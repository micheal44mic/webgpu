/**
 * Deterministic dirty-region fixtures and planners used only by Editor Labs.
 * The production renderer deliberately does not import this module.
 */

export const DIRTY_REGION_TILE_SIZES = [64, 128, 256] as const;

export interface DirtyRegionRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DirtyRegionFixture {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly footprints: readonly DirtyRegionRect[];
  readonly physicalCopiesPerBaseStamp: number;
}

export interface DirtyRegionMipLevel {
  readonly level: number;
  readonly width: number;
  readonly height: number;
  readonly regions: readonly DirtyRegionRect[];
  readonly pixels: number;
}

export interface DirtyRegionMipPlan {
  readonly levels: readonly DirtyRegionMipLevel[];
  readonly totalPixels: number;
  readonly totalDraws: number;
}

export interface DirtyRegionCoverage {
  readonly footprintPixels: number;
  readonly regionPixels: number;
  readonly coveredFootprintPixels: number;
  readonly missedPixels: number;
  readonly extraPixels: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface MutableRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function integerRect(rect: DirtyRegionRect): DirtyRegionRect {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const right = Math.ceil(rect.x + rect.width);
  const bottom = Math.ceil(rect.y + rect.height);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

function clipRect(
  rect: DirtyRegionRect,
  width: number,
  height: number,
): DirtyRegionRect | null {
  const rounded = integerRect(rect);
  const x = Math.max(0, rounded.x);
  const y = Math.max(0, rounded.y);
  const right = Math.min(width, rounded.x + rounded.width);
  const bottom = Math.min(height, rounded.y + rounded.height);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

function footprintAt(point: Point, radius: number): DirtyRegionRect {
  const reach = Math.max(1, radius) + 2;
  return integerRect({
    x: point.x - reach,
    y: point.y - reach,
    width: reach * 2,
    height: reach * 2,
  });
}

function stampPolyline(
  points: readonly Point[],
  spacing: number,
  radius: number,
): DirtyRegionRect[] {
  if (points.length === 0) return [];
  const footprints = [footprintAt(points[0], radius)];
  const safeSpacing = Math.max(0.5, spacing);
  let distanceSinceLast = 0;

  for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
    const start = points[pointIndex - 1];
    const end = points[pointIndex];
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const segmentLength = Math.hypot(deltaX, deltaY);
    if (segmentLength <= Number.EPSILON) continue;

    let consumed = 0;
    while (distanceSinceLast + segmentLength - consumed >= safeSpacing) {
      const advance = safeSpacing - distanceSinceLast;
      consumed += advance;
      const t = Math.min(1, consumed / segmentLength);
      footprints.push(footprintAt({
        x: start.x + deltaX * t,
        y: start.y + deltaY * t,
      }, radius));
      distanceSinceLast = 0;
    }
    distanceSinceLast += segmentLength - consumed;
  }

  const last = points.at(-1)!;
  const finalFootprint = footprintAt(last, radius);
  const previous = footprints.at(-1)!;
  const previousCenterX = previous.x + previous.width * 0.5;
  const previousCenterY = previous.y + previous.height * 0.5;
  if (Math.hypot(last.x - previousCenterX, last.y - previousCenterY) > 0.5) {
    footprints.push(finalFootprint);
  }
  return footprints;
}

function deterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function createDirtyRegionFixtures(
  width: number,
  height: number,
): readonly DirtyRegionFixture[] {
  const scale = Math.min(width, height) / 2048;
  const horizontal = stampPolyline([
    { x: width * 0.08, y: height * 0.5 },
    { x: width * 0.92, y: height * 0.5 },
  ], 7 * scale, 28 * scale);
  const diagonal = stampPolyline([
    { x: width * 0.1, y: height * 0.12 },
    { x: width * 0.9, y: height * 0.88 },
  ], 7 * scale, 28 * scale);

  const curvePoints: Point[] = [];
  for (let index = 0; index <= 320; index += 1) {
    const t = index / 320;
    curvePoints.push({
      x: width * (0.08 + 0.84 * t),
      y: height * (0.5 + Math.sin(t * Math.PI * 2) * 0.31),
    });
  }
  const curve = stampPolyline(curvePoints, 5 * scale, 20 * scale);

  const random = deterministicRandom(0x51a7_c0de);
  const spray: DirtyRegionRect[] = [];
  for (let index = 0; index < 1_100; index += 1) {
    const t = index / 1_099;
    const centerX = width * (0.1 + 0.8 * t);
    const centerY = height * (0.5 + Math.sin(t * Math.PI * 3) * 0.18);
    const lateral = (random() + random() + random() - 1.5) * height * 0.16;
    const longitudinal = (random() - 0.5) * width * 0.035;
    spray.push(footprintAt({
      x: centerX + longitudinal,
      y: centerY + lateral,
    }, (4 + random() * 7) * scale));
  }

  const mirroredSeed = stampPolyline([
    { x: width * 0.1, y: height * 0.16 },
    { x: width * 0.9, y: height * 0.84 },
  ], 6 * scale, 24 * scale);
  const mirrored: DirtyRegionRect[] = [];
  for (const rect of mirroredSeed) {
    mirrored.push(rect, {
      x: width - rect.x - rect.width,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  }

  return [
    {
      id: "horizontal-control",
      label: "Orizzontale compatto",
      description: "Caso di controllo nel quale il rettangolo unico è già vicino all'ottimo.",
      footprints: horizontal,
      physicalCopiesPerBaseStamp: 1,
    },
    {
      id: "long-diagonal",
      label: "Diagonale lunga",
      description: "Tratto sottile che lascia gran parte del proprio AABB vuoto.",
      footprints: diagonal,
      physicalCopiesPerBaseStamp: 1,
    },
    {
      id: "s-curve",
      label: "Curva a S",
      description: "Curva ampia con due inversioni di direzione.",
      footprints: curve,
      physicalCopiesPerBaseStamp: 1,
    },
    {
      id: "textured-spray",
      label: "Dispersione testurizzata",
      description: "Impronte piccole e disperse lungo un gesto curvo.",
      footprints: spray,
      physicalCopiesPerBaseStamp: 1,
    },
    {
      id: "mirrored-diagonals",
      label: "Diagonali specchiate",
      description: "Due copie fisiche separate che condividono un AABB quasi quadrato.",
      footprints: mirrored,
      physicalCopiesPerBaseStamp: 2,
    },
  ];
}

export function buildDirtyAabb(
  footprints: readonly DirtyRegionRect[],
  width: number,
  height: number,
): readonly DirtyRegionRect[] {
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (const footprint of footprints) {
    const clipped = clipRect(footprint, width, height);
    if (!clipped) continue;
    left = Math.min(left, clipped.x);
    top = Math.min(top, clipped.y);
    right = Math.max(right, clipped.x + clipped.width);
    bottom = Math.max(bottom, clipped.y + clipped.height);
  }
  return right > left && bottom > top
    ? [{ x: left, y: top, width: right - left, height: bottom - top }]
    : [];
}

export function buildDirtyTileBands(
  footprints: readonly DirtyRegionRect[],
  width: number,
  height: number,
  tileSize: number,
): readonly DirtyRegionRect[] {
  const safeTileSize = Math.max(1, Math.trunc(tileSize));
  const columnCount = Math.ceil(width / safeTileSize);
  const rowCount = Math.ceil(height / safeTileSize);
  const mask = new Uint8Array(columnCount * rowCount);

  for (const footprint of footprints) {
    const clipped = clipRect(footprint, width, height);
    if (!clipped) continue;
    const firstColumn = Math.floor(clipped.x / safeTileSize);
    const lastColumn = Math.floor((clipped.x + clipped.width - 1) / safeTileSize);
    const firstRow = Math.floor(clipped.y / safeTileSize);
    const lastRow = Math.floor((clipped.y + clipped.height - 1) / safeTileSize);
    for (let row = firstRow; row <= lastRow; row += 1) {
      const rowOffset = row * columnCount;
      mask.fill(1, rowOffset + firstColumn, rowOffset + lastColumn + 1);
    }
  }

  const finished: MutableRect[] = [];
  let active = new Map<string, MutableRect>();
  for (let row = 0; row < rowCount; row += 1) {
    const y = row * safeTileSize;
    const rowHeight = Math.min(safeTileSize, height - y);
    const next = new Map<string, MutableRect>();
    let column = 0;
    while (column < columnCount) {
      if (mask[row * columnCount + column] === 0) {
        column += 1;
        continue;
      }
      const firstColumn = column;
      while (column < columnCount && mask[row * columnCount + column] !== 0) {
        column += 1;
      }
      const x = firstColumn * safeTileSize;
      const runWidth = Math.min(width, column * safeTileSize) - x;
      const key = `${x}:${runWidth}`;
      const previous = active.get(key);
      const region = previous && previous.y + previous.height === y
        ? previous
        : { x, y, width: runWidth, height: 0 };
      region.height += rowHeight;
      next.set(key, region);
    }
    for (const [key, region] of active) {
      if (next.get(key) !== region) finished.push(region);
    }
    active = next;
  }
  finished.push(...active.values());
  return finished.sort((left, right) => left.y - right.y || left.x - right.x);
}

/** Convert overlapping rectangles into a disjoint set of vertically merged bands. */
export function canonicalizeRegionUnion(
  input: readonly DirtyRegionRect[],
  width: number,
  height: number,
): readonly DirtyRegionRect[] {
  const rects = input
    .map((rect) => clipRect(rect, width, height))
    .filter((rect): rect is DirtyRegionRect => rect !== null);
  const finished: MutableRect[] = [];
  let active = new Map<string, MutableRect>();

  for (let y = 0; y < height; y += 1) {
    const intervals = rects
      .filter((rect) => rect.y <= y && y < rect.y + rect.height)
      .map((rect) => [rect.x, rect.x + rect.width] as [number, number])
      .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    const merged: [number, number][] = [];
    for (const interval of intervals) {
      const previous = merged.at(-1);
      if (previous && interval[0] <= previous[1]) {
        previous[1] = Math.max(previous[1], interval[1]);
      } else {
        merged.push([...interval]);
      }
    }

    const next = new Map<string, MutableRect>();
    for (const [left, right] of merged) {
      const key = `${left}:${right}`;
      const previous = active.get(key);
      const region = previous && previous.y + previous.height === y
        ? previous
        : { x: left, y, width: right - left, height: 0 };
      region.height += 1;
      next.set(key, region);
    }
    for (const [key, region] of active) {
      if (next.get(key) !== region) finished.push(region);
    }
    active = next;
  }
  finished.push(...active.values());
  return finished.sort((left, right) => left.y - right.y || left.x - right.x);
}

function mipDimension(value: number, level: number): number {
  return Math.max(1, Math.trunc(value) >> level);
}

function downsampleRect(
  rect: DirtyRegionRect,
  level: number,
  width: number,
  height: number,
): DirtyRegionRect | null {
  const divisor = 2 ** level;
  return clipRect({
    x: Math.floor(rect.x / divisor),
    y: Math.floor(rect.y / divisor),
    width: Math.ceil((rect.x + rect.width) / divisor) - Math.floor(rect.x / divisor),
    height: Math.ceil((rect.y + rect.height) / divisor) - Math.floor(rect.y / divisor),
  }, width, height);
}

export function buildMipRegionPlan(
  baseRegions: readonly DirtyRegionRect[],
  width: number,
  height: number,
  maximumMipLevel: number,
): DirtyRegionMipPlan {
  const levels: DirtyRegionMipLevel[] = [];
  const safeMaximum = Math.max(0, Math.trunc(maximumMipLevel));
  for (let level = 0; level <= safeMaximum; level += 1) {
    const levelWidth = mipDimension(width, level);
    const levelHeight = mipDimension(height, level);
    const scaled = baseRegions
      .map((rect) => downsampleRect(rect, level, levelWidth, levelHeight))
      .filter((rect): rect is DirtyRegionRect => rect !== null);
    const regions = canonicalizeRegionUnion(scaled, levelWidth, levelHeight);
    levels.push({
      level,
      width: levelWidth,
      height: levelHeight,
      regions,
      pixels: regionPixelCount(regions),
    });
  }
  return {
    levels,
    totalPixels: levels.reduce((total, level) => total + level.pixels, 0),
    totalDraws: levels.reduce((total, level) => total + level.regions.length, 0),
  };
}

export function regionPixelCount(regions: readonly DirtyRegionRect[]): number {
  return regions.reduce((total, rect) => total + rect.width * rect.height, 0);
}

function rowIntervals(
  regions: readonly DirtyRegionRect[],
  height: number,
): readonly (readonly [number, number][])[] {
  const rows: [number, number][][] = Array.from({ length: height }, () => []);
  for (const rect of regions) {
    for (let y = rect.y; y < rect.y + rect.height && y < height; y += 1) {
      rows[y].push([rect.x, rect.x + rect.width]);
    }
  }
  for (const row of rows) row.sort((left, right) => left[0] - right[0]);
  return rows;
}

export function compareDirtyRegionCoverage(
  footprints: readonly DirtyRegionRect[],
  regions: readonly DirtyRegionRect[],
  width: number,
  height: number,
): DirtyRegionCoverage {
  const footprintUnion = canonicalizeRegionUnion(footprints, width, height);
  const regionUnion = canonicalizeRegionUnion(regions, width, height);
  const footprintRows = rowIntervals(footprintUnion, height);
  const regionRows = rowIntervals(regionUnion, height);
  let intersection = 0;
  for (let y = 0; y < height; y += 1) {
    const left = footprintRows[y];
    const right = regionRows[y];
    let leftIndex = 0;
    let rightIndex = 0;
    while (leftIndex < left.length && rightIndex < right.length) {
      const overlapLeft = Math.max(left[leftIndex][0], right[rightIndex][0]);
      const overlapRight = Math.min(left[leftIndex][1], right[rightIndex][1]);
      if (overlapRight > overlapLeft) intersection += overlapRight - overlapLeft;
      if (left[leftIndex][1] < right[rightIndex][1]) leftIndex += 1;
      else rightIndex += 1;
    }
  }
  const footprintPixels = regionPixelCount(footprintUnion);
  const regionPixels = regionPixelCount(regionUnion);
  return {
    footprintPixels,
    regionPixels,
    coveredFootprintPixels: intersection,
    missedPixels: Math.max(0, footprintPixels - intersection),
    extraPixels: Math.max(0, regionPixels - intersection),
  };
}
