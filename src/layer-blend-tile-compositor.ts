import type { BrushEngine } from "./brush-engine";
import type { DirtyRect } from "./engine-stroke-types";
import {
  DOCUMENT_HEIGHT,
  DOCUMENT_WIDTH,
  LAYER_COMPOSITE_UNIFORM_BYTES,
} from "./engine-limits";
import {
  assertShaderCompiled,
  createRenderPipelineAsync,
} from "./engine-gpu-utils";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";
import {
  documentBackgroundEncodedSrgbPremultiplied,
  documentBackgroundLinearPremultiplied,
} from "./document-background";
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
  LAYER_BLEND_TILE_QUANTIZATION_SEED,
  LAYER_BLEND_PYRAMID_PRESENT_WGSL,
} from "./layer-blend-tile-shader";
import {
  LAYER_BLEND_FOLD_COMPOSITION_CONTEXT_CODES,
  LAYER_BLEND_FOLD_UNIFORM_BYTES,
  type LayerBlendFoldCompositionContext,
} from "./layer-blend-fold-shader";
import {
  DEFAULT_LAYER_TONAL_BLEND,
  LAYER_CUTOUT_MODE_CODES,
  layerTonalBlendIsDefault,
  type LayerCutoutMode,
  type LayerTonalBlend,
} from "./layer-composition.ts";

export type LayerBlendTileOperator = "source-over" | "source-atop";

export interface LayerBlendTileSource {
  view: GPUTextureView;
  /** Raw authored matte used only by scoped cutout composition. */
  cutoutView?: GPUTextureView;
  /** Cutout textures may have a different document-space crop than the styled source. */
  cutoutOrigin?: { x: number; y: number };
  cutoutScale?: number;
  cutoutWidth?: number;
  cutoutHeight?: number;
  origin: { x: number; y: number };
  scale: number;
  width: number;
  height: number;
  /** Optional immutable-base and document-mask resources for clipping scope. */
  clipping?: {
    context: Exclude<LayerBlendFoldCompositionContext, "direct">;
    baseView: GPUTextureView;
    baseOrigin: { x: number; y: number };
    baseScale: number;
    documentMaskView: GPUTextureView;
    documentMaskOrigin: { x: number; y: number };
    documentMaskScale: number;
    documentMaskWidth: number;
    documentMaskHeight: number;
    documentMaskOpacity: number;
  };
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
 * Bounded high-precision scratch used by the faithful live layer compositor.
 * It owns no document pixels: authoritative layer/tile storage remains in the
 * existing document format, and the scratch can be dropped when every mode is
 * Normal. Encoded-sRGB documents retain that encoded-premultiplied value space
 * inside RGBA16F, avoiding an RGBA8 rounding boundary after every layer.
 */
export class LayerBlendTileCompositor {
  readonly extent = LAYER_BLEND_TILE_EXTENT;
  /** Format of the authoritative document resources consumed by this compositor. */
  readonly format: "rgba8unorm" | "rgba16float";
  /**
   * Bounded accumulation format. An RGBA8 document still folds every layer in
   * this higher-precision working set and quantizes only at its final document
   * or pyramid boundary.
   */
  readonly scratchFormat: "rgba16float";
  readonly textures: readonly [GPUTexture, GPUTexture, GPUTexture];
  readonly views: readonly [GPUTextureView, GPUTextureView, GPUTextureView];
  /** Native-format transient source written by the raster style baker. */
  readonly bakeTexture: GPUTexture;
  readonly bakeView: GPUTextureView;
  readonly documentMaskTexture: GPUTexture;
  readonly documentMaskView: GPUTextureView;
  readonly clippingBaseTexture: GPUTexture;
  readonly clippingBaseView: GPUTextureView;
  readonly authoredMatteTexture: GPUTexture;
  readonly authoredMatteView: GPUTextureView;
  readonly deepFloorTexture: GPUTexture;
  readonly deepFloorView: GPUTextureView;
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
  private readonly documentMaskContributionPipeline: GPURenderPipeline;
  private readonly tileClearPipeline: GPURenderPipeline;
  private readonly tileBackgroundPipeline: GPURenderPipeline;
  private readonly tilePresentPipeline: GPURenderPipeline;
  private readonly mipOnePipeline: GPURenderPipeline;
  private readonly pyramidPresentPipeline: GPURenderPipeline;
  private readonly pyramidPresentBindGroup: GPUBindGroup;
  private readonly normalFrameBindGroups = new Map<GPUTextureView, GPUBindGroup>();
  private readonly advancedFrameBindGroups = new Map<GPUTextureView, Map<
    GPUTextureView,
    Map<GPUTextureView, Map<GPUTextureView, Map<0 | 1 | 2, GPUBindGroup>>>
  >>();
  private readonly presentFrameBindGroups = new Map<0 | 1 | 2, GPUBindGroup>();
  private readonly mipFrameBindGroups = new Map<0 | 1 | 2, GPUBindGroup>();
  private foldRecordCount = 0;
  private presentRecordCount = 0;
  private mipRecordCount = 0;
  private destroyed = false;

