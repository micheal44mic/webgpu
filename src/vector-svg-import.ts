import type { Shadow3dPathData } from "./vector-shadow-3d.js";
import {
  mergeVectorTextPaths,
  shiftVectorTextPath,
  vectorTextPathBounds,
  type VectorTextBounds,
} from "./vector-text-transform.ts";
import {
  EndType,
  inflatePathsD,
  JoinType,
  type PathD,
} from "clipper2-ts";

export const VECTOR_SVG_IMPORT_STRATEGY =
  "sanitized-semantic-svg-gradients-retained-strokes-worker-lod-mesh-webgpu-v2" as const;
export const VECTOR_SVG_MAXIMUM_SOURCE_BYTES = 5 * 1024 * 1024;
export const VECTOR_SVG_MAXIMUM_COMMANDS = 500_000;
export const VECTOR_SVG_MAXIMUM_GRADIENT_STOPS = 4;

export interface VectorSvgGradientStop {
  readonly offset: number;
  readonly color: string;
  readonly opacity: number;
}

export interface VectorSvgGradient {
  readonly kind: "linear" | "radial";
  readonly spread: "pad" | "reflect" | "repeat";
  /** Maps gradient coordinates into the centered local coordinate system. */
  readonly transform: Matrix;
  /** Linear: x1/y1/x2/y2. Radial: cx/cy/r/fr. */
  readonly geometry: readonly [number, number, number, number];
  /** Radial focal point (fx/fy); zero for linear gradients. */
  readonly focal: readonly [number, number];
  readonly stops: readonly VectorSvgGradientStop[];
}

export interface VectorSvgStroke {
  /** Original centerline geometry before the element/group transform. */
  readonly sourcePath: Shadow3dPathData;
  /** Maps the original centerline into the centered SVG document space. */
  readonly transform: Matrix;
  readonly width: number;
  readonly linecap: "butt" | "round" | "square";
  readonly linejoin: "miter" | "round" | "bevel";
  readonly miterLimit: number;
  readonly dashArray: readonly number[];
  readonly dashOffset: number;
}

export interface VectorSvgPaint {
  readonly id: number;
  readonly color: string;
  readonly opacity: number;
  readonly fillRule: 0 | 1;
  readonly path: Shadow3dPathData;
  readonly gradient?: VectorSvgGradient;
  /** Retains editable SVG stroke semantics; `path` is its GPU-ready outline. */
  readonly strokes?: readonly VectorSvgStroke[];
  readonly revision: string;
}

export interface VectorSvgDocument {
  readonly strategy: typeof VECTOR_SVG_IMPORT_STRATEGY;
  readonly sourceName: string;
  readonly sourceBytes: number;
  readonly sourceHash: string;
  readonly sourceRevision: string;
  readonly viewBox: readonly [number, number, number, number] | null;
  readonly bounds: VectorTextBounds;
  readonly width: number;
  readonly height: number;
  readonly paints: readonly VectorSvgPaint[];
  readonly silhouettePath: Shadow3dPathData;
  readonly silhouetteRevision: string;
  readonly elementCount: number;
  readonly contourCount: number;
  readonly commandCount: number;
  readonly logicalVectorBytes: number;
}

interface Point { readonly x: number; readonly y: number; }
export type Matrix = readonly [number, number, number, number, number, number];
interface StyleState {
  fill: string;
  color: string;
  fillOpacity: number;
  fillRule: 0 | 1;
  stroke: string;
  strokeOpacity: number;
  strokeWidth: string;
  strokeLinecap: "butt" | "round" | "square";
  strokeLinejoin: "miter" | "round" | "bevel";
  strokeMiterlimit: number;
  strokeDasharray: string;
  strokeDashoffset: string;
  display: string;
  visibility: string;
}
interface CssRule { readonly selector: string; readonly declarations: ReadonlyMap<string, string>; }
interface RawPaint {
  readonly color: string;
  readonly opacity: number;
  readonly fillRule: 0 | 1;
  readonly path: Shadow3dPathData;
  readonly gradient?: VectorSvgGradient;
  readonly gradientKey: string;
  readonly strokes?: readonly VectorSvgStroke[];
  readonly strokeKey: string;
}

interface GradientDefinition {
  readonly kind: "linear" | "radial";
  readonly units: "objectBoundingBox" | "userSpaceOnUse";
  readonly spread: "pad" | "reflect" | "repeat";
  readonly transform: Matrix;
  readonly geometry: readonly [string, string, string, string];
  readonly focal: readonly [string, string];
  readonly stops: readonly VectorSvgGradientStop[];
}

interface GradientRegistry {
  get(id: string): GradientDefinition | undefined;
}

interface FlatStrokeSubpath {
  readonly points: readonly Point[];
  readonly closed: boolean;
}

const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];
const KAPPA = 0.5522847498307936;
const SAFE_ELEMENTS = new Set([
  "svg", "g", "defs", "style", "title", "desc", "metadata",
  "lineargradient", "radialgradient", "stop",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
]);
const CONTAINER_ELEMENTS = new Set(["svg", "g"]);
const GEOMETRY_ELEMENTS = new Set([
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
]);
const STYLE_PROPERTIES = new Set([
  "fill", "color", "fill-opacity", "fill-rule", "opacity", "stroke",
  "stroke-opacity", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset",
  "stop-color", "stop-opacity", "display", "visibility",
]);

