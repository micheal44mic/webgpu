import type { BrushEngine } from "../brush-engine";
import type { MixedSceneController } from "../mixed-scene-controller";
import type { MixedSceneDiagnostics } from "../mixed-scene-controller-contract";
import type { VectorSvgNodeSeed } from "../scene-svg-model";
import type { VectorTextNodeSeed } from "../scene-text-model";
import { parseVectorSvg, type VectorSvgDocument } from "../vector-svg-import";
import complexCurvedStrokesSvg from "./fixtures/complex-curved-strokes.svg?raw";

const DEFAULT_SVG_COUNT = 32;
const DEFAULT_TEXT_COUNT = 32;
const MAXIMUM_NODE_COUNT = 32;
const STABLE_TIMEOUT_MS = 180_000;
const STABLE_FRAME_COUNT = 3;
const PAN_EVENT_COUNT = 60;
const ZOOM_EVENT_COUNT = 48;

interface VectorDeviceStressTestOptions {
  readonly engine: BrushEngine;
  readonly controller: MixedSceneController;
  readonly browser: Window;
  readonly document: Document;
  readonly canvas: HTMLCanvasElement;
}

interface FrameDistribution {
  readonly p95Ms: number;
  readonly maximumMs: number;
  readonly over33Ms: number;
  readonly eventToNextFrameP95Ms: number;
  readonly recoveryMs: number;
}

interface StressPanel {
  readonly root: HTMLElement;
  readonly badge: HTMLElement;
  readonly message: HTMLElement;
  readonly progressFill: HTMLElement;
  readonly scene: HTMLElement;
  readonly ready: HTMLElement;
  readonly setupFrames: HTMLElement;
  readonly vectorMemory: HTMLElement;
  readonly effects: HTMLElement;
  readonly pan: HTMLElement;
  readonly zoom: HTMLElement;
  readonly motionButton: HTMLButtonElement;
  readonly copyButton: HTMLButtonElement;
  readonly reloadButton: HTMLButtonElement;
  readonly collapseButton: HTMLButtonElement;
  readonly copyStatus: HTMLOutputElement;
}

interface MutableStressReport {
  version: 1;
  state: "building" | "settling" | "ready" | "motion" | "error";
  createdAt: string;
  device: {
    userAgent: string;
    viewport: string;
    devicePixelRatio: number;
    gpuLabel: string;
  };
  workload: {
    svgInstances: number;
    textInstances: number;
    uniqueSvgDocuments: number;
    sharedGeometryEnabled: boolean;
  };
  setup: {
    sceneMutationMs: number | null;
    navigationToReadyMs: number | null;
    frameP95Ms: number | null;
    maximumFrameGapMs: number | null;
    framesOver33Ms: number | null;
  };
  movement: {
    pan: FrameDistribution | null;
    zoom: FrameDistribution | null;
  };
  rendering: Record<string, unknown>;
  memory: Record<string, unknown>;
  error: string | null;
}

function required<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const value = root.querySelector<T>(selector);
  if (!value) throw new Error(`Missing vector stress panel element ${selector}.`);
  return value;
}

