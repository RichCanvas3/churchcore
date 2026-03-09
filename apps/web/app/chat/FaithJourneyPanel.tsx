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
  stage_path?: Stage[];
  next_stage_id?: string | null;
  next_stage_requirements?: Array<{ node: JourneyNode; edgeType?: string; weight?: number }>;
  completed_node_ids?: string[];
  confidence?: number;
  error?: string;
};

type JourneyNextStepsResponse = {
  ok?: boolean;
  next_steps?: Array<{ node: JourneyNode; edgeType: string; score: number; why: string }>;
  error?: string;
};

type JourneyPredictFlowsResponse = {
  ok?: boolean;
  person_id?: string;
  horizon_days?: number;
  output?: any;
  error?: string;
};

type MemoryGetResponse = {
  ok?: boolean;
  memory?: any;
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
  const [bdiSaving, setBdiSaving] = useState(false);
  const [belief, setBelief] = useState<string[]>([]);
  const [desire, setDesire] = useState<string[]>([]);
  const [intent, setIntent] = useState<string[]>([]);
  const [predicting, setPredicting] = useState(false);
  const [prediction, setPrediction] = useState<any>(null);

  const stages = Array.isArray(state?.stage_path) ? state.stage_path : Array.isArray(state?.stages) ? state.stages : [];
  const currentStage = state?.current_stage?.id ? String(state.current_stage.id) : "";
  const completedNodeIds = Array.isArray(state?.completed_node_ids) ? state.completed_node_ids : [];
  const completed = new Set<string>(completedNodeIds.map(String));
  const nextStageId = state?.next_stage_id ? String(state.next_stage_id) : "";
  const nextStageTitle = stages.find((s) => String(s.id) === nextStageId)?.title ?? "";
  const nextReqs = Array.isArray(state?.next_stage_requirements) ? state!.next_stage_requirements! : [];

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [s, n, m] = await Promise.all([
        postJson<JourneyGetStateResponse>("/api/a2a/journey/get_state", { identity }),
        postJson<JourneyNextStepsResponse>("/api/a2a/journey/next_steps", { identity, limit: 3 }),
        postJson<MemoryGetResponse>("/api/a2a/memory/get", { identity }),
      ]);
      if ((s as any)?.ok === false) throw new Error(String((s as any)?.error ?? "Failed to load"));
      if ((n as any)?.ok === false) throw new Error(String((n as any)?.error ?? "Failed to load"));
      if ((m as any)?.ok === false) throw new Error(String((m as any)?.error ?? "Failed to load"));

      setState(s);
      setStageId(String((s?.current_stage as any)?.id ?? ""));
      setNext(n);

      const bdi = (m?.memory && typeof m.memory === "object" ? (m.memory as any)?.worldview?.bdi : null) as any;
      const toStrArr = (v: any) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);
      setBelief(toStrArr(bdi?.belief));
      setDesire(toStrArr(bdi?.desire));
      setIntent(toStrArr(bdi?.intent));
      setPrediction(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load memory");
    } finally {
      setLoading(false);
    }
  }

  async function runPrediction() {
    setPredicting(true);
    setError(null);
    try {
      const r = await postJson<JourneyPredictFlowsResponse>("/api/a2a/journey/predict_flows", { identity, horizon_days: 30 });
      if ((r as any)?.ok === false) throw new Error(String((r as any)?.error ?? "Prediction failed"));
      const envelope = (r as any)?.output ?? null;
      const pred = envelope?.data?.journey_prediction ?? null;
      if (!pred || typeof pred !== "object") throw new Error("No predictive flow data returned.");
      setPrediction(pred);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Prediction failed");
    } finally {
      setPredicting(false);
    }
  }

  useEffect(() => {
    setState(null);
    setNext(null);
    setError(null);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.tenant_id, identity.user_id, identity.persona_id, identity.role, identity.campus_id]);

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

  async function saveBdi() {
    setBdiSaving(true);
    setError(null);
    try {
      const ops = [
        { op: "set", path: "worldview.bdi.belief", value: belief, visibility: "self" },
        { op: "set", path: "worldview.bdi.desire", value: desire, visibility: "self" },
        { op: "set", path: "worldview.bdi.intent", value: intent, visibility: "self" },
      ];
      await postJson("/api/a2a/memory/apply_ops", { identity, ops });
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save check-in");
    } finally {
      setBdiSaving(false);
    }
  }

  function toggle(setter: (next: string[]) => void, cur: string[], value: string) {
    const has = cur.includes(value);
    setter(has ? cur.filter((x) => x !== value) : [...cur, value]);
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
            <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, background: "white" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>Predictive flows</div>
              <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px 0" }}>
                This uses your memory + the canonical journey graphs to predict likely next state changes and recommend next actions.
              </p>
              <button type="button" onClick={() => void runPrediction()} disabled={predicting} style={{ ...btn, background: "#0f172a" }}>
                {predicting ? "Predicting…" : "Show predictive flows"}
              </button>
              {prediction?.predictions && Array.isArray(prediction.predictions) ? (
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {prediction.predictions.slice(0, 6).map((p: any, idx: number) => {
                    const graphName = String(p?.graphName ?? p?.graphId ?? `Graph ${idx + 1}`);
                    const currentTitle = String(p?.current?.title ?? p?.current?.nodeId ?? "");
                    const changes = Array.isArray(p?.predictedChanges) ? p.predictedChanges : [];
                    const actions = Array.isArray(p?.recommendedNextActions) ? p.recommendedNextActions : [];
                    return (
                      <div key={idx} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "#f8fafc" }}>
                        <div style={{ fontWeight: 900, color: "#0f172a" }}>{graphName}</div>
                        {currentTitle ? <div style={{ marginTop: 4, fontSize: 12, color: "#475569" }}>Current: {currentTitle}</div> : null}
                        {changes.length ? (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>Predicted changes</div>
                            <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                              {changes.slice(0, 4).map((c: any, j: number) => (
                                <div key={j} style={{ fontSize: 12, color: "#334155" }}>
                                  {String(c?.timeHorizonDays ?? 0)}d: {String(c?.stateLabel ?? "") || String(c?.manifestationLabel ?? "")}
                                  {typeof c?.confidence === "number" ? ` (conf ${c.confidence.toFixed(2)})` : ""}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {actions.length ? (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>Recommended next actions</div>
                            <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                              {actions.slice(0, 4).map((a: any, j: number) => (
                                <div key={j} style={{ fontSize: 12, color: "#334155" }}>
                                  {String(a?.title ?? a?.nodeId ?? "")}
                                  {typeof a?.confidence === "number" ? ` (conf ${a.confidence.toFixed(2)})` : ""}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>

            <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, background: "white" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>Stage path</div>
              <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px 0" }}>
                A simple map of the journey. Your current stage is highlighted; the next stage shows what to aim for.
              </p>

              <div style={{ display: "grid", gap: 8 }}>
                {stages.map((p, idx) => {
                  const id = String(p.id);
                  const isCurrent = currentStage === id;
                  const isSelected = stageId === id;
                  const isBeforeCurrent = currentStage ? stages.findIndex((x) => String(x.id) === currentStage) > idx : false;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setStageId(id)}
                      style={{
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: isCurrent ? "2px solid #0f172a" : isSelected ? "2px solid #334155" : "1px solid #e2e8f0",
                        background: isCurrent ? "#0f172a" : isSelected ? "#f1f5f9" : "white",
                        color: isCurrent ? "white" : "#0f172a",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                        <div style={{ fontWeight: 900 }}>
                          {idx + 1}. {p.title}
                        </div>
                        <div style={{ fontSize: 12, color: isCurrent ? "#e2e8f0" : "#94a3b8" }}>{isCurrent ? "You are here" : isBeforeCurrent ? "Earlier" : ""}</div>
                      </div>
                      {p.summary ? <div style={{ marginTop: 4, fontSize: 12, color: isCurrent ? "#e2e8f0" : "#64748b" }}>{p.summary}</div> : null}
                    </button>
                  );
                })}
              </div>

              {stageId && stageId !== currentStage && (
                <button type="button" onClick={() => void saveStage()} disabled={saving} style={{ ...btn, marginTop: 10 }}>
                  {saving ? "Saving…" : "Set my current stage"}
                </button>
              )}
            </section>

            {nextStageId && nextReqs.length ? (
              <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, background: "white" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>To reach the next stage</div>
                <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px 0" }}>
                  Target: <strong>{nextStageTitle || nextStageId}</strong>
                </p>
                <div style={{ display: "grid", gap: 10 }}>
                  {nextReqs.map((r, idx) => {
                    const nodeId = String((r as any)?.node?.id ?? "");
                    const title = String((r as any)?.node?.title ?? "");
                    const type = String((r as any)?.node?.type ?? "");
                    const done = nodeId ? completed.has(nodeId) : false;
                    return (
                      <div key={idx} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: done ? "#f1f5f9" : "#f8fafc" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                          <div style={{ fontWeight: 900, color: "#0f172a" }}>{title}</div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>{type}</div>
                        </div>
                        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                          <button
                            type="button"
                            disabled={saving || done || !nodeId}
                            onClick={() => void markComplete(nodeId)}
                            style={{ ...btn, opacity: saving || done ? 0.7 : 1 }}
                          >
                            {done ? "Completed" : "Mark complete"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, background: "white" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>Truth · Longing · Next action</div>
              <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px 0" }}>
                A quick check-in so your next steps fit what you actually believe, want, and intend right now.
              </p>

              {(
                [
                  {
                    title: "Belief (Truth)",
                    values: belief,
                    set: setBelief,
                    options: ["I’m not sure what the gospel is", "I want to know if I can be forgiven", "I trust the Bible is God’s word", "I believe Jesus rose from the dead"],
                  },
                  {
                    title: "Desire (Longing)",
                    values: desire,
                    set: setDesire,
                    options: ["Clarity about God / faith", "Community / relationships", "Peace / assurance", "Help with change / habits"],
                  },
                  {
                    title: "Intent (This week)",
                    values: intent,
                    set: setIntent,
                    options: ["Read a short passage this week", "Attend a Sunday gathering", "Join a group", "Talk with a Guide"],
                  },
                ] as const
              ).map((g) => (
                <div key={g.title} style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>{g.title}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {g.options.map((opt) => {
                      const on = g.values.includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => toggle(g.set, g.values, opt)}
                          style={{
                            borderRadius: 999,
                            padding: "7px 10px",
                            border: on ? "2px solid #0f172a" : "1px solid #e2e8f0",
                            background: on ? "#0f172a" : "#f8fafc",
                            color: on ? "white" : "#0f172a",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <button type="button" onClick={() => void saveBdi()} disabled={bdiSaving} style={{ ...btn, marginTop: 12 }}>
                {bdiSaving ? "Saving…" : "Save check-in"}
              </button>
            </section>

            <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, background: "white" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>Next steps</div>
              <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px 0" }}>Small, concrete steps tied to your current stage.</p>
              {Array.isArray(next?.next_steps) && next!.next_steps!.length ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {(
                    [
                      {
                        title: "Truth (Belief)",
                        hint: "Learn and clarify what Christianity teaches.",
                        filter: (t: string) => ["DoctrineTopic", "Resource"].includes(t),
                      },
                      {
                        title: "Practice (Intent)",
                        hint: "Small actions that build spiritual rhythms.",
                        filter: (t: string) => ["Practice", "Milestone"].includes(t),
                      },
                      {
                        title: "Support (Optional)",
                        hint: "Help from people and next steps with the church.",
                        filter: (t: string) => ["ActionStep", "Community"].includes(t),
                      },
                    ] as const
                  ).map((group) => {
                    const items = next!.next_steps!.filter((s) => group.filter(String((s as any)?.node?.type ?? "")));
                    if (!items.length) return null;
                    return (
                      <div key={group.title} style={{ display: "grid", gap: 8 }}>
                        <div style={{ display: "grid", gap: 2 }}>
                          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>{group.title}</div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>{group.hint}</div>
                        </div>
                        <div style={{ display: "grid", gap: 10 }}>
                          {items.map((s, idx) => {
                            const nodeId = String((s as any)?.node?.id ?? "");
                            const title = String((s as any)?.node?.title ?? "");
                            const type = String((s as any)?.node?.type ?? "");
                            const why = String((s as any)?.why ?? "");
                            const done = nodeId ? completed.has(nodeId) : false;
                            return (
                              <div key={`${group.title}-${idx}-${nodeId}`} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, background: "#f8fafc" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                                  <div style={{ fontWeight: 900, color: "#0f172a" }}>{title}</div>
                                  <div style={{ fontSize: 12, color: "#64748b" }}>{type}</div>
                                </div>
                                {why ? <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>{why}</div> : null}
                                <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                                  <button
                                    type="button"
                                    disabled={saving || done || !nodeId}
                                    onClick={() => void markComplete(nodeId)}
                                    style={{ ...btn, opacity: saving || done ? 0.7 : 1 }}
                                  >
                                    {done ? "Completed" : "Mark complete"}
                                  </button>
                                  {nodeId ? <span style={{ fontSize: 12, color: "#94a3b8" }}>{nodeId}</span> : null}
                                </div>
                              </div>
                            );
                          })}
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
