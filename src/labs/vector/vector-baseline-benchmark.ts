import type { BrushEngine } from "../../brush-engine";
import type { EngineGpuMemoryStats } from "../../engine-stats";
import type { MixedSceneController } from "../../mixed-scene-controller";
import type { MixedSceneDiagnostics } from "../../mixed-scene-controller-contract";
import {
  VECTOR_SVG_NODE_MAXIMUM,
  VECTOR_TEXT_NODE_MAXIMUM,
} from "../../mixed-scene-stack";
import type { VectorSvgNodeSeed } from "../../scene-svg-model";
import type { VectorTextNodeSeed } from "../../scene-text-model";
import {
  parseVectorSvg,
  type VectorSvgDocument,
} from "../../vector-svg-import";

export type VectorBaselineProfile = "shared" | "unique";

const VECTOR_BASELINE_REPORT_VERSION = 1;
const VECTOR_BASELINE_STRATEGY =
  "vector-baseline-64-svg-64-text-cold-warm-pan-zoom-v1" as const;
const IDLE_FRAME_COUNT = 30;
const PAN_FRAME_COUNT = 60;
const ZOOM_FRAME_COUNT = 48;
const STABLE_FRAME_LIMIT = 720;
const STABLE_CONSECUTIVE_FRAME_COUNT = 3;
const RUNTIME_SAMPLE_INTERVAL_MS = 50;

interface BrowserMemorySnapshot {
  readonly supported: boolean;
  readonly usedJsHeapMiB: number | null;
  readonly totalJsHeapMiB: number | null;
  readonly jsHeapLimitMiB: number | null;
}

interface VectorMemorySnapshot {
  readonly countedTotalMiB: number;
  readonly registeredCurrentMiB: number;
  readonly registeredPeakMiB: number;
  readonly registeredTextureCount: number;
  readonly registeredBufferCount: number;
  readonly registeredUnmeasurableCount: number;
  readonly vectorPresentationMiB: number;
  readonly presentationCacheMiB: number;
  readonly effectsScratchPoolMiB: number;
  readonly liveVectorGpuMiB: number;
  readonly viewportTextureCount: number;
  readonly vectorFontLogicalMiB: number;
  readonly blockShadowPathLogicalMiB: number;
  readonly registeredCategories: readonly {
    readonly category: string;
    readonly currentMiB: number;
    readonly peakMiB: number;
    readonly count: number;
  }[];
  readonly browser: BrowserMemorySnapshot;
}

interface VectorCompilerSnapshot {
  readonly pendingJobs: number;
  readonly failedJobs: number;
  readonly lastError: string | null;
  readonly atomicHoldCount: number;
  readonly atomicPendingNodes: number;
}

interface VectorDiagnosticSnapshot extends VectorCompilerSnapshot {
  readonly renderCount: number;
  readonly lastRenderMs: number;
  readonly renderP95Ms: number;
  readonly zoomRenderMode: "precise" | "fast";
  readonly zoomFastPresentationMode: string;
  readonly zoomViewRevision: number;
  readonly zoomViewEventCount: number;
  readonly zoomFastActivationCount: number;
  readonly zoomExactRecoveryCount: number;
  readonly zoomSafeReprojectionCount: number;
  readonly zoomFallbackReprojectionCount: number;
  readonly zoomClippedReprojectionCount: number;
  readonly zoomUnsafeExactRefreshCount: number;
  readonly zoomFastPresentationSubmissionCount: number;
  readonly gpuGeometryStrategy: string;
  readonly gpuRenderStrategy: string;
}

interface FrameDistribution {
  readonly intervalsMs: readonly number[];
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maximumMs: number;
  readonly over20Ms: number;
  readonly over33Ms: number;
  readonly normalizedMissedFrameCount: number;
}

interface ViewRenderMeasurement {
  readonly endToEndMs: number;
  readonly renderCountDelta: number;
  readonly rendererMs: number;
  readonly waitedFrameCount: number;
  readonly frames: FrameDistribution;
  readonly before: VectorDiagnosticSnapshot;
  readonly after: VectorDiagnosticSnapshot;
}

interface GestureMeasurement {
  readonly eventCount: number;
  readonly gestureDurationMs: number;
  readonly eventToNextFrameMs: readonly number[];
  readonly eventToNextFrameP95Ms: number;
  readonly frames: FrameDistribution;
  readonly recoveryMs: number;
  readonly renderCountDuringGesture: number;
  readonly renderCountDuringRecovery: number;
  readonly fastActivationDelta: number;
  readonly exactRecoveryDelta: number;
  readonly safeReprojectionDelta: number;
  readonly fallbackReprojectionDelta: number;
  readonly clippedReprojectionDelta: number;
  readonly unsafeExactRefreshDelta: number;
  readonly fastPresentationSubmissionDelta: number;
  readonly before: VectorDiagnosticSnapshot;
  readonly during: VectorDiagnosticSnapshot;
  readonly after: VectorDiagnosticSnapshot;
}

interface RuntimePeaks {
  readonly sampleCount: number;
  readonly countedTotalMiB: number;
  readonly registeredCurrentMiB: number;
  readonly registeredBufferCount: number;
  readonly registeredTextureCount: number;
  readonly vectorPresentationMiB: number;
  readonly liveVectorGpuMiB: number;
  readonly usedJsHeapMiB: number | null;
  readonly compilerPendingJobs: number;
  readonly compilerFailedJobs: number;
  readonly atomicPendingNodes: number;
}

