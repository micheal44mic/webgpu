import type { Shadow3dPathData } from "./vector-shadow-3d.js";

export interface VectorTextPointD {
  readonly x: number;
  readonly y: number;
}

export interface VectorTextQuadCurve {
  readonly p0: VectorTextPointD;
  readonly p1: VectorTextPointD;
  readonly p2: VectorTextPointD;
}

export interface VectorTextQuadContour {
  readonly curves: readonly VectorTextQuadCurve[];
}

const COORDINATES_PER_VERB = [2, 2, 4, 6, 0] as const;
const MAXIMUM_SUBDIVISION_DEPTH = 24;

function point(x: number, y: number): VectorTextPointD {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("La geometria del testo contiene una coordinata non finita.");
  }
  return { x, y };
}

function midpoint(
  first: VectorTextPointD,
  second: VectorTextPointD,
): VectorTextPointD {
  return {
    x: (first.x + second.x) * 0.5,
    y: (first.y + second.y) * 0.5,
  };
}

function samePoint(
  first: VectorTextPointD,
  second: VectorTextPointD,
): boolean {
  const scale = Math.max(
    1,
    Math.abs(first.x),
    Math.abs(first.y),
    Math.abs(second.x),
    Math.abs(second.y),
  );
  return (
    Math.abs(first.x - second.x) <= Number.EPSILON * 64 * scale
    && Math.abs(first.y - second.y) <= Number.EPSILON * 64 * scale
  );
}

function lineAsQuadratic(
  start: VectorTextPointD,
  end: VectorTextPointD,
): VectorTextQuadCurve {
  return {
    p0: start,
    p1: midpoint(start, end),
    p2: end,
  };
}

export function cubicToQuadraticsBounded(
  p0: VectorTextPointD,
  p1: VectorTextPointD,
  p2: VectorTextPointD,
  p3: VectorTextPointD,
  maximumError: number,
  maximumDepth = MAXIMUM_SUBDIVISION_DEPTH,
): VectorTextQuadCurve[] {
  const safeError = Math.max(Number.EPSILON, maximumError);
  const output: VectorTextQuadCurve[] = [];

  const recurse = (
    a: VectorTextPointD,
    b: VectorTextPointD,
    c: VectorTextPointD,
    d: VectorTextPointD,
    depth: number,
  ): void => {
    const dx = d.x - 3 * c.x + 3 * b.x - a.x;
    const dy = d.y - 3 * c.y + 3 * b.y - a.y;
    const errorBound = Math.hypot(dx, dy) / 6;

    if (errorBound <= safeError) {
      output.push({
        p0: a,
        p1: {
          x: (3 * (b.x + c.x) - a.x - d.x) * 0.25,
          y: (3 * (b.y + c.y) - a.y - d.y) * 0.25,
        },
        p2: d,
      });
      return;
    }
    if (depth >= maximumDepth) {
      throw new Error(
        `Approssimazione cubica oltre profondità ${maximumDepth}; errore ${errorBound}.`,
      );
    }

    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const cd = midpoint(c, d);
    const abc = midpoint(ab, bc);
    const bcd = midpoint(bc, cd);
    const middle = midpoint(abc, bcd);

    recurse(a, ab, abc, middle, depth + 1);
    recurse(middle, bcd, cd, d, depth + 1);
  };

  recurse(p0, p1, p2, p3, 0);
  return output;
}

export function vectorPathToQuadraticContours(
  path: Shadow3dPathData,
  cubicTolerance: number,
): VectorTextQuadContour[] {
  const contours: VectorTextQuadContour[] = [];
  let coordinateOffset = 0;
  let curves: VectorTextQuadCurve[] | null = null;
  let current: VectorTextPointD | null = null;
  let start: VectorTextPointD | null = null;

  const finishContour = (): void => {
    if (curves && current && start && !samePoint(current, start)) {
      curves.push(lineAsQuadratic(current, start));
    }
    if (curves && curves.length > 0) {
      contours.push({ curves });
    }
    curves = null;
    current = null;
    start = null;
  };

  for (const rawVerb of path.verbs) {
    const verb = Number(rawVerb);
    if (
      !Number.isInteger(verb)
      || verb < 0
      || verb >= COORDINATES_PER_VERB.length
    ) {
      throw new Error(`Verbo OpenType non valido: ${rawVerb}.`);
    }
    if (coordinateOffset + COORDINATES_PER_VERB[verb] > path.coords.length) {
      throw new Error("Coordinate OpenType insufficienti per il verbo corrente.");
    }

    if (verb === 0) {
      finishContour();
      const moved = point(
        path.coords[coordinateOffset],
        path.coords[coordinateOffset + 1],
      );
      coordinateOffset += 2;
      curves = [];
      current = moved;
      start = moved;
      continue;
    }
    if (verb === 4) {
      finishContour();
      continue;
    }
    if (!curves || !current || !start) {
      throw new Error("Il path del testo non inizia con MOVE.");
    }

    if (verb === 1) {
      const end = point(
        path.coords[coordinateOffset],
        path.coords[coordinateOffset + 1],
      );
      coordinateOffset += 2;
      if (!samePoint(current, end)) {
        curves.push(lineAsQuadratic(current, end));
      }
      current = end;
      continue;
    }
    if (verb === 2) {
      const control = point(
        path.coords[coordinateOffset],
        path.coords[coordinateOffset + 1],
      );
      const end = point(
        path.coords[coordinateOffset + 2],
        path.coords[coordinateOffset + 3],
      );
      coordinateOffset += 4;
      if (
        !samePoint(current, control)
        || !samePoint(control, end)
      ) {
        curves.push({ p0: current, p1: control, p2: end });
      }
      current = end;
      continue;
    }

    const firstControl = point(
      path.coords[coordinateOffset],
      path.coords[coordinateOffset + 1],
    );
    const secondControl = point(
      path.coords[coordinateOffset + 2],
      path.coords[coordinateOffset + 3],
    );
    const end = point(
      path.coords[coordinateOffset + 4],
      path.coords[coordinateOffset + 5],
    );
    coordinateOffset += 6;
    if (
      samePoint(current, firstControl)
      && samePoint(firstControl, secondControl)
      && samePoint(secondControl, end)
    ) {
      current = end;
      continue;
    }
    curves.push(...cubicToQuadraticsBounded(
      current,
      firstControl,
      secondControl,
      end,
      cubicTolerance,
    ));
    current = end;
  }

  finishContour();
  if (coordinateOffset !== path.coords.length) {
    throw new Error("Numero di coordinate OpenType incoerente.");
  }
  return contours;
}

export function vectorTextQuadraticControlBounds(
  contours: readonly VectorTextQuadContour[],
): { left: number; top: number; right: number; bottom: number } {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const contour of contours) {
    for (const curve of contour.curves) {
      for (const value of [curve.p0, curve.p1, curve.p2]) {
        left = Math.min(left, value.x);
        top = Math.min(top, value.y);
        right = Math.max(right, value.x);
        bottom = Math.max(bottom, value.y);
      }
    }
  }
  if (!Number.isFinite(left)) {
    return { left: 0, top: 0, right: 0, bottom: 0 };
  }
  return { left, top, right, bottom };
}
