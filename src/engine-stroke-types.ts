/**
 * Strutture interne del tratto raster: stamp accumulati, sessione attiva,
 * rettangoli sporchi e frame della coda di spessore.
 */
import type { DryBlendPlanner } from "./blend-core";
import type { DryBlendRenderBatch } from "./blend-renderer";
import type {
  BrushSettings,
  BrushTool,
  LayerPoint,
  PaintDabProfile,
} from "./engine-types";
import type { ShapeOccupancySelection } from "./shape-occupancy";
import type { CausalStrokeCurvePlanner } from "./stroke-curve-core";
import type {
  CausalFadedStrokeStabilizer,
  StrokeStabilizationUpdate,
} from "./stroke-stabilization-core";
import type {
  PackedStrokeGeometrySession,
  PackedStrokeStampResult,
  StrokeGeometryActiveBackend,
  StrokeGeometrySession,
  StrokeGeometryStats,
} from "./stroke-geometry-backend";
import type { StrokeSymmetryMode } from "./stroke-symmetry-core";

export interface Stamp {
  x: number;
  y: number;
  radius: number;
  pressure: number;
  seed: number;
  /** Ordered Shape texture-array layer selected for this base stamp. */
  shapeLayer: number;
  directionX: number;
  directionY: number;
  historyActionId: number;
  /** CPU metadata retained outside the fixed 32-byte GPU stamp record. */
  symmetryMode: StrokeSymmetryMode;
  symmetryAngleRadians: number;
}

/** One already-packed GPU upload owned by a single Paint history action. */
export interface PendingPackedStampBatch {
  readonly packedStamps: Uint8Array;
  readonly stampCount: number;
  readonly firstSeed: number;
  readonly dirtyRect: DirtyRect;
  readonly minimumRadius: number;
  readonly historyActionId: number;
  readonly symmetryMode: StrokeSymmetryMode;
  readonly symmetryAngleRadians: number;
}

/** Consecutive packed chunks drained by one draw and one History capture. */
export interface PackedStampSubmission {
  readonly chunks: readonly PendingPackedStampBatch[];
  readonly stampCount: number;
  readonly firstSeed: number;
  readonly dirtyRect: DirtyRect;
  readonly minimumRadius: number;
  readonly historyActionId: number;
  readonly symmetryMode: StrokeSymmetryMode;
  readonly symmetryAngleRadians: number;
}

export interface HeldThicknessStamp {
  stamp: Stamp;
  timeMs: number;
  baseRadius: number;
  liveThicknessFactor: number;
}

export interface ActiveStroke {
  tool: BrushTool;
  /** Immutable brush controls used to generate and render this gesture. */
  renderSettings: BrushSettings;
  /** Immutable document-space reflection selected when the gesture begins. */
  readonly symmetryMode: StrokeSymmetryMode;
  readonly symmetryAngleRadians: number;
  lastInput: LayerPoint;
  startedAtMs: number;
  thicknessSettings: Pick<BrushSettings, "startThickness" | "endThickness">;
  thicknessDynamicsNeutral: boolean;
  thicknessTailHoldback: boolean;
  heldThicknessStamps: HeldThicknessStamp[];
  heldThicknessHead: number;
  /** Generation semantics captured at pointer-down. */
  paintDabProfile: PaintDabProfile;
  distanceSinceStamp: number;
  /** Remaining path length used only by variable direct-deposit spacing. */
  distanceToNextStamp: number;
  adaptiveSpacingInitialPercent: number;
  adaptiveSpacingPercent: number;
  historyActionId: number;
  historyCommitted: boolean;
  submitted: boolean;
  seedSequenceBeforeStroke: number;
  lightGlazeSettings: BrushSettings | null;
  blendSettings: BrushSettings | null;
  blendPlanner: DryBlendPlanner | null;
  curvePlanner: CausalStrokeCurvePlanner | null;
  stabilizer: CausalFadedStrokeStabilizer | null;
  stabilizationUpdate: Readonly<StrokeStabilizationUpdate> | null;
  /** CPU geometry implementation fixed for the complete gesture. */
  strokeGeometryBackend: StrokeGeometryActiveBackend;
  /** Present only for a compatible, prewarmed stabilized gesture. */
  strokeGeometrySession: StrokeGeometrySession | null;
  /** Strict packed session: authoritative dabs leave Wasm as GPU records. */
  packedStrokeGeometrySession: PackedStrokeGeometrySession | null;
  /** Latest revisionable tail geometry emitted by the Wasm session. */
  strokeGeometryPreviewDabs: Float64Array | null;
  /** Latest revisionable tail already encoded as fixed 32-byte GPU records. */
  strokeGeometryPreviewPackedStamps: PackedStrokeStampResult | null;
  /** Cumulative counters returned by the active Wasm session. */
  strokeGeometryStats: StrokeGeometryStats | null;
  stabilizationCommittedInput: LayerPoint;
  /**
   * Once the Quick Line hold gesture has activated, its replacement geometry
   * renders into a preview surface. Ordinary freehand never uses this path.
   * Preview stamps become authoritative only when Quick Line is released.
   */
  deferredPreview: boolean;
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
  symmetryMode: StrokeSymmetryMode;
  symmetryAngleRadians: number;
  stamps: Stamp[];
  /** Pixels changed by this frame and therefore requiring a redraw. */
  dirtyRect: DirtyRect;
  /** Complete transient surface bounds retained across incremental frames. */
  presentedRect: DirtyRect;
  shapeOccupancySelection: ShapeOccupancySelection | null;
  grainActive: boolean;
  originX: number;
  originY: number;
  /** How the transient patch combines with authoritative mip 0. */
  compositionMode: 0 | 1 | 2;
  /** Copies the permanent layer into the transient surface before drawing. */
  replacement: boolean;
  /** Loads the previous transient pixels and applies only this frame's stamps. */
  incremental: boolean;
  /** Presents the existing transient surface without mutating it. */
  retained: boolean;
}

export interface StabilizationTailFrame {
  settings: BrushSettings;
  symmetryMode: StrokeSymmetryMode;
  symmetryAngleRadians: number;
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
