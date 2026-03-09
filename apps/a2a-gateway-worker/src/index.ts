import { z } from "zod";

type Env = {
  churchcore: D1Database;
  LANGGRAPH_DEPLOYMENT_URL?: string;
  LANGSMITH_API_KEY?: string;
  LANGGRAPH_ASSISTANT_ID?: string;
  A2A_API_KEY?: string;
  SENDGRID_MCP_URL?: string;
  SENDGRID_MCP_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_TRANSCRIBE_MODEL?: string;
  AI_GATEWAY_CLIENT_ID?: string;
  AI_GATEWAY_CLIENT_SECRET?: string;
  AI_GATEWAY_TOKEN_URL?: string;
  AI_GATEWAY_BASE_URL?: string;
  AI_GATEWAY_RAG_PUBLISHER?: string;
};

function nowIso() {
  return new Date().toISOString();
}

type AiGatewayTokenCache = { accessToken: string; expiresAtMs: number };
let aiGatewayTokenCache: AiGatewayTokenCache | null = null;

async function getAiGatewayAccessToken(env: Env): Promise<string> {
  const clientId = (env.AI_GATEWAY_CLIENT_ID ?? "").trim();
  const clientSecret = (env.AI_GATEWAY_CLIENT_SECRET ?? "").trim();
  const tokenUrl = (env.AI_GATEWAY_TOKEN_URL ?? "").trim();
  if (!clientId || !clientSecret || !tokenUrl) throw new Error("Missing AI gateway OAuth config");

  const now = Date.now();
  if (aiGatewayTokenCache && aiGatewayTokenCache.expiresAtMs - now > 60_000) return aiGatewayTokenCache.accessToken;

  const auth = btoa(`${clientId}:${clientSecret}`);
  const body = `grant_type=client_credentials&scope=${encodeURIComponent("api/access")}`;
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });
  const raw = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`AI gateway token error (${res.status}): ${raw || "no body"}`);
  const j = safeJsonParse(raw) as any;
  const token = typeof j?.access_token === "string" ? j.access_token : "";
  const expiresIn = typeof j?.expires_in === "number" ? j.expires_in : Number(j?.expires_in ?? 3600);
  if (!token) throw new Error("AI gateway token response missing access_token");
  aiGatewayTokenCache = { accessToken: token, expiresAtMs: now + Math.max(300, expiresIn) * 1000 };
  return token;
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

function guessPublicBaseUrl(req: Request) {
  const url = new URL(req.url);
  // Cloudflare Workers default to correct origin; keep it simple.
  return `${url.protocol}//${url.host}/`;
}

function agentCard(req: Request, env: Env) {
  const baseUrl = guessPublicBaseUrl(req);
  const url = new URL(req.url);
  const assistantId = url.searchParams.get("assistant_id") || (env.LANGGRAPH_ASSISTANT_ID ?? "church_agent");
  const authRequired = Boolean((env.A2A_API_KEY ?? "").trim());

  // A2A Agent Card (public discovery) shape based on a2a.types AgentCard:
  // https://a2a-protocol.org/latest/tutorials/python/3-agent-skills-and-card/
  return json(
    {
      name: "Church Agent Gateway",
      description: "A2A gateway for Church Agent (threads, chat, memory, household, check-in, journey).",
      url: baseUrl,
      version: "0.1.0",
      defaultInputModes: ["text"],
      defaultOutputModes: ["text"],
      capabilities: { streaming: true },
      skills: [
        {
          id: "chat",
          name: "Chat",
          description: "General conversation (seeker/guide) with optional UI tool handoffs.",
          tags: ["chat"],
          examples: ["Tell me about the church", "What are the service times?", "What is the mission?"],
        },
        {
          id: "threads",
          name: "Threads",
          description: "Create/list/get/rename/archive chat threads (topics).",
          tags: ["threads"],
          examples: ["Create a new topic", "Rename this topic to Planning a visit"],
        },
        {
          id: "households_checkin",
          name: "Households & kids check-in",
          description: "Household lookup, member management, room preview, and check-in commit (demo OTP supported).",
          tags: ["household", "checkin", "kids"],
          examples: [
            "Find my family by phone",
            "Get my household",
            "Add a child to my household",
            "Remove a member from my household",
            "Preview rooms for Mia",
            "Check in now",
          ],
        },
        {
          id: "community",
          name: "Community",
          description: "Browse and manage groups/classes/outreach/missions/trips; join/leave and track participation.",
          tags: ["community", "groups", "classes", "outreach", "missions"],
          examples: ["Show me LifeGroups", "Join Starting Point", "What outreach is available?", "Mark that I attended"],
        },
        {
          id: "group_membership",
          name: "Group membership",
          description: "Manage long-lived groups (Life Groups, Men's/Women's, Bible study groups): my groups, rosters, invites, group schedule, and group Bible study notes.",
          tags: ["groups", "membership", "bible_study", "schedule"],
          examples: ["Show my groups", "Invite someone to my group", "Add a group event", "Start a Bible study for our group"],
        },
        {
          id: "calendar",
          name: "Calendar",
          description: "Week-view calendar of church events; outdoor events include a weather snapshot (48h/8d forecast).",
          tags: ["calendar", "events", "weather"],
          examples: ["Show this week's calendar", "Outdoor events this week"],
        },
        {
          id: "journey",
          name: "Faith journey",
          description: "Get journey state and compute next steps; mark steps complete.",
          tags: ["journey", "discipleship"],
          examples: ["What stage am I in?", "What are my next steps?"],
        },
        {
          id: "bible",
          name: "Bible passages",
          description: "Fetch public-domain Bible passage text (WEB/KJV) and provide outbound links to NIV.",
          tags: ["bible", "scripture"],
          examples: ["Ephesians 2:8-9", "John 3:16"],
        },
      ],
      // Non-standard but helpful for clients integrating *this* gateway (not LangSmith A2A JSON-RPC).
      endpoints: {
        a2a_base: `${baseUrl}a2a/`,
        chat: `${baseUrl}a2a/chat`,
        chat_stream: `${baseUrl}a2a/chat.stream`,
        thread_list: `${baseUrl}a2a/thread.list`,
        thread_get: `${baseUrl}a2a/thread.get`,
        thread_create: `${baseUrl}a2a/thread.create`,
        thread_rename: `${baseUrl}a2a/thread.rename`,
        thread_archive: `${baseUrl}a2a/thread.archive`,
        group_my_list: `${baseUrl}a2a/group.my.list`,
        group_get: `${baseUrl}a2a/group.get`,
        group_create: `${baseUrl}a2a/group.create`,
        group_update: `${baseUrl}a2a/group.update`,
        group_members_list: `${baseUrl}a2a/group.members.list`,
        group_invite_create: `${baseUrl}a2a/group.invite.create`,
        group_invite_respond: `${baseUrl}a2a/group.invite.respond`,
        group_invites_sent_list: `${baseUrl}a2a/group.invites.sent.list`,
        group_invite_cancel: `${baseUrl}a2a/group.invite.cancel`,
        group_invites_inbox_list: `${baseUrl}a2a/group.invites.inbox.list`,
        people_search: `${baseUrl}a2a/people.search`,
        group_member_remove: `${baseUrl}a2a/group.member.remove`,
        group_member_set_role: `${baseUrl}a2a/group.member.set_role`,
        group_events_list: `${baseUrl}a2a/group.events.list`,
        group_event_create: `${baseUrl}a2a/group.event.create`,
        group_event_update: `${baseUrl}a2a/group.event.update`,
        group_event_delete: `${baseUrl}a2a/group.event.delete`,
        group_bible_study_list: `${baseUrl}a2a/group.bible_study.list`,
        group_bible_study_create: `${baseUrl}a2a/group.bible_study.create`,
        group_bible_study_reading_add: `${baseUrl}a2a/group.bible_study.reading.add`,
        group_bible_study_note_add: `${baseUrl}a2a/group.bible_study.note.add`,
        group_bible_study_readings_list: `${baseUrl}a2a/group.bible_study.readings.list`,
        group_bible_study_notes_list: `${baseUrl}a2a/group.bible_study.notes.list`,
        group_bible_study_sessions_list: `${baseUrl}a2a/group.bible_study.sessions.list`,
        group_bible_study_session_create: `${baseUrl}a2a/group.bible_study.session.create`,
        household_identify: `${baseUrl}a2a/household.identify`,
        household_create: `${baseUrl}a2a/household.create`,
        household_get: `${baseUrl}a2a/household.get`,
        household_member_upsert: `${baseUrl}a2a/household.member.upsert`,
        household_member_remove: `${baseUrl}a2a/household.member.remove`,
        household_profile_upsert: `${baseUrl}a2a/household.profile.upsert`,
        household_relationship_upsert: `${baseUrl}a2a/household.relationship.upsert`,
        household_relationship_remove: `${baseUrl}a2a/household.relationship.remove`,
        weekly_podcast_list: `${baseUrl}a2a/weekly_podcast.list`,
        weekly_podcast_get: `${baseUrl}a2a/weekly_podcast.get`,
        weekly_podcast_analyze: `${baseUrl}a2a/weekly_podcast.analyze`,
        sermon_list: `${baseUrl}a2a/sermon.list`,
        sermon_get: `${baseUrl}a2a/sermon.get`,
        sermon_compare: `${baseUrl}a2a/sermon.compare`,
        bible_plan_week_get: `${baseUrl}a2a/bible.plan.week.get`,
        bible_plan_item_complete: `${baseUrl}a2a/bible.plan.item.complete`,
        bible_plan_checkin_create: `${baseUrl}a2a/bible.plan.checkin.create`,
        community_catalog_list: `${baseUrl}a2a/community.catalog.list`,
        community_my_list: `${baseUrl}a2a/community.my.list`,
        community_join: `${baseUrl}a2a/community.join`,
        community_leave: `${baseUrl}a2a/community.leave`,
        community_mark: `${baseUrl}a2a/community.mark`,
        checkin_start: `${baseUrl}a2a/checkin.start`,
        checkin_preview: `${baseUrl}a2a/checkin.preview`,
        checkin_commit: `${baseUrl}a2a/checkin.commit`,
        calendar_week: `${baseUrl}a2a/calendar.week`,
        bible_passage: `${baseUrl}a2a/bible.passage`,
        journey_get_state: `${baseUrl}a2a/journey.get_state`,
        journey_next_steps: `${baseUrl}a2a/journey.next_steps`,
      },
      authentication: authRequired ? { type: "api_key", header: "x-api-key", instructions: "Send x-api-key with the gateway API key." } : { type: "none" },
      langgraph: { assistant_id: assistantId },
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
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

const CalendarWeekSchema = z.object({
  identity: IdentitySchema,
  start: z.string().min(1).optional().nullable(), // YYYY-MM-DD
});

const BiblePassageSchema = z.object({
  identity: IdentitySchema,
  ref: z.string().min(1),
  translation: z.enum(["web", "kjv"]).optional().nullable(),
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

function firstSseJson(text: string) {
  const raw = String(text ?? "");
  // Most MCP Streamable HTTP responses are single SSE events:
  // event: message
  // data: {...jsonrpc...}
  const lines = raw.split("\n");
  const dataLines: string[] = [];
  for (const ln of lines) {
    if (ln.startsWith("data:")) dataLines.push(ln.slice(5).trimStart());
  }
  const joined = dataLines.join("\n").trim();
  return joined ? safeJsonParse(joined) : null;
}

async function mcpCallTool(env: Env, args: { baseUrl: string; apiKey?: string; toolName: string; toolArgs: Record<string, unknown> }) {
  const baseUrl = String(args.baseUrl ?? "").trim().replace(/\/$/, "");
  if (!baseUrl) return { ok: false, error: "Missing MCP baseUrl" as const };
  const url = `${baseUrl}/mcp`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const apiKey = String(args.apiKey ?? "").trim();
  if (apiKey) headers["x-api-key"] = apiKey;

  // Initialize (required by MCP).
  const initRes = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "churchcore-a2a-gateway", version: "0.1.0" } },
    }),
  });
  const initTxt = await initRes.text().catch(() => "");
  if (!initRes.ok) return { ok: false, error: `MCP initialize failed (${initRes.status}): ${initTxt || "no body"}` as const };

  // notifications/initialized (server commonly expects it)
  await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
  }).catch(() => {});

  const callRes = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: args.toolName, arguments: args.toolArgs ?? {} },
    }),
  });
  const callTxt = await callRes.text().catch(() => "");
  if (!callRes.ok) return { ok: false, error: `MCP tools/call failed (${callRes.status}): ${callTxt || "no body"}` as const };

  const msg = firstSseJson(callTxt);
  const result = msg && typeof msg === "object" ? (msg as any).result : null;
  return { ok: true, result, raw: msg } as const;
}

