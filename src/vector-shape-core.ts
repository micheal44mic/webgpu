import type { Shadow3dPathData } from "./vector-shadow-3d.ts";
import {
  VECTOR_SVG_IMPORT_STRATEGY,
  type VectorSvgDocument,
} from "./vector-svg-import.ts";

export const VECTOR_SHAPE_MODEL_VERSION = 1 as const;
export const VECTOR_SHAPE_KINDS = ["rectangle", "ellipse", "star"] as const;
export const VECTOR_SHAPE_DEFAULT_STAR_POINTS = 5;
export const VECTOR_SHAPE_MINIMUM_STAR_POINTS = 3;
export const VECTOR_SHAPE_MAXIMUM_STAR_POINTS = 64;
export const VECTOR_SHAPE_DEFAULT_STAR_INNER_RATIO = 0.5;

const CIRCLE_CUBIC_FACTOR = 0.5522847498307936;

export type VectorShapeKind = typeof VECTOR_SHAPE_KINDS[number];

export interface VectorShapeBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface VectorShapeDefinitionBase {
  readonly version: typeof VECTOR_SHAPE_MODEL_VERSION;
  readonly width: number;
  readonly height: number;
}

export interface VectorRectangleDefinition extends VectorShapeDefinitionBase {
  readonly kind: "rectangle";
  readonly cornerRadius: number;
}

export interface VectorEllipseDefinition extends VectorShapeDefinitionBase {
  readonly kind: "ellipse";
}

export interface VectorStarDefinition extends VectorShapeDefinitionBase {
  readonly kind: "star";
  readonly points: number;
  readonly innerRadiusRatio: number;
}

export type VectorShapeDefinition =
  | VectorRectangleDefinition
  | VectorEllipseDefinition
  | VectorStarDefinition;

export interface VectorShapeOptions {
  readonly cornerRadius?: number;
  readonly starPoints?: number;
  readonly starInnerRadiusRatio?: number;
  readonly fillColor?: string;
  readonly fillOpacity?: number;
  readonly name?: string;
}

/**
 * Ready-to-insert semantic geometry. The document is centered locally while
 * x/y retain the center of the requested document-space bounds.
 */
export interface VectorShapeDraft {
  readonly shapeDefinition: VectorShapeDefinition;
  readonly document: VectorSvgDocument;
  readonly x: number;
  readonly y: number;
  readonly scale: 1;
  readonly rotation: 0;
}

interface MutablePathBuilder {
  readonly verbs: number[];
  readonly coords: number[];
  move(x: number, y: number): void;
  line(x: number, y: number): void;
  cubic(
    firstControlX: number,
    firstControlY: number,
    secondControlX: number,
    secondControlY: number,
    endX: number,
    endY: number,
  ): void;
  close(): void;
  finish(): Shadow3dPathData;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return value;
}

