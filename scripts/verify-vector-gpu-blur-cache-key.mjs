import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  VECTOR_GPU_BLUR_CACHE_KEY_VERSION,
  vectorGpuBlurCacheKey,
} from "../src/vector-gpu-blur-cache-key.ts";
import {
  planVectorTextSingleShadowBlur,
} from "../src/vector-text-single-shadow.ts";

assert.equal(VECTOR_GPU_BLUR_CACHE_KEY_VERSION, "vector-gpu-blur-content-v2");

const key = (kind, revision, plan) => vectorGpuBlurCacheKey(
  { kind, revision },
  plan,
);
const baseBounds = { left: 0, top: 0, right: 100, bottom: 40 };
const basePlan = planVectorTextSingleShadowBlur(baseBounds, 6, 1);

assert.equal(
  key("mesh", "geometry-a:lod-0", basePlan),
  key("mesh", "geometry-a:lod-0", basePlan),
  "equivalent SVG copies must share one content-addressed blur matte",
);
assert.equal(
  key("slug", "slug-a", basePlan),
  key("slug", "slug-a", basePlan),
  "equivalent text copies must share one content-addressed blur matte",
);
assert.notEqual(
  key("mesh", "geometry-a:lod-0", basePlan),
  key("mesh", "geometry-b:lod-0", basePlan),
  "a geometry revision must invalidate the blur matte",
);

const changedBlurPlan = planVectorTextSingleShadowBlur(baseBounds, 6.00001, 1);
assert.notEqual(
  key("mesh", "geometry-a:lod-0", basePlan),
  key("mesh", "geometry-a:lod-0", changedBlurPlan),
  "a sub-rounded blur change must invalidate the blur matte",
);

const lowerLodPlan = planVectorTextSingleShadowBlur(baseBounds, 1, 1);
const higherLodPlan = planVectorTextSingleShadowBlur(baseBounds, 1, 2);
assert.notEqual(
  key("mesh", "geometry-a:lod-0", lowerLodPlan),
  key("mesh", "geometry-a:lod-1", higherLodPlan),
  "a new source/blur LOD must allocate a distinct matte",
);

const exactLeftDelta = Math.abs(basePlan.bounds[0]) * Number.EPSILON;
assert.notEqual(
  key("mesh", "geometry-a:lod-0", basePlan),
  key("mesh", "geometry-a:lod-0", {
    ...basePlan,
    bounds: [
      basePlan.bounds[0] - exactLeftDelta,
      basePlan.bounds[1],
      basePlan.bounds[2],
      basePlan.bounds[3],
    ],
  }),
  "every exact matte bound must participate in the cache key",
);
assert.notEqual(
  key("mesh", "geometry-a:lod-0", basePlan),
  key("mesh", "geometry-a:lod-0", {
    ...basePlan,
    scale: basePlan.scale + Number.EPSILON,
  }),
  "float plan fields must not collapse through decimal rounding",
);
assert.notEqual(
  key("mesh", "shared-revision", basePlan),
  key("slug", "shared-revision", basePlan),
  "different source rasterizers must never alias by revision alone",
);

const controllerSource = readFileSync(
  new URL("../src/mixed-scene-controller.ts", import.meta.url),
  "utf8",
);
assert.equal(
  controllerSource.match(/const blurKey = vectorGpuBlurCacheKey\(/g)?.length,
  3,
  "SVG, text outer shadow and text inner shadow must all use the shared key",
);
assert.match(
  controllerSource,
  /revision: this\.gpuBlurSourceRevision\(node\.id, sourceMesh\.revision\)/,
);
assert.equal(
  controllerSource.match(
    /revision: this\.gpuBlurSourceRevision\(node\.id, geometry\.slug\.revision\)/g,
  )?.length,
  2,
);
assert.match(
  controllerSource,
  /private gpuBlurSourceRevision\(nodeId: number, contentRevision: string\)[\s\S]*?vectorGpuResourceSharingEnabled[\s\S]*?`node:\$\{nodeId\}:\$\{contentRevision\}`/,
  "the benchmark switch must retain a node-scoped before case",
);
assert.doesNotMatch(
  controllerSource,
  /"vector-(?:svg|text)-gpu-blur-v1"/,
  "node-scoped rounded blur keys must not remain in the renderer",
);

console.log(
  "Vector GPU blur cache keys verified: copy sharing and exact content invalidation.",
);
