import { chromium } from "playwright";

function pickBaseUrl() {
  const raw = process.env.BASE_URL || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

async function main() {
  const baseUrl = pickBaseUrl();
  const url = `${baseUrl}/chat`;
  const question = process.env.QUESTION || "latest sermons";

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const hits = [];

  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("/api/a2a/chat/stream")) {
      hits.push({ type: "request", url: u, method: req.method() });
      // eslint-disable-next-line no-console
      console.log(`[hit] request ${req.method()} ${u}`);
    }
  });

  page.on("response", async (res) => {
    const u = res.url();
    if (u.includes("/api/a2a/chat/stream")) {
      const headers = res.headers();
      hits.push({ type: "response", url: u, status: res.status(), contentType: headers["content-type"] || "" });
      // eslint-disable-next-line no-console
      console.log(`[hit] response ${res.status()} content-type=${headers["content-type"] || ""}`);
    }
  });

  // eslint-disable-next-line no-console
  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Composer input is rendered by assistant-ui; use placeholder text from ChatPage.
  const input = page.getByPlaceholder("Message Church Agent…");
  await input.waitFor({ state: "visible", timeout: 30_000 });
  await input.fill(question);

  const send = page.getByRole("button", { name: "Send" });
  await send.waitFor({ state: "visible", timeout: 10_000 });

  // Kick off send and wait until we see the stream request.
  await Promise.all([page.waitForRequest((r) => r.url().includes("/api/a2a/chat/stream"), { timeout: 30_000 }), send.click()]);

  // Wait until we see a stream response too.
  await page.waitForResponse((r) => r.url().includes("/api/a2a/chat/stream"), { timeout: 30_000 });

  // Give the UI a moment to render the assistant message.
  await page.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log(`Done. saw_stream_request=${hits.some((h) => h.type === "request")} saw_stream_response=${hits.some((h) => h.type === "response")}`);

  await browser.close();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

