import {
  DESTINATION_OUT_BLEND_STATE,
} from "./engine-raster-stroke-pipelines";

export const RASTER_STROKE_GEOMETRY_KEYS = [
  "circle",
  "shape",
  "shape-occupancy",
  "grain-circle",
  "grain-shape",
  "grain-shape-occupancy",
] as const;

export type RasterStrokeGeometryKey =
  (typeof RASTER_STROKE_GEOMETRY_KEYS)[number];

export interface RasterStrokeGeometryPipelineSpec {
  readonly key: RasterStrokeGeometryKey;
  readonly label: string;
  readonly layout: GPUPipelineLayout;
  readonly fragmentModule: GPUShaderModule;
  readonly selectionLayout: GPUPipelineLayout;
  readonly normal: GPURenderPipeline;
  readonly additive: GPURenderPipeline;
  readonly vertexEntryPoint: "vertexMain" | "shapeVertexMain";
  readonly fragmentEntryPoint:
    | "fragmentMain"
    | "shapeFragmentMain"
    | "shapeOccupancyFragmentMain";
}

export interface RasterStrokePipelineFamily {
  readonly geometry: RasterStrokeGeometryPipelineSpec;
  readonly normal: GPURenderPipeline;
  readonly additive: GPURenderPipeline;
  readonly eraser: GPURenderPipeline;
}

function createEraserPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  vertexModule: GPUShaderModule,
  geometry: RasterStrokeGeometryPipelineSpec,
): GPURenderPipeline {
  return device.createRenderPipeline({
    label: `${geometry.label} destination-out ${format}`,
    layout: geometry.layout,
    vertex: {
      module: vertexModule,
      entryPoint: geometry.vertexEntryPoint,
    },
    fragment: {
      module: geometry.fragmentModule,
      entryPoint: geometry.fragmentEntryPoint,
      targets: [{ format, blend: DESTINATION_OUT_BLEND_STATE }],
    },
    primitive: { topology: "triangle-strip" },
  });
}

/**
 * Completes every existing Paint/Additive geometry with its Eraser pipeline.
 * The same catalog is consumed for pixel-selection variants, so a new brush
 * geometry cannot silently omit either Eraser or selection clipping.
 */
export function createRasterStrokePipelineFamilies(
  device: GPUDevice,
  format: GPUTextureFormat,
  vertexModule: GPUShaderModule,
  geometries: readonly RasterStrokeGeometryPipelineSpec[],
): ReadonlyMap<RasterStrokeGeometryKey, RasterStrokePipelineFamily> {
  const families = new Map<RasterStrokeGeometryKey, RasterStrokePipelineFamily>();
  for (const geometry of geometries) {
    if (families.has(geometry.key)) {
      throw new Error(`Geometria raster duplicata: ${geometry.key}.`);
    }
    families.set(geometry.key, {
      geometry,
      normal: geometry.normal,
      additive: geometry.additive,
      eraser: createEraserPipeline(device, format, vertexModule, geometry),
    });
  }
  for (const key of RASTER_STROKE_GEOMETRY_KEYS) {
    if (!families.has(key)) {
      throw new Error(`Geometria raster mancante: ${key}.`);
    }
  }
  return families;
}

export function rasterStrokePipelineFamily(
  families: ReadonlyMap<RasterStrokeGeometryKey, RasterStrokePipelineFamily>,
  key: RasterStrokeGeometryKey,
): RasterStrokePipelineFamily {
  const family = families.get(key);
  if (!family) throw new Error(`Famiglia pipeline raster mancante: ${key}.`);
  return family;
}

export function eraserPipelineMap(
  families: ReadonlyMap<RasterStrokeGeometryKey, RasterStrokePipelineFamily>,
): Map<GPURenderPipeline, GPURenderPipeline> {
  return new Map(
    [...families.values()].map((family) => [family.normal, family.eraser] as const),
  );
}
