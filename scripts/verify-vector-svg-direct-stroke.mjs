import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  compileDirectVectorSvgStrokeMesh,
  directVectorSvgStrokeQualityForLod,
  VectorSvgDirectStrokeMeshCache,
  vectorSvgPaintSupportsDirectStrokeMesh,
} from "../src/vector-svg-stroke-direct.ts";
import { vectorTextLodForSigma } from "../src/vector-text-lod.ts";

const IDENTITY_TRANSFORM = Object.freeze([1, 0, 0, 1, 0, 0]);

function pathData(verbs, coords, contourOffsets = [0]) {
  return {
    verbs: new Uint8Array(verbs),
    coords: new Float64Array(coords),
    contourOffsets: new Uint32Array(contourOffsets),
    fillRule: 0,
  };
}

function linePath(length = 40) {
  return pathData([0, 1], [0, 0, length, 0]);
}

function strokeForPath(sourcePath, overrides = {}) {
  return {
    sourcePath,
    transform: IDENTITY_TRANSFORM,
    width: 2.09,
    linecap: "butt",
    linejoin: "miter",
    miterLimit: 4,
    dashArray: [],
    dashOffset: 0,
    ...overrides,
  };
}

function paintForStroke(stroke, overrides = {}) {
  return {
    id: 1,
    color: "#172033",
    opacity: 1,
    fillRule: 0,
    path: stroke.sourcePath,
    strokes: [stroke],
    revision: "direct-stroke-fixture-v1",
    ...overrides,
  };
}

