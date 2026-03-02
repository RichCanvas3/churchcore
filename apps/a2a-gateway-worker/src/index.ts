import { z } from "zod";

type Env = {
  churchcore: D1Database;
  LANGGRAPH_DEPLOYMENT_URL?: string;
  LANGSMITH_API_KEY?: string;
  LANGGRAPH_ASSISTANT_ID?: string;
  A2A_API_KEY?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function normalizePhone(input: string) {
  const raw = String(input ?? "").trim();
  const digits = raw.replace(/[^\d+]/g, "");
  const justDigits = digits.replace(/[^\d]/g, "");
  if (justDigits.length === 10) return `+1${justDigits}`;
  if (justDigits.length === 11 && justDigits.startsWith("1")) return `+${justDigits}`;
  if (raw.startsWith("+") && justDigits.length >= 8) return `+${justDigits}`;
  return raw || `+${justDigits}`;
}

function ageMonthsFromBirthdate(birthdate: string | null | undefined) {
  if (!birthdate) return null;
  const d = new Date(String(birthdate));
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months -= 1;
  return months < 0 ? 0 : months;
}

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data ?? {}), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init?.headers ?? {}) },
  });
}

function requireApiKey(req: Request, env: Env) {
  const required = (env.A2A_API_KEY ?? "").trim();
  if (!required) return null;
  const got = (req.headers.get("x-api-key") ?? "").trim();
  if (!got || got !== required) return json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

const IdentitySchema = z.object({
  tenant_id: z.string().min(1),
  user_id: z.string().min(1),
  thread_id: z.string().min(1).optional().nullable(),
  role: z.enum(["seeker", "guide"]).optional().nullable(),
  persona_id: z.string().min(1).optional().nullable(),
  campus_id: z.string().min(1).optional().nullable(),
  timezone: z.string().min(1).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

const ChurchOverviewSchema = z.object({
  identity: IdentitySchema,
});

const StrategicIntentsListSchema = z.object({
  identity: IdentitySchema,
  intent_type: z.string().min(1).optional().nullable(),
});

async function parseJson(req: Request) {
  const raw = await req.json().catch(() => null);
  return raw;
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(String(text ?? ""));
  } catch {
    return null;
  }
}

async function getUserRoles(env: Env, args: { churchId: string; userId: string }) {
  const rows =
    (
      await env.churchcore
        .prepare(`SELECT role FROM roles WHERE church_id=?1 AND user_id=?2`)
        .bind(args.churchId, args.userId)
        .all()
    ).results ?? [];
  return new Set((rows as any[]).map((r) => String(r.role || "")).filter(Boolean));
}

async function resolvePerson(env: Env, identity: z.infer<typeof IdentitySchema>) {
  const churchId = identity.tenant_id;
  const userId = identity.user_id;

  let personId = (identity.persona_id ?? "").trim() || null;
  if (!personId) {
    const row = (await env.churchcore
      .prepare(`SELECT person_id AS personId FROM user_person_bindings WHERE church_id=?1 AND user_id=?2`)
      .bind(churchId, userId)
      .first()) as any;
    personId = typeof row?.personId === "string" ? row.personId : null;
  }

  if (!personId) return { personId: null, person: null };

  const person = (await env.churchcore
    .prepare(`SELECT * FROM people WHERE church_id=?1 AND id=?2`)
    .bind(churchId, personId)
    .first()) as any;

  return { personId, person: person ?? { id: personId } };
}

type Visibility = "self" | "team" | "pastoral" | "restricted";

function canViewVisibility(identityRole: string, visibility: Visibility) {
  const role = (identityRole || "seeker").toLowerCase();
  if (role === "guide") return true;
  return visibility === "self";
}

function redactMemoryForRole(identityRole: string, memory: any) {
  if (!memory || typeof memory !== "object") return memory;
  const role = (identityRole || "seeker").toLowerCase();
  if (role === "guide") return memory;

  const copy = JSON.parse(JSON.stringify(memory));
  const pc = copy?.pastoralCare;
  if (pc && typeof pc === "object") {
    if (Array.isArray(pc.notes)) pc.notes = pc.notes.filter((n: any) => canViewVisibility(role, (n?.visibility ?? "restricted") as Visibility));
    if (Array.isArray(pc.prayerRequests))
      pc.prayerRequests = pc.prayerRequests.filter((n: any) => canViewVisibility(role, (n?.visibility ?? "restricted") as Visibility));
  }
  return copy;
}

async function getPersonMemory(env: Env, args: { churchId: string; personId: string }) {
  const row = (await env.churchcore
    .prepare(`SELECT memory_json AS memoryJson, updated_at AS updatedAt FROM person_memory WHERE church_id=?1 AND person_id=?2`)
    .bind(args.churchId, args.personId)
    .first()) as any;
  if (!row?.memoryJson) return { memory: null, updatedAt: null };
  try {
    return { memory: JSON.parse(String(row.memoryJson)), updatedAt: row.updatedAt ?? null };
  } catch {
    return { memory: null, updatedAt: row.updatedAt ?? null };
  }
}

async function getHouseholdSummary(env: Env, args: { churchId: string; personId: string }) {
  const householdRow = (await env.churchcore
    .prepare(
      `SELECT hm.household_id AS householdId
       FROM household_members hm
       JOIN people p ON p.id = hm.person_id
       WHERE p.church_id=?1 AND p.id=?2
       LIMIT 1`,
    )
    .bind(args.churchId, args.personId)
    .first()) as any;
  const householdId = typeof householdRow?.householdId === "string" ? householdRow.householdId : null;
  if (!householdId) return { householdId: null, summary: "" };

  const kids =
    (
      await env.churchcore
        .prepare(
          `SELECT p.id, p.first_name, p.last_name, p.birthdate, cp.allergies, cp.special_needs
           FROM household_members hm
           JOIN people p ON p.id = hm.person_id
           LEFT JOIN child_profiles cp ON cp.person_id=p.id AND cp.church_id=p.church_id
           WHERE p.church_id=?1 AND hm.household_id=?2 AND hm.role='child'`,
        )
        .bind(args.churchId, householdId)
        .all()
    ).results ?? [];

  const bits = (kids as any[]).map((k) => {
    const name = `${k.first_name ?? ""} ${k.last_name ?? ""}`.trim();
    const months = ageMonthsFromBirthdate(k.birthdate ?? null);
    const years = months === null ? null : Math.floor(months / 12);
    const allergy = k.allergies ? `allergy=${String(k.allergies)}` : "";
    const sn = k.special_needs ? "special_needs" : "";
    const tail = [years !== null ? `age=${years}` : "", allergy, sn].filter(Boolean).join(", ");
    return tail ? `${name} (${tail})` : name;
  });

  const summary = bits.length ? `Household kids: ${bits.join("; ")}` : "";
  return { householdId, summary };
}

async function upsertPersonMemory(env: Env, args: { churchId: string; personId: string; memory: unknown }) {
  const ts = nowIso();
  await env.churchcore
    .prepare(
      `INSERT INTO person_memory (church_id, person_id, memory_json, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (church_id, person_id) DO UPDATE SET memory_json=excluded.memory_json, updated_at=excluded.updated_at`,
    )
    .bind(args.churchId, args.personId, JSON.stringify(args.memory ?? {}), ts, ts)
    .run();
  return { ok: true, updatedAt: ts };
}

function getByPath(obj: any, path: string) {
  const parts = path.split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function setByPath(obj: any, path: string, value: any) {
  const parts = path.split(".").filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (i === parts.length - 1) {
      cur[p] = value;
    } else {
      if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
      cur = cur[p];
    }
  }
}

type MemoryOp = {
  op: "set" | "append";
  path: string;
  value: any;
  visibility?: Visibility;
  confidence?: number;
};

const MemoryOpSchema = z.object({
  op: z.enum(["set", "append"]),
  path: z.string().min(1),
  value: z.unknown(),
  visibility: z.enum(["self", "team", "pastoral", "restricted"]).optional().nullable(),
  confidence: z.number().optional().nullable(),
});

const MemoryGetSchema = z.object({
  identity: IdentitySchema,
  person_id: z.string().min(1).optional().nullable(),
});

const MemoryApplyOpsSchema = z.object({
  identity: IdentitySchema,
  thread_id: z.string().min(1).optional().nullable(),
  person_id: z.string().min(1).optional().nullable(),
  ops: z.array(MemoryOpSchema).min(1),
});

const MemoryAuditListSchema = z.object({
  identity: IdentitySchema,
  person_id: z.string().min(1).optional().nullable(),
  limit: z.number().int().min(1).max(200).optional().nullable(),
  offset: z.number().int().min(0).max(500000).optional().nullable(),
});

// Journey endpoints
const JourneyGetStateSchema = z.object({
  identity: IdentitySchema,
  person_id: z.string().min(1).optional().nullable(),
});

const JourneyNextStepsSchema = z.object({
  identity: IdentitySchema,
  person_id: z.string().min(1).optional().nullable(),
  limit: z.number().int().min(1).max(10).optional().nullable(),
});

const JourneyCompleteStepSchema = z.object({
  identity: IdentitySchema,
  person_id: z.string().min(1).optional().nullable(),
  node_id: z.string().min(1),
  event_type: z.enum(["COMPLETED", "STARTED", "NOTE", "ASSESSMENT"]).optional().nullable(),
  value: z.unknown().optional().nullable(),
  access_level: z.enum(["self", "staff", "pastoral", "restricted"]).optional().nullable(),
});

function applyMemoryOps(baseMemory: any, ops: MemoryOp[], identityRole: string) {
  const role = (identityRole || "seeker").toLowerCase();
  const mem = baseMemory && typeof baseMemory === "object" ? baseMemory : {};
  const applied: MemoryOp[] = [];

  for (const raw of ops) {
    const op = raw && typeof raw === "object" ? raw : null;
    if (!op) continue;
    if ((op.op !== "set" && op.op !== "append") || typeof op.path !== "string" || !op.path.trim()) continue;
    const visibility = (op.visibility ?? "self") as Visibility;
    if (role !== "guide" && visibility !== "self") continue;

    if (op.op === "set") {
      setByPath(mem, op.path, op.value);
      applied.push({ op: "set", path: op.path, value: op.value, visibility, confidence: op.confidence });
      continue;
    }

    const existing = getByPath(mem, op.path);
    const entry = op.value && typeof op.value === "object" ? { ...op.value, visibility } : { value: op.value, visibility };
    if (Array.isArray(existing)) {
      existing.push(entry);
    } else {
      setByPath(mem, op.path, [entry]);
    }
    applied.push({ op: "append", path: op.path, value: entry, visibility, confidence: op.confidence });
  }

  return { memory: mem, applied };
}

function isAllowedMemoryPathForSeeker(path: string) {
  const p = String(path || "").trim();
  if (!p) return false;
  if (p.startsWith("identity.")) return true;
  if (p.startsWith("contact.")) return true;
  if (p.startsWith("communicationPreferences.")) return true;
  if (p.startsWith("spiritualJourney.")) return true;
  if (p.startsWith("intentProfile.")) return true;
  if (p.startsWith("pastoralCare.prayerRequests")) return true;
  return false;
}

function canEditArea(identityRole: string, roles: Set<string>, area: string) {
  const role = (identityRole || "seeker").toLowerCase();
  if (role === "guide" || roles.has("staff")) return true;
  const a = String(area || "").toLowerCase();
  if (a === "identity_contact") return true;
  if (a === "faith_journey") return true;
  if (a === "comm_prefs") return true;
  if (a === "care_pastoral") return true; // seekers can manage their own prayer requests
  return false;
}

async function handleMemoryGet(req: Request, env: Env) {
  const parsed = MemoryGetSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const roles = await getUserRoles(env, { churchId, userId });

  const resolved = await resolvePerson(env, identity);
  const personId = (parsed.data.person_id ?? "").trim() || resolved.personId;
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const memRow = await getPersonMemory(env, { churchId, personId });
  const redacted = redactMemoryForRole(role, memRow.memory ?? {});

  return json({
    ok: true,
    person_id: personId,
    updated_at: memRow.updatedAt,
    memory: redacted,
    can_edit: {
      identity_contact: canEditArea(role, roles, "identity_contact"),
      faith_journey: canEditArea(role, roles, "faith_journey"),
      comm_prefs: canEditArea(role, roles, "comm_prefs"),
      teams_skills: canEditArea(role, roles, "teams_skills"),
      care_pastoral: canEditArea(role, roles, "care_pastoral"),
      kids_safety: canEditArea(role, roles, "kids_safety"),
    },
    actor: { userId, role, roles: Array.from(roles.values()) },
  });
}

async function handleMemoryApplyOps(req: Request, env: Env) {
  const parsed = MemoryApplyOpsSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const roles = await getUserRoles(env, { churchId, userId });

  const resolved = await resolvePerson(env, identity);
  const personId = (parsed.data.person_id ?? "").trim() || resolved.personId;
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const personMemory = await getPersonMemory(env, { churchId, personId });
  const base = personMemory.memory ?? {};

  const identityRole = (role || "seeker").toLowerCase();
  const canEditAll = identityRole === "guide" || roles.has("staff");
  const ops: MemoryOp[] = [];
  for (const op of parsed.data.ops as any[]) {
    const vis = ((op?.visibility ?? "self") || "self") as Visibility;
    const path = String(op?.path ?? "").trim();
    if (!path) continue;
    if (!canEditAll) {
      if (!isAllowedMemoryPathForSeeker(path)) continue;
      if (vis !== "self") continue;
    }
    ops.push({ op: op.op, path, value: op.value, visibility: vis, confidence: typeof op.confidence === "number" ? op.confidence : undefined });
  }

  if (!ops.length) return json({ ok: false, error: "No permitted ops" }, { status: 403 });

  const { memory: nextMemory, applied } = applyMemoryOps(base, ops, identityRole);
  if (applied.length) {
    await upsertPersonMemory(env, { churchId, personId, memory: nextMemory });
    await auditMemoryOps(env, {
      churchId,
      personId,
      threadId: (parsed.data.thread_id ?? "").trim() || (identity.thread_id ?? "").trim() || "thread_unknown",
      actorUserId: userId,
      actorRole: canEditAll ? "guide" : "seeker",
      ops: applied,
      turnId: null,
    });
  }

  const updated = await getPersonMemory(env, { churchId, personId });
  const redacted = redactMemoryForRole(role, updated.memory ?? {});
  return json({ ok: true, person_id: personId, updated_at: updated.updatedAt, memory: redacted, applied });
}

async function handleMemoryAuditList(req: Request, env: Env) {
  const parsed = MemoryAuditListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const roles = await getUserRoles(env, { churchId, userId });

  const resolved = await resolvePerson(env, identity);
  const personId = (parsed.data.person_id ?? "").trim() || resolved.personId;
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const limit = parsed.data.limit ?? 50;
  const offset = parsed.data.offset ?? 0;
  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT id, thread_id AS threadId, turn_id AS turnId, actor_user_id AS actorUserId, actor_role AS actorRole, ops_json AS opsJson, created_at AS createdAt
           FROM person_memory_audit
           WHERE church_id=?1 AND person_id=?2
           ORDER BY created_at DESC
           LIMIT ${limit} OFFSET ${offset}`,
        )
        .bind(churchId, personId)
        .all()
    ).results ?? [];

  const isGuide = (role || "seeker").toLowerCase() === "guide" || roles.has("staff");
  const audits = (rows as any[]).map((r) => {
    let ops: any[] = [];
    try {
      ops = JSON.parse(String(r.opsJson || "[]"));
    } catch {
      ops = [];
    }
    if (!isGuide) {
      ops = (Array.isArray(ops) ? ops : []).filter((op) => {
        const vis = (op?.visibility ?? "restricted") as Visibility;
        return canViewVisibility(role, vis) && isAllowedMemoryPathForSeeker(String(op?.path ?? ""));
      });
    }
    return { id: r.id, threadId: r.threadId, turnId: r.turnId, actorUserId: r.actorUserId, actorRole: r.actorRole, ops, createdAt: r.createdAt };
  });

  return json({ ok: true, person_id: personId, audits, actor: { userId, role, roles: Array.from(roles.values()) } });
}

async function handleJourneyGetState(req: Request, env: Env) {
  const parsed = JourneyGetStateSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const resolved = await resolvePerson(env, identity);
  const personId = (parsed.data.person_id ?? "").trim() || resolved.personId;
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const personMemory = await getPersonMemory(env, { churchId, personId });
  const state = await ensurePersonJourneyState(env, { churchId, personId, personMemory: personMemory.memory ?? {} });
  const stages = await getJourneyStages(env, { churchId });
  const currentStageId = state.currentStageId ?? "stage_seeker";
  const currentStage = await getJourneyNode(env, { churchId, nodeId: currentStageId });
  const completed = await listPersonJourneyCompleted(env, { churchId, personId });
  const currentStageDocs = await listJourneyLinkedContentDocs(env, { churchId, nodeId: currentStageId, limit: 6 });
  const currentStageEntityLinks = await listJourneyEntityLinks(env, { churchId, nodeId: currentStageId, limit: 5 });
  const currentStageEntities: any[] = [];
  for (const l of currentStageEntityLinks) {
    const resolved = await resolveEntityByLink(env, { churchId, entityType: l.entityType, entityId: l.entityId });
    if (resolved) currentStageEntities.push({ ...resolved, relevance: l.relevance, metadata: l.metadata ?? null });
  }

  return json({
    ok: true,
    person_id: personId,
    current_stage: currentStage,
    stages,
    completed_node_ids: Array.from(completed.completedNodeIds.values()),
    current_stage_docs: currentStageDocs,
    current_stage_entities: currentStageEntities,
    confidence: state.confidence,
    updated_at: state.updatedAt,
    actor: { userId, role },
  });
}

async function handleJourneyNextSteps(req: Request, env: Env) {
  const parsed = JourneyNextStepsSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const resolved = await resolvePerson(env, identity);
  const personId = (parsed.data.person_id ?? "").trim() || resolved.personId;
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const limit = parsed.data.limit ?? 3;
  const personMemory = await getPersonMemory(env, { churchId, personId });
  const state = await ensurePersonJourneyState(env, { churchId, personId, personMemory: personMemory.memory ?? {} });
  const currentStageId = state.currentStageId ?? "stage_seeker";
  const nextSteps = await computeJourneyNextSteps(env, { churchId, personId, currentStageId, limit });

  const enriched: any[] = [];
  for (const s of nextSteps as any[]) {
    const nodeId = String(s?.node?.id ?? "");
    const docs = nodeId ? await listJourneyLinkedContentDocs(env, { churchId, nodeId, limit: 4 }) : [];
    const nodeEntityLinks = nodeId ? await listJourneyEntityLinks(env, { churchId, nodeId, limit: 5 }) : [];
    const entities: any[] = [];
    for (const l of nodeEntityLinks) {
      const resolved = await resolveEntityByLink(env, { churchId, entityType: l.entityType, entityId: l.entityId });
      if (resolved) entities.push({ ...resolved, relevance: l.relevance, metadata: l.metadata ?? null });
    }
    const legacyEntity = await resolveJourneyNodeEntity(env, { churchId, node: s?.node ?? null });
    enriched.push({ ...s, linked: { docs, entities, legacyEntity } });
  }

  return json({ ok: true, person_id: personId, current_stage_id: currentStageId, next_steps: enriched, actor: { userId, role } });
}

async function handleJourneyCompleteStep(req: Request, env: Env) {
  const parsed = JourneyCompleteStepSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const roles = await getUserRoles(env, { churchId, userId });

  const resolved = await resolvePerson(env, identity);
  const personId = (parsed.data.person_id ?? "").trim() || resolved.personId;
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const nodeId = parsed.data.node_id.trim();
  const node = await getJourneyNode(env, { churchId, nodeId });
  if (!node) return json({ ok: false, error: "Unknown node_id" }, { status: 404 });

  const identityRole = (role || "seeker").toLowerCase();
  const isGuide = identityRole === "guide" || roles.has("staff");
  const eventType = (parsed.data.event_type ?? "COMPLETED").trim();
  const accessLevel = (parsed.data.access_level ?? (isGuide ? "pastoral" : "self")).trim();
  const allowedAccess =
    accessLevel === "self" || (isGuide && (accessLevel === "staff" || accessLevel === "pastoral" || accessLevel === "restricted"));
  if (!allowedAccess) return json({ ok: false, error: "Not permitted" }, { status: 403 });

  if (node.type === "Stage") {
    await upsertPersonJourneyStage(env, { churchId, personId, stageId: node.id, confidence: 0.6 });
    await insertPersonJourneyEvent(env, { churchId, personId, nodeId: node.id, eventType: "NOTE", valueJson: { setStage: true }, source: "user", accessLevel: "self" });
    return json({ ok: true, person_id: personId, updated_stage_id: node.id });
  }

  await insertPersonJourneyEvent(env, {
    churchId,
    personId,
    nodeId: node.id,
    eventType,
    valueJson: parsed.data.value ?? null,
    source: isGuide ? "staff" : "user",
    accessLevel,
  });
  return json({ ok: true, person_id: personId, node_id: node.id, event_type: eventType });
}

async function auditMemoryOps(env: Env, args: { churchId: string; personId: string; threadId: string; actorUserId: string; actorRole: string; ops: unknown; turnId?: string | null }) {
  const id = crypto.randomUUID();
  await env.churchcore
    .prepare(
      `INSERT INTO person_memory_audit (id, church_id, person_id, thread_id, turn_id, actor_user_id, actor_role, ops_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(id, args.churchId, args.personId, args.threadId, args.turnId ?? null, args.actorUserId, args.actorRole, JSON.stringify(args.ops ?? {}), nowIso())
    .run();
  return { ok: true, auditId: id };
}

type JourneyStage = { id: string; title: string; summary: string | null };

async function getJourneyStages(env: Env, args: { churchId: string }): Promise<JourneyStage[]> {
  const rows = (
    await env.churchcore
      .prepare(`SELECT node_id AS id, title, summary FROM journey_node WHERE church_id=?1 AND node_type='Stage' ORDER BY node_id ASC`)
      .bind(args.churchId)
      .all()
  ).results as any[];
  return (rows ?? []).map((r) => ({ id: String(r.id), title: String(r.title), summary: r.summary ?? null }));
}

async function getJourneyNode(env: Env, args: { churchId: string; nodeId: string }) {
  const row = (
    await env.churchcore
      .prepare(`SELECT node_id AS id, node_type AS type, title, summary, metadata_json AS metadataJson FROM journey_node WHERE church_id=?1 AND node_id=?2`)
      .bind(args.churchId, args.nodeId)
      .first()
  ) as any;
  return row
    ? {
        id: String(row.id),
        type: String(row.type),
        title: String(row.title),
        summary: row.summary ?? null,
        metadata: typeof row.metadataJson === "string" ? safeJsonParse(row.metadataJson) : null,
      }
    : null;
}

async function listJourneyLinkedContentDocs(env: Env, args: { churchId: string; nodeId: string; limit: number }) {
  const lim = Math.max(1, Math.min(20, args.limit));
  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT cd.id AS docId, cd.entity_type AS entityType, cd.entity_id AS entityId, cd.locale, cd.title, cd.body_markdown AS bodyMarkdown, jr.relevance
           FROM journey_resource_link jr
           JOIN content_docs cd ON cd.id = jr.resource_id
           WHERE jr.church_id=?1 AND jr.node_id=?2
           ORDER BY jr.relevance DESC, cd.updated_at DESC
           LIMIT ${lim}`,
        )
        .bind(args.churchId, args.nodeId)
        .all()
    ).results ?? [];

  return (rows as any[]).map((r) => ({
    docId: String(r.docId),
    entityType: String(r.entityType),
    entityId: String(r.entityId),
    locale: r.locale ?? "en",
    title: r.title ?? null,
    bodyMarkdown: String(r.bodyMarkdown ?? ""),
    relevance: typeof r.relevance === "number" ? r.relevance : 1.0,
  }));
}

async function listJourneyEntityLinks(env: Env, args: { churchId: string; nodeId: string; limit: number }) {
  const lim = Math.max(1, Math.min(20, args.limit));
  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT entity_type AS entityType, entity_id AS entityId, relevance, metadata_json AS metadataJson
           FROM journey_entity_link
           WHERE church_id=?1 AND node_id=?2
           ORDER BY relevance DESC
           LIMIT ${lim}`,
        )
        .bind(args.churchId, args.nodeId)
        .all()
    ).results ?? [];
  return (rows as any[]).map((r) => ({
    entityType: String(r.entityType),
    entityId: String(r.entityId),
    relevance: typeof r.relevance === "number" ? r.relevance : 1.0,
    metadata: typeof r.metadataJson === "string" ? safeJsonParse(r.metadataJson) : null,
  }));
}

async function resolveJourneyNodeEntity(env: Env, args: { churchId: string; node: any }) {
  const meta = args?.node?.metadata;
  const entityType = typeof meta?.entity_type === "string" ? meta.entity_type : typeof meta?.entityType === "string" ? meta.entityType : "";
  const entityId = typeof meta?.entity_id === "string" ? meta.entity_id : typeof meta?.entityId === "string" ? meta.entityId : "";
  if (!entityType || !entityId) return null;

  if (entityType === "group") {
    const row = (await env.churchcore.prepare(`SELECT * FROM groups WHERE church_id=?1 AND id=?2`).bind(args.churchId, entityId).first()) as any;
    return row ? { type: "group", group: row } : null;
  }
  if (entityType === "resource") {
    const row = (await env.churchcore.prepare(`SELECT * FROM resources WHERE church_id=?1 AND id=?2`).bind(args.churchId, entityId).first()) as any;
    return row ? { type: "resource", resource: row } : null;
  }
  if (entityType === "opportunity") {
    const row = (
      await env.churchcore.prepare(`SELECT * FROM opportunities WHERE church_id=?1 AND id=?2`).bind(args.churchId, entityId).first()
    ) as any;
    return row ? { type: "opportunity", opportunity: row } : null;
  }
  if (entityType === "event") {
    const row = (await env.churchcore.prepare(`SELECT * FROM events WHERE church_id=?1 AND id=?2`).bind(args.churchId, entityId).first()) as any;
    return row ? { type: "event", event: row } : null;
  }
  if (entityType === "content_doc") {
    const row = (await env.churchcore.prepare(`SELECT * FROM content_docs WHERE church_id=?1 AND id=?2`).bind(args.churchId, entityId).first()) as any;
    return row ? { type: "content_doc", doc: row } : null;
  }
  return null;
}

async function resolveEntityByLink(env: Env, args: { churchId: string; entityType: string; entityId: string }) {
  const entityType = String(args.entityType || "").trim();
  const entityId = String(args.entityId || "").trim();
  if (!entityType || !entityId) return null;

  if (entityType === "group") {
    const row = (await env.churchcore.prepare(`SELECT * FROM groups WHERE church_id=?1 AND id=?2`).bind(args.churchId, entityId).first()) as any;
    return row ? { type: "group", group: row } : null;
  }
  if (entityType === "resource") {
    const row = (await env.churchcore.prepare(`SELECT * FROM resources WHERE church_id=?1 AND id=?2`).bind(args.churchId, entityId).first()) as any;
    return row ? { type: "resource", resource: row } : null;
  }
  if (entityType === "opportunity") {
    const row = (
      await env.churchcore.prepare(`SELECT * FROM opportunities WHERE church_id=?1 AND id=?2`).bind(args.churchId, entityId).first()
    ) as any;
    return row ? { type: "opportunity", opportunity: row } : null;
  }
  if (entityType === "event") {
    const row = (await env.churchcore.prepare(`SELECT * FROM events WHERE church_id=?1 AND id=?2`).bind(args.churchId, entityId).first()) as any;
    return row ? { type: "event", event: row } : null;
  }
  if (entityType === "content_doc") {
    const row = (await env.churchcore.prepare(`SELECT * FROM content_docs WHERE church_id=?1 AND id=?2`).bind(args.churchId, entityId).first()) as any;
    return row ? { type: "content_doc", doc: row } : null;
  }
  return null;
}

async function getPersonJourneyState(env: Env, args: { churchId: string; personId: string }) {
  const row = (
    await env.churchcore
      .prepare(`SELECT current_stage_id AS currentStageId, confidence, updated_at AS updatedAt FROM person_journey_state WHERE church_id=?1 AND person_id=?2`)
      .bind(args.churchId, args.personId)
      .first()
  ) as any;
  return row
    ? {
        currentStageId: row.currentStageId ? String(row.currentStageId) : null,
        confidence: typeof row.confidence === "number" ? row.confidence : 0.5,
        updatedAt: row.updatedAt ?? null,
      }
    : { currentStageId: null, confidence: 0.5, updatedAt: null };
}

async function upsertPersonJourneyStage(env: Env, args: { churchId: string; personId: string; stageId: string; confidence?: number | null }) {
  const now = nowIso();
  await env.churchcore
    .prepare(
      `INSERT INTO person_journey_state (church_id, person_id, current_stage_id, confidence, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(church_id, person_id) DO UPDATE SET current_stage_id=excluded.current_stage_id, confidence=excluded.confidence, updated_at=excluded.updated_at`,
    )
    .bind(args.churchId, args.personId, args.stageId, typeof args.confidence === "number" ? args.confidence : 0.5, now)
    .run();
}

async function listPersonJourneyCompleted(env: Env, args: { churchId: string; personId: string }) {
  const rows = (
    await env.churchcore
      .prepare(
        `SELECT node_id AS nodeId, created_at AS createdAt
         FROM person_journey_event
         WHERE church_id=?1 AND person_id=?2 AND event_type='COMPLETED'
         ORDER BY created_at DESC LIMIT 500`,
      )
      .bind(args.churchId, args.personId)
      .all()
  ).results as any[];
  const set = new Set<string>();
  for (const r of rows ?? []) set.add(String(r.nodeId));
  return { completedNodeIds: set, completedRows: rows ?? [] };
}

async function listPersonJourneyRecentEvents(env: Env, args: { churchId: string; personId: string; limit: number }) {
  const lim = Math.max(1, Math.min(500, args.limit));
  const rows = (
    await env.churchcore
      .prepare(
        `SELECT node_id AS nodeId, event_type AS eventType, value_json AS valueJson, created_at AS createdAt
         FROM person_journey_event
         WHERE church_id=?1 AND person_id=?2
         ORDER BY created_at DESC
         LIMIT ${lim}`,
      )
      .bind(args.churchId, args.personId)
      .all()
  ).results as any[];
  return rows ?? [];
}

async function listJourneyEdgesFrom(env: Env, args: { churchId: string; fromNodeId: string }) {
  const rows = (
    await env.churchcore
      .prepare(
        `SELECT edge_id AS edgeId, to_node_id AS toNodeId, edge_type AS edgeType, weight, metadata_json AS metadataJson
         FROM journey_edge WHERE church_id=?1 AND from_node_id=?2`,
      )
      .bind(args.churchId, args.fromNodeId)
      .all()
  ).results as any[];
  return (rows ?? []).map((r) => ({
    edgeId: String(r.edgeId),
    toNodeId: String(r.toNodeId),
    edgeType: String(r.edgeType),
    weight: typeof r.weight === "number" ? r.weight : 1.0,
    metadata: typeof r.metadataJson === "string" ? safeJsonParse(r.metadataJson) : null,
  }));
}

async function insertPersonJourneyEvent(env: Env, args: { churchId: string; personId: string; nodeId: string; eventType: string; valueJson: any; source: string; accessLevel: string }) {
  const now = nowIso();
  await env.churchcore
    .prepare(
      `INSERT INTO person_journey_event (event_id, church_id, person_id, node_id, event_type, value_json, source, access_level, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(crypto.randomUUID(), args.churchId, args.personId, args.nodeId, args.eventType, JSON.stringify(args.valueJson ?? null), args.source, args.accessLevel, now)
    .run();
}

function mapLegacyStageToCanonical(stage: string) {
  const s = String(stage || "").trim().toLowerCase();
  if (!s) return "stage_seeker";
  if (s === "visit_planned") return "stage_seeker";
  if (s === "seeker") return "stage_seeker";
  if (s === "gospel_clarity") return "stage_gospel_clarity";
  if (s === "conversion") return "stage_conversion";
  if (s === "new" || s === "new_believer") return "stage_new_believer";
  if (s === "connected") return "stage_connected";
  if (s === "growing") return "stage_growing";
  if (s === "serving") return "stage_serving";
  if (s === "multiplying") return "stage_multiplying";
  if (s === "leader") return "stage_leader";
  return "stage_seeker";
}

async function ensurePersonJourneyState(env: Env, args: { churchId: string; personId: string; personMemory: any }) {
  const existing = await getPersonJourneyState(env, { churchId: args.churchId, personId: args.personId });
  if (existing.currentStageId) return existing;
  const legacy = args.personMemory?.spiritualJourney?.stage;
  const canonical = mapLegacyStageToCanonical(typeof legacy === "string" ? legacy : "");
  await upsertPersonJourneyStage(env, { churchId: args.churchId, personId: args.personId, stageId: canonical, confidence: 0.5 });
  return await getPersonJourneyState(env, { churchId: args.churchId, personId: args.personId });
}

async function computeJourneyNextSteps(env: Env, args: { churchId: string; personId: string; currentStageId: string; limit: number }) {
  const { completedNodeIds } = await listPersonJourneyCompleted(env, { churchId: args.churchId, personId: args.personId });
  const stageEdges = await listJourneyEdgesFrom(env, { churchId: args.churchId, fromNodeId: args.currentStageId });

  const candidates: Array<{ nodeId: string; edgeType: string; score: number; why: string }> = [];
  for (const e of stageEdges) {
    const edgeType = String(e.edgeType);
    const weight = typeof e.weight === "number" ? e.weight : 1.0;
    if (edgeType === "REQUIRES") {
      if (!completedNodeIds.has(e.toNodeId)) candidates.push({ nodeId: e.toNodeId, edgeType, score: weight + 0.2, why: "Required for this stage" });
    } else if (edgeType === "RECOMMENDS") {
      candidates.push({ nodeId: e.toNodeId, edgeType, score: weight, why: "Recommended next step" });
    }
  }

  // Barrier-aware: if the person has an active barrier event, add RESOLVED_BY edges as priority candidates.
  const recent = await listPersonJourneyRecentEvents(env, { churchId: args.churchId, personId: args.personId, limit: 80 });
  const activeBarrierNodeIds: string[] = [];
  for (const ev of recent) {
    const nodeId = String(ev?.nodeId ?? "");
    if (!nodeId) continue;
    if (String(ev?.eventType ?? "") !== "ASSESSMENT" && String(ev?.eventType ?? "") !== "NOTE") continue;
    const v = typeof ev?.valueJson === "string" ? safeJsonParse(ev.valueJson) : null;
    const active = v && typeof v === "object" ? Boolean(v.active) || (typeof v.score === "number" && v.score >= 0.6) : false;
    if (!active) continue;
    const node = await getJourneyNode(env, { churchId: args.churchId, nodeId });
    if (node && node.type === "Barrier") activeBarrierNodeIds.push(nodeId);
  }
  for (const barrierId of Array.from(new Set(activeBarrierNodeIds)).slice(0, 3)) {
    const edges = await listJourneyEdgesFrom(env, { churchId: args.churchId, fromNodeId: barrierId });
    for (const e of edges) {
      if (String(e.edgeType) !== "RESOLVED_BY") continue;
      const weight = typeof e.weight === "number" ? e.weight : 1.0;
      candidates.push({ nodeId: e.toNodeId, edgeType: "RESOLVED_BY", score: weight + 0.5, why: "Helps address a current barrier" });
    }
  }

  // Fetch nodes and pick a balanced set: ActionStep + Community + Resource/Doctrine/Practice, then fill by score.
  const dedup = new Map<string, { node: any; edgeType: string; score: number; why: string }>();
  for (const c of candidates) {
    if (!c.nodeId) continue;
    if (completedNodeIds.has(c.nodeId) && c.edgeType === "REQUIRES") continue;
    const existing = dedup.get(c.nodeId);
    if (!existing || c.score > existing.score) {
      const node = await getJourneyNode(env, { churchId: args.churchId, nodeId: c.nodeId });
      if (!node) continue;
      dedup.set(c.nodeId, { node, edgeType: c.edgeType, score: c.score, why: c.why });
    }
  }

  const all = Array.from(dedup.values()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const actions = all.filter((x) => x.node?.type === "ActionStep");
  const communities = all.filter((x) => x.node?.type === "Community");
  const resources = all.filter((x) => ["Resource", "DoctrineTopic", "Practice", "Milestone"].includes(String(x.node?.type ?? "")));

  const picked: any[] = [];
  if (actions[0]) picked.push(actions[0]);
  if (communities[0]) picked.push(communities[0]);
  if (resources[0]) picked.push(resources[0]);

  for (const x of all) {
    if (picked.length >= Math.max(1, args.limit)) break;
    if (picked.some((p) => p.node?.id === x.node?.id)) continue;
    picked.push(x);
  }

  return picked.map((p) => ({ node: p.node, edgeType: p.edgeType, score: p.score, why: p.why }));
}

async function requireOwnedThread(env: Env, args: { churchId: string; userId: string; threadId: string }) {
  const { churchId, userId, threadId } = args;
  const row = (await env.churchcore
    .prepare(`SELECT id,title,status FROM chat_threads WHERE church_id=?1 AND user_id=?2 AND id=?3`)
    .bind(churchId, userId, threadId)
    .first()) as any;
  return row ?? null;
}

async function appendMessage(env: Env, args: { churchId: string; userId: string; threadId: string; senderType: string; content: string; envelope?: unknown }) {
  const thread = await requireOwnedThread(env, args);
  if (!thread) return { error: "Thread not found" };

  const id = crypto.randomUUID();
  const createdAt = nowIso();
  await env.churchcore
    .prepare(
      `INSERT INTO chat_messages (id, church_id, thread_id, sender_type, content, envelope_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(id, args.churchId, args.threadId, args.senderType, args.content, args.envelope ? JSON.stringify(args.envelope) : null, createdAt)
    .run();

  await env.churchcore
    .prepare(`UPDATE chat_threads SET updated_at=?1 WHERE church_id=?2 AND user_id=?3 AND id=?4`)
    .bind(createdAt, args.churchId, args.userId, args.threadId)
    .run();

  return { messageId: id, ok: true };
}

const ThreadCreateSchema = z.object({
  identity: IdentitySchema,
  title: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

const ThreadListSchema = z.object({
  identity: IdentitySchema,
  include_archived: z.boolean().optional().nullable(),
});

const ThreadGetSchema = z.object({
  identity: IdentitySchema,
  thread_id: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional().nullable(),
  offset: z.number().int().min(0).max(500000).optional().nullable(),
});

const ThreadRenameSchema = z.object({
  identity: IdentitySchema,
  thread_id: z.string().min(1),
  title: z.string().min(1),
});

const ThreadArchiveSchema = z.object({
  identity: IdentitySchema,
  thread_id: z.string().min(1),
});

const ThreadAppendSchema = z.object({
  identity: IdentitySchema,
  thread_id: z.string().min(1),
  sender_type: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  envelope: z.unknown().optional().nullable(),
});

const ChatSchema = z.object({
  identity: IdentitySchema,
  thread_id: z.string().min(1),
  message: z.string().min(1),
  skill: z.string().min(1).optional().nullable(),
  args: z.record(z.string(), z.unknown()).optional().nullable(),
});

// Households + check-in
const HouseholdIdentifySchema = z.object({
  identity: IdentitySchema,
  phone: z.string().min(6),
  otp_code: z.string().min(3).optional().nullable(),
});

const HouseholdCreateSchema = z.object({
  identity: IdentitySchema,
  household_name: z.string().optional().nullable(),
  primary_phone: z.string().min(6),
  primary_email: z.string().optional().nullable(),
  parent_first_name: z.string().min(1),
  parent_last_name: z.string().optional().nullable(),
  children: z
    .array(
      z.object({
        first_name: z.string().min(1),
        last_name: z.string().optional().nullable(),
        birthdate: z.string().optional().nullable(), // YYYY-MM-DD
        allergies: z.string().optional().nullable(),
        special_needs: z.boolean().optional().nullable(),
      }),
    )
    .min(1),
});

const HouseholdGetSchema = z.object({
  identity: IdentitySchema,
  household_id: z.string().min(1).optional().nullable(),
});

const HouseholdMemberUpsertSchema = z.object({
  identity: IdentitySchema,
  household_id: z.string().min(1),
  member: z.object({
    person_id: z.string().min(1).optional().nullable(),
    role: z.enum(["adult", "child"]),
    first_name: z.string().min(1),
    last_name: z.string().optional().nullable(),
    birthdate: z.string().optional().nullable(), // YYYY-MM-DD (optional, primarily for children)
    allergies: z.string().optional().nullable(),
    special_needs: z.boolean().optional().nullable(),
  }),
});

const HouseholdMemberRemoveSchema = z.object({
  identity: IdentitySchema,
  household_id: z.string().min(1),
  person_id: z.string().min(1),
});

const CheckinStartSchema = z.object({
  identity: IdentitySchema,
  service_plan_id: z.string().min(1),
  area_id: z.string().min(1),
});

const CheckinPreviewSchema = z.object({
  identity: IdentitySchema,
  service_plan_id: z.string().min(1),
  area_id: z.string().min(1),
  household_id: z.string().min(1),
});

const CheckinCommitSchema = z.object({
  identity: IdentitySchema,
  service_plan_id: z.string().min(1),
  area_id: z.string().min(1),
  household_id: z.string().min(1),
  selections: z.array(z.object({ person_id: z.string().min(1), room_id: z.string().min(1) })).min(1),
});

async function handleThreadCreate(req: Request, env: Env) {
  const parsed = ThreadCreateSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;

  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const title = (parsed.data.title ?? "New topic").trim() || "New topic";
  const id = crypto.randomUUID();
  const ts = nowIso();
  await env.churchcore
    .prepare(`INSERT INTO chat_threads (id, church_id, user_id, title, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6)`)
    .bind(id, churchId, userId, title, ts, ts)
    .run();
  return json({ thread_id: id, title });
}

async function handleThreadList(req: Request, env: Env) {
  const parsed = ThreadListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;

  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const includeArchived = Boolean(parsed.data.include_archived);
  const statusWhere = includeArchived ? "" : "AND status != 'archived'";

  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT id,title,status,created_at AS createdAt,updated_at AS updatedAt
           FROM chat_threads
           WHERE church_id=?1 AND user_id=?2 ${statusWhere}
           ORDER BY updated_at DESC`,
        )
        .bind(churchId, userId)
        .all()
    ).results ?? [];

  const { person } = await resolvePerson(env, identity);
  return json({ threads: rows, person });
}

async function handleThreadGet(req: Request, env: Env) {
  const parsed = ThreadGetSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const threadId = parsed.data.thread_id;

  const thread = await requireOwnedThread(env, { churchId, userId, threadId });
  if (!thread) return json({ error: "Thread not found" }, { status: 404 });

  const limit = parsed.data.limit ?? 50;
  const offset = parsed.data.offset ?? 0;
  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT id, sender_type AS senderType, content, envelope_json AS envelopeJson, created_at AS createdAt
           FROM chat_messages
           WHERE church_id=?1 AND thread_id=?2
           ORDER BY created_at ASC
           LIMIT ${limit} OFFSET ${offset}`,
        )
        .bind(churchId, threadId)
        .all()
    ).results ?? [];

  const messages = (rows as any[]).map((r) => {
    let envelope: unknown = null;
    if (r?.envelopeJson) {
      try {
        envelope = JSON.parse(String(r.envelopeJson));
      } catch {
        envelope = null;
      }
    }
    return { id: r.id, senderType: r.senderType, content: r.content, envelope, createdAt: r.createdAt };
  });

  const { person } = await resolvePerson(env, identity);
  return json({ thread, messages, person });
}

async function handleThreadRename(req: Request, env: Env) {
  const parsed = ThreadRenameSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const threadId = parsed.data.thread_id;

  const thread = await requireOwnedThread(env, { churchId, userId, threadId });
  if (!thread) return json({ error: "Thread not found" }, { status: 404 });

  const ts = nowIso();
  await env.churchcore
    .prepare(`UPDATE chat_threads SET title=?1, updated_at=?2 WHERE church_id=?3 AND user_id=?4 AND id=?5`)
    .bind(parsed.data.title, ts, churchId, userId, threadId)
    .run();
  return json({ ok: true });
}

async function handleThreadArchive(req: Request, env: Env) {
  const parsed = ThreadArchiveSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const threadId = parsed.data.thread_id;

  const thread = await requireOwnedThread(env, { churchId, userId, threadId });
  if (!thread) return json({ error: "Thread not found" }, { status: 404 });

  const ts = nowIso();
  await env.churchcore
    .prepare(`UPDATE chat_threads SET status='archived', updated_at=?1 WHERE church_id=?2 AND user_id=?3 AND id=?4`)
    .bind(ts, churchId, userId, threadId)
    .run();
  return json({ ok: true });
}

async function handleThreadAppend(req: Request, env: Env) {
  const parsed = ThreadAppendSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;

  const out = await appendMessage(env, {
    churchId,
    userId,
    threadId: parsed.data.thread_id,
    senderType: parsed.data.sender_type,
    content: parsed.data.content,
    envelope: parsed.data.envelope ?? undefined,
  });
  const status = (out as any)?.error ? 404 : 200;
  return json(out, { status });
}

async function runAgent(env: Env, args: { threadId: string; inputPayload: Record<string, unknown> }) {
  const { threadId, inputPayload } = args;
  const deploymentUrl = (env.LANGGRAPH_DEPLOYMENT_URL ?? "").trim();
  const apiKey = (env.LANGSMITH_API_KEY ?? "").trim();
  const assistantId = (env.LANGGRAPH_ASSISTANT_ID ?? "church_agent").trim() || "church_agent";
  if (!deploymentUrl || !apiKey) {
    return {
      message: "Hosted agent not configured (missing LANGGRAPH_DEPLOYMENT_URL / LANGSMITH_API_KEY).",
      suggested_next_actions: [],
      cards: [],
      forms: [],
      handoff: [{ type: "configure_langgraph", instructions: "Set Worker secrets for LANGGRAPH_DEPLOYMENT_URL and LANGSMITH_API_KEY." }],
      data: { received: inputPayload },
      citations: [],
    };
  }

  const res = await fetch(`${deploymentUrl.replace(/\/$/, "")}/runs/wait`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      assistant_id: assistantId,
      input: inputPayload,
      config: { configurable: { thread_id: threadId } },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) return { message: `LangGraph error (${res.status})`, data };

  const state = (data?.output ?? null) as any;
  const maybeEnvelope = state && typeof state === "object" ? (state.output ?? state) : null;
  return maybeEnvelope && typeof maybeEnvelope === "object" ? maybeEnvelope : data;
}

async function runAgentStream(env: Env, args: { threadId: string; inputPayload: Record<string, unknown> }) {
  const deploymentUrl = (env.LANGGRAPH_DEPLOYMENT_URL ?? "").trim();
  const apiKey = (env.LANGSMITH_API_KEY ?? "").trim();
  const assistantId = (env.LANGGRAPH_ASSISTANT_ID ?? "church_agent").trim() || "church_agent";
  if (!deploymentUrl || !apiKey) {
    throw new Error("Hosted agent not configured (missing LANGGRAPH_DEPLOYMENT_URL / LANGSMITH_API_KEY).");
  }

  const url = `${deploymentUrl.replace(/\/$/, "")}/threads/${encodeURIComponent(args.threadId)}/runs/stream`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream", "x-api-key": apiKey },
    body: JSON.stringify({
      assistant_id: assistantId,
      input: args.inputPayload,
      if_not_exists: "create",
      // Stream tokens + final state
      stream_mode: ["messages-tuple", "values", "updates"],
    }),
  });
  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => "");
    throw new Error(`LangGraph stream error (${res.status}): ${raw || "no body"}`);
  }
  return res;
}

