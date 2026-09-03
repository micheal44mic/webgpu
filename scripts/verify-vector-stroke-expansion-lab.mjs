import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const lab = readFileSync(
  new URL("../src/labs/vector/vector-stroke-expansion-lab.ts", import.meta.url),
  "utf8",
);
const registry = readFileSync(
  new URL("../src/labs/editor-labs.ts", import.meta.url),
  "utf8",
);
const directStroke = readFileSync(
  new URL("../src/vector-svg-stroke-direct.ts", import.meta.url),
  "utf8",
);
const gpuProbe = readFileSync(
  new URL("../src/labs/vector/vector-stroke-gpu-probe.ts", import.meta.url),
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
  /\["vector-stroke-expansion-ab", "A\/B espansione stroke vettoriale · semplice\/complessa"\]/,
);
const hostedLabIds = registry.match(
  /const HOSTED_LAB_IDS = new Set<LabId>\(\[([\s\S]*?)\]\);/,
)?.[1];
assert(hostedLabIds, "the hosted Lab allowlist must remain readable");
assert.match(
  hostedLabIds,
  /"vector-stroke-expansion-ab"/,
  "the vector stroke expansion lab must remain available in hosted Labs",
);
assert.match(registry, /case "vector-stroke-expansion-ab":/);
assert.match(
  registry,
  /import\(\s*"\.\/vector\/vector-stroke-expansion-lab"\s*\)/,
);
assert.match(registry, /runVectorStrokeExpansionLab\(engine\.device\)/);

assert.match(lab, /export async function runVectorStrokeExpansionLab\(device: GPUDevice\)/);
assert.match(
  lab,
  /const WIDTH_SWEEP = \[1, 2\.09, 4, 16, 64\] as const;/,
  "the width matrix must retain the agreed 1–64 px probes",
);
assert.match(
  lab,
  /const ZOOM_ASCENDING = \[0\.0625, 0\.125, 0\.25, 0\.5, 1, 2, 4, 8\] as const;/,
  "the zoom matrix must retain every scale from 0.0625 through 8",
);
assert.match(
  lab,
  /const ZOOM_SEQUENCE = \[\s*\.\.\.ZOOM_ASCENDING,\s*4,\s*2,\s*1,\s*0\.5,\s*0\.25,\s*0\.125,\s*0\.0625,\s*\] as const;/,
  "the zoom trace must travel outward and return to its smallest scale",
);
assert.match(lab, /sequence: ZOOM_SEQUENCE/);
assert.match(lab, /requested === null\) return DEFAULT_COMPLEX_CURVE_COUNT/);

const warmupMatch = lab.match(/const WARMUP_RUNS = (\d+);/);
assert(warmupMatch, "the lab must declare an explicit warmup count");
assert(
  Number(warmupMatch[1]) >= 1,
  "the benchmark must execute at least one warmup per backend",
);
assert.match(lab, /const MEASURED_RUNS = 7;/);
assert.match(lab, /for \(let run = 0; run < WARMUP_RUNS; run \+= 1\)/);
assert.match(lab, /for \(let run = 0; run < MEASURED_RUNS; run \+= 1\)/);
assert.match(lab, /warmupRunsPerBackend: WARMUP_RUNS/);
assert.match(lab, /measuredRunsPerBackend: MEASURED_RUNS/);
assert.match(lab, /run % 2 === 0/);

assert.match(
  lab,
  /coldDefinition:\s*\n?\s*"First uncached geometry use after renderer, kernel and probe initialization inside one live device; not a fresh browser process or device\."/,
  "the report must state exactly what its cold measurement includes",
);
assert.match(lab, /warmDefinition:/);
assert.match(lab, /zoomComparisonScope:/);
assert.match(lab, /complexFixtureScope:/);
assert.match(lab, /function pixelParity\(/);
assert.match(lab, /intersectionOverUnion/);
assert.match(lab, /parityPassed = correctness\.every/);
assert.match(lab, /passed: widthChecksPassed && parityPassed/);
assert.match(lab, /function renderLabPresentation\(/);
assert.match(lab, /data-vector-stroke-lab-presentation/);
assert.match(lab, /document\.createElement\("dialog"\)/);
assert.match(lab, /panel\.showModal\(\)/);
assert.match(lab, /close\.focus\(\{ preventScroll: true \}\)/);
assert.match(lab, /context\.complexCurveCount/);
assert.match(lab, /formatSaving\(value\)/);
assert.match(lab, /Probe isolato, non percorso di produzione/);
assert.match(lab, /let presentationError: string \| null = null;/);
assert.match(styles, /\.vector-stroke-lab-presentation \{/);
assert.match(styles, /\.vector-stroke-lab-presentation::backdrop/);
assert.match(styles, /@media \(max-width: 820px\)/);
assert.match(styles, /overflow-x: auto/);
assert.match(
  lab,
  /productionClaim: false/,
  "an isolated candidate benchmark must not claim production-path performance",
);
assert.match(
  lab,
  /not another application's runtime/,
  "the report must scope its conclusion to this repository",
);

const productNames =
  /\b(?:figma|adobe|photoshop|illustrator|affinity|canva|coreldraw|krita|gimp|procreate|sketch)\b/i;
for (const [name, source] of [
  ["lab", lab],
  ["direct stroke implementation", directStroke],
  ["GPU probe", gpuProbe],
]) {
  assert.doesNotMatch(
    source,
    productNames,
    `${name} must use product-neutral source text and labels`,
  );
}
const registryLabel = registry.match(
  /\["vector-stroke-expansion-ab", "([^"]+)"\]/,
)?.[1] ?? "";
assert(registryLabel.length > 0, "the lab must have a user-facing label");
assert.doesNotMatch(registryLabel, productNames);

assert.equal(
  packageJson.scripts?.["vector-stroke-expansion-lab:verify"],
  "node scripts/verify-vector-stroke-expansion-lab.mjs",
  "package.json must expose the dedicated lab verifier",
);

console.log("Vector stroke expansion A/B lab wiring and methodology verified.");
