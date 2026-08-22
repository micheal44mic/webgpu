import type { BrushEngine } from "../../brush-engine";
import type { MixedSceneController } from "../../mixed-scene-controller";
import { VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL } from "../../vector-text-gpu-shader";
import {
  VECTOR_TEXT_ZOOM_AB_IDLE_FRAME_COUNT,
  VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT,
  VECTOR_TEXT_ZOOM_AB_START_ZOOM,
  VECTOR_TEXT_ZOOM_AB_STRATEGY,
  VECTOR_TEXT_ZOOM_C_FALLBACK_ZOOM,
  VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS,
  VECTOR_TEXT_ZOOM_C_IDLE_FRAME_COUNT,
  VECTOR_TEXT_ZOOM_C_SAMPLE_LIMIT,
  VECTOR_TEXT_ZOOM_C_START_ZOOM,
  VECTOR_TEXT_ZOOM_C_STRATEGY,
  VECTOR_TEXT_ZOOM_C_TARGET_ZOOM,
  VECTOR_TEXT_ZOOM_STRESS_PROFILE_ORDER,
  VECTOR_TEXT_ZOOM_STRESS_SLOW_FRAME_MS,
  VECTOR_TEXT_ZOOM_STRESS_STRATEGY,
  VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM,
  VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT,
  vectorTextZoomCoverageSeed,
  vectorTextZoomStressSeed,
  vectorTextZoomStressStepFactor,
} from "../../vector-text-adaptive-zoom";

export type VectorZoomLabKind = "stress" | "during" | "release" | "coverage";

export interface VectorZoomStressReport {
  version: 1;
  strategy: typeof VECTOR_TEXT_ZOOM_STRESS_STRATEGY;
  vectorTextRoiCacheEnabled: boolean;
  textCount: number;
  profileOrder: readonly string[];
  profileCounts: {
    arch: number;
    dropShadow: number;
    blockShadow: number;
    innerShadow: number;
  };
  targetZoom: number;
  finalZoom: number;
  zoomSteps: number;
  gestureDurationMs: number;
  recoveryDurationMs: number;
  exactRenderDeltaDuringRecovery: number;
  effectRefinementRenderDelta: number;
  slowFrameThresholdMs: number;
  rafIntervalsMs: number[];
  slowFrameCount: number;
  rafP95Ms: number;
  rafMaximumMs: number;
  exactRenderDeltaDuringSafeGesture: number;
  fastActivationDelta: number;
  safeReprojectionDelta: number;
  clippedReprojectionDelta: number;
  unsafeExactRefreshDelta: number;
  unsafeExactCoalescedDelta: number;
  fastPresentationSubmitDelta: number;
  fastPresentationCoalescedDelta: number;
  exactRecoveryDelta: number;
  latestViewRevision: number;
  checks: {
    exactlyTenTexts: boolean;
    allProfilesCovered: boolean;
    reachedZoom64: boolean;
    fastPathActivated: boolean;
    safeGestureStayedCovered: boolean;
    safeGestureExactRendersBounded: boolean;
    exactRecoveryLatestOnly: boolean;
    finalModePrecise: boolean;
  };
  passed: boolean;
}

export interface VectorZoomAbReport {
  version: 1;
  strategy: typeof VECTOR_TEXT_ZOOM_AB_STRATEGY;
  vectorTextRoiCacheEnabled: boolean;
  variant: "A" | "B";
  refreshMode: "during" | "release";
  refreshPolicy: "during-gesture" | "on-release";
  traceFingerprint: string;
  textCount: number;
  idleFrameCount: number;
  sampleCount: number;
  startZoom: number;
  finalZoom: number;
  environment: {
    userAgent: string;
    gpuLabel: string;
    visibilityAtStart: DocumentVisibilityState;
    visibilityAtEnd: DocumentVisibilityState;
    devicePixelRatioAtStart: number;
    devicePixelRatioAtEnd: number;
    viewportWidthAtStart: number;
    viewportHeightAtStart: number;
    viewportWidthAtEnd: number;
    viewportHeightAtEnd: number;
    canvasWidthAtStart: number;
    canvasHeightAtStart: number;
    canvasWidthAtEnd: number;
    canvasHeightAtEnd: number;
    canvasCssWidthAtStart: number;
    canvasCssHeightAtStart: number;
    canvasCssWidthAtEnd: number;
    canvasCssHeightAtEnd: number;
  };
  idleFrameIntervalsMs: number[];
  idleFrameMedianMs: number;
  gestureFrameIntervalsMs: number[];
  eventToNextFrameMs: number[];
  gestureDurationMs: number;
  frameP50Ms: number;
  frameP95Ms: number;
  frameMaximumMs: number;
  framesOver20Ms: number;
  framesOver33Ms: number;
  normalizedMissedFrameCount: number;
  eventToNextFrameP95Ms: number;
  queuePrefixAndCallbackWaitMs: number;
  recoveryDurationMs: number;
  totalMeasuredDurationMs: number;
  exactRenderDeltaDuringGesture: number;
  exactRenderDeltaDuringRecovery: number;
  safeReprojectionDelta: number;
  clippedReprojectionDelta: number;
  unsafeExactRefreshStartedDelta: number;
  unsafeExactRefreshCompletedDelta: number;
  unsafeExactCoalescedDelta: number;
  unsafeExactRefreshInFlightAtRelease: boolean;
  unsafeExactRefreshRequestPendingAtRelease: boolean;
  fastPresentationSubmitDelta: number;
  fastPresentationCoalescedDelta: number;
  exactRecoveryDelta: number;
  latestViewRevision: number;
  checks: {
    exactlyTenTexts: boolean;
    fixedTraceCompleted: boolean;
    startedAndStayedAtZoom64: boolean;
    everyGestureEventWasClipped: boolean;
    refreshBehaviorValidated: boolean;
    exactRecoveryLatestOnly: boolean;
    finalModePrecise: boolean;
    effectsStayedSettled: boolean;
    environmentStayedStable: boolean;
  };
  passed: boolean;
}

