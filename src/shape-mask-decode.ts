
import { SHAPE_MASK_SIZE } from "./engine-limits";/**
 * Decodifica della maschera Shape via canvas 2D, percorso di fallback quando la
 * decodifica diretta del PNG non e' disponibile.
 */

export async function decodeShapeMaskWithCanvas(
  source: ArrayBuffer,
  invertLuminance = false,
): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([source], { type: "image/png" }), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });

  try {
    if (bitmap.width !== SHAPE_MASK_SIZE || bitmap.height !== SHAPE_MASK_SIZE) {
      throw new Error(
        `Shape.png must remain ${SHAPE_MASK_SIZE}×${SHAPE_MASK_SIZE}px; found ${bitmap.width}×${bitmap.height}px.`,
      );
    }

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = SHAPE_MASK_SIZE;
    sourceCanvas.height = SHAPE_MASK_SIZE;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) {
      throw new Error("Could not read the Shape.png mask.");
    }
    sourceContext.drawImage(bitmap, 0, 0);
    const rgba = sourceContext.getImageData(0, 0, SHAPE_MASK_SIZE, SHAPE_MASK_SIZE).data;
    const baseMask = new Uint8Array(SHAPE_MASK_SIZE * SHAPE_MASK_SIZE);

    for (let pixelIndex = 0, rgbaIndex = 0; pixelIndex < baseMask.length; pixelIndex += 1, rgbaIndex += 4) {
      const luminance = Math.round(
        rgba[rgbaIndex] * 0.2126
        + rgba[rgbaIndex + 1] * 0.7152
        + rgba[rgbaIndex + 2] * 0.0722,
      );
      const coverageLuminance = invertLuminance ? 255 - luminance : luminance;
      baseMask[pixelIndex] = Math.round(
        (coverageLuminance * rgba[rgbaIndex + 3]) / 255,
      );
    }
    return baseMask;
  } finally {
    bitmap.close();
  }
}