async function handleChat(req: Request, env: Env) {
  const parsed = ChatSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;

  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const threadId = parsed.data.thread_id;
  const message = parsed.data.message;
  const role = (identity.role ?? "seeker") as string;
  const skill = (parsed.data.skill ?? "chat").trim() || "chat";

  // persist user message
  const m1 = await appendMessage(env, { churchId, userId, threadId, senderType: "user", content: message });
  if ((m1 as any)?.error) return json(m1, { status: 404 });

  const { personId } = await resolvePerson(env, identity);

  // Heuristic: only compute "next steps" when the user is asking for it (saves DB work).
  const msgLower = String(message ?? "").toLowerCase();
  const wantsNextSteps =
    skill !== "chat" ||
    /next\s+step|next\s+steps|what\s+should\s+i\s+do|journey|stage|faith|baptis|membership|join\s+(a\s+)?group|serve|volunteer|guide/i.test(msgLower);

  const [personMemory, hh] = personId
    ? await Promise.all([getPersonMemory(env, { churchId, personId }), getHouseholdSummary(env, { churchId, personId })])
    : [{ memory: null, updatedAt: null }, { householdId: null, summary: "" }];

  const redactedMemory = redactMemoryForRole(role, (personMemory as any).memory);
  const journeyState = personId
    ? await ensurePersonJourneyState(env, { churchId, personId, personMemory: (personMemory as any).memory ?? {} })
    : { currentStageId: null, confidence: 0.5, updatedAt: null };
  const currentStageId = journeyState.currentStageId ?? "stage_seeker";
  const journeyCurrentStage = personId ? await getJourneyNode(env, { churchId, nodeId: currentStageId }) : null;
  const journeyNextSteps = wantsNextSteps && personId ? await computeJourneyNextSteps(env, { churchId, personId, currentStageId, limit: 3 }) : [];
  const inputArgs = parsed.data.args && typeof parsed.data.args === "object" ? (parsed.data.args as Record<string, unknown>) : {};
  const session = {
    churchId,
    campusId: identity.campus_id ?? "campus_boulder",
    timezone: identity.timezone ?? "UTC",
    userId,
    personId,
    role,
    auth: { isAuthenticated: false, roles: [] },
    threadId,
  };

  const envelope = await runAgent(env, {
    threadId,
    inputPayload: {
      skill,
      message,
      args: {
        ...inputArgs,
        __context: {
          person_memory: redactedMemory,
          person_memory_updated_at: personMemory.updatedAt,
          household: { household_id: hh.householdId, summary: hh.summary },
          journey: { current_stage: journeyCurrentStage, next_steps: journeyNextSteps },
          policy: { role },
        },
      },
      session,
    },
  });
  const assistantText = typeof (envelope as any)?.message === "string" ? String((envelope as any).message) : "";

  // Apply MemoryOps proposed by the agent (gateway enforces policy).
  if (personId) {
    const ops = (envelope as any)?.data?.memory_ops;
    if (Array.isArray(ops) && ops.length) {
      const { memory: nextMemory, applied } = applyMemoryOps(personMemory.memory ?? {}, ops as any, role);
      if (applied.length) {
        await upsertPersonMemory(env, { churchId, personId, memory: nextMemory });
        await auditMemoryOps(env, { churchId, personId, threadId, actorUserId: userId, actorRole: role, ops: applied, turnId: null });
      }
    }
  }

  // persist assistant message (+ envelope json)
  await appendMessage(env, { churchId, userId, threadId, senderType: "assistant", content: assistantText || "", envelope });

  return json({ thread_id: threadId, output: envelope });
}

