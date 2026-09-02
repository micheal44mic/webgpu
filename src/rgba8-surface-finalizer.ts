import type { BrushEngine } from "./brush-engine";
import type { MergedSurfaceResources } from "./engine-layer-resources";
import { rgba8SpatialQuantizationShader } from "./rgba8-spatial-quantization.ts";

/** Stable phase for derived presentation caches rebuilt from the same document pixels. */
export const DERIVED_RGBA8_SURFACE_QUANTIZATION_SEED = 0x51f15e0d;

const rgba8SurfaceFinalizePipelines = new WeakMap<GPUDevice, GPURenderPipeline>();

export const RGBA8_SURFACE_FINALIZE_WGSL = /* wgsl */ `
${rgba8SpatialQuantizationShader}

struct FinalizeUniforms {
  outputOrigin: vec2<u32>,
  workingOrigin: vec2<u32>,
  seed: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var workingTexture: texture_2d<f32>;
@group(0) @binding(1) var<uniform> finalize: FinalizeUniforms;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  var position = vec2<f32>(-1.0, -1.0);
  if (vertexIndex == 1u) {
    position = vec2<f32>(3.0, -1.0);
  } else if (vertexIndex == 2u) {
    position = vec2<f32>(-1.0, 3.0);
  }
  return vec4<f32>(position, 0.0, 1.0);
}

@fragment
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>,
) -> @location(0) vec4<f32> {
  let outputPixel = vec2<u32>(fragmentPosition.xy);
  let documentCoordinate = finalize.outputOrigin + outputPixel;
  let workingPixel = vec2<i32>(documentCoordinate)
    - vec2<i32>(finalize.workingOrigin);
  let encodedPremultiplied = textureLoad(workingTexture, workingPixel, 0);
  return quantizeRgba8SpatialAdjacent(
    encodedPremultiplied,
    documentCoordinate,
    finalize.seed,
  );
}
`;

function rgba8SurfaceFinalizePipeline(engine: BrushEngine): GPURenderPipeline {
  const existing = rgba8SurfaceFinalizePipelines.get(engine.device);
  if (existing) return existing;
  const module = engine.device.createShaderModule({
    label: "Derived RGBA8 surface finalizer WGSL",
    code: RGBA8_SURFACE_FINALIZE_WGSL,
  });
  const pipeline = engine.device.createRenderPipeline({
    label: "Derived RGBA16F to encoded RGBA8 surface finalizer",
    layout: "auto",
    vertex: { module, entryPoint: "vertexMain" },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [{ format: "rgba8unorm" }],
    },
    primitive: { topology: "triangle-list" },
  });
  rgba8SurfaceFinalizePipelines.set(engine.device, pipeline);
  return pipeline;
}

/**
 * Quantizes one bounded RGBA16F working tile into a persistent RGBA8 surface.
 * The threshold field is evaluated in document coordinates, so rebuilding the
 * same pixels is independent from tile boundaries and camera state.
 */
export async function finalizeRgba8SurfaceTile(
  engine: BrushEngine,
  working: MergedSurfaceResources,
  output: MergedSurfaceResources,
  label: string,
  seed = DERIVED_RGBA8_SURFACE_QUANTIZATION_SEED,
): Promise<void> {
  if (
    working.format !== "rgba16float"
    || output.format !== "rgba8unorm"
    || working.resolutionScale !== 1
    || output.resolutionScale !== 1
  ) {
    throw new Error(`${label}: expected 1:1 RGBA16F working and RGBA8 output surfaces.`);
  }
  const relativeX = working.bounds.x - output.bounds.x;
  const relativeY = working.bounds.y - output.bounds.y;
  if (
    relativeX < 0
    || relativeY < 0
    || relativeX + working.bounds.width > output.bounds.width
    || relativeY + working.bounds.height > output.bounds.height
  ) {
    throw new Error(`${label}: working tile lies outside the output surface.`);
  }
  const pipeline = rgba8SurfaceFinalizePipeline(engine);
  const uniformBuffer = engine.device.createBuffer({
    label: `${label} · finalizer uniforms`,
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  engine.device.queue.writeBuffer(
    uniformBuffer,
    0,
    new Uint32Array([
      output.bounds.x,
      output.bounds.y,
      working.bounds.x,
      working.bounds.y,
      seed >>> 0,
      0,
      0,
      0,
    ]),
  );
  try {
    const bindGroup = engine.device.createBindGroup({
      label: `${label} · finalizer bindings`,
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: working.samplingView },
        { binding: 1, resource: { buffer: uniformBuffer } },
      ],
    });
    const encoder = engine.device.createCommandEncoder({ label });
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [{
        view: output.mipViews[0],
        loadOp: "load",
        storeOp: "store",
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setScissorRect(
      relativeX,
      relativeY,
      working.bounds.width,
      working.bounds.height,
    );
    pass.draw(3, 1, 0, 0);
    pass.end();
    engine.device.queue.submit([encoder.finish()]);
    await engine.waitForGpuCapped(label, 60_000);
  } finally {
    uniformBuffer.destroy();
  }
}
