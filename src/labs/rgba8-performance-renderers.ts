import {
  STAMP_STRIDE_BYTES,
  TARGET_SIZE,
  createRgba8Masks,
  type GpuCase,
  type RendererKind,
  type SamplingProfile,
} from "./rgba8-performance-core";

const MAX_INSTANCE_BYTES = 65_536 * STAMP_STRIDE_BYTES;
const MASK_SIZE = 256;
const GPU_COMPLETION_TIMEOUT_MS = 15_000;

export interface FrameSubmission {
  readonly uploadCpuMs: number;
  readonly encodeCpuMs: number;
  readonly submitCpuMs: number;
  readonly submittedAt: number;
  readonly completion: Promise<number>;
  readonly timerSlot: number | null;
}

export interface BenchmarkRenderer {
  readonly kind: RendererKind;
  readonly timerSource: "timestamp-query" | "disjoint-timer-query" | "completion-proxy";
  readonly timerReadStatus: "not-read" | "sampled" | "unsupported" | "disjoint" | "unavailable";
  readonly featureNames: readonly string[];
  prepare(spec: GpuCase, bytes: Uint8Array): void;
  beginTiming(frameCapacity: number, sampleStride?: number): void;
  render(spec: GpuCase, bytes: Uint8Array): FrameSubmission;
  finishTiming(): Promise<readonly (number | null)[]>;
  resetTarget(): Promise<void>;
  waitForIdle(): Promise<number>;
  readPixels(): Promise<Uint8Array>;
  readUploadBytes(byteLength: number): Promise<Uint8Array>;
  dispose(): void;
}

function profileIndex(profile: SamplingProfile): number {
  switch (profile) {
    case "simple": return 0;
    case "shape": return 1;
    case "grain": return 2;
    case "shape-grain": return 3;
  }
}

const WGSL = /* wgsl */ `
struct VertexInput {
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) geometry: vec4f,
  @location(1) ids: vec2u,
  @location(2) direction: vec2f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) pressure: f32,
  @location(2) documentUv: vec2f,
  @location(3) directionBias: f32,
};

struct ProfileUniform {
  value: u32,
};

@group(0) @binding(0) var maskSampler: sampler;
@group(0) @binding(1) var shapeTexture: texture_2d<f32>;
@group(0) @binding(2) var grainTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> profile: ProfileUniform;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let corners = array<vec2f, 4>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0,  1.0)
  );
  let corner = corners[input.vertexIndex];
  let pixel = input.geometry.xy + corner * input.geometry.z;
  let directionCode = select(0u, 1u, input.direction.x < 0.0)
    + select(0u, 2u, input.direction.y < 0.0);
  let seedPhase = f32((input.ids.x + input.ids.y * 257u) % 1024u) / 1024.0;
  var output: VertexOutput;
  output.position = vec4f(
    pixel.x / ${TARGET_SIZE}.0 * 2.0 - 1.0,
    1.0 - pixel.y / ${TARGET_SIZE}.0 * 2.0,
    0.0,
    1.0
  );
  output.local = corner * 0.5 + vec2f(0.5);
  output.pressure = input.geometry.w;
  output.documentUv = pixel / ${TARGET_SIZE}.0 + vec2f(seedPhase, seedPhase * 0.5);
  output.directionBias = f32(directionCode) / 16777216.0;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let centered = input.local * 2.0 - vec2f(1.0);
  let analytic = clamp(1.0 - length(centered), 0.0, 1.0);
  var coverage = analytic;
  if (profile.value == 1u) {
    coverage = textureSample(shapeTexture, maskSampler, input.local).r;
  } else if (profile.value == 2u) {
    coverage = analytic * textureSample(grainTexture, maskSampler, input.documentUv * 8.0).r;
  } else if (profile.value == 3u) {
    coverage = textureSample(shapeTexture, maskSampler, input.local).r
      * textureSample(grainTexture, maskSampler, input.documentUv * 8.0).r;
  }
  let alpha = clamp(coverage * input.pressure + input.directionBias, 0.0, 1.0);
  let color = vec3f(1.0, 0.357, 0.208);
  return vec4f(color * alpha, alpha);
}
`;