export interface VectorBaselineReport {
  readonly version: typeof VECTOR_BASELINE_REPORT_VERSION;
  readonly strategy: typeof VECTOR_BASELINE_STRATEGY;
  readonly profile: VectorBaselineProfile;
  readonly passed: boolean;
  readonly environment: {
    readonly userAgent: string;
    readonly gpuLabel: string;
    readonly visibilityAtStart: DocumentVisibilityState;
    readonly visibilityAtEnd: DocumentVisibilityState;
    readonly devicePixelRatioAtStart: number;
    readonly devicePixelRatioAtEnd: number;
    readonly viewportWidthAtStart: number;
    readonly viewportHeightAtStart: number;
    readonly viewportWidthAtEnd: number;
    readonly viewportHeightAtEnd: number;
    readonly canvasWidthAtStart: number;
    readonly canvasHeightAtStart: number;
    readonly canvasWidthAtEnd: number;
    readonly canvasHeightAtEnd: number;
    readonly documentWidth: number;
    readonly documentHeight: number;
  };
  readonly fixture: {
    readonly svgCount: number;
    readonly textCount: number;
    readonly svgSourceRevisionCount: number;
    readonly textGeometrySignatureCount: number;
    readonly svgPaintCount: number;
    readonly svgCommandCount: number;
    readonly svgContourCount: number;
    readonly svgLogicalVectorMiB: number;
    readonly uniqueSvgLogicalVectorMiB: number;
    readonly textCharacterCount: number;
    readonly sourceGenerationMs: number;
    readonly svgParseMs: number;
    readonly sceneMutationMs: number;
    readonly firstStableSceneMs: number;
  };
  readonly idle: FrameDistribution;
  readonly fittedZoom: number;
  readonly coldTargetZoom: number;
  readonly cold: ViewRenderMeasurement;
  readonly warm: ViewRenderMeasurement;
  readonly pan: GestureMeasurement;
  readonly zoom: GestureMeasurement;
  readonly memory: {
    readonly before: VectorMemorySnapshot;
    readonly afterSetup: VectorMemorySnapshot;
    readonly afterTrace: VectorMemorySnapshot;
    readonly deltaAfterSetup: VectorMemorySnapshot;
    readonly deltaAfterTrace: VectorMemorySnapshot;
    readonly peaks: RuntimePeaks;
  };
  readonly compiler: {
    readonly before: VectorCompilerSnapshot;
    readonly afterSetup: VectorCompilerSnapshot;
    readonly afterTrace: VectorCompilerSnapshot;
    readonly failedJobDelta: number;
    readonly peakPendingJobs: number;
    readonly peakAtomicPendingNodes: number;
  };
  readonly diagnostics: {
    readonly before: VectorDiagnosticSnapshot;
    readonly afterSetup: VectorDiagnosticSnapshot;
    readonly afterTrace: VectorDiagnosticSnapshot;
  };
  readonly checks: {
    readonly freshDocumentAccepted: boolean;
    readonly maximumScenePopulated: boolean;
    readonly profileIdentityValidated: boolean;
    readonly coldAndWarmRendered: boolean;
    readonly panTraceCompleted: boolean;
    readonly zoomTraceCompleted: boolean;
    readonly compilerSettledWithoutNewFailure: boolean;
    readonly finalPresentationPrecise: boolean;
    readonly environmentStayedStable: boolean;
  };
}

interface StableResult {
  readonly diagnostics: MixedSceneDiagnostics;
  readonly intervalsMs: readonly number[];
}

interface RuntimeSampler {
  readonly observe: () => void;
  readonly stop: () => RuntimePeaks;
}

const MEBIBYTE_BYTES = 1024 * 1024;

function nextFrame(): Promise<number> {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  ];
}

function frameDistribution(
  intervalsMs: readonly number[],
  idleMedianMs: number,
): FrameDistribution {
  return {
    intervalsMs,
    p50Ms: percentile(intervalsMs, 0.5),
    p95Ms: percentile(intervalsMs, 0.95),
    maximumMs: intervalsMs.length > 0 ? Math.max(...intervalsMs) : 0,
    over20Ms: intervalsMs.filter((duration) => duration > 20).length,
    over33Ms: intervalsMs.filter((duration) => duration > 33).length,
    normalizedMissedFrameCount: idleMedianMs > 0
      ? intervalsMs.reduce(
          (count, duration) => count + Math.max(
            0,
            Math.round(duration / idleMedianMs) - 1,
          ),
          0,
        )
      : 0,
  };
}

function browserMemorySnapshot(): BrowserMemorySnapshot {
  const memory = (performance as Performance & {
    readonly memory?: {
      readonly usedJSHeapSize: number;
      readonly totalJSHeapSize: number;
      readonly jsHeapSizeLimit: number;
    };
  }).memory;
  return {
    supported: Boolean(memory),
    usedJsHeapMiB: memory ? memory.usedJSHeapSize / MEBIBYTE_BYTES : null,
    totalJsHeapMiB: memory ? memory.totalJSHeapSize / MEBIBYTE_BYTES : null,
    jsHeapLimitMiB: memory ? memory.jsHeapSizeLimit / MEBIBYTE_BYTES : null,
  };
}

