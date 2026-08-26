import type { BrushEngine } from "./brush-engine";
import type { CloneSampleMode } from "./clone-interaction-core";
import { createCloneSourceTransform } from "./clone-gpu-core";
import { clonePreviewTextureSource } from "./engine-clone-runtime";
import { assertShaderCompiled } from "./engine-gpu-utils";
import { SHAPE_MASK_FILTER_UV_HALF_EXTENT } from "./engine-limits";

const CLONE_PREVIEW_UNIFORM_BYTES = 256;
const CLONE_PREVIEW_MAX_BACKING_PIXELS = 256;

export interface CloneSamplePreviewRequest {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly angleDegrees: number;
  readonly sampleMode: CloneSampleMode;
  readonly diameterCssPixels: number;
}

interface ClonePreviewResources {
  readonly layout: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
  readonly uniformBuffer: GPUBuffer;
  readonly uniformUpload: Float32Array;
  readonly configuredCanvases: WeakSet<HTMLCanvasElement>;
  sourceView: GPUTextureView | null;
  shapeView: GPUTextureView | null;
  bindGroup: GPUBindGroup | null;
}

interface ClonePreviewState {
  resources: ClonePreviewResources | null;
  promise: Promise<ClonePreviewResources> | null;
}

const previewStates = new WeakMap<BrushEngine, ClonePreviewState>();

const clonePreviewShader = /* wgsl */ `
struct PreviewUniforms {
  sourceAndBounds: vec4<f32>,
  rotationAndBrush: vec4<f32>,
  canvasAndControls: vec4<f32>,
};

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var<uniform> preview: PreviewUniforms;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var shapeTexture: texture_2d<f32>;
@group(0) @binding(3) var shapeSampler: sampler;

fn sourceTexel(pixel: vec2<i32>) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(sourceTexture, 0));
  if (pixel.x < 0 || pixel.y < 0 || pixel.x >= dimensions.x || pixel.y >= dimensions.y) {
    return vec4<f32>(0.0);
  }
  return textureLoad(sourceTexture, pixel, 0);
}

fn sampleSource(documentPosition: vec2<f32>) -> vec4<f32> {
  let localPosition = documentPosition - preview.sourceAndBounds.zw - vec2<f32>(0.5);
  let base = vec2<i32>(floor(localPosition));
  let amount = fract(localPosition);
  let top = mix(sourceTexel(base), sourceTexel(base + vec2<i32>(1, 0)), amount.x);
  let bottom = mix(
    sourceTexel(base + vec2<i32>(0, 1)),
    sourceTexel(base + vec2<i32>(1, 1)),
    amount.x
  );
  return mix(top, bottom, amount.y);
}

fn linearToSrgbChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  if (clamped <= 0.0031308) {
    return clamped * 12.92;
  }
  return 1.055 * pow(clamped, 1.0 / 2.4) - 0.055;
}

fn encodedPremultiplied(value: vec4<f32>) -> vec4<f32> {
  let alpha = clamp(value.a, 0.0, 1.0);
  if (alpha <= 0.0) {
    return vec4<f32>(0.0);
  }
  let straight = clamp(value.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  let encoded = vec3<f32>(
    linearToSrgbChannel(straight.r),
    linearToSrgbChannel(straight.g),
    linearToSrgbChannel(straight.b)
  );
  return vec4<f32>(encoded * alpha, alpha);
}

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
fn fragmentMain(@builtin(position) fragmentPosition: vec4<f32>) -> @location(0) vec4<f32> {
  let canvasSize = max(preview.canvasAndControls.xy, vec2<f32>(1.0));
  let local = fragmentPosition.xy / canvasSize * 2.0 - vec2<f32>(1.0);
  let radiusSquared = dot(local, local);
  if (radiusSquared > 1.0) {
    discard;
  }

  let hardness = clamp(preview.canvasAndControls.z, 0.0, 1.0);
  let shapeMode = preview.canvasAndControls.w > 0.5;
  var coverage: f32;
  if (shapeMode) {
    let shapeUv = local * ${SHAPE_MASK_FILTER_UV_HALF_EXTENT} + vec2<f32>(0.5);
    let sourceCoverage = textureSample(shapeTexture, shapeSampler, shapeUv).r;
    coverage = mix(sourceCoverage * sourceCoverage, sourceCoverage, hardness);
  } else {
    let antialiasWidth = max(2.0 / min(canvasSize.x, canvasSize.y), 0.001);
    let innerEdge = min(hardness * hardness, 1.0 - antialiasWidth);
    coverage = 1.0 - smoothstep(innerEdge, 1.0 + antialiasWidth, radiusSquared);
  }
  if (coverage <= 0.0) {
    discard;
  }

  let localDocument = local * preview.rotationAndBrush.z;
  let c = preview.rotationAndBrush.x;
  let s = preview.rotationAndBrush.y;
  let sourcePosition = preview.sourceAndBounds.xy + vec2<f32>(
    c * localDocument.x - s * localDocument.y,
    s * localDocument.x + c * localDocument.y
  );
  let sampled = sampleSource(sourcePosition) * coverage * preview.rotationAndBrush.w;
  return encodedPremultiplied(sampled);
}
`;