function finite(value: string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Valore numerico SVG non valido: ${value}.`);
  return parsed;
}
function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
}
function multiply(first: Matrix, second: Matrix): Matrix {
  return [
    first[0] * second[0] + first[2] * second[1],
    first[1] * second[0] + first[3] * second[1],
    first[0] * second[2] + first[2] * second[3],
    first[1] * second[2] + first[3] * second[3],
    first[0] * second[4] + first[2] * second[5] + first[4],
    first[1] * second[4] + first[3] * second[5] + first[5],
  ];
}
function translated(matrix: Matrix, x: number, y: number): Matrix {
  return [matrix[0], matrix[1], matrix[2], matrix[3], matrix[4] + x, matrix[5] + y];
}
function boxMatrix(bounds: VectorTextBounds): Matrix {
  return [
    bounds.right - bounds.left,
    0,
    0,
    bounds.bottom - bounds.top,
    bounds.left,
    bounds.top,
  ];
}
function transformPoint(matrix: Matrix, x: number, y: number): Point {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] };
}
function finiteLength(value: string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined || value.trim() === "") return fallback;
  const match = value.trim().match(/^([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)(px|pt|pc|mm|cm|in)?$/i);
  if (!match) throw new Error(`Lunghezza SVG non supportata: ${value}.`);
  const numeric = finite(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  if (unit === "pt") return numeric * 96 / 72;
  if (unit === "pc") return numeric * 16;
  if (unit === "mm") return numeric * 96 / 25.4;
  if (unit === "cm") return numeric * 96 / 2.54;
  if (unit === "in") return numeric * 96;
  return numeric;
}
function finiteStrokeLength(
  value: string | null | undefined,
  percentageReference: number,
  fallback = 0,
): number {
  const normalized = value?.trim() ?? "";
  if (normalized.endsWith("%")) {
    return finite(normalized.slice(0, -1)) / 100 * percentageReference;
  }
  return finiteLength(value, fallback);
}
function parseNumberList(source: string): number[] {
  const numberPattern = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
  const matches = source.match(numberPattern) ?? [];
  const residue = source.replace(numberPattern, "").replace(/[\s,]+/g, "");
  if (residue.length > 0) throw new Error(`Lista numerica SVG non valida: ${source}.`);
  return matches.map((value) => finite(value));
}
function parseTransform(source: string | null): Matrix {
  if (!source?.trim()) return IDENTITY_MATRIX;
  let result: Matrix = IDENTITY_MATRIX;
  let consumed = "";
  const expression = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  for (const match of source.matchAll(expression)) {
    consumed += match[0];
    const name = match[1].toLowerCase();
    const values = parseNumberList(match[2]);
    let operation: Matrix;
    if (name === "matrix" && values.length === 6) operation = values as unknown as Matrix;
    else if (name === "translate" && (values.length === 1 || values.length === 2)) operation = [1, 0, 0, 1, values[0], values[1] ?? 0];
    else if (name === "scale" && (values.length === 1 || values.length === 2)) operation = [values[0], 0, 0, values[1] ?? values[0], 0, 0];
    else if (name === "rotate" && (values.length === 1 || values.length === 3)) {
      const angle = values[0] * Math.PI / 180;
      const rotation: Matrix = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
      operation = values.length === 3
        ? multiply(multiply([1, 0, 0, 1, values[1], values[2]], rotation), [1, 0, 0, 1, -values[1], -values[2]])
        : rotation;
    } else if (name === "skewx" && values.length === 1) operation = [1, 0, Math.tan(values[0] * Math.PI / 180), 1, 0, 0];
    else if (name === "skewy" && values.length === 1) operation = [1, Math.tan(values[0] * Math.PI / 180), 0, 1, 0, 0];
    else throw new Error(`Trasformazione SVG non supportata: ${match[0]}.`);
    result = multiply(result, operation);
  }
  if (consumed.replace(/[\s,]+/g, "") !== source.replace(/[\s,]+/g, "")) {
    throw new Error(`Sintassi transform SVG non valida: ${source}.`);
  }
  return result;
}

class PathBuilder {
  readonly verbs: number[] = [];
  readonly coords: number[] = [];
  readonly contourOffsets: number[] = [];
  private readonly matrix: Matrix;
  constructor(matrix: Matrix) {
    this.matrix = matrix;
  }
  move(x: number, y: number): void {
    const point = transformPoint(this.matrix, x, y);
    this.contourOffsets.push(this.verbs.length); this.verbs.push(0); this.coords.push(point.x, point.y);
  }
  line(x: number, y: number): void {
    const point = transformPoint(this.matrix, x, y); this.verbs.push(1); this.coords.push(point.x, point.y);
  }
  quad(cx: number, cy: number, x: number, y: number): void {
    const control = transformPoint(this.matrix, cx, cy); const end = transformPoint(this.matrix, x, y);
    this.verbs.push(2); this.coords.push(control.x, control.y, end.x, end.y);
  }
  cubic(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    const first = transformPoint(this.matrix, c1x, c1y); const second = transformPoint(this.matrix, c2x, c2y);
    const end = transformPoint(this.matrix, x, y); this.verbs.push(3);
    this.coords.push(first.x, first.y, second.x, second.y, end.x, end.y);
  }
  close(): void { this.verbs.push(4); }
  finish(fillRule: 0 | 1): Shadow3dPathData {
    if (this.verbs.length > VECTOR_SVG_MAXIMUM_COMMANDS) throw new Error(`SVG oltre ${VECTOR_SVG_MAXIMUM_COMMANDS} comandi vettoriali.`);
    return { verbs: new Uint8Array(this.verbs), coords: new Float64Array(this.coords), contourOffsets: new Uint32Array(this.contourOffsets), fillRule };
  }
}
function vectorAngle(firstX: number, firstY: number, secondX: number, secondY: number): number {
  const denominator = Math.max(Number.EPSILON, Math.hypot(firstX, firstY) * Math.hypot(secondX, secondY));
  const cosine = Math.min(1, Math.max(-1, (firstX * secondX + firstY * secondY) / denominator));
  return Math.sign(firstX * secondY - firstY * secondX || 1) * Math.acos(cosine);
}
function appendArcAsCubics(builder: PathBuilder, start: Point, radiusXValue: number, radiusYValue: number, rotationDegrees: number, largeArc: boolean, sweep: boolean, end: Point): void {
  if (start.x === end.x && start.y === end.y) return;
  let radiusX = Math.abs(radiusXValue); let radiusY = Math.abs(radiusYValue);
  if (radiusX <= Number.EPSILON || radiusY <= Number.EPSILON) { builder.line(end.x, end.y); return; }
  const phi = rotationDegrees * Math.PI / 180; const cosine = Math.cos(phi); const sine = Math.sin(phi);
  const deltaX = (start.x - end.x) * 0.5; const deltaY = (start.y - end.y) * 0.5;
  const xPrime = cosine * deltaX + sine * deltaY; const yPrime = -sine * deltaX + cosine * deltaY;
  const radiiScale = xPrime * xPrime / (radiusX * radiusX) + yPrime * yPrime / (radiusY * radiusY);
  if (radiiScale > 1) { const scale = Math.sqrt(radiiScale); radiusX *= scale; radiusY *= scale; }
  const numerator = Math.max(0, radiusX ** 2 * radiusY ** 2 - radiusX ** 2 * yPrime ** 2 - radiusY ** 2 * xPrime ** 2);
  const denominator = Math.max(Number.EPSILON, radiusX ** 2 * yPrime ** 2 + radiusY ** 2 * xPrime ** 2);
  const coefficient = (largeArc === sweep ? -1 : 1) * Math.sqrt(numerator / denominator);
  const centerPrimeX = coefficient * radiusX * yPrime / radiusY; const centerPrimeY = coefficient * -radiusY * xPrime / radiusX;
  const centerX = cosine * centerPrimeX - sine * centerPrimeY + (start.x + end.x) * 0.5;
  const centerY = sine * centerPrimeX + cosine * centerPrimeY + (start.y + end.y) * 0.5;
  const unitStartX = (xPrime - centerPrimeX) / radiusX; const unitStartY = (yPrime - centerPrimeY) / radiusY;
  const unitEndX = (-xPrime - centerPrimeX) / radiusX; const unitEndY = (-yPrime - centerPrimeY) / radiusY;
  let theta = vectorAngle(1, 0, unitStartX, unitStartY);
  let deltaTheta = vectorAngle(unitStartX, unitStartY, unitEndX, unitEndY);
  if (!sweep && deltaTheta > 0) deltaTheta -= Math.PI * 2; else if (sweep && deltaTheta < 0) deltaTheta += Math.PI * 2;
  const segmentCount = Math.max(1, Math.ceil(Math.abs(deltaTheta) / (Math.PI * 0.5)));
  const segmentAngle = deltaTheta / segmentCount;
  const pointAt = (angle: number): Point => ({ x: centerX + radiusX * cosine * Math.cos(angle) - radiusY * sine * Math.sin(angle), y: centerY + radiusX * sine * Math.cos(angle) + radiusY * cosine * Math.sin(angle) });
  const derivativeAt = (angle: number): Point => ({ x: -radiusX * cosine * Math.sin(angle) - radiusY * sine * Math.cos(angle), y: -radiusX * sine * Math.sin(angle) + radiusY * cosine * Math.cos(angle) });
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const nextTheta = theta + segmentAngle; const first = pointAt(theta); const last = pointAt(nextTheta);
    const firstDerivative = derivativeAt(theta); const lastDerivative = derivativeAt(nextTheta); const alpha = 4 / 3 * Math.tan(segmentAngle * 0.25);
    builder.cubic(first.x + firstDerivative.x * alpha, first.y + firstDerivative.y * alpha, last.x - lastDerivative.x * alpha, last.y - lastDerivative.y * alpha, last.x, last.y);
    theta = nextTheta;
  }
}
function parsePathData(data: string, matrix: Matrix, fillRule: 0 | 1): Shadow3dPathData {
  const tokenPattern = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
  const tokens = data.match(tokenPattern) ?? [];
  const residue = data.replace(tokenPattern, "").replace(/[\s,]+/g, "");
  if (residue.length > 0 || tokens.length === 0) throw new Error("Path SVG vuoto o con sintassi non valida.");
  const builder = new PathBuilder(matrix);
  let index = 0; let command = ""; let current: Point = { x: 0, y: 0 }; let start: Point = current;
  let previousCubicControl: Point | null = null; let previousQuadControl: Point | null = null;
  const isCommand = (value: string): boolean => /^[A-Za-z]$/.test(value);
  const take = (): number => {
    if (index >= tokens.length || isCommand(tokens[index])) throw new Error(`Coordinate insufficienti per il comando SVG ${command}.`);
    return finite(tokens[index++]);
  };
  while (index < tokens.length) {
    if (isCommand(tokens[index])) command = tokens[index++];
    else if (!command) throw new Error("Il path SVG deve iniziare con un comando.");
    const relative = command === command.toLowerCase(); const upper = command.toUpperCase();
    const absolutePoint = (x: number, y: number): Point => relative ? { x: current.x + x, y: current.y + y } : { x, y };
    if (upper === "Z") {
      builder.close(); current = start; previousCubicControl = null; previousQuadControl = null; command = ""; continue;
    }
    if (upper === "M") {
      const point = absolutePoint(take(), take()); builder.move(point.x, point.y); current = point; start = point;
      previousCubicControl = null; previousQuadControl = null; command = relative ? "l" : "L"; continue;
    }
    if (upper === "L") {
      const point = absolutePoint(take(), take()); builder.line(point.x, point.y); current = point;
    } else if (upper === "H") {
      const value = take(); const point = { x: relative ? current.x + value : value, y: current.y }; builder.line(point.x, point.y); current = point;
    } else if (upper === "V") {
      const value = take(); const point = { x: current.x, y: relative ? current.y + value : value }; builder.line(point.x, point.y); current = point;
    } else if (upper === "C") {
      const first = absolutePoint(take(), take()); const second = absolutePoint(take(), take()); const point = absolutePoint(take(), take());
      builder.cubic(first.x, first.y, second.x, second.y, point.x, point.y); current = point; previousCubicControl = second; previousQuadControl = null; continue;
    } else if (upper === "S") {
      const first = previousCubicControl ? { x: current.x * 2 - previousCubicControl.x, y: current.y * 2 - previousCubicControl.y } : current;
      const second = absolutePoint(take(), take()); const point = absolutePoint(take(), take());
      builder.cubic(first.x, first.y, second.x, second.y, point.x, point.y); current = point; previousCubicControl = second; previousQuadControl = null; continue;
    } else if (upper === "Q") {
      const control = absolutePoint(take(), take()); const point = absolutePoint(take(), take()); builder.quad(control.x, control.y, point.x, point.y);
      current = point; previousQuadControl = control; previousCubicControl = null; continue;
    } else if (upper === "T") {
      const control: Point = previousQuadControl ? { x: current.x * 2 - previousQuadControl.x, y: current.y * 2 - previousQuadControl.y } : current;
      const point = absolutePoint(take(), take()); builder.quad(control.x, control.y, point.x, point.y);
      current = point; previousQuadControl = control; previousCubicControl = null; continue;
    } else if (upper === "A") {
      const radiusX = take(); const radiusY = take(); const rotation = take(); const largeArc = take(); const sweep = take();
      if ((largeArc !== 0 && largeArc !== 1) || (sweep !== 0 && sweep !== 1)) throw new Error("I flag dell’arco SVG devono essere 0 oppure 1.");
      const point = absolutePoint(take(), take());
      appendArcAsCubics(builder, current, radiusX, radiusY, rotation, largeArc === 1, sweep === 1, point); current = point;
    } else throw new Error(`Comando path SVG non supportato: ${command}.`);
    previousCubicControl = null; previousQuadControl = null;
  }
  return builder.finish(fillRule);
}

function parsePoints(source: string): Point[] {
  const values = parseNumberList(source);
  if (values.length < 4 || values.length % 2 !== 0) throw new Error("La forma SVG richiede coppie di coordinate valide.");
  const points: Point[] = [];
  for (let index = 0; index < values.length; index += 2) points.push({ x: values[index], y: values[index + 1] });
  return points;
}
function shapePath(element: Element, matrix: Matrix, fillRule: 0 | 1): Shadow3dPathData {
  const name = element.localName.toLowerCase();
  if (name === "path") return parsePathData(element.getAttribute("d") ?? "", matrix, fillRule);
  const builder = new PathBuilder(matrix);
  if (name === "rect") {
    const x = finiteLength(element.getAttribute("x")); const y = finiteLength(element.getAttribute("y"));
    const width = finiteLength(element.getAttribute("width")); const height = finiteLength(element.getAttribute("height"));
    if (!(width > 0 && height > 0)) return builder.finish(fillRule);
    let radiusX = Math.max(0, finiteLength(element.getAttribute("rx"), 0));
    let radiusY = Math.max(0, finiteLength(element.getAttribute("ry"), radiusX));
    if (!element.hasAttribute("rx")) radiusX = radiusY;
    radiusX = Math.min(width * 0.5, radiusX); radiusY = Math.min(height * 0.5, radiusY);
    if (radiusX <= 0 || radiusY <= 0) {
      builder.move(x, y); builder.line(x + width, y); builder.line(x + width, y + height); builder.line(x, y + height); builder.close();
    } else {
      builder.move(x + radiusX, y); builder.line(x + width - radiusX, y);
      builder.cubic(x + width - radiusX + radiusX * KAPPA, y, x + width, y + radiusY - radiusY * KAPPA, x + width, y + radiusY);
      builder.line(x + width, y + height - radiusY);
      builder.cubic(x + width, y + height - radiusY + radiusY * KAPPA, x + width - radiusX + radiusX * KAPPA, y + height, x + width - radiusX, y + height);
      builder.line(x + radiusX, y + height);
      builder.cubic(x + radiusX - radiusX * KAPPA, y + height, x, y + height - radiusY + radiusY * KAPPA, x, y + height - radiusY);
      builder.line(x, y + radiusY);
      builder.cubic(x, y + radiusY - radiusY * KAPPA, x + radiusX - radiusX * KAPPA, y, x + radiusX, y); builder.close();
    }
  } else if (name === "circle" || name === "ellipse") {
    const centerX = finiteLength(element.getAttribute("cx")); const centerY = finiteLength(element.getAttribute("cy"));
    const radiusX = Math.max(0, finiteLength(element.getAttribute(name === "circle" ? "r" : "rx")));
    const radiusY = Math.max(0, finiteLength(element.getAttribute(name === "circle" ? "r" : "ry")));
    if (radiusX > 0 && radiusY > 0) {
      builder.move(centerX + radiusX, centerY);
      builder.cubic(centerX + radiusX, centerY + radiusY * KAPPA, centerX + radiusX * KAPPA, centerY + radiusY, centerX, centerY + radiusY);
      builder.cubic(centerX - radiusX * KAPPA, centerY + radiusY, centerX - radiusX, centerY + radiusY * KAPPA, centerX - radiusX, centerY);
      builder.cubic(centerX - radiusX, centerY - radiusY * KAPPA, centerX - radiusX * KAPPA, centerY - radiusY, centerX, centerY - radiusY);
      builder.cubic(centerX + radiusX * KAPPA, centerY - radiusY, centerX + radiusX, centerY - radiusY * KAPPA, centerX + radiusX, centerY); builder.close();
    }
  } else if (name === "line") {
    builder.move(finiteLength(element.getAttribute("x1")), finiteLength(element.getAttribute("y1")));
    builder.line(finiteLength(element.getAttribute("x2")), finiteLength(element.getAttribute("y2")));
  } else if (name === "polyline" || name === "polygon") {
    const points = parsePoints(element.getAttribute("points") ?? ""); builder.move(points[0].x, points[0].y);
    for (const point of points.slice(1)) builder.line(point.x, point.y);
    if (name === "polygon") builder.close();
  }
  return builder.finish(fillRule);
}

function samePoint(first: Point, second: Point): boolean {
  const scale = Math.max(1, Math.abs(first.x), Math.abs(first.y), Math.abs(second.x), Math.abs(second.y));
  return Math.abs(first.x - second.x) <= Number.EPSILON * 64 * scale
    && Math.abs(first.y - second.y) <= Number.EPSILON * 64 * scale;
}

function pointLineDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = Math.hypot(dx, dy);
  if (!(denominator > 0)) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / denominator;
}

function flattenQuadraticStroke(
  start: Point,
  control: Point,
  end: Point,
  tolerance: number,
  output: Point[],
  depth = 0,
): void {
  if (depth >= 20 || pointLineDistance(control, start, end) <= tolerance) {
    output.push(end);
    return;
  }
  const startControl = { x: (start.x + control.x) * 0.5, y: (start.y + control.y) * 0.5 };
  const controlEnd = { x: (control.x + end.x) * 0.5, y: (control.y + end.y) * 0.5 };
  const middle = { x: (startControl.x + controlEnd.x) * 0.5, y: (startControl.y + controlEnd.y) * 0.5 };
  flattenQuadraticStroke(start, startControl, middle, tolerance, output, depth + 1);
  flattenQuadraticStroke(middle, controlEnd, end, tolerance, output, depth + 1);
}

function flattenCubicStroke(
  start: Point,
  first: Point,
  second: Point,
  end: Point,
  tolerance: number,
  output: Point[],
  depth = 0,
): void {
  if (
    depth >= 20
    || Math.max(
      pointLineDistance(first, start, end),
      pointLineDistance(second, start, end),
    ) <= tolerance
  ) {
    output.push(end);
    return;
  }
  const a = { x: (start.x + first.x) * 0.5, y: (start.y + first.y) * 0.5 };
  const b = { x: (first.x + second.x) * 0.5, y: (first.y + second.y) * 0.5 };
  const c = { x: (second.x + end.x) * 0.5, y: (second.y + end.y) * 0.5 };
  const d = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
  const e = { x: (b.x + c.x) * 0.5, y: (b.y + c.y) * 0.5 };
  const middle = { x: (d.x + e.x) * 0.5, y: (d.y + e.y) * 0.5 };
  flattenCubicStroke(start, a, d, middle, tolerance, output, depth + 1);
  flattenCubicStroke(middle, e, c, end, tolerance, output, depth + 1);
}

function flattenStrokeSubpaths(path: Shadow3dPathData, tolerance: number): FlatStrokeSubpath[] {
  const output: FlatStrokeSubpath[] = [];
  let coordinateOffset = 0;
  let points: Point[] | null = null;
  let current: Point | null = null;
  let start: Point | null = null;
  const finish = (closed: boolean): void => {
    if (points && points.length >= 1) {
      const cleaned: Point[] = [];
      for (const point of points) {
        if (!cleaned.length || !samePoint(cleaned[cleaned.length - 1], point)) cleaned.push(point);
      }
      if (closed && cleaned.length > 1 && samePoint(cleaned[0], cleaned[cleaned.length - 1])) cleaned.pop();
      if (cleaned.length >= 1) output.push({ points: cleaned, closed: closed && cleaned.length >= 2 });
    }
    points = null;
    current = null;
    start = null;
  };
  for (const rawVerb of path.verbs) {
    const verb = Number(rawVerb);
    if (verb === 0) {
      finish(false);
      current = { x: path.coords[coordinateOffset], y: path.coords[coordinateOffset + 1] };
      coordinateOffset += 2;
      start = current;
      points = [current];
    } else if (verb === 1 && points && current) {
      current = { x: path.coords[coordinateOffset], y: path.coords[coordinateOffset + 1] };
      coordinateOffset += 2;
      points.push(current);
    } else if (verb === 2 && points && current) {
      const control = { x: path.coords[coordinateOffset], y: path.coords[coordinateOffset + 1] };
      const end = { x: path.coords[coordinateOffset + 2], y: path.coords[coordinateOffset + 3] };
      coordinateOffset += 4;
      flattenQuadraticStroke(current, control, end, tolerance, points);
      current = end;
    } else if (verb === 3 && points && current) {
      const first = { x: path.coords[coordinateOffset], y: path.coords[coordinateOffset + 1] };
      const second = { x: path.coords[coordinateOffset + 2], y: path.coords[coordinateOffset + 3] };
      const end = { x: path.coords[coordinateOffset + 4], y: path.coords[coordinateOffset + 5] };
      coordinateOffset += 6;
      flattenCubicStroke(current, first, second, end, tolerance, points);
      current = end;
    } else if (verb === 4 && points && current && start) {
      finish(true);
    } else {
      throw new Error("Geometria SVG non valida durante l'espansione della traccia.");
    }
  }
  finish(false);
  return output;
}

function parseDashArray(source: string, percentageReference: number): number[] {
  const normalized = source.trim().toLowerCase();
  if (!normalized || normalized === "none") return [];
  const values = normalized.split(/[\s,]+/).filter(Boolean).map((value) => (
    finiteStrokeLength(value, percentageReference)
  ));
  if (values.some((value) => value < 0)) throw new Error("stroke-dasharray SVG non può contenere valori negativi.");
  if (values.every((value) => value <= Number.EPSILON)) return [];
  return values.length % 2 === 0 ? values : [...values, ...values];
}

function dashedStrokeSubpaths(
  subpath: FlatStrokeSubpath,
  dashArray: readonly number[],
  dashOffset: number,
): FlatStrokeSubpath[] {
  if (dashArray.length === 0) return [subpath];
  const total = dashArray.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return [subpath];
  const source = subpath.closed
    ? [...subpath.points, subpath.points[0]]
    : [...subpath.points];
  let phase = ((dashOffset % total) + total) % total;
  let patternIndex = 0;
  let guard = 0;
  while (phase > 0 && guard < dashArray.length * 2) {
    const length = dashArray[patternIndex];
    if (length > phase) break;
    phase -= length;
    patternIndex = (patternIndex + 1) % dashArray.length;
    guard += 1;
  }
  let remaining = dashArray[patternIndex] - phase;
  let drawing = patternIndex % 2 === 0;
  const result: FlatStrokeSubpath[] = [];
  let currentDash: Point[] = [];
  const flush = (): void => {
    if (currentDash.length >= 2) result.push({ points: currentDash, closed: false });
    currentDash = [];
  };
  const advanceZeroSegments = (): void => {
    let zeroGuard = 0;
    while (remaining <= Number.EPSILON && zeroGuard <= dashArray.length) {
      if (drawing) flush();
      patternIndex = (patternIndex + 1) % dashArray.length;
      drawing = patternIndex % 2 === 0;
      remaining = dashArray[patternIndex];
      zeroGuard += 1;
    }
  };
  advanceZeroSegments();
  for (let segmentIndex = 1; segmentIndex < source.length; segmentIndex += 1) {
    const start = source[segmentIndex - 1];
    const end = source[segmentIndex];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!(length > 0)) continue;
    let consumed = 0;
    while (consumed < length - Number.EPSILON) {
      advanceZeroSegments();
      const step = Math.min(remaining, length - consumed);
      const firstT = consumed / length;
      const lastT = (consumed + step) / length;
      const first = { x: start.x + (end.x - start.x) * firstT, y: start.y + (end.y - start.y) * firstT };
      const last = { x: start.x + (end.x - start.x) * lastT, y: start.y + (end.y - start.y) * lastT };
      if (drawing) {
        if (!currentDash.length || !samePoint(currentDash[currentDash.length - 1], first)) currentDash.push(first);
        currentDash.push(last);
      }
      consumed += step;
      remaining -= step;
      if (remaining <= Number.EPSILON) {
        if (drawing) flush();
        patternIndex = (patternIndex + 1) % dashArray.length;
        drawing = patternIndex % 2 === 0;
        remaining = dashArray[patternIndex];
      }
    }
  }
  flush();
  return result;
}

function expandedStrokePath(
  localPath: Shadow3dPathData,
  matrix: Matrix,
  style: StyleState,
  percentageReference: number,
): Shadow3dPathData {
  const width = finiteStrokeLength(style.strokeWidth, percentageReference, 1);
  const builder = new PathBuilder(matrix);
  if (!(width > 0)) return builder.finish(0);
  const tolerance = Math.max(0.025, Math.min(0.5, width / 8));
  const dashArray = parseDashArray(style.strokeDasharray, percentageReference);
  const dashOffset = finiteStrokeLength(style.strokeDashoffset, percentageReference, 0);
  const join = style.strokeLinejoin === "round"
    ? JoinType.Round
    : style.strokeLinejoin === "bevel"
      ? JoinType.Bevel
      : JoinType.Miter;
  const cap = style.strokeLinecap === "round"
    ? EndType.Round
    : style.strokeLinecap === "square"
      ? EndType.Square
      : EndType.Butt;
  for (const sourceSubpath of flattenStrokeSubpaths(localPath, tolerance)) {
    if (sourceSubpath.points.length === 1) {
      if (style.strokeLinecap === "butt") continue;
      const point = sourceSubpath.points[0];
      const radius = width * 0.5;
      if (style.strokeLinecap === "square") {
        builder.move(point.x - radius, point.y - radius);
        builder.line(point.x + radius, point.y - radius);
        builder.line(point.x + radius, point.y + radius);
        builder.line(point.x - radius, point.y + radius);
        builder.close();
      } else {
        builder.move(point.x + radius, point.y);
        builder.cubic(point.x + radius, point.y + radius * KAPPA, point.x + radius * KAPPA, point.y + radius, point.x, point.y + radius);
        builder.cubic(point.x - radius * KAPPA, point.y + radius, point.x - radius, point.y + radius * KAPPA, point.x - radius, point.y);
        builder.cubic(point.x - radius, point.y - radius * KAPPA, point.x - radius * KAPPA, point.y - radius, point.x, point.y - radius);
        builder.cubic(point.x + radius * KAPPA, point.y - radius, point.x + radius, point.y - radius * KAPPA, point.x + radius, point.y);
        builder.close();
      }
      continue;
    }
    for (const subpath of dashedStrokeSubpaths(sourceSubpath, dashArray, dashOffset)) {
      const points: PathD = subpath.points.map((point) => ({ x: point.x, y: point.y }));
      const endType = subpath.closed && dashArray.length === 0 ? EndType.Joined : cap;
      const outlines = inflatePathsD(
        [points],
        width * 0.5,
        join,
        endType,
        style.strokeMiterlimit,
        4,
        tolerance,
      );
      for (const outline of outlines) {
        if (outline.length < 3) continue;
        builder.move(outline[0].x, outline[0].y);
        for (const point of outline.slice(1)) builder.line(point.x, point.y);
        builder.close();
      }
    }
  }
  return builder.finish(0);
}

function parseDeclarations(source: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of source.split(";")) {
    const separator = part.indexOf(":"); if (separator < 0) continue;
    const property = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim().replace(/\s*!important\s*$/i, "");
    if (STYLE_PROPERTIES.has(property) && value) declarations.set(property, value);
  }
  return declarations;
}
function parseCssRules(root: Element): CssRule[] {
  const rules: CssRule[] = [];
  for (const style of root.querySelectorAll("style")) {
    const source = (style.textContent ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (/@import/i.test(source) || !hasOnlyLocalPaintUrls(source)) {
      throw new Error("Lo stile SVG non può caricare risorse esterne.");
    }
    for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = parseDeclarations(match[2]);
      for (const selector of match[1].split(",")) {
        const normalized = selector.trim();
        if (/^(?:[a-zA-Z][\w-]*|\.[\w-]+|#[\w-]+)$/.test(normalized)) rules.push({ selector: normalized, declarations });
      }
    }
  }
  return rules;
}

function hasOnlyLocalPaintUrls(source: string): boolean {
  const references = [...source.matchAll(/url\s*\(([^)]*)\)/gi)];
  return references.every((match) => /^\s*["']?#[\w:.-]+["']?\s*$/.test(match[1]));
}
function selectorMatches(element: Element, selector: string): boolean {
  if (selector.startsWith(".")) return element.classList.contains(selector.slice(1));
  if (selector.startsWith("#")) return element.id === selector.slice(1);
  return element.localName.toLowerCase() === selector.toLowerCase();
}
function applyDeclarations(style: StyleState, declarations: ReadonlyMap<string, string>): number | null {
  let opacity: number | null = null;
  for (const [property, value] of declarations) {
    if (property === "fill") style.fill = value; else if (property === "color") style.color = value;
    else if (property === "fill-opacity") style.fillOpacity = clampUnit(finite(value, 1));
    else if (property === "fill-rule") style.fillRule = value.toLowerCase() === "evenodd" ? 1 : 0;
    else if (property === "stroke") style.stroke = value; else if (property === "stroke-opacity") style.strokeOpacity = clampUnit(finite(value, 1));
    else if (property === "stroke-width") style.strokeWidth = value;
    else if (property === "stroke-linecap") {
      const normalized = value.toLowerCase();
      if (normalized === "butt" || normalized === "round" || normalized === "square") {
        style.strokeLinecap = normalized;
      }
    } else if (property === "stroke-linejoin") {
      const normalized = value.toLowerCase();
      if (normalized === "miter" || normalized === "round" || normalized === "bevel") {
        style.strokeLinejoin = normalized;
      }
    } else if (property === "stroke-miterlimit") style.strokeMiterlimit = Math.max(1, finite(value, 4));
    else if (property === "stroke-dasharray") style.strokeDasharray = value;
    else if (property === "stroke-dashoffset") style.strokeDashoffset = value;
    else if (property === "display") style.display = value.toLowerCase(); else if (property === "visibility") style.visibility = value.toLowerCase();
    else if (property === "opacity") opacity = clampUnit(finite(value, 1));
  }
  return opacity;
}
function resolvedStyle(element: Element, inherited: StyleState, rules: readonly CssRule[]): { style: StyleState; opacity: number } {
  const style: StyleState = { ...inherited }; const presentation = new Map<string, string>();
  for (const property of STYLE_PROPERTIES) { const value = element.getAttribute(property); if (value !== null) presentation.set(property, value); }
  let opacity = applyDeclarations(style, presentation) ?? 1;
  for (const rule of rules) {
    if (!selectorMatches(element, rule.selector)) continue;
    opacity = applyDeclarations(style, rule.declarations) ?? opacity;
  }
  opacity = applyDeclarations(style, parseDeclarations(element.getAttribute("style") ?? "")) ?? opacity;
  return { style, opacity: clampUnit(opacity) };
}
let colorContext: CanvasRenderingContext2D | null = null;
function parseSolidColor(source: string, currentColor: string): { color: string; alpha: number } | null {
  const normalized = source.trim().toLowerCase();
  if (normalized === "none") return null;
  if (normalized === "currentcolor") return parseSolidColor(currentColor, "#000000");
  if (normalized === "transparent") return { color: "#000000", alpha: 0 };
  if (/url\s*\(/i.test(normalized)) throw new Error("Riferimento a una risorsa SVG usato dove era atteso un colore.");
  colorContext ??= document.createElement("canvas").getContext("2d");
  if (!colorContext) throw new Error("Parser colore Canvas2D non disponibile.");
  colorContext.fillStyle = "#010203"; colorContext.fillStyle = source;
  const parsed = String(colorContext.fillStyle);
  if (parsed === "#010203" && normalized !== "#010203" && normalized !== "rgb(1, 2, 3)") throw new Error(`Colore SVG non supportato: ${source}.`);
  if (/^#[0-9a-f]{6}$/i.test(parsed)) return { color: parsed.toLowerCase(), alpha: 1 };
  const rgba = parsed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/i);
  if (!rgba) throw new Error(`Colore SVG non supportato: ${source}.`);
  const hex = [rgba[1], rgba[2], rgba[3]].map((value) => Math.min(255, Number(value)).toString(16).padStart(2, "0")).join("");
  return { color: `#${hex}`, alpha: clampUnit(rgba[4] === undefined ? 1 : Number(rgba[4])) };
}

