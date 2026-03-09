import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, "..");

const required = [
  "ontology/churchcore-faith-journey.ttl",
  "ontology/churchcore-faith-journey-all.ttl",
  "ontology/cbox/faith-journey-states.ttl",
  "ontology/cbox/faith-journey-graph.ttl",
  "ontology/cbox/openness-states.ttl",
  "ontology/cbox/formation-states.ttl",
  "ontology/cbox/belonging-states.ttl",
  "ontology/cbox/multiplication-states.ttl",
  "ontology/cbox/openness-graph.ttl",
  "ontology/cbox/formation-graph.ttl",
  "ontology/cbox/belonging-graph.ttl",
  "ontology/cbox/multiplication-graph.ttl",
  "ontology/cbox/signal-levels.ttl",
  "ontology/cbox/signal-types.ttl",
  "ontology/cbox/empty.ttl",
  "ontology/abox/empty.ttl",
  "docs/ontology/README.md",
  "docs/ontology/journey.md",
];

function main() {
  const missing = required.filter((p) => !fs.existsSync(path.join(pkgRoot, p)));
  if (missing.length) throw new Error(`Missing ontology files:\n- ${missing.join("\n- ")}`);
}

try {
  main();
  // eslint-disable-next-line no-console
  console.log("[churchcore-faith-journey] ok");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[churchcore-faith-journey] verify failed", e);
  process.exitCode = 1;
}

