import earcut, { deviation } from "earcut";
import {
  area,
  Clipper64,
  ClipType,
  EndType,
  FillRule,
  inflatePaths,
  JoinType,
  PathType,
  PolyTree64,
  type Path64,
  type Paths64,
  type Point64,
  type PolyPath64,
} from "clipper2-ts";

import type { VectorTextOutlineJoin } from "./mixed-scene-stack.ts";
import type { Shadow3dPathData } from "./vector-shadow-3d.js";
import {
  vectorPathToQuadraticContours,
  type VectorTextPointD,
  type VectorTextQuadCurve,
} from "./vector-text-curve-utils.ts";
import {
  VECTOR_TEXT_GEOMETRY_COMPILER_VERSION,
  type VectorTextLod,
} from "./vector-text-lod.ts";

export const VECTOR_TEXT_GPU_GEOMETRY_STRATEGY =
  "clipper64-nonzero-worker-native-round-bevel-exact-miter-earcut-v4" as const;

export interface VectorTextGpuMeshData {
  readonly revision: string;
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly originX: number;
  readonly originY: number;
  readonly lodBucket: number;
  readonly integerScale: number;
}

export type VectorTextEffectDescription =
  | {
      readonly kind: "source-outline";
      readonly width: number;
      readonly join: VectorTextOutlineJoin;
    }
  | {
      readonly kind: "block";
      readonly vectorX: number;
      readonly vectorY: number;
    }
  | {
      readonly kind: "block-outline";
      readonly vectorX: number;
      readonly vectorY: number;
      readonly width: number;
      readonly join: VectorTextOutlineJoin;
    };

export interface CanonicalPolygonGroup {
  readonly outer: Path64;
  readonly holes: readonly Path64[];
}

export interface CanonicalPolygonSet {
  readonly groups: readonly CanonicalPolygonGroup[];
  readonly paths: Paths64;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const MAXIMUM_SUBDIVISION_DEPTH = 24;
const MITER_LIMIT = 4;

function midpoint(
  first: VectorTextPointD,
  second: VectorTextPointD,
): VectorTextPointD {
  return {
    x: (first.x + second.x) * 0.5,
    y: (first.y + second.y) * 0.5,
  };
}

function subtract(
  first: VectorTextPointD,
  second: VectorTextPointD,
): VectorTextPointD {
  return { x: first.x - second.x, y: first.y - second.y };
}

function directionWithin(
  vector: VectorTextPointD,
  reference: VectorTextPointD,
  toleranceRadians: number,
): boolean {
  const vectorLength = Math.hypot(vector.x, vector.y);
  const referenceLength = Math.hypot(reference.x, reference.y);
  if (vectorLength <= Number.EPSILON && referenceLength <= Number.EPSILON) {
    return true;
  }
  if (vectorLength <= Number.EPSILON || referenceLength <= Number.EPSILON) {
    return false;
  }
  const cosine = (
    vector.x * reference.x + vector.y * reference.y
  ) / (vectorLength * referenceLength);
  return cosine >= Math.cos(toleranceRadians);
}

function appendDistinctPoint(
  output: VectorTextPointD[],
  value: VectorTextPointD,
): void {
  const previous = output[output.length - 1];
  if (
    previous
    && previous.x === value.x
    && previous.y === value.y
  ) {
    return;
  }
  output.push(value);
}

function flattenQuadratic(
  curve: VectorTextQuadCurve,
  maximumPositionError: number,
  maximumTangentErrorRadians: number,
  output: VectorTextPointD[],
  depth = 0,
): void {
  const ddx = curve.p0.x - 2 * curve.p1.x + curve.p2.x;
  const ddy = curve.p0.y - 2 * curve.p1.y + curve.p2.y;
  const positionBound = Math.hypot(ddx, ddy) * 0.25;
  const chord = subtract(curve.p2, curve.p0);
  const startTangent = subtract(curve.p1, curve.p0);
  const endTangent = subtract(curve.p2, curve.p1);
  const controlHullLength =
    Math.hypot(startTangent.x, startTangent.y)
    + Math.hypot(endTangent.x, endTangent.y);
  const degenerate = controlHullLength <= Number.EPSILON * 64;
  const tangentsAcceptable = degenerate || (
    directionWithin(startTangent, chord, maximumTangentErrorRadians)
    && directionWithin(endTangent, chord, maximumTangentErrorRadians)
  );

  if (positionBound <= maximumPositionError && tangentsAcceptable) {
    appendDistinctPoint(output, curve.p2);
    return;
  }
  if (depth >= MAXIMUM_SUBDIVISION_DEPTH) {
    throw new Error(
      `Flattening quadratico oltre profondità ${MAXIMUM_SUBDIVISION_DEPTH}.`,
    );
  }

  const p01 = midpoint(curve.p0, curve.p1);
  const p12 = midpoint(curve.p1, curve.p2);
  const middle = midpoint(p01, p12);
  flattenQuadratic(
    { p0: curve.p0, p1: p01, p2: middle },
    maximumPositionError,
    maximumTangentErrorRadians,
    output,
    depth + 1,
  );
  flattenQuadratic(
    { p0: middle, p1: p12, p2: curve.p2 },
    maximumPositionError,
    maximumTangentErrorRadians,
    output,
    depth + 1,
  );
}

function quantizePoint(
  value: VectorTextPointD,
  scale: number,
): Point64 {
  const x = Math.round(value.x * scale);
  const y = Math.round(value.y * scale);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    throw new Error("Coordinata fixed-point del testo oltre Number.MAX_SAFE_INTEGER.");
  }
  return { x, y };
}

