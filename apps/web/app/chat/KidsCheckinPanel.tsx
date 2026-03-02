"use client";

import { useEffect, useMemo, useState } from "react";

type Identity = {
  tenant_id: string;
  user_id: string;
  role: "seeker" | "guide";
  campus_id?: string | null;
  timezone?: string | null;
  persona_id?: string | null;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error((json as any)?.error ?? (json as any)?.detail ?? `Request failed (${res.status})`);
  return json;
}

export function KidsCheckinPanel(props: { identity: Identity; onClose: () => void }) {
  const identity = props.identity;

  // demo service/area (seed.sql)
  const campusId = identity.campus_id ?? "campus_boulder";
  const defaultsByCampus: Record<string, { servicePlanId: string; areaId: string }> = {
    campus_boulder: { servicePlanId: "plan_boulder_1030", areaId: "area_kids_boulder" },
    campus_erie: { servicePlanId: "plan_erie_0930", areaId: "area_kids_erie" },
    campus_thornton: { servicePlanId: "plan_thornton_1030", areaId: "area_kids_thornton" },
  };
  const { servicePlanId, areaId } = defaultsByCampus[campusId] ?? defaultsByCampus.campus_boulder;

  const [phone, setPhone] = useState("+15550000002");
  const [otp, setOtp] = useState("");
  const [household, setHousehold] = useState<any | null>(null);
  const [kids, setKids] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [needsOtp, setNeedsOtp] = useState(false);
  const [createMode, setCreateMode] = useState(false);

  const [parentFirst, setParentFirst] = useState("Noah");
  const [parentLast, setParentLast] = useState("Seeker");
  const [childFirst, setChildFirst] = useState("Mia");
  const [childBirthdate, setChildBirthdate] = useState("2021-06-01");
  const [childAllergies, setChildAllergies] = useState("peanuts");

  const [addChildFirst, setAddChildFirst] = useState("");
  const [addChildLast, setAddChildLast] = useState("");
  const [addChildBirthdate, setAddChildBirthdate] = useState("");
  const [addChildAllergies, setAddChildAllergies] = useState("");
  const [addChildSpecialNeeds, setAddChildSpecialNeeds] = useState(false);
  const [addChildExpanded, setAddChildExpanded] = useState(false);

  const [placements, setPlacements] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [securityCode, setSecurityCode] = useState<string | null>(null);
  const [checkinId, setCheckinId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const defaultPhone = useMemo(() => (identity.user_id === "demo_user_ava" ? "+15550000001" : "+15550000002"), [identity.user_id]);

  useEffect(() => {
    setPhone(defaultPhone);
    setOtp("");
    setHousehold(null);
    setKids([]);
    setMembers([]);
    setNeedsOtp(false);
    setCreateMode(false);
    setPlacements([]);
    setSelections({});
    setSecurityCode(null);
    setCheckinId(null);
    setError(null);
    setAddChildFirst("");
    setAddChildLast("");
    setAddChildBirthdate("");
    setAddChildAllergies("");
    setAddChildSpecialNeeds(false);
    setAddChildExpanded(false);
  }, [defaultPhone]);

  useEffect(() => {
    postJson("/api/a2a/checkin/start", { identity, service_plan_id: servicePlanId, area_id: areaId })
      .then((out: any) => setRooms(Array.isArray(out?.rooms) ? out.rooms : []))
      .catch(() => {});
  }, [identity, servicePlanId, areaId]);

  async function identifyHousehold() {
    setError(null);
    setLoading(true);
    setSecurityCode(null);
    setCheckinId(null);
    try {
      const out = await postJson<any>("/api/a2a/household/identify", { identity, phone, otp_code: otp || null });
      if (out?.needs_otp) {
        setNeedsOtp(true);
        return;
      }
      setNeedsOtp(false);
      setHousehold(out?.household ?? null);
      setKids(Array.isArray(out?.children) ? out.children : []);
      setMembers(Array.isArray(out?.members) ? out.members : []);
      setCreateMode(!out?.household);
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "error"));
    } finally {
      setLoading(false);
    }
  }

  async function addChildToHousehold() {
    setError(null);
    setLoading(true);
    try {
      const householdId = String(household?.id ?? "");
      if (!householdId) throw new Error("Missing household.");
      const first = addChildFirst.trim();
      if (!first) throw new Error("Child first name is required.");
      const defaultLast = String(members.find((m: any) => String(m?.household_role ?? "").toLowerCase() === "adult")?.last_name ?? "").trim();
      const last = addChildLast.trim() || defaultLast;
      if (!last) throw new Error("Child last name is required.");

      await postJson("/api/a2a/household/member/upsert", {
        identity,
        household_id: householdId,
        member: {
          role: "child",
          first_name: first,
          last_name: last,
          birthdate: addChildBirthdate.trim() || null,
          allergies: addChildAllergies.trim() || null,
          special_needs: Boolean(addChildSpecialNeeds),
        },
      });
      setAddChildFirst("");
      setAddChildLast("");
      setAddChildBirthdate("");
      setAddChildAllergies("");
      setAddChildSpecialNeeds(false);
      setAddChildExpanded(false);

      // Refresh household + kids list so room selection picks it up.
      await identifyHousehold();
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "error"));
    } finally {
      setLoading(false);
    }
  }

  async function createHousehold() {
    setError(null);
    setLoading(true);
    try {
      await postJson<any>("/api/a2a/household/create", {
        identity,
        household_name: "Visitor Household",
        primary_phone: phone,
        primary_email: "noah.seeker@example.com",
        parent_first_name: parentFirst,
        parent_last_name: parentLast,
        children: [{ first_name: childFirst, last_name: parentLast, birthdate: childBirthdate, allergies: childAllergies, special_needs: false }],
      });
      await identifyHousehold();
      setCreateMode(false);
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "error"));
    } finally {
      setLoading(false);
    }
  }

  async function previewEligibility() {
    setError(null);
    setLoading(true);
    try {
      const householdId = String(household?.id ?? "");
      if (!householdId) throw new Error("Missing household. Identify/create first.");
      const out = await postJson<any>("/api/a2a/checkin/preview", { identity, service_plan_id: servicePlanId, area_id: areaId, household_id: householdId });
      setPlacements(Array.isArray(out?.placements) ? out.placements : []);
      setRooms(Array.isArray(out?.rooms) ? out.rooms : []);
      const next: Record<string, string> = {};
      for (const p of Array.isArray(out?.placements) ? out.placements : []) {
        const pid = String(p?.person_id ?? "");
        const firstRoom = Array.isArray(p?.eligible_rooms) && p.eligible_rooms.length ? String(p.eligible_rooms[0].id) : "";
        if (pid && firstRoom) next[pid] = firstRoom;
      }
      setSelections(next);
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "error"));
    } finally {
      setLoading(false);
    }
  }

  async function commitCheckin() {
    setError(null);
    setLoading(true);
    try {
      const householdId = String(household?.id ?? "");
      if (!householdId) throw new Error("Missing household.");
      const selectionList = Object.entries(selections)
        .filter(([, roomId]) => Boolean(roomId))
        .map(([personId, roomId]) => ({ person_id: personId, room_id: roomId }));
      if (!selectionList.length) throw new Error("Select at least one child.");

      const out = await postJson<any>("/api/a2a/checkin/commit", {
        identity,
        service_plan_id: servicePlanId,
        area_id: areaId,
        household_id: householdId,
        selections: selectionList,
      });
      setSecurityCode(String(out?.security_code ?? ""));
      setCheckinId(String(out?.checkin_id ?? ""));
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "error"));
    } finally {
      setLoading(false);
    }
  }

  const primaryBtn: React.CSSProperties = {
    border: "1px solid #0f172a",
    background: "#0f172a",
    color: "white",
    padding: "8px 10px",
    borderRadius: 12,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 900,
  };

  const secondaryBtn: React.CSSProperties = {
    border: "1px solid #e2e8f0",
    background: "white",
    color: "#0f172a",
    padding: "8px 10px",
    borderRadius: 12,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 900,
  };

  function kidLabel(personId: string) {
    const hit = kids.find((k: any) => String(k?.id ?? "") === personId);
    if (hit) {
      const name = `${hit?.first_name ?? ""} ${hit?.last_name ?? ""}`.trim();
      return name || personId;
    }
    return personId;
  }

  return (
    <div style={{ height: "100%", background: "white", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
      <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ fontSize: 14, fontWeight: 900 }}>Kids check-in</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Demo OTP: 000000</div>
        </div>
        <button onClick={props.onClose} style={{ border: "1px solid #e2e8f0", background: "white", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 12, fontWeight: 900 }}>
          Close
        </button>
      </div>

      <div style={{ padding: 14, overflow: "auto", display: "grid", gap: 14, alignContent: "start", background: "#f8fafc" }}>
        {error ? <div style={{ color: "#b91c1c", fontSize: 12 }}>{error}</div> : null}

        <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.35 }}>
          <div style={{ fontWeight: 900, color: "#0f172a" }}>Step 1</div>
          Enter a phone number, click <b>Find family</b>. If it asks for OTP, paste the code and click <b>Find family</b> again.
        </div>

        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, color: "#64748b" }}>Phone</div>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px" }} />
          </div>

          {needsOtp ? (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontSize: 12, color: "#64748b" }}>OTP</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Paste SMS code</div>
              </div>
              <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="000000" style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px" }} />
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button disabled={loading} onClick={() => void identifyHousehold()} style={{ ...primaryBtn, opacity: loading ? 0.7 : 1 }}>
              Find family
            </button>
            {needsOtp ? (
              <div style={{ fontSize: 12, color: "#64748b", alignSelf: "center" }}>After OTP, click “Find family” again.</div>
            ) : null}
          </div>

          {household ? (
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Household: <span style={{ color: "#0f172a", fontWeight: 800 }}>{household?.name ?? household?.id}</span>
            </div>
          ) : null}
        </div>

        {createMode ? (
          <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>Create family profile</div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>Parent name</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <input value={parentFirst} onChange={(e) => setParentFirst(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px" }} />
                <input value={parentLast} onChange={(e) => setParentLast(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px" }} />
              </div>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>Child</div>
              <input value={childFirst} onChange={(e) => setChildFirst(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px" }} />
              <input value={childBirthdate} onChange={(e) => setChildBirthdate(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px" }} />
              <input value={childAllergies} onChange={(e) => setChildAllergies(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px" }} />
            </div>
            <button disabled={loading} onClick={() => void createHousehold()} style={{ ...primaryBtn, opacity: loading ? 0.7 : 1 }}>
              Create family
            </button>
          </div>
        ) : null}

        {kids.length ? (
          <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>Kids</div>
            <div style={{ display: "grid", gap: 8 }}>
              {kids.map((k) => (
                <div key={String((k as any).id)} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10 }}>
                  <div style={{ fontWeight: 800 }}>{`${(k as any).first_name ?? ""} ${(k as any).last_name ?? ""}`.trim()}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{(k as any).allergies ? `Allergies: ${(k as any).allergies}` : "No allergies on file"}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.35 }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Step 2</div>
              Preview eligible rooms, then pick a room for each child.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button disabled={loading} onClick={() => void previewEligibility()} style={{ ...secondaryBtn, opacity: loading ? 0.7 : 1 }}>
                Preview rooms
              </button>
            </div>
          </div>
        ) : null}

        {household ? (
          <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>Add child to household</div>
              <button
                onClick={() => setAddChildExpanded((v) => !v)}
                style={{ border: "1px solid #e2e8f0", background: "white", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 12, fontWeight: 900 }}
                title={addChildExpanded ? "Collapse" : "Expand"}
              >
                {addChildExpanded ? "−" : "+"}
              </button>
            </div>

            {addChildExpanded ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 12, color: "#64748b" }}>First name</div>
                    <input value={addChildFirst} onChange={(e) => setAddChildFirst(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px" }} />
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 12, color: "#64748b" }}>Last name</div>
                    <input
                      value={addChildLast}
                      onChange={(e) => setAddChildLast(e.target.value)}
                      placeholder={
                        String(members.find((m: any) => String(m?.household_role ?? "").toLowerCase() === "adult")?.last_name ?? "").trim()
                          ? "Default from parent"
                          : "Required"
                      }
                      style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px" }}
                    />
                  </div>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Birthdate (optional)</div>
                  <input value={addChildBirthdate} onChange={(e) => setAddChildBirthdate(e.target.value)} placeholder="YYYY-MM-DD" style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px" }} />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Allergies (optional)</div>
                  <input value={addChildAllergies} onChange={(e) => setAddChildAllergies(e.target.value)} placeholder="e.g., peanuts" style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px" }} />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={addChildSpecialNeeds} onChange={(e) => setAddChildSpecialNeeds(e.target.checked)} />
                  <span style={{ fontSize: 12, color: "#0f172a", fontWeight: 900 }}>Special needs</span>
                </label>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button disabled={loading || !addChildFirst.trim()} onClick={() => void addChildToHousehold()} style={{ ...primaryBtn, opacity: loading ? 0.7 : 1 }}>
                    Add child
                  </button>
                  <div style={{ fontSize: 12, color: "#64748b", alignSelf: "center" }}>After adding, click “Preview rooms” again.</div>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: "#64748b" }}>Click + to add a child to this household.</div>
            )}
          </div>
        ) : null}

        {placements.length ? (
          <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>Room selection</div>
            {placements.map((p: any) => (
              <div key={String(p.person_id)} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 900 }}>{kidLabel(String(p.person_id ?? ""))}</div>
                <select
                  value={selections[String(p.person_id)] ?? ""}
                  onChange={(e) => setSelections((s) => ({ ...s, [String(p.person_id)]: e.target.value }))}
                  style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
                >
                  {(Array.isArray(p.eligible_rooms) ? p.eligible_rooms : rooms).map((r: any) => (
                    <option key={String(r.id)} value={String(r.id)}>
                      {String(r.name ?? r.id)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.35 }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Step 3</div>
              Check in to generate your pickup code.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button disabled={loading} onClick={() => void commitCheckin()} style={{ ...primaryBtn, opacity: loading ? 0.7 : 1 }}>
                Check in
              </button>
            </div>
          </div>
        ) : null}

        {securityCode ? (
          <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 900 }}>Checked in</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>checkin_id={checkinId}</div>
            <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: 2 }}>{securityCode}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

