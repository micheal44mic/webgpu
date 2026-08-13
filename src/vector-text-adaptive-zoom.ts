import type { VectorTextViewState } from "./vector-text-types";
import type { VectorTextNodeSeed } from "./scene-text-model";

/**
 * During a view gesture the last exact vector viewport is only presented, not
 * rebuilt. Every fast frame is reprojected through the current camera so text
 * and SVG never detach from the raster scene. A sharp capture handles covered
 * pixels; the optional wide capture fills newly exposed pixels. Without that
 * wide capture, the mapped primary is clipped while one bounded exact refresh
 * fills the newly exposed region.
 *
 * The semantic scene remains authoritative.  One exact redraw of the latest
 * revision replaces the transient presentation when the gesture settles.
 */
export const VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY =
  "gesture-window2-dual-gpu-auto-fallback-exact-settle-v7" as const;

export const VECTOR_TEXT_ADAPTIVE_ZOOM_SETTLE_MS = 140;
export const VECTOR_TEXT_FAST_PRESENTATION_FILTER_GUARD_PX = 0.5;
export const VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT = 2;
export const VECTOR_TEXT_WIDE_FALLBACK_MAX_ZOOM = 0.2;
export const VECTOR_TEXT_WIDE_FALLBACK_DOCUMENT_MARGIN = 0.94;

export const VECTOR_TEXT_ZOOM_STRESS_STRATEGY =
  "ten-semantic-text-seeded-arch-drop-block-inner-center-zoom64-v1" as const;
export const VECTOR_TEXT_ZOOM_STRESS_SEED = 0x5a17c0de;
export const VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT = 10;
export const VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM = 64;
export const VECTOR_TEXT_ZOOM_STRESS_SLOW_FRAME_MS = 20;
export const VECTOR_TEXT_ZOOM_STRESS_STEP_FACTOR = 1.42;
export const VECTOR_TEXT_ZOOM_AB_STRATEGY =
  "ten-semantic-text-pan180-refresh-during-vs-release-v1" as const;
export const VECTOR_TEXT_ZOOM_AB_IDLE_FRAME_COUNT = 30;
export const VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT = 180;
export const VECTOR_TEXT_ZOOM_AB_START_ZOOM = 64;
export const VECTOR_TEXT_ZOOM_C_STRATEGY =
  "ten-semantic-text-dual-gpu-fallback-auto-post-raster-window2-zoom8-to-0.3-v6" as const;
export const VECTOR_TEXT_ZOOM_C_IDLE_FRAME_COUNT = 30;
export const VECTOR_TEXT_ZOOM_C_SAMPLE_LIMIT = 120;
export const VECTOR_TEXT_ZOOM_C_GESTURE_DURATION_MS = 650;
export const VECTOR_TEXT_ZOOM_C_START_ZOOM = 8;
export const VECTOR_TEXT_ZOOM_C_TARGET_ZOOM = 0.3;
export const VECTOR_TEXT_ZOOM_C_FALLBACK_ZOOM = 0.2;

export type VectorTextZoomStressProfile =
  | "arch"
  | "drop-shadow"
  | "block-shadow"
  | "inner-shadow";

export const VECTOR_TEXT_ZOOM_STRESS_PROFILE_ORDER:
readonly VectorTextZoomStressProfile[] = [
  "arch",
  "drop-shadow",
  "block-shadow",
  "inner-shadow",
  "arch",
  "drop-shadow",
  "block-shadow",
  "inner-shadow",
  "arch",
  "drop-shadow",
];

function vectorTextZoomStressUnit(index: number, salt: number): number {
  let value = (
    VECTOR_TEXT_ZOOM_STRESS_SEED
    ^ Math.imul(index + 1, 0x9e3779b1)
    ^ Math.imul(salt + 1, 0x85ebca6b)
  ) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return value / 0x1_0000_0000;
}

