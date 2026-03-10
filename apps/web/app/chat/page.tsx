"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ComposerPrimitive, MessagePrimitive, ThreadPrimitive } from "@assistant-ui/react";
import type { Session } from "../../lib/types";
import { A2AChatRuntime } from "./A2AChatRuntime";
import { useDemoIdentity } from "../../components/DemoIdentityProvider";
import { HouseholdManagerPanel } from "./HouseholdManagerPanel";
import { KidsCheckinPanel } from "./KidsCheckinPanel";
import { FaithJourneyPanel } from "./FaithJourneyPanel";
import { IdentityContactPanel } from "./IdentityContactPanel";
import { CommPrefsPanel } from "./CommPrefsPanel";
import { TeamsSkillsPanel } from "./TeamsSkillsPanel";
import { CarePastoralPanel } from "./CarePastoralPanel";
import { MemoryManagerPanel } from "./MemoryManagerPanel";
import { CommunityManagerPanel } from "./CommunityManagerPanel";
import { GroupsPanel } from "./GroupsPanel";
import { GuidePanel } from "./GuidePanel";
import { ChurchOverviewPanel } from "./ChurchOverviewPanel";
import { StrategicIntentPanel } from "./StrategicIntentPanel";
import { CalendarPanel } from "./CalendarPanel";
import { WeeklySermonsPanel } from "./WeeklySermonsPanel";
import { BibleReaderPanel } from "./BibleReaderPanel";
import styles from "./ChatLayout.module.css";

type ThreadMeta = { id: string; title: string; status: string; updatedAt?: string; createdAt?: string; metadataJson?: string | null; metadata?: any };
type ActiveThreadMeta = {
  templateId: string | null;
  toolIds: string[];
  llmProvider: "langgraph" | "ai_gateway";
  aiGatewayMode: "general" | "grounded" | "auto";
};

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