class WebGpuBenchmarkRenderer implements BenchmarkRenderer {
  readonly kind = "webgpu" as const;
  readonly device: GPUDevice;
  readonly queue: GPUQueue;
  readonly pipeline: GPURenderPipeline;
  readonly instanceBuffer: GPUBuffer;
  readonly uniformBuffer: GPUBuffer;
  readonly targetTexture: GPUTexture;
  readonly targetView: GPUTextureView;
  readonly presentationTexture: GPUTexture;
  readonly bindGroup: GPUBindGroup;
  readonly timerSource: "timestamp-query" | "completion-proxy";
  readonly featureNames: readonly string[];
  timerReadStatus: "not-read" | "sampled" | "unsupported" | "disjoint" | "unavailable" = "not-read";
  #querySet: GPUQuerySet | null = null;
  #queryResolveBuffer: GPUBuffer | null = null;
  #queryReadBuffer: GPUBuffer | null = null;
  #queryCapacity = 0;
  #queryFrames = 0;
  #timedFrames = 0;
  #querySampleStride = 1;
  #readTexture: GPUTexture;

  private constructor(
    device: GPUDevice,
    pipeline: GPURenderPipeline,
    instanceBuffer: GPUBuffer,
    uniformBuffer: GPUBuffer,
    targetTexture: GPUTexture,
    presentationTexture: GPUTexture,
    bindGroup: GPUBindGroup,
  ) {
    this.device = device;
    this.queue = device.queue;
    this.pipeline = pipeline;
    this.instanceBuffer = instanceBuffer;
    this.uniformBuffer = uniformBuffer;
    this.targetTexture = targetTexture;
    this.targetView = targetTexture.createView();
    this.presentationTexture = presentationTexture;
    this.#readTexture = targetTexture;
    this.bindGroup = bindGroup;
    this.timerSource = device.features.has("timestamp-query")
      ? "timestamp-query"
      : "completion-proxy";
    this.featureNames = [...device.features].sort();
  }