export interface VectorZoomCoverageReport {
  version: 1;
  strategy: typeof VECTOR_TEXT_ZOOM_C_STRATEGY;
  vectorTextRoiCacheEnabled: boolean;
  variant: "C";
  runCode: string;
  traceFingerprint: string;
  initialRasterWasEmpty: boolean;
  textCount: number;
  profileOrder: readonly string[];
  idleFrameCount: number;
  sampleCount: number;
  gestureTargetDurationMs: number;
  startZoom: number;
  targetZoom: number;
  finalZoom: number;
  fallbackCaptureZoom: number;
  fallbackTextureCount: number;
  fallbackRunCount: number;
  fallbackGpuMemoryMiB: number;
  fallbackFullViewportGpuMemoryMiB: number;
  fallbackProbeAlphaPixelCounts: number[];
  rasterLayerCountAfterFallbackRebuild: number;
  selectedRasterAfterFallbackRebuild: boolean;
  automaticFallbackRebuildDelta: number;
  fastCompositeProbeAlphaPixelCounts: number[];
  witnessesOutsideStartCount: number;
  witnessesInsideTargetCount: number;
  environment: {
    userAgent: string;
    gpuLabel: string;
    visibilityAtStart: DocumentVisibilityState;
    visibilityAtEnd: DocumentVisibilityState;
    devicePixelRatioAtStart: number;
    devicePixelRatioAtEnd: number;
    viewportWidthAtStart: number;
    viewportHeightAtStart: number;
    viewportWidthAtEnd: number;
    viewportHeightAtEnd: number;
    canvasWidthAtStart: number;
    canvasHeightAtStart: number;
    canvasWidthAtEnd: number;
    canvasHeightAtEnd: number;
  };
  idleFrameIntervalsMs: number[];
  idleFrameMedianMs: number;
  gestureFrameIntervalsMs: number[];
  eventToNextFrameMs: number[];
  presentationModes: string[];
  fastSubmittedRevisionLagSamples: number[];
  fastCompletedRevisionLagSamples: number[];
  gestureDurationMs: number;
  frameP50Ms: number;
  frameP95Ms: number;
  frameMaximumMs: number;
  framesOver20Ms: number;
  framesOver33Ms: number;
  normalizedMissedFrameCount: number;
  eventToNextFrameP95Ms: number;
  queuePrefixAndCallbackWaitMs: number;
  finalFastAckDurationMs: number;
  fastCompositeProbeDurationMs: number;
  fastVerificationDurationMs: number;
  fastVerificationError: string | null;
  recoveryDurationMs: number;
  totalMeasuredDurationMs: number;
  exactRenderDeltaDuringGesture: number;
  exactRenderDeltaDuringRecovery: number;
  safeReprojectionDelta: number;
  fallbackReprojectionDelta: number;
  clippedReprojectionDelta: number;
  unsafeExactRefreshStartedDelta: number;
  unsafeExactRefreshCompletedDelta: number;
  fastPresentationSubmitDelta: number;
  fastPresentationCoalescedDelta: number;
  requiredFastPresentationSubmitCount: number;
  fastPresentationRateHz: number;
  fastPresentationMaximumInFlight: number;
  fastPresentationInFlightAtTraceEnd: number;
  fastSubmittedRevisionLagMaximum: number;
  fastCompletedRevisionLagP95: number;
  fastCompletedRevisionLagMaximum: number;
  finalFastRequestedRevision: number;
  finalFastSubmittedRevision: number;
  finalFastCompletedRevision: number;
  exactRecoveryDelta: number;
  latestViewRevision: number;
  checks: {
    exactlyTenDistributedTexts: boolean;
    fixedFastZoomOutCompleted: boolean;
    fallbackPreparedBeforeGesture: boolean;
    fallbackPixelsPresent: boolean;
    rasterLifecycleRebuiltFallback: boolean;
    finalFastFrameAcknowledged: boolean;
    fastCompositePixelsPresent: boolean;
    witnessesExerciseReveal: boolean;
    everyZoomStepCovered: boolean;
    noClippedOrExactWorkDuringGesture: boolean;
    fastPresentationFlowed: boolean;
    framePacingWithinBudget: boolean;
    recoveryWithinBudget: boolean;
    exactRecoveryLatestOnly: boolean;
    finalModePrecise: boolean;
    effectsStayedSettled: boolean;
    environmentStayedStable: boolean;
  };
  passed: boolean;
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  ];
}

async function waitForVectorTextRenderAfter(
  controller: MixedSceneController,
  previousRenderCount: number,
): Promise<ReturnType<MixedSceneController["getDiagnostics"]>> {
  for (let frame = 0; frame < 24; frame += 1) {
    await nextFrame();
    const diagnostics = controller.getDiagnostics();
    if (diagnostics.renderCount > previousRenderCount) return diagnostics;
  }
  throw new Error("Il testo non ha completato il ridisegno dello zoom.");
}

async function waitForVectorTextStable(
  engine: BrushEngine,
  controller: MixedSceneController,
  minimumRecoveryCount = 0,
): Promise<ReturnType<MixedSceneController["getDiagnostics"]>> {
  let consecutiveStableFrames = 0;
  for (let frame = 0; frame < 360; frame += 1) {
    await nextFrame();
    const diagnostics = controller.getDiagnostics();
    const stable = diagnostics.zoomRenderMode === "precise"
      && diagnostics.zoomExactRecoveryCount >= minimumRecoveryCount
      && diagnostics.effectWorkerPendingJobs === 0
      && diagnostics.atomicEffectPendingNodes === 0;
    consecutiveStableFrames = stable ? consecutiveStableFrames + 1 : 0;
    if (consecutiveStableFrames >= 2) {
      await engine.waitForIdle();
      return controller.getDiagnostics();
    }
  }
  throw new Error("Renderer vettoriale non stabilizzato entro 360 frame.");
}

function makeVectorZoomRunCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const random = new Uint8Array(8);
  crypto.getRandomValues(random);
  return Array.from(random, (value) => alphabet[value % alphabet.length]).join("");
}

async function saveVectorZoomCoverageReport(
  report: VectorZoomCoverageReport,
): Promise<{ saved: boolean; message: string }> {
  const hashUrl = new URL(window.location.href);
  hashUrl.hash = `zoomRun=${report.runCode}`;
  history.replaceState(history.state, "", hashUrl);
  if (import.meta.env.DEV) {
    return { saved: false, message: "Modalità locale: report disponibile nella pagina Labs." };
  }

  const payload = {
    version: 1,
    kind: "vector-zoom-c",
    runCode: report.runCode,
    report,
  } as const;
  let lastError = "salvataggio non riuscito";
  for (const delayMs of [0, 450, 1200]) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch("/api/vector-zoom-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null) as {
          error?: string;
        } | null;
        throw new Error(errorPayload?.error ?? `HTTP ${response.status}`);
      }
      return {
        saved: true,
        message: `Report salvato nel progetto · codice ${report.runCode}`,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      window.clearTimeout(timeout);
    }
  }
  return {
    saved: false,
    message: `Report non salvato (${lastError}); il JSON resta disponibile nella pagina Labs.`,
  };
}

async function insertZoomFixtures(
  engine: BrushEngine,
  controller: MixedSceneController,
  canvas: HTMLCanvasElement,
  coverage: boolean,
): Promise<ReturnType<typeof vectorTextZoomCoverageSeed>[]> {
  const fixtures = Array.from({ length: VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT }, (_, index) => (
    coverage
      ? vectorTextZoomCoverageSeed(
          index,
          engine.documentWidth,
          engine.documentHeight,
          {
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            targetZoom: VECTOR_TEXT_ZOOM_C_TARGET_ZOOM,
          },
        )
      : vectorTextZoomStressSeed(index, engine.documentWidth, engine.documentHeight)
  ));
  const beforeInsert = controller.getDiagnostics();
  await engine.addVectorTextNodesBatch(fixtures.map((fixture, index) => ({
    seed: fixture.seed,
    name: `${coverage ? "C" : "Zoom"} ${fixture.profile} ${String(index + 1).padStart(2, "0")}`,
  })));
  await waitForVectorTextRenderAfter(controller, beforeInsert.renderCount);
  await waitForVectorTextStable(engine, controller);
  return fixtures;
}

