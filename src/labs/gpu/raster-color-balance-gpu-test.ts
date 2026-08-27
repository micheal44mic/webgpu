import type { BrushEngine } from "../../brush-engine";
import { decodeFloat16 } from "../../float16";
import {
  rasterColorBalanceSettingsEqual,
  type RasterColorBalanceSettings,
} from "../../raster-color-balance-core";
import { rasterColorBalanceShader } from "../../raster-color-balance-shaders";

export interface RasterColorBalanceGpuTestReport {
  readonly version: 1;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly document: Readonly<{ width: 512; height: 512 }>;
  readonly layers: Readonly<{
    baseLayerId: number;
    targetLayerId: number;
  }>;
  readonly checks: Readonly<{
    shaderCompiled: boolean;
    fixtureContainedTranslucentPixels: boolean;
    previewChangedTargetRgb: boolean;
    previewPreservedAlpha: boolean;
    rapidLatestWinsExact: boolean;
    cancelRestoredTargetExact: boolean;
    cancelLeftBaseExact: boolean;
    cancelLeftHistoryExact: boolean;
    applyCommittedOneAction: boolean;
    applyMatchedPreviewExact: boolean;
    applyPreservedAlpha: boolean;
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
  }>;
  readonly differingBytes: Readonly<{
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
  }>;
  readonly history: Readonly<{
    beforePreview: HistoryCount;
    afterCancel: HistoryCount;
    beforeApply: HistoryCount;
    afterApply: HistoryCount;
    afterUndo: HistoryCount;
    afterRedo: HistoryCount;
  }>;
  readonly gpuErrors: readonly string[];
}

const REQUIRED_DOCUMENT_SIZE = 512 as const;
const RGBA16F_BYTES_PER_PIXEL = 8;

const INITIAL_SETTINGS: Readonly<RasterColorBalanceSettings> = Object.freeze({
  shadows: Object.freeze({
    cyanRedPercent: 54,
    magentaGreenPercent: -18,
    yellowBluePercent: 12,
  }),
  midtones: Object.freeze({
    cyanRedPercent: 0,
    magentaGreenPercent: 0,
    yellowBluePercent: 0,
  }),
  highlights: Object.freeze({
    cyanRedPercent: 0,
    magentaGreenPercent: 0,
    yellowBluePercent: 0,
  }),
  preserveLuminosity: true,
});

const INTERMEDIATE_SETTINGS: Readonly<RasterColorBalanceSettings> = Object.freeze({
  shadows: Object.freeze({
    cyanRedPercent: -72,
    magentaGreenPercent: 36,
    yellowBluePercent: -48,
  }),
  midtones: Object.freeze({
    cyanRedPercent: -65,
    magentaGreenPercent: 44,
    yellowBluePercent: -58,
  }),
  highlights: Object.freeze({
    cyanRedPercent: -32,
    magentaGreenPercent: 20,
    yellowBluePercent: -28,
  }),
  preserveLuminosity: false,
});

const FINAL_SETTINGS: Readonly<RasterColorBalanceSettings> = Object.freeze({
  shadows: Object.freeze({
    cyanRedPercent: 18,
    magentaGreenPercent: -12,
    yellowBluePercent: 22,
  }),
  midtones: Object.freeze({
    cyanRedPercent: 58,
    magentaGreenPercent: -42,
    yellowBluePercent: 46,
  }),
  highlights: Object.freeze({
    cyanRedPercent: -24,
    magentaGreenPercent: 16,
    yellowBluePercent: 38,
  }),
  preserveLuminosity: true,
});

type HistoryCount = Readonly<{ actionCount: number; cursor: number }>;
type ProbeResult = Omit<RasterColorBalanceGpuTestReport, "passed" | "gpuErrors">;

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

function countTranslucentPixels(pixels: Uint8Array): number {
  let count = 0;
  const view = new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  for (let index = 6; index < pixels.byteLength; index += RGBA16F_BYTES_PER_PIXEL) {
    const alpha = decodeFloat16(view.getUint16(index, true));
    if (alpha > 0 && alpha < 1) count += 1;
  }
  return count;
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
    "paint resources for the Color Balance fixture",
  );
  assert(
    engine.beginStrokeAtLayer({ x, y, pressure: 1, timeMs }),
    "The Color Balance fixture stroke could not start.",
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
    const session = engine.activeRasterColorBalanceSession;
    assert(session, "The Color Balance session closed before the rapid preview completed.");
    if (session.previewFault) throw session.previewFault;
    if (
      session.encodedSerial === session.requestedSerial
      && session.previewFrame === null
      && session.previewInFlight === null
    ) return;
    if (performance.now() - startedAt > 60_000) {
      throw new Error("Timeout while waiting for the latest Color Balance preview.");
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
  }
}

