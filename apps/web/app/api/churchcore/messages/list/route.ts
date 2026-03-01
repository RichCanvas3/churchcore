import { NextResponse } from "next/server";
import { z } from "zod";

import { callChurchcoreTool } from "../../../../../lib/churchcoreMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  churchId: z.string().min(1),
  userId: z.string().min(1),
  threadId: z.string().min(1),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const out = await callChurchcoreTool("churchcore_chat_list_messages", parsed.data);
  return NextResponse.json(out ?? {});
}