async function handleChurchGetOverview(req: Request, env: Env) {
  const parsed = ChurchOverviewSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;

  const church = (await env.churchcore.prepare(`SELECT * FROM churches WHERE id=?1`).bind(churchId).first()) as any;
  const branding = (await env.churchcore.prepare(`SELECT * FROM church_branding WHERE church_id=?1`).bind(churchId).first()) as any;
  const campuses = (await env.churchcore.prepare(`SELECT * FROM campuses WHERE church_id=?1 ORDER BY name ASC`).bind(churchId).all()).results ?? [];
  const locations = (await env.churchcore.prepare(`SELECT * FROM locations WHERE church_id=?1 ORDER BY name ASC`).bind(churchId).all()).results ?? [];
  const services = (await env.churchcore.prepare(`SELECT * FROM services WHERE church_id=?1 ORDER BY day_of_week ASC, start_time_local ASC`).bind(churchId).all())
    .results ?? [];

  const intents = (
    await env.churchcore
      .prepare(
        `SELECT id,intent_type AS intentType,title,body_markdown AS bodyMarkdown,sort_order AS sortOrder,source_url AS sourceUrl,updated_at AS updatedAt
         FROM strategic_intents
         WHERE church_id=?1
         ORDER BY intent_type ASC, sort_order ASC`,
      )
      .bind(churchId)
      .all()
  ).results ?? [];

  // small summary: first mission/vision/purpose/strategy if present
  const summarize: Record<string, any> = {};
  for (const it of intents as any[]) {
    const k = String((it as any).intentType || "");
    if (!k) continue;
    if (k === "mission" || k === "vision" || k === "purpose" || k === "strategy") {
      if (!summarize[k]) summarize[k] = it;
    }
  }

  return json({
    church: church ?? null,
    branding: branding ?? null,
    campuses,
    locations,
    services,
    strategic_intent_summary: summarize,
  });
}

