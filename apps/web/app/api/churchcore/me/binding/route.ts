import { NextResponse } from "next/server";
import { z } from "zod";

import { callChurchcoreTool } from "../../../../../lib/churchcoreMcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  churchId: z.string().min(1),
  userId: z.string().min(1),
});

export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const out = await callChurchcoreTool("churchcore_user_get_binding", parsed.data);
  return NextResponse.json(out ?? {});
}

