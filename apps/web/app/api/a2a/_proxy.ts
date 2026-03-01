import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function forwardToA2A(req: Request, path: string) {
  const base = (process.env.A2A_GATEWAY_URL ?? "").trim();
  if (!base) {
    return NextResponse.json({ error: "Missing A2A_GATEWAY_URL" }, { status: 500 });
  }

  const apiKey = (process.env.A2A_GATEWAY_API_KEY ?? "").trim();
  const url = `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;

  const bodyText = await req.text();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: bodyText || "{}",
  });

  const contentType = res.headers.get("content-type") ?? "application/json";
  const raw = await res.text();

  return new NextResponse(raw, { status: res.status, headers: { "content-type": contentType } });
}

