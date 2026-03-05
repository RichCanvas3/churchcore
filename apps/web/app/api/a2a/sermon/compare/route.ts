import { forwardToA2A } from "../../_proxy";

export async function POST(req: Request) {
  return forwardToA2A(req, "/a2a/sermon.compare");
}