function exactAreaSign(path: Path64): -1 | 0 | 1 {
  let twiceArea = 0n;
  for (let index = 0; index < path.length; index += 1) {
    const current = path[index];
    const next = path[(index + 1) % path.length];
    twiceArea +=
      BigInt(current.x) * BigInt(next.y)
      - BigInt(next.x) * BigInt(current.y);
  }
  return twiceArea < 0n ? -1 : twiceArea > 0n ? 1 : 0;
}

function removeDuplicatePoints(path: Path64): Path64 {
  const cleaned: Path64 = [];
  for (const value of path) {
    const previous = cleaned[cleaned.length - 1];
    if (!previous || previous.x !== value.x || previous.y !== value.y) {
      cleaned.push({ x: value.x, y: value.y });
    }
  }
  if (
    cleaned.length > 1
    && cleaned[0].x === cleaned[cleaned.length - 1].x
    && cleaned[0].y === cleaned[cleaned.length - 1].y
  ) {
    cleaned.pop();
  }
  return cleaned;
}

function rotateRingToStableStart(path: Path64): Path64 {
  let firstIndex = 0;
  for (let index = 1; index < path.length; index += 1) {
    const value = path[index];
    const first = path[firstIndex];
    if (value.y < first.y || (value.y === first.y && value.x < first.x)) {
      firstIndex = index;
    }
  }
  return path.map((_, index) => path[(index + firstIndex) % path.length]);
}

function normalizedRing(path: Path64, hole: boolean): Path64 | null {
  let cleaned = removeDuplicatePoints(path);
  if (cleaned.length < 3) {
    return null;
  }
  const sign = exactAreaSign(cleaned);
  if (sign === 0) {
    return null;
  }
  const wantedSign = hole ? -1 : 1;
  if (sign !== wantedSign) {
    cleaned = [...cleaned].reverse();
  }
  return rotateRingToStableStart(cleaned);
}

interface RingSortData {
  readonly path: Path64;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly absoluteArea: number;
}

function ringSortData(path: Path64): RingSortData {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const value of path) {
    left = Math.min(left, value.x);
    top = Math.min(top, value.y);
    right = Math.max(right, value.x);
    bottom = Math.max(bottom, value.y);
  }
  return {
    path,
    left,
    top,
    right,
    bottom,
    absoluteArea: Math.abs(area(path)),
  };
}