async function compileFreshColorBalancePipeline(engine: BrushEngine): Promise<void> {
  const module = engine.device.createShaderModule({
    label: "Color Balance GPU test WGSL",
    code: rasterColorBalanceShader,
  });
  const compilationInfo = await module.getCompilationInfo();
  const errors = compilationInfo.messages.filter((message) => message.type === "error");
  assert(
    errors.length === 0,
    `Color Balance WGSL failed: ${errors.map((error) => error.message).join("; ")}`,
  );
  const descriptor: GPUComputePipelineDescriptor = {
    label: "Color Balance GPU test pipeline",
    layout: "auto",
    compute: { module, entryPoint: "balanceRasterColor" },
  };
  if (typeof engine.device.createComputePipelineAsync === "function") {
    await engine.device.createComputePipelineAsync(descriptor);
  } else {
    engine.device.createComputePipeline(descriptor);
  }
}

async function runProbe(engine: BrushEngine): Promise<ProbeResult> {
  const startedAt = performance.now();
  await compileFreshColorBalancePipeline(engine);

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
  const baseLayerId = engine.getStats().layers[0].id;
  await engine.addClippingMaskLayer();
  await drawTap(engine, 164, 256, "#397bd8", 0.58, 2_000);
  assertRasterPopulated(engine, 1, "after painting the clipping child");

  const fixtureStats = engine.getStats();
  assert(
    fixtureStats.layerCount === 2 && fixtureStats.activeLayerIndex === 1,
    "The Color Balance fixture must contain an active clipping child and its base.",
  );
  const targetLayerId = fixtureStats.layers[1].id;
  assert(
    fixtureStats.layers[1].clippingParentId === baseLayerId,
    "The Color Balance target is not attached to its clipping base.",
  );
  const selected = engine.getMixedSceneSnapshot()?.items.find(
    (item) => item.key === engine.getMixedSceneSnapshot()?.selectedKey,
  );
  assert(
    selected?.kind === "raster" && selected.rasterLayerId === targetLayerId,
    "The Color Balance target is not the selected native raster.",
  );

  let clippingRelationPreserved = true;
  const trackClippingRelation = (): void => {
    clippingRelationPreserved = clippingRelationPreserved
      && engine.getStats().layers[1]?.clippingParentId === baseLayerId;
  };

  const baseBefore = await readWholeLayer(engine, 0);
  const targetBefore = await readWholeLayer(engine, 1);
  const presentationBefore = await engine.readPresentationPixelAtLayer(164, 256);
  const translucentPixels = countTranslucentPixels(targetBefore);
  assert(translucentPixels > 0, "The fixture needs translucent target pixels.");

  const historyBeforePreview = historyCount(engine);
  assert(
    await engine.beginRasterColorBalance(INITIAL_SETTINGS),
    "Color Balance did not open on the clipping child.",
  );
  assert(
    engine.getHistoryState().openEdit === "color-balance",
    "Color Balance did not own the open edit.",
  );
  engine.updateRasterColorBalance(INTERMEDIATE_SETTINGS);
  const latest = engine.updateRasterColorBalance(FINAL_SETTINGS);
  assert(
    rasterColorBalanceSettingsEqual(latest.settings, FINAL_SETTINGS),
    "The rapid preview did not retain the latest settings.",
  );
  await waitForLatestPreview(engine);
  const targetRapidPreview = await readWholeLayer(engine, 1);
  const baseDuringRapidPreview = await readWholeLayer(engine, 0);
  const presentationRapidPreview = await engine.readPresentationPixelAtLayer(164, 256);
  trackClippingRelation();

  assert(
    await engine.cancelRasterColorBalance(),
    "Cancel refused the rapid Color Balance preview.",
  );
  await engine.waitForIdle();
  const targetAfterCancel = await readWholeLayer(engine, 1);
  const baseAfterCancel = await readWholeLayer(engine, 0);
  const presentationAfterCancel = await engine.readPresentationPixelAtLayer(164, 256);
  const historyAfterCancel = historyCount(engine);
  const cancelClosedEdit = engine.getHistoryState().openEdit === null;
  trackClippingRelation();

  assert(
    await engine.beginRasterColorBalance(FINAL_SETTINGS),
    "Color Balance did not reopen with the final settings.",
  );
  const targetIsolatedFinalPreview = await readWholeLayer(engine, 1);
  const baseDuringIsolatedPreview = await readWholeLayer(engine, 0);
  const presentationIsolatedFinal = await engine.readPresentationPixelAtLayer(164, 256);
  const historyBeforeApply = historyCount(engine);
  trackClippingRelation();

  assert(
    await engine.commitRasterColorBalance(),
    "Apply refused the non-neutral Color Balance settings.",
  );
  await engine.waitForIdle();
  const targetAfterApply = await readWholeLayer(engine, 1);
  const baseAfterApply = await readWholeLayer(engine, 0);
  const presentationAfterApply = await engine.readPresentationPixelAtLayer(164, 256);
  const historyAfterApply = historyCount(engine);
  trackClippingRelation();

  assert(await engine.undo(), "Undo refused the Color Balance action.");
  await engine.waitForIdle();
  const targetAfterUndo = await readWholeLayer(engine, 1);
  const baseAfterUndo = await readWholeLayer(engine, 0);
  const presentationAfterUndo = await engine.readPresentationPixelAtLayer(164, 256);
  const historyAfterUndo = historyCount(engine);
  trackClippingRelation();

  assert(await engine.redo(), "Redo refused the Color Balance action.");
  await engine.waitForIdle();
  const targetAfterRedo = await readWholeLayer(engine, 1);
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

  const checks = {
    shaderCompiled: true,
    fixtureContainedTranslucentPixels: translucentPixels > 0,
    previewChangedTargetRgb: differingBytes.rapidTargetRgb > 0,
    previewPreservedAlpha: differingBytes.rapidTargetAlpha === 0,
    rapidLatestWinsExact:
      differingBytes.rapidVersusIsolatedFinal === 0
      && differingBytes.presentationRapidVersusIsolatedFinal === 0,
    cancelRestoredTargetExact: differingBytes.cancelTarget === 0,
    cancelLeftBaseExact: differingBytes.cancelBase === 0,
    cancelLeftHistoryExact:
      historyAfterCancel.actionCount === historyBeforePreview.actionCount
      && historyAfterCancel.cursor === historyBeforePreview.cursor
      && cancelClosedEdit,
    applyCommittedOneAction:
      historyAfterApply.actionCount === historyBeforeApply.actionCount + 1
      && historyAfterApply.cursor === historyBeforeApply.cursor + 1,
    applyMatchedPreviewExact: differingBytes.applyVersusPreview === 0,
    applyPreservedAlpha: differingBytes.applyTargetAlpha === 0,
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
  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  assert(
    failedChecks.length === 0,
    `Color Balance GPU test failed: ${failedChecks.join(", ")}.`,
  );

  return {
    version: 1,
    durationMs: performance.now() - startedAt,
    document: { width: REQUIRED_DOCUMENT_SIZE, height: REQUIRED_DOCUMENT_SIZE },
    layers: { baseLayerId, targetLayerId },
    checks,
    differingBytes,
    history: {
      beforePreview: historyBeforePreview,
      afterCancel: historyAfterCancel,
      beforeApply: historyBeforeApply,
      afterApply: historyAfterApply,
      afterUndo: historyAfterUndo,
      afterRedo: historyAfterRedo,
    },
  };
}

/** Destructive GPU probe for a fresh 512×512 RGBA16F native-raster document. */
export async function runRasterColorBalanceGpuTest(
  engine: BrushEngine,
): Promise<RasterColorBalanceGpuTestReport> {
  const initialStats = engine.getStats();
  const initialHistory = engine.getHistoryState();
  const initialScene = engine.getMixedSceneSnapshot();
  assert(
    engine.documentWidth === REQUIRED_DOCUMENT_SIZE
      && engine.documentHeight === REQUIRED_DOCUMENT_SIZE,
    `The Color Balance GPU test requires a ${REQUIRED_DOCUMENT_SIZE}×${REQUIRED_DOCUMENT_SIZE} document.`,
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
    if (engine.getHistoryState().openEdit === "color-balance") {
      try {
        await engine.cancelRasterColorBalance();
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
  assert(probe, "The Color Balance GPU probe did not produce a report.");
  assert(
    gpuErrors.length === 0,
    `WebGPU errors during Color Balance test: ${gpuErrors.join("; ")}`,
  );
  return { ...probe, passed: true, gpuErrors };
}
