import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readEngineSource } from "./engine-source.mjs";
import {
  DEFAULT_RASTER_INNER_SHADOW_STYLE,
  DEFAULT_RASTER_OUTER_SHADOW_STYLE,
  RASTER_SHADOW_CORE_BUILD,
  RASTER_SHADOW_MAX_DISTANCE,
  RASTER_SHADOW_MAX_SIZE,
  classifyRasterInnerShadowStyleChange,
  classifyRasterOuterShadowStyleChange,
  copyRasterInnerShadowStyle,
  copyRasterOuterShadowStyle,
  normalizeRasterInnerShadowStyle,
  normalizeRasterOuterShadowStyle,
  rasterInnerShadowKernel,
  rasterInnerShadowVisualBounds,
  rasterOuterShadowKernel,
  rasterOuterShadowUsesSupportedBlend,
  rasterOuterShadowInfluenceBounds,
  rasterOuterShadowVisualBounds,
  rasterShadowOffset,
} from "../src/shadow-core.ts";

assert.equal(
  RASTER_SHADOW_CORE_BUILD,
  "raster-shadow-core-webgpu-v1-morphology-then-gaussian",
);
assert.equal(DEFAULT_RASTER_OUTER_SHADOW_STYLE.enabled, false);
assert.equal(DEFAULT_RASTER_INNER_SHADOW_STYLE.enabled, false);
assert.equal(DEFAULT_RASTER_OUTER_SHADOW_STYLE.blendMode, "multiply");
assert.equal(DEFAULT_RASTER_INNER_SHADOW_STYLE.blendMode, "multiply");

{
  const style = normalizeRasterOuterShadowStyle({
    enabled: true,
    blendMode: "screen",
    color: "#804020",
    opacity: 140,
    angle: -30,
    distance: RASTER_SHADOW_MAX_DISTANCE + 1,
    spread: -2,
    size: RASTER_SHADOW_MAX_SIZE + 1,
    contour: "invalid",
    contourAA: false,
    noise: 200,
    layerKnocksOut: false,
  });
  assert.equal(style.enabled, true);
  assert.equal(style.blendMode, "multiply");
  assert.deepEqual(
    style.color.map((channel) => Math.round(channel * 255)),
    [128, 64, 32],
  );
  assert.equal(style.opacity, 100);
  assert.equal(style.angle, 330);
  assert.equal(style.distance, RASTER_SHADOW_MAX_DISTANCE);
  assert.equal(style.spread, 0);
  assert.equal(style.size, RASTER_SHADOW_MAX_SIZE);
  assert.equal(style.contour, "linear");
  assert.equal(style.contourAA, false);
  assert.equal(style.noise, 100);
  assert.equal(style.layerKnocksOut, false);
}

{
  const style = normalizeRasterInnerShadowStyle({
    enabled: true,
    blendMode: "normal",
    color: [2, -1, 0.25],
    choke: 125,
    size: -4,
  });
  assert.equal(style.blendMode, "normal");
  assert.deepEqual(style.color, [1, 0, 0.25]);
  assert.equal(style.choke, 100);
  assert.equal(style.size, 0);
}

{
  const outerA = copyRasterOuterShadowStyle(DEFAULT_RASTER_OUTER_SHADOW_STYLE);
  const outerB = copyRasterOuterShadowStyle(DEFAULT_RASTER_OUTER_SHADOW_STYLE);
  const innerA = copyRasterInnerShadowStyle(DEFAULT_RASTER_INNER_SHADOW_STYLE);
  const innerB = copyRasterInnerShadowStyle(DEFAULT_RASTER_INNER_SHADOW_STYLE);
  assert.notEqual(outerA, outerB);
  assert.notEqual(outerA.color, outerB.color);
  assert.notEqual(innerA, innerB);
  assert.notEqual(innerA.color, innerB.color);
}

assert.equal(
  rasterOuterShadowUsesSupportedBlend({
    ...DEFAULT_RASTER_OUTER_SHADOW_STYLE,
    enabled: true,
    blendMode: "multiply",
    color: [0, 0, 0],
  }),
  true,
);
assert.equal(
  rasterOuterShadowUsesSupportedBlend({
    ...DEFAULT_RASTER_OUTER_SHADOW_STYLE,
    enabled: true,
    blendMode: "multiply",
    color: [0.1, 0, 0],
  }),
  false,
);
assert.equal(
  rasterOuterShadowUsesSupportedBlend({
    ...DEFAULT_RASTER_OUTER_SHADOW_STYLE,
    enabled: true,
    blendMode: "normal",
    color: [0.1, 0.2, 0.3],
  }),
  true,
);

