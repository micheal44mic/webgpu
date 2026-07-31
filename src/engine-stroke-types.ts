/**
 * Strutture interne del tratto raster: stamp accumulati, sessione attiva,
 * rettangoli sporchi e frame della coda di spessore.
 */
import type { DryBlendPlanner } from "./blend-core";
import type { DryBlendRenderBatch } from "./blend-renderer";
import type { HistoryAction } from "./engine-history-types";
import type { BrushSettings, BrushTool, LayerPoint } from "./engine-types";
import type { ShapeOccupancySelection } from "./shape-occupancy";

export interface Stamp {
  x: number;
  y: number;
  radius: number;
  pressure: number;
  seed: number;
  directionX: number;
  directionY: number;
  historyActionId: number;
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
  seedSequenceBeforeStroke: number;
  historyCursorBeforeStroke: number;
  redoActionsBeforeStroke: HistoryAction[] | null;
  historyCompactionPendingBeforeStroke: boolean;
  lightGlazeSettings: BrushSettings | null;
  blendSettings: BrushSettings | null;
  blendPlanner: DryBlendPlanner | null;
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

export interface PendingBlendBatch {
  actionId: number;
  settings: BrushSettings;
  batch: DryBlendRenderBatch;
}
