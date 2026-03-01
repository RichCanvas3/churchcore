"use client";

import { useEffect, useMemo, useState } from "react";
import { ComposerPrimitive, MessagePrimitive, ThreadPrimitive } from "@assistant-ui/react";
import type { Session } from "../../lib/types";
import { A2AChatRuntime } from "./A2AChatRuntime";
import { useDemoIdentity } from "../../components/DemoIdentityProvider";
import { HouseholdManagerPanel } from "./HouseholdManagerPanel";
import { KidsCheckinPanel } from "./KidsCheckinPanel";

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

// NOTE: TextPart is defined inside ChatPage so it can render tool buttons.

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
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [threadsOwnerUserId, setThreadsOwnerUserId] = useState<string>(() => identity.user_id);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [mePerson, setMePerson] = useState<Record<string, unknown> | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [renaming, setRenaming] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [activeUiToolId, setActiveUiToolId] = useState<string | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  const effectiveThreadId = useMemo(() => {
    if (threadsOwnerUserId !== identity.user_id) return null;
    if (!activeThreadId) return null;
    return threads.some((t) => t && t.id === activeThreadId) ? activeThreadId : null;
  }, [activeThreadId, identity.user_id, threads, threadsOwnerUserId]);

  const session = useMemo<Session>(
    () => ({
      churchId: identity.tenant_id,
      campusId: identity.campus_id ?? "campus_main",
      timezone: identity.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
      userId: identity.user_id,
      personId: typeof (mePerson as any)?.id === "string" ? String((mePerson as any).id) : null,
      role: "seeker",
      auth: { isAuthenticated: false, roles: [] },
      threadId: effectiveThreadId,
    }),
    [effectiveThreadId, identity.campus_id, identity.tenant_id, identity.timezone, identity.user_id, mePerson],
  );

  const meLabel = useMemo(() => {
    const first = typeof (mePerson as any)?.first_name === "string" ? String((mePerson as any).first_name) : "";
    const last = typeof (mePerson as any)?.last_name === "string" ? String((mePerson as any).last_name) : "";
    const full = `${first} ${last}`.trim();
    if (full) return full;
    if (identity.user_id === "demo_user_noah") return "Noah Seeker";
    if (identity.user_id === "demo_user_ava") return "Ava Seeker";
    return "Seeker";
  }, [identity.user_id, mePerson]);

  async function refreshThreads() {
    const out = await postJson<{ threads?: ThreadMeta[]; person?: any }>("/api/a2a/thread/list", {
      identity: {
        tenant_id: identity.tenant_id,
        user_id: identity.user_id,
        role: identity.role,
        campus_id: identity.campus_id ?? undefined,
        timezone: identity.timezone ?? undefined,
        persona_id: null,
      },
      include_archived: false,
    });

    if (out?.person && typeof out.person === "object") setMePerson(out.person);
    const next = Array.isArray(out?.threads) ? out.threads : [];
    setThreads(next);
    setThreadsOwnerUserId(identity.user_id);
    setActiveThreadId((prev) => {
      if (prev && next.some((t) => t && t.id === prev)) return prev;
      return next.length ? String(next[0].id) : null;
    });
  }

  useEffect(() => {
    setThreads([]);
    setThreadsOwnerUserId(identity.user_id);
    setActiveThreadId(null);
    setMePerson(null);
    setEditingThreadId(null);
    setEditingTitle("");
    setUiError(null);
    setActiveUiToolId(null);
    setLeftCollapsed(false);
    refreshThreads().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.user_id]);

  function ToolButton(props: { toolId: string; title?: string }) {
    return (
      <button
        onClick={() => setActiveUiToolId(props.toolId)}
        style={{
          border: "1px solid #0f172a",
          background: "#0f172a",
          color: "white",
          borderRadius: 10,
          padding: "6px 10px",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 900,
        }}
      >
        Open {props.title || props.toolId}
      </button>
    );
  }

  function TextPart(props: any) {
    const text = typeof props?.text === "string" ? props.text : "";
    if (!text) return null;

    // Replace inline {"type":"ui_tool","tool_id":"kids_checkin"} snippets with buttons.
    const re = /\{\s*"type"\s*:\s*"ui_tool"\s*,\s*"tool_id"\s*:\s*"([^"]+)"\s*\}/g;
    const parts: Array<{ kind: "text"; value: string } | { kind: "tool"; toolId: string }> = [];
    let last = 0;
    for (;;) {
      const m = re.exec(text);
      if (!m) break;
      const idx = m.index;
      if (idx > last) parts.push({ kind: "text", value: text.slice(last, idx) });
      parts.push({ kind: "tool", toolId: String(m[1] || "").trim() });
      last = idx + m[0].length;
    }
    if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
    if (parts.length <= 1) return <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>;

    return (
      <span style={{ whiteSpace: "pre-wrap" }}>
        {parts.map((p, i) => {
          if (p.kind === "text") return <span key={i}>{p.value}</span>;
          const title = p.toolId === "kids_checkin" ? "Kids check-in" : p.toolId === "household_manager" ? "Household" : p.toolId;
          return (
            <span key={i} style={{ display: "inline-flex", margin: "0 6px", verticalAlign: "middle" }}>
              <ToolButton toolId={p.toolId} title={title} />
            </span>
          );
        })}
      </span>
    );
  }

  function UiToolButtonsPart(props: any) {
    const toolsLike = Array.isArray(props?.tools) ? props.tools : Array.isArray(props?.part?.tools) ? props.part.tools : [];
    const tools = (toolsLike as any[])
      .map((t) => ({
        toolId: typeof t?.toolId === "string" ? t.toolId : typeof t?.tool_id === "string" ? t.tool_id : "",
        title: typeof t?.title === "string" ? t.title : "",
      }))
      .filter((t) => t.toolId);
    if (!tools.length) return null;

    return (
      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tools.map((t) => (
          <button
            key={t.toolId}
            onClick={() => setActiveUiToolId(t.toolId)}
            style={{
              border: "1px solid #0f172a",
              background: "#0f172a",
              color: "white",
              borderRadius: 10,
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 900,
            }}
          >
            Open {t.title || t.toolId}
          </button>
        ))}
      </div>
    );
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
            <MessagePrimitive.Parts components={{ Text: TextPart, UiToolButtons: UiToolButtonsPart } as any} />
          </div>
        </div>
      </MessagePrimitive.Root>
    );
  }
  async function createThread() {
    const out = await postJson<{ thread_id?: string }>("/api/a2a/thread/create", {
      identity: {
        tenant_id: identity.tenant_id,
        user_id: identity.user_id,
        role: identity.role,
        campus_id: identity.campus_id ?? undefined,
        timezone: identity.timezone ?? undefined,
        persona_id: null,
      },
      title: "New topic",
    });
    await refreshThreads();
    if (out?.thread_id) setActiveThreadId(String(out.thread_id));
  }

  async function archiveThread(threadId: string) {
    await postJson("/api/a2a/thread/archive", {
      identity: {
        tenant_id: identity.tenant_id,
        user_id: identity.user_id,
        role: identity.role,
        campus_id: identity.campus_id ?? undefined,
        timezone: identity.timezone ?? undefined,
        persona_id: null,
      },
      thread_id: threadId,
    });
    setActiveThreadId(null);
    await refreshThreads();
  }

  async function renameThread(threadId: string, nextTitle: string) {
    const title = String(nextTitle ?? "").trim();
    if (!title) return;
    setUiError(null);
    setRenaming(true);
    try {
      await postJson("/api/a2a/thread/rename", {
        identity: {
          tenant_id: identity.tenant_id,
          user_id: identity.user_id,
          role: identity.role,
          campus_id: identity.campus_id ?? undefined,
          timezone: identity.timezone ?? undefined,
          persona_id: null,
        },
        thread_id: threadId,
        title,
      });
      setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, title } : t)));
      await refreshThreads();
      setEditingThreadId(null);
      setEditingTitle("");
    } catch (e: any) {
      setUiError(String(e?.message ?? e ?? "Rename failed"));
    } finally {
      setRenaming(false);
    }
  }

  const historyAdapter = useMemo(() => {
    const threadId = effectiveThreadId;
    return {
      async load() {
        if (!threadId) return { headId: null, messages: [] };
        let out: { messages?: any[] } | null = null;
        try {
          out = await postJson<{ messages?: any[] }>("/api/a2a/thread/get", {
            identity: {
              tenant_id: identity.tenant_id,
              user_id: identity.user_id,
              role: identity.role,
              campus_id: identity.campus_id ?? undefined,
              timezone: identity.timezone ?? undefined,
              persona_id: null,
            },
            thread_id: threadId,
            limit: 200,
            offset: 0,
          });
        } catch {
          // Happens if the active threadId belongs to a different user (e.g. after switching accounts).
          return { headId: null, messages: [] };
        }

        const rows = (Array.isArray(out?.messages) ? out!.messages : []).filter(Boolean);
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
              envelope: m?.envelope ?? null,
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
            content: (() => {
              const handoff = Array.isArray((like as any)?.envelope?.handoff) ? (((like as any).envelope.handoff as any[]) || []) : [];
              const tools = handoff
                .filter((h) => h && typeof h === "object" && String((h as any).type || "").toLowerCase() === "ui_tool" && typeof (h as any).tool_id === "string")
                .map((h) => ({
                  toolId: String((h as any).tool_id),
                  title: typeof (h as any).title === "string" ? String((h as any).title) : String((h as any).tool_id),
                }))
                .filter((t) => t.toolId);
              return tools.length ? [{ type: "text", text }, { type: "uiToolButtons", tools }] : [{ type: "text", text }];
            })(),
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
  }, [effectiveThreadId, identity.campus_id, identity.role, identity.tenant_id, identity.timezone, identity.user_id]);

  return (
    <div
      style={{
        height: "100%",
        background: "#f8fafc",
        display: "grid",
        gridTemplateColumns: activeUiToolId
          ? `${leftCollapsed ? "72px" : "320px"} 1fr minmax(420px, 40%)`
          : `${leftCollapsed ? "72px" : "320px"} 1fr`,
        overflow: "hidden",
      }}
    >
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
        <div style={{ padding: leftCollapsed ? 8 : 14, borderBottom: "1px solid #e2e8f0" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: leftCollapsed ? "center" : "space-between",
              gap: 10,
            }}
          >
            {leftCollapsed ? null : <div style={{ fontSize: 16, fontWeight: 900 }}>Messages</div>}
            <button
              onClick={() => setLeftCollapsed((v) => !v)}
              title={leftCollapsed ? "Expand topics" : "Collapse topics"}
              style={{
                border: "1px solid #e2e8f0",
                background: "white",
                borderRadius: 10,
                padding: leftCollapsed ? "6px 0" : "6px 8px",
                width: leftCollapsed ? "100%" : undefined,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 900,
              }}
            >
              {leftCollapsed ? "⟩" : "⟨"}
            </button>
          </div>
          {!leftCollapsed ? <div style={{ color: "#64748b", fontSize: 12 }}>{meLabel}</div> : null}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => createThread()}
              style={{ border: "1px solid #0f172a", background: "#0f172a", color: "white", padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              {leftCollapsed ? "+" : "New topic"}
            </button>
          </div>
          {!leftCollapsed && uiError ? <div style={{ marginTop: 10, fontSize: 12, color: "#b91c1c" }}>{uiError}</div> : null}
        </div>

        <div style={{ overflow: "auto", minHeight: 0 }}>
          {threads.length ? (
            <div style={{ padding: 10, display: "grid", gap: 6 }}>
              {threads.map((t) => {
                const isActive = t.id === effectiveThreadId;
                const isEditing = t.id === editingThreadId;
                const collapsedLabel = String(t.title || "").trim().slice(0, 1).toUpperCase() || "•";
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
                    title={leftCollapsed ? t.title : undefined}
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
                            void renameThread(t.id, editingTitle);
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
                      <div style={{ fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {leftCollapsed ? collapsedLabel : t.title}
                      </div>
                    )}
                    {!leftCollapsed ? (
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
                            void renameThread(t.id, editingTitle);
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

      <div style={{ display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0, overflow: "hidden" }}>
        <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", background: "white", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 900, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {threads.find((t) => t.id === effectiveThreadId)?.title ?? "Select a topic"}
          </div>
          {activeUiToolId ? (
            <button
              onClick={() => setActiveUiToolId(null)}
              title="Close tool panel"
              style={{ border: "1px solid #e2e8f0", background: "white", borderRadius: 10, padding: "6px 8px", cursor: "pointer", fontSize: 12, fontWeight: 900 }}
            >
              Tool ✕
            </button>
          ) : null}
          <div style={{ color: "#64748b", fontSize: 12 }}>A2A threads/messages in D1; streaming tokens.</div>
        </div>

        {effectiveThreadId ? (
          <A2AChatRuntime
            key={effectiveThreadId}
            session={session}
            threadId={effectiveThreadId}
            historyAdapter={historyAdapter}
            onFinalEnvelope={(env) => {
              setSending(false);
              const handoff = Array.isArray((env as any)?.handoff) ? ((env as any).handoff as any[]) : [];
              const uiTool = handoff.find((h) => h && typeof h === "object" && String((h as any).type || "").toLowerCase() === "ui_tool");
              const toolId = uiTool && typeof (uiTool as any).tool_id === "string" ? String((uiTool as any).tool_id) : null;
              if (toolId) {
                setActiveUiToolId(toolId);
              }
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

      {activeUiToolId ? (
        <div style={{ borderLeft: "1px solid #e2e8f0", minHeight: 0, overflow: "hidden" }}>
          {activeUiToolId === "household_manager" ? (
            <HouseholdManagerPanel
              identity={{
                tenant_id: identity.tenant_id,
                user_id: identity.user_id,
                role: identity.role,
                campus_id: identity.campus_id ?? null,
                timezone: identity.timezone ?? null,
                persona_id: null,
              }}
              onClose={() => setActiveUiToolId(null)}
            />
          ) : activeUiToolId === "kids_checkin" ? (
            <KidsCheckinPanel
              identity={{
                tenant_id: identity.tenant_id,
                user_id: identity.user_id,
                role: identity.role,
                campus_id: identity.campus_id ?? null,
                timezone: identity.timezone ?? null,
              }}
              onClose={() => setActiveUiToolId(null)}
            />
          ) : (
            <div style={{ padding: 14, color: "#64748b", background: "white", height: "100%" }}>
              Unknown tool: {activeUiToolId}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

