import type { BrushEngine } from "./brush-engine";
import type { DirtyRect } from "./engine-stroke-types";
import { LAYER_COMPOSITE_UNIFORM_BYTES, LAYER_SIZE } from "./engine-limits";
import { assertShaderCompiled } from "./engine-gpu-utils";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  LAYER_BLEND_MODE_CODES,
  type LayerBlendMode,
} from "./layer-blend-modes";
import {
  LAYER_BLEND_TILE_EXTENT,
  LAYER_BLEND_TILE_MIP_ONE_WGSL,
  LAYER_BLEND_TILE_MIP_UNIFORM_BYTES,
  LAYER_BLEND_TILE_PRESENT_UNIFORM_BYTES,
  LAYER_BLEND_TILE_PRESENT_WGSL,
  LAYER_BLEND_PYRAMID_PRESENT_WGSL,
} from "./layer-blend-tile-shader";

export type LayerBlendTileOperator = "source-over" | "source-atop";

export interface LayerBlendTileSource {
  view: GPUTextureView;
  origin: { x: number; y: number };
  scale: number;
  width: number;
  height: number;
}

const TILE_TEXTURE_COUNT = 3;
const FOLD_RECORD_CAPACITY = 2048;
const PRESENT_RECORD_CAPACITY = 128;
const MIP_RECORD_CAPACITY = 128;

const alignedStride = (size: number, alignment: number): number =>
  Math.ceil(size / Math.max(1, alignment)) * Math.max(1, alignment);

const sourceOverBlend: GPUBlendState = {
  color: {
    operation: "add",
    srcFactor: "one",
    dstFactor: "one-minus-src-alpha",
  },
  alpha: {
    operation: "add",
    srcFactor: "one",
    dstFactor: "one-minus-src-alpha",
  },
};

const sourceAtopBlend: GPUBlendState = {
  color: {
    operation: "add",
    srcFactor: "dst-alpha",
    dstFactor: "one-minus-src-alpha",
  },
  alpha: {
    operation: "add",
    srcFactor: "zero",
    dstFactor: "one",
  },
};

/**
 * Bounded native-format scratch used by the faithful live layer compositor.
 * It owns no document pixels: authoritative layer/tile storage remains in the
 * existing layer resources, and the scratch can be dropped when every mode is
 * Normal.
 */
export class LayerBlendTileCompositor {
  readonly extent = LAYER_BLEND_TILE_EXTENT;
  readonly format: "rgba8unorm" | "rgba16float";
  readonly textures: readonly [GPUTexture, GPUTexture, GPUTexture];
  readonly views: readonly [GPUTextureView, GPUTextureView, GPUTextureView];
  readonly stableMemoryBytes: number;
  readonly foldUniformStride: number;
  readonly presentUniformStride: number;
  readonly mipUniformStride: number;

  private readonly engine: BrushEngine;
  private readonly foldUniformBuffer: GPUBuffer;
  private readonly foldUniformUpload: ArrayBuffer;
  private readonly foldUniformF32: Float32Array;
  private readonly foldUniformU32: Uint32Array;
  private readonly presentUniformBuffer: GPUBuffer;
  private readonly presentUniformUpload: ArrayBuffer;
  private readonly presentUniformF32: Float32Array;
  private readonly mipUniformBuffer: GPUBuffer;
  private readonly mipUniformUpload: ArrayBuffer;
  private readonly mipUniformU32: Uint32Array;
  private readonly normalLayout: GPUBindGroupLayout;
  private readonly advancedLayout: GPUBindGroupLayout;
  private readonly presentLayout: GPUBindGroupLayout;
  private readonly mipLayout: GPUBindGroupLayout;
  private readonly normalOverPipeline: GPURenderPipeline;
  private readonly normalAtopPipeline: GPURenderPipeline;
  private readonly advancedPipeline: GPURenderPipeline;
  private readonly tileClearPipeline: GPURenderPipeline;
  private readonly tilePresentPipeline: GPURenderPipeline;
  private readonly mipOnePipeline: GPURenderPipeline;
  private readonly pyramidPresentPipeline: GPURenderPipeline;
  private readonly pyramidPresentBindGroup: GPUBindGroup;
  private readonly normalFrameBindGroups = new Map<GPUTextureView, GPUBindGroup>();
  private readonly advancedFrameBindGroups = new Map<
    GPUTextureView,
    Map<0 | 1 | 2, GPUBindGroup>
  >();
  private readonly presentFrameBindGroups = new Map<0 | 1 | 2, GPUBindGroup>();
  private readonly mipFrameBindGroups = new Map<0 | 1 | 2, GPUBindGroup>();
  private foldRecordCount = 0;
  private presentRecordCount = 0;
  private mipRecordCount = 0;
  private destroyed = false;

