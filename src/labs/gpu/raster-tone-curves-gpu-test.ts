import type { BrushEngine } from "../../brush-engine";
import { decodeFloat16 } from "../../float16";
import {
  cloneRasterLayerSource,
  rasterLayerSourcesEqual,
} from "../../raster-layer-source";
import type { RasterToneCurveSet } from "../../raster-tone-curves-core";

export interface RasterToneCurvesGpuTestReport {
  readonly version: 1;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly document: Readonly<{ width: 512; height: 512 }>;
  readonly layers: Readonly<{
    referenceLayerId: number;
    selectedLayerId: number;
  }>;
  readonly checks: Readonly<{
    previewChangedSelectedRgb: boolean;
    previewPreservedAlpha: boolean;
    previewLeftReferenceExact: boolean;
    cancelRestoredSelectedExact: boolean;
    cancelLeftReferenceExact: boolean;
    cancelLeftHistoryExact: boolean;
    repeatedPreviewWasExact: boolean;
    applyCommittedOneAction: boolean;
    applyMatchedPreviewExact: boolean;
    applyPreservedAlpha: boolean;
    applyLeftReferenceExact: boolean;
    undoRestoredSelectedExact: boolean;
    undoLeftReferenceExact: boolean;
    undoMovedOneCursorStep: boolean;
    redoRestoredAppliedExact: boolean;
    redoLeftReferenceExact: boolean;
    redoMovedOneCursorStep: boolean;
    clippingRelationPreserved: boolean;
    clippedPresentationChangedLive: boolean;
    clippedPresentationCancelExact: boolean;
    clippedPresentationApplyMatchedPreview: boolean;
    clippedPresentationUndoExact: boolean;
    clippedPresentationRedoExact: boolean;
    upperPeerStayedExact: boolean;
    basePreviewChangedRgb: boolean;
    basePreviewPreservedAlpha: boolean;
    basePreviewLeftChildAndUpperExact: boolean;
    baseCancelRestoredPixelsAndPresentation: boolean;
  }>;
  readonly differingBytes: Readonly<{
    previewSelected: number;
    previewSelectedRgb: number;
    previewSelectedAlpha: number;
    previewReference: number;
    cancelSelected: number;
    cancelReference: number;
    repeatedPreview: number;
    applyVersusPreview: number;
    applySelectedAlpha: number;
    applyReference: number;
    undoSelected: number;
    undoReference: number;
    redoSelected: number;
    redoReference: number;
    upperPeerMaximum: number;
    clippedPresentationPreview: number;
    clippedPresentationCancel: number;
    clippedPresentationApply: number;
    clippedPresentationUndo: number;
    clippedPresentationRedo: number;
    basePreviewRgb: number;
    basePreviewAlpha: number;
    baseCancel: number;
  }>;
  readonly fixture: Readonly<{
    selectedNonZeroAlphaPixels: number;
    selectedTranslucentPixels: number;
  }>;
  readonly history: Readonly<{
    beforePreview: Readonly<{ actionCount: number; cursor: number }>;
    afterCancel: Readonly<{ actionCount: number; cursor: number }>;
    beforeApply: Readonly<{ actionCount: number; cursor: number }>;
    afterApply: Readonly<{ actionCount: number; cursor: number }>;
    afterUndo: Readonly<{ actionCount: number; cursor: number }>;
    afterRedo: Readonly<{ actionCount: number; cursor: number }>;
  }>;
  readonly integration: Readonly<{
    importedOriginalKeptSource: boolean;
    duplicateInheritedSource: boolean;
    transformBeforeCurvesKeptSource: boolean;
    transformBeforeCurvesChangedPixels: boolean;
    curvesDetachedOnlySelectedSource: boolean;
    curvesLeftImportedOriginalExact: boolean;
    curvesUndoRestoredSourceAndPixels: boolean;
    curvesRedoDetachedSourceAndPixels: boolean;
    transformAfterCurvesStayedRasterized: boolean;
    transformAfterCurvesChangedPixels: boolean;
    transformUndoRestoredCurvePixels: boolean;
    transformRedoRestoredTransformedPixels: boolean;
    svgWasRejectedWithoutMutation: boolean;
    svgRasterizedToNativeRaster: boolean;
    curvesChangedRasterizedSvgRgb: boolean;
    curvesPreservedRasterizedSvgAlpha: boolean;
    curvesLeftExistingRasterExactAfterSvgRasterization: boolean;
    importedLayerIndex: number;
    duplicateLayerIndex: number;
  }>;
  readonly gpuErrors: readonly string[];
}

