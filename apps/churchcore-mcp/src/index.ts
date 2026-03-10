import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export type Env = {
  MCP_API_KEY?: string;
  churchcore: D1Database;
  // Crawl + KB refresh
  CRAWL_CHURCH_ID?: string;
  CRAWL_BUDGET?: string;
  CRAWL_DOMAIN_ALLOWLIST?: string;
  ASSEMBLYAI_API_KEY?: string;
  ASSEMBLYAI_HTTP_TIMEOUT_MS?: string; // default 20000
  OPENAI_API_KEY?: string;
  OPENAI_EMBEDDINGS_MODEL?: string;
  OPENAI_MESSAGE_MODEL?: string; // e.g. gpt-5.2
  OPENAI_TRANSCRIBE_MODEL?: string; // e.g. gpt-4o-mini-transcribe|whisper-1
  TRANSCRIBE_MAX_BYTES?: string; // default ~20MB
  // GraphDB (Ontotext) - optional read-only debug integration
  GRAPHDB_BASE_URL?: string;
  GRAPHDB_REPOSITORY?: string;
  GRAPHDB_USERNAME?: string;
  GRAPHDB_PASSWORD?: string;
  GRAPHDB_CF_ACCESS_CLIENT_ID?: string;
  GRAPHDB_CF_ACCESS_CLIENT_SECRET?: string;
  // GraphDB sync job (D1 -> GraphDB)
  GRAPHDB_SYNC_ENABLED?: string; // "1" to enable scheduled sync
  GRAPHDB_CONTEXT_BASE?: string; // default https://churchcore.ai/graph/d1
  GRAPHDB_ID_BASE?: string; // default https://id.churchcore.ai
  GRAPHDB_SYNC_BATCH?: string; // default 200
};

function nowIso() {
  return new Date().toISOString();
}

function normalizePhone(input: string) {
  const raw = String(input ?? "").trim();
  const digits = raw.replace(/[^\d+]/g, "");
  const justDigits = digits.replace(/[^\d]/g, "");
  // Very small heuristic: US 10-digit -> +1
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

async function groupActorRole(
  env: Env,
  args: { churchId: string; groupId: string; actorPersonId: string },
): Promise<"none" | "member" | "host" | "leader" | "staff"> {
  const roleRow = (await env.churchcore
    .prepare(
      `SELECT role,status
       FROM group_memberships
       WHERE church_id=?1 AND group_id=?2 AND person_id=?3`,
    )
    .bind(args.churchId, args.groupId, args.actorPersonId)
    .first()) as any;

  const status = String(roleRow?.status ?? "");
  if (status !== "active") return "none";
  const role = String(roleRow?.role ?? "member").toLowerCase();
  if (role === "leader" || role === "host") return role as any;
  return "member";
}

function canManageGroupMembers(actorRole: string) {
  // Plan decision: members can invite/add; leader can remove/change roles.
  return actorRole === "leader" || actorRole === "host" || actorRole === "staff";
}

function jsonText(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj) }],
  };
}

function base64EncodeUtf8(input: string) {
  const bytes = new TextEncoder().encode(String(input ?? ""));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  // Cloudflare Workers: btoa is available.
  return btoa(bin);
}

function checkApiKey(request: Request, env: Env): Response | null {
  const expected = (env.MCP_API_KEY ?? "").trim();
  if (!expected) return null;
  const got = request.headers.get("x-api-key") ?? request.headers.get("X-Api-Key") ?? "";
  if (got !== expected) return new Response("Unauthorized", { status: 401 });
  return null;
}

