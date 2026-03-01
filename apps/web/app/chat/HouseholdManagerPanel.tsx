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

type HouseholdGetResponse = {
  ok?: boolean;
  households?: Array<{ id: string; name?: string | null }>;
  household?: { id: string; name?: string | null } | null;
  members?: any[];
  children?: any[];
  error?: string;
};

async function postJson<T = any>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json as T;
}

export function HouseholdManagerPanel(props: { identity: Identity; onClose: () => void }) {
  const identity = props.identity;
  const [loading, setLoading] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [data, setData] = useState<HouseholdGetResponse | null>(null);

  const householdId = useMemo(() => (data?.household && typeof (data.household as any).id === "string" ? String((data.household as any).id) : null), [data?.household]);
  const kids = useMemo(() => (Array.isArray(data?.children) ? (data?.children as any[]) : []), [data?.children]);
  const adults = useMemo(() => {
    const members = Array.isArray(data?.members) ? (data?.members as any[]) : [];
    return members.filter((m) => String(m?.household_role ?? "").toLowerCase() === "adult");
  }, [data?.members]);

  const [newChild, setNewChild] = useState({ first_name: "", last_name: "", birthdate: "", allergies: "", special_needs: false });

  async function refresh() {
    setLoading(true);
    setUiError(null);
    try {
      const out = await postJson<HouseholdGetResponse>("/api/a2a/household/get", { identity });
      setData(out);
    } catch (e: any) {
      setUiError(String(e?.message ?? e ?? "Failed to load household"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setData(null);
    setUiError(null);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.tenant_id, identity.user_id]);

  async function saveAdult(adult: any) {
    if (!householdId) return;
    setLoading(true);
    setUiError(null);
    try {
      const out = await postJson("/api/a2a/household/member/upsert", {
        identity,
        household_id: householdId,
        member: {
          person_id: adult.id,
          role: "adult",
          first_name: String(adult.first_name ?? "").trim() || "Adult",
          last_name: adult.last_name ?? null,
          birthdate: adult.birthdate ?? null,
        },
      });
      setData((prev) => (prev ? { ...prev, ...(out as any) } : (out as any)));
      await refresh();
    } catch (e: any) {
      setUiError(String(e?.message ?? e ?? "Save failed"));
    } finally {
      setLoading(false);
    }
  }

  async function saveChild(child: any) {
    if (!householdId) return;
    setLoading(true);
    setUiError(null);
    try {
      const out = await postJson("/api/a2a/household/member/upsert", {
        identity,
        household_id: householdId,
        member: {
          person_id: child.id,
          role: "child",
          first_name: String(child.first_name ?? "").trim() || "Child",
          last_name: child.last_name ?? null,
          birthdate: child.birthdate ?? null,
          allergies: child.allergies ?? null,
          special_needs: Boolean(child.special_needs),
        },
      });
      setData((prev) => (prev ? { ...prev, ...(out as any) } : (out as any)));
      await refresh();
    } catch (e: any) {
      setUiError(String(e?.message ?? e ?? "Save failed"));
    } finally {
      setLoading(false);
    }
  }

  async function removeMember(personId: string) {
    if (!householdId) return;
    setLoading(true);
    setUiError(null);
    try {
      const out = await postJson("/api/a2a/household/member/remove", {
        identity,
        household_id: householdId,
        person_id: personId,
      });
      setData((prev) => (prev ? { ...prev, ...(out as any) } : (out as any)));
      await refresh();
    } catch (e: any) {
      setUiError(String(e?.message ?? e ?? "Remove failed"));
    } finally {
      setLoading(false);
    }
  }

  async function addChild() {
    if (!householdId) return;
    const first = newChild.first_name.trim();
    if (!first) return;
    const derivedLast = String((adults[0] as any)?.last_name ?? "").trim();
    const last = newChild.last_name.trim() || derivedLast;
    if (!last) {
      setUiError("Last name is required for a child.");
      return;
    }
    setLoading(true);
    setUiError(null);
    try {
      const out = await postJson("/api/a2a/household/member/upsert", {
        identity,
        household_id: householdId,
        member: {
          role: "child",
          first_name: first,
          last_name: last,
          birthdate: newChild.birthdate.trim() || null,
          allergies: newChild.allergies.trim() || null,
          special_needs: Boolean(newChild.special_needs),
        },
      });
      setNewChild({ first_name: "", last_name: "", birthdate: "", allergies: "", special_needs: false });
      setData((prev) => (prev ? { ...prev, ...(out as any) } : (out as any)));
      await refresh();
    } catch (e: any) {
      setUiError(String(e?.message ?? e ?? "Add failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ height: "100%", background: "white", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
      <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ fontSize: 14, fontWeight: 900 }}>Household</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{data?.household?.name ?? (loading ? "Loading…" : "No household")}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => void refresh()} style={{ border: "1px solid #e2e8f0", background: "white", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}>
            Refresh
          </button>
          <button onClick={props.onClose} style={{ border: "1px solid #e2e8f0", background: "white", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}>
            Close
          </button>
        </div>
      </div>

      <div style={{ padding: 14, overflow: "auto", display: "grid", gap: 14, alignContent: "start" }}>
        {uiError ? <div style={{ color: "#b91c1c", fontSize: 12 }}>{uiError}</div> : null}

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Adults</div>
          {adults.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {adults.map((a: any) => (
                <div key={String(a.id)} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, display: "grid", gap: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label style={{ display: "grid", gap: 4 }}>
                      <div style={{ fontSize: 12, color: "#64748b" }}>First name</div>
                      <input
                        value={String(a.first_name ?? "")}
                        onChange={(e) =>
                          setData((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  members: (Array.isArray(prev.members) ? prev.members : []).map((m: any) =>
                                    m && m.id === a.id ? { ...m, first_name: e.target.value } : m,
                                  ),
                                }
                              : prev,
                          )
                        }
                        style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      <div style={{ fontSize: 12, color: "#64748b" }}>Last name</div>
                      <input
                        value={String(a.last_name ?? "")}
                        onChange={(e) =>
                          setData((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  members: (Array.isArray(prev.members) ? prev.members : []).map((m: any) =>
                                    m && m.id === a.id ? { ...m, last_name: e.target.value } : m,
                                  ),
                                }
                              : prev,
                          )
                        }
                        style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
                      />
                    </label>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{String(a.id)}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      disabled={loading}
                      onClick={() => void saveAdult(a)}
                      style={{ border: "1px solid #0f172a", background: loading ? "#334155" : "#0f172a", color: "white", borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontSize: 12, fontWeight: 900 }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>None</div>
          )}
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Kids</div>
          {kids.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {kids.map((k: any) => (
                <div key={String(k.id)} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                    <div style={{ fontWeight: 900 }}>{`${k.first_name ?? ""} ${k.last_name ?? ""}`.trim() || k.id}</div>
                    <button
                      disabled={loading}
                      onClick={() => removeMember(String(k.id))}
                      style={{ border: "1px solid #fee2e2", background: "#fff1f2", borderRadius: 10, padding: "6px 8px", cursor: "pointer", fontSize: 12 }}
                    >
                      Remove
                    </button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <label style={{ display: "grid", gap: 4 }}>
                      <div style={{ fontSize: 12, color: "#64748b" }}>First name</div>
                      <input
                        value={String(k.first_name ?? "")}
                        onChange={(e) => setData((prev) => (prev ? { ...prev, children: kids.map((x) => (x.id === k.id ? { ...x, first_name: e.target.value } : x)) } : prev))}
                        style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      <div style={{ fontSize: 12, color: "#64748b" }}>Last name</div>
                      <input
                        value={String(k.last_name ?? "")}
                        onChange={(e) => setData((prev) => (prev ? { ...prev, children: kids.map((x) => (x.id === k.id ? { ...x, last_name: e.target.value } : x)) } : prev))}
                        style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
                      />
                    </label>
                  </div>

                  <label style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontSize: 12, color: "#64748b" }}>Birthdate</div>
                    <input
                      value={String(k.birthdate ?? "")}
                      onChange={(e) => setData((prev) => (prev ? { ...prev, children: kids.map((x) => (x.id === k.id ? { ...x, birthdate: e.target.value } : x)) } : prev))}
                      style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
                      placeholder="YYYY-MM-DD"
                    />
                  </label>

                  <label style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontSize: 12, color: "#64748b" }}>Allergies</div>
                    <input
                      value={String(k.allergies ?? "")}
                      onChange={(e) => setData((prev) => (prev ? { ...prev, children: kids.map((x) => (x.id === k.id ? { ...x, allergies: e.target.value } : x)) } : prev))}
                      style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
                      placeholder="e.g., peanuts"
                    />
                  </label>

                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={Boolean(k.special_needs)}
                      onChange={(e) => setData((prev) => (prev ? { ...prev, children: kids.map((x) => (x.id === k.id ? { ...x, special_needs: e.target.checked } : x)) } : prev))}
                    />
                    <span style={{ fontSize: 12, color: "#0f172a", fontWeight: 800 }}>Special needs</span>
                  </label>

                  <button
                    disabled={loading}
                    onClick={() => void saveChild(k)}
                    style={{ border: "1px solid #0f172a", background: loading ? "#334155" : "#0f172a", color: "white", borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontSize: 12, fontWeight: 900 }}
                  >
                    Save
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>No kids on household.</div>
          )}
        </div>

        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Add child</div>
          <div style={{ display: "grid", gap: 8 }}>
            <input
              value={newChild.first_name}
              onChange={(e) => setNewChild((s) => ({ ...s, first_name: e.target.value }))}
              placeholder="First name"
              style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
            />
            <input
              value={newChild.last_name}
              onChange={(e) => setNewChild((s) => ({ ...s, last_name: e.target.value }))}
              placeholder={adults.length ? `Last name (default: ${String((adults[0] as any)?.last_name ?? "").trim() || "same as parent"})` : "Last name"}
              style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
            />
            <input
              value={newChild.birthdate}
              onChange={(e) => setNewChild((s) => ({ ...s, birthdate: e.target.value }))}
              placeholder="Birthdate (YYYY-MM-DD, optional)"
              style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
            />
            <input
              value={newChild.allergies}
              onChange={(e) => setNewChild((s) => ({ ...s, allergies: e.target.value }))}
              placeholder="Allergies (optional)"
              style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={newChild.special_needs} onChange={(e) => setNewChild((s) => ({ ...s, special_needs: e.target.checked }))} />
              <span style={{ fontSize: 12, color: "#0f172a", fontWeight: 800 }}>Special needs</span>
            </label>
            <button
              disabled={loading || !householdId || !newChild.first_name.trim()}
              onClick={() => void addChild()}
              style={{ border: "1px solid #0f172a", background: "#0f172a", color: "white", borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontSize: 12, fontWeight: 900, opacity: loading ? 0.7 : 1 }}
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

