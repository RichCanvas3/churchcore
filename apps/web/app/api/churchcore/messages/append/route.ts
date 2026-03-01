import { NextResponse } from "next/server";
import { z } from "zod";

import { callChurchcoreTool } from "../../../../../lib/churchcoreMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  churchId: z.string().min(1),
  userId: z.string().min(1),
  threadId: z.string().min(1),
  senderType: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  envelope: z.unknown().optional(),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const out = await callChurchcoreTool("churchcore_chat_append_message", parsed.data as any);
  return NextResponse.json(out ?? {});
}

