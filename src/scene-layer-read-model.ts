import type { EngineStats } from "./engine-stats";
import type { LayerBlendMode } from "./layer-blend-modes";
import type { MixedSceneItem } from "./mixed-scene-stack";

export type SceneLayerKey = MixedSceneItem["key"];
export type SceneLayerKind = "raster" | "text" | "svg" | "image";

export interface SceneLayerProperties {
  readonly key: SceneLayerKey;
  readonly name: string;
  readonly kind: SceneLayerKind;
  readonly opacity: number;
  readonly blendMode: LayerBlendMode | null;
  readonly rasterIndex: number | null;
  readonly semanticId: number | null;
  readonly clippingEnabled: boolean;
  readonly clippingAvailable: boolean;
  readonly locked: boolean;
}

export function sceneLayerDisplayName(name: string): string {
  return name
    .replace(/^Livello (?=\d+$)/, "Layer ")
    .replace(/^Maschera ritaglio (?=\d+$)/, "Clipping Mask ")
    .replace(/^Testo (?=\d+$)/, "Text ")
    .replace(/^Immagine (?=\d+$)/, "Image ")
    .replace(/^Immagine raster$/, "Raster Image");
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
    rasterIndex: null,
    semanticId: node.id,
    clippingEnabled: false,
    clippingAvailable: false,
    locked,
  };
}
