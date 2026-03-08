"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  meetingFrequency?: string | null;
  meetingDayOfWeek?: number | null;
  meetingTimeLocal?: string | null;
  meetingTimezone?: string | null;
  meetingLocationName?: string | null;
  meetingLocationAddress?: string | null;
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

type BibleStudyReading = {
  id: string;
  ref: string;
  orderIndex?: number | null;
  notes?: string | null;
  createdAt?: string | null;
};

type BibleStudyNote = {
  id: string;
  authorPersonId?: string | null;
  authorFirstName?: string | null;
  authorLastName?: string | null;
  contentMarkdown: string;
  visibility?: string | null;
  createdAt?: string | null;
};

type InviteInboxItem = {
  id: string;
  groupId: string;
  groupName: string;
  groupDescription?: string | null;
  invitedByPersonId?: string | null;
  invitedByFirstName?: string | null;
  invitedByLastName?: string | null;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type OutgoingInvite = {
  id: string;
  inviteePersonId: string;
  inviteeFirstName?: string | null;
  inviteeLastName?: string | null;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  expiresAt?: string | null;
};

type PersonHit = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  campusId?: string | null;
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

  const [readings, setReadings] = useState<BibleStudyReading[]>([]);
  const [readingsErr, setReadingsErr] = useState<string | null>(null);

  const [notes, setNotes] = useState<BibleStudyNote[]>([]);
  const [notesErr, setNotesErr] = useState<string | null>(null);

  const [invites, setInvites] = useState<InviteInboxItem[]>([]);
  const [invitesErr, setInvitesErr] = useState<string | null>(null);
  const [invitesBusy, setInvitesBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [newGroupMeeting, setNewGroupMeeting] = useState("");
  const [newGroupOpen, setNewGroupOpen] = useState(true);

  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteHits, setInviteHits] = useState<PersonHit[]>([]);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const inviteSearchTimer = useRef<number | null>(null);
  const [inviteOk, setInviteOk] = useState<string | null>(null);

  const [outInvites, setOutInvites] = useState<OutgoingInvite[]>([]);
  const [outInvitesErr, setOutInvitesErr] = useState<string | null>(null);
  const [outInvitesBusy, setOutInvitesBusy] = useState(false);

  const [editFreq, setEditFreq] = useState<"" | "weekly" | "biweekly">("");
  const [editDow, setEditDow] = useState<number | "">("");
  const [editTime, setEditTime] = useState("");
  const [editTz, setEditTz] = useState("");
  const [editLocName, setEditLocName] = useState("");
  const [editLocAddr, setEditLocAddr] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupSaveErr, setGroupSaveErr] = useState<string | null>(null);

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

  async function refreshInvites() {
    setInvitesBusy(true);
    setInvitesErr(null);
    try {
      const out = await postJson<{ invites?: InviteInboxItem[] }>("/api/a2a/group/invites/inbox/list", { identity, status: "pending", limit: 50, offset: 0 });
      setInvites(Array.isArray(out?.invites) ? out.invites : []);
    } catch (e: any) {
      setInvitesErr(String(e?.message ?? e ?? "Failed to load invites"));
      setInvites([]);
    } finally {
      setInvitesBusy(false);
    }
  }

  async function createGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    setError(null);
    try {
      const out = await postJson<any>("/api/a2a/group/create", {
        identity,
        name,
        description: newGroupDesc.trim() || null,
        meeting_details: newGroupMeeting.trim() || null,
        is_open: Boolean(newGroupOpen),
      });
      const id = typeof out?.group_id === "string" ? String(out.group_id) : "";
      setNewGroupName("");
      setNewGroupDesc("");
      setNewGroupMeeting("");
      setNewGroupOpen(true);
      setCreateOpen(false);
      await refresh();
      if (id) setActiveGroupId(id);
    } catch (e: any) {
      setError(String(e?.message ?? e ?? "Failed to create group"));
    }
  }

  async function respondInvite(inviteId: string, action: "accept" | "decline") {
    setInvitesErr(null);
    try {
      await postJson("/api/a2a/group/invite/respond", { identity, invite_id: inviteId, action });
      await refreshInvites();
      if (action === "accept") await refresh();
    } catch (e: any) {
      setInvitesErr(String(e?.message ?? e ?? "Failed to respond to invite"));
    }
  }

  async function searchPeopleNow(q: string) {
    const s = q.trim();
    if (!s) {
      setInviteHits([]);
      setInviteErr(null);
      return;
    }
    setInviteErr(null);
    try {
      const out = await postJson<{ people?: PersonHit[] }>("/api/a2a/people/search", { identity, q: s, limit: 12 });
      setInviteHits(Array.isArray(out?.people) ? out.people : []);
    } catch (e: any) {
      setInviteErr(String(e?.message ?? e ?? "Search failed"));
      setInviteHits([]);
    }
  }

  async function invitePerson(personId: string) {
    if (!activeGroupId) return;
    setInviteErr(null);
    setInviteOk(null);
    try {
      const out = await postJson<any>("/api/a2a/group/invite/create", { identity, group_id: activeGroupId, invitee_person_id: personId });
      setInviteSearch("");
      setInviteHits([]);
      const exp = typeof out?.invite?.expiresAt === "string" ? String(out.invite.expiresAt) : "";
      setInviteOk(exp ? `Invite sent (expires ${exp.slice(0, 10)}).` : "Invite sent.");
      await refreshOutgoingInvites();
    } catch (e: any) {
      setInviteErr(String(e?.message ?? e ?? "Invite failed"));
    }
  }

  const refreshOutgoingInvites = useCallback(async () => {
    if (!activeGroupId) {
      setOutInvites([]);
      setOutInvitesErr(null);
      return;
    }
    setOutInvitesBusy(true);
    setOutInvitesErr(null);
    try {
      const out = await postJson<{ invites?: OutgoingInvite[] }>("/api/a2a/group/invites/sent/list", { identity, group_id: activeGroupId, status: "pending", limit: 50, offset: 0 });
      setOutInvites(Array.isArray(out?.invites) ? out.invites : []);
    } catch (e: any) {
      setOutInvitesErr(String(e?.message ?? e ?? "Failed to load outgoing invites"));
      setOutInvites([]);
    } finally {
      setOutInvitesBusy(false);
    }
  }, [activeGroupId, identity]);

  async function cancelInvite(inviteId: string) {
    setOutInvitesErr(null);
    try {
      await postJson("/api/a2a/group/invite/cancel", { identity, invite_id: inviteId });
      await refreshOutgoingInvites();
    } catch (e: any) {
      setOutInvitesErr(String(e?.message ?? e ?? "Failed to cancel invite"));
    }
  }

  useEffect(() => {
    void refresh();
    void refreshInvites();
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

    void refreshOutgoingInvites();
  }, [activeGroupId, identity, refreshOutgoingInvites]);

  useEffect(() => {
    setGroupSaveErr(null);
    if (!activeGroup) return;
    setEditFreq((activeGroup.meetingFrequency as any) || "");
    setEditDow(typeof activeGroup.meetingDayOfWeek === "number" ? activeGroup.meetingDayOfWeek : "");
    setEditTime(typeof activeGroup.meetingTimeLocal === "string" ? activeGroup.meetingTimeLocal : "");
    setEditTz(typeof activeGroup.meetingTimezone === "string" ? activeGroup.meetingTimezone : identity.timezone ?? "");
    setEditLocName(typeof activeGroup.meetingLocationName === "string" ? activeGroup.meetingLocationName : "");
    setEditLocAddr(typeof activeGroup.meetingLocationAddress === "string" ? activeGroup.meetingLocationAddress : "");
  }, [activeGroupId, activeGroup, identity.timezone]);

  async function saveRecurringSchedule() {
    if (!activeGroupId) return;
    setSavingGroup(true);
    setGroupSaveErr(null);
    try {
      await postJson("/api/a2a/group/update", {
        identity,
        group_id: activeGroupId,
        meeting_frequency: editFreq || null,
        meeting_day_of_week: editDow === "" ? null : Number(editDow),
        meeting_time_local: editTime.trim() || null,
        meeting_timezone: editTz.trim() || null,
        meeting_location_name: editLocName.trim() || null,
        meeting_location_address: editLocAddr.trim() || null,
      });
      await refresh();
    } catch (e: any) {
      setGroupSaveErr(String(e?.message ?? e ?? "Failed to save group schedule"));
    } finally {
      setSavingGroup(false);
    }
  }

  useEffect(() => {
    setSessions([]);
    setSessionsErr(null);
    setReadings([]);
    setReadingsErr(null);
    setNotes([]);
    setNotesErr(null);
    if (!activeStudyId) return;
    void postJson<{ sessions?: BibleStudySession[] }>("/api/a2a/group/bible_study/sessions/list", { identity, bible_study_id: activeStudyId })
      .then((out) => setSessions(Array.isArray(out?.sessions) ? out.sessions : []))
      .catch((e) => setSessionsErr(String((e as any)?.message ?? e ?? "Failed to load sessions")));

    void postJson<{ readings?: BibleStudyReading[] }>("/api/a2a/group/bible_study/readings/list", { identity, bible_study_id: activeStudyId })
      .then((out) => setReadings(Array.isArray(out?.readings) ? out.readings : []))
      .catch((e) => setReadingsErr(String((e as any)?.message ?? e ?? "Failed to load readings")));

    void postJson<{ notes?: BibleStudyNote[] }>("/api/a2a/group/bible_study/notes/list", { identity, bible_study_id: activeStudyId })
      .then((out) => setNotes(Array.isArray(out?.notes) ? out.notes : []))
      .catch((e) => setNotesErr(String((e as any)?.message ?? e ?? "Failed to load notes")));
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
      const out = await postJson<{ readings?: BibleStudyReading[] }>("/api/a2a/group/bible_study/readings/list", { identity, bible_study_id: activeStudyId });
      setReadings(Array.isArray(out?.readings) ? out.readings : []);
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
      const out = await postJson<{ notes?: BibleStudyNote[] }>("/api/a2a/group/bible_study/notes/list", { identity, bible_study_id: activeStudyId });
      setNotes(Array.isArray(out?.notes) ? out.notes : []);
    } catch (e: any) {
      setStudiesErr(String(e?.message ?? e ?? "Failed to add note"));
    }
  }

  return (
    <div style={{ height: "100%", background: "white", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>My Small Groups</span>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <div style={{ fontWeight: 900, color: "#0f172a" }}>Invites</div>
            <button type="button" style={smallBtn} onClick={() => void refreshInvites()} disabled={invitesBusy}>
              Refresh
            </button>
          </div>
          {invitesErr ? <div style={{ color: "#dc2626", fontSize: 12 }}>{invitesErr}</div> : null}
          {invitesBusy ? <div style={{ fontSize: 12, color: "#64748b" }}>Loading invites…</div> : null}
          {invites.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {invites.map((iv) => {
                const who = `${iv.invitedByFirstName ?? ""} ${iv.invitedByLastName ?? ""}`.trim();
                return (
                  <div key={iv.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 900, color: "#0f172a" }}>{iv.groupName}</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>
                          {who ? `Invited by ${who}` : "Invite"}
                          {iv.updatedAt ? ` · ${String(iv.updatedAt).slice(0, 10)}` : ""}
                        </div>
                        {iv.groupDescription ? <div style={{ fontSize: 12, color: "#334155", marginTop: 6 }}>{iv.groupDescription}</div> : null}
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button type="button" style={smallBtn} onClick={() => void respondInvite(iv.id, "decline")}>
                          Decline
                        </button>
                        <button type="button" style={btn} onClick={() => void respondInvite(iv.id, "accept")}>
                          Join
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>No pending invites.</div>
          )}
        </section>

        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <div style={{ fontWeight: 900, color: "#0f172a" }}>Create a small group</div>
            <button type="button" style={smallBtn} onClick={() => setCreateOpen((v) => !v)}>
              {createOpen ? "Hide" : "Create"}
            </button>
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Examples: “Joe’s Men’s Bible Study”, “Barbara’s Women’s Study”, “Twilighters Life Group”.</div>
          {createOpen ? (
            <div style={{ display: "grid", gap: 8 }}>
              <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Group name" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }} />
              <input value={newGroupDesc} onChange={(e) => setNewGroupDesc(e.target.value)} placeholder="Short description (optional)" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }} />
              <textarea value={newGroupMeeting} onChange={(e) => setNewGroupMeeting(e.target.value)} placeholder="Meeting details (when/where/how often)" rows={3} style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px", resize: "vertical" }} />
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "#334155" }}>
                <input type="checkbox" checked={newGroupOpen} onChange={(e) => setNewGroupOpen(e.target.checked)} />
                Open to invites (recommended)
              </label>
              <button type="button" style={btn} onClick={() => void createGroup()}>
                Create small group
              </button>
            </div>
          ) : null}
        </section>

        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 900, color: "#0f172a" }}>My groups</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Select a group below to view people, schedule, and Bible study.</div>
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
              {!activeGroup.meetingDetails ? <div style={{ fontSize: 12, color: "#64748b" }}>No extra notes yet.</div> : null}
            </section>

            <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <div style={{ fontWeight: 900, color: "#0f172a" }}>Recurring schedule</div>
                <button type="button" style={smallBtn} onClick={() => void saveRecurringSchedule()} disabled={savingGroup || !canManageMembers}>
                  Save
                </button>
              </div>
              {!canManageMembers ? <div style={{ fontSize: 12, color: "#64748b" }}>Only leaders/hosts (or a guide) can edit schedule details.</div> : null}
              {groupSaveErr ? <div style={{ color: "#dc2626", fontSize: 12 }}>{groupSaveErr}</div> : null}

              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Frequency</div>
                  <select value={editFreq} onChange={(e) => setEditFreq(e.target.value as any)} disabled={!canManageMembers} style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}>
                    <option value="">Not set</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly</option>
                  </select>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Day</div>
                  <select value={editDow as any} onChange={(e) => setEditDow(e.target.value === "" ? "" : Number(e.target.value))} disabled={!canManageMembers} style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}>
                    <option value="">Not set</option>
                    <option value="0">Sunday</option>
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                    <option value="6">Saturday</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Time (local)</div>
                  <input value={editTime} onChange={(e) => setEditTime(e.target.value)} disabled={!canManageMembers} placeholder="HH:MM (e.g., 19:00)" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }} />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Timezone</div>
                  <input value={editTz} onChange={(e) => setEditTz(e.target.value)} disabled={!canManageMembers} placeholder="America/Denver" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }} />
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Location</div>
                <input value={editLocName} onChange={(e) => setEditLocName(e.target.value)} disabled={!canManageMembers} placeholder="Place name (optional)" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }} />
                <input value={editLocAddr} onChange={(e) => setEditLocAddr(e.target.value)} disabled={!canManageMembers} placeholder="Address / meeting link (optional)" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }} />
              </div>
            </section>

            <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 900, color: "#0f172a" }}>People</div>
              {membersErr ? <div style={{ color: "#dc2626", fontSize: 12 }}>{membersErr}</div> : null}
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, background: "#f8fafc", display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Invite someone</div>
                <input
                  value={inviteSearch}
                  onChange={(e) => {
                    const v = e.target.value;
                    setInviteSearch(v);
                    if (inviteSearchTimer.current) window.clearTimeout(inviteSearchTimer.current);
                    inviteSearchTimer.current = window.setTimeout(() => void searchPeopleNow(v), 250) as any;
                  }}
                  placeholder="Search name, email, or phone"
                  style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }}
                />
                {inviteErr ? <div style={{ color: "#dc2626", fontSize: 12 }}>{inviteErr}</div> : null}
                {inviteOk ? <div style={{ color: "#166534", fontSize: 12 }}>{inviteOk}</div> : null}
                {inviteSearch.trim() ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    {inviteHits.map((p) => {
                      const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.id;
                      const meta = p.email || p.phone || "";
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => void invitePerson(p.id)}
                          style={{ textAlign: "left", border: "1px solid #e2e8f0", background: "white", borderRadius: 10, padding: "8px 10px", cursor: "pointer" }}
                          title="Invite to this group"
                        >
                          <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>{name}</div>
                          {meta ? <div style={{ fontSize: 12, color: "#64748b" }}>{meta}</div> : null}
                        </button>
                      );
                    })}
                    {!inviteHits.length ? <div style={{ fontSize: 12, color: "#64748b" }}>No matches.</div> : null}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "#64748b" }}>Type to search people already in this church database.</div>
                )}
              </div>

              <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, background: "#f8fafc", display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Outgoing invites</div>
                  <button type="button" style={smallBtn} onClick={() => void refreshOutgoingInvites()} disabled={outInvitesBusy}>
                    Refresh
                  </button>
                </div>
                {outInvitesErr ? <div style={{ color: "#dc2626", fontSize: 12 }}>{outInvitesErr}</div> : null}
                {outInvitesBusy ? <div style={{ fontSize: 12, color: "#64748b" }}>Loading…</div> : null}
                <div style={{ display: "grid", gap: 6 }}>
                  {outInvites.map((iv) => {
                    const who = `${iv.inviteeFirstName ?? ""} ${iv.inviteeLastName ?? ""}`.trim() || iv.inviteePersonId;
                    const sent = iv.createdAt ? String(iv.createdAt).slice(0, 10) : "";
                    const exp = iv.expiresAt ? String(iv.expiresAt).slice(0, 10) : "";
                    return (
                      <div key={iv.id} style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px", display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>{who}</div>
                          <div style={{ fontSize: 12, color: "#64748b" }}>
                            status={iv.status}
                            {sent ? ` · sent ${sent}` : ""}
                            {exp ? ` · expires ${exp}` : ""}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <button type="button" style={{ ...smallBtn, background: "#b91c1c" }} onClick={() => void cancelInvite(iv.id)} title="Cancel invite">
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {!outInvites.length ? <div style={{ fontSize: 12, color: "#64748b" }}>No pending outgoing invites.</div> : null}
                </div>
              </div>
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
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc", padding: 10, display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Readings</div>
                    {readingsErr ? <div style={{ color: "#dc2626", fontSize: 12 }}>{readingsErr}</div> : null}
                    <div style={{ display: "grid", gap: 6 }}>
                      {readings.map((r) => (
                        <div key={r.id} style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px" }}>
                          <div style={{ fontWeight: 900, color: "#0f172a", fontSize: 13 }}>{r.ref}</div>
                          {r.notes ? <div style={{ fontSize: 12, color: "#334155", marginTop: 4 }}>{r.notes}</div> : null}
                        </div>
                      ))}
                      {!readings.length ? <div style={{ fontSize: 12, color: "#64748b" }}>No readings yet.</div> : null}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr auto" }}>
                    <input value={readingRef} onChange={(e) => setReadingRef(e.target.value)} placeholder="Add reading (e.g., John 14:1-14)" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }} />
                    <button type="button" style={smallBtn} onClick={() => void addReading()}>
                      Add
                    </button>
                  </div>

                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc", padding: 10, display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Notes</div>
                    {notesErr ? <div style={{ color: "#dc2626", fontSize: 12 }}>{notesErr}</div> : null}
                    <div style={{ display: "grid", gap: 6 }}>
                      {notes.map((n) => {
                        const who = `${n.authorFirstName ?? ""} ${n.authorLastName ?? ""}`.trim();
                        return (
                          <div key={n.id} style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 10px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>{who || "Note"}</div>
                              <div style={{ fontSize: 12, color: "#64748b" }}>{n.createdAt ? String(n.createdAt).slice(0, 10) : ""}</div>
                            </div>
                            <div style={{ fontSize: 12, color: "#334155", marginTop: 6, whiteSpace: "pre-wrap" }}>{n.contentMarkdown}</div>
                          </div>
                        );
                      })}
                      {!notes.length ? <div style={{ fontSize: 12, color: "#64748b" }}>No notes yet.</div> : null}
                    </div>
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

