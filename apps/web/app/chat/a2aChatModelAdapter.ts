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
      // Support both LF and CRLF framing.
      const idxN = buf.indexOf("\n\n");
      const idxR = buf.indexOf("\r\n\r\n");
      let idx = -1;
      let delimLen = 0;
      if (idxN !== -1 && (idxR === -1 || idxN < idxR)) {
        idx = idxN;
        delimLen = 2;
      } else if (idxR !== -1) {
        idx = idxR;
        delimLen = 4;
      }
      if (idx < 0) break;
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + delimLen);

      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        const ln = line.trimEnd();
        if (ln.startsWith("event:")) event = ln.slice("event:".length).trim();
        if (ln.startsWith("data:")) dataLines.push(ln.slice("data:".length).trimEnd());
      }
      yield { event, data: dataLines.join("\n") };
    }
  }

  // Flush trailing SSE block (some servers don't end with a blank line).
  const tail = buf.trim();
  if (tail) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of tail.split("\n")) {
      const ln = line.trimEnd();
      if (ln.startsWith("event:")) event = ln.slice("event:".length).trim();
      if (ln.startsWith("data:")) dataLines.push(ln.slice("data:".length).trimEnd());
    }
    yield { event, data: dataLines.join("\n") };
  }
}

export function makeA2AChatModelAdapter(args: {
  session: Session;
  threadId: string;
  provider?: "langgraph" | "ai_gateway";
  aiGatewayMode?: "general" | "grounded" | "auto";
  onFinalEnvelope?: (env: OutputEnvelope | null) => void;
}): ChatModelAdapter {
  const { session, threadId, onFinalEnvelope } = args;
  const provider = args.provider ?? "langgraph";
  const aiGatewayMode = args.aiGatewayMode ?? "grounded";

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

      try {
        const endpoint = provider === "ai_gateway" ? "/api/a2a/chat/ai_gateway/stream" : "/api/a2a/chat/stream";
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
            ...(provider === "ai_gateway" ? { mode: aiGatewayMode } : {}),
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
            continue;
          }

          if (ev.event === "final") {
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
            yield ({ content: [{ type: "text", text: textWithTools }] } as any);
            return; // Don't hang if the server keeps the stream open.
          }

          if (ev.event === "done") {
            if (onFinalEnvelope) onFinalEnvelope(finalEnv);
            return;
          }

          if (ev.event === "error") {
            // Gateway uses JSON: {"error":"..."}.
            const j = (() => {
              try {
                return JSON.parse(ev.data);
              } catch {
                return null;
              }
            })();
            const msg = typeof j?.error === "string" ? j.error : ev.data || "A2A stream error";
            throw new Error(msg);
          }
        }

        // If the stream ends without a final envelope, unblock the UI and show what we got.
        if (onFinalEnvelope) onFinalEnvelope(finalEnv);
        if (fullText.trim()) yield ({ content: [{ type: "text", text: fullText }] } as any);
      } catch (e: any) {
        if (onFinalEnvelope) onFinalEnvelope(null);
        const msg = String(e?.message ?? e ?? "Chat failed");
        yield ({ content: [{ type: "text", text: `Error: ${msg}` }] } as any);
        return;
      }
    },
  };

  return adapter;
}

