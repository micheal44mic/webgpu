import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits.ts";
import {
  layerThumbnailDimensions,
} from "./layer-thumbnail-geometry";

export {
  LAYER_THUMBNAIL_SIZE,
  layerThumbnailDimensions,
  type LayerThumbnailDimensions,
} from "./layer-thumbnail-geometry";

export const LAYER_THUMBNAIL_SAMPLE_GRID = 8 as const;
export const LAYER_THUMBNAIL_STRATEGY =
  "lazy-idle-gpu-area-sample-document-aspect-64-readback-cache-v2" as const;

export const {
  width: LAYER_THUMBNAIL_WIDTH,
  height: LAYER_THUMBNAIL_HEIGHT,
} = layerThumbnailDimensions(DOCUMENT_WIDTH, DOCUMENT_HEIGHT);

const LAYER_THUMBNAIL_BYTES_PER_PIXEL = 4;
const LAYER_THUMBNAIL_TIGHT_BYTES_PER_ROW =
  LAYER_THUMBNAIL_WIDTH * LAYER_THUMBNAIL_BYTES_PER_PIXEL;
const LAYER_THUMBNAIL_BYTES_PER_ROW = Math.ceil(
  LAYER_THUMBNAIL_TIGHT_BYTES_PER_ROW / 256,
) * 256;
const LAYER_THUMBNAIL_BYTE_LENGTH =
  LAYER_THUMBNAIL_BYTES_PER_ROW * LAYER_THUMBNAIL_HEIGHT;
const LAYER_THUMBNAIL_TEXTURE_BYTES =
  LAYER_THUMBNAIL_TIGHT_BYTES_PER_ROW * LAYER_THUMBNAIL_HEIGHT;

export interface LayerThumbnailPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

const layerThumbnailShader = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

fn linearToSrgbChannel(value: f32) -> f32 {
  let clamped = clamp(value, 0.0, 1.0);
  return select(
    1.055 * pow(clamped, 1.0 / 2.4) - 0.055,
    clamped * 12.92,
    clamped <= 0.0031308
  );
}

