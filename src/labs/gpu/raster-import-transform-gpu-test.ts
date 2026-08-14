import type { DirtyRect } from "../../engine-stroke-types";
import type { EngineStats } from "../../engine-stats";
import type { HistoryState, RasterTransformSnapshot } from "../../engine-types";
import type { GpuRegistrySnapshot } from "../../gpu-resource-registry";
import type { NativeRasterImageImportResult } from "../../engine-raster-image-runtime";
import { RASTER_IMAGE_LAYER_IMPORT_STRATEGY } from "../../raster-image-layer-import-shader";
import { RASTER_TRANSFORM_SHADER_STRATEGY } from "../../raster-transform-shader";

const FIXTURE_WIDTH = 5_000;
const FIXTURE_HEIGHT = 64;
const INTEGER_TRANSLATION_X = 1;

interface RasterImportTransformGpuTestPort {
  readonly documentWidth: number;
  getStats(): EngineStats;
  getHistoryState(): HistoryState;
  measuredGpuMemory(): GpuRegistrySnapshot;
  importRasterImageFile(file: File): Promise<Readonly<NativeRasterImageImportResult>>;
  waitForIdle(): Promise<void>;
  readLayerPixels(rect?: DirtyRect, layerIndex?: number): Promise<Uint8Array>;
  beginRasterLayerTransform(): Promise<RasterTransformSnapshot | null>;
  updateRasterLayerTransform(
    update: Partial<Pick<RasterTransformSnapshot, "x" | "y" | "scale" | "rotation">>,
  ): RasterTransformSnapshot;
  commitRasterLayerTransform(): Promise<boolean>;
  cancelRasterLayerTransform(): Promise<boolean>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
}

function exactBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function shiftedRightDiffCount(
  source: Uint8Array,
  shifted: Uint8Array,
  width: number,
  height: number,
): number {
  const bytesPerPixel = 8;
  const rowBytes = width * bytesPerPixel;
  if (
    source.byteLength !== rowBytes * height
    || shifted.byteLength !== source.byteLength
  ) {
    throw new Error("Readback RGBA16F Trasforma con dimensioni inattese.");
  }
  let differences = 0;
  for (let y = 0; y < height; y += 1) {
    const row = y * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const destination = row + x * bytesPerPixel;
      const sourceOffset = destination - bytesPerPixel;
      for (let byte = 0; byte < bytesPerPixel; byte += 1) {
        const expected = x === 0 ? 0 : source[sourceOffset + byte];
        differences += Number(shifted[destination + byte] !== expected);
      }
    }
  }
  return differences;
}

function categoryBytes(
  snapshot: GpuRegistrySnapshot,
  category: string,
): number {
  return snapshot.categories.find((entry) => entry.category === category)?.bytes ?? 0;
}

async function createFixtureFile(): Promise<File> {
  const canvas = new OffscreenCanvas(FIXTURE_WIDTH, FIXTURE_HEIGHT);
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas2D Labs non disponibile per creare la fixture PNG.");

  context.clearRect(0, 0, FIXTURE_WIDTH, FIXTURE_HEIGHT);
  context.fillStyle = "#f4a261";
  context.fillRect(0, 0, FIXTURE_WIDTH, FIXTURE_HEIGHT);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, FIXTURE_WIDTH, 16);
  context.fillStyle = "#000000";
  for (let x = 1; x < FIXTURE_WIDTH; x += 64) {
    context.fillRect(x, 0, 1, FIXTURE_HEIGHT);
  }
  context.fillRect(0, FIXTURE_HEIGHT - 2, FIXTURE_WIDTH, 2);

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new File([blob], "perceptual-import-transform.png", {
    type: "image/png",
    lastModified: 0,
  });
}

/**
 * Destructive fresh-page probe for the two lazy pipelines that static WGSL
 * verifiers cannot compile: native raster import and Raster Transform.
 * Canvas2D is used only to manufacture a local PNG fixture inside Labs; the
 * production import still decodes to ImageBitmap and runs exclusively on GPU.
 */
