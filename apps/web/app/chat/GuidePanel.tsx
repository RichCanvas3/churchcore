"use client";

import { useEffect, useMemo, useState } from "react";

type Identity = {
  tenant_id: string;
  user_id: string;
  role?: string | null;
  campus_id?: string | null;
  timezone?: string | null;
  persona_id?: string | null;
};

type JourneyNode = { id: string; type: string; title: string; summary?: string | null; metadata?: any };

type JourneyGetStateResponse = {
  ok?: boolean;
  person_id?: string;
  current_stage?: JourneyNode | null;
  confidence?: number;
  current_stage_docs?: Array<{ docId: string; title?: string | null; entityType?: string; entityId?: string; bodyMarkdown: string }>;
  current_stage_entities?: any[];
  error?: string;
};

type JourneyNextStepsResponse = {
  ok?: boolean;
  next_steps?: Array<{
    node: JourneyNode;
    edgeType: string;
    score: number;
    why: string;
    linked?: {
      docs?: Array<{ docId: string; title?: string | null; entityType?: string; entityId?: string; bodyMarkdown: string }>;
      entities?: any[];
      legacyEntity?: any;
    };
  }>;
  error?: string;
};

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as any)?.error ?? `HTTP ${res.status}`);
  return data;
}

function snippet(md: string, max = 240) {
  const t = String(md || "")
    .replace(/\r/g, "")
    .replace(/^> /gm, "")
    .replace(/[#*_`]/g, "")
    .replace(/\\n+/g, " ")
    .replace(/\n+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max).trim() + "…" : t;
}

function LinkifiedText(props: { text: string }) {
  const text = String(props.text || "");
  if (!text) return null;

  const re = /https?:\/\/[^\s)]+/g;
  const parts: Array<{ kind: "text"; value: string } | { kind: "url"; url: string }> = [];
  let last = 0;
  for (;;) {
    const m = re.exec(text);
    if (!m) break;
    const idx = m.index;
    if (idx > last) parts.push({ kind: "text", value: text.slice(last, idx) });
    parts.push({ kind: "url", url: String(m[0]) });
    last = idx + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });

  if (parts.length <= 1) return <span>{text}</span>;

  return (
    <span>
      {parts.map((p, i) => {
        if (p.kind === "text") return <span key={i}>{p.value}</span>;
        return (
          <a key={i} href={p.url} target="_blank" rel="noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>
            {p.url}
          </a>
        );
      })}
    </span>
  );
}