  static async create(): Promise<WebGpuBenchmarkRenderer> {
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
    if (!gpu) throw new Error("WebGPU non disponibile.");
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("Adapter WebGPU non disponibile.");
    const requiredFeatures: GPUFeatureName[] = adapter.features.has("timestamp-query")
      ? ["timestamp-query"]
      : [];
    const device = await adapter.requestDevice({ requiredFeatures });
    const module = device.createShaderModule({ label: "rgba8-lab-shader", code: WGSL });
    const pipeline = await device.createRenderPipelineAsync({
      label: "rgba8-lab-pipeline",
      layout: "auto",
      vertex: {
        module,
        entryPoint: "vertexMain",
        buffers: [{
          arrayStride: STAMP_STRIDE_BYTES,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 16, format: "uint32x2" },
            { shaderLocation: 2, offset: 24, format: "float32x2" },
          ],
        }],
      },
      fragment: {
        module,
        entryPoint: "fragmentMain",
        targets: [{
          format: "rgba8unorm",
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-strip" },
    });
    const instanceBuffer = device.createBuffer({
      label: "rgba8-lab-instances",
      size: MAX_INSTANCE_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const uniformBuffer = device.createBuffer({
      label: "rgba8-lab-profile",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const targetTexture = device.createTexture({
      label: "rgba8-lab-target",
      size: [TARGET_SIZE, TARGET_SIZE],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    });
    const presentationTexture = device.createTexture({
      label: "rgba8-lab-output-copy",
      size: [TARGET_SIZE, TARGET_SIZE],
      format: "rgba8unorm",
      usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    });
    const masks = createRgba8Masks(MASK_SIZE);
    const makeMask = (label: string, bytes: Uint8Array): GPUTexture => {
      const texture = device.createTexture({
        label,
        size: [MASK_SIZE, MASK_SIZE],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture(
        { texture },
        bytes,
        { bytesPerRow: MASK_SIZE * 4, rowsPerImage: MASK_SIZE },
        [MASK_SIZE, MASK_SIZE],
      );
      return texture;
    };
    const shapeTexture = makeMask("rgba8-lab-shape", masks.shape);
    const grainTexture = makeMask("rgba8-lab-grain", masks.grain);
    const sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: shapeTexture.createView() },
        { binding: 2, resource: grainTexture.createView() },
        { binding: 3, resource: { buffer: uniformBuffer } },
      ],
    });
    return new WebGpuBenchmarkRenderer(
      device,
      pipeline,
      instanceBuffer,
      uniformBuffer,
      targetTexture,
      presentationTexture,
      bindGroup,
    );
  }

  prepare(spec: GpuCase, bytes: Uint8Array): void {
    this.queue.writeBuffer(this.uniformBuffer, 0, new Uint32Array([profileIndex(spec.sampling)]));
    if (!spec.uploadEachFrame && bytes.byteLength > 0) {
      this.queue.writeBuffer(this.instanceBuffer, 0, bytes);
    }
  }

  #encodeCopies(encoder: GPUCommandEncoder, copyCount: number): void {
    let source = this.targetTexture;
    let destination = this.presentationTexture;
    for (let copyIndex = 0; copyIndex < copyCount; copyIndex += 1) {
      encoder.copyTextureToTexture(
        { texture: source },
        { texture: destination },
        [TARGET_SIZE, TARGET_SIZE],
      );
      [source, destination] = [destination, source];
    }
    this.#readTexture = source;
  }

  beginTiming(frameCapacity: number, sampleStride = 1): void {
    this.#destroyTiming();
    this.#queryFrames = 0;
    this.#timedFrames = 0;
    this.#querySampleStride = Math.max(1, Math.floor(sampleStride));
    this.timerReadStatus = this.timerSource === "timestamp-query" ? "unavailable" : "unsupported";
    if (this.timerSource !== "timestamp-query") return;
    this.#queryCapacity = Math.max(1, Math.min(frameCapacity, 4096));
    const byteLength = this.#queryCapacity * 2 * 8;
    this.#querySet = this.device.createQuerySet({ type: "timestamp", count: this.#queryCapacity * 2 });
    this.#queryResolveBuffer = this.device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.#queryReadBuffer = this.device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  render(spec: GpuCase, bytes: Uint8Array): FrameSubmission {
    const uploadStartedAt = performance.now();
    if (spec.uploadEachFrame && bytes.byteLength > 0) {
      this.queue.writeBuffer(this.instanceBuffer, 0, bytes);
    }
    const uploadCpuMs = performance.now() - uploadStartedAt;
    if (spec.uploadOnly) {
      const submitStartedAt = performance.now();
      this.queue.submit([]);
      const completion = this.waitForIdle();
      const submitCpuMs = performance.now() - submitStartedAt;
      const submittedAt = performance.now();
      return {
        uploadCpuMs,
        encodeCpuMs: 0,
        submitCpuMs,
        submittedAt,
        completion,
        timerSlot: null,
      };
    }

    const timedFrame = this.#timedFrames++;
    const timerSlot = this.#querySet
      && spec.copies === 0
      && timedFrame % this.#querySampleStride === 0
      && this.#queryFrames < this.#queryCapacity
        ? this.#queryFrames++
        : null;
    const queryBase = timerSlot === null ? null : timerSlot * 2;
    this.#readTexture = this.targetTexture;
    let encodeCpuMs = 0;
    let submitCpuMs = 0;
    const submitEveryPass = spec.submits === spec.passes && spec.passes > 1;
    let sharedEncoder: GPUCommandEncoder | null = null;
    const sharedStartedAt = performance.now();
    if (!submitEveryPass) sharedEncoder = this.device.createCommandEncoder();
    for (let passIndex = 0; passIndex < spec.passes; passIndex += 1) {
      const encoderStartedAt = performance.now();
      const encoder = sharedEncoder ?? this.device.createCommandEncoder();
      const first = passIndex === 0;
      const last = passIndex === spec.passes - 1;
      const timestampWrites = queryBase !== null && (first || last)
        ? {
            querySet: this.#querySet!,
            ...(first ? { beginningOfPassWriteIndex: queryBase } : {}),
            ...(last ? { endOfPassWriteIndex: queryBase + 1 } : {}),
          }
        : undefined;
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.targetView,
          loadOp: first && spec.clearBeforeDraw !== false ? "clear" : "load",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
        ...(timestampWrites ? { timestampWrites } : {}),
      });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.setVertexBuffer(0, this.instanceBuffer);
      const firstInstance = Math.floor(spec.instanceCount * passIndex / spec.passes);
      const lastInstance = Math.floor(spec.instanceCount * (passIndex + 1) / spec.passes);
      pass.draw(4, lastInstance - firstInstance, 0, firstInstance);
      pass.end();
      if (submitEveryPass) {
        if (last && spec.copies > 0) {
          this.#encodeCopies(encoder, spec.copies);
        }
        const commandBuffer = encoder.finish();
        encodeCpuMs += performance.now() - encoderStartedAt;
        const submitStartedAt = performance.now();
        this.queue.submit([commandBuffer]);
        submitCpuMs += performance.now() - submitStartedAt;
      }
    }
    if (sharedEncoder) {
      if (spec.copies > 0) {
        this.#encodeCopies(sharedEncoder, spec.copies);
      }
      const commandBuffer = sharedEncoder.finish();
      encodeCpuMs += performance.now() - sharedStartedAt;
      const submitStartedAt = performance.now();
      this.queue.submit([commandBuffer]);
      submitCpuMs += performance.now() - submitStartedAt;
    }
    const completionStartedAt = performance.now();
    const completion = this.waitForIdle();
    submitCpuMs += performance.now() - completionStartedAt;
    const submittedAt = performance.now();
    return {
      uploadCpuMs,
      encodeCpuMs,
      submitCpuMs,
      submittedAt,
      completion,
      timerSlot,
    };
  }

