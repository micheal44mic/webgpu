/*
 * Slug analytic curve packing adapted from three-text 0.6.5.
 *
 * three-text is MIT licensed, Copyright © 2025-2026 Jeremy Tribby,
 * Countertype LLC. The Slug reference algorithm and shaders are MIT licensed,
 * Copyright 2017 Eric Lengyel. The local fork uses one whole text node per
 * winding operation, compact textures, dynamic bands and local coordinates.
 */

import type { Shadow3dPathData } from "./vector-shadow-3d.ts";
import {
  vectorPathToQuadraticContours,
  vectorTextQuadraticControlBounds,
  type VectorTextQuadCurve,
} from "./vector-text-curve-utils.ts";
import { vectorTextMaximumLod } from "./vector-text-lod.ts";

export const VECTOR_TEXT_SLUG_COMPILER_VERSION =
  "three-text-slug-0.6.5-whole-node-compact-bands-inclusive-v2" as const;

export interface VectorTextSlugTextureData<ArrayType extends Float32Array | Uint32Array> {
  readonly data: ArrayType;
  readonly width: number;
  readonly height: number;
  readonly logWidth: number;
}

export interface VectorTextSlugData {
  readonly revision: string;
  readonly curveTexture: VectorTextSlugTextureData<Float32Array>;
  readonly bandTexture: VectorTextSlugTextureData<Uint32Array>;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly originX: number;
  readonly originY: number;
  readonly horizontalHeaderBase: number;
  readonly verticalHeaderBase: number;
  readonly horizontalBandCount: number;
  readonly verticalBandCount: number;
  readonly bandScaleX: number;
  readonly bandScaleY: number;
  readonly bandOffsetX: number;
  readonly bandOffsetY: number;
  readonly curveCount: number;
  readonly maximumHorizontalCandidates: number;
  readonly maximumVerticalCandidates: number;
}

interface PackedCurve {
  readonly curve: VectorTextQuadCurve;
  readonly firstTexel: number;
  readonly minimumX: number;
  readonly minimumY: number;
  readonly maximumX: number;
  readonly maximumY: number;
}

interface BandLists {
  readonly horizontal: PackedCurve[][];
  readonly vertical: PackedCurve[][];
  readonly maximumHorizontalCandidates: number;
  readonly maximumVerticalCandidates: number;
}

const MINIMUM_TEXTURE_WIDTH = 16;
const MINIMUM_WEBGPU_MAXIMUM_TEXTURE_DIMENSION_2D = 8192;
const INITIAL_BAND_COUNT = 16;
const MAXIMUM_BAND_COUNT = 255;
const MAXIMUM_CANDIDATES_PER_BAND = 64;

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

function compactTextureShape(texels: number): {
  width: number;
  height: number;
  logWidth: number;
} {
  const requestedWidth = Math.max(
    MINIMUM_TEXTURE_WIDTH,
    nextPowerOfTwo(Math.ceil(Math.sqrt(Math.max(1, texels)))),
  );
  const width = Math.min(
    MINIMUM_WEBGPU_MAXIMUM_TEXTURE_DIMENSION_2D,
    requestedWidth,
  );
  const height = Math.max(1, Math.ceil(Math.max(1, texels) / width));
  if (height > MINIMUM_WEBGPU_MAXIMUM_TEXTURE_DIMENSION_2D) {
    throw new Error(
      `Slug data ${width}×${height} exceeds the portable WebGPU limit.`,
    );
  }
  return {
    width,
    height,
    logWidth: Math.round(Math.log2(width)),
  };
}

function curveBounds(curve: VectorTextQuadCurve): {
  minimumX: number;
  minimumY: number;
  maximumX: number;
  maximumY: number;
} {
  return {
    minimumX: Math.min(curve.p0.x, curve.p1.x, curve.p2.x),
    minimumY: Math.min(curve.p0.y, curve.p1.y, curve.p2.y),
    maximumX: Math.max(curve.p0.x, curve.p1.x, curve.p2.x),
    maximumY: Math.max(curve.p0.y, curve.p1.y, curve.p2.y),
  };
}

