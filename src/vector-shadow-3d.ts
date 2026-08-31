export const SHADOW_3D_VERSION = 2;
export const SHADOW_MODE_3D = '3d';
export const SHADOW_MODE_SINGLE = 'single';

export interface Shadow3dPathData {
  /**
   * Path storage is copy-on-write after publication to scene/runtime caches.
   * Geometry edits create a new path object instead of mutating these arrays.
   */
  readonly verbs: Uint8Array;
  readonly coords: Float64Array;
  readonly contourOffsets: Uint32Array;
  readonly fillRule: number;
}

export interface Shadow3dValue {
  readonly version?: number;
  readonly enabled?: boolean;
  readonly mode?: typeof SHADOW_MODE_3D | typeof SHADOW_MODE_SINGLE;
  readonly color?: ArrayLike<number>;
  readonly offset?: number;
  readonly angle?: number;
  readonly blur?: number;
  readonly outlineWidth?: number;
  readonly outlineJoin?: number;
}

export interface NormalizedShadow3dValue {
  readonly version: typeof SHADOW_3D_VERSION;
  readonly enabled: boolean;
  readonly mode: typeof SHADOW_MODE_3D | typeof SHADOW_MODE_SINGLE;
  readonly color: readonly [number, number, number, number];
  readonly offset: number;
  readonly angle: number;
  readonly blur: number;
  readonly outlineWidth: number;
  readonly outlineJoin: 0 | 1;
}

interface ShadowPoint {
  readonly x: number;
  readonly y: number;
}

interface LineSegment {
  readonly kind: 'line';
  readonly p0: ShadowPoint;
  readonly p1: ShadowPoint;
}

interface QuadraticSegment {
  readonly kind: 'quadratic';
  readonly p0: ShadowPoint;
  readonly c: ShadowPoint;
  readonly p1: ShadowPoint;
}

interface CubicSegment {
  readonly kind: 'cubic';
  readonly p0: ShadowPoint;
  readonly c1: ShadowPoint;
  readonly c2: ShadowPoint;
  readonly p1: ShadowPoint;
}

type ShadowSegment = LineSegment | QuadraticSegment | CubicSegment;

interface ShadowContour {
  readonly start: ShadowPoint;
  readonly segments: ShadowSegment[];
}

interface PreparedContour {
  readonly contour: ShadowContour;
  readonly polygon: ShadowPoint[];
  readonly area: number;
}

const DEFAULT_COLOR = Object.freeze([0.04, 0.055, 0.07, 1] as const);
const COORDS_PER_VERB = Object.freeze([2, 2, 4, 6, 0]);
const EPSILON = 1e-10;

function finite(value: unknown, fallback: number, minimum = -Infinity, maximum = Infinity): number {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : fallback;
}