  async finishTiming(): Promise<readonly (number | null)[]> {
    if (
      !this.#querySet
      || !this.#queryResolveBuffer
      || !this.#queryReadBuffer
      || this.#queryFrames === 0
    ) return [];
    await this.waitForIdle();
    const byteLength = this.#queryFrames * 2 * 8;
    const encoder = this.device.createCommandEncoder();
    encoder.resolveQuerySet(this.#querySet, 0, this.#queryFrames * 2, this.#queryResolveBuffer, 0);
    encoder.copyBufferToBuffer(this.#queryResolveBuffer, 0, this.#queryReadBuffer, 0, byteLength);
    this.queue.submit([encoder.finish()]);
    await this.#queryReadBuffer.mapAsync(GPUMapMode.READ, 0, byteLength);
    const values = new BigUint64Array(this.#queryReadBuffer.getMappedRange(0, byteLength));
    const durations = Array.from({ length: this.#queryFrames }, (_, index) => {
      const start = values[index * 2];
      const end = values[index * 2 + 1];
      return end >= start ? Number(end - start) / 1_000_000 : null;
    });
    this.timerReadStatus = durations.some((duration) => duration !== null)
      ? "sampled"
      : "unavailable";
    this.#queryReadBuffer.unmap();
    return durations;
  }

  async waitForIdle(): Promise<number> {
    let timeoutId = 0;
    try {
      return await Promise.race([
        this.queue.onSubmittedWorkDone().then(() => performance.now()),
        new Promise<number>((_resolve, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error("Timeout di completamento WebGPU."));
          }, GPU_COMPLETION_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async resetTarget(): Promise<void> {
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.targetView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.end();
    this.queue.submit([encoder.finish()]);
    await this.waitForIdle();
    this.#readTexture = this.targetTexture;
  }

  async readPixels(): Promise<Uint8Array> {
    const bytesPerRow = TARGET_SIZE * 4;
    const size = bytesPerRow * TARGET_SIZE;
    const buffer = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: this.#readTexture },
      { buffer, bytesPerRow, rowsPerImage: TARGET_SIZE },
      [TARGET_SIZE, TARGET_SIZE],
    );
    this.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const pixels = new Uint8Array(buffer.getMappedRange()).slice();
    buffer.unmap();
    buffer.destroy();
    return pixels;
  }

  async readUploadBytes(byteLength: number): Promise<Uint8Array> {
    const buffer = this.device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.instanceBuffer, 0, buffer, 0, byteLength);
    this.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const bytes = new Uint8Array(buffer.getMappedRange()).slice();
    buffer.unmap();
    buffer.destroy();
    return bytes;
  }

  #destroyTiming(): void {
    this.#querySet?.destroy();
    this.#queryResolveBuffer?.destroy();
    this.#queryReadBuffer?.destroy();
    this.#querySet = null;
    this.#queryResolveBuffer = null;
    this.#queryReadBuffer = null;
    this.#queryCapacity = 0;
  }

  dispose(): void {
    this.#destroyTiming();
    this.instanceBuffer.destroy();
    this.uniformBuffer.destroy();
    this.targetTexture.destroy();
    this.presentationTexture.destroy();
    this.device.destroy();
  }
}

interface DisjointTimerExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

const GLSL_VERTEX = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 geometry;
layout(location = 2) in uvec2 ids;
layout(location = 3) in vec2 direction;
out vec2 localUv;
out float pressureValue;
out vec2 documentUv;
out float directionBias;
void main() {
  vec2 pixel = geometry.xy + corner * geometry.z;
  uint directionCode = (direction.x < 0.0 ? 1u : 0u)
    + (direction.y < 0.0 ? 2u : 0u);
  float seedPhase = float((ids.x + ids.y * 257u) % 1024u) / 1024.0;
  gl_Position = vec4(
    pixel.x / ${TARGET_SIZE}.0 * 2.0 - 1.0,
    1.0 - pixel.y / ${TARGET_SIZE}.0 * 2.0,
    0.0,
    1.0
  );
  localUv = corner * 0.5 + vec2(0.5);
  pressureValue = geometry.w;
  documentUv = pixel / ${TARGET_SIZE}.0 + vec2(seedPhase, seedPhase * 0.5);
  directionBias = float(directionCode) / 16777216.0;
}
`;

const GLSL_FRAGMENT = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 localUv;
in float pressureValue;
in vec2 documentUv;
in float directionBias;
uniform sampler2D shapeTexture;
uniform sampler2D grainTexture;
uniform int profile;
out vec4 outputColor;
void main() {
  vec2 centered = localUv * 2.0 - vec2(1.0);
  float analytic = clamp(1.0 - length(centered), 0.0, 1.0);
  float coverage = analytic;
  if (profile == 1) {
    coverage = texture(shapeTexture, localUv).r;
  } else if (profile == 2) {
    coverage = analytic * texture(grainTexture, documentUv * 8.0).r;
  } else if (profile == 3) {
    coverage = texture(shapeTexture, localUv).r
      * texture(grainTexture, documentUv * 8.0).r;
  }
  float alpha = clamp(coverage * pressureValue + directionBias, 0.0, 1.0);
  vec3 color = vec3(1.0, 0.357, 0.208);
  outputColor = vec4(color * alpha, alpha);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Creazione shader WebGL2 non riuscita.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "errore sconosciuto";
    gl.deleteShader(shader);
    throw new Error(`Compilazione shader WebGL2 non riuscita: ${log}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, GLSL_VERTEX);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, GLSL_FRAGMENT);
  const program = gl.createProgram();
  if (!program) throw new Error("Creazione programma WebGL2 non riuscita.");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "errore sconosciuto";
    gl.deleteProgram(program);
    throw new Error(`Link programma WebGL2 non riuscito: ${log}`);
  }
  return program;
}

