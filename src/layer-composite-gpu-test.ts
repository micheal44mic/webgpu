import type { BrushEngine } from "./brush-engine";
import type { EngineGpuMemoryStats } from "./engine-stats";
import { LAYER_BAKE_STRATEGY, LAYER_COMPOSITE_STRATEGY } from "./engine-strategies";
import type { LayerSwitchResult } from "./engine-types";
import type { RasterStrokeStyle } from "./stroke-core";

interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Rgba = readonly [number, number, number, number];
const SAMPLE_KEYS = ["belowOnly", "overlap", "aboveOnly", "checker"] as const;
type SampleKey = (typeof SAMPLE_KEYS)[number];

type MemoryFields = Pick<
  EngineGpuMemoryStats,
  | "layerBaseMiB"
  | "layerColdMiB"
  | "layerHydrationMiB"
  | "layerMipChainMiB"
  | "layerBakeMiB"
  | "layerCompositeMiB"
  | "countedTotalMiB"
>;

export interface LayerMemorySnapshot extends MemoryFields {
  layerCount: number;
}

export interface LayerMemoryPeakMeasurement {
  before: LayerMemorySnapshot;
  peakTotal: LayerMemorySnapshot;
  maxima: LayerMemorySnapshot;
  after: LayerMemorySnapshot;
  peakDeltaMiB: number;
  sampleCount: number;
}

interface PixelComparison {
  actual: Rgba;
  expected: Rgba;
  maxDelta: number;
  differingChannels: number;
}

export interface LayerCompositeGpuTestReport {
  bakeStrategy: typeof LAYER_BAKE_STRATEGY;
  strategy: typeof LAYER_COMPOSITE_STRATEGY;
  passed: boolean;
  checks: Record<string, boolean>;
  samples: Record<SampleKey, {
    layerA: Rgba;
    layerB: Rgba;
    layerC: Rgba;
    presentation: PixelComparison;
  }>;
  merged: {
    below: Record<SampleKey, PixelComparison>;
    above: Record<SampleKey, PixelComparison>;
  };
  opaqueCopy: {
    comparedBytes: number;
    differingBytes: number;
  };
  rollback: {
    threw: boolean;
    activeLayerRestored: boolean;
    opacityRestored: boolean;
    workingSetMatchesActiveLayer: boolean;
    differingBytes: number;
    memoryBeforeMiB: number;
    memoryAfterMiB: number;
  };
  invalidation: {
    opacityActual: Rgba;
    opacityExpected: Rgba;
    opacityDelta: number;
    hiddenActual: Rgba;
    hiddenExpected: Rgba;
    hiddenDelta: number;
    changedFromBaseline: boolean;
  };
  zoom: {
    selectedMipLevel: number;
    aboveValidThroughLevel: number;
    actualMip2: Rgba;
    expectedMip2: Rgba;
    maxDelta: number;
    presentationAtZoom: Rgba;
    checkerAtZoom: Rgba;
  };
  fiveLayerMemory: LayerMemorySnapshot;
  fiveLayerBakeStates: ReturnType<BrushEngine["getLayerBakeState"]>[];
  fiveLayerCompositeState: ReturnType<BrushEngine["getLayerCompositeState"]>;
  fiveLayerSwitchMs: readonly [number, number];
  fiveLayerSwitchBreakdown: readonly [
    { totalMs: number; effectsMs: number; compositeMs: number; otherMs: number },
    { totalMs: number; effectsMs: number; compositeMs: number; otherMs: number },
  ];
  fiveLayerSwitchMemoryPeaks: readonly [
    LayerMemoryPeakMeasurement,
    LayerMemoryPeakMeasurement,
  ];
  fiveLayerMiddleSwitchMemoryPeaks: readonly [
    LayerMemoryPeakMeasurement,
    LayerMemoryPeakMeasurement,
  ];
  layerAddMemoryPeaks: readonly [
    LayerMemoryPeakMeasurement,
    LayerMemoryPeakMeasurement,
  ];
  nextTimeMs: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundTiesToEven(value: number): number {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (fraction < 0.5) {
    return lower;
  }
  if (fraction > 0.5) {
    return lower + 1;
  }
  return lower % 2 === 0 ? lower : lower + 1;
}

function quantizeUnorm(value: number): number {
  return roundTiesToEven(clamp(value, 0, 1) * 255);
}

function srgbToLinear(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308
    ? value * 12.92
    : 1.055 * Math.max(value, 0) ** (1 / 2.4) - 0.055;
}

function rgbaAt(pixels: Uint8Array, offsetPixels: number): Rgba {
  const offset = offsetPixels * 4;
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]];
}

