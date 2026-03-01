"use client";

import { useEffect, useMemo, useState } from "react";
import { ComposerPrimitive, MessagePrimitive, ThreadPrimitive } from "@assistant-ui/react";
import type { Session } from "../../lib/types";
import { A2AChatRuntime } from "./A2AChatRuntime";
import { useDemoIdentity } from "../../components/DemoIdentityProvider";

type ThreadMeta = { id: string; title: string; status: string; updatedAt?: string; createdAt?: string };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error((json as any)?.error ?? `Request failed (${res.status})`);
  return json;
}

function parseD1Date(value: unknown): Date {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return new Date();
  // D1 often returns "YYYY-MM-DD HH:mm:ss" (no timezone). Treat as UTC for stability.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    const d = new Date(`${s.replace(" ", "T")}Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function TextPart(props: any) {
  const text = typeof props?.text === "string" ? props.text : "";
  return <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>;
}

function UserMessage() {
  return (
    <MessagePrimitive.Root>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ maxWidth: 760, background: "#0f172a", color: "white", borderRadius: 14, padding: "10px 12px" }}>
          <MessagePrimitive.Parts components={{ Text: TextPart } as any} />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root>
      <div style={{ display: "flex", justifyContent: "flex-start" }}>
        <div style={{ maxWidth: 760, background: "white", color: "#0f172a", border: "1px solid #e2e8f0", borderRadius: 14, padding: "10px 12px" }}>
          <MessagePrimitive.Parts components={{ Text: TextPart } as any} />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
      <ComposerPrimitive.Input
        placeholder="Message Church Agent…"
        style={{ flex: 1, border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px" }}
      />
      <ComposerPrimitive.Send
        style={{ border: "1px solid #0f172a", background: "#0f172a", color: "white", padding: "10px 12px", borderRadius: 12, cursor: "pointer" }}
      >
        Send
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}

export default function ChatPage() {
  const { identity } = useDemoIdentity();
  const [session, setSession] = useState<Session>(() => ({
    churchId: identity.tenant_id,
    campusId: identity.campus_id ?? "campus_main",
    timezone: identity.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
    userId: identity.user_id,
    personId: null,
    role: "seeker",
    auth: { isAuthenticated: false, roles: [] },
    threadId: null,
  }));
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [mePerson, setMePerson] = useState<Record<string, unknown> | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [renaming, setRenaming] = useState(false);

  const meLabel = useMemo(() => {
    const first = typeof (mePerson as any)?.first_name === "string" ? String((mePerson as any).first_name) : "";
    const last = typeof (mePerson as any)?.last_name === "string" ? String((mePerson as any).last_name) : "";
    const full = `${first} ${last}`.trim();
    if (full) return full;
    if (session.personId === "p_seeker_2") return "Noah Seeker";
    return session.personId ? `Person ${session.personId}` : "Seeker";
  }, [mePerson, session.personId]);

  async function refreshThreads() {
    const out = await postJson<{ threads?: ThreadMeta[]; person?: any }>("/api/a2a/thread/list", {
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

    if (out?.person && typeof out.person === "object") setMePerson(out.person);
    const next = Array.isArray(out?.threads) ? out.threads : [];
    setThreads(next);
    if (!activeThreadId && next.length) setActiveThreadId(String(next[0].id));
  }

  useEffect(() => {
    setSession({
      churchId: identity.tenant_id,
      campusId: identity.campus_id ?? "campus_main",
      timezone: identity.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
      userId: identity.user_id,
      personId: null,
      role: "seeker",
      auth: { isAuthenticated: false, roles: [] },
      threadId: null,
    });
    setThreads([]);
    setActiveThreadId(null);
    setMePerson(null);
    refreshThreads().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.user_id]);

  async function createThread() {
    const out = await postJson<{ thread_id?: string }>("/api/a2a/thread/create", {
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
    setActiveThreadId(null);
    await refreshThreads();
  }

  async function renameThread(threadId: string, nextTitle: string) {
    const title = String(nextTitle ?? "").trim();
    if (!title) return;
    setRenaming(true);
    try {
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
      setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, title } : t)));
      await refreshThreads();
    } finally {
      setRenaming(false);
      setEditingThreadId(null);
      setEditingTitle("");
    }
  }

  const historyAdapter = useMemo(() => {
    const threadId = activeThreadId;
    return {
      async load() {
        if (!threadId) return { headId: null, messages: [] };
        const out = await postJson<{ messages?: any[] }>("/api/a2a/thread/get", {
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
        });

        const rows = (Array.isArray(out?.messages) ? out.messages : []).filter(Boolean);
        const likes = rows
          .map((m: any) => {
            const role = m?.senderType === "user" ? "user" : m?.senderType === "system" ? "system" : "assistant";
            const text = String(m?.content ?? "");
            if (!text.trim()) return null; // avoid invalid/empty messages causing importer issues

            return {
              id: String(m?.id ?? crypto.randomUUID()),
              role,
              // ThreadHistoryAdapter expects ThreadMessageLike, not already-parsed parts.
              content: text,
              createdAt: parseD1Date(m?.createdAt),
            };
          })
          .filter(Boolean);

        function toThreadMessage(like: any) {
          const id = typeof like?.id === "string" && like.id ? like.id : crypto.randomUUID();
          const role = like?.role === "user" || like?.role === "system" ? like.role : "assistant";
          const createdAt = like?.createdAt instanceof Date && !Number.isNaN(like.createdAt.getTime()) ? like.createdAt : new Date();
          const text = typeof like?.content === "string" ? like.content : "";

          if (role === "user") {
            return {
              id,
              role,
              createdAt,
              content: [{ type: "text", text }],
              attachments: [],
              metadata: { custom: {} },
            };
          }

          if (role === "system") {
            return {
              id,
              role,
              createdAt,
              content: [{ type: "text", text }],
              metadata: { custom: {} },
            };
          }

          return {
            id,
            role: "assistant",
            createdAt,
            content: [{ type: "text", text }],
            status: { type: "complete", reason: "stop" },
            metadata: {
              unstable_state: null,
              unstable_annotations: [],
              unstable_data: [],
              steps: [],
              custom: {},
            },
          };
        }

        let parentId: string | null = null;
        const exported = {
          headId: null as string | null,
          messages: [] as Array<{ message: any; parentId: string | null }>,
        };

        for (const like of likes as any[]) {
          const message = toThreadMessage(like);
          exported.messages.push({ parentId, message });
          parentId = message.id;
          exported.headId = parentId;
        }

        return exported;
      },
      async append(_item: any) {
        // no-op: A2A gateway persists transcript in D1.
      },
    };
  }, [activeThreadId, session]);

  return (
    <div style={{ height: "100%", background: "#f8fafc", display: "grid", gridTemplateColumns: "320px 1fr", overflow: "hidden" }}>
      <div
        style={{
          borderRight: "1px solid #e2e8f0",
          background: "white",
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
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

        <div style={{ overflow: "auto", minHeight: 0 }}>
          {threads.length ? (
            <div style={{ padding: 10, display: "grid", gap: 6 }}>
              {threads.map((t) => {
                const isActive = t.id === activeThreadId;
                const isEditing = t.id === editingThreadId;
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
                    {isEditing ? (
                      <input
                        value={editingTitle}
                        autoFocus
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setEditingThreadId(null);
                            setEditingTitle("");
                          }
                          if (e.key === "Enter") {
                            e.preventDefault();
                            renameThread(t.id, editingTitle).catch(() => {});
                          }
                        }}
                        style={{
                          width: "100%",
                          border: "1px solid #cbd5e1",
                          borderRadius: 10,
                          padding: "8px 10px",
                          fontWeight: 800,
                        }}
                        placeholder="Topic name"
                      />
                    ) : (
                      <div style={{ fontWeight: 800 }}>{t.title}</div>
                    )}
                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingThreadId(t.id);
                          setEditingTitle(t.title);
                        }}
                        style={{
                          border: "1px solid #e2e8f0",
                          background: "white",
                          borderRadius: 10,
                          padding: "6px 8px",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        Rename
                      </button>

                      {isEditing ? (
                        <button
                          disabled={renaming}
                          onClick={(e) => {
                            e.stopPropagation();
                            renameThread(t.id, editingTitle).catch(() => {});
                          }}
                          style={{
                            border: "1px solid #0f172a",
                            background: renaming ? "#334155" : "#0f172a",
                            color: "white",
                            borderRadius: 10,
                            padding: "6px 8px",
                            cursor: renaming ? "not-allowed" : "pointer",
                            fontSize: 12,
                          }}
                        >
                          Save
                        </button>
                      ) : null}

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

      <div style={{ display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0, overflow: "hidden" }}>
        <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", background: "white" }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>{threads.find((t) => t.id === activeThreadId)?.title ?? "Select a topic"}</div>
          <div style={{ color: "#64748b", fontSize: 12 }}>A2A threads/messages in D1; streaming tokens.</div>
        </div>

        {activeThreadId ? (
          <A2AChatRuntime
            key={activeThreadId}
            session={session}
            threadId={activeThreadId}
            historyAdapter={historyAdapter}
            onFinalEnvelope={(env) => {
              setSending(false);
              refreshThreads().catch(() => {});
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
              <ThreadPrimitive.Root style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                <ThreadPrimitive.Viewport
                  autoScroll
                  scrollToBottomOnInitialize
                  scrollToBottomOnRunStart
                  scrollToBottomOnThreadSwitch
                  style={{ flex: 1, overflow: "auto", padding: 16, display: "grid", gap: 10, minHeight: 0 }}
                >
                  <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage } as any} />
                </ThreadPrimitive.Viewport>

                <ThreadPrimitive.ScrollToBottom style={{ alignSelf: "center" }}>Scroll to bottom</ThreadPrimitive.ScrollToBottom>
              </ThreadPrimitive.Root>

              <div style={{ padding: 14, borderTop: "1px solid #e2e8f0", background: "white", display: "grid", gap: 10 }}>
                {sending ? <div style={{ fontSize: 12, color: "#64748b" }}>Generating…</div> : null}

                <div
                  onKeyDownCapture={() => {
                    setSending(true);
                  }}
                >
                  <Composer />
                </div>
              </div>
            </div>
          </A2AChatRuntime>
        ) : (
          <div style={{ padding: 16, color: "#64748b" }}>Pick a topic on the left.</div>
        )}
      </div>
    </div>
  );
}