async function auditAppend(
  env: Env,
  params: {
    churchId: string;
    actorUserId?: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    payload?: unknown;
  },
) {
  const id = crypto.randomUUID();
  await env.churchcore
    .prepare(
      `INSERT INTO audit_log (id, church_id, actor_user_id, action, entity_type, entity_id, payload_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      id,
      params.churchId,
      params.actorUserId ?? null,
      params.action,
      params.entityType ?? null,
      params.entityId ?? null,
      params.payload ? JSON.stringify(params.payload) : null,
      nowIso(),
    )
    .run();
  return id;
}

function createServer(env: Env) {
  const server = new McpServer({
    name: "ChurchCore MCP",
    version: "0.1.0",
  });

  const BaseSessionArgs = z.object({
    churchId: z.string().min(1),
    campusId: z.string().min(1).optional().nullable(),
  });

  server.tool(
    "churchcore_graphdb_sparql_query",
    "Run a read-only SPARQL query against the configured GraphDB repository (debug/validation).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      query: z.string().min(1),
      accept: z.string().min(1).optional().nullable(),
    },
    async (args) => {
      const baseUrl = String(env.GRAPHDB_BASE_URL ?? "").trim().replace(/\/+$/, "");
      const repo = String(env.GRAPHDB_REPOSITORY ?? "").trim();
      const username = String(env.GRAPHDB_USERNAME ?? "").trim();
      const password = String(env.GRAPHDB_PASSWORD ?? "").trim();
      const cfId = String(env.GRAPHDB_CF_ACCESS_CLIENT_ID ?? "").trim();
      const cfSecret = String(env.GRAPHDB_CF_ACCESS_CLIENT_SECRET ?? "").trim();
      const accept = typeof (args as any).accept === "string" && String((args as any).accept).trim() ? String((args as any).accept).trim() : "application/sparql-results+json";
      const query = String((args as any).query ?? "").trim();

      if (!baseUrl) throw new Error("GRAPHDB_BASE_URL not configured");
      if (!repo) throw new Error("GRAPHDB_REPOSITORY not configured");
      if (!query) throw new Error("query is required");

      const url = `${baseUrl}/repositories/${encodeURIComponent(repo)}`;
      const body = new URLSearchParams({ query });
      const headers: Record<string, string> = {
        accept,
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      };

      if (username && password) {
        headers.Authorization = `Basic ${base64EncodeUtf8(`${username}:${password}`)}`;
      }
      if (cfId && cfSecret) {
        headers["CF-Access-Client-Id"] = cfId;
        headers["CF-Access-Client-Secret"] = cfSecret;
      }

      const res = await fetch(url, { method: "POST", headers, body });
      const text = await res.text().catch(() => "");
      if (!res.ok) throw new Error(`GraphDB SPARQL query failed (${res.status}): ${text.slice(0, 1000)}`);

      let result: any = text;
      if (accept.includes("json")) {
        try {
          result = JSON.parse(text);
        } catch {
          result = { raw: text };
        }
      }

      return jsonText({ ok: true, accept, result });
    },
  );

  server.tool(
    "churchcore_list_services",
    "List service times (authoritative).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      campusId: BaseSessionArgs.shape.campusId,
      timezone: z.string().min(1).optional(),
    },
    async (args) => {
      const churchId = String((args as any).churchId);
      const campusId = (args as any).campusId ? String((args as any).campusId) : null;

      const q = campusId
        ? env.churchcore
            .prepare(
              `SELECT id,name,day_of_week,start_time_local,duration_minutes,timezone,location_name,location_address
               FROM services WHERE church_id=?1 AND campus_id=?2
               ORDER BY day_of_week ASC, start_time_local ASC`,
            )
            .bind(churchId, campusId)
        : env.churchcore
            .prepare(
              `SELECT id,name,day_of_week,start_time_local,duration_minutes,timezone,location_name,location_address
               FROM services WHERE church_id=?1
               ORDER BY day_of_week ASC, start_time_local ASC`,
            )
            .bind(churchId);

      const rows = (await q.all()).results ?? [];
      return jsonText({ services: rows });
    },
  );

  server.tool(
    "churchcore_list_events",
    "List upcoming events (authoritative).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      campusId: BaseSessionArgs.shape.campusId,
      timezone: z.string().min(1).optional(),
      fromIso: z.string().min(5).optional(),
      toIso: z.string().min(5).optional(),
    },
    async (args) => {
      const churchId = String((args as any).churchId);
      const campusId = (args as any).campusId ? String((args as any).campusId) : null;
      const fromIso = typeof (args as any).fromIso === "string" ? (args as any).fromIso : nowIso();
      const toIso = typeof (args as any).toIso === "string" ? (args as any).toIso : null;

      // IMPORTANT: event timestamps in D1 may not be canonical ISO (some rows have no "Z"/ms or use "YYYY-MM-DD HH:MM:SS").
      // To avoid lexicographic timestamp comparison bugs, filter by date prefix for week/range views.
      const fromDate = String(fromIso).slice(0, 10);
      const toDate = toIso ? String(toIso).slice(0, 10) : null;

      let sql = `SELECT id,campus_id,title,description,start_at,end_at,location_name,location_address,is_outdoor,lat,lon
                 FROM events
                 WHERE church_id=?1 AND substr(start_at,1,10) >= ?2`;
      const binds: any[] = [churchId, fromDate];

      if (campusId) {
        sql += ` AND campus_id=?${binds.length + 1}`;
        binds.push(campusId);
      }
      if (toDate) {
        sql += ` AND substr(start_at,1,10) <= ?${binds.length + 1}`;
        binds.push(toDate);
      }

      sql += ` ORDER BY start_at ASC LIMIT 50`;

      const rows = (await env.churchcore.prepare(sql).bind(...binds).all()).results ?? [];
      return jsonText({ events: rows });
    },
  );

  server.tool(
    "churchcore_list_weekly_podcasts",
    "List Weekly Podcast episodes (The Weekly).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      search: z.string().min(1).optional().nullable(),
      includeInactive: z.boolean().optional().nullable(),
      limit: z.number().int().min(1).max(200).optional().nullable(),
      offset: z.number().int().min(0).max(500000).optional().nullable(),
    },
    async (args) => {
      const churchId = String((args as any).churchId);
      const search = typeof (args as any).search === "string" ? String((args as any).search).trim().toLowerCase() : "";
      const includeInactive = Boolean((args as any).includeInactive);
      const limit = (args as any).limit ?? 50;
      const offset = (args as any).offset ?? 0;

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
      return jsonText({ podcasts: rows });
    },
  );

  server.tool(
    "churchcore_get_weekly_podcast",
    "Get a Weekly Podcast episode, including cached analysis if present.",
    {
      churchId: BaseSessionArgs.shape.churchId,
      podcastId: z.string().min(1),
    },
    async (args) => {
      const churchId = String((args as any).churchId);
      const podcastId = String((args as any).podcastId);

      const podcast = (await env.churchcore
        .prepare(
          `SELECT id, church_id AS churchId, episode_number AS episodeNumber, title, speaker, published_at AS publishedAt, passage,
                  source_url AS sourceUrl, watch_url AS watchUrl, listen_url AS listenUrl, image_url AS imageUrl,
                  is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt
           FROM weekly_podcasts WHERE church_id=?1 AND id=?2`,
        )
        .bind(churchId, podcastId)
        .first()) as any;

      if (!podcast) return jsonText({ podcast: null, analysis: null });

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

      return jsonText({ podcast, analysis: normalizedAnalysis });
    },
  );

  server.tool(
    "churchcore_upsert_weekly_podcast_analysis",
    "Upsert cached Weekly Podcast analysis (summary/topics/verses).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      actorUserId: z.string().min(1).optional().nullable(),
      podcastId: z.string().min(1),
      summaryMarkdown: z.string().min(1),
      topics: z.array(z.string()).optional().nullable(),
      verses: z.array(z.string()).optional().nullable(),
      model: z.string().min(1).optional().nullable(),
      source: z.string().min(1).optional().nullable(),
    },
    async (args) => {
      const churchId = String((args as any).churchId);
      const podcastId = String((args as any).podcastId);
      const actorUserId = (args as any).actorUserId ? String((args as any).actorUserId) : null;
      const summaryMarkdown = String((args as any).summaryMarkdown);
      const topics = Array.isArray((args as any).topics) ? ((args as any).topics as any[]).map((s) => String(s)) : [];
      const verses = Array.isArray((args as any).verses) ? ((args as any).verses as any[]).map((s) => String(s)) : [];
      const model = (args as any).model ? String((args as any).model) : null;
      const source = (args as any).source ? String((args as any).source) : null;
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
      await auditAppend(env, { churchId, actorUserId, action: "weekly_podcast_analysis_upsert", entityType: "weekly_podcasts", entityId: podcastId, payload: { model, source } });
      return jsonText({ ok: true });
    },
  );

  server.tool(
    "churchcore_list_groups",
    "List groups (authoritative).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      campusId: BaseSessionArgs.shape.campusId,
    },
    async (args) => {
      const churchId = String((args as any).churchId);
      const campusId = (args as any).campusId ? String((args as any).campusId) : null;

      const q = campusId
        ? env.churchcore
            .prepare(
              `SELECT id,name,description,leader_person_id,meeting_details,is_open
               FROM groups WHERE church_id=?1 AND campus_id=?2
               ORDER BY name ASC`,
            )
            .bind(churchId, campusId)
        : env.churchcore
            .prepare(
              `SELECT id,name,description,leader_person_id,meeting_details,is_open
               FROM groups WHERE church_id=?1
               ORDER BY name ASC`,
            )
            .bind(churchId);

      const rows = (await q.all()).results ?? [];
      return jsonText({ groups: rows });
    },
  );

  server.tool(
    "churchcore_groups_my_list",
    "List groups for a person (active/pending).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      personId: z.string().min(1),
      includeInactive: z.boolean().optional().nullable(),
      limit: z.number().int().min(1).max(200).optional().nullable(),
      offset: z.number().int().min(0).max(500000).optional().nullable(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          personId: z.string().min(1),
          includeInactive: z.boolean().optional().nullable(),
          limit: z.number().int().min(1).max(200).optional().nullable(),
          offset: z.number().int().min(0).max(500000).optional().nullable(),
        })
        .parse(args);

      const lim = parsed.limit ?? 100;
      const off = parsed.offset ?? 0;
      const includeInactive = Boolean(parsed.includeInactive);
      const statusClause = includeInactive ? "" : "AND gm.status IN ('active','pending')";

      const rows =
        (
          await env.churchcore
            .prepare(
              `SELECT g.id,g.campus_id AS campusId,g.name,g.description,g.leader_person_id AS leaderPersonId,g.meeting_details AS meetingDetails,g.is_open AS isOpen,
                      gm.role AS myRole, gm.status AS myStatus, gm.joined_at AS joinedAt
               FROM group_memberships gm
               JOIN groups g ON g.id=gm.group_id
               WHERE gm.church_id=?1 AND gm.person_id=?2 ${statusClause}
               ORDER BY g.name ASC
               LIMIT ${lim} OFFSET ${off}`,
            )
            .bind(parsed.churchId, parsed.personId)
            .all()
        ).results ?? [];
      return jsonText({ groups: rows });
    },
  );

  server.tool(
    "churchcore_groups_get",
    "Get a group and a small membership summary.",
    {
      churchId: BaseSessionArgs.shape.churchId,
      groupId: z.string().min(1),
    },
    async (args) => {
      const churchId = String((args as any).churchId);
      const groupId = String((args as any).groupId);

      const group = (await env.churchcore
        .prepare(
          `SELECT id,campus_id AS campusId,name,description,leader_person_id AS leaderPersonId,meeting_details AS meetingDetails,is_open AS isOpen,created_at AS createdAt,updated_at AS updatedAt
           FROM groups WHERE church_id=?1 AND id=?2`,
        )
        .bind(churchId, groupId)
        .first()) as any;
      if (!group) return jsonText({ ok: false, error: "Group not found" });

      const counts = (await env.churchcore
        .prepare(
          `SELECT status, COUNT(*) AS c
           FROM group_memberships
           WHERE church_id=?1 AND group_id=?2
           GROUP BY status`,
        )
        .bind(churchId, groupId)
        .all()) as any;
      const statusCounts: Record<string, number> = {};
      for (const r of (counts?.results ?? []) as any[]) statusCounts[String(r.status)] = Number(r.c ?? 0);

      return jsonText({ ok: true, group, membershipCounts: statusCounts });
    },
  );

  server.tool(
    "churchcore_group_members_list",
    "List group members (membership table).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      groupId: z.string().min(1),
      includeInactive: z.boolean().optional().nullable(),
    },
    async (args) => {
      const parsed = z
        .object({ churchId: z.string().min(1), groupId: z.string().min(1), includeInactive: z.boolean().optional().nullable() })
        .parse(args);
      const includeInactive = Boolean(parsed.includeInactive);
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
            .bind(parsed.churchId, parsed.groupId)
            .all()
        ).results ?? [];
      return jsonText({ members: rows });
    },
  );

  server.tool(
    "churchcore_group_invite_create",
    "Invite a person to a group (members can invite).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      groupId: z.string().min(1),
      invitedByPersonId: z.string().min(1),
      inviteePersonId: z.string().min(1),
    },
    async (args) => {
      const parsed = z
        .object({ churchId: z.string().min(1), groupId: z.string().min(1), invitedByPersonId: z.string().min(1), inviteePersonId: z.string().min(1) })
        .parse(args);
      if (parsed.invitedByPersonId === parsed.inviteePersonId) return jsonText({ ok: false, error: "Cannot invite self" });

      const actorRole = await groupActorRole(env, { churchId: parsed.churchId, groupId: parsed.groupId, actorPersonId: parsed.invitedByPersonId });
      if (actorRole === "none") return jsonText({ ok: false, error: "Not a group member" });

      // If already active/pending membership, no invite needed.
      const existing = (await env.churchcore
        .prepare(`SELECT status FROM group_memberships WHERE church_id=?1 AND group_id=?2 AND person_id=?3`)
        .bind(parsed.churchId, parsed.groupId, parsed.inviteePersonId)
        .first()) as any;
      if (existing && String(existing.status) !== "inactive") return jsonText({ ok: true, invite: null, note: "Already a member" });

      const now = nowIso();
      const id = crypto.randomUUID();
      await env.churchcore
        .prepare(
          `INSERT INTO group_invites (id, church_id, group_id, invited_by_person_id, invitee_person_id, status, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7)
           ON CONFLICT(church_id, group_id, invitee_person_id) DO UPDATE
             SET invited_by_person_id=excluded.invited_by_person_id,
                 status='pending',
                 updated_at=excluded.updated_at`,
        )
        .bind(id, parsed.churchId, parsed.groupId, parsed.invitedByPersonId, parsed.inviteePersonId, now, now)
        .run();

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: null,
        action: "group_invite_create",
        entityType: "group",
        entityId: parsed.groupId,
        payload: { invitedByPersonId: parsed.invitedByPersonId, inviteePersonId: parsed.inviteePersonId },
      });

      const invite = (await env.churchcore
        .prepare(
          `SELECT id,group_id AS groupId,invited_by_person_id AS invitedByPersonId,invitee_person_id AS inviteePersonId,status,created_at AS createdAt,updated_at AS updatedAt
           FROM group_invites WHERE church_id=?1 AND group_id=?2 AND invitee_person_id=?3`,
        )
        .bind(parsed.churchId, parsed.groupId, parsed.inviteePersonId)
        .first()) as any;
      return jsonText({ ok: true, invite });
    },
  );

  server.tool(
    "churchcore_group_invite_respond",
    "Respond to a group invite (accept/decline).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      inviteId: z.string().min(1),
      actorPersonId: z.string().min(1),
      action: z.enum(["accept", "decline"]),
    },
    async (args) => {
      const parsed = z
        .object({ churchId: z.string().min(1), inviteId: z.string().min(1), actorPersonId: z.string().min(1), action: z.enum(["accept", "decline"]) })
        .parse(args);
      const invite = (await env.churchcore
        .prepare(
          `SELECT id,group_id AS groupId,invited_by_person_id AS invitedByPersonId,invitee_person_id AS inviteePersonId,status
           FROM group_invites WHERE church_id=?1 AND id=?2`,
        )
        .bind(parsed.churchId, parsed.inviteId)
        .first()) as any;
      if (!invite) return jsonText({ ok: false, error: "Invite not found" });
      if (String(invite.inviteePersonId) !== parsed.actorPersonId) return jsonText({ ok: false, error: "Not permitted" });
      if (String(invite.status) !== "pending") return jsonText({ ok: false, error: "Invite is not pending" });

      const now = nowIso();
      const nextStatus = parsed.action === "accept" ? "accepted" : "declined";
      await env.churchcore.prepare(`UPDATE group_invites SET status=?4, updated_at=?3 WHERE church_id=?1 AND id=?2`).bind(parsed.churchId, parsed.inviteId, now, nextStatus).run();

      if (parsed.action === "accept") {
        await env.churchcore
          .prepare(
            `INSERT INTO group_memberships (church_id, group_id, person_id, role, status, joined_at)
             VALUES (?1, ?2, ?3, 'member', 'active', ?4)
             ON CONFLICT(group_id, person_id) DO UPDATE
               SET status='active',
                   role=excluded.role,
                   joined_at=COALESCE(group_memberships.joined_at, excluded.joined_at)`,
          )
          .bind(parsed.churchId, String(invite.groupId), parsed.actorPersonId, now)
          .run();
      }

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: null,
        action: "group_invite_respond",
        entityType: "group_invites",
        entityId: parsed.inviteId,
        payload: { action: parsed.action, groupId: invite.groupId },
      });

      return jsonText({ ok: true, status: nextStatus });
    },
  );

  server.tool(
    "churchcore_group_member_remove",
    "Remove a group member (leader/host only).",
    { churchId: BaseSessionArgs.shape.churchId, groupId: z.string().min(1), actorPersonId: z.string().min(1), memberPersonId: z.string().min(1) },
    async (args) => {
      const parsed = z
        .object({ churchId: z.string().min(1), groupId: z.string().min(1), actorPersonId: z.string().min(1), memberPersonId: z.string().min(1) })
        .parse(args);
      const actorRole = await groupActorRole(env, { churchId: parsed.churchId, groupId: parsed.groupId, actorPersonId: parsed.actorPersonId });
      if (!canManageGroupMembers(actorRole)) return jsonText({ ok: false, error: "Forbidden" });
      if (parsed.memberPersonId === parsed.actorPersonId) return jsonText({ ok: false, error: "Use role change; cannot remove self" });

      await env.churchcore
        .prepare(`UPDATE group_memberships SET status='inactive' WHERE church_id=?1 AND group_id=?2 AND person_id=?3`)
        .bind(parsed.churchId, parsed.groupId, parsed.memberPersonId)
        .run();
      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: null,
        action: "group_member_remove",
        entityType: "group",
        entityId: parsed.groupId,
        payload: { memberPersonId: parsed.memberPersonId, actorPersonId: parsed.actorPersonId },
      });
      return jsonText({ ok: true });
    },
  );

  server.tool(
    "churchcore_group_member_set_role",
    "Set a member role (leader/host only).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      groupId: z.string().min(1),
      actorPersonId: z.string().min(1),
      memberPersonId: z.string().min(1),
      role: z.enum(["member", "leader", "host"]),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          groupId: z.string().min(1),
          actorPersonId: z.string().min(1),
          memberPersonId: z.string().min(1),
          role: z.enum(["member", "leader", "host"]),
        })
        .parse(args);

      const actorRole = await groupActorRole(env, { churchId: parsed.churchId, groupId: parsed.groupId, actorPersonId: parsed.actorPersonId });
      if (!canManageGroupMembers(actorRole)) return jsonText({ ok: false, error: "Forbidden" });

      await env.churchcore
        .prepare(`UPDATE group_memberships SET role=?4 WHERE church_id=?1 AND group_id=?2 AND person_id=?3`)
        .bind(parsed.churchId, parsed.groupId, parsed.memberPersonId, parsed.role)
        .run();
      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: null,
        action: "group_member_set_role",
        entityType: "group",
        entityId: parsed.groupId,
        payload: { memberPersonId: parsed.memberPersonId, role: parsed.role, actorPersonId: parsed.actorPersonId },
      });
      return jsonText({ ok: true });
    },
  );

  server.tool(
    "churchcore_group_events_list",
    "List group events (schedule).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      groupId: z.string().min(1),
      fromIso: z.string().min(1),
      toIso: z.string().min(1),
    },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), groupId: z.string().min(1), fromIso: z.string().min(1), toIso: z.string().min(1) }).parse(args);
      const rows =
        (
          await env.churchcore
            .prepare(
              `SELECT id,group_id AS groupId,title,description,location,start_at AS startAt,end_at AS endAt,created_by_person_id AS createdByPersonId,visibility,created_at AS createdAt,updated_at AS updatedAt
               FROM group_events
               WHERE church_id=?1 AND group_id=?2 AND start_at>=?3 AND start_at<=?4
               ORDER BY start_at ASC`,
            )
            .bind(parsed.churchId, parsed.groupId, parsed.fromIso, parsed.toIso)
            .all()
        ).results ?? [];
      return jsonText({ events: rows });
    },
  );

  server.tool(
    "churchcore_group_event_create",
    "Create a group event (any active member).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      groupId: z.string().min(1),
      actorPersonId: z.string().min(1),
      title: z.string().min(1),
      description: z.string().optional().nullable(),
      location: z.string().optional().nullable(),
      startAt: z.string().min(1),
      endAt: z.string().optional().nullable(),
      visibility: z.enum(["members", "leaders"]).optional().nullable(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          groupId: z.string().min(1),
          actorPersonId: z.string().min(1),
          title: z.string().min(1),
          description: z.string().optional().nullable(),
          location: z.string().optional().nullable(),
          startAt: z.string().min(1),
          endAt: z.string().optional().nullable(),
          visibility: z.enum(["members", "leaders"]).optional().nullable(),
        })
        .parse(args);

      const actorRole = await groupActorRole(env, { churchId: parsed.churchId, groupId: parsed.groupId, actorPersonId: parsed.actorPersonId });
      if (actorRole === "none") return jsonText({ ok: false, error: "Not permitted" });

      const id = crypto.randomUUID();
      const now = nowIso();
      await env.churchcore
        .prepare(
          `INSERT INTO group_events (id, church_id, group_id, title, description, location, start_at, end_at, created_by_person_id, visibility, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
        )
        .bind(
          id,
          parsed.churchId,
          parsed.groupId,
          parsed.title,
          parsed.description ?? null,
          parsed.location ?? null,
          parsed.startAt,
          parsed.endAt ?? null,
          parsed.actorPersonId,
          parsed.visibility ?? "members",
          now,
          now,
        )
        .run();

      await auditAppend(env, { churchId: parsed.churchId, actorUserId: null, action: "group_event_create", entityType: "group_events", entityId: id, payload: { groupId: parsed.groupId } });
      return jsonText({ ok: true, eventId: id });
    },
  );

  server.tool(
    "churchcore_group_event_update",
    "Update a group event (creator or leader/host).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      groupId: z.string().min(1),
      eventId: z.string().min(1),
      actorPersonId: z.string().min(1),
      title: z.string().min(1).optional().nullable(),
      description: z.string().optional().nullable(),
      location: z.string().optional().nullable(),
      startAt: z.string().min(1).optional().nullable(),
      endAt: z.string().optional().nullable(),
      visibility: z.enum(["members", "leaders"]).optional().nullable(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          groupId: z.string().min(1),
          eventId: z.string().min(1),
          actorPersonId: z.string().min(1),
          title: z.string().min(1).optional().nullable(),
          description: z.string().optional().nullable(),
          location: z.string().optional().nullable(),
          startAt: z.string().min(1).optional().nullable(),
          endAt: z.string().optional().nullable(),
          visibility: z.enum(["members", "leaders"]).optional().nullable(),
        })
        .parse(args);

      const ev = (await env.churchcore
        .prepare(`SELECT created_by_person_id AS createdBy FROM group_events WHERE church_id=?1 AND id=?2 AND group_id=?3`)
        .bind(parsed.churchId, parsed.eventId, parsed.groupId)
        .first()) as any;
      if (!ev) return jsonText({ ok: false, error: "Event not found" });

      const actorRole = await groupActorRole(env, { churchId: parsed.churchId, groupId: parsed.groupId, actorPersonId: parsed.actorPersonId });
      const isPriv = canManageGroupMembers(actorRole);
      const isCreator = String(ev.createdBy ?? "") && String(ev.createdBy) === parsed.actorPersonId;
      if (!isPriv && !isCreator) return jsonText({ ok: false, error: "Forbidden" });

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
        .bind(parsed.churchId, parsed.eventId, parsed.groupId, parsed.title ?? null, parsed.description ?? null, parsed.location ?? null, parsed.startAt ?? null, parsed.endAt ?? null, parsed.visibility ?? null, now)
        .run();
      await auditAppend(env, { churchId: parsed.churchId, actorUserId: null, action: "group_event_update", entityType: "group_events", entityId: parsed.eventId, payload: { groupId: parsed.groupId } });
      return jsonText({ ok: true });
    },
  );

  server.tool(
    "churchcore_group_event_delete",
    "Delete a group event (creator or leader/host).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      groupId: z.string().min(1),
      eventId: z.string().min(1),
      actorPersonId: z.string().min(1),
    },
    async (args) => {
      const parsed = z
        .object({ churchId: z.string().min(1), groupId: z.string().min(1), eventId: z.string().min(1), actorPersonId: z.string().min(1) })
        .parse(args);
      const ev = (await env.churchcore
        .prepare(`SELECT created_by_person_id AS createdBy FROM group_events WHERE church_id=?1 AND id=?2 AND group_id=?3`)
        .bind(parsed.churchId, parsed.eventId, parsed.groupId)
        .first()) as any;
      if (!ev) return jsonText({ ok: false, error: "Event not found" });

      const actorRole = await groupActorRole(env, { churchId: parsed.churchId, groupId: parsed.groupId, actorPersonId: parsed.actorPersonId });
      const isPriv = canManageGroupMembers(actorRole);
      const isCreator = String(ev.createdBy ?? "") && String(ev.createdBy) === parsed.actorPersonId;
      if (!isPriv && !isCreator) return jsonText({ ok: false, error: "Forbidden" });

      await env.churchcore.prepare(`DELETE FROM group_events WHERE church_id=?1 AND id=?2 AND group_id=?3`).bind(parsed.churchId, parsed.eventId, parsed.groupId).run();
      await auditAppend(env, { churchId: parsed.churchId, actorUserId: null, action: "group_event_delete", entityType: "group_events", entityId: parsed.eventId, payload: { groupId: parsed.groupId } });
      return jsonText({ ok: true });
    },
  );

  server.tool(
    "churchcore_group_bible_study_list",
    "List Bible studies for a group.",
    { churchId: BaseSessionArgs.shape.churchId, groupId: z.string().min(1), includeArchived: z.boolean().optional().nullable() },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), groupId: z.string().min(1), includeArchived: z.boolean().optional().nullable() }).parse(args);
      const includeArchived = Boolean(parsed.includeArchived);
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
            .bind(parsed.churchId, parsed.groupId)
            .all()
        ).results ?? [];
      return jsonText({ studies: rows });
    },
  );

  server.tool(
    "churchcore_group_bible_study_create",
    "Create a Bible study for a group (any active member).",
    { churchId: BaseSessionArgs.shape.churchId, groupId: z.string().min(1), actorPersonId: z.string().min(1), title: z.string().min(1), description: z.string().optional().nullable() },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), groupId: z.string().min(1), actorPersonId: z.string().min(1), title: z.string().min(1), description: z.string().optional().nullable() }).parse(args);
      const actorRole = await groupActorRole(env, { churchId: parsed.churchId, groupId: parsed.groupId, actorPersonId: parsed.actorPersonId });
      if (actorRole === "none") return jsonText({ ok: false, error: "Not permitted" });
      const id = crypto.randomUUID();
      const now = nowIso();
      await env.churchcore
        .prepare(
          `INSERT INTO group_bible_studies (id, church_id, group_id, title, description, status, created_by_person_id, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?8)`,
        )
        .bind(id, parsed.churchId, parsed.groupId, parsed.title, parsed.description ?? null, parsed.actorPersonId, now, now)
        .run();
      await auditAppend(env, { churchId: parsed.churchId, actorUserId: null, action: "group_bible_study_create", entityType: "group_bible_studies", entityId: id, payload: { groupId: parsed.groupId } });
      return jsonText({ ok: true, bibleStudyId: id });
    },
  );

  server.tool(
    "churchcore_group_bible_study_add_reading",
    "Add a Scripture reading reference to a Bible study.",
    {
      churchId: BaseSessionArgs.shape.churchId,
      bibleStudyId: z.string().min(1),
      actorPersonId: z.string().min(1),
      ref: z.string().min(1),
      orderIndex: z.number().int().min(0).max(100000).optional().nullable(),
      notes: z.string().optional().nullable(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          bibleStudyId: z.string().min(1),
          actorPersonId: z.string().min(1),
          ref: z.string().min(1),
          orderIndex: z.number().int().min(0).max(100000).optional().nullable(),
          notes: z.string().optional().nullable(),
        })
        .parse(args);
      const study = (await env.churchcore
        .prepare(
          `SELECT bs.id, bs.group_id AS groupId
           FROM group_bible_studies bs
           WHERE bs.church_id=?1 AND bs.id=?2`,
        )
        .bind(parsed.churchId, parsed.bibleStudyId)
        .first()) as any;
      if (!study) return jsonText({ ok: false, error: "Bible study not found" });

      const actorRole = await groupActorRole(env, { churchId: parsed.churchId, groupId: String(study.groupId), actorPersonId: parsed.actorPersonId });
      if (actorRole === "none") return jsonText({ ok: false, error: "Not permitted" });

      const id = crypto.randomUUID();
      const now = nowIso();
      await env.churchcore
        .prepare(
          `INSERT INTO group_bible_study_readings (id, church_id, bible_study_id, ref, order_index, notes, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(id, parsed.churchId, parsed.bibleStudyId, parsed.ref, parsed.orderIndex ?? 0, parsed.notes ?? null, now)
        .run();
      await auditAppend(env, { churchId: parsed.churchId, actorUserId: null, action: "group_bible_study_add_reading", entityType: "group_bible_study_readings", entityId: id, payload: { bibleStudyId: parsed.bibleStudyId } });
      return jsonText({ ok: true, readingId: id });
    },
  );

  server.tool(
    "churchcore_group_bible_study_add_note",
    "Add a note to a Bible study.",
    {
      churchId: BaseSessionArgs.shape.churchId,
      bibleStudyId: z.string().min(1),
      actorPersonId: z.string().min(1),
      contentMarkdown: z.string().min(1),
      visibility: z.enum(["members", "leaders"]).optional().nullable(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          bibleStudyId: z.string().min(1),
          actorPersonId: z.string().min(1),
          contentMarkdown: z.string().min(1),
          visibility: z.enum(["members", "leaders"]).optional().nullable(),
        })
        .parse(args);
      const study = (await env.churchcore
        .prepare(`SELECT group_id AS groupId FROM group_bible_studies WHERE church_id=?1 AND id=?2`)
        .bind(parsed.churchId, parsed.bibleStudyId)
        .first()) as any;
      if (!study) return jsonText({ ok: false, error: "Bible study not found" });
      const actorRole = await groupActorRole(env, { churchId: parsed.churchId, groupId: String(study.groupId), actorPersonId: parsed.actorPersonId });
      if (actorRole === "none") return jsonText({ ok: false, error: "Not permitted" });

      const id = crypto.randomUUID();
      const now = nowIso();
      await env.churchcore
        .prepare(
          `INSERT INTO group_bible_study_notes (id, church_id, bible_study_id, author_person_id, content_markdown, visibility, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(id, parsed.churchId, parsed.bibleStudyId, parsed.actorPersonId, parsed.contentMarkdown, parsed.visibility ?? "members", now)
        .run();
      await auditAppend(env, { churchId: parsed.churchId, actorUserId: null, action: "group_bible_study_add_note", entityType: "group_bible_study_notes", entityId: id, payload: { bibleStudyId: parsed.bibleStudyId } });
      return jsonText({ ok: true, noteId: id });
    },
  );

  server.tool(
    "churchcore_group_bible_study_sessions_list",
    "List Bible study sessions.",
    { churchId: BaseSessionArgs.shape.churchId, bibleStudyId: z.string().min(1) },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), bibleStudyId: z.string().min(1) }).parse(args);
      const rows =
        (
          await env.churchcore
            .prepare(
              `SELECT id,bible_study_id AS bibleStudyId,session_at AS sessionAt,title,agenda,created_at AS createdAt,updated_at AS updatedAt
               FROM group_bible_study_sessions
               WHERE church_id=?1 AND bible_study_id=?2
               ORDER BY session_at DESC`,
            )
            .bind(parsed.churchId, parsed.bibleStudyId)
            .all()
        ).results ?? [];
      return jsonText({ sessions: rows });
    },
  );

  server.tool(
    "churchcore_group_bible_study_session_create",
    "Create a Bible study session (any active member of the study's group).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      bibleStudyId: z.string().min(1),
      actorPersonId: z.string().min(1),
      sessionAt: z.string().min(1),
      title: z.string().optional().nullable(),
      agenda: z.string().optional().nullable(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          bibleStudyId: z.string().min(1),
          actorPersonId: z.string().min(1),
          sessionAt: z.string().min(1),
          title: z.string().optional().nullable(),
          agenda: z.string().optional().nullable(),
        })
        .parse(args);
      const study = (await env.churchcore
        .prepare(`SELECT group_id AS groupId FROM group_bible_studies WHERE church_id=?1 AND id=?2`)
        .bind(parsed.churchId, parsed.bibleStudyId)
        .first()) as any;
      if (!study) return jsonText({ ok: false, error: "Bible study not found" });
      const actorRole = await groupActorRole(env, { churchId: parsed.churchId, groupId: String(study.groupId), actorPersonId: parsed.actorPersonId });
      if (actorRole === "none") return jsonText({ ok: false, error: "Not permitted" });

      const id = crypto.randomUUID();
      const now = nowIso();
      await env.churchcore
        .prepare(
          `INSERT INTO group_bible_study_sessions (id, church_id, bible_study_id, session_at, title, agenda, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
        )
        .bind(id, parsed.churchId, parsed.bibleStudyId, parsed.sessionAt, parsed.title ?? null, parsed.agenda ?? null, now, now)
        .run();
      await auditAppend(env, { churchId: parsed.churchId, actorUserId: null, action: "group_bible_study_session_create", entityType: "group_bible_study_sessions", entityId: id, payload: { bibleStudyId: parsed.bibleStudyId } });
      return jsonText({ ok: true, sessionId: id });
    },
  );

  server.tool(
    "churchcore_list_volunteer_opportunities",
    "List volunteer opportunities (authoritative).",
    {
      churchId: BaseSessionArgs.shape.churchId,
      campusId: BaseSessionArgs.shape.campusId,
    },
    async (args) => {
      const churchId = String((args as any).churchId);
      const campusId = (args as any).campusId ? String((args as any).campusId) : null;

      const q = campusId
        ? env.churchcore
            .prepare(
              `SELECT id,title,description,contact_email
               FROM opportunities WHERE church_id=?1 AND campus_id=?2
               ORDER BY title ASC`,
            )
            .bind(churchId, campusId)
        : env.churchcore
            .prepare(
              `SELECT id,title,description,contact_email
               FROM opportunities WHERE church_id=?1
               ORDER BY title ASC`,
            )
            .bind(churchId);

      const rows = (await q.all()).results ?? [];
      return jsonText({ opportunities: rows });
    },
  );

  // Community catalog + participation (broader than groups/opportunities/events)
  server.tool(
    "churchcore_list_community_catalog",
    "List community catalog items (authoritative).",
    {
      churchId: z.string().min(1),
      campusId: z.string().min(1).optional().nullable(),
      kind: z.string().min(1).optional().nullable(),
      search: z.string().min(1).optional().nullable(),
      includeInactive: z.boolean().optional().nullable(),
      limit: z.number().int().min(1).max(200).optional().nullable(),
      offset: z.number().int().min(0).max(500000).optional().nullable(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          campusId: z.string().min(1).optional().nullable(),
          kind: z.string().min(1).optional().nullable(),
          search: z.string().min(1).optional().nullable(),
          includeInactive: z.boolean().optional().nullable(),
          limit: z.number().int().min(1).max(200).optional().nullable(),
          offset: z.number().int().min(0).max(500000).optional().nullable(),
        })
        .parse(args);

      const lim = parsed.limit ?? 100;
      const off = parsed.offset ?? 0;
      const includeInactive = Boolean(parsed.includeInactive);

      let sql = `SELECT id,campus_id,kind,title,description,source_url,signup_url,start_at,end_at,tags_json,is_active,created_at,updated_at
                 FROM community_catalog
                 WHERE church_id=?1`;
      const binds: any[] = [parsed.churchId];

      if (parsed.campusId) {
        sql += ` AND (campus_id=?${binds.length + 1} OR campus_id IS NULL)`;
        binds.push(parsed.campusId);
      }
      if (parsed.kind) {
        sql += ` AND kind=?${binds.length + 1}`;
        binds.push(parsed.kind);
      }
      if (!includeInactive) sql += ` AND is_active=1`;
      if (parsed.search) {
        sql += ` AND (lower(title) LIKE ?${binds.length + 1} OR lower(description) LIKE ?${binds.length + 1})`;
        binds.push(`%${String(parsed.search).toLowerCase()}%`);
      }

      sql += ` ORDER BY kind ASC, title ASC LIMIT ${lim} OFFSET ${off}`;
      const rows = (await env.churchcore.prepare(sql).bind(...binds).all()).results ?? [];
      return jsonText({ items: rows });
    },
  );

  server.tool(
    "churchcore_list_person_community",
    "List a person's community involvement (authoritative).",
    {
      churchId: z.string().min(1),
      personId: z.string().min(1),
      status: z.string().min(1).optional().nullable(), // optional filter
      includeInactive: z.boolean().optional().nullable(),
      limit: z.number().int().min(1).max(200).optional().nullable(),
      offset: z.number().int().min(0).max(500000).optional().nullable(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          personId: z.string().min(1),
          status: z.string().min(1).optional().nullable(),
          includeInactive: z.boolean().optional().nullable(),
          limit: z.number().int().min(1).max(200).optional().nullable(),
          offset: z.number().int().min(0).max(500000).optional().nullable(),
        })
        .parse(args);

      const lim = parsed.limit ?? 100;
      const off = parsed.offset ?? 0;
      const includeInactive = Boolean(parsed.includeInactive);

      let sql = `SELECT pc.community_id AS communityId, pc.status, pc.role, pc.joined_at AS joinedAt, pc.left_at AS leftAt, pc.notes_json AS notesJson, pc.updated_at AS updatedAt,
                        cc.campus_id AS campusId, cc.kind, cc.title, cc.description, cc.source_url AS sourceUrl, cc.signup_url AS signupUrl, cc.start_at AS startAt, cc.end_at AS endAt, cc.tags_json AS tagsJson, cc.is_active AS isActive
                 FROM person_community pc
                 JOIN community_catalog cc ON cc.id = pc.community_id
                 WHERE pc.church_id=?1 AND pc.person_id=?2`;
      const binds: any[] = [parsed.churchId, parsed.personId];

      if (parsed.status) {
        sql += ` AND pc.status=?${binds.length + 1}`;
        binds.push(parsed.status);
      } else if (!includeInactive) {
        sql += ` AND pc.status!='inactive'`;
      }

      sql += ` ORDER BY pc.updated_at DESC LIMIT ${lim} OFFSET ${off}`;
      const rows = (await env.churchcore.prepare(sql).bind(...binds).all()).results ?? [];
      return jsonText({ items: rows });
    },
  );

  server.tool(
    "churchcore_upsert_person_community",
    "Join/leave/mark a person's community involvement (write).",
    {
      churchId: z.string().min(1),
      personId: z.string().min(1),
      communityId: z.string().min(1),
      status: z.enum(["pending", "active", "inactive", "attended", "completed"]),
      role: z.enum(["participant", "leader"]).optional().nullable(),
      notes: z.any().optional().nullable(),
      actorUserId: z.string().optional().nullable(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          personId: z.string().min(1),
          communityId: z.string().min(1),
          status: z.enum(["pending", "active", "inactive", "attended", "completed"]),
          role: z.enum(["participant", "leader"]).optional().nullable(),
          notes: z.any().optional().nullable(),
          actorUserId: z.string().optional().nullable(),
        })
        .parse(args);

      const now = nowIso();
      const existing = (await env.churchcore
        .prepare(
          `SELECT status, role, joined_at AS joinedAt, left_at AS leftAt
           FROM person_community
           WHERE church_id=?1 AND person_id=?2 AND community_id=?3`,
        )
        .bind(parsed.churchId, parsed.personId, parsed.communityId)
        .first()) as any;

      const nextRole = parsed.role ?? (typeof existing?.role === "string" ? existing.role : "participant");
      const priorJoinedAt = typeof existing?.joinedAt === "string" ? existing.joinedAt : null;
      const priorLeftAt = typeof existing?.leftAt === "string" ? existing.leftAt : null;

      const joinedAt = (parsed.status === "active" || parsed.status === "pending") && !priorJoinedAt ? now : priorJoinedAt;
      const leftAt = parsed.status === "inactive" ? now : parsed.status === "active" || parsed.status === "pending" ? null : priorLeftAt;

      await env.churchcore
        .prepare(
          `INSERT INTO person_community (church_id, person_id, community_id, status, role, joined_at, left_at, notes_json, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT(church_id, person_id, community_id) DO UPDATE SET
             status=excluded.status,
             role=excluded.role,
             joined_at=excluded.joined_at,
             left_at=excluded.left_at,
             notes_json=excluded.notes_json,
             updated_at=excluded.updated_at`,
        )
        .bind(
          parsed.churchId,
          parsed.personId,
          parsed.communityId,
          parsed.status,
          nextRole,
          joinedAt,
          leftAt,
          parsed.notes !== undefined ? JSON.stringify(parsed.notes) : null,
          now,
        )
        .run();

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.actorUserId ?? null,
        action: "person.community.upsert",
        entityType: "person_community",
        entityId: `${parsed.personId}:${parsed.communityId}`,
        payload: { personId: parsed.personId, communityId: parsed.communityId, status: parsed.status, role: nextRole },
      });

      return jsonText({ ok: true });
    },
  );

  server.tool(
    "churchcore_request_contact",
    "Create a contact request (write).",
    {
      churchId: z.string().min(1),
      userId: z.string().min(1),
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      message: z.string().optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          userId: z.string().min(1),
          name: z.string().optional(),
          email: z.string().optional(),
          phone: z.string().optional(),
          message: z.string().optional(),
        })
        .parse(args);

      const id = crypto.randomUUID();
      const payload = {
        name: parsed.name ?? null,
        email: parsed.email ?? null,
        phone: parsed.phone ?? null,
        message: parsed.message ?? null,
      };

      await env.churchcore
        .prepare(
          `INSERT INTO requests (id, church_id, campus_id, user_id, type, status, payload_json, assigned_to_user_id, created_at, updated_at)
           VALUES (?1, ?2, NULL, ?3, 'contact', 'open', ?4, NULL, ?5, ?6)`,
        )
        .bind(id, parsed.churchId, parsed.userId, JSON.stringify(payload), nowIso(), nowIso())
        .run();

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.userId,
        action: "request.contact.create",
        entityType: "requests",
        entityId: id,
        payload,
      });

      return jsonText({ requestId: id, ok: true });
    },
  );

  server.tool(
    "churchcore_schedule_visit_request",
    "Create a visit request (write).",
    {
      churchId: z.string().min(1),
      userId: z.string().min(1),
      preferredDate: z.string().optional(),
      preferredServiceId: z.string().optional(),
      notes: z.string().optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          userId: z.string().min(1),
          preferredDate: z.string().optional(),
          preferredServiceId: z.string().optional(),
          notes: z.string().optional(),
        })
        .parse(args);

      const id = crypto.randomUUID();
      const payload = {
        preferredDate: parsed.preferredDate ?? null,
        preferredServiceId: parsed.preferredServiceId ?? null,
        notes: parsed.notes ?? null,
      };

      await env.churchcore
        .prepare(
          `INSERT INTO requests (id, church_id, campus_id, user_id, type, status, payload_json, assigned_to_user_id, created_at, updated_at)
           VALUES (?1, ?2, NULL, ?3, 'visit', 'open', ?4, NULL, ?5, ?6)`,
        )
        .bind(id, parsed.churchId, parsed.userId, JSON.stringify(payload), nowIso(), nowIso())
        .run();

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.userId,
        action: "request.visit.create",
        entityType: "requests",
        entityId: id,
        payload,
      });

      return jsonText({ requestId: id, ok: true });
    },
  );

  server.tool(
    "churchcore_submit_serve_interest",
    "Submit serving interest (write).",
    {
      churchId: z.string().min(1),
      userId: z.string().min(1),
      interests: z.any().optional(),
      notes: z.string().optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          userId: z.string().min(1),
          interests: z.any().optional(),
          notes: z.string().optional(),
        })
        .parse(args);

      const id = crypto.randomUUID();
      const payload = {
        interests: parsed.interests ?? null,
        notes: parsed.notes ?? null,
      };

      await env.churchcore
        .prepare(
          `INSERT INTO requests (id, church_id, campus_id, user_id, type, status, payload_json, assigned_to_user_id, created_at, updated_at)
           VALUES (?1, ?2, NULL, ?3, 'serve_interest', 'open', ?4, NULL, ?5, ?6)`,
        )
        .bind(id, parsed.churchId, parsed.userId, JSON.stringify(payload), nowIso(), nowIso())
        .run();

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.userId,
        action: "request.serve_interest.create",
        entityType: "requests",
        entityId: id,
        payload,
      });

      return jsonText({ requestId: id, ok: true });
    },
  );

  server.tool(
    "churchcore_submit_prayer_request",
    "Submit a prayer request (write).",
    {
      churchId: z.string().min(1),
      userId: z.string().min(1),
      request: z.string().min(1),
      isPrivate: z.boolean().optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          userId: z.string().min(1),
          request: z.string().min(1),
          isPrivate: z.boolean().optional(),
        })
        .parse(args);

      const id = crypto.randomUUID();
      const payload = { request: parsed.request, isPrivate: parsed.isPrivate ?? true };

      await env.churchcore
        .prepare(
          `INSERT INTO requests (id, church_id, campus_id, user_id, type, status, payload_json, assigned_to_user_id, created_at, updated_at)
           VALUES (?1, ?2, NULL, ?3, 'prayer', 'open', ?4, NULL, ?5, ?6)`,
        )
        .bind(id, parsed.churchId, parsed.userId, JSON.stringify(payload), nowIso(), nowIso())
        .run();

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.userId,
        action: "request.prayer.create",
        entityType: "requests",
        entityId: id,
        payload,
      });

      return jsonText({ requestId: id, ok: true });
    },
  );

  server.tool(
    "churchcore_request_pastoral_care",
    "Submit a pastoral care request (write).",
    {
      churchId: z.string().min(1),
      userId: z.string().min(1),
      request: z.string().min(1),
      urgency: z.enum(["low", "normal", "high"]).optional(),
      safeToText: z.boolean().optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          userId: z.string().min(1),
          request: z.string().min(1),
          urgency: z.enum(["low", "normal", "high"]).optional(),
          safeToText: z.boolean().optional(),
        })
        .parse(args);

      const id = crypto.randomUUID();
      const payload = { request: parsed.request, urgency: parsed.urgency ?? "normal", safeToText: parsed.safeToText ?? false };

      await env.churchcore
        .prepare(
          `INSERT INTO requests (id, church_id, campus_id, user_id, type, status, payload_json, assigned_to_user_id, created_at, updated_at)
           VALUES (?1, ?2, NULL, ?3, 'pastoral_care', 'open', ?4, NULL, ?5, ?6)`,
        )
        .bind(id, parsed.churchId, parsed.userId, JSON.stringify(payload), nowIso(), nowIso())
        .run();

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.userId,
        action: "request.pastoral_care.create",
        entityType: "requests",
        entityId: id,
        payload,
      });

      return jsonText({ requestId: id, ok: true });
    },
  );

  server.tool(
    "churchcore_permissions_check",
    "Canonical authz check for guide/staff.",
    {
      churchId: z.string().min(1),
      userId: z.string().min(1),
      requestedRole: z.string().optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          userId: z.string().min(1),
          requestedRole: z.string().optional(),
        })
        .parse(args);

      const roles = (
        await env.churchcore
          .prepare(`SELECT role FROM roles WHERE church_id=?1 AND user_id=?2`)
          .bind(parsed.churchId, parsed.userId)
          .all()
      ).results as any[];

      const roleList = (roles ?? []).map((r) => String(r.role));
      const requested = (parsed.requestedRole ?? "").trim();
      const allowed =
        !requested ? true : requested === "guide" ? roleList.includes("guide") || roleList.includes("staff") : roleList.includes(requested);

      return jsonText({ allowed, roles: roleList });
    },
  );

  server.tool(
    "churchcore_membership_status",
    "Get membership status for a userId (local D1).",
    {
      churchId: z.string().min(1),
      userId: z.string().min(1),
    },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), userId: z.string().min(1) }).parse(args);
      const row = (
        await env.churchcore
          .prepare(`SELECT status, updated_at FROM memberships WHERE church_id=?1 AND user_id=?2`)
          .bind(parsed.churchId, parsed.userId)
          .first()
      ) as any;
      return jsonText({ status: row?.status ?? "unknown", updatedAt: row?.updated_at ?? null });
    },
  );

  // Guide-only tools (agent must check churchcore_permissions_check)
  server.tool(
    "churchcore_list_assigned_seekers",
    "List seekers assigned to a guide userId.",
    {
      churchId: z.string().min(1),
      guideUserId: z.string().min(1),
    },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), guideUserId: z.string().min(1) }).parse(args);
      const rows =
        (
          await env.churchcore
            .prepare(
              `SELECT p.id, p.first_name, p.last_name, p.email, p.phone
               FROM assignments a
               JOIN people p ON p.id = a.seeker_id
               WHERE a.church_id=?1 AND a.guide_user_id=?2
               ORDER BY p.last_name ASC, p.first_name ASC`,
            )
            .bind(parsed.churchId, parsed.guideUserId)
            .all()
        ).results ?? [];
      return jsonText({ seekers: rows });
    },
  );

  server.tool(
    "churchcore_get_seeker_profile",
    "Get a seeker profile by seekerId (people.id).",
    {
      churchId: z.string().min(1),
      seekerId: z.string().min(1),
    },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), seekerId: z.string().min(1) }).parse(args);
      const row = (
        await env.churchcore
          .prepare(`SELECT * FROM people WHERE church_id=?1 AND id=?2`)
          .bind(parsed.churchId, parsed.seekerId)
          .first()
      ) as any;
      return jsonText({ seeker: row ?? null });
    },
  );

  server.tool(
    "churchcore_get_journey_state",
    "Get journey_state JSON by seekerId.",
    {
      churchId: z.string().min(1),
      seekerId: z.string().min(1),
    },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), seekerId: z.string().min(1) }).parse(args);
      const row = (
        await env.churchcore
          .prepare(`SELECT state_json, updated_at FROM journey_state WHERE church_id=?1 AND seeker_id=?2`)
          .bind(parsed.churchId, parsed.seekerId)
          .first()
      ) as any;
      const state = row?.state_json ? JSON.parse(String(row.state_json)) : null;
      return jsonText({ state, updatedAt: row?.updated_at ?? null });
    },
  );

  server.tool(
    "churchcore_append_journey_note",
    "Append a journey note for a seeker.",
    {
      churchId: z.string().min(1),
      seekerId: z.string().min(1),
      authorUserId: z.string().min(1),
      note: z.string().min(1),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          seekerId: z.string().min(1),
          authorUserId: z.string().min(1),
          note: z.string().min(1),
        })
        .parse(args);

      const id = crypto.randomUUID();
      await env.churchcore
        .prepare(
          `INSERT INTO journey_notes (id, church_id, seeker_id, author_user_id, note, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(id, parsed.churchId, parsed.seekerId, parsed.authorUserId, parsed.note, nowIso())
        .run();

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.authorUserId,
        action: "journey.note.append",
        entityType: "journey_notes",
        entityId: id,
        payload: { seekerId: parsed.seekerId },
      });

      return jsonText({ noteId: id, ok: true });
    },
  );

  server.tool(
    "churchcore_create_followup_task",
    "Create a follow-up task for a seeker.",
    {
      churchId: z.string().min(1),
      seekerId: z.string().min(1),
      assignedToUserId: z.string().min(1),
      title: z.string().min(1),
      dueAt: z.string().optional(),
      notes: z.string().optional(),
      actorUserId: z.string().optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          seekerId: z.string().min(1),
          assignedToUserId: z.string().min(1),
          title: z.string().min(1),
          dueAt: z.string().optional(),
          notes: z.string().optional(),
          actorUserId: z.string().optional(),
        })
        .parse(args);

      const id = crypto.randomUUID();
      await env.churchcore
        .prepare(
          `INSERT INTO followups (id, church_id, seeker_id, assigned_to_user_id, title, due_at, status, notes, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'open', ?7, ?8, ?9)`,
        )
        .bind(
          id,
          parsed.churchId,
          parsed.seekerId,
          parsed.assignedToUserId,
          parsed.title,
          parsed.dueAt ?? null,
          parsed.notes ?? null,
          nowIso(),
          nowIso(),
        )
        .run();

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.actorUserId ?? null,
        action: "followup.create",
        entityType: "followups",
        entityId: id,
        payload: { seekerId: parsed.seekerId, assignedToUserId: parsed.assignedToUserId, title: parsed.title, dueAt: parsed.dueAt ?? null },
      });

      return jsonText({ followupId: id, ok: true });
    },
  );

  server.tool(
    "churchcore_assign_guide",
    "Assign a guide to a seeker (creates assignment row).",
    {
      churchId: z.string().min(1),
      seekerId: z.string().min(1),
      guideUserId: z.string().min(1),
      actorUserId: z.string().optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          seekerId: z.string().min(1),
          guideUserId: z.string().min(1),
          actorUserId: z.string().optional(),
        })
        .parse(args);

      const id = crypto.randomUUID();
      await env.churchcore
        .prepare(
          `INSERT INTO assignments (id, church_id, seeker_id, guide_user_id, assigned_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(church_id, seeker_id, guide_user_id) DO UPDATE SET assigned_at=excluded.assigned_at`,
        )
        .bind(id, parsed.churchId, parsed.seekerId, parsed.guideUserId, nowIso())
        .run();

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.actorUserId ?? null,
        action: "assignment.guide.upsert",
        entityType: "assignments",
        entityId: id,
        payload: { seekerId: parsed.seekerId, guideUserId: parsed.guideUserId },
      });

      return jsonText({ assignmentId: id, ok: true });
    },
  );

  server.tool(
    "churchcore_list_requests",
    "List requests for triage (care queue).",
    {
      churchId: z.string().min(1),
      status: z.string().optional(),
      type: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          status: z.string().optional(),
          type: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .parse(args);

      const limit = parsed.limit ?? 50;
      const status = parsed.status ?? "open";

      const rows =
        (
          await env.churchcore
            .prepare(
              `SELECT id,user_id,type,status,payload_json,assigned_to_user_id,created_at,updated_at
               FROM requests
               WHERE church_id=?1 AND status=?2
               ${parsed.type ? "AND type=?3" : ""}
               ORDER BY created_at ASC
               LIMIT ${limit}`,
            )
            .bind(parsed.churchId, status, ...(parsed.type ? [parsed.type] : []))
            .all()
        ).results ?? [];

      const out = rows.map((r: any) => ({
        ...r,
        payload: r?.payload_json ? JSON.parse(String(r.payload_json)) : null,
      }));

      return jsonText({ requests: out });
    },
  );

  server.tool(
    "churchcore_assign_care_case",
    "Assign a request/case to a guide/staff user.",
    { churchId: z.string().min(1), requestId: z.string().min(1), assignedToUserId: z.string().min(1), actorUserId: z.string().optional() },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          requestId: z.string().min(1),
          assignedToUserId: z.string().min(1),
          actorUserId: z.string().optional(),
        })
        .parse(args);

      await env.churchcore
        .prepare(`UPDATE requests SET status='assigned', assigned_to_user_id=?1, updated_at=?2 WHERE church_id=?3 AND id=?4`)
        .bind(parsed.assignedToUserId, nowIso(), parsed.churchId, parsed.requestId)
        .run();

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.actorUserId ?? null,
        action: "care.case.assign",
        entityType: "requests",
        entityId: parsed.requestId,
        payload: { assignedToUserId: parsed.assignedToUserId },
      });

      return jsonText({ ok: true });
    },
  );

  server.tool(
    "churchcore_escalate_to_staff",
    "Escalate a request/case (status=escalated).",
    { churchId: z.string().min(1), requestId: z.string().min(1), actorUserId: z.string().optional(), reason: z.string().optional() },
    async (args) => {
      const parsed = z
        .object({ churchId: z.string().min(1), requestId: z.string().min(1), actorUserId: z.string().optional(), reason: z.string().optional() })
        .parse(args);

      await env.churchcore
        .prepare(`UPDATE requests SET status='escalated', updated_at=?1 WHERE church_id=?2 AND id=?3`)
        .bind(nowIso(), parsed.churchId, parsed.requestId)
        .run();

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.actorUserId ?? null,
        action: "care.case.escalate",
        entityType: "requests",
        entityId: parsed.requestId,
        payload: { reason: parsed.reason ?? null },
      });

      return jsonText({ ok: true });
    },
  );

  server.tool(
    "churchcore_close_case",
    "Close a request/case (status=closed).",
    { churchId: z.string().min(1), requestId: z.string().min(1), actorUserId: z.string().optional(), resolution: z.string().optional() },
    async (args) => {
      const parsed = z
        .object({ churchId: z.string().min(1), requestId: z.string().min(1), actorUserId: z.string().optional(), resolution: z.string().optional() })
        .parse(args);

      await env.churchcore
        .prepare(`UPDATE requests SET status='closed', updated_at=?1 WHERE church_id=?2 AND id=?3`)
        .bind(nowIso(), parsed.churchId, parsed.requestId)
        .run();

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.actorUserId ?? null,
        action: "care.case.close",
        entityType: "requests",
        entityId: parsed.requestId,
        payload: { resolution: parsed.resolution ?? null },
      });

      return jsonText({ ok: true });
    },
  );

  server.tool(
    "churchcore_audit_log_append",
    "Append an audit log entry.",
    {
      churchId: z.string().min(1),
      actorUserId: z.string().optional(),
      action: z.string().min(1),
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      payload: z.any().optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          actorUserId: z.string().optional(),
          action: z.string().min(1),
          entityType: z.string().optional(),
          entityId: z.string().optional(),
          payload: z.any().optional(),
        })
        .parse(args);

      const id = await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.actorUserId ?? null,
        action: parsed.action,
        entityType: parsed.entityType ?? null,
        entityId: parsed.entityId ?? null,
        payload: parsed.payload,
      });
      return jsonText({ auditId: id, ok: true });
    },
  );

  // Knowledge base persistence (embeddings built by the hosted agent)
  server.tool(
    "churchcore_kb_list_chunks",
    "List persisted KB chunks for a church (for fast startup).",
    {
      churchId: z.string().min(1),
      limit: z.number().int().min(1).max(5000).optional(),
      offset: z.number().int().min(0).max(500000).optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          limit: z.number().int().min(1).max(5000).optional(),
          offset: z.number().int().min(0).max(500000).optional(),
        })
        .parse(args);

      const limit = parsed.limit ?? 2000;
      const offset = parsed.offset ?? 0;

      const rows =
        (
          await env.churchcore
            .prepare(
              `SELECT id AS chunkId, source_id AS sourceId, text, embedding_json AS embeddingJson
               FROM kb_chunks
               WHERE church_id=?1
               ORDER BY source_id ASC, id ASC
               LIMIT ${limit} OFFSET ${offset}`,
            )
            .bind(parsed.churchId)
            .all()
        ).results ?? [];

      const chunks = rows
        .map((r: any) => {
          try {
            const emb = JSON.parse(String(r.embeddingJson ?? "[]"));
            return { chunkId: String(r.chunkId), sourceId: String(r.sourceId), text: String(r.text ?? ""), embedding: emb };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      return jsonText({ chunks });
    },
  );

  server.tool(
    "churchcore_kb_upsert_chunks",
    "Upsert persisted KB chunks for a church (best effort).",
    {
      churchId: z.string().min(1),
      chunks: z
        .array(
          z.object({
            chunkId: z.string().min(1),
            sourceId: z.string().min(1),
            text: z.string().min(1),
            embedding: z.array(z.number()),
          }),
        )
        .min(1)
        .max(500),
      actorUserId: z.string().optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          chunks: z
            .array(
              z.object({
                chunkId: z.string().min(1),
                sourceId: z.string().min(1),
                text: z.string().min(1),
                embedding: z.array(z.number()),
              }),
            )
            .min(1)
            .max(500),
          actorUserId: z.string().optional(),
        })
        .parse(args);

      const now = nowIso();
      const stmt = env.churchcore.prepare(
        `INSERT INTO kb_chunks (id, church_id, source_id, text, embedding_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
           church_id=excluded.church_id,
           source_id=excluded.source_id,
           text=excluded.text,
           embedding_json=excluded.embedding_json,
           updated_at=excluded.updated_at`,
      );

      const batch: D1PreparedStatement[] = [];
      for (const c of parsed.chunks) {
        batch.push(
          stmt.bind(
            c.chunkId,
            parsed.churchId,
            c.sourceId,
            c.text,
            JSON.stringify(c.embedding),
            now,
            now,
          ),
        );
      }

      await env.churchcore.batch(batch);

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.actorUserId ?? null,
        action: "kb.chunks.upsert",
        entityType: "kb_chunks",
        entityId: null,
        payload: { count: parsed.chunks.length },
      });

      return jsonText({ ok: true, upserted: parsed.chunks.length });
    },
  );

  // Content docs in D1 (source-of-truth for KB content; no local markdown files)
  server.tool(
    "churchcore_content_list_docs",
    "List rich content docs stored in D1.",
    {
      churchId: z.string().min(1),
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      locale: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional(),
      offset: z.number().int().min(0).max(500000).optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          entityType: z.string().optional(),
          entityId: z.string().optional(),
          locale: z.string().optional(),
          limit: z.number().int().min(1).max(500).optional(),
          offset: z.number().int().min(0).max(500000).optional(),
        })
        .parse(args);

      const limit = parsed.limit ?? 200;
      const offset = parsed.offset ?? 0;

      let sql = `SELECT id AS docId, entity_type AS entityType, entity_id AS entityId, locale, title, body_markdown AS bodyMarkdown, updated_at AS updatedAt
                 FROM content_docs
                 WHERE church_id=?1`;
      const binds: any[] = [parsed.churchId];

      if (parsed.entityType) {
        sql += ` AND entity_type=?${binds.length + 1}`;
        binds.push(parsed.entityType);
      }
      if (parsed.entityId) {
        sql += ` AND entity_id=?${binds.length + 1}`;
        binds.push(parsed.entityId);
      }
      if (parsed.locale) {
        sql += ` AND locale=?${binds.length + 1}`;
        binds.push(parsed.locale);
      }

      sql += ` ORDER BY updated_at DESC LIMIT ${limit} OFFSET ${offset}`;
      const rows = (await env.churchcore.prepare(sql).bind(...binds).all()).results ?? [];
      return jsonText({ docs: rows });
    },
  );

  server.tool(
    "churchcore_content_get_doc",
    "Get a single rich content doc by docId.",
    { churchId: z.string().min(1), docId: z.string().min(1) },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), docId: z.string().min(1) }).parse(args);
      const row = (
        await env.churchcore
          .prepare(
            `SELECT id AS docId, entity_type AS entityType, entity_id AS entityId, locale, title, body_markdown AS bodyMarkdown, created_at AS createdAt, updated_at AS updatedAt
             FROM content_docs WHERE church_id=?1 AND id=?2`,
          )
          .bind(parsed.churchId, parsed.docId)
          .first()
      ) as any;
      return jsonText({ doc: row ?? null });
    },
  );

  server.tool(
    "churchcore_content_upsert_doc",
    "Create or update a rich content doc in D1.",
    {
      churchId: z.string().min(1),
      docId: z.string().optional(),
      entityType: z.string().min(1),
      entityId: z.string().min(1),
      locale: z.string().min(2).optional(),
      title: z.string().optional(),
      bodyMarkdown: z.string().min(1),
      actorUserId: z.string().optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          docId: z.string().optional(),
          entityType: z.string().min(1),
          entityId: z.string().min(1),
          locale: z.string().min(2).optional(),
          title: z.string().optional(),
          bodyMarkdown: z.string().min(1),
          actorUserId: z.string().optional(),
        })
        .parse(args);

      const id = (parsed.docId ?? crypto.randomUUID()).trim();
      const now = nowIso();
      await env.churchcore
        .prepare(
          `INSERT INTO content_docs (id, church_id, entity_type, entity_id, locale, title, body_markdown, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT(id) DO UPDATE SET
             church_id=excluded.church_id,
             entity_type=excluded.entity_type,
             entity_id=excluded.entity_id,
             locale=excluded.locale,
             title=excluded.title,
             body_markdown=excluded.body_markdown,
             updated_at=excluded.updated_at`,
        )
        .bind(
          id,
          parsed.churchId,
          parsed.entityType,
          parsed.entityId,
          parsed.locale ?? "en",
          parsed.title ?? null,
          parsed.bodyMarkdown,
          now,
          now,
        )
        .run();

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.actorUserId ?? null,
        action: "content.doc.upsert",
        entityType: "content_docs",
        entityId: id,
        payload: { entityType: parsed.entityType, entityId: parsed.entityId, locale: parsed.locale ?? "en" },
      });

      return jsonText({ docId: id, ok: true });
    },
  );

  server.tool(
    "churchcore_kb_export_docs",
    "Export authoritative D1 data as KB docs (no external integrations).",
    { churchId: z.string().min(1), limitPerTable: z.number().int().min(1).max(500).optional() },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), limitPerTable: z.number().int().min(1).max(500).optional() }).parse(args);
      const limit = parsed.limitPerTable ?? 200;

      const church = (await env.churchcore.prepare(`SELECT * FROM churches WHERE id=?1`).bind(parsed.churchId).first()) as any;
      const branding = (await env.churchcore.prepare(`SELECT * FROM church_branding WHERE church_id=?1`).bind(parsed.churchId).first()) as any;
      const campuses = (await env.churchcore.prepare(`SELECT * FROM campuses WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const locations = (await env.churchcore.prepare(`SELECT * FROM locations WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const services = (await env.churchcore.prepare(`SELECT * FROM services WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const servicePlans = (await env.churchcore.prepare(`SELECT * FROM service_plans WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const servicePlanItems = (await env.churchcore.prepare(`SELECT * FROM service_plan_items WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const events = (await env.churchcore.prepare(`SELECT * FROM events WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const outreaches = (await env.churchcore.prepare(`SELECT * FROM outreach_campaigns WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const communityCatalog = (await env.churchcore.prepare(`SELECT * FROM community_catalog WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const groups = (await env.churchcore.prepare(`SELECT * FROM groups WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const opportunities = (await env.churchcore.prepare(`SELECT * FROM opportunities WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const resources = (await env.churchcore.prepare(`SELECT * FROM resources WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const strategicIntents = (await env.churchcore.prepare(`SELECT * FROM strategic_intents WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const strategicLinks = (await env.churchcore.prepare(`SELECT * FROM strategic_intent_links WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const journeyNodes = (await env.churchcore.prepare(`SELECT * FROM journey_node WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const journeyEdges = (await env.churchcore.prepare(`SELECT * FROM journey_edge WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const journeyLinks = (await env.churchcore.prepare(`SELECT * FROM journey_resource_link WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];

      const contentDocs = (
        await env.churchcore
          .prepare(
            `SELECT id AS docId, entity_type AS entityType, entity_id AS entityId, locale, title, body_markdown AS bodyMarkdown, updated_at AS updatedAt
             FROM content_docs WHERE church_id=?1 ORDER BY updated_at DESC LIMIT ${limit}`,
          )
          .bind(parsed.churchId)
          .all()
      ).results ?? [];

      const docs = [
        { sourceId: "church/church.json", text: JSON.stringify({ church, branding, campuses, locations }, null, 2) },
        { sourceId: "church/services.json", text: JSON.stringify({ services, servicePlans, servicePlanItems }, null, 2) },
        { sourceId: "church/events.json", text: JSON.stringify({ events, outreaches }, null, 2) },
        { sourceId: "church/community.json", text: JSON.stringify({ communityCatalog }, null, 2) },
        { sourceId: "church/groups.json", text: JSON.stringify({ groups, opportunities }, null, 2) },
        { sourceId: "church/resources.json", text: JSON.stringify({ resources }, null, 2) },
        { sourceId: "church/strategy.json", text: JSON.stringify({ strategicIntents, strategicLinks }, null, 2) },
        { sourceId: "church/journey_graph.json", text: JSON.stringify({ journeyNodes, journeyEdges, journeyLinks }, null, 2) },
        ...contentDocs.map((d: any) => ({
          sourceId: `content/${String(d.entityType)}/${String(d.entityId)}/${String(d.locale)}#${String(d.docId)}`,
          text: String(d.bodyMarkdown ?? ""),
          title: d.title ?? null,
        })),
      ].filter((d) => typeof (d as any).text === "string" && String((d as any).text).trim());

      return jsonText({ docs });
    },
  );

  server.tool(
    "churchcore_kb_list_tables",
    "List D1 tables for full KB export (for embedding).",
    { churchId: z.string().min(1) },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1) }).parse(args);
      const tables = await d1ListTables(env);
      const out: Array<{ table: string; hasChurchIdFilter: boolean; columns: string[] }> = [];
      for (const t of tables) {
        const cols = await d1TableColumns(env, t);
        const hasChurch = cols.has("church_id") || cols.has("churchId");
        out.push({ table: t, hasChurchIdFilter: hasChurch, columns: [...cols].sort() });
      }
      return jsonText({ churchId: parsed.churchId, tables: out });
    },
  );

  server.tool(
    "churchcore_kb_export_table_docs",
    "Export one D1 table as KB docs (paginated).",
    {
      churchId: z.string().min(1),
      table: z.string().min(1),
      limit: z.number().int().min(1).max(1000).optional(),
      offset: z.number().int().min(0).max(5000000).optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          table: z.string().min(1),
          limit: z.number().int().min(1).max(1000).optional(),
          offset: z.number().int().min(0).max(5000000).optional(),
        })
        .parse(args);

      const table = sanitizeSqlIdent(parsed.table);
      const limit = parsed.limit ?? 200;
      const offset = parsed.offset ?? 0;
      const idBase = String(env.GRAPHDB_ID_BASE ?? "https://id.churchcore.ai").trim().replace(/\/+$/, "");

      const info = await d1TableInfo(env, table);
      const cols = info.map((c) => c.name);
      if (!cols.length) return jsonText({ table, docs: [], offset, limit, hasMore: false });

      const colsSet = new Set(cols);
      const churchCol = pickCol(colsSet, ["church_id", "churchId"]);
      const idCol = pickCol(colsSet, ["id"]);
      const pkCols = info
        .filter((c) => typeof c.pk === "number" && c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);

      const orderCols = (pkCols.length ? pkCols : idCol ? [idCol] : []).map(sanitizeSqlIdent);
      const orderClause = orderCols.length ? `ORDER BY ${orderCols.join(", ")}` : "";
      const selectRowId = orderCols.length ? "" : ", rowid AS __rowid";
      const orderRowId = orderCols.length ? "" : "ORDER BY __rowid";

      const safeCols = cols.map(sanitizeSqlIdent);
      const selectCols = safeCols.map((c) => `${c} AS ${c}`).join(", ");
      const where = churchCol ? `WHERE ${sanitizeSqlIdent(churchCol)}=?1` : "";

      const sql = churchCol
        ? `SELECT ${selectCols}${selectRowId} FROM ${table} ${where} ${orderClause || orderRowId} LIMIT ?2 OFFSET ?3`
        : `SELECT ${selectCols}${selectRowId} FROM ${table} ${where} ${orderClause || orderRowId} LIMIT ?1 OFFSET ?2`;
      const binds = churchCol ? [parsed.churchId, limit, offset] : [limit, offset];
      const rows = await d1All(env, sql, binds as any[]);

      const docs: Array<{ sourceId: string; text: string }> = [];
      for (const r of rows as any[]) {
        let key = "";
        if (pkCols.length && pkCols.every((c) => r?.[c] !== null && r?.[c] !== undefined && String(r?.[c]).trim() !== "")) {
          key = pkCols.map((c) => String(r[c])).join("|");
        } else if (idCol && r?.[idCol] !== null && r?.[idCol] !== undefined && String(r?.[idCol]).trim() !== "") {
          key = String(r[idCol]);
        } else if (r?.__rowid !== null && r?.__rowid !== undefined) {
          key = `rowid:${String(r.__rowid)}`;
        } else {
          key = `h:${(await sha256Hex(JSON.stringify(r))).slice(0, 16)}`;
        }

        const sourceId = `d1/${table}/${key}`;
        const rowIri = `${idBase}/d1raw/${encodeURIComponent(parsed.churchId)}/${encodeURIComponent(table)}/${encodeURIComponent(key)}`;
        const header = `TABLE ${table}\nCHURCH ${parsed.churchId}\nROW ${rowIri}\n`;
        const text = header + "\n" + JSON.stringify(r, null, 2);
        docs.push({ sourceId, text });
      }

      return jsonText({
        table,
        offset,
        limit,
        hasMore: rows.length >= limit,
        nextOffset: offset + rows.length,
        docs,
      });
    },
  );

  // Chat + identity binding (multi-topic messaging)
  async function requireOwnedThread(params: { churchId: string; userId: string; threadId: string }) {
    const row = (
      await env.churchcore
        .prepare(`SELECT id, title, status FROM chat_threads WHERE church_id=?1 AND user_id=?2 AND id=?3`)
        .bind(params.churchId, params.userId, params.threadId)
        .first()
    ) as any;
    return row ?? null;
  }

  server.tool(
    "churchcore_user_get_binding",
    "Get the personId bound to an app userId.",
    { churchId: z.string().min(1), userId: z.string().min(1) },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), userId: z.string().min(1) }).parse(args);
      const row = (
        await env.churchcore
          .prepare(`SELECT person_id AS personId FROM user_person_bindings WHERE church_id=?1 AND user_id=?2`)
          .bind(parsed.churchId, parsed.userId)
          .first()
      ) as any;
      return jsonText({ personId: row?.personId ?? null });
    },
  );

  server.tool(
    "churchcore_user_set_binding",
    "Bind an app userId to a personId (people.id).",
    { churchId: z.string().min(1), userId: z.string().min(1), personId: z.string().min(1), actorUserId: z.string().optional() },
    async (args) => {
      const parsed = z
        .object({ churchId: z.string().min(1), userId: z.string().min(1), personId: z.string().min(1), actorUserId: z.string().optional() })
        .parse(args);

      const person = (
        await env.churchcore.prepare(`SELECT id FROM people WHERE church_id=?1 AND id=?2`).bind(parsed.churchId, parsed.personId).first()
      ) as any;
      if (!person) return jsonText({ ok: false, error: "Unknown personId" });

      const now = nowIso();
      await env.churchcore
        .prepare(
          `INSERT INTO user_person_bindings (church_id, user_id, person_id, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(church_id, user_id) DO UPDATE SET person_id=excluded.person_id, updated_at=excluded.updated_at`,
        )
        .bind(parsed.churchId, parsed.userId, parsed.personId, now, now)
        .run();

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.actorUserId ?? null,
        action: "identity.user_person_binding.set",
        entityType: "user_person_bindings",
        entityId: `${parsed.userId}`,
        payload: { userId: parsed.userId, personId: parsed.personId },
      });

      return jsonText({ ok: true });
    },
  );

  server.tool(
    "churchcore_chat_list_threads",
    "List chat topics for a user.",
    { churchId: z.string().min(1), userId: z.string().min(1), includeArchived: z.boolean().optional() },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), userId: z.string().min(1), includeArchived: z.boolean().optional() }).parse(args);
      const includeArchived = parsed.includeArchived ?? false;
      const rows =
        (
          await env.churchcore
            .prepare(
              `SELECT id, title, status, created_at AS createdAt, updated_at AS updatedAt
               FROM chat_threads
               WHERE church_id=?1 AND user_id=?2 ${includeArchived ? "" : "AND status='active'"}
               ORDER BY updated_at DESC`,
            )
            .bind(parsed.churchId, parsed.userId)
            .all()
        ).results ?? [];
      return jsonText({ threads: rows });
    },
  );

  server.tool(
    "churchcore_chat_create_thread",
    "Create a new chat topic for a user.",
    { churchId: z.string().min(1), userId: z.string().min(1), title: z.string().optional() },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), userId: z.string().min(1), title: z.string().optional() }).parse(args);
      const id = crypto.randomUUID();
      const title = (parsed.title ?? "New topic").trim() || "New topic";
      const now = nowIso();
      await env.churchcore
        .prepare(`INSERT INTO chat_threads (id, church_id, user_id, title, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6)`)
        .bind(id, parsed.churchId, parsed.userId, title, now, now)
        .run();
      return jsonText({ threadId: id, title });
    },
  );

  server.tool(
    "churchcore_chat_rename_thread",
    "Rename a chat topic.",
    { churchId: z.string().min(1), userId: z.string().min(1), threadId: z.string().min(1), title: z.string().min(1) },
    async (args) => {
      const parsed = z
        .object({ churchId: z.string().min(1), userId: z.string().min(1), threadId: z.string().min(1), title: z.string().min(1) })
        .parse(args);
      const now = nowIso();
      await env.churchcore
        .prepare(`UPDATE chat_threads SET title=?1, updated_at=?2 WHERE church_id=?3 AND user_id=?4 AND id=?5`)
        .bind(parsed.title, now, parsed.churchId, parsed.userId, parsed.threadId)
        .run();
      return jsonText({ ok: true });
    },
  );

  server.tool(
    "churchcore_chat_archive_thread",
    "Archive a chat topic (soft delete).",
    { churchId: z.string().min(1), userId: z.string().min(1), threadId: z.string().min(1) },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), userId: z.string().min(1), threadId: z.string().min(1) }).parse(args);
      const now = nowIso();
      await env.churchcore
        .prepare(`UPDATE chat_threads SET status='archived', updated_at=?1 WHERE church_id=?2 AND user_id=?3 AND id=?4`)
        .bind(now, parsed.churchId, parsed.userId, parsed.threadId)
        .run();
      return jsonText({ ok: true });
    },
  );

  server.tool(
    "churchcore_chat_list_messages",
    "List messages for a thread (enforces per-user access).",
    {
      churchId: z.string().min(1),
      userId: z.string().min(1),
      threadId: z.string().min(1),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).max(500000).optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          userId: z.string().min(1),
          threadId: z.string().min(1),
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).max(500000).optional(),
        })
        .parse(args);

      const thread = await requireOwnedThread(parsed);
      if (!thread) return jsonText({ error: "Thread not found" });

      const limit = parsed.limit ?? 50;
      const offset = parsed.offset ?? 0;
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
            .bind(parsed.churchId, parsed.threadId)
            .all()
        ).results ?? [];

      const messages = rows.map((r: any) => {
        let envelope: unknown = null;
        if (r?.envelopeJson) {
          try {
            envelope = JSON.parse(String(r.envelopeJson));
          } catch {
            envelope = null;
          }
        }
        return {
          id: r.id,
          senderType: r.senderType,
          content: r.content,
          envelope,
          createdAt: r.createdAt,
        };
      });

      return jsonText({ thread: { id: thread.id, title: thread.title, status: thread.status }, messages });
    },
  );

  server.tool(
    "churchcore_chat_append_message",
    "Append a message to a thread (enforces per-user access).",
    {
      churchId: z.string().min(1),
      userId: z.string().min(1),
      threadId: z.string().min(1),
      senderType: z.enum(["user", "assistant", "system"]),
      content: z.string().min(1),
      envelope: z.any().optional(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          userId: z.string().min(1),
          threadId: z.string().min(1),
          senderType: z.enum(["user", "assistant", "system"]),
          content: z.string().min(1),
          envelope: z.any().optional(),
        })
        .parse(args);

      const thread = await requireOwnedThread(parsed);
      if (!thread) return jsonText({ error: "Thread not found" });

      const id = crypto.randomUUID();
      const now = nowIso();
      await env.churchcore
        .prepare(
          `INSERT INTO chat_messages (id, church_id, thread_id, sender_type, content, envelope_json, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(id, parsed.churchId, parsed.threadId, parsed.senderType, parsed.content, parsed.envelope ? JSON.stringify(parsed.envelope) : null, now)
        .run();

      await env.churchcore
        .prepare(`UPDATE chat_threads SET updated_at=?1 WHERE church_id=?2 AND user_id=?3 AND id=?4`)
        .bind(now, parsed.churchId, parsed.userId, parsed.threadId)
        .run();

      return jsonText({ messageId: id, ok: true });
    },
  );

  // Planning Center-ish local interfaces (no external integration)
  server.tool(
    "churchcore_people_search",
    "Search people (local D1; Planning Center-ish).",
    {
      churchId: z.string().min(1),
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async (args) => {
      const parsed = z
        .object({ churchId: z.string().min(1), query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() })
        .parse(args);
      const q = `%${parsed.query.toLowerCase()}%`;
      const limit = parsed.limit ?? 20;

      const rows =
        (
          await env.churchcore
            .prepare(
              `SELECT id,first_name,last_name,email,phone
               FROM people
               WHERE church_id=?1
                 AND (
                   lower(first_name) LIKE ?2 OR lower(last_name) LIKE ?2 OR lower(email) LIKE ?2 OR lower(phone) LIKE ?2
                 )
               ORDER BY last_name ASC, first_name ASC
               LIMIT ${limit}`,
            )
            .bind(parsed.churchId, q)
            .all()
        ).results ?? [];

      return jsonText({ people: rows });
    },
  );

  server.tool(
    "churchcore_people_get",
    "Get person details by personId (local D1).",
    { churchId: z.string().min(1), personId: z.string().min(1) },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), personId: z.string().min(1) }).parse(args);
      const row = (
        await env.churchcore
          .prepare(`SELECT * FROM people WHERE church_id=?1 AND id=?2`)
          .bind(parsed.churchId, parsed.personId)
          .first()
      ) as any;
      return jsonText({ person: row ?? null });
    },
  );

  // Householding + kids check-in (local D1; no external integration)
  server.tool(
    "churchcore_household_find_by_phone",
    "Find a household by phone number (normalized). Returns members + child profiles.",
    { churchId: z.string().min(1), phone: z.string().min(6) },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), phone: z.string().min(6) }).parse(args);
      const phone = normalizePhone(parsed.phone);
      const row = (
        await env.churchcore
          .prepare(
            `SELECT household_id AS householdId
             FROM household_contacts
             WHERE church_id=?1 AND contact_type='phone' AND contact_value=?2
             ORDER BY is_primary DESC
             LIMIT 1`,
          )
          .bind(parsed.churchId, phone)
          .first()
      ) as any;
      const householdId = typeof row?.householdId === "string" ? row.householdId : null;
      if (!householdId) return jsonText({ household: null, members: [], children: [] });

      const household = (
        await env.churchcore.prepare(`SELECT * FROM households WHERE church_id=?1 AND id=?2`).bind(parsed.churchId, householdId).first()
      ) as any;

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
            .bind(parsed.churchId, householdId)
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
            .bind(parsed.churchId, householdId)
            .all()
        ).results ?? [];

      return jsonText({ household, members, children, phone });
    },
  );

  server.tool(
    "churchcore_household_create_quick",
    "Create a lightweight household + parent + children for check-in (visitor friendly).",
    {
      churchId: z.string().min(1),
      campusId: z.string().min(1).optional().nullable(),
      householdName: z.string().optional().nullable(),
      primaryPhone: z.string().min(6),
      primaryEmail: z.string().optional().nullable(),
      parentFirstName: z.string().min(1),
      parentLastName: z.string().min(1).optional().nullable(),
      children: z
        .array(
          z.object({
            firstName: z.string().min(1),
            lastName: z.string().optional().nullable(),
            birthdate: z.string().optional().nullable(), // YYYY-MM-DD
            allergies: z.string().optional().nullable(),
            specialNeeds: z.boolean().optional().nullable(),
          }),
        )
        .min(1),
      actorUserId: z.string().optional().nullable(),
    },
    async (args) => {
      const parsed = z
        .object({
          churchId: z.string().min(1),
          campusId: z.string().min(1).optional().nullable(),
          householdName: z.string().optional().nullable(),
          primaryPhone: z.string().min(6),
          primaryEmail: z.string().optional().nullable(),
          parentFirstName: z.string().min(1),
          parentLastName: z.string().optional().nullable(),
          children: z
            .array(
              z.object({
                firstName: z.string().min(1),
                lastName: z.string().optional().nullable(),
                birthdate: z.string().optional().nullable(),
                allergies: z.string().optional().nullable(),
                specialNeeds: z.boolean().optional().nullable(),
              }),
            )
            .min(1),
          actorUserId: z.string().optional().nullable(),
        })
        .parse(args);

      const now = nowIso();
      const householdId = crypto.randomUUID();
      await env.churchcore
        .prepare(`INSERT INTO households (id, church_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
        .bind(householdId, parsed.churchId, (parsed.householdName ?? "New Household").trim() || "New Household", now, now)
        .run();

      const phone = normalizePhone(parsed.primaryPhone);
      await env.churchcore
        .prepare(
          `INSERT INTO household_contacts (id, church_id, household_id, contact_type, contact_value, is_primary, created_at, updated_at)
           VALUES (?1, ?2, ?3, 'phone', ?4, 1, ?5, ?6)`,
        )
        .bind(crypto.randomUUID(), parsed.churchId, householdId, phone, now, now)
        .run();

      if (parsed.primaryEmail) {
        const email = String(parsed.primaryEmail).trim().toLowerCase();
        if (email) {
          await env.churchcore
            .prepare(
              `INSERT INTO household_contacts (id, church_id, household_id, contact_type, contact_value, is_primary, created_at, updated_at)
               VALUES (?1, ?2, ?3, 'email', ?4, 1, ?5, ?6)`,
            )
            .bind(crypto.randomUUID(), parsed.churchId, householdId, email, now, now)
            .run();
        }
      }

      const parentId = crypto.randomUUID();
      await env.churchcore
        .prepare(
          `INSERT INTO people (id, church_id, campus_id, first_name, last_name, email, phone, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8)`,
        )
        .bind(parentId, parsed.churchId, parsed.campusId ?? null, parsed.parentFirstName, parsed.parentLastName ?? null, phone, now, now)
        .run();

      await env.churchcore.prepare(`INSERT INTO household_members (household_id, person_id, role) VALUES (?1, ?2, 'adult')`).bind(householdId, parentId).run();

      const childIds: string[] = [];
      for (const c of parsed.children) {
        const childId = crypto.randomUUID();
        childIds.push(childId);
        await env.churchcore
          .prepare(
            `INSERT INTO people (id, church_id, campus_id, first_name, last_name, birthdate, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
          )
          .bind(childId, parsed.churchId, parsed.campusId ?? null, c.firstName, c.lastName ?? null, c.birthdate ?? null, now, now)
          .run();
        await env.churchcore.prepare(`INSERT INTO household_members (household_id, person_id, role) VALUES (?1, ?2, 'child')`).bind(householdId, childId).run();

        await env.churchcore
          .prepare(
            `INSERT INTO child_profiles (person_id, church_id, allergies, special_needs, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
          )
          .bind(childId, parsed.churchId, c.allergies ?? null, c.specialNeeds ? 1 : 0, now, now)
          .run();

        await env.churchcore
          .prepare(
            `INSERT INTO person_relationships (id, church_id, from_person_id, to_person_id, relationship_type, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'guardian', 'active', ?5, ?6)`,
          )
          .bind(crypto.randomUUID(), parsed.churchId, parentId, childId, now, now)
          .run();

        await env.churchcore
          .prepare(
            `INSERT INTO person_relationships (id, church_id, from_person_id, to_person_id, relationship_type, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'authorized_pickup', 'active', ?5, ?6)`,
          )
          .bind(crypto.randomUUID(), parsed.churchId, parentId, childId, now, now)
          .run();
      }

      await auditAppend(env, {
        churchId: parsed.churchId,
        actorUserId: parsed.actorUserId ?? null,
        action: "household.create.quick",
        entityType: "households",
        entityId: householdId,
        payload: { householdId, parentId, childIds, phone },
      });

      return jsonText({ ok: true, householdId, parentId, childIds, phone });
    },
  );

  server.tool(
    "churchcore_checkin_preview",
    "Preview kids check-in eligibility (rooms) for the household.",
    {
      churchId: z.string().min(1),
      servicePlanId: z.string().min(1),
      areaId: z.string().min(1),
      householdId: z.string().min(1),
    },
    async (args) => {
      const parsed = z.object({ churchId: z.string().min(1), servicePlanId: z.string().min(1), areaId: z.string().min(1), householdId: z.string().min(1) }).parse(args);

      const rooms =
        (
          await env.churchcore
            .prepare(
              `SELECT id,name,min_age_months AS minAgeMonths,max_age_months AS maxAgeMonths,capacity
               FROM checkin_rooms
               WHERE church_id=?1 AND area_id=?2`,
            )
            .bind(parsed.churchId, parsed.areaId)
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
            .bind(parsed.churchId, parsed.householdId)
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
          personId: k.id,
          name: `${k.first_name ?? ""} ${k.last_name ?? ""}`.trim(),
          ageMonths: months,
          allergies: k.allergies ?? null,
          specialNeeds: Boolean(k.special_needs),
          eligibleRooms: eligible.map((r: any) => ({ id: r.id, name: r.name })),
        };
      });

      return jsonText({ rooms, kids, placements });
    },
  );

  return server;
}