function previewState(engine: BrushEngine): ClonePreviewState {
  let state = previewStates.get(engine);
  if (!state) {
    state = { resources: null, promise: null };
    previewStates.set(engine, state);
  }
  return state;
}

async function createPreviewResources(engine: BrushEngine): Promise<ClonePreviewResources> {
  const module = engine.device.createShaderModule({
    label: "Clone first-sample preview WGSL",
    code: clonePreviewShader,
  });
  await assertShaderCompiled(module, "Clone first-sample preview");
  const layout = engine.device.createBindGroupLayout({
    label: "Clone first-sample preview layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "unfilterable-float" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
      },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
    ],
  });
  const pipeline = await engine.device.createRenderPipelineAsync({
    label: "Clone first-sample preview pipeline",
    layout: engine.device.createPipelineLayout({
      label: "Clone first-sample preview pipeline layout",
      bindGroupLayouts: [layout],
    }),
    vertex: { module, entryPoint: "vertexMain" },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: engine.canvasFormat }],
    },
    primitive: { topology: "triangle-list" },
  });
  return {
    layout,
    pipeline,
    uniformBuffer: engine.device.createBuffer({
      label: "Clone first-sample preview uniforms",
      size: CLONE_PREVIEW_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    uniformUpload: new Float32Array(CLONE_PREVIEW_UNIFORM_BYTES / Float32Array.BYTES_PER_ELEMENT),
    configuredCanvases: new WeakSet(),
    sourceView: null,
    shapeView: null,
    bindGroup: null,
  };
}

export async function warmCloneSamplePreview(engine: BrushEngine): Promise<void> {
  const state = previewState(engine);
  if (state.resources) return;
  state.promise ??= createPreviewResources(engine).then((resources) => {
    state.resources = resources;
    return resources;
  }).finally(() => {
    state.promise = null;
  });
  await state.promise;
}

function configurePreviewCanvas(
  engine: BrushEngine,
  resources: ClonePreviewResources,
  canvas: HTMLCanvasElement,
): GPUCanvasContext | null {
  const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
  if (!context) return null;
  if (!resources.configuredCanvases.has(canvas)) {
    context.configure({
      device: engine.device,
      format: engine.canvasFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
      alphaMode: "premultiplied",
      colorSpace: "srgb",
    });
    resources.configuredCanvases.add(canvas);
  }
  return context;
}

/** Draws one transient GPU-only sample. It never creates a stroke or History entry. */
export function renderCloneSamplePreview(
  engine: BrushEngine,
  canvas: HTMLCanvasElement,
  request: Readonly<CloneSamplePreviewRequest>,
): boolean {
  const resources = previewState(engine).resources;
  if (!resources) {
    void warmCloneSamplePreview(engine).catch(() => undefined);
    return false;
  }
  const source = clonePreviewTextureSource(engine, request.sampleMode);
  if (!source) return false;

  const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const requestedBacking = Math.max(1, Math.round(request.diameterCssPixels * pixelRatio));
  const backingSize = Math.min(CLONE_PREVIEW_MAX_BACKING_PIXELS, requestedBacking);
  if (canvas.width !== backingSize || canvas.height !== backingSize) {
    canvas.width = backingSize;
    canvas.height = backingSize;
  }
  const context = configurePreviewCanvas(engine, resources, canvas);
  if (!context) return false;

  const encoder = engine.device.createCommandEncoder({
    label: "Clone first-sample preview encoder",
  });
  const pass = encoder.beginRenderPass({
    label: "Clone first-sample preview pass",
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    }],
  });
  if (source.view) {
    const transform = createCloneSourceTransform({
      sourceX: request.sourceX,
      sourceY: request.sourceY,
      destinationX: 0,
      destinationY: 0,
      angleDegrees: request.angleDegrees,
    });
    const upload = resources.uniformUpload;
    upload.fill(0);
    upload[0] = transform.sourceX;
    upload[1] = transform.sourceY;
    upload[2] = source.bounds.x;
    upload[3] = source.bounds.y;
    upload[4] = transform.rotationCos;
    upload[5] = transform.rotationSin;
    upload[6] = Math.max(0.5, engine.settings.size * 0.5);
    upload[7] = Math.max(0, Math.min(1, engine.settings.opacity * engine.settings.flow));
    upload[8] = backingSize;
    upload[9] = backingSize;
    upload[10] = engine.settings.hardness;
    upload[11] = engine.settings.shape === "shape" ? 1 : 0;
    engine.device.queue.writeBuffer(resources.uniformBuffer, 0, upload);
    if (
      resources.bindGroup === null
      || resources.sourceView !== source.view
      || resources.shapeView !== engine.shapeMaskView
    ) {
      resources.sourceView = source.view;
      resources.shapeView = engine.shapeMaskView;
      resources.bindGroup = engine.device.createBindGroup({
        label: "Clone first-sample preview bind group",
        layout: resources.layout,
        entries: [
          { binding: 0, resource: { buffer: resources.uniformBuffer } },
          { binding: 1, resource: source.view },
          { binding: 2, resource: engine.shapeMaskView },
          { binding: 3, resource: engine.shapeMaskSampler },
        ],
      });
    }
    pass.setPipeline(resources.pipeline);
    pass.setBindGroup(0, resources.bindGroup);
    pass.draw(3);
  }
  pass.end();
  engine.device.queue.submit([encoder.finish()]);
  return true;
}

