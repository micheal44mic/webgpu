import { assertShaderCompiled } from "./engine-gpu-utils";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";

const RESOLVE_UNIFORM_BYTES = 32;
const WORKGROUP_SIZE = 8;

interface SharedResolveResources {
  readonly bindGroupLayout: GPUBindGroupLayout;
  readonly pipeline: GPUComputePipeline;
}

export interface Rgba16fToRgba8ResolveResources {
  readonly uniformBuffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  readonly shared: SharedResolveResources;
  readonly memoryBytes: number;
}

export interface Rgba16fToRgba8ResolveRect {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly width: number;
  readonly height: number;
}

const sharedByDevice = new WeakMap<GPUDevice, Promise<SharedResolveResources>>();

const RESOLVE_SHADER = /* wgsl */ `
struct ResolveUniforms {
  sourceOrigin: vec2<u32>,
  targetOrigin: vec2<u32>,
  size: vec2<u32>,
  _padding: vec2<u32>,
};

@group(0) @binding(0) var<uniform> parameters: ResolveUniforms;
@group(0) @binding(1) var rgba16fSource: texture_2d<f32>;
@group(0) @binding(2) var rgba8Target: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= parameters.size.x || id.y >= parameters.size.y) {
    return;
  }
  let sourcePosition = parameters.sourceOrigin + id.xy;
  let targetPosition = parameters.targetOrigin + id.xy;
  // This is the only intended persistent UNORM8 quantization for the
  // operation. All upstream paint/effect passes remain RGBA16F with f32 math.
  textureStore(
    rgba8Target,
    vec2<i32>(targetPosition),
    textureLoad(rgba16fSource, vec2<i32>(sourcePosition), 0)
  );
}
`;

async function createSharedResources(device: GPUDevice): Promise<SharedResolveResources> {
  return runGpuAllocationTransaction(
    device,
    "Pipeline resolve RGBA16F → layer RGBA8",
    async () => {
      const module = device.createShaderModule({
        label: "Resolve RGBA16F → layer RGBA8 WGSL",
        code: RESOLVE_SHADER,
      });
      await assertShaderCompiled(module, "Resolve RGBA16F → RGBA8");
      const bindGroupLayout = device.createBindGroupLayout({
        label: "Resolve RGBA16F → layer RGBA8 layout",
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "uniform", minBindingSize: RESOLVE_UNIFORM_BYTES },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            texture: { sampleType: "unfilterable-float" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: { access: "write-only", format: "rgba8unorm" },
          },
        ],
      });
      const pipeline = device.createComputePipeline({
        label: "Resolve RGBA16F → layer RGBA8 pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        compute: { module, entryPoint: "main" },
      });
      return { bindGroupLayout, pipeline };
    },
  );
}

async function requireSharedResources(device: GPUDevice): Promise<SharedResolveResources> {
  let promise = sharedByDevice.get(device);
  if (!promise) {
    promise = createSharedResources(device);
    sharedByDevice.set(device, promise);
  }
  try {
    return await promise;
  } catch (error) {
    sharedByDevice.delete(device);
    throw error;
  }
}

export async function createRgba16fToRgba8ResolveResources(
  device: GPUDevice,
  sourceView: GPUTextureView,
  targetView: GPUTextureView,
  label: string,
): Promise<Rgba16fToRgba8ResolveResources> {
  const shared = await requireSharedResources(device);
  const uniformBuffer = device.createBuffer({
    label: `${label} resolve parameters`,
    size: RESOLVE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  try {
    const bindGroup = device.createBindGroup({
      label: `${label} resolve bind group`,
      layout: shared.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: sourceView },
        { binding: 2, resource: targetView },
      ],
    });
    return {
      uniformBuffer,
      bindGroup,
      shared,
      memoryBytes: RESOLVE_UNIFORM_BYTES,
    };
  } catch (error) {
    uniformBuffer.destroy();
    throw error;
  }
}

export function encodeRgba16fToRgba8Resolve(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  resources: Rgba16fToRgba8ResolveResources,
  rect: Rgba16fToRgba8ResolveRect,
  label: string,
): void {
  if (rect.width <= 0 || rect.height <= 0) return;
  const upload = new Uint32Array([
    rect.sourceX >>> 0,
    rect.sourceY >>> 0,
    rect.targetX >>> 0,
    rect.targetY >>> 0,
    rect.width >>> 0,
    rect.height >>> 0,
    0,
    0,
  ]);
  device.queue.writeBuffer(resources.uniformBuffer, 0, upload);
  const pass = encoder.beginComputePass({ label });
  pass.setPipeline(resources.shared.pipeline);
  pass.setBindGroup(0, resources.bindGroup);
  pass.dispatchWorkgroups(
    Math.ceil(rect.width / WORKGROUP_SIZE),
    Math.ceil(rect.height / WORKGROUP_SIZE),
  );
  pass.end();
}

export function destroyRgba16fToRgba8ResolveResources(
  resources: Rgba16fToRgba8ResolveResources | null,
): void {
  resources?.uniformBuffer.destroy();
}
