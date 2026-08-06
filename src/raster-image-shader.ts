/**
 * WebGPU shaders for immutable raster-image assets in the heterogeneous scene.
 *
 * Mipmap pass bindings (group 0):
 *   0 - `texture_2d<f32>` view exposing exactly the preceding sRGB mip.
 *
 * The mip pipeline must target `rgba8unorm-srgb` without blending. Reading an
 * sRGB view decodes RGB to linear values and writing the sRGB attachment encodes
 * RGB again; alpha stays linear. Mip 0 must already contain premultiplied alpha,
 * so the exact 2x2 average below remains premultiplied and cannot create dark
 * fringes around transparent pixels.
 *
 * Mixed-scene image bindings (group 0):
 *   0 - the existing 64-byte `DisplayUniforms` buffer;
 *   1 - one 32-byte `RasterImageUniforms` buffer;
 *   2 - the complete premultiplied `rgba8unorm-srgb` image texture + mip chain;
 *   3 - a filtering sampler (linear min/mag and linear mip filtering).
 *
 * The image pipeline uses a four-vertex `triangle-strip`, culling disabled, and
 * targets the existing `rgba16float` mixed-scene surface with premultiplied
 * source-over blending (`one`, `one-minus-src-alpha`) for color and alpha.
 */

export const RASTER_IMAGE_MIPMAP_STRATEGY =
  "webgpu-straight-srgb-to-linear-premultiplied-exact-area-npot-mips-v2" as const;

export const RASTER_IMAGE_MIXED_SCENE_STRATEGY =
  "webgpu-native-srgb-mips-transformed-quad-premultiplied-source-over-v1" as const;

/**
 * Generates one mip from a view of the immediately preceding mip.
 *
 * A per-level source view makes `textureLoad(..., 0)` address that view's sole
 * mip. Clamping every tap is required for 1-pixel axes and keeps all reads valid
 * throughout a non-power-of-two chain. The render pass viewport/scissor must be
 * exactly the destination mip dimensions.
 */
export const rasterImageMipmapShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@fragment
fn fragmentPremultiplyMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(sourceTexture, 0));
  let coordinate = clamp(
    vec2<i32>(fragmentPosition.xy),
    vec2<i32>(0),
    dimensions - vec2<i32>(1)
  );
  let straightLinear = textureLoad(sourceTexture, coordinate, 0);
  return vec4<f32>(straightLinear.rgb * straightLinear.a, straightLinear.a);
}

fn texelOverlap(start: f32, end: f32, coordinate: i32) -> f32 {
  let texelStart = f32(coordinate);
  return max(0.0, min(end, texelStart + 1.0) - max(start, texelStart));
}

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let sourceDimensions = vec2<i32>(textureDimensions(sourceTexture, 0));
  let destinationDimensions = max(sourceDimensions / vec2<i32>(2), vec2<i32>(1));
  let destinationCoordinate = vec2<i32>(fragmentPosition.xy);
  let sourceScale = vec2<f32>(sourceDimensions) / vec2<f32>(destinationDimensions);
  let sourceStart = vec2<f32>(destinationCoordinate) * sourceScale;
  let sourceEnd = vec2<f32>(destinationCoordinate + vec2<i32>(1)) * sourceScale;
  let firstSourceCoordinate = vec2<i32>(floor(sourceStart));

  var accumulated = vec4<f32>(0.0);
  var accumulatedWeight = 0.0;
  for (var y = 0; y < 3; y = y + 1) {
    let sourceY = firstSourceCoordinate.y + y;
    if (sourceY >= 0 && sourceY < sourceDimensions.y) {
      let weightY = texelOverlap(sourceStart.y, sourceEnd.y, sourceY);
      for (var x = 0; x < 3; x = x + 1) {
        let sourceX = firstSourceCoordinate.x + x;
        if (sourceX >= 0 && sourceX < sourceDimensions.x) {
          let weight = weightY * texelOverlap(sourceStart.x, sourceEnd.x, sourceX);
          accumulated += textureLoad(
            sourceTexture,
            vec2<i32>(sourceX, sourceY),
            0
          ) * weight;
          accumulatedWeight += weight;
        }
      }
    }
  }

  // Each source view contains linear-premultiplied pixels encoded by its sRGB
  // format. Exact area weights preserve every edge texel on odd NPOT levels.
  return accumulated / max(accumulatedWeight, 0.000001);
}
`;

/**
 * Draws one native image asset directly into the ordered mixed-scene target.
 *
 * `center` and `halfSize` are document-space values. `rotation` is `(cos, sin)`
 * for the node rotation in the document's clockwise-positive, Y-down space.
 * `halfSize` may be signed, allowing future horizontal/vertical flips without
 * changing the shader ABI. `opacity` is clamped in the shader; `_padding` must
 * be zero and keeps the uniform size/alignment at exactly 32 bytes.
 */
export const rasterImageMixedSceneShader = /* wgsl */ `
const RASTER_IMAGE_PIXEL_VIEW_ZOOM_THRESHOLD: f32 = 5.81;

