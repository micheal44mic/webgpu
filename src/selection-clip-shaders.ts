import { brushShader, texturizedGrainShader } from "./shaders";
import {
  SELECTION_LAYER_HEIGHT,
  SELECTION_LAYER_WIDTH,
  SELECTION_WORDS_PER_ROW,
} from "./selection-core";

export const PIXEL_SELECTION_PAINT_CLIP_STRATEGY =
  "separate-fragment-storage-mask-pipelines-history-snapshot-v1" as const;

const selectionBindingAndGuard = /* wgsl */ `
const PIXEL_SELECTION_LAYER_EXTENT: vec2<i32> = vec2<i32>(${SELECTION_LAYER_WIDTH}, ${SELECTION_LAYER_HEIGHT});
const PIXEL_SELECTION_WORDS_PER_ROW: u32 = ${SELECTION_WORDS_PER_ROW}u;

@group(1) @binding(0) var<storage, read> pixelSelectionMask: array<u32>;

fn pixelSelectionContains(fragmentPosition: vec4<f32>) -> bool {
  let pixel = vec2<i32>(floor(fragmentPosition.xy + brush.renderTargetOrigin));
  if (
    pixel.x < 0 || pixel.y < 0
    || pixel.x >= PIXEL_SELECTION_LAYER_EXTENT.x
    || pixel.y >= PIXEL_SELECTION_LAYER_EXTENT.y
  ) {
    return false;
  }
  let unsignedPixel = vec2<u32>(pixel);
  let wordIndex = unsignedPixel.y * PIXEL_SELECTION_WORDS_PER_ROW + unsignedPixel.x / 32u;
  return (pixelSelectionMask[wordIndex] & (1u << (unsignedPixel.x & 31u))) != 0u;
}
`;

function injectSelectionClip(
  source: string,
  bindingMarker: string,
  inputType: "VertexOutput" | "FragmentInput",
  coverageFunctions: readonly string[],
): string {
  if (!source.includes(bindingMarker)) {
    throw new Error("Marker bind group del pennello non trovato per la Selezione pixel.");
  }
  let result = source.replace(bindingMarker, `${bindingMarker}\n${selectionBindingAndGuard}`);
  for (const functionName of coverageFunctions) {
    const marker = `fn ${functionName}(input: ${inputType}) -> f32 {`;
    const matches = result.split(marker).length - 1;
    if (matches !== 1) {
      throw new Error(
        `La guardia Selezione pixel richiede una sola funzione ${functionName}; trovate ${matches}.`,
      );
    }
    const functionStart = result.indexOf(marker);
    const functionEnd = result.indexOf("\n}\n", functionStart);
    const returnMarker = "  return coverage;";
    const returnOffset = result.lastIndexOf(returnMarker, functionEnd);
    if (functionEnd < 0 || returnOffset < functionStart) {
      throw new Error(`Punto di uscita coverage ${functionName} non trovato.`);
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