const REQUIRED_DOCUMENT_SIZE = 512 as const;
const RGBA16F_BYTES_PER_PIXEL = 8;
const TEST_CURVES: Readonly<RasterToneCurveSet> = Object.freeze({
  composite: Object.freeze([
    Object.freeze({ x: 0, y: 0 }),
    Object.freeze({ x: 0.2, y: 0.46 }),
    Object.freeze({ x: 0.65, y: 0.86 }),
    Object.freeze({ x: 1, y: 1 }),
  ]),
  red: Object.freeze([Object.freeze({ x: 0, y: 0 }), Object.freeze({ x: 1, y: 1 })]),
  green: Object.freeze([Object.freeze({ x: 0, y: 0 }), Object.freeze({ x: 1, y: 1 })]),
  blue: Object.freeze([Object.freeze({ x: 0, y: 0 }), Object.freeze({ x: 1, y: 1 })]),
});

type HistoryCount = Readonly<{ actionCount: number; cursor: number }>;
type ProbeResult = Omit<RasterToneCurvesGpuTestReport, "passed" | "gpuErrors">;
type IntegrationReport = RasterToneCurvesGpuTestReport["integration"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function historyCount(engine: BrushEngine): HistoryCount {
  const state = engine.getHistoryState();
  return { actionCount: state.actionCount, cursor: state.cursor };
}

function countDifferingBytes(left: Uint8Array, right: Uint8Array): number {
  assert(left.byteLength === right.byteLength, "Pixel readbacks have different lengths.");
  let count = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) count += 1;
  }
  return count;
}

function countDifferingRgbBytes(left: Uint8Array, right: Uint8Array): number {
  assert(left.byteLength === right.byteLength, "Pixel readbacks have different lengths.");
  let count = 0;
  for (let index = 0; index < left.byteLength; index += RGBA16F_BYTES_PER_PIXEL) {
    for (let channelByte = 0; channelByte < 6; channelByte += 1) {
      if (left[index + channelByte] !== right[index + channelByte]) count += 1;
    }
  }
  return count;
}

function countDifferingAlphaBytes(left: Uint8Array, right: Uint8Array): number {
  assert(left.byteLength === right.byteLength, "Pixel readbacks have different lengths.");
  let count = 0;
  for (let index = 6; index < left.byteLength; index += RGBA16F_BYTES_PER_PIXEL) {
    if (left[index] !== right[index]) count += 1;
    if (left[index + 1] !== right[index + 1]) count += 1;
  }
  return count;
}

function countAlphaPixels(pixels: Uint8Array): {
  nonZero: number;
  translucent: number;
} {
  let nonZero = 0;
  let translucent = 0;
  const view = new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  for (let index = 6; index < pixels.byteLength; index += RGBA16F_BYTES_PER_PIXEL) {
    const alpha = decodeFloat16(view.getUint16(index, true));
    if (alpha > 0) nonZero += 1;
    if (alpha > 0 && alpha < 1) translucent += 1;
  }
  return { nonZero, translucent };
}

async function drawTap(
  engine: BrushEngine,
  x: number,
  y: number,
  color: string,
  opacity: number,
  timeMs: number,
): Promise<void> {
  engine.setBrushSettings({ color, opacity });
  await waitUntil(
    () => !engine.isPaintReadinessPending(),
    "paint resources for the Curves fixture",
  );
  assert(
    engine.beginStrokeAtLayer({ x, y, pressure: 1, timeMs }),
    "The Curves fixture stroke could not start.",
  );
  engine.extendStrokeAtLayer([{ x: x + 1, y, pressure: 1, timeMs: timeMs + 16 }]);
  engine.endStroke(timeMs + 16);
  await engine.waitForIdle();
}

async function readWholeLayer(engine: BrushEngine, layerIndex: number): Promise<Uint8Array> {
  return engine.readLayerPixels({
    x: 0,
    y: 0,
    width: REQUIRED_DOCUMENT_SIZE,
    height: REQUIRED_DOCUMENT_SIZE,
  }, layerIndex);
}

async function selectRasterLayer(engine: BrushEngine, layerIndex: number): Promise<void> {
  const stats = engine.getStats();
  const record = stats.layers[layerIndex];
  assert(record, `Raster layer ${layerIndex} is missing.`);
  const scene = engine.getMixedSceneSnapshot();
  const item = scene?.items.find(
    (candidate) => candidate.kind === "raster" && candidate.rasterLayerId === record.id,
  );
  assert(item, `Raster layer ${record.id} is missing from the mixed scene.`);
  await engine.setActiveMixedSceneItem(item.key);
  const selectedScene = engine.getMixedSceneSnapshot();
  assert(
    engine.getStats().activeLayerIndex === layerIndex
      && selectedScene?.selectedKey === item.key,
    `Raster layer ${record.id} was not selected atomically.`,
  );
}

function assertRasterPopulated(
  engine: BrushEngine,
  layerIndex: number,
  phase: string,
): void {
  const record = engine.layerStack.at(layerIndex);
  const active = engine.getStats().activeLayerIndex === layerIndex;
  const hasContent = active ? engine.layerHasContent : record.hasContent;
  const contentBounds = active ? engine.layerContentBounds : record.contentBounds;
  assert(
    hasContent && contentBounds !== null,
    `Raster layer ${record.id} became empty ${phase}.`,
  );
}