function isUuid(s: string) {
  const v = String(s || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

async function getOrCreateLangGraphThreadId(env: Env, args: { churchId: string; threadId: string }) {
  const threadId = String(args.threadId || "").trim();
  if (!threadId) throw new Error("Missing thread_id");
  if (isUuid(threadId)) return threadId;

  const row = (await env.churchcore
    .prepare(
      `SELECT langgraph_thread_id AS langgraphThreadId
       FROM chat_thread_langgraph_map
       WHERE church_id=?1 AND thread_id=?2
       LIMIT 1`,
    )
    .bind(args.churchId, threadId)
    .first()) as any;

  const existing = typeof row?.langgraphThreadId === "string" ? String(row.langgraphThreadId).trim() : "";
  if (existing && isUuid(existing)) return existing;

  const lg = crypto.randomUUID();
  const ts = nowIso();
  await env.churchcore
    .prepare(
      `INSERT INTO chat_thread_langgraph_map (church_id, thread_id, langgraph_thread_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(church_id, thread_id) DO UPDATE SET langgraph_thread_id=excluded.langgraph_thread_id, updated_at=excluded.updated_at`,
    )
    .bind(args.churchId, threadId, lg, ts, ts)
    .run();

  return lg;
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
    if (Array.isArray(pc.thanksgivings))
      pc.thanksgivings = pc.thanksgivings.filter((n: any) => canViewVisibility(role, (n?.visibility ?? "restricted") as Visibility));
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
  if (p.startsWith("groups.")) return true;
  if (p.startsWith("community.")) return true;
  if (p.startsWith("spiritualJourney.")) return true;
  // Allow self-assessments/check-ins used by the Faith Journey tool.
  if (p.startsWith("worldview.bdi.")) return true;
  if (p.startsWith("intentProfile.")) return true;
  if (p.startsWith("pastoralCare.prayerRequests")) return true;
  if (p.startsWith("pastoralCare.thanksgivings")) return true;
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

  // Provide explicit stage path + next-stage requirements for UI visualization.
  const currentEdges = await listJourneyEdgesFrom(env, { churchId, fromNodeId: currentStageId });
  const nextStageEdge = currentEdges
    .filter((e) => String(e.edgeType) === "NEXT_STAGE")
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || String(a.toNodeId).localeCompare(String(b.toNodeId)))[0];
  const nextStageId = nextStageEdge?.toNodeId ? String(nextStageEdge.toNodeId) : null;

  const nextStageRequirements: any[] = [];
  if (nextStageId) {
    const nextEdges = await listJourneyEdgesFrom(env, { churchId, fromNodeId: nextStageId });
    const reqs = nextEdges
      .filter((e) => String(e.edgeType) === "REQUIRES")
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || String(a.toNodeId).localeCompare(String(b.toNodeId)));
    for (const e of reqs.slice(0, 12)) {
      const node = await getJourneyNode(env, { churchId, nodeId: String(e.toNodeId) });
      if (node) nextStageRequirements.push({ node, edgeType: "REQUIRES", weight: e.weight ?? 1.0 });
    }
  }

  return json({
    ok: true,
    person_id: personId,
    current_stage: currentStage,
    stages,
    stage_path: stages,
    next_stage_id: nextStageId,
    next_stage_requirements: nextStageRequirements,
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
  const nextSteps = await computeJourneyNextSteps(env, { churchId, personId, currentStageId, limit, personMemory: personMemory.memory ?? {} });

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

async function syncPersonGroupsAndCommunityToMemory(
  env: Env,
  args: { churchId: string; personId: string; actorUserId: string; actorRole: string; threadId: string },
) {
  const groups =
    (
      await env.churchcore
        .prepare(
          `SELECT g.id,
                  g.campus_id AS campusId,
                  g.name,
                  g.description,
                  gm.role,
                  gm.status,
                  gm.joined_at AS joinedAt
           FROM group_memberships gm
           JOIN groups g ON g.id=gm.group_id AND g.church_id=gm.church_id
           WHERE gm.church_id=?1 AND gm.person_id=?2 AND gm.status!='inactive'
           ORDER BY gm.status DESC, gm.role DESC, g.name ASC`,
        )
        .bind(args.churchId, args.personId)
        .all()
    ).results ?? [];

  const community =
    (
      await env.churchcore
        .prepare(
          `SELECT pc.community_id AS communityId,
                  pc.status,
                  pc.role,
                  pc.joined_at AS joinedAt,
                  pc.left_at AS leftAt,
                  cc.kind,
                  cc.title,
                  cc.campus_id AS campusId
           FROM person_community pc
           JOIN community_catalog cc ON cc.id=pc.community_id
           WHERE pc.church_id=?1 AND pc.person_id=?2 AND pc.status!='inactive'
           ORDER BY pc.updated_at DESC`,
        )
        .bind(args.churchId, args.personId)
        .all()
    ).results ?? [];

  const personMemory = await getPersonMemory(env, { churchId: args.churchId, personId: args.personId });
  const base = personMemory.memory && typeof personMemory.memory === "object" ? personMemory.memory : {};
  const next = JSON.parse(JSON.stringify(base));
  setByPath(next, "groups.my", groups);
  setByPath(next, "community.my", community);
  setByPath(next, "groups.updatedAt", nowIso());
  setByPath(next, "community.updatedAt", nowIso());

  await upsertPersonMemory(env, { churchId: args.churchId, personId: args.personId, memory: next });
  await auditMemoryOps(env, {
    churchId: args.churchId,
    personId: args.personId,
    threadId: args.threadId || "thread_unknown",
    actorUserId: args.actorUserId,
    actorRole: args.actorRole,
    ops: [
      { op: "set", path: "groups.my", value: groups, visibility: "self" },
      { op: "set", path: "community.my", value: community, visibility: "self" },
    ],
    turnId: null,
  });
}

type JourneyStage = { id: string; title: string; summary: string | null };

type JourneyEdgeRow = { fromNodeId: string; toNodeId: string; edgeType: string; weight: number };

async function listJourneyEdgesByType(env: Env, args: { churchId: string; edgeType: string }) {
  const rows = (
    await env.churchcore
      .prepare(
        `SELECT from_node_id AS fromNodeId, to_node_id AS toNodeId, edge_type AS edgeType, weight
         FROM journey_edge
         WHERE church_id=?1 AND edge_type=?2`,
      )
      .bind(args.churchId, args.edgeType)
      .all()
  ).results as any[];

  return (rows ?? []).map((r) => ({
    fromNodeId: String(r.fromNodeId),
    toNodeId: String(r.toNodeId),
    edgeType: String(r.edgeType),
    weight: typeof r.weight === "number" ? r.weight : 1.0,
  })) as JourneyEdgeRow[];
}

async function getJourneyStages(env: Env, args: { churchId: string }): Promise<JourneyStage[]> {
  const rows = (
    await env.churchcore
      .prepare(`SELECT node_id AS id, title, summary FROM journey_node WHERE church_id=?1 AND node_type='Stage'`)
      .bind(args.churchId)
      .all()
  ).results as any[];

  const stages: JourneyStage[] = (rows ?? []).map((r) => ({ id: String(r.id), title: String(r.title), summary: r.summary ?? null }));
  const byId = new Map<string, JourneyStage>(stages.map((s) => [s.id, s]));

  // Order stages by walking the NEXT_STAGE chain (seeded as stage_seeker -> ...).
  // If the graph is malformed (branching/cycles/missing head), fall back to a stable order.
  const nextEdges = await listJourneyEdgesByType(env, { churchId: args.churchId, edgeType: "NEXT_STAGE" });
  const filtered = nextEdges.filter((e) => byId.has(e.fromNodeId) && byId.has(e.toNodeId));

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, Array<{ to: string; weight: number }>>();
  for (const e of filtered) {
    incoming.set(e.toNodeId, (incoming.get(e.toNodeId) ?? 0) + 1);
    const list = outgoing.get(e.fromNodeId) ?? [];
    list.push({ to: e.toNodeId, weight: e.weight });
    outgoing.set(e.fromNodeId, list);
  }

  let head = byId.has("stage_seeker") ? "stage_seeker" : "";
  if (!head) {
    // Prefer any stage with no incoming NEXT_STAGE edges.
    for (const s of stages) {
      if ((incoming.get(s.id) ?? 0) === 0) {
        head = s.id;
        break;
      }
    }
  }

  const ordered: JourneyStage[] = [];
  const visited = new Set<string>();
  const pickNext = (from: string) => {
    const outs = outgoing.get(from);
    if (!outs?.length) return "";
    const sorted = outs
      .slice()
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || String(a.to).localeCompare(String(b.to)));
    return String(sorted[0]?.to ?? "");
  };

  if (head) {
    let cur = head;
    while (cur && !visited.has(cur)) {
      const node = byId.get(cur);
      if (!node) break;
      ordered.push(node);
      visited.add(cur);
      cur = pickNext(cur);
    }
  }

  // Append any missing stages in stable order (title then id).
  const remaining = stages
    .filter((s) => !visited.has(s.id))
    .sort((a, b) => String(a.title).localeCompare(String(b.title)) || String(a.id).localeCompare(String(b.id)));
  ordered.push(...remaining);

  return ordered;
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
  if (entityType === "community") {
    const row = (
      await env.churchcore
        .prepare(
          `SELECT id,campus_id,kind,title,description,source_url,signup_url,start_at,end_at,tags_json,is_active,created_at,updated_at
           FROM community_catalog
           WHERE church_id=?1 AND id=?2`,
        )
        .bind(args.churchId, entityId)
        .first()
    ) as any;
    return row ? { type: "community", community: row } : null;
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
  if (entityType === "community") {
    const row = (
      await env.churchcore
        .prepare(
          `SELECT id,campus_id,kind,title,description,source_url,signup_url,start_at,end_at,tags_json,is_active,created_at,updated_at
           FROM community_catalog
           WHERE church_id=?1 AND id=?2`,
        )
        .bind(args.churchId, entityId)
        .first()
    ) as any;
    return row ? { type: "community", community: row } : null;
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

async function computeJourneyNextSteps(
  env: Env,
  args: { churchId: string; personId: string; currentStageId: string; limit: number; personMemory?: any },
) {
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

  // Prefer nodes that help satisfy the *next stage* requirements (keeps progression feeling concrete).
  const nextStageEdge = stageEdges
    .filter((e) => String(e.edgeType) === "NEXT_STAGE")
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || String(a.toNodeId).localeCompare(String(b.toNodeId)))[0];
  const nextStageId = nextStageEdge?.toNodeId ? String(nextStageEdge.toNodeId) : "";
  const nextStageReqNodeIds = new Set<string>();
  if (nextStageId) {
    const nextEdges = await listJourneyEdgesFrom(env, { churchId: args.churchId, fromNodeId: nextStageId });
    for (const e of nextEdges) {
      if (String(e.edgeType) !== "REQUIRES") continue;
      const nodeId = String(e.toNodeId ?? "");
      if (!nodeId) continue;
      nextStageReqNodeIds.add(nodeId);
      if (!completedNodeIds.has(nodeId)) {
        const weight = typeof e.weight === "number" ? e.weight : 1.0;
        candidates.push({ nodeId, edgeType: "REQUIRES_NEXT_STAGE", score: weight + 0.35, why: "Moves you toward the next stage" });
      }
    }
  }

  // Barrier-aware: if the person has an active barrier event, add RESOLVED_BY edges as priority candidates.
  const recent = await listPersonJourneyRecentEvents(env, { churchId: args.churchId, personId: args.personId, limit: 80 });
  const activeBarrierNodeIds: string[] = [];
  let barrierSuggestsGuide = false;
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
      const toId = String(e.toNodeId ?? "");
      if (toId === "step_talk_to_guide") barrierSuggestsGuide = true;
      candidates.push({ nodeId: toId, edgeType: "RESOLVED_BY", score: weight + 0.5, why: "Helps address a current barrier" });
    }
  }

  // Belief / Desire / Intent (BDI) from person memory to make next steps personal.
  const bdiRaw = args.personMemory && typeof args.personMemory === "object" ? (args.personMemory as any)?.worldview?.bdi : null;
  const asStrArray = (v: any) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);
  const bdi = bdiRaw && typeof bdiRaw === "object" ? { belief: asStrArray((bdiRaw as any).belief), desire: asStrArray((bdiRaw as any).desire), intent: asStrArray((bdiRaw as any).intent) } : { belief: [], desire: [], intent: [] };
  const wantsTalk = bdi.intent.some((x) => /talk|guide|mentor|pastor/i.test(x));
  const wantsCommunity = bdi.desire.some((x) => /community|relationships?|belong|group/i.test(x));
  const wantsClarity = bdi.desire.some((x) => /clarity|understand|truth|questions?|gospel|bible/i.test(x));
  const wantsPractice = bdi.intent.some((x) => /read|pray|attend|serve|start|join/i.test(x)) || bdi.desire.some((x) => /grow|discipline|habit/i.test(x));

  // Fetch nodes and pick a balanced set: ActionStep + Community + Resource/Doctrine/Practice, then fill by score.
  const dedup = new Map<string, { node: any; edgeType: string; score: number; why: string }>();
  for (const c of candidates) {
    if (!c.nodeId) continue;
    if (completedNodeIds.has(c.nodeId) && c.edgeType === "REQUIRES") continue;
    const existing = dedup.get(c.nodeId);
    if (!existing || c.score > existing.score) {
      const node = await getJourneyNode(env, { churchId: args.churchId, nodeId: c.nodeId });
      if (!node) continue;
      let score = c.score;

      // Progression boost: required-for-next-stage gets a nudge (even if introduced via other edges).
      if (nextStageReqNodeIds.has(String(node.id))) score += 0.25;

      // BDI boosts (lightweight; UI copy explains categories).
      const nodeType = String(node.type ?? "");
      const nodeId = String(node.id ?? "");
      if (wantsCommunity && (nodeType === "Community" || /join_group|group|community/i.test(nodeId))) score += 0.18;
      if (wantsClarity && (nodeType === "DoctrineTopic" || nodeType === "Resource" || /topic_|res_/i.test(nodeId))) score += 0.15;
      if (wantsPractice && (nodeType === "Practice" || nodeType === "Milestone" || /pr_|ms_/i.test(nodeId))) score += 0.12;

      // De-emphasize “Talk with a Guide” unless intent-driven or barrier-driven.
      if (nodeId === "step_talk_to_guide" && !wantsTalk && !barrierSuggestsGuide) score -= 0.35;

      const whyParts = [c.why];
      if (nextStageReqNodeIds.has(nodeId)) whyParts.push("Helps you reach the next stage");
      dedup.set(c.nodeId, { node, edgeType: c.edgeType, score, why: whyParts.filter(Boolean).join(" · ") });
    }
  }

  const all = Array.from(dedup.values()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const actions = all.filter((x) => x.node?.type === "ActionStep").filter((x) => String(x.node?.id ?? "") !== "step_talk_to_guide" || wantsTalk || barrierSuggestsGuide);
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
  let row: any = null;
  try {
    row = (await env.churchcore
      .prepare(`SELECT id,title,status,metadata_json AS metadataJson FROM chat_threads WHERE church_id=?1 AND user_id=?2 AND id=?3`)
      .bind(churchId, userId, threadId)
      .first()) as any;
  } catch {
    row = (await env.churchcore
      .prepare(`SELECT id,title,status FROM chat_threads WHERE church_id=?1 AND user_id=?2 AND id=?3`)
      .bind(churchId, userId, threadId)
      .first()) as any;
  }
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

const TopicTemplateListSchema = z.object({
  identity: IdentitySchema,
  include_inactive: z.boolean().optional().nullable(),
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

const ThreadClearSchema = z.object({
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

const ChatAiGatewaySchema = ChatSchema.extend({
  mode: z.enum(["general", "grounded", "auto"]).optional().nullable(),
  sources_limit: z.number().int().min(1).max(25).optional().nullable(),
  rag_publisher: z.string().min(1).optional().nullable(),
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
    custody_notes: z.string().optional().nullable(),
  }),
});

const HouseholdMemberRemoveSchema = z.object({
  identity: IdentitySchema,
  household_id: z.string().min(1),
  person_id: z.string().min(1),
});

const HouseholdProfileUpsertSchema = z.object({
  identity: IdentitySchema,
  household_id: z.string().min(1),
  allergy_notes: z.string().optional().nullable(),
});

const HouseholdRelationshipUpsertSchema = z.object({
  identity: IdentitySchema,
  household_id: z.string().min(1),
  child_person_id: z.string().min(1),
  relationship: z.enum(["authorized_pickup", "grandparent", "aunt", "uncle", "aunt_uncle", "other_family"]),
  person: z.object({
    person_id: z.string().min(1).optional().nullable(),
    first_name: z.string().min(1),
    last_name: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
});

const HouseholdRelationshipRemoveSchema = z.object({
  identity: IdentitySchema,
  household_id: z.string().min(1),
  relationship_id: z.string().min(1),
});

// Weekly Podcast (The Weekly)
const WeeklyPodcastListSchema = z.object({
  identity: IdentitySchema,
  search: z.string().min(1).optional().nullable(),
  include_inactive: z.boolean().optional().nullable(),
  limit: z.number().int().min(1).max(200).optional().nullable(),
  offset: z.number().int().min(0).max(500000).optional().nullable(),
});

const WeeklyPodcastGetSchema = z.object({
  identity: IdentitySchema,
  podcast_id: z.string().min(1),
});

const WeeklyPodcastAnalyzeSchema = z
  .object({
    identity: IdentitySchema,
    podcast_id: z.string().min(1),
    source_text: z.string().optional().nullable(), // transcript/notes (optional if mp3_url is provided)
    mp3_url: z.string().url().optional().nullable(), // will be fetched + transcribed
  })
  .refine((v) => (typeof v.source_text === "string" && v.source_text.trim().length >= 20) || (typeof v.mp3_url === "string" && v.mp3_url.trim().length > 0), {
    message: "Provide source_text (20+ chars) or mp3_url",
    path: ["source_text"],
  });

// Weekly Sermons (campus messages)
const SermonListSchema = z.object({
  identity: IdentitySchema,
  campus_id: z.string().min(1).optional().nullable(),
  search: z.string().min(1).optional().nullable(), // title/speaker/passage
  limit: z.number().int().min(1).max(200).optional().nullable(),
  offset: z.number().int().min(0).max(500000).optional().nullable(),
});

const SermonGetSchema = z.object({
  identity: IdentitySchema,
  message_id: z.string().min(1), // campus_messages.id (e.g. msg_2479)
});

const SermonCompareSchema = z.object({
  identity: IdentitySchema,
  campuses: z.array(z.string().min(1)).optional().nullable(), // default: boulder/erie/thornton
  message_ids: z.array(z.string().min(1)).optional().nullable(), // optional explicit override (3 items)
  anchor_message_id: z.string().min(1).optional().nullable(), // preferred: compare based on this sermon (date+title)
});

// Bible reading plan (sermon-anchored, week + daily items)
const BiblePlanWeekGetSchema = z.object({
  identity: IdentitySchema,
  campus_id: z.string().min(1).optional().nullable(),
  week_start_date: z.string().min(10).optional().nullable(), // YYYY-MM-DD (optional override)
});

const BiblePlanItemCompleteSchema = z.object({
  identity: IdentitySchema,
  item_id: z.string().min(1),
});

const BiblePlanCheckinCreateSchema = z.object({
  identity: IdentitySchema,
  week_id: z.string().min(1),
  person_id: z.string().min(1),
  day_date: z.string().min(10).optional().nullable(), // YYYY-MM-DD optional
  message: z.string().min(1).max(5000),
});

// Community (catalog + per-person involvement)
const CommunityCatalogListSchema = z.object({
  identity: IdentitySchema,
  campus_id: z.string().min(1).optional().nullable(),
  kind: z.string().min(1).optional().nullable(),
  search: z.string().min(1).optional().nullable(),
  include_inactive: z.boolean().optional().nullable(),
  limit: z.number().int().min(1).max(200).optional().nullable(),
  offset: z.number().int().min(0).max(500000).optional().nullable(),
});

const CommunityMyListSchema = z.object({
  identity: IdentitySchema,
  include_inactive: z.boolean().optional().nullable(),
  limit: z.number().int().min(1).max(200).optional().nullable(),
  offset: z.number().int().min(0).max(500000).optional().nullable(),
});

const CommunityJoinSchema = z.object({
  identity: IdentitySchema,
  community_id: z.string().min(1),
  status: z.enum(["pending", "active"]).optional().nullable(),
});

const CommunityLeaveSchema = z.object({
  identity: IdentitySchema,
  community_id: z.string().min(1),
});

const CommunityMarkSchema = z.object({
  identity: IdentitySchema,
  community_id: z.string().min(1),
  status: z.enum(["attended", "completed"]),
});

// Groups (long-lived membership + schedule + bible study)
const GroupMyListSchema = z.object({
  identity: IdentitySchema,
  include_inactive: z.boolean().optional().nullable(),
  limit: z.number().int().min(1).max(200).optional().nullable(),
  offset: z.number().int().min(0).max(500000).optional().nullable(),
});

const GroupGetSchema = z.object({
  identity: IdentitySchema,
  group_id: z.string().min(1),
});

const GroupMembersListSchema = z.object({
  identity: IdentitySchema,
  group_id: z.string().min(1),
  include_inactive: z.boolean().optional().nullable(),
});

const GroupInviteCreateSchema = z.object({
  identity: IdentitySchema,
  group_id: z.string().min(1),
  invitee_person_id: z.string().min(1),
});

const GroupInviteRespondSchema = z.object({
  identity: IdentitySchema,
  invite_id: z.string().min(1),
  action: z.enum(["accept", "decline"]),
});

const GroupInvitesSentListSchema = z.object({
  identity: IdentitySchema,
  group_id: z.string().min(1),
  status: z.enum(["pending", "accepted", "declined", "cancelled", "expired"]).optional().nullable(),
  limit: z.number().int().min(1).max(200).optional().nullable(),
  offset: z.number().int().min(0).max(100000).optional().nullable(),
});

const GroupInviteCancelSchema = z.object({
  identity: IdentitySchema,
  invite_id: z.string().min(1),
});

const GroupCreateSchema = z.object({
  identity: IdentitySchema,
  campus_id: z.string().optional().nullable(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  meeting_details: z.string().optional().nullable(),
  meeting_frequency: z.enum(["weekly", "biweekly"]).optional().nullable(),
  meeting_day_of_week: z.number().int().min(0).max(6).optional().nullable(),
  meeting_time_local: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  meeting_timezone: z.string().optional().nullable(),
  meeting_location_name: z.string().optional().nullable(),
  meeting_location_address: z.string().optional().nullable(),
  is_open: z.boolean().optional().nullable(),
});

const GroupUpdateSchema = z.object({
  identity: IdentitySchema,
  group_id: z.string().min(1),
  campus_id: z.string().optional().nullable(),
  name: z.string().min(1).optional().nullable(),
  description: z.string().optional().nullable(),
  meeting_details: z.string().optional().nullable(),
  meeting_frequency: z.enum(["weekly", "biweekly"]).optional().nullable(),
  meeting_day_of_week: z.number().int().min(0).max(6).optional().nullable(),
  meeting_time_local: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  meeting_timezone: z.string().optional().nullable(),
  meeting_location_name: z.string().optional().nullable(),
  meeting_location_address: z.string().optional().nullable(),
  is_open: z.boolean().optional().nullable(),
});

const GroupInvitesInboxListSchema = z.object({
  identity: IdentitySchema,
  status: z.enum(["pending", "accepted", "declined", "cancelled"]).optional().nullable(),
  limit: z.number().int().min(1).max(200).optional().nullable(),
  offset: z.number().int().min(0).max(100000).optional().nullable(),
});

const PeopleSearchSchema = z.object({
  identity: IdentitySchema,
  q: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional().nullable(),
});

const GroupMemberRemoveSchema = z.object({
  identity: IdentitySchema,
  group_id: z.string().min(1),
  member_person_id: z.string().min(1),
});

const GroupMemberSetRoleSchema = z.object({
  identity: IdentitySchema,
  group_id: z.string().min(1),
  member_person_id: z.string().min(1),
  role: z.enum(["member", "leader", "host"]),
});

const GroupEventsListSchema = z.object({
  identity: IdentitySchema,
  group_id: z.string().min(1),
  from_iso: z.string().min(1),
  to_iso: z.string().min(1),
});

const GroupEventCreateSchema = z.object({
  identity: IdentitySchema,
  group_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  start_at: z.string().min(1),
  end_at: z.string().optional().nullable(),
  visibility: z.enum(["members", "leaders"]).optional().nullable(),
});

const GroupEventUpdateSchema = z.object({
  identity: IdentitySchema,
  group_id: z.string().min(1),
  event_id: z.string().min(1),
  title: z.string().min(1).optional().nullable(),
  description: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  start_at: z.string().min(1).optional().nullable(),
  end_at: z.string().optional().nullable(),
  visibility: z.enum(["members", "leaders"]).optional().nullable(),
});

const GroupEventDeleteSchema = z.object({
  identity: IdentitySchema,
  group_id: z.string().min(1),
  event_id: z.string().min(1),
});

const GroupBibleStudyListSchema = z.object({
  identity: IdentitySchema,
  group_id: z.string().min(1),
  include_archived: z.boolean().optional().nullable(),
});

const GroupBibleStudyCreateSchema = z.object({
  identity: IdentitySchema,
  group_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
});

const GroupBibleStudyAddReadingSchema = z.object({
  identity: IdentitySchema,
  bible_study_id: z.string().min(1),
  ref: z.string().min(1),
  order_index: z.number().int().min(0).max(100000).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const GroupBibleStudyAddNoteSchema = z.object({
  identity: IdentitySchema,
  bible_study_id: z.string().min(1),
  content_markdown: z.string().min(1),
  visibility: z.enum(["members", "leaders"]).optional().nullable(),
});

const GroupBibleStudyReadingsListSchema = z.object({
  identity: IdentitySchema,
  bible_study_id: z.string().min(1),
});

const GroupBibleStudyNotesListSchema = z.object({
  identity: IdentitySchema,
  bible_study_id: z.string().min(1),
});

const GroupBibleStudySessionsListSchema = z.object({
  identity: IdentitySchema,
  bible_study_id: z.string().min(1),
});

const GroupBibleStudySessionCreateSchema = z.object({
  identity: IdentitySchema,
  bible_study_id: z.string().min(1),
  session_at: z.string().min(1),
  title: z.string().optional().nullable(),
  agenda: z.string().optional().nullable(),
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
  const metadata = parsed.data.metadata && typeof parsed.data.metadata === "object" ? parsed.data.metadata : null;
  const metadataJson = metadata ? JSON.stringify(metadata) : null;
  try {
    await env.churchcore
      .prepare(`INSERT INTO chat_threads (id, church_id, user_id, title, metadata_json, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7)`)
      .bind(id, churchId, userId, title, metadataJson, ts, ts)
      .run();
  } catch {
    // Backwards-compatible if `metadata_json` isn't deployed yet.
    await env.churchcore
      .prepare(`INSERT INTO chat_threads (id, church_id, user_id, title, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6)`)
      .bind(id, churchId, userId, title, ts, ts)
      .run();
  }
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

  let rows: any[] = [];
  try {
    rows =
      (
        await env.churchcore
          .prepare(
            `SELECT id,title,status,metadata_json AS metadataJson,created_at AS createdAt,updated_at AS updatedAt
             FROM chat_threads
             WHERE church_id=?1 AND user_id=?2 ${statusWhere}
             ORDER BY updated_at DESC`,
          )
          .bind(churchId, userId)
          .all()
      ).results ?? [];
  } catch {
    rows =
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
  }

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

  let threadMeta: any = thread;
  if (thread && typeof (thread as any)?.metadataJson === "string") {
    try {
      const mj = JSON.parse(String((thread as any).metadataJson));
      threadMeta = { ...(thread as any), metadata: mj };
    } catch {
      threadMeta = thread;
    }
  }

  const { person } = await resolvePerson(env, identity);
  return json({ thread: threadMeta, messages, person });
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

async function handleThreadClear(req: Request, env: Env) {
  const parsed = ThreadClearSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const threadId = parsed.data.thread_id;

  const thread = await requireOwnedThread(env, { churchId, userId, threadId });
  if (!thread) return json({ error: "Thread not found" }, { status: 404 });

  await env.churchcore.prepare(`DELETE FROM chat_messages WHERE church_id=?1 AND thread_id=?2`).bind(churchId, threadId).run();
  const ts = nowIso();
  await env.churchcore.prepare(`UPDATE chat_threads SET updated_at=?1 WHERE church_id=?2 AND user_id=?3 AND id=?4`).bind(ts, churchId, userId, threadId).run();
  return json({ ok: true, thread_id: threadId, cleared_at: ts });
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

function defaultTopicTemplates() {
  // Tools: guide, faith_journey, community_manager, calendar, bible_reader, weekly_sermons, etc.
  return [
    { slug: "ask_our_church", title: "Ask our church", description: "Answers grounded in our church content (beliefs, sermons, policies).", toolIds: ["guide", "weekly_sermons"] },
    { slug: "faith_journey", title: "Faith journey", description: "Track where you are and next steps (baptism, groups, serving).", toolIds: ["faith_journey", "guide", "bible_reader"] },
    { slug: "your_community", title: "Find your community", description: "Explore groups, classes, outreach, and ways to connect.", toolIds: ["community_manager", "calendar", "guide"] },
    { slug: "home_group", title: "Find a home group", description: "Help me find and join a small group that fits.", toolIds: ["community_manager", "guide", "calendar"] },
    { slug: "sermon_discussion", title: "This week’s sermon", description: "Sermon recap, questions, and weekly Bible plan.", toolIds: ["weekly_sermons", "bible_reader", "guide"] },
    { slug: "bible_plan", title: "Bible reading plan", description: "Stay on track with this week’s readings and mark progress.", toolIds: ["bible_reader", "guide"] },
    { slug: "events", title: "Events & schedule", description: "What’s happening this week and what should I attend?", toolIds: ["calendar", "community_manager"] },
    { slug: "prayer", title: "Prayer", description: "Share prayer requests and get support.", toolIds: ["care_pastoral", "guide"] },
    { slug: "kids", title: "Kids & family", description: "Kids check-in, household info, allergies, custody notes.", toolIds: ["kids_checkin", "household_manager"] },
  ];
}

async function handleTopicTemplateList(req: Request, env: Env) {
  const parsed = TopicTemplateListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const includeInactive = Boolean(parsed.data.include_inactive);

  // If table exists, prefer it; otherwise return defaults.
  try {
    const rows =
      (
        await env.churchcore
          .prepare(
            `SELECT slug,title,description,tool_ids_json AS toolIdsJson,sort_order AS sortOrder,is_active AS isActive,updated_at AS updatedAt
             FROM topic_templates
             WHERE church_id=?1 ${includeInactive ? "" : "AND is_active=1"}
             ORDER BY sort_order ASC, updated_at DESC`,
          )
          .bind(churchId)
          .all()
      ).results ?? [];
    const items = (rows as any[]).map((r) => {
      let toolIds: string[] = [];
      try {
        const j = r?.toolIdsJson ? JSON.parse(String(r.toolIdsJson)) : [];
        toolIds = Array.isArray(j) ? j.map((x) => String(x)).filter(Boolean) : [];
      } catch {
        toolIds = [];
      }
      return { slug: String(r.slug), title: String(r.title), description: r.description ?? null, toolIds, sortOrder: Number(r.sortOrder ?? 0) };
    });
    if (items.length) return json({ ok: true, templates: items });
  } catch {
    // fall back
  }

  return json({ ok: true, templates: defaultTopicTemplates() });
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

type AiGatewayChatMode = "general" | "grounded" | "auto";
type AiGatewayMsg = { role: "system" | "user" | "assistant"; content: string };

async function loadThreadMessagesForAiGateway(env: Env, args: { churchId: string; threadId: string; limit?: number }) {
  const limit = Math.max(1, Math.min(400, args.limit ?? 200));
  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT sender_type AS senderType, content
           FROM chat_messages
           WHERE church_id=?1 AND thread_id=?2
           ORDER BY created_at ASC
           LIMIT ${limit}`,
        )
        .bind(args.churchId, args.threadId)
        .all()
    ).results ?? [];

  const msgs: AiGatewayMsg[] = [];
  for (const r of rows as any[]) {
    const sender = String(r?.senderType ?? "").toLowerCase();
    const content = typeof r?.content === "string" ? String(r.content) : "";
    if (!content.trim()) continue;
    if (sender === "assistant") msgs.push({ role: "assistant", content });
    else if (sender === "user") msgs.push({ role: "user", content });
    else continue;
  }
  return msgs;
}

function compactJson(value: unknown, maxChars: number) {
  try {
    const s = JSON.stringify(value ?? null);
    if (s.length <= maxChars) return s;
    return `${s.slice(0, Math.max(0, maxChars - 3))}...`;
  } catch {
    return "";
  }
}

async function getKbExcerptForQuery(env: Env, args: { churchId: string; query: string; limit?: number }) {
  const q = String(args.query ?? "").trim();
  if (!q) return "";
  const terms = q
    .split(/\s+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4)
    .slice(0, 6);
  if (!terms.length) return "";
  const limit = Math.max(1, Math.min(6, args.limit ?? 3));

  const patterns = terms.map((t) => `%${t.toLowerCase()}%`);
  const clauses = patterns.map((_, i) => `LOWER(text) LIKE ?${i + 2}`).join(" OR ");
  const binds = [args.churchId, ...patterns];

  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT source_id AS sourceId, text, updated_at AS updatedAt
           FROM kb_chunks
           WHERE church_id=?1 AND (${clauses})
           ORDER BY updated_at DESC
           LIMIT ${limit}`,
        )
        .bind(...(binds as any))
        .all()
    ).results ?? [];

  const parts: string[] = [];
  for (const r of rows as any[]) {
    const sourceId = typeof r?.sourceId === "string" ? r.sourceId : "unknown_source";
    const text = typeof r?.text === "string" ? r.text : "";
    if (!text.trim()) continue;
    parts.push(`- source: ${sourceId}\n${text.trim().slice(0, 900)}`);
  }
  return parts.join("\n\n");
}

function buildAiGatewaySystemPrompt(args: {
  role: string;
  identityContact: any;
  journey: any;
  weekly: any;
  kbExcerpt: string;
}) {
  const role = String(args.role || "seeker");
  const kb = String(args.kbExcerpt || "").trim();
  const weeklyCompact = compactJson(args.weekly, 3500);
  const journeyCompact = compactJson(args.journey, 2200);
  const contactCompact = compactJson(args.identityContact, 800);

  return [
    `You are the ChurchCore assistant for a local evangelical church.`,
    ``,
    `## Guardrails`,
    `- Be honest about what you know; do not invent church facts, policies, times, or staff names.`,
    `- Distinguish biblical counsel (general) from this church's policies (specific). If unsure about church policy, ask a clarifying question or suggest where to confirm.`,
    `- If the user expresses self-harm, abuse, or imminent danger, urge immediate local help (call emergency services / a trusted person) and offer to connect to church pastoral care.`,
    ``,
    `## Tradition`,
    `- tradition: evangelical`,
    ``,
    `## ChurchCore context (may be partial)`,
    `identity_contact: ${contactCompact || "{}"}`,
    `journey: ${journeyCompact || "{}"}`,
    `weekly: ${weeklyCompact || "null"}`,
    kb ? `` : "",
    kb ? `## ChurchCore KB excerpt (unverified; cite softly)` : "",
    kb ? kb : "",
    ``,
    `## Output`,
    `- Respond concisely, with warmth and clarity.`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function runAiGatewayCompletion(env: Env, args: {
  mode: AiGatewayChatMode;
  messages: AiGatewayMsg[];
  sourcesLimit?: number | null;
  ragPublisher?: string | null;
}) {
  const token = await getAiGatewayAccessToken(env);
  const base = (env.AI_GATEWAY_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (!base) throw new Error("Missing AI_GATEWAY_BASE_URL");
  const mode = (args.mode ?? "grounded") as AiGatewayChatMode;
  const url = mode === "general" ? `${base}/chat/completions` : `${base}/chat/completions/grounded`;

  const body: any = {
    auto_routing: true,
    tradition: "evangelical",
    messages: args.messages,
  };
  const sourcesLimit = args.sourcesLimit ?? null;
  if (mode !== "general" && typeof sourcesLimit === "number") body.sources_limit = sourcesLimit;
  const rp = String(args.ragPublisher ?? env.AI_GATEWAY_RAG_PUBLISHER ?? "").trim();
  if (mode !== "general" && rp) body.rag_publisher = rp;

  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text().catch(() => "");
  const j = safeJsonParse(raw) as any;
  if (!res.ok) throw new Error(`AI gateway completion error (${res.status}): ${raw || "no body"}`);

  const choice = Array.isArray(j?.choices) && j.choices.length ? j.choices[0] : null;
  const content = typeof choice?.message?.content === "string" ? String(choice.message.content) : "";
  return { raw: j, content };
}

async function runAiGatewayCompletionStream(env: Env, args: {
  mode: AiGatewayChatMode;
  messages: AiGatewayMsg[];
  sourcesLimit?: number | null;
  ragPublisher?: string | null;
}) {
  const token = await getAiGatewayAccessToken(env);
  const base = (env.AI_GATEWAY_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (!base) throw new Error("Missing AI_GATEWAY_BASE_URL");
  const mode = (args.mode ?? "grounded") as AiGatewayChatMode;
  const url = mode === "general" ? `${base}/chat/completions` : `${base}/chat/completions/grounded`;

  const body: any = {
    auto_routing: true,
    tradition: "evangelical",
    stream: true,
    messages: args.messages,
  };
  const sourcesLimit = args.sourcesLimit ?? null;
  if (mode !== "general" && typeof sourcesLimit === "number") body.sources_limit = sourcesLimit;
  const rp = String(args.ragPublisher ?? env.AI_GATEWAY_RAG_PUBLISHER ?? "").trim();
  if (mode !== "general" && rp) body.rag_publisher = rp;

  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => "");
    throw new Error(`AI gateway stream error (${res.status}): ${raw || "no body"}`);
  }
  return res;
}

async function transcribeMp3WithOpenAI(env: Env, args: { mp3Url: string }) {
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY (needed for mp3 transcription)");
  const model = (env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1").trim() || "whisper-1";

  const mp3Url = String(args.mp3Url || "").trim();
  if (!mp3Url) throw new Error("Missing mp3Url");

  const audioRes = await fetch(mp3Url);
  if (!audioRes.ok) throw new Error(`Failed to fetch MP3 (${audioRes.status})`);
  const ct = audioRes.headers.get("content-type") ?? "";
  const buf = await audioRes.arrayBuffer();
  if (buf.byteLength <= 0) throw new Error("Empty MP3 download");

  const form = new FormData();
  form.append("model", model);
  form.append("file", new Blob([buf], { type: ct || "audio/mpeg" }), "audio.mp3");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(`OpenAI transcription error (${res.status}): ${data?.error?.message ?? "unknown"}`);
  const text = typeof data?.text === "string" ? data.text : "";
  if (!text.trim()) throw new Error("Transcription returned empty text");
  return { text, model, bytes: buf.byteLength };
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

  // LangGraph /threads/<id>/runs/stream requires UUID thread ids; map chat thread ids to UUIDs.
  const langgraphThreadId = await getOrCreateLangGraphThreadId(env, { churchId, threadId });

  const { personId } = await resolvePerson(env, identity);

  // Keep cross-thread memory synced with relational membership tables (groups + community).
  if (personId) {
    try {
      await syncPersonGroupsAndCommunityToMemory(env, { churchId, personId, actorUserId: userId, actorRole: role, threadId });
    } catch {
      // best-effort
    }
  }

  // Heuristic: only compute "next steps" when the user is asking for it (saves DB work).
  const msgLower = String(message ?? "").toLowerCase();
  const wantsNextSteps =
    skill !== "chat" ||
    /next\s+step|next\s+steps|what\s+should\s+i\s+do|journey|stage|faith|baptis|membership|join\s+(a\s+)?group|serve|volunteer|guide/i.test(msgLower);

  const [personMemory, hh] = personId
    ? await Promise.all([getPersonMemory(env, { churchId, personId }), getHouseholdSummary(env, { churchId, personId })])
    : [{ memory: null, updatedAt: null }, { householdId: null, summary: "" }];

  const memCampusIdRaw = (personMemory as any)?.memory?.identity?.campusId;
  const memCampusId = typeof memCampusIdRaw === "string" && /^campus_[a-z0-9_]+$/i.test(memCampusIdRaw.trim()) ? memCampusIdRaw.trim() : null;
  const effectiveCampusId = memCampusId ?? identity.campus_id ?? "campus_boulder";
  const memPreferredNameRaw = (personMemory as any)?.memory?.identity?.preferredName;
  const memPreferredName = typeof memPreferredNameRaw === "string" ? memPreferredNameRaw.trim() : "";
  const memEmailRaw = (personMemory as any)?.memory?.contact?.email;
  const memPhoneRaw = (personMemory as any)?.memory?.contact?.phone;
  let email = typeof memEmailRaw === "string" ? memEmailRaw.trim() : "";
  let phone = typeof memPhoneRaw === "string" ? memPhoneRaw.trim() : "";
  if (personId && (!email || !phone)) {
    const row = (await env.churchcore.prepare(`SELECT email, phone FROM people WHERE church_id=?1 AND id=?2 LIMIT 1`).bind(churchId, personId).first()) as any;
    if (!email && typeof row?.email === "string") email = String(row.email).trim();
    if (!phone && typeof row?.phone === "string") phone = String(row.phone).trim();
  }
  const identityContact = { churchId, campusId: effectiveCampusId, preferredName: memPreferredName || null, email: email || null, phone: phone || null };

  const redactedMemory = redactMemoryForRole(role, (personMemory as any).memory);
  const journeyState = personId
    ? await ensurePersonJourneyState(env, { churchId, personId, personMemory: (personMemory as any).memory ?? {} })
    : { currentStageId: null, confidence: 0.5, updatedAt: null };
  const currentStageId = journeyState.currentStageId ?? "stage_seeker";
  const journeyCurrentStage = personId ? await getJourneyNode(env, { churchId, nodeId: currentStageId }) : null;
  const journeyNextSteps =
    wantsNextSteps && personId ? await computeJourneyNextSteps(env, { churchId, personId, currentStageId, limit: 3, personMemory: (personMemory as any).memory ?? {} }) : [];
  const inputArgs = parsed.data.args && typeof parsed.data.args === "object" ? (parsed.data.args as Record<string, unknown>) : {};
  const session = {
    churchId,
    campusId: effectiveCampusId,
    timezone: identity.timezone ?? "UTC",
    userId,
    personId,
    role,
    auth: { isAuthenticated: false, roles: [] },
    threadId,
  };

  const weekly = personId ? await getWeeklySermonPlanContext(env, { churchId, campusId: effectiveCampusId, personId }) : null;

  const envelope = await runAgent(env, {
    threadId: langgraphThreadId,
    inputPayload: {
      skill,
      message,
      args: {
        ...inputArgs,
        __context: {
          person_memory: redactedMemory,
          person_memory_updated_at: personMemory.updatedAt,
          identity_contact: identityContact,
          household: { household_id: hh.householdId, summary: hh.summary },
          journey: { current_stage: journeyCurrentStage, next_steps: journeyNextSteps },
          weekly,
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

async function handleCalendarWeek(req: Request, env: Env) {
  const parsed = CalendarWeekSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const start = String(parsed.data.start ?? "").trim();
  const startIso = /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : new Date().toISOString().slice(0, 10);

  const envelope = await runAgent(env, {
    threadId: crypto.randomUUID(),
    inputPayload: {
      skill: "calendar.week",
      args: { start: startIso },
      session: {
        churchId,
        campusId: identity.campus_id ?? null,
        timezone: identity.timezone ?? "UTC",
        userId,
        personId: identity.persona_id ?? null,
        role,
        auth: { isAuthenticated: false, roles: [] },
        threadId: null,
      },
    },
  });

  const schedule = (envelope as any)?.data?.schedule ?? null;
  if (!schedule || typeof schedule !== "object") return json({ ok: false, error: "calendar.week did not return schedule", envelope });
  return json(schedule);
}

async function handleBiblePassage(req: Request, env: Env) {
  const parsed = BiblePassageSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  // Auth is already enforced for POST routes by the worker.
  const ref = String(parsed.data.ref ?? "").trim();
  const translation = (parsed.data.translation ?? "web") as "web" | "kjv";
  // bible-api.com expects refs like "Ephesians 2:8-9" URL-encoded.
  const url = `https://bible-api.com/${encodeURIComponent(ref)}?translation=${encodeURIComponent(translation)}`;
  const res = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
  const raw = await res.text().catch(() => "");
  if (!res.ok) return json({ ok: false, error: `Bible API error (${res.status})`, detail: raw || "no body" }, { status: 502 });
  const j = safeJsonParse(raw) as any;
  const verses = Array.isArray(j?.verses) ? j.verses : [];
  const normalizedVerses = verses
    .filter((v: any) => v && typeof v === "object")
    .map((v: any) => ({
      book: typeof v.book_name === "string" ? v.book_name : null,
      chapter: typeof v.chapter === "number" ? v.chapter : null,
      verse: typeof v.verse === "number" ? v.verse : null,
      text: typeof v.text === "string" ? v.text : "",
    }))
    .filter((v: any) => v.text);

  const text =
    typeof j?.text === "string"
      ? String(j.text)
      : normalizedVerses.map((v: any) => (v.verse != null ? `${v.verse} ${String(v.text).trim()}` : String(v.text).trim())).join("\n");

  return json({
    ok: true,
    ref: typeof j?.reference === "string" ? String(j.reference) : ref,
    translation,
    text: String(text || "").trim(),
    verses: normalizedVerses,
  });
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

        // LangGraph /threads/<id>/runs/stream requires UUID thread ids; map chat thread ids to UUIDs.
        const langgraphThreadId = await getOrCreateLangGraphThreadId(env, { churchId, threadId });

        const { personId } = await resolvePerson(env, identity);
        if (personId) {
          try {
            await syncPersonGroupsAndCommunityToMemory(env, { churchId, personId, actorUserId: userId, actorRole: role, threadId });
          } catch {
            // best-effort
          }
        }
        const msgLower = String(message ?? "").toLowerCase();
        const wantsNextSteps =
          skill !== "chat" ||
          /next\s+step|next\s+steps|what\s+should\s+i\s+do|journey|stage|faith|baptis|membership|join\s+(a\s+)?group|serve|volunteer|guide/i.test(msgLower);

        const [personMemory, hh] = personId
          ? await Promise.all([getPersonMemory(env, { churchId, personId }), getHouseholdSummary(env, { churchId, personId })])
          : [{ memory: null, updatedAt: null }, { householdId: null, summary: "" }];

        const memCampusIdRaw = (personMemory as any)?.memory?.identity?.campusId;
        const memCampusId = typeof memCampusIdRaw === "string" && /^campus_[a-z0-9_]+$/i.test(memCampusIdRaw.trim()) ? memCampusIdRaw.trim() : null;
        const effectiveCampusId = memCampusId ?? identity.campus_id ?? "campus_boulder";
        const memPreferredNameRaw = (personMemory as any)?.memory?.identity?.preferredName;
        const memPreferredName = typeof memPreferredNameRaw === "string" ? memPreferredNameRaw.trim() : "";
        const memEmailRaw = (personMemory as any)?.memory?.contact?.email;
        const memPhoneRaw = (personMemory as any)?.memory?.contact?.phone;
        let email = typeof memEmailRaw === "string" ? memEmailRaw.trim() : "";
        let phone = typeof memPhoneRaw === "string" ? memPhoneRaw.trim() : "";
        if (personId && (!email || !phone)) {
          const row = (await env.churchcore.prepare(`SELECT email, phone FROM people WHERE church_id=?1 AND id=?2 LIMIT 1`).bind(churchId, personId).first()) as any;
          if (!email && typeof row?.email === "string") email = String(row.email).trim();
          if (!phone && typeof row?.phone === "string") phone = String(row.phone).trim();
        }
        const identityContact = { churchId, campusId: effectiveCampusId, preferredName: memPreferredName || null, email: email || null, phone: phone || null };

        const redactedMemory = redactMemoryForRole(role, (personMemory as any).memory);
        const journeyState = personId
          ? await ensurePersonJourneyState(env, { churchId, personId, personMemory: (personMemory as any).memory ?? {} })
          : { currentStageId: null, confidence: 0.5, updatedAt: null };
        const currentStageId = journeyState.currentStageId ?? "stage_seeker";
        const journeyCurrentStage = personId ? await getJourneyNode(env, { churchId, nodeId: currentStageId }) : null;
        const journeyNextSteps =
          wantsNextSteps && personId
            ? await computeJourneyNextSteps(env, { churchId, personId, currentStageId, limit: 3, personMemory: (personMemory as any).memory ?? {} })
            : [];
        const inputArgs = parsed.data.args && typeof parsed.data.args === "object" ? (parsed.data.args as Record<string, unknown>) : {};

        const session = {
          churchId,
          campusId: effectiveCampusId,
          timezone: identity.timezone ?? "UTC",
          userId,
          personId,
          role,
          auth: { isAuthenticated: false, roles: [] },
          threadId,
        };

        const weekly = personId ? await getWeeklySermonPlanContext(env, { churchId, campusId: effectiveCampusId, personId }) : null;

        const inputPayload = {
          skill,
          message,
          args: {
            ...inputArgs,
            __context: {
              person_memory: redactedMemory,
              person_memory_updated_at: (personMemory as any).updatedAt,
              identity_contact: identityContact,
              household: { household_id: (hh as any).householdId, summary: (hh as any).summary },
              journey: { current_stage: journeyCurrentStage, next_steps: journeyNextSteps },
              weekly,
              policy: { role },
            },
          },
          session,
        } as Record<string, unknown>;

        const lgRes = await runAgentStream(env, { threadId: langgraphThreadId, inputPayload });
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
              // LangGraph streams both human + ai messages; only emit AI tokens.
              const msgType = String(messageChunk?.type ?? messageChunk?.role ?? "").toLowerCase();
              const isAi = msgType === "ai" || msgType === "assistant";
              if (isAi) {
                const token = typeof messageChunk?.content === "string" ? String(messageChunk.content) : "";
                emitToken(token);
              }
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
            const msgType = String(messageChunk?.type ?? messageChunk?.role ?? "").toLowerCase();
            const isAi = msgType === "ai" || msgType === "assistant";
            if (isAi) {
              const token = typeof messageChunk?.content === "string" ? String(messageChunk.content) : "";
              emitToken(token);
            }
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
        // If the agent errored, surface it (don't return stale output).
        if ((envelope as any)?.__error__) {
          throw new Error(String((envelope as any)?.__error__?.message ?? "Agent error"));
        }

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

async function handleChatAiGateway(req: Request, env: Env) {
  const parsed = ChatAiGatewaySchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;

  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const threadId = parsed.data.thread_id;
  const message = parsed.data.message;
  const role = (identity.role ?? "seeker") as string;
  const mode = ((parsed.data.mode ?? "grounded") as AiGatewayChatMode) || "grounded";
  const sourcesLimit = parsed.data.sources_limit ?? null;
  const ragPublisher = parsed.data.rag_publisher ?? null;

  // Persist user message
  const m1 = await appendMessage(env, { churchId, userId, threadId, senderType: "user", content: message });
  if ((m1 as any)?.error) return json(m1, { status: 404 });

  const { personId } = await resolvePerson(env, identity);
  const [personMemory, hh] = personId
    ? await Promise.all([getPersonMemory(env, { churchId, personId }), getHouseholdSummary(env, { churchId, personId })])
    : [{ memory: null, updatedAt: null }, { householdId: null, summary: "" }];

  const memCampusIdRaw = (personMemory as any)?.memory?.identity?.campusId;
  const memCampusId = typeof memCampusIdRaw === "string" && /^campus_[a-z0-9_]+$/i.test(memCampusIdRaw.trim()) ? memCampusIdRaw.trim() : null;
  const effectiveCampusId = memCampusId ?? identity.campus_id ?? "campus_boulder";
  const memPreferredNameRaw = (personMemory as any)?.memory?.identity?.preferredName;
  const memPreferredName = typeof memPreferredNameRaw === "string" ? memPreferredNameRaw.trim() : "";
  const memEmailRaw = (personMemory as any)?.memory?.contact?.email;
  const memPhoneRaw = (personMemory as any)?.memory?.contact?.phone;
  let email = typeof memEmailRaw === "string" ? memEmailRaw.trim() : "";
  let phone = typeof memPhoneRaw === "string" ? memPhoneRaw.trim() : "";
  if (personId && (!email || !phone)) {
    const row = (await env.churchcore.prepare(`SELECT email, phone FROM people WHERE church_id=?1 AND id=?2 LIMIT 1`).bind(churchId, personId).first()) as any;
    if (!email && typeof row?.email === "string") email = String(row.email).trim();
    if (!phone && typeof row?.phone === "string") phone = String(row.phone).trim();
  }
  const identityContact = { churchId, campusId: effectiveCampusId, preferredName: memPreferredName || null, email: email || null, phone: phone || null };

  const redactedMemory = redactMemoryForRole(role, (personMemory as any).memory);
  const journeyState = personId
    ? await ensurePersonJourneyState(env, { churchId, personId, personMemory: (personMemory as any).memory ?? {} })
    : { currentStageId: null, confidence: 0.5, updatedAt: null };
  const currentStageId = journeyState.currentStageId ?? "stage_seeker";
  const journeyCurrentStage = personId ? await getJourneyNode(env, { churchId, nodeId: currentStageId }) : null;
  const journey = { current_stage: journeyCurrentStage, next_steps: [] };

  const weekly = personId ? await getWeeklySermonPlanContext(env, { churchId, campusId: effectiveCampusId, personId }) : null;
  const kbExcerpt = mode === "general" ? "" : await getKbExcerptForQuery(env, { churchId, query: message, limit: 3 });
  const systemPrompt = buildAiGatewaySystemPrompt({ role, identityContact, journey, weekly, kbExcerpt });

  const history = await loadThreadMessagesForAiGateway(env, { churchId, threadId, limit: 200 });
  const messages: AiGatewayMsg[] = [{ role: "system", content: systemPrompt }, ...history];

  const { raw, content } = await runAiGatewayCompletion(env, { mode, messages, sourcesLimit, ragPublisher });
  const assistantText = String(content || "").trim();

  const envelope: any = {
    message: assistantText,
    data: { ai_gateway: { mode, raw } },
    citations: [],
    suggested_next_actions: [],
    cards: [],
    forms: [],
    handoff: [],
  };

  await appendMessage(env, { churchId, userId, threadId, senderType: "assistant", content: assistantText || "", envelope });
  return json({ thread_id: threadId, output: envelope });
}

async function handleChatAiGatewayStream(req: Request, env: Env) {
  const parsed = ChatAiGatewaySchema.safeParse(await parseJson(req));
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
        const mode = ((parsed.data.mode ?? "grounded") as AiGatewayChatMode) || "grounded";
        const sourcesLimit = parsed.data.sources_limit ?? null;
        const ragPublisher = parsed.data.rag_publisher ?? null;

        const m1 = await appendMessage(env, { churchId, userId, threadId, senderType: "user", content: message });
        if ((m1 as any)?.error) throw new Error(String((m1 as any)?.error ?? "append failed"));

        const { personId } = await resolvePerson(env, identity);
        const [personMemory, hh] = personId
          ? await Promise.all([getPersonMemory(env, { churchId, personId }), getHouseholdSummary(env, { churchId, personId })])
          : [{ memory: null, updatedAt: null }, { householdId: null, summary: "" }];

        const memCampusIdRaw = (personMemory as any)?.memory?.identity?.campusId;
        const memCampusId = typeof memCampusIdRaw === "string" && /^campus_[a-z0-9_]+$/i.test(memCampusIdRaw.trim()) ? memCampusIdRaw.trim() : null;
        const effectiveCampusId = memCampusId ?? identity.campus_id ?? "campus_boulder";
        const memPreferredNameRaw = (personMemory as any)?.memory?.identity?.preferredName;
        const memPreferredName = typeof memPreferredNameRaw === "string" ? memPreferredNameRaw.trim() : "";
        const memEmailRaw = (personMemory as any)?.memory?.contact?.email;
        const memPhoneRaw = (personMemory as any)?.memory?.contact?.phone;
        let email = typeof memEmailRaw === "string" ? memEmailRaw.trim() : "";
        let phone = typeof memPhoneRaw === "string" ? memPhoneRaw.trim() : "";
        if (personId && (!email || !phone)) {
          const row = (await env.churchcore.prepare(`SELECT email, phone FROM people WHERE church_id=?1 AND id=?2 LIMIT 1`).bind(churchId, personId).first()) as any;
          if (!email && typeof row?.email === "string") email = String(row.email).trim();
          if (!phone && typeof row?.phone === "string") phone = String(row.phone).trim();
        }
        const identityContact = { churchId, campusId: effectiveCampusId, preferredName: memPreferredName || null, email: email || null, phone: phone || null };

        const redactedMemory = redactMemoryForRole(role, (personMemory as any).memory);
        const journeyState = personId
          ? await ensurePersonJourneyState(env, { churchId, personId, personMemory: (personMemory as any).memory ?? {} })
          : { currentStageId: null, confidence: 0.5, updatedAt: null };
        const currentStageId = journeyState.currentStageId ?? "stage_seeker";
        const journeyCurrentStage = personId ? await getJourneyNode(env, { churchId, nodeId: currentStageId }) : null;
        const journey = { current_stage: journeyCurrentStage, next_steps: [] };

        const weekly = personId ? await getWeeklySermonPlanContext(env, { churchId, campusId: effectiveCampusId, personId }) : null;
        const kbExcerpt = mode === "general" ? "" : await getKbExcerptForQuery(env, { churchId, query: message, limit: 3 });
        const systemPrompt = buildAiGatewaySystemPrompt({ role, identityContact, journey, weekly, kbExcerpt });

        const history = await loadThreadMessagesForAiGateway(env, { churchId, threadId, limit: 200 });
        const messages: AiGatewayMsg[] = [{ role: "system", content: systemPrompt }, ...history];

        const aiRes = await runAiGatewayCompletionStream(env, { mode, messages, sourcesLimit, ragPublisher });
        const reader = aiRes.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let assistantText = "";
        let lastChunk: any = null;

        function emitToken(t: string) {
          if (!t) return;
          assistantText += t;
          const safe = t.replace(/\r/g, "").replace(/\n/g, "\\n");
          controller.enqueue(encoder.encode(`event: token\ndata: ${safe}\n\n`));
        }

        function processEventBlock(block: string) {
          const lines = block.split("\n").map((l) => l.trimEnd());
          const dataLines: string[] = [];
          for (const ln of lines) {
            if (ln.startsWith("data:")) dataLines.push(ln.slice(5).trimStart());
          }
          const dataRaw = dataLines.join("\n").trim();
          if (!dataRaw) return;
          if (dataRaw === "[DONE]") return;
          const j = safeJsonParse(dataRaw) as any;
          if (!j || typeof j !== "object") return;
          lastChunk = j;
          const choice = Array.isArray(j?.choices) && j.choices.length ? j.choices[0] : null;
          const delta = choice?.delta ?? null;
          const token = typeof delta?.content === "string" ? String(delta.content) : "";
          if (token) emitToken(token);
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
        const tail = buf.trim();
        if (tail) processEventBlock(tail);

        const envelope: any = {
          message: assistantText,
          data: { ai_gateway: { mode, lastChunk } },
          citations: [],
          suggested_next_actions: [],
          cards: [],
          forms: [],
          handoff: [],
        };

        await appendMessage(env, { churchId, userId, threadId, senderType: "assistant", content: assistantText || "", envelope });
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
        `INSERT INTO child_profiles (person_id, church_id, allergies, special_needs, custody_notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)`,
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

  await syncHouseholdSnapshotToAdults(env, { churchId, householdId });
  return json({ ok: true, household_id: householdId, parent_person_id: parentPersonId, child_person_ids: childIds, actor: { userId, role } });
}

async function loadHouseholdFull(env: Env, args: { churchId: string; householdId: string }) {
  const household = (await env.churchcore.prepare(`SELECT * FROM households WHERE church_id=?1 AND id=?2`).bind(args.churchId, args.householdId).first()) as any;
  if (!household) return { household: null, profile: null as any, members: [], children: [], relationships: [] as any[] };

  const profile = (await env.churchcore
    .prepare(`SELECT household_id AS householdId, allergy_notes AS allergyNotes, created_at AS createdAt, updated_at AS updatedAt FROM household_profiles WHERE church_id=?1 AND household_id=?2`)
    .bind(args.churchId, args.householdId)
    .first()) as any;

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
          `SELECT p.id, p.first_name, p.last_name, p.birthdate, cp.grade, cp.allergies, cp.medical_notes, cp.special_needs, cp.custody_notes AS custody_notes
           FROM household_members hm
           JOIN people p ON p.id = hm.person_id
           LEFT JOIN child_profiles cp ON cp.person_id = p.id
           WHERE p.church_id=?1 AND hm.household_id=?2 AND hm.role='child'`,
        )
        .bind(args.churchId, args.householdId)
        .all()
    ).results ?? [];

  const childIds = (children as any[]).map((c) => String(c?.id ?? "")).filter(Boolean);
  let relationships: any[] = [];
  if (childIds.length) {
    const placeholders = childIds.map((_, i) => `?${i + 2}`).join(",");
    const rows =
      (
        await env.churchcore
          .prepare(
            `SELECT pr.id, pr.from_person_id AS fromPersonId, pr.to_person_id AS toPersonId, pr.relationship_type AS relationshipType, pr.status, pr.notes, pr.created_at AS createdAt, pr.updated_at AS updatedAt,
                    fp.first_name AS fromFirstName, fp.last_name AS fromLastName,
                    tp.first_name AS toFirstName, tp.last_name AS toLastName
             FROM person_relationships pr
             JOIN people fp ON fp.id = pr.from_person_id AND fp.church_id = pr.church_id
             JOIN people tp ON tp.id = pr.to_person_id AND tp.church_id = pr.church_id
             WHERE pr.church_id=?1 AND pr.status='active' AND pr.to_person_id IN (${placeholders})
               AND pr.relationship_type IN ('guardian','authorized_pickup','grandparent','aunt','uncle','aunt_uncle','other_family')
             ORDER BY pr.relationship_type ASC, fp.last_name ASC, fp.first_name ASC`,
          )
          .bind(args.churchId, ...childIds)
          .all()
      ).results ?? [];
    relationships = rows as any[];
  }

  return { household, profile: profile ?? null, members, children, relationships };
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

  const { household, profile, members, children, relationships } = await loadHouseholdFull(env, { churchId, householdId });
  return json({ ok: true, households: householdRows, household, profile, members, children, relationships, actor: { userId, role, personId } });
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
        `INSERT INTO child_profiles (person_id, church_id, allergies, special_needs, custody_notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(person_id) DO UPDATE SET allergies=excluded.allergies, special_needs=excluded.special_needs, custody_notes=excluded.custody_notes, updated_at=excluded.updated_at`,
      )
      .bind(nextPersonId, churchId, member.allergies ?? null, member.special_needs ? 1 : 0, member.custody_notes ?? null, now, now)
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

  await syncHouseholdSnapshotToAdults(env, { churchId, householdId });
  const { household, profile, members, children, relationships } = await loadHouseholdFull(env, { churchId, householdId });
  return json({ ok: true, household, profile, members, children, relationships, member_person_id: nextPersonId, actor: { userId, role, personId: actorPersonId } });
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
  await syncHouseholdSnapshotToAdults(env, { churchId, householdId });
  const { household, profile, members, children, relationships } = await loadHouseholdFull(env, { churchId, householdId });
  return json({ ok: true, household, profile, members, children, relationships, actor: { userId, role, personId: actorPersonId } });
}

async function syncHouseholdSnapshotToAdults(env: Env, args: { churchId: string; householdId: string }) {
  const { household, profile, members, children, relationships } = await loadHouseholdFull(env, { churchId: args.churchId, householdId: args.householdId });
  if (!household) return;
  const adultIds = (Array.isArray(members) ? members : [])
    .filter((m: any) => String(m?.household_role ?? "").toLowerCase() === "adult")
    .map((m: any) => String(m?.id ?? ""))
    .filter(Boolean);
  if (!adultIds.length) return;

  const snapshot = {
    household_id: String(household?.id ?? args.householdId),
    name: household?.name ?? null,
    profile: profile ?? null,
    members,
    children,
    relationships,
    synced_at: nowIso(),
  };

  for (const personId of adultIds) {
    const row = await getPersonMemory(env, { churchId: args.churchId, personId });
    const base = row.memory && typeof row.memory === "object" ? row.memory : {};
    const next = { ...base, household: snapshot };
    await upsertPersonMemory(env, { churchId: args.churchId, personId, memory: next });
  }
}

async function handleHouseholdProfileUpsert(req: Request, env: Env) {
  const parsed = HouseholdProfileUpsertSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const householdId = parsed.data.household_id;

  const { personId: actorPersonId } = await resolvePerson(env, identity);
  const ok = await canManageHousehold(env, { churchId, userId, role, personId: actorPersonId, householdId });
  if (!ok) return json({ error: "Forbidden" }, { status: 403 });

  const now = nowIso();
  await env.churchcore
    .prepare(
      `INSERT INTO household_profiles (household_id, church_id, allergy_notes, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(household_id) DO UPDATE SET allergy_notes=excluded.allergy_notes, updated_at=excluded.updated_at`,
    )
    .bind(householdId, churchId, (parsed.data.allergy_notes ?? null) as any, now, now)
    .run();

  await syncHouseholdSnapshotToAdults(env, { churchId, householdId });
  const out = await loadHouseholdFull(env, { churchId, householdId });
  return json({ ok: true, ...out, actor: { userId, role, personId: actorPersonId } });
}

async function handleHouseholdRelationshipUpsert(req: Request, env: Env) {
  const parsed = HouseholdRelationshipUpsertSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const householdId = parsed.data.household_id;
  const childPersonId = parsed.data.child_person_id;
  const relationshipType = parsed.data.relationship;
  const p = parsed.data.person;

  const { personId: actorPersonId } = await resolvePerson(env, identity);
  const ok = await canManageHousehold(env, { churchId, userId, role, personId: actorPersonId, householdId });
  if (!ok) return json({ error: "Forbidden" }, { status: 403 });

  const childRow = (await env.churchcore
    .prepare(`SELECT 1 FROM household_members WHERE household_id=?1 AND person_id=?2 AND role='child' LIMIT 1`)
    .bind(householdId, childPersonId)
    .first()) as any;
  if (!childRow) return json({ error: "Unknown child_person_id for household" }, { status: 400 });

  const now = nowIso();
  const relPersonId = (p.person_id ?? "").trim() || crypto.randomUUID();
  const existing = (await env.churchcore.prepare(`SELECT id FROM people WHERE church_id=?1 AND id=?2`).bind(churchId, relPersonId).first()) as any;
  if (!existing) {
    await env.churchcore
      .prepare(`INSERT INTO people (id, church_id, campus_id, first_name, last_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
      .bind(relPersonId, churchId, identity.campus_id ?? null, p.first_name, p.last_name ?? null, now, now)
      .run();
  } else {
    await env.churchcore
      .prepare(`UPDATE people SET first_name=?3, last_name=?4, updated_at=?5 WHERE church_id=?1 AND id=?2`)
      .bind(churchId, relPersonId, p.first_name, p.last_name ?? null, now)
      .run();
  }

  await env.churchcore
    .prepare(
      `INSERT INTO person_relationships (id, church_id, from_person_id, to_person_id, relationship_type, status, notes, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8)`,
    )
    .bind(crypto.randomUUID(), churchId, relPersonId, childPersonId, relationshipType, p.notes ?? null, now, now)
    .run();

  await syncHouseholdSnapshotToAdults(env, { churchId, householdId });
  const out = await loadHouseholdFull(env, { churchId, householdId });
  return json({ ok: true, ...out, actor: { userId, role, personId: actorPersonId } });
}

async function handleHouseholdRelationshipRemove(req: Request, env: Env) {
  const parsed = HouseholdRelationshipRemoveSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const householdId = parsed.data.household_id;
  const relationshipId = parsed.data.relationship_id;

  const { personId: actorPersonId } = await resolvePerson(env, identity);
  const ok = await canManageHousehold(env, { churchId, userId, role, personId: actorPersonId, householdId });
  if (!ok) return json({ error: "Forbidden" }, { status: 403 });

  await env.churchcore.prepare(`UPDATE person_relationships SET status='inactive', updated_at=?3 WHERE church_id=?1 AND id=?2`).bind(churchId, relationshipId, nowIso()).run();
  await syncHouseholdSnapshotToAdults(env, { churchId, householdId });
  const out = await loadHouseholdFull(env, { churchId, householdId });
  return json({ ok: true, ...out, actor: { userId, role, personId: actorPersonId } });
}

async function handleWeeklyPodcastList(req: Request, env: Env) {
  const parsed = WeeklyPodcastListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const search = (parsed.data.search ?? "").trim().toLowerCase();
  const includeInactive = Boolean(parsed.data.include_inactive);
  const limit = parsed.data.limit ?? 50;
  const offset = parsed.data.offset ?? 0;

  let sql = `SELECT p.id, p.episode_number AS episodeNumber, p.title, p.speaker, p.published_at AS publishedAt, p.passage,
                    p.source_url AS sourceUrl, p.watch_url AS watchUrl, p.listen_url AS listenUrl, p.image_url AS imageUrl,
                    a.updated_at AS analysisUpdatedAt
             FROM weekly_podcasts p
             LEFT JOIN weekly_podcast_analysis a ON a.podcast_id = p.id
             WHERE p.church_id=?1`;
  const binds: any[] = [churchId];
  if (!includeInactive) sql += ` AND p.is_active=1`;
  if (search) {
    sql += ` AND (lower(p.title) LIKE ?${binds.length + 1} OR lower(p.speaker) LIKE ?${binds.length + 1})`;
    binds.push(`%${search}%`);
  }
  sql += ` ORDER BY p.published_at DESC, p.episode_number DESC LIMIT ${limit} OFFSET ${offset}`;

  const rows = (await env.churchcore.prepare(sql).bind(...binds).all()).results ?? [];
  return json({ ok: true, podcasts: rows, actor: { userId, role } });
}

async function handleWeeklyPodcastGet(req: Request, env: Env) {
  const parsed = WeeklyPodcastGetSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const podcastId = parsed.data.podcast_id.trim();

  const podcast = (await env.churchcore
    .prepare(
      `SELECT id, episode_number AS episodeNumber, title, speaker, published_at AS publishedAt, passage,
              source_url AS sourceUrl, watch_url AS watchUrl, listen_url AS listenUrl, image_url AS imageUrl,
              is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
       FROM weekly_podcasts WHERE church_id=?1 AND id=?2`,
    )
    .bind(churchId, podcastId)
    .first()) as any;
  if (!podcast) return json({ ok: true, podcast: null, analysis: null, actor: { userId, role } });

  const analysis = (await env.churchcore
    .prepare(
      `SELECT podcast_id AS podcastId, summary_markdown AS summaryMarkdown, topics_json AS topicsJson, verses_json AS versesJson,
              model, source, created_at AS createdAt, updated_at AS updatedAt
       FROM weekly_podcast_analysis WHERE church_id=?1 AND podcast_id=?2`,
    )
    .bind(churchId, podcastId)
    .first()) as any;
  const topics = analysis?.topicsJson ? JSON.parse(String(analysis.topicsJson)) : null;
  const verses = analysis?.versesJson ? JSON.parse(String(analysis.versesJson)) : null;
  const normalizedAnalysis = analysis
    ? {
        podcastId: analysis.podcastId,
        summaryMarkdown: analysis.summaryMarkdown ?? null,
        topics: Array.isArray(topics) ? topics : [],
        verses: Array.isArray(verses) ? verses : [],
        model: analysis.model ?? null,
        source: analysis.source ?? null,
        createdAt: analysis.createdAt,
        updatedAt: analysis.updatedAt,
      }
    : null;

  return json({ ok: true, podcast, analysis: normalizedAnalysis, actor: { userId, role } });
}

async function handleWeeklyPodcastAnalyze(req: Request, env: Env) {
  const parsed = WeeklyPodcastAnalyzeSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const podcastId = parsed.data.podcast_id.trim();
  const sourceText = typeof (parsed.data as any).source_text === "string" ? String((parsed.data as any).source_text) : "";
  const mp3Url = typeof (parsed.data as any).mp3_url === "string" ? String((parsed.data as any).mp3_url) : "";

  const podcast = (await env.churchcore.prepare(`SELECT id,title FROM weekly_podcasts WHERE church_id=?1 AND id=?2`).bind(churchId, podcastId).first()) as any;
  if (!podcast) return json({ error: "Unknown podcast_id" }, { status: 404 });

  let transcriptText = sourceText.trim();
  let transcriptionMeta: any = null;
  if ((!transcriptText || transcriptText.length < 20) && mp3Url.trim()) {
    const t = await transcribeMp3WithOpenAI(env, { mp3Url: mp3Url.trim() });
    transcriptText = t.text;
    transcriptionMeta = { model: t.model, bytes: t.bytes, mp3_url: mp3Url.trim() };
  }

  // Ask LangGraph agent to extract a structured analysis from pasted transcript/notes.
  const lgThreadId = crypto.randomUUID();
  const envelope = await runAgent(env, {
    threadId: lgThreadId,
    inputPayload: {
      session: { churchId, userId, role, threadId: `weekly_podcast:${podcastId}` },
      skill: "weekly_podcast.analyze",
      args: { podcast_id: podcastId, source_text: transcriptText, mp3_url: mp3Url.trim() || null, transcription: transcriptionMeta },
      input: `Analyze Weekly Podcast episode and return summary/topics/verses.`,
    },
  });

  const analysis = (envelope as any)?.data?.weekly_podcast_analysis ?? (envelope as any)?.data?.analysis ?? null;
  if (!analysis || typeof analysis !== "object") {
    return json({ ok: false, error: "Analysis missing from agent output", envelope, actor: { userId, role } }, { status: 502 });
  }

  const summaryMarkdown = typeof (analysis as any).summary_markdown === "string" ? (analysis as any).summary_markdown : "";
  const topics = Array.isArray((analysis as any).topics) ? (analysis as any).topics.map((t: any) => String(t)) : [];
  const verses = Array.isArray((analysis as any).verses) ? (analysis as any).verses.map((v: any) => String(v)) : [];
  const model = typeof (analysis as any).model === "string" ? String((analysis as any).model) : null;
  const source = typeof (analysis as any).source === "string" ? String((analysis as any).source) : "user_paste";

  if (!summaryMarkdown.trim()) {
    return json({ ok: false, error: "Agent returned empty summary", envelope, actor: { userId, role } }, { status: 502 });
  }

  const now = nowIso();
  await env.churchcore
    .prepare(
      `INSERT INTO weekly_podcast_analysis (podcast_id, church_id, summary_markdown, topics_json, verses_json, model, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(podcast_id) DO UPDATE
         SET summary_markdown=excluded.summary_markdown,
             topics_json=excluded.topics_json,
             verses_json=excluded.verses_json,
             model=excluded.model,
             source=excluded.source,
             updated_at=excluded.updated_at`,
    )
    .bind(podcastId, churchId, summaryMarkdown, JSON.stringify(topics), JSON.stringify(verses), model, source, now, now)
    .run();
  await env.churchcore.prepare(`UPDATE weekly_podcasts SET updated_at=?3 WHERE church_id=?1 AND id=?2`).bind(churchId, podcastId, now).run();

  const out = await env.churchcore
    .prepare(
      `SELECT podcast_id AS podcastId, summary_markdown AS summaryMarkdown, topics_json AS topicsJson, verses_json AS versesJson, model, source, created_at AS createdAt, updated_at AS updatedAt
       FROM weekly_podcast_analysis WHERE church_id=?1 AND podcast_id=?2`,
    )
    .bind(churchId, podcastId)
    .first();
  return json({ ok: true, podcast_id: podcastId, analysis: out, actor: { userId, role } });
}

async function handleSermonList(req: Request, env: Env) {
  const parsed = SermonListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const campusId = (parsed.data.campus_id ?? identity.campus_id ?? "").trim() || null;
  const search = (parsed.data.search ?? "").trim().toLowerCase();
  const limit = parsed.data.limit ?? 50;
  const offset = parsed.data.offset ?? 0;

  let sql = `SELECT m.id, m.campus_id AS campusId, m.title, m.speaker, m.preached_at AS preachedAt, m.passage,
                    m.series_title AS seriesTitle,
                    m.source_url AS sourceUrl, m.watch_url AS watchUrl, m.listen_url AS listenUrl, m.download_url AS downloadUrl,
                    m.guide_discussion_url AS guideDiscussionUrl, m.guide_leader_url AS guideLeaderUrl,
                    a.updated_at AS analysisUpdatedAt,
                    t.updated_at AS transcriptUpdatedAt
             FROM campus_messages m
             LEFT JOIN campus_message_analysis a ON a.message_id = m.id
             LEFT JOIN campus_message_transcripts t ON t.message_id = m.id
             WHERE m.church_id=?1`;
  const binds: any[] = [churchId];

  if (campusId) {
    sql += ` AND m.campus_id=?${binds.length + 1}`;
    binds.push(campusId);
  }
  if (search) {
    sql += ` AND (lower(m.title) LIKE ?${binds.length + 1} OR lower(m.speaker) LIKE ?${binds.length + 1} OR lower(m.passage) LIKE ?${binds.length + 1})`;
    binds.push(`%${search}%`);
  }
  sql += ` ORDER BY m.preached_at DESC, m.updated_at DESC LIMIT ${limit} OFFSET ${offset}`;

  const rows = (await env.churchcore.prepare(sql).bind(...binds).all()).results ?? [];
  return json({ ok: true, sermons: rows, actor: { userId, role } });
}

async function handleSermonGet(req: Request, env: Env) {
  const parsed = SermonGetSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const messageId = parsed.data.message_id.trim();

  const sermon = (await env.churchcore
    .prepare(
      `SELECT id, campus_id AS campusId, title, speaker, preached_at AS preachedAt, passage, series_title AS seriesTitle,
              source_url AS sourceUrl, watch_url AS watchUrl, listen_url AS listenUrl, download_url AS downloadUrl,
              guide_series_slug AS guideSeriesSlug, guide_week_number AS guideWeekNumber,
              guide_discussion_url AS guideDiscussionUrl, guide_leader_url AS guideLeaderUrl,
              created_at AS createdAt, updated_at AS updatedAt
       FROM campus_messages WHERE church_id=?1 AND id=?2`,
    )
    .bind(churchId, messageId)
    .first()) as any;
  if (!sermon) return json({ ok: true, sermon: null, analysis: null, transcript: null, actor: { userId, role } });

  const analysisRow = (await env.churchcore
    .prepare(
      `SELECT message_id AS messageId, summary_markdown AS summaryMarkdown, topics_json AS topicsJson, verses_json AS versesJson, key_points_json AS keyPointsJson,
              model, source, created_at AS createdAt, updated_at AS updatedAt
       FROM campus_message_analysis WHERE church_id=?1 AND message_id=?2`,
    )
    .bind(churchId, messageId)
    .first()) as any;
  const topics = analysisRow?.topicsJson ? JSON.parse(String(analysisRow.topicsJson)) : null;
  const verses = analysisRow?.versesJson ? JSON.parse(String(analysisRow.versesJson)) : null;
  const keyPoints = analysisRow?.keyPointsJson ? JSON.parse(String(analysisRow.keyPointsJson)) : null;
  const analysis = analysisRow
    ? {
        messageId: analysisRow.messageId,
        summaryMarkdown: analysisRow.summaryMarkdown ?? null,
        topics: Array.isArray(topics) ? topics : [],
        verses: Array.isArray(verses) ? verses : [],
        keyPoints: Array.isArray(keyPoints) ? keyPoints : [],
        model: analysisRow.model ?? null,
        source: analysisRow.source ?? null,
        createdAt: analysisRow.createdAt,
        updatedAt: analysisRow.updatedAt,
      }
    : null;

  const transcriptRow = (await env.churchcore
    .prepare(
      `SELECT message_id AS messageId, source_url AS sourceUrl, model, created_at AS createdAt, updated_at AS updatedAt,
              length(transcript_text) AS charCount
       FROM campus_message_transcripts WHERE church_id=?1 AND message_id=?2`,
    )
    .bind(churchId, messageId)
    .first()) as any;
  const transcript = transcriptRow
    ? {
        messageId: transcriptRow.messageId,
        sourceUrl: transcriptRow.sourceUrl ?? null,
        model: transcriptRow.model ?? null,
        charCount: typeof transcriptRow.charCount === "number" ? transcriptRow.charCount : Number(transcriptRow.charCount ?? 0),
        createdAt: transcriptRow.createdAt,
        updatedAt: transcriptRow.updatedAt,
      }
    : null;

  return json({ ok: true, sermon, analysis, transcript, actor: { userId, role } });
}

async function handleSermonCompare(req: Request, env: Env) {
  const parsed = SermonCompareSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const defaultCampuses = ["campus_boulder", "campus_erie", "campus_thornton"];
  const campusesIn = Array.isArray(parsed.data.campuses) && parsed.data.campuses.length ? parsed.data.campuses.map((c) => String(c)).filter(Boolean) : defaultCampuses;
  const campuses = [...new Set(campusesIn)].slice(0, 6);
  const explicitIds = Array.isArray(parsed.data.message_ids) && parsed.data.message_ids.length ? parsed.data.message_ids.map((s) => String(s).trim()).filter(Boolean) : null;
  const anchorMessageId = typeof (parsed.data as any).anchor_message_id === "string" ? String((parsed.data as any).anchor_message_id).trim() : "";

  const messageIds: Array<{ campusId: string | null; messageId: string }> = [];
  let match: { preachedDate: string; titleKey: string; titleDisplay: string; campusCount: number } | null = null;
  if (explicitIds && explicitIds.length) {
    for (const mid of explicitIds.slice(0, 6)) messageIds.push({ campusId: null, messageId: mid });
  } else {
    const placeholders = campuses.map((_, i) => `?${i + 2}`).join(",");
    let preachedDate: string | null = null;
    let titleKey: string | null = null;

    if (anchorMessageId) {
      const anchor = (await env.churchcore
        .prepare(`SELECT date(preached_at) AS preachedDate, lower(trim(title)) AS titleKey FROM campus_messages WHERE church_id=?1 AND id=?2`)
        .bind(churchId, anchorMessageId)
        .first()) as any;
      preachedDate = typeof anchor?.preachedDate === "string" ? anchor.preachedDate : null;
      titleKey = typeof anchor?.titleKey === "string" ? anchor.titleKey : null;
      if (!preachedDate || !titleKey) {
        return json({ ok: false, error: "anchor_message_id missing preached_at/title", anchor_message_id: anchorMessageId, actor: { userId, role } }, { status: 409 });
      }
    } else {
      // Fallback: most recent shared (date+title) across campuses.
      const groupRow = (await env.churchcore
        .prepare(
          `SELECT date(preached_at) AS preachedDate,
                  lower(trim(title)) AS titleKey,
                  max(preached_at) AS latestPreachedAt,
                  count(DISTINCT campus_id) AS campusCount
           FROM campus_messages
           WHERE church_id=?1
             AND campus_id IN (${placeholders})
             AND preached_at IS NOT NULL
             AND title IS NOT NULL
             AND length(trim(title)) > 0
           GROUP BY preachedDate, titleKey
           HAVING campusCount >= 2
           ORDER BY latestPreachedAt DESC
           LIMIT 1`,
        )
        .bind(churchId, ...campuses)
        .first()) as any;

      preachedDate = typeof groupRow?.preachedDate === "string" ? groupRow.preachedDate : null;
      titleKey = typeof groupRow?.titleKey === "string" ? groupRow.titleKey : null;
      const campusCount = Number(groupRow?.campusCount ?? 0);
      if (!preachedDate || !titleKey || campusCount < 2) {
        return json({ ok: false, error: "No shared (date + title) found to compare.", campuses, actor: { userId, role } }, { status: 409 });
      }
    }

    const rows =
      (
        await env.churchcore
          .prepare(
            `SELECT id, campus_id AS campusId, title
             FROM campus_messages
             WHERE church_id=?1
               AND campus_id IN (${placeholders})
               AND date(preached_at)=?${campuses.length + 2}
               AND lower(trim(title))=?${campuses.length + 3}
             ORDER BY preached_at DESC, updated_at DESC
             LIMIT 20`,
          )
          .bind(churchId, ...campuses, preachedDate, titleKey)
          .all()
      ).results ?? [];

    const picked = new Map<string, { id: string; title: string }>();
    for (const r of rows as any[]) {
      const c = String(r?.campusId ?? "").trim();
      const id = String(r?.id ?? "").trim();
      const title = String(r?.title ?? "").trim();
      if (!c || !id) continue;
      if (!picked.has(c)) picked.set(c, { id, title });
    }
    for (const campusId of campuses) {
      const p = picked.get(campusId);
      if (p?.id) messageIds.push({ campusId, messageId: p.id });
    }
    const titleDisplay = [...picked.values()][0]?.title ?? "";
    match = { preachedDate, titleKey, titleDisplay, campusCount: messageIds.length };
  }

  if (messageIds.length < 2) {
    return json({ ok: false, error: "Not enough sermons to compare", messageIds, actor: { userId, role } }, { status: 400 });
  }

  const sermons: any[] = [];
  for (const m of messageIds) {
    const msgId = m.messageId;
    const sermon = (await env.churchcore
      .prepare(
        `SELECT id, campus_id AS campusId, title, speaker, preached_at AS preachedAt, passage, series_title AS seriesTitle,
                source_url AS sourceUrl, watch_url AS watchUrl, listen_url AS listenUrl, download_url AS downloadUrl
         FROM campus_messages WHERE church_id=?1 AND id=?2`,
      )
      .bind(churchId, msgId)
      .first()) as any;
    if (!sermon) continue;

    const a = (await env.churchcore
      .prepare(
        `SELECT summary_markdown AS summaryMarkdown, topics_json AS topicsJson, verses_json AS versesJson, key_points_json AS keyPointsJson,
                model AS analysisModel, source AS analysisSource, updated_at AS analysisUpdatedAt
         FROM campus_message_analysis WHERE church_id=?1 AND message_id=?2`,
      )
      .bind(churchId, msgId)
      .first()) as any;
    const topics = a?.topicsJson ? JSON.parse(String(a.topicsJson)) : null;
    const verses = a?.versesJson ? JSON.parse(String(a.versesJson)) : null;
    const keyPoints = a?.keyPointsJson ? JSON.parse(String(a.keyPointsJson)) : null;

    const t = (await env.churchcore
      .prepare(
        `SELECT transcript_text AS transcriptText, source_url AS transcriptSourceUrl, model AS transcriptModel, updated_at AS transcriptUpdatedAt
         FROM campus_message_transcripts WHERE church_id=?1 AND message_id=?2`,
      )
      .bind(churchId, msgId)
      .first()) as any;

    sermons.push({
      id: String(sermon.id),
      campusId: sermon.campusId ?? m.campusId ?? null,
      title: sermon.title ?? null,
      speaker: sermon.speaker ?? null,
      preachedAt: sermon.preachedAt ?? null,
      passage: sermon.passage ?? null,
      seriesTitle: sermon.seriesTitle ?? null,
      sourceUrl: sermon.sourceUrl ?? null,
      watchUrl: sermon.watchUrl ?? null,
      listenUrl: sermon.listenUrl ?? null,
      downloadUrl: sermon.downloadUrl ?? null,
      analysis: a
        ? {
            summaryMarkdown: a.summaryMarkdown ?? null,
            topics: Array.isArray(topics) ? topics : [],
            verses: Array.isArray(verses) ? verses : [],
            keyPoints: Array.isArray(keyPoints) ? keyPoints : [],
            model: a.analysisModel ?? null,
            source: a.analysisSource ?? null,
            updatedAt: a.analysisUpdatedAt ?? null,
          }
        : null,
      transcript: t
        ? {
            transcriptText: typeof t.transcriptText === "string" ? t.transcriptText : "",
            sourceUrl: t.transcriptSourceUrl ?? null,
            model: t.transcriptModel ?? null,
            updatedAt: t.transcriptUpdatedAt ?? null,
          }
        : null,
    });
  }

  if (sermons.length < 2) return json({ ok: false, error: "No sermons found to compare", actor: { userId, role } }, { status: 404 });

  // Enforce same date + title across compared sermons.
  const baseDate = sermons[0]?.preachedAt ? String(sermons[0].preachedAt).slice(0, 10) : "";
  const baseTitleKey = sermons[0]?.title ? String(sermons[0].title).trim().toLowerCase() : "";
  const mismatch = sermons.find((s) => (s?.preachedAt ? String(s.preachedAt).slice(0, 10) : "") !== baseDate || (s?.title ? String(s.title).trim().toLowerCase() : "") !== baseTitleKey);
  if (mismatch) {
    return json(
      {
        ok: false,
        error: "Sermons must match on preached date + title to compare.",
        expected: { preachedDate: baseDate, title: String(sermons[0]?.title ?? "") },
        got: sermons.map((s) => ({ id: s?.id, campusId: s?.campusId ?? null, preachedDate: String(s?.preachedAt ?? "").slice(0, 10), title: s?.title ?? null })),
        actor: { userId, role },
      },
      { status: 409 },
    );
  }

  const lgThreadId = crypto.randomUUID();
  const envelope = await runAgent(env, {
    threadId: lgThreadId,
    inputPayload: {
      session: { churchId, userId, role, threadId: `weekly_sermons_compare:${lgThreadId}` },
      skill: "sermon.compare",
      args: { sermons },
      input: "Compare weekly sermons across campuses and summarize similarities and differences.",
    },
  });

  const comparison = (envelope as any)?.data?.sermon_comparison ?? (envelope as any)?.data?.comparison ?? null;
  const effectiveMatch = match ?? { preachedDate: baseDate, titleKey: baseTitleKey, titleDisplay: String(sermons[0]?.title ?? ""), campusCount: sermons.length };
  return json({ ok: true, sermons, comparison, match: effectiveMatch, actor: { userId, role } });
}

async function resolveEffectiveCampusIdFromMemory(env: Env, identity: any, fallbackCampusId: string | null) {
  const churchId = String(identity?.tenant_id ?? "").trim();
  const { personId } = await resolvePerson(env, identity);
  if (!personId) return { campusId: fallbackCampusId, personId: null };
  const mem = await getPersonMemory(env, { churchId, personId });
  const memCampusRaw = (mem as any)?.memory?.identity?.campusId;
  const memCampus = typeof memCampusRaw === "string" && memCampusRaw.trim() ? memCampusRaw.trim() : null;
  return { campusId: memCampus ?? fallbackCampusId, personId };
}

async function getWeeklySermonPlanContext(env: Env, args: { churchId: string; campusId: string; personId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const weekRow = (await env.churchcore
      .prepare(
        `SELECT id, campus_id AS campusId, anchor_message_id AS anchorMessageId, preached_date AS preachedDate, week_start_date AS weekStartDate, week_end_date AS weekEndDate,
                title, passage, created_at AS createdAt, updated_at AS updatedAt
         FROM bible_reading_weeks
         WHERE church_id=?1 AND campus_id=?2 AND week_start_date<=?3 AND week_end_date>=?3
         ORDER BY week_start_date DESC
         LIMIT 1`,
      )
      .bind(args.churchId, args.campusId, today)
      .first()) as any;
    if (!weekRow?.id) return null;

    const weekId = String(weekRow.id);
    const items = (
      (await env.churchcore
        .prepare(
          `SELECT id, day_date AS dayDate, kind, ref, label, notes_markdown AS notesMarkdown
           FROM bible_reading_items
           WHERE church_id=?1 AND week_id=?2
           ORDER BY day_date ASC, kind ASC`,
        )
        .bind(args.churchId, weekId)
        .all()).results ?? []
    ) as any[];

    const progress = (
      (await env.churchcore
        .prepare(
          `SELECT item_id AS itemId, status, completed_at AS completedAt
           FROM bible_reading_progress
           WHERE church_id=?1 AND person_id=?2 AND item_id IN (SELECT id FROM bible_reading_items WHERE church_id=?1 AND week_id=?3)`,
        )
        .bind(args.churchId, args.personId, weekId)
        .all()).results ?? []
    ) as any[];

    const completed = new Set<string>();
    for (const p of progress) if (p?.itemId && String(p?.status ?? "").toLowerCase() === "completed") completed.add(String(p.itemId));
    const todayItems = items.filter((it) => String(it?.dayDate ?? "") === today).slice(0, 3);
    const sermon =
      weekRow?.anchorMessageId
        ? ((await env.churchcore
            .prepare(
              `SELECT id, campus_id AS campusId, title, speaker, preached_at AS preachedAt, passage, series_title AS seriesTitle,
                      source_url AS sourceUrl, watch_url AS watchUrl, listen_url AS listenUrl, download_url AS downloadUrl,
                      guide_discussion_url AS guideDiscussionUrl, guide_leader_url AS guideLeaderUrl
               FROM campus_messages
               WHERE church_id=?1 AND id=?2
               LIMIT 1`,
            )
            .bind(args.churchId, String(weekRow.anchorMessageId))
            .first()) as any)
        : null;

    return {
      campusId: args.campusId,
      today,
      sermon: sermon ?? {
        id: weekRow.anchorMessageId ?? null,
        campusId: weekRow.campusId ?? args.campusId,
        preachedAt: weekRow.preachedDate ?? null,
        title: weekRow.title ?? null,
        passage: weekRow.passage ?? null,
      },
      plan: {
        week: weekRow,
        today_items: todayItems.map((it) => ({ ...it, completed: completed.has(String(it?.id ?? "")) })),
        counts: { total: items.length, completed: completed.size },
      },
    };
  } catch {
    // Best-effort: if the schema isn't deployed yet, don't break chat.
    return null;
  }
}

async function handleBiblePlanWeekGet(req: Request, env: Env) {
  const parsed = BiblePlanWeekGetSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const fallbackCampusId = (parsed.data.campus_id ?? identity.campus_id ?? "").trim() || null;
  const { campusId, personId } = await resolveEffectiveCampusIdFromMemory(env, identity, fallbackCampusId);
  if (!campusId) return json({ ok: false, error: "Missing campusId" }, { status: 400 });
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const weekStartOverride = typeof parsed.data.week_start_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.data.week_start_date.trim()) ? parsed.data.week_start_date.trim() : null;
  const today = new Date().toISOString().slice(0, 10);

  const weekRow = (await env.churchcore
    .prepare(
      `SELECT id, campus_id AS campusId, anchor_message_id AS anchorMessageId, preached_date AS preachedDate, week_start_date AS weekStartDate, week_end_date AS weekEndDate,
              title, passage, created_at AS createdAt, updated_at AS updatedAt
       FROM bible_reading_weeks
       WHERE church_id=?1 AND campus_id=?2
         AND (?3 IS NULL OR week_start_date=?3)
         AND (?3 IS NOT NULL OR (week_start_date<=?4 AND week_end_date>=?4))
       ORDER BY week_start_date DESC
       LIMIT 1`,
    )
    .bind(churchId, campusId, weekStartOverride, today)
    .first()) as any;

  if (!weekRow?.id) return json({ ok: true, week: null, items: [], progress: [], checkins: [], actor: { userId, role } });
  const weekId = String(weekRow.id);

  const items = (
    (await env.churchcore
      .prepare(
        `SELECT id, day_date AS dayDate, kind, ref, label, notes_markdown AS notesMarkdown, created_at AS createdAt, updated_at AS updatedAt
         FROM bible_reading_items
         WHERE church_id=?1 AND week_id=?2
         ORDER BY day_date ASC, kind ASC`,
      )
      .bind(churchId, weekId)
      .all()).results ?? []
  ) as any[];

  const progress = (
    (await env.churchcore
      .prepare(
        `SELECT item_id AS itemId, status, completed_at AS completedAt, notes_markdown AS notesMarkdown, updated_at AS updatedAt
         FROM bible_reading_progress
         WHERE church_id=?1 AND person_id=?2 AND item_id IN (SELECT id FROM bible_reading_items WHERE church_id=?1 AND week_id=?3)`,
      )
      .bind(churchId, personId, weekId)
      .all()).results ?? []
  ) as any[];

  const checkins = (
    (await env.churchcore
      .prepare(
        `SELECT id, day_date AS dayDate, guide_user_id AS guideUserId, message, created_at AS createdAt
         FROM bible_reading_checkins
         WHERE church_id=?1 AND week_id=?2 AND person_id=?3
         ORDER BY created_at ASC`,
      )
      .bind(churchId, weekId, personId)
      .all()).results ?? []
  ) as any[];

  return json({ ok: true, week: weekRow, items, progress, checkins, actor: { userId, role, personId, campusId } });
}

async function handleBiblePlanItemComplete(req: Request, env: Env) {
  const parsed = BiblePlanItemCompleteSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const itemId = parsed.data.item_id.trim();

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const exists = (await env.churchcore.prepare(`SELECT 1 FROM bible_reading_items WHERE church_id=?1 AND id=?2`).bind(churchId, itemId).first()) as any;
  if (!exists) return json({ ok: false, error: "Unknown item_id" }, { status: 404 });

  const now = nowIso();
  await env.churchcore
    .prepare(
      `INSERT INTO bible_reading_progress (church_id, person_id, item_id, status, completed_at, notes_markdown, updated_at)
       VALUES (?1, ?2, ?3, 'completed', ?4, NULL, ?5)
       ON CONFLICT(church_id, person_id, item_id) DO UPDATE SET
         status='completed',
         completed_at=excluded.completed_at,
         updated_at=excluded.updated_at`,
    )
    .bind(churchId, personId, itemId, now, now)
    .run();

  return json({ ok: true, item_id: itemId, status: "completed", completed_at: now, actor: { userId, role, personId } });
}

async function handleBiblePlanCheckinCreate(req: Request, env: Env) {
  const parsed = BiblePlanCheckinCreateSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const roles = await getUserRoles(env, { churchId, userId });
  const isGuide = String(role).toLowerCase() === "guide" || roles.has("staff");
  if (!isGuide) return json({ ok: false, error: "Forbidden" }, { status: 403 });

  const weekId = parsed.data.week_id.trim();
  const personId = parsed.data.person_id.trim();
  const dayDate = typeof parsed.data.day_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.data.day_date.trim()) ? parsed.data.day_date.trim() : null;
  const message = parsed.data.message.trim();

  const weekExists = (await env.churchcore.prepare(`SELECT 1 FROM bible_reading_weeks WHERE church_id=?1 AND id=?2`).bind(churchId, weekId).first()) as any;
  if (!weekExists) return json({ ok: false, error: "Unknown week_id" }, { status: 404 });

  const id = crypto.randomUUID();
  const now = nowIso();
  await env.churchcore
    .prepare(
      `INSERT INTO bible_reading_checkins (id, church_id, week_id, person_id, guide_user_id, day_date, message, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(id, churchId, weekId, personId, userId, dayDate, message, now)
    .run();

  return json({ ok: true, id, week_id: weekId, person_id: personId, day_date: dayDate, message, created_at: now, actor: { userId, role } });
}

async function handleCommunityCatalogList(req: Request, env: Env) {
  const parsed = CommunityCatalogListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const campusId = (parsed.data.campus_id ?? identity.campus_id ?? "").trim() || null;
  const kind = (parsed.data.kind ?? "").trim() || null;
  const search = (parsed.data.search ?? "").trim() || null;
  const includeInactive = Boolean(parsed.data.include_inactive);
  const limit = parsed.data.limit ?? 100;
  const offset = parsed.data.offset ?? 0;

  let sql = `SELECT id,campus_id AS campusId,kind,title,description,source_url AS sourceUrl,signup_url AS signupUrl,start_at AS startAt,end_at AS endAt,tags_json AS tagsJson,is_active AS isActive,created_at AS createdAt,updated_at AS updatedAt
             FROM community_catalog
             WHERE church_id=?1`;
  const binds: any[] = [churchId];

  if (campusId) {
    sql += ` AND (campus_id=?${binds.length + 1} OR campus_id IS NULL)`;
    binds.push(campusId);
  }
  if (kind) {
    sql += ` AND kind=?${binds.length + 1}`;
    binds.push(kind);
  }
  if (!includeInactive) sql += ` AND is_active=1`;
  if (search) {
    sql += ` AND (lower(title) LIKE ?${binds.length + 1} OR lower(description) LIKE ?${binds.length + 1})`;
    binds.push(`%${search.toLowerCase()}%`);
  }
  sql += ` ORDER BY kind ASC, title ASC LIMIT ${limit} OFFSET ${offset}`;

  const rows = (await env.churchcore.prepare(sql).bind(...binds).all()).results ?? [];
  return json({ ok: true, items: rows, actor: { userId, role } });
}

async function handleCommunityMyList(req: Request, env: Env) {
  const parsed = CommunityMyListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const includeInactive = Boolean(parsed.data.include_inactive);
  const limit = parsed.data.limit ?? 100;
  const offset = parsed.data.offset ?? 0;

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: true, person_id: null, items: [], actor: { userId, role } });

  let sql = `SELECT pc.community_id AS communityId, pc.status, pc.role, pc.joined_at AS joinedAt, pc.left_at AS leftAt, pc.notes_json AS notesJson, pc.updated_at AS updatedAt,
                    cc.campus_id AS campusId, cc.kind, cc.title, cc.description, cc.source_url AS sourceUrl, cc.signup_url AS signupUrl, cc.start_at AS startAt, cc.end_at AS endAt, cc.tags_json AS tagsJson, cc.is_active AS isActive
             FROM person_community pc
             JOIN community_catalog cc ON cc.id = pc.community_id
             WHERE pc.church_id=?1 AND pc.person_id=?2`;
  const binds: any[] = [churchId, personId];
  if (!includeInactive) sql += ` AND pc.status!='inactive'`;
  sql += ` ORDER BY pc.updated_at DESC LIMIT ${limit} OFFSET ${offset}`;

  const rows = (await env.churchcore.prepare(sql).bind(...binds).all()).results ?? [];
  return json({ ok: true, person_id: personId, items: rows, actor: { userId, role } });
}

async function handleCommunityJoin(req: Request, env: Env) {
  const parsed = CommunityJoinSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const communityId = parsed.data.community_id.trim();
  const status = (parsed.data.status ?? "active").trim() as "pending" | "active";

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const exists = (await env.churchcore.prepare(`SELECT 1 FROM community_catalog WHERE church_id=?1 AND id=?2 LIMIT 1`).bind(churchId, communityId).first()) as any;
  if (!exists) return json({ ok: false, error: "Unknown community_id" }, { status: 404 });

  const now = nowIso();
  const existing = (await env.churchcore
    .prepare(`SELECT joined_at AS joinedAt FROM person_community WHERE church_id=?1 AND person_id=?2 AND community_id=?3`)
    .bind(churchId, personId, communityId)
    .first()) as any;
  const joinedAt = typeof existing?.joinedAt === "string" ? existing.joinedAt : now;

  await env.churchcore
    .prepare(
      `INSERT INTO person_community (church_id, person_id, community_id, status, role, joined_at, left_at, notes_json, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'participant', ?5, NULL, NULL, ?6)
       ON CONFLICT(church_id, person_id, community_id) DO UPDATE SET
         status=excluded.status,
         role=excluded.role,
         joined_at=excluded.joined_at,
         left_at=NULL,
         updated_at=excluded.updated_at`,
    )
    .bind(churchId, personId, communityId, status, joinedAt, now)
    .run();

  await syncPersonGroupsAndCommunityToMemory(env, { churchId, personId, actorUserId: userId, actorRole: role, threadId: (identity.thread_id ?? "").trim() || "thread_unknown" });
  return json({ ok: true, person_id: personId, community_id: communityId, status, actor: { userId, role } });
}

async function handleCommunityLeave(req: Request, env: Env) {
  const parsed = CommunityLeaveSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const communityId = parsed.data.community_id.trim();

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const now = nowIso();
  await env.churchcore
    .prepare(
      `INSERT INTO person_community (church_id, person_id, community_id, status, role, joined_at, left_at, notes_json, updated_at)
       VALUES (?1, ?2, ?3, 'inactive', 'participant', NULL, ?4, NULL, ?5)
       ON CONFLICT(church_id, person_id, community_id) DO UPDATE SET
         status='inactive',
         left_at=?4,
         updated_at=?5`,
    )
    .bind(churchId, personId, communityId, now, now)
    .run();

  await syncPersonGroupsAndCommunityToMemory(env, { churchId, personId, actorUserId: userId, actorRole: role, threadId: (identity.thread_id ?? "").trim() || "thread_unknown" });
  return json({ ok: true, person_id: personId, community_id: communityId, status: "inactive", actor: { userId, role } });
}

async function handleCommunityMark(req: Request, env: Env) {
  const parsed = CommunityMarkSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const communityId = parsed.data.community_id.trim();
  const status = parsed.data.status;

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const now = nowIso();
  await env.churchcore
    .prepare(
      `INSERT INTO person_community (church_id, person_id, community_id, status, role, joined_at, left_at, notes_json, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'participant', ?5, NULL, NULL, ?6)
       ON CONFLICT(church_id, person_id, community_id) DO UPDATE SET
         status=excluded.status,
         updated_at=excluded.updated_at`,
    )
    .bind(churchId, personId, communityId, status, now, now)
    .run();

  await syncPersonGroupsAndCommunityToMemory(env, { churchId, personId, actorUserId: userId, actorRole: role, threadId: (identity.thread_id ?? "").trim() || "thread_unknown" });
  return json({ ok: true, person_id: personId, community_id: communityId, status, actor: { userId, role } });
}

async function groupActorRole(env: Env, args: { churchId: string; groupId: string; actorPersonId: string }) {
  const row = (await env.churchcore
    .prepare(`SELECT role,status FROM group_memberships WHERE church_id=?1 AND group_id=?2 AND person_id=?3`)
    .bind(args.churchId, args.groupId, args.actorPersonId)
    .first()) as any;
  const status = String(row?.status ?? "");
  const role = String(row?.role ?? "member").toLowerCase();
  return { status, role: role === "leader" || role === "host" ? role : "member" };
}

async function canManageGroupMembers(env: Env, args: { churchId: string; userId: string; identityRole: string; groupId: string; personId: string }) {
  const roles = await getUserRoles(env, { churchId: args.churchId, userId: args.userId });
  const isStaff = String(args.identityRole || "").toLowerCase() === "guide" || roles.has("staff");
  if (isStaff) return true;
  const actor = await groupActorRole(env, { churchId: args.churchId, groupId: args.groupId, actorPersonId: args.personId });
  return actor.status === "active" && (actor.role === "leader" || actor.role === "host");
}

async function handleGroupMyList(req: Request, env: Env) {
  const parsed = GroupMyListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const includeInactive = Boolean(parsed.data.include_inactive);
  const limit = parsed.data.limit ?? 100;
  const offset = parsed.data.offset ?? 0;

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: true, person_id: null, groups: [], actor: { userId, role } });

  const statusClause = includeInactive ? "" : "AND gm.status IN ('active','pending')";
  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT g.id,
                  g.campus_id AS campusId,
                  g.name,
                  g.description,
                  g.leader_person_id AS leaderPersonId,
                  g.meeting_details AS meetingDetails,
                  g.meeting_frequency AS meetingFrequency,
                  g.meeting_day_of_week AS meetingDayOfWeek,
                  g.meeting_time_local AS meetingTimeLocal,
                  g.meeting_timezone AS meetingTimezone,
                  g.meeting_location_name AS meetingLocationName,
                  g.meeting_location_address AS meetingLocationAddress,
                  g.is_open AS isOpen,
                  gm.role AS myRole, gm.status AS myStatus, gm.joined_at AS joinedAt
           FROM group_memberships gm
           JOIN groups g ON g.id=gm.group_id
           WHERE gm.church_id=?1 AND gm.person_id=?2 ${statusClause}
           ORDER BY g.name ASC
           LIMIT ${limit} OFFSET ${offset}`,
        )
        .bind(churchId, personId)
        .all()
    ).results ?? [];
  return json({ ok: true, person_id: personId, groups: rows, actor: { userId, role } });
}

async function handleGroupGet(req: Request, env: Env) {
  const parsed = GroupGetSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const groupId = parsed.data.group_id.trim();

  const group = (await env.churchcore
    .prepare(
      `SELECT id,
              campus_id AS campusId,
              name,
              description,
              leader_person_id AS leaderPersonId,
              meeting_details AS meetingDetails,
              meeting_frequency AS meetingFrequency,
              meeting_day_of_week AS meetingDayOfWeek,
              meeting_time_local AS meetingTimeLocal,
              meeting_timezone AS meetingTimezone,
              meeting_location_name AS meetingLocationName,
              meeting_location_address AS meetingLocationAddress,
              is_open AS isOpen,
              created_at AS createdAt,
              updated_at AS updatedAt
       FROM groups WHERE church_id=?1 AND id=?2`,
    )
    .bind(churchId, groupId)
    .first()) as any;
  if (!group) return json({ ok: false, error: "Group not found", actor: { userId, role } }, { status: 404 });

  const counts = (await env.churchcore
    .prepare(
      `SELECT status, COUNT(*) AS c
       FROM group_memberships
       WHERE church_id=?1 AND group_id=?2
       GROUP BY status`,
    )
    .bind(churchId, groupId)
    .all()) as any;
  const membershipCounts: Record<string, number> = {};
  for (const r of ((counts?.results ?? []) as any[]).filter(Boolean)) membershipCounts[String(r.status)] = Number(r.c ?? 0);

  return json({ ok: true, group, membershipCounts, actor: { userId, role } });
}

async function handleGroupUpdate(req: Request, env: Env) {
  const parsed = GroupUpdateSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const groupId = parsed.data.group_id.trim();

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });
  const ok = await canManageGroupMembers(env, { churchId, userId, identityRole: role, groupId, personId });
  if (!ok) return json({ ok: false, error: "Forbidden" }, { status: 403 });

  const now = nowIso();
  await env.churchcore
    .prepare(
      `UPDATE groups
       SET campus_id=COALESCE(?3, campus_id),
           name=COALESCE(?4, name),
           description=COALESCE(?5, description),
           meeting_details=COALESCE(?6, meeting_details),
           meeting_frequency=COALESCE(?7, meeting_frequency),
           meeting_day_of_week=COALESCE(?8, meeting_day_of_week),
           meeting_time_local=COALESCE(?9, meeting_time_local),
           meeting_timezone=COALESCE(?10, meeting_timezone),
           meeting_location_name=COALESCE(?11, meeting_location_name),
           meeting_location_address=COALESCE(?12, meeting_location_address),
           is_open=COALESCE(?13, is_open),
           updated_at=?14
       WHERE church_id=?1 AND id=?2`,
    )
    .bind(
      churchId,
      groupId,
      parsed.data.campus_id ?? null,
      parsed.data.name ?? null,
      parsed.data.description ?? null,
      parsed.data.meeting_details ?? null,
      parsed.data.meeting_frequency ?? null,
      parsed.data.meeting_day_of_week ?? null,
      parsed.data.meeting_time_local ?? null,
      parsed.data.meeting_timezone ?? null,
      parsed.data.meeting_location_name ?? null,
      parsed.data.meeting_location_address ?? null,
      parsed.data.is_open == null ? null : parsed.data.is_open ? 1 : 0,
      now,
    )
    .run();

  return json({ ok: true, group_id: groupId, actor: { userId, role, personId } });
}

async function handleGroupMembersList(req: Request, env: Env) {
  const parsed = GroupMembersListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const groupId = parsed.data.group_id.trim();
  const includeInactive = Boolean(parsed.data.include_inactive);

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });
  const actor = await groupActorRole(env, { churchId, groupId, actorPersonId: personId });
  if (actor.status !== "active") return json({ ok: false, error: "Not permitted" }, { status: 403 });

  const statusClause = includeInactive ? "" : "AND gm.status='active'";
  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT gm.person_id AS personId, gm.role, gm.status, gm.joined_at AS joinedAt,
                  p.first_name AS firstName, p.last_name AS lastName, p.email, p.phone
           FROM group_memberships gm
           JOIN people p ON p.id=gm.person_id
           WHERE gm.church_id=?1 AND gm.group_id=?2 ${statusClause}
           ORDER BY gm.role DESC, p.last_name ASC, p.first_name ASC`,
        )
        .bind(churchId, groupId)
        .all()
    ).results ?? [];

  return json({ ok: true, members: rows, actor: { userId, role, personId } });
}

async function handleGroupInviteCreate(req: Request, env: Env) {
  const parsed = GroupInviteCreateSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const groupId = parsed.data.group_id.trim();
  const inviteePersonId = parsed.data.invitee_person_id.trim();

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });
  if (inviteePersonId === personId) return json({ ok: false, error: "Cannot invite self" }, { status: 400 });
  const actor = await groupActorRole(env, { churchId, groupId, actorPersonId: personId });
  if (actor.status !== "active") return json({ ok: false, error: "Not a group member" }, { status: 403 });

  const existing = (await env.churchcore
    .prepare(`SELECT status FROM group_memberships WHERE church_id=?1 AND group_id=?2 AND person_id=?3`)
    .bind(churchId, groupId, inviteePersonId)
    .first()) as any;
  if (existing && String(existing.status) !== "inactive") return json({ ok: true, invite: null, note: "Already a member", actor: { userId, role, personId } });

  const now = nowIso();
  const expiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
  const id = crypto.randomUUID();
  await env.churchcore
    .prepare(
      `INSERT INTO group_invites (id, church_id, group_id, invited_by_person_id, invitee_person_id, status, expires_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8)
       ON CONFLICT(church_id, group_id, invitee_person_id) DO UPDATE
         SET invited_by_person_id=excluded.invited_by_person_id,
             status='pending',
             expires_at=excluded.expires_at,
             updated_at=excluded.updated_at`,
    )
    .bind(id, churchId, groupId, personId, inviteePersonId, expiresAt, now, now)
    .run();

  const invite = (await env.churchcore
    .prepare(
      `SELECT id,group_id AS groupId,invited_by_person_id AS invitedByPersonId,invitee_person_id AS inviteePersonId,status,expires_at AS expiresAt,created_at AS createdAt,updated_at AS updatedAt
       FROM group_invites WHERE church_id=?1 AND group_id=?2 AND invitee_person_id=?3`,
    )
    .bind(churchId, groupId, inviteePersonId)
    .first()) as any;

  return json({ ok: true, invite, actor: { userId, role, personId } });
}

async function handleGroupInviteRespond(req: Request, env: Env) {
  const parsed = GroupInviteRespondSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const inviteId = parsed.data.invite_id.trim();
  const action = parsed.data.action;

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const invite = (await env.churchcore
    .prepare(
      `SELECT id,group_id AS groupId,invitee_person_id AS inviteePersonId,status,expires_at AS expiresAt
       FROM group_invites WHERE church_id=?1 AND id=?2`,
    )
    .bind(churchId, inviteId)
    .first()) as any;
  if (!invite) return json({ ok: false, error: "Invite not found" }, { status: 404 });
  if (String(invite.inviteePersonId) !== personId) return json({ ok: false, error: "Not permitted" }, { status: 403 });
  if (String(invite.status) !== "pending") return json({ ok: false, error: "Invite is not pending" }, { status: 400 });

  const now = nowIso();
  const exp = typeof invite.expiresAt === "string" ? String(invite.expiresAt) : "";
  if (exp && Date.parse(exp) && Date.parse(now) > Date.parse(exp)) {
    await env.churchcore.prepare(`UPDATE group_invites SET status='expired', updated_at=?3 WHERE church_id=?1 AND id=?2`).bind(churchId, inviteId, now).run();
    return json({ ok: false, error: "Invite expired" }, { status: 400 });
  }
  const nextStatus = action === "accept" ? "accepted" : "declined";
  await env.churchcore.prepare(`UPDATE group_invites SET status=?4, updated_at=?3 WHERE church_id=?1 AND id=?2`).bind(churchId, inviteId, now, nextStatus).run();
  if (action === "accept") {
    await env.churchcore
      .prepare(
        `INSERT INTO group_memberships (church_id, group_id, person_id, role, status, joined_at)
         VALUES (?1, ?2, ?3, 'member', 'active', ?4)
         ON CONFLICT(group_id, person_id) DO UPDATE
           SET status='active',
               role=excluded.role,
               joined_at=COALESCE(group_memberships.joined_at, excluded.joined_at)`,
      )
      .bind(churchId, String(invite.groupId), personId, now)
      .run();
  }

  if (action === "accept") {
    await syncPersonGroupsAndCommunityToMemory(env, { churchId, personId, actorUserId: userId, actorRole: role, threadId: (identity.thread_id ?? "").trim() || "thread_unknown" });
  }
  return json({ ok: true, status: nextStatus, group_id: String(invite.groupId), actor: { userId, role, personId } });
}

async function handleGroupInvitesSentList(req: Request, env: Env) {
  const parsed = GroupInvitesSentListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const groupId = parsed.data.group_id.trim();

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });
  const actor = await groupActorRole(env, { churchId, groupId, actorPersonId: personId });
  if (actor.status !== "active") return json({ ok: false, error: "Not permitted" }, { status: 403 });

  const status = (parsed.data.status ?? "pending") as string;
  const limit = parsed.data.limit ?? 50;
  const offset = parsed.data.offset ?? 0;

  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT i.id,
                  i.group_id AS groupId,
                  i.invited_by_person_id AS invitedByPersonId,
                  ib.first_name AS invitedByFirstName,
                  ib.last_name AS invitedByLastName,
                  i.invitee_person_id AS inviteePersonId,
                  ie.first_name AS inviteeFirstName,
                  ie.last_name AS inviteeLastName,
                  i.status,
                  i.expires_at AS expiresAt,
                  i.created_at AS createdAt,
                  i.updated_at AS updatedAt
           FROM group_invites i
           LEFT JOIN people ib ON ib.church_id=i.church_id AND ib.id=i.invited_by_person_id
           LEFT JOIN people ie ON ie.church_id=i.church_id AND ie.id=i.invitee_person_id
           WHERE i.church_id=?1 AND i.group_id=?2 AND i.status=?3
           ORDER BY i.updated_at DESC
           LIMIT ?4 OFFSET ?5`,
        )
        .bind(churchId, groupId, status, limit, offset)
        .all()
    ).results ?? [];

  return json({ ok: true, invites: rows, actor: { userId, role, personId } });
}

async function handleGroupInviteCancel(req: Request, env: Env) {
  const parsed = GroupInviteCancelSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const inviteId = parsed.data.invite_id.trim();

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const inv = (await env.churchcore
    .prepare(`SELECT id, group_id AS groupId, invited_by_person_id AS invitedByPersonId, status FROM group_invites WHERE church_id=?1 AND id=?2`)
    .bind(churchId, inviteId)
    .first()) as any;
  if (!inv) return json({ ok: false, error: "Invite not found" }, { status: 404 });
  const groupId = String(inv.groupId);
  const status = String(inv.status);
  if (status !== "pending") return json({ ok: false, error: "Only pending invites can be cancelled" }, { status: 400 });

  const isManager = await canManageGroupMembers(env, { churchId, userId, identityRole: role, groupId, personId });
  const isInviter = String(inv.invitedByPersonId) === personId;
  if (!isManager && !isInviter) return json({ ok: false, error: "Forbidden" }, { status: 403 });

  const now = nowIso();
  await env.churchcore.prepare(`UPDATE group_invites SET status='cancelled', updated_at=?3 WHERE church_id=?1 AND id=?2`).bind(churchId, inviteId, now).run();
  return json({ ok: true, invite_id: inviteId, status: "cancelled", actor: { userId, role, personId } });
}

async function handleGroupCreate(req: Request, env: Env) {
  const parsed = GroupCreateSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const id = crypto.randomUUID();
  const now = nowIso();
  await env.churchcore
    .prepare(
      `INSERT INTO groups (
         id, church_id, campus_id, name, description, leader_person_id,
         meeting_details, meeting_frequency, meeting_day_of_week, meeting_time_local, meeting_timezone, meeting_location_name, meeting_location_address,
         is_open, created_at, updated_at
       )
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
    )
    .bind(
      id,
      churchId,
      parsed.data.campus_id ?? identity.campus_id ?? null,
      parsed.data.name,
      parsed.data.description ?? null,
      personId,
      parsed.data.meeting_details ?? null,
      parsed.data.meeting_frequency ?? null,
      parsed.data.meeting_day_of_week ?? null,
      parsed.data.meeting_time_local ?? null,
      parsed.data.meeting_timezone ?? identity.timezone ?? null,
      parsed.data.meeting_location_name ?? null,
      parsed.data.meeting_location_address ?? null,
      parsed.data.is_open == null ? 1 : parsed.data.is_open ? 1 : 0,
      now,
      now,
    )
    .run();

  await env.churchcore
    .prepare(
      `INSERT INTO group_memberships (church_id, group_id, person_id, role, status, joined_at)
       VALUES (?1, ?2, ?3, 'leader', 'active', ?4)
       ON CONFLICT(group_id, person_id) DO UPDATE
         SET status='active',
             role='leader',
             joined_at=COALESCE(group_memberships.joined_at, excluded.joined_at)`,
    )
    .bind(churchId, id, personId, now)
    .run();

  await syncPersonGroupsAndCommunityToMemory(env, { churchId, personId, actorUserId: userId, actorRole: role, threadId: (identity.thread_id ?? "").trim() || "thread_unknown" });
  return json({ ok: true, group_id: id, actor: { userId, role, personId } });
}

async function handleGroupInvitesInboxList(req: Request, env: Env) {
  const parsed = GroupInvitesInboxListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const status = (parsed.data.status ?? "pending") as string;
  const limit = parsed.data.limit ?? 50;
  const offset = parsed.data.offset ?? 0;

  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT i.id,
                  i.group_id AS groupId,
                  g.name AS groupName,
                  g.description AS groupDescription,
                  i.invited_by_person_id AS invitedByPersonId,
                  p.first_name AS invitedByFirstName,
                  p.last_name AS invitedByLastName,
                  i.status,
                  i.created_at AS createdAt,
                  i.updated_at AS updatedAt
           FROM group_invites i
           JOIN groups g ON g.id=i.group_id AND g.church_id=i.church_id
           LEFT JOIN people p ON p.id=i.invited_by_person_id AND p.church_id=i.church_id
           WHERE i.church_id=?1 AND i.invitee_person_id=?2 AND i.status=?3
           ORDER BY i.updated_at DESC
           LIMIT ?4 OFFSET ?5`,
        )
        .bind(churchId, personId, status, limit, offset)
        .all()
    ).results ?? [];

  return json({ ok: true, invites: rows, actor: { userId, role, personId } });
}

async function handlePeopleSearch(req: Request, env: Env) {
  const parsed = PeopleSearchSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const q = parsed.data.q.trim();
  const limit = parsed.data.limit ?? 12;
  const like = `%${q.replaceAll("%", "").replaceAll("_", "")}%`;

  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT id, first_name AS firstName, last_name AS lastName, email, phone, campus_id AS campusId
           FROM people
           WHERE church_id=?1
             AND (
               (first_name || ' ' || last_name) LIKE ?2 COLLATE NOCASE
               OR (last_name || ' ' || first_name) LIKE ?2 COLLATE NOCASE
               OR email LIKE ?2 COLLATE NOCASE
               OR phone LIKE ?2 COLLATE NOCASE
             )
           ORDER BY last_name ASC, first_name ASC
           LIMIT ?3`,
        )
        .bind(churchId, like, limit)
        .all()
    ).results ?? [];

  return json({ ok: true, people: rows, actor: { userId, role } });
}

async function handleGroupMemberRemove(req: Request, env: Env) {
  const parsed = GroupMemberRemoveSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const groupId = parsed.data.group_id.trim();
  const memberPersonId = parsed.data.member_person_id.trim();

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });
  const ok = await canManageGroupMembers(env, { churchId, userId, identityRole: role, groupId, personId });
  if (!ok) return json({ ok: false, error: "Forbidden" }, { status: 403 });
  if (memberPersonId === personId) return json({ ok: false, error: "Cannot remove self" }, { status: 400 });

  await env.churchcore.prepare(`UPDATE group_memberships SET status='inactive' WHERE church_id=?1 AND group_id=?2 AND person_id=?3`).bind(churchId, groupId, memberPersonId).run();
  await syncPersonGroupsAndCommunityToMemory(env, { churchId, personId: memberPersonId, actorUserId: userId, actorRole: role, threadId: (identity.thread_id ?? "").trim() || "thread_unknown" });
  return json({ ok: true, actor: { userId, role, personId } });
}

async function handleGroupMemberSetRole(req: Request, env: Env) {
  const parsed = GroupMemberSetRoleSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const groupId = parsed.data.group_id.trim();
  const memberPersonId = parsed.data.member_person_id.trim();
  const nextRole = parsed.data.role;

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });
  const ok = await canManageGroupMembers(env, { churchId, userId, identityRole: role, groupId, personId });
  if (!ok) return json({ ok: false, error: "Forbidden" }, { status: 403 });

  await env.churchcore.prepare(`UPDATE group_memberships SET role=?4 WHERE church_id=?1 AND group_id=?2 AND person_id=?3`).bind(churchId, groupId, memberPersonId, nextRole).run();
  return json({ ok: true, actor: { userId, role, personId } });
}

async function handleGroupEventsList(req: Request, env: Env) {
  const parsed = GroupEventsListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const groupId = parsed.data.group_id.trim();
  const fromIso = parsed.data.from_iso.trim();
  const toIso = parsed.data.to_iso.trim();

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });
  const actor = await groupActorRole(env, { churchId, groupId, actorPersonId: personId });
  if (actor.status !== "active") return json({ ok: false, error: "Not permitted" }, { status: 403 });

  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT id,group_id AS groupId,title,description,location,start_at AS startAt,end_at AS endAt,created_by_person_id AS createdByPersonId,visibility,created_at AS createdAt,updated_at AS updatedAt
           FROM group_events
           WHERE church_id=?1 AND group_id=?2 AND start_at>=?3 AND start_at<=?4
           ORDER BY start_at ASC`,
        )
        .bind(churchId, groupId, fromIso, toIso)
        .all()
    ).results ?? [];

  return json({ ok: true, events: rows, actor: { userId, role, personId } });
}

async function handleGroupEventCreate(req: Request, env: Env) {
  const parsed = GroupEventCreateSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const groupId = parsed.data.group_id.trim();

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });
  const actor = await groupActorRole(env, { churchId, groupId, actorPersonId: personId });
  if (actor.status !== "active") return json({ ok: false, error: "Not permitted" }, { status: 403 });

  const id = crypto.randomUUID();
  const now = nowIso();
  await env.churchcore
    .prepare(
      `INSERT INTO group_events (id, church_id, group_id, title, description, location, start_at, end_at, created_by_person_id, visibility, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .bind(
      id,
      churchId,
      groupId,
      parsed.data.title,
      parsed.data.description ?? null,
      parsed.data.location ?? null,
      parsed.data.start_at,
      parsed.data.end_at ?? null,
      personId,
      parsed.data.visibility ?? "members",
      now,
      now,
    )
    .run();

  return json({ ok: true, event_id: id, actor: { userId, role, personId } });
}

async function handleGroupEventUpdate(req: Request, env: Env) {
  const parsed = GroupEventUpdateSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const groupId = parsed.data.group_id.trim();
  const eventId = parsed.data.event_id.trim();

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });
  const actor = await groupActorRole(env, { churchId, groupId, actorPersonId: personId });
  const roles = await getUserRoles(env, { churchId, userId });
  const isStaff = String(role).toLowerCase() === "guide" || roles.has("staff");
  if (!isStaff && actor.status !== "active") return json({ ok: false, error: "Not permitted" }, { status: 403 });

  const ev = (await env.churchcore
    .prepare(`SELECT created_by_person_id AS createdBy FROM group_events WHERE church_id=?1 AND id=?2 AND group_id=?3`)
    .bind(churchId, eventId, groupId)
    .first()) as any;
  if (!ev) return json({ ok: false, error: "Event not found" }, { status: 404 });
  const isPriv = isStaff || (actor.status === "active" && (actor.role === "leader" || actor.role === "host"));
  const isCreator = String(ev.createdBy ?? "") && String(ev.createdBy) === personId;
  if (!isPriv && !isCreator) return json({ ok: false, error: "Forbidden" }, { status: 403 });

  const now = nowIso();
  await env.churchcore
    .prepare(
      `UPDATE group_events
       SET title=COALESCE(?4, title),
           description=COALESCE(?5, description),
           location=COALESCE(?6, location),
           start_at=COALESCE(?7, start_at),
           end_at=COALESCE(?8, end_at),
           visibility=COALESCE(?9, visibility),
           updated_at=?10
       WHERE church_id=?1 AND id=?2 AND group_id=?3`,
    )
    .bind(
      churchId,
      eventId,
      groupId,
      parsed.data.title ?? null,
      parsed.data.description ?? null,
      parsed.data.location ?? null,
      parsed.data.start_at ?? null,
      parsed.data.end_at ?? null,
      parsed.data.visibility ?? null,
      now,
    )
    .run();

  return json({ ok: true, actor: { userId, role, personId } });
}

async function handleGroupEventDelete(req: Request, env: Env) {
  const parsed = GroupEventDeleteSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const groupId = parsed.data.group_id.trim();
  const eventId = parsed.data.event_id.trim();

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });
  const actor = await groupActorRole(env, { churchId, groupId, actorPersonId: personId });
  const roles = await getUserRoles(env, { churchId, userId });
  const isStaff = String(role).toLowerCase() === "guide" || roles.has("staff");
  if (!isStaff && actor.status !== "active") return json({ ok: false, error: "Not permitted" }, { status: 403 });

  const ev = (await env.churchcore
    .prepare(`SELECT created_by_person_id AS createdBy FROM group_events WHERE church_id=?1 AND id=?2 AND group_id=?3`)
    .bind(churchId, eventId, groupId)
    .first()) as any;
  if (!ev) return json({ ok: false, error: "Event not found" }, { status: 404 });
  const isPriv = isStaff || (actor.status === "active" && (actor.role === "leader" || actor.role === "host"));
  const isCreator = String(ev.createdBy ?? "") && String(ev.createdBy) === personId;
  if (!isPriv && !isCreator) return json({ ok: false, error: "Forbidden" }, { status: 403 });

  await env.churchcore.prepare(`DELETE FROM group_events WHERE church_id=?1 AND id=?2 AND group_id=?3`).bind(churchId, eventId, groupId).run();
  return json({ ok: true, actor: { userId, role, personId } });
}

async function handleGroupBibleStudyList(req: Request, env: Env) {
  const parsed = GroupBibleStudyListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const groupId = parsed.data.group_id.trim();
  const includeArchived = Boolean(parsed.data.include_archived);

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });
  const actor = await groupActorRole(env, { churchId, groupId, actorPersonId: personId });
  if (actor.status !== "active") return json({ ok: false, error: "Not permitted" }, { status: 403 });

  const clause = includeArchived ? "" : "AND status='active'";
  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT id,group_id AS groupId,title,description,status,created_by_person_id AS createdByPersonId,created_at AS createdAt,updated_at AS updatedAt
           FROM group_bible_studies
           WHERE church_id=?1 AND group_id=?2 ${clause}
           ORDER BY updated_at DESC`,
        )
        .bind(churchId, groupId)
        .all()
    ).results ?? [];
  return json({ ok: true, studies: rows, actor: { userId, role, personId } });
}

async function handleGroupBibleStudyCreate(req: Request, env: Env) {
  const parsed = GroupBibleStudyCreateSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;
  const groupId = parsed.data.group_id.trim();

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });
  const actor = await groupActorRole(env, { churchId, groupId, actorPersonId: personId });
  if (actor.status !== "active") return json({ ok: false, error: "Not permitted" }, { status: 403 });

  const id = crypto.randomUUID();
  const now = nowIso();
  await env.churchcore
    .prepare(
      `INSERT INTO group_bible_studies (id, church_id, group_id, title, description, status, created_by_person_id, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8)`,
    )
    .bind(id, churchId, groupId, parsed.data.title, parsed.data.description ?? null, personId, now, now)
    .run();
  return json({ ok: true, bible_study_id: id, actor: { userId, role, personId } });
}

async function handleGroupBibleStudyAddReading(req: Request, env: Env) {
  const parsed = GroupBibleStudyAddReadingSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const bibleStudyId = parsed.data.bible_study_id.trim();
  const study = (await env.churchcore.prepare(`SELECT group_id AS groupId FROM group_bible_studies WHERE church_id=?1 AND id=?2`).bind(churchId, bibleStudyId).first()) as any;
  if (!study) return json({ ok: false, error: "Bible study not found" }, { status: 404 });
  const groupId = String(study.groupId);
  const actor = await groupActorRole(env, { churchId, groupId, actorPersonId: personId });
  if (actor.status !== "active") return json({ ok: false, error: "Not permitted" }, { status: 403 });

  const id = crypto.randomUUID();
  const now = nowIso();
  await env.churchcore
    .prepare(`INSERT INTO group_bible_study_readings (id, church_id, bible_study_id, ref, order_index, notes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(id, churchId, bibleStudyId, parsed.data.ref, parsed.data.order_index ?? 0, parsed.data.notes ?? null, now)
    .run();
  return json({ ok: true, reading_id: id, actor: { userId, role, personId } });
}

async function handleGroupBibleStudyAddNote(req: Request, env: Env) {
  const parsed = GroupBibleStudyAddNoteSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const bibleStudyId = parsed.data.bible_study_id.trim();
  const study = (await env.churchcore.prepare(`SELECT group_id AS groupId FROM group_bible_studies WHERE church_id=?1 AND id=?2`).bind(churchId, bibleStudyId).first()) as any;
  if (!study) return json({ ok: false, error: "Bible study not found" }, { status: 404 });
  const groupId = String(study.groupId);
  const actor = await groupActorRole(env, { churchId, groupId, actorPersonId: personId });
  if (actor.status !== "active") return json({ ok: false, error: "Not permitted" }, { status: 403 });

  const id = crypto.randomUUID();
  const now = nowIso();
  await env.churchcore
    .prepare(`INSERT INTO group_bible_study_notes (id, church_id, bible_study_id, author_person_id, content_markdown, visibility, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(id, churchId, bibleStudyId, personId, parsed.data.content_markdown, parsed.data.visibility ?? "members", now)
    .run();
  return json({ ok: true, note_id: id, actor: { userId, role, personId } });
}

async function handleGroupBibleStudyReadingsList(req: Request, env: Env) {
  const parsed = GroupBibleStudyReadingsListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const bibleStudyId = parsed.data.bible_study_id.trim();
  const study = (await env.churchcore.prepare(`SELECT group_id AS groupId FROM group_bible_studies WHERE church_id=?1 AND id=?2`).bind(churchId, bibleStudyId).first()) as any;
  if (!study) return json({ ok: false, error: "Bible study not found" }, { status: 404 });
  const groupId = String(study.groupId);
  const actor = await groupActorRole(env, { churchId, groupId, actorPersonId: personId });
  if (actor.status !== "active") return json({ ok: false, error: "Not permitted" }, { status: 403 });

  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT id,bible_study_id AS bibleStudyId,ref,order_index AS orderIndex,notes,created_at AS createdAt
           FROM group_bible_study_readings
           WHERE church_id=?1 AND bible_study_id=?2
           ORDER BY order_index ASC, created_at ASC`,
        )
        .bind(churchId, bibleStudyId)
        .all()
    ).results ?? [];

  return json({ ok: true, readings: rows, actor: { userId, role, personId } });
}

