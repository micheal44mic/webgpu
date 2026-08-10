import type { BrushEngine } from "./brush-engine";
import type { DirtyRect } from "./engine-stroke-types";
import type { MixedVectorTextController } from "./mixed-vector-text-controller";
import { parseVectorSvg } from "./vector-svg-import";

export type LayerMergeGpuTestCase = "raster" | "clipping" | "mixed" | "memory" | "reject";

interface PixelDiff {
  readonly byteLength: number;
  readonly changedBytes: number;
  readonly changedPixels: number;
  readonly maxDelta: number;
  readonly meanDelta: number;
  readonly maximumSample?: Readonly<{
    x: number;
    y: number;
    channel: number;
    before: number;
    after: number;
  }>;
  readonly changedBounds?: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

interface Float16ScaleDiff {
  readonly componentCount: number;
  readonly maxAbsoluteDelta: number;
  readonly meanAbsoluteDelta: number;
}

export interface LayerMergeGpuTestReport {
  readonly version: 1;
  readonly testCase: LayerMergeGpuTestCase;
  readonly passed: boolean;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly details: unknown;
}

function comparePixels(
  before: Uint8Array,
  after: Uint8Array,
  rowWidth?: number,
): PixelDiff {
  if (before.byteLength !== after.byteLength) {
    throw new Error(
      `Confronto merge incoerente: ${before.byteLength} byte prima, ${after.byteLength} dopo.`,
    );
  }
  let changedBytes = 0;
  let changedPixels = 0;
  let maxDelta = 0;
  let totalDelta = 0;
  let maximumByteIndex = -1;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < before.byteLength; index += 1) {
    const delta = Math.abs(before[index] - after[index]);
    if (delta > 0) changedBytes += 1;
    if (delta > maxDelta) {
      maxDelta = delta;
      maximumByteIndex = index;
    }
    totalDelta += delta;
  }
  for (let index = 0; index < before.byteLength; index += 4) {
    const changed = before[index] !== after[index]
      || before[index + 1] !== after[index + 1]
      || before[index + 2] !== after[index + 2]
      || before[index + 3] !== after[index + 3];
    if (changed) {
      changedPixels += 1;
      if (rowWidth && rowWidth > 0) {
        const pixelIndex = index / 4;
        const x = pixelIndex % rowWidth;
        const y = Math.floor(pixelIndex / rowWidth);
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }
  }
  return {
    byteLength: before.byteLength,
    changedBytes,
    changedPixels,
    maxDelta,
    meanDelta: before.byteLength > 0 ? totalDelta / before.byteLength : 0,
    ...(rowWidth && maximumByteIndex >= 0
      ? {
        maximumSample: {
          x: Math.floor(maximumByteIndex / 4) % rowWidth,
          y: Math.floor(Math.floor(maximumByteIndex / 4) / rowWidth),
          channel: maximumByteIndex % 4,
          before: before[maximumByteIndex],
          after: after[maximumByteIndex],
        },
      }
      : {}),
    ...(Number.isFinite(left)
      ? { changedBounds: { x: left, y: top, width: right - left, height: bottom - top } }
      : {}),
  };
}

function float16ToNumber(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : NaN;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

function compareFloat16Scale(
  source: Uint8Array,
  result: Uint8Array,
  scale: number,
): Float16ScaleDiff {
  if (source.byteLength !== result.byteLength || source.byteLength % 2 !== 0) {
    throw new Error("Confronto RGBA16F del merge non valido.");
  }
  const sourceView = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const resultView = new DataView(result.buffer, result.byteOffset, result.byteLength);
  let maxAbsoluteDelta = 0;
  let totalAbsoluteDelta = 0;
  const componentCount = source.byteLength / 2;
  for (let index = 0; index < componentCount; index += 1) {
    const expected = float16ToNumber(sourceView.getUint16(index * 2, true)) * scale;
    const actual = float16ToNumber(resultView.getUint16(index * 2, true));
    const delta = Math.abs(expected - actual);
    maxAbsoluteDelta = Math.max(maxAbsoluteDelta, delta);
    totalAbsoluteDelta += delta;
  }
  return {
    componentCount,
    maxAbsoluteDelta,
    meanAbsoluteDelta: componentCount > 0 ? totalAbsoluteDelta / componentCount : 0,
  };
}

function captureRect(engine: BrushEngine, centerX: number, centerY: number): DirtyRect {
  const environment = engine.getBenchmarkEnvironment();
  const width = Math.max(64, Math.min(760, environment.canvasWidth - 8));
  const height = Math.max(64, Math.min(620, environment.canvasHeight - 8));
  return {
    x: Math.round(centerX - width * 0.5),
    y: Math.round(centerY - height * 0.5),
    width,
    height,
  };
}

async function settlePresentation(
  engine: BrushEngine,
  controller?: MixedVectorTextController,
): Promise<void> {
  const deadline = performance.now() + 15_000;
  for (;;) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    await engine.waitForVectorTextPresentationCompletion();
    await engine.waitForIdle();
    const diagnostics = controller?.getDiagnostics();
    if (
      !diagnostics
      || (
        diagnostics.effectWorkerPendingJobs === 0
        && diagnostics.atomicEffectPendingNodes === 0
        && !diagnostics.zoomUnsafeExactRefreshInFlight
        && !diagnostics.zoomUnsafeExactRefreshRequestPending
      )
    ) return;
    if (performance.now() >= deadline) {
      throw new Error("La presentazione vettoriale non è diventata stabile entro 15 s.");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}

async function readStablePresentation(
  engine: BrushEngine,
  rect: DirtyRect,
  controller?: MixedVectorTextController,
): Promise<Uint8Array> {
  await settlePresentation(engine, controller);
  let previous = await engine.readPresentationLayerRect(rect);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    await settlePresentation(engine, controller);
    const current = await engine.readPresentationLayerRect(rect);
    if (comparePixels(previous, current).maxDelta === 0) return current;
    previous = current;
  }
  throw new Error("La cache di presentazione non è rimasta identica per due letture consecutive.");
}

async function drawTap(
  engine: BrushEngine,
  x: number,
  y: number,
  color: string,
  size: number,
  hardness: number,
  timeMs: number,
): Promise<void> {
  engine.setBrushSettings({
    tool: "paint",
    shape: "circle",
    grainMode: "off",
    color,
    size,
    hardness,
    spacingPercent: 2,
    stabilization: 0,
    count: 1,
    flow: 1,
    opacity: 1,
    blendMode: "normal",
    shapeScatter: 0,
    hueJitterDegrees: 0,
    saturationJitter: 0,
    lightnessJitter: 0,
    darknessJitter: 0,
    positionJitterLateral: 0,
    positionJitterLinear: 0,
  });
  engine.beginStrokeAtLayer({ x, y, pressure: 1, timeMs });
  engine.extendStrokeAtLayer([{ x: x + 1, y, pressure: 1, timeMs: timeMs + 16 }]);
  engine.endStroke(timeMs + 16);
  await engine.waitForIdle();
}

function requireFreshDocument(engine: BrushEngine): void {
  const stats = engine.getStats();
  const history = engine.getHistoryState();
  if (
    stats.layerFormat !== "rgba16float"
    || stats.layers.length !== 1
    || stats.layers[0]?.hasContent
    || history.actionCount !== 0
    || history.cursor !== 0
  ) {
    throw new Error(
      "La sonda merge richiede una pagina dev nuova con un solo raster RGBA16F vuoto.",
    );
  }
}

async function runRasterCase(
  engine: BrushEngine,
  controller: MixedVectorTextController,
): Promise<LayerMergeGpuTestReport> {
  const center = { x: 2048, y: 2048 };
  engine.setLayerCompositeTestView(center.x, center.y, 1);
  await drawTap(engine, center.x, center.y, "#d95d39", 820, 0.45, 1_000);
  await engine.setLayerOpacity(0, 0.35);
  await engine.setLayerBlendMode(0, "multiply");
  await engine.addLayer("Raster Screen");
  await drawTap(engine, center.x + 90, center.y - 40, "#3f88c5", 760, 0.8, 1_100);
  await engine.setLayerOpacity(1, 0.7);
  await engine.setLayerBlendMode(1, "screen");
  await engine.setLayerReference(1, true);
  const keys = engine.getMixedSceneSnapshot()!.items.map((item) => item.key);
  const rect = captureRect(engine, center.x, center.y);
  const before = await engine.readPresentationLayerRect(rect);
  const historyBefore = engine.getHistoryState();
  const result = await controller.mergeSceneItems(keys);
  const after = await engine.readPresentationLayerRect(rect);
  const mergedStats = engine.getStats();
  const mergeDiff = comparePixels(before, after);
  const undoReturned = await engine.undo();
  await settlePresentation(engine);
  const afterUndo = await engine.readPresentationLayerRect(rect);
  const undoDiff = comparePixels(before, afterUndo);
  const undoLayerCount = engine.getStats().layers.length;
  const redoReturned = await engine.redo();
  await settlePresentation(engine);
  const afterRedo = await engine.readPresentationLayerRect(rect);
  const redoDiff = comparePixels(after, afterRedo);
  const output = mergedStats.layers[0];
  const checks = {
    oneAtomicAction: engine.getHistoryState().actionCount === historyBefore.actionCount + 1,
    twoRasterInputs: result.rasterInputCount === 2 && result.vectorInputCount === 0,
    exactPresentation: mergeDiff.maxDelta <= 4,
    normalizedOutput: mergedStats.layers.length === 1
      && output?.blendMode === "normal"
      && output.opacity === 1,
    referenceTransferred: output?.reference === true,
    undoExact: undoReturned && undoDiff.maxDelta <= 4 && undoLayerCount === 2,
    redoExact: redoReturned && redoDiff.maxDelta <= 4 && engine.getStats().layers.length === 1,
  };
  return {
    version: 1,
    testCase: "raster",
    passed: Object.values(checks).every(Boolean),
    checks,
    details: { result, rect, mergeDiff, undoDiff, redoDiff },
  };
}

async function runClippingCase(
  engine: BrushEngine,
  controller: MixedVectorTextController,
): Promise<LayerMergeGpuTestReport> {
  const variant = new URLSearchParams(window.location.search).get("layerMergeVariant")
    ?? "single";
  const multiUnit = variant === "multi";
  const center = { x: 2048, y: 2048 };
  engine.setLayerCompositeTestView(center.x, center.y, 1);
  await drawTap(engine, center.x, center.y, "#4b8fd8", 650, 0, 2_000);
  await engine.setLayerOpacity(0, 0.83);
  await engine.setLayerBlendMode(0, "hue");
  await engine.setRasterColorOverlayStyle({ enabled: true, color: "#00ff00", opacity: 100 });
  const parentId = engine.getStats().layers[0].id;

  await engine.addClippingMaskLayer();
  await drawTap(engine, center.x, center.y, "#f05272", 980, 1, 2_100);
  await engine.setLayerOpacity(1, 0.61);
  await engine.setLayerBlendMode(1, "multiply");
  await engine.setRasterColorOverlayStyle({
    enabled: true,
    color: "#ff00ff",
    opacity: 42,
  });

  await engine.addClippingMaskLayer();
  await drawTap(engine, center.x, center.y, "#43b9ef", 920, 1, 2_200);
  await engine.setLayerOpacity(2, 0.46);
  await engine.setLayerBlendMode(2, "screen");

  await engine.addClippingMaskLayer();
  await drawTap(engine, center.x, center.y, "#8ac926", 760, 1, 2_300);
  await engine.setLayerOpacity(3, 0.37);
  await engine.setLayerBlendMode(3, "hard-light");
  await engine.setLayerReference(3, true);
  await engine.setLayerVisibility(3, false);

  if (multiUnit) {
    await engine.addLayer("Raster sopra il clipping");
    await drawTap(engine, center.x + 120, center.y - 80, "#f6bd60", 720, 0.25, 2_400);
    await engine.setLayerOpacity(4, 0.49);
    await engine.setLayerBlendMode(4, "overlay");
  }

  const keys = engine.getMixedSceneSnapshot()!.items.map((item) => item.key);
  const inputIds = engine.getStats().layers.map((layer) => layer.id);
  const rect = captureRect(engine, center.x, center.y);
  let activeSelectionDiff: PixelDiff | null = null;
  if (!multiUnit) {
    const childActivePixels = await readStablePresentation(engine, rect);
    await engine.setActiveLayer(0);
    const parentActivePixels = await readStablePresentation(engine, rect);
    activeSelectionDiff = comparePixels(childActivePixels, parentActivePixels, rect.width);
    await engine.setActiveLayer(3);
  }
  const before = await readStablePresentation(engine, rect);
  const result = await controller.mergeSceneItems(keys);
  const after = await engine.readPresentationLayerRect(rect);
  const mergeDiff = comparePixels(before, after);
  const merged = engine.getStats().layers[0];
  const undoReturned = await engine.undo();
  await settlePresentation(engine);
  const undoStats = engine.getStats();
  const undoDiff = comparePixels(before, await engine.readPresentationLayerRect(rect));
  const restoredParent = engine.layerStack.byId(parentId);
  const restoredHidden = undoStats.layers.find((layer) => layer.id === inputIds[3]);
  const redoReturned = await engine.redo();
  await settlePresentation(engine);
  const redoDiff = comparePixels(after, await engine.readPresentationLayerRect(rect));
  const checks = {
    completeClippingUnit: result.rasterInputCount === (multiUnit ? 5 : 4)
      && result.preservesParentPresentation === !multiUnit,
    exactPresentation: mergeDiff.maxDelta <= 4,
    parentOuterContract: multiUnit
      ? merged?.opacity === 1 && merged.blendMode === "normal"
      : merged?.opacity === 0.83 && merged.blendMode === "hue",
    activeSelectionInvariant: activeSelectionDiff === null
      || activeSelectionDiff.maxDelta <= 4,
    referenceTransferred: merged?.reference === true,
    undoExact: undoReturned && undoDiff.maxDelta <= 4,
    undoRestoresStructure: undoStats.layers.map((layer) => layer.id).join(",")
      === inputIds.join(",")
      && undoStats.layers.slice(1, 4).every((layer) => layer.clippingParentId === parentId)
      && (!multiUnit || undoStats.layers[4]?.clippingParentId === null),
    undoRestoresHiddenChild: restoredHidden?.visible === false && restoredHidden.reference,
    undoRestoresParentEffect: Boolean(restoredParent?.colorOverlayStyle.enabled),
    redoExact: redoReturned && redoDiff.maxDelta <= 4 && engine.getStats().layers.length === 1,
  };
  return {
    version: 1,
    testCase: "clipping",
    passed: Object.values(checks).every(Boolean),
    checks,
    details: {
      variant,
      result,
      rect,
      activeSelectionDiff,
      mergeDiff,
      undoDiff,
      redoDiff,
      inputIds,
    },
  };
}

async function runMixedCase(
  engine: BrushEngine,
  controller: MixedVectorTextController,
): Promise<LayerMergeGpuTestReport> {
  const variant = new URLSearchParams(window.location.search).get("layerMergeVariant")
    ?? "extreme";
  const includeText = variant !== "svg";
  const includeSvg = variant !== "text";
  const includeEffects = variant === "extreme" || variant === "effects";
  const includeRaster = variant === "extreme"
    || variant === "raster"
    || variant === "rasteronly"
    || variant === "rasternormal"
    || variant === "rasteropaque"
    || variant === "rasterblendnormal"
    || variant === "rastereffect";
  const hideVectors = variant === "rasteronly"
    || variant === "rasternormal"
    || variant === "rasteropaque"
    || variant === "rastereffect";
  const center = { x: 2048, y: 2048 };
  engine.setLayerCompositeTestView(center.x, center.y, 1);
  if (includeRaster) {
    await drawTap(engine, center.x - 130, center.y + 40, "#264653", 900, 0.4, 3_000);
    await engine.setLayerOpacity(0, variant === "rasteropaque" ? 1 : 0.72);
    await engine.setLayerBlendMode(
      0,
      variant === "rasternormal"
        || variant === "rasterblendnormal"
        || variant === "rastereffect"
        ? "normal"
        : "multiply",
    );
    if (variant === "rastereffect") {
      await engine.setRasterColorOverlayStyle({
        enabled: true,
        color: "#2aff73",
        opacity: 68,
      });
    }
  } else {
    await engine.setLayerVisibility(0, false);
  }
  await engine.setLayerReference(0, true);

  if (includeText) {
    const textNode = await engine.addVectorTextNode({
      text: "Merge Åg",
      fontFamily: "Anton",
      fontSize: 260,
      color: "#e76f51",
      outlineWidth: includeEffects ? 18 : 0,
      outlineColor: "#fff3b0",
      outlineJoin: "round",
      blockShadowEnabled: false,
      blockShadowColor: "#000000",
      blockShadowOpacity: 0,
      blockShadowOffset: 0,
      blockShadowAngle: 0,
      blockShadowOutlineWidth: 0,
      singleShadowEnabled: includeEffects,
      singleShadowColor: "#000000",
      singleShadowOpacity: 0.45,
      singleShadowOffset: 24,
      singleShadowAngle: 125,
      singleShadowBlur: 12,
      innerShadowEnabled: false,
      innerShadowColor: "#000000",
      innerShadowOpacity: 0,
      innerShadowOffset: 0,
      innerShadowAngle: 0,
      innerShadowBlur: 0,
      x: center.x - 190,
      y: center.y + 20,
      scale: 1.05,
      rotation: 0.17,
    }, "Merge text");
    await engine.setVectorTextNodeOpacity(textNode.id, hideVectors ? 0 : 0.63);
  }

  if (includeSvg) {
    const svgDocument = parseVectorSvg(
      '<svg viewBox="0 0 300 300"><circle cx="95" cy="150" r="90" fill="#ff006e"/>'
        + '<rect x="120" y="45" width="150" height="210" rx="28" '
        + 'fill="#3a86ff" fill-opacity=".72"/></svg>',
      "merge-extreme.svg",
    );
    const svgNode = await engine.addVectorSvgNode({
      document: svgDocument,
      x: center.x + 180,
      y: center.y + 30,
      scale: 2.2,
      rotation: -0.22,
      outlineWidth: includeEffects ? 12 : 0,
      outlineColor: "#f8f9fa",
      outlineJoin: "round",
      singleShadowEnabled: includeEffects,
      singleShadowColor: "#000000",
      singleShadowOpacity: 0.4,
      singleShadowOffset: 20,
      singleShadowAngle: 35,
      singleShadowBlur: 10,
    }, "Merge SVG");
    await engine.setVectorSvgNodeOpacity(svgNode.id, hideVectors ? 0 : 0.58);
  }
  await settlePresentation(engine, controller);

  const keys = engine.getMixedSceneSnapshot()!.items.map((item) => item.key);
  const rect = captureRect(engine, center.x, center.y);
  const presentationPathBefore = {
    styleStackActive: engine.styleStackActive(),
    ordered: engine.usesOrderedScenePresentation(),
    tileBlend: engine.usesLayerBlendTilePresentation(),
  };
  const rawBefore = hideVectors && variant !== "rastereffect"
    ? await engine.readLayerPixels(rect)
    : null;
  const before = await readStablePresentation(engine, rect, controller);
  const historyBefore = engine.getHistoryState();
  const result = await controller.mergeSceneItems(keys);
  const rawAfter = rawBefore ? await engine.readLayerPixels(rect) : null;
  const after = await engine.readPresentationLayerRect(rect);
  const mergeDiff = comparePixels(before, after, rect.width);
  const merged = engine.getStats().layers[0];
  const undoReturned = await engine.undo();
  await settlePresentation(engine, controller);
  const undoSnapshot = engine.getMixedSceneSnapshot();
  const undoDiff = comparePixels(
    before,
    await readStablePresentation(engine, rect, controller),
  );
  const redoReturned = await engine.redo();
  await settlePresentation(engine);
  const redoDiff = comparePixels(after, await engine.readPresentationLayerRect(rect));
  const checks = {
    oneAtomicAction: engine.getHistoryState().actionCount === historyBefore.actionCount + 1,
    heterogeneousInputs: result.rasterInputCount === 1
      && result.vectorInputCount === Number(includeText) + Number(includeSvg),
    exactPresentation: mergeDiff.maxDelta <= 4,
    normalizedOutput: merged?.blendMode === "normal" && merged.opacity === 1,
    referenceTransferred: merged?.reference === true,
    undoExact: undoReturned && undoDiff.maxDelta <= 4,
    undoRestoresSemanticNodes: undoSnapshot?.items.map((item) => item.key).join(",")
      === keys.join(","),
    redoExact: redoReturned && redoDiff.maxDelta <= 4,
  };
  return {
    version: 1,
    testCase: "mixed",
    passed: Object.values(checks).every(Boolean),
    checks,
    details: {
      variant,
      result,
      rect,
      mergeDiff,
      undoDiff,
      redoDiff,
      rawOpacityDiff: rawBefore && rawAfter
        ? compareFloat16Scale(rawBefore, rawAfter, variant === "rasteropaque" ? 1 : 0.72)
        : null,
      presentationPathBefore,
      keys,
    },
  };
}

async function runMemoryCase(
  engine: BrushEngine,
  controller: MixedVectorTextController,
): Promise<LayerMergeGpuTestReport> {
  const variant = new URLSearchParams(window.location.search).get("layerMergeVariant")
    ?? "empty";
  const sparse = variant === "sparse" || variant === "reference";
  for (let index = 0; index < 16; index += 1) {
    if (index > 0) await engine.addLayer(`${sparse ? "Sparse" : "Empty"} ${index + 1}`);
    if (sparse) {
      const column = index % 4;
      const row = Math.floor(index / 4);
      await drawTap(
        engine,
        1540 + column * 330,
        1540 + row * 330,
        index % 2 === 0 ? "#ef476f" : "#118ab2",
        150,
        0.55,
        5_000 + index * 40,
      );
    }
  }
  if (variant === "reference") {
    await engine.setActiveLayer(0);
    await engine.setLayerReference(0, true);
    await engine.setActiveLayer(15);
  }
  const before = engine.getStats();
  const keys = engine.getMixedSceneSnapshot()!.items.map((item) => item.key);
  const result = await controller.mergeSceneItems(keys);
  const afterMerge = engine.getStats();
  const undoReturned = await engine.undo();
  await settlePresentation(engine);
  const afterUndo = engine.getStats();
  await new Promise((resolve) => window.setTimeout(resolve, 500));
  const afterSettle = engine.getStats();
  const redoReturned = await engine.redo();
  await settlePresentation(engine);
  const afterRedo = engine.getStats();
  const undoAgainReturned = await engine.undo();
  await settlePresentation(engine);
  const afterUndoAgain = engine.getStats();
  const hotAfterUndo = afterUndo.layers.filter((layer) => layer.hotAllocated).length;
  const hotAfterUndoAgain = afterUndoAgain.layers.filter((layer) => layer.hotAllocated).length;
  const expectedHotMaximum = variant === "reference" ? 2 : 1;
  const memoryEnvelopeMiB = before.gpuMemory.countedTotalMiB + 320;
  const checks = {
    sixteenInputsMerged: result.rasterInputCount === 16
      && afterMerge.layers.length === 1
      && (!sparse || result.tileCount > 0),
    undoReturned,
    undoRestoresSixteen: afterUndo.layers.length === 16,
    noInactiveHotLeak: hotAfterUndo <= expectedHotMaximum
      && hotAfterUndoAgain <= expectedHotMaximum,
    memoryReturnsToEnvelope: afterSettle.gpuMemory.countedTotalMiB <= memoryEnvelopeMiB,
    redoReturned: redoReturned && afterRedo.layers.length === 1,
    repeatedUndoStable: undoAgainReturned
      && afterUndoAgain.gpuMemory.countedTotalMiB <= memoryEnvelopeMiB,
    reservationReleased: afterUndoAgain.gpuMemory.governorReservedMiB === 0,
  };
  const memory = (stats: typeof before) => ({
    countedTotalMiB: stats.gpuMemory.countedTotalMiB,
    governorUsedMiB: stats.gpuMemory.governorUsedMiB,
    governorReservedMiB: stats.gpuMemory.governorReservedMiB,
    layerCount: stats.layers.length,
    hotCount: stats.layers.filter((layer) => layer.hotAllocated).length,
  });
  return {
    version: 1,
    testCase: "memory",
    passed: Object.values(checks).every(Boolean),
    checks,
    details: {
      result,
      variant,
      expectedHotMaximum,
      memoryEnvelopeMiB,
      before: memory(before),
      afterMerge: memory(afterMerge),
      afterUndo: memory(afterUndo),
      afterSettle: memory(afterSettle),
      afterRedo: memory(afterRedo),
      afterUndoAgain: memory(afterUndoAgain),
    },
  };
}

async function runRejectCase(
  engine: BrushEngine,
  controller: MixedVectorTextController,
): Promise<LayerMergeGpuTestReport> {
  const center = { x: 2048, y: 2048 };
  engine.setLayerCompositeTestView(center.x, center.y, 1);
  await drawTap(engine, center.x, center.y, "#26734d", 980, 0.55, 4_000);
  await engine.setLayerOpacity(0, 0.88);

  await engine.addLayer("Backdrop-dependent Multiply");
  await drawTap(engine, center.x - 40, center.y + 20, "#e63946", 760, 0.35, 4_100);
  await engine.setLayerOpacity(1, 0.67);
  await engine.setLayerBlendMode(1, "multiply");
  await engine.setLayerReference(1, true);

  await engine.addLayer("Backdrop-dependent Screen");
  await drawTap(engine, center.x + 55, center.y - 35, "#457b9d", 700, 0.7, 4_200);
  await engine.setLayerOpacity(2, 0.53);
  await engine.setLayerBlendMode(2, "screen");
  await settlePresentation(engine);

  const selectedKeys = engine.getMixedSceneSnapshot()!.items
    .slice(1)
    .map((item) => item.key);
  const rect = captureRect(engine, center.x, center.y);
  const beforePixels = await engine.readPresentationLayerRect(rect);
  const beforeHistory = engine.getHistoryState();
  const structuralState = () => ({
    activeId: engine.layerStack.active.id,
    sceneKeys: engine.getMixedSceneSnapshot()!.items.map((item) => item.key),
    layers: engine.getStats().layers.map((layer) => ({
      id: layer.id,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      reference: layer.reference,
      clippingParentId: layer.clippingParentId,
      hasContent: layer.hasContent,
    })),
  });
  const beforeStructure = structuralState();
  let rejectionMessage = "";
  try {
    await controller.mergeSceneItems(selectedKeys);
  } catch (error) {
    rejectionMessage = error instanceof Error ? error.message : String(error);
  }
  await settlePresentation(engine);
  const afterHistory = engine.getHistoryState();
  const afterStructure = structuralState();
  const presentationDiff = comparePixels(
    beforePixels,
    await engine.readPresentationLayerRect(rect),
    rect.width,
  );
  const checks = {
    rejectedForExternalBackdrop: rejectionMessage.includes("backdrop esterno"),
    presentationUntouched: presentationDiff.maxDelta === 0,
    structureUntouched: JSON.stringify(afterStructure) === JSON.stringify(beforeStructure),
    historyUntouched: afterHistory.actionCount === beforeHistory.actionCount
      && afterHistory.cursor === beforeHistory.cursor,
    noOutputLayer: afterStructure.layers.length === 3,
  };
  return {
    version: 1,
    testCase: "reject",
    passed: Object.values(checks).every(Boolean),
    checks,
    details: {
      selectedKeys,
      rejectionMessage,
      presentationDiff,
      beforeHistory: {
        actionCount: beforeHistory.actionCount,
        cursor: beforeHistory.cursor,
      },
      afterHistory: {
        actionCount: afterHistory.actionCount,
        cursor: afterHistory.cursor,
      },
    },
  };
}

export async function runLayerMergeGpuTest(
  engine: BrushEngine,
  controller: MixedVectorTextController,
  testCase: LayerMergeGpuTestCase,
): Promise<LayerMergeGpuTestReport> {
  requireFreshDocument(engine);
  if (testCase === "raster") return runRasterCase(engine, controller);
  if (testCase === "clipping") return runClippingCase(engine, controller);
  if (testCase === "mixed") return runMixedCase(engine, controller);
  if (testCase === "memory") return runMemoryCase(engine, controller);
  return runRejectCase(engine, controller);
}