function diagnosticSnapshot(
  diagnostics: MixedSceneDiagnostics,
): VectorDiagnosticSnapshot {
  return {
    renderCount: diagnostics.renderCount,
    lastRenderMs: diagnostics.lastRenderMs,
    renderP95Ms: diagnostics.renderP95Ms,
    zoomRenderMode: diagnostics.zoomRenderMode,
    zoomFastPresentationMode: diagnostics.zoomFastPresentationMode,
    zoomViewRevision: diagnostics.zoomViewRevision,
    zoomViewEventCount: diagnostics.zoomViewEventCount,
    zoomFastActivationCount: diagnostics.zoomFastActivationCount,
    zoomExactRecoveryCount: diagnostics.zoomExactRecoveryCount,
    zoomSafeReprojectionCount: diagnostics.zoomSafeReprojectionCount,
    zoomFallbackReprojectionCount: diagnostics.zoomFallbackReprojectionCount,
    zoomClippedReprojectionCount: diagnostics.zoomClippedReprojectionCount,
    zoomUnsafeExactRefreshCount: diagnostics.zoomUnsafeExactRefreshCount,
    zoomFastPresentationSubmissionCount:
      diagnostics.zoomFastPresentationSubmissionCount,
    gpuGeometryStrategy: diagnostics.gpuGeometryStrategy,
    gpuRenderStrategy: diagnostics.gpuRenderStrategy,
    pendingJobs: diagnostics.effectWorkerPendingJobs,
    failedJobs: diagnostics.effectWorkerFailedJobs,
    lastError: diagnostics.effectWorkerLastError,
    atomicHoldCount: diagnostics.atomicEffectHoldCount,
    atomicPendingNodes: diagnostics.atomicEffectPendingNodes,
  };
}

function compilerSnapshot(
  diagnostics: MixedSceneDiagnostics,
): VectorCompilerSnapshot {
  return {
    pendingJobs: diagnostics.effectWorkerPendingJobs,
    failedJobs: diagnostics.effectWorkerFailedJobs,
    lastError: diagnostics.effectWorkerLastError,
    atomicHoldCount: diagnostics.atomicEffectHoldCount,
    atomicPendingNodes: diagnostics.atomicEffectPendingNodes,
  };
}

function memorySnapshot(
  gpuMemory: EngineGpuMemoryStats,
  diagnostics: MixedSceneDiagnostics,
): VectorMemorySnapshot {
  return {
    countedTotalMiB: gpuMemory.countedTotalMiB,
    registeredCurrentMiB: gpuMemory.registeredCurrentMiB,
    registeredPeakMiB: gpuMemory.registeredPeakMiB,
    registeredTextureCount: gpuMemory.registeredTextureCount,
    registeredBufferCount: gpuMemory.registeredBufferCount,
    registeredUnmeasurableCount: gpuMemory.registeredUnmeasurableCount,
    vectorPresentationMiB: gpuMemory.vectorTextPresentationMiB,
    presentationCacheMiB: gpuMemory.presentationCacheMiB,
    effectsScratchPoolMiB: gpuMemory.effectsScratchPoolMiB,
    liveVectorGpuMiB: diagnostics.liveGpuMemoryMiB,
    viewportTextureCount: diagnostics.viewportTextureCount,
    vectorFontLogicalMiB: diagnostics.vectorFontLogicalMiB,
    blockShadowPathLogicalMiB: diagnostics.blockShadowPathLogicalMiB,
    registeredCategories: gpuMemory.registeredCategories.map((category) => ({
      ...category,
    })),
    browser: browserMemorySnapshot(),
  };
}

function subtractMemory(
  right: VectorMemorySnapshot,
  left: VectorMemorySnapshot,
): VectorMemorySnapshot {
  const categories = new Map(left.registeredCategories.map((entry) => [
    entry.category,
    entry,
  ]));
  return {
    countedTotalMiB: right.countedTotalMiB - left.countedTotalMiB,
    registeredCurrentMiB: right.registeredCurrentMiB - left.registeredCurrentMiB,
    registeredPeakMiB: right.registeredPeakMiB - left.registeredPeakMiB,
    registeredTextureCount: right.registeredTextureCount - left.registeredTextureCount,
    registeredBufferCount: right.registeredBufferCount - left.registeredBufferCount,
    registeredUnmeasurableCount:
      right.registeredUnmeasurableCount - left.registeredUnmeasurableCount,
    vectorPresentationMiB:
      right.vectorPresentationMiB - left.vectorPresentationMiB,
    presentationCacheMiB: right.presentationCacheMiB - left.presentationCacheMiB,
    effectsScratchPoolMiB:
      right.effectsScratchPoolMiB - left.effectsScratchPoolMiB,
    liveVectorGpuMiB: right.liveVectorGpuMiB - left.liveVectorGpuMiB,
    viewportTextureCount: right.viewportTextureCount - left.viewportTextureCount,
    vectorFontLogicalMiB: right.vectorFontLogicalMiB - left.vectorFontLogicalMiB,
    blockShadowPathLogicalMiB:
      right.blockShadowPathLogicalMiB - left.blockShadowPathLogicalMiB,
    registeredCategories: right.registeredCategories.map((entry) => {
      const before = categories.get(entry.category);
      return {
        category: entry.category,
        currentMiB: entry.currentMiB - (before?.currentMiB ?? 0),
        peakMiB: entry.peakMiB - (before?.peakMiB ?? 0),
        count: entry.count - (before?.count ?? 0),
      };
    }),
    browser: {
      supported: right.browser.supported && left.browser.supported,
      usedJsHeapMiB: right.browser.usedJsHeapMiB !== null
          && left.browser.usedJsHeapMiB !== null
        ? right.browser.usedJsHeapMiB - left.browser.usedJsHeapMiB
        : null,
      totalJsHeapMiB: right.browser.totalJsHeapMiB !== null
          && left.browser.totalJsHeapMiB !== null
        ? right.browser.totalJsHeapMiB - left.browser.totalJsHeapMiB
        : null,
      jsHeapLimitMiB: right.browser.jsHeapLimitMiB !== null
          && left.browser.jsHeapLimitMiB !== null
        ? right.browser.jsHeapLimitMiB - left.browser.jsHeapLimitMiB
        : null,
    },
  };
}