function createPanel(documentValue: Document): StressPanel {
  documentValue.getElementById("vectorDeviceStressPanel")?.remove();
  const root = documentValue.createElement("section");
  root.id = "vectorDeviceStressPanel";
  root.className = "vector-device-stress-panel";
  root.dataset.phase = "building";
  root.setAttribute("aria-label", "Vector device stress test");
  root.innerHTML = `
    <header class="vector-device-stress-header">
      <div>
        <span class="vector-device-stress-kicker">TEMPORARY TEST</span>
        <strong>Vector stress</strong>
      </div>
      <button class="vector-device-stress-collapse" type="button" aria-expanded="true" aria-label="Collapse panel">−</button>
    </header>
    <div class="vector-device-stress-body">
      <div class="vector-device-stress-state">
        <span class="vector-device-stress-badge">PREPARING</span>
        <span class="vector-device-stress-message" role="status" aria-live="polite">Starting the scene…</span>
      </div>
      <div class="vector-device-stress-progress" aria-hidden="true"><span></span></div>
      <dl class="vector-device-stress-grid">
        <div><dt>Scene</dt><dd data-stress-value="scene">0 / 64</dd></div>
        <div><dt>Ready in</dt><dd data-stress-value="ready">—</dd></div>
        <div><dt>Frame setup</dt><dd data-stress-value="setup">—</dd></div>
        <div><dt>Vector GPU</dt><dd data-stress-value="vector-memory">—</dd></div>
        <div><dt>Effects</dt><dd data-stress-value="effects">—</dd></div>
        <div><dt>Pan ×60</dt><dd data-stress-value="pan">not run</dd></div>
        <div><dt>Zoom ×48</dt><dd data-stress-value="zoom">not run</dd></div>
      </dl>
      <p class="vector-device-stress-note">32 shared instances of one complex SVG + 32 text nodes, with outlines and shadows. This test stays in RAM and is never saved.</p>
      <div class="vector-device-stress-actions">
        <button type="button" data-stress-action="motion" disabled>Run pan + zoom</button>
        <button type="button" data-stress-action="copy">Copy results</button>
        <button type="button" data-stress-action="reload">Run again</button>
      </div>
      <output class="vector-device-stress-copy-status" aria-live="polite"></output>
    </div>
  `;
  documentValue.body.append(root);
  return {
    root,
    badge: required(root, ".vector-device-stress-badge"),
    message: required(root, ".vector-device-stress-message"),
    progressFill: required(root, ".vector-device-stress-progress > span"),
    scene: required(root, '[data-stress-value="scene"]'),
    ready: required(root, '[data-stress-value="ready"]'),
    setupFrames: required(root, '[data-stress-value="setup"]'),
    vectorMemory: required(root, '[data-stress-value="vector-memory"]'),
    effects: required(root, '[data-stress-value="effects"]'),
    pan: required(root, '[data-stress-value="pan"]'),
    zoom: required(root, '[data-stress-value="zoom"]'),
    motionButton: required(root, '[data-stress-action="motion"]'),
    copyButton: required(root, '[data-stress-action="copy"]'),
    reloadButton: required(root, '[data-stress-action="reload"]'),
    collapseButton: required(root, ".vector-device-stress-collapse"),
    copyStatus: required(root, ".vector-device-stress-copy-status"),
  };
}

function requestedCount(search: URLSearchParams, key: string, fallback: number): number {
  const value = Number.parseInt(search.get(key) ?? "", 10);
  return Number.isInteger(value)
    ? Math.min(MAXIMUM_NODE_COUNT, Math.max(1, value))
    : fallback;
}

