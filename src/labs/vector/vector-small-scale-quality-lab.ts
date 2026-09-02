import type { BrushEngine } from "../../brush-engine";
import type { MixedSceneController } from "../../mixed-scene-controller";
import type { MixedSceneDiagnostics } from "../../mixed-scene-controller-contract";
import { parseVectorSvg } from "../../vector-svg-import";
import complexCurvedStrokesSvg from "../../vector-stress/fixtures/complex-curved-strokes.svg?raw";

const VECTOR_SMALL_SCALE_QUALITY_STRATEGY =
  "vector-small-scale-precise-raster-quality-ab-v1" as const;
const TEST_SCALES = [1, 0.25, 0.125, 0.0625] as const;
const STABLE_FRAME_LIMIT = 720;
const STABLE_FRAME_COUNT = 3;
const WARM_REDRAW_COUNT = 3;
const FIXTURE_NAME = "complex-curved-strokes.svg";

type VectorRasterQualityMode = "baseline" | "coverage";

type QualityHookEngine = BrushEngine & {
  readonly vectorRasterQualityMode?: VectorRasterQualityMode;
  setVectorRasterQualityMode?: (
    mode: VectorRasterQualityMode,
  ) => void | Promise<void>;
};

interface PixelCapture {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

interface StrokeContinuityMetrics {
  readonly sampledRowCount: number;
  readonly coveredRowCount: number;
  readonly continuityRatio: number;
  readonly longestMissingRun: number;
  readonly meanEncodedLumaContrast: number;
  readonly maximumEncodedLumaContrast: number;
  readonly intermediateContrastLevelCount: number;
}

interface PixelQualityMetrics {
  readonly nonWhitePixelCount: number;
  readonly darkDetailPixelCount: number;
  readonly intermediateEncodedLumaLevelCount: number;
  readonly minimumEncodedLuma: number;
  readonly meanLinearLuminance: number;
  readonly centerStroke: StrokeContinuityMetrics;
}

interface ScaleCapture {
  readonly scale: (typeof TEST_SCALES)[number];
  readonly effectiveScale: number;
  readonly label: string;
  readonly capture: PixelCapture;
  readonly quality: PixelQualityMetrics;
  readonly updateToStableMs: number;
  readonly rendererMs: number;
  readonly warmRendererMs: readonly number[];
  readonly rasterBounds: null | {
    readonly width: number;
    readonly height: number;
  };
}

interface ModeCapture {
  readonly mode: VectorRasterQualityMode;
  readonly samples: readonly ScaleCapture[];
  readonly rendererMedianMs: number;
  readonly rendererP95Ms: number;
}

export interface VectorSmallScaleQualityReport {
  readonly version: 1;
  readonly strategy: typeof VECTOR_SMALL_SCALE_QUALITY_STRATEGY;
  readonly passed: boolean;
  readonly candidateAvailable: boolean;
  readonly environment: {
    readonly userAgent: string;
    readonly gpuLabel: string;
    readonly canvasFormat: string;
    readonly documentStorageColorSpace: string;
    readonly devicePixelRatio: number;
    readonly canvasWidth: number;
    readonly canvasHeight: number;
  };
  readonly fixture: {
    readonly name: typeof FIXTURE_NAME;
    readonly sourceRevision: string;
    readonly width: number;
    readonly height: number;
    readonly baseScale: number;
    readonly retainedStrokeCount: number;
    readonly scales: typeof TEST_SCALES;
  };
  readonly modes: readonly {
    readonly mode: VectorRasterQualityMode;
    readonly rendererMedianMs: number;
    readonly rendererP95Ms: number;
    readonly samples: readonly {
      readonly scale: number;
      readonly effectiveScale: number;
      readonly label: string;
      readonly width: number;
      readonly height: number;
      readonly quality: PixelQualityMetrics;
      readonly updateToStableMs: number;
      readonly rendererMs: number;
      readonly warmRendererMs: readonly number[];
      readonly rasterBounds: null | {
        readonly width: number;
        readonly height: number;
      };
    }[];
  }[];
  readonly comparison: null | {
    readonly rendererMedianDeltaMs: number;
    readonly rendererMedianDeltaPercent: number;
    readonly byScale: readonly {
      readonly scale: number;
      readonly continuityDelta: number;
      readonly missingRunDelta: number;
      readonly intermediateContrastLevelDelta: number;
      readonly meanStrokeContrastDelta: number;
      readonly changedPixelCount: number;
      readonly meanAbsoluteChannelDelta: number;
    }[];
  };
  readonly checks: {
    readonly freshSceneAccepted: boolean;
    readonly exactOneToOneView: boolean;
    readonly fixtureHasRetainedStrokes: boolean;
    readonly allRequestedScalesCaptured: boolean;
    readonly finalPresentationPrecise: boolean;
    readonly candidateProducesDifferentPixels: boolean;
    readonly smallestScaleContinuityImproved: boolean;
  };
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => window.requestAnimationFrame(resolve));
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
): Promise<MixedSceneDiagnostics> {
  let stableFrames = 0;
  for (let frame = 0; frame < STABLE_FRAME_LIMIT; frame += 1) {
    await nextFrame();
    const diagnostics = controller.getDiagnostics();
    stableFrames = diagnostics.renderCount >= minimumRenderCount && stable(diagnostics)
      ? stableFrames + 1
      : 0;
    if (stableFrames < STABLE_FRAME_COUNT) continue;
    await engine.waitForIdle();
    await engine.waitForVectorTextPresentationCompletion();
    const settled = controller.getDiagnostics();
    if (settled.renderCount >= minimumRenderCount && stable(settled)) return settled;
    stableFrames = 0;
  }
  throw new Error("The small-scale vector scene did not settle within 720 frames.");
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
}

