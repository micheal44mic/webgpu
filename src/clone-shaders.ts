import { brushShader, texturizedGrainShader } from "./shaders";
import { injectSelectionClip } from "./selection-clip-shaders";

const cloneSourceBindings = /* wgsl */ `
struct CloneSourceUniforms {
  sourceAndDestination: vec4<f32>,
  rotationAndDocument: vec4<f32>,
  tileAndGrid: vec4<u32>,
};

@group(0) @binding(8) var cloneSourceAtlas: texture_2d_array<f32>;
@group(0) @binding(9) var<storage, read> cloneSourcePageTable: array<u32>;
@group(0) @binding(10) var<uniform> cloneSource: CloneSourceUniforms;

fn cloneSourceTexel(pixel: vec2<i32>) -> vec4<f32> {
  let documentSize = vec2<i32>(cloneSource.rotationAndDocument.zw);
  if (pixel.x < 0 || pixel.y < 0 || pixel.x >= documentSize.x || pixel.y >= documentSize.y) {
    return vec4<f32>(0.0);
  }
  let tileSize = vec2<i32>(cloneSource.tileAndGrid.xy);
  let tile = pixel / tileSize;
  let gridSize = i32(cloneSource.tileAndGrid.z);
  let pageIndex = tile.y * gridSize + tile.x;
  let encodedLayer = cloneSourcePageTable[u32(pageIndex)];
  if (encodedLayer == 0u) {
    return vec4<f32>(0.0);
  }
  let localPixel = pixel - tile * tileSize;
  return textureLoad(cloneSourceAtlas, localPixel, i32(encodedLayer - 1u), 0);
}

fn sampleCloneSource(documentPosition: vec2<f32>) -> vec4<f32> {
  let texelPosition = documentPosition - vec2<f32>(0.5);
  let base = vec2<i32>(floor(texelPosition));
  let amount = fract(texelPosition);
  let top = mix(
    cloneSourceTexel(base),
    cloneSourceTexel(base + vec2<i32>(1, 0)),
    amount.x
  );
  let bottom = mix(
    cloneSourceTexel(base + vec2<i32>(0, 1)),
    cloneSourceTexel(base + vec2<i32>(1, 1)),
    amount.x
  );
  return mix(top, bottom, amount.y);
}

fn clonePremultipliedPixel(fragmentPosition: vec4<f32>, coverage: f32) -> vec4<f32> {
  let destinationPosition = fragmentPosition.xy + brush.renderTargetOrigin;
  let destinationDelta = destinationPosition - cloneSource.sourceAndDestination.zw;
  let rotationCos = cloneSource.rotationAndDocument.x;
  let rotationSin = cloneSource.rotationAndDocument.y;
  let documentPosition = cloneSource.sourceAndDestination.xy + vec2<f32>(
    rotationCos * destinationDelta.x - rotationSin * destinationDelta.y,
    rotationSin * destinationDelta.x + rotationCos * destinationDelta.y
  );
  let amount = clamp(
    coverage * brush.controls.x * brush.baseHslAlpha.w * brush.controls.z,
    0.0,
    0.999999
  );
  return sampleCloneSource(documentPosition) * amount;
}
`;

const cloneBrushEntries = /* wgsl */ `
@fragment
fn cloneFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return clonePremultipliedPixel(input.position, circleCoverage(input));
}

@fragment
fn cloneShapeFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return clonePremultipliedPixel(input.position, shapeCoverage(input));
}

@fragment
fn cloneShapeOccupancyFragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return clonePremultipliedPixel(input.position, occupiedShapeCoverage(input));
}
`;

const cloneGrainEntries = /* wgsl */ `
@fragment
fn cloneFragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return clonePremultipliedPixel(input.position, circleGrainCoverage(input));
}

@fragment
fn cloneShapeFragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return clonePremultipliedPixel(input.position, shapeGrainCoverage(input));
}

@fragment
fn cloneShapeOccupancyFragmentMain(input: FragmentInput) -> @location(0) vec4<f32> {
  return clonePremultipliedPixel(input.position, occupiedShapeGrainCoverage(input));
}
`;

export const cloneBrushShader = `${brushShader}\n${cloneSourceBindings}\n${cloneBrushEntries}`;
export const cloneTexturizedGrainShader =
  `${texturizedGrainShader}\n${cloneSourceBindings}\n${cloneGrainEntries}`;

export const selectionCloneBrushShader = injectSelectionClip(
  cloneBrushShader,
  "@group(0) @binding(4) var<uniform> shapeOccupancy: ShapeOccupancy;",
  "VertexOutput",
  ["circleCoverage", "shapeCoverage", "occupiedShapeCoverage"],
);

export const selectionCloneTexturizedGrainShader = injectSelectionClip(
  cloneTexturizedGrainShader,
  "@group(0) @binding(7) var<uniform> grain: GrainUniforms;",
  "FragmentInput",
  ["circleGrainCoverage", "shapeGrainCoverage", "occupiedShapeGrainCoverage"],
);