async function createImportedImageFixture(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 80;
  const context = canvas.getContext("2d");
  assert(context, "The browser did not provide a 2D canvas for the image fixture.");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = 0.62;
  context.fillStyle = "#d737a9";
  context.fillRect(4, 4, 88, 72);
  context.globalAlpha = 0.84;
  context.fillStyle = "#30c7dd";
  context.beginPath();
  context.arc(48, 40, 24, 0, Math.PI * 2);
  context.fill();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((candidate) => {
      if (candidate) resolve(candidate);
      else reject(new Error("The browser could not encode the image fixture."));
    }, "image/png");
  });
  return new File([blob], "curve-import-fixture.png", { type: "image/png" });
}

function createSvgFixture(): File {
  const source = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="80" viewBox="0 0 96 80">',
    '<rect width="96" height="80" rx="12" fill="#d737a9"/>',
    '<circle cx="48" cy="40" r="22" fill="#30c7dd"/>',
    "</svg>",
  ].join("");
  return new File([source], "curve-semantic-fixture.svg", { type: "image/svg+xml" });
}

function dispatchFileSelection(inputId: string, file: File): void {
  const input = document.getElementById(inputId);
  assert(input instanceof HTMLInputElement, `Missing file input #${inputId}.`);
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function waitUntil(
  predicate: () => boolean,
  description: string,
  timeoutMs = 60_000,
): Promise<void> {
  const startedAt = performance.now();
  while (!predicate()) {
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error(`Timeout while waiting for ${description}.`);
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
  }
}

async function runImportTransformAndSemanticProbe(
  engine: BrushEngine,
): Promise<IntegrationReport> {
  await engine.importRasterImageFile(await createImportedImageFixture());
  await engine.waitForIdle();
  const importedStats = engine.getStats();
  const importedLayerIndex = importedStats.activeLayerIndex;
  const importedRecord = engine.layerStack.at(importedLayerIndex);
  const importedSource = cloneRasterLayerSource(importedRecord.rasterSource);
  assert(importedSource, "The imported raster did not retain its immutable source.");

  const duplicate = await engine.duplicateSelectedLayer();
  assert(duplicate.kind === "raster", "The imported raster duplicate was not native raster.");
  await engine.waitForIdle();
  const duplicateLayerIndex = engine.getStats().activeLayerIndex;
  const duplicateSource = cloneRasterLayerSource(
    engine.layerStack.at(duplicateLayerIndex).rasterSource,
  );
  const duplicateInheritedSource = rasterLayerSourcesEqual(importedSource, duplicateSource);
  const duplicateBeforeTransform = await readWholeLayer(engine, duplicateLayerIndex);

  const transformBefore = await engine.beginRasterLayerTransform("affine");
  assert(transformBefore, "Transform did not open on the imported duplicate.");
  engine.updateRasterLayerTransform({
    x: transformBefore.x + 7,
    y: transformBefore.y - 5,
    scaleX: 0.82,
    scaleY: 0.82,
    rotation: 0.06,
  });
  assert(
    await engine.commitRasterLayerTransform(),
    "Transform before Curves did not commit on the imported duplicate.",
  );
  await engine.waitForIdle();
  const transformedSource = cloneRasterLayerSource(
    engine.layerStack.at(duplicateLayerIndex).rasterSource,
  );
  const transformBeforeCurvesKeptSource = transformedSource !== null
    && rasterLayerSourcesEqual(importedSource, engine.layerStack.at(importedLayerIndex).rasterSource);
  const importedBeforeCurves = await readWholeLayer(engine, importedLayerIndex);
  const duplicateBeforeCurves = await readWholeLayer(engine, duplicateLayerIndex);
  const transformBeforeCurvesChangedPixels = countDifferingBytes(
    duplicateBeforeTransform,
    duplicateBeforeCurves,
  ) > 0;

  assert(await engine.beginRasterToneCurves(TEST_CURVES), "Curves did not open on the duplicate.");
  assert(await engine.commitRasterToneCurves(), "Curves did not apply to the duplicate.");
  await engine.waitForIdle();
  const duplicateAfterCurves = await readWholeLayer(engine, duplicateLayerIndex);
  const importedAfterCurves = await readWholeLayer(engine, importedLayerIndex);
  const curvesDetachedOnlySelectedSource = engine.layerStack.at(duplicateLayerIndex).rasterSource === null
    && rasterLayerSourcesEqual(importedSource, engine.layerStack.at(importedLayerIndex).rasterSource);
  const curvesLeftImportedOriginalExact = countDifferingBytes(
    importedBeforeCurves,
    importedAfterCurves,
  ) === 0;
  assert(
    countDifferingRgbBytes(duplicateBeforeCurves, duplicateAfterCurves) > 0,
    "Curves did not change the imported duplicate's RGB values.",
  );

  assert(await engine.undo(), "Undo refused Curves on the imported duplicate.");
  await engine.waitForIdle();
  const duplicateAfterCurvesUndo = await readWholeLayer(engine, duplicateLayerIndex);
  const curvesUndoRestoredSourceAndPixels = rasterLayerSourcesEqual(
    transformedSource,
    engine.layerStack.at(duplicateLayerIndex).rasterSource,
  ) && countDifferingBytes(duplicateBeforeCurves, duplicateAfterCurvesUndo) === 0;

  assert(await engine.redo(), "Redo refused Curves on the imported duplicate.");
  await engine.waitForIdle();
  const duplicateAfterCurvesRedo = await readWholeLayer(engine, duplicateLayerIndex);
  const curvesRedoDetachedSourceAndPixels = engine.layerStack.at(duplicateLayerIndex).rasterSource === null
    && countDifferingBytes(duplicateAfterCurves, duplicateAfterCurvesRedo) === 0;

  const transformAfter = await engine.beginRasterLayerTransform("affine");
  assert(transformAfter, "Transform did not open after Curves.");
  engine.updateRasterLayerTransform({
    x: transformAfter.x + 6,
    y: transformAfter.y + 4,
    scaleX: 0.92,
    scaleY: 0.92,
    rotation: transformAfter.rotation - 0.04,
  });
  assert(await engine.commitRasterLayerTransform(), "Transform after Curves did not commit.");
  await engine.waitForIdle();
  const duplicateAfterTransform = await readWholeLayer(engine, duplicateLayerIndex);
  const transformAfterCurvesChangedPixels = countDifferingBytes(
    duplicateAfterCurves,
    duplicateAfterTransform,
  ) > 0;
  const transformAfterCurvesStayedRasterized = engine.layerStack.at(
    duplicateLayerIndex,
  ).rasterSource === null;
  assert(await engine.undo(), "Undo refused Transform after Curves.");
  await engine.waitForIdle();
  const transformUndoRestoredCurvePixels = countDifferingBytes(
    duplicateAfterCurves,
    await readWholeLayer(engine, duplicateLayerIndex),
  ) === 0 && engine.layerStack.at(duplicateLayerIndex).rasterSource === null;
  assert(await engine.redo(), "Redo refused Transform after Curves.");
  await engine.waitForIdle();
  const transformRedoRestoredTransformedPixels = countDifferingBytes(
    duplicateAfterTransform,
    await readWholeLayer(engine, duplicateLayerIndex),
  ) === 0 && engine.layerStack.at(duplicateLayerIndex).rasterSource === null;

  const historyBeforeSvg = historyCount(engine);
  const rasterBeforeSvgAttempt = await readWholeLayer(engine, duplicateLayerIndex);
  dispatchFileSelection("vectorSvgFileInput", createSvgFixture());
  await waitUntil(() => {
    const scene = engine.getMixedSceneSnapshot();
    const selected = scene?.items.find((item) => item.key === scene.selectedKey);
    const history = engine.getHistoryState();
    return selected?.kind === "svg"
      && !history.busy
      && history.actionCount === historyBeforeSvg.actionCount + 1;
  }, "semantic SVG import");
  await engine.waitForIdle();
  const historyAfterSvg = historyCount(engine);
  const blockedResult = await engine.beginRasterToneCurves(TEST_CURVES);
  const historyAfterBlockedCurves = historyCount(engine);
  const selectedAfterBlockedCurves = engine.getMixedSceneSnapshot()?.items.find(
    (item) => item.key === engine.getMixedSceneSnapshot()?.selectedKey,
  );
  const svgWasRejectedWithoutMutation = blockedResult === null
    && selectedAfterBlockedCurves?.kind === "svg"
    && engine.getHistoryState().openEdit === null
    && historyAfterBlockedCurves.actionCount === historyAfterSvg.actionCount
    && historyAfterBlockedCurves.cursor === historyAfterSvg.cursor
    && countDifferingBytes(
      rasterBeforeSvgAttempt,
      await readWholeLayer(engine, duplicateLayerIndex),
    ) === 0;

  const labController = (window as Window & {
    readonly __mixedSceneController?: {
      rasterizeSelectedSvgLayer(): Promise<unknown>;
    };
  }).__mixedSceneController;
  assert(labController, "The Labs vector controller is unavailable.");
  const rasterizedSvg = await labController.rasterizeSelectedSvgLayer();
  assert(rasterizedSvg, "The semantic SVG did not rasterize.");
  await engine.waitForIdle();
  const rasterizedScene = engine.getMixedSceneSnapshot();
  const rasterizedSelected = rasterizedScene?.items.find(
    (item) => item.key === rasterizedScene.selectedKey,
  );
  const rasterizedSvgLayerIndex = engine.getStats().activeLayerIndex;
  const rasterizedSvgRecord = engine.layerStack.at(rasterizedSvgLayerIndex);
  const svgRasterizedToNativeRaster = rasterizedSelected?.kind === "raster"
    && rasterizedSelected.rasterLayerId === rasterizedSvgRecord.id;
  const rasterizedSvgBeforeCurves = await readWholeLayer(engine, rasterizedSvgLayerIndex);
  const existingRasterBeforeRasterizedSvgCurves = await readWholeLayer(
    engine,
    duplicateLayerIndex,
  );
  assert(
    await engine.beginRasterToneCurves(TEST_CURVES),
    "Curves did not open after explicit SVG rasterization.",
  );
  assert(
    await engine.commitRasterToneCurves(),
    "Curves did not apply after explicit SVG rasterization.",
  );
  await engine.waitForIdle();
  const rasterizedSvgAfterCurves = await readWholeLayer(engine, rasterizedSvgLayerIndex);
  const curvesChangedRasterizedSvgRgb = countDifferingRgbBytes(
    rasterizedSvgBeforeCurves,
    rasterizedSvgAfterCurves,
  ) > 0;
  const curvesPreservedRasterizedSvgAlpha = countDifferingAlphaBytes(
    rasterizedSvgBeforeCurves,
    rasterizedSvgAfterCurves,
  ) === 0;
  const curvesLeftExistingRasterExactAfterSvgRasterization = countDifferingBytes(
    existingRasterBeforeRasterizedSvgCurves,
    await readWholeLayer(engine, duplicateLayerIndex),
  ) === 0;

  const report: IntegrationReport = {
    importedOriginalKeptSource: rasterLayerSourcesEqual(
      importedSource,
      engine.layerStack.at(importedLayerIndex).rasterSource,
    ),
    duplicateInheritedSource,
    transformBeforeCurvesKeptSource,
    transformBeforeCurvesChangedPixels,
    curvesDetachedOnlySelectedSource,
    curvesLeftImportedOriginalExact,
    curvesUndoRestoredSourceAndPixels,
    curvesRedoDetachedSourceAndPixels,
    transformAfterCurvesStayedRasterized,
    transformAfterCurvesChangedPixels,
    transformUndoRestoredCurvePixels,
    transformRedoRestoredTransformedPixels,
    svgWasRejectedWithoutMutation,
    svgRasterizedToNativeRaster,
    curvesChangedRasterizedSvgRgb,
    curvesPreservedRasterizedSvgAlpha,
    curvesLeftExistingRasterExactAfterSvgRasterization,
    importedLayerIndex,
    duplicateLayerIndex,
  };
  const failed = Object.entries(report)
    .filter(([name, passed]) => !name.endsWith("LayerIndex") && passed !== true)
    .map(([name]) => name);
  assert(failed.length === 0, `Curve integration test failed: ${failed.join(", ")}.`);
  return report;
}

async function runProbe(engine: BrushEngine): Promise<ProbeResult> {
  const startedAt = performance.now();
  engine.setBrushSettings({
    tool: "paint",
    shape: "circle",
    grainMode: "off",
    shapeScatter: 0,
    size: 132,
    spacingPercent: 25,
    stabilization: 0,
    startThickness: 1,
    endThickness: 1,
    count: 1,
    flow: 1,
    hardness: 0.72,
    blendMode: "normal",
    jitterMaster: 0,
    hueJitterDegrees: 0,
    saturationJitter: 0,
    lightnessJitter: 0,
    darknessJitter: 0,
    jitterPerCopy: false,
    positionJitterLateral: 0,
    positionJitterLinear: 0,
  });

  await drawTap(engine, 164, 256, "#d84a5c", 0.83, 1_000);
  assertRasterPopulated(engine, 0, "after painting the clipping base");
  const referenceLayerId = engine.getStats().layers[0].id;
  await engine.addClippingMaskLayer();
  await drawTap(engine, 164, 256, "#397bd8", 0.58, 2_000);
  assertRasterPopulated(engine, 0, "after painting the clipping child");

  const fixtureStats = engine.getStats();
  assert(fixtureStats.layerCount === 2, "The curve test fixture did not create two raster layers.");
  assert(fixtureStats.activeLayerIndex === 1, "The curve test target is not the active raster layer.");
  const selectedLayerId = fixtureStats.layers[1].id;
  assert(
    fixtureStats.layers[1].clippingParentId === referenceLayerId,
    "The curve test target is not attached to its clipping base.",
  );
  let clippingRelationPreserved = true;
  const trackClippingRelation = (): void => {
    clippingRelationPreserved = clippingRelationPreserved
      && engine.getStats().layers[1]?.clippingParentId === referenceLayerId;
  };
  const scene = engine.getMixedSceneSnapshot();
  const selectedItem = scene?.items.find((item) => item.key === scene.selectedKey);
  assert(
    selectedItem?.kind === "raster" && selectedItem.rasterLayerId === selectedLayerId,
    "The curve test target is not the selected scene item.",
  );

  await engine.addLayer("Curve test upper peer");
  await drawTap(engine, 410, 92, "#46b96b", 0.71, 3_000);
  assertRasterPopulated(engine, 0, "after painting the upper peer");
  assert(engine.getStats().activeLayerIndex === 2, "The upper raster peer was not created.");
  await selectRasterLayer(engine, 1);
  assert(engine.getStats().activeLayerIndex === 1, "The clipped curve target was not reselected.");

  const referenceBefore = await readWholeLayer(engine, 0);
  const selectedBefore = await readWholeLayer(engine, 1);
  const upperPeerBefore = await readWholeLayer(engine, 2);
  const clippedPresentationBefore = await engine.readPresentationPixelAtLayer(164, 256);
  const alphaFixture = countAlphaPixels(selectedBefore);
  assert(alphaFixture.nonZero > 0, "The curve test target has no painted pixels.");
  assert(
    alphaFixture.translucent > 0,
    "The curve test target needs translucent pixels to verify alpha preservation.",
  );

  const historyBeforePreview = historyCount(engine);
  const firstPreview = await engine.beginRasterToneCurves(TEST_CURVES);
  assert(firstPreview, "The curve preview did not open on the selected raster layer.");
  assert(engine.getHistoryState().openEdit === "curves", "The curve preview did not own its edit.");
  const selectedPreview = await readWholeLayer(engine, 1);
  const referenceDuringPreview = await readWholeLayer(engine, 0);
  const upperPeerDuringPreview = await readWholeLayer(engine, 2);
  const clippedPresentationPreview = await engine.readPresentationPixelAtLayer(164, 256);
  assertRasterPopulated(engine, 0, "during the clipping-child preview");
  trackClippingRelation();

  assert(await engine.cancelRasterToneCurves(), "Cancel refused the open curve preview.");
  await engine.waitForIdle();
  const selectedAfterCancel = await readWholeLayer(engine, 1);
  const referenceAfterCancel = await readWholeLayer(engine, 0);
  const upperPeerAfterCancel = await readWholeLayer(engine, 2);
  const clippedPresentationAfterCancel = await engine.readPresentationPixelAtLayer(164, 256);
  const historyAfterCancel = historyCount(engine);
  const cancelClosedEdit = engine.getHistoryState().openEdit === null;
  assertRasterPopulated(engine, 0, "after canceling the clipping-child preview");
  trackClippingRelation();

  const secondPreview = await engine.beginRasterToneCurves(TEST_CURVES);
  assert(secondPreview, "The repeated curve preview did not open.");
  const selectedRepeatedPreview = await readWholeLayer(engine, 1);
  const historyBeforeApply = historyCount(engine);
  assert(await engine.commitRasterToneCurves(), "Apply refused the non-identity curve.");
  await engine.waitForIdle();
  const selectedAfterApply = await readWholeLayer(engine, 1);
  const referenceAfterApply = await readWholeLayer(engine, 0);
  const upperPeerAfterApply = await readWholeLayer(engine, 2);
  const clippedPresentationAfterApply = await engine.readPresentationPixelAtLayer(164, 256);
  const historyAfterApply = historyCount(engine);
  assertRasterPopulated(engine, 0, "after applying Curves to the clipping child");
  trackClippingRelation();

  assert(await engine.undo(), "Undo refused the curve action.");
  await engine.waitForIdle();
  const selectedAfterUndo = await readWholeLayer(engine, 1);
  const referenceAfterUndo = await readWholeLayer(engine, 0);
  const upperPeerAfterUndo = await readWholeLayer(engine, 2);
  const clippedPresentationAfterUndo = await engine.readPresentationPixelAtLayer(164, 256);
  const historyAfterUndo = historyCount(engine);
  assertRasterPopulated(engine, 0, "after undoing Curves on the clipping child");
  trackClippingRelation();

  assert(await engine.redo(), "Redo refused the curve action.");
  await engine.waitForIdle();
  const selectedAfterRedo = await readWholeLayer(engine, 1);
  const referenceAfterRedo = await readWholeLayer(engine, 0);
  const upperPeerAfterRedo = await readWholeLayer(engine, 2);
  const clippedPresentationAfterRedo = await engine.readPresentationPixelAtLayer(164, 256);
  const historyAfterRedo = historyCount(engine);
  assertRasterPopulated(engine, 0, "after redoing Curves on the clipping child");
  trackClippingRelation();

  await selectRasterLayer(engine, 0);
  const basePresentationBefore = await engine.readPresentationPixelAtLayer(164, 256);
  assert(await engine.beginRasterToneCurves(TEST_CURVES), "Curves did not open on the clipping base.");
  const basePreview = await readWholeLayer(engine, 0);
  const childDuringBasePreview = await readWholeLayer(engine, 1);
  const upperDuringBasePreview = await readWholeLayer(engine, 2);
  const basePresentationPreview = await engine.readPresentationPixelAtLayer(164, 256);
  assert(await engine.cancelRasterToneCurves(), "Cancel refused Curves on the clipping base.");
  await engine.waitForIdle();
  const baseAfterCancel = await readWholeLayer(engine, 0);
  const basePresentationAfterCancel = await engine.readPresentationPixelAtLayer(164, 256);
  trackClippingRelation();
  await selectRasterLayer(engine, 1);

  const differingBytes = {
    previewSelected: countDifferingBytes(selectedBefore, selectedPreview),
    previewSelectedRgb: countDifferingRgbBytes(selectedBefore, selectedPreview),
    previewSelectedAlpha: countDifferingAlphaBytes(selectedBefore, selectedPreview),
    previewReference: countDifferingBytes(referenceBefore, referenceDuringPreview),
    cancelSelected: countDifferingBytes(selectedBefore, selectedAfterCancel),
    cancelReference: countDifferingBytes(referenceBefore, referenceAfterCancel),
    repeatedPreview: countDifferingBytes(selectedPreview, selectedRepeatedPreview),
    applyVersusPreview: countDifferingBytes(selectedPreview, selectedAfterApply),
    applySelectedAlpha: countDifferingAlphaBytes(selectedBefore, selectedAfterApply),
    applyReference: countDifferingBytes(referenceBefore, referenceAfterApply),
    undoSelected: countDifferingBytes(selectedBefore, selectedAfterUndo),
    undoReference: countDifferingBytes(referenceBefore, referenceAfterUndo),
    redoSelected: countDifferingBytes(selectedAfterApply, selectedAfterRedo),
    redoReference: countDifferingBytes(referenceBefore, referenceAfterRedo),
    upperPeerMaximum: Math.max(
      countDifferingBytes(upperPeerBefore, upperPeerDuringPreview),
      countDifferingBytes(upperPeerBefore, upperPeerAfterCancel),
      countDifferingBytes(upperPeerBefore, upperPeerAfterApply),
      countDifferingBytes(upperPeerBefore, upperPeerAfterUndo),
      countDifferingBytes(upperPeerBefore, upperPeerAfterRedo),
    ),
    clippedPresentationPreview: countDifferingBytes(
      clippedPresentationBefore,
      clippedPresentationPreview,
    ),
    clippedPresentationCancel: countDifferingBytes(
      clippedPresentationBefore,
      clippedPresentationAfterCancel,
    ),
    clippedPresentationApply: countDifferingBytes(
      clippedPresentationPreview,
      clippedPresentationAfterApply,
    ),
    clippedPresentationUndo: countDifferingBytes(
      clippedPresentationBefore,
      clippedPresentationAfterUndo,
    ),
    clippedPresentationRedo: countDifferingBytes(
      clippedPresentationAfterApply,
      clippedPresentationAfterRedo,
    ),
    basePreviewRgb: countDifferingRgbBytes(referenceBefore, basePreview),
    basePreviewAlpha: countDifferingAlphaBytes(referenceBefore, basePreview),
    baseCancel: countDifferingBytes(referenceBefore, baseAfterCancel),
  };
  const checks = {
    previewChangedSelectedRgb: differingBytes.previewSelected > 0
      && differingBytes.previewSelectedRgb > 0,
    previewPreservedAlpha: differingBytes.previewSelectedAlpha === 0,
    previewLeftReferenceExact: differingBytes.previewReference === 0,
    cancelRestoredSelectedExact: differingBytes.cancelSelected === 0,
    cancelLeftReferenceExact: differingBytes.cancelReference === 0,
    cancelLeftHistoryExact: historyAfterCancel.actionCount === historyBeforePreview.actionCount
      && historyAfterCancel.cursor === historyBeforePreview.cursor
      && cancelClosedEdit,
    repeatedPreviewWasExact: differingBytes.repeatedPreview === 0,
    applyCommittedOneAction:
      historyAfterApply.actionCount === historyBeforeApply.actionCount + 1
      && historyAfterApply.cursor === historyBeforeApply.cursor + 1,
    applyMatchedPreviewExact: differingBytes.applyVersusPreview === 0,
    applyPreservedAlpha: differingBytes.applySelectedAlpha === 0,
    applyLeftReferenceExact: differingBytes.applyReference === 0,
    undoRestoredSelectedExact: differingBytes.undoSelected === 0,
    undoLeftReferenceExact: differingBytes.undoReference === 0,
    undoMovedOneCursorStep:
      historyAfterUndo.actionCount === historyAfterApply.actionCount
      && historyAfterUndo.cursor === historyAfterApply.cursor - 1,
    redoRestoredAppliedExact: differingBytes.redoSelected === 0,
    redoLeftReferenceExact: differingBytes.redoReference === 0,
    redoMovedOneCursorStep:
      historyAfterRedo.actionCount === historyAfterApply.actionCount
      && historyAfterRedo.cursor === historyAfterApply.cursor,
    clippingRelationPreserved,
    clippedPresentationChangedLive: differingBytes.clippedPresentationPreview > 0,
    clippedPresentationCancelExact: differingBytes.clippedPresentationCancel === 0,
    clippedPresentationApplyMatchedPreview: differingBytes.clippedPresentationApply === 0,
    clippedPresentationUndoExact: differingBytes.clippedPresentationUndo === 0,
    clippedPresentationRedoExact: differingBytes.clippedPresentationRedo === 0,
    upperPeerStayedExact: differingBytes.upperPeerMaximum === 0,
    basePreviewChangedRgb: differingBytes.basePreviewRgb > 0,
    basePreviewPreservedAlpha: differingBytes.basePreviewAlpha === 0,
    basePreviewLeftChildAndUpperExact:
      countDifferingBytes(selectedAfterRedo, childDuringBasePreview) === 0
      && countDifferingBytes(upperPeerBefore, upperDuringBasePreview) === 0,
    baseCancelRestoredPixelsAndPresentation:
      differingBytes.baseCancel === 0
      && countDifferingBytes(basePresentationBefore, basePresentationAfterCancel) === 0
      && countDifferingBytes(basePresentationBefore, basePresentationPreview) > 0,
  };
  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  assert(
    failedChecks.length === 0,
    `Curve GPU test failed: ${failedChecks.join(", ")}.`,
  );
  const integration = await runImportTransformAndSemanticProbe(engine);

  return {
    version: 1,
    durationMs: performance.now() - startedAt,
    document: { width: REQUIRED_DOCUMENT_SIZE, height: REQUIRED_DOCUMENT_SIZE },
    layers: { referenceLayerId, selectedLayerId },
    checks,
    differingBytes,
    fixture: {
      selectedNonZeroAlphaPixels: alphaFixture.nonZero,
      selectedTranslucentPixels: alphaFixture.translucent,
    },
    history: {
      beforePreview: historyBeforePreview,
      afterCancel: historyAfterCancel,
      beforeApply: historyBeforeApply,
      afterApply: historyAfterApply,
      afterUndo: historyAfterUndo,
      afterRedo: historyAfterRedo,
    },
    integration,
  };
}

/** Destructive GPU probe for a fresh 512×512 RGBA16F raster document. */
export async function runRasterToneCurvesGpuTest(
  engine: BrushEngine,
): Promise<RasterToneCurvesGpuTestReport> {
  const initialStats = engine.getStats();
  const initialHistory = engine.getHistoryState();
  const initialScene = engine.getMixedSceneSnapshot();
  assert(
    engine.documentWidth === REQUIRED_DOCUMENT_SIZE
      && engine.documentHeight === REQUIRED_DOCUMENT_SIZE,
    `The curve GPU test requires a ${REQUIRED_DOCUMENT_SIZE}×${REQUIRED_DOCUMENT_SIZE} document.`,
  );
  assert(initialStats.layerFormat === "rgba16float", "The curve GPU test requires RGBA16F.");
  assert(
    initialStats.layerCount === 1
      && !initialStats.layers[0]?.hasContent
      && initialStats.activeLayerIndex === 0,
    "The curve GPU test requires exactly one empty active raster layer.",
  );
  assert(
    initialScene?.items.length === 1
      && initialScene.items[0]?.kind === "raster"
      && !initialScene.items[0].rasterHasContent,
    "The curve GPU test requires a fresh native-raster scene.",
  );
  assert(
    initialHistory.actionCount === 0
      && initialHistory.cursor === 0
      && initialHistory.openEdit === null
      && !initialHistory.busy
      && !initialHistory.inconsistent,
    "The curve GPU test requires empty, idle, consistent history.",
  );

  engine.device.pushErrorScope("validation");
  engine.device.pushErrorScope("internal");
  engine.device.pushErrorScope("out-of-memory");
  const gpuErrors: string[] = [];
  let probe: ProbeResult | null = null;
  let failure: unknown = null;
  try {
    probe = await runProbe(engine);
  } catch (error) {
    failure = error;
  } finally {
    if (engine.getHistoryState().openEdit === "curves") {
      try {
        await engine.cancelRasterToneCurves();
      } catch (cleanupError) {
        if (!failure) failure = cleanupError;
      }
    }
    const outOfMemoryError = await engine.device.popErrorScope();
    const internalError = await engine.device.popErrorScope();
    const validationError = await engine.device.popErrorScope();
    for (const error of [validationError, internalError, outOfMemoryError]) {
      if (error) gpuErrors.push(error.message);
    }
  }
  if (failure) throw failure;
  assert(probe, "The curve GPU probe did not produce a report.");
  assert(gpuErrors.length === 0, `WebGPU errors during curve test: ${gpuErrors.join("; ")}`);
  return { ...probe, passed: true, gpuErrors };
}
