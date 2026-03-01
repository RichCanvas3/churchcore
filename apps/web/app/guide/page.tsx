/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useMemo, useState } from "react";
import type { OutputEnvelope, Session } from "../../lib/types";
import { CardsRenderer } from "../../components/CardsRenderer";
import { NextActionsRenderer } from "../../components/NextActionsRenderer";
import { FormsRenderer } from "../../components/FormsRenderer";
import { HandoffRenderer } from "../../components/HandoffRenderer";

function defaultSession(): Session {
  return {
    churchId: "demo-church",
    campusId: null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    userId: "local-guide",
    role: "guide",
    auth: { isAuthenticated: true, roles: ["guide"] },
    threadId: null,
  };
}

export default function GuidePage() {
  const [session, setSession] = useState<Session>(() => defaultSession());
  const [message, setMessage] = useState<string>("");
  const [output, setOutput] = useState<OutputEnvelope | null>(null);
  const [loading, setLoading] = useState(false);

  const authOk = useMemo(() => !!session.auth?.isAuthenticated, [session.auth]);

  async function callSkill(skill: string, args?: Record<string, unknown>, msg?: string) {
    setLoading(true);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skill, message: msg ?? null, args: args ?? null, session }),
      });
      const json = (await res.json().catch(() => ({}))) as any;
      setOutput(json as OutputEnvelope);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: 16, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Guide Console</div>
            <div style={{ color: "#475569" }}>Permission-protected skills. Uses the same deployed agent.</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <a href="/chat" style={{ fontSize: 12 }}>
              Back to Seeker Chat
            </a>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#475569" }}>Authenticated</span>
              <input
                type="checkbox"
                checked={authOk}
                onChange={(e) =>
                  setSession((s) => ({
                    ...s,
                    auth: e.target.checked ? { isAuthenticated: true, roles: ["guide"] } : { isAuthenticated: false, roles: [] },
                  }))
                }
              />
            </label>
          </div>
        </div>

        <div
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            padding: 12,
            background: "white",
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", gap: 10 }}>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask or type a guide command…"
              style={{
                flex: 1,
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                padding: "10px 12px",
              }}
            />
            <button
              onClick={() => callSkill("chat", null, message)}
              disabled={loading || !message.trim()}
              style={{
                border: "1px solid #0f172a",
                background: "#0f172a",
                color: "white",
                padding: "10px 12px",
                borderRadius: 10,
                cursor: "pointer",
                opacity: loading ? 0.7 : 1,
              }}
            >
              Send
            </button>
          </div>
          <NextActionsRenderer
            actions={[
              { title: "View assigned seekers", skill: "guide.view_assigned_seekers" },
              { title: "View care requests", skill: "care.view_requests" },
              { title: "Permissions check", skill: "profile.permissions_check" },
            ]}
            onAction={callSkill}
          />
        </div>

        {output ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{output.message}</div>
            <HandoffRenderer handoff={output.handoff ?? []} />
            <CardsRenderer cards={output.cards ?? []} />
            <FormsRenderer forms={output.forms ?? []} />
            <details>
              <summary style={{ cursor: "pointer" }}>Debug data</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(output, null, 2)}</pre>
            </details>
          </div>
        ) : (
          <div style={{ color: "#475569" }}>Try “View assigned seekers”.</div>
        )}
      </div>
    </div>
  );
}

