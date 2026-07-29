import type { VectorTextGpuMeshData, VectorTextEffectDescription } from "./vector-text-effect-geometry";
import type { VectorTextLod } from "./vector-text-lod";

export interface VectorTextWorkerPathData {
  readonly fillRule: number;
  readonly verbs: Uint8Array;
  readonly coords: Float64Array;
  readonly contourOffsets: Uint32Array;
}

export interface RegisterVectorTextPathMessage {
  readonly type: "register-path";
  readonly revision: string;
  readonly path: VectorTextWorkerPathData;
}

export interface ReleaseVectorTextPathMessage {
  readonly type: "release-path";
  readonly revision: string;
}

export interface BuildVectorTextEffectMessage {
  readonly type: "build-effect";
  readonly requestId: number;
  readonly revision: string;
  readonly cacheKey: string;
  readonly lod: VectorTextLod;
  readonly effect: VectorTextEffectDescription;
}

export type VectorTextEffectWorkerRequest =
  | RegisterVectorTextPathMessage
  | ReleaseVectorTextPathMessage
  | BuildVectorTextEffectMessage;

export interface VectorTextEffectReadyMessage {
  readonly type: "effect-ready";
  readonly requestId: number;
  readonly cacheKey: string;
  readonly mesh: VectorTextGpuMeshData | null;
}

export interface VectorTextEffectFailedMessage {
  readonly type: "effect-failed";
  readonly requestId: number;
  readonly cacheKey: string;
  readonly message: string;
}

export type VectorTextEffectWorkerResponse =
  | VectorTextEffectReadyMessage
  | VectorTextEffectFailedMessage;
