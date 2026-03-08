import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, '..');

const required = [
  'ontology/churchcore-upper-core.ttl',
  'ontology/churchcore-upper-planning.ttl',
  'ontology/churchcore-upper-provenance.ttl',
  'ontology/churchcore-upper-situations.ttl',
  'ontology/churchcore-upper-community.ttl',
  'ontology/churchcore-upper-bible.ttl',
  'ontology/churchcore-upper-discipleship.ttl',
  'ontology/churchcore-all.ttl',
];

function main() {
  const missing = required.filter((p) => !fs.existsSync(path.join(pkgRoot, p)));
  if (missing.length) {
    throw new Error(`Missing ontology files:\n- ${missing.join('\n- ')}`);
  }
}

try {
  main();
  // eslint-disable-next-line no-console
  console.log('[churchcore-ontology] ok');
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[churchcore-ontology] verify failed', e);
  process.exitCode = 1;
}