export function vectorTextZoomStressSeed(
  index: number,
  documentWidth: number,
  documentHeight: number = documentWidth,
): { profile: VectorTextZoomStressProfile; seed: VectorTextNodeSeed } {
  if (!Number.isInteger(index) || index < 0 || index >= VECTOR_TEXT_ZOOM_STRESS_TEXT_COUNT) {
    throw new RangeError(`Indice testo stress zoom fuori range: ${index}.`);
  }
  const profile = VECTOR_TEXT_ZOOM_STRESS_PROFILE_ORDER[index];
  const palette = ["#f2f0e9", "#dd5c35", "#62a8e5", "#e7bd52", "#9c7cff"];
  const label = profile === "arch"
    ? "ARCH"
    : profile === "drop-shadow"
      ? "DROP"
      : profile === "block-shadow"
        ? "BLOCK"
        : "INNER";
  const centerJitter = 0.06;
  return {
    profile,
    seed: {
      text: `${label} ${String(index + 1).padStart(2, "0")}`,
      fontFamily: ["Anton", "Bebas Neue", "Poppins"][index % 3],
      fontSize: 260 + Math.round(vectorTextZoomStressUnit(index, 0) * 80),
      color: palette[index % palette.length],
      transformType: profile === "arch" ? "arch" : "none",
      transformCurve: 55 + Math.round(vectorTextZoomStressUnit(index, 1) * 50),
      circleRadiusPercent: 50,
      circleInverted: false,
      distortPoints: null,
      outlineWidth: 0,
      outlineColor: "#202226",
      outlineJoin: "round",
      blockShadowEnabled: profile === "block-shadow",
      blockShadowColor: "#202226",
      blockShadowOpacity: 0.9,
      blockShadowOffset: 24 + Math.round(vectorTextZoomStressUnit(index, 2) * 24),
      blockShadowAngle: -135 + Math.round(vectorTextZoomStressUnit(index, 3) * 90),
      blockShadowOutlineWidth: 0,
      singleShadowEnabled: profile === "drop-shadow",
      singleShadowColor: "#101216",
      singleShadowOpacity: 0.75,
      singleShadowOffset: 20 + Math.round(vectorTextZoomStressUnit(index, 4) * 28),
      singleShadowAngle: -180 + Math.round(vectorTextZoomStressUnit(index, 5) * 90),
      singleShadowBlur: 6 + Math.round(vectorTextZoomStressUnit(index, 6) * 10),
      innerShadowEnabled: profile === "inner-shadow",
      innerShadowColor: "#050608",
      innerShadowOpacity: 0.7,
      innerShadowOffset: 8 + Math.round(vectorTextZoomStressUnit(index, 7) * 12),
      innerShadowAngle: -180 + Math.round(vectorTextZoomStressUnit(index, 8) * 90),
      innerShadowBlur: 5 + Math.round(vectorTextZoomStressUnit(index, 9) * 9),
      // All ten nodes deliberately overlap the zoom anchor. At 64× each one
      // still contributes real vector work instead of leaving the viewport.
      x: documentWidth * 0.5
        + (vectorTextZoomStressUnit(index, 10) - 0.5) * centerJitter,
      y: documentHeight * 0.5
        + (vectorTextZoomStressUnit(index, 11) - 0.5) * centerJitter,
      scale: 0.92 + vectorTextZoomStressUnit(index, 12) * 0.16,
      rotation: (vectorTextZoomStressUnit(index, 13) - 0.5) * Math.PI / 45,
    },
  };
}

const VECTOR_TEXT_ZOOM_C_POSITIONS = [
  [0, 0],
  [-0.7, -0.7],
  [0, -0.7],
  [0.7, -0.7],
  [-0.7, 0],
  [0.7, 0],
  [-0.7, 0.7],
  [0, 0.7],
  [0.7, 0.7],
  [0.35, 0.35],
] as const;

/**
 * The C fixture keeps the same deterministic effect mix as the A/B fixture,
 * but distributes the witnesses across the document. Most witnesses therefore
 * start outside the sharp 8x capture and become visible during the zoom-out.
 */
