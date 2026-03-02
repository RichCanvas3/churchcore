"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

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
  start_at: string;
  end_at?: string | null;
  location_name?: string | null;
  location_address?: string | null;
  is_outdoor?: number | boolean | null;
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

export function CalendarPanel(props: { identity: Identity; onClose: () => void }) {
  const identity = props.identity;
  const [weekStartISO, setWeekStartISO] = useState<string>(() => startOfDayISO(new Date()));
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");

  const weekDates = useMemo(() => {
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) dates.push(addDaysISO(weekStartISO, i));
    return dates;
  }, [weekStartISO]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBusy(true);
      setErr("");
      try {
        const sched = await postJson<Schedule>("/api/a2a/calendar/week", { identity, start: weekStartISO });
        if (!cancelled) setSchedule(sched);
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message ?? e ?? "Failed to load calendar"));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [identity, weekStartISO]);

  const events = useMemo(() => {
    const items = Array.isArray(schedule?.events) ? schedule!.events : [];
    return items
      .filter((e) => e && typeof e === "object" && typeof e.id === "string" && typeof e.title === "string" && typeof e.start_at === "string")
      .slice()
      .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  }, [schedule]);

  const grouped = useMemo(() => {
    const map = new Map<string, ChurchEvent[]>();
    for (const d of weekDates) map.set(d, []);
    for (const e of events) {
      const key = new Date(e.start_at).toISOString().slice(0, 10);
      const arr = map.get(key);
      if (arr) arr.push(e);
    }
    return [...map.entries()];
  }, [events, weekDates]);

  const buttonStyle: React.CSSProperties = {
    border: "1px solid #e2e8f0",
    background: "white",
    borderRadius: 10,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 900,
  };

  return (
    <div style={{ height: "100%", minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr", background: "white" }}>
      <div style={{ padding: 12, borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ fontWeight: 900 }}>Events calendar</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            {weekDates[0]} → {weekDates[6]} {schedule?.asOfISO ? ` (as-of ${schedule.asOfISO})` : ""}
          </div>
          {busy ? <div style={{ fontSize: 12, color: "#64748b" }}>Loading…</div> : null}
          {err ? <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 800 }}>{err}</div> : null}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button style={buttonStyle} onClick={() => setWeekStartISO(addDaysISO(weekStartISO, -7))}>
            Prev
          </button>
          <button style={buttonStyle} onClick={() => setWeekStartISO(startOfDayISO(new Date()))}>
            Today
          </button>
          <button style={buttonStyle} onClick={() => setWeekStartISO(addDaysISO(weekStartISO, 7))}>
            Next
          </button>
          <Link href={`/calendar?start=${encodeURIComponent(weekStartISO)}`} target="_blank" style={{ ...buttonStyle, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Open full
          </Link>
          <button style={buttonStyle} onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>

      <div style={{ minHeight: 0, overflow: "auto", padding: 12 }}>
        <div style={{ display: "grid", gap: 12 }}>
          {grouped.map(([dateISO, items]) => (
            <div key={dateISO} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 900 }}>
                  {formatWeekday(dateISO)} <span style={{ color: "#64748b", fontWeight: 700 }}>{formatMonthDay(dateISO)}</span>
                </div>
                <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>{items.length}</div>
              </div>
              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                {items.length === 0 ? (
                  <div style={{ color: "#94a3b8", fontSize: 12 }}>—</div>
                ) : (
                  items.map((e) => {
                    const wf = e.weatherForecast ?? null;
                    const isOutdoor = Boolean(e.is_outdoor);
                    return (
                      <div key={e.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 900 }}>{formatLocalTime(e.start_at)}</div>
                          {isOutdoor ? (
                            <div style={{ fontSize: 10, fontWeight: 900, background: "#fff7ed", border: "1px solid #fdba74", color: "#78350f", borderRadius: 999, padding: "3px 8px" }}>
                              Outdoor
                            </div>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 900 }}>{e.title}</div>
                        {wf ? (
                          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>
                            {wf.summary ?? "Forecast"} • {typeof wf.temp === "number" ? `${wf.temp.toFixed(0)}°F` : "?"} •{" "}
                            {typeof wf.pop === "number" ? `${Math.round(wf.pop * 100)}% precip` : "?"}
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
    </div>
  );
}