class WebGlBenchmarkRenderer implements BenchmarkRenderer {
  readonly kind = "webgl2" as const;
  readonly gl: WebGL2RenderingContext;
  readonly program: WebGLProgram;
  readonly instanceBuffer: WebGLBuffer;
  readonly targetTexture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  readonly presentationTexture: WebGLTexture;
  readonly presentationFramebuffer: WebGLFramebuffer;
  readonly passBoundaryFramebuffer: WebGLFramebuffer;
  readonly vao: WebGLVertexArrayObject;
  readonly timerExtension: DisjointTimerExtension | null;
  readonly timerSource: "disjoint-timer-query" | "completion-proxy";
  readonly featureNames: readonly string[];
  timerReadStatus: "not-read" | "sampled" | "unsupported" | "disjoint" | "unavailable" = "not-read";
  #queries: WebGLQuery[] = [];
  #profileLocation: WebGLUniformLocation;
  #queryCapacity = 0;
  #querySampleStride = 1;
  #timedFrames = 0;
  #readFramebuffer: WebGLFramebuffer;

  private constructor(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    instanceBuffer: WebGLBuffer,
    targetTexture: WebGLTexture,
    framebuffer: WebGLFramebuffer,
    presentationTexture: WebGLTexture,
    presentationFramebuffer: WebGLFramebuffer,
    passBoundaryFramebuffer: WebGLFramebuffer,
    vao: WebGLVertexArrayObject,
    timerExtension: DisjointTimerExtension | null,
  ) {
    this.gl = gl;
    this.program = program;
    this.instanceBuffer = instanceBuffer;
    this.targetTexture = targetTexture;
    this.framebuffer = framebuffer;
    this.presentationTexture = presentationTexture;
    this.presentationFramebuffer = presentationFramebuffer;
    this.passBoundaryFramebuffer = passBoundaryFramebuffer;
    this.#readFramebuffer = framebuffer;
    this.vao = vao;
    this.timerExtension = timerExtension;
    this.timerSource = timerExtension ? "disjoint-timer-query" : "completion-proxy";
    this.featureNames = gl.getSupportedExtensions()?.sort() ?? [];
    const profileLocation = gl.getUniformLocation(program, "profile");
    if (!profileLocation) throw new Error("Uniform profile WebGL2 assente.");
    this.#profileLocation = profileLocation;
  }

