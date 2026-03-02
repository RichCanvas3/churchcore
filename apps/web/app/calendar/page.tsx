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

type Filters = {
  campus: "all" | "campus_boulder" | "campus_erie" | "campus_thornton";
  outdoorOnly: boolean;
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

  const [weekStartISO, setWeekStartISO] = useState<string>(() => startOfDayISO(new Date()));
  const [filters, setFilters] = useState<Filters>(() => ({
    campus: "all",
    outdoorOnly: false,
  }));

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const weekDates = useMemo(() => {
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) dates.push(addDaysISO(weekStartISO, i));
    return dates;
  }, [weekStartISO]);

  const effectiveIdentity = useMemo<Identity>(() => {
    const campus_id = filters.campus === "all" ? null : filters.campus;
    return { ...baseIdentity, campus_id };
  }, [baseIdentity, filters.campus]);

  useEffect(() => {
    // If a caller navigated directly with ?start=YYYY-MM-DD, respect it once.
    const u = new URL(window.location.href);
    const start = String(u.searchParams.get("start") ?? "").trim();
    if (start && isISODate(start)) setWeekStartISO(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const allEvents = useMemo(() => {
    const items = Array.isArray(schedule?.events) ? schedule!.events : [];
    return items
      .filter((e) => e && typeof e === "object" && typeof e.id === "string" && typeof e.title === "string" && typeof e.start_at === "string")
      .slice()
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  }, [schedule]);

  const filteredEvents = useMemo(() => {
    if (!filters.outdoorOnly) return allEvents;
    return allEvents.filter((e) => Boolean(e.is_outdoor) || String(e.title ?? "").toLowerCase().includes("outdoor"));
  }, [allEvents, filters.outdoorOnly]);

  const grouped = useMemo(() => {
    const map = new Map<string, ChurchEvent[]>();
    for (const d of weekDates) map.set(d, []);
    for (const e of filteredEvents) {
      const key = new Date(e.start_at).toISOString().slice(0, 10);
      const arr = map.get(key);
      if (arr) arr.push(e);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
      map.set(k, arr);
    }
    return [...map.entries()];
  }, [filteredEvents, weekDates]);

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
              Week view. Outdoor events include a weather snapshot (48h/8d).
            </div>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Week: <span style={{ fontWeight: 800 }}>{weekDates[0]}</span> → <span style={{ fontWeight: 800 }}>{weekDates[6]}</span>
              {schedule?.asOfISO ? <span style={{ marginLeft: 10 }}>as-of {schedule.asOfISO}</span> : null}
            </div>
            {err ? (
              <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 800 }}>{err}</div>
            ) : busy ? (
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>Loading…</div>
            ) : null}
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Showing <span style={{ fontWeight: 900 }}>{filteredEvents.length}</span> of{" "}
              <span style={{ fontWeight: 900 }}>{allEvents.length}</span> events
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => setWeekStartISO(addDaysISO(weekStartISO, -7))} style={button}>
              <ChevronLeft size={16} />
              Prev
            </button>
            <button onClick={() => setWeekStartISO(startOfDayISO(new Date()))} style={button}>
              Today
            </button>
            <button onClick={() => setWeekStartISO(addDaysISO(weekStartISO, 7))} style={button}>
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
                <option value="campus_boulder">Boulder</option>
                <option value="campus_erie">Erie</option>
                <option value="campus_thornton">Thornton</option>
              </select>
            </label>

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
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 12,
            }}
          >
            <style>{`
              @media (min-width: 900px) {
                .cc-calendar-grid { grid-template-columns: repeat(7, minmax(0, 1fr)); }
              }
            `}</style>
            <div className="cc-calendar-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
              {grouped.map(([dateISO, items]) => (
                <div key={dateISO} style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>
                        {formatWeekday(dateISO)}{" "}
                        <span style={{ fontWeight: 700, color: "#64748b" }}>{formatMonthDay(dateISO)}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "#94a3b8" }}>{dateISO}</div>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 900, color: "#64748b" }}>{items.length}</div>
                  </div>
                  <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                    {items.length === 0 ? (
                      <div
                        style={{
                          border: "1px dashed #e2e8f0",
                          borderRadius: 12,
                          padding: 10,
                          fontSize: 12,
                          color: "#94a3b8",
                          textAlign: "center",
                        }}
                      >
                        —
                      </div>
                    ) : (
                      items.map((e) => {
                        const wf = e.weatherForecast ?? null;
                        const isOutdoor = Boolean(e.is_outdoor) || String(e.title ?? "").toLowerCase().includes("outdoor");
                        const campusLabel =
                          String(e.campus_id ?? "") === "campus_boulder"
                            ? "Boulder"
                            : String(e.campus_id ?? "") === "campus_erie"
                              ? "Erie"
                              : String(e.campus_id ?? "") === "campus_thornton"
                                ? "Thornton"
                                : "";
                        return (
                          <div key={e.id} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 10, display: "grid", gap: 6 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 900, color: "#0f172a" }}>
                                <Clock size={14} color="#475569" />
                                {formatLocalTime(e.start_at)}
                              </div>
                              {isOutdoor ? (
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    borderRadius: 999,
                                    padding: "4px 8px",
                                    background: "#fef3c7",
                                    border: "1px solid #fdba74",
                                    fontSize: 10,
                                    fontWeight: 900,
                                    color: "#78350f",
                                  }}
                                >
                                  <Sun size={12} />
                                  Outdoor
                                </span>
                              ) : null}
                            </div>
                            <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a", lineHeight: 1.25, wordBreak: "break-word" }}>
                              {e.title}
                            </div>
                            {filters.campus === "all" && campusLabel ? (
                              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 800 }}>Campus: {campusLabel}</div>
                            ) : null}
                            {e.location_name || e.location_address ? (
                              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#64748b", fontWeight: 700 }}>
                                <MapPin size={14} color="#64748b" />
                                <span style={{ wordBreak: "break-word" }}>
                                  {String(e.location_name ?? "").trim()}
                                  {e.location_address ? ` — ${String(e.location_address)}` : ""}
                                </span>
                              </div>
                            ) : null}

                            {isOutdoor && wf ? (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11, color: "#64748b", fontWeight: 700 }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                  <Sun size={14} color="#64748b" />
                                  {wf.summary ?? "Forecast"}
                                </span>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                  <Wind size={14} color="#64748b" />
                                  {typeof wf.wind_speed === "number" ? wf.wind_speed.toFixed(1) : "?"}{" "}
                                  {typeof wf.wind_gust === "number" ? `gust ${wf.wind_gust.toFixed(1)}` : ""} mph
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
                </div>
              ))}
            </div>
          </div>
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

