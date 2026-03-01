import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  skill: z.string().min(1),
  message: z.string().optional().nullable(),
  args: z.record(z.string(), z.unknown()).optional().nullable(),
  session: z.unknown(),
});

function localFallback(body: z.infer<typeof BodySchema>) {
  return {
    message:
      "Local fallback response (set LANGGRAPH_DEPLOYMENT_URL + LANGSMITH_API_KEY to use the hosted Church Agent).",
    suggested_next_actions: [
      { title: "List service times", skill: "discover.service_times" },
      { title: "List events", skill: "discover.events" },
    ],
    cards: [
      {
        type: "info",
        title: "Hosted agent not configured",
        body: "This repo is wired for LangSmith Deployments. Add env vars and retry.",
      },
    ],
    forms: [],
    handoff: [],
    data: { received: body },
    citations: [],
  };
}

export async function POST(req: Request) {
  const deploymentUrl = process.env.LANGGRAPH_DEPLOYMENT_URL ?? "";
  const apiKey = process.env.LANGSMITH_API_KEY ?? "";
  const assistantId = process.env.LANGGRAPH_ASSISTANT_ID ?? "church_agent";

  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const body = parsed.data;

  if (!deploymentUrl || !apiKey) {
    return NextResponse.json(localFallback(body));
  }

  const session =
    body.session && typeof body.session === "object" ? (body.session as Record<string, unknown>) : undefined;
  const threadId = session && typeof (session as any).threadId === "string" ? String((session as any).threadId) : undefined;

  const url = `${deploymentUrl.replace(/\/$/, "")}/runs/wait`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      assistant_id: assistantId,
      input: { skill: body.skill, message: body.message ?? null, args: body.args ?? null, session },
      config: threadId ? { configurable: { thread_id: threadId } } : undefined,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) return NextResponse.json(json, { status: res.status });

  const output = (json.output ?? {}) as Record<string, unknown>;
  return NextResponse.json(output);
}

