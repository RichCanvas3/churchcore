"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BibleReaderPanel } from "./BibleReaderPanel";

type Identity = {
  tenant_id: string;
  user_id: string;
  role: "seeker" | "guide";
  campus_id?: string | null;
  timezone?: string | null;
  persona_id?: string | null;
};

type BiblePlanWeekGetResponse = {
  ok: boolean;
  week: { id: string; anchorMessageId?: string | null; title?: string | null; passage?: string | null; weekStartDate?: string | null; weekEndDate?: string | null } | null;
  items: Array<{ id: string; dayDate: string; kind: string; ref?: string | null; label?: string | null }>;
  progress: Array<{ itemId: string; status: string; completedAt?: string | null }>;
  checkins: Array<{ id: string; dayDate?: string | null; guideUserId?: string | null; message: string; createdAt: string }>;
  error?: string;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error((json as any)?.error ?? (json as any)?.detail ?? `Request failed (${res.status})`);
  return json;
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export function BibleHubModal(props: { identity: Identity; initialRef?: string | null; onClose: () => void }) {
  const [ref, setRef] = useState<string>(() => String(props.initialRef || "Ephesians 2:8-9"));
  const [plan, setPlan] = useState<BiblePlanWeekGetResponse | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planErr, setPlanErr] = useState<string>("");
  const [sermon, setSermon] = useState<any | null>(null);
  const [sermonBusy, setSermonBusy] = useState(false);

  const today = useMemo(() => isoToday(), []);
  const completedIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of plan?.progress ?? []) if (p?.itemId && String(p.status).toLowerCase() === "completed") s.add(String(p.itemId));
    return s;
  }, [plan?.progress]);

  async function loadPlan() {
    setPlanBusy(true);
    setPlanErr("");
    try {
      const out = await postJson<BiblePlanWeekGetResponse>("/api/a2a/bible/plan/week/get", { identity: props.identity });
      if (!out?.ok) throw new Error(out?.error ?? "Failed to load plan");
      setPlan(out);
    } catch (e: any) {
      setPlanErr(String(e?.message ?? e ?? "Failed to load plan"));
      setPlan(null);
    } finally {
      setPlanBusy(false);
    }
  }

  useEffect(() => {
    void loadPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.identity.tenant_id, props.identity.user_id, props.identity.persona_id, props.identity.role, props.identity.campus_id]);

  useEffect(() => {
    const mid = String(plan?.week?.anchorMessageId ?? "").trim();
    if (!mid) {
      setSermon(null);
      return;
    }
    let cancelled = false;
    async function load() {
      setSermonBusy(true);
      try {
        const out = await postJson<any>("/api/a2a/sermon/get", { identity: props.identity, message_id: mid });
        if (!cancelled) setSermon((out as any)?.sermon ?? null);
      } catch {
        if (!cancelled) setSermon(null);
      } finally {
        if (!cancelled) setSermonBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.week?.anchorMessageId]);

  const todays = useMemo(() => (plan?.items ?? []).filter((it) => String(it.dayDate) === today), [plan?.items, today]);
  const nextUp = useMemo(() => {
    const first = todays.find((it) => !completedIds.has(it.id)) ?? todays[0] ?? null;
    return first?.ref ? String(first.ref) : plan?.week?.passage ? String(plan.week.passage) : "";
  }, [completedIds, plan?.week?.passage, todays]);

  useEffect(() => {
    // If opened without an explicit ref, default to today's plan.
    const raw = String(props.initialRef ?? "").trim();
    if (!raw && nextUp) setRef(nextUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextUp]);

  const btn: React.CSSProperties = {
    border: "1px solid #e2e8f0",
    background: "white",
    borderRadius: 10,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 900,
    color: "#0f172a",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={props.onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2500,
        background: "rgba(15, 23, 42, 0.55)",
        display: "grid",
        placeItems: "center",
        padding: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1400px, 98vw)",
          height: "min(94vh, 1100px)",
          background: "white",
          borderRadius: 16,
          border: "1px solid #e2e8f0",
          overflow: "hidden",
          display: "grid",
          gridTemplateRows: "auto 1fr",
          boxShadow: "0 30px 120px rgba(15, 23, 42, 0.38)",
        }}
      >
        <div style={{ padding: 12, borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>Bible</div>
            <div style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ref || "—"}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" onClick={() => void loadPlan()} style={btn} disabled={planBusy}>
              {planBusy ? "Refreshing…" : "Refresh"}
            </button>
            <button type="button" onClick={props.onClose} style={btn}>
              Close
            </button>
          </div>
        </div>

        <div style={{ minHeight: 0, display: "grid", gridTemplateColumns: "1.35fr 0.65fr" }}>
          <div style={{ minHeight: 0, borderRight: "1px solid #e2e8f0" }}>
            <BibleReaderPanel identity={props.identity} initialRef={ref} onClose={props.onClose} />
          </div>

          <div style={{ minHeight: 0, overflow: "auto", padding: 12, background: "#f8fafc", display: "grid", gap: 12, alignContent: "start" }}>
            <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Today’s reading</div>
              {planErr ? <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 800 }}>{planErr}</div> : null}
              {todays.length ? (
                <div style={{ display: "grid", gap: 6 }}>
                  {todays.map((it) => {
                    const done = completedIds.has(it.id);
                    return (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => setRef(String(it.ref ?? plan?.week?.passage ?? ref))}
                        style={{
                          textAlign: "left",
                          border: "1px solid #e2e8f0",
                          background: done ? "#f0fdf4" : "white",
                          borderRadius: 12,
                          padding: 10,
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>{String(it.label ?? "Reading")}</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>
                          {String(it.ref ?? "")} {done ? "· Done" : ""}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#64748b" }}>{planBusy ? "Loading…" : "No plan items scheduled for today."}</div>
              )}
            </section>

            {plan?.week ? (
              <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>This week</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {String(plan.week.weekStartDate ?? "")} → {String(plan.week.weekEndDate ?? "")}
                </div>
                {plan.week.title || plan.week.passage ? (
                  <div style={{ fontSize: 12, color: "#0f172a" }}>
                    {plan.week.title ? <strong>{String(plan.week.title)}</strong> : null}
                    {plan.week.passage ? ` · ${String(plan.week.passage)}` : ""}
                  </div>
                ) : null}
                <button type="button" onClick={() => setRef(String(plan.week?.passage ?? ref))} style={btn}>
                  Open week passage
                </button>
              </section>
            ) : null}

            <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Sermon & guides</div>
              {sermonBusy ? <div style={{ fontSize: 12, color: "#64748b" }}>Loading…</div> : null}
              {sermon?.title ? <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>{String(sermon.title)}</div> : <div style={{ fontSize: 12, color: "#64748b" }}>No sermon linked.</div>}
              <div style={{ display: "grid", gap: 6 }}>
                {sermon?.watchUrl ? (
                  <Link href={String(sermon.watchUrl)} target="_blank" rel="noreferrer" style={{ ...btn, justifyContent: "center" }}>
                    Watch
                  </Link>
                ) : null}
                {sermon?.listenUrl ? (
                  <Link href={String(sermon.listenUrl)} target="_blank" rel="noreferrer" style={{ ...btn, justifyContent: "center" }}>
                    Listen
                  </Link>
                ) : null}
                {sermon?.guideDiscussionUrl ? (
                  <Link href={String(sermon.guideDiscussionUrl)} target="_blank" rel="noreferrer" style={{ ...btn, justifyContent: "center" }}>
                    Discussion guide
                  </Link>
                ) : null}
                {sermon?.guideLeaderUrl ? (
                  <Link href={String(sermon.guideLeaderUrl)} target="_blank" rel="noreferrer" style={{ ...btn, justifyContent: "center" }}>
                    Leader guide
                  </Link>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