function unit(bytes: Rgba): [number, number, number, number] {
  return [bytes[0] / 255, bytes[1] / 255, bytes[2] / 255, bytes[3] / 255];
}

function scaleLayer(bytes: Rgba, opacity: number, quantize: boolean): Rgba | [number, number, number, number] {
  const scaled = unit(bytes).map((value) => value * opacity) as [number, number, number, number];
  return quantize
    ? scaled.map(quantizeUnorm) as [number, number, number, number]
    : scaled;
}

function sourceOver(
  source: readonly number[],
  destination: readonly number[],
): [number, number, number, number] {
  const inverseAlpha = 1 - source[3];
  return [
    source[0] + destination[0] * inverseAlpha,
    source[1] + destination[1] * inverseAlpha,
    source[2] + destination[2] * inverseAlpha,
    source[3] + destination[3] * inverseAlpha,
  ];
}

function checkerByte(x: number, y: number): number {
  const parity = (Math.floor((x + 0.5) / 96) + Math.floor((y + 0.5) / 96)) & 1;
  return quantizeUnorm(parity === 0 ? 0.91 : 0.82);
}

function presentationFromLinearPaint(paint: readonly number[], x: number, y: number): Rgba {
  const parity = (Math.floor((x + 0.5) / 96) + Math.floor((y + 0.5) / 96)) & 1;
  const backgroundLinear = srgbToLinear(parity === 0 ? 0.91 : 0.82);
  return [
    quantizeUnorm(linearToSrgb(paint[0] + backgroundLinear * (1 - paint[3]))),
    quantizeUnorm(linearToSrgb(paint[1] + backgroundLinear * (1 - paint[3]))),
    quantizeUnorm(linearToSrgb(paint[2] + backgroundLinear * (1 - paint[3]))),
    255,
  ];
}

function expectedPresentation(
  belowRaw: Rgba,
  activeRaw: Rgba,
  aboveRaw: Rgba,
  x: number,
  y: number,
  aboveOpacity = 0.7,
  aboveVisible = true,
): Rgba {
  const below = unit(scaleLayer(belowRaw, 0.6, true) as Rgba);
  const active = scaleLayer(activeRaw, 0.5, false) as [number, number, number, number];
  const above = unit(scaleLayer(
    aboveRaw,
    aboveVisible ? aboveOpacity : 0,
    true,
  ) as Rgba);
  return presentationFromLinearPaint(
    sourceOver(above, sourceOver(active, below)),
    x,
    y,
  );
}

function wrongSrgbSpacePresentation(
  belowRaw: Rgba,
  activeRaw: Rgba,
  aboveRaw: Rgba,
  x: number,
  y: number,
): Rgba {
  const toSrgbPremultiplied = (bytes: Rgba, opacity: number) => {
    const alpha = bytes[3] / 255 * opacity;
    return [
      linearToSrgb(bytes[0] / 255) * opacity,
      linearToSrgb(bytes[1] / 255) * opacity,
      linearToSrgb(bytes[2] / 255) * opacity,
      alpha,
    ] as [number, number, number, number];
  };
  const paint = sourceOver(
    toSrgbPremultiplied(aboveRaw, 0.7),
    sourceOver(
      toSrgbPremultiplied(activeRaw, 0.5),
      toSrgbPremultiplied(belowRaw, 0.6),
    ),
  );
  const background = checkerByte(x, y) / 255;
  return [
    quantizeUnorm(paint[0] + background * (1 - paint[3])),
    quantizeUnorm(paint[1] + background * (1 - paint[3])),
    quantizeUnorm(paint[2] + background * (1 - paint[3])),
    255,
  ];
}

function compare(actualBytes: Uint8Array | Rgba, expected: Rgba): PixelComparison {
  const actual = [
    actualBytes[0], actualBytes[1], actualBytes[2], actualBytes[3],
  ] as Rgba;
  let maxDelta = 0;
  let differingChannels = 0;
  for (let channel = 0; channel < 4; channel += 1) {
    const delta = Math.abs(actual[channel] - expected[channel]);
    maxDelta = Math.max(maxDelta, delta);
    differingChannels += Number(delta !== 0);
  }
  return { actual, expected, maxDelta, differingChannels };
}