function beginRuntimeSampling(
  engine: BrushEngine,
  controller: MixedSceneController,
): RuntimeSampler {
  let sampleCount = 0;
  let countedTotalMiB = 0;
  let registeredCurrentMiB = 0;
  let registeredBufferCount = 0;
  let registeredTextureCount = 0;
  let vectorPresentationMiB = 0;
  let liveVectorGpuMiB = 0;
  let usedJsHeapMiB: number | null = null;
  let compilerPendingJobs = 0;
  let compilerFailedJobs = 0;
  let atomicPendingNodes = 0;
  const observe = () => {
    const gpu = engine.getStats().gpuMemory;
    const diagnostics = controller.getDiagnostics();
    const browser = browserMemorySnapshot();
    sampleCount += 1;
    countedTotalMiB = Math.max(countedTotalMiB, gpu.countedTotalMiB);
    registeredCurrentMiB = Math.max(registeredCurrentMiB, gpu.registeredCurrentMiB);
    registeredBufferCount = Math.max(registeredBufferCount, gpu.registeredBufferCount);
    registeredTextureCount = Math.max(registeredTextureCount, gpu.registeredTextureCount);
    vectorPresentationMiB = Math.max(
      vectorPresentationMiB,
      gpu.vectorTextPresentationMiB,
    );
    liveVectorGpuMiB = Math.max(liveVectorGpuMiB, diagnostics.liveGpuMemoryMiB);
    if (browser.usedJsHeapMiB !== null) {
      usedJsHeapMiB = Math.max(usedJsHeapMiB ?? 0, browser.usedJsHeapMiB);
    }
    compilerPendingJobs = Math.max(
      compilerPendingJobs,
      diagnostics.effectWorkerPendingJobs,
    );
    compilerFailedJobs = Math.max(
      compilerFailedJobs,
      diagnostics.effectWorkerFailedJobs,
    );
    atomicPendingNodes = Math.max(
      atomicPendingNodes,
      diagnostics.atomicEffectPendingNodes,
    );
  };
  const interval = window.setInterval(observe, RUNTIME_SAMPLE_INTERVAL_MS);
  observe();
  return {
    observe,
    stop: () => {
      window.clearInterval(interval);
      observe();
      return {
        sampleCount,
        countedTotalMiB,
        registeredCurrentMiB,
        registeredBufferCount,
        registeredTextureCount,
        vectorPresentationMiB,
        liveVectorGpuMiB,
        usedJsHeapMiB,
        compilerPendingJobs,
        compilerFailedJobs,
        atomicPendingNodes,
      };
    },
  };
}

function stable(diagnostics: MixedSceneDiagnostics): boolean {
  return diagnostics.zoomRenderMode === "precise"
    && diagnostics.zoomFastPresentationMode === "precise"
    && diagnostics.effectWorkerPendingJobs === 0
    && diagnostics.atomicEffectPendingNodes === 0
    && !diagnostics.zoomUnsafeExactRefreshInFlight
    && !diagnostics.zoomUnsafeExactRefreshRequestPending;
}

async function waitForStableScene(
  engine: BrushEngine,
  controller: MixedSceneController,
  minimumRenderCount: number,
  sampler: RuntimeSampler,
): Promise<StableResult> {
  let consecutiveStableFrames = 0;
  const intervalsMs: number[] = [];
  let previous = await nextFrame();
  for (let frame = 0; frame < STABLE_FRAME_LIMIT; frame += 1) {
    const timestamp = await nextFrame();
    intervalsMs.push(Math.max(0, timestamp - previous));
    previous = timestamp;
    sampler.observe();
    const diagnostics = controller.getDiagnostics();
    const isStable = diagnostics.renderCount >= minimumRenderCount
      && stable(diagnostics);
    consecutiveStableFrames = isStable ? consecutiveStableFrames + 1 : 0;
    if (consecutiveStableFrames >= STABLE_CONSECUTIVE_FRAME_COUNT) {
      await engine.waitForIdle();
      await engine.waitForVectorTextPresentationCompletion();
      const settled = controller.getDiagnostics();
      if (settled.renderCount >= minimumRenderCount && stable(settled)) {
        sampler.observe();
        return { diagnostics: settled, intervalsMs };
      }
      consecutiveStableFrames = 0;
    }
  }
  throw new Error("Vector scene did not settle within 720 visible frames.");
}

async function measureIdleFrames(): Promise<FrameDistribution> {
  const intervalsMs: number[] = [];
  let previous = await nextFrame();
  for (let index = 0; index < IDLE_FRAME_COUNT; index += 1) {
    const timestamp = await nextFrame();
    intervalsMs.push(Math.max(0, timestamp - previous));
    previous = timestamp;
  }
  return frameDistribution(intervalsMs, percentile(intervalsMs, 0.5));
}

function gridPlacement(
  index: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const column = index % 8;
  const row = Math.floor(index / 8);
  const marginX = width * 0.12;
  const marginY = height * 0.12;
  return {
    x: marginX + (column + 0.5) * (width - marginX * 2) / 8,
    y: marginY + (row + 0.5) * (height - marginY * 2) / 8,
  };
}

function paletteColor(index: number, offset = 0): string {
  const palette = [
    "#16324f",
    "#e4572e",
    "#17bebb",
    "#ffc914",
    "#7d53de",
    "#76b041",
    "#d7263d",
    "#4f6d7a",
  ];
  return palette[(index + offset) % palette.length];
}

