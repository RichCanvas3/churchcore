import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const base = (process.env.A2A_GATEWAY_URL ?? "").trim();
  if (!base) return NextResponse.json({ error: "Missing A2A_GATEWAY_URL" }, { status: 500 });

  const apiKey = (process.env.A2A_GATEWAY_API_KEY ?? "").trim();
  const url = `${base.replace(/\/$/, "")}/.well-known/agent-card.json`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    cache: "no-store",
  });

  const raw = await res.text();
  return new NextResponse(raw, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json; charset=utf-8" },
  });
}

