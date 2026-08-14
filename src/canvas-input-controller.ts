import type { BrushEngine } from "./brush-engine";
import type { EditorExtension } from "./editor-extension-contract";
import type { BrushSettings, HistoryState, PointerSample } from "./engine-types";
import type { MixedSceneController } from "./mixed-scene-controller";
import type { SelectionCombineMode, SelectionMethod, SelectionPoint } from "./selection-core";
import {
  TOUCH_PAINT_INTENT_HOLD_MS,
  TOUCH_PAINT_INTENT_MOVE_THRESHOLD_PX,
  TOUCH_PAINT_INTENT_STRATEGY,
  shouldHoldTouchPaintIntent,
  touchPaintIntentMovementReached,
} from "./touch-paint-intent-core";

export type CanvasInputTool =
  | BrushSettings["tool"]
  | "fill"
  | "selection"
  | "transform"
  | "liquify";

export type CanvasInputEnginePort = Pick<
  BrushEngine,
  | "beginRasterLiquifyStroke"
  | "beginStroke"
  | "beginViewRotationGesture"
  | "cancelStrokeBeforeRender"
  | "endRasterLiquifyStroke"
  | "endStroke"
  | "endViewRotationGesture"
  | "extendRasterLiquifyStroke"
  | "extendStroke"
  | "fillAtClientPoint"
  | "getHistoryState"
  | "panByClientDelta"
  | "resizeCanvas"
  | "rotateViewBy"
  | "selectConnectedAtClientPoint"
  | "selectPixelsByClientLasso"
  | "toLayerPoint"
  | "zoomBy"
>;

export type CanvasInputVectorPort = Pick<
  MixedSceneController,
  "beginViewGesture" | "endViewGesture"
>;

export type CanvasInputExtensionPort = Pick<
  EditorExtension,
  | "beginPaintRecording"
  | "cancelPaintRecording"
  | "capturePaintRecording"
  | "finishPaintRecording"
  | "wantsPaintRecording"
>;

export interface CanvasInputBrowser extends Window {
  readonly AbortController: typeof AbortController;
  readonly Element: typeof Element;
  readonly ResizeObserver: typeof ResizeObserver;
}

export interface CanvasInputElements {
  readonly canvas: HTMLCanvasElement;
  readonly selectionGestureCanvas: HTMLCanvasElement;
  readonly selectionGestureContext: CanvasRenderingContext2D;
  readonly status: HTMLParagraphElement;
}

export interface CanvasInputFillSettings {
  readonly tolerance: number;
}

export interface CanvasInputSelectionSettings {
  readonly tolerance: number;
  readonly combineMode: SelectionCombineMode;
}

export interface CanvasInputDiagnostics {
  readonly touchNavigationStrategy: "two-finger-pan-pinch-rotate-zero-magnet";
  readonly touchPaintIntentStrategy: typeof TOUCH_PAINT_INTENT_STRATEGY;
  readonly touchPaintIntentHoldEnabled: boolean;
  readonly touchPaintIntentHoldMs: typeof TOUCH_PAINT_INTENT_HOLD_MS;
  readonly touchPaintIntentMoveThresholdPx: typeof TOUCH_PAINT_INTENT_MOVE_THRESHOLD_PX;
  readonly touchPaintIntentStarts: number;
  readonly touchPaintIntentReleasedByMovement: number;
  readonly touchPaintIntentReleasedByTimeout: number;
  readonly touchPaintIntentReleasedByPointerUp: number;
  readonly touchPaintIntentCanceledForNavigation: number;
  readonly touchPaintIntentCanceledForPointerEnd: number;
  readonly touchPaintIntentMaximumBufferedSamples: number;
  readonly touchPaintIntentLastHoldDurationMs: number;
}

export interface CanvasInputControllerOptions {
  readonly engine: CanvasInputEnginePort;
  readonly browser: CanvasInputBrowser;
  readonly elements: CanvasInputElements;
  readonly touchPaintIntentHoldEnabled: boolean;
  readonly getActiveTool: () => CanvasInputTool;
  readonly getSelectionMethod: () => SelectionMethod;
  readonly getFillSettings: () => CanvasInputFillSettings;
  readonly getSelectionSettings: () => CanvasInputSelectionSettings;
  readonly getBrushColor: () => string;
  readonly getHistoryState: () => HistoryState;
  readonly onHistoryState: (state: HistoryState) => void;
  readonly operationLocked: (allowDestructiveEdit?: boolean) => boolean;
  readonly viewOperationLocked: () => boolean;
  readonly isLiquifyEditActive: () => boolean;
  readonly isDestructivePreviewNavigationActive: () => boolean;
  readonly getVectorController: () => CanvasInputVectorPort | null;
  readonly getEditorExtension: () => CanvasInputExtensionPort | null;
  readonly updateHistoryControls: () => void;
  readonly runPixelSelectionOperation: (operation: () => Promise<unknown>) => void;
  readonly scheduleLayersRefresh: () => void;
  readonly invalidateActiveThumbnail: (delayMs?: number) => void;
}

export type CanvasPointerMode =
  | "paint"
  | "liquify"
  | "fill"
  | "selection-tap"
  | "selection-lasso"
  | "transform"
  | "pan"
  | "rotate"
  | "touch-navigation";