function compareRings(first: Path64, second: Path64): number {
  const left = ringSortData(first);
  const right = ringSortData(second);
  for (const difference of [
    left.top - right.top,
    left.left - right.left,
    left.bottom - right.bottom,
    left.right - right.right,
    right.absoluteArea - left.absoluteArea,
    left.path.length - right.path.length,
  ]) {
    if (difference !== 0) {
      return difference;
    }
  }
  for (let index = 0; index < left.path.length; index += 1) {
    const yDifference = left.path[index].y - right.path[index].y;
    if (yDifference !== 0) {
      return yDifference;
    }
    const xDifference = left.path[index].x - right.path[index].x;
    if (xDifference !== 0) {
      return xDifference;
    }
  }
  return 0;
}

function executeClipper(
  subject: Paths64,
  operation: ClipType,
  clip: Paths64 = [],
  fillRule = FillRule.NonZero,
): PolyTree64 {
  const engine = new Clipper64();
  engine.preserveCollinear = false;
  engine.reverseSolution = false;
  engine.addPaths(subject, PathType.Subject, false);
  if (clip.length > 0) {
    engine.addPaths(clip, PathType.Clip, false);
  }
  const tree = new PolyTree64();
  if (!engine.execute(operation, fillRule, tree)) {
    throw new Error(`Clipper64 non ha completato l'operazione ${operation}.`);
  }
  return tree;
}

function canonicalSetFromTree(tree: PolyTree64): CanonicalPolygonSet {
  const groups: CanonicalPolygonGroup[] = [];

  const visitOuter = (node: PolyPath64): void => {
    if (node.isHole || !node.polygon) {
      for (let index = 0; index < node.count; index += 1) {
        visitOuter(node.child(index));
      }
      return;
    }
    const outer = normalizedRing(node.polygon, false);
    if (!outer) {
      return;
    }
    const holes: Path64[] = [];
    for (let index = 0; index < node.count; index += 1) {
      const child = node.child(index);
      if (child.isHole && child.polygon) {
        const hole = normalizedRing(child.polygon, true);
        if (hole) {
          holes.push(hole);
        }
        for (let islandIndex = 0; islandIndex < child.count; islandIndex += 1) {
          visitOuter(child.child(islandIndex));
        }
      } else {
        visitOuter(child);
      }
    }
    holes.sort(compareRings);
    groups.push({ outer, holes });
  };

  for (let index = 0; index < tree.count; index += 1) {
    visitOuter(tree.child(index));
  }
  groups.sort((first, second) => compareRings(first.outer, second.outer));

  const paths: Paths64 = [];
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const group of groups) {
    for (const ring of [group.outer, ...group.holes]) {
      paths.push(ring);
      for (const value of ring) {
        left = Math.min(left, value.x);
        top = Math.min(top, value.y);
        right = Math.max(right, value.x);
        bottom = Math.max(bottom, value.y);
      }
    }
  }
  if (!Number.isFinite(left)) {
    left = 0;
    top = 0;
    right = 0;
    bottom = 0;
  }
  return { groups, paths, left, top, right, bottom };
}

function canonicalSetFromPaths(
  paths: Paths64,
  fillRule = FillRule.NonZero,
): CanonicalPolygonSet {
  return canonicalSetFromTree(
    executeClipper(paths, ClipType.Union, [], fillRule),
  );
}

export function canonicalizeVectorTextPath(
  path: Shadow3dPathData,
  lod: VectorTextLod,
  outlineRadius = 0,
): CanonicalPolygonSet {
  const tangentTolerance = Math.min(
    0.1,
    Math.acos(1 - Math.min(
      1,
      lod.polygonFlattenTolerance
      / Math.max(outlineRadius, lod.polygonFlattenTolerance),
    )),
  );
  const contours = vectorPathToQuadraticContours(
    path,
    lod.cubicToQuadraticTolerance,
  );
  const paths: Paths64 = [];
  for (const contour of contours) {
    if (contour.curves.length === 0) {
      continue;
    }
    const flattened: VectorTextPointD[] = [contour.curves[0].p0];
    for (const curve of contour.curves) {
      flattenQuadratic(
        curve,
        lod.polygonFlattenTolerance,
        tangentTolerance,
        flattened,
      );
    }
    const quantized = removeDuplicatePoints(
      flattened.map((value) => quantizePoint(value, lod.integerScale)),
    );
    if (quantized.length >= 3) {
      paths.push(quantized);
    }
  }
  const fillRule = Number(path.fillRule) === 1
    ? FillRule.EvenOdd
    : FillRule.NonZero;
  return canonicalSetFromPaths(paths, fillRule);
}

