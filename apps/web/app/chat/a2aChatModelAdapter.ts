"use client";

import type { ChatModelAdapter } from "@assistant-ui/react";
import type { OutputEnvelope, Session } from "../../lib/types";

function extractTextFromMessage(msg: any): string {
  const content = msg?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p: any) => {
      if (typeof p === "string") return p;
      if (p && typeof p === "object" && p.type === "text" && typeof p.text === "string") return p.text;
      return "";
    })
    .join("");
}

type SseEvent = { event: string; data: string };

async function* readSseEvents(res: Response): AsyncGenerator<SseEvent> {
  const reader = res.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    while (true) {
      const idx = buf.indexOf("\n\n");
      if (idx < 0) break;
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice("event:".length).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimEnd());
      }
      yield { event, data: dataLines.join("\n") };
    }
  }
}

export function makeA2AChatModelAdapter(args: {
  session: Session;
  threadId: string;
  provider?: "langgraph" | "gloo";
  glooMode?: "general" | "grounded" | "auto";
  onFinalEnvelope?: (env: OutputEnvelope | null) => void;
}): ChatModelAdapter {
  const { session, threadId, onFinalEnvelope } = args;
  const provider = args.provider ?? "langgraph";
  const glooMode = args.glooMode ?? "grounded";

  function appendUiToolSnippets(text: string, tools: Array<{ toolId: string; title?: string }>) {
    const ids = tools.map((t) => String(t.toolId || "").trim()).filter(Boolean);
    if (!ids.length) return text;
    const snippets = ids.map((id) => `{"type":"ui_tool","tool_id":"${id.replace(/"/g, "")}"}`).join("\n");
    return `${text}\n\n${snippets}`;
  }

  const adapter: ChatModelAdapter = {
    async *run({ messages, abortSignal }: any) {
      const last = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;
      const userText = extractTextFromMessage(last);
      if (!userText.trim()) return;

      const endpoint = provider === "gloo" ? "/api/a2a/chat/gloo/stream" : "/api/a2a/chat/stream";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        signal: abortSignal,
        body: JSON.stringify({
          identity: {
            tenant_id: session.churchId,
            user_id: session.userId,
            role: session.role,
            campus_id: session.campusId ?? undefined,
            timezone: session.timezone,
            persona_id: session.personId ?? undefined,
          },
          thread_id: threadId,
          message: userText,
          skill: "chat",
          args: null,
          ...(provider === "gloo" ? { mode: glooMode } : {}),
        }),
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `A2A stream failed (${res.status})`);
      }

      let fullText = "";
      let finalEnv: OutputEnvelope | null = null;

      for await (const ev of readSseEvents(res)) {
        if (ev.event === "token") {
          fullText += ev.data;
          yield ({ content: [{ type: "text", text: fullText }] } as any);
        } else if (ev.event === "final") {
          try {
            finalEnv = JSON.parse(ev.data) as OutputEnvelope;
          } catch {
            finalEnv = null;
          }
          const finalText = typeof finalEnv?.message === "string" ? finalEnv.message : fullText;
          fullText = finalText;
          if (onFinalEnvelope) onFinalEnvelope(finalEnv);
          const handoff = Array.isArray((finalEnv as any)?.handoff) ? ((finalEnv as any).handoff as any[]) : [];
          const tools = handoff
            .filter((h) => h && typeof h === "object" && String((h as any).type || "").toLowerCase() === "ui_tool" && typeof (h as any).tool_id === "string")
            .map((h) => ({
              toolId: String((h as any).tool_id),
              title: typeof (h as any).title === "string" ? String((h as any).title) : String((h as any).tool_id),
            }));
          const textWithTools = appendUiToolSnippets(fullText, tools);
          yield ({
            content: [{ type: "text", text: textWithTools }],
          } as any);
        } else if (ev.event === "error") {
          throw new Error(ev.data || "A2A stream error");
        }
      }
    },
  };

  return adapter;
}

