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

type MemoryGetResponse = {
  ok?: boolean;
  memory?: any;
  can_edit?: { care_pastoral?: boolean };
  error?: string;
};

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as any)?.error ?? `HTTP ${res.status}`);
  return data;
}

export function CarePastoralPanel(props: { identity: Identity; onClose: () => void }) {
  const { identity, onClose } = props;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MemoryGetResponse | null>(null);

  const canEdit = data?.can_edit?.care_pastoral !== false;
  const care = (data?.memory && typeof data.memory === "object" ? (data.memory as any).pastoralCare : null) as any;
  const prayerRequests = Array.isArray(care?.prayerRequests) ? care.prayerRequests : [];

  const [newPrayer, setNewPrayer] = useState("");

  const btn = useMemo(
    () => ({
      border: "1px solid #0f172a",
      background: "#0f172a",
      color: "white",
      borderRadius: 10,
      padding: "8px 12px",
      cursor: "pointer",
      fontSize: 13,
      fontWeight: 600,
    }),
    [],
  );

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const out = await postJson<MemoryGetResponse>("/api/a2a/memory/get", { identity });
      setData(out);
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

  async function addPrayerRequest() {
    if (!canEdit || !newPrayer.trim()) return;
    const entry = { topic: newPrayer.trim(), date: new Date().toISOString().slice(0, 10) };
    setSaving(true);
    setError(null);
    try {
      await postJson("/api/a2a/memory/apply_ops", {
        identity,
        ops: [{ op: "append", path: "pastoralCare.prayerRequests", value: entry, visibility: "self" }],
      });
      setNewPrayer("");
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ height: "100%", background: "white", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Care & Prayer</span>
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
            <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Prayer requests</div>
              {prayerRequests.length ? (
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {prayerRequests.map((r: any, i: number) => (
                    <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                      {typeof r === "string" ? r : String(r?.topic ?? r?.text ?? r?.note ?? JSON.stringify(r))}
                      {r?.date ? ` (${String(r.date).slice(0, 10)})` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <div style={{ fontSize: 12, color: "#64748b" }}>No prayer requests saved yet.</div>
              )}

              {canEdit ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="text"
                    placeholder="Add a prayer request…"
                    value={newPrayer}
                    onChange={(e) => setNewPrayer(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addPrayerRequest()}
                    disabled={saving}
                    style={{ flex: 1, padding: "8px 10px", borderRadius: 10, border: "1px solid #e2e8f0" }}
                  />
                  <button type="button" onClick={() => void addPrayerRequest()} disabled={saving || !newPrayer.trim()} style={btn}>
                    Add
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#64748b" }}>Read-only for your role.</div>
              )}

              <div style={{ fontSize: 12, color: "#64748b" }}>Stored at `pastoralCare.prayerRequests`</div>
            </section>

            <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Current memory (preview)</div>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, color: "#334155" }}>{JSON.stringify({ pastoralCare: care ?? {} }, null, 2)}</pre>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