function bandRange(
  minimum: number,
  maximum: number,
  boundsMinimum: number,
  boundsMaximum: number,
  count: number,
): readonly [number, number] {
  const span = Math.max(Number.EPSILON, boundsMaximum - boundsMinimum);
  // Slug bands are closed intervals. A curve whose minimum lies exactly on
  // a band boundary must also be visible from the preceding band; otherwise
  // pixels immediately before the boundary lose one winding contribution and
  // show a thin seam through the glyph.
  const first = Math.max(
    0,
    Math.min(
      count - 1,
      Math.ceil((minimum - boundsMinimum) / span * count) - 1,
    ),
  );
  const last = Math.max(
    first,
    Math.min(
      count - 1,
      Math.floor((maximum - boundsMinimum) / span * count),
    ),
  );
  return [first, last];
}

function buildBandLists(
  curves: readonly PackedCurve[],
  left: number,
  top: number,
  right: number,
  bottom: number,
  horizontalCount: number,
  verticalCount: number,
): BandLists {
  const horizontal = Array.from(
    { length: horizontalCount },
    () => [] as PackedCurve[],
  );
  const vertical = Array.from(
    { length: verticalCount },
    () => [] as PackedCurve[],
  );
  for (const curve of curves) {
    const [firstHorizontal, lastHorizontal] = bandRange(
      curve.minimumY,
      curve.maximumY,
      top,
      bottom,
      horizontalCount,
    );
    for (
      let index = firstHorizontal;
      index <= lastHorizontal;
      index += 1
    ) {
      horizontal[index].push(curve);
    }
    const [firstVertical, lastVertical] = bandRange(
      curve.minimumX,
      curve.maximumX,
      left,
      right,
      verticalCount,
    );
    for (let index = firstVertical; index <= lastVertical; index += 1) {
      vertical[index].push(curve);
    }
  }
  for (const list of horizontal) {
    list.sort((first, second) => second.maximumX - first.maximumX);
  }
  for (const list of vertical) {
    list.sort((first, second) => second.maximumY - first.maximumY);
  }
  return {
    horizontal,
    vertical,
    maximumHorizontalCandidates: horizontal.reduce(
      (maximum, list) => Math.max(maximum, list.length),
      0,
    ),
    maximumVerticalCandidates: vertical.reduce(
      (maximum, list) => Math.max(maximum, list.length),
      0,
    ),
  };
}

function stablePathRevision(path: Shadow3dPathData): string {
  let hash = 2166136261;
  const update = (value: number): void => {
    hash = Math.imul(hash ^ value, 16777619);
  };
  for (const value of path.verbs) {
    update(value);
  }
  const words = new Uint32Array(
    path.coords.buffer,
    path.coords.byteOffset,
    path.coords.byteLength / 4,
  );
  for (const value of words) {
    update(value);
  }
  update(Number(path.fillRule) | 0);
  return `${hash >>> 0}`;
}

export function vectorTextPathRevision(path: Shadow3dPathData): string {
  return `${VECTOR_TEXT_SLUG_COMPILER_VERSION}:${stablePathRevision(path)}`;
}

