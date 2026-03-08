import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTICTRUST_TTL_FILES, agentictrustUrl } from './manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, '..');
const outDir = path.join(pkgRoot, 'ontology');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function fetchText(url) {
  const res = await fetch(url, { method: 'GET', headers: { accept: 'text/turtle, text/plain;q=0.9, */*;q=0.1' } });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}\n${text.slice(0, 400)}`);
  return text;
}

async function main() {
  ensureDir(outDir);

  let ok = 0;
  for (const f of AGENTICTRUST_TTL_FILES) {
    const url = agentictrustUrl(f);
    const body = await fetchText(url);
    fs.writeFileSync(path.join(outDir, f), body, 'utf8');
    ok++;
  }

  // eslint-disable-next-line no-console
  console.log(`[agentictrust-ontology] downloaded ${ok}/${AGENTICTRUST_TTL_FILES.length} ttl files to ${outDir}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(`[agentictrust-ontology] download failed`, e);
  process.exitCode = 1;
});

