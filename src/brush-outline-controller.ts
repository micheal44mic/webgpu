import type { BrushEngine } from "./brush-engine";
import type { CanvasInputTool } from "./canvas-input-controller";
import {
  BRUSH_OUTLINE_MIN_VISIBLE_CSS_PIXELS,
  brushOutlineBoundingExtentCssPixels,
  brushOutlineRotationRadians,
  type BrushMaskOutline,
  type BrushOutlineGpuTarget,
  type BrushOutlineSnapshot,
} from "./brush-outline-core";

export type BrushOutlineEnginePort = Pick<
  BrushEngine,
  "getBrushOutlineSnapshot" | "getBrushOutlineGpuTarget"
>;

export interface BrushOutlineBrowser extends Window {
  readonly AbortController: typeof AbortController;
  readonly ResizeObserver: typeof ResizeObserver;
}

export interface BrushOutlineControllerOptions {
  readonly engine: BrushOutlineEnginePort;
  readonly browser: BrushOutlineBrowser;
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  readonly getActiveTool: () => CanvasInputTool;
}

interface PointerPosition {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerType: string;
}

interface BrushOutlineGpuResources {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly pipeline: GPURenderPipeline;
  readonly brushUniformBuffer: GPUBuffer;
  readonly brushBindGroup: GPUBindGroup;
  readonly crossUniformBuffer: GPUBuffer;
  readonly crossBindGroup: GPUBindGroup;
  readonly circleBuffer: GPUBuffer;
  readonly circleSegmentCount: number;
  readonly crossBuffer: GPUBuffer;
  readonly crossSegmentCount: number;
}

const OUTLINE_PHYSICAL_PIXELS = 1;
const OVERSIZED_CENTER_MARK_CSS_PIXELS = 7;
const STROKE_OUTLINE_HIDE_DELAY_MILLISECONDS = 400;
const BRUSH_OUTLINE_UNIFORM_BYTES = 32;
const CIRCLE_SEGMENT_COUNT = 256;

const brushOutlineShader = /* wgsl */ `
struct OutlineUniforms {
  center: vec2f,
  diameter: f32,
  line_width: f32,
  viewport: vec2f,
  rotation: vec2f,
}

@group(0) @binding(0) var<uniform> uniforms: OutlineUniforms;

struct VertexInput {
  @location(0) segment: vec4f,
  @builtin(vertex_index) vertex_index: u32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) segment_start: vec2f,
  @location(1) @interpolate(flat) segment_end: vec2f,
}

fn transform_local(local: vec2f) -> vec2f {
  let scaled = local * uniforms.diameter;
  let cosine = uniforms.rotation.x;
  let sine = uniforms.rotation.y;
  return uniforms.center + vec2f(
    scaled.x * cosine - scaled.y * sine,
    scaled.x * sine + scaled.y * cosine,
  );
}

@vertex
fn vertex_main(input: VertexInput) -> VertexOutput {
  let start = transform_local(input.segment.xy);
  let end = transform_local(input.segment.zw);
  let delta = end - start;
  let segment_length = max(length(delta), 0.0001);
  let tangent = delta / segment_length;
  let normal = vec2f(-tangent.y, tangent.x);
  let at_end = input.vertex_index >= 2u;
  let positive_side = input.vertex_index == 1u || input.vertex_index == 3u;
  let along = select(0.0, 1.0, at_end);
  let side = select(-1.0, 1.0, positive_side);
  let raster_half_width = uniforms.line_width * 0.5 + 1.0;
  let screen = mix(start, end, along)
    + tangent * ((along * 2.0 - 1.0) * raster_half_width)
    + normal * (side * raster_half_width);
  let clip = vec2f(
    screen.x / uniforms.viewport.x * 2.0 - 1.0,
    1.0 - screen.y / uniforms.viewport.y * 2.0,
  );
  var output: VertexOutput;
  output.position = vec4f(clip, 0.0, 1.0);
  output.segment_start = start;
  output.segment_end = end;
  return output;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
  let segment = input.segment_end - input.segment_start;
  let relative = input.position.xy - input.segment_start;
  let projection = clamp(
    dot(relative, segment) / max(dot(segment, segment), 0.0001),
    0.0,
    1.0,
  );
  let distance = length(relative - segment * projection);
  let half_width = uniforms.line_width * 0.5;
  let coverage = 1.0 - smoothstep(
    max(0.0, half_width - 0.5),
    half_width + 0.5,
    distance,
  );
  return vec4f(vec3f(coverage), coverage);
}
`;