async function handleGroupBibleStudyNotesList(req: Request, env: Env) {
  const parsed = GroupBibleStudyNotesListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const bibleStudyId = parsed.data.bible_study_id.trim();
  const study = (await env.churchcore.prepare(`SELECT group_id AS groupId FROM group_bible_studies WHERE church_id=?1 AND id=?2`).bind(churchId, bibleStudyId).first()) as any;
  if (!study) return json({ ok: false, error: "Bible study not found" }, { status: 404 });
  const groupId = String(study.groupId);
  const actor = await groupActorRole(env, { churchId, groupId, actorPersonId: personId });
  if (actor.status !== "active") return json({ ok: false, error: "Not permitted" }, { status: 403 });

  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT n.id,
                  n.bible_study_id AS bibleStudyId,
                  n.author_person_id AS authorPersonId,
                  p.first_name AS authorFirstName,
                  p.last_name AS authorLastName,
                  n.content_markdown AS contentMarkdown,
                  n.visibility,
                  n.created_at AS createdAt
           FROM group_bible_study_notes n
           LEFT JOIN people p ON p.church_id=n.church_id AND p.id=n.author_person_id
           WHERE n.church_id=?1 AND n.bible_study_id=?2
           ORDER BY n.created_at DESC`,
        )
        .bind(churchId, bibleStudyId)
        .all()
    ).results ?? [];

  return json({ ok: true, notes: rows, actor: { userId, role, personId } });
}

async function handleGroupBibleStudySessionsList(req: Request, env: Env) {
  const parsed = GroupBibleStudySessionsListSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const bibleStudyId = parsed.data.bible_study_id.trim();
  const study = (await env.churchcore.prepare(`SELECT group_id AS groupId FROM group_bible_studies WHERE church_id=?1 AND id=?2`).bind(churchId, bibleStudyId).first()) as any;
  if (!study) return json({ ok: false, error: "Bible study not found" }, { status: 404 });
  const groupId = String(study.groupId);

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });
  const actor = await groupActorRole(env, { churchId, groupId, actorPersonId: personId });
  if (actor.status !== "active") return json({ ok: false, error: "Not permitted" }, { status: 403 });

  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT id,bible_study_id AS bibleStudyId,session_at AS sessionAt,title,agenda,created_at AS createdAt,updated_at AS updatedAt
           FROM group_bible_study_sessions
           WHERE church_id=?1 AND bible_study_id=?2
           ORDER BY session_at DESC`,
        )
        .bind(churchId, bibleStudyId)
        .all()
    ).results ?? [];
  return json({ ok: true, sessions: rows, actor: { userId, role, personId } });
}