fn linearToSrgb(value: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    linearToSrgbChannel(value.r),
    linearToSrgbChannel(value.g),
    linearToSrgbChannel(value.b)
  );
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
fn fragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let sourceSize = vec2<i32>(textureDimensions(sourceTexture));
  let destinationSize = vec2<i32>(
    ${LAYER_THUMBNAIL_WIDTH},
    ${LAYER_THUMBNAIL_HEIGHT},
  );
  let destination = min(
    vec2<i32>(fragmentPosition.xy),
    destinationSize - vec2<i32>(1)
  );
  let blockOrigin = destination * sourceSize / destinationSize;
  let blockEnd = (destination + vec2<i32>(1)) * sourceSize / destinationSize;
  let blockSize = max(blockEnd - blockOrigin, vec2<i32>(1));

  var accumulated = vec4<f32>(0.0);
  for (var sampleY = 0; sampleY < ${LAYER_THUMBNAIL_SAMPLE_GRID}; sampleY += 1) {
    for (var sampleX = 0; sampleX < ${LAYER_THUMBNAIL_SAMPLE_GRID}; sampleX += 1) {
      let sampleIndex = vec2<i32>(sampleX, sampleY);
      let sampleOffset = (
        (sampleIndex * 2 + vec2<i32>(1)) * blockSize
      ) / ${LAYER_THUMBNAIL_SAMPLE_GRID * 2};
      let sampleCoordinate = min(
        blockOrigin + sampleOffset,
        sourceSize - vec2<i32>(1)
      );
      accumulated += textureLoad(sourceTexture, sampleCoordinate, 0);
    }
  }

  let sampleCount = f32(${LAYER_THUMBNAIL_SAMPLE_GRID ** 2});
  let premultipliedLinear = accumulated / sampleCount;
  let alpha = clamp(premultipliedLinear.a, 0.0, 1.0);
  var straightLinear = vec3<f32>(0.0);
  if (alpha > 0.000001) {
    straightLinear = clamp(premultipliedLinear.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  }
  return vec4<f32>(linearToSrgb(straightLinear), alpha);
}
`;

export class LayerThumbnailRenderer {
  static async create(device: GPUDevice): Promise<LayerThumbnailRenderer> {
    const bindGroupLayout = device.createBindGroupLayout({
      label: "Layer thumbnail source layout",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float", viewDimension: "2d", multisampled: false },
      }],
    });
    const shaderModule = device.createShaderModule({
      label: `Layer thumbnail ${LAYER_THUMBNAIL_WIDTH}x${LAYER_THUMBNAIL_HEIGHT} area sampler WGSL`,
      code: layerThumbnailShader,
    });
    const compilation = await shaderModule.getCompilationInfo();
    const errors = compilation.messages.filter((message) => message.type === "error");
    if (errors.length > 0) {
      throw new Error(
        "Shader miniatura livello non valido:\n"
        + errors.map((message) => (
          `${message.lineNum}:${message.linePos} ${message.message}`
        )).join("\n"),
      );
    }
    const pipeline = await device.createRenderPipelineAsync({
      label: `Layer thumbnail ${LAYER_THUMBNAIL_WIDTH}x${LAYER_THUMBNAIL_HEIGHT} area sampler`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: { module: shaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: shaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: "rgba8unorm" }],
      },
      primitive: { topology: "triangle-list" },
    });
    return new LayerThumbnailRenderer(device, bindGroupLayout, pipeline);
  }

  readonly residentBytes = LAYER_THUMBNAIL_BYTE_LENGTH + LAYER_THUMBNAIL_TEXTURE_BYTES;

  private readonly targetTexture: GPUTexture;
  private readonly targetView: GPUTextureView;
  private readonly readbackBuffer: GPUBuffer;
  private captureInFlight = false;

  private constructor(
    private readonly device: GPUDevice,
    private readonly bindGroupLayout: GPUBindGroupLayout,
    private readonly pipeline: GPURenderPipeline,
  ) {
    this.targetTexture = device.createTexture({
      label: `Layer thumbnail ${LAYER_THUMBNAIL_WIDTH}x${LAYER_THUMBNAIL_HEIGHT} target`,
      size: {
        width: LAYER_THUMBNAIL_WIDTH,
        height: LAYER_THUMBNAIL_HEIGHT,
        depthOrArrayLayers: 1,
      },
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.targetView = this.targetTexture.createView({
      label: `Layer thumbnail ${LAYER_THUMBNAIL_WIDTH}x${LAYER_THUMBNAIL_HEIGHT} target view`,
    });
    this.readbackBuffer = device.createBuffer({
      label: `Layer thumbnail ${LAYER_THUMBNAIL_BYTE_LENGTH} B aligned readback`,
      size: LAYER_THUMBNAIL_BYTE_LENGTH,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  async capture(sourceView: GPUTextureView): Promise<LayerThumbnailPixels> {
    if (this.captureInFlight) {
      throw new Error("Una miniatura di livello è già in acquisizione.");
    }
    this.captureInFlight = true;
    let mapped = false;
    try {
      const bindGroup = this.device.createBindGroup({
        label: "Layer thumbnail current source",
        layout: this.bindGroupLayout,
        entries: [{ binding: 0, resource: sourceView }],
      });
      const encoder = this.device.createCommandEncoder({
        label: "Capture active layer thumbnail",
      });
      const pass = encoder.beginRenderPass({
        label: "Render active layer thumbnail",
        colorAttachments: [{
          view: this.targetView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3, 1, 0, 0);
      pass.end();
      encoder.copyTextureToBuffer(
        { texture: this.targetTexture },
        {
          buffer: this.readbackBuffer,
          bytesPerRow: LAYER_THUMBNAIL_BYTES_PER_ROW,
          rowsPerImage: LAYER_THUMBNAIL_HEIGHT,
        },
        {
          width: LAYER_THUMBNAIL_WIDTH,
          height: LAYER_THUMBNAIL_HEIGHT,
          depthOrArrayLayers: 1,
        },
      );
      this.device.queue.submit([encoder.finish()]);
      await this.readbackBuffer.mapAsync(GPUMapMode.READ);
      mapped = true;
      const mappedBytes = new Uint8Array(this.readbackBuffer.getMappedRange());
      const rgba = new Uint8ClampedArray(LAYER_THUMBNAIL_TEXTURE_BYTES);
      for (let row = 0; row < LAYER_THUMBNAIL_HEIGHT; row += 1) {
        rgba.set(
          mappedBytes.subarray(
            row * LAYER_THUMBNAIL_BYTES_PER_ROW,
            row * LAYER_THUMBNAIL_BYTES_PER_ROW + LAYER_THUMBNAIL_TIGHT_BYTES_PER_ROW,
          ),
          row * LAYER_THUMBNAIL_TIGHT_BYTES_PER_ROW,
        );
      }
      return {
        width: LAYER_THUMBNAIL_WIDTH,
        height: LAYER_THUMBNAIL_HEIGHT,
        rgba,
      };
    } finally {
      if (mapped) {
        this.readbackBuffer.unmap();
      }
      this.captureInFlight = false;
    }
  }

  destroy(): void {
    this.readbackBuffer.destroy();
    this.targetTexture.destroy();
  }
}
