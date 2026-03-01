import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  skill: z.string().min(1),
  message: z.string().optional().nullable(),
  args: z.record(z.string(), z.unknown()).optional().nullable(),
  session: z.unknown(),
});

function sseEncode(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function chunkText(txt: string, size: number) {
  const out: string[] = [];
  for (let i = 0; i < txt.length; i += size) out.push(txt.slice(i, i + size));
  return out;
}

export async function POST(req: Request) {
  const deploymentUrl = process.env.LANGGRAPH_DEPLOYMENT_URL ?? "";
  const apiKey = process.env.LANGSMITH_API_KEY ?? "";
  const assistantId = process.env.LANGGRAPH_ASSISTANT_ID ?? "church_agent";

  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return new Response(sseEncode("error", { error: "Invalid body", issues: parsed.error.issues }), {
      status: 400,
      headers: { "content-type": "text/event-stream" },
    });
  }

  const body = parsed.data;
  const session =
    body.session && typeof body.session === "object" ? (body.session as Record<string, unknown>) : undefined;
  const threadId = session && typeof (session as any).threadId === "string" ? String((session as any).threadId) : undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(sseEncode(event, data)));

      send("meta", { ok: true, mode: "shim" });

      if (!deploymentUrl || !apiKey) {
        const msg =
          "Local fallback streaming (set LANGGRAPH_DEPLOYMENT_URL + LANGSMITH_API_KEY to use hosted streaming).";
        for (const part of chunkText(msg, 18)) send("token", part);
        send("done", { message: msg });
        controller.close();
        return;
      }

      try {
        const url = `${deploymentUrl.replace(/\/$/, "")}/runs/wait`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({
            assistant_id: assistantId,
            input: { skill: "chat.stream", message: body.message ?? null, args: body.args ?? null, session },
            config: threadId ? { configurable: { thread_id: threadId } } : undefined,
          }),
        });

        const json = (await res.json().catch(() => ({}))) as any;
        if (!res.ok) {
          send("error", json);
          controller.close();
          return;
        }

        // Shim: /runs/wait returns { output: <final_state> }.
        const state = (json?.output ?? null) as any;
        const output = state && typeof state === "object" ? (state.output ?? state) : {};
        const message = typeof (output as any)?.message === "string" ? (output as any).message : "";
        for (const part of chunkText(message, 24)) send("token", part);
        send("final", output);
        send("done", { ok: true });
        controller.close();
      } catch (e: any) {
        send("error", { error: String(e?.message ?? e) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