function countDifferingBytes(left: Uint8Array, right: Uint8Array): number {
  if (left.length !== right.length) {
    return Math.max(left.length, right.length);
  }
  let count = 0;
  for (let index = 0; index < left.length; index += 1) {
    count += Number(left[index] !== right[index]);
  }
  return count;
}

function snapshotMemory(engine: BrushEngine): LayerMemorySnapshot {
  const stats = engine.getStats();
  return {
    layerCount: stats.layerCount,
    layerBaseMiB: stats.gpuMemory.layerBaseMiB,
    layerColdMiB: stats.gpuMemory.layerColdMiB,
    layerHydrationMiB: stats.gpuMemory.layerHydrationMiB,
    layerMipChainMiB: stats.gpuMemory.layerMipChainMiB,
    layerBakeMiB: stats.gpuMemory.layerBakeMiB,
    layerCompositeMiB: stats.gpuMemory.layerCompositeMiB,
    countedTotalMiB: stats.gpuMemory.countedTotalMiB,
  };
}

async function measureMemoryPeakDuring<T>(
  engine: BrushEngine,
  operation: () => Promise<T>,
): Promise<{ result: T; memory: LayerMemoryPeakMeasurement }> {
  const before = snapshotMemory(engine);
  let peakTotal = before;
  let maxima = { ...before };
  let sampleCount = 0;
  const sample = () => {
    const current = snapshotMemory(engine);
    sampleCount += 1;
    if (current.countedTotalMiB > peakTotal.countedTotalMiB) {
      peakTotal = current;
    }
    maxima = {
      layerCount: Math.max(maxima.layerCount, current.layerCount),
      layerBaseMiB: Math.max(maxima.layerBaseMiB, current.layerBaseMiB),
      layerColdMiB: Math.max(maxima.layerColdMiB, current.layerColdMiB),
      layerHydrationMiB: Math.max(maxima.layerHydrationMiB, current.layerHydrationMiB),
      layerMipChainMiB: Math.max(maxima.layerMipChainMiB, current.layerMipChainMiB),
      layerBakeMiB: Math.max(maxima.layerBakeMiB, current.layerBakeMiB),
      layerCompositeMiB: Math.max(maxima.layerCompositeMiB, current.layerCompositeMiB),
      countedTotalMiB: Math.max(maxima.countedTotalMiB, current.countedTotalMiB),
    };
  };
  sample();
  const timer = window.setInterval(sample, 1);
  try {
    const result = await operation();
    sample();
    const after = snapshotMemory(engine);
    return {
      result,
      memory: {
        before,
        peakTotal,
        maxima,
        after,
        peakDeltaMiB: peakTotal.countedTotalMiB - before.countedTotalMiB,
        sampleCount,
      },
    };
  } finally {
    window.clearInterval(timer);
  }
}

function downsample2x2(source: Uint8Array, width: number, height: number): Uint8Array {
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new Error("Il riferimento mip richiede dimensioni pari.");
  }
  const targetWidth = width / 2;
  const targetHeight = height / 2;
  const target = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        const offsets = [
          ((y * 2) * width + x * 2) * 4 + channel,
          ((y * 2) * width + x * 2 + 1) * 4 + channel,
          (((y * 2) + 1) * width + x * 2) * 4 + channel,
          (((y * 2) + 1) * width + x * 2 + 1) * 4 + channel,
        ];
        const average = offsets.reduce((sum, offset) => sum + source[offset], 0) / 4;
        target[(y * targetWidth + x) * 4 + channel] = roundTiesToEven(average);
      }
    }
  }
  return target;
}

async function drawLine(
  engine: BrushEngine,
  x: number,
  y: number,
  color: string,
  timeMs: number,
): Promise<void> {
  engine.setBrushSettings({ color });
  if (!await engine.beginStrokeAtLayerAfterHistoryDrain({ x, y, pressure: 1, timeMs })) {
    throw new Error("Tratto compositing rifiutato dal gate History.");
  }
  engine.extendStrokeAtLayer([{ x: x + 48, y, pressure: 1, timeMs: timeMs + 16 }]);
  engine.endStroke(timeMs + 16);
  await engine.waitForIdle();
}

