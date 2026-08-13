/**
 * Semantic operation performed by a raster stroke.
 *
 * BrushSettings keeps describing the reusable brush geometry (Paint or Blend).
 * Erase is deliberately separate so selecting the eraser never changes brush
 * presets or the persisted project schema.
 */
export type RasterStrokeOperation = "paint" | "erase";

export function rasterStrokeOperationForCanvasTool(
  tool: string,
): RasterStrokeOperation {
  return tool === "eraser" ? "erase" : "paint";
}

export function normalizeRasterStrokeOperation(
  operation: RasterStrokeOperation | undefined,
): RasterStrokeOperation {
  return operation === "erase" ? "erase" : "paint";
}
