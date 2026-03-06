"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Droplets, Filter, MapPin, Sun, Wind } from "lucide-react";
import { useDemoIdentity } from "../../components/DemoIdentityProvider";

type Identity = {
  tenant_id: string;
  user_id: string;
  role: "seeker" | "guide";
  campus_id?: string | null;
  timezone?: string | null;
  persona_id?: string | null;
};

type Campus = { id: string; name?: string | null };

type WeatherForecast = {
  summary?: string;
  temp?: number;
  wind_speed?: number;
  wind_gust?: number;
  pop?: number;
};

type ChurchEvent = {
  id: string;
  campus_id?: string | null;
  title: string;
  description?: string | null;
  start_at: string;
  end_at?: string | null;
  location_name?: string | null;
  location_address?: string | null;
  is_outdoor?: number | boolean | null;
  lat?: number | null;
  lon?: number | null;
  weatherForecast?: WeatherForecast | null;
};

type Schedule = {
  asOfISO?: string;
  weekStartISO: string;
  weekEndISO: string;
  events: ChurchEvent[];
};

type MyActivity = {
  communityId: string;
  status?: string | null;
  role?: string | null;
  joinedAt?: string | null;
  leftAt?: string | null;
  updatedAt?: string | null;
  campusId?: string | null;
  kind?: string | null;
  title: string;
  description?: string | null;
  sourceUrl?: string | null;
  signupUrl?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  isActive?: number | boolean | null;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error((json as any)?.error ?? (json as any)?.detail ?? `Request failed (${res.status})`);
  return json;
}

function startOfDayISO(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
  return x.toISOString().slice(0, 10);
}

function isISODate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function addDaysISO(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return isoDate;
  return startOfDayISO(new Date(ms + days * 24 * 3600 * 1000));
}

function startOfWeekISO(isoDate: string, weekStartsOn: 0 | 1 = 0) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0..6 (Sun..Sat)
  const diff = (dow - weekStartsOn + 7) % 7;
  return addDaysISO(isoDate, -diff);
}

function startOfMonthISO(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  return startOfDayISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

function addMonthsISO(isoDate: string, months: number) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  return startOfDayISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)));
}

function formatLocalTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d);
}

function formatWeekday(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(d);
}

function formatMonthDay(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}

function formatMonthYear(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(d);
}

type ViewMode = "cards" | "week" | "month";

type Filters = {
  campus: "all" | string;
  outdoorOnly: boolean;
  showChurchEvents: boolean;
  showMyActivities: boolean;
};

