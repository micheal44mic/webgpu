/**
 * Risorse GPU condivise dal pennello: maschera Shape, texture Grain e set di
 * risorse della sessione Light Glaze.
 */
import type { LightGlazeStorageMode, ShapeMaskDecodeStrategy } from "./engine-strategies";
import type { DirtyRect } from "./engine-stroke-types";
import type {
  BrushGrainAssetId,
  BrushSettings,
  BrushShapeAssetId,
} from "./engine-types";

export interface LightGlazeSession {
  historyActionId: number;
  settings: BrushSettings;
  /** Union of temporary and authoritative pixels touched while presenting. */
  dirtyRect: DirtyRect | null;
  /** Only stamps that will be retained in history and committed at lift. */
  authoritativeDirtyRect: DirtyRect | null;
  needsClear: boolean;
  hasContent: boolean;
  endRequested: boolean;
  commitRequested: boolean;
  mipValidThroughLevel: number;
  tintLinear: [number, number, number] | null;
}

export interface LightGlazeResourceSet {
  storageMode: LightGlazeStorageMode;
  texture: GPUTexture;
  compositeMipTexture: GPUTexture;
  view: GPUTextureView;
  samplingView: GPUTextureView;
  compositeMipViews: GPUTextureView[];
  downsampleBindGroups: GPUBindGroup[];
  compositeMipBindGroup: GPUBindGroup;
  displayBindGroup: GPUBindGroup;
  compositeBindGroup: GPUBindGroup;
  commitTileTexture: GPUTexture | null;
  commitTileView: GPUTextureView | null;
  commitTileBindGroup: GPUBindGroup | null;
}

export interface ShapeMaskResources {
  assetId: BrushShapeAssetId;
  texture: GPUTexture;
  decodeStrategy: ShapeMaskDecodeStrategy;
  identity: number;
  occupancyWords: Uint32Array;
  occupancyActiveCells: number[];
  occupancyCoverageRatios: number[];
  previewSprite: HTMLCanvasElement;
}

export interface GrainTextureResources {
  assetId: BrushGrainAssetId;
  texture: GPUTexture;
  identity: number;
  width: number;
  height: number;
  mipLevelCount: number;
  memoryBytes: number;
  previewSprite: HTMLCanvasElement;
  decodeMs: number;
  mipBuildMs: number;
  uploadMs: number;
}

export function destroyLightGlazeResourceSet(resources: LightGlazeResourceSet | null): void {
  resources?.commitTileTexture?.destroy();
  resources?.compositeMipTexture.destroy();
  resources?.texture.destroy();
}
