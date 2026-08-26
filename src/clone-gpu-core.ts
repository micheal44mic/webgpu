import {
  normalizeCloneAngleDegrees,
  type ClonePoint,
  type CloneSampleMode,
} from "./clone-interaction-core";
import type { DirtyRect, Stamp } from "./engine-stroke-types";
import type { BrushSettings } from "./engine-types";

export const CLONE_SOURCE_TILE_GRID_SIZE = 16;
export const CLONE_SOURCE_PAGE_TABLE_LENGTH =
  CLONE_SOURCE_TILE_GRID_SIZE * CLONE_SOURCE_TILE_GRID_SIZE;
export const CLONE_SOURCE_INITIAL_ATLAS_LAYERS = 4;
export const CLONE_SOURCE_UNIFORM_BYTES = 256;
export const CLONE_HISTORY_BUFFER_ALIGNMENT_BYTES = 256;

export interface CloneSourceLayout {
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly gridSize: typeof CLONE_SOURCE_TILE_GRID_SIZE;
}

export interface CloneSourceTileRect extends DirtyRect {
  readonly index: number;
  readonly tileX: number;
  readonly tileY: number;
}

export interface CloneStrokeConfiguration {
  readonly sampleMode: CloneSampleMode;
  readonly sourceX: number;
  readonly sourceY: number;
  readonly destinationX: number;
  readonly destinationY: number;
  readonly angleDegrees: number;
}

export interface CloneSourceTransform {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly destinationX: number;
  readonly destinationY: number;
  readonly rotationCos: number;
  readonly rotationSin: number;
  readonly angleDegrees: number;
}

function finiteF32(value: number): number {
  return Math.fround(Number.isFinite(value) ? value : 0);
}

function snappedF32Trig(value: number): number {
  if (Math.abs(value) < 1e-12) return 0;
  if (Math.abs(value - 1) < 1e-12) return 1;
  if (Math.abs(value + 1) < 1e-12) return -1;
  return Math.fround(value);
}

export function createCloneSourceTransform(
  configuration: Pick<
    CloneStrokeConfiguration,
    "sourceX" | "sourceY" | "destinationX" | "destinationY" | "angleDegrees"
  >,
): CloneSourceTransform {
  const angleDegrees = normalizeCloneAngleDegrees(configuration.angleDegrees);
  const radians = angleDegrees * Math.PI / 180;
  return {
    sourceX: finiteF32(configuration.sourceX),
    sourceY: finiteF32(configuration.sourceY),
    destinationX: finiteF32(configuration.destinationX),
    destinationY: finiteF32(configuration.destinationY),
    rotationCos: snappedF32Trig(Math.cos(radians)),
    // Destination-to-source lookup is the inverse transform. This makes a
    // positive UI angle rotate the cloned appearance clockwise on a y-down canvas.
    rotationSin: snappedF32Trig(-Math.sin(radians)),
    angleDegrees,
  };
}

export function cloneSourcePointForDestination(
  transform: Readonly<CloneSourceTransform>,
  destination: Readonly<ClonePoint>,
): ClonePoint {
  const deltaX = destination.x - transform.destinationX;
  const deltaY = destination.y - transform.destinationY;
  return {
    x: transform.sourceX
      + transform.rotationCos * deltaX
      - transform.rotationSin * deltaY,
    y: transform.sourceY
      + transform.rotationSin * deltaX
      + transform.rotationCos * deltaY,
  };
}

export function cloneSourceLayout(
  documentWidth: number,
  documentHeight: number,
): CloneSourceLayout {
  const width = Math.max(1, Math.floor(documentWidth));
  const height = Math.max(1, Math.floor(documentHeight));
  return {
    documentWidth: width,
    documentHeight: height,
    tileWidth: Math.ceil(width / CLONE_SOURCE_TILE_GRID_SIZE),
    tileHeight: Math.ceil(height / CLONE_SOURCE_TILE_GRID_SIZE),
    gridSize: CLONE_SOURCE_TILE_GRID_SIZE,
  };
}

export function cloneSourceTileRect(
  layout: Readonly<CloneSourceLayout>,
  index: number,
): CloneSourceTileRect {
  if (!Number.isInteger(index) || index < 0 || index >= CLONE_SOURCE_PAGE_TABLE_LENGTH) {
    throw new RangeError("Clone source tile index is outside the document grid.");
  }
  const tileX = index % layout.gridSize;
  const tileY = Math.floor(index / layout.gridSize);
  const x = tileX * layout.tileWidth;
  const y = tileY * layout.tileHeight;
  return {
    index,
    tileX,
    tileY,
    x,
    y,
    width: Math.max(0, Math.min(layout.tileWidth, layout.documentWidth - x)),
    height: Math.max(0, Math.min(layout.tileHeight, layout.documentHeight - y)),
  };
}

