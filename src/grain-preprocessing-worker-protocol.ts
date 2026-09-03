import type {
  GrainPreprocessingBackend,
  GrainPreprocessingResult,
} from "./grain-preprocessing-core";

export const GRAIN_PREPROCESSING_PROTOCOL_VERSION = 1 as const;

export interface GrainPreprocessingWorkerPrepareScalarRequest {
  readonly type: "prepare-scalar";
  readonly requestId: number;
  readonly scalar16: Uint16Array;
  readonly width: number;
  readonly height: number;
  readonly invertLuminance: boolean;
  readonly sourceBitDepth: 8 | 16;
}

export interface GrainPreprocessingWorkerPreparePngRequest {
  readonly type: "prepare-png";
  readonly requestId: number;
  readonly pngBytes: ArrayBuffer;
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  readonly invertLuminance: boolean;
}

export interface GrainPreprocessingWorkerCancelRequest {
  readonly type: "cancel";
  readonly requestId: number;
}

export type GrainPreprocessingWorkerRequest =
  | GrainPreprocessingWorkerPrepareScalarRequest
  | GrainPreprocessingWorkerPreparePngRequest
  | GrainPreprocessingWorkerCancelRequest;

export interface GrainPreprocessingWorkerReadyResponse {
  readonly type: "ready";
  readonly protocolVersion: typeof GRAIN_PREPROCESSING_PROTOCOL_VERSION;
  readonly backend: GrainPreprocessingBackend;
  readonly acceleratorFailure: string | null;
}

export interface GrainPreprocessingWorkerPreparedResponse extends GrainPreprocessingResult {
  readonly type: "prepared";
  readonly requestId: number;
}

export interface GrainPreprocessingWorkerFailedResponse {
  readonly type: "failed";
  readonly requestId: number;
  readonly message: string;
}

export type GrainPreprocessingWorkerResponse =
  | GrainPreprocessingWorkerReadyResponse
  | GrainPreprocessingWorkerPreparedResponse
  | GrainPreprocessingWorkerFailedResponse;
