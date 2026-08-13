import type { BrushSettings } from "./engine-types";
import type { RasterStrokeOperation } from "./raster-stroke-operation";

export const SOURCE_OVER_BLEND_STATE: GPUBlendState = {
  color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};

export const ADDITIVE_BLEND_STATE: GPUBlendState = {
  color: { operation: "add", srcFactor: "one", dstFactor: "one" },
  alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};

/** Premultiplied destination-out: retain only the destination outside coverage. */
export const DESTINATION_OUT_BLEND_STATE: GPUBlendState = {
  color: { operation: "add", srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
  alpha: { operation: "add", srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
};

export interface RasterStrokePipelinePort {
  readonly normalPipeline: GPURenderPipeline;
  readonly additivePipeline: GPURenderPipeline;
  readonly shapeNormalPipeline: GPURenderPipeline;
  readonly shapeAdditivePipeline: GPURenderPipeline;
  readonly shapeOccupancyNormalPipeline: GPURenderPipeline;
  readonly shapeOccupancyAdditivePipeline: GPURenderPipeline;
  readonly grainNormalPipeline: GPURenderPipeline;
  readonly grainAdditivePipeline: GPURenderPipeline;
  readonly grainShapeNormalPipeline: GPURenderPipeline;
  readonly grainShapeAdditivePipeline: GPURenderPipeline;
  readonly grainShapeOccupancyNormalPipeline: GPURenderPipeline;
  readonly grainShapeOccupancyAdditivePipeline: GPURenderPipeline;
  readonly eraserPipelineByPaintBase: ReadonlyMap<GPURenderPipeline, GPURenderPipeline>;
}

export interface RasterStrokePipelineRequest {
  readonly operation: RasterStrokeOperation;
  readonly grainActive: boolean;
  readonly shapeOccupancyActive: boolean;
}

function paintBasePipeline(
  pipelines: RasterStrokePipelinePort,
  settings: Readonly<BrushSettings>,
  request: RasterStrokePipelineRequest,
): GPURenderPipeline {
  // Erase ignores the authored Paint blend mode. Its fixed-function blend is
  // always destination-out, so the matching source-over base identifies only
  // geometry, shader and bind-group layout.
  const additive = request.operation === "paint" && settings.blendMode === "additive";
  const shape = settings.shape === "shape";
  if (request.grainActive) {
    if (!shape) return additive ? pipelines.grainAdditivePipeline : pipelines.grainNormalPipeline;
    if (request.shapeOccupancyActive) {
      return additive
        ? pipelines.grainShapeOccupancyAdditivePipeline
        : pipelines.grainShapeOccupancyNormalPipeline;
    }
    return additive ? pipelines.grainShapeAdditivePipeline : pipelines.grainShapeNormalPipeline;
  }
  if (!shape) return additive ? pipelines.additivePipeline : pipelines.normalPipeline;
  if (request.shapeOccupancyActive) {
    return additive
      ? pipelines.shapeOccupancyAdditivePipeline
      : pipelines.shapeOccupancyNormalPipeline;
  }
  return additive ? pipelines.shapeAdditivePipeline : pipelines.shapeNormalPipeline;
}

/** Selects one authoritative GPU pipeline for Paint or Erase. */
export function selectRasterStrokePipeline(
  pipelines: RasterStrokePipelinePort,
  settings: Readonly<BrushSettings>,
  request: RasterStrokePipelineRequest,
): GPURenderPipeline {
  const paintBase = paintBasePipeline(pipelines, settings, request);
  if (request.operation === "paint") return paintBase;
  const eraser = pipelines.eraserPipelineByPaintBase.get(paintBase);
  if (!eraser) {
    throw new Error("Pipeline Eraser mancante per la geometria raster selezionata.");
  }
  return eraser;
}
