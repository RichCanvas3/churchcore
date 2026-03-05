import fs from "fs";
import path from "path";
import OpenAI from "openai";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { spawnSync, execSync } from "child_process";

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

const messageId = arg("--messageId");
if (!messageId) {
  console.error("Missing --messageId (e.g. msg_2479)");
  process.exit(1);
}

const workerBase = (arg("--worker") ?? process.env.CCH_WORKER ?? "https://churchcore-mcp.richardpedersen3.workers.dev").replace(/\/+$/, "");
const apiKeyHeader = process.env.MCP_API_KEY ? { "x-api-key": process.env.MCP_API_KEY } : {};

// Resolve audio URL via remote D1 (requires wrangler auth configured).
const sql = `SELECT download_url AS downloadUrl, listen_url AS listenUrl FROM campus_messages WHERE church_id='calvarybible' AND id='${messageId.replace(/'/g, "''")}' LIMIT 1;`;
const raw = execSync(`wrangler d1 execute churchcore --remote --command "${sql.replace(/"/g, '\\"')}"`, { stdio: ["ignore", "pipe", "inherit"] }).toString();
const m = raw.match(/\[\s*\{\s*"results"\s*:\s*(\[[\s\S]*?\])\s*,\s*"success"/);
const results = m ? JSON.parse(m[1]) : [];
const row = results?.[0] ?? null;
const audioUrl = String(row?.downloadUrl || row?.listenUrl || "").trim();
if (!audioUrl) {
  console.error("No download_url/listen_url found for messageId.");
  process.exit(1);
}

const tmpDir = arg("--outDir") ?? process.env.CCH_TMP ?? ".tmp";
fs.mkdirSync(tmpDir, { recursive: true });
const ext = audioUrl.toLowerCase().includes(".m4a") ? "m4a" : audioUrl.toLowerCase().includes(".mp3") ? "mp3" : "audio";
const filePath = path.join(tmpDir, `${messageId}.${ext}`);

if (!fs.existsSync(filePath)) {
  const r = await fetch(audioUrl, { redirect: "follow" });
  if (!r.ok) throw new Error(`Failed to download audio (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(filePath, buf);
}

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in environment.");
  process.exit(1);
}

function getFfprobePath() {
  const override = arg("--ffprobe") ?? process.env.CCH_FFPROBE;
  if (override) return override;
  const p = ffprobeInstaller?.path;
  if (p && fs.existsSync(p)) return p;
  throw new Error(
    "ffprobe_unavailable: install ffmpeg/ffprobe or run `pnpm approve-builds` to allow @ffprobe-installer/linux-x64 postinstall, then reinstall/rebuild.",
  );
}

function getFfmpegPath() {
  const override = arg("--ffmpeg") ?? process.env.CCH_FFMPEG;
  if (override) return override;
  const p = ffmpegInstaller?.path;
  if (p && fs.existsSync(p)) return p;
  throw new Error(
    "ffmpeg_unavailable: install ffmpeg or run `pnpm approve-builds` to allow @ffmpeg-installer/linux-x64 postinstall, then reinstall/rebuild.",
  );
}

function probeDurationSeconds(p) {
  const ffprobe = getFfprobePath();
  const r = spawnSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", p], {
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  const s = String(r.stdout ?? "").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function splitAudioToMp3Segments(inputPath, outDir, segmentSeconds) {
  const ffmpeg = getFfmpegPath();
  const outPattern = path.join(outDir, `${path.basename(inputPath)}.part-%03d.mp3`);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "64k",
    "-f",
    "segment",
    "-segment_time",
    String(segmentSeconds),
    "-reset_timestamps",
    "1",
    outPattern,
  ];
  const r = spawnSync(ffmpeg, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg_split_failed");
  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith(path.basename(inputPath) + ".part-") && f.endsWith(".mp3"))
    .sort()
    .map((f) => path.join(outDir, f));
  if (!files.length) throw new Error("no_segments_created");
  return files;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const transcribeModel = process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1";

async function transcribeOne(p) {
  const transcript = await openai.audio.transcriptions.create({
    file: fs.createReadStream(p),
    model: transcribeModel,
  });
  return String(transcript?.text ?? "").trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function transcribeOneWithRetry(p, tries = 4) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await transcribeOne(p);
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message ?? e ?? "");
      const isDuration = msg.includes("audio duration") || msg.includes("invalid_value");
      if (isDuration) throw e;
      const isConn =
        msg.toLowerCase().includes("connection error") ||
        msg.toLowerCase().includes("fetch failed") ||
        msg.toLowerCase().includes("other side closed") ||
        msg.includes("UND_ERR_SOCKET");
      if (!isConn) throw e;
      await sleep(1000 * Math.pow(2, i));
    }
  }
  throw lastErr ?? new Error("transcribe_failed");
}

async function transcribeWithAutoSplit(p) {
  const duration = probeDurationSeconds(p);
  const bytes = fs.statSync(p).size;
  // Never try uploading huge originals; split+downsample to keep chunks small and under model caps.
  const needsSplit = bytes > 20 * 1024 * 1024 || duration === null || duration > 1300;
  if (!needsSplit) return await transcribeOneWithRetry(p);

  const segDir = path.join(tmpDir, `${messageId}.segments`);
  fs.mkdirSync(segDir, { recursive: true });
  const segments = splitAudioToMp3Segments(p, segDir, 1200);
  const parts = [];
  for (let i = 0; i < segments.length; i++) {
    const t = await transcribeOneWithRetry(segments[i]);
    parts.push(t);
  }
  return parts.filter(Boolean).join("\n\n");
}

const transcriptText = await transcribeWithAutoSplit(filePath);

if (!transcriptText) {
  console.error("Empty transcript returned.");
  process.exit(1);
}

const resp = await fetch(`${workerBase}/admin/upsert-message-transcript`, {
  method: "POST",
  headers: { "content-type": "application/json", ...apiKeyHeader },
  body: JSON.stringify({
    messageId,
    transcriptText,
    transcriptSource: audioUrl,
    transcriptModel: transcribeModel,
  }),
});

const out = await resp.text();
console.log(out);
if (!resp.ok) process.exit(1);