async function disableActiveEffects(engine: BrushEngine): Promise<void> {
  await engine.setRasterStrokeStyle({ ...engine.getRasterStrokeStyle(), enabled: false });
  await engine.setRasterBevelStyle({ ...engine.getRasterBevelStyle(), enabled: false });
  await engine.waitForIdle();
}

export async function runLayerCompositeGpuTest(
  engine: BrushEngine,
  strokeStyle: RasterStrokeStyle,
  startingTimeMs: number,
): Promise<LayerCompositeGpuTestReport> {
  const initial = engine.getStats();
  if (initial.layerCount !== 2 || initial.activeLayerIndex !== 1) {
    throw new Error("Il test compositing richiede due livelli e B attivo.");
  }

  const y = 1024;
  const coordinates: Record<SampleKey, number> = {
    belowOnly: 1344,
    overlap: 1600,
    aboveOnly: 1856,
    checker: 2112,
  };
  const stripRect: PixelRect = {
    x: coordinates.belowOnly,
    y,
    width: coordinates.checker - coordinates.belowOnly + 1,
    height: 1,
  };
  let timeMs = startingTimeMs;

  await engine.setActiveLayer(0);
  await disableActiveEffects(engine);
  await drawLine(engine, coordinates.belowOnly - 24, y, "#ef3636", timeMs += 100);
  await drawLine(engine, coordinates.overlap - 24, y, "#ef3636", timeMs += 100);

  await engine.setActiveLayer(1);
  const opaqueRawBelow = await engine.readLayerPixels(stripRect, 0);
  const opaqueMergedBelow = await engine.readMergedLayerPixels("below", stripRect);
  const opaqueCopy = {
    comparedBytes: opaqueRawBelow.byteLength,
    differingBytes: countDifferingBytes(opaqueRawBelow, opaqueMergedBelow),
  };
  await engine.setLayerOpacity(0, 0.6);
  await disableActiveEffects(engine);
  await drawLine(engine, coordinates.overlap - 24, y, "#35d36e", timeMs += 100);
  await engine.setLayerOpacity(1, 0.5);

  await engine.addLayer("Compositing C");
  await disableActiveEffects(engine);
  await drawLine(engine, coordinates.aboveOnly - 24, y, "#3578ef", timeMs += 100);
  await drawLine(engine, coordinates.overlap - 24, y, "#3578ef", timeMs += 100);
  await engine.setLayerOpacity(2, 0.7);
  await engine.setActiveLayer(1);
  engine.setLayerCompositeTestView(
    (coordinates.belowOnly + coordinates.checker) * 0.5,
    y,
    1,
  );
  await engine.waitForIdle();

  const rawStrips = await Promise.all([0, 1, 2].map((index) =>
    engine.readLayerPixels(stripRect, index)
  ));
  const rawSamples = Object.fromEntries(SAMPLE_KEYS.map((key) => {
    const offset = coordinates[key] - stripRect.x;
    return [key, {
      layerA: rgbaAt(rawStrips[0], offset),
      layerB: rgbaAt(rawStrips[1], offset),
      layerC: rgbaAt(rawStrips[2], offset),
    }];
  })) as Record<SampleKey, { layerA: Rgba; layerB: Rgba; layerC: Rgba }>;

  const presentationPixels = Object.fromEntries(await Promise.all(SAMPLE_KEYS.map(async (key) => [
    key,
    await engine.readPresentationPixelAtLayer(coordinates[key], y),
  ]))) as Record<SampleKey, Uint8Array>;
  const samples = Object.fromEntries(SAMPLE_KEYS.map((key) => {
    const raw = rawSamples[key];
    return [key, {
      ...raw,
      presentation: compare(
        presentationPixels[key],
        expectedPresentation(raw.layerA, raw.layerB, raw.layerC, coordinates[key], y),
      ),
    }];
  })) as LayerCompositeGpuTestReport["samples"];

  const mergedBelowPixels = await engine.readMergedLayerPixels("below", stripRect);
  const mergedAbovePixels = await engine.readMergedLayerPixels("above", stripRect);
  const mergedBelow = Object.fromEntries(SAMPLE_KEYS.map((key) => {
    const offset = coordinates[key] - stripRect.x;
    return [key, compare(
      rgbaAt(mergedBelowPixels, offset),
      scaleLayer(rawSamples[key].layerA, 0.6, true) as Rgba,
    )];
  })) as Record<SampleKey, PixelComparison>;
  const mergedAbove = Object.fromEntries(SAMPLE_KEYS.map((key) => {
    const offset = coordinates[key] - stripRect.x;
    return [key, compare(
      rgbaAt(mergedAbovePixels, offset),
      scaleLayer(rawSamples[key].layerC, 0.7, true) as Rgba,
    )];
  })) as Record<SampleKey, PixelComparison>;

  const overlapWrongSrgb = wrongSrgbSpacePresentation(
    rawSamples.overlap.layerA,
    rawSamples.overlap.layerB,
    rawSamples.overlap.layerC,
    coordinates.overlap,
    y,
  );
  const overlapCorrect = samples.overlap.presentation.expected;

  const rollbackBefore = await engine.readMergedLayerPixels("above", stripRect);
  const rollbackMemoryBefore = engine.getStats().gpuMemory.layerCompositeMiB;
  engine.injectLayerCompositeFault("after-candidate-submit");
  let compositeRollbackThrew = false;
  try {
    await engine.setLayerOpacity(2, 0.25);
  } catch {
    compositeRollbackThrew = true;
  }
  await engine.waitForIdle();
  const rollbackAfter = await engine.readMergedLayerPixels("above", stripRect);
  const rollbackStats = engine.getStats();
  const rollback = {
    threw: compositeRollbackThrew,
    activeLayerRestored: rollbackStats.activeLayerIndex === 1,
    opacityRestored: Math.abs(rollbackStats.layers[2].opacity - 0.7) < 1e-6,
    workingSetMatchesActiveLayer: engine.effectsWorkingSetMatchesActiveLayer(),
    differingBytes: countDifferingBytes(rollbackBefore, rollbackAfter),
    memoryBeforeMiB: rollbackMemoryBefore,
    memoryAfterMiB: rollbackStats.gpuMemory.layerCompositeMiB,
  };

  await engine.setLayerOpacity(2, 0.25);
  await engine.waitForIdle();
  const opacityActual = await engine.readPresentationPixelAtLayer(coordinates.aboveOnly, y);
  const opacityExpected = expectedPresentation(
    rawSamples.aboveOnly.layerA,
    rawSamples.aboveOnly.layerB,
    rawSamples.aboveOnly.layerC,
    coordinates.aboveOnly,
    y,
    0.25,
    true,
  );
  const opacityComparison = compare(opacityActual, opacityExpected);

  await engine.setLayerVisibility(2, false);
  await engine.waitForIdle();
  const hiddenActual = await engine.readPresentationPixelAtLayer(coordinates.aboveOnly, y);
  const hiddenExpected = expectedPresentation(
    rawSamples.aboveOnly.layerA,
    rawSamples.aboveOnly.layerB,
    rawSamples.aboveOnly.layerC,
    coordinates.aboveOnly,
    y,
    0.25,
    false,
  );
  const hiddenComparison = compare(hiddenActual, hiddenExpected);
  const invalidation = {
    opacityActual: opacityComparison.actual,
    opacityExpected: opacityComparison.expected,
    opacityDelta: opacityComparison.maxDelta,
    hiddenActual: hiddenComparison.actual,
    hiddenExpected: hiddenComparison.expected,
    hiddenDelta: hiddenComparison.maxDelta,
    changedFromBaseline:
      samples.aboveOnly.presentation.actual.some((value, index) => value !== opacityActual[index])
      && opacityActual.some((value, index) => value !== hiddenActual[index]),
  };

  await engine.setLayerVisibility(2, true);
  await engine.setLayerOpacity(2, 0.7);
  await engine.waitForIdle();

  const mipX = Math.floor(coordinates.aboveOnly / 4);
  const mipY = Math.floor(y / 4);
  const mergedBaseBlock = await engine.readMergedLayerPixels("above", {
    x: mipX * 4,
    y: mipY * 4,
    width: 4,
    height: 4,
  });
  const mip1Reference = downsample2x2(mergedBaseBlock, 4, 4);
  const mip2Reference = downsample2x2(mip1Reference, 2, 2);
  const expectedMip2 = rgbaAt(mip2Reference, 0);

  engine.setLayerCompositeTestView(
    (coordinates.belowOnly + coordinates.checker) * 0.5,
    y,
    0.25,
  );
  await engine.waitForIdle();
  const compositeStateAtZoom = engine.getLayerCompositeState();
  const actualMip2Bytes = await engine.readMergedLayerPixels(
    "above",
    { x: mipX, y: mipY, width: 1, height: 1 },
    2,
    false,
  );
  const mipComparison = compare(actualMip2Bytes, expectedMip2);
  const presentationAtZoom = await engine.readPresentationPixelAtLayer(
    coordinates.aboveOnly,
    y,
  );
  const checkerAtZoom = [
    checkerByte(coordinates.aboveOnly, y),
    checkerByte(coordinates.aboveOnly, y),
    checkerByte(coordinates.aboveOnly, y),
    255,
  ] as Rgba;
  const zoom = {
    selectedMipLevel: compositeStateAtZoom.selectedMipLevel,
    aboveValidThroughLevel: compositeStateAtZoom.above.validThroughLevel,
    actualMip2: mipComparison.actual,
    expectedMip2: mipComparison.expected,
    maxDelta: mipComparison.maxDelta,
    presentationAtZoom: [
      presentationAtZoom[0], presentationAtZoom[1], presentationAtZoom[2], presentationAtZoom[3],
    ] as Rgba,
    checkerAtZoom,
  };
  engine.setLayerCompositeTestView(
    (coordinates.belowOnly + coordinates.checker) * 0.5,
    y,
    1,
  );
  await engine.waitForIdle();

  await engine.setRasterStrokeStyle(strokeStyle);
  await engine.setActiveLayer(0);
  await engine.setRasterStrokeStyle(strokeStyle);
  await engine.setActiveLayer(1);
  await engine.setRasterStrokeStyle(strokeStyle);
  await engine.setActiveLayer(2);
  await engine.setRasterStrokeStyle(strokeStyle);

  const addDMeasured = await measureMemoryPeakDuring(
    engine,
    () => engine.addLayer("Compositing D"),
  );
  await engine.setRasterStrokeStyle(strokeStyle);
  await drawLine(engine, 2200, y, "#d43fe8", timeMs += 100);
  const addEMeasured = await measureMemoryPeakDuring(
    engine,
    () => engine.addLayer("Compositing E"),
  );
  await engine.setRasterStrokeStyle(strokeStyle);
  await drawLine(engine, 2320, y, "#f2a338", timeMs += 100);
  await engine.waitForIdle();

  const fiveLayerMemory = snapshotMemory(engine);
  const fiveLayerBakeStates = Array.from({ length: 5 }, (_, index) =>
    engine.getLayerBakeState(index)
  );
  const toBottomMeasured = await measureMemoryPeakDuring(
    engine,
    () => engine.setActiveLayer(0),
  );
  const toTopMeasured = await measureMemoryPeakDuring(
    engine,
    () => engine.setActiveLayer(4),
  );
  const toMiddleMeasured = await measureMemoryPeakDuring(
    engine,
    () => engine.setActiveLayer(2),
  );
  const middleToTopMeasured = await measureMemoryPeakDuring(
    engine,
    () => engine.setActiveLayer(4),
  );
  const toBottom = toBottomMeasured.result;
  const toTop = toTopMeasured.result;
  await engine.waitForIdle();
  const fiveLayerSwitchMs = [
    toBottom?.totalMs ?? 0,
    toTop?.totalMs ?? 0,
  ] as const;
  const summarizeSwitch = (result: LayerSwitchResult | null) => {
    const totalMs = result?.totalMs ?? 0;
    const effectsMs = result?.effectsMs ?? 0;
    const compositeMs = result?.compositeMs ?? 0;
    return {
      totalMs,
      effectsMs,
      compositeMs,
      otherMs: Math.max(0, totalMs - effectsMs - compositeMs),
    };
  };
  const fiveLayerSwitchBreakdown = [
    summarizeSwitch(toBottom),
    summarizeSwitch(toTop),
  ] as const;
  const fiveLayerSwitchMemoryPeaks = [
    toBottomMeasured.memory,
    toTopMeasured.memory,
  ] as const;
  const fiveLayerMiddleSwitchMemoryPeaks = [
    toMiddleMeasured.memory,
    middleToTopMeasured.memory,
  ] as const;
  const layerAddMemoryPeaks = [
    addDMeasured.memory,
    addEMeasured.memory,
  ] as const;
  const fiveLayerCompositeState = engine.getLayerCompositeState();

  const alpha = (rgba: Rgba): number => rgba[3];
  const edgeMemoryPeaks: readonly LayerMemoryPeakMeasurement[] = [
    ...layerAddMemoryPeaks,
    ...fiveLayerSwitchMemoryPeaks,
  ];
  const edgePeakResourcesAreBounded = edgeMemoryPeaks.every((entry) =>
    entry.maxima.layerBaseMiB <= 64.01
    && entry.maxima.layerHydrationMiB <= 64.01
    && entry.maxima.layerMipChainMiB <= 42.68
    && entry.maxima.layerBakeMiB <= 64.01
    && entry.maxima.layerCompositeMiB <= 64.01
    && entry.peakDeltaMiB <= 140.01
  );
  const middlePeakResourcesAreBounded =
    fiveLayerMiddleSwitchMemoryPeaks.every((entry) =>
      entry.maxima.layerBaseMiB <= 64.01
      && entry.maxima.layerHydrationMiB <= 64.01
      && entry.maxima.layerMipChainMiB <= 64.01
      && entry.maxima.layerBakeMiB <= 64.01
      && entry.maxima.layerCompositeMiB <= 128.01
    )
    && toMiddleMeasured.memory.peakDeltaMiB <= 220.01
    && middleToTopMeasured.memory.peakDeltaMiB <= 140.01;
  const checks = {
    boundedBakeSignatureMatches:
      LAYER_BAKE_STRATEGY
        === "transient-analytic-bounded-visual-rect-no-handoff-residency-mip0-fused-into-two-merged-surfaces",
    compositeSchedulingAndBoundsSignatureMatches:
      LAYER_COMPOSITE_STRATEGY
      === "merged-above-over-isolated-active-clipping-group-over-merged-below-source-atop-live-prefix-suffix-compose-before-filter-parent-opacity-once-deferred-to-fold-fence-bounded-visual-rect",
    belowOnlyHasOnlyLayerA:
      alpha(rawSamples.belowOnly.layerA) > 0
      && alpha(rawSamples.belowOnly.layerB) === 0
      && alpha(rawSamples.belowOnly.layerC) === 0,
    aboveOnlyHasOnlyLayerC:
      alpha(rawSamples.aboveOnly.layerA) === 0
      && alpha(rawSamples.aboveOnly.layerB) === 0
      && alpha(rawSamples.aboveOnly.layerC) > 0,
    overlapContainsAllThreeLayers:
      alpha(rawSamples.overlap.layerA) > 0
      && alpha(rawSamples.overlap.layerB) > 0
      && alpha(rawSamples.overlap.layerC) > 0,
    checkerIsEmptyInAllLayers:
      alpha(rawSamples.checker.layerA) === 0
      && alpha(rawSamples.checker.layerB) === 0
      && alpha(rawSamples.checker.layerC) === 0,
    belowOnlyMatchesAbsoluteReference: samples.belowOnly.presentation.maxDelta <= 1,
    aboveOnlyMatchesAbsoluteReference: samples.aboveOnly.presentation.maxDelta <= 1,
    overlapMatchesSourceOverReference: samples.overlap.presentation.maxDelta <= 1,
    checkerMatchesAbsoluteReference: samples.checker.presentation.maxDelta <= 1,
    mergedBelowMatchesIndependentRawReference:
      Object.values(mergedBelow).every((entry) => entry.maxDelta <= 1),
    mergedAboveMatchesIndependentRawReference:
      Object.values(mergedAbove).every((entry) => entry.maxDelta <= 1),
    opaqueRawFastPathIsByteExact:
      opaqueCopy.comparedBytes > 0 && opaqueCopy.differingBytes === 0,
    srgbOrderingReferenceIsDiscriminating:
      overlapCorrect.some((value, index) => value !== overlapWrongSrgb[index]),
    compositeRollbackFailureWasReported: rollback.threw,
    compositeRollbackKeptActiveLayer: rollback.activeLayerRestored,
    compositeRollbackKeptOpacity: rollback.opacityRestored,
    compositeRollbackKeptWorkingSet: rollback.workingSetMatchesActiveLayer,
    compositeRollbackKeptMergedBytes: rollback.differingBytes === 0,
    compositeRollbackReleasedCandidates:
      Math.abs(rollback.memoryAfterMiB - rollback.memoryBeforeMiB) < 0.01,
    inactiveOpacityInvalidatedMergedAbove:
      invalidation.opacityDelta <= 1 && invalidation.changedFromBaseline,
    inactiveVisibilityInvalidatedMergedAbove: invalidation.hiddenDelta <= 1,
    zoomSelectedLogicalMip2: zoom.selectedMipLevel === 2,
    zoomBuiltMergedAboveMip2: zoom.aboveValidThroughLevel >= 2,
    zoomMip2MatchesIndependentBoxFilter: zoom.maxDelta <= 1,
    zoomPresentationDidNotFallBackToChecker:
      zoom.presentationAtZoom.some((value, index) => value !== zoom.checkerAtZoom[index]),
    fiveLayersAllocated: fiveLayerMemory.layerCount === 5,
    fiveLayersKeepOnlyOneHotFullCanvas:
      Math.abs(fiveLayerMemory.layerBaseMiB - 64) < 0.01,
    fiveLayerColdStoreIsSparse:
      fiveLayerMemory.layerColdMiB > 0
      && fiveLayerMemory.layerColdMiB < 4 * 64,
    fiveLayerHydrationsWereReleased:
      fiveLayerMemory.layerHydrationMiB < 0.01,
    fiveLayerBakesWereReleased:
      fiveLayerMemory.layerBakeMiB < 0.01
      && fiveLayerBakeStates.every((state) => !state.allocated && !state.valid),
    fiveLayersUseOneFusedSide:
      fiveLayerCompositeState.below.layerCount === 4
      && !fiveLayerCompositeState.above.allocated,
    fiveLayerFoldDomainWasBounded:
      fiveLayerCompositeState.below.foldedPixels > 0
      && fiveLayerCompositeState.below.foldedPixels < 4 * 4096 * 4096,
    fiveLayerAnalyticBakeDomainWasBounded:
      fiveLayerCompositeState.below.analyticBakePixels > 0
      && fiveLayerCompositeState.below.analyticBakePixels < 4 * 4096 * 4096,
    fiveLayerSwitchBreakdownIsConsistent:
      fiveLayerSwitchBreakdown.every((entry) =>
        Number.isFinite(entry.totalMs)
        && Number.isFinite(entry.effectsMs)
        && Number.isFinite(entry.compositeMs)
        && entry.totalMs + 0.01 >= entry.effectsMs + entry.compositeMs
      ),
    fiveLayerSwitchPeakSamplerObservedBothRuns:
      fiveLayerSwitchMemoryPeaks.every((entry) =>
        entry.sampleCount > 1
        && Number.isFinite(entry.peakDeltaMiB)
        && entry.maxima.countedTotalMiB + 1e-6 >= entry.before.countedTotalMiB
      ),
    fiveLayerMiddleSwitchPeakSamplerObservedBothRuns:
      fiveLayerMiddleSwitchMemoryPeaks.every((entry) =>
        entry.sampleCount > 1
        && Number.isFinite(entry.peakDeltaMiB)
        && entry.maxima.countedTotalMiB + 1e-6 >= entry.before.countedTotalMiB
      ),
    layerAddPeakSamplerObservedBothRuns:
      layerAddMemoryPeaks.every((entry) =>
        entry.sampleCount > 1
        && Number.isFinite(entry.peakDeltaMiB)
        && entry.maxima.countedTotalMiB + 1e-6 >= entry.before.countedTotalMiB
      ),
    edgeLayerTransitionsKeepOneCopyPerReconstructibleClass: edgePeakResourcesAreBounded,
    middleLayerTransitionKeepsOnlyItsTwoFinalCompositeSides:
      middlePeakResourcesAreBounded,
  };

  return {
    bakeStrategy: LAYER_BAKE_STRATEGY,
    strategy: LAYER_COMPOSITE_STRATEGY,
    passed: Object.values(checks).every(Boolean),
    checks,
    samples,
    merged: { below: mergedBelow, above: mergedAbove },
    opaqueCopy,
    rollback,
    invalidation,
    zoom,
    fiveLayerMemory,
    fiveLayerBakeStates,
    fiveLayerCompositeState,
    fiveLayerSwitchMs,
    fiveLayerSwitchBreakdown,
    fiveLayerSwitchMemoryPeaks,
    fiveLayerMiddleSwitchMemoryPeaks,
    layerAddMemoryPeaks,
    nextTimeMs: timeMs,
  };
}
