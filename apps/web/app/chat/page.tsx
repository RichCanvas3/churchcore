"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { OutputEnvelope, Session } from "../../lib/types";
import { CardsRenderer } from "../../components/CardsRenderer";
import { FormsRenderer } from "../../components/FormsRenderer";
import { HandoffRenderer } from "../../components/HandoffRenderer";

function defaultSession(): Session {
  return {
    churchId: "demo-church",
    campusId: "campus_main",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    // App user identity (separate from personId). Seeded in D1.
    userId: "demo_user_noah",
    personId: "p_seeker_2",
    role: "seeker",
    auth: { isAuthenticated: false, roles: [] },
    threadId: null,
  };
}

type Thread = {
  id: string;
  title: string;
  status: "active" | "archived" | string;
  updatedAt?: string;
};

type ChatMessage = {
  id: string;
  senderType: "user" | "assistant" | "system" | string;
  content: string;
  createdAt?: string;
  envelope?: OutputEnvelope | null;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return json;
}

export default function ChatPage() {
  const [session, setSession] = useState<Session>(() => defaultSession());
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composer, setComposer] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [lastEnvelope, setLastEnvelope] = useState<OutputEnvelope | null>(null);
  const [mePerson, setMePerson] = useState<Record<string, unknown> | null>(null);

  const [renameThreadId, setRenameThreadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const meLabel = useMemo(() => {
    const first = typeof (mePerson as any)?.first_name === "string" ? String((mePerson as any).first_name) : "";
    const last = typeof (mePerson as any)?.last_name === "string" ? String((mePerson as any).last_name) : "";
    const full = `${first} ${last}`.trim();
    if (full) return full;
    if (session.personId === "p_seeker_2") return "Noah Seeker";
    return session.personId ? `Person ${session.personId}` : "Seeker";
  }, [mePerson, session.personId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, activeThreadId]);

  async function refreshThreads() {
    const out = await postJson<{ threads?: Thread[]; person?: any }>("/api/a2a/thread/list", {
      identity: {
        tenant_id: session.churchId,
        user_id: session.userId,
        role: session.role,
        campus_id: session.campusId ?? undefined,
        timezone: session.timezone,
        persona_id: session.personId ?? undefined,
      },
      include_archived: false,
    });

    if (out?.person && typeof out.person === "object") {
      setMePerson(out.person);
      const pid = typeof out.person?.id === "string" ? String(out.person.id) : null;
      if (pid) setSession((s) => ({ ...s, personId: pid }));
    }

    const nextThreads = Array.isArray(out?.threads) ? out.threads : [];
    setThreads(nextThreads);
    if (!activeThreadId && nextThreads.length) {
      setActiveThreadId(String(nextThreads[0].id));
    }
  }

  async function loadThread(threadId: string) {
    const out = await postJson<{ messages?: ChatMessage[]; thread?: { id: string; title: string }; person?: any }>(
      "/api/a2a/thread/get",
      {
        identity: {
          tenant_id: session.churchId,
          user_id: session.userId,
          role: session.role,
          campus_id: session.campusId ?? undefined,
          timezone: session.timezone,
          persona_id: session.personId ?? undefined,
        },
        thread_id: threadId,
        limit: 200,
        offset: 0,
      },
    );
    const next = Array.isArray(out?.messages) ? out.messages : [];
    setMessages(next);

    if (out?.person && typeof out.person === "object") {
      setMePerson(out.person);
      const pid = typeof out.person?.id === "string" ? String(out.person.id) : null;
      if (pid) setSession((s) => ({ ...s, personId: pid }));
    }
  }

  useEffect(() => {
    refreshThreads().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeThreadId) return;
    setSession((s) => ({ ...s, threadId: activeThreadId }));
    loadThread(activeThreadId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  async function createThread() {
    const out = await postJson<{ thread_id?: string; title?: string }>("/api/a2a/thread/create", {
      identity: {
        tenant_id: session.churchId,
        user_id: session.userId,
        role: session.role,
        campus_id: session.campusId ?? undefined,
        timezone: session.timezone,
        persona_id: session.personId ?? undefined,
      },
      title: "New topic",
    });
    await refreshThreads();
    if (out?.thread_id) setActiveThreadId(String(out.thread_id));
  }

  async function archiveThread(threadId: string) {
    await postJson("/api/a2a/thread/archive", {
      identity: {
        tenant_id: session.churchId,
        user_id: session.userId,
        role: session.role,
        campus_id: session.campusId ?? undefined,
        timezone: session.timezone,
        persona_id: session.personId ?? undefined,
      },
      thread_id: threadId,
    });
    setMessages([]);
    setLastEnvelope(null);
    setActiveThreadId(null);
    await refreshThreads();
  }

  async function renameThread(threadId: string, title: string) {
    await postJson("/api/a2a/thread/rename", {
      identity: {
        tenant_id: session.churchId,
        user_id: session.userId,
        role: session.role,
        campus_id: session.campusId ?? undefined,
        timezone: session.timezone,
        persona_id: session.personId ?? undefined,
      },
      thread_id: threadId,
      title,
    });
    setRenameThreadId(null);
    setRenameValue("");
    await refreshThreads();
  }

  async function sendMessage() {
    const threadId = activeThreadId;
    const text = composer.trim();
    if (!threadId || !text) return;

    setSending(true);
    setComposer("");

    const optimisticId = `local_${Date.now()}`;
    setMessages((m) => [...m, { id: optimisticId, senderType: "user", content: text, createdAt: new Date().toISOString() }]);

    try {
      const out = await postJson<{ output?: OutputEnvelope }>("/api/a2a/chat", {
        identity: {
          tenant_id: session.churchId,
          user_id: session.userId,
          role: session.role,
          campus_id: session.campusId ?? undefined,
          timezone: session.timezone,
          persona_id: session.personId ?? undefined,
        },
        thread_id: threadId,
        message: text,
        skill: "chat",
        args: null,
      });

      const envelope = (out?.output ?? null) as OutputEnvelope | null;
      if (envelope) setLastEnvelope(envelope);

      // Reload from D1 (source of truth)
      await loadThread(threadId);
      await refreshThreads();
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ height: "100vh", background: "#f8fafc", display: "grid", gridTemplateColumns: "320px 1fr" }}>
      {/* Sidebar */}
      <div style={{ borderRight: "1px solid #e2e8f0", background: "white", display: "grid", gridTemplateRows: "auto 1fr auto" }}>
        <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>Messages</div>
          <div style={{ color: "#64748b", fontSize: 12 }}>{meLabel}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={() => createThread()}
              style={{ border: "1px solid #0f172a", background: "#0f172a", color: "white", padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              New topic
            </button>
          </div>
        </div>

        <div style={{ overflow: "auto" }}>
          {threads.length ? (
            <div style={{ padding: 10, display: "grid", gap: 6 }}>
              {threads.map((t) => {
                const isActive = t.id === activeThreadId;
                const isRenaming = renameThreadId === t.id;
                return (
                  <div
                    key={t.id}
                    style={{
                      border: isActive ? "1px solid #0f172a" : "1px solid #e2e8f0",
                      borderRadius: 12,
                      padding: 10,
                      background: isActive ? "#f1f5f9" : "white",
                      cursor: "pointer",
                      display: "grid",
                      gap: 8,
                    }}
                    onClick={() => setActiveThreadId(t.id)}
                  >
                    {isRenaming ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          style={{ flex: 1, border: "1px solid #cbd5e1", borderRadius: 10, padding: "6px 8px" }}
                          autoFocus
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            renameThread(t.id, renameValue.trim() || t.title);
                          }}
                          style={{ border: "1px solid #0f172a", background: "#0f172a", color: "white", borderRadius: 10, padding: "6px 8px" }}
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <div style={{ fontWeight: 800 }}>{t.title}</div>
                    )}
                    {!isRenaming ? (
                      <div style={{ display: "flex", gap: 10 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenameThreadId(t.id);
                            setRenameValue(t.title);
                          }}
                          style={{ border: "1px solid #cbd5e1", background: "white", borderRadius: 10, padding: "6px 8px", cursor: "pointer", fontSize: 12 }}
                        >
                          Rename
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            archiveThread(t.id);
                          }}
                          style={{ border: "1px solid #fee2e2", background: "#fff1f2", borderRadius: 10, padding: "6px 8px", cursor: "pointer", fontSize: 12 }}
                        >
                          Archive
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: 14, color: "#64748b" }}>No topics yet.</div>
          )}
        </div>

        <div style={{ padding: 12, borderTop: "1px solid #e2e8f0", fontSize: 12, color: "#64748b" }}>
          churchId={session.churchId} userId={session.userId}
        </div>
      </div>

      {/* Conversation */}
      <div style={{ display: "grid", gridTemplateRows: "auto 1fr auto" }}>
        <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", background: "white" }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>
            {threads.find((t) => t.id === activeThreadId)?.title ?? "Select a topic"}
          </div>
          <div style={{ color: "#64748b", fontSize: 12 }}>Single deployed agent; messages persisted in D1.</div>
        </div>

        <div style={{ overflow: "auto", padding: 16, display: "grid", gap: 10 }}>
          {messages.map((m) => {
            const isUser = m.senderType === "user";
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
                <div
                  style={{
                    maxWidth: 760,
                    border: "1px solid " + (isUser ? "#0f172a" : "#e2e8f0"),
                    background: isUser ? "#0f172a" : "white",
                    color: isUser ? "white" : "#0f172a",
                    borderRadius: 14,
                    padding: "10px 12px",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.content}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <div style={{ padding: 14, borderTop: "1px solid #e2e8f0", background: "white", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder={activeThreadId ? "Message Church Agent…" : "Select a topic first…"}
              disabled={!activeThreadId || sending}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              style={{ flex: 1, border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px" }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!activeThreadId || sending || !composer.trim()}
              style={{
                border: "1px solid #0f172a",
                background: "#0f172a",
                color: "white",
                padding: "10px 12px",
                borderRadius: 12,
                cursor: "pointer",
                opacity: sending ? 0.7 : 1,
              }}
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>

          {lastEnvelope ? (
            <div style={{ display: "grid", gap: 10 }}>
              <HandoffRenderer handoff={lastEnvelope.handoff ?? []} />
              <CardsRenderer cards={lastEnvelope.cards ?? []} />
              <FormsRenderer forms={lastEnvelope.forms ?? []} />
              <details>
                <summary style={{ cursor: "pointer" }}>Latest envelope</summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(lastEnvelope, null, 2)}</pre>
              </details>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