async function handleChurchStrategicIntentsList(req: Request, env: Env) {
  const parsed = StrategicIntentsListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const intentType = parsed.data.intent_type ? String(parsed.data.intent_type) : null;

  const intents = (
    await env.churchcore
      .prepare(
        `SELECT id,intent_type AS intentType,title,body_markdown AS bodyMarkdown,sort_order AS sortOrder,source_url AS sourceUrl,updated_at AS updatedAt
         FROM strategic_intents
         WHERE church_id=?1 ${intentType ? "AND intent_type=?2" : ""}
         ORDER BY intent_type ASC, sort_order ASC`,
      )
      .bind(churchId, ...(intentType ? [intentType] : []))
      .all()
  ).results ?? [];

  const links = (
    await env.churchcore
      .prepare(
        `SELECT from_intent_id AS fromIntentId,to_intent_id AS toIntentId,link_type AS linkType,weight,metadata_json AS metadataJson,created_at AS createdAt
         FROM strategic_intent_links
         WHERE church_id=?1
         ORDER BY created_at ASC`,
      )
      .bind(churchId)
      .all()
  ).results ?? [];

  return json({ intents, links });
}

async function handleChatStream(req: Request, env: Env) {
  const parsed = ChatSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const { identity } = parsed.data;
        const churchId = identity.tenant_id;
        const userId = identity.user_id;
        const threadId = parsed.data.thread_id;
        const message = parsed.data.message;
        const role = (identity.role ?? "seeker") as string;
        const skill = (parsed.data.skill ?? "chat").trim() || "chat";

        // Persist user message now (so refresh shows it immediately)
        const m1 = await appendMessage(env, { churchId, userId, threadId, senderType: "user", content: message });
        if ((m1 as any)?.error) throw new Error(String((m1 as any)?.error ?? "append failed"));

        const { personId } = await resolvePerson(env, identity);
        const msgLower = String(message ?? "").toLowerCase();
        const wantsNextSteps =
          skill !== "chat" ||
          /next\s+step|next\s+steps|what\s+should\s+i\s+do|journey|stage|faith|baptis|membership|join\s+(a\s+)?group|serve|volunteer|guide/i.test(msgLower);

        const [personMemory, hh] = personId
          ? await Promise.all([getPersonMemory(env, { churchId, personId }), getHouseholdSummary(env, { churchId, personId })])
          : [{ memory: null, updatedAt: null }, { householdId: null, summary: "" }];

        const redactedMemory = redactMemoryForRole(role, (personMemory as any).memory);
        const journeyState = personId
          ? await ensurePersonJourneyState(env, { churchId, personId, personMemory: (personMemory as any).memory ?? {} })
          : { currentStageId: null, confidence: 0.5, updatedAt: null };
        const currentStageId = journeyState.currentStageId ?? "stage_seeker";
        const journeyCurrentStage = personId ? await getJourneyNode(env, { churchId, nodeId: currentStageId }) : null;
        const journeyNextSteps = wantsNextSteps && personId ? await computeJourneyNextSteps(env, { churchId, personId, currentStageId, limit: 3 }) : [];
        const inputArgs = parsed.data.args && typeof parsed.data.args === "object" ? (parsed.data.args as Record<string, unknown>) : {};

        const session = {
          churchId,
          campusId: identity.campus_id ?? "campus_boulder",
          timezone: identity.timezone ?? "UTC",
          userId,
          personId,
          role,
          auth: { isAuthenticated: false, roles: [] },
          threadId,
        };

        const inputPayload = {
          skill,
          message,
          args: {
            ...inputArgs,
            __context: {
              person_memory: redactedMemory,
              person_memory_updated_at: (personMemory as any).updatedAt,
              household: { household_id: (hh as any).householdId, summary: (hh as any).summary },
              journey: { current_stage: journeyCurrentStage, next_steps: journeyNextSteps },
              policy: { role },
            },
          },
          session,
        } as Record<string, unknown>;

        const lgRes = await runAgentStream(env, { threadId, inputPayload });
        const reader = lgRes.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let lastValues: any = null;
        let assistantText = "";

        function emitToken(t: string) {
          if (!t) return;
          assistantText += t;
          // data lines must not contain raw newlines
          const safe = t.replace(/\r/g, "").replace(/\n/g, "\\n");
          controller.enqueue(encoder.encode(`event: token\ndata: ${safe}\n\n`));
        }

        function processEventBlock(block: string) {
          const lines = block.split("\n").map((l) => l.trimEnd());
          let eventName = "";
          const dataLines: string[] = [];
          for (const ln of lines) {
            if (ln.startsWith("event:")) eventName = ln.slice(6).trim();
            if (ln.startsWith("data:")) dataLines.push(ln.slice(5).trimStart());
          }
          const dataRaw = dataLines.join("\n").trim();
          if (!dataRaw) return;

          // Prefer JSON payloads (LangGraph sends {event,data} in many cases)
          const j = safeJsonParse(dataRaw);
          // LangGraph Agent Server often uses `event: message` for all chunks.
          // In that case, prefer the JSON `event` field.
          const ev = ((j && typeof (j as any).event === "string" ? (j as any).event : "") || eventName || "") as string;
          const data = j && "data" in j ? (j as any).data : j;

          // When stream_mode is a list, many APIs return (mode, chunk) tuples.
          if (Array.isArray(data) && data.length === 2 && typeof data[0] === "string") {
            const mode = String(data[0]);
            const chunk = data[1];
            if (mode === "messages-tuple") {
              const tup = Array.isArray(chunk) ? chunk : [];
              const messageChunk = tup[0] as any;
              const token = typeof messageChunk?.content === "string" ? String(messageChunk.content) : "";
              emitToken(token);
              return;
            }
            if (mode === "values") {
              lastValues = chunk;
              return;
            }
            if (mode === "updates") {
              // Not guaranteed to be full state, but keep the latest in case "values" isn't emitted.
              lastValues = chunk;
              return;
            }
          }

          if (ev === "messages") {
            // messages-tuple: [message_chunk, metadata]
            const tup = Array.isArray(data) ? data : [];
            const messageChunk = tup[0] as any;
            const token = typeof messageChunk?.content === "string" ? String(messageChunk.content) : "";
            emitToken(token);
            return;
          }
          if (ev === "values" || ev === "updates") {
            lastValues = data;
            return;
          }
        }

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          for (;;) {
            const idxN = buf.indexOf("\n\n");
            const idxR = buf.indexOf("\r\n\r\n");
            let idx = -1;
            let delimLen = 0;
            if (idxN !== -1 && (idxR === -1 || idxN < idxR)) {
              idx = idxN;
              delimLen = 2;
            } else if (idxR !== -1) {
              idx = idxR;
              delimLen = 4;
            }
            if (idx === -1) break;
            const block = buf.slice(0, idx).trim();
            buf = buf.slice(idx + delimLen);
            if (block) processEventBlock(block);
          }
        }
        // Flush trailing SSE block (some servers don't end with a blank line).
        const tail = buf.trim();
        if (tail) processEventBlock(tail);

        // Resolve final envelope
        let envelope: any = null;
        if (lastValues !== null && typeof lastValues === "object") {
          // state may be the full state, or {output: {...}} depending on graph
          const maybeEnvelope = (lastValues as any)?.output ?? lastValues;
          envelope = maybeEnvelope && typeof maybeEnvelope === "object" ? maybeEnvelope : null;
        }
        if (!envelope) throw new Error("LangGraph stream did not produce final state (values).");

        // Apply MemoryOps proposed by the agent (gateway enforces policy).
        if (personId) {
          const ops = (envelope as any)?.data?.memory_ops;
          if (Array.isArray(ops) && ops.length) {
            const { memory: nextMemory, applied } = applyMemoryOps((personMemory as any).memory ?? {}, ops as any, role);
            if (applied.length) {
              await upsertPersonMemory(env, { churchId, personId, memory: nextMemory });
              await auditMemoryOps(env, { churchId, personId, threadId, actorUserId: userId, actorRole: role, ops: applied, turnId: null });
            }
          }
        }

        // Persist assistant message (+ envelope json). Use streamed text if envelope lacks message.
        const finalText = typeof (envelope as any)?.message === "string" ? String((envelope as any).message) : assistantText;
        await appendMessage(env, { churchId, userId, threadId, senderType: "assistant", content: finalText || "", envelope });

        controller.enqueue(encoder.encode(`event: final\ndata: ${JSON.stringify(envelope ?? {})}\n\n`));
        controller.enqueue(encoder.encode(`event: done\ndata: {\"ok\":true}\n\n`));
      } catch (e: any) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: String(e?.message ?? e ?? "error") })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

