export const VECTOR_TEXT_MAXIMUM_VECTOR_ZOOM = 64;
export const VECTOR_TEXT_GEOMETRY_COMPILER_VERSION =
  "clipper64-nonzero-lod-worker-v4" as const;

export interface VectorTextLod {
  readonly bucket: number;
  readonly bucketScale: number;
  readonly cubicToQuadraticTolerance: number;
  readonly polygonFlattenTolerance: number;
  readonly roundArcSagittaTolerance: number;
  readonly integerScale: number;
}

function nextPowerOfTwo(value: number): number {
  const safe = Math.max(1, Math.ceil(value));
  return 2 ** Math.ceil(Math.log2(safe));
}

export function vectorTextLodForSigma(sigma: number): VectorTextLod {
  const safeSigma = Math.max(
    1 / 32,
    Math.min(
      VECTOR_TEXT_MAXIMUM_VECTOR_ZOOM,
      Number.isFinite(sigma) ? Math.abs(sigma) : 1,
    ),
  );
  const bucket = Math.ceil(Math.log2(safeSigma));
  const bucketScale = 2 ** bucket;
  return {
    bucket,
    bucketScale,
    cubicToQuadraticTolerance: Math.min(0.025, 1 / (64 * bucketScale)),
    polygonFlattenTolerance: Math.min(0.05, 1 / (32 * bucketScale)),
    roundArcSagittaTolerance: Math.min(0.05, 1 / (32 * bucketScale)),
    integerScale: Math.max(
      8192,
      nextPowerOfTwo(Math.ceil(46 * bucketScale)),
    ),
  };
}

export function vectorTextMaximumLod(): VectorTextLod {
  return vectorTextLodForSigma(VECTOR_TEXT_MAXIMUM_VECTOR_ZOOM);
}

export function vectorTextFloat64Key(value: number): string {
  const storage = new ArrayBuffer(8);
  const floats = new Float64Array(storage);
  const words = new Uint32Array(storage);
  floats[0] = Number.isFinite(value) ? value : 0;
  return `${words[1].toString(16).padStart(8, "0")}`
    + `${words[0].toString(16).padStart(8, "0")}`;
}
