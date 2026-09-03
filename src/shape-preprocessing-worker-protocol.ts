import type {
  ShapePreprocessingBackend,
  ShapePreprocessingInput,
  ShapePreprocessingMaskFormat,
  ShapePngPreprocessingInput,
  ShapePreprocessingResult,
  ShapePreprocessingTimings,
} from "./shape-preprocessing-core";

export const SHAPE_PREPROCESSING_PROTOCOL_VERSION = 1 as const;

export interface ShapePreprocessingWorkerPrepareRequest {
  readonly type: "prepare";
  readonly requestId: number;
  readonly source: Uint16Array;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly invert: boolean;
  readonly maskFormat: ShapePreprocessingMaskFormat;
}

export interface ShapePreprocessingWorkerCancelRequest {
  readonly type: "cancel";
  readonly requestId: number;
}

export interface ShapePreprocessingWorkerPreparePngRequest {
  readonly type: "prepare-png";
  readonly requestId: number;
  readonly pngBytes: ArrayBuffer;
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  readonly invert: boolean;
  readonly maskFormat: ShapePreprocessingMaskFormat;
}

export type ShapePreprocessingWorkerRequest =
  | ShapePreprocessingWorkerPrepareRequest
  | ShapePreprocessingWorkerPreparePngRequest
  | ShapePreprocessingWorkerCancelRequest;

export interface ShapePreprocessingWorkerReadyResponse {
  readonly type: "ready";
  readonly protocolVersion: typeof SHAPE_PREPROCESSING_PROTOCOL_VERSION;
  readonly backend: ShapePreprocessingBackend;
  readonly acceleratorFailure: string | null;
}

export interface ShapePreprocessingWorkerPreparedResponse {
  readonly type: "prepared";
  readonly requestId: number;
  readonly scalar16: Uint16Array;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly identity: number;
  readonly sourceIdentity: number;
  readonly outline: ShapePreprocessingResult["outline"];
  readonly previewMask: Uint8Array;
  readonly previewSize: number;
  readonly occupancyWords: Uint32Array;
  readonly occupancyActiveCells: Uint32Array;
  readonly occupancyCoverageRatios: Float32Array;
  readonly backend: ShapePreprocessingBackend;
  readonly acceleratorFailure: string | null;
  readonly retainedWasmMemoryBytes: number;
  readonly timings: ShapePreprocessingTimings;
}

export interface ShapePreprocessingWorkerFailedResponse {
  readonly type: "failed";
  readonly requestId: number;
  readonly message: string;
}

export type ShapePreprocessingWorkerResponse =
  | ShapePreprocessingWorkerReadyResponse
  | ShapePreprocessingWorkerPreparedResponse
  | ShapePreprocessingWorkerFailedResponse;

export function workerRequestInput(
  request: ShapePreprocessingWorkerPrepareRequest,
): ShapePreprocessingInput {
  return {
    source: request.source,
    sourceWidth: request.sourceWidth,
    sourceHeight: request.sourceHeight,
    invert: request.invert,
    maskFormat: request.maskFormat,
  };
}

export function workerPngRequestInput(
  request: ShapePreprocessingWorkerPreparePngRequest,
): ShapePngPreprocessingInput {
  return {
    pngBytes: request.pngBytes,
    expectedWidth: request.expectedWidth,
    expectedHeight: request.expectedHeight,
    invert: request.invert,
    maskFormat: request.maskFormat,
  };
}
