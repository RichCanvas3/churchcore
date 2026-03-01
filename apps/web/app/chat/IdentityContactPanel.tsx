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
  person_id?: string;
  updated_at?: string;
  memory?: any;
  can_edit?: { identity_contact?: boolean };
  error?: string;
};

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as any)?.error ?? `HTTP ${res.status}`);
  return data;
}

function asStr(v: unknown) {
  return typeof v === "string" ? v : "";
}

export function IdentityContactPanel(props: { identity: Identity; onClose: () => void }) {
  const { identity, onClose } = props;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MemoryGetResponse | null>(null);

  const canEdit = data?.can_edit?.identity_contact !== false;

  const memIdentity = (data?.memory && typeof data.memory === "object" ? data.memory.identity : null) as any;
  const memContact = (data?.memory && typeof data.memory === "object" ? data.memory.contact : null) as any;

  const [preferredName, setPreferredName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

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
      const i = (out?.memory && typeof out.memory === "object" ? (out.memory as any).identity : null) as any;
      const c = (out?.memory && typeof out.memory === "object" ? (out.memory as any).contact : null) as any;
      setPreferredName(asStr(i?.preferredName));
      setEmail(asStr(c?.email));
      setPhone(asStr(c?.phone));
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

  async function save() {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const ops = [
        { op: "set", path: "identity.preferredName", value: preferredName.trim() || null, visibility: "self" },
        { op: "set", path: "contact.email", value: email.trim() || null, visibility: "self" },
        { op: "set", path: "contact.phone", value: phone.trim() || null, visibility: "self" },
      ];
      await postJson("/api/a2a/memory/apply_ops", { identity, ops });
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ height: "100%", background: "white", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Identity & Contact</span>
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
              <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Preferred name</div>
              <input
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value)}
                placeholder="e.g. Noah"
                disabled={!canEdit}
                style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #e2e8f0", background: canEdit ? "white" : "#f1f5f9" }}
              />
              <div style={{ fontSize: 12, color: "#64748b" }}>Stored at `identity.preferredName`</div>
            </section>

            <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Contact</div>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#0f172a", fontWeight: 700 }}>Email</span>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  disabled={!canEdit}
                  style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #e2e8f0", background: canEdit ? "white" : "#f1f5f9" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#0f172a", fontWeight: 700 }}>Phone</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+15550000002"
                  disabled={!canEdit}
                  style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #e2e8f0", background: canEdit ? "white" : "#f1f5f9" }}
                />
              </label>
              <div style={{ fontSize: 12, color: "#64748b" }}>Stored at `contact.email` and `contact.phone`</div>
            </section>

            {canEdit ? (
              <button type="button" onClick={() => void save()} disabled={saving} style={{ ...btn, justifySelf: "start" }}>
                {saving ? "Saving…" : "Save"}
              </button>
            ) : (
              <div style={{ fontSize: 12, color: "#64748b" }}>Read-only for your role.</div>
            )}

            <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Current memory (preview)</div>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, color: "#334155" }}>
                {JSON.stringify({ identity: memIdentity ?? {}, contact: memContact ?? {} }, null, 2)}
              </pre>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