export function GuidePanel(props: { identity: Identity; onClose: () => void; onOpenTool?: (toolId: string, args?: Record<string, unknown> | null) => void }) {
  const { identity, onClose, onOpenTool } = props;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<JourneyGetStateResponse | null>(null);
  const [next, setNext] = useState<JourneyNextStepsResponse | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<any | null>(null);

  const btn = useMemo(
    () => ({
      border: "1px solid #0f172a",
      background: "#0f172a",
      color: "white",
      borderRadius: 10,
      padding: "8px 12px",
      cursor: "pointer",
      fontSize: 13,
      fontWeight: 700,
    }),
    [],
  );
  const secondaryBtn = useMemo(() => ({ ...btn, background: "#64748b", fontWeight: 600 }), [btn]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const s = await postJson<JourneyGetStateResponse>("/api/a2a/journey/get_state", { identity });
      if ((s as any)?.ok === false) throw new Error(String((s as any)?.error ?? "Failed to load"));
      setState(s);
      const n = await postJson<JourneyNextStepsResponse>("/api/a2a/journey/next_steps", { identity, limit: 5 });
      if ((n as any)?.ok === false) throw new Error(String((n as any)?.error ?? "Failed to load"));
      setNext(n);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setState(null);
    setNext(null);
    setError(null);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.tenant_id, identity.user_id, identity.persona_id, identity.role, identity.campus_id]);

  async function markStep(nodeId: string, eventType: "COMPLETED" | "STARTED" = "COMPLETED") {
    setSaving(true);
    setError(null);
    try {
      await postJson("/api/a2a/journey/complete_step", { identity, node_id: nodeId, event_type: eventType, value: { via: "guide_panel" }, access_level: "self" });
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function refreshPlan() {
    setPlanLoading(true);
    setPlanErr(null);
    try {
      const out = await postJson<any>("/api/a2a/bible/plan/week/get", { identity });
      if (!out?.ok) throw new Error(String(out?.error ?? "Failed to load plan"));
      setPlan(out);
    } catch (e: any) {
      setPlanErr(String(e?.message ?? e ?? "Failed to load plan"));
      setPlan(null);
    } finally {
      setPlanLoading(false);
    }
  }

  useEffect(() => {
    void refreshPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.tenant_id, identity.user_id, identity.persona_id, identity.role, identity.campus_id]);

  const current = state?.current_stage ?? null;
  const stageDocs = Array.isArray(state?.current_stage_docs) ? state!.current_stage_docs! : [];
  const stageEntities = Array.isArray((state as any)?.current_stage_entities) ? ((state as any).current_stage_entities as any[]) : [];
  const nextSteps = Array.isArray(next?.next_steps) ? next!.next_steps! : [];

  const actionSteps = nextSteps.filter((s) => String(s?.node?.type ?? "") === "ActionStep");
  const communitySteps = nextSteps.filter((s) => String(s?.node?.type ?? "") === "Community");
  const resourceSteps = nextSteps.filter((s) => ["Resource", "DoctrineTopic", "Practice", "Milestone"].includes(String(s?.node?.type ?? "")));

  function ToolCtaButton(props: { toolId: string; label?: string }) {
    if (!onOpenTool) return null;
    return (
      <button type="button" onClick={() => onOpenTool(props.toolId, null)} style={{ ...btn, background: "#334155" }}>
        {props.label ?? `Open ${props.toolId}`}
      </button>
    );
  }

  function StepCard(props: { step: (typeof nextSteps)[number] }) {
    const s = props.step;
    const nodeId = String(s?.node?.id ?? "");
    const title = String(s?.node?.title ?? "");
    const kind = String(s?.node?.type ?? "");
    const docs = Array.isArray(s?.linked?.docs) ? (s!.linked!.docs! as any[]) : [];
    const entities = Array.isArray(s?.linked?.entities) ? (s!.linked!.entities! as any[]) : [];
    const legacyEntity = (s as any)?.linked?.legacyEntity ?? null;
    const toolFromMeta = typeof (s as any)?.node?.metadata?.tool === "string" ? String((s as any).node.metadata.tool) : "";

    const supportedToolIds = new Set([
      "guide",
      "faith_journey",
      "community_manager",
      "memory_manager",
      "identity_contact",
      "comm_prefs",
      "care_pastoral",
      "teams_skills",
      "kids_checkin",
      "household_manager",
    ]);
    const toolId = supportedToolIds.has(toolFromMeta) ? toolFromMeta : "";
    const markLabel = nodeId === "step_start_bible_plan" ? "Mark as started" : nodeId === "step_join_group" ? "Mark as started" : "Mark complete";
    const markType: "COMPLETED" | "STARTED" = nodeId === "step_start_bible_plan" || nodeId === "step_join_group" ? "STARTED" : "COMPLETED";

    return (
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "#f8fafc" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
          <div style={{ fontWeight: 900, color: "#0f172a" }}>{title}</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{kind}</div>
        </div>
        {s.why ? <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>{s.why}</div> : null}

        {entities.length ? (
          <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
            {entities.map((e, idx) => (
              <div key={idx} style={{ fontSize: 12, color: "#334155" }}>
                <strong>{String(e?.type ?? "entity")}:</strong>{" "}
                {e?.type === "group" ? String(e.group?.title ?? "") : e?.type === "resource" ? String(e.resource?.title ?? "") : String(e?.type ?? "")}
              </div>
            ))}
          </div>
        ) : legacyEntity?.type ? (
          <div style={{ marginTop: 10, fontSize: 12, color: "#334155" }}>
            <strong>{String(legacyEntity.type)}:</strong>{" "}
            {legacyEntity.type === "group"
              ? String(legacyEntity.group?.title ?? "")
              : legacyEntity.type === "resource"
                ? String(legacyEntity.resource?.title ?? "")
                : String(legacyEntity.type)}
          </div>
        ) : null}

        {docs.length ? (
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {docs.map((d) => (
              <div key={d.docId} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, background: "white" }}>
                <div style={{ fontWeight: 900, color: "#0f172a", fontSize: 12 }}>
                  {d.entityType === "scripture_ref" ? "Scripture: " : ""}
                  {d.title ?? d.docId}
                </div>
                {d.bodyMarkdown ? (
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                    <LinkifiedText text={snippet(d.bodyMarkdown)} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={saving || !nodeId}
            onClick={() => void markStep(nodeId, markType)}
            style={{ ...btn, opacity: saving ? 0.7 : 1 }}
            title={
              nodeId === "step_start_bible_plan"
                ? "Use this once you've begun the plan for this week."
                : nodeId === "step_join_group"
                  ? "Use this once you've taken your first step toward joining a group."
                  : undefined
            }
          >
            {markLabel}
          </button>
          {toolId ? <ToolCtaButton toolId={toolId} label={`Open ${toolId.replace(/_/g, " ")}`} /> : null}
          <span style={{ fontSize: 12, color: "#94a3b8" }}>{nodeId}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", background: "white", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Guide</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => void refresh()} disabled={loading} style={secondaryBtn}>
            Refresh
          </button>
          <button type="button" onClick={() => void refreshPlan()} disabled={planLoading} style={secondaryBtn}>
            {planLoading ? "Plan…" : "Plan"}
          </button>
          <button type="button" onClick={onClose} style={secondaryBtn}>
            Close
          </button>
        </div>
      </div>

      <div style={{ padding: 14, overflow: "auto", minHeight: 0, display: "grid", gap: 14, alignContent: "start", background: "#f8fafc" }}>
        {error ? <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div> : null}
        {planErr ? <div style={{ color: "#dc2626", fontSize: 13 }}>{planErr}</div> : null}
        {loading ? <div style={{ color: "#64748b" }}>Loading…</div> : null}

        {plan ? (
          plan?.week ? (
            <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>This week’s Bible Reading Plan</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {String(plan.week.weekStartDate ?? "")} → {String(plan.week.weekEndDate ?? "")}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                {plan.week.title ? <strong>{String(plan.week.title)}</strong> : null}
                {plan.week.passage ? ` · ${String(plan.week.passage)}` : ""}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {(Array.isArray(plan.items) ? plan.items : [])
                  .filter((it: any) => String(it?.dayDate ?? "") === new Date().toISOString().slice(0, 10))
                  .slice(0, 2)
                  .map((it: any) => (
                    <button
                      key={String(it?.id)}
                      type="button"
                      onClick={() => (onOpenTool ? onOpenTool("bible_reader", { ref: String(it?.ref ?? plan.week.passage ?? "") }) : undefined)}
                      style={{ textAlign: "left", border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: 12, padding: 10, cursor: onOpenTool ? "pointer" : "default" }}
                      title={onOpenTool ? "Open in Bible reader" : undefined}
                    >
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>{String(it?.label ?? "Today")}</div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>{String(it?.ref ?? "")}</div>
                    </button>
                  ))}
                {!Array.isArray(plan.items) || !plan.items.some((it: any) => String(it?.dayDate ?? "") === new Date().toISOString().slice(0, 10)) ? (
                  <div style={{ fontSize: 12, color: "#64748b" }}>No plan items scheduled for today.</div>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => (onOpenTool ? onOpenTool("bible_reader", { ref: String(plan.week.passage ?? "") }) : undefined)} style={{ ...btn, background: "#334155" }}>
                  Open Bible tool
                </button>
              </div>
            </section>
          ) : (
            <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>This week’s Bible Reading Plan</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>No plan available yet.</div>
            </section>
          )
        ) : null}

        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Where you are</div>
          <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>{current?.title ?? "Unknown stage"}</div>
          {current?.summary ? <div style={{ fontSize: 12, color: "#64748b" }}>{current.summary}</div> : null}
          {typeof state?.confidence === "number" ? <div style={{ fontSize: 12, color: "#94a3b8" }}>Confidence: {Math.round(state.confidence * 100)}%</div> : null}
        </section>

        {stageDocs.length || stageEntities.length ? (
          <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Bible & resources for this stage</div>
            {stageDocs.map((d) => (
              <div key={d.docId} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, background: "#f8fafc" }}>
                <div style={{ fontWeight: 900, color: "#0f172a", fontSize: 13 }}>
                  {d.entityType === "scripture_ref" ? "Scripture: " : ""}
                  {d.title ?? d.docId}
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                  <LinkifiedText text={snippet(d.bodyMarkdown)} />
                </div>
              </div>
            ))}
            {stageEntities.length ? (
              <div style={{ display: "grid", gap: 6 }}>
                {stageEntities.map((e, idx) => (
                  <div key={idx} style={{ fontSize: 12, color: "#334155" }}>
                    <strong>{String(e?.type ?? "entity")}:</strong>{" "}
                    {e?.type === "group" ? String(e.group?.title ?? "") : e?.type === "resource" ? String(e.resource?.title ?? "") : String(e?.type ?? "")}
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Next steps</div>
          {nextSteps.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {actionSteps.length ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Action</div>
                  {actionSteps.map((s, i) => (
                    <StepCard key={`a:${i}`} step={s} />
                  ))}
                </div>
              ) : null}
              {communitySteps.length ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Community</div>
                  {communitySteps.map((s, i) => (
                    <StepCard key={`c:${i}`} step={s} />
                  ))}
                </div>
              ) : null}
              {resourceSteps.length ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Learn / Practice</div>
                  {resourceSteps.map((s, i) => (
                    <StepCard key={`r:${i}`} step={s} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>No next steps available yet.</div>
          )}
        </section>
      </div>
    </div>
  );
}

