import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, '..');

const required = [
  'ontology/churchcore-congregation.ttl',
  'ontology/churchcore-congregation-all.ttl',
  'ontology/tbox/ops.ttl',
  'ontology/tbox/audience.ttl',
  'ontology/cbox/empty.ttl',
  'ontology/cbox/ministry-categories.ttl',
  'ontology/cbox/audience-segments.ttl',
  'ontology/cbox/congregation-lifecycle-states.ttl',
  'ontology/cbox/congregation-lifecycle-graph.ttl',
  'ontology/cbox/program-categories.ttl',
  'ontology/cbox/service-types.ttl',
  'ontology/cbox/attendance-statuses.ttl',
  'ontology/abox/empty.ttl',
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
  console.log('[churchcore-congregation] ok');
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[churchcore-congregation] verify failed', e);
  process.exitCode = 1;
}

