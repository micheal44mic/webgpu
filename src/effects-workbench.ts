import type { RasterBevelRenderer } from "./bevel-renderer";
import type { RasterShadowRenderer } from "./shadow-renderer";
import type { RasterStrokeRenderer } from "./stroke-renderer";
import { EffectsScratchPool } from "./effects-scratch-pool";

export const EFFECTS_WORKING_SET_STRATEGY =
  "single-retargetable-active-layer-source" as const;

export type EffectsLayerFormat = "rgba8unorm" | "rgba16float";

export interface EffectsLayerSource {
  view: GPUTextureView;
  format: EffectsLayerFormat;
}
export interface EffectsWorkbenchOptions extends EffectsLayerSource {
  device: GPUDevice;
  canReallocateScratch?: () => boolean;
  /** Session high-water mark carried over when the workbench is recreated. */
  initialScratchPeakBytes?: number;
}


/**
 * Owns the one reusable set of derived effect resources. The engine remains
 * responsible for scheduling clear/rebuild work after a source retarget.
 */
export class EffectsWorkbench {
  private source: EffectsLayerSource;
  private _generation = 0;
  private _strokeRenderer: RasterStrokeRenderer | null = null;
  private _bevelRenderer: RasterBevelRenderer | null = null;
  private _outerShadowRenderer: RasterShadowRenderer | null = null;
  private _innerShadowRenderer: RasterShadowRenderer | null = null;

  readonly scratchPool: EffectsScratchPool;
  constructor(options: EffectsWorkbenchOptions) {
    this.source = { view: options.view, format: options.format };
    this.scratchPool = new EffectsScratchPool(options.device, {
      canReallocate: options.canReallocateScratch,
      initialPeakBytes: options.initialScratchPeakBytes,
    });
  }

  get sourceView(): GPUTextureView {
    return this.source.view;
  }

  get sourceFormat(): EffectsLayerFormat {
    return this.source.format;
  }

  get generation(): number {
    return this._generation;
  }

  get strokeRenderer(): RasterStrokeRenderer | null {
    return this._strokeRenderer;
  }

  get bevelRenderer(): RasterBevelRenderer | null {
    return this._bevelRenderer;
  }

  get outerShadowRenderer(): RasterShadowRenderer | null {
    return this._outerShadowRenderer;
  }

  get innerShadowRenderer(): RasterShadowRenderer | null {
    return this._innerShadowRenderer;
  }

  attachStrokeRenderer(renderer: RasterStrokeRenderer): void {
    if (this._strokeRenderer && this._strokeRenderer !== renderer) {
      throw new Error("The working set already owns a Stroke renderer.");
    }
    this._strokeRenderer = renderer;
  }

  attachBevelRenderer(renderer: RasterBevelRenderer): void {
    if (this._bevelRenderer && this._bevelRenderer !== renderer) {
      throw new Error("The working set already owns a Bevel renderer.");
    }
    this._bevelRenderer = renderer;
  }

  attachOuterShadowRenderer(renderer: RasterShadowRenderer): void {
    if (renderer.kind !== "outer") {
      throw new Error("The assigned Outer Shadow renderer has the wrong type.");
    }
    if (this._outerShadowRenderer && this._outerShadowRenderer !== renderer) {
      throw new Error("The working set already owns an Outer Shadow renderer.");
    }
    this._outerShadowRenderer = renderer;
  }

  attachInnerShadowRenderer(renderer: RasterShadowRenderer): void {
    if (renderer.kind !== "inner") {
      throw new Error("The assigned Inner Shadow renderer has the wrong type.");
    }
    if (this._innerShadowRenderer && this._innerShadowRenderer !== renderer) {
      throw new Error("The working set already owns an Inner Shadow renderer.");
    }
    this._innerShadowRenderer = renderer;
  }

  releaseStrokeRenderer(): void {
    this._strokeRenderer?.destroy();
    this._strokeRenderer = null;
  }

  releaseBevelRenderer(): void {
    this._bevelRenderer?.destroy();
    this._bevelRenderer = null;
  }

  releaseOuterShadowRenderer(): void {
    this._outerShadowRenderer?.destroy();
    this._outerShadowRenderer = null;
  }

  releaseInnerShadowRenderer(): void {
    this._innerShadowRenderer?.destroy();
    this._innerShadowRenderer = null;
  }

  retarget(source: EffectsLayerSource): number {
    if (source.format !== this.source.format) {
      throw new Error(
        `Working set format ${this.source.format} is incompatible with ${source.format}; `
        + "the layer resources must be fully recreated.",
      );
    }
    this._outerShadowRenderer?.retarget(source.view);
    this._innerShadowRenderer?.retarget(source.view);
    this._bevelRenderer?.retarget(source.view);
    this._strokeRenderer?.retarget(source.view, source.format);
    this.source = { ...source };
    this._generation += 1;
    return this._generation;
  }

  destroy(): void {
    this.releaseStrokeRenderer();
    this.releaseBevelRenderer();
    this.releaseOuterShadowRenderer();
    this.releaseInnerShadowRenderer();
    this.scratchPool.destroy();
  }
}
