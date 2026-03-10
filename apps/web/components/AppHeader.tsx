"use client";

import { useEffect, useMemo, useState } from "react";
import { useDemoIdentity } from "./DemoIdentityProvider";
import { CalendarPanel } from "../app/chat/CalendarPanel";
import { MemoryManagerPanel } from "../app/chat/MemoryManagerPanel";
import { IdentityContactPanel } from "../app/chat/IdentityContactPanel";
import { FaithJourneyPanel } from "../app/chat/FaithJourneyPanel";
import { CommunityManagerPanel } from "../app/chat/CommunityManagerPanel";
import { GroupsPanel } from "../app/chat/GroupsPanel";
import { HouseholdManagerPanel } from "../app/chat/HouseholdManagerPanel";
import { CommPrefsPanel } from "../app/chat/CommPrefsPanel";
import { CarePastoralPanel } from "../app/chat/CarePastoralPanel";
import { TeamsSkillsPanel } from "../app/chat/TeamsSkillsPanel";

type Person = { first_name?: string | null; last_name?: string | null; id?: string | null } | null;
type JourneyGetStateResponse = {
  ok?: boolean;
  current_stage?: { id?: string | null; title?: string | null; summary?: string | null } | null;
  next_stage_id?: string | null;
  stage_path?: Array<{ id?: string | null; title?: string | null; summary?: string | null }> | null;
  confidence?: number;
  error?: string;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error((json as any)?.error ?? `Request failed (${res.status})`);
  return json;
}