interface TouchContact {
  clientX: number;
  clientY: number;
}

interface TouchNavigationGesture {
  contactCount: number;
  centerX: number;
  centerY: number;
  distance: number;
  angle: number;
}

type TouchPaintIntentReleaseReason = "movement" | "timeout" | "pointer-up";

interface TouchPaintIntentHold {
  pointerId: number;
  initialSample: PointerSample;
  bufferedSamples: PointerSample[];
  startedAtPerformanceMs: number;
  timeoutId: number;
}

interface CanvasInputRuntime {
  readonly isPointerActive: () => boolean;
  readonly pointerMode: () => CanvasPointerMode | null;
  readonly diagnostics: () => CanvasInputDiagnostics;
  readonly cancelKeyboardSelectionGesture: (hideCursor: boolean) => void;
  readonly dispose: () => void;
}

export class CanvasInputController {
  private readonly runtime: CanvasInputRuntime;

  constructor(options: CanvasInputControllerOptions) {
    this.runtime = createCanvasInputRuntime(options);
  }

  static initialDiagnostics(touchPaintIntentHoldEnabled: boolean): CanvasInputDiagnostics {
    return canvasInputDiagnostics(touchPaintIntentHoldEnabled, {
      starts: 0,
      releasedByMovement: 0,
      releasedByTimeout: 0,
      releasedByPointerUp: 0,
      canceledForNavigation: 0,
      canceledForPointerEnd: 0,
      maximumBufferedSamples: 0,
      lastHoldDurationMs: 0,
    });
  }

  get isPointerActive(): boolean {
    return this.runtime.isPointerActive();
  }

  get pointerMode(): CanvasPointerMode | null {
    return this.runtime.pointerMode();
  }

  diagnostics(): CanvasInputDiagnostics {
    return this.runtime.diagnostics();
  }

  cancelKeyboardSelectionGesture(hideCursor: boolean): void {
    this.runtime.cancelKeyboardSelectionGesture(hideCursor);
  }

  dispose(): void {
    this.runtime.dispose();
  }
}

function canvasInputDiagnostics(
  touchPaintIntentHoldEnabled: boolean,
  counters: {
    readonly starts: number;
    readonly releasedByMovement: number;
    readonly releasedByTimeout: number;
    readonly releasedByPointerUp: number;
    readonly canceledForNavigation: number;
    readonly canceledForPointerEnd: number;
    readonly maximumBufferedSamples: number;
    readonly lastHoldDurationMs: number;
  },
): CanvasInputDiagnostics {
  return {
    touchNavigationStrategy: "two-finger-pan-pinch-rotate-zero-magnet",
    touchPaintIntentStrategy: TOUCH_PAINT_INTENT_STRATEGY,
    touchPaintIntentHoldEnabled,
    touchPaintIntentHoldMs: TOUCH_PAINT_INTENT_HOLD_MS,
    touchPaintIntentMoveThresholdPx: TOUCH_PAINT_INTENT_MOVE_THRESHOLD_PX,
    touchPaintIntentStarts: counters.starts,
    touchPaintIntentReleasedByMovement: counters.releasedByMovement,
    touchPaintIntentReleasedByTimeout: counters.releasedByTimeout,
    touchPaintIntentReleasedByPointerUp: counters.releasedByPointerUp,
    touchPaintIntentCanceledForNavigation: counters.canceledForNavigation,
    touchPaintIntentCanceledForPointerEnd: counters.canceledForPointerEnd,
    touchPaintIntentMaximumBufferedSamples: counters.maximumBufferedSamples,
    touchPaintIntentLastHoldDurationMs: Number(counters.lastHoldDurationMs.toFixed(3)),
  };
}