function assertApproximately(actual, expected, label, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`,
  );
}

const basePath = linePath();
const baseStroke = strokeForPath(basePath);
const basePaint = paintForStroke(baseStroke);
const baseLod = vectorTextLodForSigma(1);
const controllerSource = readFileSync(
  new URL("../src/mixed-scene-controller.ts", import.meta.url),
  "utf8",
);

assert.match(
  controllerSource,
  /effect\.kind === "source-fill"[\s\S]{0,220}svgDirectStrokeMeshes\.meshForPaint/,
  "the production source-fill path must query the direct stroke cache",
);
assert.match(
  controllerSource,
  /svgDirectStrokeMeshes\.clear\(\)/,
  "document reset must release direct stroke meshes",
);

// A straight butt-capped centerline remains a four-vertex, two-triangle strip
// at every supported width. Width is preserved in floating-point geometry.
for (const width of [1, 2.09, 4, 16, 64]) {
  const stroke = strokeForPath(basePath, { width });
  const result = compileDirectVectorSvgStrokeMesh(
    [stroke],
    directVectorSvgStrokeQualityForLod([stroke], baseLod),
    `width-${width}`,
    { lodBucket: baseLod.bucket, integerScale: baseLod.integerScale },
  );
  assert.ok(result.mesh, `${width}px: direct mesh is missing`);
  assert.equal(result.metrics.segmentCount, 1, `${width}px: segment count changed`);
  assert.equal(result.metrics.vertexCount, 4, `${width}px: vertex count changed`);
  assert.equal(result.metrics.indexCount, 6, `${width}px: index count changed`);
  assert.equal(result.metrics.degenerateSegmentCount, 0);
  assert.equal(result.metrics.miterFallbackCount, 0);
  assertApproximately(
    result.mesh.bottom - result.mesh.top,
    width,
    `${width}px: mesh width changed`,
  );
  assertApproximately(
    result.mesh.right - result.mesh.left,
    40,
    `${width}px: centerline length changed`,
  );
}

// The production gate intentionally admits only the subset for which direct
// overlapping triangles are equivalent to the canonical opaque source fill.
assert.equal(vectorSvgPaintSupportsDirectStrokeMesh(basePaint, 1), true);
assert.equal(vectorSvgPaintSupportsDirectStrokeMesh(basePaint, 0.5), false);
assert.equal(
  vectorSvgPaintSupportsDirectStrokeMesh(
    paintForStroke(baseStroke, { opacity: 0.5 }),
    1,
  ),
  false,
);
assert.equal(
  vectorSvgPaintSupportsDirectStrokeMesh(
    paintForStroke(baseStroke, { gradient: {} }),
    1,
  ),
  false,
);
for (const [label, rejectedStroke] of [
  ["zero width", strokeForPath(basePath, { width: 0 })],
  ["dash pattern", strokeForPath(basePath, { dashArray: [4, 2] })],
  ["round cap", strokeForPath(basePath, { linecap: "round" })],
  ["bevel join", strokeForPath(basePath, { linejoin: "bevel" })],
  [
    "closed contour",
    strokeForPath(pathData([0, 1, 1, 4], [0, 0, 40, 0, 40, 40])),
  ],
  [
    "singular transform",
    strokeForPath(basePath, { transform: [1, 0, 0, 0, 0, 0] }),
  ],
  [
    "ill-conditioned transform",
    strokeForPath(basePath, { transform: [1e9, 0, 0, 1e-9, 0, 0] }),
  ],
  [
    "non-finite coordinates",
    strokeForPath(pathData([0, 1], [0, 0, Number.POSITIVE_INFINITY, 0])),
  ],
  ["non-finite miter limit", strokeForPath(basePath, { miterLimit: Number.NaN })],
]) {
  assert.equal(
    vectorSvgPaintSupportsDirectStrokeMesh(paintForStroke(rejectedStroke), 1),
    false,
    `${label}: an unsupported stroke reached the direct production path`,
  );
}

const overBudgetVerbs = new Uint8Array(2_049);
overBudgetVerbs[0] = 0;
overBudgetVerbs.fill(1, 1);
assert.equal(
  vectorSvgPaintSupportsDirectStrokeMesh(
    paintForStroke(strokeForPath({
      verbs: overBudgetVerbs,
      coords: new Float64Array(overBudgetVerbs.length * 2),
      contourOffsets: new Uint32Array([0]),
      fillRule: 0,
    })),
    1,
  ),
  false,
  "oversized sources must stay on the bounded worker path",
);

// Exact LOD requests reuse the same object. Higher LODs compile once, the
// per-paint cache stays bounded, and a retained higher LOD serves a lower one.
const cache = new VectorSvgDirectStrokeMeshCache();
const firstMesh = cache.meshForPaint(basePaint, baseLod, "semantic-line");
assert.ok(firstMesh);
assert.deepEqual(cache.diagnostics(), {
  entries: 1,
  logicalBytes: firstMesh.vertices.byteLength + firstMesh.indices.byteLength,
  failedLods: 0,
  cacheHits: 0,
  cacheMisses: 1,
});
assert.equal(
  cache.meshForPaint(basePaint, baseLod, "semantic-line"),
  firstMesh,
  "an exact LOD must reuse its mesh object",
);
const equivalentPaint = paintForStroke(strokeForPath(linePath()), {
  id: 99,
  revision: "a-different-object-revision",
});
assert.equal(
  cache.meshForPaint(equivalentPaint, baseLod, "semantic-line"),
  firstMesh,
  "semantic identity, rather than object revision, must own cache reuse",
);

const lodOneMesh = cache.meshForPaint(
  basePaint,
  vectorTextLodForSigma(2),
  "semantic-line",
);
assert.ok(lodOneMesh);
const lodTwoMesh = cache.meshForPaint(
  basePaint,
  vectorTextLodForSigma(4),
  "semantic-line",
);
assert.ok(lodTwoMesh);
const lodThreeMesh = cache.meshForPaint(
  basePaint,
  vectorTextLodForSigma(8),
  "semantic-line",
);
assert.ok(lodThreeMesh);
assert.equal(cache.diagnostics().entries, 3, "LOD variants must remain bounded");
assert.equal(cache.diagnostics().cacheMisses, 4);
assert.equal(
  cache.meshForPaint(basePaint, vectorTextLodForSigma(0.5), "semantic-line"),
  lodOneMesh,
  "the nearest retained higher LOD must satisfy a lower-LOD request",
);
assert.equal(cache.diagnostics().cacheHits, 3);

const independentCache = new VectorSvgDirectStrokeMeshCache();
const independentMesh = independentCache.meshForPaint(
  basePaint,
  baseLod,
  "semantic-line",
);
assert.ok(independentMesh);
assert.notEqual(
  independentMesh.revision,
  firstMesh.revision,
  "independent caches must not alias GPU resource revisions",
);

const excessiveTranslationStroke = strokeForPath(basePath, {
  transform: [1, 0, 0, 1, 1e50, 0],
});
assert.equal(
  vectorSvgPaintSupportsDirectStrokeMesh(
    paintForStroke(excessiveTranslationStroke),
    1,
  ),
  true,
  "floating-point range is validated against the compiled mesh",
);
const excessiveTranslationCache = new VectorSvgDirectStrokeMeshCache();
assert.equal(
  excessiveTranslationCache.meshForPaint(
    paintForStroke(excessiveTranslationStroke),
    baseLod,
    "excessive-translation",
  ),
  null,
  "coordinates outside GPU floating-point range must use the canonical path",
);
assert.equal(excessiveTranslationCache.diagnostics().failedLods, 1);

const pathologicalCubic = strokeForPath(pathData(
  [0, 3],
  [0, 0, 0, 100, 100, -100, 100, 0],
));
assert.throws(
  () => compileDirectVectorSvgStrokeMesh(
    [pathologicalCubic],
    {
      centerlineTolerance: Number.MIN_VALUE,
      roundArcSagittaTolerance: Number.MIN_VALUE,
    },
    "flatten-budget",
  ),
  /point budget/,
  "adaptive subdivision must stop at the production point budget",
);

// Degenerate centerlines and joins that exceed their miter limit are compiled
// only to validate them, then remembered as canonical-path fallbacks.
const degenerateStroke = strokeForPath(
  pathData([0, 1], [0, 0, 1e-13, 0]),
);
const degenerateResult = compileDirectVectorSvgStrokeMesh(
  [degenerateStroke],
  directVectorSvgStrokeQualityForLod([degenerateStroke], baseLod),
  "degenerate",
);
assert.equal(degenerateResult.mesh, null);
assert.equal(degenerateResult.metrics.degenerateSegmentCount, 1);
const degenerateCache = new VectorSvgDirectStrokeMeshCache();
const degeneratePaint = paintForStroke(degenerateStroke);
assert.equal(
  degenerateCache.meshForPaint(degeneratePaint, baseLod, "degenerate"),
  null,
);
assert.deepEqual(degenerateCache.diagnostics(), {
  entries: 0,
  logicalBytes: 0,
  failedLods: 1,
  cacheHits: 0,
  cacheMisses: 1,
});
assert.equal(
  degenerateCache.meshForPaint(degeneratePaint, baseLod, "degenerate"),
  null,
);
assert.equal(
  degenerateCache.diagnostics().cacheMisses,
  1,
  "a remembered fallback must not be recompiled",
);

const limitedMiterStroke = strokeForPath(
  pathData([0, 1, 1], [0, 0, 20, 0, 20, 20]),
  { miterLimit: 1 },
);
assert.equal(
  vectorSvgPaintSupportsDirectStrokeMesh(paintForStroke(limitedMiterStroke), 1),
  true,
  "miter suitability is decided from compiled geometry",
);
const limitedMiterResult = compileDirectVectorSvgStrokeMesh(
  [limitedMiterStroke],
  directVectorSvgStrokeQualityForLod([limitedMiterStroke], baseLod),
  "limited-miter",
);
assert.ok(limitedMiterResult.mesh);
assert.equal(limitedMiterResult.metrics.miterFallbackCount, 1);
const miterCache = new VectorSvgDirectStrokeMeshCache();
assert.equal(
  miterCache.meshForPaint(
    paintForStroke(limitedMiterStroke),
    baseLod,
    "limited-miter",
  ),
  null,
  "miter fallback geometry must use the canonical production path",
);
assert.equal(miterCache.diagnostics().failedLods, 1);

cache.clear();
assert.deepEqual(cache.diagnostics(), {
  entries: 0,
  logicalBytes: 0,
  failedLods: 0,
  cacheHits: 0,
  cacheMisses: 0,
});

console.log(
  "Direct vector stroke production gate, width preservation, cache, LOD reuse, and canonical fallbacks verified.",
);