function brushToolActive(tool: CanvasInputTool): boolean {
  return tool === "paint" || tool === "erase" || tool === "blend" || tool === "clone";
}

function clampPixelRatio(value: number): number {
  return Math.min(2, Math.max(1, Number.isFinite(value) ? value : 1));
}

export function snapBrushOutlineCssCoordinate(value: number, pixelRatio: number): number {
  return Math.round(value * pixelRatio) / pixelRatio;
}

export function compileBrushOutlineSegments(outline: BrushMaskOutline): Float32Array {
  let segmentCount = 0;
  for (const path of outline.paths) {
    if (path.length >= 6) segmentCount += path.length / 2;
  }
  const segments = new Float32Array(segmentCount * 4);
  let cursor = 0;
  for (const path of outline.paths) {
    if (path.length < 6) continue;
    const pointCount = path.length / 2;
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      const nextPointIndex = (pointIndex + 1) % pointCount;
      const sourceIndex = pointIndex * 2;
      const nextSourceIndex = nextPointIndex * 2;
      segments[cursor] = path[sourceIndex];
      segments[cursor + 1] = path[sourceIndex + 1];
      segments[cursor + 2] = path[nextSourceIndex];
      segments[cursor + 3] = path[nextSourceIndex + 1];
      cursor += 4;
    }
  }
  return segments;
}

function createCircleSegments(): Float32Array {
  const segments = new Float32Array(CIRCLE_SEGMENT_COUNT * 4);
  for (let index = 0; index < CIRCLE_SEGMENT_COUNT; index += 1) {
    const start = index / CIRCLE_SEGMENT_COUNT * Math.PI * 2;
    const end = (index + 1) / CIRCLE_SEGMENT_COUNT * Math.PI * 2;
    const offset = index * 4;
    segments[offset] = Math.cos(start) * 0.5;
    segments[offset + 1] = Math.sin(start) * 0.5;
    segments[offset + 2] = Math.cos(end) * 0.5;
    segments[offset + 3] = Math.sin(end) * 0.5;
  }
  return segments;
}

const circleSegments = createCircleSegments();
const crossSegments = Float32Array.of(
  -0.5, 0, 0.5, 0,
  0, -0.5, 0, 0.5,
);

function createGpuLineBuffer(
  device: GPUDevice,
  label: string,
  segments: Float32Array,
): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: Math.max(16, segments.byteLength),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, segments);
  return buffer;
}

/**
 * Owns only the cursor decoration. Alpha topology is compiled once on the CPU;
 * all pointer-time transform, antialiasing and rasterization runs in WebGPU.
 */
export class BrushOutlineController {
  private readonly abortController: AbortController;
  private readonly context: GPUCanvasContext | null;
  private readonly resizeObserver: ResizeObserver;
  private readonly brushUniformData = new Float32Array(BRUSH_OUTLINE_UNIFORM_BYTES / 4);
  private readonly crossUniformData = new Float32Array(BRUSH_OUTLINE_UNIFORM_BYTES / 4);
  private pointer: PointerPosition | null = null;
  private previousPointer: PointerPosition | null = null;
  private pointerDirectionRadians: number | null = null;
  private lastViewRotationRadians: number | null = null;
  private frame: number | null = null;
  private strokeHideTimer: number | null = null;
  private strokeActive = false;
  private strokeOutlineSuppressed = false;
  private pixelRatio = 1;
  private gpuResources: BrushOutlineGpuResources | null = null;
  private failedDevice: GPUDevice | null = null;
  private cachedOutline: BrushMaskOutline | null = null;
  private cachedOutlineBuffer: GPUBuffer | null = null;
  private cachedOutlineSegmentCount = 0;
  private disposed = false;