async function runVectorZoomCoverage(
  engine: BrushEngine,
  controller: MixedSceneController,
  canvas: HTMLCanvasElement,
): Promise<{ report: VectorZoomCoverageReport; persistence: { saved: boolean; message: string } }> {
  const initialScene = engine.getMixedSceneSnapshot();
  const initialStats = engine.getStats();
  const initialRasterWasEmpty = initialStats.layerCount === 1
    && initialStats.layers.length === 1
    && initialStats.layers[0].hasContent === false;
  if (
    !initialScene
    || initialScene.items.some((item) => item.kind !== "raster")
    || !initialRasterWasEmpty
  ) {
    throw new Error("Il test C zoom richiede una pagina nuova con un solo raster vuoto.");
  }

  const fixtures = await insertZoomFixtures(engine, controller, canvas, true);
  let fallbackCaptureZoom = 0;
  let fallbackTextureCount = 0;
  let fallbackRunCount = 0;
  let fallbackGpuMemoryMiB = 0;
  let fallbackProbeAlphaPixelCounts: number[] = [];
  let rasterLayerCountAfterFallbackRebuild = 0;
  let selectedRasterAfterFallbackRebuild = false;
  let automaticFallbackRebuildDelta = 0;
  let fallbackCompleteAfterRaster = false;
  controller.setAdaptiveZoomEnabled(false);
  try {
    let beforeCameraRender = controller.getDiagnostics();
    engine.fitView();
    await waitForVectorTextRenderAfter(controller, beforeCameraRender.renderCount);
    await waitForVectorTextStable(engine, controller);

    const rectangle = canvas.getBoundingClientRect();
    const anchorX = rectangle.left + rectangle.width * 0.5;
    const anchorY = rectangle.top + rectangle.height * 0.5;
    beforeCameraRender = controller.getDiagnostics();
    engine.zoomBy(
      VECTOR_TEXT_ZOOM_C_START_ZOOM / engine.getVectorTextViewState().zoom,
      anchorX,
      anchorY,
    );
    await waitForVectorTextRenderAfter(controller, beforeCameraRender.renderCount);
    await waitForVectorTextStable(engine, controller);

    const beforeRasterLifecycle = controller.getDiagnostics();
    await engine.addLayer("C raster lifecycle");
    await waitForVectorTextRenderAfter(controller, beforeRasterLifecycle.renderCount);
    const afterRasterLifecycle = await waitForVectorTextStable(engine, controller);
    automaticFallbackRebuildDelta = afterRasterLifecycle.fallbackPresentationRebuildCount
      - beforeRasterLifecycle.fallbackPresentationRebuildCount;
    const fallback = engine.getVectorTextFallbackPresentationStats();
    fallbackCaptureZoom = fallback.captureView?.zoom ?? 0;
    fallbackTextureCount = fallback.textureCount;
    fallbackGpuMemoryMiB = fallback.gpuMemoryMiB;
    fallbackCompleteAfterRaster = fallback.complete;
    const postRasterScene = engine.getMixedSceneSnapshot();
    const selectedPostRasterItem = postRasterScene?.items.find(
      (item) => item.key === postRasterScene.selectedKey,
    );
    rasterLayerCountAfterFallbackRebuild = engine.getStats().layerCount;
    selectedRasterAfterFallbackRebuild = selectedPostRasterItem?.kind === "raster";
    await engine.waitForVectorTextPresentationCompletion();
    const probe = await engine.probeVectorTextFallbackAlpha(
      fixtures.map(({ seed }) => ({ x: seed.x, y: seed.y })),
    );
    fallbackRunCount = probe.runCount;
    fallbackProbeAlphaPixelCounts = probe.alphaPixelCounts;
  } finally {
    controller.setAdaptiveZoomEnabled(true);
  }
  await waitForVectorTextStable(engine, controller);

  const startRectangle = canvas.getBoundingClientRect();
  const environmentStart = {
    visibility: document.visibilityState,
    devicePixelRatio: window.devicePixelRatio,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  };
  const idleFrameIntervalsMs: number[] = [];
  let idlePreviousRaf = await nextFrame();
  for (let index = 0; index < VECTOR_TEXT_ZOOM_C_IDLE_FRAME_COUNT; index += 1) {
    const timestamp = await nextFrame();
    idleFrameIntervalsMs.push(Math.max(0, timestamp - idlePreviousRaf));
    idlePreviousRaf = timestamp;
  }
  const idleFrameMedianMs = percentile(idleFrameIntervalsMs, 0.5);

  const before = controller.getDiagnostics();
  const startView = engine.getVectorTextViewState();
  const startZoom = startView.zoom;
  const gestureFrameIntervalsMs: number[] = [];
  const eventToNextFrameMs: number[] = [];
  const presentationModes: string[] = [];
  const fastSubmittedRevisionLagSamples: number[] = [];
  const fastCompletedRevisionLagSamples: number[] = [];
  const rectangle = canvas.getBoundingClientRect();
  let previousRaf = await nextFrame();
  const gestureStartedAt = performance.now();
  controller.beginViewGesture();
  for (let index = 0; index < VECTOR_TEXT_ZOOM_C_SAMPLE_LIMIT; index += 1) {
    const progress = Math.min(
      1,
      (performance.now() - gestureStartedAt) / VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS,
    );
    const plannedZoom = VECTOR_TEXT_ZOOM_C_START_ZOOM * (
      VECTOR_TEXT_ZOOM_C_TARGET_ZOOM / VECTOR_TEXT_ZOOM_C_START_ZOOM
    ) ** progress;
    const anchorX = rectangle.left + rectangle.width * (
      0.68 + Math.sin(progress * Math.PI * 2) * 0.035
    );
    const anchorY = rectangle.top + rectangle.height * (
      0.44 + Math.cos(progress * Math.PI * 2) * 0.025
    );
    const eventStartedAt = performance.now();
    engine.zoomBy(
      plannedZoom / engine.getVectorTextViewState().zoom,
      anchorX,
      anchorY,
    );
    const timestamp = await nextFrame();
    gestureFrameIntervalsMs.push(Math.max(0, timestamp - previousRaf));
    eventToNextFrameMs.push(Math.max(0, performance.now() - eventStartedAt));
    presentationModes.push(controller.getDiagnostics().zoomFastPresentationMode);
    const fastRevisions = engine.getVectorTextFastPresentationBackpressureStats();
    fastSubmittedRevisionLagSamples.push(Math.max(
      0,
      fastRevisions.requestedRevision - fastRevisions.submittedRevision,
    ));
    fastCompletedRevisionLagSamples.push(Math.max(
      0,
      fastRevisions.requestedRevision - fastRevisions.completedRevision,
    ));
    previousRaf = timestamp;
    if (progress >= 1) break;
  }
  const duringTrace = controller.getDiagnostics();
  const duringFastBackpressure = engine.getVectorTextFastPresentationBackpressureStats();
  const gestureDurationMs = performance.now() - gestureStartedAt;
  const queuePrefixStartedAt = performance.now();
  const queuePrefixPromise = engine.waitForVectorTextPresentationCompletion()
    .then(() => performance.now() - queuePrefixStartedAt);
  const finalFastRequestedRevision = engine
    .getVectorTextFastPresentationBackpressureStats().requestedRevision;
  const fastVerificationStartedAt = performance.now();
  let fastVerificationError: string | null = null;
  let fastCompositeProbeAlphaPixelCounts: number[] = [];
  let finalFastAckDurationMs = 0;
  let fastCompositeProbeDurationMs = 0;
  try {
    const finalFastAckStartedAt = performance.now();
    await engine.waitForVectorTextFastPresentationRevision(finalFastRequestedRevision);
    finalFastAckDurationMs = performance.now() - finalFastAckStartedAt;
    const fastCompositeProbeStartedAt = performance.now();
    try {
      const fastCompositeProbe = await engine.probeVectorTextFastCompositeAlpha(
        fixtures.map(({ seed }) => ({ x: seed.x, y: seed.y })),
      );
      fastCompositeProbeAlphaPixelCounts = fastCompositeProbe.alphaPixelCounts;
    } finally {
      fastCompositeProbeDurationMs = performance.now() - fastCompositeProbeStartedAt;
    }
  } catch (error) {
    if (finalFastAckDurationMs === 0) {
      finalFastAckDurationMs = performance.now() - fastVerificationStartedAt;
    }
    fastVerificationError = error instanceof Error ? error.message : String(error);
  }
  const finalFastRevisions = engine.getVectorTextFastPresentationBackpressureStats();
  const fastVerificationDurationMs = performance.now() - fastVerificationStartedAt;
  const duringVerified = controller.getDiagnostics();
  const recoveryStartedAt = performance.now();
  controller.endViewGesture();
  const after = await waitForVectorTextStable(
    engine,
    controller,
    before.zoomExactRecoveryCount + 1,
  );
  const recoveryDurationMs = performance.now() - recoveryStartedAt;
  const queuePrefixAndCallbackWaitMs = await queuePrefixPromise;
  const totalMeasuredDurationMs = gestureDurationMs
    + finalFastAckDurationMs
    + recoveryDurationMs;
  const finalView = engine.getVectorTextViewState();
  const finalZoom = finalView.zoom;
  const environmentEnd = {
    visibility: document.visibilityState,
    devicePixelRatio: window.devicePixelRatio,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  };

  const exactRenderDeltaDuringGesture = duringVerified.renderCount - before.renderCount;
  const exactRenderDeltaDuringRecovery = after.renderCount - duringVerified.renderCount;
  const safeReprojectionDelta =
    duringVerified.zoomSafeReprojectionCount - before.zoomSafeReprojectionCount;
  const fallbackReprojectionDelta =
    duringVerified.zoomFallbackReprojectionCount - before.zoomFallbackReprojectionCount;
  const clippedReprojectionDelta =
    duringVerified.zoomClippedReprojectionCount - before.zoomClippedReprojectionCount;
  const unsafeExactRefreshStartedDelta =
    duringVerified.zoomUnsafeExactRefreshCount - before.zoomUnsafeExactRefreshCount;
  const unsafeExactRefreshCompletedDelta =
    duringVerified.zoomUnsafeExactRefreshCompletedCount
    - before.zoomUnsafeExactRefreshCompletedCount;
  const exactRecoveryDelta = after.zoomExactRecoveryCount - before.zoomExactRecoveryCount;
  const normalizedMissedFrameCount = idleFrameMedianMs > 0
    ? gestureFrameIntervalsMs.reduce(
        (count, duration) => count + Math.max(
          0,
          Math.round(duration / idleFrameMedianMs) - 1,
        ),
        0,
      )
    : 0;
  const profileOrder = fixtures.map((fixture) => fixture.profile);
  const sampleCount = gestureFrameIntervalsMs.length;
  const frameP95Ms = percentile(gestureFrameIntervalsMs, 0.95);
  const framesOver20Ms = gestureFrameIntervalsMs.filter((duration) => duration > 20).length;
  const framesOver33Ms = gestureFrameIntervalsMs.filter((duration) => duration > 33).length;
  const fastPresentationSubmitDelta =
    duringTrace.zoomFastPresentationSubmissionCount
    - before.zoomFastPresentationSubmissionCount;
  const fastPresentationCoalescedDelta =
    duringTrace.zoomFastPresentationCoalescedRequestCount
    - before.zoomFastPresentationCoalescedRequestCount;
  const requiredFastPresentationSubmitCount = Math.max(
    1,
    Math.ceil(Math.min(sampleCount, gestureDurationMs * 55 / 1000)),
  );
  const fastPresentationRateHz = gestureDurationMs > 0
    ? fastPresentationSubmitDelta * 1000 / gestureDurationMs
    : 0;
  const fastPresentationMaximumInFlight = duringFastBackpressure.maximumInFlightCount;
  const fastPresentationInFlightAtTraceEnd = duringFastBackpressure.inFlightCount;
  const fastSubmittedRevisionLagMaximum = Math.max(0, ...fastSubmittedRevisionLagSamples);
  const fastCompletedRevisionLagP95 = percentile(fastCompletedRevisionLagSamples, 0.95);
  const fastCompletedRevisionLagMaximum = Math.max(0, ...fastCompletedRevisionLagSamples);
  const witnessesOutsideStartCount = fixtures.filter(({ seed }) => (
    Math.abs(seed.x - startView.centerX) * startZoom > canvas.width * 0.5
    || Math.abs(seed.y - startView.centerY) * startZoom > canvas.height * 0.5
  )).length;
  const witnessesInsideTargetCount = fixtures.filter(({ seed }) => (
    Math.abs(seed.x - finalView.centerX) * VECTOR_TEXT_ZOOM_C_TARGET_ZOOM
      < canvas.width * 0.5
    && Math.abs(seed.y - finalView.centerY) * VECTOR_TEXT_ZOOM_C_TARGET_ZOOM
      < canvas.height * 0.5
  )).length;
  const fallbackFullViewportGpuMemoryMiB =
    canvas.width * canvas.height * VECTOR_TEXT_GPU_TARGET_BYTES_PER_PIXEL / (1024 * 1024);
  const fallbackMemoryMatchesCacheMode = engine.vectorTextRoiCacheEnabled
    ? fallbackGpuMemoryMiB > 0
      && fallbackGpuMemoryMiB < fallbackFullViewportGpuMemoryMiB
    : Math.abs(fallbackGpuMemoryMiB - fallbackFullViewportGpuMemoryMiB) < 1e-6;
  const emptyFallbackWitnessCount = fallbackProbeAlphaPixelCounts.filter(
    (count) => count === 0,
  ).length;
  const checks = {
    exactlyTenDistributedTexts:
      initialRasterWasEmpty
      && after.textNodeCount === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT
      && engine.getMixedSceneSnapshot()?.items.filter((item) => item.kind === "text").length
        === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT,
    fixedFastZoomOutCompleted:
      sampleCount >= 2
      && sampleCount <= VECTOR_TEXT_ZOOM_C_SAMPLE_LIMIT
      && gestureDurationMs >= VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS
      && Math.abs(startZoom - VECTOR_TEXT_ZOOM_C_START_ZOOM) < 1e-6
      && Math.abs(finalZoom - VECTOR_TEXT_ZOOM_C_TARGET_ZOOM) < 1e-6,
    fallbackPreparedBeforeGesture:
      fallbackTextureCount === 1
      && fallbackRunCount === fallbackTextureCount
      && fallbackMemoryMatchesCacheMode
      && Math.abs(fallbackCaptureZoom - VECTOR_TEXT_ZOOM_C_FALLBACK_ZOOM) < 1e-6,
    fallbackPixelsPresent:
      fallbackProbeAlphaPixelCounts.length === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT
      && emptyFallbackWitnessCount === 0,
    rasterLifecycleRebuiltFallback:
      rasterLayerCountAfterFallbackRebuild === 2
      && selectedRasterAfterFallbackRebuild
      && automaticFallbackRebuildDelta >= 1
      && fallbackCompleteAfterRaster
      && fallbackTextureCount === fallbackRunCount,
    finalFastFrameAcknowledged:
      finalFastRevisions.submittedRevision === finalFastRequestedRevision
      && finalFastRevisions.completedRevision === finalFastRequestedRevision,
    fastCompositePixelsPresent:
      fastCompositeProbeAlphaPixelCounts.length === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT
      && fastCompositeProbeAlphaPixelCounts.every((count) => count > 0),
    witnessesExerciseReveal:
      witnessesOutsideStartCount >= 8
      && witnessesInsideTargetCount === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT,
    everyZoomStepCovered:
      presentationModes.every(
        (mode) => mode === "reproject" || mode === "reproject-fallback",
      )
      && fallbackReprojectionDelta > 0
      && clippedReprojectionDelta === 0,
    noClippedOrExactWorkDuringGesture:
      clippedReprojectionDelta === 0
      && unsafeExactRefreshStartedDelta === 0
      && unsafeExactRefreshCompletedDelta === 0
      && exactRenderDeltaDuringGesture === 0
      && !duringVerified.zoomUnsafeExactRefreshInFlight
      && !duringVerified.zoomUnsafeExactRefreshRequestPending,
    fastPresentationFlowed:
      fastPresentationSubmitDelta >= requiredFastPresentationSubmitCount
      && fastPresentationCoalescedDelta <= Math.ceil(sampleCount * 0.1)
      && fastPresentationMaximumInFlight >= 1
      && fastPresentationMaximumInFlight <= 2
      && fastPresentationInFlightAtTraceEnd <= 2
      && fastSubmittedRevisionLagMaximum <= 2
      && fastCompletedRevisionLagP95 <= 2
      && fastCompletedRevisionLagMaximum <= 2,
    framePacingWithinBudget:
      frameP95Ms <= Math.max(20, idleFrameMedianMs * 1.5)
      && framesOver33Ms <= 1
      && normalizedMissedFrameCount <= 2,
    recoveryWithinBudget:
      finalFastAckDurationMs <= 250
      && queuePrefixAndCallbackWaitMs <= 250
      && recoveryDurationMs <= 1200
      && totalMeasuredDurationMs <= VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS + 1500,
    exactRecoveryLatestOnly:
      exactRecoveryDelta === 1
      && after.zoomViewRevision === duringVerified.zoomViewRevision,
    finalModePrecise:
      after.zoomRenderMode === "precise"
      && after.zoomFastPresentationMode === "precise",
    effectsStayedSettled:
      before.effectWorkerPendingJobs === 0
      && duringTrace.effectWorkerPendingJobs === 0
      && duringVerified.effectWorkerPendingJobs === 0
      && after.effectWorkerPendingJobs === 0
      && before.atomicEffectPendingNodes === 0
      && duringTrace.atomicEffectPendingNodes === 0
      && duringVerified.atomicEffectPendingNodes === 0
      && after.atomicEffectPendingNodes === 0,
    environmentStayedStable:
      environmentStart.visibility === "visible"
      && environmentEnd.visibility === "visible"
      && environmentEnd.devicePixelRatio === environmentStart.devicePixelRatio
      && environmentEnd.viewportWidth === environmentStart.viewportWidth
      && environmentEnd.viewportHeight === environmentStart.viewportHeight
      && environmentEnd.canvasWidth === environmentStart.canvasWidth
      && environmentEnd.canvasHeight === environmentStart.canvasHeight
      && Math.abs(canvas.getBoundingClientRect().width - startRectangle.width) < 0.5
      && Math.abs(canvas.getBoundingClientRect().height - startRectangle.height) < 0.5,
  };
  const report: VectorZoomCoverageReport = {
    version: 1,
    strategy: VECTOR_TEXT_ZOOM_C_STRATEGY,
    vectorTextRoiCacheEnabled: engine.vectorTextRoiCacheEnabled,
    variant: "C",
    runCode: makeVectorZoomRunCode(),
    initialRasterWasEmpty,
    traceFingerprint:
      `texts:${VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT}|zoom:${VECTOR_TEXT_ZOOM_C_START_ZOOM}`
      + `->${VECTOR_TEXT_ZOOM_C_TARGET_ZOOM}|duration:${VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS}`
      + "|fallback:auto-post-raster|window:2|anchor:drift|coverage:dual-gpu"
      + `|run-cache:${engine.vectorTextRoiCacheEnabled ? "roi" : "viewport"}`,
    textCount: after.textNodeCount,
    profileOrder,
    idleFrameCount: VECTOR_TEXT_ZOOM_C_IDLE_FRAME_COUNT,
    sampleCount,
    gestureTargetDurationMs: VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS,
    startZoom,
    targetZoom: VECTOR_TEXT_ZOOM_C_TARGET_ZOOM,
    finalZoom,
    fallbackCaptureZoom,
    fallbackTextureCount,
    fallbackRunCount,
    fallbackGpuMemoryMiB,
    fallbackFullViewportGpuMemoryMiB,
    fallbackProbeAlphaPixelCounts,
    rasterLayerCountAfterFallbackRebuild,
    selectedRasterAfterFallbackRebuild,
    automaticFallbackRebuildDelta,
    fastCompositeProbeAlphaPixelCounts,
    witnessesOutsideStartCount,
    witnessesInsideTargetCount,
    environment: {
      userAgent: navigator.userAgent,
      gpuLabel: engine.getBenchmarkEnvironment().gpuLabel,
      visibilityAtStart: environmentStart.visibility,
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
    },
    idleFrameIntervalsMs,
    idleFrameMedianMs,
    gestureFrameIntervalsMs,
    eventToNextFrameMs,
    presentationModes,
    fastSubmittedRevisionLagSamples,
    fastCompletedRevisionLagSamples,
    gestureDurationMs,
    frameP50Ms: percentile(gestureFrameIntervalsMs, 0.5),
    frameP95Ms,
    frameMaximumMs: Math.max(0, ...gestureFrameIntervalsMs),
    framesOver20Ms,
    framesOver33Ms,
    normalizedMissedFrameCount,
    eventToNextFrameP95Ms: percentile(eventToNextFrameMs, 0.95),
    queuePrefixAndCallbackWaitMs,
    finalFastAckDurationMs,
    fastCompositeProbeDurationMs,
    fastVerificationDurationMs,
    fastVerificationError,
    recoveryDurationMs,
    totalMeasuredDurationMs,
    exactRenderDeltaDuringGesture,
    exactRenderDeltaDuringRecovery,
    safeReprojectionDelta,
    fallbackReprojectionDelta,
    clippedReprojectionDelta,
    unsafeExactRefreshStartedDelta,
    unsafeExactRefreshCompletedDelta,
    fastPresentationSubmitDelta,
    fastPresentationCoalescedDelta,
    requiredFastPresentationSubmitCount,
    fastPresentationRateHz,
    fastPresentationMaximumInFlight,
    fastPresentationInFlightAtTraceEnd,
    fastSubmittedRevisionLagMaximum,
    fastCompletedRevisionLagP95,
    fastCompletedRevisionLagMaximum,
    finalFastRequestedRevision,
    finalFastSubmittedRevision: finalFastRevisions.submittedRevision,
    finalFastCompletedRevision: finalFastRevisions.completedRevision,
    exactRecoveryDelta,
    latestViewRevision: after.zoomViewRevision,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
  (window as Window & {
    __vectorZoomCoverageReport?: VectorZoomCoverageReport;
  }).__vectorZoomCoverageReport = report;
  const persistence = await saveVectorZoomCoverageReport(report);
  return { report, persistence };
}

async function runVectorZoomAb(
  engine: BrushEngine,
  controller: MixedSceneController,
  canvas: HTMLCanvasElement,
  refreshMode: "during" | "release",
): Promise<VectorZoomAbReport> {
  const initialScene = engine.getMixedSceneSnapshot();
  if (!initialScene || initialScene.items.some((item) => item.kind !== "raster")) {
    throw new Error("Il test A/B zoom richiede una pagina nuova con il solo raster iniziale.");
  }
  const variant = refreshMode === "during" ? "A" : "B";
  await insertZoomFixtures(engine, controller, canvas, false);

  controller.setAdaptiveZoomEnabled(false);
  try {
    let beforeCameraRender = controller.getDiagnostics();
    engine.fitView();
    await waitForVectorTextRenderAfter(controller, beforeCameraRender.renderCount);
    await waitForVectorTextStable(engine, controller);
    const rectangle = canvas.getBoundingClientRect();
    const anchorX = rectangle.left + rectangle.width * 0.5;
    const anchorY = rectangle.top + rectangle.height * 0.5;
    beforeCameraRender = controller.getDiagnostics();
    const currentZoom = engine.getVectorTextViewState().zoom;
    engine.zoomBy(VECTOR_TEXT_ZOOM_AB_START_ZOOM / currentZoom, anchorX, anchorY);
    await waitForVectorTextRenderAfter(controller, beforeCameraRender.renderCount);
    await waitForVectorTextStable(engine, controller);
  } finally {
    controller.setAdaptiveZoomEnabled(true);
  }
  await waitForVectorTextStable(engine, controller);

  const startRectangle = canvas.getBoundingClientRect();
  const environmentStart = {
    visibility: document.visibilityState,
    devicePixelRatio: window.devicePixelRatio,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    canvasCssWidth: startRectangle.width,
    canvasCssHeight: startRectangle.height,
  };
  const idleFrameIntervalsMs: number[] = [];
  let idlePreviousRaf = await nextFrame();
  for (let index = 0; index < VECTOR_TEXT_ZOOM_AB_IDLE_FRAME_COUNT; index += 1) {
    const timestamp = await nextFrame();
    idleFrameIntervalsMs.push(Math.max(0, timestamp - idlePreviousRaf));
    idlePreviousRaf = timestamp;
  }
  const idleFrameMedianMs = percentile(idleFrameIntervalsMs, 0.5);

  const before = controller.getDiagnostics();
  const startZoom = engine.getVectorTextViewState().zoom;
  const gestureFrameIntervalsMs: number[] = [];
  const eventToNextFrameMs: number[] = [];
  let previousRaf = await nextFrame();
  const gestureStartedAt = performance.now();
  controller.beginViewGesture();
  for (let index = 0; index < VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT; index += 1) {
    const eventStartedAt = performance.now();
    engine.panByClientDelta(1, 0);
    const timestamp = await nextFrame();
    gestureFrameIntervalsMs.push(Math.max(0, timestamp - previousRaf));
    eventToNextFrameMs.push(Math.max(0, performance.now() - eventStartedAt));
    previousRaf = timestamp;
  }
  const during = controller.getDiagnostics();
  const gestureDurationMs = performance.now() - gestureStartedAt;
  const queuePrefixStartedAt = performance.now();
  const queuePrefixPromise = engine.waitForVectorTextPresentationCompletion()
    .then(() => performance.now() - queuePrefixStartedAt);
  const recoveryStartedAt = performance.now();
  controller.endViewGesture();
  const after = await waitForVectorTextStable(
    engine,
    controller,
    before.zoomExactRecoveryCount + 1,
  );
  const recoveryDurationMs = performance.now() - recoveryStartedAt;
  const queuePrefixAndCallbackWaitMs = await queuePrefixPromise;
  const totalMeasuredDurationMs = performance.now() - gestureStartedAt;
  const finalZoom = engine.getVectorTextViewState().zoom;
  const endRectangle = canvas.getBoundingClientRect();
  const environmentEnd = {
    visibility: document.visibilityState,
    devicePixelRatio: window.devicePixelRatio,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    canvasCssWidth: endRectangle.width,
    canvasCssHeight: endRectangle.height,
  };

  const exactRenderDeltaDuringGesture = during.renderCount - before.renderCount;
  const exactRenderDeltaDuringRecovery = after.renderCount - during.renderCount;
  const safeReprojectionDelta = during.zoomSafeReprojectionCount - before.zoomSafeReprojectionCount;
  const clippedReprojectionDelta =
    during.zoomClippedReprojectionCount - before.zoomClippedReprojectionCount;
  const unsafeExactRefreshStartedDelta =
    during.zoomUnsafeExactRefreshCount - before.zoomUnsafeExactRefreshCount;
  const unsafeExactRefreshCompletedDelta =
    during.zoomUnsafeExactRefreshCompletedCount - before.zoomUnsafeExactRefreshCompletedCount;
  const unsafeExactCoalescedDelta =
    during.zoomUnsafeExactCoalescedCount - before.zoomUnsafeExactCoalescedCount;
  const exactRecoveryDelta = after.zoomExactRecoveryCount - before.zoomExactRecoveryCount;
  const normalizedMissedFrameCount = idleFrameMedianMs > 0
    ? gestureFrameIntervalsMs.reduce(
        (count, duration) => count + Math.max(
          0,
          Math.round(duration / idleFrameMedianMs) - 1,
        ),
        0,
      )
    : 0;
  const checks = {
    exactlyTenTexts:
      after.textNodeCount === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT
      && engine.getMixedSceneSnapshot()?.items.filter((item) => item.kind === "text").length
        === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT,
    fixedTraceCompleted:
      gestureFrameIntervalsMs.length === VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT
      && eventToNextFrameMs.length === VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT,
    startedAndStayedAtZoom64:
      Math.abs(startZoom - VECTOR_TEXT_ZOOM_AB_START_ZOOM) < 1e-6
      && Math.abs(finalZoom - VECTOR_TEXT_ZOOM_AB_START_ZOOM) < 1e-6,
    everyGestureEventWasClipped:
      clippedReprojectionDelta >= VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT
      && safeReprojectionDelta === 0,
    refreshBehaviorValidated: refreshMode === "during"
      ? unsafeExactRefreshStartedDelta > 0 && unsafeExactRefreshCompletedDelta > 0
      : unsafeExactRefreshStartedDelta === 0
        && unsafeExactRefreshCompletedDelta === 0
        && exactRenderDeltaDuringGesture === 0
        && !during.zoomUnsafeExactRefreshInFlight
        && !during.zoomUnsafeExactRefreshRequestPending,
    exactRecoveryLatestOnly:
      exactRecoveryDelta === 1
      && after.zoomViewRevision === during.zoomViewRevision,
    finalModePrecise:
      after.zoomRenderMode === "precise"
      && after.zoomFastPresentationMode === "precise",
    effectsStayedSettled:
      before.effectWorkerPendingJobs === 0
      && during.effectWorkerPendingJobs === 0
      && after.effectWorkerPendingJobs === 0
      && before.atomicEffectPendingNodes === 0
      && during.atomicEffectPendingNodes === 0
      && after.atomicEffectPendingNodes === 0,
    environmentStayedStable:
      environmentStart.visibility === "visible"
      && environmentEnd.visibility === "visible"
      && environmentEnd.devicePixelRatio === environmentStart.devicePixelRatio
      && environmentEnd.viewportWidth === environmentStart.viewportWidth
      && environmentEnd.viewportHeight === environmentStart.viewportHeight
      && environmentEnd.canvasWidth === environmentStart.canvasWidth
      && environmentEnd.canvasHeight === environmentStart.canvasHeight
      && Math.abs(environmentEnd.canvasCssWidth - environmentStart.canvasCssWidth) < 0.5
      && Math.abs(environmentEnd.canvasCssHeight - environmentStart.canvasCssHeight) < 0.5,
  };
  const report: VectorZoomAbReport = {
    version: 1,
    strategy: VECTOR_TEXT_ZOOM_AB_STRATEGY,
    vectorTextRoiCacheEnabled: engine.vectorTextRoiCacheEnabled,
    variant,
    refreshMode,
    refreshPolicy: during.zoomClippedRefreshPolicy,
    traceFingerprint:
      `texts:${VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT}|zoom:${VECTOR_TEXT_ZOOM_AB_START_ZOOM}`
      + `|pan-css-x:+1|frames:${VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT}`
      + `|run-cache:${engine.vectorTextRoiCacheEnabled ? "roi" : "viewport"}`,
    textCount: after.textNodeCount,
    idleFrameCount: VECTOR_TEXT_ZOOM_AB_IDLE_FRAME_COUNT,
    sampleCount: VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT,
    startZoom,
    finalZoom,
    environment: {
      userAgent: navigator.userAgent,
      gpuLabel: engine.getBenchmarkEnvironment().gpuLabel,
      visibilityAtStart: environmentStart.visibility,
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
      canvasCssWidthAtStart: environmentStart.canvasCssWidth,
      canvasCssHeightAtStart: environmentStart.canvasCssHeight,
      canvasCssWidthAtEnd: environmentEnd.canvasCssWidth,
      canvasCssHeightAtEnd: environmentEnd.canvasCssHeight,
    },
    idleFrameIntervalsMs,
    idleFrameMedianMs,
    gestureFrameIntervalsMs,
    eventToNextFrameMs,
    gestureDurationMs,
    frameP50Ms: percentile(gestureFrameIntervalsMs, 0.5),
    frameP95Ms: percentile(gestureFrameIntervalsMs, 0.95),
    frameMaximumMs: Math.max(0, ...gestureFrameIntervalsMs),
    framesOver20Ms: gestureFrameIntervalsMs.filter((duration) => duration > 20).length,
    framesOver33Ms: gestureFrameIntervalsMs.filter((duration) => duration > 33).length,
    normalizedMissedFrameCount,
    eventToNextFrameP95Ms: percentile(eventToNextFrameMs, 0.95),
    queuePrefixAndCallbackWaitMs,
    recoveryDurationMs,
    totalMeasuredDurationMs,
    exactRenderDeltaDuringGesture,
    exactRenderDeltaDuringRecovery,
    safeReprojectionDelta,
    clippedReprojectionDelta,
    unsafeExactRefreshStartedDelta,
    unsafeExactRefreshCompletedDelta,
    unsafeExactCoalescedDelta,
    unsafeExactRefreshInFlightAtRelease: during.zoomUnsafeExactRefreshInFlight,
    unsafeExactRefreshRequestPendingAtRelease: during.zoomUnsafeExactRefreshRequestPending,
    fastPresentationSubmitDelta:
      during.zoomFastPresentationSubmissionCount
      - before.zoomFastPresentationSubmissionCount,
    fastPresentationCoalescedDelta:
      during.zoomFastPresentationCoalescedRequestCount
      - before.zoomFastPresentationCoalescedRequestCount,
    exactRecoveryDelta,
    latestViewRevision: after.zoomViewRevision,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
  (window as Window & { __vectorZoomAbReport?: VectorZoomAbReport }).__vectorZoomAbReport = report;
  return report;
}

async function runVectorZoomStress(
  engine: BrushEngine,
  controller: MixedSceneController,
  canvas: HTMLCanvasElement,
): Promise<VectorZoomStressReport> {
  const initialScene = engine.getMixedSceneSnapshot();
  if (!initialScene || initialScene.items.some((item) => item.kind !== "raster")) {
    throw new Error("Lo stress zoom richiede una pagina nuova con il solo raster iniziale.");
  }
  await insertZoomFixtures(engine, controller, canvas, false);

  controller.setAdaptiveZoomEnabled(false);
  const beforeFit = controller.getDiagnostics();
  engine.fitView();
  await waitForVectorTextRenderAfter(controller, beforeFit.renderCount);
  await waitForVectorTextStable(engine, controller);
  controller.setAdaptiveZoomEnabled(true);

  const before = controller.getDiagnostics();
  const rectangle = canvas.getBoundingClientRect();
  const anchorX = rectangle.left + rectangle.width * 0.5;
  const anchorY = rectangle.top + rectangle.height * 0.5;
  const rafIntervalsMs: number[] = [];
  let previousRaf = await nextFrame();
  let zoomSteps = 0;
  const gestureStartedAt = performance.now();
  controller.beginViewGesture();
  while (
    engine.getVectorTextViewState().zoom < VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM - 1e-9
    && zoomSteps < 64
  ) {
    const currentZoom = engine.getVectorTextViewState().zoom;
    engine.zoomBy(vectorTextZoomStressStepFactor(currentZoom), anchorX, anchorY);
    const timestamp = await nextFrame();
    rafIntervalsMs.push(Math.max(0, timestamp - previousRaf));
    previousRaf = timestamp;
    zoomSteps += 1;
  }
  const during = controller.getDiagnostics();
  const gestureDurationMs = performance.now() - gestureStartedAt;
  const recoveryStartedAt = performance.now();
  controller.endViewGesture();
  const after = await waitForVectorTextStable(
    engine,
    controller,
    before.zoomExactRecoveryCount + 1,
  );
  const recoveryDurationMs = performance.now() - recoveryStartedAt;
  const finalZoom = engine.getVectorTextViewState().zoom;
  const exactRenderDeltaDuringSafeGesture = during.renderCount - before.renderCount;
  const exactRenderDeltaDuringRecovery = after.renderCount - during.renderCount;
  const effectRefinementRenderDelta = Math.max(0, exactRenderDeltaDuringRecovery - 1);
  const finalScene = engine.getMixedSceneSnapshot();
  const stressNodes = finalScene?.items.flatMap(
    (item) => item.kind === "text" ? [item.textNode] : [],
  ) ?? [];
  const profileCounts = {
    arch: stressNodes.filter((node) => node.transformType === "arch").length,
    dropShadow: stressNodes.filter((node) => node.singleShadowEnabled).length,
    blockShadow: stressNodes.filter((node) => node.blockShadowEnabled).length,
    innerShadow: stressNodes.filter((node) => node.innerShadowEnabled).length,
  };
  const checks = {
    exactlyTenTexts:
      after.textNodeCount === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT
      && stressNodes.length === VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT,
    allProfilesCovered:
      profileCounts.arch === 3
      && profileCounts.dropShadow === 3
      && profileCounts.blockShadow === 2
      && profileCounts.innerShadow === 2,
    reachedZoom64: Math.abs(finalZoom - VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM) < 1e-6,
    fastPathActivated: during.zoomFastActivationCount > before.zoomFastActivationCount,
    safeGestureStayedCovered:
      during.zoomSafeReprojectionCount - before.zoomSafeReprojectionCount >= zoomSteps
      && during.zoomClippedReprojectionCount === before.zoomClippedReprojectionCount,
    safeGestureExactRendersBounded: exactRenderDeltaDuringSafeGesture <= 1,
    exactRecoveryLatestOnly:
      after.zoomExactRecoveryCount - before.zoomExactRecoveryCount === 1
      && after.zoomViewRevision === during.zoomViewRevision,
    finalModePrecise:
      after.zoomRenderMode === "precise"
      && after.zoomFastPresentationMode === "precise",
  };
  const report: VectorZoomStressReport = {
    version: 1,
    strategy: VECTOR_TEXT_ZOOM_STRESS_STRATEGY,
    vectorTextRoiCacheEnabled: engine.vectorTextRoiCacheEnabled,
    textCount: after.textNodeCount,
    profileOrder: [...VECTOR_TEXT_ZOOM_STRESS_PROFILE_ORDER],
    profileCounts,
    targetZoom: VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM,
    finalZoom,
    zoomSteps,
    gestureDurationMs,
    recoveryDurationMs,
    exactRenderDeltaDuringRecovery,
    effectRefinementRenderDelta,
    slowFrameThresholdMs: VECTOR_TEXT_ZOOM_STRESS_SLOW_FRAME_MS,
    rafIntervalsMs,
    slowFrameCount: rafIntervalsMs.filter(
      (duration) => duration > VECTOR_TEXT_ZOOM_STRESS_SLOW_FRAME_MS,
    ).length,
    rafP95Ms: percentile(rafIntervalsMs, 0.95),
    rafMaximumMs: Math.max(0, ...rafIntervalsMs),
    exactRenderDeltaDuringSafeGesture,
    fastActivationDelta: during.zoomFastActivationCount - before.zoomFastActivationCount,
    safeReprojectionDelta:
      during.zoomSafeReprojectionCount - before.zoomSafeReprojectionCount,
    clippedReprojectionDelta:
      during.zoomClippedReprojectionCount - before.zoomClippedReprojectionCount,
    unsafeExactRefreshDelta:
      during.zoomUnsafeExactRefreshCount - before.zoomUnsafeExactRefreshCount,
    unsafeExactCoalescedDelta:
      during.zoomUnsafeExactCoalescedCount - before.zoomUnsafeExactCoalescedCount,
    fastPresentationSubmitDelta:
      during.zoomFastPresentationSubmissionCount
      - before.zoomFastPresentationSubmissionCount,
    fastPresentationCoalescedDelta:
      during.zoomFastPresentationCoalescedRequestCount
      - before.zoomFastPresentationCoalescedRequestCount,
    exactRecoveryDelta: after.zoomExactRecoveryCount - before.zoomExactRecoveryCount,
    latestViewRevision: after.zoomViewRevision,
    checks,
    passed: Object.values(checks).every(Boolean),
  };
  (window as Window & {
    __vectorZoomStressReport?: VectorZoomStressReport;
  }).__vectorZoomStressReport = report;
  return report;
}

export async function runVectorZoomLab(
  engine: BrushEngine,
  controller: MixedSceneController,
  canvas: HTMLCanvasElement,
  kind: VectorZoomLabKind,
): Promise<unknown> {
  const expectedPolicy = kind === "release" ? "on-release" : "during-gesture";
  if (controller.getDiagnostics().zoomClippedRefreshPolicy !== expectedPolicy) {
    throw new Error(
      `Il laboratorio ${kind} richiede policy ${expectedPolicy}; ricarica la pagina Labs.`,
    );
  }
  switch (kind) {
    case "coverage":
      return runVectorZoomCoverage(engine, controller, canvas);
    case "during":
    case "release":
      return runVectorZoomAb(engine, controller, canvas, kind);
    case "stress":
      return runVectorZoomStress(engine, controller, canvas);
  }
}
