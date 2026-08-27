import type { BrushEngine } from "../../brush-engine";
import { decodeFloat16 } from "../../float16";
import {
  cloneRasterLayerSource,
  rasterLayerSourcesEqual,
} from "../../raster-layer-source";
import {
  rasterGradientMapSettingsEqual,
  type RasterGradientMapSettings,
} from "../../raster-gradient-map-core";
import { rasterGradientMapShader } from "../../raster-gradient-map-shaders";

export interface RasterGradientMapGpuTestReport {
  readonly version: 1;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly document: Readonly<{ width: 512; height: 512; format: "rgba16float" }>;
  readonly layers: Readonly<{
    clippingBaseLayerId: number;
    clippingTargetLayerId: number;
    importedOriginalLayerId: number;
    importedDuplicateLayerId: number;
    svgRasterLayerId: number;
    textRasterLayerId: number;
  }>;
  readonly checks: Readonly<{
    shaderCompiled: boolean;
    selectedTargetWasNativeRaster: boolean;
    fixtureContainedTranslucentPixels: boolean;
    interpolationOutputsFinite: boolean;
    interpolationModesDistinct: boolean;
    reverseOutputDistinct: boolean;
    interpolationProbePreservedAlpha: boolean;
    interpolationProbeCancelExact: boolean;
    interpolationProbeLeftHistoryExact: boolean;
    previewChangedTargetRgb: boolean;
    previewPreservedAlpha: boolean;
    previewPreservedBounds: boolean;
    rapidLatestWinsExact: boolean;
    cancelRestoredTargetExact: boolean;
    cancelLeftBaseExact: boolean;
    cancelPreservedBounds: boolean;
    cancelLeftHistoryExact: boolean;
    applyCommittedOneAction: boolean;
    applyMatchedPreviewExact: boolean;
    applyPreservedAlpha: boolean;
    applyPreservedBounds: boolean;
    undoRestoredTargetExact: boolean;
    undoMovedOneCursorStep: boolean;
    redoRestoredAppliedExact: boolean;
    redoMovedOneCursorStep: boolean;
    baseStayedExact: boolean;
    clippingRelationPreserved: boolean;
    clippedPresentationChangedLive: boolean;
    clippedPresentationCancelExact: boolean;
    clippedPresentationApplyMatchedPreview: boolean;
    clippedPresentationUndoExact: boolean;
    clippedPresentationRedoExact: boolean;
    importedOriginalKeptSource: boolean;
    importedDuplicateInheritedSource: boolean;
    importedPreviewChangedSelectedRgb: boolean;
    importedPreviewPreservedAlpha: boolean;
    importedPreviewPreservedBounds: boolean;
    importedApplyCommittedOneAction: boolean;
    importedApplyDetachedOnlySelectedSource: boolean;
    importedApplyLeftOriginalExact: boolean;
    importedUndoRestoredSourceAndPixels: boolean;
    importedRedoDetachedSourceAndPixels: boolean;
    svgSelectedOnlyRasterization: boolean;
    svgOtherVectorStayedExact: boolean;
    svgActiveRasterMatched: boolean;
    svgClippingPreserved: boolean;
    svgRasterizeAndMapHistorySeparated: boolean;
    svgGradientChangedRgb: boolean;
    svgGradientPreservedAlphaAndBounds: boolean;
    textSelectedOnlyRasterization: boolean;
    textOtherLayersStayedExact: boolean;
    textActiveRasterMatched: boolean;
    textClippingPreserved: boolean;
    textRasterizeAndMapHistorySeparated: boolean;
    textGradientChangedRgb: boolean;
    textGradientPreservedAlphaAndBounds: boolean;
  }>;
  readonly differingBytes: Readonly<{
    encodedVersusLinear: number;
    encodedVersusPerceptual: number;
    linearVersusPerceptual: number;
    perceptualVersusReverse: number;
    rapidTargetRgb: number;
    rapidTargetAlpha: number;
    rapidBase: number;
    rapidVersusIsolatedFinal: number;
    cancelTarget: number;
    cancelBase: number;
    applyVersusPreview: number;
    applyTargetAlpha: number;
    applyBase: number;
    undoTarget: number;
    undoBase: number;
    redoTarget: number;
    redoBase: number;
    presentationRapid: number;
    presentationCancel: number;
    presentationRapidVersusIsolatedFinal: number;
    presentationApply: number;
    presentationUndo: number;
    presentationRedo: number;
    importedPreviewRgb: number;
    importedPreviewAlpha: number;
    importedApplyVersusPreview: number;
    importedOriginalAfterApply: number;
    importedUndo: number;
    importedRedo: number;
    svgGradientRgb: number;
    svgGradientAlpha: number;
    textGradientRgb: number;
    textGradientAlpha: number;
  }>;
  readonly history: Readonly<{
    beforePreview: HistoryCount;
    afterCancel: HistoryCount;
    beforeApply: HistoryCount;
    afterApply: HistoryCount;
    afterUndo: HistoryCount;
    afterRedo: HistoryCount;
    beforeImportedApply: HistoryCount;
    afterImportedApply: HistoryCount;
  }>;
  readonly gpuErrors: readonly string[];
}

const REQUIRED_DOCUMENT_SIZE = 512 as const;
const RGBA16F_BYTES_PER_PIXEL = 8;

const INITIAL_SETTINGS: Readonly<RasterGradientMapSettings> = Object.freeze({
  stops: Object.freeze([
    Object.freeze({ position: 0, color: [0.02, 0.03, 0.08] as const }),
    Object.freeze({ position: 0.42, color: [0.82, 0.08, 0.24] as const }),
    Object.freeze({ position: 1, color: [1, 0.92, 0.56] as const }),
  ]),
  reverse: false,
  dither: false,
  interpolation: "encoded-rgb",
});

const INTERMEDIATE_SETTINGS: Readonly<RasterGradientMapSettings> = Object.freeze({
  stops: Object.freeze([
    Object.freeze({ position: 0, color: [0.01, 0.11, 0.18] as const }),
    Object.freeze({ position: 0.5, color: [0.08, 0.86, 0.72] as const }),
    Object.freeze({ position: 1, color: [0.94, 0.98, 1] as const }),
  ]),
  reverse: true,
  dither: false,
  interpolation: "linear-light",
});