export async function runRasterImportTransformGpuTest(
  engine: RasterImportTransformGpuTestPort,
) {
  const initialStats = engine.getStats();
  const initialHistory = engine.getHistoryState();
  if (
    initialStats.layerFormat !== "rgba16float"
    || initialStats.layerCount !== 1
    || initialStats.layers[0]?.hasContent
    || initialHistory.actionCount !== 0
    || initialHistory.cursor !== 0
  ) {
    throw new Error(
      "Il test Import/Trasforma richiede una pagina Labs nuova con un raster vuoto.",
    );
  }

  const memoryBefore = engine.measuredGpuMemory();
  const fixture = await createFixtureFile();
  const importStartedAt = performance.now();
  const imported = await engine.importRasterImageFile(fixture);
  await engine.waitForIdle();
  const importMs = performance.now() - importStartedAt;
  if (
    imported.sourceWidth !== FIXTURE_WIDTH
    || imported.sourceHeight !== FIXTURE_HEIGHT
    || imported.bounds.width !== engine.documentWidth
    || imported.bounds.height >= FIXTURE_HEIGHT
  ) {
    throw new Error("La fixture non ha attraversato il ridimensionamento GPU previsto.");
  }
  const historyAfterImport = engine.getHistoryState();
  if (historyAfterImport.actionCount !== 1 || historyAfterImport.cursor !== 1) {
    throw new Error("Import raster non pubblicato come una sola azione History.");
  }

  const sourcePixels = await engine.readLayerPixels(imported.bounds, imported.layerIndex);
  const memoryAfterImport = engine.measuredGpuMemory();
  if (categoryBytes(memoryAfterImport, "Import e trasformazioni raster") !== 0) {
    throw new Error("Lo scratch GPU dell'import è rimasto residente dopo il completamento.");
  }

  const transformStartedAt = performance.now();
  const transform = await engine.beginRasterLayerTransform();
  if (!transform || transform.scope !== "layer") {
    throw new Error("Sessione Trasforma raster non aperta sulla fixture importata.");
  }
  engine.updateRasterLayerTransform({ x: transform.x + INTEGER_TRANSLATION_X });
  const memoryDuringIntegerTransform = engine.measuredGpuMemory();
  const committed = await engine.commitRasterLayerTransform();
  await engine.waitForIdle();
  const integerTransformMs = performance.now() - transformStartedAt;
  if (!committed) throw new Error("Traslazione intera Raster Transform non applicata.");

  const shiftedPixels = await engine.readLayerPixels(imported.bounds, imported.layerIndex);
  const integerShiftDifferingBytes = shiftedRightDiffCount(
    sourcePixels,
    shiftedPixels,
    imported.bounds.width,
    imported.bounds.height,
  );
  if (integerShiftDifferingBytes !== 0) {
    throw new Error(
      `Traslazione intera non texel-exact: ${integerShiftDifferingBytes} byte differenti.`,
    );
  }
  const historyAfterTransform = engine.getHistoryState();
  if (historyAfterTransform.actionCount !== 2 || historyAfterTransform.cursor !== 2) {
    throw new Error("Trasforma non pubblicato come una sola azione History.");
  }

  const undoReturned = await engine.undo();
  await engine.waitForIdle();
  const pixelsAfterUndo = await engine.readLayerPixels(imported.bounds, imported.layerIndex);
  const undoRestoredExactly = exactBytes(sourcePixels, pixelsAfterUndo);
  const redoReturned = await engine.redo();
  await engine.waitForIdle();
  const pixelsAfterRedo = await engine.readLayerPixels(imported.bounds, imported.layerIndex);
  const redoRestoredExactly = exactBytes(shiftedPixels, pixelsAfterRedo);
  if (!undoReturned || !undoRestoredExactly || !redoReturned || !redoRestoredExactly) {
    throw new Error("Undo/Redo Trasforma non ha ripristinato i byte RGBA16F esatti.");
  }

  const stablePixels = pixelsAfterRedo;
  const fractionalStartedAt = performance.now();
  const fractional = await engine.beginRasterLayerTransform();
  if (!fractional) throw new Error("Seconda sessione Trasforma raster non aperta.");
  engine.updateRasterLayerTransform({
    x: fractional.x + 0.5,
    y: fractional.y + 0.25,
    scale: 0.75,
    rotation: 0.08,
  });
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
    resolve();
  })));
  await engine.waitForIdle();
  const memoryDuringFractionalTransform = engine.measuredGpuMemory();
  const cancelled = await engine.cancelRasterLayerTransform();
  await engine.waitForIdle();
  const fractionalCancelMs = performance.now() - fractionalStartedAt;
  const pixelsAfterCancel = await engine.readLayerPixels(imported.bounds, imported.layerIndex);
  const cancelRestoredExactly = exactBytes(stablePixels, pixelsAfterCancel);
  if (!cancelled || !cancelRestoredExactly) {
    throw new Error("Annulla Trasforma frazionario non ha ripristinato i byte esatti.");
  }

  const memoryAfter = engine.measuredGpuMemory();
  const transformScratchAfterBytes = categoryBytes(
    memoryAfter,
    "Import e trasformazioni raster",
  );
  if (transformScratchAfterBytes !== 0) {
    throw new Error("Lo scratch GPU Trasforma è rimasto residente dopo Annulla.");
  }

  return {
    passed: true,
    importStrategy: RASTER_IMAGE_LAYER_IMPORT_STRATEGY,
    transformStrategy: RASTER_TRANSFORM_SHADER_STRATEGY,
    fixture: {
      sourceWidth: FIXTURE_WIDTH,
      sourceHeight: FIXTURE_HEIGHT,
      sourceBytes: fixture.size,
      outputBounds: imported.bounds,
    },
    timingsMs: {
      import: importMs,
      integerTransformCommit: integerTransformMs,
      fractionalTransformPreviewAndCancel: fractionalCancelMs,
    },
    exactness: {
      integerShiftDifferingBytes,
      undoRestoredExactly,
      redoRestoredExactly,
      cancelRestoredExactly,
    },
    memoryBytes: {
      before: memoryBefore.currentBytes,
      afterImport: memoryAfterImport.currentBytes,
      duringIntegerTransform: memoryDuringIntegerTransform.currentBytes,
      duringFractionalTransform: memoryDuringFractionalTransform.currentBytes,
      after: memoryAfter.currentBytes,
      transformScratchAfter: transformScratchAfterBytes,
    },
  };
}
