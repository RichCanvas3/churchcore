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
  'ontology/churchcore-upper-classifications.ttl',
  'ontology/churchcore-upper-situations.ttl',
  'ontology/churchcore-upper-state.ttl',
  'ontology/churchcore-upper-process.ttl',
  'ontology/churchcore-upper-intent.ttl',
  'ontology/churchcore-upper-community.ttl',
  'ontology/churchcore-upper-discipleship.ttl',
  'ontology/churchcore-upper-commerce.ttl',
  'ontology/churchcore-all.ttl',
  'ontology/tbox/core.ttl',
  'ontology/tbox/plan.ttl',
  'ontology/tbox/prov.ttl',
  'ontology/tbox/situation.ttl',
  'ontology/tbox/state.ttl',
  'ontology/tbox/process.ttl',
  'ontology/tbox/intent.ttl',
  'ontology/tbox/community.ttl',
  'ontology/tbox/journey.ttl',
  'ontology/tbox/commerce.ttl',
  'ontology/cbox/classifications.ttl',
  'ontology/cbox/strategic-intent.ttl',
  'ontology/cbox/journey.ttl',
  'ontology/cbox/community.ttl',
  'ontology/cbox/people-relationships.ttl',
  'ontology/cbox/taxonomies.ttl',
  'ontology/cbox/ops-statuses.ttl',
  'ontology/cbox/state-categories.ttl',
  'ontology/cbox/situations.ttl',
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
  console.log('[churchcore-ontology] ok');
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[churchcore-ontology] verify failed', e);
  process.exitCode = 1;
}