  constructor(private readonly options: BrushOutlineControllerOptions) {
    this.abortController = new options.browser.AbortController();
    this.context = options.overlay.getContext("webgpu") as GPUCanvasContext | null;
    options.overlay.hidden = true;
    const signal = this.abortController.signal;
    options.canvas.addEventListener("pointerenter", this.handlePointer, { signal });
    options.canvas.addEventListener("pointerrawupdate", (event) => {
      this.handlePointer(event as PointerEvent);
    }, { signal });
    options.canvas.addEventListener("pointermove", this.handlePointer, { signal });
    options.canvas.addEventListener("pointerdown", this.handlePointerDown, { signal });
    options.canvas.addEventListener("pointerup", this.handlePointerUp, { signal });
    options.canvas.addEventListener("pointercancel", this.hideForPointerEnd, { signal });
    options.canvas.addEventListener("pointerleave", this.hideForPointerEnd, { signal });
    options.canvas.addEventListener("lostpointercapture", this.handleLostCapture, { signal });
    options.browser.addEventListener("keydown", this.handleKeyChange, { signal });
    options.browser.addEventListener("keyup", this.handleKeyChange, { signal });
    options.browser.addEventListener("blur", this.hideForPointerEnd, { signal });
    this.resizeObserver = new options.browser.ResizeObserver(() => {
      this.resizeBackingStore();
      this.scheduleRender();
    });
    this.resizeObserver.observe(options.canvas);
    this.resizeBackingStore();
  }

  prepareGpuResources(): void {
    this.ensureGpuResources();
  }

  notifyEngineUpdate(): void {
    this.scheduleRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.resizeObserver.disconnect();
    this.cancelScheduledRender();
    this.cancelStrokeHide();
    this.hide();
    this.destroyGpuResources();
  }

