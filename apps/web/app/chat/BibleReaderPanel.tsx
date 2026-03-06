"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Identity = {
  tenant_id: string;
  user_id: string;
  role: "seeker" | "guide";
  campus_id?: string | null;
  timezone?: string | null;
  persona_id?: string | null;
};

type BiblePassageResponse = {
  ok?: boolean;
  ref?: string;
  translation?: string;
  text?: string;
  verses?: Array<{ book?: string | null; chapter?: number | null; verse?: number | null; text?: string }>;
  error?: string;
  detail?: string;
};

type BiblePlanWeek = {
  id: string;
  campusId?: string | null;
  anchorMessageId?: string | null;
  preachedDate?: string | null;
  weekStartDate?: string | null;
  weekEndDate?: string | null;
  title?: string | null;
  passage?: string | null;
};

type BiblePlanItem = {
  id: string;
  dayDate: string;
  kind: "reading" | "daily_verse" | "reflection";
  ref?: string | null;
  label?: string | null;
  notesMarkdown?: string | null;
};

type BiblePlanWeekGetResponse = {
  ok: boolean;
  week: BiblePlanWeek | null;
  items: BiblePlanItem[];
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

function normalizeRef(raw: string) {
  return String(raw || "")
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

export function BibleReaderPanel(props: { identity: Identity; initialRef?: string | null; onClose: () => void }) {
  const identity = props.identity;
  const [ref, setRef] = useState<string>(() => normalizeRef(props.initialRef || "Ephesians 2:8-9"));
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  const [data, setData] = useState<BiblePassageResponse | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planErr, setPlanErr] = useState<string>("");
  const [plan, setPlan] = useState<BiblePlanWeekGetResponse | null>(null);

  const normalizedRef = useMemo(() => normalizeRef(ref), [ref]);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const bibleGatewayUrl = useMemo(() => {
    const q = encodeURIComponent(normalizedRef || "");
    return `https://www.biblegateway.com/passage/?search=${q}&version=NIV`;
  }, [normalizedRef]);

  async function load(nextRef: string) {
    const r = normalizeRef(nextRef);
    if (!r) return;
    setLoading(true);
    setErr("");
    try {
      const out = await postJson<BiblePassageResponse>("/api/a2a/bible/passage", {
        identity,
        ref: r,
        translation: "web",
      });
      if ((out as any)?.ok === false) throw new Error(String((out as any)?.error ?? "Failed to load passage"));
      setData(out);
    } catch (e: any) {
      setErr(String(e?.message ?? e ?? "Failed to load passage"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  // Reload when the active ref changes (e.g., clicked from chat).
  useEffect(() => {
    setRef(normalizeRef(props.initialRef || ref));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialRef]);

  useEffect(() => {
    void load(normalizedRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.tenant_id, identity.user_id, identity.persona_id, identity.role, identity.campus_id, normalizedRef]);

  async function loadPlan() {
    setPlanLoading(true);
    setPlanErr("");
    try {
      const out = await postJson<BiblePlanWeekGetResponse>("/api/a2a/bible/plan/week/get", { identity });
      if (!out?.ok) throw new Error(out?.error ?? "Failed to load plan");
      setPlan(out);
    } catch (e: any) {
      setPlanErr(String(e?.message ?? e ?? "Failed to load plan"));
      setPlan(null);
    } finally {
      setPlanLoading(false);
    }
  }

  useEffect(() => {
    void loadPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.tenant_id, identity.user_id, identity.persona_id, identity.role, identity.campus_id]);

  const completedIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of plan?.progress ?? []) {
      if (p?.itemId && String(p.status).toLowerCase() === "completed") s.add(String(p.itemId));
    }
    return s;
  }, [plan?.progress]);

  async function markComplete(itemId: string) {
    try {
      await postJson("/api/a2a/bible/plan/item/complete", { identity, item_id: itemId });
      await loadPlan();
    } catch (e: any) {
      setPlanErr(String(e?.message ?? e ?? "Failed to mark complete"));
    }
  }

  const verses = Array.isArray(data?.verses) ? data!.verses! : [];
  const displayRef = String(data?.ref || normalizedRef || "").trim();
  const text = String(data?.text || "").trim();

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
    <div style={{ height: "100%", minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr", background: "white" }}>
      <div style={{ padding: 12, borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ fontWeight: 900 }}>Bible</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            In-panel text: WEB (public domain) • Open NIV in a new tab
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Link href={bibleGatewayUrl} target="_blank" rel="noopener noreferrer" style={btn}>
            Open NIV
          </Link>
          <button type="button" onClick={props.onClose} style={btn}>
            Close
          </button>
        </div>
      </div>

      <div style={{ minHeight: 0, overflow: "auto", padding: 12, background: "#f8fafc", display: "grid", gap: 12, alignContent: "start" }}>
        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Passage</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="e.g. Ephesians 2:8-9"
              style={{ flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 10, border: "1px solid #e2e8f0", background: "white", fontWeight: 700 }}
            />
            <button type="button" onClick={() => void load(ref)} style={btn} disabled={loading}>
              {loading ? "Loading…" : "Go"}
            </button>
          </div>
          {err ? <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 800 }}>{err}</div> : null}
          {displayRef ? <div style={{ fontSize: 12, color: "#64748b" }}>Showing: {displayRef}</div> : null}
        </section>

        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Text</div>
          {text ? (
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6, color: "#0f172a" }}>{text}</pre>
          ) : verses.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {verses.map((v, idx) => (
                <div key={idx} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <div style={{ minWidth: 28, fontSize: 12, color: "#64748b", fontWeight: 900 }}>{v.verse ?? ""}</div>
                  <div style={{ fontSize: 14, color: "#0f172a", lineHeight: 1.55 }}>{String(v.text ?? "").trim()}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>{loading ? "Loading…" : "No text available."}</div>
          )}
        </section>

        <section style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Bible Reading Plan</div>
            <button type="button" onClick={() => void loadPlan()} style={btn} disabled={planLoading}>
              {planLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {planErr ? <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 800 }}>{planErr}</div> : null}
          {plan?.week?.weekStartDate ? (
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Week of {plan.week.weekStartDate} → {plan.week.weekEndDate}
              {plan.week.title ? ` • ${plan.week.title}` : ""}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#64748b" }}>{planLoading ? "Loading plan…" : "No plan available for this week yet."}</div>
          )}

          {plan?.items?.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Today</div>
              <div style={{ display: "grid", gap: 6 }}>
                {plan.items
                  .filter((it) => it.dayDate === today)
                  .map((it) => {
                    const done = completedIds.has(it.id);
                    return (
                      <div key={it.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, background: done ? "#f0fdf4" : "white" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label ?? "Plan item"}</div>
                          {it.ref ? (
                            <button type="button" onClick={() => void load(String(it.ref))} style={{ marginTop: 4, padding: 0, border: "none", background: "transparent", color: "#2563eb", fontSize: 12, fontWeight: 800, cursor: "pointer", textAlign: "left" }}>
                              {String(it.ref)}
                            </button>
                          ) : null}
                        </div>
                        <button type="button" style={btn} disabled={done} onClick={() => void markComplete(it.id)} title={done ? "Completed" : "Mark complete"}>
                          {done ? "Done" : "Mark complete"}
                        </button>
                      </div>
                    );
                  })}
                {!plan.items.some((it) => it.dayDate === today) ? <div style={{ fontSize: 12, color: "#64748b" }}>No items scheduled for today.</div> : null}
              </div>

              <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a", marginTop: 6 }}>This week</div>
              <div style={{ display: "grid", gap: 6 }}>
                {plan.items.map((it) => {
                  const done = completedIds.has(it.id);
                  return (
                    <div key={it.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, background: done ? "#f0fdf4" : "white" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 900 }}>{it.dayDate}</div>
                          <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label ?? "Plan item"}</div>
                        </div>
                        {it.ref ? (
                          <button type="button" onClick={() => void load(String(it.ref))} style={{ marginTop: 4, padding: 0, border: "none", background: "transparent", color: "#2563eb", fontSize: 12, fontWeight: 800, cursor: "pointer", textAlign: "left" }}>
                            {String(it.ref)}
                          </button>
                        ) : null}
                      </div>
                      <button type="button" style={btn} disabled={done} onClick={() => void markComplete(it.id)} title={done ? "Completed" : "Mark complete"}>
                        {done ? "Done" : "Mark complete"}
                      </button>
                    </div>
                  );
                })}
              </div>

              {plan?.checkins?.length ? (
                <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Encouragement</div>
                  {plan.checkins.map((c) => (
                    <div key={c.id} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, background: "#f8fafc" }}>
                      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 900 }}>{String(c.createdAt).slice(0, 10)}{c.dayDate ? ` • ${c.dayDate}` : ""}</div>
                      <div style={{ marginTop: 4, fontSize: 13, color: "#0f172a", lineHeight: 1.5 }}>{c.message}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