async function handleHouseholdIdentify(req: Request, env: Env) {
  const parsed = HouseholdIdentifySchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const roles = await getUserRoles(env, { churchId, userId });

  const phone = normalizePhone(parsed.data.phone);
  const otp = (parsed.data.otp_code ?? "").trim();

  // Assisted stations: guide or volunteer can search without OTP in this MVP.
  const isAssisted = String(role).toLowerCase() === "guide" || roles.has("volunteer") || roles.has("staff");

  if (!isAssisted) {
    // Demo OTP rule: accept 000000. If not provided, tell client to request OTP.
    if (!otp) return json({ ok: false, needs_otp: true, phone, hint: "Enter OTP (demo: 000000)" });
    if (otp !== "000000") return json({ ok: false, needs_otp: true, phone, error: "Invalid OTP" }, { status: 401 });
  }

  const row = (await env.churchcore
    .prepare(
      `SELECT household_id AS householdId
       FROM household_contacts
       WHERE church_id=?1 AND contact_type='phone' AND contact_value=?2
       ORDER BY is_primary DESC
       LIMIT 1`,
    )
    .bind(churchId, phone)
    .first()) as any;
  const householdId = typeof row?.householdId === "string" ? row.householdId : null;
  if (!householdId) return json({ ok: true, household: null, members: [], children: [], phone });

  const household = (await env.churchcore.prepare(`SELECT * FROM households WHERE church_id=?1 AND id=?2`).bind(churchId, householdId).first()) as any;
  const members =
    (
      await env.churchcore
        .prepare(
          `SELECT p.*, hm.role AS household_role
           FROM household_members hm
           JOIN people p ON p.id = hm.person_id
           WHERE p.church_id=?1 AND hm.household_id=?2
           ORDER BY (hm.role='adult') DESC, p.last_name ASC, p.first_name ASC`,
        )
        .bind(churchId, householdId)
        .all()
    ).results ?? [];
  const children =
    (
      await env.churchcore
        .prepare(
          `SELECT p.id, p.first_name, p.last_name, p.birthdate, cp.grade, cp.allergies, cp.medical_notes, cp.special_needs
           FROM household_members hm
           JOIN people p ON p.id = hm.person_id
           LEFT JOIN child_profiles cp ON cp.person_id = p.id AND cp.church_id = p.church_id
           WHERE p.church_id=?1 AND hm.household_id=?2 AND hm.role='child'`,
        )
        .bind(churchId, householdId)
        .all()
    ).results ?? [];

  return json({ ok: true, household, members, children, phone, actor: { userId, role } });
}

