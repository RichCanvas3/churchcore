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
  can_edit?: { household_memory?: boolean };
  error?: string;
};

type HouseholdGetResponse = {
  ok?: boolean;
  household?: { id: string; name?: string | null } | null;
  members?: any[];
  children?: any[];
  error?: string;
};

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

function splitCsv(s: string) {
  return String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

type ExtendedFamilyEntry = { relation: string; first_name: string; last_name: string; notes?: string | null };

export function HouseholdMemoryPanel(props: { identity: Identity; onClose: () => void }) {
  const { identity, onClose } = props;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mem, setMem] = useState<MemoryGetResponse | null>(null);
  const [hh, setHh] = useState<HouseholdGetResponse | null>(null);

  const canEdit = mem?.can_edit?.household_memory !== false;

  const household = (mem?.memory && typeof mem.memory === "object" ? (mem.memory as any).household : null) as any;
  const legacyKidsSafety = (mem?.memory && typeof mem.memory === "object" ? (mem.memory as any).kidsSafety : null) as any;

  const kidsNotes = (household && typeof household === "object" ? household.kids : null) as any;
  const existingPickup = Array.isArray(kidsNotes?.authorizedPickup)
    ? kidsNotes.authorizedPickup
    : Array.isArray(legacyKidsSafety?.authorizedPickup)
      ? legacyKidsSafety.authorizedPickup
      : [];
  const existingCustody = typeof kidsNotes?.custodyNotes === "string" ? kidsNotes.custodyNotes : typeof legacyKidsSafety?.custodyNotes === "string" ? legacyKidsSafety.custodyNotes : "";
  const existingAllergy = typeof kidsNotes?.allergyNotes === "string" ? kidsNotes.allergyNotes : typeof legacyKidsSafety?.allergyNotes === "string" ? legacyKidsSafety.allergyNotes : "";

  const [authorizedPickup, setAuthorizedPickup] = useState("");
  const [custodyNotes, setCustodyNotes] = useState("");
  const [allergyNotes, setAllergyNotes] = useState("");

  const extendedFamily = useMemo(() => {
    const arr = household && typeof household === "object" && Array.isArray(household.extendedFamily) ? household.extendedFamily : [];
    return (arr as any[])
      .map((e) => ({
        relation: String(e?.relation ?? "").trim(),
        first_name: String(e?.first_name ?? "").trim(),
        last_name: String(e?.last_name ?? "").trim(),
        notes: typeof e?.notes === "string" ? e.notes : null,
      }))
      .filter((e) => e.relation && (e.first_name || e.last_name));
  }, [household]);

  const [newRel, setNewRel] = useState("grandparent");
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [newNotes, setNewNotes] = useState("");

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
  const secondaryBtn = useMemo(() => ({ ...btn, background: "#64748b", borderColor: "#64748b" }), [btn]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [m, h] = await Promise.all([
        postJson<MemoryGetResponse>("/api/a2a/memory/get", { identity }),
        postJson<HouseholdGetResponse>("/api/a2a/household/get", { identity }),
      ]);
      if ((m as any)?.ok === false) throw new Error(String((m as any)?.error ?? "Failed to load memory"));
      if ((h as any)?.ok === false) throw new Error(String((h as any)?.error ?? "Failed to load household"));

      setMem(m);
      setHh(h);

      const mHousehold = (m?.memory && typeof m.memory === "object" ? (m.memory as any).household : null) as any;
      const mKids = mHousehold && typeof mHousehold === "object" ? mHousehold.kids : null;
      const mLegacy = (m?.memory && typeof m.memory === "object" ? (m.memory as any).kidsSafety : null) as any;

      const ap = Array.isArray(mKids?.authorizedPickup) ? mKids.authorizedPickup : Array.isArray(mLegacy?.authorizedPickup) ? mLegacy.authorizedPickup : [];
      setAuthorizedPickup(ap.map(String).join(", "));
      setCustodyNotes(typeof mKids?.custodyNotes === "string" ? mKids.custodyNotes : typeof mLegacy?.custodyNotes === "string" ? mLegacy.custodyNotes : "");
      setAllergyNotes(typeof mKids?.allergyNotes === "string" ? mKids.allergyNotes : typeof mLegacy?.allergyNotes === "string" ? mLegacy.allergyNotes : "");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load household memory");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setMem(null);
    setHh(null);
    setError(null);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.tenant_id, identity.user_id]);

  async function saveKidsNotes() {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const ops = [
        { op: "set", path: "household.kids.authorizedPickup", value: splitCsv(authorizedPickup), visibility: "self" },
        { op: "set", path: "household.kids.custodyNotes", value: custodyNotes.trim() || null, visibility: "self" },
        { op: "set", path: "household.kids.allergyNotes", value: allergyNotes.trim() || null, visibility: "self" },
      ];
      await postJson("/api/a2a/memory/apply_ops", { identity, ops });
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function addExtended() {
    if (!canEdit) return;
    const first = newFirst.trim();
    const last = newLast.trim();
    if (!first && !last) return;
    const entry: ExtendedFamilyEntry = { relation: newRel, first_name: first || "Unknown", last_name: last || "", notes: newNotes.trim() || null };
    setSaving(true);
    setError(null);
    try {
      await postJson("/api/a2a/memory/apply_ops", { identity, ops: [{ op: "append", path: "household.extendedFamily", value: entry, visibility: "self" }] });
      setNewFirst("");
      setNewLast("");
      setNewNotes("");
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  }

  async function removeExtended(idx: number) {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const next = extendedFamily.filter((_, i) => i !== idx);
      await postJson("/api/a2a/memory/apply_ops", { identity, ops: [{ op: "set", path: "household.extendedFamily", value: next, visibility: "self" }] });
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setSaving(false);
    }
  }

  const members = Array.isArray(hh?.members) ? (hh!.members as any[]) : [];
  const children = Array.isArray(hh?.children) ? (hh!.children as any[]) : [];
  const adults = members.filter((m) => String(m?.household_role ?? "").toLowerCase() === "adult");

  return (
    <div style={{ height: "100%", background: "white", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Household</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" onClick={() => void refresh()} disabled={loading} style={secondaryBtn}>
            Refresh
          </button>
          <button type="button" onClick={onClose} style={secondaryBtn}>
            Close
          </button>
        </div>
      </div>

      <div style={{ padding: 14, overflow: "auto", minHeight: 0, display: "grid", gap: 14, alignContent: "start", background: "#f8fafc" }}>
        {error ? <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div> : null}
        {loading ? <div style={{ color: "#64748b" }}>Loading…</div> : null}

        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Nuclear household</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{hh?.household?.name ?? "Household"}</div>
          {adults.length ? (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>Adults</div>
              {adults.map((a) => (
                <div key={String(a.id)} style={{ fontSize: 12, color: "#334155" }}>
                  {String(a.first_name ?? "")} {String(a.last_name ?? "")} <span style={{ color: "#94a3b8" }}>({String(a.id)})</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>No adults found yet.</div>
          )}
          {children.length ? (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>Kids</div>
              {children.map((c) => (
                <div key={String(c.id)} style={{ fontSize: 12, color: "#334155" }}>
                  {String(c.first_name ?? "")} {String(c.last_name ?? "")}
                  {c.birthdate ? <span style={{ color: "#94a3b8" }}> · {String(c.birthdate)}</span> : null}
                  {c.allergies ? <span style={{ color: "#94a3b8" }}> · Allergies: {String(c.allergies)}</span> : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>No children found yet.</div>
          )}
        </section>

        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Kids info (household memory)</div>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Authorized pickup (comma-separated)</span>
            <input
              value={authorizedPickup}
              onChange={(e) => setAuthorizedPickup(e.target.value)}
              placeholder="e.g. Grandma Sue, Uncle Mike"
              disabled={!canEdit}
              style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #e2e8f0", background: canEdit ? "white" : "#f1f5f9" }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Custody notes</span>
            <textarea
              value={custodyNotes}
              onChange={(e) => setCustodyNotes(e.target.value)}
              disabled={!canEdit}
              rows={3}
              style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #e2e8f0", background: canEdit ? "white" : "#f1f5f9", resize: "vertical" }}
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Allergy notes (household-level)</span>
            <textarea
              value={allergyNotes}
              onChange={(e) => setAllergyNotes(e.target.value)}
              disabled={!canEdit}
              rows={2}
              style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #e2e8f0", background: canEdit ? "white" : "#f1f5f9", resize: "vertical" }}
            />
          </label>
          <button type="button" onClick={() => void saveKidsNotes()} disabled={saving || !canEdit} style={{ ...btn, justifySelf: "start", opacity: saving ? 0.8 : 1 }}>
            {saving ? "Saving…" : "Save kids notes"}
          </button>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Stored under <code>household.kids.*</code>. (If older <code>kidsSafety.*</code> exists, we read it but new saves go to household memory.)
          </div>
        </section>

        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Extended family (as defined)</div>
          {extendedFamily.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {extendedFamily.map((e, idx) => (
                <div key={idx} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, background: "#f8fafc", display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                    <div style={{ fontWeight: 900, color: "#0f172a" }}>
                      {e.first_name} {e.last_name}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{e.relation}</div>
                  </div>
                  {e.notes ? <div style={{ fontSize: 12, color: "#64748b" }}>{e.notes}</div> : null}
                  {canEdit ? (
                    <button type="button" onClick={() => void removeExtended(idx)} disabled={saving} style={{ ...secondaryBtn, justifySelf: "start" }}>
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>No extended family defined yet.</div>
          )}

          <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 6, paddingTop: 10, display: "grid", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>Add extended family</div>
            <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr", gap: 8 }}>
              <select value={newRel} onChange={(e) => setNewRel(e.target.value)} disabled={!canEdit} style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px", background: canEdit ? "white" : "#f1f5f9" }}>
                <option value="grandparent">Grandparent</option>
                <option value="aunt">Aunt</option>
                <option value="uncle">Uncle</option>
                <option value="aunt_uncle">Aunt/Uncle</option>
                <option value="cousin">Cousin</option>
                <option value="other">Other</option>
              </select>
              <input value={newFirst} onChange={(e) => setNewFirst(e.target.value)} disabled={!canEdit} placeholder="First name" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px", background: canEdit ? "white" : "#f1f5f9" }} />
              <input value={newLast} onChange={(e) => setNewLast(e.target.value)} disabled={!canEdit} placeholder="Last name" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px", background: canEdit ? "white" : "#f1f5f9" }} />
            </div>
            <textarea value={newNotes} onChange={(e) => setNewNotes(e.target.value)} disabled={!canEdit} rows={2} placeholder="Notes (optional)" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px", background: canEdit ? "white" : "#f1f5f9", resize: "vertical" }} />
            <button type="button" onClick={() => void addExtended()} disabled={saving || !canEdit} style={{ ...btn, justifySelf: "start", opacity: saving ? 0.8 : 1 }}>
              Add
            </button>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Stored under <code>household.extendedFamily</code>.
            </div>
          </div>
        </section>

        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Current memory (preview)</div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, color: "#334155" }}>
            {JSON.stringify({ household: household ?? {}, kidsSafety: legacyKidsSafety ?? {} }, null, 2)}
          </pre>
        </section>
      </div>
    </div>
  );
}