  private constructor(options: {
    engine: BrushEngine;
    scratchFormat: "rgba16float";
    textures: [GPUTexture, GPUTexture, GPUTexture];
    views: [GPUTextureView, GPUTextureView, GPUTextureView];
    bakeTexture: GPUTexture;
    bakeView: GPUTextureView;
    documentMaskTexture: GPUTexture;
    documentMaskView: GPUTextureView;
    clippingBaseTexture: GPUTexture;
    clippingBaseView: GPUTextureView;
    authoredMatteTexture: GPUTexture;
    authoredMatteView: GPUTextureView;
    deepFloorTexture: GPUTexture;
    deepFloorView: GPUTextureView;
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
    documentMaskContributionPipeline: GPURenderPipeline;
    tileClearPipeline: GPURenderPipeline;
    tileBackgroundPipeline: GPURenderPipeline;
    tilePresentPipeline: GPURenderPipeline;
    mipOnePipeline: GPURenderPipeline;
    pyramidPresentPipeline: GPURenderPipeline;
    pyramidPresentBindGroup: GPUBindGroup;
  }) {
    this.engine = options.engine;
    this.format = options.engine.layerFormat;
    this.scratchFormat = options.scratchFormat;
    this.textures = options.textures;
    this.views = options.views;
    this.bakeTexture = options.bakeTexture;
    this.bakeView = options.bakeView;
    this.documentMaskTexture = options.documentMaskTexture;
    this.documentMaskView = options.documentMaskView;
    this.clippingBaseTexture = options.clippingBaseTexture;
    this.clippingBaseView = options.clippingBaseView;
    this.authoredMatteTexture = options.authoredMatteTexture;
    this.authoredMatteView = options.authoredMatteView;
    this.deepFloorTexture = options.deepFloorTexture;
    this.deepFloorView = options.deepFloorView;
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
    this.documentMaskContributionPipeline = options.documentMaskContributionPipeline;
    this.tileClearPipeline = options.tileClearPipeline;
    this.tileBackgroundPipeline = options.tileBackgroundPipeline;
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
    const documentBytesPerPixel = this.format === "rgba16float" ? 8 : 4;
    const scratchBytesPerPixel = 8;
    this.stableMemoryBytes = this.extent * this.extent
      * (
        scratchBytesPerPixel * (TILE_TEXTURE_COUNT + 3)
        + documentBytesPerPixel * 2
      )
      + FOLD_RECORD_CAPACITY * this.foldUniformStride
      + PRESENT_RECORD_CAPACITY * this.presentUniformStride
      + MIP_RECORD_CAPACITY * this.mipUniformStride;
  }

