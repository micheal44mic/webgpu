import { brushShader, texturizedGrainShader } from "./shaders";

export const PIXEL_SELECTION_PAINT_CLIP_STRATEGY =
  "separate-fragment-storage-mask-pipelines-history-snapshot-v1" as const;

const selectionBindingAndGuard = /* wgsl */ `
@group(1) @binding(0) var<storage, read> pixelSelectionMask: array<u32>;

fn pixelSelectionContains(fragmentPosition: vec4<f32>) -> bool {
  let pixel = vec2<i32>(floor(fragmentPosition.xy + brush.renderTargetOrigin));
  let documentExtent = vec2<i32>(brush.documentSize);
  if (
    pixel.x < 0 || pixel.y < 0
    || pixel.x >= documentExtent.x
    || pixel.y >= documentExtent.y
  ) {
    return false;
  }
  let unsignedPixel = vec2<u32>(pixel);
  let wordsPerRow = (u32(documentExtent.x) + 31u) / 32u;
  let wordIndex = unsignedPixel.y * wordsPerRow + unsignedPixel.x / 32u;
  return (pixelSelectionMask[wordIndex] & (1u << (unsignedPixel.x & 31u))) != 0u;
}
`;

export function injectSelectionClip(
  source: string,
  bindingMarker: string,
  inputType: "VertexOutput" | "FragmentInput",
  coverageFunctions: readonly string[],
): string {
  if (!source.includes(bindingMarker)) {
    throw new Error("The brush bind-group marker was not found for Pixel Selection.");
  }
  let result = source.replace(bindingMarker, `${bindingMarker}\n${selectionBindingAndGuard}`);
  for (const functionName of coverageFunctions) {
    const marker = `fn ${functionName}(input: ${inputType}) -> f32 {`;
    const matches = result.split(marker).length - 1;
    if (matches !== 1) {
      throw new Error(
        `The Pixel Selection guard requires exactly one ${functionName} function; found ${matches}.`,
      );
    }
    const functionStart = result.indexOf(marker);
    const functionEnd = result.indexOf("\n}\n", functionStart);
    const returnMarker = "  return coverage;";
    const returnOffset = result.lastIndexOf(returnMarker, functionEnd);
    if (functionEnd < 0 || returnOffset < functionStart) {
      throw new Error(`Coverage exit point ${functionName} was not found.`);
    }
    result = result.slice(0, returnOffset)
      + "  if (!pixelSelectionContains(input.position)) { discard; }\n"
      + result.slice(returnOffset);
  }
  return result;
}

export const selectionBrushShader = injectSelectionClip(
  brushShader,
  "@group(0) @binding(4) var<uniform> shapeOccupancy: ShapeOccupancy;",
  "VertexOutput",
  ["circleCoverage", "shapeCoverage", "occupiedShapeCoverage"],
);

export const selectionTexturizedGrainShader = injectSelectionClip(
  texturizedGrainShader,
  "@group(0) @binding(7) var<uniform> grain: GrainUniforms;",
  "FragmentInput",
  ["circleGrainCoverage", "shapeGrainCoverage", "occupiedShapeGrainCoverage"],
);