function pushPositivePiece(pieces: Paths64, piece: Path64): void {
  const cleaned = removeDuplicatePoints(piece);
  if (cleaned.length >= 3 && exactAreaSign(cleaned) !== 0) {
    pieces.push(
      exactAreaSign(cleaned) >= 0 ? cleaned : [...cleaned].reverse(),
    );
  }
}

function rightOffset(
  value: Point64,
  edgeX: number,
  edgeY: number,
  radius: number,
): Point64 {
  const length = Math.hypot(edgeX, edgeY);
  if (!(length > 0)) {
    throw new Error("Contorno Clipper con lato nullo.");
  }
  return {
    x: Math.round(value.x + edgeY / length * radius),
    y: Math.round(value.y - edgeX / length * radius),
  };
}

function lineIntersection(
  p: VectorTextPointD,
  r: VectorTextPointD,
  q: VectorTextPointD,
  s: VectorTextPointD,
): VectorTextPointD | null {
  const denominator = r.x * s.y - r.y * s.x;
  const scale = Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y);
  if (
    Math.abs(denominator)
    <= Number.EPSILON * 32 * Math.max(1, scale)
  ) {
    return null;
  }
  const qmp = { x: q.x - p.x, y: q.y - p.y };
  const t = (qmp.x * s.y - qmp.y * s.x) / denominator;
  return { x: p.x + t * r.x, y: p.y + t * r.y };
}