function fixed(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "0.000";
}

function complexClosedPath(seed: number): string {
  const contourCount = 1;
  const pointCount = 16;
  const commands: string[] = [];
  for (let contour = 0; contour < contourCount; contour += 1) {
    const centerX = 256 + Math.sin(seed * 0.73) * 3;
    const centerY = 256 + Math.cos(seed * 0.51) * 3;
    const baseRadius = 210 - contour * 50;
    const phase = seed * 0.071 + contour * 0.43;
    const points = Array.from({ length: pointCount }, (_, pointIndex) => {
      const angle = pointIndex / pointCount * Math.PI * 2;
      const ripple = 1
        + 0.025 * Math.sin(angle * (5 + contour) + phase)
        + 0.01 * Math.cos(angle * (9 - contour) - phase * 0.7);
      return {
        x: centerX + Math.cos(angle) * baseRadius * ripple,
        y: centerY + Math.sin(angle) * baseRadius * ripple,
      };
    });
    commands.push(`M ${fixed(points[0].x)} ${fixed(points[0].y)}`);
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      const previous = points[(pointIndex - 1 + pointCount) % pointCount];
      const current = points[pointIndex];
      const next = points[(pointIndex + 1) % pointCount];
      const following = points[(pointIndex + 2) % pointCount];
      const firstControl = {
        x: current.x + (next.x - previous.x) / 6,
        y: current.y + (next.y - previous.y) / 6,
      };
      const secondControl = {
        x: next.x - (following.x - current.x) / 6,
        y: next.y - (following.y - current.y) / 6,
      };
      commands.push(
        `C ${fixed(firstControl.x)} ${fixed(firstControl.y)} `
        + `${fixed(secondControl.x)} ${fixed(secondControl.y)} `
        + `${fixed(next.x)} ${fixed(next.y)}`,
      );
    }
    commands.push("Z");
  }
  return commands.join(" ");
}

function vectorSvgSource(seed: number): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
    `<metadata>revision-${seed}</metadata>`,
    `<path d="${complexClosedPath(0)}" fill="${paletteColor(0)}"/>`,
    "</svg>",
  ].join("");
}

function uniqueText(index: number): string {
  const characters = [..."VECTOR SHARED CURVES"];
  let state = (index + 1) * 0x9e3779b1;
  for (let cursor = characters.length - 1; cursor > 0; cursor -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const swap = (state >>> 0) % (cursor + 1);
    [characters[cursor], characters[swap]] = [characters[swap], characters[cursor]];
  }
  return characters.join("");
}

function textSeed(
  profile: VectorBaselineProfile,
  index: number,
  width: number,
  height: number,
): VectorTextNodeSeed {
  const placement = gridPlacement(index, width, height);
  return {
    text: profile === "shared" ? "VECTOR SHARED CURVES" : uniqueText(index),
    fontFamily: "Anton",
    fontSize: 108,
    color: paletteColor(index, 2),
    transformType: "none",
    transformCurve: 80,
    circleRadiusPercent: 50,
    circleInverted: false,
    distortPoints: null,
    outlineWidth: 0,
    outlineColor: "#111111",
    outlineJoin: "round",
    blockShadowEnabled: false,
    blockShadowColor: "#000000",
    blockShadowOpacity: 0,
    blockShadowOffset: 0,
    blockShadowAngle: 0,
    blockShadowOutlineWidth: 0,
    singleShadowEnabled: false,
    singleShadowColor: "#000000",
    singleShadowOpacity: 0,
    singleShadowOffset: 0,
    singleShadowAngle: 0,
    singleShadowBlur: 0,
    innerShadowEnabled: false,
    innerShadowColor: "#000000",
    innerShadowOpacity: 0,
    innerShadowOffset: 0,
    innerShadowAngle: 0,
    innerShadowBlur: 0,
    x: placement.x,
    y: placement.y + height * 0.021,
    scale: 0.34,
    rotation: ((index % 7) - 3) * Math.PI / 180,
  };
}

function svgSeed(
  documentValue: VectorSvgDocument,
  index: number,
  width: number,
  height: number,
): VectorSvgNodeSeed {
  const placement = gridPlacement(index, width, height);
  return {
    document: documentValue,
    paintColors: documentValue.paints.map((_paint, paintIndex) => (
      paletteColor(index, paintIndex * 3)
    )),
    outlineWidth: 0,
    outlineColor: "#111111",
    outlineJoin: "round",
    blockShadowEnabled: false,
    blockShadowOpacity: 0,
    singleShadowEnabled: false,
    singleShadowOpacity: 0,
    innerShadowEnabled: false,
    innerShadowOpacity: 0,
    x: placement.x,
    y: placement.y - height * 0.025,
    scale: 0.31,
    rotation: ((index % 9) - 4) * Math.PI / 180,
  };
}

async function measureViewRender(
  engine: BrushEngine,
  controller: MixedSceneController,
  sampler: RuntimeSampler,
  idleMedianMs: number,
  mutation: () => void,
): Promise<ViewRenderMeasurement> {
  const beforeDiagnostics = controller.getDiagnostics();
  const startedAt = performance.now();
  mutation();
  const stableResult = await waitForStableScene(
    engine,
    controller,
    beforeDiagnostics.renderCount + 1,
    sampler,
  );
  const afterDiagnostics = stableResult.diagnostics;
  return {
    endToEndMs: performance.now() - startedAt,
    renderCountDelta: afterDiagnostics.renderCount - beforeDiagnostics.renderCount,
    rendererMs: afterDiagnostics.lastRenderMs,
    waitedFrameCount: stableResult.intervalsMs.length,
    frames: frameDistribution(stableResult.intervalsMs, idleMedianMs),
    before: diagnosticSnapshot(beforeDiagnostics),
    after: diagnosticSnapshot(afterDiagnostics),
  };
}

