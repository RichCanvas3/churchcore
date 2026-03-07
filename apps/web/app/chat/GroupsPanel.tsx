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

type Group = {
  id: string;
  campusId?: string | null;
  name: string;
  description?: string | null;
  leaderPersonId?: string | null;
  meetingDetails?: string | null;
  isOpen?: number | boolean | null;
  myRole?: string | null;
  myStatus?: string | null;
};

type GroupMember = {
  personId: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  role: string;
  status: string;
};

type GroupEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt?: string | null;
  location?: string | null;
  description?: string | null;
  createdByPersonId?: string | null;
};

type BibleStudy = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
};

type BibleStudySession = {
  id: string;
  sessionAt: string;
  title?: string | null;
  agenda?: string | null;
};

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as any)?.error ?? `HTTP ${res.status}`);
  return data;
}

function isoDate(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0)).toISOString();
}

export function GroupsPanel(props: { identity: Identity; onClose: () => void }) {
  const { identity, onClose } = props;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string>("");

  const [members, setMembers] = useState<GroupMember[]>([]);
  const [membersErr, setMembersErr] = useState<string | null>(null);

  const [events, setEvents] = useState<GroupEvent[]>([]);
  const [eventsErr, setEventsErr] = useState<string | null>(null);

  const [studies, setStudies] = useState<BibleStudy[]>([]);
  const [studiesErr, setStudiesErr] = useState<string | null>(null);

  const [sessions, setSessions] = useState<BibleStudySession[]>([]);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);
  const [activeStudyId, setActiveStudyId] = useState<string>("");

  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventStart, setNewEventStart] = useState<string>(() => new Date().toISOString().slice(0, 16));
  const [newEventLocation, setNewEventLocation] = useState("");

  const [newStudyTitle, setNewStudyTitle] = useState("");
  const [readingRef, setReadingRef] = useState("");
  const [noteMd, setNoteMd] = useState("");

  const activeGroup = useMemo(() => groups.find((g) => g.id === activeGroupId) ?? null, [groups, activeGroupId]);
  const canManageMembers = useMemo(() => {
    const r = String(activeGroup?.myRole ?? "").toLowerCase();
    return r === "leader" || r === "host" || String(identity.role ?? "").toLowerCase() === "guide";
  }, [activeGroup?.myRole, identity.role]);

  const btn: React.CSSProperties = {
    border: "1px solid #0f172a",
    background: "#0f172a",
    color: "white",
    borderRadius: 10,
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
  };
  const smallBtn: React.CSSProperties = { ...btn, background: "#64748b", fontWeight: 600, padding: "6px 10px", fontSize: 12 };

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const out = await postJson<{ ok?: boolean; groups?: Group[] }>("/api/a2a/group/my/list", { identity, include_inactive: false, limit: 200, offset: 0 });
      const list = Array.isArray(out?.groups) ? out.groups : [];
      setGroups(list);
      setActiveGroupId((prev) => (prev && list.some((g) => g.id === prev) ? prev : list[0]?.id ?? ""));
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "Failed to load groups"));
      setGroups([]);
      setActiveGroupId("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.tenant_id, identity.user_id, identity.persona_id, identity.role, identity.campus_id]);

  useEffect(() => {
    setMembers([]);
    setEvents([]);
    setStudies([]);
    setSessions([]);
    setMembersErr(null);
    setEventsErr(null);
    setStudiesErr(null);
    setSessionsErr(null);
    setActiveStudyId("");
    if (!activeGroupId) return;

    void postJson<{ members?: GroupMember[] }>("/api/a2a/group/members/list", { identity, group_id: activeGroupId, include_inactive: false })
      .then((out) => setMembers(Array.isArray(out?.members) ? out.members : []))
      .catch((e) => setMembersErr(String((e as any)?.message ?? e ?? "Failed to load members")));

    const fromIso = isoDate(new Date(Date.now() - 7 * 24 * 3600 * 1000));
    const toIso = isoDate(new Date(Date.now() + 60 * 24 * 3600 * 1000));
    void postJson<{ events?: GroupEvent[] }>("/api/a2a/group/events/list", { identity, group_id: activeGroupId, from_iso: fromIso, to_iso: toIso })
      .then((out) => setEvents(Array.isArray(out?.events) ? out.events : []))
      .catch((e) => setEventsErr(String((e as any)?.message ?? e ?? "Failed to load schedule")));

    void postJson<{ studies?: BibleStudy[] }>("/api/a2a/group/bible_study/list", { identity, group_id: activeGroupId, include_archived: false })
      .then((out) => {
        const s = Array.isArray(out?.studies) ? out.studies : [];
        setStudies(s);
        setActiveStudyId((prev) => (prev && s.some((x) => x.id === prev) ? prev : s[0]?.id ?? ""));
      })
      .catch((e) => setStudiesErr(String((e as any)?.message ?? e ?? "Failed to load Bible studies")));
  }, [activeGroupId, identity]);

  useEffect(() => {
    setSessions([]);
    setSessionsErr(null);
    if (!activeStudyId) return;
    void postJson<{ sessions?: BibleStudySession[] }>("/api/a2a/group/bible_study/sessions/list", { identity, bible_study_id: activeStudyId })
      .then((out) => setSessions(Array.isArray(out?.sessions) ? out.sessions : []))
      .catch((e) => setSessionsErr(String((e as any)?.message ?? e ?? "Failed to load sessions")));
  }, [activeStudyId, identity]);

  async function createEvent() {
    if (!activeGroupId) return;
    const title = newEventTitle.trim();
    if (!title) return;
    setEventsErr(null);
    try {
      const startAt = new Date(newEventStart).toISOString();
      await postJson("/api/a2a/group/event/create", { identity, group_id: activeGroupId, title, start_at: startAt, location: newEventLocation || null });
      setNewEventTitle("");
      setNewEventLocation("");
      // reload
      const fromIso = isoDate(new Date(Date.now() - 7 * 24 * 3600 * 1000));
      const toIso = isoDate(new Date(Date.now() + 60 * 24 * 3600 * 1000));
      const out = await postJson<{ events?: GroupEvent[] }>("/api/a2a/group/events/list", { identity, group_id: activeGroupId, from_iso: fromIso, to_iso: toIso });
      setEvents(Array.isArray(out?.events) ? out.events : []);
    } catch (e: any) {
      setEventsErr(String(e?.message ?? e ?? "Failed to create event"));
    }
  }

  async function createStudy() {
    if (!activeGroupId) return;
    const title = newStudyTitle.trim();
    if (!title) return;
    setStudiesErr(null);
    try {
      const out = await postJson<any>("/api/a2a/group/bible_study/create", { identity, group_id: activeGroupId, title, description: null });
      setNewStudyTitle("");
      const id = typeof out?.bible_study_id === "string" ? out.bible_study_id : "";
      const list = await postJson<{ studies?: BibleStudy[] }>("/api/a2a/group/bible_study/list", { identity, group_id: activeGroupId, include_archived: false });
      const s = Array.isArray(list?.studies) ? list.studies : [];
      setStudies(s);
      setActiveStudyId(id || s[0]?.id || "");
    } catch (e: any) {
      setStudiesErr(String(e?.message ?? e ?? "Failed to create Bible study"));
    }
  }

  async function addReading() {
    const ref = readingRef.trim();
    if (!activeStudyId || !ref) return;
    try {
      await postJson("/api/a2a/group/bible_study/reading/add", { identity, bible_study_id: activeStudyId, ref, order_index: 0, notes: null });
      setReadingRef("");
    } catch (e: any) {
      setStudiesErr(String(e?.message ?? e ?? "Failed to add reading"));
    }
  }

  async function addNote() {
    const md = noteMd.trim();
    if (!activeStudyId || !md) return;
    try {
      await postJson("/api/a2a/group/bible_study/note/add", { identity, bible_study_id: activeStudyId, content_markdown: md, visibility: "members" });
      setNoteMd("");
    } catch (e: any) {
      setStudiesErr(String(e?.message ?? e ?? "Failed to add note"));
    }
  }

  return (
    <div style={{ height: "100%", background: "white", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Groups</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" onClick={() => void refresh()} disabled={loading} style={smallBtn}>
            Refresh
          </button>
          <button type="button" onClick={onClose} style={smallBtn}>
            Close
          </button>
        </div>
      </div>

      <div style={{ padding: 14, overflow: "auto", display: "grid", gap: 14, alignContent: "start", background: "#f8fafc" }}>
        {error ? <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div> : null}
        {loading ? <div style={{ color: "#64748b" }}>Loading…</div> : null}

        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 900, color: "#0f172a" }}>My groups</div>
          {groups.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {groups.map((g) => {
                const isActive = g.id === activeGroupId;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setActiveGroupId(g.id)}
                    style={{
                      textAlign: "left",
                      border: isActive ? "2px solid #0f172a" : "1px solid #e2e8f0",
                      background: isActive ? "#0f172a" : "white",
                      color: isActive ? "white" : "#0f172a",
                      borderRadius: 12,
                      padding: "10px 12px",
                      cursor: "pointer",
                      display: "grid",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 900 }}>{g.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.85 }}>
                        {String(g.myRole ?? "member")} · {String(g.myStatus ?? "active")}
                      </div>
                    </div>
                    {g.description ? <div style={{ fontSize: 12, opacity: 0.85 }}>{g.description}</div> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>No groups yet. (You’ll only see groups you belong to.)</div>
          )}
        </section>

        {activeGroup ? (
          <>
            <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Group details</div>
              {activeGroup.meetingDetails ? <div style={{ fontSize: 12, color: "#334155" }}>{activeGroup.meetingDetails}</div> : null}
              {!activeGroup.meetingDetails ? <div style={{ fontSize: 12, color: "#64748b" }}>No meeting details yet.</div> : null}
            </section>

            <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>People</div>
              {membersErr ? <div style={{ color: "#dc2626", fontSize: 12 }}>{membersErr}</div> : null}
              <div style={{ display: "grid", gap: 8 }}>
                {members.map((m) => (
                  <div key={m.personId} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {`${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || m.personId}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>
                        {m.role} · {m.status}
                      </div>
                    </div>
                    {canManageMembers && m.status === "active" ? (
                      <button
                        type="button"
                        style={{ ...smallBtn, background: "#b91c1c" }}
                        onClick={() => void postJson("/api/a2a/group/member/remove", { identity, group_id: activeGroupId, member_person_id: m.personId }).then(() => void refresh())}
                        title="Remove from group"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              {!canManageMembers ? <div style={{ fontSize: 12, color: "#64748b" }}>You can invite people, but only leaders/hosts can remove or change roles.</div> : null}
            </section>

            <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Schedule</div>
              {eventsErr ? <div style={{ color: "#dc2626", fontSize: 12 }}>{eventsErr}</div> : null}
              <div style={{ display: "grid", gap: 8 }}>
                {events.map((e) => (
                  <div key={e.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10 }}>
                    <div style={{ fontWeight: 900, color: "#0f172a" }}>{e.title}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      {new Date(e.startAt).toLocaleString()} {e.location ? `· ${e.location}` : ""}
                    </div>
                    {e.description ? <div style={{ fontSize: 12, color: "#334155", marginTop: 6 }}>{e.description}</div> : null}
                  </div>
                ))}
                {!events.length ? <div style={{ fontSize: 12, color: "#64748b" }}>No upcoming events.</div> : null}
              </div>

              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 10, display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Plan an activity</div>
                <input value={newEventTitle} onChange={(e) => setNewEventTitle(e.target.value)} placeholder="Event title" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }} />
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                  <input type="datetime-local" value={newEventStart} onChange={(e) => setNewEventStart(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }} />
                  <input value={newEventLocation} onChange={(e) => setNewEventLocation(e.target.value)} placeholder="Location (optional)" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }} />
                </div>
                <button type="button" style={btn} onClick={() => void createEvent()}>
                  Create event
                </button>
              </div>
            </section>

            <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>Bible study</div>
              {studiesErr ? <div style={{ color: "#dc2626", fontSize: 12 }}>{studiesErr}</div> : null}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select value={activeStudyId} onChange={(e) => setActiveStudyId(e.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px", minWidth: 220 }}>
                  <option value="">Select a Bible study…</option>
                  {studies.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
                <input value={newStudyTitle} onChange={(e) => setNewStudyTitle(e.target.value)} placeholder="New study title" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }} />
                <button type="button" style={smallBtn} onClick={() => void createStudy()}>
                  Create
                </button>
              </div>

              {activeStudyId ? (
                <>
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr auto" }}>
                    <input value={readingRef} onChange={(e) => setReadingRef(e.target.value)} placeholder="Add reading (e.g., John 14:1-14)" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }} />
                    <button type="button" style={smallBtn} onClick={() => void addReading()}>
                      Add
                    </button>
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    <textarea value={noteMd} onChange={(e) => setNoteMd(e.target.value)} placeholder="Add a group note (markdown)" rows={4} style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px", resize: "vertical" }} />
                    <button type="button" style={smallBtn} onClick={() => void addNote()}>
                      Save note
                    </button>
                  </div>

                  <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Sessions</div>
                    {sessionsErr ? <div style={{ color: "#dc2626", fontSize: 12 }}>{sessionsErr}</div> : null}
                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                      {sessions.map((s) => (
                        <div key={s.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10 }}>
                          <div style={{ fontWeight: 900, color: "#0f172a" }}>{s.title || "Session"}</div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>{new Date(s.sessionAt).toLocaleString()}</div>
                          {s.agenda ? <div style={{ fontSize: 12, color: "#334155", marginTop: 6 }}>{s.agenda}</div> : null}
                        </div>
                      ))}
                      {!sessions.length ? <div style={{ fontSize: 12, color: "#64748b" }}>No sessions yet.</div> : null}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: "#64748b" }}>Create or select a Bible study to add readings, notes, and sessions.</div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

