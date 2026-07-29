import type { Shadow3dPathData } from "./vector-shadow-3d.js";
import {
  mergeVectorTextPaths,
  shiftVectorTextPath,
  vectorTextPathBounds,
  type VectorTextBounds,
} from "./vector-text-transform.ts";

export const VECTOR_SVG_IMPORT_STRATEGY =
  "sanitized-semantic-svg-solid-paints-worker-lod-mesh-webgpu-v1" as const;
export const VECTOR_SVG_MAXIMUM_SOURCE_BYTES = 5 * 1024 * 1024;
export const VECTOR_SVG_MAXIMUM_COMMANDS = 500_000;

export interface VectorSvgPaint {
  readonly id: number;
  readonly color: string;
  readonly opacity: number;
  readonly fillRule: 0 | 1;
  readonly path: Shadow3dPathData;
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
type Matrix = readonly [number, number, number, number, number, number];
interface StyleState {
  fill: string;
  color: string;
  fillOpacity: number;
  fillRule: 0 | 1;
  stroke: string;
  strokeOpacity: number;
  display: string;
  visibility: string;
}
interface CssRule { readonly selector: string; readonly declarations: ReadonlyMap<string, string>; }
interface RawPaint {
  readonly color: string;
  readonly opacity: number;
  readonly fillRule: 0 | 1;
  readonly path: Shadow3dPathData;
}

const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];
const KAPPA = 0.5522847498307936;
const SAFE_ELEMENTS = new Set([
  "svg", "g", "defs", "style", "title", "desc", "metadata",
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
]);
const CONTAINER_ELEMENTS = new Set(["svg", "g"]);
const GEOMETRY_ELEMENTS = new Set([
  "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
]);
const STYLE_PROPERTIES = new Set([
  "fill", "color", "fill-opacity", "fill-rule", "opacity", "stroke",
  "stroke-opacity", "display", "visibility",
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
function transformPoint(matrix: Matrix, x: number, y: number): Point {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] };
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
    const x = finite(element.getAttribute("x")); const y = finite(element.getAttribute("y"));
    const width = finite(element.getAttribute("width")); const height = finite(element.getAttribute("height"));
    if (!(width > 0 && height > 0)) return builder.finish(fillRule);
    let radiusX = Math.max(0, finite(element.getAttribute("rx"), 0));
    let radiusY = Math.max(0, finite(element.getAttribute("ry"), radiusX));
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
    const centerX = finite(element.getAttribute("cx")); const centerY = finite(element.getAttribute("cy"));
    const radiusX = Math.max(0, finite(element.getAttribute(name === "circle" ? "r" : "rx")));
    const radiusY = Math.max(0, finite(element.getAttribute(name === "circle" ? "r" : "ry")));
    if (radiusX > 0 && radiusY > 0) {
      builder.move(centerX + radiusX, centerY);
      builder.cubic(centerX + radiusX, centerY + radiusY * KAPPA, centerX + radiusX * KAPPA, centerY + radiusY, centerX, centerY + radiusY);
      builder.cubic(centerX - radiusX * KAPPA, centerY + radiusY, centerX - radiusX, centerY + radiusY * KAPPA, centerX - radiusX, centerY);
      builder.cubic(centerX - radiusX, centerY - radiusY * KAPPA, centerX - radiusX * KAPPA, centerY - radiusY, centerX, centerY - radiusY);
      builder.cubic(centerX + radiusX * KAPPA, centerY - radiusY, centerX + radiusX, centerY - radiusY * KAPPA, centerX + radiusX, centerY); builder.close();
    }
  } else if (name === "line") {
    builder.move(finite(element.getAttribute("x1")), finite(element.getAttribute("y1")));
    builder.line(finite(element.getAttribute("x2")), finite(element.getAttribute("y2")));
  } else if (name === "polyline" || name === "polygon") {
    const points = parsePoints(element.getAttribute("points") ?? ""); builder.move(points[0].x, points[0].y);
    for (const point of points.slice(1)) builder.line(point.x, point.y);
    if (name === "polygon") builder.close();
  }
  return builder.finish(fillRule);
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
    if (/@import|url\s*\(/i.test(source)) throw new Error("Lo stile SVG non può caricare risorse esterne.");
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
function selectorMatches(element: Element, selector: string): boolean {
  if (selector.startsWith(".")) return element.classList.contains(selector.slice(1));
  if (selector.startsWith("#")) return element.id === selector.slice(1);
  return element.localName.toLowerCase() === selector.toLowerCase();
}
function applyDeclarations(style: StyleState, declarations: ReadonlyMap<string, string>): number {
  let opacity = 1;
  for (const [property, value] of declarations) {
    if (property === "fill") style.fill = value; else if (property === "color") style.color = value;
    else if (property === "fill-opacity") style.fillOpacity = clampUnit(finite(value, 1));
    else if (property === "fill-rule") style.fillRule = value.toLowerCase() === "evenodd" ? 1 : 0;
    else if (property === "stroke") style.stroke = value; else if (property === "stroke-opacity") style.strokeOpacity = clampUnit(finite(value, 1));
    else if (property === "display") style.display = value.toLowerCase(); else if (property === "visibility") style.visibility = value.toLowerCase();
    else if (property === "opacity") opacity = clampUnit(finite(value, 1));
  }
  return opacity;
}
function resolvedStyle(element: Element, inherited: StyleState, rules: readonly CssRule[]): { style: StyleState; opacity: number } {
  const style: StyleState = { ...inherited }; const presentation = new Map<string, string>();
  for (const property of STYLE_PROPERTIES) { const value = element.getAttribute(property); if (value !== null) presentation.set(property, value); }
  let opacity = applyDeclarations(style, presentation);
  for (const rule of rules) if (selectorMatches(element, rule.selector)) opacity *= applyDeclarations(style, rule.declarations);
  opacity *= applyDeclarations(style, parseDeclarations(element.getAttribute("style") ?? ""));
  return { style, opacity: clampUnit(opacity) };
}
let colorContext: CanvasRenderingContext2D | null = null;
function parseColor(source: string, currentColor: string): { color: string; alpha: number } | null {
  const normalized = source.trim().toLowerCase();
  if (normalized === "none") return null;
  if (normalized === "currentcolor") return parseColor(currentColor, "#000000");
  if (normalized === "transparent") return { color: "#000000", alpha: 0 };
  if (/url\s*\(/i.test(normalized)) throw new Error("Gradienti e pattern SVG non sono ancora supportati: usa riempimenti solidi.");
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
    paints: documentValue.paints.map((paint) => ({ ...paint, path: clonePath(paint.path) })),
    silhouettePath: clonePath(documentValue.silhouettePath),
  };
}
function validateSecurity(root: Element, source: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("DOCTYPE ed entità XML non sono consentiti negli SVG importati.");
  for (const element of root.querySelectorAll("*")) {
    const name = element.localName.toLowerCase();
    if (!SAFE_ELEMENTS.has(name)) throw new Error(`Elemento SVG non supportato o non sicuro: <${name}>.`);
    for (const attribute of [...element.attributes]) {
      const attributeName = attribute.name.toLowerCase(); const value = attribute.value.trim();
      if (attributeName.startsWith("on")) throw new Error(`Handler evento SVG non consentito: ${attribute.name}.`);
      if (attributeName === "href" || attributeName.endsWith(":href")) throw new Error("Riferimenti href non consentiti negli SVG importati.");
      if (["filter", "mask", "clip-path"].includes(attributeName) && value.toLowerCase() !== "none") throw new Error(`${attribute.name} SVG non è ancora supportato.`);
      if (/url\s*\(/i.test(value) && attributeName !== "style") throw new Error("Riferimenti URL non consentiti negli SVG importati.");
    }
  }
}
function parseViewBox(root: Element): readonly [number, number, number, number] | null {
  const source = root.getAttribute("viewBox"); if (!source) return null;
  const values = parseNumberList(source);
  if (values.length !== 4 || !(values[2] > 0 && values[3] > 0)) throw new Error("viewBox SVG non valida.");
  return values as unknown as readonly [number, number, number, number];
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
  const rules = parseCssRules(root); const rawPaints: RawPaint[] = [];
  let elementCount = 0; let commandCount = 0;
  const defaults: StyleState = { fill: "#000000", color: "#000000", fillOpacity: 1, fillRule: 0, stroke: "none", strokeOpacity: 1, display: "inline", visibility: "visible" };
  const walk = (element: Element, parentMatrix: Matrix, inheritedStyle: StyleState, inheritedOpacity: number): void => {
    const name = element.localName.toLowerCase();
    if (name === "defs" || name === "style" || name === "title" || name === "desc" || name === "metadata") return;
    const localMatrix = multiply(parentMatrix, parseTransform(element.getAttribute("transform")));
    const resolved = resolvedStyle(element, inheritedStyle, rules); const opacity = inheritedOpacity * resolved.opacity;
    if (resolved.style.display === "none" || resolved.style.visibility === "hidden" || opacity <= 0) return;
    if (CONTAINER_ELEMENTS.has(name)) { for (const child of [...element.children]) walk(child, localMatrix, resolved.style, opacity); return; }
    if (!GEOMETRY_ELEMENTS.has(name)) return;
    elementCount += 1;
    const stroke = parseColor(resolved.style.stroke, resolved.style.color);
    if (stroke && stroke.alpha * resolved.style.strokeOpacity * opacity > 0) {
      throw new Error("SVG con tracce originali non ancora supportato: converti le tracce in riempimenti; poi puoi applicare la Traccia dell’app.");
    }
    const fill = parseColor(resolved.style.fill, resolved.style.color);
    if (!fill || fill.alpha * resolved.style.fillOpacity * opacity <= 0) return;
    const path = shapePath(element, localMatrix, resolved.style.fillRule); if (path.verbs.length === 0) return;
    commandCount += path.verbs.length;
    if (commandCount > VECTOR_SVG_MAXIMUM_COMMANDS) throw new Error(`SVG oltre ${VECTOR_SVG_MAXIMUM_COMMANDS} comandi vettoriali.`);
    rawPaints.push({ color: fill.color, opacity: clampUnit(fill.alpha * resolved.style.fillOpacity * opacity), fillRule: resolved.style.fillRule, path });
  };
  const rootResolved = resolvedStyle(root, defaults, rules); const rootMatrix = parseTransform(root.getAttribute("transform"));
  for (const child of [...root.children]) walk(child, rootMatrix, rootResolved.style, rootResolved.opacity);
  if (rawPaints.length === 0) throw new Error("L’SVG non contiene riempimenti vettoriali visibili.");
  const fillRules = new Set(rawPaints.map((paint) => paint.fillRule));
  if (fillRules.size > 1) throw new Error("SVG con fill-rule misti non ancora supportato nello stesso oggetto.");
  const rawSilhouette = mergeVectorTextPaths(rawPaints.map((paint) => paint.path)); rawSilhouette.fillRule = rawPaints[0].fillRule;
  const rawBounds = vectorTextPathBounds(rawSilhouette); const centerX = (rawBounds.left + rawBounds.right) * 0.5; const centerY = (rawBounds.top + rawBounds.bottom) * 0.5;
  const centeredRawPaints = rawPaints.map((paint) => ({ ...paint, path: shiftVectorTextPath(paint.path, -centerX, -centerY) }));
  const grouped: RawPaint[] = [];
  for (const paint of centeredRawPaints) {
    const previous = grouped[grouped.length - 1];
    if (previous && previous.color === paint.color && previous.opacity === paint.opacity && previous.fillRule === paint.fillRule) {
      grouped[grouped.length - 1] = { ...previous, path: mergeVectorTextPaths([previous.path, paint.path]) };
    } else grouped.push(paint);
  }
  const sourceHash = stableHash(bytes); const sourceRevision = `svg:${sourceHash}`;
  const paints: VectorSvgPaint[] = grouped.map((paint, index) => ({ id: index, color: paint.color, opacity: paint.opacity, fillRule: paint.fillRule, path: paint.path, revision: `${sourceRevision}:paint:${index}` }));
  const silhouettePath = shiftVectorTextPath(rawSilhouette, -centerX, -centerY); const bounds = vectorTextPathBounds(silhouettePath);
  const silhouetteRevision = `${sourceRevision}:silhouette`;
  const logicalVectorBytes = paints.reduce((total, paint) => total + pathLogicalBytes(paint.path), 0) + pathLogicalBytes(silhouettePath);
  return Object.freeze({
    strategy: VECTOR_SVG_IMPORT_STRATEGY,
    sourceName: sourceName.trim() || "import.svg",
    sourceBytes: bytes.byteLength,
    sourceHash,
    sourceRevision,
    viewBox: parseViewBox(root),
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