  private constructor(options: {
    engine: BrushEngine;
    textures: [GPUTexture, GPUTexture, GPUTexture];
    views: [GPUTextureView, GPUTextureView, GPUTextureView];
    foldUniformBuffer: GPUBuffer;
    foldUniformStride: number;
    presentUniformBuffer: GPUBuffer;
    presentUniformStride: number;
    mipUniformBuffer: GPUBuffer;
    mipUniformStride: number;
    normalLayout: GPUBindGroupLayout;
    advancedLayout: GPUBindGroupLayout;
    presentLayout: GPUBindGroupLayout;
    mipLayout: GPUBindGroupLayout;
    normalOverPipeline: GPURenderPipeline;
    normalAtopPipeline: GPURenderPipeline;
    advancedPipeline: GPURenderPipeline;
    tileClearPipeline: GPURenderPipeline;
    tilePresentPipeline: GPURenderPipeline;
    mipOnePipeline: GPURenderPipeline;
    pyramidPresentPipeline: GPURenderPipeline;
    pyramidPresentBindGroup: GPUBindGroup;
  }) {
    this.engine = options.engine;
    this.format = options.engine.layerFormat;
    this.textures = options.textures;
    this.views = options.views;
    this.foldUniformBuffer = options.foldUniformBuffer;
    this.foldUniformStride = options.foldUniformStride;
    this.presentUniformBuffer = options.presentUniformBuffer;
    this.presentUniformStride = options.presentUniformStride;
    this.mipUniformBuffer = options.mipUniformBuffer;
    this.mipUniformStride = options.mipUniformStride;
    this.normalLayout = options.normalLayout;
    this.advancedLayout = options.advancedLayout;
    this.presentLayout = options.presentLayout;
    this.mipLayout = options.mipLayout;
    this.normalOverPipeline = options.normalOverPipeline;
    this.normalAtopPipeline = options.normalAtopPipeline;
    this.advancedPipeline = options.advancedPipeline;
    this.tileClearPipeline = options.tileClearPipeline;
    this.tilePresentPipeline = options.tilePresentPipeline;
    this.mipOnePipeline = options.mipOnePipeline;
    this.pyramidPresentPipeline = options.pyramidPresentPipeline;
    this.pyramidPresentBindGroup = options.pyramidPresentBindGroup;
    this.foldUniformUpload = new ArrayBuffer(
      FOLD_RECORD_CAPACITY * this.foldUniformStride,
    );
    this.foldUniformF32 = new Float32Array(this.foldUniformUpload);
    this.foldUniformU32 = new Uint32Array(this.foldUniformUpload);
    this.presentUniformUpload = new ArrayBuffer(
      PRESENT_RECORD_CAPACITY * this.presentUniformStride,
    );
    this.presentUniformF32 = new Float32Array(this.presentUniformUpload);
    this.mipUniformUpload = new ArrayBuffer(
      MIP_RECORD_CAPACITY * this.mipUniformStride,
    );
    this.mipUniformU32 = new Uint32Array(this.mipUniformUpload);
    const bytesPerPixel = this.format === "rgba16float" ? 8 : 4;
    this.stableMemoryBytes = this.extent * this.extent
      * bytesPerPixel * TILE_TEXTURE_COUNT
      + FOLD_RECORD_CAPACITY * this.foldUniformStride
      + PRESENT_RECORD_CAPACITY * this.presentUniformStride
      + MIP_RECORD_CAPACITY * this.mipUniformStride;
  }

