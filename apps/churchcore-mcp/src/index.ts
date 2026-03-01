import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export type Env = {
  MCP_API_KEY?: string;
  churchcore: D1Database;
};

function nowIso() {
  return new Date().toISOString();
}

function jsonText(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj) }],
  };
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

      let sql = `SELECT id,title,description,start_at,end_at,location_name,location_address
                 FROM events
                 WHERE church_id=?1 AND start_at >= ?2`;
      const binds: any[] = [churchId, fromIso];

      if (campusId) {
        sql += ` AND campus_id=?${binds.length + 1}`;
        binds.push(campusId);
      }
      if (toIso) {
        sql += ` AND start_at <= ?${binds.length + 1}`;
        binds.push(toIso);
      }

      sql += ` ORDER BY start_at ASC LIMIT 50`;

      const rows = (await env.churchcore.prepare(sql).bind(...binds).all()).results ?? [];
      return jsonText({ events: rows });
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
      const campuses = (await env.churchcore.prepare(`SELECT * FROM campuses WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const locations = (await env.churchcore.prepare(`SELECT * FROM locations WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const services = (await env.churchcore.prepare(`SELECT * FROM services WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const servicePlans = (await env.churchcore.prepare(`SELECT * FROM service_plans WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const servicePlanItems = (await env.churchcore.prepare(`SELECT * FROM service_plan_items WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const events = (await env.churchcore.prepare(`SELECT * FROM events WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const outreaches = (await env.churchcore.prepare(`SELECT * FROM outreach_campaigns WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const groups = (await env.churchcore.prepare(`SELECT * FROM groups WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const opportunities = (await env.churchcore.prepare(`SELECT * FROM opportunities WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];
      const resources = (await env.churchcore.prepare(`SELECT * FROM resources WHERE church_id=?1 LIMIT ${limit}`).bind(parsed.churchId).all()).results ?? [];

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
        { sourceId: "church/church.json", text: JSON.stringify({ church, campuses, locations }, null, 2) },
        { sourceId: "church/services.json", text: JSON.stringify({ services, servicePlans, servicePlanItems }, null, 2) },
        { sourceId: "church/events.json", text: JSON.stringify({ events, outreaches }, null, 2) },
        { sourceId: "church/groups.json", text: JSON.stringify({ groups, opportunities }, null, 2) },
        { sourceId: "church/resources.json", text: JSON.stringify({ resources }, null, 2) },
        ...contentDocs.map((d: any) => ({
          sourceId: `content/${String(d.entityType)}/${String(d.entityId)}/${String(d.locale)}#${String(d.docId)}`,
          text: String(d.bodyMarkdown ?? ""),
          title: d.title ?? null,
        })),
      ].filter((d) => typeof (d as any).text === "string" && String((d as any).text).trim());

      return jsonText({ docs });
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

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const auth = checkApiKey(request, env);
    if (auth) return auth;
    const server = createServer(env);
    return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
  },
};

