import {
  LAYER_THUMBNAIL_SIZE,
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

const LAYER_THUMBNAIL_BYTES_PER_PIXEL = 4;

export interface LayerThumbnailPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

export type LayerThumbnailSourceColorSpace =
  | "linear-premultiplied"
  | "encoded-srgb-premultiplied";

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

fn averagedPremultipliedSource(
  fragmentPosition: vec4<f32>
) -> vec4<f32> {
  let sourceSize = vec2<i32>(textureDimensions(sourceTexture));
  let longestSourceEdge = max(sourceSize.x, sourceSize.y);
  let destinationSize = max(
    vec2<i32>(1),
    (
      sourceSize * ${LAYER_THUMBNAIL_SIZE * 2}
      + vec2<i32>(longestSourceEdge)
    ) / vec2<i32>(longestSourceEdge * 2),
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

  return accumulated / f32(${LAYER_THUMBNAIL_SAMPLE_GRID ** 2});
}

@fragment
fn linearFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let premultipliedLinear = averagedPremultipliedSource(fragmentPosition);
  let alpha = clamp(premultipliedLinear.a, 0.0, 1.0);
  var straightLinear = vec3<f32>(0.0);
  if (alpha > 0.000001) {
    straightLinear = clamp(premultipliedLinear.rgb / alpha, vec3<f32>(0.0), vec3<f32>(1.0));
  }
  return vec4<f32>(linearToSrgb(straightLinear), alpha);
}

@fragment
fn encodedFragmentMain(
  @builtin(position) fragmentPosition: vec4<f32>
) -> @location(0) vec4<f32> {
  let premultipliedEncoded = averagedPremultipliedSource(fragmentPosition);
  let alpha = clamp(premultipliedEncoded.a, 0.0, 1.0);
  var straightEncoded = vec3<f32>(0.0);
  if (alpha > 0.000001) {
    straightEncoded = clamp(
      premultipliedEncoded.rgb / alpha,
      vec3<f32>(0.0),
      vec3<f32>(1.0),
    );
  }
  return vec4<f32>(straightEncoded, alpha);
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
      label: "Layer thumbnail dimension-neutral area sampler WGSL",
      code: layerThumbnailShader,
    });
    const compilation = await shaderModule.getCompilationInfo();
    const errors = compilation.messages.filter((message) => message.type === "error");
    if (errors.length > 0) {
      throw new Error(
        "Invalid layer-thumbnail shader:\n"
        + errors.map((message) => (
          `${message.lineNum}:${message.linePos} ${message.message}`
        )).join("\n"),
      );
    }
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    const createPipeline = (
      entryPoint: "linearFragmentMain" | "encodedFragmentMain",
      label: string,
    ) => device.createRenderPipelineAsync({
      label,
      layout,
      vertex: { module: shaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: shaderModule,
        entryPoint,
        targets: [{ format: "rgba8unorm" }],
      },
      primitive: { topology: "triangle-list" },
    });
    const [linearPipeline, encodedPipeline] = await Promise.all([
      createPipeline(
        "linearFragmentMain",
        "Layer thumbnail linear source area sampler",
      ),
      createPipeline(
        "encodedFragmentMain",
        "Layer thumbnail encoded-sRGB source area sampler",
      ),
    ]);
    return new LayerThumbnailRenderer(
      device,
      bindGroupLayout,
      linearPipeline,
      encodedPipeline,
    );
  }

  private targetTexture: GPUTexture | null = null;
  private targetView: GPUTextureView | null = null;
  private readbackBuffer: GPUBuffer | null = null;
  private width = 0;
  private height = 0;
  private tightBytesPerRow = 0;
  private bytesPerRow = 0;
  private byteLength = 0;
  private textureBytes = 0;
  private captureInFlight = false;

  get residentBytes(): number {
    return this.byteLength + this.textureBytes;
  }

  private constructor(
    private readonly device: GPUDevice,
    private readonly bindGroupLayout: GPUBindGroupLayout,
    private readonly linearPipeline: GPURenderPipeline,
    private readonly encodedPipeline: GPURenderPipeline,
  ) {}

  private reconfigureDocument(documentWidth: number, documentHeight: number): void {
    const { width, height } = layerThumbnailDimensions(documentWidth, documentHeight);
    if (this.targetTexture && width === this.width && height === this.height) return;
    if (this.captureInFlight) {
      throw new Error("A layer thumbnail capture must finish before changing its document.");
    }
    const tightBytesPerRow = width * LAYER_THUMBNAIL_BYTES_PER_PIXEL;
    const bytesPerRow = Math.ceil(tightBytesPerRow / 256) * 256;
    const byteLength = bytesPerRow * height;
    const textureBytes = tightBytesPerRow * height;
    const targetTexture = this.device.createTexture({
      label: `Layer thumbnail ${width}x${height} target`,
      size: {
        width,
        height,
        depthOrArrayLayers: 1,
      },
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const targetView = targetTexture.createView({
      label: `Layer thumbnail ${width}x${height} target view`,
    });
    let readbackBuffer: GPUBuffer;
    try {
      readbackBuffer = this.device.createBuffer({
        label: `Layer thumbnail ${byteLength} B aligned readback`,
        size: byteLength,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    } catch (error) {
      targetTexture.destroy();
      throw error;
    }
    const previousTexture = this.targetTexture;
    const previousReadback = this.readbackBuffer;
    this.targetTexture = targetTexture;
    this.targetView = targetView;
    this.readbackBuffer = readbackBuffer;
    this.width = width;
    this.height = height;
    this.tightBytesPerRow = tightBytesPerRow;
    this.bytesPerRow = bytesPerRow;
    this.byteLength = byteLength;
    this.textureBytes = textureBytes;
    previousReadback?.destroy();
    previousTexture?.destroy();
  }

  async capture(
    sourceView: GPUTextureView,
    documentWidth: number,
    documentHeight: number,
    sourceColorSpace: LayerThumbnailSourceColorSpace = "linear-premultiplied",
  ): Promise<LayerThumbnailPixels> {
    if (this.captureInFlight) {
      throw new Error("A layer thumbnail is already being captured.");
    }
    this.reconfigureDocument(documentWidth, documentHeight);
    const targetTexture = this.targetTexture!;
    const targetView = this.targetView!;
    const readbackBuffer = this.readbackBuffer!;
    const width = this.width;
    const height = this.height;
    const tightBytesPerRow = this.tightBytesPerRow;
    const bytesPerRow = this.bytesPerRow;
    const textureBytes = this.textureBytes;
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
          view: targetView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setPipeline(
        sourceColorSpace === "encoded-srgb-premultiplied"
          ? this.encodedPipeline
          : this.linearPipeline,
      );
      pass.setBindGroup(0, bindGroup);
      pass.draw(3, 1, 0, 0);
      pass.end();
      encoder.copyTextureToBuffer(
        { texture: targetTexture },
        {
          buffer: readbackBuffer,
          bytesPerRow,
          rowsPerImage: height,
        },
        {
          width,
          height,
          depthOrArrayLayers: 1,
        },
      );
      this.device.queue.submit([encoder.finish()]);
      await readbackBuffer.mapAsync(GPUMapMode.READ);
      mapped = true;
      const mappedBytes = new Uint8Array(readbackBuffer.getMappedRange());
      const rgba = new Uint8ClampedArray(textureBytes);
      for (let row = 0; row < height; row += 1) {
        rgba.set(
          mappedBytes.subarray(
            row * bytesPerRow,
            row * bytesPerRow + tightBytesPerRow,
          ),
          row * tightBytesPerRow,
        );
      }
      return {
        width,
        height,
        rgba,
      };
    } finally {
      if (mapped) {
        readbackBuffer.unmap();
      }
      this.captureInFlight = false;
    }
  }

  destroy(): void {
    this.readbackBuffer?.destroy();
    this.targetTexture?.destroy();
    this.readbackBuffer = null;
    this.targetTexture = null;
    this.targetView = null;
    this.byteLength = 0;
    this.textureBytes = 0;
  }
}