const FINAL_SETTINGS: Readonly<RasterGradientMapSettings> = Object.freeze({
  stops: Object.freeze([
    Object.freeze({ position: 0, color: [0.03, 0.015, 0.12] as const }),
    Object.freeze({ position: 0.31, color: [0.12, 0.32, 0.88] as const }),
    Object.freeze({ position: 0.68, color: [0.94, 0.16, 0.55] as const }),
    Object.freeze({ position: 1, color: [1, 0.82, 0.28] as const }),
  ]),
  reverse: false,
  dither: true,
  interpolation: "perceptual",
});

const INTERPOLATION_PROBE_SETTINGS: Readonly<RasterGradientMapSettings> = Object.freeze({
  stops: Object.freeze([
    Object.freeze({ position: 0, color: [0.02, 0.07, 0.72] as const }),
    Object.freeze({ position: 0.37, color: [0.91, 0.12, 0.2] as const }),
    Object.freeze({ position: 1, color: [0.94, 0.98, 0.1] as const }),
  ]),
  reverse: false,
  dither: false,
  interpolation: "encoded-rgb",
});

type HistoryCount = Readonly<{ actionCount: number; cursor: number }>;
type PixelBounds = Readonly<{ x: number; y: number; width: number; height: number }>;
type ProbeResult = Omit<RasterGradientMapGpuTestReport, "passed" | "gpuErrors">;

interface LabMixedSceneController {
  createText(color?: string): void;
  rasterizeSelectedSvgLayer(): Promise<Readonly<{ layerId: number }> | null>;
  rasterizeSelectedTextLayer(): Promise<Readonly<{ layerId: number }> | null>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function historyCount(engine: BrushEngine): HistoryCount {
  const state = engine.getHistoryState();
  return { actionCount: state.actionCount, cursor: state.cursor };
}

function copyLayerBounds(engine: BrushEngine, layerIndex: number): PixelBounds | null {
  const record = engine.layerStack.at(layerIndex);
  const bounds = engine.getStats().activeLayerIndex === layerIndex
    ? engine.layerContentBounds
    : record.contentBounds;
  return bounds ? { ...bounds } : null;
}

function boundsEqual(left: PixelBounds | null, right: PixelBounds | null): boolean {
  return left === null || right === null
    ? left === right
    : left.x === right.x
      && left.y === right.y
      && left.width === right.width
      && left.height === right.height;
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

function countTranslucentPixels(pixels: Uint8Array): number {
  let count = 0;
  const view = new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  for (let index = 6; index < pixels.byteLength; index += RGBA16F_BYTES_PER_PIXEL) {
    const alpha = decodeFloat16(view.getUint16(index, true));
    if (alpha > 0 && alpha < 1) count += 1;
  }
  return count;
}

function allRgba16fComponentsFinite(pixels: Uint8Array): boolean {
  if (pixels.byteLength % RGBA16F_BYTES_PER_PIXEL !== 0) return false;
  const view = new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  for (let index = 0; index < pixels.byteLength; index += 2) {
    if (!Number.isFinite(decodeFloat16(view.getUint16(index, true)))) return false;
  }
  return true;
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
    await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
  }
}

async function waitForLatestPreview(engine: BrushEngine): Promise<void> {
  const startedAt = performance.now();
  for (;;) {
    const session = engine.activeRasterGradientMapSession;
    assert(session, "The Gradient Map session closed before the latest preview completed.");
    if (session.previewFault) throw session.previewFault;
    if (
      session.encodedSerial === session.requestedSerial
      && session.previewFrame === null
      && session.previewInFlight === null
    ) return;
    if (performance.now() - startedAt > 60_000) {
      throw new Error("Timeout while waiting for the latest Gradient Map preview.");
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
  }
}

async function ensureMixedSceneCompositorReady(engine: BrushEngine): Promise<void> {
  await engine.ensureOptionalEditorResources();
  await waitUntil(
    () => Boolean(
      engine.mixedSceneRasterSegmentBindGroupLayout
      && engine.mixedSceneTextSegmentBindGroupLayout
      && engine.mixedScenePresentBindGroupLayout
      && engine.mixedSceneBackgroundBindGroupLayout,
    ),
    "mixed-scene compositor resources",
  );
}

async function compileFreshGradientMapPipeline(engine: BrushEngine): Promise<void> {
  const module = engine.device.createShaderModule({
    label: "Gradient Map GPU test WGSL",
    code: rasterGradientMapShader,
  });
  const compilationInfo = await module.getCompilationInfo();
  const errors = compilationInfo.messages.filter((message) => message.type === "error");
  assert(
    errors.length === 0,
    `Gradient Map WGSL failed: ${errors.map((error) => error.message).join("; ")}`,
  );
  const descriptor: GPUComputePipelineDescriptor = {
    label: "Gradient Map GPU test pipeline",
    layout: "auto",
    compute: { module, entryPoint: "mapRasterGradient" },
  };
  if (typeof engine.device.createComputePipelineAsync === "function") {
    await engine.device.createComputePipelineAsync(descriptor);
  } else {
    engine.device.createComputePipeline(descriptor);
  }
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
    "paint resources for the Gradient Map fixture",
  );
  assert(
    engine.beginStrokeAtLayer({ x, y, pressure: 1, timeMs }),
    "The Gradient Map fixture stroke could not start.",
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

function assertRasterPopulated(
  engine: BrushEngine,
  layerIndex: number,
  phase: string,
): void {
  const record = engine.layerStack.at(layerIndex);
  const active = engine.getStats().activeLayerIndex === layerIndex;
  const hasContent = active ? engine.layerHasContent : record.hasContent;
  const contentBounds = active ? engine.layerContentBounds : record.contentBounds;
  assert(hasContent && contentBounds !== null, `Raster layer ${record.id} became empty ${phase}.`);
}

async function createImportedImageFixture(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 112;
  canvas.height = 88;
  const context = canvas.getContext("2d");
  assert(context, "The browser did not provide a 2D canvas for the image fixture.");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = 0.57;
  context.fillStyle = "#cf365d";
  context.fillRect(4, 4, 104, 80);
  context.globalAlpha = 0.86;
  context.fillStyle = "#36c9d7";
  context.beginPath();
  context.arc(56, 44, 27, 0, Math.PI * 2);
  context.fill();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((candidate) => {
      if (candidate) resolve(candidate);
      else reject(new Error("The browser could not encode the imported image fixture."));
    }, "image/png");
  });
  return new File([blob], "gradient-map-import-fixture.png", { type: "image/png" });
}

function createSvgFixture(
  name: string,
  firstColor: string,
  secondColor: string,
  inset: number,
): File {
  const source = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100" viewBox="0 0 120 100">',
    `<rect x="${inset}" y="${inset}" width="${120 - inset * 2}" `
      + `height="${100 - inset * 2}" rx="14" fill="${firstColor}" fill-opacity=".72"/>`,
    `<circle cx="60" cy="50" r="${29 - inset}" fill="${secondColor}" fill-opacity=".88"/>`,
    "</svg>",
  ].join("");
  return new File([source], `${name}.svg`, { type: "image/svg+xml" });
}

