import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const fixtureUrl = new URL(
  "../src/labs/vector/fixtures/complex-curved-strokes.svg",
  import.meta.url,
);
const benchmarkUrl = new URL(
  "../src/labs/vector/vector-baseline-benchmark.ts",
  import.meta.url,
);
const labsUrl = new URL("../src/labs/editor-labs.ts", import.meta.url);
const fixture = readFileSync(fixtureUrl, "utf8");
const benchmarkSource = readFileSync(benchmarkUrl, "utf8");
const labsSource = readFileSync(labsUrl, "utf8");
const sha256 = createHash("sha256").update(fixture).digest("hex");

assert.equal(
  sha256,
  "8c169ce7e7570492b08bfd26279e1698b0e0abd3ad2b3021e05a1e0c70e8fe9e",
);
assert.equal((fixture.match(/<path\b/g) ?? []).length, 18);
assert.equal((fixture.match(/<line\b/g) ?? []).length, 1);
const pathCommandCount = [...fixture.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)]
  .reduce(
    (total, match) => total + (match[1].match(/[AaCcHhLlMmQqSsTtVvZz]/g) ?? []).length,
    0,
  );
assert.equal(pathCommandCount, 84);
assert.match(fixture, /stroke-dasharray:\s*3\.48 1\.74 0 0/);
assert.match(fixture, /stroke-linecap:\s*round/);
assert.match(fixture, /stroke-linejoin:\s*round/);
assert.doesNotMatch(fixture, /<!--|generator/i);
assert.doesNotMatch(
  fixture,
  /<script\b|\son[a-z]+\s*=|(?:href|xlink:href)\s*=|url\s*\(/i,
);
assert.match(
  benchmarkSource,
  /import complexCurvedStrokesSvg from "\.\/fixtures\/complex-curved-strokes\.svg\?raw"/,
);
assert.match(
  benchmarkSource,
  /export type VectorBaselineProfile = "shared" \| "unique" \| "curved-strokes"/,
);
assert.match(benchmarkSource, /const CURVED_STROKE_SVG_COUNT = 32/);
assert.match(benchmarkSource, /vectorBaselineSvgCount/);
assert.match(benchmarkSource, /vectorBaselineTextCount/);
assert.match(benchmarkSource, /VECTOR_BASELINE_REPORT_VERSION = 6/);
assert.match(benchmarkSource, /strokeLodCompletedWithoutFallback/);
assert.match(
  benchmarkSource,
  /visualInspectionMode\s*\? 1\s*:\s*CURVED_STROKE_SVG_COUNT/,
);
assert.match(
  benchmarkSource,
  /visualInspectionMode\s*\? 0\s*:\s*VECTOR_TEXT_NODE_MAXIMUM/,
);
assert.match(benchmarkSource, /CURVED_STROKE_SOURCE_PATH_OPERATION_COUNT = 177/);
assert.match(benchmarkSource, /CURVED_STROKE_SOURCE_DRAWABLE_SEGMENT_COUNT = 159/);
assert.match(benchmarkSource, /CURVED_STROKE_SOURCE_ELEMENT_COUNT = 19/);
assert.match(benchmarkSource, /CURVED_STROKE_SOURCE_RETAINED_STROKE_COUNT = 14/);
assert.match(
  benchmarkSource,
  /profile === "curved-strokes"[\s\S]{0,120}\? paint\.color/,
);
assert.match(
  labsSource,
  /\["vector-baseline-curved-strokes", "Baseline vettori · curve e tratteggi"\]/,
);

console.log(
  "Complex curved-stroke fixture verified: immutable hash, structure, safety, and lab routing.",
);