function positiveDimension(value: number, label: string): number {
  const normalized = finite(value, label);
  if (!(normalized > 0)) {
    throw new RangeError(`${label} must be greater than zero.`);
  }
  return normalized;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampUnit(value: number): number {
  return clamp(Number.isFinite(value) ? value : 1, 0, 1);
}

function pathBuilder(): MutablePathBuilder {
  const verbs: number[] = [];
  const coords: number[] = [];
  return {
    verbs,
    coords,
    move(x, y) {
      verbs.push(0);
      coords.push(x, y);
    },
    line(x, y) {
      verbs.push(1);
      coords.push(x, y);
    },
    cubic(firstControlX, firstControlY, secondControlX, secondControlY, endX, endY) {
      verbs.push(3);
      coords.push(
        firstControlX,
        firstControlY,
        secondControlX,
        secondControlY,
        endX,
        endY,
      );
    },
    close() {
      verbs.push(4);
    },
    finish() {
      return {
        verbs: new Uint8Array(verbs),
        coords: new Float64Array(coords),
        contourOffsets: new Uint32Array([0]),
        fillRule: 0,
      };
    },
  };
}

function clonePath(path: Readonly<Shadow3dPathData>): Shadow3dPathData {
  return {
    verbs: path.verbs.slice(),
    coords: path.coords.slice(),
    contourOffsets: path.contourOffsets.slice(),
    fillRule: path.fillRule,
  };
}

function rectanglePath(definition: Readonly<VectorRectangleDefinition>): Shadow3dPathData {
  const builder = pathBuilder();
  const left = -definition.width * 0.5;
  const right = definition.width * 0.5;
  const top = -definition.height * 0.5;
  const bottom = definition.height * 0.5;
  const radius = definition.cornerRadius;
  if (radius <= Number.EPSILON) {
    builder.move(left, top);
    builder.line(right, top);
    builder.line(right, bottom);
    builder.line(left, bottom);
    builder.close();
    return builder.finish();
  }

  const tangent = radius * CIRCLE_CUBIC_FACTOR;
  builder.move(left + radius, top);
  builder.line(right - radius, top);
  builder.cubic(
    right - radius + tangent,
    top,
    right,
    top + radius - tangent,
    right,
    top + radius,
  );
  builder.line(right, bottom - radius);
  builder.cubic(
    right,
    bottom - radius + tangent,
    right - radius + tangent,
    bottom,
    right - radius,
    bottom,
  );
  builder.line(left + radius, bottom);
  builder.cubic(
    left + radius - tangent,
    bottom,
    left,
    bottom - radius + tangent,
    left,
    bottom - radius,
  );
  builder.line(left, top + radius);
  builder.cubic(
    left,
    top + radius - tangent,
    left + radius - tangent,
    top,
    left + radius,
    top,
  );
  builder.close();
  return builder.finish();
}

function ellipsePath(definition: Readonly<VectorEllipseDefinition>): Shadow3dPathData {
  const builder = pathBuilder();
  const radiusX = definition.width * 0.5;
  const radiusY = definition.height * 0.5;
  const tangentX = radiusX * CIRCLE_CUBIC_FACTOR;
  const tangentY = radiusY * CIRCLE_CUBIC_FACTOR;
  builder.move(0, -radiusY);
  builder.cubic(tangentX, -radiusY, radiusX, -tangentY, radiusX, 0);
  builder.cubic(radiusX, tangentY, tangentX, radiusY, 0, radiusY);
  builder.cubic(-tangentX, radiusY, -radiusX, tangentY, -radiusX, 0);
  builder.cubic(-radiusX, -tangentY, -tangentX, -radiusY, 0, -radiusY);
  builder.close();
  return builder.finish();
}

function starPath(definition: Readonly<VectorStarDefinition>): Shadow3dPathData {
  const rawPoints: { x: number; y: number }[] = [];
  const vertexCount = definition.points * 2;
  for (let index = 0; index < vertexCount; index += 1) {
    const angle = -Math.PI * 0.5 + index * Math.PI / definition.points;
    const radius = index % 2 === 0 ? 1 : definition.innerRadiusRatio;
    rawPoints.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  }
  const left = Math.min(...rawPoints.map((point) => point.x));
  const right = Math.max(...rawPoints.map((point) => point.x));
  const top = Math.min(...rawPoints.map((point) => point.y));
  const bottom = Math.max(...rawPoints.map((point) => point.y));
  const spanX = Math.max(Number.EPSILON, right - left);
  const spanY = Math.max(Number.EPSILON, bottom - top);
  const points = rawPoints.map((point) => ({
    x: ((point.x - left) / spanX - 0.5) * definition.width,
    y: ((point.y - top) / spanY - 0.5) * definition.height,
  }));

  const builder = pathBuilder();
  builder.move(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    builder.line(points[index].x, points[index].y);
  }
  builder.close();
  return builder.finish();
}

function shapePath(definition: Readonly<VectorShapeDefinition>): Shadow3dPathData {
  if (definition.kind === "rectangle") return rectanglePath(definition);
  if (definition.kind === "ellipse") return ellipsePath(definition);
  return starPath(definition);
}

function pathLogicalBytes(path: Readonly<Shadow3dPathData>): number {
  return path.verbs.byteLength + path.coords.byteLength + path.contourOffsets.byteLength;
}

function stableHash(source: Uint8Array): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const value of source) {
    first ^= value;
    first = Math.imul(first, 0x01000193) >>> 0;
    second ^= value + 0x9d;
    second = Math.imul(second, 0x85ebca6b) >>> 0;
  }
  return first.toString(16).padStart(8, "0")
    + second.toString(16).padStart(8, "0");
}

function defaultShapeName(kind: VectorShapeKind): string {
  if (kind === "rectangle") return "Rectangle";
  if (kind === "ellipse") return "Ellipse";
  return "Star";
}

export function normalizeVectorShapeBounds(
  bounds: Readonly<VectorShapeBounds>,
): VectorShapeBounds {
  const firstX = finite(bounds.left, "Shape bounds left");
  const secondX = finite(bounds.right, "Shape bounds right");
  const firstY = finite(bounds.top, "Shape bounds top");
  const secondY = finite(bounds.bottom, "Shape bounds bottom");
  const normalized = {
    left: Math.min(firstX, secondX),
    top: Math.min(firstY, secondY),
    right: Math.max(firstX, secondX),
    bottom: Math.max(firstY, secondY),
  };
  positiveDimension(normalized.right - normalized.left, "Shape width");
  positiveDimension(normalized.bottom - normalized.top, "Shape height");
  return normalized;
}