function clampInt(v: unknown, def: number, min: number, max: number) {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function parseDomainAllowlist(env: Env): string[] {
  const raw = (env.CRAWL_DOMAIN_ALLOWLIST ?? "calvarybible.com,calvarybible.s3.us-west-1.amazonaws.com").trim();
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedUrl(url: string, allowDomains: string[]) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return allowDomains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function stripHtmlToText(html: string) {
  let s = String(html || "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "\n");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "\n");
  s = s.replace(/<\/(p|div|section|article|header|footer|li|h1|h2|h3|h4|h5|h6)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/g, " ");
  s = s.replace(/&amp;/g, "&");
  s = s.replace(/&lt;/g, "<");
  s = s.replace(/&gt;/g, ">");
  s = s.replace(/&quot;/g, '"');
  s = s.replace(/&#039;/g, "'");
  s = s.replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n");
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

function extractTitle(html: string) {
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  return stripHtmlToText(m[1] || "").slice(0, 200) || null;
}

async function sha256Hex(text: string) {
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(digest);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function chunkText(text: string, chunkSize: number, overlap: number) {
  const clean = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) return [clean];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const end = Math.min(clean.length, i + chunkSize);
    out.push(clean.slice(i, end));
    if (end >= clean.length) break;
    i = Math.max(0, end - overlap);
  }
  return out.filter((s) => s.trim());
}

async function openAiEmbed(env: Env, inputs: string[]) {
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY (required for KB embeddings refresh).");
  const model = (env.OPENAI_EMBEDDINGS_MODEL ?? "text-embedding-3-large").trim() || "text-embedding-3-large";

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: inputs }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(`OpenAI embeddings error (${res.status}): ${data?.error?.message ?? "unknown"}`);
  const arr = Array.isArray(data?.data) ? data.data : [];
  return arr.map((d: any) => (Array.isArray(d?.embedding) ? d.embedding : []));
}

function decodeHtmlEntities(input: string) {
  return String(input || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function stripVtt(vtt: string) {
  const lines = String(vtt || "")
    .split("\n")
    .map((l) => l.trim());
  const out: string[] = [];
  for (const l of lines) {
    if (!l) continue;
    if (l === "WEBVTT") continue;
    if (/^\d+$/.test(l)) continue;
    if (/^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/.test(l)) continue;
    if (l.startsWith("NOTE")) continue;
    if (l.startsWith("STYLE")) continue;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractYoutubeVideoIds(html: string) {
  const raw = String(html || "");
  const ids = new Set<string>();
  const patterns = [
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/g,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/g,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/g,
  ];
  for (const re of patterns) {
    for (;;) {
      const m = re.exec(raw);
      if (!m) break;
      ids.add(String(m[1]));
    }
  }
  return [...ids];
}

function extractJsonArrayAfterKey(raw: string, key: string) {
  const i = raw.indexOf(key);
  if (i < 0) return null;
  const start = raw.indexOf("[", i);
  if (start < 0) return null;
  let depth = 0;
  for (let j = start; j < raw.length; j++) {
    const ch = raw[j];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return raw.slice(start, j + 1);
    }
  }
  return null;
}

async function fetchYouTubeTranscript(videoId: string) {
  const id = String(videoId || "").trim();
  if (!id) return null;
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    const res = await fetch(watchUrl, { headers: { "user-agent": "Mozilla/5.0 (compatible; churchcore-mcp/0.1)" } });
    if (!res.ok) return null;
    const html = await res.text();

    const arrRaw = extractJsonArrayAfterKey(html, '"captionTracks":');
    if (!arrRaw) return null;
    const jsonText = arrRaw.replace(/\\u0026/g, "&");
    let tracks: any[] = [];
    try {
      tracks = JSON.parse(jsonText);
    } catch {
      return null;
    }
    if (!Array.isArray(tracks) || !tracks.length) return null;

    // Prefer English, else first.
    const preferred =
      tracks.find((t) => String(t?.languageCode ?? "").toLowerCase().startsWith("en") && typeof t?.baseUrl === "string") ??
      tracks.find((t) => typeof t?.baseUrl === "string");
    const baseUrl = typeof preferred?.baseUrl === "string" ? String(preferred.baseUrl) : null;
    if (!baseUrl) return null;

    const timed = baseUrl.includes("fmt=") ? baseUrl : `${baseUrl}&fmt=vtt`;
    const r2 = await fetch(timed, { headers: { "user-agent": "Mozilla/5.0 (compatible; churchcore-mcp/0.1)" } });
    if (!r2.ok) return null;
    const vtt = (await r2.text()).trim();
    if (!vtt) return null;
    const text = vtt.startsWith("WEBVTT") ? stripVtt(vtt) : stripHtmlToText(vtt);
    if (text.length < 200) return null;
    return { text, source: "youtube_captions" as const };
  } catch {
    return null;
  }
}

function guessExtFromUrl(url: string) {
  const u = String(url || "").split("?")[0].toLowerCase();
  const m = u.match(/\.([a-z0-9]{2,5})$/);
  return m ? m[1] : null;
}

function guessMimeFromExt(ext: string | null) {
  const e = String(ext || "").toLowerCase();
  if (e === "m4a") return "audio/mp4";
  if (e === "mp3") return "audio/mpeg";
  if (e === "mp4") return "video/mp4";
  if (e === "wav") return "audio/wav";
  return "application/octet-stream";
}

async function openAiTranscribeUrl(env: Env, mediaUrl: string) {
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return null;

  const maxBytes = clampInt(env.TRANSCRIBE_MAX_BYTES, 25 * 1024 * 1024, 1 * 1024 * 1024, 200 * 1024 * 1024);
  const model = (env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe").trim() || "gpt-4o-mini-transcribe";

  // Try HEAD for content-length.
  try {
    const head = await fetch(mediaUrl, { method: "HEAD", headers: { "user-agent": "churchcore-mcp-crawler/0.1" }, redirect: "follow" });
    const len = head.headers.get("content-length");
    if (len) {
      const n = parseInt(len, 10);
      if (Number.isFinite(n) && n > maxBytes) return { error: `too_large:${n}>${maxBytes}` as const };
    }
  } catch {
    // ignore
  }

  const res = await fetch(mediaUrl, { headers: { "user-agent": "churchcore-mcp-crawler/0.1" }, redirect: "follow" });
  if (!res.ok) return { error: `download_failed:${res.status}` as const };

  const buf = await res.arrayBuffer();
  if (buf.byteLength > maxBytes) return { error: `too_large:${buf.byteLength}>${maxBytes}` as const };

  const ext = guessExtFromUrl(mediaUrl);
  const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || guessMimeFromExt(ext);
  const filename = `media.${ext ?? "bin"}`;

  const fd = new FormData();
  fd.append("model", model);
  fd.append("response_format", "json");
  fd.append("file", new Blob([buf], { type: mime }), filename);

  const tr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  const data = (await tr.json().catch(() => ({}))) as any;
  if (!tr.ok) return { error: `openai:${tr.status}:${String(data?.error?.message ?? "transcribe_failed")}` as const };
  const text = typeof data?.text === "string" ? data.text.trim() : "";
  if (text.length < 200) return { error: "too_short" as const };
  return { text, model, source: "asr" as const };
}

function normalizePassageKey(passage: string | null | undefined) {
  const s = String(passage ?? "").trim();
  if (!s) return null;
  return s
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, "")
    .replace(/,/g, ";")
    .replace(/[^A-Z0-9:;,\-]/g, "");
}

function addDaysDate(isoDate: string, days: number) {
  const s = String(isoDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + (Number.isFinite(days) ? days : 0));
  return d.toISOString().slice(0, 10);
}

// Given a preached_date (YYYY-MM-DD), return the next Monday (strictly after).
function nextMondayDate(preachedDate: string) {
  const s = String(preachedDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  let delta = (1 - day + 7) % 7; // days until Monday
  if (delta === 0) delta = 7; // strictly after
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function extractLinksFromHtml(html: string, baseUrl: string) {
  const out: string[] = [];
  const raw = String(html || "");
  const re = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  for (;;) {
    const m = re.exec(raw);
    if (!m) break;
    const href = decodeHtmlEntities(String(m[1] ?? "").trim());
    if (!href) continue;
    if (href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("#")) continue;
    try {
      out.push(new URL(href, baseUrl).toString());
    } catch {
      // ignore
    }
  }
  return out;
}

function inferCampusIdFromTid(tid: string | null) {
  const t = String(tid ?? "").trim();
  if (t === "156") return "campus_boulder";
  if (t === "160") return "campus_erie";
  if (t === "157") return "campus_thornton";
  return null;
}

function inferGuideSeriesSlug(seriesTitle: string | null, passage: string | null) {
  const s = String(seriesTitle ?? "").toLowerCase();
  const p = String(passage ?? "").toLowerCase();
  if (s.includes("gospel of john") || s.includes("the gospel of john") || p.startsWith("john")) return "john";
  return null;
}

function parseWeekFromLabel(label: string) {
  const m = String(label || "").match(/week\s*([0-9]{1,3})/i);
  return m ? parseInt(m[1], 10) : null;
}

function parsePassageFromLabel(label: string) {
  const m = String(label || "").match(/week\s*[0-9]{1,3}\s*:\s*(.+)$/i);
  return m ? String(m[1]).trim() : null;
}

function extractAnchors(html: string, baseUrl: string) {
  const out: Array<{ href: string; text: string }> = [];
  const raw = String(html || "");
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (;;) {
    const m = re.exec(raw);
    if (!m) break;
    const hrefRaw = decodeHtmlEntities(String(m[1] ?? "").trim());
    const text = stripHtmlToText(String(m[2] ?? "")).trim();
    if (!hrefRaw || !text) continue;
    try {
      const href = new URL(hrefRaw, baseUrl).toString();
      out.push({ href, text });
    } catch {
      // ignore
    }
  }
  return out;
}

async function upsertWeeklyGuide(
  env: Env,
  args: {
    churchId: string;
    seriesSlug: string;
    weekNumber: number;
    passage: string | null;
    discussionUrl: string | null;
    leaderUrl: string | null;
    now: string;
  },
) {
  const id = `guide_${args.seriesSlug}_${args.weekNumber}`;
  const passageKey = normalizePassageKey(args.passage);
  await env.churchcore
    .prepare(
      `INSERT INTO weekly_guides (id, church_id, series_slug, week_number, passage, passage_key, discussion_url, leader_url, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(id) DO UPDATE SET
         church_id=excluded.church_id,
         series_slug=excluded.series_slug,
         week_number=excluded.week_number,
         passage=excluded.passage,
         passage_key=excluded.passage_key,
         discussion_url=COALESCE(excluded.discussion_url, weekly_guides.discussion_url),
         leader_url=COALESCE(excluded.leader_url, weekly_guides.leader_url),
         updated_at=excluded.updated_at`,
    )
    .bind(
      id,
      args.churchId,
      args.seriesSlug,
      args.weekNumber,
      args.passage ?? null,
      passageKey,
      args.discussionUrl,
      args.leaderUrl,
      args.now,
      args.now,
    )
    .run();
}

async function upsertWeeklyGuideDoc(
  env: Env,
  args: {
    churchId: string;
    seriesSlug: string;
    weekNumber: number;
    kind: "discussion" | "leader";
    weekStartDate: string | null;
    title: string;
    bodyMarkdown: string;
    now: string;
  },
) {
  const entityId = `guide:${args.seriesSlug}:${args.weekNumber}:${args.kind}${args.weekStartDate ? `:${args.weekStartDate}` : ""}`;
  const docId = `wg_${(await sha256Hex(entityId)).slice(0, 24)}`;
  await env.churchcore
    .prepare(
      `INSERT INTO content_docs (id, church_id, entity_type, entity_id, locale, title, body_markdown, created_at, updated_at)
       VALUES (?1, ?2, 'weekly_guide', ?3, 'en', ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET
         church_id=excluded.church_id,
         entity_type=excluded.entity_type,
         entity_id=excluded.entity_id,
         locale=excluded.locale,
         title=excluded.title,
         body_markdown=excluded.body_markdown,
         updated_at=excluded.updated_at`,
    )
    .bind(docId, args.churchId, entityId, args.title, args.bodyMarkdown, args.now, args.now)
    .run();
  return { docId, sourceId: `content/weekly_guide/${args.seriesSlug}/${args.weekNumber}/${args.kind}/${args.weekStartDate ?? "unknown"}/en#${docId}` };
}

async function extractPdfText(buf: ArrayBuffer) {
  // Lazy import to keep startup light.
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buf);
  const task = pdfjs.getDocument({ data, disableWorker: true });
  const pdf = await task.promise;
  const parts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = (content?.items ?? [])
      .map((it: any) => (typeof it?.str === "string" ? it.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (line) parts.push(line);
  }
  return parts.join("\n").trim();
}

async function fetchGuideAsMarkdown(env: Env, url: string) {
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "churchcore-mcp-crawler/0.1" } });
  if (!res.ok) throw new Error(`guide_fetch_failed:${res.status}`);
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const finalUrl = res.url || url;
  const isPdf = ct.includes("application/pdf") || /\.pdf(\?|$)/i.test(finalUrl);
  if (isPdf) {
    const buf = await res.arrayBuffer();
    const text = await extractPdfText(buf);
    return { kind: "pdf" as const, finalUrl, text: text || "" };
  }
  const html = await res.text();
  const text = stripHtmlToText(html);
  return { kind: "html" as const, finalUrl, text: text || "" };
}

async function ingestWeeklyGuidesToKb(env: Env, args: { churchId: string; now: string; limit: number }) {
  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT series_slug AS seriesSlug, week_number AS weekNumber, passage, discussion_url AS discussionUrl, leader_url AS leaderUrl
           FROM weekly_guides
           WHERE church_id=?1
           ORDER BY updated_at DESC
           LIMIT ${args.limit}`,
        )
        .bind(args.churchId)
        .all()
    ).results ?? [];

  for (const r of rows as any[]) {
    const seriesSlug = String(r?.seriesSlug ?? "").trim();
    const weekNumber = Number(r?.weekNumber ?? 0);
    if (!seriesSlug || !Number.isFinite(weekNumber) || weekNumber <= 0) continue;

    const matchRow = (await env.churchcore
      .prepare(
        `SELECT week_start_date AS weekStartDate
         FROM campus_messages
         WHERE church_id=?1 AND guide_series_slug=?2 AND guide_week_number=?3 AND week_start_date IS NOT NULL
         ORDER BY preached_at DESC, updated_at DESC
         LIMIT 1`,
      )
      .bind(args.churchId, seriesSlug, weekNumber)
      .first()) as any;
    const weekStartDate = typeof matchRow?.weekStartDate === "string" && matchRow.weekStartDate.trim() ? String(matchRow.weekStartDate).trim() : null;

    const baseHeader = [
      `Series: ${seriesSlug}`,
      `Week: ${weekNumber}`,
      weekStartDate ? `Week start: ${weekStartDate}` : null,
      r?.passage ? `Passage: ${String(r.passage)}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const discussionUrl = typeof r?.discussionUrl === "string" ? String(r.discussionUrl).trim() : "";
    if (discussionUrl) {
      try {
        const fetched = await fetchGuideAsMarkdown(env, discussionUrl);
        const md = `${baseHeader}\n\nSource: ${fetched.finalUrl}\n\n## Discussion Guide\n\n${fetched.text}`;
        const doc = await upsertWeeklyGuideDoc(env, {
          churchId: args.churchId,
          seriesSlug,
          weekNumber,
          kind: "discussion",
          weekStartDate,
          title: `Discussion Guide — ${seriesSlug} Week ${weekNumber}`,
          bodyMarkdown: md,
          now: args.now,
        });
        await refreshKbForSource(env, { churchId: args.churchId, sourceId: doc.sourceId, docId: doc.docId, text: md, now: args.now });
      } catch {
        // best effort
      }
    }

    const leaderUrl = typeof r?.leaderUrl === "string" ? String(r.leaderUrl).trim() : "";
    if (leaderUrl) {
      try {
        const fetched = await fetchGuideAsMarkdown(env, leaderUrl);
        const md = `${baseHeader}\n\nSource: ${fetched.finalUrl}\n\n## Leader Guide\n\n${fetched.text}`;
        const doc = await upsertWeeklyGuideDoc(env, {
          churchId: args.churchId,
          seriesSlug,
          weekNumber,
          kind: "leader",
          weekStartDate,
          title: `Leader Guide — ${seriesSlug} Week ${weekNumber}`,
          bodyMarkdown: md,
          now: args.now,
        });
        await refreshKbForSource(env, { churchId: args.churchId, sourceId: doc.sourceId, docId: doc.docId, text: md, now: args.now });
      } catch {
        // best effort
      }
    }
  }
}

async function upsertCampusMessage(
  env: Env,
  args: {
    churchId: string;
    messageId: string;
    campusId: string | null;
    title: string;
    speaker: string | null;
    preachedAt: string | null;
    passage: string | null;
    seriesTitle: string | null;
    seriesId: string | null;
    campusFeedId: string | null;
    sourceUrl: string;
    watchUrl: string | null;
    listenUrl: string | null;
    downloadUrl: string | null;
    guide: { seriesSlug: string; weekNumber: number; discussionUrl: string | null; leaderUrl: string | null } | null;
    now: string;
  },
) {
  const passageKey = normalizePassageKey(args.passage);
  const preachedDate = args.preachedAt ? String(args.preachedAt).slice(0, 10) : null;
  const weekStartDate = preachedDate ? nextMondayDate(preachedDate) : null;
  const weekEndDate = weekStartDate ? addDaysDate(weekStartDate, 6) : null;
  await env.churchcore
    .prepare(
      `INSERT INTO campus_messages (
         id, church_id, campus_id, title, speaker, preached_at, preached_date, week_start_date, week_end_date, passage, passage_key,
         series_title, series_id, campus_feed_id, source_url, watch_url, listen_url, download_url,
         guide_series_slug, guide_week_number, guide_discussion_url, guide_leader_url,
         created_at, updated_at
       )
       VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
         ?12, ?13, ?14, ?15, ?16, ?17, ?18,
         ?19, ?20, ?21, ?22,
         ?23, ?24
       )
       ON CONFLICT(id) DO UPDATE SET
         church_id=excluded.church_id,
         campus_id=excluded.campus_id,
         title=excluded.title,
         speaker=excluded.speaker,
         preached_at=excluded.preached_at,
         preached_date=excluded.preached_date,
         week_start_date=excluded.week_start_date,
         week_end_date=excluded.week_end_date,
         passage=excluded.passage,
         passage_key=excluded.passage_key,
         series_title=excluded.series_title,
         series_id=excluded.series_id,
         campus_feed_id=excluded.campus_feed_id,
         source_url=excluded.source_url,
         watch_url=excluded.watch_url,
         listen_url=excluded.listen_url,
         download_url=excluded.download_url,
         guide_series_slug=excluded.guide_series_slug,
         guide_week_number=excluded.guide_week_number,
         guide_discussion_url=excluded.guide_discussion_url,
         guide_leader_url=excluded.guide_leader_url,
         updated_at=excluded.updated_at`,
    )
    .bind(
      args.messageId,
      args.churchId,
      args.campusId,
      args.title,
      args.speaker,
      args.preachedAt,
      preachedDate,
      weekStartDate,
      weekEndDate,
      args.passage,
      passageKey,
      args.seriesTitle,
      args.seriesId,
      args.campusFeedId,
      args.sourceUrl,
      args.watchUrl,
      args.listenUrl,
      args.downloadUrl,
      args.guide?.seriesSlug ?? null,
      args.guide?.weekNumber ?? null,
      args.guide?.discussionUrl ?? null,
      args.guide?.leaderUrl ?? null,
      args.now,
      args.now,
    )
    .run();
}

async function upsertCampusMessageAnalysis(
  env: Env,
  args: {
    churchId: string;
    messageId: string;
    summaryMarkdown: string | null;
    topics: string[];
    verses: string[];
    keyPoints: string[];
    model: string | null;
    source: string | null;
    now: string;
  },
) {
  await env.churchcore
    .prepare(
      `INSERT INTO campus_message_analysis (message_id, church_id, summary_markdown, topics_json, verses_json, key_points_json, model, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(message_id) DO UPDATE SET
         church_id=excluded.church_id,
         summary_markdown=excluded.summary_markdown,
         topics_json=excluded.topics_json,
         verses_json=excluded.verses_json,
         key_points_json=excluded.key_points_json,
         model=excluded.model,
         source=excluded.source,
         updated_at=excluded.updated_at`,
    )
    .bind(
      args.messageId,
      args.churchId,
      args.summaryMarkdown,
      JSON.stringify(args.topics ?? []),
      JSON.stringify(args.verses ?? []),
      JSON.stringify(args.keyPoints ?? []),
      args.model,
      args.source,
      args.now,
      args.now,
    )
    .run();
}

async function upsertCampusMessageDoc(
  env: Env,
  args: { churchId: string; messageId: string; title: string | null; bodyMarkdown: string; now: string },
) {
  const docId = `msg_${(await sha256Hex(args.messageId)).slice(0, 24)}`;
  await env.churchcore
    .prepare(
      `INSERT INTO content_docs (id, church_id, entity_type, entity_id, locale, title, body_markdown, created_at, updated_at)
       VALUES (?1, ?2, 'campus_message', ?3, 'en', ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET
         church_id=excluded.church_id,
         entity_type=excluded.entity_type,
         entity_id=excluded.entity_id,
         locale=excluded.locale,
         title=excluded.title,
         body_markdown=excluded.body_markdown,
         updated_at=excluded.updated_at`,
    )
    .bind(docId, args.churchId, args.messageId, args.title ?? null, args.bodyMarkdown, args.now, args.now)
    .run();
  return { docId, sourceId: `content/campus_message/${args.messageId}/en#${docId}` };
}

async function openAiSummarizeMessage(
  env: Env,
  args: {
    title: string;
    speaker: string | null;
    preachedAt: string | null;
    passage: string | null;
    seriesTitle: string | null;
    campusId: string | null;
    pageText: string;
    transcriptText: string | null;
    transcriptSource: string | null;
  },
) {
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const model = (env.OPENAI_MESSAGE_MODEL ?? "gpt-5.2").trim() || "gpt-5.2";

  const prompt = {
    title: args.title,
    speaker: args.speaker,
    preachedAt: args.preachedAt,
    passage: args.passage,
    seriesTitle: args.seriesTitle,
    campusId: args.campusId,
    transcriptSource: args.transcriptSource,
    transcriptText: args.transcriptText,
    pageText: args.pageText,
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You create a church knowledge-base entry for a weekly message. Prefer transcriptText if present; otherwise use pageText. Do not invent quotes, stories, or details not present. If something is missing, leave it null or an empty array. Output JSON with keys: summaryMarkdown (string), topics (string[]), verses (string[]), keyPoints (string[]), extractedContentMarkdown (string). The extractedContentMarkdown should be detailed (outline + main points + applications) and may include short direct quotes ONLY if they appear in the provided text.",
        },
        { role: "user", content: JSON.stringify(prompt) },
      ],
    }),
  });

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) return null;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) return null;
  try {
    const obj = JSON.parse(content);
    return {
      model,
      summaryMarkdown: typeof obj?.summaryMarkdown === "string" ? obj.summaryMarkdown : null,
      topics: Array.isArray(obj?.topics) ? obj.topics.map((s: any) => String(s)).filter(Boolean).slice(0, 30) : [],
      verses: Array.isArray(obj?.verses) ? obj.verses.map((s: any) => String(s)).filter(Boolean).slice(0, 50) : [],
      keyPoints: Array.isArray(obj?.keyPoints) ? obj.keyPoints.map((s: any) => String(s)).filter(Boolean).slice(0, 30) : [],
      extractedContentMarkdown: typeof obj?.extractedContentMarkdown === "string" ? obj.extractedContentMarkdown : "",
    };
  } catch {
    return null;
  }
}