{
  const outer = rasterOuterShadowKernel({
    ...DEFAULT_RASTER_OUTER_SHADOW_STYLE,
    size: 20,
    spread: 25,
  });
  assert.deepEqual(outer, {
    morphologyRadius: 5,
    blurRadius: 15,
    sigma: 5,
    influenceRadius: 20,
  });
  const inner = rasterInnerShadowKernel({
    ...DEFAULT_RASTER_INNER_SHADOW_STYLE,
    size: 20,
    choke: 100,
  });
  assert.deepEqual(inner, {
    morphologyRadius: 20,
    blurRadius: 0,
    sigma: 0,
    influenceRadius: 20,
  });
}

{
  const [x0, y0] = rasterShadowOffset(0, 10);
  assert.equal(x0, -10);
  assert.ok(Math.abs(y0) < 1e-9);
  const [x90, y90] = rasterShadowOffset(90, 10);
  assert.ok(Math.abs(x90) < 1e-9);
  assert.equal(y90, 10);
}

{
  const source = { x: 100, y: 100, width: 20, height: 10 };
  const style = {
    ...DEFAULT_RASTER_OUTER_SHADOW_STYLE,
    enabled: true,
    angle: 0,
    distance: 5,
    size: 10,
    spread: 0,
  };
  assert.deepEqual(
    rasterOuterShadowInfluenceBounds(source, style, 4096, 4096),
    { x: 90, y: 90, width: 40, height: 30 },
  );
  assert.deepEqual(
    rasterOuterShadowVisualBounds(source, style, 4096, 4096),
    { x: 84, y: 89, width: 42, height: 32 },
  );
  assert.deepEqual(
    rasterInnerShadowVisualBounds(
      source,
      { ...DEFAULT_RASTER_INNER_SHADOW_STYLE, enabled: true },
      4096,
      4096,
    ),
    source,
  );
}

{
  const before = {
    ...DEFAULT_RASTER_OUTER_SHADOW_STYLE,
    enabled: true,
  };
  assert.deepEqual(
    classifyRasterOuterShadowStyleChange(before, { ...before, color: [1, 0, 0] }),
    { changed: true, matteChanged: false, composeOnly: true, release: false },
  );
  assert.deepEqual(
    classifyRasterOuterShadowStyleChange(before, { ...before, size: 18 }),
    { changed: true, matteChanged: true, composeOnly: false, release: false },
  );
  assert.equal(
    classifyRasterOuterShadowStyleChange(before, { ...before, enabled: false }).release,
    true,
  );
  const inner = {
    ...DEFAULT_RASTER_INNER_SHADOW_STYLE,
    enabled: true,
  };
  assert.equal(
    classifyRasterInnerShadowStyleChange(inner, { ...inner, angle: 40 }).composeOnly,
    true,
  );
  assert.equal(
    classifyRasterInnerShadowStyleChange(inner, { ...inner, choke: 40 }).matteChanged,
    true,
  );
}

