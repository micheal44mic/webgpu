/**
 * Strutture interne del tratto raster: stamp accumulati, sessione attiva,
 * rettangoli sporchi e frame della coda di spessore.
 */
import type { DryBlendPlanner } from "./blend-core";
import type { DryBlendRenderBatch } from "./blend-renderer";
import type { HistoryAction } from "./engine-history-types";
import type { BrushSettings, BrushTool, LayerPoint } from "./engine-types";
import type { ShapeOccupancySelection } from "./shape-occupancy";
import type { CausalStrokeCurvePlanner } from "./stroke-curve-core";
import type {
  CausalFadedStrokeStabilizer,
  StrokeStabilizationUpdate,
} from "./stroke-stabilization-core";

export interface Stamp {
  x: number;
  y: number;
  radius: number;
  pressure: number;
  seed: number;
  directionX: number;
  directionY: number;
  historyActionId: number;
  /** Set only while an end-thickness stamp is held after reserving History. */
  historyPayloadReserved?: boolean;
}

export interface HeldThicknessStamp {
  stamp: Stamp;
  timeMs: number;
  baseRadius: number;
  liveThicknessFactor: number;
}

export interface ActiveStroke {
  tool: BrushTool;
  lastInput: LayerPoint;
  startedAtMs: number;
  thicknessSettings: Pick<BrushSettings, "startThickness" | "endThickness">;
  thicknessDynamicsNeutral: boolean;
  thicknessTailHoldback: boolean;
  heldThicknessStamps: HeldThicknessStamp[];
  heldThicknessHead: number;
  distanceSinceStamp: number;
  adaptiveSpacingInitialPercent: number;
  adaptiveSpacingPercent: number;
  historyActionId: number;
  historyCommitted: boolean;
  submitted: boolean;
  /** Logical GPU payload accepted for this gesture; selection is accounted separately. */
  historyPayloadBytes: number;
  /** Once true, no later sample from this pointer gesture may mutate pixels. */
  historyCaptureLimitReached: boolean;
  seedSequenceBeforeStroke: number;
  historyCursorBeforeStroke: number;
  redoActionsBeforeStroke: HistoryAction[] | null;
  historyCompactionPendingBeforeStroke: boolean;
  lightGlazeSettings: BrushSettings | null;
  blendSettings: BrushSettings | null;
  blendPlanner: DryBlendPlanner | null;
  curvePlanner: CausalStrokeCurvePlanner | null;
  stabilizer: CausalFadedStrokeStabilizer | null;
  stabilizationUpdate: Readonly<StrokeStabilizationUpdate> | null;
  stabilizationCommittedInput: LayerPoint;
}

/**
 * One active gesture may own at most one ordinary History GPU page. Completed
 * gestures are drained to durable storage by idle maintenance.
 */
export const ACTIVE_STROKE_HISTORY_PAYLOAD_LIMIT_BYTES = 2 * 1024 * 1024;

export type ActiveStrokeHistoryPayloadReservation =
  | "accepted"
  | "accepted-at-limit"
  | "rejected-at-limit"
  | "rejected";

/**
 * Reserves logical payload before its corresponding Paint/Blend mutation is
 * enqueued. A rejected reservation must never be rendered.
 */
export function reserveActiveStrokeHistoryPayload(
  stroke: Pick<
    ActiveStroke,
    "historyPayloadBytes" | "historyCaptureLimitReached"
  >,
  payloadBytes: number,
): ActiveStrokeHistoryPayloadReservation {
  if (!Number.isInteger(payloadBytes) || payloadBytes <= 0) {
    throw new RangeError("La prenotazione History del tratto deve essere un numero di byte positivo.");
  }
  if (
    !Number.isInteger(stroke.historyPayloadBytes)
    || stroke.historyPayloadBytes < 0
    || stroke.historyPayloadBytes > ACTIVE_STROKE_HISTORY_PAYLOAD_LIMIT_BYTES
  ) {
    throw new Error("Contatore payload History del tratto non valido.");
  }
  if (stroke.historyCaptureLimitReached) return "rejected";
  if (payloadBytes > ACTIVE_STROKE_HISTORY_PAYLOAD_LIMIT_BYTES - stroke.historyPayloadBytes) {
    stroke.historyCaptureLimitReached = true;
    return "rejected-at-limit";
  }
  stroke.historyPayloadBytes += payloadBytes;
  if (stroke.historyPayloadBytes === ACTIVE_STROKE_HISTORY_PAYLOAD_LIMIT_BYTES) {
    stroke.historyCaptureLimitReached = true;
    return "accepted-at-limit";
  }
  return "accepted";
}

export interface DirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PackedStampUpload {
  dirtyRect: DirtyRect | null;
  minimumRadius: number;
}

export interface ThicknessTailFrame {
  settings: BrushSettings;
  stamps: Stamp[];
  dirtyRect: DirtyRect;
  shapeOccupancySelection: ShapeOccupancySelection | null;
  grainActive: boolean;
}

export interface StabilizationTailFrame {
  settings: BrushSettings;
  stampCount: number;
  dirtyRect: DirtyRect;
  shapeOccupancySelection: ShapeOccupancySelection | null;
  grainActive: boolean;
}

export interface PendingBlendBatch {
  actionId: number;
  settings: BrushSettings;
  batch: DryBlendRenderBatch;
}
