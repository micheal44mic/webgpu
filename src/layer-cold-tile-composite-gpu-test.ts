import type { BrushEngine } from "./brush-engine";
import {
  compressColdStorageResources,
  destroyLayerColdStorage,
} from "./engine-cold-storage";

type PixelRect = { x: number; y: number; width: number; height: number };

function differingBytes(left: Uint8Array, right: Uint8Array): number {
  if (left.byteLength !== right.byteLength) {
    return Math.max(left.byteLength, right.byteLength);
  }
  let count = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) count += 1;
  }
  return count;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function firstPixelDifferences(
  left: Uint8Array,
  right: Uint8Array,
  width: number,
): Array<{ x: number; y: number; authoritative: number[]; merged: number[] }> {
  const differences: Array<{
    x: number;
    y: number;
    authoritative: number[];
    merged: number[];
  }> = [];
  const bytesPerPixel = 8;
  const pixelCount = Math.min(left.byteLength, right.byteLength) / bytesPerPixel;
  for (let pixel = 0; pixel < pixelCount && differences.length < 8; pixel += 1) {
    const offset = pixel * bytesPerPixel;
    let differs = false;
    for (let channelByte = 0; channelByte < bytesPerPixel; channelByte += 1) {
      differs ||= left[offset + channelByte] !== right[offset + channelByte];
    }
    if (differs) {
      differences.push({
        x: pixel % width,
        y: Math.floor(pixel / width),
        authoritative: Array.from(left.subarray(offset, offset + bytesPerPixel)),
        merged: Array.from(right.subarray(offset, offset + bytesPerPixel)),
      });
    }
  }
  return differences;
}

/**
 * Destructive, query-gated browser probe for the exact resident-cold fast path.
 * It deliberately crosses a document-tile boundary and requires the telemetry
 * counter to advance, so pixel parity cannot pass accidentally via fallback.
 */