struct DisplayUniforms {
  canvasSize: vec2<f32>,
  viewRotation: vec2<f32>,
  viewCenter: vec2<f32>,
  zoom: f32,
  checkerSize: f32,
  selectedMipLevel: f32,
  hasMergedBelow: f32,
  hasMergedAbove: f32,
  activeLayerAlpha: f32,
  mergedBelowOrigin: vec2<f32>,
  mergedAboveOrigin: vec2<f32>,
};

struct RasterImageUniforms {
  center: vec2<f32>,
  halfSize: vec2<f32>,
  rotation: vec2<f32>,
  opacity: f32,
  _padding: f32,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var<uniform> display: DisplayUniforms;
@group(0) @binding(1) var<uniform> image: RasterImageUniforms;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var sourceSampler: sampler;

fn rotateYDown(value: vec2<f32>, rotation: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    rotation.x * value.x - rotation.y * value.y,
    rotation.y * value.x + rotation.x * value.y
  );
}

fn documentToScreen(documentPosition: vec2<f32>) -> vec2<f32> {
  let documentDelta = documentPosition - display.viewCenter;
  return display.canvasSize * 0.5 + display.zoom * vec2<f32>(
    display.viewRotation.x * documentDelta.x
      - display.viewRotation.y * documentDelta.y,
    display.viewRotation.y * documentDelta.x
      + display.viewRotation.x * documentDelta.y
  );
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );
  let texcoords = array<vec2<f32>, 4>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0)
  );

  let localOffset = corners[vertexIndex] * image.halfSize;
  let documentPosition = image.center + rotateYDown(localOffset, image.rotation);
  let screenPosition = documentToScreen(documentPosition);
  let safeCanvasSize = max(display.canvasSize, vec2<f32>(1.0));

  var output: VertexOutput;
  output.position = vec4<f32>(
    screenPosition.x / safeCanvasSize.x * 2.0 - 1.0,
    1.0 - screenPosition.y / safeCanvasSize.y * 2.0,
    0.0,
    1.0
  );
  output.uv = texcoords[vertexIndex];
  return output;
}

fn nearestImageTexel(uv: vec2<f32>, dimensions: vec2<i32>) -> vec2<i32> {
  return clamp(
    vec2<i32>(floor(clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0))
      * vec2<f32>(dimensions))),
    vec2<i32>(0),
    dimensions - vec2<i32>(1)
  );
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(sourceTexture, 0));
  let dimensionsF = vec2<f32>(dimensions);

  // Compute derivatives before control flow. This keeps derivative operations
  // in uniform flow and also gives rotated/non-uniform transforms the correct
  // hardware LOD instead of estimating it from document zoom alone.
  let uvDx = dpdx(input.uv);
  let uvDy = dpdy(input.uv);
  let filtered = textureSampleGrad(
    sourceTexture,
    sourceSampler,
    input.uv,
    uvDx,
    uvDy
  );

  let documentPixelsPerTexel = 2.0 * abs(image.halfSize) / dimensionsF;
  let minimumScreenPixelsPerTexel = display.zoom * min(
    documentPixelsPerTexel.x,
    documentPixelsPerTexel.y
  );
  var source = filtered;
  if (minimumScreenPixelsPerTexel >= RASTER_IMAGE_PIXEL_VIEW_ZOOM_THRESHOLD) {
    source = textureLoad(
      sourceTexture,
      nearestImageTexel(input.uv, dimensions),
      0
    );
  }

  // Sampling the sRGB texture decodes RGB to linear light. The asset and all
  // its mip levels are already premultiplied, therefore opacity scales the
  // complete RGBA vector exactly once before fixed-function source-over.
  return source * clamp(image.opacity, 0.0, 1.0);
}
`;