function gridPlacement(index: number, width: number, height: number): { x: number; y: number } {
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

function textSeed(index: number, width: number, height: number): VectorTextNodeSeed {
  const placement = gridPlacement(index, width, height);
  const blurredOuterShadow = index % 2 === 0;
  return {
    text: "VECTOR SHARED CURVES",
    fontFamily: "Anton",
    fontSize: 108,
    color: paletteColor(index, 2),
    transformType: "none",
    transformCurve: 80,
    circleRadiusPercent: 50,
    circleInverted: false,
    distortPoints: null,
    outlineWidth: 4,
    outlineColor: "#111111",
    outlineJoin: "round",
    blockShadowEnabled: !blurredOuterShadow,
    blockShadowColor: "#000000",
    blockShadowOpacity: 0.72,
    blockShadowOffset: 14,
    blockShadowAngle: -132,
    blockShadowOutlineWidth: 2,
    singleShadowEnabled: blurredOuterShadow,
    singleShadowColor: "#000000",
    singleShadowOpacity: 0.68,
    singleShadowOffset: 12,
    singleShadowAngle: -132,
    singleShadowBlur: 10,
    innerShadowEnabled: true,
    innerShadowColor: "#000000",
    innerShadowOpacity: 0.58,
    innerShadowOffset: 8,
    innerShadowAngle: 48,
    innerShadowBlur: 10,
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
  const blurredOuterShadow = index % 2 === 0;
  return {
    document: documentValue,
    paintColors: documentValue.paints.map((paint) => paint.color),
    outlineWidth: 4,
    outlineColor: "#111111",
    outlineJoin: "round",
    blockShadowEnabled: !blurredOuterShadow,
    blockShadowColor: "#000000",
    blockShadowOpacity: 0.72,
    blockShadowOffset: 14,
    blockShadowAngle: -132,
    blockShadowOutlineWidth: 2,
    singleShadowEnabled: blurredOuterShadow,
    singleShadowColor: "#000000",
    singleShadowOpacity: 0.68,
    singleShadowOffset: 12,
    singleShadowAngle: -132,
    singleShadowBlur: 10,
    innerShadowEnabled: true,
    innerShadowColor: "#000000",
    innerShadowOpacity: 0.58,
    innerShadowOffset: 8,
    innerShadowAngle: 48,
    innerShadowBlur: 10,
    x: placement.x,
    y: placement.y - height * 0.025,
    scale: 0.31,
    rotation: ((index % 9) - 4) * Math.PI / 180,
  };
}

function nextFrame(browser: Window): Promise<number> {
  return new Promise((resolve) => browser.requestAnimationFrame(resolve));
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function formatDuration(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)} s` : `${value.toFixed(1)} ms`;
}

function isStable(diagnostics: MixedSceneDiagnostics): boolean {
  return diagnostics.zoomRenderMode === "precise"
    && diagnostics.zoomFastPresentationMode === "precise"
    && diagnostics.effectWorkerPendingJobs === 0
    && diagnostics.effectWorkerFailedJobs === 0
    && diagnostics.atomicEffectPendingNodes === 0
    && !diagnostics.zoomUnsafeExactRefreshInFlight
    && !diagnostics.zoomUnsafeExactRefreshRequestPending;
}

async function waitForStableScene(
  options: VectorDeviceStressTestOptions,
  minimumRenderCount: number,
  onSample: (diagnostics: MixedSceneDiagnostics) => void,
): Promise<MixedSceneDiagnostics> {
  const deadline = performance.now() + STABLE_TIMEOUT_MS;
  let consecutive = 0;
  while (performance.now() < deadline) {
    await nextFrame(options.browser);
    const diagnostics = options.controller.getDiagnostics();
    onSample(diagnostics);
    if (diagnostics.effectWorkerFailedJobs > 0) {
      throw new Error(diagnostics.effectWorkerLastError ?? "One or more vector effects failed.");
    }
    consecutive = diagnostics.renderCount >= minimumRenderCount && isStable(diagnostics)
      ? consecutive + 1
      : 0;
    if (consecutive < STABLE_FRAME_COUNT) continue;
    await options.engine.waitForIdle();
    await options.engine.waitForVectorTextPresentationCompletion();
    const settled = options.controller.getDiagnostics();
    onSample(settled);
    if (settled.renderCount >= minimumRenderCount && isStable(settled)) return settled;
    consecutive = 0;
  }
  throw new Error("The vector scene did not become ready within three minutes.");
}

function frameDistribution(
  intervals: readonly number[],
  eventToNextFrame: readonly number[],
  recoveryMs: number,
): FrameDistribution {
  return {
    p95Ms: percentile(intervals, 0.95),
    maximumMs: intervals.length > 0 ? Math.max(...intervals) : 0,
    over33Ms: intervals.filter((value) => value > 33).length,
    eventToNextFrameP95Ms: percentile(eventToNextFrame, 0.95),
    recoveryMs,
  };
}

function summary(value: FrameDistribution): string {
  return `p95 ${value.p95Ms.toFixed(1)} ms · >33 ${value.over33Ms}`;
}

async function writeClipboard(documentValue: Document, text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = documentValue.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  documentValue.body.append(input);
  input.select();
  const copied = documentValue.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Copy is unavailable in this browser.");
}

export async function startVectorDeviceStressTest(
  options: VectorDeviceStressTestOptions,
): Promise<void> {
  const panel = createPanel(options.document);
  const search = new URLSearchParams(options.browser.location.search);
  const svgCount = requestedCount(search, "vectorStressSvgCount", DEFAULT_SVG_COUNT);
  const textCount = requestedCount(search, "vectorStressTextCount", DEFAULT_TEXT_COUNT);
  const totalNodes = svgCount + textCount;
  const report: MutableStressReport = {
    version: 1,
    state: "building",
    createdAt: new Date().toISOString(),
    device: {
      userAgent: navigator.userAgent,
      viewport: `${options.browser.innerWidth}x${options.browser.innerHeight}`,
      devicePixelRatio: options.browser.devicePixelRatio,
      gpuLabel: options.engine.getStats().gpuLabel,
    },
    workload: {
      svgInstances: svgCount,
      textInstances: textCount,
      uniqueSvgDocuments: 1,
      sharedGeometryEnabled: options.engine.vectorGpuResourceSharingEnabled,
    },
    setup: {
      sceneMutationMs: null,
      navigationToReadyMs: null,
      frameP95Ms: null,
      maximumFrameGapMs: null,
      framesOver33Ms: null,
    },
    movement: { pan: null, zoom: null },
    rendering: {},
    memory: {},
    error: null,
  };
  const setupIntervals: number[] = [];
  let setupFrameRequest = 0;
  let previousSetupFrame: number | null = null;
  let sampleSetupFrames = true;
  let peakVectorMemoryMiB = 0;
  let peakRegisteredMemoryMiB = 0;
  let completedNodes = 0;
  let lastMemorySampleAt = Number.NEGATIVE_INFINITY;

  const sampleMemory = (
    diagnostics = options.controller.getDiagnostics(),
    force = false,
  ): void => {
    const now = performance.now();
    panel.effects.textContent = `${diagnostics.effectWorkerPendingJobs} pending · `
      + `${diagnostics.effectWorkerFailedJobs} errors`;
    if (!force && now - lastMemorySampleAt < 200) return;
    lastMemorySampleAt = now;
    const stats = options.engine.getStats();
    peakVectorMemoryMiB = Math.max(peakVectorMemoryMiB, diagnostics.liveGpuMemoryMiB);
    peakRegisteredMemoryMiB = Math.max(
      peakRegisteredMemoryMiB,
      stats.gpuMemory.registeredPeakMiB,
    );
    panel.vectorMemory.textContent = `${diagnostics.liveGpuMemoryMiB.toFixed(1)} MiB`
      + ` · peak ${peakVectorMemoryMiB.toFixed(1)}`;
  };
  const sampleSetupFrame = (timestamp: number): void => {
    if (!sampleSetupFrames) return;
    if (previousSetupFrame !== null) setupIntervals.push(Math.max(0, timestamp - previousSetupFrame));
    previousSetupFrame = timestamp;
    setupFrameRequest = options.browser.requestAnimationFrame(sampleSetupFrame);
  };
  setupFrameRequest = options.browser.requestAnimationFrame(sampleSetupFrame);

  const setState = (
    state: MutableStressReport["state"],
    badge: string,
    message: string,
  ): void => {
    report.state = state;
    panel.root.dataset.phase = state;
    panel.badge.textContent = badge;
    panel.message.textContent = message;
  };
  const setProgress = (message: string): void => {
    panel.message.textContent = message;
    panel.scene.textContent = `${completedNodes} / ${totalNodes}`;
    panel.progressFill.style.transform = `scaleX(${totalNodes > 0 ? completedNodes / totalNodes : 1})`;
    panel.root.dataset.completedNodes = String(completedNodes);
    sampleMemory();
  };
  const updateReport = (diagnostics = options.controller.getDiagnostics()): void => {
    const stats = options.engine.getStats();
    const snapshot = options.engine.getMixedSceneSnapshot();
    report.rendering = {
      precise: isStable(diagnostics),
      renderCount: diagnostics.renderCount,
      lastRenderMs: diagnostics.lastRenderMs,
      renderP95Ms: diagnostics.renderP95Ms,
      effectWorkerPendingJobs: diagnostics.effectWorkerPendingJobs,
      effectWorkerFailedJobs: diagnostics.effectWorkerFailedJobs,
      atomicEffectPendingNodes: diagnostics.atomicEffectPendingNodes,
      svgNodeCount: snapshot?.items.filter((item) => item.kind === "svg").length ?? 0,
      textNodeCount: snapshot?.items.filter((item) => item.kind === "text").length ?? 0,
      vectorGeometryGpu: diagnostics.vectorGeometryGpu,
    };
    report.memory = {
      liveVectorGpuMiB: diagnostics.liveGpuMemoryMiB,
      peakVectorGpuMiB: peakVectorMemoryMiB,
      vectorPresentationMiB: stats.gpuMemory.vectorTextPresentationMiB,
      registeredCurrentMiB: stats.gpuMemory.registeredCurrentMiB,
      registeredPeakMiB: Math.max(peakRegisteredMemoryMiB, stats.gpuMemory.registeredPeakMiB),
      registeredBufferCount: stats.gpuMemory.registeredBufferCount,
      registeredTextureCount: stats.gpuMemory.registeredTextureCount,
      countedTotalMiB: stats.gpuMemory.countedTotalMiB,
    };
  };

  panel.collapseButton.addEventListener("click", () => {
    const collapsed = panel.root.classList.toggle("is-collapsed");
    panel.collapseButton.textContent = collapsed ? "+" : "−";
    panel.collapseButton.setAttribute("aria-expanded", String(!collapsed));
    panel.collapseButton.setAttribute("aria-label", collapsed ? "Expand panel" : "Collapse panel");
  });
  panel.reloadButton.addEventListener("click", () => options.browser.location.reload());
  panel.copyButton.addEventListener("click", () => {
    updateReport();
    void writeClipboard(options.document, JSON.stringify(report, null, 2)).then(
      () => {
        panel.copyStatus.textContent = "Results copied. Paste them into the chat.";
      },
      (error: unknown) => {
        panel.copyStatus.textContent = error instanceof Error ? error.message : "Copy failed.";
      },
    );
  });

  const measureGesture = async (
    eventCount: number,
    applyEvent: (index: number) => void,
  ): Promise<FrameDistribution> => {
    const intervals: number[] = [];
    const eventToNextFrame: number[] = [];
    let previous = await nextFrame(options.browser);
    options.controller.beginViewGesture();
    try {
      for (let index = 0; index < eventCount; index += 1) {
        const eventStartedAt = performance.now();
        applyEvent(index);
        const timestamp = await nextFrame(options.browser);
        intervals.push(Math.max(0, timestamp - previous));
        eventToNextFrame.push(Math.max(0, performance.now() - eventStartedAt));
        previous = timestamp;
      }
    } finally {
      options.controller.endViewGesture();
    }
    const recoveryStartedAt = performance.now();
    options.engine.fitView();
    await waitForStableScene(
      options,
      options.controller.getDiagnostics().renderCount,
      sampleMemory,
    );
    return frameDistribution(
      intervals,
      eventToNextFrame,
      performance.now() - recoveryStartedAt,
    );
  };

  panel.motionButton.addEventListener("click", () => {
    if (report.state !== "ready") return;
    panel.motionButton.disabled = true;
    setState("motion", "MOTION", "Measuring the same 60 pans and 48 zooms on every device…");
    void (async () => {
      const pan = await measureGesture(PAN_EVENT_COUNT, (index) => {
        options.engine.panByClientDelta(
          Math.sin(index * 0.47) * 13,
          Math.cos(index * 0.31) * 9,
        );
      });
      report.movement.pan = pan;
      panel.pan.textContent = summary(pan);
      const rectangle = options.canvas.getBoundingClientRect();
      const zoom = await measureGesture(ZOOM_EVENT_COUNT, (index) => {
        options.engine.zoomBy(
          index % 2 === 0 ? 1.035 : 1 / 1.035,
          rectangle.left + rectangle.width * 0.5,
          rectangle.top + rectangle.height * 0.5,
        );
      });
      report.movement.zoom = zoom;
      panel.zoom.textContent = summary(zoom);
      setState("ready", "READY", "Motion test complete. Copy the results and send them to me.");
      panel.motionButton.disabled = false;
      panel.motionButton.textContent = "Run pan + zoom again";
      updateReport();
    })().catch((error: unknown) => {
      report.error = error instanceof Error ? error.message : String(error);
      setState("error", "ERROR", report.error);
      panel.motionButton.disabled = false;
      updateReport();
    });
  });

  try {
    const parsedSvg = parseVectorSvg(complexCurvedStrokesSvg, "complex-curved-strokes.svg");
    const fontPreparation = options.controller.prepareTextCreationResources("Anton");
    const mutationStartedAt = performance.now();
    for (let index = 0; index < svgCount; index += 1) {
      await options.engine.addVectorSvgNode(
        svgSeed(parsedSvg, index, options.engine.documentWidth, options.engine.documentHeight),
        `Stress SVG ${String(index + 1).padStart(2, "0")}`,
      );
      completedNodes += 1;
      setProgress(`Creating complex SVGs: ${index + 1} / ${svgCount}`);
      if ((index + 1) % 2 === 0) await nextFrame(options.browser);
    }
    await fontPreparation;
    const textEntries = Array.from({ length: textCount }, (_, index) => ({
      seed: textSeed(index, options.engine.documentWidth, options.engine.documentHeight),
      name: `Stress text ${String(index + 1).padStart(2, "0")}`,
    }));
    for (let start = 0; start < textEntries.length; start += 8) {
      const entries = textEntries.slice(start, start + 8);
      await options.engine.addVectorTextNodesBatch(entries);
      completedNodes += entries.length;
      setProgress(`Creating text and effects: ${Math.min(textCount, start + entries.length)} / ${textCount}`);
      await nextFrame(options.browser);
    }
    report.setup.sceneMutationMs = performance.now() - mutationStartedAt;
    panel.progressFill.style.transform = "scaleX(1)";
    setState("settling", "EFFECTS", "The scene is complete; waiting for shadows and precise rendering…");
    options.engine.fitView();
    const minimumRenderCount = options.controller.getDiagnostics().renderCount + 1;
    void waitForStableScene(options, minimumRenderCount, (diagnostics) => {
      sampleMemory(diagnostics);
    }).then((diagnostics) => {
      sampleSetupFrames = false;
      options.browser.cancelAnimationFrame(setupFrameRequest);
      report.setup.navigationToReadyMs = performance.now();
      report.setup.frameP95Ms = percentile(setupIntervals, 0.95);
      report.setup.maximumFrameGapMs = setupIntervals.length > 0 ? Math.max(...setupIntervals) : 0;
      report.setup.framesOver33Ms = setupIntervals.filter((value) => value > 33).length;
      panel.ready.textContent = formatDuration(report.setup.navigationToReadyMs);
      panel.setupFrames.textContent = `p95 ${report.setup.frameP95Ms.toFixed(1)} · `
        + `max ${report.setup.maximumFrameGapMs.toFixed(1)} ms`;
      const snapshot = options.engine.getMixedSceneSnapshot();
      const actualSvgCount = snapshot?.items.filter((item) => item.kind === "svg").length ?? 0;
      const actualTextCount = snapshot?.items.filter((item) => item.kind === "text").length ?? 0;
      if (actualSvgCount !== svgCount || actualTextCount !== textCount) {
        throw new Error(`Scene count mismatch: ${actualSvgCount} SVG and ${actualTextCount} text.`);
      }
      setState("ready", "READY", "The scene is stable. Now run the pan + zoom test.");
      panel.motionButton.disabled = false;
      panel.root.dataset.ready = "true";
      sampleMemory(diagnostics, true);
      updateReport(diagnostics);
    }).catch((error: unknown) => {
      sampleSetupFrames = false;
      options.browser.cancelAnimationFrame(setupFrameRequest);
      report.error = error instanceof Error ? error.message : String(error);
      setState("error", "ERROR", report.error);
      updateReport();
    });
  } catch (error) {
    sampleSetupFrames = false;
    options.browser.cancelAnimationFrame(setupFrameRequest);
    report.error = error instanceof Error ? error.message : String(error);
    setState("error", "ERROR", report.error);
    updateReport();
    throw error;
  }
}