export async function runLayerColdTileCompositeGpuTest(engine: BrushEngine): Promise<{
  version: 1;
  passed: boolean;
  checks: Record<string, boolean>;
  documentSize: number;
  seamX: number;
  comparedBytes: number;
  differingBytes: number;
  firstDifferences: ReturnType<typeof firstPixelDifferences>;
  nonZeroAuthoritativeBytes: number;
  nonZeroMergedBytes: number;
  compositeState: ReturnType<BrushEngine["getLayerCompositeState"]>;
  addLayerMs: number;
  addLayerCompositeMs: number;
  switchSamples: Array<{ totalMs: number; compositeMs: number }>;
  compressedProbe: null | {
    differingBytes: number;
    switchMs: number;
    compositeMs: number;
    switchSamples: Array<{ totalMs: number; compositeMs: number }>;
    rawMiB: number;
    storedMiB: number;
    before: ReturnType<BrushEngine["getStats"]>["layerColdTileComposite"];
    after: ReturnType<BrushEngine["getStats"]>["layerColdTileComposite"];
  };
  before: ReturnType<BrushEngine["getStats"]>["layerColdTileComposite"];
  afterFirstFold: ReturnType<BrushEngine["getStats"]>["layerColdTileComposite"];
  after: ReturnType<BrushEngine["getStats"]>["layerColdTileComposite"];
}> {
  const initial = engine.getStats();
  if (
    initial.layerCount !== 1
    || initial.activeLayerIndex !== 0
    || initial.layers[0].hasContent
    || initial.layerFormat !== "rgba16float"
  ) {
    throw new Error("Il test cold tile richiede una pagina dev RGBA16F nuova e vuota.");
  }

  engine.setBrushSettings({
    tool: "paint",
    shape: "circle",
    shapeScatter: 0,
    grainMode: "off",
    color: "#ef3636",
    size: 64,
    spacingPercent: 25,
    startThickness: 1,
    endThickness: 1,
    count: 1,
    flow: 1,
    opacity: 1,
    hardness: 1,
    blendIntensity: 1,
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
  await engine.setRasterStrokeStyle({ ...engine.getRasterStrokeStyle(), enabled: false });
  await engine.setRasterBevelStyle({ ...engine.getRasterBevelStyle(), enabled: false });

  const tileSize = engine.layerSize / 16;
  const seamX = tileSize * 5;
  const y = tileSize * 5;
  const auditRect: PixelRect = {
    x: seamX - 64,
    y: y - 32,
    width: 129,
    height: 65,
  };
  engine.beginStrokeAtLayer({ x: seamX - 48, y, pressure: 1, timeMs: 100 });
  engine.extendStrokeAtLayer([
    { x: seamX + 48, y, pressure: 1, timeMs: 116 },
  ]);
  engine.endStroke(116);
  await engine.waitForIdle();
  const authoritative = await engine.readLayerPixels(auditRect, 0);
  const before = engine.getStats().layerColdTileComposite;

  const result = await engine.addLayer("Cold tile composite probe");
  await engine.waitForIdle();
  const merged = await engine.readMergedLayerPixels("below", auditRect, 0, false);
  const afterFirstStats = engine.getStats();
  const afterFirstFold = afterFirstStats.layerColdTileComposite;
  const byteDelta = differingBytes(authoritative, merged);
  const switchSamples: Array<{ totalMs: number; compositeMs: number }> = [];
  for (let iteration = 0; iteration < 6; iteration += 1) {
    await engine.setActiveLayer(0);
    const switchResult = await engine.setActiveLayer(1);
    if (!switchResult) throw new Error("Il cambio livello della sonda non è stato eseguito.");
    if (iteration > 0) {
      switchSamples.push({
        totalMs: switchResult.totalMs,
        compositeMs: switchResult.compositeMs,
      });
    }
  }
  await engine.waitForIdle();
  let afterStats = engine.getStats();
  let after = afterStats.layerColdTileComposite;
  let compressedProbe: null | {
    differingBytes: number;
    switchMs: number;
    compositeMs: number;
    switchSamples: Array<{ totalMs: number; compositeMs: number }>;
    rawMiB: number;
    storedMiB: number;
    before: typeof after;
    after: typeof after;
  } = null;
  if (engine.layerColdCompressionEnabled) {
    await engine.addLayer("Compressed cold tile probe");
    await engine.waitForIdle();
    const sourceRecord = engine.layerStack.at(0);
    const sourceGpu = engine.requireLayerGpu(sourceRecord.id);
    if (!sourceGpu.cold || sourceGpu.compressed || sourceGpu.hot) {
      throw new Error("La sonda non trova il cold store GPU da comprimere.");
    }
    const cold = sourceGpu.cold;
    const compressed = await compressColdStorageResources(
      engine,
      cold,
      "Sonda direct cold tile compresso",
    );
    sourceGpu.compressed = compressed;
    sourceGpu.cold = null;
    destroyLayerColdStorage(cold);
    engine.publishStats();
    const compressedLayer = engine.getStats().layers[0];
    if (!compressedLayer.compressed) {
      throw new Error("La sonda non è riuscita a preparare un cold store compresso.");
    }
    const beforeCompressedFold = engine.getStats().layerColdTileComposite;
    const compressedSwitchSamples: Array<{ totalMs: number; compositeMs: number }> = [];
    for (let iteration = 0; iteration < 6; iteration += 1) {
      if (iteration > 0) {
        const returnSwitch = await engine.setActiveLayer(2);
        if (!returnSwitch) {
          throw new Error("Il ritorno al livello della sonda compressa non è stato eseguito.");
        }
      }
      const compressedSwitch = await engine.setActiveLayer(1);
      if (!compressedSwitch) {
        throw new Error("Il cambio livello compresso della sonda non è stato eseguito.");
      }
      if (iteration > 0) {
        compressedSwitchSamples.push({
          totalMs: compressedSwitch.totalMs,
          compositeMs: compressedSwitch.compositeMs,
        });
      }
    }
    await engine.waitForIdle();
    const compressedMerged = await engine.readMergedLayerPixels("below", auditRect, 0, false);
    const afterCompressedFold = engine.getStats().layerColdTileComposite;
    const compressedDifference = differingBytes(authoritative, compressedMerged);
    compressedProbe = {
      differingBytes: compressedDifference,
      switchMs: median(compressedSwitchSamples.map((sample) => sample.totalMs)),
      compositeMs: median(compressedSwitchSamples.map((sample) => sample.compositeMs)),
      switchSamples: compressedSwitchSamples,
      rawMiB: compressedLayer.compressedRawMiB,
      storedMiB: compressedLayer.compressedCpuMiB,
      before: beforeCompressedFold,
      after: afterCompressedFold,
    };
    afterStats = engine.getStats();
    after = afterStats.layerColdTileComposite;
  }
  const checks = {
    fastPathEnabled: afterFirstStats.layerColdTileCompositeEnabled,
    directFoldExecuted: afterFirstFold.foldCount === before.foldCount + 1,
    residentColdWasUsed:
      afterFirstFold.residentFoldCount === before.residentFoldCount + 1,
    compressedFallbackWasNotUsed:
      afterFirstFold.compressedFoldCount === before.compressedFoldCount,
    oneSubmissionForResidentArray:
      afterFirstFold.submissionCount === before.submissionCount + 1,
    crossedMoreThanOneTile: afterFirstFold.tileCount >= before.tileCount + 2,
    avoidedOneFullHydration:
      afterFirstFold.avoidedHydrationMiB >= before.avoidedHydrationMiB + 31.99,
    seamIsByteExact: byteDelta === 0,
    transientScratchWasReleased: after.scratchActiveMiB < 0.01,
    noFullCanvasHydrationRemains: afterStats.gpuMemory.layerHydrationMiB < 0.01,
    compressedFoldExecutedWhenRequested:
      !engine.layerColdCompressionEnabled
      || compressedProbe!.after.compressedFoldCount
        === compressedProbe!.before.compressedFoldCount + 11,
    compressedFoldIsByteExact:
      !engine.layerColdCompressionEnabled || compressedProbe!.differingBytes === 0,
    compressedScratchIsBoundedAndReleased:
      !engine.layerColdCompressionEnabled
      || (
        compressedProbe!.after.scratchPeakMiB <= 2.01
        && compressedProbe!.after.scratchActiveMiB < 0.01
      ),
  };
  return {
    version: 1,
    passed: Object.values(checks).every(Boolean),
    checks,
    documentSize: engine.layerSize,
    seamX,
    comparedBytes: authoritative.byteLength,
    differingBytes: byteDelta,
    firstDifferences: firstPixelDifferences(authoritative, merged, auditRect.width),
    nonZeroAuthoritativeBytes: authoritative.reduce(
      (count, value) => count + Number(value !== 0),
      0,
    ),
    nonZeroMergedBytes: merged.reduce((count, value) => count + Number(value !== 0), 0),
    compositeState: engine.getLayerCompositeState(),
    addLayerMs: result.totalMs,
    addLayerCompositeMs: result.compositeMs,
    switchSamples,
    compressedProbe,
    before,
    afterFirstFold,
    after,
  };
}