export function buildExpandedVectorTextSet(
  canonicalFill: CanonicalPolygonSet,
  radius: number,
  join: VectorTextOutlineJoin,
  arcTolerance: number,
): CanonicalPolygonSet {
  if (!(radius > 0)) {
    throw new Error("L'espansione vettoriale richiede raggio maggiore di zero.");
  }
  const nativeJoin = join === "round"
    ? JoinType.Round
    : join === "bevel"
      ? JoinType.Bevel
      : null;
  if (nativeJoin !== null) {
    const expandedPaths = inflatePaths(
      canonicalFill.paths,
      radius,
      nativeJoin,
      EndType.Polygon,
      MITER_LIMIT,
      arcTolerance,
    );
    return canonicalSetFromPaths(expandedPaths);
  }
  const pieces: Paths64 = canonicalFill.paths.map((ring) => [...ring]);

  for (const ring of canonicalFill.paths) {
    const count = ring.length;
    if (count < 3) {
      continue;
    }
    const edgeX = new Float64Array(count);
    const edgeY = new Float64Array(count);

    for (let index = 0; index < count; index += 1) {
      const start = ring[index];
      const end = ring[(index + 1) % count];
      const x = end.x - start.x;
      const y = end.y - start.y;
      if (x === 0 && y === 0) {
        throw new Error("Contorno canonico con punti consecutivi duplicati.");
      }
      edgeX[index] = x;
      edgeY[index] = y;
      pushPositivePiece(pieces, [
        start,
        rightOffset(start, x, y, radius),
        rightOffset(end, x, y, radius),
        end,
      ]);
    }

    for (let index = 0; index < count; index += 1) {
      const value = ring[index];
      const previous = (index + count - 1) % count;
      const incomingX = edgeX[previous];
      const incomingY = edgeY[previous];
      const outgoingX = edgeX[index];
      const outgoingY = edgeY[index];
      const turn = incomingX * outgoingY - incomingY * outgoingX;
      if (!(turn > 0)) {
        continue;
      }

      const firstOffset = rightOffset(
        value,
        incomingX,
        incomingY,
        radius,
      );
      const secondOffset = rightOffset(
        value,
        outgoingX,
        outgoingY,
        radius,
      );
      if (join === "bevel") {
        pushPositivePiece(pieces, [value, firstOffset, secondOffset]);
        continue;
      }
      if (join === "miter") {
        const intersection = lineIntersection(
          firstOffset,
          { x: incomingX, y: incomingY },
          secondOffset,
          { x: outgoingX, y: outgoingY },
        );
        if (
          intersection
          && Math.hypot(
            intersection.x - value.x,
            intersection.y - value.y,
          ) <= radius * MITER_LIMIT
        ) {
          pushPositivePiece(pieces, [
            value,
            firstOffset,
            {
              x: Math.round(intersection.x),
              y: Math.round(intersection.y),
            },
            secondOffset,
          ]);
        } else {
          // Il contratto richiede bevel, non square, oltre il limite 4×.
          pushPositivePiece(pieces, [value, firstOffset, secondOffset]);
        }
        continue;
      }

      const firstNormal = {
        x: firstOffset.x - value.x,
        y: firstOffset.y - value.y,
      };
      const secondNormal = {
        x: secondOffset.x - value.x,
        y: secondOffset.y - value.y,
      };
      const startAngle = Math.atan2(firstNormal.y, firstNormal.x);
      let sweep = Math.atan2(
        firstNormal.x * secondNormal.y - firstNormal.y * secondNormal.x,
        firstNormal.x * secondNormal.x + firstNormal.y * secondNormal.y,
      );
      if (sweep <= 0) {
        sweep += Math.PI * 2;
      }
      const safeTolerance = Math.min(
        Math.max(1, arcTolerance),
        radius,
      );
      const maximumStep = 2 * Math.acos(Math.max(
        -1,
        Math.min(1, 1 - safeTolerance / radius),
      ));
      const steps = Math.max(
        1,
        Math.ceil(sweep / Math.max(maximumStep, 1e-6)),
      );
      const fan: Path64 = [value, firstOffset];
      for (let step = 1; step < steps; step += 1) {
        const angleAtStep = startAngle + sweep * step / steps;
        fan.push({
          x: Math.round(value.x + Math.cos(angleAtStep) * radius),
          y: Math.round(value.y + Math.sin(angleAtStep) * radius),
        });
      }
      fan.push(secondOffset);
      pushPositivePiece(pieces, fan);
    }
  }

  return canonicalSetFromPaths(pieces);
}
export function buildOutsideVectorTextOutline(
  canonicalFill: CanonicalPolygonSet,
  width: number,
  join: VectorTextOutlineJoin,
  arcTolerance: number,
): CanonicalPolygonSet | null {
  if (!(width > 0)) {
    return null;
  }
  const expanded = buildExpandedVectorTextSet(
    canonicalFill,
    width,
    join,
    arcTolerance,
  );
  return canonicalSetFromTree(executeClipper(
    expanded.paths,
    ClipType.Difference,
    canonicalFill.paths,
  ));
}

function exactCrossSign(
  firstX: number,
  firstY: number,
  secondX: number,
  secondY: number,
): -1 | 0 | 1 {
  const value =
    BigInt(firstX) * BigInt(secondY)
    - BigInt(firstY) * BigInt(secondX);
  return value < 0n ? -1 : value > 0n ? 1 : 0;
}

export function buildVectorTextBlockSet(
  canonicalFill: CanonicalPolygonSet,
  vectorX: number,
  vectorY: number,
): CanonicalPolygonSet {
  if (vectorX === 0 && vectorY === 0) {
    return canonicalFill;
  }

  const pieces: Paths64 = canonicalFill.paths.map((ring) => [...ring]);
  for (const ring of canonicalFill.paths) {
    for (let index = 0; index < ring.length; index += 1) {
      const start = ring[index];
      const end = ring[(index + 1) % ring.length];
      const edgeX = end.x - start.x;
      const edgeY = end.y - start.y;
      if (exactCrossSign(vectorX, vectorY, edgeX, edgeY) <= 0) {
        continue;
      }
      pushPositivePiece(pieces, [
        start,
        { x: start.x + vectorX, y: start.y + vectorY },
        { x: end.x + vectorX, y: end.y + vectorY },
        end,
      ]);
    }
  }
  return canonicalSetFromPaths(pieces);
}