function srgbChannelToLinear(value: number): number {
  const normalized = Math.min(1, Math.max(0, value));
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function encodedLuma(rgba: Uint8Array, pixelIndex: number): number {
  const offset = pixelIndex * 4;
  return (
    rgba[offset] * 0.2126
    + rgba[offset + 1] * 0.7152
    + rgba[offset + 2] * 0.0722
  ) / 255;
}

function linearLuma(rgba: Uint8Array, pixelIndex: number): number {
  const offset = pixelIndex * 4;
  return srgbChannelToLinear(rgba[offset] / 255) * 0.2126
    + srgbChannelToLinear(rgba[offset + 1] / 255) * 0.7152
    + srgbChannelToLinear(rgba[offset + 2] / 255) * 0.0722;
}

function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

function centerStrokeMetrics(
  capture: PixelCapture,
  scale: number,
): StrokeContinuityMetrics {
  // The fixture contains a retained vertical center stroke across roughly the
  // upper three quarters of its bounds. Neighbouring texels provide the local
  // fill luminance, so this probe remains independent of the storage profile.
  const centerX = (capture.width - 1) * 0.5;
  const startY = Math.floor(capture.height * 0.08);
  const endY = Math.max(startY, Math.ceil(capture.height * 0.72));
  const centerRadius = Math.max(1, Math.ceil(scale * 1.25));
  const neighbourStart = Math.max(centerRadius + 2, Math.ceil(scale * 5));
  const neighbourEnd = neighbourStart + Math.max(2, Math.ceil(scale * 3));
  const contrasts: number[] = [];
  let coveredRowCount = 0;
  let longestMissingRun = 0;
  let currentMissingRun = 0;
  const intermediateLevels = new Set<number>();

  for (let y = startY; y < endY; y += 1) {
    const centerSamples: number[] = [];
    const neighbourSamples: number[] = [];
    for (let delta = -centerRadius; delta <= centerRadius; delta += 1) {
      const x = Math.min(capture.width - 1, Math.max(0, Math.round(centerX + delta)));
      centerSamples.push(encodedLuma(capture.rgba, y * capture.width + x));
    }
    for (let distance = neighbourStart; distance <= neighbourEnd; distance += 1) {
      for (const direction of [-1, 1] as const) {
        const x = Math.min(
          capture.width - 1,
          Math.max(0, Math.round(centerX + direction * distance)),
        );
        neighbourSamples.push(encodedLuma(capture.rgba, y * capture.width + x));
      }
    }
    const contrast = Math.max(0, median(neighbourSamples) - Math.min(...centerSamples));
    contrasts.push(contrast);
    if (contrast >= 1 / 255) {
      coveredRowCount += 1;
      currentMissingRun = 0;
      if (contrast < 1 - 1 / 255) intermediateLevels.add(Math.round(contrast * 255));
    } else {
      currentMissingRun += 1;
      longestMissingRun = Math.max(longestMissingRun, currentMissingRun);
    }
  }

  const sampledRowCount = contrasts.length;
  return {
    sampledRowCount,
    coveredRowCount,
    continuityRatio: sampledRowCount > 0 ? coveredRowCount / sampledRowCount : 0,
    longestMissingRun,
    meanEncodedLumaContrast: sampledRowCount > 0
      ? contrasts.reduce((total, value) => total + value, 0) / sampledRowCount
      : 0,
    maximumEncodedLumaContrast: contrasts.length > 0 ? Math.max(...contrasts) : 0,
    intermediateContrastLevelCount: intermediateLevels.size,
  };
}

function pixelQuality(capture: PixelCapture, scale: number): PixelQualityMetrics {
  let nonWhitePixelCount = 0;
  let darkDetailPixelCount = 0;
  let minimumEncodedLuma = 1;
  let linearLuminanceTotal = 0;
  const intermediateLevels = new Set<number>();
  const pixelCount = capture.width * capture.height;
  for (let index = 0; index < pixelCount; index += 1) {
    const luma = encodedLuma(capture.rgba, index);
    const linear = linearLuma(capture.rgba, index);
    linearLuminanceTotal += linear;
    minimumEncodedLuma = Math.min(minimumEncodedLuma, luma);
    if (luma < 250 / 255) nonWhitePixelCount += 1;
    if (luma < 0.65) darkDetailPixelCount += 1;
    if (luma > 1 / 255 && luma < 254 / 255) {
      intermediateLevels.add(Math.round(luma * 255));
    }
  }
  return {
    nonWhitePixelCount,
    darkDetailPixelCount,
    intermediateEncodedLumaLevelCount: intermediateLevels.size,
    minimumEncodedLuma,
    meanLinearLuminance: pixelCount > 0 ? linearLuminanceTotal / pixelCount : 1,
    centerStroke: centerStrokeMetrics(capture, scale),
  };
}

function captureRect(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  scale: number,
): { x: number; y: number; width: number; height: number } {
  const padding = 8;
  const scaledWidth = Math.max(1, Math.ceil(width * scale));
  const scaledHeight = Math.max(1, Math.ceil(height * scale));
  return {
    x: Math.floor(centerX - scaledWidth * 0.5 - padding),
    y: Math.floor(centerY - scaledHeight * 0.5 - padding),
    width: scaledWidth + padding * 2,
    height: scaledHeight + padding * 2,
  };
}

async function warmRedraws(
  engine: BrushEngine,
  controller: MixedSceneController,
): Promise<number[]> {
  const rendererTimes: number[] = [];
  for (let index = 0; index < WARM_REDRAW_COUNT; index += 1) {
    const before = controller.getDiagnostics();
    engine.panByClientDelta(0, 0);
    const after = await waitForStableScene(engine, controller, before.renderCount + 1);
    rendererTimes.push(after.lastRenderMs);
  }
  return rendererTimes;
}

async function applyQualityMode(
  engine: QualityHookEngine,
  controller: MixedSceneController,
  mode: VectorRasterQualityMode,
): Promise<void> {
  if (engine.setVectorRasterQualityMode) {
    await engine.setVectorRasterQualityMode(mode);
  } else if (mode === "coverage") {
    throw new Error("The coverage quality candidate is not available in this build.");
  }
  await controller.prepareCurrentScenePresentation();
}

async function runMode(
  engine: BrushEngine,
  controller: MixedSceneController,
  nodeId: number,
  centerX: number,
  centerY: number,
  fixtureWidth: number,
  fixtureHeight: number,
  baseScale: number,
  mode: VectorRasterQualityMode,
): Promise<ModeCapture> {
  await applyQualityMode(engine as QualityHookEngine, controller, mode);
  const samples: ScaleCapture[] = [];
  for (const scale of TEST_SCALES) {
    const effectiveScale = baseScale * scale;
    const before = controller.getDiagnostics();
    const startedAt = performance.now();
    engine.updateVectorSvgNode(nodeId, {
      scale: effectiveScale,
      scaleX: effectiveScale,
      scaleY: effectiveScale,
    });
    const settled = await waitForStableScene(engine, controller, before.renderCount + 1);
    const updateToStableMs = performance.now() - startedAt;
    const rasterBounds = [...engine.vectorTextRunTextures.values()].find(
      (resources) => resources.initialized && resources.lastBounds !== null,
    )?.lastBounds ?? null;
    const rect = captureRect(
      centerX,
      centerY,
      fixtureWidth,
      fixtureHeight,
      effectiveScale,
    );
    const rgba = await engine.readPresentationLayerRect(rect);
    const capture = { width: rect.width, height: rect.height, rgba };
    samples.push({
      scale,
      effectiveScale,
      label: `${scale * 100}%`,
      capture,
      quality: pixelQuality(capture, effectiveScale),
      updateToStableMs,
      rendererMs: settled.lastRenderMs,
      warmRendererMs: await warmRedraws(engine, controller),
      rasterBounds: rasterBounds
        ? { width: rasterBounds.width, height: rasterBounds.height }
        : null,
    });
  }
  const rendererTimes = samples.flatMap((sample) => sample.warmRendererMs);
  return {
    mode,
    samples,
    rendererMedianMs: percentile(rendererTimes, 0.5),
    rendererP95Ms: percentile(rendererTimes, 0.95),
  };
}

function modeLabel(mode: VectorRasterQualityMode): string {
  return mode === "baseline" ? "Baseline" : "Copertura migliorata";
}

function captureCanvas(capture: PixelCapture, label: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = capture.width;
  canvas.height = capture.height;
  canvas.setAttribute("aria-label", label);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The quality comparison canvas is unavailable.");
  context.putImageData(
    new ImageData(new Uint8ClampedArray(capture.rgba), capture.width, capture.height),
    0,
    0,
  );
  return canvas;
}

function renderVisualComparison(
  modes: readonly ModeCapture[],
  candidateAvailable: boolean,
): void {
  document.querySelector("[data-vector-small-scale-comparison]")?.remove();
  const panel = document.createElement("section");
  panel.className = "vector-small-scale-comparison";
  panel.dataset.vectorSmallScaleComparison = "";
  panel.setAttribute("aria-label", "Confronto qualità vettori piccoli");
  const header = document.createElement("header");
  const heading = document.createElement("h2");
  heading.textContent = "Qualità vettori piccoli · confronto 1:1";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Chiudi confronto";
  close.addEventListener("click", () => panel.remove());
  header.append(heading, close);
  panel.append(header);

  const note = document.createElement("p");
  note.textContent = candidateAvailable
    ? "Ogni canvas è mostrato a un pixel CSS per pixel acquisito."
    : "Baseline acquisita. La colonna candidata apparirà quando il relativo hook GPU sarà disponibile.";
  panel.append(note);

  const grid = document.createElement("div");
  grid.className = "vector-small-scale-comparison-grid";
  for (const mode of modes) {
    const column = document.createElement("section");
    const title = document.createElement("h3");
    title.textContent = `${modeLabel(mode.mode)} · mediana ${mode.rendererMedianMs.toFixed(2)} ms`;
    column.append(title);
    for (const sample of mode.samples) {
      const figure = document.createElement("figure");
      const caption = document.createElement("figcaption");
      caption.textContent = `${sample.label} · continuità ${(sample.quality.centerStroke.continuityRatio * 100).toFixed(1)}% · vuoto max ${sample.quality.centerStroke.longestMissingRun}px`;
      figure.append(caption, captureCanvas(sample.capture, `${modeLabel(mode.mode)} ${sample.label}`));
      column.append(figure);
    }
    grid.append(column);
  }
  panel.append(grid);
  document.body.append(panel);
}

function reportMode(mode: ModeCapture): VectorSmallScaleQualityReport["modes"][number] {
  return {
    mode: mode.mode,
    rendererMedianMs: mode.rendererMedianMs,
    rendererP95Ms: mode.rendererP95Ms,
    samples: mode.samples.map((sample) => ({
      scale: sample.scale,
      effectiveScale: sample.effectiveScale,
      label: sample.label,
      width: sample.capture.width,
      height: sample.capture.height,
      quality: sample.quality,
      updateToStableMs: sample.updateToStableMs,
      rendererMs: sample.rendererMs,
      warmRendererMs: sample.warmRendererMs,
      rasterBounds: sample.rasterBounds,
    })),
  };
}

function comparison(
  baseline: ModeCapture,
  coverage: ModeCapture | undefined,
): VectorSmallScaleQualityReport["comparison"] {
  if (!coverage) return null;
  return {
    rendererMedianDeltaMs: coverage.rendererMedianMs - baseline.rendererMedianMs,
    rendererMedianDeltaPercent: baseline.rendererMedianMs > 0
      ? (coverage.rendererMedianMs / baseline.rendererMedianMs - 1) * 100
      : 0,
    byScale: baseline.samples.map((sample, index) => {
      const candidate = coverage.samples[index];
      const comparedPixelCount = Math.min(
        sample.capture.width * sample.capture.height,
        candidate.capture.width * candidate.capture.height,
      );
      let changedPixelCount = 0;
      let absoluteChannelDelta = 0;
      for (let pixelIndex = 0; pixelIndex < comparedPixelCount; pixelIndex += 1) {
        let pixelChanged = false;
        for (let channel = 0; channel < 3; channel += 1) {
          const offset = pixelIndex * 4 + channel;
          const delta = Math.abs(
            candidate.capture.rgba[offset] - sample.capture.rgba[offset],
          );
          absoluteChannelDelta += delta;
          pixelChanged ||= delta > 0;
        }
        if (pixelChanged) changedPixelCount += 1;
      }
      return {
        scale: sample.scale,
        continuityDelta:
          candidate.quality.centerStroke.continuityRatio
          - sample.quality.centerStroke.continuityRatio,
        missingRunDelta:
          candidate.quality.centerStroke.longestMissingRun
          - sample.quality.centerStroke.longestMissingRun,
        intermediateContrastLevelDelta:
          candidate.quality.centerStroke.intermediateContrastLevelCount
          - sample.quality.centerStroke.intermediateContrastLevelCount,
        meanStrokeContrastDelta:
          candidate.quality.centerStroke.meanEncodedLumaContrast
          - sample.quality.centerStroke.meanEncodedLumaContrast,
        changedPixelCount,
        meanAbsoluteChannelDelta: comparedPixelCount > 0
          ? absoluteChannelDelta / (comparedPixelCount * 3)
          : 0,
      };
    }),
  };
}

export async function runVectorSmallScaleQualityLab(
  engine: BrushEngine,
  controller: MixedSceneController,
  canvas: HTMLCanvasElement,
): Promise<VectorSmallScaleQualityReport> {
  const snapshot = engine.getMixedSceneSnapshot();
  const freshSceneAccepted = Boolean(snapshot)
    && !snapshot!.items.some((item) => item.kind !== "raster");
  if (!freshSceneAccepted) {
    throw new Error("Run the small-scale vector quality lab on a fresh Labs page.");
  }

  const initialView = engine.getVectorTextViewState();
  if (Math.abs(initialView.rotationRadians) > 1e-7) {
    throw new Error("The small-scale vector quality lab requires zero view rotation.");
  }
  const qualityEngine = engine as QualityHookEngine;
  const initialQualityMode = qualityEngine.vectorRasterQualityMode ?? "baseline";
  const initialAdaptiveZoomEnabled = controller.getDiagnostics().adaptiveZoomEnabled;
  let completed = false;
  controller.setAdaptiveZoomEnabled(false);
  try {
    if (Math.abs(initialView.zoom - 1) > 1e-7) {
      const before = controller.getDiagnostics();
      engine.zoomBy(1 / initialView.zoom);
      await waitForStableScene(engine, controller, before.renderCount + 1);
    }
    const view = engine.getVectorTextViewState();
    const exactOneToOneView = Math.abs(view.zoom - 1) <= 1e-6;
    if (!exactOneToOneView) {
      throw new Error("The small-scale vector quality lab could not establish a 1:1 view.");
    }

    const documentValue = parseVectorSvg(complexCurvedStrokesSvg, FIXTURE_NAME);
    if (canvas.width <= 32 || canvas.height <= 32) {
      throw new Error(
        "The visible canvas must be larger than the quality capture margin.",
      );
    }
    const baseScale = Math.min(
      1,
      (canvas.width - 32) / documentValue.width,
      (canvas.height - 32) / documentValue.height,
    );
    const retainedStrokeCount = documentValue.paints.reduce(
      (total, paint) => total + (paint.strokes?.length ?? 0),
      0,
    );
    const node = await engine.addVectorSvgNode({
      document: documentValue,
      paintColors: documentValue.paints.map((paint) => paint.color),
      x: view.centerX,
      y: view.centerY,
      scale: baseScale,
      scaleX: baseScale,
      scaleY: baseScale,
      rotation: 0,
    }, "Small-scale vector quality fixture");
    const candidateAvailable = typeof qualityEngine.setVectorRasterQualityMode === "function";
    const modes: ModeCapture[] = [];
    modes.push(await runMode(
      engine,
      controller,
      node.id,
      view.centerX,
      view.centerY,
      documentValue.width,
      documentValue.height,
      baseScale,
      "baseline",
    ));
    if (candidateAvailable) {
      modes.push(await runMode(
        engine,
        controller,
        node.id,
        view.centerX,
        view.centerY,
        documentValue.width,
        documentValue.height,
        baseScale,
        "coverage",
      ));
    }
    renderVisualComparison(modes, candidateAvailable);
    const finalDiagnostics = controller.getDiagnostics();
    const modeComparison = comparison(modes[0], modes[1]);
    const smallestBaseline = modes[0].samples.at(-1);
    const smallestCandidate = modes[1]?.samples.at(-1);
    const checks = {
      freshSceneAccepted,
      exactOneToOneView,
      fixtureHasRetainedStrokes: retainedStrokeCount > 0,
      allRequestedScalesCaptured: modes.every(
        (mode) => mode.samples.length === TEST_SCALES.length,
      ),
      finalPresentationPrecise: stable(finalDiagnostics),
      candidateProducesDifferentPixels: Boolean(
        modeComparison?.byScale.some((entry) => entry.changedPixelCount > 0),
      ),
      smallestScaleContinuityImproved: Boolean(
        smallestBaseline
        && smallestCandidate
        && smallestCandidate.quality.centerStroke.continuityRatio
          > smallestBaseline.quality.centerStroke.continuityRatio + 0.25,
      ),
    };
    const report: VectorSmallScaleQualityReport = {
      version: 1,
      strategy: VECTOR_SMALL_SCALE_QUALITY_STRATEGY,
      passed: candidateAvailable && Object.values(checks).every(Boolean),
      candidateAvailable,
      environment: {
        userAgent: navigator.userAgent,
        gpuLabel: engine.device.label,
        canvasFormat: engine.canvasFormat,
        documentStorageColorSpace: engine.documentStorageColorSpace,
        devicePixelRatio: window.devicePixelRatio,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      },
      fixture: {
        name: FIXTURE_NAME,
        sourceRevision: documentValue.sourceRevision,
        width: documentValue.width,
        height: documentValue.height,
        baseScale,
        retainedStrokeCount,
        scales: TEST_SCALES,
      },
      modes: modes.map(reportMode),
      comparison: modeComparison,
      checks,
    };
    completed = true;
    return report;
  } finally {
    if (!completed) {
      await qualityEngine.setVectorRasterQualityMode?.(initialQualityMode);
    }
    controller.setAdaptiveZoomEnabled(initialAdaptiveZoomEnabled);
  }
}