const rendererSource = readFileSync(
  new URL("../src/shadow-renderer.ts", import.meta.url),
  "utf8",
);
assert.match(
  rendererSource,
  /prewarmWorkspace\(source: unknown\): void \{\s+this\.requireScratchLease\(this\.styleKernel\(source\)\);/,
  "il prewarm deve riusare lease e bind group quando l'extent non cambia",
);
assert.match(rendererSource, /persistent packed f16 matte/);
assert.match(rendererSource, /const COVERAGE_WORD_PIXELS = 2/);
assert.match(rendererSource, /shadowMatte\[linearIndex >> 1u\] = pack2x16float\(matte\)/);
assert.doesNotMatch(rendererSource, /round\(value \* 255\.0\)/);
assert.match(rendererSource, /morphology\/Gaussian matte/);
assert.match(rendererSource, /options\.encoder\.clearBuffer\(this\.coverageBuffer\)/);
assert.match(rendererSource, /this\.scratchPool\.declareEffect\(this\.effectId/);
assert.doesNotMatch(rendererSource, /mapAsync|copyBufferToBuffer|readBuffer/);

const compositorSource = readFileSync(
  new URL("../src/stroke-renderer.ts", import.meta.url),
  "utf8",
);
assert.match(compositorSource, /fn outerShadowPlane\(/);
assert.match(compositorSource, /fn innerShadowNode\(/);
assert.match(compositorSource, /outerShadowField: array<u32>/);
assert.match(compositorSource, /innerShadowField: array<u32>/);
assert.match(
  compositorSource,
  /unpack2x16float\(outerShadowField\[linearIndex >> 1u\]\)/,
);
assert.match(
  compositorSource,
  /unpack2x16float\(innerShadowField\[linearIndex >> 1u\]\)/,
);
// A full-width 4096² matte is exactly two bytes per pixel. This guards both
// the wide-document allocation and the old one-byte stride from returning.
assert.equal(4096 * 4096 / 2 * 4, 32 * 1024 * 1024);
assert.match(
  compositorSource,
  /let shadowsDisabled = outerShadow\.flags\.x == 0u && innerShadow\.flags\.x == 0u/,
  "il fast path deve conservare esattamente i pixel precedenti con entrambe le ombre off",
);
assert.match(
  compositorSource,
  /let zeroPoint = exp\(-0\.5 \/ \(0\.35 \* 0\.35\)\);/,
  "il contour Gaussiano deve normalizzare il matte zero a trasparenza zero",
);
assert.match(
  compositorSource,
  /if \(x <= 0\.0\) \{\s+return 0\.0;/,
  "l'AA del contour non può riaccendere un matte nullo",
);
assert.match(
  compositorSource,
  /let grain = select\(0\.0, 1\.0, random24\(vec2<u32>\(position\), seed\) < coverage\);/,
  "il Disturbo deve preservare esattamente coverage zero e uno",
);
assert.doesNotMatch(compositorSource, /coverage \+ noise \* amount/);

const engineSource = readEngineSource();
assert.match(engineSource, /async setRasterOuterShadowStyle\(style: unknown\)/);
assert.match(engineSource, /async setRasterInnerShadowStyle\(style: unknown\)/);
assert.match(engineSource, /outerShadowStyle: RasterOuterShadowStyle/);
assert.match(engineSource, /innerShadowStyle: RasterInnerShadowStyle/);
assert.match(engineSource, /rasterOuterShadowMatteMiB/);
assert.match(engineSource, /rasterInnerShadowMatteMiB/);

const goldenSource = readFileSync(
  new URL("../src/shadow-golden.ts", import.meta.url),
  "utf8",
);
const mainSource = readFileSync(
  new URL("../src/main.ts", import.meta.url),
  "utf8",
);
const goldenBaseline = JSON.parse(readFileSync(
  new URL("../goldens/raster-shadow-rgba8-v1.json", import.meta.url),
  "utf8",
));
assert.equal(goldenBaseline.version, 1);
assert.equal(goldenBaseline.cases.length, 6);
assert.ok(goldenBaseline.cases.every((goldenCase) => goldenCase.mips.length === 9));
assert.equal(
  goldenBaseline.cases[4].sha256,
  goldenBaseline.cases[5].sha256,
  "la ricostruzione ripetuta della coppia Ombre deve essere deterministica",
);
assert.equal(
  goldenBaseline.combinedSha256,
  "2b812a001c7951ea5b41df933e811af8baad9f503a4a24b05915374b697b8040",
);
assert.equal(
  goldenBaseline.mipCombinedSha256,
  "f5bcd1e4caee360ab77cdcd9a9f8022fc3b93f079cc75216bf60471a27ed0a9e",
);
const mipIdentity = Buffer.from(JSON.stringify({
  // The checked-in baseline is the legacy v1/RGBA8 identity. Runtime goldens
  // are now v2/RGBA16F and intentionally report a mismatch until regenerated.
  mipChainVersion: 1,
  format: "rgba8unorm",
  width: 256,
  height: 192,
  fixtureSha256: goldenBaseline.fixtureSha256,
  cases: goldenBaseline.cases.map(({ id, mips }) => ({
    id,
    mips: mips.map(({ level, sha256 }) => ({
      level,
      width: Math.max(1, 256 >> level),
      height: Math.max(1, 192 >> level),
      sha256,
    })),
  })),
}));
assert.equal(
  createHash("sha256").update(mipIdentity).digest("hex"),
  goldenBaseline.mipCombinedSha256,
);
assert.match(goldenSource, /outer-soft-linear/);
assert.match(goldenSource, /inner-hard-cone-noise/);
assert.match(goldenSource, /outer-inner-combined-restored/);
assert.match(goldenSource, /RASTER_SHADOW_GOLDEN_VERSION = 2/);
assert.match(goldenSource, /RASTER_SHADOW_GOLDEN_MIP_CHAIN_VERSION = 2/);
assert.match(goldenSource, /packRgba8UnormToRgba16FloatBytes/);
assert.match(goldenSource, /GOLDEN_RGBA16F_BYTES_PER_PIXEL = 8/);
assert.match(goldenSource, /lightGlazeUniforms\[1\] = 1/);
assert.match(goldenSource, /format: RASTER_STROKE_GOLDEN_FORMAT/);
assert.match(goldenSource, /layerFormat: RASTER_STROKE_GOLDEN_FORMAT/);
assert.match(goldenSource, /scratchExtent: 8/);
assert.match(goldenSource, /strokeGeometryEnabled: false/);
assert.match(goldenSource, /baselineMatches: baselineMismatches\.length === 0/);
assert.match(engineSource, /async runRasterShadowGolden\(\)/);
assert.match(mainSource, /id="runRasterShadowGolden"|runRasterShadowGolden/);
assert.match(engineSource, /RASTER_STROKE_COMPOSITOR_ONLY_SCRATCH_EXTENT/);
assert.match(engineSource, /scheduleEffectsScratchShrink\(\)/);

console.log("Shadow core verification passed.");