  static async create(): Promise<WebGlBenchmarkRenderer> {
    const canvas = document.createElement("canvas");
    canvas.width = TARGET_SIZE;
    canvas.height = TARGET_SIZE;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 non disponibile.");
    const program = createProgram(gl);
    const vao = gl.createVertexArray();
    const quadBuffer = gl.createBuffer();
    const instanceBuffer = gl.createBuffer();
    const targetTexture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    const presentationTexture = gl.createTexture();
    const presentationFramebuffer = gl.createFramebuffer();
    const passBoundaryFramebuffer = gl.createFramebuffer();
    if (
      !vao
      || !quadBuffer
      || !instanceBuffer
      || !targetTexture
      || !framebuffer
      || !presentationTexture
      || !presentationFramebuffer
      || !passBoundaryFramebuffer
    ) {
      throw new Error("Allocazione risorse WebGL2 non riuscita.");
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCE_BYTES, gl.DYNAMIC_DRAW);
    for (const location of [1, 3]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.enableVertexAttribArray(2);
    gl.vertexAttribDivisor(2, 1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STAMP_STRIDE_BYTES, 0);
    gl.vertexAttribIPointer(2, 2, gl.UNSIGNED_INT, STAMP_STRIDE_BYTES, 16);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, STAMP_STRIDE_BYTES, 24);

    gl.bindTexture(gl.TEXTURE_2D, targetTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, TARGET_SIZE, TARGET_SIZE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, targetTexture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Framebuffer RGBA8 WebGL2 incompleto.");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, passBoundaryFramebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      targetTexture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Framebuffer di separazione pass WebGL2 incompleto.");
    }
    gl.bindTexture(gl.TEXTURE_2D, presentationTexture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, TARGET_SIZE, TARGET_SIZE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, presentationFramebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      presentationTexture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Framebuffer copia RGBA8 WebGL2 incompleto.");
    }
    const masks = createRgba8Masks(MASK_SIZE);
    const makeMask = (unit: number, bytes: Uint8Array): WebGLTexture => {
      const texture = gl.createTexture();
      if (!texture) throw new Error("Texture maschera WebGL2 non disponibile.");
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, MASK_SIZE, MASK_SIZE);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        MASK_SIZE,
        MASK_SIZE,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bytes,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      return texture;
    };
    makeMask(0, masks.shape);
    makeMask(1, masks.grain);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "shapeTexture"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "grainTexture"), 1);
    gl.viewport(0, 0, TARGET_SIZE, TARGET_SIZE);
    gl.disable(gl.DITHER);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(null);
    const timerExtension = gl.getExtension(
      "EXT_disjoint_timer_query_webgl2",
    ) as DisjointTimerExtension | null;
    return new WebGlBenchmarkRenderer(
      gl,
      program,
      instanceBuffer,
      targetTexture,
      framebuffer,
      presentationTexture,
      presentationFramebuffer,
      passBoundaryFramebuffer,
      vao,
      timerExtension,
    );
  }

  #bindInstanceOffset(firstInstance: number): void {
    const gl = this.gl;
    const offset = firstInstance * STAMP_STRIDE_BYTES;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STAMP_STRIDE_BYTES, offset);
    gl.vertexAttribIPointer(2, 2, gl.UNSIGNED_INT, STAMP_STRIDE_BYTES, offset + 16);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, STAMP_STRIDE_BYTES, offset + 24);
  }

  prepare(spec: GpuCase, bytes: Uint8Array): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniform1i(this.#profileLocation, profileIndex(spec.sampling));
    if (!spec.uploadEachFrame && bytes.byteLength > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, bytes);
    }
  }

  beginTiming(frameCapacity: number, sampleStride = 1): void {
    for (const query of this.#queries) this.gl.deleteQuery(query);
    this.#queries = [];
    this.#queryCapacity = Math.max(0, Math.min(frameCapacity, 4096));
    this.#querySampleStride = Math.max(1, Math.floor(sampleStride));
    this.#timedFrames = 0;
    this.timerReadStatus = this.timerExtension ? "unavailable" : "unsupported";
  }

  #copyOutput(copyCount: number): void {
    const gl = this.gl;
    let source = this.framebuffer;
    let destination = this.presentationFramebuffer;
    for (let copyIndex = 0; copyIndex < copyCount; copyIndex += 1) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination);
      gl.blitFramebuffer(
        0,
        0,
        TARGET_SIZE,
        TARGET_SIZE,
        0,
        0,
        TARGET_SIZE,
        TARGET_SIZE,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST,
      );
      [source, destination] = [destination, source];
    }
    this.#readFramebuffer = source;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
  }

  #completion(flush: boolean): Promise<number> {
    const gl = this.gl;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (flush) gl.flush();
    if (!sync) return Promise.reject(new Error("Fence WebGL2 non disponibile."));
    const deadline = performance.now() + GPU_COMPLETION_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const poll = (): void => {
        if (gl.isContextLost()) {
          gl.deleteSync(sync);
          reject(new Error("Contesto WebGL2 perso durante il completamento."));
          return;
        }
        if (performance.now() >= deadline) {
          gl.deleteSync(sync);
          reject(new Error("Timeout di completamento WebGL2."));
          return;
        }
        const status = gl.clientWaitSync(sync, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
          gl.deleteSync(sync);
          resolve(performance.now());
        } else if (status === gl.WAIT_FAILED) {
          gl.deleteSync(sync);
          reject(new Error("Fence WebGL2 non riuscita."));
        } else {
          setTimeout(poll, 0);
        }
      };
      poll();
    });
  }

  render(spec: GpuCase, bytes: Uint8Array): FrameSubmission {
    const gl = this.gl;
    const uploadStartedAt = performance.now();
    if (spec.uploadEachFrame && bytes.byteLength > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, bytes);
    }
    const uploadCpuMs = performance.now() - uploadStartedAt;
    const timedFrame = this.#timedFrames++;
    const sampleTimer = !spec.uploadOnly
      && spec.copies === 0
      && timedFrame % this.#querySampleStride === 0
      && this.#queries.length < this.#queryCapacity;
    const query = sampleTimer && this.timerExtension ? gl.createQuery() : null;
    if (query && this.timerExtension) {
      this.#queries.push(query);
      gl.beginQuery(this.timerExtension.TIME_ELAPSED_EXT, query);
    }
    const encodeStartedAt = performance.now();
    let submitCpuMs = 0;
    if (!spec.uploadOnly) {
      this.#readFramebuffer = this.framebuffer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.bindVertexArray(this.vao);
      gl.useProgram(this.program);
      if (spec.clearBeforeDraw !== false) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      for (let passIndex = 0; passIndex < spec.passes; passIndex += 1) {
        if (passIndex > 0) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.passBoundaryFramebuffer);
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        }
        const firstInstance = Math.floor(spec.instanceCount * passIndex / spec.passes);
        const lastInstance = Math.floor(spec.instanceCount * (passIndex + 1) / spec.passes);
        this.#bindInstanceOffset(firstInstance);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lastInstance - firstInstance);
        if (spec.submits === spec.passes && passIndex < spec.passes - 1) {
          const boundaryStartedAt = performance.now();
          gl.flush();
          submitCpuMs += performance.now() - boundaryStartedAt;
        }
      }
      this.#bindInstanceOffset(0);
      gl.bindVertexArray(null);
    }
    if (!spec.uploadOnly && spec.copies > 0) this.#copyOutput(spec.copies);
    if (query && this.timerExtension) gl.endQuery(this.timerExtension.TIME_ELAPSED_EXT);
    const encodeCpuMs = Math.max(0, performance.now() - encodeStartedAt - submitCpuMs);
    const submitStartedAt = performance.now();
    const completion = this.#completion(true);
    submitCpuMs += performance.now() - submitStartedAt;
    const submittedAt = performance.now();
    return {
      uploadCpuMs,
      encodeCpuMs,
      submitCpuMs,
      submittedAt,
      completion,
      timerSlot: query ? this.#queries.length - 1 : null,
    };
  }

  async finishTiming(): Promise<readonly (number | null)[]> {
    if (!this.timerExtension || this.#queries.length === 0) return [];
    await this.waitForIdle();
    let disjoint = Boolean(this.gl.getParameter(this.timerExtension.GPU_DISJOINT_EXT));
    const deadline = performance.now() + GPU_COMPLETION_TIMEOUT_MS;
    while (
      !disjoint
      && this.#queries.some((query) => !this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE))
    ) {
      if (this.gl.isContextLost() || performance.now() >= deadline) {
        for (const query of this.#queries) this.gl.deleteQuery(query);
        this.#queries = [];
        throw new Error(this.gl.isContextLost()
          ? "Contesto WebGL2 perso durante la lettura timer."
          : "Timeout lettura timer WebGL2.");
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      disjoint = Boolean(this.gl.getParameter(this.timerExtension.GPU_DISJOINT_EXT));
    }
    const durations = this.#queries.map((query) => disjoint
      ? null
      : Number(this.gl.getQueryParameter(query, this.gl.QUERY_RESULT)) / 1_000_000);
    this.timerReadStatus = disjoint
      ? "disjoint"
      : durations.some((duration) => duration !== null) ? "sampled" : "unavailable";
    for (const query of this.#queries) this.gl.deleteQuery(query);
    this.#queries = [];
    return durations;
  }

  waitForIdle(): Promise<number> {
    return this.#completion(true);
  }

  async resetTarget(): Promise<void> {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    await this.waitForIdle();
    this.#readFramebuffer = this.framebuffer;
  }

  async readPixels(): Promise<Uint8Array> {
    const gl = this.gl;
    await this.waitForIdle();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#readFramebuffer);
    const pixels = new Uint8Array(TARGET_SIZE * TARGET_SIZE * 4);
    gl.readPixels(0, 0, TARGET_SIZE, TARGET_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const rowBytes = TARGET_SIZE * 4;
    const temporaryRow = new Uint8Array(rowBytes);
    for (let y = 0; y < Math.floor(TARGET_SIZE / 2); y += 1) {
      const topOffset = y * rowBytes;
      const bottomOffset = (TARGET_SIZE - 1 - y) * rowBytes;
      temporaryRow.set(pixels.subarray(topOffset, topOffset + rowBytes));
      pixels.copyWithin(topOffset, bottomOffset, bottomOffset + rowBytes);
      pixels.set(temporaryRow, bottomOffset);
    }
    return pixels;
  }

  async readUploadBytes(byteLength: number): Promise<Uint8Array> {
    const gl = this.gl;
    await this.waitForIdle();
    const bytes = new Uint8Array(byteLength);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, bytes);
    return bytes;
  }

  dispose(): void {
    for (const query of this.#queries) this.gl.deleteQuery(query);
    this.gl.deleteBuffer(this.instanceBuffer);
    this.gl.deleteTexture(this.targetTexture);
    this.gl.deleteTexture(this.presentationTexture);
    this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.deleteFramebuffer(this.presentationFramebuffer);
    this.gl.deleteFramebuffer(this.passBoundaryFramebuffer);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

export async function createBenchmarkRenderer(kind: RendererKind): Promise<BenchmarkRenderer> {
  return kind === "webgpu"
    ? WebGpuBenchmarkRenderer.create()
    : WebGlBenchmarkRenderer.create();
}
