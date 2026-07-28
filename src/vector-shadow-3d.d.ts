export interface Shadow3dPathData {
  verbs: Uint8Array;
  coords: Float64Array;
  contourOffsets: Uint32Array;
  fillRule: number;
}

export interface Shadow3dValue {
  version?: number;
  enabled?: boolean;
  mode?: "3d" | "single";
  color?: ArrayLike<number>;
  offset?: number;
  angle?: number;
  blur?: number;
  outlineWidth?: number;
  outlineJoin?: number;
}

export const SHADOW_3D_VERSION: number;
export const SHADOW_3D_NAME: string;
export const SHADOW_MODE_3D: "3d";
export const SHADOW_MODE_SINGLE: "single";

export function buildShadow3dPath(
  path: Shadow3dPathData,
  value: Shadow3dValue,
  options?: { tolerance?: number },
): Shadow3dPathData;

export function shadow3dVector(value: Shadow3dValue): { x: number; y: number };
export function shadow3dBounds(
  bounds: ArrayLike<number>,
  value: Shadow3dValue,
): Float64Array;