export function triangulateCanonicalVectorTextSet(
  set: CanonicalPolygonSet,
  integerScale: number,
  revision: string,
  lodBucket: number,
): VectorTextGpuMeshData {
  const absoluteVertices: number[] = [];
  const indices: number[] = [];
  for (const group of set.groups) {
    const flat: number[] = [];
    const holeIndices: number[] = [];
    const appendRing = (ring: Path64): void => {
      for (const value of ring) {
        flat.push(value.x / integerScale, value.y / integerScale);
      }
    };
    appendRing(group.outer);
    for (const hole of group.holes) {
      holeIndices.push(flat.length / 2);
      appendRing(hole);
    }
    const localIndices = earcut(flat, holeIndices, 2);
    const triangulationDeviation = deviation(
      flat,
      holeIndices,
      2,
      localIndices,
    );
    if (
      !Number.isFinite(triangulationDeviation)
      || triangulationDeviation > 1e-8
    ) {
      throw new Error(
        `Deviazione Earcut ${triangulationDeviation} oltre 1e-8.`,
      );
    }
    const base = absoluteVertices.length / 2;
    absoluteVertices.push(...flat);
    for (const index of localIndices) {
      indices.push(base + index);
    }
  }

  const absoluteLeft = set.left / integerScale;
  const absoluteTop = set.top / integerScale;
  const absoluteRight = set.right / integerScale;
  const absoluteBottom = set.bottom / integerScale;
  const originX = (absoluteLeft + absoluteRight) * 0.5;
  const originY = (absoluteTop + absoluteBottom) * 0.5;
  const rebased = new Float32Array(absoluteVertices.length);
  for (let index = 0; index < absoluteVertices.length; index += 2) {
    rebased[index] = absoluteVertices[index] - originX;
    rebased[index + 1] = absoluteVertices[index + 1] - originY;
  }
  return {
    revision,
    vertices: rebased,
    indices: new Uint32Array(indices),
    left: absoluteLeft - originX,
    top: absoluteTop - originY,
    right: absoluteRight - originX,
    bottom: absoluteBottom - originY,
    originX,
    originY,
    lodBucket,
    integerScale,
  };
}

export function compileVectorTextEffect(
  path: Shadow3dPathData,
  lod: VectorTextLod,
  effect: VectorTextEffectDescription,
  revision: string,
): VectorTextGpuMeshData | null {
  if (
    (effect.kind === "source-outline" || effect.kind === "block-outline")
    && !(effect.width > 0)
  ) {
    return null;
  }
  const outlineRadius = effect.kind === "source-outline"
    || effect.kind === "block-outline"
    ? effect.width
    : 0;
  const canonicalFill = canonicalizeVectorTextPath(
    path,
    lod,
    outlineRadius,
  );
  const arcTolerance = Math.max(
    1,
    Math.round(lod.roundArcSagittaTolerance * lod.integerScale),
  );

  let result: CanonicalPolygonSet | null;
  if (effect.kind === "source-outline") {
    result = buildOutsideVectorTextOutline(
      canonicalFill,
      Math.round(effect.width * lod.integerScale),
      effect.join,
      arcTolerance,
    );
  } else {
    const vectorX = Math.round(effect.vectorX * lod.integerScale);
    const vectorY = Math.round(effect.vectorY * lod.integerScale);
    const block = buildVectorTextBlockSet(
      canonicalFill,
      vectorX,
      vectorY,
    );
    result = effect.kind === "block"
      ? block
      : buildOutsideVectorTextOutline(
        block,
        Math.round(effect.width * lod.integerScale),
        effect.join,
        arcTolerance,
      );
  }
  if (!result || result.groups.length === 0) {
    return null;
  }
  return triangulateCanonicalVectorTextSet(
    result,
    lod.integerScale,
    `${VECTOR_TEXT_GEOMETRY_COMPILER_VERSION}:${revision}`,
    lod.bucket,
  );
}