function cascadedProperty(
  element: Element,
  rules: readonly CssRule[],
  property: string,
  fallback: string,
): string {
  let value = element.getAttribute(property) ?? fallback;
  for (const rule of rules) {
    if (selectorMatches(element, rule.selector)) value = rule.declarations.get(property) ?? value;
  }
  value = parseDeclarations(element.getAttribute("style") ?? "").get(property) ?? value;
  return value;
}

function gradientStopElements(
  element: Element,
  rules: readonly CssRule[],
): VectorSvgGradientStop[] {
  const stops: VectorSvgGradientStop[] = [];
  let priorOffset = 0;
  for (const stop of [...element.children].filter((child) => child.localName.toLowerCase() === "stop")) {
    const offsetSource = stop.getAttribute("offset")?.trim() ?? "0";
    const parsedOffset = offsetSource.endsWith("%")
      ? finite(offsetSource.slice(0, -1)) / 100
      : finite(offsetSource);
    const offset = Math.max(priorOffset, clampUnit(parsedOffset));
    priorOffset = offset;
    const currentColor = cascadedProperty(stop, rules, "color", "#000000");
    const parsed = parseSolidColor(
      cascadedProperty(stop, rules, "stop-color", "#000000"),
      currentColor,
    ) ?? { color: "#000000", alpha: 0 };
    const stopOpacity = clampUnit(finite(cascadedProperty(stop, rules, "stop-opacity", "1"), 1));
    const opacity = clampUnit(finite(cascadedProperty(stop, rules, "opacity", "1"), 1));
    stops.push({ offset, color: parsed.color, opacity: parsed.alpha * stopOpacity * opacity });
  }
  return stops;
}

