import type { EngineStats } from "./engine-stats";
import type { LayerBlendMode } from "./layer-blend-modes";
import {
  normalizeLayerContentOpacity,
  normalizeLayerCutoutMode,
  normalizeLayerTonalBlend,
  type LayerCutoutMode,
  type LayerTonalBlend,
} from "./layer-composition";
import type { MixedSceneItem } from "./mixed-scene-stack";

export type SceneLayerKey = MixedSceneItem["key"];
export type SceneLayerKind = "raster" | "text" | "svg" | "image";

export interface SceneLayerProperties {
  readonly key: SceneLayerKey;
  readonly name: string;
  readonly kind: SceneLayerKind;
  readonly opacity: number;
  readonly blendMode: LayerBlendMode | null;
  readonly contentOpacity: number | null;
  readonly cutoutMode: LayerCutoutMode | null;
  readonly tonalBlend: LayerTonalBlend | null;
  readonly rasterIndex: number | null;
  readonly semanticId: number | null;
  readonly clippingEnabled: boolean;
  readonly clippingAvailable: boolean;
  readonly locked: boolean;
}

export function sceneLayerDisplayName(name: string): string {
  return name
    // Keep old localized default names readable without shipping them as UI copy.
    .replace(/^\u004c\u0069\u0076\u0065\u006c\u006c\u006f (?=\d+$)/, "Layer ")
    .replace(/^\u004d\u0061\u0073\u0063\u0068\u0065\u0072\u0061 \u0072\u0069\u0074\u0061\u0067\u006c\u0069\u006f (?=\d+$)/, "Clipping Mask ")
    .replace(/^\u0054\u0065\u0073\u0074\u006f (?=\d+$)/, "Text ")
    .replace(/^\u0049\u006d\u006d\u0061\u0067\u0069\u006e\u0065 (?=\d+$)/, "Image ")
    .replace(/^\u0049\u006d\u006d\u0061\u0067\u0069\u006e\u0065 \u0072\u0061\u0073\u0074\u0065\u0072$/, "Raster Image");
}

export function isSceneLayerKey(key: string): key is SceneLayerKey {
  return /^(?:raster|text|svg|image):\d+$/.test(key);
}

export function rasterIndexForSceneLayerKey(
  stats: EngineStats,
  key: SceneLayerKey,
): number {
  const sceneItem = stats.mixedScene?.items.find((item) => item.key === key);
  if (sceneItem) return sceneItem.kind === "raster" ? sceneItem.rasterLayerIndex : -1;
  return stats.layers.findIndex((layer) => `raster:${layer.id}` === key);
}

export function selectedSceneLayerProperties(
  stats: EngineStats,
  locked: boolean,
  requestedKey: string | null = null,
): SceneLayerProperties | null {
  const scene = stats.mixedScene;
  if (!scene) {
    const active = stats.layers[stats.activeLayerIndex];
    const key = requestedKey ?? (active ? `raster:${active.id}` : null);
    if (!key || !isSceneLayerKey(key)) return null;
    const rasterIndex = rasterIndexForSceneLayerKey(stats, key);
    const layer = stats.layers[rasterIndex];
    if (!layer) return null;
    const clippingEnabled = layer.clippingParentId !== null;
    return {
      key,
      name: sceneLayerDisplayName(layer.name),
      kind: "raster",
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      contentOpacity: normalizeLayerContentOpacity(layer.contentOpacity),
      cutoutMode: normalizeLayerCutoutMode(layer.cutoutMode),
      tonalBlend: normalizeLayerTonalBlend(layer.tonalBlend),
      rasterIndex,
      semanticId: null,
      clippingEnabled,
      clippingAvailable: clippingEnabled || rasterIndex > 0,
      locked,
    };
  }

  const key = requestedKey ?? scene.selectedKey;
  if (!isSceneLayerKey(key)) return null;
  const sceneIndex = scene.items.findIndex((item) => item.key === key);
  const item = scene.items[sceneIndex];
  if (!item) return null;
  if (item.kind === "raster") {
    const layer = stats.layers[item.rasterLayerIndex];
    if (!layer) return null;
    const clippingEnabled = item.rasterClippingParentId !== null;
    const hasAdjacentRasterBelow = sceneIndex > 0
      && scene.items[sceneIndex - 1]?.kind === "raster";
    return {
      key,
      name: sceneLayerDisplayName(layer.name),
      kind: "raster",
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      contentOpacity: normalizeLayerContentOpacity(layer.contentOpacity),
      cutoutMode: normalizeLayerCutoutMode(layer.cutoutMode),
      tonalBlend: normalizeLayerTonalBlend(layer.tonalBlend),
      rasterIndex: item.rasterLayerIndex,
      semanticId: null,
      clippingEnabled,
      clippingAvailable: clippingEnabled || hasAdjacentRasterBelow,
      locked,
    };
  }

  const node = item.kind === "text"
    ? item.textNode
    : item.kind === "svg"
      ? item.svgNode
      : item.imageNode;
  return {
    key,
    name: sceneLayerDisplayName(node.name),
    kind: item.kind,
    opacity: node.opacity,
    blendMode: null,
    contentOpacity: null,
    cutoutMode: null,
    tonalBlend: null,
    rasterIndex: null,
    semanticId: node.id,
    clippingEnabled: false,
    clippingAvailable: false,
    locked,
  };
}