export function buildVectorTextSlugData(
  path: Shadow3dPathData,
  revision = vectorTextPathRevision(path),
): VectorTextSlugData {
  if (Number(path.fillRule) === 1) {
    throw new Error(
      "The Slug source accepts an OpenType NonZero path; EvenOdd must be canonicalized first.",
    );
  }
  const maximumLod = vectorTextMaximumLod();
  const contours = vectorPathToQuadraticContours(
    path,
    maximumLod.cubicToQuadraticTolerance,
  );
  const absoluteBounds = vectorTextQuadraticControlBounds(contours);
  const originX = (absoluteBounds.left + absoluteBounds.right) * 0.5;
  const originY = (absoluteBounds.top + absoluteBounds.bottom) * 0.5;
  const left = absoluteBounds.left - originX;
  const top = absoluteBounds.top - originY;
  const right = absoluteBounds.right - originX;
  const bottom = absoluteBounds.bottom - originY;

  const sourceCurves = contours.flatMap((contour) => contour.curves);
  const curveShape = compactTextureShape(sourceCurves.length * 2);
  const curveData = new Float32Array(
    curveShape.width * curveShape.height * 4,
  );
  const curves: PackedCurve[] = [];
  for (let index = 0; index < sourceCurves.length; index += 1) {
    const source = sourceCurves[index];
    const curve: VectorTextQuadCurve = {
      p0: { x: source.p0.x - originX, y: source.p0.y - originY },
      p1: { x: source.p1.x - originX, y: source.p1.y - originY },
      p2: { x: source.p2.x - originX, y: source.p2.y - originY },
    };
    const firstTexel = index * 2;
    const firstOffset = firstTexel * 4;
    const secondOffset = (firstTexel + 1) * 4;
    curveData[firstOffset] = curve.p0.x;
    curveData[firstOffset + 1] = curve.p0.y;
    curveData[firstOffset + 2] = curve.p1.x;
    curveData[firstOffset + 3] = curve.p1.y;
    curveData[secondOffset] = curve.p2.x;
    curveData[secondOffset + 1] = curve.p2.y;
    curves.push({ curve, firstTexel, ...curveBounds(curve) });
  }

  let horizontalBandCount = INITIAL_BAND_COUNT;
  let verticalBandCount = INITIAL_BAND_COUNT;
  let bandLists = buildBandLists(
    curves,
    left,
    top,
    right,
    bottom,
    horizontalBandCount,
    verticalBandCount,
  );
  while (
    bandLists.maximumHorizontalCandidates > MAXIMUM_CANDIDATES_PER_BAND
    && horizontalBandCount < MAXIMUM_BAND_COUNT
  ) {
    horizontalBandCount = Math.min(
      MAXIMUM_BAND_COUNT,
      horizontalBandCount * 2,
    );
    bandLists = buildBandLists(
      curves,
      left,
      top,
      right,
      bottom,
      horizontalBandCount,
      verticalBandCount,
    );
  }
  while (
    bandLists.maximumVerticalCandidates > MAXIMUM_CANDIDATES_PER_BAND
    && verticalBandCount < MAXIMUM_BAND_COUNT
  ) {
    verticalBandCount = Math.min(
      MAXIMUM_BAND_COUNT,
      verticalBandCount * 2,
    );
    bandLists = buildBandLists(
      curves,
      left,
      top,
      right,
      bottom,
      horizontalBandCount,
      verticalBandCount,
    );
  }

  const horizontalHeaderBase = 0;
  const verticalHeaderBase = horizontalBandCount;
  const headerTexels = horizontalBandCount + verticalBandCount;
  const candidateTexels = [
    ...bandLists.horizontal,
    ...bandLists.vertical,
  ].reduce((total, list) => total + list.length, 0);
  const bandShape = compactTextureShape(headerTexels + candidateTexels);
  const bandData = new Uint32Array(
    bandShape.width * bandShape.height * 4,
  );
  let candidateOffset = headerTexels;
  const writeLists = (
    lists: readonly (readonly PackedCurve[])[],
    headerBase: number,
  ): void => {
    for (let index = 0; index < lists.length; index += 1) {
      const list = lists[index];
      const headerOffset = (headerBase + index) * 4;
      bandData[headerOffset] = list.length;
      bandData[headerOffset + 1] = candidateOffset;
      for (const curve of list) {
        bandData[candidateOffset * 4] = curve.firstTexel;
        candidateOffset += 1;
      }
    }
  };
  writeLists(bandLists.horizontal, horizontalHeaderBase);
  writeLists(bandLists.vertical, verticalHeaderBase);

  const width = Math.max(Number.EPSILON, right - left);
  const height = Math.max(Number.EPSILON, bottom - top);
  return {
    revision,
    curveTexture: { data: curveData, ...curveShape },
    bandTexture: { data: bandData, ...bandShape },
    left,
    top,
    right,
    bottom,
    originX,
    originY,
    horizontalHeaderBase,
    verticalHeaderBase,
    horizontalBandCount,
    verticalBandCount,
    bandScaleX: verticalBandCount / width,
    bandScaleY: horizontalBandCount / height,
    bandOffsetX: -left * verticalBandCount / width,
    bandOffsetY: -top * horizontalBandCount / height,
    curveCount: curves.length,
    maximumHorizontalCandidates:
      bandLists.maximumHorizontalCandidates,
    maximumVerticalCandidates:
      bandLists.maximumVerticalCandidates,
  };
}