async function measureGesture(
  engine: BrushEngine,
  controller: MixedSceneController,
  sampler: RuntimeSampler,
  idleMedianMs: number,
  eventCount: number,
  applyEvent: (index: number) => void,
): Promise<GestureMeasurement> {
  const before = controller.getDiagnostics();
  const intervalsMs: number[] = [];
  const eventToNextFrameMs: number[] = [];
  let previous = await nextFrame();
  const gestureStartedAt = performance.now();
  controller.beginViewGesture();
  try {
    for (let index = 0; index < eventCount; index += 1) {
      const eventStartedAt = performance.now();
      applyEvent(index);
      const timestamp = await nextFrame();
      intervalsMs.push(Math.max(0, timestamp - previous));
      eventToNextFrameMs.push(Math.max(0, performance.now() - eventStartedAt));
      previous = timestamp;
      sampler.observe();
    }
  } catch (error) {
    controller.endViewGesture();
    throw error;
  }
  const during = controller.getDiagnostics();
  const gestureDurationMs = performance.now() - gestureStartedAt;
  const recoveryStartedAt = performance.now();
  controller.endViewGesture();
  const stableResult = await waitForStableScene(
    engine,
    controller,
    during.renderCount,
    sampler,
  );
  const after = stableResult.diagnostics;
  return {
    eventCount,
    gestureDurationMs,
    eventToNextFrameMs,
    eventToNextFrameP95Ms: percentile(eventToNextFrameMs, 0.95),
    frames: frameDistribution(intervalsMs, idleMedianMs),
    recoveryMs: performance.now() - recoveryStartedAt,
    renderCountDuringGesture: during.renderCount - before.renderCount,
    renderCountDuringRecovery: after.renderCount - during.renderCount,
    fastActivationDelta: during.zoomFastActivationCount - before.zoomFastActivationCount,
    exactRecoveryDelta: after.zoomExactRecoveryCount - before.zoomExactRecoveryCount,
    safeReprojectionDelta:
      during.zoomSafeReprojectionCount - before.zoomSafeReprojectionCount,
    fallbackReprojectionDelta:
      during.zoomFallbackReprojectionCount - before.zoomFallbackReprojectionCount,
    clippedReprojectionDelta:
      during.zoomClippedReprojectionCount - before.zoomClippedReprojectionCount,
    unsafeExactRefreshDelta:
      during.zoomUnsafeExactRefreshCount - before.zoomUnsafeExactRefreshCount,
    fastPresentationSubmissionDelta:
      during.zoomFastPresentationSubmissionCount
      - before.zoomFastPresentationSubmissionCount,
    before: diagnosticSnapshot(before),
    during: diagnosticSnapshot(during),
    after: diagnosticSnapshot(after),
  };
}

function initialDocumentIsFresh(engine: BrushEngine): boolean {
  const stats = engine.getStats();
  const scene = engine.getMixedSceneSnapshot();
  return stats.layerCount === 1
    && stats.layers.length === 1
    && !stats.layers[0].hasContent
    && Boolean(scene)
    && scene?.items.length === 1
    && scene.items[0].kind === "raster";
}

