import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lab = readFileSync(
  new URL("../src/labs/gpu/prepared-copy-instance-lab.ts", import.meta.url),
  "utf8",
);
const registry = readFileSync(
  new URL("../src/labs/editor-labs.ts", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/labs/styles.css", import.meta.url),
  "utf8",
);
const verificationSuite = readFileSync(
  new URL("./verification-suite.mjs", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(readFileSync(
  new URL("../package.json", import.meta.url),
  "utf8",
));

assert.match(registry, /\["prepared-copy-instance-ab",\s*"[^"]+"\]/);
assert.match(registry, /case "prepared-copy-instance-ab":/);
assert.match(
  registry,
  /import\(\s*"\.\/gpu\/prepared-copy-instance-lab"\s*\)/,
);
assert.match(registry, /runPreparedCopyInstanceLab\(engine,\s*\{/);
assert.match(registry, /applySettings:\s*\(settings\)\s*=>\s*this\.#host\.applyBrushSettings\(settings\)/);
assert.match(registry, /onProgress:\s*\(progress\)\s*=>\s*\{/);

const hostedLabIds = registry.match(
  /const HOSTED_LAB_IDS = new Set<LabId>\(\[([\s\S]*?)\]\);/,
)?.[1];
assert(hostedLabIds, "the hosted Lab allowlist must remain readable");
assert.match(hostedLabIds, /"prepared-copy-instance-ab"/);

assert.match(lab, /export async function runPreparedCopyInstanceLab\(/);
assert.match(lab, /lab:\s*"prepared-copy-instance-ab"/);
assert.match(lab, /productionClaim:\s*false/);
for (const strategy of [
  "one-procedural",
  "sixteen-procedural",
  "sixteen-prepared-resident",
  "sixteen-prepared-compute",
]) {
  assert.match(lab, new RegExp(`id:\\s*"${strategy}"`));
}
for (const methodologyMarker of [
  "perFrameGpuTimestamps",
  "recordedInputCadenceBacklog",
  "fullTargetComparison",
]) {
  assert.match(lab, new RegExp(`\\b${methodologyMarker}\\b`));
}
assert.match(lab, /data-prepared-instance-lab-presentation/);
assert.match(lab, /panel\.showModal\(\)/);

assert.match(styles, /\.prepared-instance-lab-presentation\s*\{/);
assert.match(styles, /\.prepared-instance-lab-presentation::backdrop/);
assert.match(styles, /\.prepared-instance-lab-cards/);
assert.match(styles, /\.prepared-instance-lab-table-scroll/);
assert.match(styles, /@media \(max-width:\s*760px\)/);

assert.match(
  verificationSuite,
  /"verify-prepared-copy-instance-lab\.mjs"/,
);
assert.equal(
  packageJson.scripts?.["prepared-copy-instance-lab:verify"],
  "node scripts/verify-prepared-copy-instance-lab.mjs",
);

console.log("Prepared-copy instance A/B lab wiring and methodology verified.");