async function handleGroupBibleStudySessionCreate(req: Request, env: Env) {
  const parsed = GroupBibleStudySessionCreateSchema.safeParse(await parseJson(req));
  if (!parsed.success) return json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  const { identity } = parsed.data;
  const churchId = identity.tenant_id;
  const userId = identity.user_id;
  const role = (identity.role ?? "seeker") as string;

  const { personId } = await resolvePerson(env, identity);
  if (!personId) return json({ ok: false, error: "No personId" }, { status: 400 });

  const bibleStudyId = parsed.data.bible_study_id.trim();
  const study = (await env.churchcore.prepare(`SELECT group_id AS groupId FROM group_bible_studies WHERE church_id=?1 AND id=?2`).bind(churchId, bibleStudyId).first()) as any;
  if (!study) return json({ ok: false, error: "Bible study not found" }, { status: 404 });
  const groupId = String(study.groupId);
  const actor = await groupActorRole(env, { churchId, groupId, actorPersonId: personId });
  if (actor.status !== "active") return json({ ok: false, error: "Not permitted" }, { status: 403 });

  const id = crypto.randomUUID();
  const now = nowIso();
  await env.churchcore
    .prepare(
      `INSERT INTO group_bible_study_sessions (id, church_id, bible_study_id, session_at, title, agenda, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(id, churchId, bibleStudyId, parsed.data.session_at, parsed.data.title ?? null, parsed.data.agenda ?? null, now, now)
    .run();
  return json({ ok: true, session_id: id, actor: { userId, role, personId } });
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

  // Best-effort: email the check-in id to the user/household email.
  let emailSent: boolean | null = null;
  let emailTo: string | null = null;
  let emailError: string | null = null;
  try {
    const pid = identity.persona_id ? String(identity.persona_id) : "";
    if (pid) {
      const row = (await env.churchcore
        .prepare(`SELECT email FROM people WHERE church_id=?1 AND id=?2 LIMIT 1`)
        .bind(churchId, pid)
        .first()) as any;
      const em = typeof row?.email === "string" ? String(row.email).trim() : "";
      if (em) emailTo = em;
    }
    if (!emailTo) {
      const row = (await env.churchcore
        .prepare(
          `SELECT contact_value AS email
           FROM household_contacts
           WHERE church_id=?1 AND household_id=?2 AND contact_type='email'
           ORDER BY is_primary DESC, updated_at DESC
           LIMIT 1`,
        )
        .bind(churchId, parsed.data.household_id)
        .first()) as any;
      const em = typeof row?.email === "string" ? String(row.email).trim() : "";
      if (em) emailTo = em;
    }

    const mcpUrl = String(env.SENDGRID_MCP_URL ?? "").trim();
    const mcpKey = String(env.SENDGRID_MCP_API_KEY ?? "").trim();
    if (emailTo && mcpUrl) {
      const subject = "Kids check-in confirmation";
      const text =
        `Your kids check-in is complete.\n\n` +
        `Check-in ID: ${checkinId}\n` +
        `Pickup code: ${securityCode}\n` +
        `Campus: ${String(identity.campus_id ?? "")}\n` +
        `Created at: ${now}\n`;

      const out = await mcpCallTool(env, { baseUrl: mcpUrl, apiKey: mcpKey, toolName: "sendEmail", toolArgs: { to: emailTo, subject, text } });
      if (!out.ok) {
        emailSent = false;
        emailError = out.error;
      } else {
        emailSent = true;
      }
    }
  } catch (e: any) {
    emailSent = false;
    emailError = String(e?.message ?? e ?? "email failed");
  }

  return json({ ok: true, checkin_id: checkinId, security_code: securityCode, items, email_to: emailTo, email_sent: emailSent, email_error: emailError });
}

export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    // Public discovery endpoints (no auth)
    if (req.method === "GET" && url.pathname === "/.well-known/agent-card.json") return agentCard(req, env);
    if (req.method === "GET" && url.pathname === "/healthz") return json({ ok: true });

    const auth = requireApiKey(req, env);
    if (auth) return auth;

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
      case "/a2a/thread.clear":
        return handleThreadClear(req, env);
      case "/a2a/topic.template.list":
        return handleTopicTemplateList(req, env);
      case "/a2a/thread.append":
        return handleThreadAppend(req, env);
      case "/a2a/chat":
        return handleChat(req, env);
      case "/a2a/chat.stream":
        return handleChatStream(req, env);
      case "/a2a/chat.ai_gateway":
        return handleChatAiGateway(req, env);
      case "/a2a/chat.ai_gateway.stream":
        return handleChatAiGatewayStream(req, env);
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
      case "/a2a/household.profile.upsert":
        return handleHouseholdProfileUpsert(req, env);
      case "/a2a/household.relationship.upsert":
        return handleHouseholdRelationshipUpsert(req, env);
      case "/a2a/household.relationship.remove":
        return handleHouseholdRelationshipRemove(req, env);
      case "/a2a/weekly_podcast.list":
        return handleWeeklyPodcastList(req, env);
      case "/a2a/weekly_podcast.get":
        return handleWeeklyPodcastGet(req, env);
      case "/a2a/weekly_podcast.analyze":
        return handleWeeklyPodcastAnalyze(req, env);
      case "/a2a/sermon.list":
        return handleSermonList(req, env);
      case "/a2a/sermon.get":
        return handleSermonGet(req, env);
      case "/a2a/sermon.compare":
        return handleSermonCompare(req, env);
      case "/a2a/bible.plan.week.get":
        return handleBiblePlanWeekGet(req, env);
      case "/a2a/bible.plan.item.complete":
        return handleBiblePlanItemComplete(req, env);
      case "/a2a/bible.plan.checkin.create":
        return handleBiblePlanCheckinCreate(req, env);
      case "/a2a/community.catalog.list":
        return handleCommunityCatalogList(req, env);
      case "/a2a/community.my.list":
        return handleCommunityMyList(req, env);
      case "/a2a/community.join":
        return handleCommunityJoin(req, env);
      case "/a2a/community.leave":
        return handleCommunityLeave(req, env);
      case "/a2a/community.mark":
        return handleCommunityMark(req, env);
      case "/a2a/group.my.list":
        return handleGroupMyList(req, env);
      case "/a2a/group.get":
        return handleGroupGet(req, env);
      case "/a2a/group.update":
        return handleGroupUpdate(req, env);
      case "/a2a/group.members.list":
        return handleGroupMembersList(req, env);
      case "/a2a/group.invite.create":
        return handleGroupInviteCreate(req, env);
      case "/a2a/group.invite.respond":
        return handleGroupInviteRespond(req, env);
      case "/a2a/group.invites.sent.list":
        return handleGroupInvitesSentList(req, env);
      case "/a2a/group.invite.cancel":
        return handleGroupInviteCancel(req, env);
      case "/a2a/group.create":
        return handleGroupCreate(req, env);
      case "/a2a/group.invites.inbox.list":
        return handleGroupInvitesInboxList(req, env);
      case "/a2a/people.search":
        return handlePeopleSearch(req, env);
      case "/a2a/group.member.remove":
        return handleGroupMemberRemove(req, env);
      case "/a2a/group.member.set_role":
        return handleGroupMemberSetRole(req, env);
      case "/a2a/group.events.list":
        return handleGroupEventsList(req, env);
      case "/a2a/group.event.create":
        return handleGroupEventCreate(req, env);
      case "/a2a/group.event.update":
        return handleGroupEventUpdate(req, env);
      case "/a2a/group.event.delete":
        return handleGroupEventDelete(req, env);
      case "/a2a/group.bible_study.list":
        return handleGroupBibleStudyList(req, env);
      case "/a2a/group.bible_study.create":
        return handleGroupBibleStudyCreate(req, env);
      case "/a2a/group.bible_study.reading.add":
        return handleGroupBibleStudyAddReading(req, env);
      case "/a2a/group.bible_study.note.add":
        return handleGroupBibleStudyAddNote(req, env);
      case "/a2a/group.bible_study.readings.list":
        return handleGroupBibleStudyReadingsList(req, env);
      case "/a2a/group.bible_study.notes.list":
        return handleGroupBibleStudyNotesList(req, env);
      case "/a2a/group.bible_study.sessions.list":
        return handleGroupBibleStudySessionsList(req, env);
      case "/a2a/group.bible_study.session.create":
        return handleGroupBibleStudySessionCreate(req, env);
      case "/a2a/checkin.start":
        return handleCheckinStart(req, env);
      case "/a2a/checkin.preview":
        return handleCheckinPreview(req, env);
      case "/a2a/checkin.commit":
        return handleCheckinCommit(req, env);
      case "/a2a/calendar.week":
        return handleCalendarWeek(req, env);
      case "/a2a/bible.passage":
        return handleBiblePassage(req, env);
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