function normalizedAngle(value: unknown): number {
  const angle = finite(value, 45);
  const wrapped = ((angle + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function normalizedColor(value: unknown): readonly [number, number, number, number] {
  const source: ArrayLike<number> = value !== null
    && typeof value === 'object'
    && 'length' in value
    && typeof value.length === 'number'
    ? value as ArrayLike<number>
    : DEFAULT_COLOR;
  return Object.freeze([0, 1, 2, 3].map(index => (
    finite(source[index], DEFAULT_COLOR[index], 0, 1)
  ))) as unknown as readonly [number, number, number, number];
}

function normalizedOutlineJoin(value: unknown): 0 | 1 {
  return Number(value) === 1 ? 1 : 0;
}

function normalizedMode(
  value: unknown,
): typeof SHADOW_MODE_3D | typeof SHADOW_MODE_SINGLE {
  return value === SHADOW_MODE_SINGLE ? SHADOW_MODE_SINGLE : SHADOW_MODE_3D;
}

/**
 * Stato serializzabile dell'effetto. Il colore resta parte del paint e non
 * invalida la geometria; i controlli pubblici includono outlineWidth e outlineJoin.
 */
export function normalizeShadow3d(
  value: Readonly<Shadow3dValue> | null = null,
): Readonly<NormalizedShadow3dValue> {
  const source: Readonly<Shadow3dValue> = value ?? {};
  const version = source.version === undefined ? SHADOW_3D_VERSION : Number(source.version);
  if (version !== 1 && version !== SHADOW_3D_VERSION) {
    throw new RangeError(`unsupported 3D Shadow version: ${source.version}`);
  }
  return Object.freeze({
    version: SHADOW_3D_VERSION,
    enabled: Boolean(source.enabled),
    mode: normalizedMode(source.mode),
    color: normalizedColor(source.color),
    offset: finite(source.offset, 40, 0, 1_000_000),
    angle: normalizedAngle(source.angle),
    blur: finite(source.blur, version === 1 ? 0 : 16, 0, 300),
    outlineWidth: finite(source.outlineWidth, 0, 0, 1_000_000),
    outlineJoin: normalizedOutlineJoin(source.outlineJoin),
  });
}

export function serializeShadow3d(
  value: Readonly<Shadow3dValue> | null,
): Shadow3dValue {
  const shadow = normalizeShadow3d(value);
  return {
    version: shadow.version,
    enabled: shadow.enabled,
    mode: shadow.mode,
    color: [...shadow.color],
    offset: shadow.offset,
    angle: shadow.angle,
    blur: shadow.blur,
    outlineWidth: shadow.outlineWidth,
    outlineJoin: shadow.outlineJoin,
  };
}

export function updateShadow3d(
  value: Readonly<Shadow3dValue> | null,
  patch: Readonly<Partial<Shadow3dValue>> = {},
): Readonly<NormalizedShadow3dValue> {
  const current = serializeShadow3d(value);
  return normalizeShadow3d({ ...current, ...patch });
}

export function shadow3dGeometryKey(value: Readonly<Shadow3dValue> | null): string {
  const shadow = normalizeShadow3d(value);
  if (shadow.mode === SHADOW_MODE_SINGLE) return `shadow3d-v${shadow.version}:single`;
  return `shadow3d-v${shadow.version}:3d:${shadow.offset}:${shadow.angle}:${shadow.outlineWidth}:${shadow.outlineJoin}`;
}

export function shadow3dVector(
  value: Readonly<Shadow3dValue> | null,
): ShadowPoint {
  const shadow = normalizeShadow3d(value);
  const radians = shadow.angle * Math.PI / 180;
  return {
    x: Math.cos(radians) * shadow.offset,
    y: Math.sin(radians) * shadow.offset,
  };
}

export function shadow3dBounds(
  bounds: ArrayLike<number> | null,
  value: Readonly<Shadow3dValue> | null,
): Float64Array {
  const source: ArrayLike<number> = bounds && typeof bounds.length === 'number'
    ? bounds
    : [0, 0, 0, 0];
  const shadow = normalizeShadow3d(value);
  if (!shadow.enabled) return new Float64Array(source);
  const vector = shadow3dVector(shadow);
  const inflate = shadow.outlineWidth / 2;
  if (shadow.mode === SHADOW_MODE_SINGLE) {
    const inflate = shadow.blur > 0 ? shadow.blur * 3 + 1 : 0;
    return new Float64Array([
      Number(source[0]) + vector.x - inflate,
      Number(source[1]) + vector.y - inflate,
      Number(source[2]) + vector.x + inflate,
      Number(source[3]) + vector.y + inflate,
    ]);
  }
  return new Float64Array([
    Math.min(Number(source[0]), Number(source[0]) + vector.x) - inflate,
    Math.min(Number(source[1]), Number(source[1]) + vector.y) - inflate,
    Math.max(Number(source[2]), Number(source[2]) + vector.x) + inflate,
    Math.max(Number(source[3]), Number(source[3]) + vector.y) + inflate,
  ]);
}

function point(x: unknown, y: unknown): ShadowPoint {
  return { x:Number(x), y:Number(y) };
}

function samePoint(left: ShadowPoint, right: ShadowPoint): boolean {
  const scale = Math.max(1, Math.abs(left.x), Math.abs(left.y), Math.abs(right.x), Math.abs(right.y));
  return Math.hypot(left.x - right.x, left.y - right.y) <= scale * 1e-12;
}

function line(p0: ShadowPoint, p1: ShadowPoint): LineSegment {
  return { kind:'line', p0, p1 };
}

function readContours(path: Readonly<Shadow3dPathData>): ShadowContour[] {
  if (!path.verbs || !path.coords) throw new TypeError('PathData is required for 3D Shadow');
  const verbs = path.verbs;
  const coords = path.coords;
  const contours: ShadowContour[] = [];
  let coordOffset = 0;
  let contour: ShadowContour | null = null;
  let current: ShadowPoint | null = null;

  const finish = (): void => {
    const activeContour = contour;
    const activeCurrent = current;
    if (!activeContour) return;
    if (activeCurrent && activeContour.segments.length
      && !samePoint(activeCurrent, activeContour.start)) {
      activeContour.segments.push(line(activeCurrent, activeContour.start));
    }
    if (activeContour.segments.length >= 2) contours.push(activeContour);
    contour = null;
    current = null;
  };

  for (const rawVerb of verbs) {
    const verb = Number(rawVerb);
    if (!Number.isInteger(verb) || verb < 0 || verb >= COORDS_PER_VERB.length) {
      throw new TypeError(`invalid 3D Shadow PathData verb: ${rawVerb}`);
    }
    if (verb === 0) {
      finish();
      const start = point(coords[coordOffset++], coords[coordOffset++]);
      contour = { start, segments:[] };
      current = start;
      continue;
    }
    if (!contour || !current) throw new TypeError('3D Shadow PathData must begin with MOVE');
    if (verb === 1) {
      const end = point(coords[coordOffset++], coords[coordOffset++]);
      contour.segments.push(line(current, end));
      current = end;
    } else if (verb === 2) {
      const control = point(coords[coordOffset++], coords[coordOffset++]);
      const end = point(coords[coordOffset++], coords[coordOffset++]);
      contour.segments.push({ kind:'quadratic', p0:current, c:control, p1:end });
      current = end;
    } else if (verb === 3) {
      const c1 = point(coords[coordOffset++], coords[coordOffset++]);
      const c2 = point(coords[coordOffset++], coords[coordOffset++]);
      const end = point(coords[coordOffset++], coords[coordOffset++]);
      contour.segments.push({ kind:'cubic', p0:current, c1, c2, p1:end });
      current = end;
    } else if (verb === 4) {
      finish();
    }
  }
  finish();
  if (coordOffset !== coords.length) throw new TypeError('Inconsistent 3D Shadow PathData coordinates');
  return contours;
}

function lerpPoint(a: ShadowPoint, b: ShadowPoint, t: number): ShadowPoint {
  return point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
}

function splitSegment(
  segment: ShadowSegment,
  t: number,
): readonly [ShadowSegment, ShadowSegment] {
  if (segment.kind === 'line') {
    const middle = lerpPoint(segment.p0, segment.p1, t);
    return [line(segment.p0, middle), line(middle, segment.p1)];
  }
  if (segment.kind === 'quadratic') {
    const a = lerpPoint(segment.p0, segment.c, t);
    const b = lerpPoint(segment.c, segment.p1, t);
    const middle = lerpPoint(a, b, t);
    return [
      { kind:'quadratic', p0:segment.p0, c:a, p1:middle },
      { kind:'quadratic', p0:middle, c:b, p1:segment.p1 },
    ];
  }
  const a = lerpPoint(segment.p0, segment.c1, t);
  const b = lerpPoint(segment.c1, segment.c2, t);
  const c = lerpPoint(segment.c2, segment.p1, t);
  const d = lerpPoint(a, b, t);
  const e = lerpPoint(b, c, t);
  const middle = lerpPoint(d, e, t);
  return [
    { kind:'cubic', p0:segment.p0, c1:a, c2:d, p1:middle },
    { kind:'cubic', p0:middle, c1:e, c2:c, p1:segment.p1 },
  ];
}

function reverseSegment(segment: ShadowSegment): ShadowSegment {
  if (segment.kind === 'line') return line(segment.p1, segment.p0);
  if (segment.kind === 'quadratic') {
    return { kind:'quadratic', p0:segment.p1, c:segment.c, p1:segment.p0 };
  }
  return { kind:'cubic', p0:segment.p1, c1:segment.c2, c2:segment.c1, p1:segment.p0 };
}

function reverseSegments(segments: readonly ShadowSegment[]): ShadowSegment[] {
  return [...segments].reverse().map(reverseSegment);
}

function distanceToLine(
  value: ShadowPoint,
  start: ShadowPoint,
  end: ShadowPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return Math.hypot(value.x - start.x, value.y - start.y);
  return Math.abs(dx * (start.y - value.y) - (start.x - value.x) * dy) / length;
}

function flattenSegment(
  segment: ShadowSegment,
  tolerance: number,
  output: ShadowPoint[],
  depth = 0,
): void {
  if (segment.kind === 'line') {
    output.push(segment.p1);
    return;
  }
  const flat = segment.kind === 'quadratic'
    ? distanceToLine(segment.c, segment.p0, segment.p1)
    : Math.max(
      distanceToLine(segment.c1, segment.p0, segment.p1),
      distanceToLine(segment.c2, segment.p0, segment.p1),
    );
  if (flat <= tolerance || depth >= 14) {
    output.push(segment.p1);
    return;
  }
  const [left, right] = splitSegment(segment, 0.5);
  flattenSegment(left, tolerance, output, depth + 1);
  flattenSegment(right, tolerance, output, depth + 1);
}

function flattenedContour(
  segments: readonly ShadowSegment[],
  tolerance: number,
): ShadowPoint[] {
  const values = [segments[0].p0];
  for (const segment of segments) flattenSegment(segment, tolerance, values);
  if (values.length > 1 && samePoint(values[0], values[values.length - 1])) values.pop();
  return values;
}

function signedArea(points: readonly ShadowPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function windingAt(points: readonly ShadowPoint[], value: ShadowPoint): number {
  let winding = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const side = (b.x - a.x) * (value.y - a.y) - (value.x - a.x) * (b.y - a.y);
    if (a.y <= value.y) {
      if (b.y > value.y && side > 0) winding++;
    } else if (b.y <= value.y && side < 0) winding--;
  }
  return winding;
}

function pointInFill(
  polygons: readonly (readonly ShadowPoint[])[],
  value: ShadowPoint,
  fillRule: 0 | 1,
): boolean {
  if (fillRule === 1) {
    let crossings = 0;
    for (const polygon of polygons) if (windingAt(polygon, value) !== 0) crossings++;
    return crossings % 2 === 1;
  }
  let winding = 0;
  for (const polygon of polygons) winding += windingAt(polygon, value);
  return winding !== 0;
}

function boundaryType(
  index: number,
  prepared: readonly PreparedContour[],
  fillRule: 0 | 1,
  tolerance: number,
): 'outer' | 'hole' | null {
  const entry = prepared[index];
  const polygon = entry.polygon;
  const area = entry.area;
  if (polygon.length < 3 || Math.abs(area) <= EPSILON) return null;
  let best: { a: ShadowPoint; b: ShadowPoint; length: number } | null = null;
  for (let edge = 0; edge < polygon.length; edge++) {
    const a = polygon[edge];
    const b = polygon[(edge + 1) % polygon.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!best || length > best.length) best = { a, b, length };
  }
  if (!best || best.length <= EPSILON) return null;
  const dx = best.b.x - best.a.x;
  const dy = best.b.y - best.a.y;
  const orientation = Math.sign(area) || 1;
  const nx = orientation * -dy / best.length;
  const ny = orientation * dx / best.length;
  const xs = polygon.map(value => value.x);
  const ys = polygon.map(value => value.y);
  const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const epsilon = Math.min(best.length * 0.2, Math.max(1e-5, tolerance * 2, diagonal * 1e-5));
  const middle = point((best.a.x + best.b.x) / 2, (best.a.y + best.b.y) / 2);
  const inside = point(middle.x + nx * epsilon, middle.y + ny * epsilon);
  const outside = point(middle.x - nx * epsilon, middle.y - ny * epsilon);
  const polygons = prepared.map(value => value.polygon);
  const insideFilled = pointInFill(polygons, inside, fillRule);
  const outsideFilled = pointInFill(polygons, outside, fillRule);
  if (insideFilled === outsideFilled) return null;
  return insideFilled ? 'outer' : 'hole';
}

function canonicalContours(
  path: Readonly<Shadow3dPathData>,
  tolerance: number,
): ShadowSegment[][] {
  const contours = readContours(path);
  const prepared: PreparedContour[] = contours.map(contour => {
    const polygon = flattenedContour(contour.segments, tolerance);
    return { contour, polygon, area:signedArea(polygon) };
  });
  const values: ShadowSegment[][] = [];
  for (let index = 0; index < prepared.length; index++) {
    const type = boundaryType(index, prepared, Number(path.fillRule) === 1 ? 1 : 0, tolerance);
    if (!type) continue;
    const entry = prepared[index];
    const wantedSign = type === 'outer' ? 1 : -1;
    values.push(Math.sign(entry.area) === wantedSign
      ? entry.contour.segments
      : reverseSegments(entry.contour.segments));
  }
  return values;
}

function derivative(segment: ShadowSegment, t: number): ShadowPoint {
  if (segment.kind === 'line') {
    return point(segment.p1.x - segment.p0.x, segment.p1.y - segment.p0.y);
  }
  if (segment.kind === 'quadratic') {
    return point(
      2 * ((1 - t) * (segment.c.x - segment.p0.x) + t * (segment.p1.x - segment.c.x)),
      2 * ((1 - t) * (segment.c.y - segment.p0.y) + t * (segment.p1.y - segment.c.y)),
    );
  }
  const mt = 1 - t;
  return point(
    3 * (mt * mt * (segment.c1.x - segment.p0.x)
      + 2 * mt * t * (segment.c2.x - segment.c1.x)
      + t * t * (segment.p1.x - segment.c2.x)),
    3 * (mt * mt * (segment.c1.y - segment.p0.y)
      + 2 * mt * t * (segment.c2.y - segment.c1.y)
      + t * t * (segment.p1.y - segment.c2.y)),
  );
}

function cross(left: ShadowPoint, right: ShadowPoint): number {
  return left.x * right.y - left.y * right.x;
}

function quadraticRoots(a: number, b: number, c: number): number[] {
  if (Math.abs(a) <= EPSILON) {
    if (Math.abs(b) <= EPSILON) return [];
    return [-c / b];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -EPSILON) return [];
  if (Math.abs(discriminant) <= EPSILON) return [-b / (2 * a)];
  const root = Math.sqrt(Math.max(0, discriminant));
  return [(-b - root) / (2 * a), (-b + root) / (2 * a)];
}

function directionRoots(segment: ShadowSegment, vector: ShadowPoint): number[] {
  if (segment.kind === 'line') return [];
  const projected = (value: ShadowPoint): number => cross(vector, value);
  if (segment.kind === 'quadratic') {
    const a = projected(point(segment.c.x - segment.p0.x, segment.c.y - segment.p0.y));
    const b = projected(point(segment.p1.x - segment.c.x, segment.p1.y - segment.c.y));
    if (Math.abs(b - a) <= EPSILON) return [];
    return [-a / (b - a)];
  }
  const a = projected(point(segment.c1.x - segment.p0.x, segment.c1.y - segment.p0.y));
  const b = projected(point(segment.c2.x - segment.c1.x, segment.c2.y - segment.c1.y));
  const c = projected(point(segment.p1.x - segment.c2.x, segment.p1.y - segment.c2.y));
  return quadraticRoots(a - 2 * b + c, -2 * a + 2 * b, a);
}

function splitAtRoots(segment: ShadowSegment, roots: readonly number[]): ShadowSegment[] {
  const sorted = [...new Set(roots
    .filter(value => Number.isFinite(value) && value > 1e-6 && value < 1 - 1e-6)
    .map(value => Math.round(value * 1e12) / 1e12))].sort((a, b) => a - b);
  if (!sorted.length) return [segment];
  const pieces: ShadowSegment[] = [];
  let current: ShadowSegment = segment;
  let previous = 0;
  for (const root of sorted) {
    const local = (root - previous) / (1 - previous);
    const [left, right] = splitSegment(current, local);
    pieces.push(left);
    current = right;
    previous = root;
  }
  pieces.push(current);
  return pieces;
}

class PathWriter {
  private readonly verbs: number[] = [];
  private readonly coords: number[] = [];
  private readonly contourOffsets: number[] = [];

  move(value: ShadowPoint): void {
    this.contourOffsets.push(this.verbs.length);
    this.verbs.push(0);
    this.coords.push(value.x, value.y);
  }

  line(value: ShadowPoint): void {
    this.verbs.push(1);
    this.coords.push(value.x, value.y);
  }

  segment(segment: ShadowSegment, delta: ShadowPoint | null = null): void {
    const dx = delta?.x ?? 0;
    const dy = delta?.y ?? 0;
    if (segment.kind === 'line') {
      this.line(point(segment.p1.x + dx, segment.p1.y + dy));
    } else if (segment.kind === 'quadratic') {
      this.verbs.push(2);
      this.coords.push(segment.c.x + dx, segment.c.y + dy, segment.p1.x + dx, segment.p1.y + dy);
    } else {
      this.verbs.push(3);
      this.coords.push(
        segment.c1.x + dx, segment.c1.y + dy,
        segment.c2.x + dx, segment.c2.y + dy,
        segment.p1.x + dx, segment.p1.y + dy,
      );
    }
  }

  close(): void {
    this.verbs.push(4);
  }

  result(): Shadow3dPathData {
    return {
      verbs:new Uint8Array(this.verbs),
      coords:new Float64Array(this.coords),
      contourOffsets:new Uint32Array(this.contourOffsets),
      fillRule:0,
    };
  }
}

function appendContour(writer: PathWriter, segments: readonly ShadowSegment[]): void {
  if (!segments.length) return;
  writer.move(segments[0].p0);
  for (const segment of segments) writer.segment(segment);
  writer.close();
}

function appendSide(
  writer: PathWriter,
  segment: ShadowSegment,
  vector: ShadowPoint,
): void {
  writer.move(segment.p0);
  writer.line(point(segment.p0.x + vector.x, segment.p0.y + vector.y));
  writer.segment(segment, vector);
  writer.line(segment.p1);
  writer.segment(reverseSegment(segment));
  writer.close();
}

/**
 * Crea una sola silhouette vettoriale estrusa. I contorni vengono canonizzati
 * (esterni/buchi), invertiti come nel renderer di riferimento e le curve sono
 * spezzate solo nei punti in cui cambia il lato esposto alla direzione d'ombra.
 */
export function buildShadow3dPath(
  path: Readonly<Shadow3dPathData>,
  value: Readonly<Shadow3dValue>,
  { tolerance = 0.3 }: { readonly tolerance?: number } = {},
): Shadow3dPathData {
  const shadow = normalizeShadow3d(value);
  if (!shadow.enabled || shadow.mode === SHADOW_MODE_SINGLE) return path;
  const safeTolerance = finite(tolerance, 0.3, 0.01, 1000);
  const vector = shadow3dVector(shadow);
  const contours = canonicalContours(path, safeTolerance);
  const writer = new PathWriter();

  for (const normalized of contours) {
    const reversed = reverseSegments(normalized);
    appendContour(writer, reversed);
    if (shadow.offset <= EPSILON) continue;
    for (const segment of reversed) {
      for (const piece of splitAtRoots(segment, directionRoots(segment, vector))) {
        const tangent = derivative(piece, 0.5);
        const facing = cross(vector, tangent);
        const threshold = EPSILON * Math.max(1, shadow.offset, Math.hypot(tangent.x, tangent.y));
        if (facing < -threshold) appendSide(writer, piece, vector);
      }
    }
  }
  return writer.result();
}