export function AppHeader(props: { height?: number }) {
  const h = props.height ?? 56;

  const { identity, accounts, setIdentity } = useDemoIdentity();

  const [person, setPerson] = useState<Person>(null);
  const [headerToolId, setHeaderToolId] = useState<string | null>(null);
  const [headerToolBackId, setHeaderToolBackId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [personPickerOpen, setPersonPickerOpen] = useState(false);
  const [personQuery, setPersonQuery] = useState("");
  const [journeyByUserId, setJourneyByUserId] = useState<Record<string, { stageTitle: string; stageSummary: string; nextTitle: string; confidence?: number }>>({});
  const [journeyPendingByUserId, setJourneyPendingByUserId] = useState<Record<string, true>>({});
  const [journeyLoading, setJourneyLoading] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(Boolean(mq.matches));
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    postJson<{ person?: any }>("/api/a2a/thread/list", { identity, include_archived: false })
      .then((out) => setPerson((out?.person ?? null) as any))
      .catch(() => {});
  }, [identity]);

  // Close the upper-right menu on outside click / scroll / escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as any;
      const inMenu = t && typeof t.closest === "function" ? Boolean(t.closest("[data-appheader-menu]")) : false;
      if (!inMenu) setMenuOpen(false);
    };
    const onScroll = () => setMenuOpen(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!headerToolId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [headerToolId]);

  const label = useMemo(() => {
    const first = typeof (person as any)?.first_name === "string" ? String((person as any).first_name) : "";
    const last = typeof (person as any)?.last_name === "string" ? String((person as any).last_name) : "";
    const full = `${first} ${last}`.trim();
    return full || "Noah Seeker";
  }, [person]);

  const identityForTools = useMemo(
    () => ({
      tenant_id: identity.tenant_id,
      user_id: identity.user_id,
      role: identity.role,
      campus_id: identity.campus_id ?? null,
      timezone: identity.timezone ?? null,
      persona_id: (identity as any).persona_id ?? null,
    }),
    [identity],
  );

  async function loadJourneyForIdentity(who: any) {
    try {
      const out = await postJson<JourneyGetStateResponse>("/api/a2a/journey/get_state", { identity: who });
      if ((out as any)?.ok === false) throw new Error(String((out as any)?.error ?? "Failed"));
      const current = out?.current_stage ?? null;
      const stageTitle = String(current?.title ?? "").trim();
      const stageSummary = String(current?.summary ?? "").trim();
      const nextId = String(out?.next_stage_id ?? "").trim();
      const stagePath = Array.isArray(out?.stage_path) ? out!.stage_path! : [];
      const nextTitle = nextId ? String(stagePath.find((s) => String(s?.id ?? "") === nextId)?.title ?? "").trim() : "";
      return { stageTitle, stageSummary, nextTitle, confidence: typeof out?.confidence === "number" ? out.confidence : undefined };
    } catch {
      return { stageTitle: "", stageSummary: "", nextTitle: "" };
    }
  }

  // Prefetch journey stage summaries for the person picker (prefer visible results first).
  useEffect(() => {
    if (!personPickerOpen) return;
    let cancelled = false;
    setJourneyLoading(true);
    const q = String(personQuery || "").trim().toLowerCase();
    const ordered = (() => {
      if (!q) return accounts;
      const match: typeof accounts = [];
      const rest: typeof accounts = [];
      for (const a of accounts) {
        const hay = `${String(a.label || "").toLowerCase()} ${String((a as any)?.identity?.user_id ?? "").toLowerCase()}`.trim();
        (hay.includes(q) ? match : rest).push(a);
      }
      return [...match, ...rest];
    })();
    const todo = ordered.slice(0, 80);
    const max = 6;

    (async () => {
      const out: Record<string, { stageTitle: string; stageSummary: string; nextTitle: string; confidence?: number }> = {};
      let batchUids: string[] = [];
      try {
        const toFetch: Array<{ uid: string; identity: any }> = [];
        for (const a of todo) {
          const uid = String((a as any)?.identity?.user_id ?? "");
          if (!uid) continue;
          const cur = journeyByUserId[uid];
          if (cur && (cur.stageTitle || cur.stageSummary || cur.nextTitle)) continue;
          if (journeyPendingByUserId[uid]) continue;
          toFetch.push({ uid, identity: (a as any).identity });
        }

        batchUids = toFetch.map((x) => x.uid);
        if (batchUids.length) {
          setJourneyPendingByUserId((prev) => {
            const next = { ...prev };
            for (const uid of batchUids) next[uid] = true;
            return next;
          });
        }

        const queue = [...toFetch];
        const workers = Array.from({ length: Math.min(max, queue.length) }, () => null);
        await Promise.all(
          workers.map(async () => {
            while (queue.length) {
              const a = queue.shift();
              if (!a) break;
              const uid = String((a as any)?.uid ?? "");
              if (!uid) continue;
              const j = await loadJourneyForIdentity((a as any).identity);
              out[uid] = j;
            }
          }),
        );
        if (cancelled) return;
        if (Object.keys(out).length) setJourneyByUserId((prev) => ({ ...out, ...prev }));
      } finally {
        if (cancelled) return;
        if (batchUids.length) {
          setJourneyPendingByUserId((prev) => {
            const next = { ...prev };
            for (const uid of batchUids) delete (next as any)[uid];
            return next;
          });
        }
        setJourneyLoading(false);
      }
    })().catch(() => {});

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personPickerOpen, personQuery]);

  function openHeaderTool(toolId: string, backId: string | null) {
    setHeaderToolBackId(backId);
    setHeaderToolId(toolId);
  }

  function closeHeaderTool() {
    setHeaderToolId((cur) => {
      if (!cur) return null;
      return headerToolBackId ?? null;
    });
    setHeaderToolBackId((back) => (back ? null : back));
  }

  function renderHeaderTool() {
    if (!headerToolId) return null;
    if (headerToolId === "calendar") return <CalendarPanel identity={identityForTools as any} onClose={() => setHeaderToolId(null)} />;
    if (headerToolId === "memory_manager")
      return (
        <MemoryManagerPanel
          identity={identityForTools as any}
          onClose={() => {
            setHeaderToolId(null);
            setHeaderToolBackId(null);
          }}
          onOpenTool={(toolId: string) => openHeaderTool(toolId, "memory_manager")}
        />
      );
    if (headerToolId === "identity_contact") return <IdentityContactPanel identity={identityForTools as any} onClose={closeHeaderTool} />;
    if (headerToolId === "faith_journey") return <FaithJourneyPanel identity={identityForTools as any} onClose={closeHeaderTool} />;
    if (headerToolId === "community_manager") return <CommunityManagerPanel identity={identityForTools as any} onClose={closeHeaderTool} />;
    if (headerToolId === "groups_manager") return <GroupsPanel identity={identityForTools as any} onClose={closeHeaderTool} />;
    if (headerToolId === "household_manager") return <HouseholdManagerPanel identity={identityForTools as any} onClose={closeHeaderTool} />;
    if (headerToolId === "comm_prefs") return <CommPrefsPanel identity={identityForTools as any} onClose={closeHeaderTool} />;
    if (headerToolId === "care_pastoral") return <CarePastoralPanel identity={identityForTools as any} onClose={closeHeaderTool} />;
    if (headerToolId === "teams_skills") return <TeamsSkillsPanel identity={identityForTools as any} onClose={closeHeaderTool} />;
    return <div style={{ padding: 14 }}>Unknown tool: {headerToolId}</div>;
  }

  const pill: React.CSSProperties = {
    border: "1px solid #e2e8f0",
    background: "white",
    borderRadius: 999,
    padding: "6px 10px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 900,
    color: "#0f172a",
    lineHeight: 1,
  };

  const filteredAccounts = useMemo(() => {
    const q = String(personQuery || "").trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => String(a.label || "").toLowerCase().includes(q) || String((a as any)?.identity?.user_id ?? "").toLowerCase().includes(q));
  }, [accounts, personQuery]);

  function closeAllMenus() {
    setMenuOpen(false);
    setPersonPickerOpen(false);
  }

  return (
    <>
      <div
        style={{
          height: h,
          borderBottom: "1px solid #e2e8f0",
          background: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 14px",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <div style={{ fontWeight: 900 }}>Church Agent</div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {!isMobile ? (
            <>
              <button
                type="button"
                style={pill}
                onClick={() => {
                  setHeaderToolBackId(null);
                  setHeaderToolId("groups_manager");
                }}
              >
                My Groups
              </button>
              <button
                type="button"
                style={pill}
                onClick={() => {
                  setHeaderToolBackId(null);
                  setHeaderToolId("calendar");
                }}
              >
                My Calendar
              </button>
              <button
                type="button"
                style={pill}
                onClick={() => {
                  setHeaderToolBackId(null);
                  setHeaderToolId("memory_manager");
                }}
              >
                Me
              </button>
            </>
          ) : null}

          <div style={{ position: "relative" }} data-appheader-menu>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              style={{ ...pill, fontWeight: 800, display: "inline-flex", alignItems: "baseline", gap: 8 }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span>{label}</span>
              <span style={{ color: "#64748b", fontWeight: 600, fontSize: 12 }}>({identity.role})</span>
            </button>
            {menuOpen && !isMobile ? (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  marginTop: 10,
                  width: 260,
                  border: "1px solid #e2e8f0",
                  background: "white",
                  borderRadius: 12,
                  padding: 10,
                  display: "grid",
                  gap: 10,
                  zIndex: 60,
                  boxShadow: "0 18px 50px rgba(15, 23, 42, 0.18)",
                }}
                role="menu"
              >
                <a href="/chat" style={{ fontSize: 14 }} onClick={() => setMenuOpen(false)}>
                  Chat
                </a>
                <a href="/calendar" style={{ fontSize: 14 }} onClick={() => setMenuOpen(false)}>
                  Calendar
                </a>
                <a href="/checkin" style={{ fontSize: 14 }} onClick={() => setMenuOpen(false)}>
                  Kids check-in
                </a>
                <a href="/guide" style={{ fontSize: 14 }} onClick={() => setMenuOpen(false)}>
                  Guide
                </a>
                <a href="/agent-card" style={{ fontSize: 14 }} onClick={() => setMenuOpen(false)}>
                  Agent card
                </a>

                {isMobile ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setHeaderToolBackId(null);
                        setHeaderToolId("groups_manager");
                      }}
                      style={{ ...pill, borderRadius: 12, width: "100%", textAlign: "left", padding: "10px 10px" }}
                    >
                      My Groups
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setHeaderToolBackId(null);
                        setHeaderToolId("calendar");
                      }}
                      style={{ ...pill, borderRadius: 12, width: "100%", textAlign: "left", padding: "10px 10px" }}
                    >
                      My Calendar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setHeaderToolBackId(null);
                        setHeaderToolId("memory_manager");
                      }}
                      style={{ ...pill, borderRadius: 12, width: "100%", textAlign: "left", padding: "10px 10px" }}
                    >
                      Me
                    </button>
                  </>
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setPersonPickerOpen(true);
                    setPersonQuery("");
                  }}
                  style={{ ...pill, borderRadius: 12, width: "100%", textAlign: "left", padding: "10px 10px" }}
                >
                  Switch person…
                </button>

                <div style={{ fontSize: 12, color: "#64748b" }}>
                  churchId={identity.tenant_id}
                  <br />
                  userId={identity.user_id}
                  <br />
                  personId={(person as any)?.id ?? (identity as any)?.persona_id ?? ""}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {menuOpen && isMobile ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            background: "rgba(15, 23, 42, 0.45)",
            display: "grid",
            alignItems: "end",
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMenuOpen(false);
          }}
        >
          <div
            style={{
              background: "white",
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              borderTop: "1px solid #e2e8f0",
              padding: 14,
              paddingBottom: 18,
              boxShadow: "0 -18px 60px rgba(15, 23, 42, 0.25)",
              maxHeight: "88dvh",
              overflow: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <div style={{ fontWeight: 900, fontSize: 14, color: "#0f172a" }}>{label}</div>
              <button type="button" onClick={() => setMenuOpen(false)} style={pill}>
                Close
              </button>
            </div>
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <a href="/chat" style={{ ...pill, borderRadius: 12, textDecoration: "none", padding: "12px 12px" }} onClick={() => setMenuOpen(false)}>
                Chat
              </a>
              <a href="/checkin" style={{ ...pill, borderRadius: 12, textDecoration: "none", padding: "12px 12px" }} onClick={() => setMenuOpen(false)}>
                Kids check-in
              </a>

              <div style={{ height: 1, background: "#e2e8f0", margin: "6px 0" }} />

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setPersonPickerOpen(true);
                  setPersonQuery("");
                }}
                style={{ ...pill, borderRadius: 12, width: "100%", textAlign: "left", padding: "12px 12px" }}
              >
                Switch person…
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {personPickerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            // Keep above the mobile bottom-sheet menu.
            zIndex: 120,
            background: "rgba(15, 23, 42, 0.45)",
            display: "grid",
            placeItems: "center",
            padding: 12,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAllMenus();
          }}
        >
          <div
            style={{
              width: "min(760px, 96vw)",
              height: "min(78vh, 760px)",
              background: "white",
              borderRadius: 16,
              overflow: "hidden",
              border: "1px solid #e2e8f0",
              boxShadow: "0 24px 80px rgba(15, 23, 42, 0.35)",
              display: "grid",
              gridTemplateRows: "auto auto 1fr",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 900 }}>Switch person</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Search by name. Shows current journey stage.</div>
              </div>
              <button type="button" onClick={() => closeAllMenus()} style={pill}>
                Close
              </button>
            </div>
            <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", display: "flex", gap: 10, alignItems: "center" }}>
              <input
                value={personQuery}
                onChange={(e) => setPersonQuery(e.target.value)}
                placeholder="Search people…"
                autoFocus
                style={{ flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 12, border: "1px solid #e2e8f0", fontWeight: 800 }}
              />
              <div style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>
                {journeyLoading ? "Loading stages…" : `${filteredAccounts.length} people`}
              </div>
            </div>
            <div style={{ padding: 14, overflow: "auto", background: "#f8fafc", display: "grid", gap: 10, alignContent: "start" }}>
              {filteredAccounts.slice(0, 80).map((a) => {
                const uid = String((a as any)?.identity?.user_id ?? "");
                const isActive = uid && uid === String(identity.user_id);
                const pending = uid ? Boolean(journeyPendingByUserId[uid]) : false;
                const j = uid ? journeyByUserId[uid] : undefined;
                const loadingRow = pending || (journeyLoading && !j);
                const stageTitle = String(j?.stageTitle ?? "").trim();
                const stageSummary = String(j?.stageSummary ?? "").trim();
                const nextTitle = String(j?.nextTitle ?? "").trim();
                const summaryShort = stageSummary.length > 110 ? `${stageSummary.slice(0, 110).trim()}…` : stageSummary;
                return (
                  <button
                    key={uid || a.label}
                    type="button"
                    onClick={() => {
                      setIdentity((a as any).identity);
                      closeAllMenus();
                    }}
                    style={{
                      textAlign: "left",
                      border: "1px solid #e2e8f0",
                      background: isActive ? "#eef2ff" : "white",
                      borderRadius: 14,
                      padding: 12,
                      cursor: "pointer",
                      display: "grid",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>{a.label}</div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>{isActive ? "current" : ""}</div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>
                        {loadingRow ? "Stage: Loading…" : stageTitle ? `Stage: ${stageTitle}` : "Stage: —"}
                      </div>
                      {!loadingRow && nextTitle ? <div style={{ fontSize: 12, color: "#475569" }}>Next: {nextTitle}</div> : null}
                      {typeof j?.confidence === "number" ? <div style={{ fontSize: 12, color: "#64748b" }}>conf {j.confidence.toFixed(2)}</div> : null}
                    </div>
                    {loadingRow ? (
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>Loading journey summary…</div>
                    ) : summaryShort ? (
                      <div style={{ fontSize: 12, color: "#475569" }}>{summaryShort}</div>
                    ) : (
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>No stage summary.</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {headerToolId ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(15, 23, 42, 0.35)",
            display: "grid",
            placeItems: "center",
            padding: 12,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setHeaderToolId(null);
          }}
        >
          <div
            style={{
              width: "min(1100px, 96vw)",
              height: "min(820px, 92vh)",
              background: "white",
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 20px 60px rgba(15, 23, 42, 0.35)",
            }}
          >
            {renderHeaderTool()}
          </div>
        </div>
      ) : null}
    </>
  );
}