  private readonly handlePointer = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      this.hideForPointerEnd();
      return;
    }
    const next: PointerPosition = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: event.pointerType,
    };
    const previous = this.previousPointer;
    if (previous && previous.pointerType === next.pointerType) {
      const deltaX = next.clientX - previous.clientX;
      const deltaY = next.clientY - previous.clientY;
      if (Math.hypot(deltaX, deltaY) >= 1) {
        this.pointerDirectionRadians = Math.atan2(deltaY, deltaX);
      }
    }
    this.pointer = next;
    this.previousPointer = next;
    this.scheduleRender();
  };

  private readonly hideForPointerEnd = (): void => {
    this.strokeActive = false;
    this.strokeOutlineSuppressed = false;
    this.cancelStrokeHide();
    this.pointer = null;
    this.previousPointer = null;
    this.pointerDirectionRadians = null;
    this.hide();
  };

  private readonly handleLostCapture = (): void => {
    if (!this.pointer) this.hide();
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.handlePointer(event);
    if (event.pointerType === "touch" || event.button !== 0) return;
    this.strokeActive = true;
    this.strokeOutlineSuppressed = false;
    this.cancelStrokeHide();
    this.strokeHideTimer = this.options.browser.setTimeout(() => {
      this.strokeHideTimer = null;
      if (!this.strokeActive) return;
      this.strokeOutlineSuppressed = true;
      this.cancelScheduledRender();
      this.hide();
    }, STROKE_OUTLINE_HIDE_DELAY_MILLISECONDS);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    this.strokeActive = false;
    this.strokeOutlineSuppressed = false;
    this.cancelStrokeHide();
    this.handlePointer(event);
  };

  private readonly handleKeyChange = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() !== "r") return;
    if (event.type === "keydown") this.hide();
    else this.scheduleRender();
  };

  private scheduleRender(): void {
    if (
      this.disposed
      || !this.pointer
      || this.strokeOutlineSuppressed
      || this.frame !== null
    ) return;
    this.frame = this.options.browser.requestAnimationFrame(() => {
      this.frame = null;
      if (this.disposed || !this.pointer || this.strokeOutlineSuppressed) return;
      this.render();
    });
  }

  private cancelScheduledRender(): void {
    if (this.frame === null) return;
    this.options.browser.cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private cancelStrokeHide(): void {
    if (this.strokeHideTimer === null) return;
    this.options.browser.clearTimeout(this.strokeHideTimer);
    this.strokeHideTimer = null;
  }

  private resizeBackingStore(): void {
    const rectangle = this.options.canvas.getBoundingClientRect();
    this.pixelRatio = clampPixelRatio(this.options.browser.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rectangle.width * this.pixelRatio));
    const height = Math.max(1, Math.round(rectangle.height * this.pixelRatio));
    if (this.options.overlay.width !== width) this.options.overlay.width = width;
    if (this.options.overlay.height !== height) this.options.overlay.height = height;
  }

  private hide(): void {
    this.options.overlay.hidden = true;
    delete this.options.overlay.dataset.brushOutlineKind;
    delete this.options.overlay.dataset.brushOutlineDiameter;
    delete this.options.overlay.dataset.brushOutlinePrecision;
    delete this.options.overlay.dataset.brushOutlineRenderer;
    delete this.options.overlay.dataset.brushOutlineSegments;
    this.options.canvas.classList.remove("brush-outline-active");
  }

  private destroyGpuResources(): void {
    this.releaseCachedOutlineBuffer();
    const resources = this.gpuResources;
    this.gpuResources = null;
    if (!resources) return;
    resources.brushUniformBuffer.destroy();
    resources.crossUniformBuffer.destroy();
    resources.circleBuffer.destroy();
    resources.crossBuffer.destroy();
    this.context?.unconfigure();
  }

  private releaseCachedOutlineBuffer(): void {
    this.cachedOutlineBuffer?.destroy();
    this.cachedOutlineBuffer = null;
    this.cachedOutline = null;
    this.cachedOutlineSegmentCount = 0;
  }

  private ensureGpuResources(): BrushOutlineGpuResources | null {
    if (this.disposed || !this.context) return null;
    const target: BrushOutlineGpuTarget | null = this.options.engine.getBrushOutlineGpuTarget();
    if (!target) return null;
    if (
      this.gpuResources
      && this.gpuResources.device === target.device
      && this.gpuResources.format === target.format
    ) {
      return this.gpuResources;
    }
    if (this.failedDevice === target.device) return null;
    this.destroyGpuResources();
    const createdBuffers: GPUBuffer[] = [];
    try {
      this.context.configure({
        device: target.device,
        format: target.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        alphaMode: "premultiplied",
        colorSpace: "srgb",
      });
      const shaderModule = target.device.createShaderModule({
        label: "Brush outline · WebGPU shader",
        code: brushOutlineShader,
      });
      const bindGroupLayout = target.device.createBindGroupLayout({
        label: "Brush outline · bind group layout",
        entries: [{
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform", minBindingSize: BRUSH_OUTLINE_UNIFORM_BYTES },
        }],
      });
      const pipelineLayout = target.device.createPipelineLayout({
        label: "Brush outline · pipeline layout",
        bindGroupLayouts: [bindGroupLayout],
      });
      const pipeline = target.device.createRenderPipeline({
        label: "Brush outline · antialiased line segments",
        layout: pipelineLayout,
        vertex: {
          module: shaderModule,
          entryPoint: "vertex_main",
          buffers: [{
            arrayStride: 16,
            stepMode: "instance",
            attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }],
          }],
        },
        fragment: {
          module: shaderModule,
          entryPoint: "fragment_main",
          targets: [{
            format: target.format,
            blend: {
              color: {
                operation: "max",
                srcFactor: "one",
                dstFactor: "one",
              },
              alpha: {
                operation: "max",
                srcFactor: "one",
                dstFactor: "one",
              },
            },
          }],
        },
        primitive: { topology: "triangle-strip" },
      });
      const createUniformBuffer = (label: string): GPUBuffer => {
        const buffer = target.device.createBuffer({
          label,
          size: BRUSH_OUTLINE_UNIFORM_BYTES,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        createdBuffers.push(buffer);
        return buffer;
      };
      const brushUniformBuffer = createUniformBuffer("Brush outline · brush uniforms");
      const crossUniformBuffer = createUniformBuffer("Brush outline · center mark uniforms");
      const circleBuffer = createGpuLineBuffer(
        target.device,
        "Brush outline · unit circle",
        circleSegments,
      );
      createdBuffers.push(circleBuffer);
      const crossBuffer = createGpuLineBuffer(
        target.device,
        "Brush outline · oversized center mark",
        crossSegments,
      );
      createdBuffers.push(crossBuffer);
      const createBindGroup = (label: string, buffer: GPUBuffer): GPUBindGroup =>
        target.device.createBindGroup({
          label,
          layout: bindGroupLayout,
          entries: [{ binding: 0, resource: { buffer } }],
        });
      this.gpuResources = {
        device: target.device,
        format: target.format,
        pipeline,
        brushUniformBuffer,
        brushBindGroup: createBindGroup("Brush outline · brush bind group", brushUniformBuffer),
        crossUniformBuffer,
        crossBindGroup: createBindGroup("Brush outline · center mark bind group", crossUniformBuffer),
        circleBuffer,
        circleSegmentCount: circleSegments.length / 4,
        crossBuffer,
        crossSegmentCount: crossSegments.length / 4,
      };
      this.failedDevice = null;
      return this.gpuResources;
    } catch (error) {
      for (const buffer of createdBuffers) buffer.destroy();
      this.context.unconfigure();
      this.failedDevice = target.device;
      console.warn("WebGPU brush outline is unavailable.", error);
      return null;
    }
  }

  private compileOutlineBuffer(
    resources: BrushOutlineGpuResources,
    outline: BrushMaskOutline,
  ): GPUBuffer | null {
    if (this.cachedOutline === outline) return this.cachedOutlineBuffer;
    this.cachedOutlineBuffer?.destroy();
    this.cachedOutlineBuffer = null;
    this.cachedOutline = outline;
    const segments = compileBrushOutlineSegments(outline);
    this.cachedOutlineSegmentCount = segments.length / 4;
    if (segments.length === 0) return null;
    this.cachedOutlineBuffer = createGpuLineBuffer(
      resources.device,
      "Brush outline · cached alpha boundary",
      segments,
    );
    return this.cachedOutlineBuffer;
  }

  private writeUniform(
    resources: BrushOutlineGpuResources,
    targetBuffer: GPUBuffer,
    data: Float32Array,
    centerXCssPixels: number,
    centerYCssPixels: number,
    diameterCssPixels: number,
    rotationRadians: number,
  ): void {
    data[0] = snapBrushOutlineCssCoordinate(centerXCssPixels, this.pixelRatio)
      * this.pixelRatio;
    data[1] = snapBrushOutlineCssCoordinate(centerYCssPixels, this.pixelRatio)
      * this.pixelRatio;
    data[2] = diameterCssPixels * this.pixelRatio;
    data[3] = OUTLINE_PHYSICAL_PIXELS;
    data[4] = this.options.overlay.width;
    data[5] = this.options.overlay.height;
    data[6] = Math.cos(rotationRadians);
    data[7] = Math.sin(rotationRadians);
    resources.device.queue.writeBuffer(targetBuffer, 0, data);
  }

  private drawGpuOutline(
    centerX: number,
    centerY: number,
    diameter: number,
    rotation: number,
    outline: BrushMaskOutline | null,
    oversized: boolean,
  ): number | null {
    const resources = this.ensureGpuResources();
    if (!resources || !this.context) return null;
    let lineBuffer = resources.circleBuffer;
    let segmentCount = resources.circleSegmentCount;
    if (outline) {
      const outlineBuffer = this.compileOutlineBuffer(resources, outline);
      if (!outlineBuffer || this.cachedOutlineSegmentCount === 0) return null;
      lineBuffer = outlineBuffer;
      segmentCount = this.cachedOutlineSegmentCount;
    }
    this.writeUniform(
      resources,
      resources.brushUniformBuffer,
      this.brushUniformData,
      centerX,
      centerY,
      diameter,
      rotation,
    );
    if (oversized) {
      this.writeUniform(
        resources,
        resources.crossUniformBuffer,
        this.crossUniformData,
        centerX,
        centerY,
        OVERSIZED_CENTER_MARK_CSS_PIXELS * 2,
        0,
      );
    }

    try {
      const encoder = resources.device.createCommandEncoder({
        label: "Brush outline · pointer frame",
      });
      const pass = encoder.beginRenderPass({
        label: "Brush outline · transparent overlay",
        colorAttachments: [{
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(resources.pipeline);
      pass.setBindGroup(0, resources.brushBindGroup);
      pass.setVertexBuffer(0, lineBuffer);
      pass.draw(4, segmentCount);
      if (oversized) {
        pass.setBindGroup(0, resources.crossBindGroup);
        pass.setVertexBuffer(0, resources.crossBuffer);
        pass.draw(4, resources.crossSegmentCount);
      }
      pass.end();
      resources.device.queue.submit([encoder.finish()]);
      return segmentCount + (oversized ? resources.crossSegmentCount : 0);
    } catch (error) {
      this.failedDevice = resources.device;
      this.destroyGpuResources();
      console.warn("WebGPU brush outline stopped.", error);
      return null;
    }
  }

  private render(): void {
    const pointer = this.pointer;
    const canvas = this.options.canvas;
    if (
      !pointer
      || !brushToolActive(this.options.getActiveTool())
      || canvas.classList.contains("panning")
      || canvas.classList.contains("rotating")
      || canvas.classList.contains("rotation-ready")
    ) {
      this.hide();
      return;
    }
    this.resizeBackingStore();
    const snapshot: BrushOutlineSnapshot = this.options.engine.getBrushOutlineSnapshot();
    if (
      snapshot.kind === "unavailable"
      || !Number.isFinite(snapshot.diameterCssPixels)
      || snapshot.diameterCssPixels <= 0
    ) {
      if (snapshot.kind === "unavailable") this.releaseCachedOutlineBuffer();
      this.hide();
      return;
    }
    if (
      this.lastViewRotationRadians !== null
      && this.lastViewRotationRadians !== snapshot.viewRotationRadians
    ) {
      this.pointerDirectionRadians = null;
    }
    this.lastViewRotationRadians = snapshot.viewRotationRadians;

    const rectangle = canvas.getBoundingClientRect();
    const centerX = pointer.clientX - rectangle.left;
    const centerY = pointer.clientY - rectangle.top;
    const exactDiameter = snapshot.diameterCssPixels;
    const outline = snapshot.kind === "shape" ? snapshot.outline : null;
    if (snapshot.kind === "shape" && (!outline || outline.paths.length === 0)) {
      this.releaseCachedOutlineBuffer();
      this.hide();
      return;
    }
    const hasShapeBoundary = outline !== null;
    const shapeRotation = hasShapeBoundary
      ? brushOutlineRotationRadians(
        snapshot.followsStroke,
        snapshot.viewRotationRadians,
        this.pointerDirectionRadians,
      )
      : 0;
    const exactBoundingExtent = hasShapeBoundary
      ? brushOutlineBoundingExtentCssPixels(outline, exactDiameter, shapeRotation)
      : exactDiameter * 2;
    const useMinimumCircle = exactBoundingExtent < BRUSH_OUTLINE_MIN_VISIBLE_CSS_PIXELS;
    const oversized = exactBoundingExtent > rectangle.width + rectangle.height;
    const diameter = useMinimumCircle
      ? BRUSH_OUTLINE_MIN_VISIBLE_CSS_PIXELS
      : exactDiameter;
    const usesShapeBoundary = !useMinimumCircle && hasShapeBoundary;
    const rotation = usesShapeBoundary ? shapeRotation : 0;
    if (!usesShapeBoundary) this.releaseCachedOutlineBuffer();

    this.options.overlay.hidden = false;
    const renderedSegments = this.drawGpuOutline(
      centerX,
      centerY,
      diameter,
      rotation,
      usesShapeBoundary ? outline : null,
      oversized,
    );
    if (renderedSegments === null) {
      this.hide();
      return;
    }
    this.options.overlay.dataset.brushOutlineKind = oversized
      ? "oversized-with-center"
      : usesShapeBoundary
        ? "shape-alpha"
        : "circle";
    this.options.overlay.dataset.brushOutlineDiameter = exactDiameter.toFixed(3);
    this.options.overlay.dataset.brushOutlinePrecision = outline
      ? (outline.precise ? "precise" : "bounded")
      : "analytic";
    this.options.overlay.dataset.brushOutlineRenderer = "webgpu-shape-alpha-boundary";
    this.options.overlay.dataset.brushOutlineSegments = String(renderedSegments);
    canvas.classList.add("brush-outline-active");
  }
}