function hexChannels(color: string): readonly [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function sampleGradientStops(
  stops: readonly VectorSvgGradientStop[],
  offset: number,
): VectorSvgGradientStop {
  if (offset <= stops[0].offset) return { ...stops[0], offset };
  const last = stops[stops.length - 1];
  if (offset >= last.offset) return { ...last, offset };
  let rightIndex = 1;
  while (rightIndex < stops.length && stops[rightIndex].offset < offset) rightIndex += 1;
  const left = stops[rightIndex - 1];
  const right = stops[rightIndex];
  const span = right.offset - left.offset;
  const t = span > Number.EPSILON ? (offset - left.offset) / span : 1;
  const leftRgb = hexChannels(left.color);
  const rightRgb = hexChannels(right.color);
  const channels = leftRgb.map((value, index) => Math.round(value + (rightRgb[index] - value) * t));
  return {
    offset,
    color: `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`,
    opacity: left.opacity + (right.opacity - left.opacity) * t,
  };
}

function normalizeGradientStops(stops: readonly VectorSvgGradientStop[]): VectorSvgGradientStop[] {
  if (stops.length === 0) throw new Error("Il gradiente SVG non contiene stop colore.");
  const complete = stops.length === 1 ? [stops[0], { ...stops[0], offset: 1 }] : [...stops];
  if (complete.length <= VECTOR_SVG_MAXIMUM_GRADIENT_STOPS) return complete;
  return Array.from({ length: VECTOR_SVG_MAXIMUM_GRADIENT_STOPS }, (_, index) => (
    sampleGradientStops(complete, index / (VECTOR_SVG_MAXIMUM_GRADIENT_STOPS - 1))
  ));
}

function parseGradientDefinitions(
  root: Element,
  rules: readonly CssRule[],
): GradientRegistry {
  const elements = new Map<string, Element>();
  for (const element of root.querySelectorAll("linearGradient, radialGradient")) {
    const id = element.id.trim();
    if (id) elements.set(id, element);
  }
  const resolved = new Map<string, GradientDefinition>();
  const resolving = new Set<string>();
  const resolve = (id: string): GradientDefinition => {
    const cached = resolved.get(id);
    if (cached) return cached;
    const element = elements.get(id);
    if (!element) throw new Error(`Gradiente SVG #${id} inesistente.`);
    if (resolving.has(id)) throw new Error(`Riferimento ciclico nel gradiente SVG #${id}.`);
    resolving.add(id);
    const href = element.getAttribute("href") ?? element.getAttribute("xlink:href");
    const base = href?.startsWith("#") ? resolve(href.slice(1)) : null;
    const kind = element.localName.toLowerCase() === "radialgradient" ? "radial" : "linear";
    const attribute = (name: string, fallback: string): string => (
      element.hasAttribute(name) ? element.getAttribute(name) ?? fallback : fallback
    );
    const unitsValue = attribute("gradientUnits", base?.units ?? "objectBoundingBox");
    const units = unitsValue === "userSpaceOnUse" ? "userSpaceOnUse" : "objectBoundingBox";
    const spreadValue = attribute("spreadMethod", base?.spread ?? "pad").toLowerCase();
    const spread = spreadValue === "repeat" || spreadValue === "reflect" ? spreadValue : "pad";
    const transform = element.hasAttribute("gradientTransform")
      ? parseTransform(element.getAttribute("gradientTransform"))
      : base?.transform ?? IDENTITY_MATRIX;
    const ownStops = gradientStopElements(element, rules);
    const stops = normalizeGradientStops(ownStops.length ? ownStops : base?.stops ?? []);
    let geometry: readonly [string, string, string, string];
    let focal: readonly [string, string];
    if (kind === "linear") {
      const fallback = base?.kind === "linear" ? base.geometry : ["0%", "0%", "100%", "0%"] as const;
      geometry = [
        attribute("x1", fallback[0]),
        attribute("y1", fallback[1]),
        attribute("x2", fallback[2]),
        attribute("y2", fallback[3]),
      ];
      focal = ["0", "0"];
    } else {
      const fallback = base?.kind === "radial" ? base.geometry : ["50%", "50%", "50%", "0%"] as const;
      const centerX = attribute("cx", fallback[0]);
      const centerY = attribute("cy", fallback[1]);
      geometry = [centerX, centerY, attribute("r", fallback[2]), attribute("fr", fallback[3])];
      const baseFocal = base?.kind === "radial" ? base.focal : [centerX, centerY] as const;
      focal = [attribute("fx", baseFocal[0]), attribute("fy", baseFocal[1])];
    }
    const definition: GradientDefinition = { kind, units, spread, transform, geometry, focal, stops };
    resolving.delete(id);
    resolved.set(id, definition);
    return definition;
  };
  return {
    get(id: string): GradientDefinition | undefined {
      return elements.has(id) ? resolve(id) : undefined;
    },
  };
}

function gradientLength(
  source: string,
  units: GradientDefinition["units"],
  axis: "x" | "y" | "radius",
  viewBox: readonly [number, number, number, number] | null,
): number {
  const normalized = source.trim();
  const isPercentage = normalized.endsWith("%");
  const ratio = isPercentage ? finite(normalized.slice(0, -1)) / 100 : finiteLength(normalized);
  if (units === "objectBoundingBox") return ratio;
  if (!isPercentage) return ratio;
  const box = viewBox ?? [0, 0, 1, 1] as const;
  if (axis === "x") return box[0] + ratio * box[2];
  if (axis === "y") return box[1] + ratio * box[3];
  return ratio * Math.hypot(box[2], box[3]) / Math.SQRT2;
}

function resolveGradient(
  definition: GradientDefinition,
  localMatrix: Matrix,
  localBounds: VectorTextBounds,
  viewBox: readonly [number, number, number, number] | null,
): VectorSvgGradient {
  if (
    definition.units === "objectBoundingBox"
    && (!(localBounds.right > localBounds.left) || !(localBounds.bottom > localBounds.top))
  ) {
    throw new Error("Gradiente objectBoundingBox applicato a una forma SVG senza area.");
  }
  const unitsMatrix = definition.units === "objectBoundingBox"
    ? boxMatrix(localBounds)
    : IDENTITY_MATRIX;
  const transform = multiply(multiply(localMatrix, unitsMatrix), definition.transform);
  const geometry: [number, number, number, number] = [
    gradientLength(definition.geometry[0], definition.units, "x", viewBox),
    gradientLength(definition.geometry[1], definition.units, "y", viewBox),
    gradientLength(definition.geometry[2], definition.units, definition.kind === "radial" ? "radius" : "x", viewBox),
    gradientLength(definition.geometry[3], definition.units, definition.kind === "radial" ? "radius" : "y", viewBox),
  ];
  const focal: [number, number] = [
    gradientLength(definition.focal[0], definition.units, "x", viewBox),
    gradientLength(definition.focal[1], definition.units, "y", viewBox),
  ];
  return {
    kind: definition.kind,
    spread: definition.spread,
    transform,
    geometry,
    focal,
    stops: definition.stops.map((stop) => ({ ...stop })),
  };
}

function representativeGradientColor(stops: readonly VectorSvgGradientStop[]): string {
  return sampleGradientStops(stops, 0.5).color;
}

function parsePaint(
  source: string,
  currentColor: string,
  gradients: GradientRegistry,
  localMatrix: Matrix,
  localBounds: VectorTextBounds,
  viewBox: readonly [number, number, number, number] | null,
): { color: string; alpha: number; gradient?: VectorSvgGradient; gradientKey: string } | null {
  const normalized = source.trim();
  const reference = normalized.match(/^url\(\s*["']?#([\w:.-]+)["']?\s*\)(?:\s+.*)?$/i);
  if (!reference) {
    const solid = parseSolidColor(source, currentColor);
    return solid ? { ...solid, gradientKey: "" } : null;
  }
  const definition = gradients.get(reference[1]);
  if (!definition) throw new Error(`Gradiente SVG #${reference[1]} inesistente.`);
  const gradient = resolveGradient(definition, localMatrix, localBounds, viewBox);
  const gradientKey = JSON.stringify(gradient);
  return {
    color: representativeGradientColor(gradient.stops),
    alpha: 1,
    gradient,
    gradientKey,
  };
}
function pathLogicalBytes(path: Shadow3dPathData): number {
  return path.verbs.byteLength + path.coords.byteLength + path.contourOffsets.byteLength;
}
function stableHash(source: Uint8Array): string {
  let first = 0x811c9dc5; let second = 0x9e3779b9;
  for (const value of source) {
    first ^= value; first = Math.imul(first, 0x01000193) >>> 0;
    second ^= value + 0x9d; second = Math.imul(second, 0x85ebca6b) >>> 0;
  }
  return first.toString(16).padStart(8, "0") + second.toString(16).padStart(8, "0");
}
function clonePath(path: Shadow3dPathData): Shadow3dPathData {
  return { verbs: path.verbs.slice(), coords: path.coords.slice(), contourOffsets: path.contourOffsets.slice(), fillRule: path.fillRule };
}
export function cloneVectorSvgDocument(documentValue: VectorSvgDocument): VectorSvgDocument {
  return {
    ...documentValue,
    viewBox: documentValue.viewBox ? [...documentValue.viewBox] as [number, number, number, number] : null,
    bounds: { ...documentValue.bounds },
    paints: documentValue.paints.map((paint) => ({
      ...paint,
      path: clonePath(paint.path),
      gradient: paint.gradient ? {
        ...paint.gradient,
        transform: [...paint.gradient.transform] as unknown as Matrix,
        geometry: [...paint.gradient.geometry] as [number, number, number, number],
        focal: [...paint.gradient.focal] as [number, number],
        stops: paint.gradient.stops.map((stop) => ({ ...stop })),
      } : undefined,
      strokes: paint.strokes?.map((stroke) => ({
        ...stroke,
        sourcePath: clonePath(stroke.sourcePath),
        transform: [...stroke.transform] as unknown as Matrix,
        dashArray: [...stroke.dashArray],
      })),
    })),
    silhouettePath: clonePath(documentValue.silhouettePath),
  };
}
function validateSecurity(root: Element, source: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("DOCTYPE ed entità XML non sono consentiti negli SVG importati.");
  for (const element of [root, ...root.querySelectorAll("*")]) {
    const name = element.localName.toLowerCase();
    if (!SAFE_ELEMENTS.has(name)) throw new Error(`Elemento SVG non supportato o non sicuro: <${name}>.`);
    for (const attribute of [...element.attributes]) {
      const attributeName = attribute.name.toLowerCase(); const value = attribute.value.trim();
      if (attributeName.startsWith("on")) throw new Error(`Handler evento SVG non consentito: ${attribute.name}.`);
      if (attributeName === "href" || attributeName.endsWith(":href")) {
        const gradientHref = name === "lineargradient" || name === "radialgradient";
        if (!gradientHref || !/^#[\w:.-]+$/.test(value)) {
          throw new Error("Sono consentiti solo riferimenti href locali fra gradienti SVG.");
        }
      }
      if (["filter", "mask", "clip-path"].includes(attributeName) && value.toLowerCase() !== "none") throw new Error(`${attribute.name} SVG non è ancora supportato.`);
      if (/url\s*\(/i.test(value)) {
        const paintAttribute = attributeName === "fill" || attributeName === "stroke" || attributeName === "style";
        if (!paintAttribute || !hasOnlyLocalPaintUrls(value)) {
          throw new Error("Sono consentiti solo riferimenti url(#id) locali per fill e stroke SVG.");
        }
      }
    }
  }
}
function parseViewBox(root: Element): readonly [number, number, number, number] | null {
  const source = root.getAttribute("viewBox"); if (!source) return null;
  const values = parseNumberList(source);
  if (values.length !== 4 || !(values[2] > 0 && values[3] > 0)) throw new Error("viewBox SVG non valida.");
  return values as unknown as readonly [number, number, number, number];
}

function svgCoordinateViewport(
  root: Element,
  viewBox: readonly [number, number, number, number] | null,
): readonly [number, number, number, number] {
  if (viewBox) return viewBox;
  const rootLength = (value: string | null, fallback: number): number => {
    const normalized = value?.trim() ?? "";
    if (normalized === "" || normalized.endsWith("%")) return fallback;
    return finiteLength(normalized, fallback);
  };
  const width = Math.max(1, rootLength(root.getAttribute("width"), 300));
  const height = Math.max(1, rootLength(root.getAttribute("height"), 150));
  return [0, 0, width, height];
}

export function parseVectorSvg(source: string, sourceName = "import.svg"): VectorSvgDocument {
  const bytes = new TextEncoder().encode(source);
  if (bytes.byteLength > VECTOR_SVG_MAXIMUM_SOURCE_BYTES) throw new Error(`SVG oltre ${(VECTOR_SVG_MAXIMUM_SOURCE_BYTES / 1024 / 1024).toFixed(0)} MiB.`);
  const xml = new DOMParser().parseFromString(source, "image/svg+xml");
  const parserError = xml.querySelector("parsererror");
  if (parserError) throw new Error("XML SVG non valido: " + (parserError.textContent ?? "errore parser"));
  const root = xml.documentElement;
  if (root.localName.toLowerCase() !== "svg") throw new Error("Il file non contiene una radice <svg>.");
  validateSecurity(root, source);
  const viewBox = parseViewBox(root);
  const coordinateViewport = svgCoordinateViewport(root, viewBox);
  const strokePercentageReference = Math.hypot(
    coordinateViewport[2],
    coordinateViewport[3],
  ) / Math.SQRT2;
  const rules = parseCssRules(root);
  const gradients = parseGradientDefinitions(root, rules);
  const rawPaints: RawPaint[] = [];
  let elementCount = 0; let commandCount = 0;
  const defaults: StyleState = {
    fill: "#000000",
    color: "#000000",
    fillOpacity: 1,
    fillRule: 0,
    stroke: "none",
    strokeOpacity: 1,
    strokeWidth: "1",
    strokeLinecap: "butt",
    strokeLinejoin: "miter",
    strokeMiterlimit: 4,
    strokeDasharray: "none",
    strokeDashoffset: "0",
    display: "inline",
    visibility: "visible",
  };
  const appendPaint = (paint: RawPaint): void => {
    if (paint.path.verbs.length === 0 || paint.opacity <= 0) return;
    commandCount += paint.path.verbs.length;
    if (commandCount > VECTOR_SVG_MAXIMUM_COMMANDS) {
      throw new Error(`SVG oltre ${VECTOR_SVG_MAXIMUM_COMMANDS} comandi vettoriali.`);
    }
    rawPaints.push(paint);
  };
  const walk = (element: Element, parentMatrix: Matrix, inheritedStyle: StyleState, inheritedOpacity: number): void => {
    const name = element.localName.toLowerCase();
    if (name === "defs" || name === "style" || name === "title" || name === "desc" || name === "metadata") return;
    const localMatrix = multiply(parentMatrix, parseTransform(element.getAttribute("transform")));
    const resolved = resolvedStyle(element, inheritedStyle, rules); const opacity = inheritedOpacity * resolved.opacity;
    if (resolved.style.display === "none" || resolved.style.visibility === "hidden" || opacity <= 0) return;
    if (CONTAINER_ELEMENTS.has(name)) { for (const child of [...element.children]) walk(child, localMatrix, resolved.style, opacity); return; }
    if (!GEOMETRY_ELEMENTS.has(name)) return;
    elementCount += 1;
    const localPath = shapePath(element, IDENTITY_MATRIX, resolved.style.fillRule);
    if (localPath.verbs.length === 0) return;
    const localBounds = vectorTextPathBounds(localPath);
    const fill = parsePaint(
      resolved.style.fill,
      resolved.style.color,
      gradients,
      localMatrix,
      localBounds,
      coordinateViewport,
    );
    const fillOpacity = fill
      ? clampUnit(fill.alpha * resolved.style.fillOpacity * opacity)
      : 0;
    if (fill && fillOpacity > 0) {
      appendPaint({
        color: fill.color,
        opacity: fillOpacity,
        fillRule: resolved.style.fillRule,
        path: shapePath(element, localMatrix, resolved.style.fillRule),
        gradient: fill.gradient,
        gradientKey: fill.gradientKey,
        strokeKey: "",
      });
    }
    const stroke = parsePaint(
      resolved.style.stroke,
      resolved.style.color,
      gradients,
      localMatrix,
      localBounds,
      coordinateViewport,
    );
    const width = finiteStrokeLength(
      resolved.style.strokeWidth,
      strokePercentageReference,
      1,
    );
    const strokeOpacity = stroke
      ? clampUnit(stroke.alpha * resolved.style.strokeOpacity * opacity)
      : 0;
    if (stroke && width > 0 && strokeOpacity > 0) {
      const dashArray = parseDashArray(
        resolved.style.strokeDasharray,
        strokePercentageReference,
      );
      const dashOffset = finiteStrokeLength(
        resolved.style.strokeDashoffset,
        strokePercentageReference,
        0,
      );
      const strokeSemantics: VectorSvgStroke = {
        sourcePath: clonePath(localPath),
        transform: localMatrix,
        width,
        linecap: resolved.style.strokeLinecap,
        linejoin: resolved.style.strokeLinejoin,
        miterLimit: resolved.style.strokeMiterlimit,
        dashArray,
        dashOffset,
      };
      const strokeKey = JSON.stringify({
        width,
        linecap: strokeSemantics.linecap,
        linejoin: strokeSemantics.linejoin,
        miterLimit: strokeSemantics.miterLimit,
        dashArray,
        dashOffset,
      });
      appendPaint({
        color: stroke.color,
        opacity: strokeOpacity,
        fillRule: 0,
        path: expandedStrokePath(
          localPath,
          localMatrix,
          resolved.style,
          strokePercentageReference,
        ),
        gradient: stroke.gradient,
        gradientKey: stroke.gradientKey,
        strokes: [strokeSemantics],
        strokeKey,
      });
    }
  };
  const rootResolved = resolvedStyle(root, defaults, rules); const rootMatrix = parseTransform(root.getAttribute("transform"));
  for (const child of [...root.children]) walk(child, rootMatrix, rootResolved.style, rootResolved.opacity);
  if (rawPaints.length === 0) throw new Error("L’SVG non contiene riempimenti vettoriali visibili.");
  const fillRules = new Set(rawPaints.map((paint) => paint.fillRule));
  if (fillRules.size > 1) throw new Error("SVG con fill-rule misti non ancora supportato nello stesso oggetto.");
  const rawSilhouette = mergeVectorTextPaths(rawPaints.map((paint) => paint.path)); rawSilhouette.fillRule = rawPaints[0].fillRule;
  const rawBounds = vectorTextPathBounds(rawSilhouette); const centerX = (rawBounds.left + rawBounds.right) * 0.5; const centerY = (rawBounds.top + rawBounds.bottom) * 0.5;
  const centeredRawPaints = rawPaints.map((paint) => ({
    ...paint,
    path: shiftVectorTextPath(paint.path, -centerX, -centerY),
    gradient: paint.gradient ? {
      ...paint.gradient,
      transform: translated(paint.gradient.transform, -centerX, -centerY),
      geometry: [...paint.gradient.geometry] as [number, number, number, number],
      focal: [...paint.gradient.focal] as [number, number],
      stops: paint.gradient.stops.map((stop) => ({ ...stop })),
    } : undefined,
    strokes: paint.strokes?.map((stroke) => ({
      ...stroke,
      transform: translated(stroke.transform, -centerX, -centerY),
      sourcePath: clonePath(stroke.sourcePath),
      dashArray: [...stroke.dashArray],
    })),
  }));
  const grouped: RawPaint[] = [];
  for (const paint of centeredRawPaints) {
    const previous = grouped[grouped.length - 1];
    if (
      previous
      && previous.color === paint.color
      && previous.opacity === paint.opacity
      && previous.fillRule === paint.fillRule
      && previous.gradientKey === paint.gradientKey
      && previous.strokeKey === paint.strokeKey
    ) {
      grouped[grouped.length - 1] = {
        ...previous,
        path: mergeVectorTextPaths([previous.path, paint.path]),
        strokes: previous.strokes || paint.strokes
          ? [...(previous.strokes ?? []), ...(paint.strokes ?? [])]
          : undefined,
      };
    } else grouped.push(paint);
  }
  const sourceHash = stableHash(bytes); const sourceRevision = `svg:${sourceHash}`;
  const paints: VectorSvgPaint[] = grouped.map((paint, index) => ({
    id: index,
    color: paint.color,
    opacity: paint.opacity,
    fillRule: paint.fillRule,
    path: paint.path,
    gradient: paint.gradient,
    strokes: paint.strokes,
    revision: `${sourceRevision}:paint:${index}`,
  }));
  const silhouettePath = shiftVectorTextPath(rawSilhouette, -centerX, -centerY); const bounds = vectorTextPathBounds(silhouettePath);
  const silhouetteRevision = `${sourceRevision}:silhouette`;
  const logicalVectorBytes = paints.reduce((total, paint) => (
    total
      + pathLogicalBytes(paint.path)
      + (paint.strokes?.reduce((sum, stroke) => sum + pathLogicalBytes(stroke.sourcePath), 0) ?? 0)
  ), 0) + pathLogicalBytes(silhouettePath);
  return Object.freeze({
    strategy: VECTOR_SVG_IMPORT_STRATEGY,
    sourceName: sourceName.trim() || "import.svg",
    sourceBytes: bytes.byteLength,
    sourceHash,
    sourceRevision,
    viewBox,
    bounds,
    width: Math.max(0, bounds.right - bounds.left),
    height: Math.max(0, bounds.bottom - bounds.top),
    paints: Object.freeze(paints),
    silhouettePath,
    silhouetteRevision,
    elementCount,
    contourCount: silhouettePath.contourOffsets.length,
    commandCount,
    logicalVectorBytes,
  });
}