function dispatchFileSelection(inputId: string, file: File): void {
  const input = document.getElementById(inputId);
  assert(input instanceof HTMLInputElement, `Missing file input #${inputId}.`);
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function applyGradientToActiveRaster(
  engine: BrushEngine,
  settings: Readonly<RasterGradientMapSettings>,
  label: string,
): Promise<Readonly<{
  layerId: number;
  beforePixels: Uint8Array;
  afterPixels: Uint8Array;
  beforeBounds: PixelBounds | null;
  afterBounds: PixelBounds | null;
  historyBefore: HistoryCount;
  historyAfter: HistoryCount;
}>> {
  const stats = engine.getStats();
  const layerIndex = stats.activeLayerIndex;
  const record = stats.layers[layerIndex];
  assert(record, `${label}: the active raster record is missing.`);
  const beforePixels = await readWholeLayer(engine, layerIndex);
  const beforeBounds = copyLayerBounds(engine, layerIndex);
  const historyBefore = historyCount(engine);
  const preview = await engine.beginRasterGradientMap(settings);
  assert(preview?.layerId === record.id, `${label}: Gradient Map opened on the wrong raster.`);
  assert(
    engine.getHistoryState().openEdit === "gradient-map",
    `${label}: Gradient Map did not own its edit.`,
  );
  assert(await engine.commitRasterGradientMap(), `${label}: Gradient Map did not apply.`);
  await engine.waitForIdle();
  const afterPixels = await readWholeLayer(engine, layerIndex);
  const afterBounds = copyLayerBounds(engine, layerIndex);
  return {
    layerId: record.id,
    beforePixels,
    afterPixels,
    beforeBounds,
    afterBounds,
    historyBefore,
    historyAfter: historyCount(engine),
  };
}

async function runSemanticVectorProbe(engine: BrushEngine) {
  const controller = (window as Window & {
    readonly __mixedSceneController?: LabMixedSceneController;
  }).__mixedSceneController;
  assert(controller, "The mixed-scene controller is unavailable to the GPU lab.");

  const historyBeforeBaseImport = historyCount(engine);
  dispatchFileSelection(
    "vectorSvgFileInput",
    createSvgFixture("gradient-map-vector-base", "#2539a8", "#54d8c2", 4),
  );
  await waitUntil(() => {
    const scene = engine.getMixedSceneSnapshot();
    const selected = scene?.items.find((item) => item.key === scene.selectedKey);
    const history = engine.getHistoryState();
    return selected?.kind === "svg"
      && !history.busy
      && history.actionCount === historyBeforeBaseImport.actionCount + 1;
  }, "Gradient Map SVG clipping base import");
  await engine.waitForIdle();
  const baseScene = engine.getMixedSceneSnapshot();
  const baseItem = baseScene?.items.find((item) => item.key === baseScene.selectedKey);
  assert(baseItem?.kind === "svg", "The SVG clipping base was not selected.");
  const baseKey = baseItem.key;
  const baseFingerprint = JSON.stringify(baseItem.svgNode);

  const historyBeforeTargetImport = historyCount(engine);
  dispatchFileSelection(
    "vectorSvgFileInput",
    createSvgFixture("gradient-map-vector-target", "#e84b58", "#f1c84c", 9),
  );
  await waitUntil(() => {
    const scene = engine.getMixedSceneSnapshot();
    const selected = scene?.items.find((item) => item.key === scene.selectedKey);
    const history = engine.getHistoryState();
    return selected?.kind === "svg"
      && selected.key !== baseKey
      && !history.busy
      && history.actionCount === historyBeforeTargetImport.actionCount + 1;
  }, "Gradient Map selected SVG import");
  await engine.waitForIdle();
  const targetScene = engine.getMixedSceneSnapshot();
  const targetItem = targetScene?.items.find((item) => item.key === targetScene.selectedKey);
  assert(targetItem?.kind === "svg", "The selected SVG target is missing.");
  const targetKey = targetItem.key;
  await engine.setSceneLayerClipping(targetKey, true);
  await engine.waitForIdle();
  assert(
    engine.getMixedSceneSnapshot()?.items.find((item) => item.key === targetKey)
      ?.clippingParentKey === baseKey,
    "The selected SVG was not linked to its clipping base.",
  );

  const historyBeforeSvgRasterize = historyCount(engine);
  const svgRasterized = await controller.rasterizeSelectedSvgLayer();
  assert(svgRasterized, "The selected SVG did not rasterize through the editor controller.");
  await engine.waitForIdle();
  const historyAfterSvgRasterize = historyCount(engine);
  const svgRasterLayerId = svgRasterized.layerId;
  const svgRasterKey = `raster:${svgRasterLayerId}` as const;
  const sceneAfterSvgRasterize = engine.getMixedSceneSnapshot();
  const selectedAfterSvgRasterize = sceneAfterSvgRasterize?.items.find(
    (item) => item.key === sceneAfterSvgRasterize.selectedKey,
  );
  const baseAfterSvgRasterize = sceneAfterSvgRasterize?.items.find(
    (item) => item.key === baseKey,
  );
  const svgActiveStats = engine.getStats();
  const svgActiveRasterMatched = selectedAfterSvgRasterize?.kind === "raster"
    && selectedAfterSvgRasterize.key === svgRasterKey
    && selectedAfterSvgRasterize.rasterLayerId === svgRasterLayerId
    && svgActiveStats.layers[svgActiveStats.activeLayerIndex]?.id === svgRasterLayerId;

  const svgMap = await applyGradientToActiveRaster(
    engine,
    INTERMEDIATE_SETTINGS,
    "Selected SVG",
  );
  const sceneAfterSvgMap = engine.getMixedSceneSnapshot();
  const svgAfterMap = sceneAfterSvgMap?.items.find((item) => item.key === svgRasterKey);
  const baseAfterSvgMap = sceneAfterSvgMap?.items.find((item) => item.key === baseKey);
  const svgLayerIndexAfterMap = engine.layerStack.indexOfId(svgRasterLayerId);
  assert(svgLayerIndexAfterMap >= 0, "The rasterized SVG disappeared after Gradient Map.");
  const svgMappedPixels = await readWholeLayer(engine, svgLayerIndexAfterMap);

  const historyBeforeTextCreate = historyCount(engine);
  controller.createText("#d82f72");
  await waitUntil(() => {
    const scene = engine.getMixedSceneSnapshot();
    const selected = scene?.items.find((item) => item.key === scene.selectedKey);
    const history = engine.getHistoryState();
    return selected?.kind === "text"
      && !history.busy
      && history.actionCount === historyBeforeTextCreate.actionCount + 1;
  }, "Gradient Map selected text creation");
  await engine.waitForIdle();
  const textScene = engine.getMixedSceneSnapshot();
  const textItem = textScene?.items.find((item) => item.key === textScene.selectedKey);
  assert(textItem?.kind === "text", "The selected text target is missing.");
  const textKey = textItem.key;
  await engine.setSceneLayerClipping(textKey, true);
  await engine.waitForIdle();
  assert(
    engine.getMixedSceneSnapshot()?.items.find((item) => item.key === textKey)
      ?.clippingParentKey === baseKey,
    "The selected text was not linked to its clipping base.",
  );

  const historyBeforeTextRasterize = historyCount(engine);
  const textRasterized = await controller.rasterizeSelectedTextLayer();
  assert(textRasterized, "The selected text did not rasterize through the editor controller.");
  await engine.waitForIdle();
  const historyAfterTextRasterize = historyCount(engine);
  const textRasterLayerId = textRasterized.layerId;
  const textRasterKey = `raster:${textRasterLayerId}` as const;
  const sceneAfterTextRasterize = engine.getMixedSceneSnapshot();
  const selectedAfterTextRasterize = sceneAfterTextRasterize?.items.find(
    (item) => item.key === sceneAfterTextRasterize.selectedKey,
  );
  const textActiveStats = engine.getStats();
  const textActiveRasterMatched = selectedAfterTextRasterize?.kind === "raster"
    && selectedAfterTextRasterize.key === textRasterKey
    && selectedAfterTextRasterize.rasterLayerId === textRasterLayerId
    && textActiveStats.layers[textActiveStats.activeLayerIndex]?.id === textRasterLayerId;

  const textMap = await applyGradientToActiveRaster(
    engine,
    FINAL_SETTINGS,
    "Selected text",
  );
  const sceneAfterTextMap = engine.getMixedSceneSnapshot();
  const textAfterMap = sceneAfterTextMap?.items.find((item) => item.key === textRasterKey);
  const baseAfterTextMap = sceneAfterTextMap?.items.find((item) => item.key === baseKey);
  const svgLayerIndexAfterTextMap = engine.layerStack.indexOfId(svgRasterLayerId);
  assert(svgLayerIndexAfterTextMap >= 0, "The earlier SVG raster disappeared.");
  const svgPixelsAfterTextMap = await readWholeLayer(engine, svgLayerIndexAfterTextMap);

  const differingBytes = {
    svgGradientRgb: countDifferingRgbBytes(svgMap.beforePixels, svgMap.afterPixels),
    svgGradientAlpha: countDifferingAlphaBytes(svgMap.beforePixels, svgMap.afterPixels),
    textGradientRgb: countDifferingRgbBytes(textMap.beforePixels, textMap.afterPixels),
    textGradientAlpha: countDifferingAlphaBytes(textMap.beforePixels, textMap.afterPixels),
  };
  const checks = {
    svgSelectedOnlyRasterization:
      !sceneAfterSvgRasterize?.items.some((item) => item.key === targetKey)
      && baseAfterSvgRasterize?.kind === "svg",
    svgOtherVectorStayedExact:
      baseAfterSvgMap?.kind === "svg"
      && JSON.stringify(baseAfterSvgMap.svgNode) === baseFingerprint,
    svgActiveRasterMatched,
    svgClippingPreserved: svgAfterMap?.clippingParentKey === baseKey,
    svgRasterizeAndMapHistorySeparated:
      historyAfterSvgRasterize.actionCount === historyBeforeSvgRasterize.actionCount + 1
      && historyAfterSvgRasterize.cursor === historyBeforeSvgRasterize.cursor + 1
      && svgMap.historyBefore.actionCount === historyAfterSvgRasterize.actionCount
      && svgMap.historyBefore.cursor === historyAfterSvgRasterize.cursor
      && svgMap.historyAfter.actionCount === svgMap.historyBefore.actionCount + 1
      && svgMap.historyAfter.cursor === svgMap.historyBefore.cursor + 1,
    svgGradientChangedRgb: differingBytes.svgGradientRgb > 0,
    svgGradientPreservedAlphaAndBounds:
      differingBytes.svgGradientAlpha === 0
      && boundsEqual(svgMap.beforeBounds, svgMap.afterBounds),
    textSelectedOnlyRasterization:
      !sceneAfterTextRasterize?.items.some((item) => item.key === textKey)
      && Boolean(sceneAfterTextRasterize?.items.some((item) => item.key === svgRasterKey))
      && Boolean(sceneAfterTextRasterize?.items.some((item) => item.key === baseKey)),
    textOtherLayersStayedExact:
      countDifferingBytes(svgMappedPixels, svgPixelsAfterTextMap) === 0
      && Boolean(
        baseAfterTextMap?.kind === "svg"
        && JSON.stringify(baseAfterTextMap.svgNode) === baseFingerprint,
      ),
    textActiveRasterMatched,
    textClippingPreserved: textAfterMap?.clippingParentKey === baseKey,
    textRasterizeAndMapHistorySeparated:
      historyAfterTextRasterize.actionCount === historyBeforeTextRasterize.actionCount + 1
      && historyAfterTextRasterize.cursor === historyBeforeTextRasterize.cursor + 1
      && textMap.historyBefore.actionCount === historyAfterTextRasterize.actionCount
      && textMap.historyBefore.cursor === historyAfterTextRasterize.cursor
      && textMap.historyAfter.actionCount === textMap.historyBefore.actionCount + 1
      && textMap.historyAfter.cursor === textMap.historyBefore.cursor + 1,
    textGradientChangedRgb: differingBytes.textGradientRgb > 0,
    textGradientPreservedAlphaAndBounds:
      differingBytes.textGradientAlpha === 0
      && boundsEqual(textMap.beforeBounds, textMap.afterBounds),
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  assert(
    failed.length === 0,
    `Gradient Map semantic-vector test failed: ${failed.join(", ")}.`,
  );
  return { svgRasterLayerId, textRasterLayerId, checks, differingBytes };
}

async function runInterpolationAndReverseProbe(
  engine: BrushEngine,
  targetLayerIndex: number,
  targetBefore: Uint8Array,
): Promise<{
  readonly checks: Pick<
    RasterGradientMapGpuTestReport["checks"],
    | "interpolationOutputsFinite"
    | "interpolationModesDistinct"
    | "reverseOutputDistinct"
    | "interpolationProbePreservedAlpha"
    | "interpolationProbeCancelExact"
    | "interpolationProbeLeftHistoryExact"
  >;
  readonly differingBytes: Pick<
    RasterGradientMapGpuTestReport["differingBytes"],
    | "encodedVersusLinear"
    | "encodedVersusPerceptual"
    | "linearVersusPerceptual"
    | "perceptualVersusReverse"
  >;
}> {
  const historyBefore = historyCount(engine);
  const encodedPreview = await engine.beginRasterGradientMap(
    INTERPOLATION_PROBE_SETTINGS,
  );
  assert(encodedPreview, "The encoded interpolation probe did not open.");
  const encodedPixels = await readWholeLayer(engine, targetLayerIndex);

  engine.updateRasterGradientMap({
    ...INTERPOLATION_PROBE_SETTINGS,
    interpolation: "linear-light",
  });
  await waitForLatestPreview(engine);
  const linearPixels = await readWholeLayer(engine, targetLayerIndex);

  engine.updateRasterGradientMap({
    ...INTERPOLATION_PROBE_SETTINGS,
    interpolation: "perceptual",
  });
  await waitForLatestPreview(engine);
  const perceptualPixels = await readWholeLayer(engine, targetLayerIndex);

  engine.updateRasterGradientMap({
    ...INTERPOLATION_PROBE_SETTINGS,
    interpolation: "perceptual",
    reverse: true,
  });
  await waitForLatestPreview(engine);
  const reversedPixels = await readWholeLayer(engine, targetLayerIndex);

  assert(
    await engine.cancelRasterGradientMap(),
    "Cancel refused the interpolation and Reverse probe.",
  );
  await engine.waitForIdle();
  const targetAfterCancel = await readWholeLayer(engine, targetLayerIndex);
  const historyAfter = historyCount(engine);

  const differingBytes = {
    encodedVersusLinear: countDifferingRgbBytes(encodedPixels, linearPixels),
    encodedVersusPerceptual: countDifferingRgbBytes(encodedPixels, perceptualPixels),
    linearVersusPerceptual: countDifferingRgbBytes(linearPixels, perceptualPixels),
    perceptualVersusReverse: countDifferingRgbBytes(perceptualPixels, reversedPixels),
  };
  const checks = {
    interpolationOutputsFinite: [
      encodedPixels,
      linearPixels,
      perceptualPixels,
      reversedPixels,
    ].every(allRgba16fComponentsFinite),
    interpolationModesDistinct:
      differingBytes.encodedVersusLinear > 0
      && differingBytes.encodedVersusPerceptual > 0
      && differingBytes.linearVersusPerceptual > 0,
    reverseOutputDistinct: differingBytes.perceptualVersusReverse > 0,
    interpolationProbePreservedAlpha: [
      encodedPixels,
      linearPixels,
      perceptualPixels,
      reversedPixels,
    ].every((pixels) => countDifferingAlphaBytes(targetBefore, pixels) === 0),
    interpolationProbeCancelExact: countDifferingBytes(
      targetBefore,
      targetAfterCancel,
    ) === 0,
    interpolationProbeLeftHistoryExact:
      historyAfter.actionCount === historyBefore.actionCount
      && historyAfter.cursor === historyBefore.cursor
      && engine.getHistoryState().openEdit === null,
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  assert(
    failed.length === 0,
    `Gradient Map interpolation test failed: ${failed.join(", ")}.`,
  );
  return { checks, differingBytes };
}

async function runImportedSourceProbe(engine: BrushEngine): Promise<{
  readonly originalLayerId: number;
  readonly duplicateLayerId: number;
  readonly checks: Pick<
    RasterGradientMapGpuTestReport["checks"],
    | "importedOriginalKeptSource"
    | "importedDuplicateInheritedSource"
    | "importedPreviewChangedSelectedRgb"
    | "importedPreviewPreservedAlpha"
    | "importedPreviewPreservedBounds"
    | "importedApplyCommittedOneAction"
    | "importedApplyDetachedOnlySelectedSource"
    | "importedApplyLeftOriginalExact"
    | "importedUndoRestoredSourceAndPixels"
    | "importedRedoDetachedSourceAndPixels"
  >;
  readonly differingBytes: Pick<
    RasterGradientMapGpuTestReport["differingBytes"],
    | "importedPreviewRgb"
    | "importedPreviewAlpha"
    | "importedApplyVersusPreview"
    | "importedOriginalAfterApply"
    | "importedUndo"
    | "importedRedo"
  >;
  readonly historyBeforeApply: HistoryCount;
  readonly historyAfterApply: HistoryCount;
}> {
  await engine.importRasterImageFile(await createImportedImageFixture());
  await engine.waitForIdle();
  const originalLayerIndex = engine.getStats().activeLayerIndex;
  const originalRecord = engine.layerStack.at(originalLayerIndex);
  const originalLayerId = originalRecord.id;
  const originalSource = cloneRasterLayerSource(originalRecord.rasterSource);
  assert(originalSource, "The imported raster did not retain its immutable source.");
  const originalBefore = await readWholeLayer(engine, originalLayerIndex);

  const duplicate = await engine.duplicateSelectedLayer();
  assert(duplicate.kind === "raster", "The imported duplicate was not a native raster.");
  await engine.waitForIdle();
  const duplicateLayerIndex = engine.getStats().activeLayerIndex;
  const duplicateRecord = engine.layerStack.at(duplicateLayerIndex);
  const duplicateLayerId = duplicateRecord.id;
  const duplicateSource = cloneRasterLayerSource(duplicateRecord.rasterSource);
  const duplicateBefore = await readWholeLayer(engine, duplicateLayerIndex);
  const duplicateBoundsBefore = copyLayerBounds(engine, duplicateLayerIndex);
  assert(duplicateBoundsBefore, "The imported duplicate has no content bounds.");

  const preview = await engine.beginRasterGradientMap(FINAL_SETTINGS);
  assert(preview, "Gradient Map did not open on the imported duplicate.");
  const duplicatePreview = await readWholeLayer(engine, duplicateLayerIndex);
  const duplicateBoundsPreview = copyLayerBounds(engine, duplicateLayerIndex);
  const historyBeforeApply = historyCount(engine);
  assert(
    await engine.commitRasterGradientMap(),
    "Gradient Map did not apply to the imported duplicate.",
  );
  await engine.waitForIdle();
  const duplicateAfterApply = await readWholeLayer(engine, duplicateLayerIndex);
  const originalAfterApply = await readWholeLayer(engine, originalLayerIndex);
  const historyAfterApply = historyCount(engine);
  const selectedSourceDetachedAfterApply = engine.layerStack.at(
    duplicateLayerIndex,
  ).rasterSource === null;
  const originalSourcePreservedAfterApply = rasterLayerSourcesEqual(
    originalSource,
    engine.layerStack.at(originalLayerIndex).rasterSource,
  );

  assert(await engine.undo(), "Undo refused Gradient Map on the imported duplicate.");
  await engine.waitForIdle();
  const duplicateAfterUndo = await readWholeLayer(engine, duplicateLayerIndex);
  const sourceAfterUndo = cloneRasterLayerSource(
    engine.layerStack.at(duplicateLayerIndex).rasterSource,
  );

  assert(await engine.redo(), "Redo refused Gradient Map on the imported duplicate.");
  await engine.waitForIdle();
  const duplicateAfterRedo = await readWholeLayer(engine, duplicateLayerIndex);

  const differingBytes = {
    importedPreviewRgb: countDifferingRgbBytes(duplicateBefore, duplicatePreview),
    importedPreviewAlpha: countDifferingAlphaBytes(duplicateBefore, duplicatePreview),
    importedApplyVersusPreview: countDifferingBytes(duplicatePreview, duplicateAfterApply),
    importedOriginalAfterApply: countDifferingBytes(originalBefore, originalAfterApply),
    importedUndo: countDifferingBytes(duplicateBefore, duplicateAfterUndo),
    importedRedo: countDifferingBytes(duplicateAfterApply, duplicateAfterRedo),
  };
  const checks = {
    importedOriginalKeptSource: rasterLayerSourcesEqual(
      originalSource,
      engine.layerStack.at(originalLayerIndex).rasterSource,
    ),
    importedDuplicateInheritedSource: rasterLayerSourcesEqual(
      originalSource,
      duplicateSource,
    ),
    importedPreviewChangedSelectedRgb: differingBytes.importedPreviewRgb > 0,
    importedPreviewPreservedAlpha: differingBytes.importedPreviewAlpha === 0,
    importedPreviewPreservedBounds: boundsEqual(
      duplicateBoundsBefore,
      duplicateBoundsPreview,
    ),
    importedApplyCommittedOneAction:
      historyAfterApply.actionCount === historyBeforeApply.actionCount + 1
      && historyAfterApply.cursor === historyBeforeApply.cursor + 1,
    importedApplyDetachedOnlySelectedSource:
      selectedSourceDetachedAfterApply && originalSourcePreservedAfterApply,
    importedApplyLeftOriginalExact: differingBytes.importedOriginalAfterApply === 0,
    importedUndoRestoredSourceAndPixels:
      rasterLayerSourcesEqual(duplicateSource, sourceAfterUndo)
      && differingBytes.importedUndo === 0,
    importedRedoDetachedSourceAndPixels:
      engine.layerStack.at(duplicateLayerIndex).rasterSource === null
      && differingBytes.importedRedo === 0,
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  assert(
    failed.length === 0,
    `Gradient Map imported-source test failed: ${failed.join(", ")}.`,
  );
  return {
    originalLayerId,
    duplicateLayerId,
    checks,
    differingBytes,
    historyBeforeApply,
    historyAfterApply,
  };
}

async function runProbe(engine: BrushEngine): Promise<ProbeResult> {
  const startedAt = performance.now();
  await ensureMixedSceneCompositorReady(engine);
  await compileFreshGradientMapPipeline(engine);

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
  const clippingBaseLayerId = engine.getStats().layers[0].id;
  await engine.addClippingMaskLayer();
  await drawTap(engine, 164, 256, "#397bd8", 0.58, 2_000);
  assertRasterPopulated(engine, 1, "after painting the clipping child");

  const fixtureStats = engine.getStats();
  assert(
    fixtureStats.layerCount === 2 && fixtureStats.activeLayerIndex === 1,
    "The Gradient Map fixture must contain an active clipping child and its base.",
  );
  const clippingTargetLayerId = fixtureStats.layers[1].id;
  assert(
    fixtureStats.layers[1].clippingParentId === clippingBaseLayerId,
    "The Gradient Map target is not attached to its clipping base.",
  );
  const selected = engine.getMixedSceneSnapshot()?.items.find(
    (item) => item.key === engine.getMixedSceneSnapshot()?.selectedKey,
  );
  const selectedTargetWasNativeRaster = selected?.kind === "raster"
    && selected.rasterLayerId === clippingTargetLayerId;
  assert(selectedTargetWasNativeRaster, "The Gradient Map target is not native raster.");

  let clippingRelationPreserved = true;
  const trackClippingRelation = (): void => {
    clippingRelationPreserved = clippingRelationPreserved
      && engine.getStats().layers[1]?.clippingParentId === clippingBaseLayerId;
  };

  const baseBefore = await readWholeLayer(engine, 0);
  const targetBefore = await readWholeLayer(engine, 1);
  const targetBoundsBefore = copyLayerBounds(engine, 1);
  const presentationBefore = await engine.readPresentationPixelAtLayer(164, 256);
  const translucentPixels = countTranslucentPixels(targetBefore);
  assert(translucentPixels > 0, "The fixture needs translucent target pixels.");

  const interpolationProbe = await runInterpolationAndReverseProbe(
    engine,
    1,
    targetBefore,
  );

  const historyBeforePreview = historyCount(engine);
  const initialPreview = await engine.beginRasterGradientMap(INITIAL_SETTINGS);
  assert(initialPreview, "Gradient Map did not open on the clipping child.");
  assert(
    engine.getHistoryState().openEdit === "gradient-map",
    "Gradient Map did not own the open edit.",
  );
  engine.updateRasterGradientMap(INTERMEDIATE_SETTINGS);
  const latest = engine.updateRasterGradientMap(FINAL_SETTINGS);
  assert(
    rasterGradientMapSettingsEqual(latest.settings, FINAL_SETTINGS),
    "The rapid preview did not retain the latest settings.",
  );
  await waitForLatestPreview(engine);
  const targetRapidPreview = await readWholeLayer(engine, 1);
  const targetBoundsRapidPreview = copyLayerBounds(engine, 1);
  const baseDuringRapidPreview = await readWholeLayer(engine, 0);
  const presentationRapidPreview = await engine.readPresentationPixelAtLayer(164, 256);
  trackClippingRelation();

  assert(await engine.cancelRasterGradientMap(), "Cancel refused Gradient Map.");
  await engine.waitForIdle();
  const targetAfterCancel = await readWholeLayer(engine, 1);
  const targetBoundsAfterCancel = copyLayerBounds(engine, 1);
  const baseAfterCancel = await readWholeLayer(engine, 0);
  const presentationAfterCancel = await engine.readPresentationPixelAtLayer(164, 256);
  const historyAfterCancel = historyCount(engine);
  const cancelClosedEdit = engine.getHistoryState().openEdit === null;
  trackClippingRelation();

  const isolatedFinal = await engine.beginRasterGradientMap(FINAL_SETTINGS);
  assert(isolatedFinal, "Gradient Map did not reopen with the final settings.");
  const targetIsolatedFinalPreview = await readWholeLayer(engine, 1);
  const targetBoundsIsolatedFinal = copyLayerBounds(engine, 1);
  const baseDuringIsolatedPreview = await readWholeLayer(engine, 0);
  const presentationIsolatedFinal = await engine.readPresentationPixelAtLayer(164, 256);
  const historyBeforeApply = historyCount(engine);
  trackClippingRelation();

  assert(
    await engine.commitRasterGradientMap(),
    "Apply refused the non-neutral Gradient Map settings.",
  );
  await engine.waitForIdle();
  const targetAfterApply = await readWholeLayer(engine, 1);
  const targetBoundsAfterApply = copyLayerBounds(engine, 1);
  const baseAfterApply = await readWholeLayer(engine, 0);
  const presentationAfterApply = await engine.readPresentationPixelAtLayer(164, 256);
  const historyAfterApply = historyCount(engine);
  trackClippingRelation();

  assert(await engine.undo(), "Undo refused the Gradient Map action.");
  await engine.waitForIdle();
  const targetAfterUndo = await readWholeLayer(engine, 1);
  const targetBoundsAfterUndo = copyLayerBounds(engine, 1);
  const baseAfterUndo = await readWholeLayer(engine, 0);
  const presentationAfterUndo = await engine.readPresentationPixelAtLayer(164, 256);
  const historyAfterUndo = historyCount(engine);
  trackClippingRelation();

  assert(await engine.redo(), "Redo refused the Gradient Map action.");
  await engine.waitForIdle();
  const targetAfterRedo = await readWholeLayer(engine, 1);
  const targetBoundsAfterRedo = copyLayerBounds(engine, 1);
  const baseAfterRedo = await readWholeLayer(engine, 0);
  const presentationAfterRedo = await engine.readPresentationPixelAtLayer(164, 256);
  const historyAfterRedo = historyCount(engine);
  trackClippingRelation();

  const differingBytes = {
    rapidTargetRgb: countDifferingRgbBytes(targetBefore, targetRapidPreview),
    rapidTargetAlpha: countDifferingAlphaBytes(targetBefore, targetRapidPreview),
    rapidBase: countDifferingBytes(baseBefore, baseDuringRapidPreview),
    rapidVersusIsolatedFinal: countDifferingBytes(
      targetRapidPreview,
      targetIsolatedFinalPreview,
    ),
    cancelTarget: countDifferingBytes(targetBefore, targetAfterCancel),
    cancelBase: countDifferingBytes(baseBefore, baseAfterCancel),
    applyVersusPreview: countDifferingBytes(targetIsolatedFinalPreview, targetAfterApply),
    applyTargetAlpha: countDifferingAlphaBytes(targetBefore, targetAfterApply),
    applyBase: countDifferingBytes(baseBefore, baseAfterApply),
    undoTarget: countDifferingBytes(targetBefore, targetAfterUndo),
    undoBase: countDifferingBytes(baseBefore, baseAfterUndo),
    redoTarget: countDifferingBytes(targetAfterApply, targetAfterRedo),
    redoBase: countDifferingBytes(baseBefore, baseAfterRedo),
    presentationRapid: countDifferingBytes(presentationBefore, presentationRapidPreview),
    presentationCancel: countDifferingBytes(presentationBefore, presentationAfterCancel),
    presentationRapidVersusIsolatedFinal: countDifferingBytes(
      presentationRapidPreview,
      presentationIsolatedFinal,
    ),
    presentationApply: countDifferingBytes(presentationIsolatedFinal, presentationAfterApply),
    presentationUndo: countDifferingBytes(presentationBefore, presentationAfterUndo),
    presentationRedo: countDifferingBytes(presentationAfterApply, presentationAfterRedo),
  };

  const coreChecks = {
    shaderCompiled: true,
    selectedTargetWasNativeRaster,
    fixtureContainedTranslucentPixels: translucentPixels > 0,
    ...interpolationProbe.checks,
    previewChangedTargetRgb: differingBytes.rapidTargetRgb > 0,
    previewPreservedAlpha: differingBytes.rapidTargetAlpha === 0,
    previewPreservedBounds: boundsEqual(targetBoundsBefore, targetBoundsRapidPreview),
    rapidLatestWinsExact:
      differingBytes.rapidVersusIsolatedFinal === 0
      && differingBytes.presentationRapidVersusIsolatedFinal === 0,
    cancelRestoredTargetExact: differingBytes.cancelTarget === 0,
    cancelLeftBaseExact: differingBytes.cancelBase === 0,
    cancelPreservedBounds: boundsEqual(targetBoundsBefore, targetBoundsAfterCancel),
    cancelLeftHistoryExact:
      historyAfterCancel.actionCount === historyBeforePreview.actionCount
      && historyAfterCancel.cursor === historyBeforePreview.cursor
      && cancelClosedEdit,
    applyCommittedOneAction:
      historyAfterApply.actionCount === historyBeforeApply.actionCount + 1
      && historyAfterApply.cursor === historyBeforeApply.cursor + 1,
    applyMatchedPreviewExact: differingBytes.applyVersusPreview === 0,
    applyPreservedAlpha: differingBytes.applyTargetAlpha === 0,
    applyPreservedBounds:
      boundsEqual(targetBoundsBefore, targetBoundsIsolatedFinal)
      && boundsEqual(targetBoundsBefore, targetBoundsAfterApply)
      && boundsEqual(targetBoundsBefore, targetBoundsAfterUndo)
      && boundsEqual(targetBoundsBefore, targetBoundsAfterRedo),
    undoRestoredTargetExact: differingBytes.undoTarget === 0,
    undoMovedOneCursorStep:
      historyAfterUndo.actionCount === historyAfterApply.actionCount
      && historyAfterUndo.cursor === historyAfterApply.cursor - 1,
    redoRestoredAppliedExact: differingBytes.redoTarget === 0,
    redoMovedOneCursorStep:
      historyAfterRedo.actionCount === historyAfterApply.actionCount
      && historyAfterRedo.cursor === historyAfterApply.cursor,
    baseStayedExact: Math.max(
      differingBytes.rapidBase,
      countDifferingBytes(baseBefore, baseDuringIsolatedPreview),
      differingBytes.cancelBase,
      differingBytes.applyBase,
      differingBytes.undoBase,
      differingBytes.redoBase,
    ) === 0,
    clippingRelationPreserved,
    clippedPresentationChangedLive: differingBytes.presentationRapid > 0,
    clippedPresentationCancelExact: differingBytes.presentationCancel === 0,
    clippedPresentationApplyMatchedPreview: differingBytes.presentationApply === 0,
    clippedPresentationUndoExact: differingBytes.presentationUndo === 0,
    clippedPresentationRedoExact: differingBytes.presentationRedo === 0,
  };

  const imported = await runImportedSourceProbe(engine);
  const semantic = await runSemanticVectorProbe(engine);
  const checks = { ...coreChecks, ...imported.checks, ...semantic.checks };
  const allDifferingBytes = {
    ...interpolationProbe.differingBytes,
    ...differingBytes,
    ...imported.differingBytes,
    ...semantic.differingBytes,
  };
  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  assert(
    failedChecks.length === 0,
    `Gradient Map GPU test failed: ${failedChecks.join(", ")}.`,
  );

  return {
    version: 1,
    durationMs: performance.now() - startedAt,
    document: {
      width: REQUIRED_DOCUMENT_SIZE,
      height: REQUIRED_DOCUMENT_SIZE,
      format: "rgba16float",
    },
    layers: {
      clippingBaseLayerId,
      clippingTargetLayerId,
      importedOriginalLayerId: imported.originalLayerId,
      importedDuplicateLayerId: imported.duplicateLayerId,
      svgRasterLayerId: semantic.svgRasterLayerId,
      textRasterLayerId: semantic.textRasterLayerId,
    },
    checks,
    differingBytes: allDifferingBytes,
    history: {
      beforePreview: historyBeforePreview,
      afterCancel: historyAfterCancel,
      beforeApply: historyBeforeApply,
      afterApply: historyAfterApply,
      afterUndo: historyAfterUndo,
      afterRedo: historyAfterRedo,
      beforeImportedApply: imported.historyBeforeApply,
      afterImportedApply: imported.historyAfterApply,
    },
  };
}

/** Destructive GPU probe for a fresh 512×512 RGBA16F native-raster document. */
export async function runRasterGradientMapGpuTest(
  engine: BrushEngine,
): Promise<RasterGradientMapGpuTestReport> {
  const initialStats = engine.getStats();
  const initialHistory = engine.getHistoryState();
  const initialScene = engine.getMixedSceneSnapshot();
  assert(
    engine.documentWidth === REQUIRED_DOCUMENT_SIZE
      && engine.documentHeight === REQUIRED_DOCUMENT_SIZE,
    `The Gradient Map GPU test requires a ${REQUIRED_DOCUMENT_SIZE}×${REQUIRED_DOCUMENT_SIZE} document.`,
  );
  assert(initialStats.layerFormat === "rgba16float", "The GPU test requires RGBA16F.");
  assert(
    initialStats.layerCount === 1
      && !initialStats.layers[0]?.hasContent
      && initialStats.activeLayerIndex === 0,
    "The GPU test requires exactly one empty active raster layer.",
  );
  assert(
    initialScene?.items.length === 1
      && initialScene.items[0]?.kind === "raster"
      && !initialScene.items[0].rasterHasContent,
    "The GPU test requires a fresh native-raster scene.",
  );
  assert(
    initialHistory.actionCount === 0
      && initialHistory.cursor === 0
      && initialHistory.openEdit === null
      && !initialHistory.busy
      && !initialHistory.inconsistent,
    "The GPU test requires empty, idle, consistent history.",
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
    if (engine.getHistoryState().openEdit === "gradient-map") {
      try {
        await engine.cancelRasterGradientMap();
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
  assert(probe, "The Gradient Map GPU probe did not produce a report.");
  assert(
    gpuErrors.length === 0,
    `WebGPU errors during Gradient Map test: ${gpuErrors.join("; ")}`,
  );
  return { ...probe, passed: true, gpuErrors };
}