  static async create(engine: BrushEngine): Promise<LayerBlendTileCompositor> {
    const scratchFormat = "rgba16float" as const;
    const alignment = engine.device.limits.minUniformBufferOffsetAlignment;
    const foldUniformStride = alignedStride(LAYER_BLEND_FOLD_UNIFORM_BYTES, alignment);
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
      "Tile-blend compositor allocation",
      async (transaction) => {
        const textures = Array.from({ length: TILE_TEXTURE_COUNT }, (_, index) =>
          engine.device.createTexture({
            label: `Layer blend document tile ${index} ${LAYER_BLEND_TILE_EXTENT}²`,
            size: {
              width: LAYER_BLEND_TILE_EXTENT,
              height: LAYER_BLEND_TILE_EXTENT,
              depthOrArrayLayers: 1,
            },
            format: scratchFormat,
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
        const bakeTexture = engine.device.createTexture({
          label: `Layer blend native bake source ${LAYER_BLEND_TILE_EXTENT}²`,
          size: {
            width: LAYER_BLEND_TILE_EXTENT,
            height: LAYER_BLEND_TILE_EXTENT,
            depthOrArrayLayers: 1,
          },
          format: engine.layerFormat,
          usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => bakeTexture.destroy());
        const bakeView = bakeTexture.createView({
          label: "Layer blend native bake source view",
        });
        const documentMaskTexture = engine.device.createTexture({
          label: `Layer blend clipping document mask ${LAYER_BLEND_TILE_EXTENT}²`,
          size: {
            width: LAYER_BLEND_TILE_EXTENT,
            height: LAYER_BLEND_TILE_EXTENT,
            depthOrArrayLayers: 1,
          },
          format: scratchFormat,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => documentMaskTexture.destroy());
        const documentMaskView = documentMaskTexture.createView({
          label: "Layer blend clipping document mask view",
        });
        const clippingBaseTexture = engine.device.createTexture({
          label: `Layer blend clipping immutable base ${LAYER_BLEND_TILE_EXTENT}²`,
          size: {
            width: LAYER_BLEND_TILE_EXTENT,
            height: LAYER_BLEND_TILE_EXTENT,
            depthOrArrayLayers: 1,
          },
          format: scratchFormat,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => clippingBaseTexture.destroy());
        const clippingBaseView = clippingBaseTexture.createView({
          label: "Layer blend clipping immutable base view",
        });
        const authoredMatteTexture = engine.device.createTexture({
          label: `Layer blend live authored matte ${LAYER_BLEND_TILE_EXTENT}²`,
          size: {
            width: LAYER_BLEND_TILE_EXTENT,
            height: LAYER_BLEND_TILE_EXTENT,
            depthOrArrayLayers: 1,
          },
          format: engine.layerFormat,
          usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        transaction.deferRollback(() => authoredMatteTexture.destroy());
        const authoredMatteView = authoredMatteTexture.createView({
          label: "Layer blend live authored matte view",
        });
        const deepFloorTexture = engine.device.createTexture({
          label: `Layer blend Deep floor ${LAYER_BLEND_TILE_EXTENT}²`,
          size: {
            width: LAYER_BLEND_TILE_EXTENT,
            height: LAYER_BLEND_TILE_EXTENT,
            depthOrArrayLayers: 1,
          },
          format: scratchFormat,
          usage:
            GPUTextureUsage.RENDER_ATTACHMENT
            | GPUTextureUsage.TEXTURE_BINDING
            | GPUTextureUsage.COPY_DST,
        });
        transaction.deferRollback(() => deepFloorTexture.destroy());
        const deepFloorView = deepFloorTexture.createView({
          label: "Layer blend Deep floor view",
        });

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
                minBindingSize: LAYER_BLEND_FOLD_UNIFORM_BYTES,
              },
            },
            {
              binding: 3,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "float", viewDimension: "2d" },
            },
            {
              binding: 4,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "float", viewDimension: "2d" },
            },
            {
              binding: 5,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "float", viewDimension: "2d" },
            },
            {
              binding: 6,
              visibility: GPUShaderStage.FRAGMENT,
              texture: { sampleType: "float", viewDimension: "2d" },
            },
          ],
        });
        const presentLayout = engine.device.createBindGroupLayout({
          label: "Layer blend tile screen present layout",
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: "uniform", minBindingSize: 128 },
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
        ): Promise<GPURenderPipeline> => createRenderPipelineAsync(engine.device, {
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
        const layerBlendFoldShaderModule = engine.layerBlendFoldShaderModule;
        if (!layerBlendFoldShaderModule) {
          throw new Error("The advanced-fold shader is not initialized.");
        }
        const mixedSceneClearShaderModule = engine.mixedSceneClearShaderModule;
        if (!mixedSceneClearShaderModule) {
          throw new Error("The mixed-scene partial-clear shader is not initialized.");
        }
        const mixedScenePresentShaderModule = engine.mixedScenePresentShaderModule;
        const mixedSceneBackgroundBindGroupLayout = engine.mixedSceneBackgroundBindGroupLayout;
        if (
          !mixedScenePresentShaderModule
          || !mixedSceneBackgroundBindGroupLayout
          || !engine.mixedSceneBackgroundBindGroup
        ) {
          throw new Error("The document-background pipeline is not initialized.");
        }

        const pyramidLayout = engine.device.createBindGroupLayout({
          label: "Layer blend final pyramid present layout",
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: "uniform", minBindingSize: 128 },
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
        const [
          normalOverPipeline,
          normalAtopPipeline,
          advancedPipeline,
          documentMaskContributionPipeline,
          tileClearPipeline,
          tileBackgroundPipeline,
          tilePresentPipeline,
          mipOnePipeline,
          pyramidPresentPipeline,
        ] = await (async (): Promise<readonly GPURenderPipeline[]> => {
          const pipelineResults = await Promise.allSettled([
            pipeline(
              "Layer blend tile Normal source-over",
              normalLayout,
              engine.layerCompositeShaderModule,
              "fragmentMain",
              scratchFormat,
              sourceOverBlend,
            ),
            pipeline(
              "Layer blend tile Normal source-atop",
              normalLayout,
              engine.layerCompositeShaderModule,
              "fragmentMain",
              scratchFormat,
              sourceAtopBlend,
            ),
            pipeline(
              "Layer blend tile advanced fold",
              advancedLayout,
              layerBlendFoldShaderModule,
              "fragmentMain",
              scratchFormat,
            ),
            pipeline(
              "Layer blend tile document-mask contribution",
              advancedLayout,
              layerBlendFoldShaderModule,
              "documentMaskContributionFragmentMain",
              scratchFormat,
              sourceOverBlend,
            ),
            createRenderPipelineAsync(engine.device, {
              label: "Layer blend tile bounded transparent clear",
              layout: engine.device.createPipelineLayout({
                label: "Layer blend tile bounded transparent clear pipeline layout",
                bindGroupLayouts: [],
              }),
              vertex: {
                module: mixedSceneClearShaderModule,
                entryPoint: "vertexMain",
              },
              fragment: {
                module: mixedSceneClearShaderModule,
                entryPoint: "fragmentMain",
                targets: [{ format: scratchFormat }],
              },
              primitive: { topology: "triangle-list" },
            }),
            createRenderPipelineAsync(engine.device, {
              label: "Layer blend tile bounded document background",
              layout: engine.device.createPipelineLayout({
                label: "Layer blend tile bounded document background pipeline layout",
                bindGroupLayouts: [mixedSceneBackgroundBindGroupLayout],
              }),
              vertex: {
                module: mixedScenePresentShaderModule,
                entryPoint: "vertexMain",
              },
              fragment: {
                module: mixedScenePresentShaderModule,
                entryPoint: "storageBackgroundFragmentMain",
                targets: [{ format: scratchFormat }],
              },
              primitive: { topology: "triangle-list" },
            }),
            pipeline(
              "Layer blend tile to linear presentation",
              presentLayout,
              presentShader,
              "fragmentMain",
              "rgba16float",
            ),
            pipeline(
              "Layer blend tile exact mip 1",
              mipLayout,
              mipShader,
              "fragmentMain",
              engine.layerFormat,
            ),
            pipeline(
              "Layer blend final pyramid to linear presentation",
              pyramidLayout,
              pyramidShader,
              "fragmentMain",
              "rgba16float",
            ),
          ]);
          const pipelineErrors = pipelineResults.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : []);
          if (pipelineErrors.length > 0) {
            throw new AggregateError(
              pipelineErrors,
              "Layer blend pipeline creation failed.",
            );
          }
          return pipelineResults.map((result) => {
            if (result.status === "rejected") throw result.reason;
            return result.value;
          });
        })();
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
          scratchFormat,
          textures,
          views,
          bakeTexture,
          bakeView,
          documentMaskTexture,
          documentMaskView,
          clippingBaseTexture,
          clippingBaseView,
          authoredMatteTexture,
          authoredMatteView,
          deepFloorTexture,
          deepFloorView,
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
          documentMaskContributionPipeline,
          tileClearPipeline,
          tileBackgroundPipeline,
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

  clearDocumentMask(
    encoder: GPUCommandEncoder,
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
        view: this.documentMaskView,
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

  clearClippingBase(
    encoder: GPUCommandEncoder,
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
        view: this.clippingBaseView,
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

  encodeClippingBaseSeed(options: {
    encoder: GPUCommandEncoder;
    source: LayerBlendTileSource;
    tileDocumentRect: DirtyRect;
    localScissor: DirtyRect;
    label: string;
  }): void {
    this.assertAlive();
    const record = this.writeFoldRecord(
      options.tileDocumentRect,
      options.source,
      1,
      "normal",
      "source-over",
      null,
    );
    const pass = options.encoder.beginRenderPass({
      label: options.label,
      colorAttachments: [{
        view: this.clippingBaseView,
        loadOp: "load",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.normalOverPipeline);
    pass.setBindGroup(
      0,
      this.normalBindGroup(options.source.view, options.label),
      [record * this.foldUniformStride],
    );
    pass.setScissorRect(
      options.localScissor.x,
      options.localScissor.y,
      options.localScissor.width,
      options.localScissor.height,
    );
    pass.draw(3, 1, 0, 0);
    pass.end();
  }

  encodeDocumentMaskSeed(options: {
    encoder: GPUCommandEncoder;
    source: LayerBlendTileSource;
    tileDocumentRect: DirtyRect;
    localScissor: DirtyRect;
    label: string;
  }): void {
    this.assertAlive();
    const record = this.writeFoldRecord(
      options.tileDocumentRect,
      options.source,
      1,
      "normal",
      "source-over",
      null,
    );
    const pass = options.encoder.beginRenderPass({
      label: options.label,
      colorAttachments: [{
        view: this.documentMaskView,
        loadOp: "load",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.normalOverPipeline);
    pass.setBindGroup(
      0,
      this.normalBindGroup(options.source.view, options.label),
      [record * this.foldUniformStride],
    );
    pass.setScissorRect(
      options.localScissor.x,
      options.localScissor.y,
      options.localScissor.width,
      options.localScissor.height,
    );
    pass.draw(3, 1, 0, 0);
    pass.end();
  }

  encodeDocumentMaskContribution(options: {
    encoder: GPUCommandEncoder;
    backdropTile: 0 | 1 | 2;
    source: LayerBlendTileSource;
    tileDocumentRect: DirtyRect;
    localScissor: DirtyRect;
    opacity: number;
    mode: LayerBlendMode;
    composition: {
      readonly cutoutMode: LayerCutoutMode;
      readonly tonalBlend: LayerTonalBlend;
    };
    label: string;
  }): void {
    this.assertAlive();
    const clipping = options.source.clipping;
    if (!clipping || clipping.context !== "clipping-child") {
      throw new Error("Document-mask contribution requires clipping-child resources.");
    }
    const record = this.writeFoldRecord(
      options.tileDocumentRect,
      options.source,
      options.opacity,
      options.mode,
      "source-atop",
      options.composition,
    );
    const bindGroup = this.advancedBindGroup(
      options.source.view,
      options.source.cutoutView ?? options.source.view,
      clipping.baseView,
      this.engine.transparentLayerView,
      options.backdropTile,
      options.label,
    );
    const pass = options.encoder.beginRenderPass({
      label: options.label,
      colorAttachments: [{
        view: this.documentMaskView,
        loadOp: "load",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.documentMaskContributionPipeline);
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

  seedTileWithDocumentBackground(
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
    const color = this.engine.documentStorageColorSpace === "encoded-srgb-premultiplied"
      ? documentBackgroundEncodedSrgbPremultiplied(this.engine.documentBackground)
      : documentBackgroundLinearPremultiplied(this.engine.documentBackground);
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [{
        view: this.views[tileIndex],
        loadOp: clearsWholeTile ? "clear" : "load",
        storeOp: "store",
        clearValue: {
          r: color[0],
          g: color[1],
          b: color[2],
          a: color[3],
        },
      }],
    });
    if (!clearsWholeTile) {
      pass.setPipeline(this.tileBackgroundPipeline);
      pass.setBindGroup(0, this.engine.mixedSceneBackgroundBindGroup!);
      pass.setScissorRect(0, 0, boundedWidth, boundedHeight);
      pass.draw(3, 1, 0, 0);
    }
    pass.end();
  }

  seedDeepFloorWithDocumentBackground(
    encoder: GPUCommandEncoder,
    label: string,
  ): void {
    this.assertAlive();
    const color = this.engine.documentStorageColorSpace === "encoded-srgb-premultiplied"
      ? documentBackgroundEncodedSrgbPremultiplied(this.engine.documentBackground)
      : documentBackgroundLinearPremultiplied(this.engine.documentBackground);
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [{
        view: this.deepFloorView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: color[0], g: color[1], b: color[2], a: color[3] },
      }],
    });
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
    composition?: {
      readonly cutoutMode: LayerCutoutMode;
      readonly tonalBlend: LayerTonalBlend;
    } | null;
    label: string;
  }): void {
    this.assertAlive();
    const record = this.writeFoldRecord(
      options.tileDocumentRect,
      options.source,
      options.opacity,
      options.mode,
      options.operator,
      options.composition ?? null,
    );
    const advanced = options.mode !== "normal"
      || options.composition?.cutoutMode !== undefined
        && options.composition.cutoutMode !== "off"
      || options.composition?.tonalBlend !== undefined
        && !layerTonalBlendIsDefault(options.composition.tonalBlend)
      || options.source.clipping !== undefined;
    if (advanced && options.backdropTile === undefined) {
      throw new Error("Advanced fold requires the backdrop tile.");
    }
    if (advanced && options.backdropTile === options.targetTile) {
      throw new Error("Advanced fold cannot read from and write to the same tile.");
    }
    const bindGroup = advanced
      ? this.advancedBindGroup(
        options.source.view,
        options.source.cutoutView ?? options.source.view,
        options.source.clipping?.baseView ?? this.engine.transparentLayerView,
        options.source.clipping?.documentMaskView ?? this.engine.transparentLayerView,
        options.backdropTile!,
        options.label,
      )
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

  copyTileToDeepFloor(
    encoder: GPUCommandEncoder,
    sourceTile: 0 | 1 | 2,
    width: number,
    height: number,
  ): void {
    this.assertAlive();
    encoder.copyTextureToTexture(
      { texture: this.textures[sourceTile] },
      { texture: this.deepFloorTexture },
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
      throw new Error("Too many blend-presentation tiles in one frame.");
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
      throw new Error("Too many blend mip tiles in one frame.");
    }
    const record = this.mipRecordCount++;
    const word = record * (this.mipUniformStride / 4);
    this.mipUniformU32[word] = options.textureOrigin.x;
    this.mipUniformU32[word + 1] = options.textureOrigin.y;
    this.mipUniformU32[word + 2] = DOCUMENT_WIDTH;
    this.mipUniformU32[word + 3] = DOCUMENT_HEIGHT;
    this.mipUniformU32[word + 4] = this.engine.layerFormat === "rgba8unorm" ? 1 : 0;
    this.mipUniformU32[word + 5] = LAYER_BLEND_TILE_QUANTIZATION_SEED;
    this.mipUniformU32[word + 6] = 0;
    this.mipUniformU32[word + 7] = 0;
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
    this.bakeTexture.destroy();
    this.documentMaskTexture.destroy();
    this.clippingBaseTexture.destroy();
    this.authoredMatteTexture.destroy();
    this.deepFloorTexture.destroy();
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
    composition: {
      readonly cutoutMode: LayerCutoutMode;
      readonly tonalBlend: LayerTonalBlend;
    } | null,
  ): number {
    if (this.foldRecordCount >= FOLD_RECORD_CAPACITY) {
      throw new Error("Too many tile-blend folds in one frame.");
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
    const tonalBlend = composition?.tonalBlend ?? DEFAULT_LAYER_TONAL_BLEND;
    tonalBlend.current.forEach((value, index) => {
      this.foldUniformF32[word + 12 + index] = value / 255;
    });
    tonalBlend.underlying.forEach((value, index) => {
      this.foldUniformF32[word + 16 + index] = value / 255;
    });
    this.foldUniformU32[word + 20] = LAYER_CUTOUT_MODE_CODES[
      composition?.cutoutMode ?? "off"
    ];
    const clipping = source.clipping;
    this.foldUniformU32[word + 21] = LAYER_BLEND_FOLD_COMPOSITION_CONTEXT_CODES[
      clipping?.context ?? "direct"
    ];
    this.foldUniformF32[word + 22] = clipping?.baseScale ?? source.scale;
    this.foldUniformF32[word + 23] = Math.min(
      1,
      Math.max(0, clipping?.documentMaskOpacity ?? 1),
    );
    this.foldUniformF32[word + 24] = source.cutoutOrigin?.x ?? source.origin.x;
    this.foldUniformF32[word + 25] = source.cutoutOrigin?.y ?? source.origin.y;
    this.foldUniformF32[word + 26] = source.cutoutScale ?? source.scale;
    this.foldUniformF32[word + 27] = 0;
    this.foldUniformU32[word + 28] = source.cutoutWidth ?? source.width;
    this.foldUniformU32[word + 29] = source.cutoutHeight ?? source.height;
    this.foldUniformF32[word + 30] = clipping?.baseOrigin.x ?? source.origin.x;
    this.foldUniformF32[word + 31] = clipping?.baseOrigin.y ?? source.origin.y;
    this.foldUniformF32[word + 32] = clipping?.documentMaskOrigin.x ?? source.origin.x;
    this.foldUniformF32[word + 33] = clipping?.documentMaskOrigin.y ?? source.origin.y;
    this.foldUniformF32[word + 34] = clipping?.documentMaskScale ?? source.scale;
    this.foldUniformF32[word + 35] = 0;
    this.foldUniformU32[word + 36] = clipping?.documentMaskWidth ?? source.width;
    this.foldUniformU32[word + 37] = clipping?.documentMaskHeight ?? source.height;
    this.foldUniformU32[word + 38] = this.engine.documentStorageColorSpace
      === "encoded-srgb-premultiplied" ? 1 : 0;
    this.foldUniformU32[word + 39] = 0;
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
    cutoutView: GPUTextureView,
    clippingBaseView: GPUTextureView,
    documentMaskView: GPUTextureView,
    backdropTile: 0 | 1 | 2,
    label: string,
  ): GPUBindGroup {
    let byCutout = this.advancedFrameBindGroups.get(sourceView);
    if (!byCutout) {
      byCutout = new Map();
      this.advancedFrameBindGroups.set(sourceView, byCutout);
    }
    let byBase = byCutout.get(cutoutView);
    if (!byBase) {
      byBase = new Map();
      byCutout.set(cutoutView, byBase);
    }
    let byMask = byBase.get(clippingBaseView);
    if (!byMask) {
      byMask = new Map();
      byBase.set(clippingBaseView, byMask);
    }
    let byBackdrop = byMask.get(documentMaskView);
    if (!byBackdrop) {
      byBackdrop = new Map();
      byMask.set(documentMaskView, byBackdrop);
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
            size: LAYER_BLEND_FOLD_UNIFORM_BYTES,
          },
        },
        { binding: 3, resource: cutoutView },
        { binding: 4, resource: clippingBaseView },
        { binding: 5, resource: documentMaskView },
        { binding: 6, resource: this.deepFloorView },
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
      throw new Error("The tile-blend compositor has already been destroyed.");
    }
  }
}
