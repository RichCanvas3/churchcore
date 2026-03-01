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

async function parseJson(req: Request) {
  const raw = await req.json().catch(() => null);
  return raw;
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
  const personMemory = personId ? await getPersonMemory(env, { churchId, personId }) : { memory: null, updatedAt: null };
  const redactedMemory = redactMemoryForRole(role, personMemory.memory);
  const hh = personId ? await getHouseholdSummary(env, { churchId, personId }) : { householdId: null, summary: "" };
  const inputArgs = parsed.data.args && typeof parsed.data.args === "object" ? (parsed.data.args as Record<string, unknown>) : {};
  const session = {
    churchId,
    campusId: identity.campus_id ?? "campus_main",
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

async function handleChatStream(req: Request, env: Env) {
  const parsed = ChatSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const out = await handleChat(new Request(req.url, { method: "POST", body: JSON.stringify(parsed.data) }), env);
        const body = (await out.json().catch(() => ({}))) as any;
        const msg = typeof body?.output?.message === "string" ? String(body.output.message) : "";
        for (let i = 0; i < msg.length; i += 24) {
          const chunk = msg.slice(i, i + 24);
          controller.enqueue(encoder.encode(`event: token\ndata: ${chunk}\n\n`));
        }
        controller.enqueue(encoder.encode(`event: final\ndata: ${JSON.stringify(body.output ?? {})}\n\n`));
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
      case "/a2a/checkin.start":
        return handleCheckinStart(req, env);
      case "/a2a/checkin.preview":
        return handleCheckinPreview(req, env);
      case "/a2a/checkin.commit":
        return handleCheckinCommit(req, env);
      default:
        return json({ error: "Not found" }, { status: 404 });
    }
  },
};