function CalendarInner() {
  const { identity: demo } = useDemoIdentity();
  const baseIdentity = useMemo<Identity>(
    () => ({
      tenant_id: demo.tenant_id,
      user_id: demo.user_id,
      role: demo.role,
      campus_id: demo.campus_id ?? null,
      timezone: demo.timezone ?? null,
      persona_id: (demo as any).persona_id ?? null,
    }),
    [demo],
  );

  const [view, setView] = useState<ViewMode>("cards");
  const [weekStartISO, setWeekStartISO] = useState<string>(() => startOfWeekISO(startOfDayISO(new Date()), 0));
  const [monthStartISO, setMonthStartISO] = useState<string>(() => startOfMonthISO(startOfDayISO(new Date())));
  const [filters, setFilters] = useState<Filters>(() => ({
    campus: "all",
    outdoorOnly: false,
    showChurchEvents: true,
    showMyActivities: true,
  }));

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [monthSchedules, setMonthSchedules] = useState<Record<string, Schedule>>({});
  const [myActivities, setMyActivities] = useState<MyActivity[]>([]);
  const [myBusy, setMyBusy] = useState(false);
  const [myErr, setMyErr] = useState<string>("");
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const weekDates = useMemo(() => {
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) dates.push(addDaysISO(weekStartISO, i));
    return dates;
  }, [weekStartISO]);

  const monthGridDates = useMemo(() => {
    const start = startOfWeekISO(monthStartISO, 0);
    const dates: string[] = [];
    for (let i = 0; i < 42; i++) dates.push(addDaysISO(start, i));
    return dates;
  }, [monthStartISO]);

  const activeDates = view === "month" ? monthGridDates : weekDates;
  const activeDateSet = useMemo(() => new Set(activeDates), [activeDates]);

  const effectiveIdentity = useMemo<Identity>(() => {
    const campus_id = filters.campus === "all" ? null : filters.campus;
    return { ...baseIdentity, campus_id };
  }, [baseIdentity, filters.campus]);

  useEffect(() => {
    // If a caller navigated directly with ?start=YYYY-MM-DD, respect it once.
    const u = new URL(window.location.href);
    const start = String(u.searchParams.get("start") ?? "").trim();
    if (start && isISODate(start)) setWeekStartISO(startOfWeekISO(start, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Pull campuses for the filter (fallback to a small hardcoded set).
    let cancelled = false;
    async function load() {
      try {
        const out = await postJson<any>("/api/a2a/church/get_overview", { identity: baseIdentity });
        const list = Array.isArray(out?.campuses) ? out.campuses : [];
        const normalized = list
          .filter((c: any) => c && typeof c === "object")
          .map((c: any) => ({ id: String(c.id ?? ""), name: typeof c.name === "string" ? c.name : null }))
          .filter((c: Campus) => c.id);
        if (!cancelled) setCampuses(normalized);
      } catch {
        if (!cancelled) setCampuses([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [baseIdentity]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBusy(true);
      setErr("");
      try {
        const sched = await postJson<Schedule>("/api/a2a/calendar/week", { identity: effectiveIdentity, start: weekStartISO });
        if (!cancelled) setSchedule(sched);
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message ?? e ?? "Calendar fetch failed."));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [effectiveIdentity, weekStartISO]);

  useEffect(() => {
    // My activities (joined groups/classes/etc).
    let cancelled = false;
    async function load() {
      setMyBusy(true);
      setMyErr("");
      try {
        const out = await postJson<any>("/api/a2a/community/my/list", { identity: baseIdentity, include_inactive: false, limit: 200, offset: 0 });
        const items = Array.isArray(out?.items) ? out.items : [];
        const normalized = items
          .filter((it: any) => it && typeof it === "object" && typeof it.title === "string" && typeof it.communityId === "string")
          .map((it: any) => it as MyActivity);
        if (!cancelled) setMyActivities(normalized);
      } catch (e: any) {
        if (!cancelled) setMyErr(String(e?.message ?? e ?? "Failed to load your activities."));
        if (!cancelled) setMyActivities([]);
      } finally {
        if (!cancelled) setMyBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [baseIdentity]);

  useEffect(() => {
    if (view !== "month") return;
    let cancelled = false;
    async function loadMonthWeeks() {
      setBusy(true);
      setErr("");
      try {
        const weekStarts: string[] = [];
        const start = startOfWeekISO(monthStartISO, 0);
        for (let i = 0; i < 42; i += 7) weekStarts.push(addDaysISO(start, i));
        const missing = weekStarts.filter((ws) => !monthSchedules[ws]);
        if (!missing.length) return;

        const fetched = await Promise.all(
          missing.map(async (ws) => {
            const sched = await postJson<Schedule>("/api/a2a/calendar/week", { identity: effectiveIdentity, start: ws });
            return [ws, sched] as const;
          }),
        );
        if (cancelled) return;
        setMonthSchedules((prev) => {
          const next = { ...prev };
          for (const [ws, sched] of fetched) next[ws] = sched;
          return next;
        });
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message ?? e ?? "Calendar fetch failed."));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void loadMonthWeeks();
    return () => {
      cancelled = true;
    };
  }, [effectiveIdentity, monthSchedules, monthStartISO, view]);

  const allEvents = useMemo(() => {
    const items =
      view === "month"
        ? Object.values(monthSchedules).flatMap((s) => (Array.isArray(s?.events) ? s.events : []))
        : Array.isArray(schedule?.events)
          ? schedule!.events
          : [];
    const normalized = items
      .filter((e) => e && typeof e === "object" && typeof e.id === "string" && typeof e.title === "string" && typeof e.start_at === "string")
      .slice();
    if (view === "month") {
      const seen = new Set<string>();
      const deduped: ChurchEvent[] = [];
      for (const e of normalized) {
        const k = `${e.id}:${e.start_at}`;
        if (seen.has(k)) continue;
        seen.add(k);
        deduped.push(e);
      }
      return deduped.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    }
    return normalized.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  }, [schedule, monthSchedules, view]);

  const filteredEvents = useMemo(() => {
    if (!filters.outdoorOnly) return allEvents;
    return allEvents.filter((e) => Boolean(e.is_outdoor) || String(e.title ?? "").toLowerCase().includes("outdoor"));
  }, [allEvents, filters.outdoorOnly]);

  const filteredMy = useMemo(() => {
    const campusFilter = filters.campus === "all" ? null : String(filters.campus);
    const items = Array.isArray(myActivities) ? myActivities : [];
    return items
      .filter((it) => it && typeof it === "object" && typeof it.communityId === "string" && typeof it.title === "string")
      .filter((it) => {
        if (!campusFilter) return true;
        const cid = typeof it.campusId === "string" ? it.campusId : null;
        return cid === null || cid === campusFilter;
      })
      .filter((it) => typeof it.startAt === "string" && it.startAt)
      .filter((it) => activeDateSet.has(String(it.startAt).slice(0, 10)))
      .slice()
      .sort((a, b) => Date.parse(String(a.startAt)) - Date.parse(String(b.startAt)));
  }, [activeDateSet, filters.campus, myActivities]);

  const grouped = useMemo(() => {
    const map = new Map<string, { church: ChurchEvent[]; mine: MyActivity[] }>();
    for (const d of activeDates) map.set(d, { church: [], mine: [] });
    for (const e of filteredEvents) {
      const key = new Date(e.start_at).toISOString().slice(0, 10);
      const arr = map.get(key);
      if (arr) arr.church.push(e);
    }
    for (const it of filteredMy) {
      const key = String(it.startAt).slice(0, 10);
      const arr = map.get(key);
      if (arr) arr.mine.push(it);
    }
    for (const [k, arr] of map.entries()) {
      arr.church.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
      arr.mine.sort((a, b) => Date.parse(String(a.startAt)) - Date.parse(String(b.startAt)));
      map.set(k, arr);
    }
    return [...map.entries()];
  }, [activeDates, filteredEvents, filteredMy]);

  const cardItems = useMemo(() => {
    const items: Array<{ source: "church" | "mine"; startAt: string; id: string; church?: ChurchEvent; mine?: MyActivity }> = [];
    if (filters.showChurchEvents) {
      for (const e of filteredEvents) {
        const day = new Date(e.start_at).toISOString().slice(0, 10);
        if (!activeDateSet.has(day)) continue;
        items.push({ source: "church", startAt: e.start_at, id: `church:${e.id}`, church: e });
      }
    }
    if (filters.showMyActivities) {
      for (const it of filteredMy) {
        items.push({ source: "mine", startAt: String(it.startAt), id: `mine:${it.communityId}`, mine: it });
      }
    }
    return items.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  }, [activeDateSet, filteredEvents, filteredMy, filters.showChurchEvents, filters.showMyActivities]);

  const shell: React.CSSProperties = { height: "100%", overflow: "auto", background: "#f8fafc" };
  const card: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 16, background: "white" };
  const button: React.CSSProperties = {
    height: 40,
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "white",
    padding: "0 12px",
    fontSize: 14,
    fontWeight: 800,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: "#0f172a",
  };

  const viewBtn = (active: boolean): React.CSSProperties => ({
    ...button,
    height: 36,
    borderRadius: 999,
    padding: "0 10px",
    fontSize: 12,
    background: active ? "#0f172a" : "white",
    color: active ? "white" : "#0f172a",
    border: active ? "1px solid #0f172a" : "1px solid #e2e8f0",
  });

  const rangeLabel =
    view === "month"
      ? formatMonthYear(monthStartISO)
      : `Week: ${weekDates[0]} → ${weekDates[6]}` + (schedule?.asOfISO ? ` (as-of ${schedule.asOfISO})` : "");

  return (
    <div style={shell}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16, display: "grid", gap: 12 }}>
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 4, minWidth: 260 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CalendarDays size={18} color="#475569" />
              <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>Calendar</div>
            </div>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>
              {view === "cards" ? "Event cards (default)." : view === "week" ? "Week view (day cards)." : "Month view (day cards)."} Outdoor events include a weather snapshot.
            </div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{rangeLabel}</div>
            {err ? (
              <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 800 }}>{err}</div>
            ) : busy ? (
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>Loading…</div>
            ) : null}
            {myErr ? <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 800 }}>{myErr}</div> : myBusy ? <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>Loading your activities…</div> : null}
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Showing{" "}
              <span style={{ fontWeight: 900 }}>
                {filters.showChurchEvents ? filteredEvents.filter((e) => activeDateSet.has(new Date(e.start_at).toISOString().slice(0, 10))).length : 0}
              </span>{" "}
              church events and <span style={{ fontWeight: 900 }}>{filters.showMyActivities ? filteredMy.length : 0}</span> my activities
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => setView("cards")} style={viewBtn(view === "cards")}>
              Cards
            </button>
            <button onClick={() => setView("week")} style={viewBtn(view === "week")}>
              Week
            </button>
            <button
              onClick={() => {
                setMonthStartISO(startOfMonthISO(weekStartISO));
                setView("month");
              }}
              style={viewBtn(view === "month")}
            >
              Month
            </button>

            <button
              onClick={() => {
                if (view === "month") setMonthStartISO(addMonthsISO(monthStartISO, -1));
                else setWeekStartISO(addDaysISO(weekStartISO, -7));
              }}
              style={button}
            >
              <ChevronLeft size={16} />
              Prev
            </button>
            <button
              onClick={() => {
                const today = startOfDayISO(new Date());
                setWeekStartISO(startOfWeekISO(today, 0));
                setMonthStartISO(startOfMonthISO(today));
              }}
              style={button}
            >
              Today
            </button>
            <button
              onClick={() => {
                if (view === "month") setMonthStartISO(addMonthsISO(monthStartISO, 1));
                else setWeekStartISO(addDaysISO(weekStartISO, 7));
              }}
              style={button}
            >
              Next
              <ChevronRight size={16} />
            </button>
            <Link href="/chat" style={{ ...button, textDecoration: "none" }}>
              Chat
            </Link>
          </div>
        </header>

        <section style={{ ...card, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 900, color: "#0f172a" }}>
            <Filter size={16} color="#475569" />
            Filters
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 800, color: "#0f172a" }}>
              Campus
              <select
                value={filters.campus}
                onChange={(e) => setFilters((f) => ({ ...f, campus: e.target.value as any }))}
                style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "6px 10px", fontSize: 12, fontWeight: 800 }}
              >
                <option value="all">All</option>
                {(campuses.length
                  ? campuses
                  : [
                      { id: "campus_boulder", name: "Boulder" },
                      { id: "campus_erie", name: "Erie" },
                      { id: "campus_thornton", name: "Thornton" },
                    ]
                ).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? c.id}
                  </option>
                ))}
              </select>
            </label>

            <button
              onClick={() => setFilters((f) => ({ ...f, showChurchEvents: !f.showChurchEvents }))}
              style={{
                borderRadius: 999,
                border: `1px solid ${filters.showChurchEvents ? "#93c5fd" : "#e2e8f0"}`,
                background: filters.showChurchEvents ? "#eff6ff" : "white",
                padding: "8px 10px",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                fontWeight: 900,
                color: "#0f172a",
              }}
              title="Toggle church events"
            >
              Church events
            </button>

            <button
              onClick={() => setFilters((f) => ({ ...f, showMyActivities: !f.showMyActivities }))}
              style={{
                borderRadius: 999,
                border: `1px solid ${filters.showMyActivities ? "#86efac" : "#e2e8f0"}`,
                background: filters.showMyActivities ? "#f0fdf4" : "white",
                padding: "8px 10px",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                fontWeight: 900,
                color: "#0f172a",
              }}
              title="Toggle my activities"
            >
              My activities
            </button>

            <button
              onClick={() => setFilters((f) => ({ ...f, outdoorOnly: !f.outdoorOnly }))}
              style={{
                borderRadius: 999,
                border: `1px solid ${filters.outdoorOnly ? "#fdba74" : "#e2e8f0"}`,
                background: filters.outdoorOnly ? "#fff7ed" : "white",
                padding: "8px 10px",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                fontWeight: 900,
                color: "#0f172a",
              }}
            >
              <Sun size={16} color={filters.outdoorOnly ? "#b45309" : "#475569"} />
              Outdoor
            </button>
          </div>
        </section>

        <section style={{ ...card, padding: 12 }}>
          {view === "cards" ? (
            <div style={{ display: "grid", gap: 10 }}>
              {cardItems.length === 0 ? (
                <div style={{ border: "1px dashed #e2e8f0", borderRadius: 14, padding: 14, color: "#64748b", fontWeight: 800 }}>
                  No items in this range.
                </div>
              ) : (
                cardItems.map((it) => {
                  const dayISO = new Date(it.startAt).toISOString().slice(0, 10);
                  if (it.source === "mine" && it.mine) {
                    const a = it.mine;
                    return (
                      <div key={it.id} style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 14, padding: 12, display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                          <div style={{ fontSize: 12, fontWeight: 900, color: "#166534" }}>
                            My activity{a.kind ? ` · ${String(a.kind)}` : ""}
                          </div>
                          <div style={{ fontSize: 12, color: "#166534", fontWeight: 900 }}>
                            {formatWeekday(dayISO)} {formatMonthDay(dayISO)} · {formatLocalTime(String(a.startAt))}
                          </div>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>{a.title}</div>
                        {a.description ? <div style={{ fontSize: 12, color: "#334155" }}>{String(a.description)}</div> : null}
                      </div>
                    );
                  }
                  const e = it.church!;
                  const wf = e.weatherForecast ?? null;
                  const isOutdoor = Boolean(e.is_outdoor) || String(e.title ?? "").toLowerCase().includes("outdoor");
                  return (
                    <div key={it.id} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 900, color: "#0f172a" }}>
                          <Clock size={14} color="#475569" />
                          {formatWeekday(dayISO)} {formatMonthDay(dayISO)} · {formatLocalTime(e.start_at)}
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ fontSize: 10, fontWeight: 900, background: "#eff6ff", border: "1px solid #93c5fd", color: "#1e3a8a", borderRadius: 999, padding: "3px 8px" }}>
                            Church event
                          </span>
                          {isOutdoor ? (
                            <span style={{ fontSize: 10, fontWeight: 900, background: "#fef3c7", border: "1px solid #fdba74", color: "#78350f", borderRadius: 999, padding: "3px 8px" }}>
                              Outdoor
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>{e.title}</div>
                      {e.location_name || e.location_address ? (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b", fontWeight: 700 }}>
                          <MapPin size={14} color="#64748b" />
                          <span style={{ wordBreak: "break-word" }}>
                            {String(e.location_name ?? "").trim()}
                            {e.location_address ? ` — ${String(e.location_address)}` : ""}
                          </span>
                        </div>
                      ) : null}
                      {isOutdoor && wf ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, color: "#64748b", fontWeight: 700 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <Sun size={14} color="#64748b" />
                            {wf.summary ?? "Forecast"}
                          </span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <Wind size={14} color="#64748b" />
                            {typeof wf.wind_speed === "number" ? wf.wind_speed.toFixed(1) : "?"} {typeof wf.wind_gust === "number" ? `gust ${wf.wind_gust.toFixed(1)}` : ""} mph
                          </span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <Droplets size={14} color="#64748b" />
                            {typeof wf.pop === "number" ? `${Math.round(wf.pop * 100)}%` : "?"} precip
                          </span>
                          <span>Temp {typeof wf.temp === "number" ? `${wf.temp.toFixed(0)}°F` : "?"}</span>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
              <style>{`
                @media (min-width: 900px) {
                  .cc-calendar-grid { grid-template-columns: repeat(7, minmax(0, 1fr)); }
                }
              `}</style>
              <div className="cc-calendar-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                {grouped.map(([dateISO, bucket]) => {
                  const itemsChurch = filters.showChurchEvents ? bucket.church : [];
                  const itemsMine = filters.showMyActivities ? bucket.mine : [];
                  const total = itemsChurch.length + itemsMine.length;
                  const inMonth = view !== "month" ? true : dateISO.slice(0, 7) === monthStartISO.slice(0, 7);
                  return (
                    <div key={dateISO} style={{ minWidth: 0, opacity: view === "month" && !inMonth ? 0.55 : 1 }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>
                            {formatWeekday(dateISO)} <span style={{ fontWeight: 700, color: "#64748b" }}>{formatMonthDay(dateISO)}</span>
                          </div>
                          <div style={{ fontSize: 10, color: "#94a3b8" }}>{dateISO}</div>
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 900, color: "#64748b" }}>{total}</div>
                      </div>

                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        {total === 0 ? (
                          <div style={{ border: "1px dashed #e2e8f0", borderRadius: 12, padding: 10, fontSize: 12, color: "#94a3b8", textAlign: "center" }}>—</div>
                        ) : null}

                        {itemsMine.map((a) => (
                          <div key={`mine:${a.communityId}`} style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 14, padding: 10, display: "grid", gap: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 900, color: "#166534" }}>
                                <Clock size={14} color="#166534" />
                                {formatLocalTime(String(a.startAt))}
                              </div>
                              <span style={{ fontSize: 10, fontWeight: 900, background: "#dcfce7", border: "1px solid #86efac", color: "#166534", borderRadius: 999, padding: "3px 8px" }}>
                                My
                              </span>
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a", lineHeight: 1.25, wordBreak: "break-word" }}>{a.title}</div>
                            {a.kind ? <div style={{ fontSize: 11, color: "#166534", fontWeight: 800 }}>{String(a.kind)}</div> : null}
                          </div>
                        ))}

                        {itemsChurch.map((e) => {
                          const wf = e.weatherForecast ?? null;
                          const isOutdoor = Boolean(e.is_outdoor) || String(e.title ?? "").toLowerCase().includes("outdoor");
                          return (
                            <div key={`church:${e.id}`} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 10, display: "grid", gap: 6 }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 900, color: "#0f172a" }}>
                                  <Clock size={14} color="#475569" />
                                  {formatLocalTime(e.start_at)}
                                </div>
                                {isOutdoor ? (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "4px 8px", background: "#fef3c7", border: "1px solid #fdba74", fontSize: 10, fontWeight: 900, color: "#78350f" }}>
                                    <Sun size={12} />
                                    Outdoor
                                  </span>
                                ) : (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "4px 8px", background: "#eff6ff", border: "1px solid #93c5fd", fontSize: 10, fontWeight: 900, color: "#1e3a8a" }}>
                                    Church
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a", lineHeight: 1.25, wordBreak: "break-word" }}>{e.title}</div>
                              {isOutdoor && wf ? (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11, color: "#64748b", fontWeight: 700 }}>
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                    <Sun size={14} color="#64748b" />
                                    {wf.summary ?? "Forecast"}
                                  </span>
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                    <Droplets size={14} color="#64748b" />
                                    {typeof wf.pop === "number" ? `${Math.round(wf.pop * 100)}%` : "?"} precip
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<div style={{ height: "100%", padding: 16 }}>Loading calendar…</div>}>
      <CalendarInner />
    </Suspense>
  );
}

