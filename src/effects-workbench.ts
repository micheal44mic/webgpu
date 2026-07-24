import type { RasterBevelRenderer } from "./bevel-renderer";
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

  attachStrokeRenderer(renderer: RasterStrokeRenderer): void {
    if (this._strokeRenderer && this._strokeRenderer !== renderer) {
      throw new Error("Il working set possiede già un renderer Traccia.");
    }
    this._strokeRenderer = renderer;
  }

  attachBevelRenderer(renderer: RasterBevelRenderer): void {
    if (this._bevelRenderer && this._bevelRenderer !== renderer) {
      throw new Error("Il working set possiede già un renderer Smusso.");
    }
    this._bevelRenderer = renderer;
  }

  releaseStrokeRenderer(): void {
    this._strokeRenderer?.destroy();
    this._strokeRenderer = null;
  }

  releaseBevelRenderer(): void {
    this._bevelRenderer?.destroy();
    this._bevelRenderer = null;
  }

  retarget(source: EffectsLayerSource): number {
    if (source.format !== this.source.format) {
      throw new Error(
        `Formato working set ${this.source.format} incompatibile con ${source.format}; `
        + "serve la ricreazione completa delle risorse layer.",
      );
    }
    this._bevelRenderer?.retarget(source.view);
    this._strokeRenderer?.retarget(source.view, source.format);
    this.source = { ...source };
    this._generation += 1;
    return this._generation;
  }

  destroy(): void {
    this.releaseStrokeRenderer();
    this.releaseBevelRenderer();
    this.scratchPool.destroy();
  }
}
