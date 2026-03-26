import { forwardToA2A } from "../../_proxy";

// This endpoint can be slow because it runs a hosted agent comparison.
export const maxDuration = 300;

export async function POST(req: Request) {
  return forwardToA2A(req, "/a2a/sermon.compare");
}

