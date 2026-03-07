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

  useEffect(() => {
    postJson<{ person?: any }>("/api/a2a/thread/list", { identity, include_archived: false })
      .then((out) => setPerson((out?.person ?? null) as any))
      .catch(() => {});
  }, [identity]);

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

          <details>
            <summary style={{ cursor: "pointer", listStyle: "none", fontWeight: 800 }}>
              {label} <span style={{ color: "#64748b", fontWeight: 600, fontSize: 12 }}>({identity.role})</span>
            </summary>
            <div
              style={{
                position: "absolute",
                right: 14,
                marginTop: 10,
                width: 240,
                border: "1px solid #e2e8f0",
                background: "white",
                borderRadius: 12,
                padding: 10,
                display: "grid",
                gap: 10,
              }}
            >
              <a href="/chat" style={{ fontSize: 14 }}>
                Chat
              </a>
              <a href="/calendar" style={{ fontSize: 14 }}>
                Calendar
              </a>
              <a href="/checkin" style={{ fontSize: 14 }}>
                Kids check-in
              </a>
              <a href="/guide" style={{ fontSize: 14 }}>
                Guide
              </a>
              <a href="/agent-card" style={{ fontSize: 14 }}>
                Agent card
              </a>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, color: "#64748b" }}>Switch account</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {accounts.map((a) => (
                    <button
                      key={a.identity.user_id}
                      onClick={() => setIdentity(a.identity)}
                      style={{
                        textAlign: "left",
                        border: "1px solid #e2e8f0",
                        background: a.identity.user_id === identity.user_id ? "#f1f5f9" : "white",
                        borderRadius: 10,
                        padding: "8px 10px",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                churchId={identity.tenant_id}
                <br />
                userId={identity.user_id}
                <br />
                personId={(person as any)?.id ?? "p_seeker_2"}
              </div>
            </div>
          </details>
        </div>
      </div>

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

