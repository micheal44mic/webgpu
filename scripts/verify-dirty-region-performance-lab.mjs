import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const model = readFileSync(
  new URL("../src/labs/gpu/dirty-region-lab-model.ts", import.meta.url),
  "utf8",
);
const lab = readFileSync(
  new URL("../src/labs/gpu/dirty-region-performance-lab.ts", import.meta.url),
  "utf8",
);
const humanWorkload = readFileSync(
  new URL("../src/labs/gpu/dirty-region-human-workload.ts", import.meta.url),
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
const packageJson = JSON.parse(readFileSync(
  new URL("../package.json", import.meta.url),
  "utf8",
));

assert.match(
  registry,
  /\["dirty-region-performance-ab", "A\/B regioni dirty · AABB \/ tile fuse"\]/,
);
assert.match(registry, /case "dirty-region-performance-ab":/);
assert.match(
  registry,
  /import\(\s*"\.\/gpu\/dirty-region-performance-lab"\s*\)/,
);
assert.match(registry, /runDirtyRegionPerformanceLab\(engine\.device,/);
const hostedLabIds = registry.match(
  /const HOSTED_LAB_IDS = new Set<LabId>\(\[([\s\S]*?)\]\);/,
)?.[1];
assert(hostedLabIds, "the hosted Lab allowlist must remain readable");
assert.match(hostedLabIds, /"dirty-region-performance-ab"/);

assert.match(model, /export const DIRTY_REGION_TILE_SIZES = \[64, 128, 256\] as const/);
for (const fixture of [
  "horizontal-control",
  "long-diagonal",
  "s-curve",
  "textured-spray",
  "mirrored-diagonals",
]) {
  assert.match(model, new RegExp(`id: "${fixture}"`));
}
assert.match(model, /export function buildDirtyAabb\(/);
assert.match(model, /export function buildDirtyTileBands\(/);
assert.match(model, /export function buildMipRegionPlan\(/);
assert.match(model, /export function compareDirtyRegionCoverage\(/);
assert.match(model, /mask\.fill\(1,/);
assert.match(model, /previous && previous\.y \+ previous\.height === y/);

assert.match(lab, /const WARMUP_RUNS = 1;/);
assert.match(lab, /const MEASURED_RUNS = 7;/);
assert.match(lab, /const REPORT_VERSION = 2;/);
assert.match(lab, /loadHumanDirtyRegionWorkload/);
assert.match(lab, /strategy\.frames\.map\(\(frame\) => frame\.plan\)/);
assert.match(lab, /await device\.queue\.onSubmittedWorkDone\(\);/);
assert.match(lab, /pass\.setScissorRect\(/);
assert.match(lab, /pass\.draw\(3\);/);
assert.match(lab, /strategy\.missedPixels === 0/);
assert.match(lab, /productionClaim: false/);
assert.match(lab, /timestampQueryAvailable: device\.features\.has\("timestamp-query"\)/);
assert.match(lab, /liveGpuTimestampMs/);
assert.match(lab, /commitGpuTimestampMs/);
assert.match(lab, /data-dirty-region-lab-presentation/);
assert.match(lab, /panel\.showModal\(\)/);
assert.match(lab, /type="range"/);

assert.match(humanWorkload, /HUMAN_STROKE_API_URL = "\/api\/human-stroke"/);
assert.match(humanWorkload, /HUMAN_STROKE_TIMELINE_API_URL = "\/api\/stroke-timeline"/);
assert.match(humanWorkload, /loadRequiredPackedStrokeGeometryProcessor/);
assert.match(humanWorkload, /processor\.beginPacked/);
assert.match(humanWorkload, /session\.processBatch\(\[points\[index\]\]/);
assert.match(humanWorkload, /STAMP_STRIDE_BYTES/);
assert.match(humanWorkload, /view\.getFloat32\(byteOffset \+ 8, true\)/);
assert.match(humanWorkload, /recordedReferenceMatches/);
assert.match(styles, /\.dirty-region-lab-presentation \{/);
assert.match(styles, /\.dirty-region-lab-presentation::backdrop/);
assert.match(styles, /\.dirty-region-lab-preview-grid/);
assert.match(styles, /\.dirty-region-lab-scrubber/);

const productNames =
  /\b(?:ibispaint|figma|adobe|photoshop|illustrator|affinity|canva|coreldraw|krita|gimp|procreate|sketch)\b/i;
for (const [name, source] of [
  ["model", model],
  ["lab", lab],
  ["human workload", humanWorkload],
]) {
  assert.doesNotMatch(source, productNames, `${name} must use product-neutral source text`);
}

assert.equal(
  packageJson.scripts?.["dirty-region-performance-lab:verify"],
  "node scripts/verify-dirty-region-performance-lab.mjs",
);

console.log("Dirty-region performance A/B lab wiring and methodology verified.");
