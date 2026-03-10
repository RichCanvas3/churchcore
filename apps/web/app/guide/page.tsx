"use client";

import { useEffect, useMemo, useState } from "react";
import type { OutputEnvelope } from "../../lib/types";
import { CardsRenderer } from "../../components/CardsRenderer";
import { NextActionsRenderer } from "../../components/NextActionsRenderer";
import { FormsRenderer } from "../../components/FormsRenderer";
import { HandoffRenderer } from "../../components/HandoffRenderer";
import { useDemoIdentity } from "../../components/DemoIdentityProvider";

async function postJson<T = any>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json as T;
}

export default function GuidePage() {
  const { identity } = useDemoIdentity();
  const [message, setMessage] = useState<string>("");
  const [output, setOutput] = useState<OutputEnvelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [runAsGuide, setRunAsGuide] = useState(true);
  const [uiError, setUiError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(Boolean(mq.matches));
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const effectiveRole = useMemo(() => (runAsGuide ? "guide" : identity.role), [identity.role, runAsGuide]);

  useEffect(() => {
    setThreadId(null);
    setOutput(null);
    setUiError(null);
  }, [identity.user_id]);

  async function ensureThread(): Promise<string> {
    if (threadId) return threadId;
    const created = await postJson<{ thread_id: string; title?: string }>("/api/a2a/thread/create", {
      identity: {
        tenant_id: identity.tenant_id,
        user_id: identity.user_id,
        role: effectiveRole,
        campus_id: identity.campus_id ?? undefined,
        timezone: identity.timezone ?? undefined,
        persona_id: (identity as any).persona_id ?? undefined,
      },
      title: "Guide console",
      metadata: { surface: "guide" },
    });
    setThreadId(created.thread_id);
    return created.thread_id;
  }

  async function callSkill(skill: string, args?: Record<string, unknown>, msg?: string) {
    setLoading(true);
    setUiError(null);
    try {
      const tid = await ensureThread();
      const json = await postJson<{ thread_id: string; output: OutputEnvelope }>("/api/a2a/chat", {
        identity: {
          tenant_id: identity.tenant_id,
          user_id: identity.user_id,
          role: effectiveRole,
          campus_id: identity.campus_id ?? undefined,
          timezone: identity.timezone ?? undefined,
          persona_id: (identity as any).persona_id ?? undefined,
        },
        thread_id: tid,
        message: String(msg ?? "").trim(),
        skill,
        args: args ?? null,
      });
      setOutput((json as any)?.output ?? null);
    } catch (e: any) {
      setUiError(String(e?.message ?? e ?? "Request failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ height: "100%", minHeight: 0, overflow: "auto", background: "#f8fafc" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: 16, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: isMobile ? "flex-start" : "baseline", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Guide Console</div>
            <div style={{ color: "#475569" }}>All requests go through the A2A gateway.</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {!isMobile ? (
              <a href="/chat" style={{ fontSize: 12 }}>
                Back to Seeker Chat
              </a>
            ) : null}
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#475569" }}>Run as guide</span>
              <input
                type="checkbox"
                checked={runAsGuide}
                onChange={(e) => setRunAsGuide(e.target.checked)}
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
          <div style={{ display: "flex", gap: 10, flexDirection: isMobile ? "column" : "row" }}>
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
              onClick={() => callSkill("chat", undefined, message)}
              disabled={loading || !message.trim()}
              style={{
                border: "1px solid #0f172a",
                background: "#0f172a",
                color: "white",
                padding: "10px 12px",
                borderRadius: 10,
                cursor: "pointer",
                opacity: loading ? 0.7 : 1,
                width: isMobile ? "100%" : undefined,
              }}
            >
              Send
            </button>
          </div>
          {uiError ? <div style={{ color: "#b91c1c", fontSize: 12 }}>{uiError}</div> : null}
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

