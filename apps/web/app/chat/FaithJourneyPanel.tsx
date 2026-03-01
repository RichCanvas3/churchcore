"use client";

import { useEffect, useState } from "react";

type Identity = {
  tenant_id: string;
  user_id: string;
  role?: string | null;
  campus_id?: string | null;
  timezone?: string | null;
  persona_id?: string | null;
};

type Stage = { id: string; title: string; summary?: string | null };
type JourneyNode = { id: string; type: string; title: string; summary?: string | null; metadata?: any };

type JourneyGetStateResponse = {
  ok?: boolean;
  person_id?: string;
  current_stage?: JourneyNode | null;
  stages?: Stage[];
  completed_node_ids?: string[];
  confidence?: number;
  error?: string;
};

type JourneyNextStepsResponse = {
  ok?: boolean;
  next_steps?: Array<{ node: JourneyNode; edgeType: string; score: number; why: string }>;
  error?: string;
};

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as any)?.error ?? `HTTP ${res.status}`);
  return data;
}

export function FaithJourneyPanel(props: { identity: Identity; onClose: () => void }) {
  const { identity, onClose } = props;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<JourneyGetStateResponse | null>(null);
  const [next, setNext] = useState<JourneyNextStepsResponse | null>(null);
  const [stageId, setStageId] = useState<string>("");

  const stages = Array.isArray(state?.stages) ? state.stages : [];
  const currentStage = state?.current_stage?.id ? String(state.current_stage.id) : "";
  const completedNodeIds = Array.isArray(state?.completed_node_ids) ? state.completed_node_ids : [];
  const completed = new Set<string>(completedNodeIds.map(String));

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const s = await postJson<JourneyGetStateResponse>("/api/a2a/journey/get_state", { identity });
      setState(s);
      setStageId(String((s?.current_stage as any)?.id ?? ""));
      const n = await postJson<JourneyNextStepsResponse>("/api/a2a/journey/next_steps", { identity, limit: 3 });
      setNext(n);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load memory");
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
  }, [identity.tenant_id, identity.user_id]);

  async function saveStage() {
    setSaving(true);
    setError(null);
    try {
      if (!stageId) return;
      await postJson("/api/a2a/journey/complete_step", { identity, node_id: stageId, event_type: "NOTE", value: { setStage: true }, access_level: "self" });
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function markComplete(nodeId: string) {
    setSaving(true);
    setError(null);
    try {
      await postJson("/api/a2a/journey/complete_step", { identity, node_id: nodeId, event_type: "COMPLETED", value: { via: "faith_journey_tool" }, access_level: "self" });
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const btn = {
    border: "1px solid #0f172a",
    background: "#0f172a",
    color: "white",
    borderRadius: 10,
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  };

  return (
    <div style={{ height: "100%", background: "white", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Faith Journey</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => void refresh()} disabled={loading} style={{ ...btn, background: "#64748b" }}>
            Refresh
          </button>
          <button type="button" onClick={onClose} style={{ ...btn, background: "#64748b" }}>
            Close
          </button>
        </div>
      </div>

      <div style={{ padding: 14, overflow: "auto", display: "grid", gap: 14, alignContent: "start", background: "#f8fafc" }}>
        {error ? <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div> : null}
        {loading ? (
          <div style={{ color: "#64748b" }}>Loading…</div>
        ) : (
          <>
            <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>Phase</div>
              <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px 0" }}>
                Your current stage in your faith journey. This helps the church support you well.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {stages.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setStageId(p.id)}
                    style={{
                      ...btn,
                      background: currentStage === p.id ? "#0f172a" : stageId === p.id ? "#334155" : "#f1f5f9",
                      color: currentStage === p.id || stageId === p.id ? "white" : "#0f172a",
                      border: currentStage === p.id ? "2px solid #0f172a" : "1px solid #e2e8f0",
                    }}
                  >
                    {p.title}
                  </button>
                ))}
              </div>
              {stageId && stageId !== currentStage && (
                <button type="button" onClick={() => void saveStage()} disabled={saving} style={{ ...btn, marginTop: 10 }}>
                  {saving ? "Saving…" : "Save phase"}
                </button>
              )}
            </section>

            <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, background: "white" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>Next steps</div>
              <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px 0" }}>Small, concrete steps tied to your current stage.</p>
              {Array.isArray(next?.next_steps) && next!.next_steps!.length ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {next!.next_steps!.map((s, idx) => {
                    const nodeId = String((s as any)?.node?.id ?? "");
                    const title = String((s as any)?.node?.title ?? "");
                    const type = String((s as any)?.node?.type ?? "");
                    const why = String((s as any)?.why ?? "");
                    const done = nodeId ? completed.has(nodeId) : false;
                    return (
                      <div key={idx} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "#f8fafc" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                          <div style={{ fontWeight: 900, color: "#0f172a" }}>{title}</div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>{type}</div>
                        </div>
                        {why ? <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>{why}</div> : null}
                        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                          <button type="button" disabled={saving || done || !nodeId} onClick={() => void markComplete(nodeId)} style={{ ...btn, opacity: saving || done ? 0.7 : 1 }}>
                            {done ? "Completed" : "Mark complete"}
                          </button>
                          {nodeId ? <span style={{ fontSize: 12, color: "#94a3b8" }}>{nodeId}</span> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#64748b" }}>No next steps available yet.</div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