async function handleHouseholdCreate(req: Request, env: Env) {
  const parsed = HouseholdCreateSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const now = nowIso();
  const householdId = crypto.randomUUID();
  await env.churchcore
    .prepare(`INSERT INTO households (id, church_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(householdId, churchId, (parsed.data.household_name ?? "New Household").trim() || "New Household", now, now)
    .run();

  const phone = normalizePhone(parsed.data.primary_phone);
  await env.churchcore
    .prepare(
      `INSERT INTO household_contacts (id, church_id, household_id, contact_type, contact_value, is_primary, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'phone', ?4, 1, ?5, ?6)`,
    )
    .bind(crypto.randomUUID(), churchId, householdId, phone, now, now)
    .run();

  if (parsed.data.primary_email) {
    const email = String(parsed.data.primary_email).trim().toLowerCase();
    if (email) {
      await env.churchcore
        .prepare(
          `INSERT INTO household_contacts (id, church_id, household_id, contact_type, contact_value, is_primary, created_at, updated_at)
           VALUES (?1, ?2, ?3, 'email', ?4, 1, ?5, ?6)`,
        )
        .bind(crypto.randomUUID(), churchId, householdId, email, now, now)
        .run();
    }
  }

  // Parent personId: use existing binding if present, else create + bind.
  const binding = (await env.churchcore
    .prepare(`SELECT person_id AS personId FROM user_person_bindings WHERE church_id=?1 AND user_id=?2`)
    .bind(churchId, userId)
    .first()) as any;
  let parentPersonId = typeof binding?.personId === "string" ? binding.personId : null;

  if (!parentPersonId) {
    parentPersonId = crypto.randomUUID();
    await env.churchcore
      .prepare(
        `INSERT INTO people (id, church_id, campus_id, first_name, last_name, email, phone, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8)`,
      )
      .bind(parentPersonId, churchId, identity.campus_id ?? null, parsed.data.parent_first_name, parsed.data.parent_last_name ?? null, phone, now, now)
      .run();
    await env.churchcore
      .prepare(
        `INSERT INTO user_person_bindings (church_id, user_id, person_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(church_id, user_id) DO UPDATE SET person_id=excluded.person_id, updated_at=excluded.updated_at`,
      )
      .bind(churchId, userId, parentPersonId, now, now)
      .run();
  }

  await env.churchcore.prepare(`INSERT INTO household_members (household_id, person_id, role) VALUES (?1, ?2, 'adult')`).bind(householdId, parentPersonId).run();

  const childIds: string[] = [];
  for (const c of parsed.data.children) {
    const childId = crypto.randomUUID();
    childIds.push(childId);
    await env.churchcore
      .prepare(
        `INSERT INTO people (id, church_id, campus_id, first_name, last_name, birthdate, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(childId, churchId, identity.campus_id ?? null, c.first_name, c.last_name ?? null, c.birthdate ?? null, now, now)
      .run();
    await env.churchcore.prepare(`INSERT INTO household_members (household_id, person_id, role) VALUES (?1, ?2, 'child')`).bind(householdId, childId).run();
    await env.churchcore
      .prepare(
        `INSERT INTO child_profiles (person_id, church_id, allergies, special_needs, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(childId, churchId, c.allergies ?? null, c.special_needs ? 1 : 0, now, now)
      .run();
    await env.churchcore
      .prepare(
        `INSERT INTO person_relationships (id, church_id, from_person_id, to_person_id, relationship_type, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'guardian', 'active', ?5, ?6)`,
      )
      .bind(crypto.randomUUID(), churchId, parentPersonId, childId, now, now)
      .run();
    await env.churchcore
      .prepare(
        `INSERT INTO person_relationships (id, church_id, from_person_id, to_person_id, relationship_type, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'authorized_pickup', 'active', ?5, ?6)`,
      )
      .bind(crypto.randomUUID(), churchId, parentPersonId, childId, now, now)
      .run();
  }

  return json({ ok: true, household_id: householdId, parent_person_id: parentPersonId, child_person_ids: childIds, actor: { userId, role } });
}

async function loadHouseholdFull(env: Env, args: { churchId: string; householdId: string }) {
  const household = (await env.churchcore.prepare(`SELECT * FROM households WHERE church_id=?1 AND id=?2`).bind(args.churchId, args.householdId).first()) as any;
  if (!household) return { household: null, members: [], children: [] };

  const members =
    (
      await env.churchcore
        .prepare(
          `SELECT p.*, hm.role AS household_role
           FROM household_members hm
           JOIN people p ON p.id = hm.person_id
           WHERE p.church_id=?1 AND hm.household_id=?2
           ORDER BY (hm.role='adult') DESC, p.last_name ASC, p.first_name ASC`,
        )
        .bind(args.churchId, args.householdId)
        .all()
    ).results ?? [];

  const children =
    (
      await env.churchcore
        .prepare(
          `SELECT p.id, p.first_name, p.last_name, p.birthdate, cp.grade, cp.allergies, cp.medical_notes, cp.special_needs
           FROM household_members hm
           JOIN people p ON p.id = hm.person_id
           LEFT JOIN child_profiles cp ON cp.person_id = p.id
           WHERE p.church_id=?1 AND hm.household_id=?2 AND hm.role='child'`,
        )
        .bind(args.churchId, args.householdId)
        .all()
    ).results ?? [];

  return { household, members, children };
}

async function canManageHousehold(env: Env, args: { churchId: string; userId: string; role: string; personId: string | null; householdId: string }) {
  const identityRole = (args.role || "seeker").toLowerCase();
  const roles = await getUserRoles(env, { churchId: args.churchId, userId: args.userId });
  const assisted = identityRole === "guide" || roles.has("staff") || roles.has("volunteer");
  if (assisted) return true;
  if (!args.personId) return false;

  const row = (await env.churchcore
    .prepare(`SELECT role FROM household_members WHERE household_id=?1 AND person_id=?2 LIMIT 1`)
    .bind(args.householdId, args.personId)
    .first()) as any;
  return String(row?.role ?? "").toLowerCase() === "adult";
}

async function handleHouseholdGet(req: Request, env: Env) {
  const parsed = HouseholdGetSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: true, households: [], household: null, members: [], children: [], actor: { userId, role, personId: null } });

  const householdRows =
    (
      await env.churchcore
        .prepare(
          `SELECT h.id, h.name, h.created_at AS createdAt, h.updated_at AS updatedAt
           FROM household_members hm
           JOIN households h ON h.id = hm.household_id
           WHERE h.church_id=?1 AND hm.person_id=?2
           ORDER BY h.updated_at DESC`,
        )
        .bind(churchId, personId)
        .all()
    ).results ?? [];

  const requestedId = (parsed.data.household_id ?? "").trim();
  const defaultId = typeof (householdRows as any[])[0]?.id === "string" ? String((householdRows as any[])[0].id) : null;
  const householdId = requestedId || defaultId;
  if (!householdId) return json({ ok: true, households: householdRows, household: null, members: [], children: [], actor: { userId, role, personId } });

  const ok = await canManageHousehold(env, { churchId, userId, role, personId, householdId });
  if (!ok) return json({ error: "Forbidden" }, { status: 403 });

  const { household, members, children } = await loadHouseholdFull(env, { churchId, householdId });
  return json({ ok: true, households: householdRows, household, members, children, actor: { userId, role, personId } });
}

async function handleHouseholdMemberUpsert(req: Request, env: Env) {
  const parsed = HouseholdMemberUpsertSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const householdId = parsed.data.household_id;
  const member = parsed.data.member;

  const { personId: actorPersonId } = await resolvePerson(env, identity);
  const ok = await canManageHousehold(env, { churchId, userId, role, personId: actorPersonId, householdId });
  if (!ok) return json({ error: "Forbidden" }, { status: 403 });

  const now = nowIso();
  const nextPersonId = (member.person_id ?? "").trim() || crypto.randomUUID();

  const existing = (await env.churchcore.prepare(`SELECT id FROM people WHERE church_id=?1 AND id=?2`).bind(churchId, nextPersonId).first()) as any;
  if (!existing) {
    await env.churchcore
      .prepare(
        `INSERT INTO people (id, church_id, campus_id, first_name, last_name, birthdate, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(nextPersonId, churchId, identity.campus_id ?? null, member.first_name, member.last_name ?? null, member.birthdate ?? null, now, now)
      .run();
  } else {
    await env.churchcore
      .prepare(
        `UPDATE people
         SET first_name=?3, last_name=?4, birthdate=?5, updated_at=?6
         WHERE church_id=?1 AND id=?2`,
      )
      .bind(churchId, nextPersonId, member.first_name, member.last_name ?? null, member.birthdate ?? null, now)
      .run();
  }

  await env.churchcore
    .prepare(`INSERT OR IGNORE INTO household_members (household_id, person_id, role) VALUES (?1, ?2, ?3)`)
    .bind(householdId, nextPersonId, member.role)
    .run();

  if (member.role === "child") {
    await env.churchcore
      .prepare(
        `INSERT INTO child_profiles (person_id, church_id, allergies, special_needs, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(person_id) DO UPDATE SET allergies=excluded.allergies, special_needs=excluded.special_needs, updated_at=excluded.updated_at`,
      )
      .bind(nextPersonId, churchId, member.allergies ?? null, member.special_needs ? 1 : 0, now, now)
      .run();

    if (actorPersonId) {
      // Ensure a guardian edge exists for authorization decisions.
      const rel = (await env.churchcore
        .prepare(
          `SELECT 1
           FROM person_relationships
           WHERE church_id=?1 AND from_person_id=?2 AND to_person_id=?3 AND relationship_type='guardian' AND status='active'
           LIMIT 1`,
        )
        .bind(churchId, actorPersonId, nextPersonId)
        .first()) as any;
      if (!rel) {
        await env.churchcore
          .prepare(
            `INSERT INTO person_relationships (id, church_id, from_person_id, to_person_id, relationship_type, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'guardian', 'active', ?5, ?6)`,
          )
          .bind(crypto.randomUUID(), churchId, actorPersonId, nextPersonId, now, now)
          .run();
      }
    }
  }

  const { household, members, children } = await loadHouseholdFull(env, { churchId, householdId });
  return json({ ok: true, household, members, children, member_person_id: nextPersonId, actor: { userId, role, personId: actorPersonId } });
}

async function handleHouseholdMemberRemove(req: Request, env: Env) {
  const parsed = HouseholdMemberRemoveSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const householdId = parsed.data.household_id;
  const personIdToRemove = parsed.data.person_id;

  const { personId: actorPersonId } = await resolvePerson(env, identity);
  const ok = await canManageHousehold(env, { churchId, userId, role, personId: actorPersonId, householdId });
  if (!ok) return json({ error: "Forbidden" }, { status: 403 });

  await env.churchcore.prepare(`DELETE FROM household_members WHERE household_id=?1 AND person_id=?2`).bind(householdId, personIdToRemove).run();
  const { household, members, children } = await loadHouseholdFull(env, { churchId, householdId });
  return json({ ok: true, household, members, children, actor: { userId, role, personId: actorPersonId } });
}

async function handleCheckinStart(req: Request, env: Env) {
  const parsed = CheckinStartSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const schedule = (await env.churchcore
    .prepare(
      `SELECT id, service_plan_id AS servicePlanId, area_id AS areaId, opens_at AS opensAt, closes_at AS closesAt
       FROM checkin_schedules
       WHERE church_id=?1 AND service_plan_id=?2 AND area_id=?3
       LIMIT 1`,
    )
    .bind(churchId, parsed.data.service_plan_id, parsed.data.area_id)
    .first()) as any;

  const rooms =
    (
      await env.churchcore
        .prepare(
          `SELECT id,name,min_age_months AS minAgeMonths,max_age_months AS maxAgeMonths,capacity
           FROM checkin_rooms
           WHERE church_id=?1 AND area_id=?2`,
        )
        .bind(churchId, parsed.data.area_id)
        .all()
    ).results ?? [];

  // Try to resolve household via person binding.
  const { personId } = await resolvePerson(env, identity);
  let householdId: string | null = null;
  if (personId) {
    const row = (await env.churchcore
      .prepare(
        `SELECT household_id AS householdId
         FROM household_members
         WHERE person_id=?1
         LIMIT 1`,
      )
      .bind(personId)
      .first()) as any;
    householdId = typeof row?.householdId === "string" ? row.householdId : null;
  }

  return json({ ok: true, schedule: schedule ?? null, rooms, household_id: householdId, actor: { userId, role, personId } });
}

async function handleCheckinPreview(req: Request, env: Env) {
  const parsed = CheckinPreviewSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;

  const rooms =
    (
      await env.churchcore
        .prepare(
          `SELECT id,name,min_age_months AS minAgeMonths,max_age_months AS maxAgeMonths,capacity
           FROM checkin_rooms
           WHERE church_id=?1 AND area_id=?2`,
        )
        .bind(churchId, parsed.data.area_id)
        .all()
    ).results ?? [];

  const kids =
    (
      await env.churchcore
        .prepare(
          `SELECT p.id, p.first_name, p.last_name, p.birthdate, cp.allergies, cp.special_needs
           FROM household_members hm
           JOIN people p ON p.id = hm.person_id
           LEFT JOIN child_profiles cp ON cp.person_id=p.id AND cp.church_id=p.church_id
           WHERE p.church_id=?1 AND hm.household_id=?2 AND hm.role='child'`,
        )
        .bind(churchId, parsed.data.household_id)
        .all()
    ).results ?? [];

  const placements = (kids as any[]).map((k) => {
    const months = ageMonthsFromBirthdate(k.birthdate ?? null);
    const eligible = (rooms as any[]).filter((r) => {
      if (months === null) return true;
      const min = typeof r.minAgeMonths === "number" ? r.minAgeMonths : null;
      const max = typeof r.maxAgeMonths === "number" ? r.maxAgeMonths : null;
      if (min !== null && months < min) return false;
      if (max !== null && months > max) return false;
      return true;
    });
    return {
      person_id: k.id,
      name: `${k.first_name ?? ""} ${k.last_name ?? ""}`.trim(),
      age_months: months,
      allergies: k.allergies ?? null,
      special_needs: Boolean(k.special_needs),
      eligible_rooms: eligible.map((r: any) => ({ id: r.id, name: r.name })),
    };
  });

  return json({ ok: true, kids, rooms, placements });
}

async function handleCheckinCommit(req: Request, env: Env) {
  const parsed = CheckinCommitSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const roles = await getUserRoles(env, { churchId, userId });

  const checkinId = crypto.randomUUID();
  const now = nowIso();
  const securityCode = String(Math.floor(1000 + Math.random() * 9000));

  await env.churchcore
    .prepare(
      `INSERT INTO checkins (id, church_id, campus_id, service_plan_id, area_id, household_id, created_by_user_id, created_by_role, mode, security_code, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'complete', ?11)`,
    )
    .bind(
      checkinId,
      churchId,
      identity.campus_id ?? null,
      parsed.data.service_plan_id,
      parsed.data.area_id,
      parsed.data.household_id,
      userId,
      roles.has("staff") || String(role).toLowerCase() === "guide" ? "guide" : roles.has("volunteer") ? "volunteer" : "seeker",
      roles.has("staff") || String(role).toLowerCase() === "guide" || roles.has("volunteer") ? "assisted" : "self",
      securityCode,
      now,
    )
    .run();

  const items: any[] = [];
  for (const s of parsed.data.selections) {
    const id = crypto.randomUUID();
    await env.churchcore
      .prepare(
        `INSERT INTO checkin_items (id, church_id, checkin_id, person_id, room_id, status, checked_in_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'checked_in', ?6)`,
      )
      .bind(id, churchId, checkinId, s.person_id, s.room_id, now)
      .run();
    items.push({ id, person_id: s.person_id, room_id: s.room_id, checked_in_at: now });
  }

  return json({ ok: true, checkin_id: checkinId, security_code: securityCode, items });
}

export default {
  async fetch(req: Request, env: Env) {
    const auth = requireApiKey(req, env);
    if (auth) return auth;

    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/healthz") return json({ ok: true });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });

    switch (url.pathname) {
      case "/a2a/thread.create":
        return handleThreadCreate(req, env);
      case "/a2a/thread.list":
        return handleThreadList(req, env);
      case "/a2a/thread.get":
        return handleThreadGet(req, env);
      case "/a2a/thread.rename":
        return handleThreadRename(req, env);
      case "/a2a/thread.archive":
        return handleThreadArchive(req, env);
      case "/a2a/thread.append":
        return handleThreadAppend(req, env);
      case "/a2a/chat":
        return handleChat(req, env);
      case "/a2a/chat.stream":
        return handleChatStream(req, env);
      case "/a2a/household.identify":
        return handleHouseholdIdentify(req, env);
      case "/a2a/household.create":
        return handleHouseholdCreate(req, env);
      case "/a2a/household.get":
        return handleHouseholdGet(req, env);
      case "/a2a/household.member.upsert":
        return handleHouseholdMemberUpsert(req, env);
      case "/a2a/household.member.remove":
        return handleHouseholdMemberRemove(req, env);
      case "/a2a/checkin.start":
        return handleCheckinStart(req, env);
      case "/a2a/checkin.preview":
        return handleCheckinPreview(req, env);
      case "/a2a/checkin.commit":
        return handleCheckinCommit(req, env);
      case "/a2a/memory.get":
        return handleMemoryGet(req, env);
      case "/a2a/memory.apply_ops":
        return handleMemoryApplyOps(req, env);
      case "/a2a/memory.audit.list":
        return handleMemoryAuditList(req, env);
      case "/a2a/journey.get_state":
        return handleJourneyGetState(req, env);
      case "/a2a/journey.next_steps":
        return handleJourneyNextSteps(req, env);
      case "/a2a/journey.complete_step":
        return handleJourneyCompleteStep(req, env);
      case "/a2a/church.get_overview":
        return handleChurchGetOverview(req, env);
      case "/a2a/church.strategic_intent.list":
        return handleChurchStrategicIntentsList(req, env);
      default:
        return json({ error: "Not found" }, { status: 404 });
    }
  },
};

