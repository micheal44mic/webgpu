import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deferredEraseTextureMinimum,
  planDeferredErasePreview,
  planDeferredPreviewTextureExtent,
} from "../src/deferred-erase-preview-core.ts";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const types = read("src/engine-types.ts");
const engine = read("src/brush-engine.ts");
const runtime = read("src/engine-layer-runtime.ts");
const resources = read("src/engine-resource-setup.ts");
const html = read("index.html");
const main = read("src/main.ts");
const tools = read("src/canvas-tool-controller.ts");
const editorContract = read("src/editor-tools-contract.ts");

assert.match(types, /export type BrushTool = "paint" \| "erase" \| "blend";/);
assert.match(editorContract, /"paint",\s*"erase",\s*"blend",/);
assert.match(
  html,
  /id="mobileEraser"[\s\S]*?aria-label="Select Eraser"[\s\S]*?aria-pressed="false"/,
);
assert.doesNotMatch(
  html.match(/<button\s+id="mobileEraser"[\s\S]*?<\/button>/)?.[0] ?? "",
  /disabled/,
);
assert.match(
  html,
  /data-mobile-canvas-tool="erase"[\s\S]*?aria-label="Select Eraser"/,
);
assert.match(main, /const mobileEraserButton = element<HTMLButtonElement>\("mobileEraser"\)/);
assert.match(main, /eraserButton: mobileEraserButton/);
assert.match(tools, /eraserButton\.addEventListener\("click"[\s\S]*?this\.select\("erase"\)/);

assert.match(
  runtime,
  /const eraseBlend: GPUBlendState = \{[\s\S]*?srcFactor: "zero"[\s\S]*?dstFactor: "one-minus-src-alpha"[\s\S]*?srcFactor: "zero"[\s\S]*?dstFactor: "one-minus-src-alpha"/,
  "Eraser must use premultiplied destination-out for both RGB and alpha",
);
for (const pipeline of [
  "erasePipeline",
  "shapeErasePipeline",
  "shapeOccupancyErasePipeline",
  "grainErasePipeline",
  "grainShapeErasePipeline",
  "grainShapeOccupancyErasePipeline",
]) {
  assert.match(engine, new RegExp(`${pipeline}!: GPURenderPipeline`), `${pipeline} field missing`);
  assert.match(runtime, new RegExp(`const ${pipeline} = createErasePipeline`), `${pipeline} creation missing`);
  assert.match(runtime, new RegExp(`(?:brush|grain)Variant\\(${pipeline},[\\s\\S]*?eraseBlend\\)`), `${pipeline} selection clip missing`);
}
assert.match(
  engine,
  /const pipeline = cloneRender\?\.pipeline \?\? \(settings\.tool === "erase"[\s\S]*?grainShapeOccupancyErasePipeline[\s\S]*?shapeOccupancyErasePipeline[\s\S]*?erasePipeline/,
  "direct stamp submission must select Eraser pipelines for shape and grain",
);
assert.match(
  engine,
  /if \(tool !== "blend"\) \{[\s\S]*?capturePaintSelectionHistoryMask/,
  "Eraser must capture the pixel-selection mask for deterministic history replay",
);
assert.match(engine, /const curvePlanner = tool === "blend" \? null : this\.paintCurvePlanner/);
assert.match(engine, /thicknessDynamicsNeutral: tool === "blend" \|\| thicknessDynamicsIsNeutral/);

// Destination-out on premultiplied pixels scales every channel uniformly.
const destination = [0.4, 0.2, 0.1, 0.5];
const coverage = 0.25;
assert.deepEqual(
  destination.map((channel) => Number((channel * (1 - coverage)).toFixed(6))),
  [0.3, 0.15, 0.075, 0.375],
);

const firstPreview = planDeferredErasePreview({
  totalStampCount: 1,
  presentedStampCount: 0,
  previousPresentedRect: null,
  nextDirtyRect: { x: 300, y: 200, width: 40, height: 40 },
  forceRebuild: true,
  textureChanged: true,
  textureWidth: 256,
  textureHeight: 256,
  previousOriginX: 0,
  previousOriginY: 0,
  documentWidth: 2_048,
  documentHeight: 2_048,
});
assert.equal(firstPreview.rebuild, true);
assert.equal(firstPreview.stampStart, 0);
assert.deepEqual(firstPreview.presentedRect, { x: 300, y: 200, width: 40, height: 40 });

const appendedPreview = planDeferredErasePreview({
  totalStampCount: 2,
  presentedStampCount: 1,
  previousPresentedRect: firstPreview.presentedRect,
  nextDirtyRect: { x: 335, y: 205, width: 30, height: 30 },
  forceRebuild: false,
  textureChanged: false,
  textureWidth: 256,
  textureHeight: 256,
  previousOriginX: firstPreview.originX,
  previousOriginY: firstPreview.originY,
  documentWidth: 2_048,
  documentHeight: 2_048,
});
assert.equal(appendedPreview.rebuild, false);
assert.equal(appendedPreview.stampStart, 1);
assert.equal(appendedPreview.originX, firstPreview.originX);
assert.equal(appendedPreview.originY, firstPreview.originY);
assert.deepEqual(appendedPreview.presentedRect, { x: 300, y: 200, width: 65, height: 40 });

// A long stroke that remains inside its retained ROI must stay linear: the
// first frame draws one stamp, then every frame draws only its one new stamp.
let previousPlan = firstPreview;
let plannedStampWork = 1;
for (let totalStampCount = 2; totalStampCount <= 100; totalStampCount += 1) {
  const nextPlan = planDeferredErasePreview({
    totalStampCount,
    presentedStampCount: totalStampCount - 1,
    previousPresentedRect: previousPlan.presentedRect,
    nextDirtyRect: { x: 301, y: 201, width: 38, height: 38 },
    forceRebuild: false,
    textureChanged: false,
    textureWidth: 256,
    textureHeight: 256,
    previousOriginX: previousPlan.originX,
    previousOriginY: previousPlan.originY,
    documentWidth: 2_048,
    documentHeight: 2_048,
  });
  assert.equal(nextPlan.rebuild, false);
  plannedStampWork += totalStampCount - nextPlan.stampStart;
  previousPlan = nextPlan;
}
assert.equal(plannedStampWork, 100, "live preview work must be O(n), not triangular");

let textureExtent = 0;
let textureRebuilds = 0;
for (let contentExtent = 1; contentExtent <= 4_000; contentExtent += 10) {
  const nextExtent = planDeferredPreviewTextureExtent({
    currentExtent: textureExtent,
    requiredExtent: deferredEraseTextureMinimum(contentExtent, 4_000),
    maximumExtent: 4_000,
    quantum: 256,
    allowShrink: false,
  });
  if (nextExtent !== textureExtent) textureRebuilds += 1;
  textureExtent = nextExtent;
}
assert.ok(textureRebuilds <= 6, `growing ROI rebuilt ${textureRebuilds} times`);
assert.equal(textureExtent, 4_000);
assert.equal(
  planDeferredPreviewTextureExtent({
    currentExtent: 4_000,
    requiredExtent: deferredEraseTextureMinimum(40, 4_000),
    maximumExtent: 4_000,
    quantum: 256,
    allowShrink: true,
  }),
  256,
  "a new small gesture must release a heavily oversized preview texture",
);
assert.equal(
  planDeferredPreviewTextureExtent({
    currentExtent: 0,
    requiredExtent: 2_000,
    maximumExtent: 1_080,
    quantum: 256,
    allowShrink: false,
  }),
  1_080,
  "preview allocation must be clamped per rectangular-document axis",
);

const mergeTestRects = (left, right) => {
  if (!left) return { ...right };
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
};
const expandingStampCount = 800;
const expandingDocumentExtent = 4_000;
let expandingTextureWidth = 0;
let expandingTextureHeight = 0;
let expandingPresentedRect = null;
let expandingOriginX = 0;
let expandingOriginY = 0;
let expandingRebuilds = 0;
let expandingDrawnStamps = 0;
for (let index = 0; index < expandingStampCount; index += 1) {
  const centerX = 500 + 3_000 * index / (expandingStampCount - 1);
  const nextDirtyRect = {
    x: Math.max(0, Math.floor(centerX - 377)),
    y: 1_600,
    width: Math.min(expandingDocumentExtent, Math.ceil(centerX + 377))
      - Math.max(0, Math.floor(centerX - 377)),
    height: 754,
  };
  const requestedRect = mergeTestRects(expandingPresentedRect, nextDirtyRect);
  const nextTextureWidth = planDeferredPreviewTextureExtent({
    currentExtent: expandingTextureWidth,
    requiredExtent: deferredEraseTextureMinimum(
      requestedRect.width,
      expandingDocumentExtent,
    ),
    maximumExtent: expandingDocumentExtent,
    quantum: 256,
    allowShrink: false,
  });
  const nextTextureHeight = planDeferredPreviewTextureExtent({
    currentExtent: expandingTextureHeight,
    requiredExtent: deferredEraseTextureMinimum(
      requestedRect.height,
      expandingDocumentExtent,
    ),
    maximumExtent: expandingDocumentExtent,
    quantum: 256,
    allowShrink: false,
  });
  const plan = planDeferredErasePreview({
    totalStampCount: index + 1,
    presentedStampCount: index,
    previousPresentedRect: expandingPresentedRect,
    nextDirtyRect,
    forceRebuild: index === 0,
    textureChanged: nextTextureWidth !== expandingTextureWidth
      || nextTextureHeight !== expandingTextureHeight,
    textureWidth: nextTextureWidth,
    textureHeight: nextTextureHeight,
    previousOriginX: expandingOriginX,
    previousOriginY: expandingOriginY,
    documentWidth: expandingDocumentExtent,
    documentHeight: expandingDocumentExtent,
  });
  expandingTextureWidth = nextTextureWidth;
  expandingTextureHeight = nextTextureHeight;
  expandingPresentedRect = plan.presentedRect;
  expandingOriginX = plan.originX;
  expandingOriginY = plan.originY;
  if (plan.rebuild) expandingRebuilds += 1;
  expandingDrawnStamps += plan.rebuild ? index + 1 : 1;
}
assert.ok(
  expandingRebuilds <= 7,
  `expanding live Eraser ROI rebuilt ${expandingRebuilds} times`,
);
assert.ok(
  expandingDrawnStamps / expandingStampCount < 3,
  `expanding live Eraser drew ${(expandingDrawnStamps / expandingStampCount).toFixed(2)}× stamps`,
);

const resourceGrowth = planDeferredErasePreview({
  totalStampCount: 101,
  presentedStampCount: 100,
  previousPresentedRect: previousPlan.presentedRect,
  nextDirtyRect: { x: 540, y: 201, width: 40, height: 40 },
  forceRebuild: false,
  textureChanged: true,
  textureWidth: 512,
  textureHeight: 256,
  previousOriginX: previousPlan.originX,
  previousOriginY: previousPlan.originY,
  documentWidth: 2_048,
  documentHeight: 2_048,
});
assert.equal(resourceGrowth.rebuild, true);
assert.equal(resourceGrowth.stampStart, 0);

const roiRebase = planDeferredErasePreview({
  totalStampCount: 101,
  presentedStampCount: 100,
  previousPresentedRect: firstPreview.presentedRect,
  nextDirtyRect: { x: 180, y: 205, width: 20, height: 20 },
  forceRebuild: false,
  textureChanged: false,
  textureWidth: 256,
  textureHeight: 256,
  previousOriginX: firstPreview.originX,
  previousOriginY: firstPreview.originY,
  documentWidth: 2_048,
  documentHeight: 2_048,
});
assert.equal(roiRebase.rebuild, true, "an append outside the retained ROI must rebase once");
assert.equal(roiRebase.stampStart, 0);

const quickLineReplacement = planDeferredErasePreview({
  totalStampCount: 12,
  presentedStampCount: 100,
  previousPresentedRect: previousPlan.presentedRect,
  nextDirtyRect: { x: 400, y: 400, width: 120, height: 30 },
  forceRebuild: true,
  textureChanged: false,
  textureWidth: 512,
  textureHeight: 256,
  previousOriginX: previousPlan.originX,
  previousOriginY: previousPlan.originY,
  documentWidth: 2_048,
  documentHeight: 2_048,
});
assert.equal(quickLineReplacement.rebuild, true);
assert.equal(quickLineReplacement.stampStart, 0);

assert.match(engine, /preview\.stamps\.slice\(requestedStampStart\)/);
assert.match(
  engine,
  /const incrementalPreview = this\.straightLineAdjustment === null/,
  "selected and stabilized Paint/Eraser stamps must stay on the incremental append path",
);
assert.doesNotMatch(
  engine,
  /const incrementalPreview[\s\S]{0,160}pixelSelectionState/,
  "Pixel Selection must not restore cumulative Eraser preview replays",
);
assert.match(engine, /frame\.replacement \|\| frame\.incremental \? "load" : "clear"/);
assert.match(engine, /if \(frame\.replacement\) \{\s+encoder\.copyTextureToTexture/);
assert.match(
  engine,
  /pass\.draw\(STAMP_VERTICES_PER_COPY, frame\.stamps\.length \* physicalCopyCount, 0, 0\)/,
);
assert.match(engine, /\? \{ \.\.\.thicknessTailFrame\.presentedRect \}/);
assert.match(engine, /thicknessTailPresentationNeedsRefresh\(\)/);
assert.match(engine, /if \(stamps\.length === 0\) return retainedDeferredFrame\(\)/);
assert.match(engine, /stamps: \[\],\s+dirtyRect: \{ \.\.\.preview\.presentedRect \}/);
assert.match(engine, /if \(frame\.retained\) return;/);
assert.match(engine, /const retainedDeferredPreview = stroke\?\.deferredPreview === true/);
assert.match(
  resources,
  /requiredExtent: minimumWidth,[\s\S]*?maximumExtent: DOCUMENT_WIDTH,[\s\S]*?allowShrink,/,
  "the Eraser patch width must never exceed a rectangular document",
);
assert.match(
  resources,
  /requiredExtent: minimumHeight,[\s\S]*?maximumExtent: DOCUMENT_HEIGHT,[\s\S]*?allowShrink,/,
  "the Eraser patch height must never exceed a rectangular document",
);
assert.doesNotMatch(
  engine,
  /\|\| this\.thicknessTailPresentedRect !== null/,
  "a retained Eraser preview must not keep the animation-frame pump alive",
);

console.log(
  "Eraser: destination-out pipelines, live incremental preview, selection and UI verified.",
);
