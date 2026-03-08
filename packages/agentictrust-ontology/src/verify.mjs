import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTICTRUST_TTL_FILES } from './manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, '..');
const outDir = path.join(pkgRoot, 'ontology');

function main() {
  const missing = [];
  for (const f of AGENTICTRUST_TTL_FILES) {
    const p = path.join(outDir, f);
    if (!fs.existsSync(p)) missing.push(f);
  }
  if (missing.length) {
    throw new Error(`Missing ontology files in ${outDir}:\n- ${missing.join('\n- ')}\nRun: pnpm -C ${pkgRoot} download`);
  }
}

try {
  main();
  // eslint-disable-next-line no-console
  console.log('[agentictrust-ontology] ok');
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[agentictrust-ontology] verify failed', e);
  process.exitCode = 1;
}

