import type { BrushEngine } from "./brush-engine";
import {
  APP_DIAGNOSTIC_SCHEMA,
  BoundedAppDiagnosticLog,
  captureAppDiagnosticState,
  describeAppDiagnosticError,
  inspectAppDiagnosticInvariants,
  summarizeAppDiagnosticHistoryWindow,
} from "./app-diagnostics";
import type { HistoryState } from "./engine-types";
import { GPU_MEMORY_AUDIT_TOLERANCE_BYTES } from "./gpu-memory-audit";

type MixedSceneSnapshot = NonNullable<ReturnType<BrushEngine["getMixedSceneSnapshot"]>>;

interface DiagnosticNavigatorUAData {
  readonly brands?: readonly { readonly brand: string; readonly version: string }[];
  readonly mobile?: boolean;
  readonly platform?: string;
  getHighEntropyValues?(hints: readonly string[]): Promise<Record<string, unknown>>;
}

export interface AppDiagnosticsUiSnapshot {
  readonly engineInitialized: boolean;
  readonly layerSwitching: boolean;
  readonly historyUiBusy: boolean;
  readonly historyQueueDraining: boolean;
  readonly queuedHistoryOperations: number;
  readonly activePointer: boolean;
  readonly currentHistory: HistoryState;
  readonly lastHistoryFailure: unknown;
  readonly rasterAdjustmentLocks: {
    readonly rasterGaussianBlurUiBusy: boolean;
    readonly rasterMotionBlurUiBusy: boolean;
    readonly rasterNoiseUiBusy: boolean;
    readonly rasterLiquifyUiBusy: boolean;
  };
}

export interface AppDiagnosticsControllerOptions {
  readonly engine: BrushEngine;
  readonly browser: Window & { readonly AbortController: typeof AbortController };
  readonly document: Document;
  readonly navigator: Navigator;
  readonly canvas: HTMLCanvasElement;
  readonly elements: {
    readonly copyButton: HTMLButtonElement;
    readonly copyStatus: HTMLOutputElement;
    readonly details: HTMLDetailsElement;
    readonly report: HTMLElement;
    readonly appStatus: HTMLElement;
    readonly layerStatus: HTMLElement;
  };
  readonly appMode: string;
  readonly documentSize: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly getUiSnapshot: () => AppDiagnosticsUiSnapshot;
  readonly getVectorDiagnostics: () => unknown;
}

type DiagnosticSection<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: ReturnType<typeof describeAppDiagnosticError> };

/** Owns bounded diagnostics, global error capture and on-demand report copying. */
export class AppDiagnosticsController {
  private readonly options: AppDiagnosticsControllerOptions;
  private readonly abortController: AbortController;
  private readonly log = new BoundedAppDiagnosticLog();
  private historySignature = "";
  private sceneSignature = "";
  private copyBusy = false;

  constructor(options: AppDiagnosticsControllerOptions) {
    this.options = options;
    this.abortController = new options.browser.AbortController();
    const signal = this.abortController.signal;
    options.browser.addEventListener("error", (event) => {
      this.log.record({
        category: "error",
        name: "window-error",
        detail: event.filename
          ? `${event.filename}:${event.lineno}:${event.colno}`
          : null,
        error: event.error ?? new Error(event.message || "Global error with no message."),
      });
    }, { signal });
    options.browser.addEventListener("unhandledrejection", (event) => {
      this.log.record({
        category: "error",
        name: "unhandled-promise-rejection",
        error: event.reason,
      });
    }, { signal });
    options.elements.copyButton.addEventListener("click", () => {
      void this.copyReport();
    }, { signal });
  }

  recordStatusError(message: string): void {
    this.log.record({
      category: "status",
      name: "engine-status-error",
      detail: message,
    });
  }

  recordHistoryState(state: HistoryState): void {
    const signature = [
      state.cursor,
      state.actionCount,
      state.inconsistent,
      state.openEdit ?? "none",
    ].join("|");
    if (signature === this.historySignature) return;
    this.historySignature = signature;
    this.log.record({
      category: "history",
      name: state.inconsistent ? "history-inconsistent" : "history-state",
      detail: JSON.stringify({
        cursor: state.cursor,
        actionCount: state.actionCount,
        busy: state.busy,
        inconsistent: state.inconsistent,
        openEdit: state.openEdit,
        undoBlockedReason: state.undoBlockedReason,
        redoBlockedReason: state.redoBlockedReason,
      }),
    });
  }

  recordSceneSnapshot(snapshot: MixedSceneSnapshot): void {
    const signature = `${snapshot.selectedKey}|`
      + snapshot.items.map((item) => item.key).join(",");
    if (signature === this.sceneSignature) return;
    this.sceneSignature = signature;
    this.log.record({
      category: "scene",
      name: "mixed-scene-state",
      detail: JSON.stringify({
        selectedKey: snapshot.selectedKey,
        activeRasterLayerId: snapshot.activeRasterLayerId,
        bottomUpKeys: snapshot.items.map((item) => item.key),
      }),
    });
  }

