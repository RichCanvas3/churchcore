import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function forwardToA2A(req: Request, path: string) {
  try {
    const base = (process.env.A2A_GATEWAY_URL ?? "").trim();
    if (!base) {
      return NextResponse.json({ error: "Missing A2A_GATEWAY_URL" }, { status: 500 });
    }

    const apiKey = (process.env.A2A_GATEWAY_API_KEY ?? "").trim();
    const url = `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

    const bodyText = await req.text();
    // IMPORTANT: ensure we get response headers quickly.
    // If the gateway is down/unreachable, we don't want the client to hang forever.
    const controller = new AbortController();
    // Streaming endpoints should respond quickly with headers; non-stream endpoints may take longer
    // (e.g. sermon.compare calls hosted LangGraph and can exceed 30s).
    const isStream = path.endsWith(".stream") || path.includes("chat.stream");
    const timeoutMs = isStream ? 30_000 : 180_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: bodyText || "{}",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const contentType = res.headers.get("content-type") ?? "application/json";

    // IMPORTANT: don't buffer SSE; stream it through.
    if (contentType.includes("text/event-stream") && res.body) {
      return new NextResponse(res.body, {
        status: res.status,
        headers: {
          "content-type": contentType,
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
      });
    }

    const raw = await res.text();
    return new NextResponse(raw, { status: res.status, headers: { "content-type": contentType } });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "A2A proxy failed",
        detail: String(
          e?.name === "AbortError"
            ? "Gateway timed out waiting for response. This can happen on long-running calls (e.g. sermon compare)."
            : e?.message ?? e ?? "error",
        ),
      },
      { status: 500 },
    );
  }
}

