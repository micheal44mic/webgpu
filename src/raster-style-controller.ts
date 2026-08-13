import type {
  BrushEngine,
  RasterBevelStyle,
  RasterInnerShadowStyle,
  RasterOuterShadowStyle,
  RasterStrokeStyle,
} from "./brush-engine";
import type { RasterColorOverlayStyle } from "./raster-color-overlay-core";
import type { NonDestructiveRasterEffectKind } from "./raster-effects-contract.ts";

export type RasterStyleEnginePort = Pick<
  BrushEngine,
  | "getMixedSceneSnapshot"
  | "canPaintSelectedSceneItem"
  | "getRasterColorOverlayStyle"
  | "getRasterStrokeStyle"
  | "getRasterOuterShadowStyle"
  | "getRasterInnerShadowStyle"
  | "getRasterBevelStyle"
  | "setRasterColorOverlayStyle"
  | "setRasterStrokeStyle"
  | "setRasterOuterShadowStyle"
  | "setRasterInnerShadowStyle"
  | "setRasterBevelStyle"
>;

export interface RasterStyleControllerOptions {
  readonly engine: RasterStyleEnginePort;
  readonly isEngineReady: () => boolean;
  readonly isPointerActive: () => boolean;
  readonly onBusyChange: () => void;
}

/** Owns guarded, asynchronous mutations of non-destructive raster metadata. */
export class RasterStyleController {
  private readonly options: RasterStyleControllerOptions;
  private readonly busyKinds = new Set<NonDestructiveRasterEffectKind>();

  constructor(options: RasterStyleControllerOptions) {
    this.options = options;
  }

  get isBusy(): boolean {
    return this.busyKinds.size > 0;
  }

  colorOverlayTargetIsSelected(): boolean {
    return this.options.engine.getMixedSceneSnapshot() === null
      || this.options.engine.canPaintSelectedSceneItem();
  }

  effectEnabled(kind: NonDestructiveRasterEffectKind): boolean {
    if (kind === "color-overlay") return this.getColorOverlayStyle().enabled;
    if (kind === "stroke") return this.getStrokeStyle().enabled;
    if (kind === "outer-shadow") return this.getOuterShadowStyle().enabled;
    if (kind === "inner-shadow") return this.getInnerShadowStyle().enabled;
    return this.getBevelStyle().enabled;
  }

  getColorOverlayStyle(): RasterColorOverlayStyle {
    return this.options.engine.getRasterColorOverlayStyle();
  }

  getStrokeStyle(): RasterStrokeStyle {
    return this.options.engine.getRasterStrokeStyle();
  }

  getOuterShadowStyle(): RasterOuterShadowStyle {
    return this.options.engine.getRasterOuterShadowStyle();
  }

  getInnerShadowStyle(): RasterInnerShadowStyle {
    return this.options.engine.getRasterInnerShadowStyle();
  }

  getBevelStyle(): RasterBevelStyle {
    return this.options.engine.getRasterBevelStyle();
  }

  applyColorOverlayStyle(style: RasterColorOverlayStyle): Promise<boolean> {
    return this.apply(
      "color-overlay",
      () => this.options.engine.setRasterColorOverlayStyle(style),
      true,
    );
  }

  applyStrokeStyle(style: RasterStrokeStyle): Promise<boolean> {
    return this.apply("stroke", () => this.options.engine.setRasterStrokeStyle(style));
  }

  applyOuterShadowStyle(style: RasterOuterShadowStyle): Promise<boolean> {
    return this.apply(
      "outer-shadow",
      () => this.options.engine.setRasterOuterShadowStyle(style),
    );
  }

  applyInnerShadowStyle(style: RasterInnerShadowStyle): Promise<boolean> {
    return this.apply(
      "inner-shadow",
      () => this.options.engine.setRasterInnerShadowStyle(style),
    );
  }

  applyBevelStyle(style: RasterBevelStyle): Promise<boolean> {
    return this.apply("bevel", () => this.options.engine.setRasterBevelStyle(style));
  }

  private async apply(
    kind: NonDestructiveRasterEffectKind,
    mutation: () => Promise<boolean>,
    requiresSelectedTarget = false,
  ): Promise<boolean> {
    if (
      !this.options.isEngineReady()
      || this.busyKinds.has(kind)
      || this.options.isPointerActive()
      || (requiresSelectedTarget && !this.colorOverlayTargetIsSelected())
    ) {
      return false;
    }
    this.busyKinds.add(kind);
    this.options.onBusyChange();
    try {
      return await mutation();
    } catch {
      return false;
    } finally {
      this.busyKinds.delete(kind);
      this.options.onBusyChange();
    }
  }
}