export function normalizeVectorShapeDefinition(
  definition: Readonly<VectorShapeDefinition>,
): VectorShapeDefinition {
  const width = positiveDimension(definition.width, "Shape width");
  const height = positiveDimension(definition.height, "Shape height");
  if (definition.kind === "rectangle") {
    return Object.freeze({
      version: VECTOR_SHAPE_MODEL_VERSION,
      kind: "rectangle",
      width,
      height,
      cornerRadius: clamp(
        finite(definition.cornerRadius, "Rectangle corner radius"),
        0,
        Math.min(width, height) * 0.5,
      ),
    });
  }
  if (definition.kind === "ellipse") {
    return Object.freeze({
      version: VECTOR_SHAPE_MODEL_VERSION,
      kind: "ellipse",
      width,
      height,
    });
  }
  if (definition.kind !== "star") {
    throw new TypeError("Unsupported vector shape kind.");
  }
  const points = Math.round(finite(definition.points, "Star point count"));
  return Object.freeze({
    version: VECTOR_SHAPE_MODEL_VERSION,
    kind: "star",
    width,
    height,
    points: clamp(
      points,
      VECTOR_SHAPE_MINIMUM_STAR_POINTS,
      VECTOR_SHAPE_MAXIMUM_STAR_POINTS,
    ),
    innerRadiusRatio: clamp(
      finite(definition.innerRadiusRatio, "Star inner radius ratio"),
      0,
      1,
    ),
  });
}

export function cloneVectorShapeDefinition(
  definition: Readonly<VectorShapeDefinition> | null | undefined,
): VectorShapeDefinition | undefined {
  return definition ? normalizeVectorShapeDefinition(definition) : undefined;
}

export function createVectorShapeDefinition(
  kind: VectorShapeKind,
  widthValue: number,
  heightValue: number,
  options: Readonly<VectorShapeOptions> = {},
): VectorShapeDefinition {
  const width = positiveDimension(widthValue, "Shape width");
  const height = positiveDimension(heightValue, "Shape height");
  if (kind === "rectangle") {
    return normalizeVectorShapeDefinition({
      version: VECTOR_SHAPE_MODEL_VERSION,
      kind,
      width,
      height,
      cornerRadius: options.cornerRadius ?? 0,
    });
  }
  if (kind === "ellipse") {
    return normalizeVectorShapeDefinition({
      version: VECTOR_SHAPE_MODEL_VERSION,
      kind,
      width,
      height,
    });
  }
  if (kind === "star") {
    return normalizeVectorShapeDefinition({
      version: VECTOR_SHAPE_MODEL_VERSION,
      kind,
      width,
      height,
      points: options.starPoints ?? VECTOR_SHAPE_DEFAULT_STAR_POINTS,
      innerRadiusRatio: options.starInnerRadiusRatio
        ?? VECTOR_SHAPE_DEFAULT_STAR_INNER_RATIO,
    });
  }
  throw new TypeError("Unsupported vector shape kind.");
}

export function createVectorShapeDocument(
  definitionValue: Readonly<VectorShapeDefinition>,
  options: Readonly<VectorShapeOptions> = {},
): VectorSvgDocument {
  const definition = normalizeVectorShapeDefinition(definitionValue);
  const fillColor = options.fillColor?.trim() || "#111111";
  const fillOpacity = clampUnit(options.fillOpacity ?? 1);
  const sourceDescriptor = JSON.stringify({
    model: VECTOR_SHAPE_MODEL_VERSION,
    definition,
    fillColor,
    fillOpacity,
  });
  const sourceBytes = new TextEncoder().encode(sourceDescriptor);
  const sourceHash = stableHash(sourceBytes);
  const sourceRevision = `vector-shape:${sourceHash}`;
  const path = shapePath(definition);
  const silhouettePath = clonePath(path);
  const bounds = {
    left: -definition.width * 0.5,
    top: -definition.height * 0.5,
    right: definition.width * 0.5,
    bottom: definition.height * 0.5,
  };
  return Object.freeze({
    strategy: VECTOR_SVG_IMPORT_STRATEGY,
    sourceName: options.name?.trim() || defaultShapeName(definition.kind),
    sourceBytes: sourceBytes.byteLength,
    sourceHash,
    sourceRevision,
    viewBox: [bounds.left, bounds.top, definition.width, definition.height] as const,
    bounds,
    width: definition.width,
    height: definition.height,
    paints: Object.freeze([{
      id: 0,
      color: fillColor,
      opacity: fillOpacity,
      fillRule: 0 as const,
      path,
      revision: `${sourceRevision}:paint:0`,
    }]),
    silhouettePath,
    silhouetteRevision: `${sourceRevision}:silhouette`,
    elementCount: 1,
    contourCount: 1,
    commandCount: path.verbs.length,
    logicalVectorBytes: pathLogicalBytes(path) + pathLogicalBytes(silhouettePath),
  });
}

export function createVectorShapeDraft(
  kind: VectorShapeKind,
  boundsValue: Readonly<VectorShapeBounds>,
  options: Readonly<VectorShapeOptions> = {},
): VectorShapeDraft {
  const bounds = normalizeVectorShapeBounds(boundsValue);
  const definition = createVectorShapeDefinition(
    kind,
    bounds.right - bounds.left,
    bounds.bottom - bounds.top,
    options,
  );
  return Object.freeze({
    shapeDefinition: definition,
    document: createVectorShapeDocument(definition, options),
    x: (bounds.left + bounds.right) * 0.5,
    y: (bounds.top + bounds.bottom) * 0.5,
    scale: 1,
    rotation: 0,
  });
}