export async function runVectorBaselineBenchmark(
  engine: BrushEngine,
  controller: MixedSceneController,
  canvas: HTMLCanvasElement,
  profile: VectorBaselineProfile,
): Promise<VectorBaselineReport> {
  const freshDocumentAccepted = initialDocumentIsFresh(engine);
  if (!freshDocumentAccepted) {
    throw new Error(
      "Vector baseline requires a new document with one empty raster layer.",
    );
  }

  const visibilityAtStart = document.visibilityState;
  if (visibilityAtStart !== "visible") {
    throw new Error("Vector baseline requires a visible foreground tab.");
  }
  const environmentStart = {
    devicePixelRatio: window.devicePixelRatio,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  };
  const diagnosticsBefore = controller.getDiagnostics();
  const memoryBefore = memorySnapshot(engine.getStats().gpuMemory, diagnosticsBefore);
  const compilerBefore = compilerSnapshot(diagnosticsBefore);
  const sampler = beginRuntimeSampling(engine, controller);

  let sourceGenerationMs = 0;
  let svgParseMs = 0;
  let sceneMutationMs = 0;
  let firstStableSceneMs = 0;
  let peaks: RuntimePeaks | null = null;
  try {
    const sourceStartedAt = performance.now();
    const svgSources = profile === "shared"
      ? [vectorSvgSource(0)]
      : Array.from(
          { length: VECTOR_SVG_NODE_MAXIMUM },
          (_, index) => vectorSvgSource(index + 1),
        );
    const textEntries = Array.from({ length: VECTOR_TEXT_NODE_MAXIMUM }, (_, index) => ({
      seed: textSeed(profile, index, engine.documentWidth, engine.documentHeight),
      name: `Vector baseline text ${String(index + 1).padStart(2, "0")}`,
    }));
    sourceGenerationMs = performance.now() - sourceStartedAt;
    const parseStartedAt = performance.now();
    const parsedDocuments = svgSources.map((source, index) => parseVectorSvg(
      source,
      profile === "shared"
        ? "vector-baseline-shared.svg"
        : `vector-baseline-unique-${String(index + 1).padStart(2, "0")}.svg`,
    ));
    svgParseMs = performance.now() - parseStartedAt;

    const sceneStartedAt = performance.now();
    for (let index = 0; index < VECTOR_SVG_NODE_MAXIMUM; index += 1) {
      const documentValue = profile === "shared"
        ? parsedDocuments[0]
        : parsedDocuments[index];
      await engine.addVectorSvgNode(
        svgSeed(documentValue, index, engine.documentWidth, engine.documentHeight),
        `Vector baseline SVG ${String(index + 1).padStart(2, "0")}`,
      );
      sampler.observe();
    }
    await engine.addVectorTextNodesBatch(textEntries);
    sampler.observe();
    sceneMutationMs = performance.now() - sceneStartedAt;

    const settleStartedAt = performance.now();
    const setupStable = await waitForStableScene(
      engine,
      controller,
      diagnosticsBefore.renderCount + 1,
      sampler,
    );
    firstStableSceneMs = performance.now() - sceneStartedAt;
    const settleTailMs = performance.now() - settleStartedAt;
    if (settleTailMs > firstStableSceneMs) {
      throw new Error("Invalid vector baseline setup timing.");
    }

    const snapshot = engine.getMixedSceneSnapshot();
    if (!snapshot) throw new Error("Vector baseline scene snapshot is unavailable.");
    const svgNodes = snapshot.items.flatMap((item) => (
      item.kind === "svg" ? [item.svgNode] : []
    ));
    const textNodes = snapshot.items.flatMap((item) => (
      item.kind === "text" ? [item.textNode] : []
    ));
    const uniqueSvgDocuments = new Map<string, VectorSvgDocument>();
    for (const node of svgNodes) {
      uniqueSvgDocuments.set(node.document.sourceRevision, node.document);
    }
    const textGeometrySignatures = new Set(textNodes.map((node) => JSON.stringify({
      text: node.text,
      fontFamily: node.fontFamily,
      fontSize: node.fontSize,
      transformType: node.transformType,
      transformCurve: node.transformCurve,
      circleRadiusPercent: node.circleRadiusPercent,
      circleInverted: node.circleInverted,
      distortPoints: node.distortPoints,
    })));
    const svgLogicalVectorBytes = svgNodes.reduce(
      (total, node) => total + node.document.logicalVectorBytes,
      0,
    );
    const uniqueSvgLogicalVectorBytes = [...uniqueSvgDocuments.values()].reduce(
      (total, documentValue) => total + documentValue.logicalVectorBytes,
      0,
    );

    const diagnosticsAfterSetup = setupStable.diagnostics;
    const memoryAfterSetup = memorySnapshot(
      engine.getStats().gpuMemory,
      diagnosticsAfterSetup,
    );
    const compilerAfterSetup = compilerSnapshot(diagnosticsAfterSetup);
    const idle = await measureIdleFrames();
    const idleMedianMs = idle.p50Ms;

    controller.setAdaptiveZoomEnabled(false);
    let fittedZoom = 0;
    let coldTargetZoom = 0;
    let cold: ViewRenderMeasurement;
    let warm: ViewRenderMeasurement;
    try {
      await measureViewRender(
        engine,
        controller,
        sampler,
        idleMedianMs,
        () => engine.fitView(),
      );
      fittedZoom = engine.getVectorTextViewState().zoom;
      coldTargetZoom = Math.min(64, Math.max(fittedZoom * 4, fittedZoom + 0.01));
      const rectangle = canvas.getBoundingClientRect();
      const anchorX = rectangle.left + rectangle.width * 0.5;
      const anchorY = rectangle.top + rectangle.height * 0.5;
      cold = await measureViewRender(
        engine,
        controller,
        sampler,
        idleMedianMs,
        () => engine.zoomBy(
          coldTargetZoom / engine.getVectorTextViewState().zoom,
          anchorX,
          anchorY,
        ),
      );
      warm = await measureViewRender(
        engine,
        controller,
        sampler,
        idleMedianMs,
        () => engine.panByClientDelta(0, 0),
      );
    } finally {
      controller.setAdaptiveZoomEnabled(true);
    }

    const pan = await measureGesture(
      engine,
      controller,
      sampler,
      idleMedianMs,
      PAN_FRAME_COUNT,
      (index) => {
        const direction = index < PAN_FRAME_COUNT / 2 ? 1 : -1;
        engine.panByClientDelta(direction * 2, Math.sin(index * 0.37) * 0.75);
      },
    );

    const rectangle = canvas.getBoundingClientRect();
    const zoom = await measureGesture(
      engine,
      controller,
      sampler,
      idleMedianMs,
      ZOOM_FRAME_COUNT,
      (index) => {
        const outward = index < ZOOM_FRAME_COUNT / 2;
        const factor = outward ? 1.035 : 1 / 1.035;
        const progress = index / Math.max(1, ZOOM_FRAME_COUNT - 1);
        engine.zoomBy(
          factor,
          rectangle.left + rectangle.width * (0.5 + Math.sin(progress * Math.PI * 2) * 0.04),
          rectangle.top + rectangle.height * (0.5 + Math.cos(progress * Math.PI * 2) * 0.04),
        );
      },
    );

    const afterTrace = await waitForStableScene(
      engine,
      controller,
      controller.getDiagnostics().renderCount,
      sampler,
    );
    const diagnosticsAfterTrace = afterTrace.diagnostics;
    const memoryAfterTrace = memorySnapshot(
      engine.getStats().gpuMemory,
      diagnosticsAfterTrace,
    );
    const compilerAfterTrace = compilerSnapshot(diagnosticsAfterTrace);
    peaks = sampler.stop();

    const environmentEnd = {
      visibility: document.visibilityState,
      devicePixelRatio: window.devicePixelRatio,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };
    const maximumScenePopulated = svgNodes.length === VECTOR_SVG_NODE_MAXIMUM
      && textNodes.length === VECTOR_TEXT_NODE_MAXIMUM;
    const profileIdentityValidated = profile === "shared"
      ? uniqueSvgDocuments.size === 1 && textGeometrySignatures.size === 1
      : uniqueSvgDocuments.size === VECTOR_SVG_NODE_MAXIMUM
        && textGeometrySignatures.size === VECTOR_TEXT_NODE_MAXIMUM;
    const compilerSettledWithoutNewFailure = compilerAfterTrace.pendingJobs === 0
      && compilerAfterTrace.atomicPendingNodes === 0
      && compilerAfterTrace.failedJobs === compilerBefore.failedJobs;
    const environmentStayedStable = visibilityAtStart === "visible"
      && environmentEnd.visibility === "visible"
      && environmentStart.devicePixelRatio === environmentEnd.devicePixelRatio
      && environmentStart.viewportWidth === environmentEnd.viewportWidth
      && environmentStart.viewportHeight === environmentEnd.viewportHeight
      && environmentStart.canvasWidth === environmentEnd.canvasWidth
      && environmentStart.canvasHeight === environmentEnd.canvasHeight;
    const checks = {
      freshDocumentAccepted,
      maximumScenePopulated,
      profileIdentityValidated,
      coldAndWarmRendered: cold.renderCountDelta > 0 && warm.renderCountDelta > 0,
      panTraceCompleted:
        pan.frames.intervalsMs.length === PAN_FRAME_COUNT
        && pan.eventToNextFrameMs.length === PAN_FRAME_COUNT,
      zoomTraceCompleted:
        zoom.frames.intervalsMs.length === ZOOM_FRAME_COUNT
        && zoom.eventToNextFrameMs.length === ZOOM_FRAME_COUNT,
      compilerSettledWithoutNewFailure,
      finalPresentationPrecise:
        diagnosticsAfterTrace.zoomRenderMode === "precise"
        && diagnosticsAfterTrace.zoomFastPresentationMode === "precise",
      environmentStayedStable,
    };

    return {
      version: VECTOR_BASELINE_REPORT_VERSION,
      strategy: VECTOR_BASELINE_STRATEGY,
      profile,
      passed: Object.values(checks).every(Boolean),
      environment: {
        userAgent: navigator.userAgent,
        gpuLabel: engine.device.label,
        visibilityAtStart,
        visibilityAtEnd: environmentEnd.visibility,
        devicePixelRatioAtStart: environmentStart.devicePixelRatio,
        devicePixelRatioAtEnd: environmentEnd.devicePixelRatio,
        viewportWidthAtStart: environmentStart.viewportWidth,
        viewportHeightAtStart: environmentStart.viewportHeight,
        viewportWidthAtEnd: environmentEnd.viewportWidth,
        viewportHeightAtEnd: environmentEnd.viewportHeight,
        canvasWidthAtStart: environmentStart.canvasWidth,
        canvasHeightAtStart: environmentStart.canvasHeight,
        canvasWidthAtEnd: environmentEnd.canvasWidth,
        canvasHeightAtEnd: environmentEnd.canvasHeight,
        documentWidth: engine.documentWidth,
        documentHeight: engine.documentHeight,
      },
      fixture: {
        svgCount: svgNodes.length,
        textCount: textNodes.length,
        svgSourceRevisionCount: uniqueSvgDocuments.size,
        textGeometrySignatureCount: textGeometrySignatures.size,
        svgPaintCount: svgNodes.reduce(
          (total, node) => total + node.document.paints.length,
          0,
        ),
        svgCommandCount: svgNodes.reduce(
          (total, node) => total + node.document.commandCount,
          0,
        ),
        svgContourCount: svgNodes.reduce(
          (total, node) => total + node.document.contourCount,
          0,
        ),
        svgLogicalVectorMiB: svgLogicalVectorBytes / MEBIBYTE_BYTES,
        uniqueSvgLogicalVectorMiB: uniqueSvgLogicalVectorBytes / MEBIBYTE_BYTES,
        textCharacterCount: textNodes.reduce(
          (total, node) => total + node.text.length,
          0,
        ),
        sourceGenerationMs,
        svgParseMs,
        sceneMutationMs,
        firstStableSceneMs,
      },
      idle,
      fittedZoom,
      coldTargetZoom,
      cold,
      warm,
      pan,
      zoom,
      memory: {
        before: memoryBefore,
        afterSetup: memoryAfterSetup,
        afterTrace: memoryAfterTrace,
        deltaAfterSetup: subtractMemory(memoryAfterSetup, memoryBefore),
        deltaAfterTrace: subtractMemory(memoryAfterTrace, memoryBefore),
        peaks,
      },
      compiler: {
        before: compilerBefore,
        afterSetup: compilerAfterSetup,
        afterTrace: compilerAfterTrace,
        failedJobDelta: compilerAfterTrace.failedJobs - compilerBefore.failedJobs,
        peakPendingJobs: peaks.compilerPendingJobs,
        peakAtomicPendingNodes: peaks.atomicPendingNodes,
      },
      diagnostics: {
        before: diagnosticSnapshot(diagnosticsBefore),
        afterSetup: diagnosticSnapshot(diagnosticsAfterSetup),
        afterTrace: diagnosticSnapshot(diagnosticsAfterTrace),
      },
      checks,
    };
  } finally {
    if (!peaks) sampler.stop();
  }
}