export function vectorTextZoomCoverageSeed(
  index: number,
  documentWidth: number,
  documentHeightOrViewport: number | {
    canvasWidth: number;
    canvasHeight: number;
    targetZoom: number;
  } = documentWidth,
  viewportOverride?: {
    canvasWidth: number;
    canvasHeight: number;
    targetZoom: number;
  },
): { profile: VectorTextZoomStressProfile; seed: VectorTextNodeSeed } {
  const documentHeight = typeof documentHeightOrViewport === "number"
    ? documentHeightOrViewport
    : documentWidth;
  const viewport = typeof documentHeightOrViewport === "number"
    ? viewportOverride ?? {
      canvasWidth: documentWidth,
      canvasHeight: documentHeight,
      targetZoom: 1,
    }
    : documentHeightOrViewport;
  const fixture = vectorTextZoomStressSeed(index, documentWidth, documentHeight);
  const position = VECTOR_TEXT_ZOOM_C_POSITIONS[index];
  const targetZoom = Number.isFinite(viewport.targetZoom) && viewport.targetZoom > 0
    ? viewport.targetZoom
    : 1;
  const horizontalReach = Math.min(
    documentWidth * 0.42,
    Math.max(0, viewport.canvasWidth) / (2 * targetZoom) * 0.88,
  );
  const verticalReach = Math.min(
    documentHeight * 0.42,
    Math.max(0, viewport.canvasHeight) / (2 * targetZoom) * 0.88,
  );
  return {
    profile: fixture.profile,
    seed: {
      ...fixture.seed,
      x: documentWidth * 0.5 + horizontalReach * position[0],
      y: documentHeight * 0.5 + verticalReach * position[1],
      rotation: 0,
    },
  };
}

export function vectorTextZoomStressStepFactor(currentZoom: number): number {
  if (!Number.isFinite(currentZoom) || currentZoom <= 0) return 1;
  return Math.max(
    1,
    Math.min(
      VECTOR_TEXT_ZOOM_STRESS_STEP_FACTOR,
      VECTOR_TEXT_ZOOM_STRESS_TARGET_ZOOM / currentZoom,
    ),
  );
}

export type VectorTextFastPresentationMode =
  | "precise"
  | "reproject"
  | "reproject-fallback"
  | "reproject-clipped";

function finiteView(view: Readonly<VectorTextViewState>): boolean {
  return Number.isFinite(view.canvasWidth)
    && Number.isFinite(view.canvasHeight)
    && Number.isFinite(view.centerX)
    && Number.isFinite(view.centerY)
    && Number.isFinite(view.zoom)
    && view.canvasWidth > 0
    && view.canvasHeight > 0
    && view.zoom > 0
    && Number.isFinite(view.rotationCos)
    && Number.isFinite(view.rotationSin);
}

function currentCanvasPointInCapture(
  x: number,
  y: number,
  capture: Readonly<VectorTextViewState>,
  current: Readonly<VectorTextViewState>,
): readonly [number, number] {
  const currentOffsetX = (x - current.canvasWidth * 0.5) / current.zoom;
  const currentOffsetY = (y - current.canvasHeight * 0.5) / current.zoom;
  const layerX = current.centerX
    + current.rotationCos * currentOffsetX
    + current.rotationSin * currentOffsetY;
  const layerY = current.centerY
    - current.rotationSin * currentOffsetX
    + current.rotationCos * currentOffsetY;
  const captureDeltaX = layerX - capture.centerX;
  const captureDeltaY = layerY - capture.centerY;
  return [
    capture.canvasWidth * 0.5 + capture.zoom * (
      capture.rotationCos * captureDeltaX
      - capture.rotationSin * captureDeltaY
    ),
    capture.canvasHeight * 0.5 + capture.zoom * (
      capture.rotationSin * captureDeltaX
      + capture.rotationCos * captureDeltaY
    ),
  ];
}

/**
 * Pure coverage guard shared by runtime and verification. Every fast mode uses
 * the same camera reprojection. The fallback variant means the primary is
 * incomplete but the wide capture fully covers the current view.
 */
function vectorTextCaptureCoversView(
  capture: Readonly<VectorTextViewState> | null,
  current: Readonly<VectorTextViewState>,
): boolean {
  if (!capture || !finiteView(capture) || !finiteView(current)) {
    return false;
  }
  if (
    capture.canvasWidth !== current.canvasWidth
    || capture.canvasHeight !== current.canvasHeight
  ) {
    return false;
  }

  const guard = VECTOR_TEXT_FAST_PRESENTATION_FILTER_GUARD_PX;
  const left = guard;
  const top = guard;
  const right = Math.max(left, current.canvasWidth - guard);
  const bottom = Math.max(top, current.canvasHeight - guard);
  const captureRight = capture.canvasWidth - guard;
  const captureBottom = capture.canvasHeight - guard;
  const epsilon = 1e-4;
  for (const [x, y] of [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ] as const) {
    const [captureX, captureY] = currentCanvasPointInCapture(
      x,
      y,
      capture,
      current,
    );
    if (
      captureX < guard - epsilon
      || captureY < guard - epsilon
      || captureX > captureRight + epsilon
      || captureY > captureBottom + epsilon
    ) {
      return false;
    }
  }
  return true;
}

