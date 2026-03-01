"use client";

import { useEffect, useMemo, useState } from "react";

type Identity = {
  tenant_id: string;
  user_id: string;
  role: "seeker" | "guide";
  campus_id?: string | null;
  timezone?: string | null;
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
  const servicePlanId = "plan1";
  const areaId = "area_kids_main";

  const [phone, setPhone] = useState("+15550000002");
  const [otp, setOtp] = useState("");
  const [household, setHousehold] = useState<any | null>(null);
  const [kids, setKids] = useState<any[]>([]);
  const [needsOtp, setNeedsOtp] = useState(false);
  const [createMode, setCreateMode] = useState(false);

  const [parentFirst, setParentFirst] = useState("Noah");
  const [parentLast, setParentLast] = useState("Seeker");
  const [childFirst, setChildFirst] = useState("Mia");
  const [childBirthdate, setChildBirthdate] = useState("2021-06-01");
  const [childAllergies, setChildAllergies] = useState("peanuts");

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
    setNeedsOtp(false);
    setCreateMode(false);
    setPlacements([]);
    setSelections({});
    setSecurityCode(null);
    setCheckinId(null);
    setError(null);
  }, [defaultPhone]);

  useEffect(() => {
    postJson("/api/a2a/checkin/start", { identity, service_plan_id: servicePlanId, area_id: areaId })
      .then((out: any) => setRooms(Array.isArray(out?.rooms) ? out.rooms : []))
      .catch(() => {});
  }, [identity]);

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
      setCreateMode(!out?.household);
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

  return (
    <div style={{ height: "100%", background: "white", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
      <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ fontSize: 14, fontWeight: 900 }}>Kids check-in</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Demo OTP: 000000</div>
        </div>
        <button onClick={props.onClose} style={{ border: "1px solid #e2e8f0", background: "white", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}>
          Close
        </button>
      </div>

      <div style={{ padding: 14, overflow: "auto", display: "grid", gap: 14, background: "#f8fafc" }}>
        {error ? <div style={{ color: "#b91c1c", fontSize: 12 }}>{error}</div> : null}

        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, color: "#64748b" }}>Phone</div>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px" }} />
          </div>

          {needsOtp ? (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, color: "#64748b" }}>OTP</div>
              <input value={otp} onChange={(e) => setOtp(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px" }} />
            </div>
          ) : null}

          <button disabled={loading} onClick={() => void identifyHousehold()} style={{ border: "1px solid #0f172a", background: "#0f172a", color: "white", padding: "10px 12px", borderRadius: 12, cursor: "pointer" }}>
            Find family
          </button>

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
            <button disabled={loading} onClick={() => void createHousehold()} style={{ border: "1px solid #0f172a", background: "#0f172a", color: "white", padding: "10px 12px", borderRadius: 12, cursor: "pointer" }}>
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
            <button disabled={loading} onClick={() => void previewEligibility()} style={{ border: "1px solid #0f172a", background: "#0f172a", color: "white", padding: "10px 12px", borderRadius: 12, cursor: "pointer" }}>
              Preview rooms
            </button>
          </div>
        ) : null}

        {placements.length ? (
          <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>Room selection</div>
            {placements.map((p: any) => (
              <div key={String(p.person_id)} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 800 }}>{p.person_name ?? p.person_id}</div>
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
            <button disabled={loading} onClick={() => void commitCheckin()} style={{ border: "1px solid #0f172a", background: "#0f172a", color: "white", padding: "10px 12px", borderRadius: 12, cursor: "pointer" }}>
              Check in
            </button>
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