async function upsertCampusMessageTranscript(
  env: Env,
  args: { churchId: string; messageId: string; transcriptText: string; sourceUrl: string | null; model: string | null; now: string },
) {
  await env.churchcore
    .prepare(
      `INSERT INTO campus_message_transcripts (message_id, church_id, transcript_text, source_url, model, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(message_id) DO UPDATE SET
         church_id=excluded.church_id,
         transcript_text=excluded.transcript_text,
         source_url=excluded.source_url,
         model=excluded.model,
         updated_at=excluded.updated_at`,
    )
    .bind(args.messageId, args.churchId, args.transcriptText, args.sourceUrl, args.model, args.now, args.now)
    .run();
}

async function openAiTranscribeAudio(
  env: Env,
  args: { audioUrl: string; filename: string; mimeType: string | null; maxBytes: number },
) {
  const apiKey = (env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY (required for transcription).");
  const model = (env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-transcribe").trim() || "gpt-4o-transcribe";

  const head = await fetch(args.audioUrl, { method: "HEAD", redirect: "follow" }).catch(() => null);
  const len = head?.headers?.get("content-length");
  const contentLength = len ? parseInt(len, 10) : NaN;
  if (Number.isFinite(contentLength) && contentLength > args.maxBytes) {
    throw new Error(`audio_too_large:${contentLength}`);
  }

  const res = await fetch(args.audioUrl, { redirect: "follow" });
  if (!res.ok) throw new Error(`audio_fetch_failed:${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > args.maxBytes) throw new Error(`audio_too_large:${buf.byteLength}`);

  const blob = new Blob([buf], { type: args.mimeType ?? "application/octet-stream" });
  const file = new File([blob], args.filename);
  const form = new FormData();
  form.append("file", file);
  form.append("model", model);

  const t = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form as any,
  });
  const data = (await t.json().catch(() => ({}))) as any;
  if (!t.ok) throw new Error(`openai_transcribe_error:${t.status}:${data?.error?.message ?? "unknown"}`);
  const text = typeof data?.text === "string" ? data.text : "";
  return { model, text };
}

async function assemblyAiRequest(env: Env, path: string, init: RequestInit) {
  const apiKey = (env.ASSEMBLYAI_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("Missing ASSEMBLYAI_API_KEY (required for AssemblyAI transcription).");
  const url = `https://api.assemblyai.com${path.startsWith("/") ? "" : "/"}${path}`;
  const timeoutMs = clampInt(env.ASSEMBLYAI_HTTP_TIMEOUT_MS, 20000, 2000, 60000);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ac.signal,
      headers: {
        authorization: apiKey,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      } as any,
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new Error(`assemblyai_error:${res.status}:${data?.error ?? data?.message ?? "unknown"}`);
    return data;
  } catch (e: any) {
    if (String(e?.name ?? "") === "AbortError") throw new Error("assemblyai_timeout");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function assemblyAiSubmit(env: Env, args: { audioUrl: string }) {
  const body = {
    audio_url: args.audioUrl,
    language_detection: true,
    speech_models: ["universal-3-pro", "universal-2"],
  };
  const data = await assemblyAiRequest(env, "/v2/transcript", { method: "POST", body: JSON.stringify(body) });
  const id = typeof data?.id === "string" ? data.id : null;
  if (!id) throw new Error("assemblyai_missing_transcript_id");
  return { id };
}

async function assemblyAiGet(env: Env, transcriptId: string) {
  const data = await assemblyAiRequest(env, `/v2/transcript/${encodeURIComponent(transcriptId)}`, { method: "GET" });
  const status = typeof data?.status === "string" ? data.status : "unknown";
  const text = typeof data?.text === "string" ? data.text : null;
  const error = typeof data?.error === "string" ? data.error : null;
  return { status, text, error, raw: data };
}

async function applyTranscriptToMessage(
  env: Env,
  args: {
    churchId: string;
    messageId: string;
    transcriptText: string;
    transcriptSource: string | null;
    transcriptModel: string | null;
    analysisSource: string;
    now: string;
  },
) {
  const row = (await env.churchcore
    .prepare(
      `SELECT id, campus_id AS campusId, title, speaker, preached_at AS preachedAt, passage, series_title AS seriesTitle,
              source_url AS sourceUrl, download_url AS downloadUrl, listen_url AS listenUrl, watch_url AS watchUrl,
              guide_discussion_url AS guideDiscussionUrl, guide_leader_url AS guideLeaderUrl
       FROM campus_messages WHERE church_id=?1 AND id=?2`,
    )
    .bind(args.churchId, args.messageId)
    .first()) as any;
  if (!row) throw new Error("unknown_messageId");

  await upsertCampusMessageTranscript(env, {
    churchId: args.churchId,
    messageId: args.messageId,
    transcriptText: args.transcriptText,
    sourceUrl: args.transcriptSource,
    model: args.transcriptModel,
    now: args.now,
  });

  const llm = await openAiSummarizeMessage(env, {
    title: String(row.title ?? "Message"),
    speaker: row.speaker ?? null,
    preachedAt: row.preachedAt ?? null,
    passage: row.passage ?? null,
    seriesTitle: row.seriesTitle ?? null,
    campusId: row.campusId ?? null,
    pageText: "",
    transcriptText: args.transcriptText,
    transcriptSource: args.transcriptSource,
  });

  if (llm) {
    await upsertCampusMessageAnalysis(env, {
      churchId: args.churchId,
      messageId: args.messageId,
      summaryMarkdown: llm.summaryMarkdown ?? null,
      topics: llm.topics ?? [],
      verses: llm.verses ?? [],
      keyPoints: llm.keyPoints ?? [],
      model: llm.model ?? null,
      source: args.analysisSource,
      now: args.now,
    });
  }

  const topics = llm?.topics ?? [];
  const verses = llm?.verses ?? [];
  const keyPoints = llm?.keyPoints ?? [];

  const md = [
    row.sourceUrl ? `Source: ${row.sourceUrl}` : null,
    row.campusId ? `Campus: ${row.campusId}` : null,
    row.preachedAt ? `Date: ${String(row.preachedAt).slice(0, 10)}` : null,
    row.speaker ? `Speaker: ${row.speaker}` : null,
    row.passage ? `Passage: ${row.passage}` : null,
    row.seriesTitle ? `Series: ${row.seriesTitle}` : null,
    row.watchUrl ? `Watch: ${row.watchUrl}` : null,
    row.listenUrl ? `Listen: ${row.listenUrl}` : null,
    row.downloadUrl ? `Download: ${row.downloadUrl}` : null,
    row.guideDiscussionUrl ? `Discussion Questions: ${row.guideDiscussionUrl}` : null,
    row.guideLeaderUrl ? `Leader Guide: ${row.guideLeaderUrl}` : null,
    args.transcriptSource ? `Transcript source: ${args.transcriptSource}` : null,
    args.transcriptModel ? `Transcript model: ${args.transcriptModel}` : null,
    llm?.summaryMarkdown ? `## Summary\n\n${llm.summaryMarkdown}` : null,
    topics.length ? `## Topics\n\n${topics.map((t: string) => `- ${t}`).join("\n")}` : null,
    verses.length ? `## Verses\n\n${verses.map((v: string) => `- ${v}`).join("\n")}` : null,
    keyPoints.length ? `## Key Points\n\n${keyPoints.map((p: string) => `- ${p}`).join("\n")}` : null,
    `## Transcript\n\n${args.transcriptText}`,
    llm?.extractedContentMarkdown?.trim() ? `## Extracted Outline\n\n${llm.extractedContentMarkdown.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const doc = await upsertCampusMessageDoc(env, { churchId: args.churchId, messageId: args.messageId, title: String(row.title ?? "Message"), bodyMarkdown: md, now: args.now });
  await refreshKbForSource(env, { churchId: args.churchId, sourceId: doc.sourceId, docId: doc.docId, text: md, now: args.now });
  return { summaryModel: llm?.model ?? null, summarized: Boolean(llm) };
}

async function transcriptionJobCreate(
  env: Env,
  args: { churchId: string; messageId: string; provider: string; audioUrl: string; now: string },
) {
  const id = crypto.randomUUID();
  await env.churchcore
    .prepare(
      `INSERT INTO transcription_jobs (id, church_id, message_id, provider, audio_url, provider_job_id, status, error, created_at, updated_at, completed_at)
       VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'queued', NULL, ?6, ?7, NULL)`,
    )
    .bind(id, args.churchId, args.messageId, args.provider, args.audioUrl, args.now, args.now)
    .run();
  return id;
}

async function transcriptionJobUpdate(
  env: Env,
  args: { id: string; status: string; providerJobId?: string | null; error?: string | null; completedAt?: string | null; now: string },
) {
  await env.churchcore
    .prepare(
      `UPDATE transcription_jobs
       SET status=?2, provider_job_id=COALESCE(?3, provider_job_id), error=?4, completed_at=?5, updated_at=?6
       WHERE id=?1`,
    )
    .bind(args.id, args.status, args.providerJobId ?? null, args.error ?? null, args.completedAt ?? null, args.now)
    .run();
}

async function processAssemblyAiJobs(env: Env, args: { churchId: string; limit: number }) {
  const now = nowIso();
  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT id, message_id AS messageId, audio_url AS audioUrl, provider_job_id AS providerJobId, status
           FROM transcription_jobs
           WHERE church_id=?1 AND provider='assemblyai' AND status IN ('queued','processing')
           ORDER BY updated_at ASC
           LIMIT ${args.limit}`,
        )
        .bind(args.churchId)
        .all()
    ).results ?? [];

  for (const r of rows as any[]) {
    const jobId = String(r.id);
    const messageId = String(r.messageId);
    const audioUrl = String(r.audioUrl);
    const providerJobId = r.providerJobId ? String(r.providerJobId) : null;
    try {
      if (!providerJobId) {
        const sub = await assemblyAiSubmit(env, { audioUrl });
        await transcriptionJobUpdate(env, { id: jobId, status: "processing", providerJobId: sub.id, now });
        continue;
      }

      const st = await assemblyAiGet(env, providerJobId);
      if (st.status === "completed" && st.text) {
        await applyTranscriptToMessage(env, {
          churchId: args.churchId,
          messageId,
          transcriptText: st.text,
          transcriptSource: "assemblyai",
          transcriptModel: "universal-3-pro/universal-2",
          analysisSource: "assemblyai_transcript",
          now,
        });
        await transcriptionJobUpdate(env, { id: jobId, status: "completed", completedAt: now, now });
      } else if (st.status === "error" || st.status === "failed") {
        await transcriptionJobUpdate(env, { id: jobId, status: "failed", error: st.error ?? "assemblyai_failed", now });
      } else {
        await transcriptionJobUpdate(env, { id: jobId, status: "processing", now });
      }
    } catch (e: any) {
      await transcriptionJobUpdate(env, { id: jobId, status: "failed", error: String(e?.message ?? e ?? "job_failed"), now });
    }
  }
  return { ok: true, processed: rows.length };
}

async function queueMissingAssemblyAiJobs(env: Env, args: { churchId: string; limit: number }) {
  const now = nowIso();
  const rows =
    (
      await env.churchcore
        .prepare(
          `SELECT m.id AS messageId,
                  COALESCE(m.download_url, m.listen_url) AS audioUrl
           FROM campus_messages m
           LEFT JOIN campus_message_transcripts t
             ON t.message_id = m.id AND t.church_id = m.church_id
           WHERE m.church_id=?1
             AND COALESCE(m.download_url, m.listen_url) IS NOT NULL
             AND (t.message_id IS NULL OR length(t.transcript_text) = 0)
             AND NOT EXISTS (
               SELECT 1 FROM transcription_jobs j
               WHERE j.church_id = m.church_id
                 AND j.message_id = m.id
                 AND j.provider = 'assemblyai'
                 AND j.status IN ('queued','processing')
             )
           ORDER BY m.preached_at DESC
           LIMIT ${args.limit}`,
        )
        .bind(args.churchId)
        .all()
    ).results ?? [];

  let queued = 0;
  for (const r of rows as any[]) {
    const messageId = String(r.messageId);
    const audioUrl = String(r.audioUrl ?? "").trim();
    if (!audioUrl) continue;
    await transcriptionJobCreate(env, { churchId: args.churchId, messageId, provider: "assemblyai", audioUrl, now });
    queued += 1;
  }
  return { ok: true, queued, considered: rows.length };
}

function parseSitemapXml(xml: string) {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  for (;;) {
    const m = re.exec(xml);
    if (!m) break;
    out.push(String(m[1]).trim());
  }
  return out;
}

async function upsertWebPageDoc(env: Env, args: { churchId: string; url: string; title: string | null; bodyMarkdown: string; now: string }) {
  const url = args.url;
  const docId = `web_${(await sha256Hex(url)).slice(0, 24)}`;
  await env.churchcore
    .prepare(
      `INSERT INTO content_docs (id, church_id, entity_type, entity_id, locale, title, body_markdown, created_at, updated_at)
       VALUES (?1, ?2, 'web_page', ?3, 'en', ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET
         entity_type=excluded.entity_type,
         entity_id=excluded.entity_id,
         locale=excluded.locale,
         title=excluded.title,
         body_markdown=excluded.body_markdown,
         updated_at=excluded.updated_at`,
    )
    .bind(docId, args.churchId, url, args.title ?? null, args.bodyMarkdown, args.now, args.now)
    .run();
  return { docId, sourceId: `content/web_page/${url}/en#${docId}` };
}

async function upsertCrawlMeta(
  env: Env,
  args: {
    churchId: string;
    url: string;
    etag: string | null;
    lastModified: string | null;
    contentHash: string | null;
    title: string | null;
    statusCode: number | null;
    lastFetchedAt: string;
    lastChangedAt: string | null;
    error: string | null;
    now: string;
  },
) {
  await env.churchcore
    .prepare(
      `INSERT INTO web_crawl_pages (url, church_id, etag, last_modified, content_hash, title, status_code, last_fetched_at, last_changed_at, error, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT(url) DO UPDATE SET
         church_id=excluded.church_id,
         etag=excluded.etag,
         last_modified=excluded.last_modified,
         content_hash=excluded.content_hash,
         title=excluded.title,
         status_code=excluded.status_code,
         last_fetched_at=excluded.last_fetched_at,
         last_changed_at=excluded.last_changed_at,
         error=excluded.error,
         updated_at=excluded.updated_at`,
    )
    .bind(
      args.url,
      args.churchId,
      args.etag,
      args.lastModified,
      args.contentHash,
      args.title,
      args.statusCode,
      args.lastFetchedAt,
      args.lastChangedAt,
      args.error,
      args.now,
    )
    .run();
}

async function refreshKbForSource(env: Env, args: { churchId: string; sourceId: string; docId: string; text: string; now: string }) {
  const chunks = chunkText(args.text, 900, 150);
  if (!chunks.length) return;

  // Replace all chunks for this sourceId (prevents stale retrieval).
  await env.churchcore.prepare(`DELETE FROM kb_chunks WHERE church_id=?1 AND source_id=?2`).bind(args.churchId, args.sourceId).run();

  // Embed in small batches.
  const vectors: number[][] = [];
  for (let i = 0; i < chunks.length; i += 64) {
    const batch = chunks.slice(i, i + 64);
    const emb = await openAiEmbed(env, batch);
    for (const v of emb) vectors.push(v);
  }

  const stmt = env.churchcore.prepare(
    `INSERT INTO kb_chunks (id, church_id, source_id, text, embedding_json, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET
       church_id=excluded.church_id,
       source_id=excluded.source_id,
       text=excluded.text,
       embedding_json=excluded.embedding_json,
       updated_at=excluded.updated_at`,
  );
  const batch: D1PreparedStatement[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkId = `${args.churchId}:${args.docId}#${i}`;
    batch.push(stmt.bind(chunkId, args.churchId, args.sourceId, chunks[i], JSON.stringify(vectors[i] ?? []), args.now, args.now));
  }
  await env.churchcore.batch(batch);
}

async function crawlOne(env: Env, args: { churchId: string; url: string; allowDomains: string[]; now: string; forceMessages?: boolean }) {
  const url = args.url;
  if (!isAllowedUrl(url, args.allowDomains)) return { url, skipped: true, reason: "disallowed_domain" };

  const prev = (await env.churchcore
    .prepare(`SELECT etag AS etag, last_modified AS lastModified, content_hash AS contentHash FROM web_crawl_pages WHERE url=?1 AND church_id=?2`)
    .bind(url, args.churchId)
    .first()) as any;

  const headers: Record<string, string> = { "user-agent": "churchcore-mcp-crawler/0.1" };
  let isMessageDetailUrl = false;
  let isMessagesIndexUrl = false;
  try {
    const u0 = new URL(url);
    isMessageDetailUrl = Boolean(u0.searchParams.get("enmse_mid")) && u0.pathname.includes("/messages/");
    // Also treat message index pages as forceable, so we can reliably discover new message detail URLs.
    isMessagesIndexUrl = !u0.searchParams.get("enmse_mid") && /^\/messages\/(boulder|erie|thornton)?\/$/i.test(u0.pathname);
  } catch {
    isMessageDetailUrl = false;
    isMessagesIndexUrl = false;
  }
  const forceMessages = Boolean(args.forceMessages) && (isMessageDetailUrl || isMessagesIndexUrl);
  if (!forceMessages) {
    if (typeof prev?.etag === "string" && prev.etag) headers["if-none-match"] = prev.etag;
    if (typeof prev?.lastModified === "string" && prev.lastModified) headers["if-modified-since"] = prev.lastModified;
  }

  try {
    const res = await fetch(url, { headers, redirect: "follow" });
    const status = res.status;
    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");

    if (status === 304) {
      await upsertCrawlMeta(env, {
        churchId: args.churchId,
        url,
        etag: etag ?? (prev?.etag ?? null),
        lastModified: lastModified ?? (prev?.lastModified ?? null),
        contentHash: prev?.contentHash ?? null,
        title: null,
        statusCode: 304,
        lastFetchedAt: args.now,
        lastChangedAt: null,
        error: null,
        now: args.now,
      });
      return { url, changed: false, status, discoveredUrls: [] as string[] };
    }

    const raw = await res.text();
    const title = extractTitle(raw);
    // Some pages encode querystring separators as HTML entities in href attributes (e.g., &amp;),
    // which breaks URLSearchParams parsing unless decoded.
    const links = extractLinksFromHtml(raw, url).map((l) => String(l).replace(/&amp;/g, "&").replace(/&#0?38;/g, "&"));
    const text = stripHtmlToText(raw);
    const bodyMarkdown = `Source: ${url}\n\n${text}`;
    const contentHash = await sha256Hex(bodyMarkdown);
    const changed = String(prev?.contentHash ?? "") !== contentHash;
    const effectiveChanged = changed || forceMessages;

    const u = new URL(url);
    const mid = u.searchParams.get("enmse_mid");
    const tid = u.searchParams.get("enmse_tid");
    const sid = u.searchParams.get("enmse_sid");
    const isMessageDetail = Boolean(mid) && u.pathname.includes("/messages/");
    // Treat both the global messages index and campus-specific indexes as sources of recent message links.
    const isCampusMessagesIndex = !mid && /^\/messages\/(boulder|erie|thornton)?\/$/i.test(u.pathname);
    const isDiscussionJohn = /^\/discussion\/john\/$/i.test(u.pathname);

    // If this is the discussion guide page, upsert weekly guide links (best effort).
    if (changed && isDiscussionJohn) {
      const anchors = extractAnchors(raw, url);
      const seriesSlug = "john";
      const grouped = new Map<number, { passage: string | null; discussionUrl: string | null; leaderUrl: string | null }>();
      for (const a of anchors) {
        if (!/week\s*[0-9]{1,3}\s*:/i.test(a.text)) continue;
        const week = parseWeekFromLabel(a.text);
        if (!week) continue;
        const passage = parsePassageFromLabel(a.text);
        const href = a.href;
        const isPdf = /\.pdf(\?|$)/i.test(href);
        if (!isPdf) continue;
        const isLeader = /leader/i.test(href) || /leader/i.test(a.text);
        const isDiscussion = /dq/i.test(href) || /discussion/i.test(href) || /dq/i.test(a.text) || /discussion/i.test(a.text);
        if (!isLeader && !isDiscussion) continue;
        const cur = grouped.get(week) ?? { passage, discussionUrl: null, leaderUrl: null };
        cur.passage = cur.passage ?? passage;
        if (isLeader) cur.leaderUrl = href;
        if (isDiscussion) cur.discussionUrl = href;
        grouped.set(week, cur);
      }
      for (const [weekNumber, g] of grouped.entries()) {
        await upsertWeeklyGuide(env, {
          churchId: args.churchId,
          seriesSlug,
          weekNumber,
          passage: g.passage,
          discussionUrl: g.discussionUrl,
          leaderUrl: g.leaderUrl,
          now: args.now,
        });
      }
    }

    // Discover recent message detail URLs from campus index pages.
    const discoveredUrls = isCampusMessagesIndex
      ? Array.from(new Set(links.filter((l) => l.includes("enmse_mid=") && l.includes("/messages/")))).slice(0, 30)
      : ([] as string[]);

    let doc: { docId: string; sourceId: string } | null = null;
    let kbBody: string | null = null;

    if (effectiveChanged && text.trim()) {
      if (isMessageDetail && mid) {
        // Parse basic message metadata from the rendered text.
        const lines = text
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        const speakerDateIdx = lines.findIndex((ln) => / - [A-Za-z]+ \d{1,2}, \d{4}$/.test(ln));
        const speakerDate = speakerDateIdx >= 0 ? lines[speakerDateIdx] : null;
        const speaker = speakerDate ? speakerDate.split(" - ")[0].trim() : null;
        const dateStr = speakerDate ? speakerDate.split(" - ")[1].trim() : null;
        const preachedAt = dateStr ? new Date(dateStr).toISOString() : null;
        const titleLine = speakerDateIdx >= 0 ? lines.slice(speakerDateIdx + 1).find((ln) => ln.length >= 4) : null;
        const msgTitle = (titleLine ?? title ?? "Message").trim();

        const passageLine =
          lines.find((ln) => /Scripture References/i.test(ln))?.replace(/Scripture References:\s*/i, "").trim() ??
          lines.find((ln) => /^[1-3]?\s?[A-Za-z]+\s+\d+:\d+/.test(ln)) ??
          null;
        const passage = passageLine ? passageLine.trim() : null;

        const seriesLine = lines.find((ln) => /^From Series:/i.test(ln));
        const seriesTitle = seriesLine ? seriesLine.replace(/^From Series:\s*/i, "").split("|")[0].trim() : null;

        const campusId = inferCampusIdFromTid(tid);
        const messageId = `msg_${mid}`;

        const watchUrl = links.find((l) => l.includes("enmse_mid=" + mid) && l.includes("/messages/") && !l.includes("enmse_av=1")) ?? url;
        const listenUrl = links.find((l) => l.includes("enmse_mid=" + mid) && l.includes("enmse_av=1")) ?? null;
        const downloadUrl = links.find((l) => l.includes("calvarybible.s3.us-west-1.amazonaws.com") && /\.(m4a|mp3)(\?|$)/i.test(l)) ?? null;

        // Transcript: YouTube captions if embedded, otherwise ASR from downloadable audio (best-effort).
        let transcriptText: string | null = null;
        let transcriptSource: string | null = null;
        let transcriptError: string | null = null;
        const yt = extractYoutubeVideoIds(raw);
        if (yt.length) {
          const t = await fetchYouTubeTranscript(yt[0]);
          if (t?.text) {
            transcriptText = t.text;
            transcriptSource = t.source;
          }
        }
        if (!transcriptText && downloadUrl) {
          const t = await openAiTranscribeUrl(env, downloadUrl);
          if (t && (t as any)?.text) {
            transcriptText = (t as any).text;
            transcriptSource = `asr:${(t as any).model ?? "unknown"}`;
          } else if ((t as any)?.error) {
            transcriptError = String((t as any).error);
          }
        }

        // Link to weekly guide PDFs by matching passage to the latest guide index.
        const guideSeriesSlug = inferGuideSeriesSlug(seriesTitle, passage);
        let guide: { seriesSlug: string; weekNumber: number; discussionUrl: string | null; leaderUrl: string | null } | null = null;
        if (guideSeriesSlug && passage) {
          const passageKey = normalizePassageKey(passage);
          if (passageKey) {
            const row = (await env.churchcore
              .prepare(
                `SELECT series_slug AS seriesSlug, week_number AS weekNumber, discussion_url AS discussionUrl, leader_url AS leaderUrl
                 FROM weekly_guides WHERE church_id=?1 AND passage_key=?2
                 ORDER BY updated_at DESC LIMIT 1`,
              )
              .bind(args.churchId, passageKey)
              .first()) as any;
            if (row?.seriesSlug && row?.weekNumber) {
              guide = { seriesSlug: String(row.seriesSlug), weekNumber: Number(row.weekNumber), discussionUrl: row.discussionUrl ?? null, leaderUrl: row.leaderUrl ?? null };
            }
          }
        }

        await upsertCampusMessage(env, {
          churchId: args.churchId,
          messageId,
          campusId,
          title: msgTitle,
          speaker,
          preachedAt,
          passage,
          seriesTitle,
          seriesId: sid,
          campusFeedId: tid,
          sourceUrl: url,
          watchUrl,
          listenUrl,
          downloadUrl,
          guide,
          now: args.now,
        });

        const llm = await openAiSummarizeMessage(env, {
          title: msgTitle,
          speaker,
          preachedAt,
          passage,
          seriesTitle,
          campusId,
          pageText: text,
          transcriptText,
          transcriptSource,
        });
        const summaryMarkdown = llm?.summaryMarkdown ?? null;
        const extracted = llm?.extractedContentMarkdown?.trim() || "";
        const topics = llm?.topics ?? [];
        const verses = llm?.verses ?? [];
        const keyPoints = llm?.keyPoints ?? [];

        if (llm) {
          await upsertCampusMessageAnalysis(env, {
            churchId: args.churchId,
            messageId,
            summaryMarkdown,
            topics,
            verses,
            keyPoints,
            model: llm.model ?? null,
            source: "web_page_text",
            now: args.now,
          });
        }

        const md = [
          `Source: ${url}`,
          campusId ? `Campus: ${campusId}` : null,
          preachedAt ? `Date: ${preachedAt.slice(0, 10)}` : null,
          speaker ? `Speaker: ${speaker}` : null,
          passage ? `Passage: ${passage}` : null,
          seriesTitle ? `Series: ${seriesTitle}` : null,
          watchUrl ? `Watch: ${watchUrl}` : null,
          listenUrl ? `Listen: ${listenUrl}` : null,
          downloadUrl ? `Download: ${downloadUrl}` : null,
          transcriptSource ? `Transcript source: ${transcriptSource}` : null,
          transcriptError ? `Transcript error: ${transcriptError}` : null,
          guide?.discussionUrl ? `Discussion Questions: ${guide.discussionUrl}` : null,
          guide?.leaderUrl ? `Leader Guide: ${guide.leaderUrl}` : null,
          summaryMarkdown ? `## Summary\n\n${summaryMarkdown}` : null,
          topics.length ? `## Topics\n\n${topics.map((t: string) => `- ${t}`).join("\n")}` : null,
          verses.length ? `## Verses\n\n${verses.map((v: string) => `- ${v}`).join("\n")}` : null,
          keyPoints.length ? `## Key Points\n\n${keyPoints.map((p: string) => `- ${p}`).join("\n")}` : null,
          `## Extracted Content\n\n${extracted || text}`,
          transcriptText ? `## Transcript\n\n${transcriptText}` : null,
        ]
          .filter(Boolean)
          .join("\n\n");

        doc = await upsertCampusMessageDoc(env, { churchId: args.churchId, messageId, title: msgTitle, bodyMarkdown: md, now: args.now });
        kbBody = md;
      } else {
        doc = await upsertWebPageDoc(env, { churchId: args.churchId, url, title, bodyMarkdown, now: args.now });
        kbBody = bodyMarkdown;
      }
    }

    await upsertCrawlMeta(env, {
      churchId: args.churchId,
      url,
      etag: etag ?? null,
      lastModified: lastModified ?? null,
      contentHash,
      title,
      statusCode: status,
      lastFetchedAt: args.now,
      lastChangedAt: effectiveChanged ? args.now : null,
      error: null,
      now: args.now,
    });

    return { url, changed: effectiveChanged, status, doc, bodyMarkdown: kbBody ?? bodyMarkdown, discoveredUrls };
  } catch (e: any) {
    await upsertCrawlMeta(env, {
      churchId: args.churchId,
      url,
      etag: prev?.etag ?? null,
      lastModified: prev?.lastModified ?? null,
      contentHash: prev?.contentHash ?? null,
      title: null,
      statusCode: null,
      lastFetchedAt: args.now,
      lastChangedAt: null,
      error: String(e?.message ?? e ?? "fetch_failed"),
      now: args.now,
    });
    return { url, changed: false, error: String(e?.message ?? e ?? "fetch_failed"), discoveredUrls: [] as string[] };
  }
}

async function crawlBatch(env: Env, args: { churchId: string; urls: string[]; allowDomains: string[]; now: string; forceMessages?: boolean }) {
  const changedDocs: Array<{ docId: string; sourceId: string; bodyMarkdown: string }> = [];
  const discovered: string[] = [];
  const q = [...new Set(args.urls.map((u) => String(u).trim()).filter(Boolean))];
  const concurrency = 5;
  for (let i = 0; i < q.length; i += concurrency) {
    const slice = q.slice(i, i + concurrency);
    const results = await Promise.all(
      slice.map((url) => crawlOne(env, { churchId: args.churchId, url, allowDomains: args.allowDomains, now: args.now, forceMessages: args.forceMessages })),
    );
    for (const r of results as any[]) {
      if (r?.changed && r?.doc?.docId && typeof r?.bodyMarkdown === "string") {
        changedDocs.push({ docId: r.doc.docId, sourceId: r.doc.sourceId, bodyMarkdown: r.bodyMarkdown });
      }
      if (Array.isArray(r?.discoveredUrls)) discovered.push(...r.discoveredUrls.map((u: any) => String(u)));
    }
  }
  return { changedDocs, discoveredUrls: [...new Set(discovered)].filter(Boolean) };
}

function parseBookChapterRef(passage: string | null) {
  const p = String(passage ?? "").trim();
  if (!p) return null;
  // e.g. "John 14:1-14" -> "John 14"
  const m = p.match(/^((?:[1-3]\s*)?[A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(\d{1,3})\s*:/);
  if (!m) return null;
  const book = String(m[1]).trim().replace(/\s+/g, " ");
  const ch = String(m[2]).trim();
  return `${book} ${ch}`;
}

function ttlEscapeString(s: string) {
  // Turtle string literal escaping (minimal)
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function ttlLitString(s: any) {
  const v = String(s ?? "").trim();
  return `"${ttlEscapeString(v)}"`;
}

function ttlLitDate(s: any) {
  const v = String(s ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `"${v}"^^xsd:date` : ttlLitString(v);
}

function ttlLitDateTime(s: any) {
  const v = String(s ?? "").trim();
  // allow ISO-ish; fallback to string
  return /^\d{4}-\d{2}-\d{2}T/.test(v) ? `"${v}"^^xsd:dateTime` : ttlLitString(v);
}

function ttlIri(s: string) {
  const v = String(s ?? "").trim();
  if (!v) return "<>";
  // assumes v is already a valid absolute IRI
  return `<${v.replace(/[\s<>"]/g, "")}>`;
}

function graphDbHeaders(env: Env, accept?: string) {
  const username = String(env.GRAPHDB_USERNAME ?? "").trim();
  const password = String(env.GRAPHDB_PASSWORD ?? "").trim();
  const cfId = String(env.GRAPHDB_CF_ACCESS_CLIENT_ID ?? "").trim();
  const cfSecret = String(env.GRAPHDB_CF_ACCESS_CLIENT_SECRET ?? "").trim();
  const headers: Record<string, string> = {};
  if (accept) headers.accept = accept;
  if (username && password) headers.Authorization = `Basic ${base64EncodeUtf8(`${username}:${password}`)}`;
  if (cfId && cfSecret) {
    headers["CF-Access-Client-Id"] = cfId;
    headers["CF-Access-Client-Secret"] = cfSecret;
  }
  return headers;
}

function graphDbConfig(env: Env) {
  const baseUrl = String(env.GRAPHDB_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const repo = String(env.GRAPHDB_REPOSITORY ?? "").trim();
  if (!baseUrl) throw new Error("GRAPHDB_BASE_URL not configured");
  if (!repo) throw new Error("GRAPHDB_REPOSITORY not configured");
  return { baseUrl, repo };
}

async function graphDbClearGraph(env: Env, args: { contextIri: string }) {
  const { baseUrl, repo } = graphDbConfig(env);
  const url = `${baseUrl}/repositories/${encodeURIComponent(repo)}/statements?context=${encodeURIComponent(`<${args.contextIri}>`)}`;
  const res = await fetch(url, { method: "DELETE", headers: graphDbHeaders(env) });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`GraphDB clear graph failed (${res.status}): ${text.slice(0, 1000)}`);
  return { ok: true };
}

async function graphDbUploadTurtle(env: Env, args: { contextIri: string; turtle: string }) {
  const { baseUrl, repo } = graphDbConfig(env);
  const url = `${baseUrl}/repositories/${encodeURIComponent(repo)}/statements?context=${encodeURIComponent(`<${args.contextIri}>`)}`;
  const headers: Record<string, string> = {
    ...graphDbHeaders(env, "application/json"),
    "content-type": "text/turtle;charset=UTF-8",
  };
  const res = await fetch(url, { method: "POST", headers, body: args.turtle });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`GraphDB upload failed (${res.status}): ${text.slice(0, 1000)}`);
  return { ok: true };
}

async function d1All(env: Env, sql: string, binds: any[] = []) {
  const stmt = env.churchcore.prepare(sql);
  const out = await (binds.length ? stmt.bind(...binds) : stmt).all();
  const rows = (out as any)?.results;
  return Array.isArray(rows) ? rows : [];
}

function sanitizeSqlIdent(name: string) {
  const n = String(name ?? "").trim();
  if (!/^[A-Za-z0-9_]+$/.test(n)) throw new Error("invalid_sql_identifier");
  return n;
}

async function d1TableColumns(env: Env, table: string) {
  const t = sanitizeSqlIdent(table);
  try {
    const rows = await d1All(env, `PRAGMA table_info(${t})`);
    const cols = new Set<string>();
    for (const r of rows as any[]) {
      if (r && typeof r.name === "string") cols.add(r.name);
    }
    return cols;
  } catch {
    return new Set<string>();
  }
}

async function d1TableInfo(env: Env, table: string) {
  const t = sanitizeSqlIdent(table);
  try {
    const rows = await d1All(env, `PRAGMA table_info(${t})`);
    const out: Array<{ name: string; pk: number }> = [];
    for (const r of rows as any[]) {
      const name = typeof r?.name === "string" ? String(r.name) : "";
      const pk = typeof r?.pk === "number" ? Number(r.pk) : 0;
      if (name) out.push({ name, pk });
    }
    return out;
  } catch {
    return [];
  }
}

async function d1ListTables(env: Env) {
  const rows = await d1All(
    env,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
  );
  const out: string[] = [];
  for (const r of rows as any[]) {
    const n = typeof r?.name === "string" ? String(r.name).trim() : "";
    if (n) out.push(n);
  }
  return out;
}

function pickCol(cols: Set<string>, candidates: string[]) {
  for (const c of candidates) if (cols.has(c)) return c;
  return null;
}

function ttlPrefixes() {
  return [
    `@prefix cc: <https://ontology.churchcore.ai/cc#> .`,
    `@prefix cccomm: <https://ontology.churchcore.ai/cc/community#> .`,
    `@prefix cccong: <https://ontology.churchcore.ai/cc/congregation#> .`,
    `@prefix ccglobal: <https://ontology.churchcore.ai/cc/global#> .`,
    `@prefix ccbible: <https://ontology.churchcore.ai/cc/global/bible#> .`,
    `@prefix ccintent: <https://ontology.churchcore.ai/cc/intent#> .`,
    `@prefix ccproc: <https://ontology.churchcore.ai/cc/process#> .`,
    `@prefix ccprov: <https://ontology.churchcore.ai/cc/prov#> .`,
    `@prefix ccsit: <https://ontology.churchcore.ai/cc/situation#> .`,
    `@prefix prov: <http://www.w3.org/ns/prov#> .`,
    `@prefix at: <https://agentictrust.io/ontology/core#> .`,
    `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`,
    ``,
  ].join("\n");
}

async function syncGraphDbFromD1(env: Env, args: { churchId: string; mode: "full" | "append" }) {
  const churchId = String(args.churchId ?? "").trim();
  if (!churchId) throw new Error("churchId is required");

  const enabled = String(env.GRAPHDB_SYNC_ENABLED ?? "").trim() === "1";
  if (!enabled) return { ok: false, reason: "GRAPHDB_SYNC_ENABLED_not_set" as const };

  const contextBase = String(env.GRAPHDB_CONTEXT_BASE ?? "https://churchcore.ai/graph/d1").trim().replace(/\/+$/, "");
  const idBase = String(env.GRAPHDB_ID_BASE ?? "https://id.churchcore.ai").trim().replace(/\/+$/, "");
  const batch = clampInt(env.GRAPHDB_SYNC_BATCH, 200, 25, 1000);
  const contextIri = `${contextBase}/${encodeURIComponent(churchId)}`;

  // NOTE: GraphDB statements POST appends; for correctness we clear-by-graph on full sync.
  if (args.mode === "full") await graphDbClearGraph(env, { contextIri });

  let uploaded = 0;

  async function uploadChunk(lines: string[]) {
    if (!lines.length) return;
    const turtle = `${ttlPrefixes()}\n${lines.join("\n")}\n`;
    await graphDbUploadTurtle(env, { contextIri, turtle });
    uploaded += lines.length;
  }

  // churches
  {
    const cols = await d1TableColumns(env, "churches");
    const idCol = pickCol(cols, ["id", "church_id"]);
    const nameCol = pickCol(cols, ["name", "church_name", "title"]);
    const websiteCol = pickCol(cols, ["website", "website_url", "url"]);
    const createdCol = pickCol(cols, ["created_at", "createdAt", "created"]);
    const updatedCol = pickCol(cols, ["updated_at", "updatedAt", "updated"]);
    const selectCols = [
      idCol ? `${idCol} AS id` : null,
      nameCol ? `${nameCol} AS name` : null,
      websiteCol ? `${websiteCol} AS websiteUrl` : null,
      createdCol ? `${createdCol} AS createdAt` : null,
      updatedCol ? `${updatedCol} AS updatedAt` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const where = idCol ? `WHERE ${idCol}=?1` : "";
    const rows = selectCols
      ? await d1All(env, `SELECT ${selectCols} FROM churches ${where} LIMIT 1`, idCol ? [churchId] : [])
      : [];
    const lines: string[] = [];
    for (const r of rows as any[]) {
      const s = `${idBase}/church/${encodeURIComponent(String(r.id))}`;
      const parts: string[] = [`${ttlIri(s)} a cc:Church ; cc:name ${ttlLitString(r.name ?? "")}`];
      if (String(r.websiteUrl ?? "").trim()) parts.push(`; ccprov:sourceUrl ${ttlLitString(r.websiteUrl)}`);
      parts.push(`; prov:generatedAtTime ${ttlLitDateTime(r.updatedAt ?? r.createdAt ?? nowIso())} .`);
      lines.push(parts.join(" "));
    }
    await uploadChunk(lines);
  }

  // campuses
  {
    const cols = await d1TableColumns(env, "campuses");
    const idCol = pickCol(cols, ["id", "campus_id"]);
    const churchCol = pickCol(cols, ["church_id", "churchId"]);
    const nameCol = pickCol(cols, ["name", "campus_name", "title"]);
    const cityCol = pickCol(cols, ["city"]);
    const regionCol = pickCol(cols, ["region", "state"]);
    const createdCol = pickCol(cols, ["created_at", "createdAt"]);
    const updatedCol = pickCol(cols, ["updated_at", "updatedAt"]);

    const selectCols = [
      idCol ? `${idCol} AS id` : null,
      nameCol ? `${nameCol} AS name` : null,
      cityCol ? `${cityCol} AS city` : null,
      regionCol ? `${regionCol} AS region` : null,
      createdCol ? `${createdCol} AS createdAt` : null,
      updatedCol ? `${updatedCol} AS updatedAt` : null,
    ]
      .filter(Boolean)
      .join(", ");

    if (selectCols && idCol) {
      for (let offset = 0; ; offset += batch) {
        const where = churchCol ? `WHERE ${churchCol}=?1` : "";
        const sql = `SELECT ${selectCols} FROM campuses ${where} ORDER BY ${idCol} LIMIT ?2 OFFSET ?3`;
        const binds = churchCol ? [churchId, batch, offset] : [batch, offset];
        const rows = await d1All(env, sql, binds as any[]);
        if (!rows.length) break;
        const lines: string[] = [];
        for (const r of rows as any[]) {
          const s = `${idBase}/campus/${encodeURIComponent(String(r.id))}`;
          const church = `${idBase}/church/${encodeURIComponent(churchId)}`;
          const parts: string[] = [
            `${ttlIri(s)} a cc:Resource ; cc:name ${ttlLitString(r.name ?? "")} ; cc:inChurch ${ttlIri(church)}`,
          ];
          if (r.city) parts.push(`; cc:city ${ttlLitString(r.city)}`);
          if (r.region) parts.push(`; cc:region ${ttlLitString(r.region)}`);
          parts.push(`; prov:generatedAtTime ${ttlLitDateTime(r.updatedAt ?? r.createdAt ?? nowIso())} .`);
          lines.push(parts.join(" "));
        }
        await uploadChunk(lines);
        if (rows.length < batch) break;
      }
    }
  }

  // people
  {
    const cols = await d1TableColumns(env, "people");
    const idCol = pickCol(cols, ["id", "person_id"]);
    const churchCol = pickCol(cols, ["church_id", "churchId"]);
    const firstCol = pickCol(cols, ["first_name", "firstName"]);
    const lastCol = pickCol(cols, ["last_name", "lastName"]);
    const emailCol = pickCol(cols, ["email"]);
    const phoneCol = pickCol(cols, ["phone"]);
    const createdCol = pickCol(cols, ["created_at", "createdAt"]);
    const updatedCol = pickCol(cols, ["updated_at", "updatedAt"]);

    const selectCols = [
      idCol ? `${idCol} AS id` : null,
      firstCol ? `${firstCol} AS firstName` : null,
      lastCol ? `${lastCol} AS lastName` : null,
      emailCol ? `${emailCol} AS email` : null,
      phoneCol ? `${phoneCol} AS phone` : null,
      createdCol ? `${createdCol} AS createdAt` : null,
      updatedCol ? `${updatedCol} AS updatedAt` : null,
    ]
      .filter(Boolean)
      .join(", ");

    if (selectCols && idCol) {
      for (let offset = 0; ; offset += batch) {
        const where = churchCol ? `WHERE ${churchCol}=?1` : "";
        const sql = `SELECT ${selectCols} FROM people ${where} ORDER BY ${idCol} LIMIT ?2 OFFSET ?3`;
        const binds = churchCol ? [churchId, batch, offset] : [batch, offset];
        const rows = await d1All(env, sql, binds as any[]);
        if (!rows.length) break;
        const lines: string[] = [];
        for (const r of rows as any[]) {
          const s = `${idBase}/person/${encodeURIComponent(String(r.id))}`;
          const name = [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || String(r.id);
          const parts: string[] = [`${ttlIri(s)} a cc:Person ; cc:name ${ttlLitString(name)}`];
          if (r.email) parts.push(`; cc:email ${ttlLitString(r.email)}`);
          if (r.phone) parts.push(`; cc:phone ${ttlLitString(r.phone)}`);
          parts.push(`; prov:generatedAtTime ${ttlLitDateTime(r.updatedAt ?? r.createdAt ?? nowIso())} .`);
          lines.push(parts.join(" "));
        }
        await uploadChunk(lines);
        if (rows.length < batch) break;
      }
    }
  }

  // groups
  {
    const cols = await d1TableColumns(env, "groups");
    const idCol = pickCol(cols, ["id", "group_id"]);
    const churchCol = pickCol(cols, ["church_id", "churchId"]);
    const nameCol = pickCol(cols, ["name", "group_name", "title"]);
    const descCol = pickCol(cols, ["description", "notes"]);
    const createdCol = pickCol(cols, ["created_at", "createdAt"]);
    const updatedCol = pickCol(cols, ["updated_at", "updatedAt"]);

    const selectCols = [
      idCol ? `${idCol} AS id` : null,
      nameCol ? `${nameCol} AS name` : null,
      descCol ? `${descCol} AS description` : null,
      createdCol ? `${createdCol} AS createdAt` : null,
      updatedCol ? `${updatedCol} AS updatedAt` : null,
    ]
      .filter(Boolean)
      .join(", ");

    if (selectCols && idCol) {
      for (let offset = 0; ; offset += batch) {
        const where = churchCol ? `WHERE ${churchCol}=?1` : "";
        const sql = `SELECT ${selectCols} FROM groups ${where} ORDER BY ${idCol} LIMIT ?2 OFFSET ?3`;
        const binds = churchCol ? [churchId, batch, offset] : [batch, offset];
        const rows = await d1All(env, sql, binds as any[]);
        if (!rows.length) break;
        const lines: string[] = [];
        for (const r of rows as any[]) {
          const s = `${idBase}/group/${encodeURIComponent(String(r.id))}`;
          const parts: string[] = [
            `${ttlIri(s)} a cccomm:Group, cccong:SmallGroup ; cc:name ${ttlLitString(r.name ?? "")}`,
          ];
          if (r.description) parts.push(`; cc:description ${ttlLitString(r.description)}`);
          parts.push(`; prov:generatedAtTime ${ttlLitDateTime(r.updatedAt ?? r.createdAt ?? nowIso())} .`);
          lines.push(parts.join(" "));
        }
        await uploadChunk(lines);
        if (rows.length < batch) break;
      }
    }
  }

  // group memberships -> situation
  for (let offset = 0; ; offset += batch) {
    const rows = await d1All(
      env,
      `SELECT group_id AS groupId, person_id AS personId, role, status
       FROM group_memberships WHERE church_id=?1 ORDER BY group_id, person_id LIMIT ?2 OFFSET ?3`,
      [churchId, batch, offset],
    );
    if (!rows.length) break;
    const lines: string[] = [];
    for (const r of rows as any[]) {
      const sid = `${idBase}/situation/group_membership/${encodeURIComponent(String(r.groupId))}:${encodeURIComponent(String(r.personId))}`;
      const person = `${idBase}/person/${encodeURIComponent(String(r.personId))}`;
      const group = `${idBase}/group/${encodeURIComponent(String(r.groupId))}`;
      const parts: string[] = [
        `${ttlIri(sid)} a cccomm:GroupMembershipSituation ; cccomm:membershipPerson ${ttlIri(person)} ; cccomm:membershipGroup ${ttlIri(group)}`,
      ];
      if (r.status) parts.push(`; cccomm:membershipStatus ${ttlLitString(r.status)}`);
      if (r.role) parts.push(`; cc:roleName ${ttlLitString(r.role)}`);
      parts.push(`; ccsit:validFrom ${ttlLitDateTime(r.createdAt ?? nowIso())} ; prov:generatedAtTime ${ttlLitDateTime(r.updatedAt ?? r.createdAt ?? nowIso())} .`);
      lines.push(parts.join(" "));
    }
    await uploadChunk(lines);
    if (rows.length < batch) break;
  }

  // journey graph
  {
    const cols = await d1TableColumns(env, "journey_node");
    const idCol = pickCol(cols, ["id", "node_id"]);
    const churchCol = pickCol(cols, ["church_id", "churchId"]);
    const typeCol = pickCol(cols, ["type", "node_type"]);
    const titleCol = pickCol(cols, ["title", "name"]);
    const summaryCol = pickCol(cols, ["summary", "description"]);
    const stageOrderCol = pickCol(cols, ["stage_order", "stageOrder", "sort_order"]);
    const accessCol = pickCol(cols, ["access_level", "accessLevel"]);
    const createdCol = pickCol(cols, ["created_at", "createdAt"]);
    const updatedCol = pickCol(cols, ["updated_at", "updatedAt"]);

    const selectCols = [
      idCol ? `${idCol} AS id` : null,
      typeCol ? `${typeCol} AS type` : null,
      titleCol ? `${titleCol} AS title` : null,
      summaryCol ? `${summaryCol} AS summary` : null,
      stageOrderCol ? `${stageOrderCol} AS stageOrder` : null,
      accessCol ? `${accessCol} AS accessLevel` : null,
      createdCol ? `${createdCol} AS createdAt` : null,
      updatedCol ? `${updatedCol} AS updatedAt` : null,
    ]
      .filter(Boolean)
      .join(", ");

    if (selectCols && idCol) {
      for (let offset = 0; ; offset += batch) {
        const where = churchCol ? `WHERE ${churchCol}=?1` : "";
        const sql = `SELECT ${selectCols} FROM journey_node ${where} ORDER BY ${idCol} LIMIT ?2 OFFSET ?3`;
        const binds = churchCol ? [churchId, batch, offset] : [batch, offset];
        const rows = await d1All(env, sql, binds as any[]);
        if (!rows.length) break;
        const lines: string[] = [];
        for (const r of rows as any[]) {
          const s = `${idBase}/journey/node/${encodeURIComponent(String(r.id))}`;
          const parts: string[] = [`${ttlIri(s)} a cc:Resource ; cc:name ${ttlLitString(r.title ?? "")}`];
          if (r.type) parts.push(`; cc:nodeType ${ttlLitString(r.type)}`);
          if (r.summary) parts.push(`; cc:summary ${ttlLitString(r.summary)}`);
          if (typeof r.stageOrder === "number") parts.push(`; cc:stageOrder ${String(r.stageOrder)}`);
          if (r.accessLevel) parts.push(`; cc:accessLevel ${ttlLitString(r.accessLevel)}`);
          parts.push(`; prov:generatedAtTime ${ttlLitDateTime(r.updatedAt ?? r.createdAt ?? nowIso())} .`);
          lines.push(parts.join(" "));
        }
        await uploadChunk(lines);
        if (rows.length < batch) break;
      }
    }
  }

  {
    const cols = await d1TableColumns(env, "journey_edge");
    const idCol = pickCol(cols, ["id", "edge_id"]);
    const churchCol = pickCol(cols, ["church_id", "churchId"]);
    const typeCol = pickCol(cols, ["type", "edge_type"]);
    const fromCol = pickCol(cols, ["from_node_id", "fromNodeId", "from_id"]);
    const toCol = pickCol(cols, ["to_node_id", "toNodeId", "to_id"]);
    const titleCol = pickCol(cols, ["title", "name"]);
    const summaryCol = pickCol(cols, ["summary", "description"]);
    const createdCol = pickCol(cols, ["created_at", "createdAt"]);
    const updatedCol = pickCol(cols, ["updated_at", "updatedAt"]);

    const selectCols = [
      idCol ? `${idCol} AS id` : null,
      typeCol ? `${typeCol} AS type` : null,
      fromCol ? `${fromCol} AS fromNodeId` : null,
      toCol ? `${toCol} AS toNodeId` : null,
      titleCol ? `${titleCol} AS title` : null,
      summaryCol ? `${summaryCol} AS summary` : null,
      createdCol ? `${createdCol} AS createdAt` : null,
      updatedCol ? `${updatedCol} AS updatedAt` : null,
    ]
      .filter(Boolean)
      .join(", ");

    if (selectCols && idCol && fromCol && toCol) {
      for (let offset = 0; ; offset += batch) {
        const where = churchCol ? `WHERE ${churchCol}=?1` : "";
        const sql = `SELECT ${selectCols} FROM journey_edge ${where} ORDER BY ${idCol} LIMIT ?2 OFFSET ?3`;
        const binds = churchCol ? [churchId, batch, offset] : [batch, offset];
        const rows = await d1All(env, sql, binds as any[]);
        if (!rows.length) break;
        const lines: string[] = [];
        for (const r of rows as any[]) {
          const s = `${idBase}/journey/edge/${encodeURIComponent(String(r.id))}`;
          const from = `${idBase}/journey/node/${encodeURIComponent(String(r.fromNodeId))}`;
          const to = `${idBase}/journey/node/${encodeURIComponent(String(r.toNodeId))}`;
          const parts: string[] = [
            `${ttlIri(s)} a cc:Resource ; cc:edgeType ${ttlLitString(r.type ?? "")} ; cc:fromNode ${ttlIri(from)} ; cc:toNode ${ttlIri(to)}`,
          ];
          if (r.title) parts.push(`; cc:name ${ttlLitString(r.title)}`);
          if (r.summary) parts.push(`; cc:summary ${ttlLitString(r.summary)}`);
          parts.push(`; prov:generatedAtTime ${ttlLitDateTime(r.updatedAt ?? r.createdAt ?? nowIso())} .`);
          lines.push(parts.join(" "));
        }
        await uploadChunk(lines);
        if (rows.length < batch) break;
      }
    }
  }

  // raw D1 export (all tables) into the SAME per-church graph.
  // This ensures nothing is dropped while we incrementally improve ontology-aligned mappings.
  {
    const tables = await d1ListTables(env);
    for (const table of tables) {
      const info = await d1TableInfo(env, table);
      const cols = info.map((c) => c.name);
      if (!cols.length) continue;

      const colsSet = new Set(cols);
      const churchCol = pickCol(colsSet, ["church_id", "churchId"]);
      const idCol = pickCol(colsSet, ["id"]);
      const pkCols = info
        .filter((c) => typeof c.pk === "number" && c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);

      const orderCols = (pkCols.length ? pkCols : idCol ? [idCol] : []).map(sanitizeSqlIdent);
      const orderClause = orderCols.length ? `ORDER BY ${orderCols.join(", ")}` : "";

      // If no PK/id ordering, fall back to rowid ordering (best-effort).
      const selectRowId = orderCols.length ? "" : ", rowid AS __rowid";
      const orderRowId = orderCols.length ? "" : "ORDER BY __rowid";

      const safeTable = sanitizeSqlIdent(table);
      const safeCols = cols.map(sanitizeSqlIdent);
      const selectCols = safeCols.map((c) => `${c} AS ${c}`).join(", ");
      const where = churchCol ? `WHERE ${sanitizeSqlIdent(churchCol)}=?1` : "";

      for (let offset = 0; ; offset += batch) {
        const sql = churchCol
          ? `SELECT ${selectCols}${selectRowId} FROM ${safeTable} ${where} ${orderClause || orderRowId} LIMIT ?2 OFFSET ?3`
          : `SELECT ${selectCols}${selectRowId} FROM ${safeTable} ${where} ${orderClause || orderRowId} LIMIT ?1 OFFSET ?2`;
        const binds = churchCol ? [churchId, batch, offset] : [batch, offset];
        const rows = await d1All(env, sql, binds as any[]);
        if (!rows.length) break;

        const lines: string[] = [];
        for (const r of rows as any[]) {
          // Stable row key
          let key = "";
          if (pkCols.length && pkCols.every((c) => r?.[c] !== null && r?.[c] !== undefined && String(r?.[c]).trim() !== "")) {
            key = pkCols.map((c) => String(r[c])).join("|");
          } else if (idCol && r?.[idCol] !== null && r?.[idCol] !== undefined && String(r?.[idCol]).trim() !== "") {
            key = String(r[idCol]);
          } else if (r?.__rowid !== null && r?.__rowid !== undefined) {
            key = `rowid:${String(r.__rowid)}`;
          } else {
            key = `h:${(await sha256Hex(JSON.stringify(r))).slice(0, 16)}`;
          }

          const subj = `${idBase}/d1raw/${encodeURIComponent(churchId)}/${encodeURIComponent(table)}/${encodeURIComponent(key)}`;
          const classIri = `${idBase}/d1raw/schema/${encodeURIComponent(table)}`;

          const parts: string[] = [`${ttlIri(subj)} a ${ttlIri(classIri)}`];
          for (const c of cols) {
            const v = (r as any)?.[c];
            if (v === null || v === undefined) continue;
            const pred = `${idBase}/d1raw/schema/${encodeURIComponent(table)}#${encodeURIComponent(c)}`;
            if (typeof v === "number") {
              const lit = Number.isInteger(v) ? `"${String(v)}"^^xsd:integer` : `"${String(v)}"^^xsd:decimal`;
              parts.push(`; ${ttlIri(pred)} ${lit}`);
              continue;
            }
            if (typeof v === "boolean") {
              parts.push(`; ${ttlIri(pred)} "${v ? "true" : "false"}"^^xsd:boolean`);
              continue;
            }
            parts.push(`; ${ttlIri(pred)} ${ttlLitString(String(v))}`);
          }
          parts.push(` .`);
          lines.push(parts.join(" "));
        }

        await uploadChunk(lines);
        if (rows.length < batch) break;
      }
    }
  }

  await auditAppend(env, {
    churchId,
    actorUserId: null,
    action: "graphdb.sync",
    entityType: "graphdb",
    entityId: contextIri,
    payload: { mode: args.mode, uploadedLines: uploaded, batch },
  });

  return { ok: true, churchId, contextIri, mode: args.mode, uploadedLines: uploaded, batch };
}

async function upsertBibleReadingWeek(
  env: Env,
  args: {
    churchId: string;
    campusId: string;
    anchorMessageId: string;
    preachedDate: string;
    weekStartDate: string;
    weekEndDate: string;
    title: string | null;
    passage: string | null;
    now: string;
  },
) {
  const id = `brw_${(await sha256Hex(`${args.churchId}:${args.campusId}:${args.weekStartDate}`)).slice(0, 24)}`;
  await env.churchcore
    .prepare(
      `INSERT INTO bible_reading_weeks (id, church_id, campus_id, anchor_message_id, preached_date, week_start_date, week_end_date, title, passage, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT(church_id, campus_id, week_start_date) DO UPDATE SET
         anchor_message_id=excluded.anchor_message_id,
         preached_date=excluded.preached_date,
         week_end_date=excluded.week_end_date,
         title=excluded.title,
         passage=excluded.passage,
         updated_at=excluded.updated_at`,
    )
    .bind(id, args.churchId, args.campusId, args.anchorMessageId, args.preachedDate, args.weekStartDate, args.weekEndDate, args.title, args.passage, args.now, args.now)
    .run();
  return id;
}

async function upsertBibleReadingItem(
  env: Env,
  args: {
    churchId: string;
    weekId: string;
    dayDate: string;
    kind: "reading" | "daily_verse" | "reflection";
    ref: string | null;
    label: string;
    notesMarkdown: string | null;
    now: string;
  },
) {
  const refKey = (args.ref ?? "").trim().toLowerCase();
  const id = `bri_${(await sha256Hex(`${args.churchId}:${args.weekId}:${args.dayDate}:${args.kind}:${refKey || "none"}`)).slice(0, 24)}`;
  await env.churchcore
    .prepare(
      `INSERT INTO bible_reading_items (id, church_id, week_id, day_date, kind, ref, label, notes_markdown, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT(id) DO UPDATE SET
         label=excluded.label,
         ref=excluded.ref,
         notes_markdown=excluded.notes_markdown,
         updated_at=excluded.updated_at`,
    )
    .bind(id, args.churchId, args.weekId, args.dayDate, args.kind, args.ref ?? null, args.label, args.notesMarkdown ?? null, args.now, args.now)
    .run();
  return id;
}

async function generateBibleReadingPlanForCampus(env: Env, args: { churchId: string; campusId: string; now: string }) {
  const row = (await env.churchcore
    .prepare(
      `SELECT m.id AS messageId, m.title, m.passage, m.preached_at AS preachedAt, m.preached_date AS preachedDate, m.week_start_date AS weekStartDate, m.week_end_date AS weekEndDate,
              m.guide_discussion_url AS guideDiscussionUrl, m.guide_leader_url AS guideLeaderUrl,
              a.verses_json AS versesJson
       FROM campus_messages m
       LEFT JOIN campus_message_analysis a ON a.message_id = m.id
       WHERE m.church_id=?1 AND m.campus_id=?2 AND m.preached_at IS NOT NULL
       ORDER BY m.preached_at DESC, m.updated_at DESC
       LIMIT 1`,
    )
    .bind(args.churchId, args.campusId)
    .first()) as any;
  if (!row?.messageId) return { ok: false, reason: "no_sermon" as const };

  const preachedDate = (typeof row.preachedDate === "string" && row.preachedDate.trim()) || (typeof row.preachedAt === "string" ? String(row.preachedAt).slice(0, 10) : "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preachedDate)) return { ok: false, reason: "missing_preached_date" as const };
  const weekStartDate = (typeof row.weekStartDate === "string" && row.weekStartDate.trim()) || nextMondayDate(preachedDate);
  if (!weekStartDate) return { ok: false, reason: "missing_week_start" as const };
  const weekEndDate = (typeof row.weekEndDate === "string" && row.weekEndDate.trim()) || addDaysDate(weekStartDate, 6);
  if (!weekEndDate) return { ok: false, reason: "missing_week_end" as const };

  const title = typeof row.title === "string" ? row.title : null;
  const passage = typeof row.passage === "string" ? row.passage : null;
  const chapterRef = parseBookChapterRef(passage) ?? passage;

  let verses: string[] = [];
  try {
    const raw = typeof row.versesJson === "string" ? JSON.parse(row.versesJson) : null;
    if (Array.isArray(raw)) verses = raw.map((v: any) => String(v)).map((s) => s.trim()).filter(Boolean);
  } catch {
    verses = [];
  }
  const dedup = new Set<string>();
  const versesClean: string[] = [];
  for (const v of verses) {
    const k = v.toLowerCase();
    if (dedup.has(k)) continue;
    if (passage && k === passage.toLowerCase()) continue;
    dedup.add(k);
    versesClean.push(v);
    if (versesClean.length >= 5) break;
  }

  const weekId = await upsertBibleReadingWeek(env, {
    churchId: args.churchId,
    campusId: args.campusId,
    anchorMessageId: String(row.messageId),
    preachedDate,
    weekStartDate,
    weekEndDate,
    title,
    passage,
    now: args.now,
  });

  const guideDiscussionUrl = typeof row.guideDiscussionUrl === "string" ? row.guideDiscussionUrl.trim() : "";
  const guideLeaderUrl = typeof row.guideLeaderUrl === "string" ? row.guideLeaderUrl.trim() : "";

  const day = (n: number) => addDaysDate(weekStartDate, n) as string;
  await upsertBibleReadingItem(env, {
    churchId: args.churchId,
    weekId,
    dayDate: day(0),
    kind: "reading",
    ref: passage,
    label: "Day 1: Re-read Sunday's passage",
    notesMarkdown: "Ask: What does this show me about Jesus? What response is Jesus inviting?",
    now: args.now,
  });
  await upsertBibleReadingItem(env, {
    churchId: args.churchId,
    weekId,
    dayDate: day(1),
    kind: "reading",
    ref: chapterRef,
    label: "Day 2: Read the surrounding chapter",
    notesMarkdown: "Note repeated words, commands, and promises. Write one takeaway.",
    now: args.now,
  });
  const v1 = versesClean[0] ?? passage;
  const v2 = versesClean[1] ?? versesClean[0] ?? null;
  const v3 = versesClean[2] ?? versesClean[1] ?? null;
  await upsertBibleReadingItem(env, {
    churchId: args.churchId,
    weekId,
    dayDate: day(2),
    kind: "daily_verse",
    ref: v1,
    label: "Day 3: Verse of the day",
    notesMarkdown: "Memorize or rewrite in your own words. Pray it back to God.",
    now: args.now,
  });
  if (v2) {
    await upsertBibleReadingItem(env, {
      churchId: args.churchId,
      weekId,
      dayDate: day(3),
      kind: "daily_verse",
      ref: v2,
      label: "Day 4: Verse of the day",
      notesMarkdown: "What difference would believing this make today?",
      now: args.now,
    });
  }
  if (v3) {
    await upsertBibleReadingItem(env, {
      churchId: args.churchId,
      weekId,
      dayDate: day(4),
      kind: "daily_verse",
      ref: v3,
      label: "Day 5: Verse of the day",
      notesMarkdown: "Share one line with your guide or a friend.",
      now: args.now,
    });
  }
  await upsertBibleReadingItem(env, {
    churchId: args.churchId,
    weekId,
    dayDate: day(5),
    kind: "reflection",
    ref: "Psalm 23",
    label: "Day 6: Prayer day",
    notesMarkdown: "Pray slowly. Where do you need God's comfort this week?",
    now: args.now,
  });
  const guideLinks = [
    guideDiscussionUrl ? `Discussion guide: ${guideDiscussionUrl}` : null,
    guideLeaderUrl ? `Leader guide: ${guideLeaderUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  await upsertBibleReadingItem(env, {
    churchId: args.churchId,
    weekId,
    dayDate: day(6),
    kind: "reflection",
    ref: passage,
    label: "Day 7: Recap + discussion",
    notesMarkdown: ["Review the sermon and write one next step.", guideLinks || null].filter(Boolean).join("\n\n"),
    now: args.now,
  });

  return { ok: true, weekId, weekStartDate, anchorMessageId: String(row.messageId) };
}

async function generateBibleReadingPlans(env: Env, args: { churchId: string; now: string }) {
  const campuses = ["campus_boulder", "campus_erie", "campus_thornton"];
  const out: any[] = [];
  for (const campusId of campuses) {
    try {
      out.push(await generateBibleReadingPlanForCampus(env, { churchId: args.churchId, campusId, now: args.now }));
    } catch (e: any) {
      out.push({ ok: false, campusId, error: String(e?.message ?? e ?? "plan_failed") });
    }
  }
  return out;
}

async function discoverDailyUrls(env: Env, args: { allowDomains: string[]; budget: number }) {
  const out: string[] = [];
  const root = "https://calvarybible.com/sitemap.xml";
  try {
    const res = await fetch(root, { headers: { "user-agent": "churchcore-mcp-crawler/0.1" } });
    const xml = await res.text();
    const locs = parseSitemapXml(xml);
    // If this is a sitemap index, pull a few nested maps.
    const nested = locs.filter((u) => u.endsWith(".xml")).slice(0, 5);
    if (nested.length) {
      for (const sm of nested) {
        const r = await fetch(sm, { headers: { "user-agent": "churchcore-mcp-crawler/0.1" } });
        const x = await r.text();
        out.push(...parseSitemapXml(x));
        if (out.length >= args.budget * 3) break;
      }
    } else {
      out.push(...locs);
    }
  } catch {
    // ignore
  }
  const filtered = out
    .map((u) => String(u).trim())
    .filter(Boolean)
    .filter((u) => !u.endsWith(".xml"))
    .filter((u) => !/\.(jpg|jpeg|png|gif|webp|pdf|mp3|mp4)(\?|$)/i.test(u))
    .filter((u) => isAllowedUrl(u, args.allowDomains));
  return filtered.slice(0, args.budget);
}

async function runScheduledCrawl(env: Env, cron: string, opts?: { forceMessages?: boolean }) {
  const churchId = (env.CRAWL_CHURCH_ID ?? "calvarybible").trim() || "calvarybible";
  const budget = clampInt(env.CRAWL_BUDGET, 50, 10, 500);
  const allowDomains = parseDomainAllowlist(env);
  const now = nowIso();

  const keyPages = [
    "https://calvarybible.com/theweekly/",
    "https://calvarybible.com/messages/",
    "https://calvarybible.com/messages/boulder/",
    "https://calvarybible.com/messages/erie/",
    "https://calvarybible.com/messages/thornton/",
    "https://calvarybible.com/discussion/",
    "https://calvarybible.com/discussion/john/",
    "https://calvarybible.com/locations/",
    "https://calvarybible.com/message-archive/",
    "https://calvarybible.com/events/",
    "https://calvarybible.com/mission-vision/",
  ];

  const isDaily = String(cron || "").includes("3 * * *");
  const reserveForMessageDetails = isDaily ? 20 : 25;
  const daily = isDaily ? await discoverDailyUrls(env, { allowDomains, budget }) : [];
  const seedLimit = Math.max(keyPages.length, budget - reserveForMessageDetails);
  const seedUrls = [...new Set([...keyPages, ...daily])].slice(0, seedLimit);

  const first = await crawlBatch(env, { churchId, urls: seedUrls, allowDomains, now, forceMessages: opts?.forceMessages });
  const messageUrlBudget = Math.max(0, budget - seedUrls.length);
  const messageUrls = first.discoveredUrls
    .filter((u) => u.includes("/messages/") && u.includes("enmse_mid="))
    .filter((u) => !u.includes("enmse_o=")) // avoid paging controls
    // Prefer newest messages (enmse_mid is monotonically increasing).
    .sort((a, b) => {
      try {
        const ma = Number(new URL(a).searchParams.get("enmse_mid") || 0);
        const mb = Number(new URL(b).searchParams.get("enmse_mid") || 0);
        return mb - ma;
      } catch {
        return 0;
      }
    })
    .slice(0, messageUrlBudget);

  const second = messageUrls.length
    ? await crawlBatch(env, { churchId, urls: messageUrls, allowDomains, now, forceMessages: opts?.forceMessages })
    : { changedDocs: [], discoveredUrls: [] as string[] };
  const changedDocs = [...first.changedDocs, ...second.changedDocs];

  // KB refresh for changed pages only.
  for (const d of changedDocs) {
    await refreshKbForSource(env, { churchId, sourceId: d.sourceId, docId: d.docId, text: d.bodyMarkdown, now });
  }

  // Generate/update weekly Bible reading plans anchored to the latest sermon per campus.
  await generateBibleReadingPlans(env, { churchId, now });

  // Best-effort: ingest weekly discussion/leader guides into KB for grounding.
  await ingestWeeklyGuidesToKb(env, { churchId, now, limit: 12 });

  await auditAppend(env, {
    churchId,
    actorUserId: null,
    action: "web.crawl.scheduled",
    entityType: "web_crawl_pages",
    entityId: null,
    payload: { cron, budget, changed: changedDocs.length, urls: seedUrls.length + messageUrls.length },
  });
  return { ok: true, changed: changedDocs.length, urls: seedUrls.length + messageUrls.length };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const auth = checkApiKey(request, env);
    if (auth) return auth;

    // Manual trigger for live system (protected by x-api-key if MCP_API_KEY is set).
    // POST /admin/run-crawl  body: { mode?: "key"|"daily", forceMessages?: boolean }
    const u = new URL(request.url);

    if (u.pathname === "/admin/run-crawl" && request.method.toUpperCase() === "POST") {
      const body = (await request.json().catch(() => ({}))) as any;
      const mode = String(body?.mode ?? "key").toLowerCase();
      const forceMessages = Boolean(body?.forceMessages);
      const cron = mode === "daily" ? "manual 15 3 * * *" : "manual 0 */6 * * *";
      const result = await runScheduledCrawl(env, cron, { forceMessages });
      return Response.json(result, { status: 200 });
    }

    // POST /admin/graphdb-sync  body: { mode?: "full"|"append", churchId?: string }
    if (u.pathname === "/admin/graphdb-sync" && request.method.toUpperCase() === "POST") {
      try {
        const body = (await request.json().catch(() => ({}))) as any;
        const churchId = String(body?.churchId ?? env.CRAWL_CHURCH_ID ?? "calvarybible").trim() || "calvarybible";
        const mode = String(body?.mode ?? "full").toLowerCase() === "append" ? ("append" as const) : ("full" as const);
        const result = await syncGraphDbFromD1(env, { churchId, mode });
        return Response.json(result, { status: 200 });
      } catch (e: any) {
        return Response.json({ ok: false, error: String(e?.message ?? e ?? "graphdb_sync_failed") }, { status: 500 });
      }
    }

    if (u.pathname === "/admin/transcribe-message" && request.method.toUpperCase() === "POST") {
      try {
        const now = nowIso();
        const body = (await request.json().catch(() => ({}))) as any;
        const churchId = (env.CRAWL_CHURCH_ID ?? "calvarybible").trim() || "calvarybible";
        const messageId = String(body?.messageId ?? "").trim();
        if (!messageId) return Response.json({ ok: false, error: "missing_messageId" }, { status: 400 });

        const row = (await env.churchcore
          .prepare(
            `SELECT id, campus_id AS campusId, title, speaker, preached_at AS preachedAt, passage, series_title AS seriesTitle,
                    source_url AS sourceUrl, download_url AS downloadUrl, listen_url AS listenUrl, watch_url AS watchUrl,
                    guide_discussion_url AS guideDiscussionUrl, guide_leader_url AS guideLeaderUrl
             FROM campus_messages WHERE church_id=?1 AND id=?2`,
          )
          .bind(churchId, messageId)
          .first()) as any;
        if (!row) return Response.json({ ok: false, error: "unknown_messageId" }, { status: 404 });

        const audioUrl = String(row.downloadUrl || row.listenUrl || "").trim();
        if (!audioUrl) return Response.json({ ok: false, error: "missing_audio_url" }, { status: 400 });

        const maxBytes = clampInt(env.TRANSCRIBE_MAX_BYTES, 24 * 1024 * 1024, 1024 * 1024, 100 * 1024 * 1024);
        const ext = audioUrl.toLowerCase().includes(".m4a") ? "m4a" : audioUrl.toLowerCase().includes(".mp3") ? "mp3" : "audio";
        const mimeType = ext === "m4a" ? "audio/mp4" : ext === "mp3" ? "audio/mpeg" : null;
        const filename = `sermon.${ext}`;

        const tr = await openAiTranscribeAudio(env, { audioUrl, filename, mimeType, maxBytes });
        const transcriptText = tr.text.trim();
        if (!transcriptText) return Response.json({ ok: false, error: "empty_transcript" }, { status: 502 });

        const applied = await applyTranscriptToMessage(env, {
          churchId,
          messageId,
          transcriptText,
          transcriptSource: audioUrl,
          transcriptModel: tr.model,
          analysisSource: "audio_transcript",
          now,
        });

        return Response.json({ ok: true, messageId, audioUrl, transcriptModel: tr.model, ...applied, kbRefreshed: true }, { status: 200 });
      } catch (e: any) {
        return Response.json({ ok: false, error: String(e?.message ?? e ?? "transcribe_failed") }, { status: 500 });
      }
    }

    // POST /admin/upsert-message-transcript
    // body: { messageId, transcriptText, transcriptSource?, transcriptModel? }
    // Use this when audio/video is too large for the Worker to transcribe.
    if (u.pathname === "/admin/upsert-message-transcript" && request.method.toUpperCase() === "POST") {
      try {
        const now = nowIso();
        const body = (await request.json().catch(() => ({}))) as any;
        const churchId = (env.CRAWL_CHURCH_ID ?? "calvarybible").trim() || "calvarybible";
        const messageId = String(body?.messageId ?? "").trim();
        const transcriptText = String(body?.transcriptText ?? "").trim();
        const transcriptSource = body?.transcriptSource ? String(body.transcriptSource).trim() : null;
        const transcriptModel = body?.transcriptModel ? String(body.transcriptModel).trim() : null;
        if (!messageId) return Response.json({ ok: false, error: "missing_messageId" }, { status: 400 });
        if (!transcriptText) return Response.json({ ok: false, error: "missing_transcriptText" }, { status: 400 });

        const applied = await applyTranscriptToMessage(env, {
          churchId,
          messageId,
          transcriptText,
          transcriptSource,
          transcriptModel,
          analysisSource: "external_transcript",
          now,
        });

        return Response.json({ ok: true, messageId, upsertedTranscript: true, ...applied, kbRefreshed: true }, { status: 200 });
      } catch (e: any) {
        return Response.json({ ok: false, error: String(e?.message ?? e ?? "upsert_transcript_failed") }, { status: 500 });
      }
    }

    // POST /admin/queue-assemblyai-transcription  body: { messageId }
    if (u.pathname === "/admin/queue-assemblyai-transcription" && request.method.toUpperCase() === "POST") {
      try {
        const now = nowIso();
        const body = (await request.json().catch(() => ({}))) as any;
        const churchId = (env.CRAWL_CHURCH_ID ?? "calvarybible").trim() || "calvarybible";
        const messageId = String(body?.messageId ?? "").trim();
        if (!messageId) return Response.json({ ok: false, error: "missing_messageId" }, { status: 400 });

        const row = (await env.churchcore
          .prepare(`SELECT download_url AS downloadUrl, listen_url AS listenUrl FROM campus_messages WHERE church_id=?1 AND id=?2`)
          .bind(churchId, messageId)
          .first()) as any;
        if (!row) return Response.json({ ok: false, error: "unknown_messageId" }, { status: 404 });
        const audioUrl = String(row.downloadUrl || row.listenUrl || "").trim();
        if (!audioUrl) return Response.json({ ok: false, error: "missing_audio_url" }, { status: 400 });

        const existing = (await env.churchcore
          .prepare(
            `SELECT id,status FROM transcription_jobs
             WHERE church_id=?1 AND message_id=?2 AND provider='assemblyai' AND status IN ('queued','processing')
             ORDER BY updated_at DESC LIMIT 1`,
          )
          .bind(churchId, messageId)
          .first()) as any;
        if (existing?.id) {
          return Response.json({ ok: true, jobId: String(existing.id), messageId, provider: "assemblyai", status: String(existing.status) }, { status: 200 });
        }

        const jobId = await transcriptionJobCreate(env, { churchId, messageId, provider: "assemblyai", audioUrl, now });
        return Response.json({ ok: true, jobId, messageId, provider: "assemblyai", status: "queued" }, { status: 200 });
      } catch (e: any) {
        return Response.json({ ok: false, error: String(e?.message ?? e ?? "queue_failed") }, { status: 500 });
      }
    }

    // POST /admin/queue-assemblyai-transcription-missing  body: { limit?: number }
    if (u.pathname === "/admin/queue-assemblyai-transcription-missing" && request.method.toUpperCase() === "POST") {
      try {
        const body = (await request.json().catch(() => ({}))) as any;
        const churchId = (env.CRAWL_CHURCH_ID ?? "calvarybible").trim() || "calvarybible";
        const limit = clampInt(body?.limit, 50, 1, 500);
        const result = await queueMissingAssemblyAiJobs(env, { churchId, limit });
        return Response.json(result, { status: 200 });
      } catch (e: any) {
        return Response.json({ ok: false, error: String(e?.message ?? e ?? "queue_missing_failed") }, { status: 500 });
      }
    }

    // POST /admin/process-transcription-jobs  body: { limit?: number }
    if (u.pathname === "/admin/process-transcription-jobs" && request.method.toUpperCase() === "POST") {
      try {
        const body = (await request.json().catch(() => ({}))) as any;
        const churchId = (env.CRAWL_CHURCH_ID ?? "calvarybible").trim() || "calvarybible";
        const limit = clampInt(body?.limit, 3, 1, 25);
        const result = await processAssemblyAiJobs(env, { churchId, limit });
        return Response.json(result, { status: 200 });
      } catch (e: any) {
        return Response.json({ ok: false, error: String(e?.message ?? e ?? "process_failed") }, { status: 500 });
      }
    }

    const server = createServer(env);
    return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const cron = String((event as any).cron ?? "");
    const churchId = (env.CRAWL_CHURCH_ID ?? "calvarybible").trim() || "calvarybible";
    ctx.waitUntil(runScheduledCrawl(env, cron));
    // Auto-queue missing sermon transcripts (bounded) so transcripts arrive without manual admin calls.
    // Uses AssemblyAI queue+poll flow (requires ASSEMBLYAI_API_KEY).
    try {
      const enabled = String((env as any).TRANSCRIPTION_AUTO_QUEUE_ENABLED ?? "1").trim() === "1";
      const apiKey = String((env as any).ASSEMBLYAI_API_KEY ?? "").trim();
      if (enabled && apiKey) {
        const limit = clampInt((env as any).TRANSCRIPTION_AUTO_QUEUE_LIMIT, 10, 1, 200);
        ctx.waitUntil(queueMissingAssemblyAiJobs(env, { churchId, limit }));
      }
    } catch {
      // best-effort
    }
    ctx.waitUntil(processAssemblyAiJobs(env, { churchId, limit: 2 }));
    // Daily GraphDB sync (opt-in via GRAPHDB_SYNC_ENABLED=1)
    if (String(env.GRAPHDB_SYNC_ENABLED ?? "").trim() === "1" && cron.includes("15 3")) {
      ctx.waitUntil(syncGraphDbFromD1(env, { churchId, mode: "full" }));
    }
  },
};

