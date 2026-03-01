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

const FAITH_PHASES = [
  { id: "seeker", label: "Seeker", description: "Exploring faith" },
  { id: "visit_planned", label: "Planning a visit", description: "First visit in mind" },
  { id: "new", label: "New", description: "Just getting started" },
  { id: "new_believer", label: "New Believer", description: "Recent decision" },
  { id: "growing", label: "Growing", description: "Growing in faith" },
  { id: "mature", label: "Mature", description: "Established in faith" },
  { id: "leader", label: "Leader", description: "Leading others" },
] as const;

type MemoryGetResponse = {
  ok?: boolean;
  person_id?: string;
  updated_at?: string;
  memory?: {
    spiritualJourney?: {
      stage?: string;
      milestones?: Array<{ name?: string; date?: string; note?: string } | string>;
    };
  };
  can_edit?: { faith_journey?: boolean };
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
  const [data, setData] = useState<MemoryGetResponse | null>(null);
  const [stage, setStage] = useState<string>("");
  const [newMilestone, setNewMilestone] = useState("");

  const sj = data?.memory?.spiritualJourney;
  const currentStage = (sj?.stage ?? "").trim() || "seeker";
  const milestones = Array.isArray(sj?.milestones) ? sj.milestones : [];
  const canEdit = data?.can_edit?.faith_journey !== false;

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const out = await postJson<MemoryGetResponse>("/api/a2a/memory/get", { identity });
      setData(out);
      setStage((out?.memory?.spiritualJourney as any)?.stage ?? "seeker");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load memory");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setData(null);
    setError(null);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.tenant_id, identity.user_id]);

  async function saveStage() {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      await postJson("/api/a2a/memory/apply_ops", {
        identity,
        ops: [{ op: "set", path: "spiritualJourney.stage", value: stage || "seeker", visibility: "self" }],
      });
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function addMilestone() {
    if (!canEdit || !newMilestone.trim()) return;
    const entry = { name: newMilestone.trim(), date: new Date().toISOString().slice(0, 10) };
    setSaving(true);
    setError(null);
    try {
      await postJson("/api/a2a/memory/apply_ops", {
        identity,
        ops: [{ op: "append", path: "spiritualJourney.milestones", value: entry, visibility: "self" }],
      });
      setNewMilestone("");
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add milestone");
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

      <div style={{ padding: 14, overflow: "auto", display: "grid", gap: 14, alignContent: "start" }}>
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
                {FAITH_PHASES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => canEdit && setStage(p.id)}
                    style={{
                      ...btn,
                      background: currentStage === p.id ? "#0f172a" : stage === p.id ? "#334155" : "#f1f5f9",
                      color: currentStage === p.id || stage === p.id ? "white" : "#0f172a",
                      border: currentStage === p.id ? "2px solid #0f172a" : "1px solid #e2e8f0",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {canEdit && stage !== currentStage && (
                <button type="button" onClick={() => void saveStage()} disabled={saving} style={{ ...btn, marginTop: 10 }}>
                  {saving ? "Saving…" : "Save phase"}
                </button>
              )}
            </section>

            <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>Milestones</div>
              <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px 0" }}>
                Baptism, membership class, first serving, small group, etc.
              </p>
              <ul style={{ margin: "0 0 10px 0", paddingLeft: 20 }}>
                {milestones.map((m, i) => (
                  <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                    {typeof m === "string" ? m : (m as any)?.name ?? (m as any)?.note ?? JSON.stringify(m)}
                    {(m as any)?.date ? ` (${String((m as any).date).slice(0, 10)})` : ""}
                  </li>
                ))}
              </ul>
              {canEdit && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="text"
                    placeholder="e.g. Baptism, Membership class"
                    value={newMilestone}
                    onChange={(e) => setNewMilestone(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addMilestone()}
                    style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0" }}
                  />
                  <button type="button" onClick={() => void addMilestone()} disabled={saving || !newMilestone.trim()} style={btn}>
                    Add
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
