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

  const envelope = await runAgent(env, { threadId, inputPayload: { skill, message, args: parsed.data.args ?? null, session } });
  const assistantText = typeof (envelope as any)?.message === "string" ? String((envelope as any).message) : "";

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
      default:
        return json({ error: "Not found" }, { status: 404 });
    }
  },
};

