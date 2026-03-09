#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function usageAndExit(code = 1) {
  // Keep this short; user asked for terse output.
  // eslint-disable-next-line no-console
  console.error(
    [
      "Usage: node tools/load-ontology-to-graphdb.mjs [--context <iri>] [--root <repoRoot>] [--packages <csv>]",
      "",
      "Env (required): GRAPHDB_BASE_URL, GRAPHDB_REPOSITORY",
      "Env (optional): GRAPHDB_USERNAME, GRAPHDB_PASSWORD, GRAPHDB_CF_ACCESS_CLIENT_ID, GRAPHDB_CF_ACCESS_CLIENT_SECRET",
      "",
      "Example:",
      '  GRAPHDB_BASE_URL="https://graphdb.example.com" GRAPHDB_REPOSITORY="churchcore" \\',
      '    node tools/load-ontology-to-graphdb.mjs --context "https://churchcore.ai/graph/ontology"',
    ].join("\n"),
  );
  process.exit(code);
}

function parseArgs(argv) {
  const out = { context: "https://churchcore.ai/graph/ontology", root: process.cwd(), packages: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--context") out.context = String(argv[++i] || "").trim();
    else if (a === "--root") out.root = String(argv[++i] || "").trim();
    else if (a === "--packages") out.packages = String(argv[++i] || "").trim();
    else if (a === "-h" || a === "--help") usageAndExit(0);
  }
  if (!out.context) throw new Error("missing --context");
  if (!out.root) throw new Error("missing --root");
  return out;
}

function base64EncodeUtf8(input) {
  return Buffer.from(String(input ?? ""), "utf8").toString("base64");
}

function graphDbConfigFromEnv() {
  const baseUrl = String(process.env.GRAPHDB_BASE_URL || "").trim().replace(/\/+$/, "");
  const repo = String(process.env.GRAPHDB_REPOSITORY || "").trim();
  if (!baseUrl || !repo) throw new Error("Missing GRAPHDB_BASE_URL / GRAPHDB_REPOSITORY");
  return { baseUrl, repo };
}

function graphDbHeadersFromEnv(accept) {
  const headers = {
    accept: accept || "application/json",
  };
  const username = String(process.env.GRAPHDB_USERNAME || "").trim();
  const password = String(process.env.GRAPHDB_PASSWORD || "").trim();
  const cfId = String(process.env.GRAPHDB_CF_ACCESS_CLIENT_ID || "").trim();
  const cfSecret = String(process.env.GRAPHDB_CF_ACCESS_CLIENT_SECRET || "").trim();
  if (username && password) headers.Authorization = `Basic ${base64EncodeUtf8(`${username}:${password}`)}`;
  if (cfId && cfSecret) {
    headers["CF-Access-Client-Id"] = cfId;
    headers["CF-Access-Client-Secret"] = cfSecret;
  }
  return headers;
}

function listTtlFilesRecursive(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) break;
    let entries = [];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) {
        // Skip common junk
        if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
        stack.push(p);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".ttl")) {
        out.push(p);
      }
    }
  }
  return out;
}

function resolveOntologyRoots(repoRoot, packagesCsv) {
  const pkgsRoot = path.join(repoRoot, "packages");
  const requested = (packagesCsv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let packageDirs = [];
  if (requested.length) {
    packageDirs = requested.map((name) => path.join(pkgsRoot, name, "ontology"));
  } else {
    // default: every packages/*/ontology folder that exists
    let entries = [];
    try {
      entries = fs.readdirSync(pkgsRoot, { withFileTypes: true });
    } catch {
      entries = [];
    }
    packageDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(pkgsRoot, e.name, "ontology"))
      .filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
  }
  return packageDirs;
}

async function graphDbClearGraph({ baseUrl, repo }, contextIri) {
  const url = `${baseUrl}/repositories/${encodeURIComponent(repo)}/statements?context=${encodeURIComponent(`<${contextIri}>`)}`;
  const res = await fetch(url, { method: "DELETE", headers: graphDbHeadersFromEnv("application/json") });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`GraphDB clear graph failed (${res.status}): ${text.slice(0, 1000)}`);
}

async function graphDbUploadTurtle({ baseUrl, repo }, contextIri, turtle, sourceLabel) {
  const url = `${baseUrl}/repositories/${encodeURIComponent(repo)}/statements?context=${encodeURIComponent(`<${contextIri}>`)}`;
  const headers = {
    ...graphDbHeadersFromEnv("application/json"),
    "content-type": "text/turtle;charset=UTF-8",
  };
  const res = await fetch(url, { method: "POST", headers, body: turtle });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `GraphDB upload failed (${res.status}) for ${sourceLabel || "turtle"}: ${text.slice(0, 1000)}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = graphDbConfigFromEnv();

  const roots = resolveOntologyRoots(args.root, args.packages);
  const files = roots.flatMap((r) => listTtlFilesRecursive(r)).sort();
  if (!files.length) throw new Error("No .ttl files found under packages/*/ontology");

  // eslint-disable-next-line no-console
  console.log(`[graphdb] clearing ontology graph: ${args.context}`);
  await graphDbClearGraph(cfg, args.context);

  // eslint-disable-next-line no-console
  console.log(`[graphdb] uploading ${files.length} ttl files...`);
  let uploaded = 0;
  for (const f of files) {
    const turtle = fs.readFileSync(f, "utf8");
    if (!String(turtle || "").trim()) continue;
    await graphDbUploadTurtle(cfg, args.context, turtle, path.relative(args.root, f));
    uploaded += 1;
  }

  // eslint-disable-next-line no-console
  console.log(`[graphdb] done. files_uploaded=${uploaded} context=${args.context}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(String(e?.message ?? e ?? "error"));
  usageAndExit(1);
});