  recordOperation(name: string, detail: string | null = null, error?: unknown): void {
    this.log.record({
      category: error === undefined ? "operation" : "error",
      name,
      detail,
      error,
      state: this.captureCurrentState(),
    });
  }

  async buildReport(): Promise<string> {
    const { engine, browser, document, navigator, canvas } = this.options;
    const [userAgentDataResult, fillDiagnosticsResult] = await Promise.all([
      this.asyncSection(() => this.captureUserAgentData()),
      this.asyncSection(() => engine.captureFillDiagnostics()),
    ]);
    const statsResult = this.section(() => engine.getStats());
    const historyResult = this.section(() => engine.getHistoryState());
    const stats = statsResult.ok ? statsResult.value : null;
    const ui = this.options.getUiSnapshot();
    const currentHistory = historyResult.ok ? historyResult.value : ui.currentHistory;
    const measuredResult = this.section(() => engine.measuredGpuMemory());
    const maintenanceResult = this.section(() => engine.getHistoryMaintenanceTelemetry());
    const vectorDiagnosticsResult = this.section(() => this.options.getVectorDiagnostics());
    const webGpuDiagnosticsResult = this.section(() => engine.getWebGpuDiagnosticInfo());
    const currentState = stats ? captureAppDiagnosticState(stats, currentHistory) : null;
    const invariants = stats
      ? inspectAppDiagnosticInvariants(stats, currentHistory)
      : { ok: false, issues: ["Engine stats could not be read during capture."] };
    const measured = measuredResult.ok ? measuredResult.value : null;
    const declaredBytes = (stats?.gpuMemory.countedTotalMiB ?? 0) * 1024 * 1024;
    const measuredBytes = measured?.currentBytes ?? 0;
    const memoryDeltaBytes = measuredBytes - declaredBytes;
    const historyWindowResult = this.section(() =>
      summarizeAppDiagnosticHistoryWindow(engine.historyActions, engine.historyCursor)
    );
    const report = {
      schema: APP_DIAGNOSTIC_SCHEMA,
      capturedAt: new Date().toISOString(),
      privacy:
        "No pixels, text content, SVG source, or full masks are included; "
        + "only Fill counters and five words around the seed.",
      app: {
        mode: this.options.appMode,
        documentSize: this.options.documentSize,
        documentWidth: this.options.documentWidth,
        documentHeight: this.options.documentHeight,
        path: `${browser.location.pathname}${browser.location.search}`,
        visibility: document.visibilityState,
        entryScripts: [...document.scripts]
          .map((script) => script.src)
          .filter(Boolean)
          .map((source) => {
            try {
              return new URL(source, browser.location.href).pathname.split("/").at(-1) ?? source;
            } catch {
              return source;
            }
          }),
      },
      environment: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints,
        language: navigator.language,
        viewportCss: { width: browser.innerWidth, height: browser.innerHeight },
        screenCss: { width: browser.screen.width, height: browser.screen.height },
        canvasPixels: { width: canvas.width, height: canvas.height },
        devicePixelRatio: browser.devicePixelRatio,
        gpuLabel: stats?.gpuLabel ?? null,
        userAgentData: userAgentDataResult,
        webGpu: webGpuDiagnosticsResult,
      },
      uiLocks: {
        engineInitialized: ui.engineInitialized,
        layerSwitching: ui.layerSwitching,
        historyUiBusy: ui.historyUiBusy,
        historyQueueDraining: ui.historyQueueDraining,
        queuedHistoryOperations: ui.queuedHistoryOperations,
        activePointer: ui.activePointer,
        ...ui.rasterAdjustmentLocks,
      },
      engineLocks: {
        initialized: engine.initialized,
        layerSwitchBusy: engine.layerSwitchBusy,
        selectionBusy: engine.selectionBusy,
        historyBusy: engine.historyBusy,
        historyStateInconsistent: engine.historyStateInconsistent,
        activeStroke: engine.activeStroke !== null,
        deviceLost: engine.deviceLostError
          ? describeAppDiagnosticError(engine.deviceLostError)
          : null,
        renderFrameError: engine.renderFrameError
          ? describeAppDiagnosticError(engine.renderFrameError)
          : null,
        firstInconsistentLatch: engine.getDocumentInconsistentDiagnostic(),
      },
      renderWork: {
        layerPresentationFrozen: engine.layerPresentationFrozen,
        displayDirty: engine.displayDirty,
        presentationCacheNeedsFullRebuild: engine.presentationCacheNeedsFullRebuild,
        frameRequestPending: engine.frameRequest !== null,
        pendingStamps: engine.pendingStamps.length,
        pendingBlendBatches: engine.pendingBlendBatches.length,
      },
      layerResidency: (() => {
        const stackIds = engine.layerStack.layers.map((layer) => layer.id);
        const gpuIds = [...engine.layerGpu.keys()];
        const stackIdSet = new Set(stackIds);
        const gpuIdSet = new Set(gpuIds);
        return {
          stackIds,
          gpuIds,
          missingGpuIds: stackIds.filter((id) => !gpuIdSet.has(id)),
          orphanGpuIds: gpuIds.filter((id) => !stackIdSet.has(id)),
          resources: gpuIds.map((id) => {
            const gpu = engine.layerGpu.get(id);
            return {
              id,
              hot: Boolean(gpu?.hot),
              cold: Boolean(gpu?.cold),
              compressed: Boolean(gpu?.compressed),
            };
          }),
        };
      })(),
      visibleMessages: {
        status: this.options.elements.appStatus.textContent,
        layer: this.options.elements.layerStatus.textContent,
        lastHistoryFailure: ui.lastHistoryFailure,
      },
      currentState,
      invariants,
      statsReadError: statsResult.ok ? null : statsResult.error,
      historyReadError: historyResult.ok ? null : historyResult.error,
      gpuMemoryAudit: measured
        ? {
            declaredMiB: declaredBytes / (1024 * 1024),
            registeredMiB: measuredBytes / (1024 * 1024),
            deltaMiB: memoryDeltaBytes / (1024 * 1024),
            warning: Math.abs(memoryDeltaBytes) > GPU_MEMORY_AUDIT_TOLERANCE_BYTES,
            textureCount: measured.textureCount,
            bufferCount: measured.bufferCount,
            unmeasurableCount: measured.unmeasurableCount,
            categories: measured.categories.map((category) => ({
              category: category.category,
              currentMiB: category.bytes / (1024 * 1024),
              peakMiB: category.peakBytes / (1024 * 1024),
              count: category.count,
            })),
          }
        : measuredResult,
      layerColdTileComposite: stats
        ? {
            enabled: stats.layerColdTileCompositeEnabled,
            ...stats.layerColdTileComposite,
          }
        : null,
      historyMaintenance: maintenanceResult,
      vectorDiagnostics: vectorDiagnosticsResult,
      fillDiagnostics: fillDiagnosticsResult,
      historyWindow: historyWindowResult,
      recentEvents: this.log.snapshot(),
    };
    return JSON.stringify(report, null, 2);
  }

  async copyReport(): Promise<void> {
    if (this.copyBusy) return;
    this.copyBusy = true;
    const { copyButton, copyStatus, details, report } = this.options.elements;
    copyButton.disabled = true;
    copyButton.setAttribute("aria-busy", "true");
    copyStatus.hidden = false;
    copyStatus.textContent = "Preparing report…";
    try {
      const serialized = await this.buildReport();
      report.textContent = serialized;
      details.hidden = false;
      (this.options.browser as Window & { __appDiagnosticReport?: string })
        .__appDiagnosticReport = serialized;
      let copied = false;
      try {
        await this.options.navigator.clipboard.writeText(serialized);
        copied = true;
      } catch {
        copied = this.copyTextWithLegacySelection(serialized);
      }
      details.open = !copied;
      copyStatus.textContent = copied
        ? "Diagnostics copied. Paste them into the chat without reloading the page."
        : "Automatic copying was not allowed. The report is open below for manual selection.";
    } catch (error) {
      const diagnosticError = describeAppDiagnosticError(error);
      copyStatus.textContent = `Could not create the report: ${diagnosticError.message}`;
      details.hidden = true;
      this.log.record({
        category: "error",
        name: "diagnostic-report-failed",
        error,
      });
    } finally {
      this.copyBusy = false;
      copyButton.disabled = false;
      copyButton.setAttribute("aria-busy", "false");
    }
  }

  dispose(): void {
    this.abortController.abort();
  }

  private captureCurrentState() {
    try {
      return captureAppDiagnosticState(
        this.options.engine.getStats(),
        this.options.engine.getHistoryState(),
      );
    } catch {
      return null;
    }
  }

  private section<Value>(read: () => Value): DiagnosticSection<Value> {
    try {
      return { ok: true, value: read() };
    } catch (error) {
      return { ok: false, error: describeAppDiagnosticError(error) };
    }
  }

  private async asyncSection<Value>(read: () => Promise<Value>): Promise<DiagnosticSection<Value>> {
    try {
      return { ok: true, value: await read() };
    } catch (error) {
      return { ok: false, error: describeAppDiagnosticError(error) };
    }
  }

  private async captureUserAgentData(): Promise<Record<string, unknown> | null> {
    const userAgentData = (
      this.options.navigator as Navigator & { readonly userAgentData?: DiagnosticNavigatorUAData }
    ).userAgentData;
    if (!userAgentData) return null;
    const lowEntropy = {
      brands: userAgentData.brands ?? null,
      mobile: userAgentData.mobile ?? null,
      platform: userAgentData.platform ?? null,
    };
    if (!userAgentData.getHighEntropyValues) return lowEntropy;
    const highEntropy = await userAgentData.getHighEntropyValues([
      "platformVersion",
      "model",
      "architecture",
      "bitness",
      "fullVersionList",
    ]);
    return { ...lowEntropy, ...highEntropy };
  }

  private copyTextWithLegacySelection(text: string): boolean {
    const textarea = this.options.document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.position = "fixed";
    textarea.style.inset = "0 auto auto 0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.fontSize = "16px";
    this.options.document.body.append(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    try {
      return this.options.document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }
}
