import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, "..");

const required = [
  "ontology/churchcore-global-all.ttl",
  "ontology/churchcore-global.ttl",
  "ontology/tbox/bible.ttl",
  "ontology/tbox/ecosystem.ttl",
  "ontology/tbox/measurement.ttl",
  "ontology/cbox/denominations.ttl",
  "ontology/cbox/traditions.ttl",
  "ontology/cbox/theology.ttl",
  "ontology/cbox/initiative-types.ttl",
  "ontology/cbox/people-group-status.ttl",
  "ontology/cbox/organization-service-categories.ttl",
  "ontology/cbox/partnership-types.ttl",
  "ontology/cbox/flourishing-dimensions.ttl",
  "ontology/cbox/congregation-thriving-dimensions.ttl",
  "ontology/abox/empty.ttl",
];

function main() {
  const missing = required.filter((p) => !fs.existsSync(path.join(pkgRoot, p)));
  if (missing.length) throw new Error(`Missing ontology files:\n- ${missing.join("\n- ")}`);
}

try {
  main();
  // eslint-disable-next-line no-console
  console.log("[churchcore-global] ok");
} catch (e) {
  // eslint-disable-next-line no-console
  console.error("[churchcore-global] verify failed", e);
  process.exitCode = 1;
}