  static async create(engine: BrushEngine): Promise<LayerBlendTileCompositor> {
    const alignment = engine.device.limits.minUniformBufferOffsetAlignment;
    const foldUniformStride = alignedStride(LAYER_COMPOSITE_UNIFORM_BYTES, alignment);
    const presentUniformStride = alignedStride(
      LAYER_BLEND_TILE_PRESENT_UNIFORM_BYTES,
      alignment,
    );
    const mipUniformStride = alignedStride(
      LAYER_BLEND_TILE_MIP_UNIFORM_BYTES,
      alignment,
    );

    return runGpuAllocationTransaction(
      engine.device,
      "Allocazione compositore fusioni a tile",
      async (transaction) => {
        const textures = Array.from({ length: TILE_TEXTURE_COUNT }, (_, index) =>
          engine.device.createTexture({
            label: `Layer blend document tile ${index} ${LAYER_BLEND_TILE_EXTENT}²`,
            size: {
              width: LAYER_BLEND_TILE_EXTENT,
              height: LAYER_BLEND_TILE_EXTENT,
              depthOrArrayLayers: 1,
            },
            format: engine.layerFormat,
            usage:
              GPUTextureUsage.RENDER_ATTACHMENT
              | GPUTextureUsage.TEXTURE_BINDING
              | GPUTextureUsage.COPY_SRC
              | GPUTextureUsage.COPY_DST
              | GPUTextureUsage.STORAGE_BINDING,
          })) as [GPUTexture, GPUTexture, GPUTexture];
        textures.forEach((texture) => transaction.deferRollback(() => texture.destroy()));
        const views = textures.map((texture, index) => texture.createView({
          label: `Layer blend document tile view ${index}`,
        })) as [GPUTextureView, GPUTextureView, GPUTextureView];

        const createUniformBuffer = (label: string, size: number): GPUBuffer => {
          const buffer = engine.device.createBuffer({
            label,
            size,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          transaction.deferRollback(() => buffer.destroy());
          return buffer;
        };
        const foldUniformBuffer = createUniformBuffer(
          "Layer blend tile fold uniform ring",
          FOLD_RECORD_CAPACITY * foldUniformStride,
        );
        const presentUniformBuffer = createUniformBuffer(
          "Layer blend tile present uniform ring",
          PRESENT_RECORD_CAPACITY * presentUniformStride,
        );
        const mipUniformBuffer = createUniformBuffer(
          "Layer blend tile mip uniform ring",
          MIP_RECORD_CAPACITY * mipUniformStride,
        );

        const normalLayout = engine.device.createBindGroupLayout({
          label: "Layer blend tile Normal layout",
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "float", viewDimension: "2d" },
            },
            {
              binding: 1,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: {
                type: "uniform",
                hasDynamicOffset: true,
                minBindingSize: LAYER_COMPOSITE_UNIFORM_BYTES,
              },
            },
          ],
        });
        const advancedLayout = engine.device.createBindGroupLayout({
          label: "Layer blend tile advanced layout",
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "float", viewDimension: "2d" },
            },
            {
              binding: 1,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "float", viewDimension: "2d" },
            },
            {
              binding: 2,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: {
                type: "uniform",
                hasDynamicOffset: true,
                minBindingSize: LAYER_COMPOSITE_UNIFORM_BYTES,
              },
            },
          ],
        });
        const presentLayout = engine.device.createBindGroupLayout({
          label: "Layer blend tile screen present layout",
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: "uniform", minBindingSize: 96 },
            },
            {
              binding: 1,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: {
                type: "uniform",
                hasDynamicOffset: true,
                minBindingSize: LAYER_BLEND_TILE_PRESENT_UNIFORM_BYTES,
              },
            },
            {
              binding: 2,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "float", viewDimension: "2d" },
            },
          ],
        });
        const mipLayout = engine.device.createBindGroupLayout({
          label: "Layer blend tile mip-1 layout",
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "float", viewDimension: "2d" },
            },
            {
              binding: 1,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: {
                type: "uniform",
                hasDynamicOffset: true,
                minBindingSize: LAYER_BLEND_TILE_MIP_UNIFORM_BYTES,
              },
            },
          ],
        });

        const presentShader = engine.device.createShaderModule({
          label: "Layer blend tile screen present WGSL",
          code: LAYER_BLEND_TILE_PRESENT_WGSL,
        });
        const mipShader = engine.device.createShaderModule({
          label: "Layer blend tile mip-1 WGSL",
          code: LAYER_BLEND_TILE_MIP_ONE_WGSL,
        });
        const pyramidShader = engine.device.createShaderModule({
          label: "Layer blend final pyramid present WGSL",
          code: LAYER_BLEND_PYRAMID_PRESENT_WGSL,
        });
        await Promise.all([
          assertShaderCompiled(presentShader, "layer blend tile screen present"),
          assertShaderCompiled(mipShader, "layer blend tile mip 1"),
          assertShaderCompiled(pyramidShader, "layer blend final pyramid present"),
        ]);

        const pipeline = (
          label: string,
          layout: GPUBindGroupLayout,
          module: GPUShaderModule,
          fragmentEntryPoint: string,
          format: GPUTextureFormat,
          blend?: GPUBlendState,
        ): GPURenderPipeline => engine.device.createRenderPipeline({
          label,
          layout: engine.device.createPipelineLayout({
            label: `${label} pipeline layout`,
            bindGroupLayouts: [layout],
          }),
          vertex: { module, entryPoint: "vertexMain" },
          fragment: {
            module,
            entryPoint: fragmentEntryPoint,
            targets: [{ format, ...(blend ? { blend } : {}) }],
          },
          primitive: { topology: "triangle-list" },
        });
        const normalOverPipeline = pipeline(
          "Layer blend tile Normal source-over",
          normalLayout,
          engine.layerCompositeShaderModule,
          "fragmentMain",
          engine.layerFormat,
          sourceOverBlend,
        );
        const normalAtopPipeline = pipeline(
          "Layer blend tile Normal source-atop",
          normalLayout,
          engine.layerCompositeShaderModule,
          "fragmentMain",
          engine.layerFormat,
          sourceAtopBlend,
        );
        if (!engine.layerBlendFoldShaderModule) {
          throw new Error("Shader fold avanzato non inizializzato.");
        }
        const advancedPipeline = pipeline(
          "Layer blend tile advanced fold",
          advancedLayout,
          engine.layerBlendFoldShaderModule,
          "fragmentMain",
          engine.layerFormat,
        );
        if (!engine.mixedSceneClearShaderModule) {
          throw new Error("Shader clear parziale scena mista non inizializzato.");
        }
        const tileClearPipeline = engine.device.createRenderPipeline({
          label: "Layer blend tile bounded transparent clear",
          layout: engine.device.createPipelineLayout({
            label: "Layer blend tile bounded transparent clear pipeline layout",
            bindGroupLayouts: [],
          }),
          vertex: {
            module: engine.mixedSceneClearShaderModule,
            entryPoint: "vertexMain",
          },
          fragment: {
            module: engine.mixedSceneClearShaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format: engine.layerFormat }],
          },
          primitive: { topology: "triangle-list" },
        });
        const tilePresentPipeline = pipeline(
          "Layer blend tile to linear presentation",
          presentLayout,
          presentShader,
          "fragmentMain",
          "rgba16float",
        );
        const mipOnePipeline = pipeline(
          "Layer blend tile exact mip 1",
          mipLayout,
          mipShader,
          "fragmentMain",
          engine.layerFormat,
        );

        const pyramidLayout = engine.device.createBindGroupLayout({
          label: "Layer blend final pyramid present layout",
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: "uniform", minBindingSize: 96 },
            },
            {
              binding: 1,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "float", viewDimension: "2d" },
            },
            {
              binding: 2,
              visibility: GPUShaderStage.FRAGMENT,
              sampler: { type: "filtering" },
            },
          ],
        });
        const pyramidPresentPipeline = pipeline(
          "Layer blend final pyramid to linear presentation",
          pyramidLayout,
          pyramidShader,
          "fragmentMain",
          "rgba16float",
        );
        const pyramidPresentBindGroup = engine.device.createBindGroup({
          label: "Layer blend final pyramid present bind group",
          layout: pyramidLayout,
          entries: [
            { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
            { binding: 1, resource: engine.activeLayerDisplayPyramid.samplingView },
            { binding: 2, resource: engine.sampler },
          ],
        });

        return new LayerBlendTileCompositor({
          engine,
          textures,
          views,
          foldUniformBuffer,
          foldUniformStride,
          presentUniformBuffer,
          presentUniformStride,
          mipUniformBuffer,
          mipUniformStride,
          normalLayout,
          advancedLayout,
          presentLayout,
          mipLayout,
          normalOverPipeline,
          normalAtopPipeline,
          advancedPipeline,
          tileClearPipeline,
          tilePresentPipeline,
          mipOnePipeline,
          pyramidPresentPipeline,
          pyramidPresentBindGroup,
        });
      },
    );
  }

  beginFrame(): void {
    this.assertAlive();
    this.foldRecordCount = 0;
    this.presentRecordCount = 0;
    this.mipRecordCount = 0;
    // Source surfaces can be replaced between frames. A frame-local cache
    // removes tile-multiplied bind-group creation without retaining stale views.
    this.normalFrameBindGroups.clear();
    this.advancedFrameBindGroups.clear();
    this.presentFrameBindGroups.clear();
    this.mipFrameBindGroups.clear();
  }

  finishEncoding(): void {
    this.assertAlive();
    if (this.foldRecordCount > 0) {
      this.engine.device.queue.writeBuffer(
        this.foldUniformBuffer,
        0,
        this.foldUniformUpload,
        0,
        this.foldRecordCount * this.foldUniformStride,
      );
    }
    if (this.presentRecordCount > 0) {
      this.engine.device.queue.writeBuffer(
        this.presentUniformBuffer,
        0,
        this.presentUniformUpload,
        0,
        this.presentRecordCount * this.presentUniformStride,
      );
    }
    if (this.mipRecordCount > 0) {
      this.engine.device.queue.writeBuffer(
        this.mipUniformBuffer,
        0,
        this.mipUniformUpload,
        0,
        this.mipRecordCount * this.mipUniformStride,
      );
    }
  }

  clearTile(
    encoder: GPUCommandEncoder,
    tileIndex: 0 | 1 | 2,
    label: string,
    width: number = this.extent,
    height: number = this.extent,
  ): void {
    this.assertAlive();
    const boundedWidth = Math.min(this.extent, Math.max(0, Math.ceil(width)));
    const boundedHeight = Math.min(this.extent, Math.max(0, Math.ceil(height)));
    if (boundedWidth <= 0 || boundedHeight <= 0) return;
    const clearsWholeTile = boundedWidth === this.extent
      && boundedHeight === this.extent;
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [{
        view: this.views[tileIndex],
        loadOp: clearsWholeTile ? "clear" : "load",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    if (!clearsWholeTile) {
      pass.setPipeline(this.tileClearPipeline);
      pass.setScissorRect(0, 0, boundedWidth, boundedHeight);
      pass.draw(3, 1, 0, 0);
    }
    pass.end();
  }

  encodeFold(options: {
    encoder: GPUCommandEncoder;
    targetTile: 0 | 1 | 2;
    backdropTile?: 0 | 1 | 2;
    source: LayerBlendTileSource;
    tileDocumentRect: DirtyRect;
    localScissor: DirtyRect;
    opacity: number;
    mode: LayerBlendMode;
    operator: LayerBlendTileOperator;
    label: string;
  }): void {
    this.assertAlive();
    const record = this.writeFoldRecord(
      options.tileDocumentRect,
      options.source,
      options.opacity,
      options.mode,
      options.operator,
    );
    const advanced = options.mode !== "normal";
    if (advanced && options.backdropTile === undefined) {
      throw new Error("Il fold avanzato richiede il tile backdrop.");
    }
    if (advanced && options.backdropTile === options.targetTile) {
      throw new Error("Il fold avanzato non può leggere e scrivere lo stesso tile.");
    }
    const bindGroup = advanced
      ? this.advancedBindGroup(options.source.view, options.backdropTile!, options.label)
      : this.normalBindGroup(options.source.view, options.label);
    const pass = options.encoder.beginRenderPass({
      label: options.label,
      colorAttachments: [{
        view: this.views[options.targetTile],
        loadOp: "load",
        storeOp: "store",
      }],
    });
    pass.setPipeline(
      advanced
        ? this.advancedPipeline
        : options.operator === "source-atop"
          ? this.normalAtopPipeline
          : this.normalOverPipeline,
    );
    pass.setBindGroup(0, bindGroup, [record * this.foldUniformStride]);
    pass.setScissorRect(
      options.localScissor.x,
      options.localScissor.y,
      options.localScissor.width,
      options.localScissor.height,
    );
    pass.draw(3, 1, 0, 0);
    pass.end();
  }

  copyTile(
    encoder: GPUCommandEncoder,
    sourceTile: 0 | 1 | 2,
    targetTile: 0 | 1 | 2,
    width: number,
    height: number,
  ): void {
    this.assertAlive();
    encoder.copyTextureToTexture(
      { texture: this.textures[sourceTile] },
      { texture: this.textures[targetTile] },
      { width, height, depthOrArrayLayers: 1 },
    );
  }

  encodeTilePresentation(options: {
    pass: GPURenderPassEncoder;
    sourceTile: 0 | 1 | 2;
    textureOrigin: { x: number; y: number };
    core: DirtyRect;
    textureSize: { width: number; height: number };
    scissor: DirtyRect;
  }): void {
    this.assertAlive();
    if (this.presentRecordCount >= PRESENT_RECORD_CAPACITY) {
      throw new Error("Troppi tile di presentazione fusione in un frame.");
    }
    const record = this.presentRecordCount++;
    const word = record * (this.presentUniformStride / 4);
    this.presentUniformF32[word] = options.textureOrigin.x;
    this.presentUniformF32[word + 1] = options.textureOrigin.y;
    this.presentUniformF32[word + 2] = options.core.x;
    this.presentUniformF32[word + 3] = options.core.y;
    this.presentUniformF32[word + 4] = options.core.width;
    this.presentUniformF32[word + 5] = options.core.height;
    this.presentUniformF32[word + 6] = options.textureSize.width;
    this.presentUniformF32[word + 7] = options.textureSize.height;
    const bindGroup = this.presentBindGroup(options.sourceTile);
    options.pass.setPipeline(this.tilePresentPipeline);
    options.pass.setBindGroup(0, bindGroup, [record * this.presentUniformStride]);
    options.pass.setScissorRect(
      options.scissor.x,
      options.scissor.y,
      options.scissor.width,
      options.scissor.height,
    );
    options.pass.draw(3, 1, 0, 0);
  }

  encodeMipOne(options: {
    encoder: GPUCommandEncoder;
    sourceTile: 0 | 1 | 2;
    textureOrigin: { x: number; y: number };
    targetRect: DirtyRect;
  }): void {
    this.assertAlive();
    if (this.mipRecordCount >= MIP_RECORD_CAPACITY) {
      throw new Error("Troppi tile mip fusione in un frame.");
    }
    const record = this.mipRecordCount++;
    const word = record * (this.mipUniformStride / 4);
    this.mipUniformU32[word] = options.textureOrigin.x;
    this.mipUniformU32[word + 1] = options.textureOrigin.y;
    this.mipUniformU32[word + 2] = LAYER_SIZE;
    this.mipUniformU32[word + 3] = LAYER_SIZE;
    const bindGroup = this.mipBindGroup(options.sourceTile);
    const pass = options.encoder.beginRenderPass({
      label: "Layer blend tile exact mip 1",
      colorAttachments: [{
        view: this.engine.paintMipViews[1],
        loadOp: "load",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.mipOnePipeline);
    pass.setBindGroup(0, bindGroup, [record * this.mipUniformStride]);
    pass.setScissorRect(
      options.targetRect.x,
      options.targetRect.y,
      options.targetRect.width,
      options.targetRect.height,
    );
    pass.draw(3, 1, 0, 0);
    pass.end();
  }

  encodePyramidPresentation(pass: GPURenderPassEncoder): void {
    this.assertAlive();
    pass.setPipeline(this.pyramidPresentPipeline);
    pass.setBindGroup(0, this.pyramidPresentBindGroup);
    pass.draw(3, 1, 0, 0);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.textures.forEach((texture) => texture.destroy());
    this.foldUniformBuffer.destroy();
    this.presentUniformBuffer.destroy();
    this.mipUniformBuffer.destroy();
  }

  private writeFoldRecord(
    tileDocumentRect: DirtyRect,
    source: LayerBlendTileSource,
    opacity: number,
    mode: LayerBlendMode,
    operator: LayerBlendTileOperator,
  ): number {
    if (this.foldRecordCount >= FOLD_RECORD_CAPACITY) {
      throw new Error("Troppi fold fusione a tile in un frame.");
    }
    const record = this.foldRecordCount++;
    const word = record * (this.foldUniformStride / 4);
    this.foldUniformF32[word] = tileDocumentRect.x;
    this.foldUniformF32[word + 1] = tileDocumentRect.y;
    this.foldUniformF32[word + 2] = 1;
    this.foldUniformF32[word + 3] = Math.min(1, Math.max(0, opacity));
    this.foldUniformF32[word + 4] = source.origin.x;
    this.foldUniformF32[word + 5] = source.origin.y;
    this.foldUniformF32[word + 6] = source.scale;
    this.foldUniformF32[word + 7] = 0;
    this.foldUniformU32[word + 8] = source.width;
    this.foldUniformU32[word + 9] = source.height;
    this.foldUniformU32[word + 10] = LAYER_BLEND_MODE_CODES[mode];
    this.foldUniformU32[word + 11] = operator === "source-atop" ? 1 : 0;
    return record;
  }

  private normalBindGroup(sourceView: GPUTextureView, label: string): GPUBindGroup {
    const cached = this.normalFrameBindGroups.get(sourceView);
    if (cached) return cached;
    const bindGroup = this.engine.device.createBindGroup({
      label: `${label} · frame source`,
      layout: this.normalLayout,
      entries: [
        { binding: 0, resource: sourceView },
        {
          binding: 1,
          resource: {
            buffer: this.foldUniformBuffer,
            offset: 0,
            size: LAYER_COMPOSITE_UNIFORM_BYTES,
          },
        },
      ],
    });
    this.normalFrameBindGroups.set(sourceView, bindGroup);
    return bindGroup;
  }

  private advancedBindGroup(
    sourceView: GPUTextureView,
    backdropTile: 0 | 1 | 2,
    label: string,
  ): GPUBindGroup {
    let byBackdrop = this.advancedFrameBindGroups.get(sourceView);
    if (!byBackdrop) {
      byBackdrop = new Map();
      this.advancedFrameBindGroups.set(sourceView, byBackdrop);
    }
    const cached = byBackdrop.get(backdropTile);
    if (cached) return cached;
    const bindGroup = this.engine.device.createBindGroup({
      label: `${label} · frame source/backdrop`,
      layout: this.advancedLayout,
      entries: [
        { binding: 0, resource: this.views[backdropTile] },
        { binding: 1, resource: sourceView },
        {
          binding: 2,
          resource: {
            buffer: this.foldUniformBuffer,
            offset: 0,
            size: LAYER_COMPOSITE_UNIFORM_BYTES,
          },
        },
      ],
    });
    byBackdrop.set(backdropTile, bindGroup);
    return bindGroup;
  }

  private presentBindGroup(sourceTile: 0 | 1 | 2): GPUBindGroup {
    const cached = this.presentFrameBindGroups.get(sourceTile);
    if (cached) return cached;
    const bindGroup = this.engine.device.createBindGroup({
      label: `Layer blend tile present frame source ${sourceTile}`,
      layout: this.presentLayout,
      entries: [
        { binding: 0, resource: { buffer: this.engine.displayUniformBuffer } },
        {
          binding: 1,
          resource: {
            buffer: this.presentUniformBuffer,
            offset: 0,
            size: LAYER_BLEND_TILE_PRESENT_UNIFORM_BYTES,
          },
        },
        { binding: 2, resource: this.views[sourceTile] },
      ],
    });
    this.presentFrameBindGroups.set(sourceTile, bindGroup);
    return bindGroup;
  }

  private mipBindGroup(sourceTile: 0 | 1 | 2): GPUBindGroup {
    const cached = this.mipFrameBindGroups.get(sourceTile);
    if (cached) return cached;
    const bindGroup = this.engine.device.createBindGroup({
      label: `Layer blend tile mip frame source ${sourceTile}`,
      layout: this.mipLayout,
      entries: [
        { binding: 0, resource: this.views[sourceTile] },
        {
          binding: 1,
          resource: {
            buffer: this.mipUniformBuffer,
            offset: 0,
            size: LAYER_BLEND_TILE_MIP_UNIFORM_BYTES,
          },
        },
      ],
    });
    this.mipFrameBindGroups.set(sourceTile, bindGroup);
    return bindGroup;
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("Compositore fusioni a tile già distrutto.");
    }
  }
}