function layerPointInCapture(
  x: number,
  y: number,
  capture: Readonly<VectorTextViewState>,
): readonly [number, number] {
  const deltaX = x - capture.centerX;
  const deltaY = y - capture.centerY;
  return [
    capture.canvasWidth * 0.5 + capture.zoom * (
      capture.rotationCos * deltaX - capture.rotationSin * deltaY
    ),
    capture.canvasHeight * 0.5 + capture.zoom * (
      capture.rotationSin * deltaX + capture.rotationCos * deltaY
    ),
  ];
}

/**
 * A production fallback represents the whole document, not the empty area
 * around it. Once all four document corners fit, it can safely supply vector
 * pixels at any zoom-out or pan while the primary capture stays sharp.
 */
export function vectorTextCaptureCoversDocument(
  capture: Readonly<VectorTextViewState> | null,
  documentWidth: number,
  documentHeight: number = documentWidth,
): boolean {
  if (
    !capture
    || !finiteView(capture)
    || !Number.isFinite(documentWidth)
    || !Number.isFinite(documentHeight)
    || documentWidth <= 0
    || documentHeight <= 0
  ) {
    return false;
  }
  const guard = VECTOR_TEXT_FAST_PRESENTATION_FILTER_GUARD_PX;
  const right = capture.canvasWidth - guard;
  const bottom = capture.canvasHeight - guard;
  const epsilon = 1e-4;
  for (const [x, y] of [
    [0, 0],
    [documentWidth, 0],
    [documentWidth, documentHeight],
    [0, documentHeight],
  ] as const) {
    const [captureX, captureY] = layerPointInCapture(x, y, capture);
    if (
      captureX < guard - epsilon
      || captureY < guard - epsilon
      || captureX > right + epsilon
      || captureY > bottom + epsilon
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Fixed, scene-relative camera used to rebuild the wide GPU cache without
 * moving the visible camera. The 0.2 cap keeps the iPhone fixture identical;
 * smaller viewports reduce the zoom just enough to retain the full document.
 */
export function vectorTextWideFallbackView(
  current: Readonly<VectorTextViewState>,
  documentWidth: number,
  documentHeight: number = documentWidth,
): VectorTextViewState {
  if (
    !finiteView(current)
    || !Number.isFinite(documentWidth)
    || !Number.isFinite(documentHeight)
    || documentWidth <= 0
    || documentHeight <= 0
  ) {
    throw new RangeError("Vista o dimensione documento non valida per la cache vettoriale larga.");
  }
  const fitZoom = Math.min(
    current.canvasWidth / documentWidth,
    current.canvasHeight / documentHeight,
  ) * VECTOR_TEXT_WIDE_FALLBACK_DOCUMENT_MARGIN;
  return {
    ...current,
    centerX: documentWidth * 0.5,
    centerY: documentHeight * 0.5,
    zoom: Math.min(VECTOR_TEXT_WIDE_FALLBACK_MAX_ZOOM, fitZoom),
    rotationRadians: 0,
    rotationCos: 1,
    rotationSin: 0,
  };
}

export function vectorTextFastPresentationMode(
  capture: Readonly<VectorTextViewState> | null,
  current: Readonly<VectorTextViewState>,
  fallbackCapture: Readonly<VectorTextViewState> | null = null,
  documentWidth?: number,
  documentHeight: number = documentWidth ?? Number.NaN,
): VectorTextFastPresentationMode {
  if (vectorTextCaptureCoversView(capture, current)) {
    return "reproject";
  }
  const fallbackCovers = documentWidth === undefined
    ? vectorTextCaptureCoversView(fallbackCapture, current)
    : vectorTextCaptureCoversDocument(fallbackCapture, documentWidth, documentHeight);
  if (fallbackCovers) {
    return "reproject-fallback";
  }
  return "reproject-clipped";
}

/** A recovery callback is valid only for the newest idle view revision. */
export function vectorTextExactRecoveryIsCurrent(
  scheduledRevision: number,
  currentRevision: number,
  gestureActive: boolean,
): boolean {
  return !gestureActive
    && Number.isSafeInteger(scheduledRevision)
    && scheduledRevision === currentRevision;
}