function createCanvasInputRuntime(options: CanvasInputControllerOptions): CanvasInputRuntime {
  const { browser, engine } = options;
  const {
    canvas,
    selectionGestureCanvas,
    selectionGestureContext,
    status,
  } = options.elements;
  const abortController = new browser.AbortController();
  let disposed = false;
  let activePointerId: number | null = null;
  let pointerMode: CanvasPointerMode | null = null;
  let lastPanClientX = 0;
  let lastPanClientY = 0;
  let lastRotateClientX = 0;
  let rotateShortcutHeld = false;
  let fillPointerStartX = 0;
  let fillPointerStartY = 0;
  let fillPointerMoved = false;
  let selectionPointerStartX = 0;
  let selectionPointerStartY = 0;
  let selectionPointerMoved = false;
  let selectionTapMethod: SelectionMethod = "magic-wand";
  let lassoClientPoints: SelectionPoint[] = [];
  let lassoCombineMode: SelectionCombineMode = "replace";
  let selectionKeyboardCursorClientX = Number.NaN;
  let selectionKeyboardCursorClientY = Number.NaN;
  let selectionKeyboardCursorVisible = false;
  let selectionKeyboardLassoActive = false;
  const activeTouchContacts = new Map<number, TouchContact>();
  let touchNavigationGesture: TouchNavigationGesture | null = null;
  let touchPaintIntentHold: TouchPaintIntentHold | null = null;
  const touchPaintIntentCounters = {
    starts: 0,
    releasedByMovement: 0,
    releasedByTimeout: 0,
    releasedByPointerUp: 0,
    canceledForNavigation: 0,
    canceledForPointerEnd: 0,
    maximumBufferedSamples: 0,
    lastHoldDurationMs: 0,
  };

  const publishHistoryState = (): void => {
    options.onHistoryState(engine.getHistoryState());
    options.updateHistoryControls();
  };

  const normalizedPressure = (event: PointerEvent): number => {
    if (event.pointerType === "mouse") return 1;
    if (event.pressure > 0) return event.pressure;
    return event.pointerType === "pen" ? 0.5 : 0.65;
  };

  const toPointerSample = (event: PointerEvent): PointerSample => ({
    clientX: event.clientX,
    clientY: event.clientY,
    pressure: normalizedPressure(event),
    timeMs: event.timeStamp,
  });

  const syncSelectionGestureCanvasSize = (): void => {
    if (selectionGestureCanvas.width !== canvas.width) {
      selectionGestureCanvas.width = canvas.width;
    }
    if (selectionGestureCanvas.height !== canvas.height) {
      selectionGestureCanvas.height = canvas.height;
    }
  };

  const clientPointToSelectionCanvas = (point: SelectionPoint): SelectionPoint => {
    const rectangle = canvas.getBoundingClientRect();
    return {
      x: (point.x - rectangle.left) * canvas.width / Math.max(1, rectangle.width),
      y: (point.y - rectangle.top) * canvas.height / Math.max(1, rectangle.height),
    };
  };

  const ensureSelectionKeyboardCursor = (): void => {
    const rectangle = canvas.getBoundingClientRect();
    const minimumX = rectangle.left + 1;
    const maximumX = Math.max(minimumX, rectangle.right - 1);
    const minimumY = rectangle.top + 1;
    const maximumY = Math.max(minimumY, rectangle.bottom - 1);
    if (
      !Number.isFinite(selectionKeyboardCursorClientX)
      || !Number.isFinite(selectionKeyboardCursorClientY)
    ) {
      selectionKeyboardCursorClientX = rectangle.left + rectangle.width * 0.5;
      selectionKeyboardCursorClientY = rectangle.top + rectangle.height * 0.5;
    }
    selectionKeyboardCursorClientX = Math.min(
      maximumX,
      Math.max(minimumX, selectionKeyboardCursorClientX),
    );
    selectionKeyboardCursorClientY = Math.min(
      maximumY,
      Math.max(minimumY, selectionKeyboardCursorClientY),
    );
  };

  const drawLassoGesture = (): void => {
    syncSelectionGestureCanvasSize();
    selectionGestureContext.clearRect(
      0,
      0,
      selectionGestureCanvas.width,
      selectionGestureCanvas.height,
    );
    if (lassoClientPoints.length === 0 && !selectionKeyboardCursorVisible) {
      selectionGestureCanvas.hidden = true;
      return;
    }
    selectionGestureCanvas.hidden = false;
    selectionGestureContext.save();
    selectionGestureContext.lineCap = "round";
    selectionGestureContext.lineJoin = "round";
    const scale = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
    if (lassoClientPoints.length > 0) {
      selectionGestureContext.beginPath();
      const first = clientPointToSelectionCanvas(lassoClientPoints[0]);
      selectionGestureContext.moveTo(first.x, first.y);
      for (let index = 1; index < lassoClientPoints.length; index += 1) {
        const point = clientPointToSelectionCanvas(lassoClientPoints[index]);
        selectionGestureContext.lineTo(point.x, point.y);
      }
      selectionGestureContext.setLineDash([5 * scale, 4 * scale]);
      selectionGestureContext.lineWidth = 3 * scale;
      selectionGestureContext.strokeStyle = "rgba(0, 0, 0, 0.9)";
      selectionGestureContext.stroke();
      selectionGestureContext.lineDashOffset = -4 * scale;
      selectionGestureContext.lineWidth = 1.4 * scale;
      selectionGestureContext.strokeStyle = "rgba(255, 255, 255, 0.96)";
      selectionGestureContext.stroke();
    }
    if (selectionKeyboardCursorVisible) {
      ensureSelectionKeyboardCursor();
      const cursor = clientPointToSelectionCanvas({
        x: selectionKeyboardCursorClientX,
        y: selectionKeyboardCursorClientY,
      });
      const radius = 8 * scale;
      selectionGestureContext.setLineDash([]);
      selectionGestureContext.beginPath();
      selectionGestureContext.arc(cursor.x, cursor.y, radius, 0, Math.PI * 2);
      selectionGestureContext.moveTo(cursor.x - radius * 1.5, cursor.y);
      selectionGestureContext.lineTo(cursor.x + radius * 1.5, cursor.y);
      selectionGestureContext.moveTo(cursor.x, cursor.y - radius * 1.5);
      selectionGestureContext.lineTo(cursor.x, cursor.y + radius * 1.5);
      selectionGestureContext.lineWidth = 3 * scale;
      selectionGestureContext.strokeStyle = "rgba(0, 0, 0, 0.92)";
      selectionGestureContext.stroke();
      selectionGestureContext.lineWidth = 1.25 * scale;
      selectionGestureContext.strokeStyle = "rgba(255, 255, 255, 0.98)";
      selectionGestureContext.stroke();
    }
    selectionGestureContext.restore();
  };

  const appendLassoClientPoint = (clientX: number, clientY: number): void => {
    const previous = lassoClientPoints[lassoClientPoints.length - 1];
    if (previous && Math.hypot(clientX - previous.x, clientY - previous.y) < 0.5) return;
    lassoClientPoints.push({ x: clientX, y: clientY });
  };

  const clearLassoGesture = (): void => {
    lassoClientPoints = [];
    selectionGestureContext.clearRect(
      0,
      0,
      selectionGestureCanvas.width,
      selectionGestureCanvas.height,
    );
    if (selectionKeyboardCursorVisible) drawLassoGesture();
    else selectionGestureCanvas.hidden = true;
  };

  const cancelKeyboardSelectionGesture = (hideCursor: boolean): void => {
    selectionKeyboardLassoActive = false;
    if (hideCursor) selectionKeyboardCursorVisible = false;
    clearLassoGesture();
  };

  const clearTouchPaintIntentTimer = (hold: TouchPaintIntentHold): void => {
    browser.clearTimeout(hold.timeoutId);
  };

  const releasePointerCapture = (pointerId: number): void => {
    try {
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    } catch {
      // The element can already be detached while pagehide is disposing the app.
    }
  };

  const releaseTouchPaintIntentHold = (
    reason: TouchPaintIntentReleaseReason,
  ): boolean => {
    const hold = touchPaintIntentHold;
    if (!hold) return false;
    clearTouchPaintIntentTimer(hold);
    touchPaintIntentHold = null;
    if (activePointerId !== hold.pointerId || pointerMode !== "paint") {
      touchPaintIntentCounters.canceledForPointerEnd += 1;
      return false;
    }
    touchPaintIntentCounters.lastHoldDurationMs = Math.max(
      0,
      browser.performance.now() - hold.startedAtPerformanceMs,
    );
    if (reason === "movement") touchPaintIntentCounters.releasedByMovement += 1;
    else if (reason === "timeout") touchPaintIntentCounters.releasedByTimeout += 1;
    else touchPaintIntentCounters.releasedByPointerUp += 1;

    if (!engine.beginStroke(hold.initialSample)) {
      activeTouchContacts.delete(hold.pointerId);
      activePointerId = null;
      pointerMode = null;
      releasePointerCapture(hold.pointerId);
      options.getEditorExtension()?.cancelPaintRecording?.();
      publishHistoryState();
      return false;
    }
    if (hold.bufferedSamples.length > 0) engine.extendStroke(hold.bufferedSamples);
    return true;
  };

  const startTouchPaintIntentHold = (
    pointerId: number,
    initialSample: PointerSample,
  ): void => {
    if (touchPaintIntentHold) clearTouchPaintIntentTimer(touchPaintIntentHold);
    const hold: TouchPaintIntentHold = {
      pointerId,
      initialSample,
      bufferedSamples: [],
      startedAtPerformanceMs: browser.performance.now(),
      timeoutId: 0,
    };
    touchPaintIntentHold = hold;
    touchPaintIntentCounters.starts += 1;
    hold.timeoutId = browser.setTimeout(() => {
      if (disposed || touchPaintIntentHold !== hold) return;
      releaseTouchPaintIntentHold("timeout");
    }, TOUCH_PAINT_INTENT_HOLD_MS);
  };

  const cancelTouchPaintIntentHold = (
    reason: "navigation" | "pointer-end",
  ): boolean => {
    const hold = touchPaintIntentHold;
    if (!hold) return false;
    clearTouchPaintIntentTimer(hold);
    touchPaintIntentHold = null;
    touchPaintIntentCounters.lastHoldDurationMs = Math.max(
      0,
      browser.performance.now() - hold.startedAtPerformanceMs,
    );
    if (reason === "navigation") touchPaintIntentCounters.canceledForNavigation += 1;
    else touchPaintIntentCounters.canceledForPointerEnd += 1;
    return true;
  };

  const currentTouchNavigationGesture = (): TouchNavigationGesture | null => {
    const contacts = [...activeTouchContacts.values()];
    if (contacts.length === 0) return null;
    if (contacts.length === 1) {
      return {
        contactCount: 1,
        centerX: contacts[0].clientX,
        centerY: contacts[0].clientY,
        distance: 1,
        angle: 0,
      };
    }
    const first = contacts[0];
    const second = contacts[1];
    return {
      contactCount: contacts.length,
      centerX: (first.clientX + second.clientX) * 0.5,
      centerY: (first.clientY + second.clientY) * 0.5,
      distance: Math.max(
        1,
        Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
      ),
      angle: Math.atan2(second.clientY - first.clientY, second.clientX - first.clientX),
    };
  };

  const enterTouchNavigation = (): void => {
    if (pointerMode !== "touch-navigation") {
      if (pointerMode === "paint") {
        const canceledHeldIntent = cancelTouchPaintIntentHold("navigation");
        if (!canceledHeldIntent && !engine.cancelStrokeBeforeRender()) engine.endStroke();
        options.getEditorExtension()?.cancelPaintRecording?.();
      } else if (pointerMode === "liquify") {
        engine.endRasterLiquifyStroke(false);
        canvas.classList.remove("liquify-deforming");
      } else if (pointerMode === "fill") {
        fillPointerMoved = true;
      } else if (pointerMode === "selection-tap") {
        selectionPointerMoved = true;
      } else if (pointerMode === "selection-lasso") {
        clearLassoGesture();
      }
      options.getVectorController()?.beginViewGesture();
      engine.beginViewRotationGesture();
      pointerMode = "touch-navigation";
      canvas.classList.add("panning");
    }
    touchNavigationGesture = currentTouchNavigationGesture();
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (
      event.pointerType === "touch"
      && activePointerId !== null
      && activeTouchContacts.size > 0
      && !options.viewOperationLocked()
    ) {
      event.preventDefault();
      activeTouchContacts.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      canvas.setPointerCapture(event.pointerId);
      if (activeTouchContacts.size >= 2) enterTouchNavigation();
      return;
    }
    if (activePointerId !== null) return;

    const shouldRotate = event.pointerType === "mouse"
      && event.button === 0
      && rotateShortcutHeld;
    const shouldPan = event.shiftKey || event.button === 1 || event.button === 2;
    const activeTool = options.getActiveTool();
    const requestedPointerMode: CanvasPointerMode = shouldRotate
      ? "rotate"
      : shouldPan
        ? "pan"
        : activeTool === "fill"
          ? "fill"
          : activeTool === "liquify"
            ? "liquify"
            : activeTool === "selection"
              ? options.getSelectionMethod() === "lasso"
                ? "selection-lasso"
                : "selection-tap"
              : activeTool === "transform"
                ? "transform"
                : "paint";
    const viewNavigationRequested = requestedPointerMode === "pan"
      || requestedPointerMode === "rotate";
    const liquifyEditRequested = requestedPointerMode === "liquify"
      && options.isLiquifyEditActive();
    const blurTouchNavigationRequested = event.pointerType === "touch"
      && options.isDestructivePreviewNavigationActive();
    if (
      (viewNavigationRequested || blurTouchNavigationRequested)
        ? options.viewOperationLocked()
        : options.operationLocked(liquifyEditRequested)
    ) {
      if (options.getHistoryState().openEdit === "raster-property") {
        status.textContent = "Completo la modifica dell'effetto prima del tratto…";
        status.className = "status";
      }
      return;
    }

    if (blurTouchNavigationRequested) {
      event.preventDefault();
      activePointerId = event.pointerId;
      activeTouchContacts.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      canvas.setPointerCapture(event.pointerId);
      enterTouchNavigation();
      return;
    }

    const paintSample = requestedPointerMode === "paint" ? toPointerSample(event) : null;
    const liquifyPoint = requestedPointerMode === "liquify"
      ? engine.toLayerPoint({
        ...toPointerSample(event),
        pressure: event.pointerType === "pen" ? normalizedPressure(event) : 1,
      })
      : null;
    if (liquifyPoint && !engine.beginRasterLiquifyStroke(liquifyPoint)) {
      publishHistoryState();
      return;
    }
    const holdPaintIntent = paintSample !== null && shouldHoldTouchPaintIntent(
      options.touchPaintIntentHoldEnabled,
      event.pointerType,
      activeTool,
    );
    if (paintSample && !holdPaintIntent) {
      const extension = options.getEditorExtension();
      const extensionRecordingStarted = extension?.wantsPaintRecording?.() === true;
      if (extensionRecordingStarted) extension?.beginPaintRecording?.(event, paintSample);
      if (!engine.beginStroke(paintSample)) {
        if (extensionRecordingStarted) extension?.cancelPaintRecording?.();
        publishHistoryState();
        return;
      }
    }

    event.preventDefault();
    if (activeTool === "selection") cancelKeyboardSelectionGesture(true);
    activePointerId = event.pointerId;
    if (event.pointerType === "touch") {
      activeTouchContacts.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }
    pointerMode = requestedPointerMode;
    canvas.setPointerCapture(event.pointerId);

    if (pointerMode === "rotate") {
      options.getVectorController()?.beginViewGesture();
      engine.beginViewRotationGesture();
      canvas.classList.add("rotating");
      lastRotateClientX = event.clientX;
    } else if (pointerMode === "pan") {
      options.getVectorController()?.beginViewGesture();
      canvas.classList.add("panning");
      lastPanClientX = event.clientX;
      lastPanClientY = event.clientY;
    } else if (pointerMode === "fill") {
      fillPointerStartX = event.clientX;
      fillPointerStartY = event.clientY;
      fillPointerMoved = false;
    } else if (pointerMode === "selection-tap") {
      selectionPointerStartX = event.clientX;
      selectionPointerStartY = event.clientY;
      selectionPointerMoved = false;
      selectionTapMethod = options.getSelectionMethod();
    } else if (pointerMode === "selection-lasso") {
      lassoClientPoints = [];
      lassoCombineMode = options.getSelectionSettings().combineMode;
      appendLassoClientPoint(event.clientX, event.clientY);
      drawLassoGesture();
    } else if (pointerMode === "liquify") {
      canvas.classList.add("liquify-deforming");
    } else if (pointerMode === "paint" && paintSample && holdPaintIntent) {
      const extension = options.getEditorExtension();
      if (extension?.wantsPaintRecording?.() === true) {
        extension.beginPaintRecording?.(event, paintSample);
      }
      startTouchPaintIntentHold(event.pointerId, paintSample);
    }

    browser.requestAnimationFrame(() => {
      if (!disposed && activePointerId === event.pointerId) options.updateHistoryControls();
    });
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch" && activeTouchContacts.has(event.pointerId)) {
      activeTouchContacts.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
      if (pointerMode === "touch-navigation") {
        event.preventDefault();
        const nextGesture = currentTouchNavigationGesture();
        const previousGesture = touchNavigationGesture;
        if (nextGesture && previousGesture) {
          const deltaX = nextGesture.centerX - previousGesture.centerX;
          const deltaY = nextGesture.centerY - previousGesture.centerY;
          if (Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01) {
            engine.panByClientDelta(deltaX, deltaY);
          }
          if (nextGesture.contactCount >= 2 && previousGesture.contactCount >= 2) {
            const zoomFactor = nextGesture.distance / previousGesture.distance;
            if (Number.isFinite(zoomFactor) && Math.abs(zoomFactor - 1) > 0.0001) {
              engine.zoomBy(
                Math.min(2, Math.max(0.5, zoomFactor)),
                nextGesture.centerX,
                nextGesture.centerY,
              );
            }
            const rawRotationDelta = nextGesture.angle - previousGesture.angle;
            const rotationDelta = Math.atan2(
              Math.sin(rawRotationDelta),
              Math.cos(rawRotationDelta),
            );
            if (Math.abs(rotationDelta) > 0.0001) {
              engine.rotateViewBy(rotationDelta, nextGesture.centerX, nextGesture.centerY);
            }
          }
        }
        touchNavigationGesture = nextGesture;
        return;
      }
    }
    if (event.pointerId !== activePointerId || pointerMode === null) return;

    event.preventDefault();
    if (pointerMode === "rotate") {
      const deltaRadians = (event.clientX - lastRotateClientX) * Math.PI / 720;
      engine.rotateViewBy(deltaRadians);
      lastRotateClientX = event.clientX;
      return;
    }
    if (pointerMode === "pan") {
      engine.panByClientDelta(event.clientX - lastPanClientX, event.clientY - lastPanClientY);
      lastPanClientX = event.clientX;
      lastPanClientY = event.clientY;
      return;
    }
    if (pointerMode === "fill") {
      if (Math.hypot(event.clientX - fillPointerStartX, event.clientY - fillPointerStartY) > 8) {
        fillPointerMoved = true;
      }
      return;
    }
    if (pointerMode === "selection-tap") {
      if (
        Math.hypot(
          event.clientX - selectionPointerStartX,
          event.clientY - selectionPointerStartY,
        ) > 8
      ) {
        selectionPointerMoved = true;
      }
      return;
    }
    if (pointerMode === "selection-lasso") {
      const coalesced = (
        event as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] }
      ).getCoalescedEvents?.() ?? [];
      for (const source of coalesced.length > 0 ? coalesced : [event]) {
        appendLassoClientPoint(source.clientX, source.clientY);
      }
      drawLassoGesture();
      return;
    }
    if (pointerMode === "transform") return;

    const coalesced = (
      event as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] }
    ).getCoalescedEvents?.() ?? [];
    const sourceEvents = coalesced.length > 0 ? coalesced : [event];
    if (pointerMode === "liquify") {
      engine.extendRasterLiquifyStroke(sourceEvents.map((source) => engine.toLayerPoint({
        ...toPointerSample(source),
        pressure: source.pointerType === "pen" ? normalizedPressure(source) : 1,
      })));
      return;
    }
    const samples = sourceEvents.map(toPointerSample);
    options.getEditorExtension()?.capturePaintRecording?.(sourceEvents, samples);
    const heldIntent = touchPaintIntentHold;
    if (heldIntent?.pointerId === event.pointerId) {
      heldIntent.bufferedSamples.push(...samples);
      touchPaintIntentCounters.maximumBufferedSamples = Math.max(
        touchPaintIntentCounters.maximumBufferedSamples,
        heldIntent.bufferedSamples.length,
      );
      if (touchPaintIntentMovementReached(heldIntent.initialSample, samples)) {
        releaseTouchPaintIntentHold("movement");
      }
      return;
    }
    engine.extendStroke(samples);
  };

  const finishPointer = (event: PointerEvent): void => {
    if (event.pointerType === "touch") activeTouchContacts.delete(event.pointerId);
    if (pointerMode === "touch-navigation") {
      event.preventDefault();
      const remainingPointerId = activeTouchContacts.keys().next().value;
      activePointerId = typeof remainingPointerId === "number" ? remainingPointerId : null;
      touchNavigationGesture = currentTouchNavigationGesture();
      if (activeTouchContacts.size === 0) {
        engine.endViewRotationGesture();
        options.getVectorController()?.endViewGesture();
        canvas.classList.remove("panning");
        pointerMode = null;
        publishHistoryState();
      }
      return;
    }
    if (event.pointerId !== activePointerId) return;

    if (pointerMode === "paint" && touchPaintIntentHold?.pointerId === event.pointerId) {
      if (event.type === "pointerup") releaseTouchPaintIntentHold("pointer-up");
      else cancelTouchPaintIntentHold("pointer-end");
    }

    const fillRequest = pointerMode === "fill"
      && event.type === "pointerup"
      && !fillPointerMoved
      ? {
        clientX: event.clientX,
        clientY: event.clientY,
        tolerance: options.getFillSettings().tolerance,
        color: options.getBrushColor(),
      }
      : null;
    const selectionTapRequest = pointerMode === "selection-tap"
      && selectionTapMethod === "magic-wand"
      && event.type === "pointerup"
      && !selectionPointerMoved
      ? (() => {
        const selection = options.getSelectionSettings();
        return {
          clientX: event.clientX,
          clientY: event.clientY,
          tolerance: selection.tolerance,
          combineMode: selection.combineMode,
        };
      })()
      : null;
    if (pointerMode === "selection-lasso" && event.type === "pointerup") {
      appendLassoClientPoint(event.clientX, event.clientY);
    }
    const lassoRequest = pointerMode === "selection-lasso"
      && event.type === "pointerup"
      ? { points: lassoClientPoints.slice(), combineMode: lassoCombineMode }
      : null;

    const completedPointerMode = pointerMode;
    if (pointerMode === "paint") {
      engine.endStroke(event.timeStamp);
      options.getEditorExtension()?.finishPaintRecording?.(event.type === "pointerup");
    } else if (pointerMode === "liquify") {
      engine.endRasterLiquifyStroke(event.type === "pointerup");
    } else if (pointerMode === "rotate") {
      engine.endViewRotationGesture();
    }
    if (pointerMode === "rotate" || pointerMode === "pan") {
      options.getVectorController()?.endViewGesture();
    }
    canvas.classList.remove("panning", "rotating", "liquify-deforming");
    pointerMode = null;
    activePointerId = null;
    options.scheduleLayersRefresh();
    if (completedPointerMode === "paint") options.invalidateActiveThumbnail();
    touchNavigationGesture = null;
    fillPointerMoved = false;
    selectionPointerMoved = false;
    clearLassoGesture();
    publishHistoryState();

    if (fillRequest) {
      void engine.fillAtClientPoint(
        fillRequest.clientX,
        fillRequest.clientY,
        fillRequest.tolerance,
        fillRequest.color,
      ).catch((error) => {
        console.error("Riempimento WebGPU non riuscito", error);
      }).finally(() => {
        if (disposed) return;
        publishHistoryState();
        options.invalidateActiveThumbnail();
      });
    }
    if (selectionTapRequest) {
      options.runPixelSelectionOperation(() => engine.selectConnectedAtClientPoint(
        selectionTapRequest.clientX,
        selectionTapRequest.clientY,
        selectionTapRequest.tolerance,
        selectionTapRequest.combineMode,
      ));
    } else if (lassoRequest) {
      options.runPixelSelectionOperation(() => engine.selectPixelsByClientLasso(
        lassoRequest.points,
        lassoRequest.combineMode,
      ));
    }
  };

  const handleCanvasKeydown = (event: KeyboardEvent): void => {
    if (
      options.getActiveTool() !== "selection"
      || options.getSelectionMethod() === "color-range"
      || activePointerId !== null
      || options.operationLocked()
      || event.isComposing
      || event.altKey
      || event.ctrlKey
      || event.metaKey
    ) return;

    const method = options.getSelectionMethod();
    selectionKeyboardCursorVisible = true;
    ensureSelectionKeyboardCursor();
    const step = event.shiftKey ? 32 : 8;
    let moved = true;
    if (event.key === "ArrowLeft") selectionKeyboardCursorClientX -= step;
    else if (event.key === "ArrowRight") selectionKeyboardCursorClientX += step;
    else if (event.key === "ArrowUp") selectionKeyboardCursorClientY -= step;
    else if (event.key === "ArrowDown") selectionKeyboardCursorClientY += step;
    else moved = false;
    if (moved) {
      event.preventDefault();
      ensureSelectionKeyboardCursor();
      if (method === "lasso" && selectionKeyboardLassoActive) {
        appendLassoClientPoint(
          selectionKeyboardCursorClientX,
          selectionKeyboardCursorClientY,
        );
      }
      drawLassoGesture();
      return;
    }
    if (event.key === "Escape" && method === "lasso" && selectionKeyboardLassoActive) {
      event.preventDefault();
      cancelKeyboardSelectionGesture(false);
      status.textContent = "Lazo da tastiera annullato.";
      status.className = "status";
      return;
    }
    const activates = event.key === "Enter" || event.code === "Space";
    if (!activates) return;
    event.preventDefault();
    if (method === "magic-wand") {
      const selection = options.getSelectionSettings();
      options.runPixelSelectionOperation(() => engine.selectConnectedAtClientPoint(
        selectionKeyboardCursorClientX,
        selectionKeyboardCursorClientY,
        selection.tolerance,
        selection.combineMode,
      ));
      return;
    }
    if (event.code === "Space") {
      if (!selectionKeyboardLassoActive) {
        lassoClientPoints = [];
        lassoCombineMode = options.getSelectionSettings().combineMode;
        selectionKeyboardLassoActive = true;
        status.textContent =
          "Lazo da tastiera attivo: usa le frecce, Invio per chiudere, Esc per annullare.";
        status.className = "status";
      }
      appendLassoClientPoint(
        selectionKeyboardCursorClientX,
        selectionKeyboardCursorClientY,
      );
      drawLassoGesture();
      return;
    }
    if (event.key === "Enter" && selectionKeyboardLassoActive) {
      appendLassoClientPoint(
        selectionKeyboardCursorClientX,
        selectionKeyboardCursorClientY,
      );
      const points = lassoClientPoints.slice();
      const combineMode = lassoCombineMode;
      selectionKeyboardLassoActive = false;
      clearLassoGesture();
      options.runPixelSelectionOperation(() => engine.selectPixelsByClientLasso(
        points,
        combineMode,
      ));
    }
  };

  const keyboardEventTargetsEditable = (target: EventTarget | null): boolean => {
    const elementTarget = target instanceof browser.Element ? target : null;
    return Boolean(elementTarget?.closest("input, textarea, select, [contenteditable]"));
  };

  canvas.addEventListener("pointerdown", handlePointerDown, { signal: abortController.signal });
  canvas.addEventListener("pointermove", handlePointerMove, { signal: abortController.signal });
  canvas.addEventListener("pointerup", finishPointer, { signal: abortController.signal });
  canvas.addEventListener("pointercancel", finishPointer, { signal: abortController.signal });
  canvas.addEventListener("lostpointercapture", finishPointer, { signal: abortController.signal });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault(), {
    signal: abortController.signal,
  });
  canvas.addEventListener("focus", () => {
    if (
      options.getActiveTool() !== "selection"
      || options.getSelectionMethod() === "color-range"
      || activePointerId !== null
    ) return;
    selectionKeyboardCursorVisible = true;
    ensureSelectionKeyboardCursor();
    drawLassoGesture();
  }, { signal: abortController.signal });
  canvas.addEventListener("blur", () => cancelKeyboardSelectionGesture(true), {
    signal: abortController.signal,
  });
  canvas.addEventListener("keydown", handleCanvasKeydown, { signal: abortController.signal });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (options.viewOperationLocked() || activePointerId !== null) return;
    const factor = Math.exp(-event.deltaY * 0.0015);
    engine.zoomBy(Math.min(2, Math.max(0.5, factor)), event.clientX, event.clientY);
  }, { passive: false, signal: abortController.signal });

  browser.addEventListener("keydown", (event) => {
    if (
      event.defaultPrevented
      || event.isComposing
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.key.toLowerCase() !== "r"
      || keyboardEventTargetsEditable(event.target)
    ) return;
    rotateShortcutHeld = true;
    canvas.classList.add("rotation-ready");
    event.preventDefault();
  }, { signal: abortController.signal });
  browser.addEventListener("keyup", (event) => {
    if (event.key.toLowerCase() !== "r") return;
    rotateShortcutHeld = false;
    canvas.classList.remove("rotation-ready");
  }, { signal: abortController.signal });
  browser.addEventListener("blur", () => {
    rotateShortcutHeld = false;
    canvas.classList.remove("rotation-ready");
  }, { signal: abortController.signal });

  const resizeObserver = new browser.ResizeObserver(() => {
    if (disposed) return;
    engine.resizeCanvas();
    syncSelectionGestureCanvasSize();
    if (pointerMode === "selection-lasso" || selectionKeyboardCursorVisible) {
      drawLassoGesture();
    }
  });
  resizeObserver.observe(canvas);

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    abortController.abort();
    resizeObserver.disconnect();

    const mode = pointerMode;
    if (mode === "paint") {
      const canceledHeldIntent = cancelTouchPaintIntentHold("pointer-end");
      if (canceledHeldIntent) {
        options.getEditorExtension()?.cancelPaintRecording?.();
      } else {
        if (!engine.cancelStrokeBeforeRender()) engine.endStroke();
        options.getEditorExtension()?.finishPaintRecording?.(false);
      }
    } else if (mode === "liquify") {
      engine.endRasterLiquifyStroke(false);
    } else if (mode === "rotate" || mode === "touch-navigation") {
      engine.endViewRotationGesture();
    }
    if (mode === "rotate" || mode === "pan" || mode === "touch-navigation") {
      options.getVectorController()?.endViewGesture();
    }

    for (const pointerId of activeTouchContacts.keys()) {
      releasePointerCapture(pointerId);
    }
    if (activePointerId !== null) releasePointerCapture(activePointerId);
    activeTouchContacts.clear();
    activePointerId = null;
    pointerMode = null;
    rotateShortcutHeld = false;
    canvas.classList.remove("panning", "rotating", "rotation-ready", "liquify-deforming");
    selectionKeyboardCursorVisible = false;
    selectionKeyboardLassoActive = false;
    clearLassoGesture();
  };

  return {
    isPointerActive: () => activePointerId !== null,
    pointerMode: () => pointerMode,
    diagnostics: () => canvasInputDiagnostics(
      options.touchPaintIntentHoldEnabled,
      touchPaintIntentCounters,
    ),
    cancelKeyboardSelectionGesture,
    dispose,
  };
}