function Composer(props: { disabled?: boolean; onSend?: () => void }) {
  const disabled = Boolean(props.disabled);
  return (
    <ComposerPrimitive.Root style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
      <ComposerPrimitive.Input
        placeholder="Message Church Agent…"
        disabled={disabled}
        style={{ flex: 1, minWidth: 0, border: "1px solid #cbd5e1", borderRadius: 12, padding: "10px 12px", fontSize: 16 }}
      />
      <ComposerPrimitive.Send
        disabled={disabled}
        onClick={() => props.onSend?.()}
        style={{
          border: "1px solid #0f172a",
          background: "#0f172a",
          color: "white",
          padding: "10px 12px",
          borderRadius: 12,
          cursor: disabled ? "not-allowed" : "pointer",
          touchAction: "manipulation",
          opacity: disabled ? 0.7 : 1,
        }}
      >
        {disabled ? "Thinking…" : "Send"}
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
  const [threadEmpty, setThreadEmpty] = useState<boolean | null>(null);
  const [mePerson, setMePerson] = useState<Record<string, unknown> | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>("");
  const [renaming, setRenaming] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [activeUiToolId, setActiveUiToolId] = useState<string | null>(null);
  const [activeUiToolArgs, setActiveUiToolArgs] = useState<Record<string, unknown> | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isThreadsOpenMobile, setIsThreadsOpenMobile] = useState(false);
  const [isToolsOpenMobile, setIsToolsOpenMobile] = useState(false);
  const [sermonCompareOpen, setSermonCompareOpen] = useState(false);
  const [sermonCompareLoading, setSermonCompareLoading] = useState(false);
  const [sermonCompareError, setSermonCompareError] = useState<string | null>(null);
  const [sermonCompareMarkdown, setSermonCompareMarkdown] = useState<string>("");
  const [sermonCompareIncluded, setSermonCompareIncluded] = useState<any[]>([]);
  const [sermonCompareAnchorId, setSermonCompareAnchorId] = useState<string>("");
  const [sermonCompareMatch, setSermonCompareMatch] = useState<any | null>(null);
  const [bibleRef, setBibleRef] = useState<string | null>(null);
  const [hideBibleTool, setHideBibleTool] = useState(false);
  const [threadReloadNonce, setThreadReloadNonce] = useState(0);
  const [newTopicOpen, setNewTopicOpen] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateErr, setTemplateErr] = useState<string>("");
  const [templates, setTemplates] = useState<Array<{ slug: string; title: string; description?: string | null; toolIds?: string[] }>>([]);
  const [templateSearch, setTemplateSearch] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const refreshThreadsSeq = useRef(0);

  const closeTool = () => {
    const isBible = String(activeUiToolId || "").trim() === "bible_reader";
    setActiveUiToolId(null);
    setActiveUiToolArgs(null);
    setIsToolsOpenMobile(false);
    if (isBible) setHideBibleTool(true);
  };

  async function openSermonCompare(anchorMessageId?: string) {
    setSermonCompareOpen(true);
    setSermonCompareLoading(true);
    setSermonCompareError(null);
    setSermonCompareMarkdown("");
    setSermonCompareIncluded([]);
    setSermonCompareMatch(null);
    const anchor = String(anchorMessageId ?? sermonCompareAnchorId ?? "").trim();
    setSermonCompareAnchorId(anchor);
    try {
      const out = await postJson<any>("/api/a2a/sermon/compare", {
        identity: {
          tenant_id: identity.tenant_id,
          user_id: identity.user_id,
          role: identity.role,
          campus_id: identity.campus_id ?? null,
          timezone: identity.timezone ?? null,
          persona_id: (identity as any).persona_id ?? null,
        },
        campuses: ["campus_boulder", "campus_erie", "campus_thornton"],
        anchor_message_id: anchor || null,
      });
      const cmp = (out as any)?.comparison ?? null;
      const md =
        typeof cmp?.comparison_markdown === "string"
          ? cmp.comparison_markdown
          : typeof cmp?.comparisonMarkdown === "string"
            ? cmp.comparisonMarkdown
            : "";
      setSermonCompareMarkdown(md || "No comparison returned.");
      setSermonCompareIncluded(Array.isArray((out as any)?.sermons) ? (out as any).sermons : []);
      setSermonCompareMatch((out as any)?.match ?? null);
    } catch (e: any) {
      setSermonCompareError(String(e?.message ?? e ?? "Compare failed"));
    } finally {
      setSermonCompareLoading(false);
    }
  }

  function openTool(toolId: string, args?: Record<string, unknown> | null) {
    const nextToolId = toolId === "kids_safety" || toolId === "household_memory" ? "household_manager" : toolId;
    if (nextToolId === "bible_reader") {
      const r = args && typeof (args as any)?.ref === "string" ? String((args as any).ref) : null;
      setBibleRef(r);
      setHideBibleTool(false);
      setActiveUiToolId("bible_reader");
      setActiveUiToolArgs(args ?? null);
      if (isMobile) setIsToolsOpenMobile(true);
      return;
    }
    setActiveUiToolId(nextToolId);
    setActiveUiToolArgs(args ?? null);
    setHideBibleTool(false);
  }

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(Boolean(mq.matches));
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // On mobile, if a UI tool becomes active, open the tools sheet.
  useEffect(() => {
    if (isMobile && activeUiToolId) setIsToolsOpenMobile(true);
    if (!activeUiToolId) setIsToolsOpenMobile(false);
    if (!isMobile) {
      setIsThreadsOpenMobile(false);
      setIsToolsOpenMobile(false);
    }
  }, [activeUiToolId, isMobile]);

  // Lock background scroll when overlays are open on mobile.
  useEffect(() => {
    if (!isMobile) return;
    const open = isThreadsOpenMobile || isToolsOpenMobile;
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isMobile, isThreadsOpenMobile, isToolsOpenMobile]);

  const effectiveLeftCollapsed = isMobile ? false : leftCollapsed;

  const effectiveThreadId = useMemo(() => {
    if (threadsOwnerUserId !== identity.user_id) return null;
    if (!activeThreadId) return null;
    return threads.some((t) => t && t.id === activeThreadId) ? activeThreadId : null;
  }, [activeThreadId, identity.user_id, threads, threadsOwnerUserId]);

  const activeThreadMeta = useMemo<ActiveThreadMeta | null>(() => {
    if (!effectiveThreadId) return null;
    const t = threads.find((x) => x && x.id === effectiveThreadId) ?? null;
    if (!t) return null;
    let meta: any = null;
    if (typeof (t as any).metadataJson === "string" && String((t as any).metadataJson).trim()) {
      try {
        meta = JSON.parse(String((t as any).metadataJson));
      } catch {
        meta = null;
      }
    } else if (typeof (t as any).metadata === "object") {
      meta = (t as any).metadata;
    }
    const toolIds = Array.isArray(meta?.tool_ids) ? meta.tool_ids.map((x: any) => String(x)).filter(Boolean) : [];
    const llmProviderRaw = typeof meta?.llm_provider === "string" ? String(meta.llm_provider).trim().toLowerCase() : "";
    const llmProvider: "langgraph" | "ai_gateway" = llmProviderRaw === "ai_gateway" ? "ai_gateway" : "langgraph";
    const aiGatewayModeRaw =
      typeof meta?.ai_gateway_mode === "string" ? String(meta.ai_gateway_mode).trim().toLowerCase() : "";
    const aiGatewayMode: "general" | "grounded" | "auto" =
      aiGatewayModeRaw === "general" || aiGatewayModeRaw === "auto" || aiGatewayModeRaw === "grounded" ? aiGatewayModeRaw : "grounded";
    return { templateId: typeof meta?.template_id === "string" ? meta.template_id : null, toolIds, llmProvider, aiGatewayMode };
  }, [effectiveThreadId, threads]);

  const session = useMemo<Session>(
    () => ({
      churchId: identity.tenant_id,
      campusId: identity.campus_id ?? "campus_boulder",
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
    const seq = ++refreshThreadsSeq.current;
    const reqUserId = identity.user_id;
    const out = await postJson<{ threads?: ThreadMeta[]; person?: any }>("/api/a2a/thread/list", {
      identity: {
        tenant_id: identity.tenant_id,
        user_id: reqUserId,
        role: identity.role,
        campus_id: identity.campus_id ?? undefined,
        timezone: identity.timezone ?? undefined,
        persona_id: (identity as any).persona_id ?? null,
      },
      include_archived: false,
    });

    // Guard against out-of-order responses (e.g., identity changes during load).
    if (seq !== refreshThreadsSeq.current) return;

    if (out?.person && typeof out.person === "object") setMePerson(out.person);
    const next = Array.isArray(out?.threads) ? out.threads : [];
    setThreads(next);
    setThreadsOwnerUserId(reqUserId);
    setActiveThreadId((prev) => {
      if (prev && next.some((t) => t && t.id === prev)) return prev;
      return next.length ? String(next[0].id) : null;
    });
  }

  useEffect(() => {
    // Invalidate any in-flight thread refresh for prior identity.
    refreshThreadsSeq.current += 1;
    setThreads([]);
    setThreadsOwnerUserId(identity.user_id);
    setActiveThreadId(null);
    setMePerson(null);
    setEditingThreadId(null);
    setEditingTitle("");
    setUiError(null);
    setActiveUiToolId(null);
    setActiveUiToolArgs(null);
    setHideBibleTool(true);
    setLeftCollapsed(false);
    refreshThreads().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.user_id]);

  // Close the right-side tool when switching topics.
  useEffect(() => {
    setActiveUiToolId(null);
    setActiveUiToolArgs(null);
    setIsToolsOpenMobile(false);
    setHideBibleTool(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveThreadId]);

  const effectiveUiToolId = useMemo(() => {
    // On mobile, don't force-open the Bible panel by default.
    if (isMobile) return activeUiToolId;
    if (activeUiToolId) return activeUiToolId;
    return hideBibleTool ? null : "bible_reader";
  }, [activeUiToolId, hideBibleTool, isMobile]);

  // Welcome card is shown only when the thread is empty.
  useEffect(() => {
    setThreadEmpty(null);
  }, [effectiveThreadId]);

  function toolDisplayTitle(toolId: string, title?: string) {
    if (toolId === "guide") return "Your Personal Guide";
    if (toolId === "calendar") return "My Calendar";
    if (toolId === "bible_reader") return "Bible Scripture";
    if (toolId === "groups_manager") return "My Groups";
    if (toolId === "strategic_intent") return "Congregation Strategic Intent";
    const t = String(title ?? "").trim();
    return t || toolId;
  }

  function ToolButton(props: { toolId: string; title?: string; variant?: "inline" | "cta" }) {
    const variant = props.variant ?? "inline";
    const label = toolDisplayTitle(props.toolId, props.title);
    return (
      <button
        onClick={() => openTool(props.toolId)}
        style={{
          border: variant === "cta" ? "1px solid #0f172a" : "1px solid #cbd5e1",
          background: variant === "cta" ? "#0f172a" : "#f8fafc",
          color: variant === "cta" ? "white" : "#0f172a",
          borderRadius: 999,
          padding: variant === "cta" ? "7px 12px" : "4px 10px",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 800,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          lineHeight: 1,
        }}
      >
        {variant === "cta" ? `Open ${label}` : label}
      </button>
    );
  }

  function welcomeSpec(templateId: string | null) {
    const id = String(templateId ?? "").trim();
    if (id === "ask_our_church") {
      return {
        heading: "Ask anything about Calvary.",
        starters: ["What time are services at my campus?", "What does the church believe about baptism?", "Summarize last Sunday’s sermon in 5 bullets."],
      };
    }
    if (id === "faith_journey") {
      return {
        heading: "Let’s map where you are and what’s next.",
        starters: ["What stage am I in right now?", "What are my next 3 steps this week?", "Help me start a Bible plan for this week’s sermon."],
      };
    }
    if (id === "your_community") {
      return {
        heading: "Let’s help you find your people.",
        starters: ["What groups/classes fit my schedule?", "What’s a good next community step for my stage?", "Show upcoming events I should attend."],
      };
    }
    if (id === "home_group") {
      return {
        heading: "Let’s find a home group that fits.",
        starters: ["Help me find a group near Erie.", "What groups are best for newcomers?", "What’s the easiest first step this week?"],
      };
    }
    if (id === "sermon_discussion") {
      return {
        heading: "Let’s unpack this week’s sermon together.",
        starters: ["What was the big idea?", "Give me 5 discussion questions.", "What Scriptures should I reread this week?"],
      };
    }
    if (id === "bible_plan") {
      return {
        heading: "Let’s keep your weekly Bible plan on track.",
        starters: ["What’s today’s reading?", "Show this week’s plan.", "Help me catch up if I’m behind."],
      };
    }
    if (id === "events") {
      return { heading: "Here’s what’s coming up.", starters: ["What’s happening this week at my campus?", "Show my activities + church events.", "Any outdoor events (with weather)?"] };
    }
    if (id === "prayer") {
      return { heading: "Share what you’d like prayer for.", starters: ["I’d like prayer for…", "Help me write a short prayer request.", "What should I pray about this week from the sermon?"] };
    }
    if (id === "kids") {
      return { heading: "Let’s make Sundays smoother for your family.", starters: ["How does kids check-in work?", "Add a child (with allergies) to my household.", "What rooms are my kids eligible for?"] };
    }
    return { heading: "Welcome. Ask your first question.", starters: ["What should I do next?", "Tell me about this week’s sermon.", "Help me plan a visit."] };
  }

  function WelcomeCard() {
    const threadTitle = threads.find((t) => t.id === effectiveThreadId)?.title ?? "New topic";
    const tplId = activeThreadMeta?.templateId ?? null;
    const tpl = tplId ? templates.find((t) => t.slug === tplId) ?? null : null;
    const spec = welcomeSpec(tplId);
    const title = tpl?.title ?? threadTitle;
    const desc = (tpl?.description ?? "").trim();
    const tools = (activeThreadMeta?.toolIds ?? []).slice(0, 5);

    return (
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 14, background: "white" }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>{title}</div>
        <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{spec.heading}</div>
        {desc ? <div style={{ marginTop: 6, fontSize: 12, color: "#475569" }}>{desc}</div> : null}
        {tools.length ? (
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {tools.map((toolId) => (
              <ToolButton key={toolId} toolId={toolId} title={toolDisplayTitle(toolId)} variant="cta" />
            ))}
          </div>
        ) : null}
        <div style={{ marginTop: 12, fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Try one</div>
        <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
          {spec.starters.map((s) => (
            <div key={s} style={{ fontSize: 12, color: "#334155" }}>
              - {s}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function TextPart(props: any) {
    const text = typeof props?.text === "string" ? props.text : "";
    if (!text) return null;

    function renderTextWithLinks(raw: string) {
      const s = String(raw ?? "");
      if (!s) return null;
      const urlRe = /(https?:\/\/[^\s<>"']+)/g;
      const scriptureRe =
        /\b(?:[1-3]\s*)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+\d{1,3}:\d{1,3}(?:[-–—]\d{1,3})?(?:,\s*\d{1,3}(?:[-–—]\d{1,3})?)*\b/g;

      const out: React.ReactNode[] = [];

      const reset = () => {
        urlRe.lastIndex = 0;
        scriptureRe.lastIndex = 0;
      };
      reset();

      let i = 0;
      for (;;) {
        urlRe.lastIndex = i;
        scriptureRe.lastIndex = i;
        const mu = urlRe.exec(s);
        const ms = scriptureRe.exec(s);
        const nu = mu ? mu.index : -1;
        const ns = ms ? ms.index : -1;
        if (nu === -1 && ns === -1) break;

        const pick = nu !== -1 && (ns === -1 || nu < ns) ? ("url" as const) : ("scripture" as const);
        const idx = pick === "url" ? nu : ns;
        const m = pick === "url" ? mu! : ms!;
        if (idx > i) out.push(<span key={`t-${i}`}>{s.slice(i, idx)}</span>);

        if (pick === "url") {
          let url = String(m[1] ?? "");
          // Trim common trailing punctuation that isn't part of URLs.
          const trailing: string[] = [];
          while (url && /[)\],.!?:;]$/.test(url)) {
            trailing.unshift(url.slice(-1));
            url = url.slice(0, -1);
          }
          if (url) {
            out.push(
              <a
                key={`a-${idx}`}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#2563eb", textDecoration: "underline", fontWeight: 700 }}
              >
                {url}
              </a>,
            );
          } else {
            out.push(<span key={`a-${idx}`}>{String(m[1] ?? "")}</span>);
          }
          if (trailing.length) out.push(<span key={`p-${idx}`}>{trailing.join("")}</span>);
        } else {
          const ref = String(m[0] ?? "").trim();
          out.push(
            <button
              key={`s-${idx}`}
              type="button"
              onClick={() => openTool("bible_reader", { ref })}
              style={{
                border: "1px solid #cbd5e1",
                background: "#eef2ff",
                color: "#1e3a8a",
                borderRadius: 999,
                padding: "2px 8px",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 900,
                lineHeight: 1.4,
              }}
              title={`Read ${ref}`}
            >
              {ref}
            </button>,
          );
        }

        i = idx + String(m[0] ?? "").length;
      }

      if (i < s.length) out.push(<span key={`t-${i}`}>{s.slice(i)}</span>);
      return out.length ? out : s;
    }

    // Replace inline {"type":"ui_tool","tool_id":"kids_checkin"} (or escaped variants) with buttons.
    const parts: Array<{ kind: "text"; value: string } | { kind: "tool"; toolId: string }> = [];
    const s0 = String(text ?? "");
    const patterns = [
      // Normal JSON
      /\{\s*"type"\s*:\s*"ui_tool"\s*,\s*"tool_id"\s*:\s*"([^"]+)"\s*\}/g,
      // Escaped JSON inside strings, e.g. {\"type\":\"ui_tool\",\"tool_id\":\"calendar\"}
      /\{\s*\\"type\\"\s*:\s*\\"ui_tool\\"\s*,\s*\\"tool_id\\"\s*:\s*\\"([^\\"]+)\\"\s*\}/g,
    ];
    // Collect matches from either pattern, then split in one pass.
    const matches: Array<{ start: number; end: number; toolId: string }> = [];
    for (const re of patterns) {
      re.lastIndex = 0;
      for (;;) {
        const m = re.exec(s0);
        if (!m) break;
        const toolId = String(m[1] || "").trim();
        if (toolId) matches.push({ start: m.index, end: m.index + m[0].length, toolId });
      }
    }
    matches.sort((a, b) => a.start - b.start || b.end - a.end);
    // Remove overlaps (prefer the earliest + longest).
    const pruned: Array<{ start: number; end: number; toolId: string }> = [];
    for (const m of matches) {
      const last = pruned[pruned.length - 1];
      if (!last) {
        pruned.push(m);
        continue;
      }
      if (m.start >= last.end) pruned.push(m);
    }
    let lastIdx = 0;
    for (const m of pruned) {
      if (m.start > lastIdx) parts.push({ kind: "text", value: s0.slice(lastIdx, m.start) });
      parts.push({ kind: "tool", toolId: m.toolId });
      lastIdx = m.end;
    }
    if (lastIdx < s0.length) parts.push({ kind: "text", value: s0.slice(lastIdx) });
    const textStyle: React.CSSProperties = { whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" };
    if (parts.length <= 1) return <span style={textStyle}>{renderTextWithLinks(text)}</span>;

    return (
      <span style={textStyle}>
        {parts.map((p, i) => {
          if (p.kind === "text") return <span key={i}>{renderTextWithLinks(p.value)}</span>;
          const title =
            p.toolId === "kids_checkin"
              ? "Kids check-in"
              : p.toolId === "household_manager"
                ? "Household"
                : p.toolId === "weekly_sermons" || p.toolId === "weekly_podcasts"
                  ? "Weekly sermons"
                : p.toolId === "community_manager"
                  ? "Community"
                : p.toolId === "calendar"
                  ? "Calendar"
                  : p.toolId === "bible_reader"
                    ? "Bible"
                : p.toolId === "faith_journey"
                  ? "Faith journey"
                  : p.toolId === "identity_contact"
                    ? "Identity & contact"
                    : p.toolId === "comm_prefs"
                      ? "Communication prefs"
                      : p.toolId === "care_pastoral"
                        ? "Care & prayer"
                        : p.toolId === "teams_skills"
                          ? "Teams & skills"
                            : p.toolId === "memory_manager"
                              ? "Memory manager"
                    : p.toolId === "guide"
                      ? "Guide"
                      : p.toolId === "church_overview"
                        ? "Church"
                        : p.toolId === "strategic_intent"
                          ? "Congregation Strategic Intent"
                              : p.toolId;
          return (
            <span key={i} style={{ display: "inline-flex", margin: "0 6px", verticalAlign: "middle" }}>
              <ToolButton toolId={p.toolId} title={title} variant="inline" />
            </span>
          );
        })}
      </span>
    );
  }

  // Defensive: older persisted messages (or cached clients) may still contain UiToolButtons parts.
  // We don't emit this part anymore, but rendering it prevents noisy console warnings.
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
          <ToolButton key={t.toolId} toolId={t.toolId} title={t.title || t.toolId} variant="cta" />
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
            <MessagePrimitive.Parts components={{ Text: TextPart, UiToolButtons: UiToolButtonsPart, uiToolButtons: UiToolButtonsPart } as any} />
          </div>
        </div>
      </MessagePrimitive.Root>
    );
  }
  async function createThread() {
    // Backwards-compat: still allow a quick blank thread creation (used by template modal).
    const out = await postJson<{ thread_id?: string }>("/api/a2a/thread/create", {
      identity: {
        tenant_id: identity.tenant_id,
        user_id: identity.user_id,
        role: identity.role,
        campus_id: identity.campus_id ?? undefined,
        timezone: identity.timezone ?? undefined,
        persona_id: (identity as any).persona_id ?? null,
      },
      title: (customTitle || "New topic").trim() || "New topic",
      metadata: customTitle ? { template_id: "blank", tool_ids: [] } : undefined,
    });
    await refreshThreads();
    if (out?.thread_id) setActiveThreadId(String(out.thread_id));
    setNewTopicOpen(false);
    setCustomTitle("");
    setTemplateSearch("");
  }

  async function loadTemplates() {
    setTemplateBusy(true);
    setTemplateErr("");
    try {
      const out = await postJson<any>("/api/a2a/topic/template/list", {
        identity: {
          tenant_id: identity.tenant_id,
          user_id: identity.user_id,
          role: identity.role,
          campus_id: identity.campus_id ?? undefined,
          timezone: identity.timezone ?? undefined,
          persona_id: (identity as any).persona_id ?? null,
        },
        include_inactive: false,
      });
      const list = Array.isArray(out?.templates) ? out.templates : [];
      const normalized = list
        .filter((t: any) => t && typeof t === "object" && typeof t.slug === "string" && typeof t.title === "string")
        .map((t: any) => ({
          slug: String(t.slug),
          title: String(t.title),
          description: typeof t.description === "string" ? t.description : null,
          toolIds: Array.isArray(t.toolIds) ? t.toolIds.map((x: any) => String(x)).filter(Boolean) : [],
        }));
      setTemplates(normalized);
    } catch (e: any) {
      setTemplateErr(String(e?.message ?? e ?? "Failed to load templates"));
      setTemplates([]);
    } finally {
      setTemplateBusy(false);
    }
  }

  async function createThreadFromTemplate(tpl: { slug: string; title: string; toolIds?: string[] }) {
    const title = (customTitle || tpl.title || "New topic").trim() || "New topic";
    const useAiGateway = String(tpl.slug || "").trim().toLowerCase() === "ask_our_church";
    const metadata: any = { template_id: tpl.slug, tool_ids: Array.isArray(tpl.toolIds) ? tpl.toolIds : [] };
    if (useAiGateway) {
      metadata.llm_provider = "ai_gateway";
      metadata.ai_gateway_mode = "grounded";
    }
    const out = await postJson<{ thread_id?: string }>("/api/a2a/thread/create", {
      identity: {
        tenant_id: identity.tenant_id,
        user_id: identity.user_id,
        role: identity.role,
        campus_id: identity.campus_id ?? undefined,
        timezone: identity.timezone ?? undefined,
        persona_id: (identity as any).persona_id ?? null,
      },
      title,
      metadata,
    });
    await refreshThreads();
    if (out?.thread_id) setActiveThreadId(String(out.thread_id));
    setNewTopicOpen(false);
    setCustomTitle("");
    setTemplateSearch("");
  }

  async function archiveThread(threadId: string) {
    await postJson("/api/a2a/thread/archive", {
      identity: {
        tenant_id: identity.tenant_id,
        user_id: identity.user_id,
        role: identity.role,
        campus_id: identity.campus_id ?? undefined,
        timezone: identity.timezone ?? undefined,
        persona_id: (identity as any).persona_id ?? null,
      },
      thread_id: threadId,
    });
    setActiveThreadId(null);
    await refreshThreads();
  }

  async function clearThreadMessages(threadId: string) {
    if (!threadId) return;
    setUiError(null);
    try {
      await postJson("/api/a2a/thread/clear", {
        identity: {
          tenant_id: identity.tenant_id,
          user_id: identity.user_id,
          role: identity.role,
          campus_id: identity.campus_id ?? undefined,
          timezone: identity.timezone ?? undefined,
          persona_id: (identity as any).persona_id ?? null,
        },
        thread_id: threadId,
      });
      setThreadReloadNonce((n) => n + 1);
      await refreshThreads();
    } catch (e: any) {
      setUiError(String(e?.message ?? e ?? "Clear failed"));
    }
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
          persona_id: (identity as any).persona_id ?? null,
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

  const personaId = (identity as any).persona_id ?? null;

  const historyAdapter = useMemo(() => {
    const threadId = effectiveThreadId;
    return {
      async load() {
        if (!threadId) {
          setThreadEmpty(null);
          return { headId: null, messages: [] };
        }
        let out: { messages?: any[] } | null = null;
        try {
          out = await postJson<{ messages?: any[] }>("/api/a2a/thread/get", {
            identity: {
              tenant_id: identity.tenant_id,
              user_id: identity.user_id,
              role: identity.role,
              campus_id: identity.campus_id ?? undefined,
              timezone: identity.timezone ?? undefined,
              persona_id: personaId,
            },
            thread_id: threadId,
            limit: 200,
            offset: 0,
          });
        } catch {
          // Happens if the active threadId belongs to a different user (e.g. after switching accounts).
          setThreadEmpty(true);
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

        setThreadEmpty(likes.length === 0);

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
              const snippets = tools.map((t) => `{"type":"ui_tool","tool_id":"${String(t.toolId).replace(/"/g, "")}"}`).join("\n");
              const withTools = snippets ? `${text}\n\n${snippets}` : text;
              return [{ type: "text", text: withTools }];
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
  }, [effectiveThreadId, identity.campus_id, identity.role, identity.tenant_id, identity.timezone, identity.user_id, personaId]);

  return (
    <div
      className={styles.root}
      style={
        {
          ["--left-width" as any]: effectiveLeftCollapsed ? "72px" : "234px",
          ["--right-width" as any]: effectiveUiToolId ? "minmax(420px, 40%)" : "0px",
        } as any
      }
    >
      <style>{`
        @keyframes ccspin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes ccpulse { 0% { opacity: .55; } 50% { opacity: 1; } 100% { opacity: .55; } }
      `}</style>
      {/* Mobile: threads drawer backdrop */}
      <div
        className={`${styles.backdrop} ${isMobile && isThreadsOpenMobile ? styles.backdropOpen : ""}`}
        onClick={() => setIsThreadsOpenMobile(false)}
      />

      {/* Mobile: tools sheet backdrop */}
      <div
        className={`${styles.backdrop} ${isMobile && isToolsOpenMobile ? styles.backdropOpen : ""}`}
        onClick={() => setIsToolsOpenMobile(false)}
        style={{ zIndex: 55 }}
      />

      <div className={`${styles.leftPane} ${isMobile && isThreadsOpenMobile ? styles.leftPaneOpen : ""}`}>
        <div style={{ padding: effectiveLeftCollapsed ? 8 : 14, borderBottom: "1px solid #e2e8f0" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: effectiveLeftCollapsed ? "center" : "space-between",
              gap: 10,
            }}
          >
            {effectiveLeftCollapsed ? null : <div style={{ fontSize: 16, fontWeight: 900 }}>Messages</div>}
            <button
              className={styles.desktopOnly}
              onClick={() => setLeftCollapsed((v) => !v)}
              title={effectiveLeftCollapsed ? "Expand topics" : "Collapse topics"}
              style={{
                border: "1px solid #e2e8f0",
                background: "white",
                borderRadius: 10,
                padding: effectiveLeftCollapsed ? "6px 0" : "6px 8px",
                width: effectiveLeftCollapsed ? "100%" : undefined,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 900,
              }}
            >
              {effectiveLeftCollapsed ? "⟩" : "⟨"}
            </button>
            <button
              className={styles.mobileOnly}
              onClick={() => setIsThreadsOpenMobile(false)}
              title="Close topics"
              style={{
                border: "1px solid #e2e8f0",
                background: "white",
                borderRadius: 10,
                padding: "6px 8px",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 900,
              }}
            >
              ✕
            </button>
          </div>
          {!effectiveLeftCollapsed ? <div style={{ color: "#64748b", fontSize: 12 }}>{meLabel}</div> : null}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                setNewTopicOpen(true);
                setTemplateErr("");
                setTemplateSearch("");
                setCustomTitle("");
                void loadTemplates();
              }}
              style={{ border: "1px solid #0f172a", background: "#0f172a", color: "white", padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
            >
              {effectiveLeftCollapsed ? "+" : "New topic"}
            </button>
          </div>
          {!effectiveLeftCollapsed && uiError ? <div style={{ marginTop: 10, fontSize: 12, color: "#b91c1c" }}>{uiError}</div> : null}
        </div>

        <div style={{ overflow: "auto", minHeight: 0 }}>
          {threads.length ? (
            <div style={{ padding: 10, display: "grid", gap: 6 }}>
              {threads.map((t) => {
                const isActive = t.id === effectiveThreadId;
                const isEditing = t.id === editingThreadId;
                const collapsedLabel = String(t.title || "").trim().slice(0, 1).toUpperCase() || "•";

                const IconButton = (props: { title: string; onClick: (e: React.MouseEvent) => void; disabled?: boolean; children: React.ReactNode }) => (
                  <button
                    type="button"
                    onClick={props.onClick}
                    disabled={Boolean(props.disabled)}
                    title={props.title}
                    aria-label={props.title}
                    style={{
                      border: "1px solid #e2e8f0",
                      background: "white",
                      borderRadius: 10,
                      padding: "6px",
                      cursor: props.disabled ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: props.disabled ? 0.6 : 1,
                    }}
                  >
                    {props.children}
                  </button>
                );

                const IconPencil = () => (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 20h9" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" />
                    <path
                      d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z"
                      stroke="#0f172a"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                  </svg>
                );
                const IconCheck = () => (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                );
                const IconTrash = () => (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M3 6h18" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" />
                    <path d="M8 6V4h8v2" stroke="#0f172a" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M19 6l-1 16H6L5 6" stroke="#0f172a" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M10 11v6" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" />
                    <path d="M14 11v6" stroke="#0f172a" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                );

                return (
                  <div
                    key={t.id}
                    style={{
                      border: isActive ? "1px solid #0f172a" : "1px solid #e2e8f0",
                      borderRadius: 12,
                      padding: effectiveLeftCollapsed ? 10 : 8,
                      background: isActive ? "#f1f5f9" : "white",
                      cursor: "pointer",
                      display: "grid",
                      gap: 6,
                    }}
                    onClick={() => {
                      setActiveUiToolId(null);
                      setIsToolsOpenMobile(false);
                      setActiveThreadId(t.id);
                      if (isMobile) setIsThreadsOpenMobile(false);
                    }}
                    title={effectiveLeftCollapsed ? t.title : undefined}
                  >
                    {isEditing && !effectiveLeftCollapsed ? (
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
                          boxSizing: "border-box",
                          border: "1px solid #cbd5e1",
                          borderRadius: 10,
                          padding: "8px 10px",
                          fontWeight: 500,
                        }}
                        placeholder="Topic name"
                      />
                    ) : (
                      <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {effectiveLeftCollapsed ? collapsedLabel : t.title}
                      </div>
                    )}

                    {!effectiveLeftCollapsed ? (
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <IconButton
                          title="Rename"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingThreadId(t.id);
                            setEditingTitle(t.title);
                          }}
                        >
                          <IconPencil />
                        </IconButton>

                        {isEditing ? (
                          <IconButton
                            title="Save"
                            disabled={renaming}
                            onClick={(e) => {
                              e.stopPropagation();
                              void renameThread(t.id, editingTitle);
                            }}
                          >
                            <IconCheck />
                          </IconButton>
                        ) : null}

                        <IconButton
                          title="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            archiveThread(t.id);
                          }}
                        >
                          <IconTrash />
                        </IconButton>
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

      <div className={styles.centerPane}>
        <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", background: "white", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <button
            className={styles.mobileOnly}
            onClick={() => setIsThreadsOpenMobile(true)}
            title="Topics"
            style={{
              border: "1px solid #e2e8f0",
              background: "white",
              borderRadius: 10,
              padding: "6px 8px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 900,
            }}
          >
            ☰
          </button>
          <div style={{ fontSize: 16, fontWeight: 600, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {threads.find((t) => t.id === effectiveThreadId)?.title ?? "Select a topic"}
          </div>
          {effectiveThreadId && !isMobile ? (
            <div className={styles.desktopOnly} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              {(activeThreadMeta?.toolIds ?? []).slice(0, 5).map((toolId: string) => (
                <ToolButton key={toolId} toolId={toolId} title={toolDisplayTitle(toolId)} variant="inline" />
              ))}
              <button
                onClick={() => void clearThreadMessages(effectiveThreadId)}
                title="Clear messages"
                style={{ border: "1px solid #e2e8f0", background: "white", borderRadius: 10, padding: "6px 8px", cursor: "pointer", fontSize: 12, fontWeight: 900 }}
              >
                🧹
              </button>
            </div>
          ) : null}
          {/* Mobile: don't show right-side header actions */}

        </div>

        {effectiveThreadId ? (
          <A2AChatRuntime
            key={`${effectiveThreadId}:${threadReloadNonce}`}
            session={session}
            threadId={effectiveThreadId}
            provider={activeThreadMeta?.llmProvider ?? "langgraph"}
            aiGatewayMode={activeThreadMeta?.aiGatewayMode ?? "grounded"}
            historyAdapter={historyAdapter}
            onFinalEnvelope={(env) => {
              setSending(false);
              const handoff = Array.isArray((env as any)?.handoff) ? ((env as any).handoff as any[]) : [];
              const uiTool = handoff.find((h) => h && typeof h === "object" && String((h as any).type || "").toLowerCase() === "ui_tool");
              const toolId = uiTool && typeof (uiTool as any).tool_id === "string" ? String((uiTool as any).tool_id) : null;
              const toolArgs =
                uiTool && (uiTool as any)?.args && typeof (uiTool as any).args === "object" ? ((uiTool as any).args as Record<string, unknown>) : null;
              if (toolId) {
                openTool(toolId, toolArgs);
                setHideBibleTool(false);
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
                  {threadEmpty === true ? <WelcomeCard /> : null}
                  <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage } as any} />
                </ThreadPrimitive.Viewport>

                <ThreadPrimitive.ScrollToBottom style={{ alignSelf: "center" }}>Scroll to bottom</ThreadPrimitive.ScrollToBottom>
              </ThreadPrimitive.Root>

              <div className={styles.composerWrap} style={{ padding: 14, display: "grid", gap: 10 }}>
                {sending ? (
                  <div
                    role="status"
                    aria-live="polite"
                    style={{
                      border: "1px solid #e2e8f0",
                      background: "#f8fafc",
                      borderRadius: 12,
                      padding: "10px 12px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 999,
                          border: "2px solid #cbd5e1",
                          borderTopColor: "#0f172a",
                          animation: "ccspin 900ms linear infinite",
                          flex: "0 0 auto",
                        }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>Thinking…</div>
                        <div style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", animation: "ccpulse 1400ms ease-in-out infinite" }}>
                          Working on your response
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800, flex: "0 0 auto" }}>Please wait</div>
                  </div>
                ) : null}

                {isMobile && activeUiToolId && !isToolsOpenMobile ? (
                  <button
                    type="button"
                    onClick={() => setIsToolsOpenMobile(true)}
                    style={{
                      border: "1px solid #e2e8f0",
                      background: "white",
                      borderRadius: 12,
                      padding: "10px 12px",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 900,
                      color: "#0f172a",
                      textAlign: "left",
                    }}
                  >
                    Open tool
                  </button>
                ) : null}

                <div
                  onKeyDownCapture={(e) => {
                    // Avoid flipping to "thinking" while typing; only when sending.
                    // Enter sends (without Shift) for the assistant-ui composer.
                    if (e.key === "Enter" && !e.shiftKey) {
                      setSending(true);
                      setThreadEmpty(false);
                    }
                  }}
                >
                  <Composer
                    disabled={sending}
                    onSend={() => {
                      setSending(true);
                      setThreadEmpty(false);
                    }}
                  />
                </div>
              </div>
            </div>
          </A2AChatRuntime>
        ) : (
          <div style={{ padding: 16, color: "#64748b" }}>Pick a topic on the left.</div>
        )}
      </div>

      {effectiveUiToolId ? (
        <div className={`${styles.toolPane} ${isMobile && isToolsOpenMobile ? styles.toolPaneOpen : ""}`}>
          <div style={{ height: "100%", minHeight: 0 }}>
            {effectiveUiToolId === "household_manager" ? (
              <HouseholdManagerPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                onClose={closeTool}
              />
            ) : effectiveUiToolId === "weekly_sermons" ? (
              <WeeklySermonsPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                onCompare={(anchorId: string) => void openSermonCompare(anchorId)}
                initialMessageId={
                  typeof (activeUiToolArgs as any)?.message_id === "string"
                    ? String((activeUiToolArgs as any).message_id)
                    : typeof (activeUiToolArgs as any)?.sermon_id === "string"
                      ? String((activeUiToolArgs as any).sermon_id)
                      : null
                }
                onClose={closeTool}
              />
            ) : effectiveUiToolId === "weekly_podcasts" ? (
              <WeeklySermonsPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                onCompare={(anchorId: string) => void openSermonCompare(anchorId)}
                initialMessageId={
                  typeof (activeUiToolArgs as any)?.message_id === "string"
                    ? String((activeUiToolArgs as any).message_id)
                    : typeof (activeUiToolArgs as any)?.sermon_id === "string"
                      ? String((activeUiToolArgs as any).sermon_id)
                      : null
                }
                onClose={closeTool}
              />
            ) : effectiveUiToolId === "community_manager" ? (
              <CommunityManagerPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                onClose={closeTool}
              />
            ) : effectiveUiToolId === "groups_manager" ? (
              <GroupsPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                onClose={closeTool}
              />
            ) : effectiveUiToolId === "kids_checkin" ? (
              <KidsCheckinPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                }}
                onClose={closeTool}
              />
            ) : effectiveUiToolId === "memory_manager" ? (
              <MemoryManagerPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                onClose={closeTool}
                onOpenTool={(toolId) => openTool(toolId)}
              />
            ) : effectiveUiToolId === "faith_journey" ? (
              <FaithJourneyPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                onClose={closeTool}
              />
            ) : effectiveUiToolId === "identity_contact" ? (
              <IdentityContactPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                onClose={closeTool}
              />
            ) : effectiveUiToolId === "comm_prefs" ? (
              <CommPrefsPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                onClose={closeTool}
              />
            ) : effectiveUiToolId === "care_pastoral" ? (
              <CarePastoralPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                onClose={closeTool}
              />
            ) : effectiveUiToolId === "teams_skills" ? (
              <TeamsSkillsPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                onClose={closeTool}
              />
            ) : effectiveUiToolId === "guide" ? (
              <GuidePanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                onClose={closeTool}
                onOpenTool={(toolId: string, args?: any) => openTool(toolId, args ?? null)}
              />
            ) : effectiveUiToolId === "church_overview" ? (
              <ChurchOverviewPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                onClose={closeTool}
                onOpenTool={(toolId: string) => openTool(toolId)}
              />
            ) : effectiveUiToolId === "strategic_intent" ? (
              <StrategicIntentPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                onClose={closeTool}
              />
            ) : effectiveUiToolId === "calendar" ? (
              <CalendarPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                onClose={closeTool}
              />
            ) : effectiveUiToolId === "bible_reader" ? (
              <BibleReaderPanel
                identity={{
                  tenant_id: identity.tenant_id,
                  user_id: identity.user_id,
                  role: identity.role as any,
                  campus_id: identity.campus_id ?? null,
                  timezone: identity.timezone ?? null,
                  persona_id: (identity as any).persona_id ?? null,
                }}
                initialRef={bibleRef}
                onClose={() => {
                  setActiveUiToolId(null);
                  setActiveUiToolArgs(null);
                  setIsToolsOpenMobile(false);
                  setHideBibleTool(true);
                }}
                showPlan={true}
              />
            ) : (
              <div style={{ padding: 14, color: "#64748b", background: "white", height: "100%" }}>Unknown tool: {effectiveUiToolId}</div>
            )}
          </div>
        </div>
      ) : null}

      {sermonCompareOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setSermonCompareOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2000,
            background: "rgba(15, 23, 42, 0.55)",
            display: "grid",
            placeItems: "center",
            padding: 12,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(1100px, 98vw)",
              height: "min(94dvh, 1100px)",
              background: "white",
              borderRadius: 16,
              border: "1px solid #e2e8f0",
              overflow: "hidden",
              display: "grid",
              gridTemplateRows: "auto 1fr",
              boxShadow: "0 30px 120px rgba(15, 23, 42, 0.38)",
            }}
          >
            <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 900 }}>Campus sermon comparison</div>
                <div style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  Uses full transcripts + cached notes
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => void openSermonCompare(sermonCompareAnchorId)}
                  disabled={sermonCompareLoading}
                  style={{
                    border: "1px solid #e2e8f0",
                    background: "white",
                    borderRadius: 10,
                    padding: "6px 10px",
                    cursor: sermonCompareLoading ? "not-allowed" : "pointer",
                    fontSize: 12,
                    opacity: sermonCompareLoading ? 0.7 : 1,
                  }}
                >
                  Refresh
                </button>
                <button
                  onClick={() => setSermonCompareOpen(false)}
                  style={{ border: "1px solid #e2e8f0", background: "white", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}
                >
                  Close
                </button>
              </div>
            </div>

            <div style={{ padding: 14, overflow: "auto", display: "grid", gap: 12, alignContent: "start", background: "#f8fafc" }}>
              {sermonCompareError ? <div style={{ color: "#b91c1c", fontSize: 12 }}>{sermonCompareError}</div> : null}
              {sermonCompareLoading ? <div style={{ fontSize: 12, color: "#64748b" }}>Comparing sermons…</div> : null}
              {sermonCompareMatch ? (
                <div style={{ fontSize: 12, color: "#334155" }}>
                  <strong>Matched:</strong> {String(sermonCompareMatch?.preachedDate ?? "")} · {String(sermonCompareMatch?.titleDisplay ?? "")}
                </div>
              ) : null}

              {sermonCompareIncluded.length ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>Included sermons</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {sermonCompareIncluded.map((s: any) => (
                      <div key={String(s?.id ?? crypto.randomUUID())} style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 10 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>{String(s?.title ?? "Sermon")}</div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>
                          {String(s?.campusId ?? "")}
                          {s?.preachedAt ? ` · ${String(s.preachedAt).slice(0, 10)}` : ""}
                          {s?.speaker ? ` · ${String(s.speaker)}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {sermonCompareMarkdown ? (
                <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>Comparison</div>
                  <div style={{ fontSize: 12, color: "#334155", whiteSpace: "pre-wrap" }}>{sermonCompareMarkdown}</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {newTopicOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setNewTopicOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2400,
            background: "rgba(15, 23, 42, 0.55)",
            display: "grid",
            placeItems: "center",
            padding: 12,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(920px, 98vw)",
              height: "min(84dvh, 820px)",
              background: "white",
              borderRadius: 16,
              border: "1px solid #e2e8f0",
              overflow: "hidden",
              display: "grid",
              gridTemplateRows: "auto auto 1fr",
              boxShadow: "0 30px 120px rgba(15, 23, 42, 0.38)",
            }}
          >
            <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 900 }}>New topic</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>Choose a template or start blank.</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => void loadTemplates()}
                  disabled={templateBusy}
                  style={{ border: "1px solid #e2e8f0", background: "white", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}
                >
                  Refresh
                </button>
                <button type="button" onClick={() => setNewTopicOpen(false)} style={{ border: "1px solid #e2e8f0", background: "white", borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}>
                  Close
                </button>
              </div>
            </div>

            <div style={{ padding: 14, borderBottom: "1px solid #e2e8f0", display: "grid", gap: 10 }}>
              {templateErr ? <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 800 }}>{templateErr}</div> : null}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>Search templates</div>
                  <input value={templateSearch} onChange={(e) => setTemplateSearch(e.target.value)} placeholder="e.g. faith journey, groups, sermon" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>Custom title (optional)</div>
                  <input value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} placeholder="Leave blank to use template title" style={{ border: "1px solid #cbd5e1", borderRadius: 10, padding: "8px 10px" }} />
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void createThread()}
                  style={{ border: "1px solid #0f172a", background: "#0f172a", color: "white", borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontSize: 12, fontWeight: 900 }}
                >
                  Create blank topic
                </button>
              </div>
            </div>

            <div style={{ padding: 14, overflow: "auto", background: "#f8fafc" }}>
              {templateBusy ? <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800 }}>Loading templates…</div> : null}
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
                {templates
                  .filter((t) => {
                    const q = templateSearch.trim().toLowerCase();
                    if (!q) return true;
                    return String(t.title).toLowerCase().includes(q) || String(t.slug).toLowerCase().includes(q) || String(t.description ?? "").toLowerCase().includes(q);
                  })
                  .map((t) => (
                    <button
                      key={t.slug}
                      type="button"
                      onClick={() => void createThreadFromTemplate(t)}
                      style={{
                        textAlign: "left",
                        border: "1px solid #e2e8f0",
                        background: "white",
                        borderRadius: 14,
                        padding: 12,
                        cursor: "pointer",
                        display: "grid",
                        gap: 8,
                      }}
                      title="Create topic from template"
                    >
                      <div style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }}>{t.title}</div>
                      {t.description ? <div style={{ fontSize: 12, color: "#64748b" }}>{t.description}</div> : null}
                      {(t.toolIds?.length ?? 0) ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {t.toolIds!.slice(0, 4).map((toolId) => (
                            <span key={toolId} style={{ fontSize: 11, fontWeight: 900, color: "#0f172a", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 999, padding: "3px 8px" }}>
                              {toolDisplayTitle(toolId)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

