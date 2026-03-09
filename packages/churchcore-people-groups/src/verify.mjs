import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, "..");

const required = [
  "ontology/churchcore-people-groups.ttl",
  "ontology/churchcore-people-groups-all.ttl",
  "ontology/tbox/people-groups.ttl",
  "ontology/cbox/religions.ttl",
  "ontology/cbox/gospel-progress-levels.ttl",
  "ontology/cbox/scripture-statuses.ttl",
  "ontology/cbox/mission-engagement-states.ttl",
  "ontology/cbox/people-group-faith-phases.ttl",
  "ontology/cbox/movement-stages.ttl",
  "ontology/cbox/movement-stage-graph.ttl",
  "ontology/cbox/people-group-faith-journey-graph.ttl",
  "ontology/cbox/empty.ttl",
  "ontology/abox/empty.ttl",
  "docs/ontology/README.md",
  "docs/ontology/people-groups.md",
];

function main() {
  const missing = required.filter((p) => !fs.existsSync(path.join(pkgRoot, p)));
  if (missing.length) throw new Error(`Missing ontology files:\n- ${missing.join("\n- ")}`);
}

try {
  main();
  // eslint-disable-next-line no-console
  console.log("[churchcore-people-groups] ok");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[churchcore-people-groups] verify failed", e);
  process.exitCode = 1;
}

