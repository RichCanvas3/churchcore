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
  onFinalEnvelope?: (env: OutputEnvelope | null) => void;
}): ChatModelAdapter {
  const { session, threadId, onFinalEnvelope } = args;

  const adapter: ChatModelAdapter = {
    async *run({ messages, abortSignal }: any) {
      const last = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;
      const userText = extractTextFromMessage(last);
      if (!userText.trim()) return;

      const res = await fetch("/api/a2a/chat/stream", {
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
          yield { content: [{ type: "text", text: fullText }] };
        } else if (ev.event === "final") {
          try {
            finalEnv = JSON.parse(ev.data) as OutputEnvelope;
          } catch {
            finalEnv = null;
          }
          const finalText = typeof finalEnv?.message === "string" ? finalEnv.message : fullText;
          fullText = finalText;
          if (onFinalEnvelope) onFinalEnvelope(finalEnv);
          yield { content: [{ type: "text", text: fullText }] };
        } else if (ev.event === "error") {
          throw new Error(ev.data || "A2A stream error");
        }
      }
    },
  };

  return adapter;
}

