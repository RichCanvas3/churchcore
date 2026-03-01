import { z } from "zod";

function sseFirstJson(text: string): unknown {
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice("data:".length).trim();
    if (!payload) continue;
    try {
      return JSON.parse(payload);
    } catch {
      continue;
    }
  }
  return null;
}

async function callMcp(method: string, params: Record<string, unknown>) {
  const url = (process.env.CHURCHCORE_MCP_URL ?? "").trim();
  if (!url) throw new Error("Missing CHURCHCORE_MCP_URL");

  const apiKey = (process.env.CHURCHCORE_MCP_API_KEY ?? "").trim();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: String(Date.now()),
      method,
      params,
    }),
  });

  const rawText = await res.text();
  const contentType = res.headers.get("content-type") ?? "";

  const parsed =
    contentType.includes("text/event-stream") ? sseFirstJson(rawText) : (rawText ? JSON.parse(rawText) : null);

  if (!res.ok) {
    throw new Error(`ChurchCore MCP HTTP ${res.status}: ${rawText.slice(0, 400)}`);
  }

  return parsed as any;
}

const McpToolCallSchema = z.object({
  result: z.object({
    content: z
      .array(
        z.object({
          type: z.string(),
          text: z.string().optional(),
        }),
      )
      .optional(),
  }),
});

function extractJsonContent(obj: unknown): unknown {
  const parsed = McpToolCallSchema.safeParse(obj);
  if (!parsed.success) return null;
  const blocks = parsed.data.result.content ?? [];
  for (const b of blocks) {
    if (typeof b.text !== "string") continue;
    try {
      return JSON.parse(b.text);
    } catch {
      return b.text;
    }
  }
  return null;
}

export async function callChurchcoreTool<T = unknown>(toolName: string, args: Record<string, unknown>) {
  const resp = await callMcp("tools/call", { name: toolName, arguments: args });
  const content = extractJsonContent(resp);
  return content as T;
}