export function cloneSourceTileIndicesForRect(
  layout: Readonly<CloneSourceLayout>,
  destinationRect: Readonly<DirtyRect> | null,
  transform: Readonly<CloneSourceTransform>,
  halo = 1,
): number[] {
  if (!destinationRect || destinationRect.width <= 0 || destinationRect.height <= 0) {
    return [];
  }
  const padding = Math.max(0, Number.isFinite(halo) ? Math.ceil(halo) : 0);
  const destinationRight = destinationRect.x + destinationRect.width;
  const destinationBottom = destinationRect.y + destinationRect.height;
  const corners = [
    cloneSourcePointForDestination(transform, {
      x: destinationRect.x,
      y: destinationRect.y,
    }),
    cloneSourcePointForDestination(transform, {
      x: destinationRight,
      y: destinationRect.y,
    }),
    cloneSourcePointForDestination(transform, {
      x: destinationRect.x,
      y: destinationBottom,
    }),
    cloneSourcePointForDestination(transform, {
      x: destinationRight,
      y: destinationBottom,
    }),
  ];
  const sourceLeft = Math.min(...corners.map((point) => point.x));
  const sourceTop = Math.min(...corners.map((point) => point.y));
  const sourceRight = Math.max(...corners.map((point) => point.x));
  const sourceBottom = Math.max(...corners.map((point) => point.y));
  const left = Math.max(0, Math.floor(sourceLeft) - padding);
  const top = Math.max(0, Math.floor(sourceTop) - padding);
  const right = Math.min(
    layout.documentWidth,
    Math.ceil(sourceRight) + padding,
  );
  const bottom = Math.min(
    layout.documentHeight,
    Math.ceil(sourceBottom) + padding,
  );
  if (right <= left || bottom <= top) return [];

  const firstX = Math.max(0, Math.floor(left / layout.tileWidth));
  const firstY = Math.max(0, Math.floor(top / layout.tileHeight));
  const lastX = Math.min(layout.gridSize - 1, Math.floor((right - 1) / layout.tileWidth));
  const lastY = Math.min(layout.gridSize - 1, Math.floor((bottom - 1) / layout.tileHeight));
  const result: number[] = [];
  for (let tileY = firstY; tileY <= lastY; tileY += 1) {
    for (let tileX = firstX; tileX <= lastX; tileX += 1) {
      result.push(tileY * layout.gridSize + tileX);
    }
  }
  return result;
}

export function cloneConservativeStampBounds(
  stamps: readonly Stamp[],
  settings: Pick<
    BrushSettings,
    | "shape"
    | "shapeRotation"
    | "shapeScatter"
    | "positionJitterLinear"
    | "positionJitterLateral"
  >,
): DirtyRect | null {
  if (stamps.length === 0) return null;
  const rotatedShape = settings.shape === "shape"
    && (settings.shapeRotation === "follow-stroke" || settings.shapeScatter >= 0.125);
  const shapeReach = rotatedShape ? Math.SQRT2 : 1;
  const jitterReach = 2 * (
    Math.max(0, settings.positionJitterLinear)
    + Math.max(0, settings.positionJitterLateral)
  );
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const stamp of stamps) {
    const radius = Math.max(0, stamp.radius) * (shapeReach + jitterReach) + 2;
    left = Math.min(left, stamp.x - radius);
    top = Math.min(top, stamp.y - radius);
    right = Math.max(right, stamp.x + radius);
    bottom = Math.max(bottom, stamp.y + radius);
  }
  return Number.isFinite(left) && right > left && bottom > top
    ? {
      x: Math.floor(left),
      y: Math.floor(top),
      width: Math.ceil(right) - Math.floor(left),
      height: Math.ceil(bottom) - Math.floor(top),
    }
    : null;
}

export function cloneHistoryBytesPerRow(tileWidth: number, bytesPerPixel: number): number {
  const rowBytes = Math.max(1, Math.ceil(tileWidth)) * Math.max(1, bytesPerPixel);
  return Math.ceil(rowBytes / CLONE_HISTORY_BUFFER_ALIGNMENT_BYTES)
    * CLONE_HISTORY_BUFFER_ALIGNMENT_BYTES;
}

export function cloneHistorySourceOffset(stampBytes: number): number {
  return Math.ceil(Math.max(0, stampBytes) / CLONE_HISTORY_BUFFER_ALIGNMENT_BYTES)
    * CLONE_HISTORY_BUFFER_ALIGNMENT_BYTES;
}

export function growCloneAtlasLayerCapacity(current: number, required: number): number {
  let capacity = Math.max(CLONE_SOURCE_INITIAL_ATLAS_LAYERS, Math.floor(current));
  const boundedRequired = Math.min(CLONE_SOURCE_PAGE_TABLE_LENGTH, Math.max(1, required));
  while (capacity < boundedRequired) capacity *= 2;
  return Math.min(CLONE_SOURCE_PAGE_TABLE_LENGTH, capacity);
}
