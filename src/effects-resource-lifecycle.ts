import type {
  HistoryAction,
  RasterLayerMetadataHistoryState,
} from "./engine-history-types";

export interface RasterEffectStyleOwner {
  readonly id: number;
  readonly strokeStyle: {
    readonly enabled: boolean;
    readonly width: number;
  };
  readonly bevelStyle: {
    readonly enabled: boolean;
  };
  readonly outerShadowStyle: {
    readonly enabled: boolean;
  };
  readonly innerShadowStyle: {
    readonly enabled: boolean;
  };
  readonly colorOverlayStyle: {
    readonly enabled: boolean;
    readonly opacity: number;
  };
}

export interface RasterEffectRendererReachability {
  readonly stroke: boolean;
  readonly bevel: boolean;
  readonly outerShadow: boolean;
  readonly innerShadow: boolean;
}

interface MutableRasterEffectRendererReachability {
  stroke: boolean;
  bevel: boolean;
  outerShadow: boolean;
  innerShadow: boolean;
}

function includeStroke(
  target: MutableRasterEffectRendererReachability,
  style: { readonly enabled: boolean; readonly width: number },
): void {
  if (style.enabled && style.width > 0) target.stroke = true;
}

function includeBevel(
  target: MutableRasterEffectRendererReachability,
  style: { readonly enabled: boolean },
): void {
  if (!style.enabled) return;
  target.bevel = true;
  target.stroke = true;
}

function includeOuterShadow(
  target: MutableRasterEffectRendererReachability,
  style: { readonly enabled: boolean },
): void {
  if (!style.enabled) return;
  target.outerShadow = true;
  target.stroke = true;
}

function includeInnerShadow(
  target: MutableRasterEffectRendererReachability,
  style: { readonly enabled: boolean },
): void {
  if (!style.enabled) return;
  target.innerShadow = true;
  target.stroke = true;
}

function includeColorOverlay(
  target: MutableRasterEffectRendererReachability,
  style: { readonly enabled: boolean; readonly opacity: number },
): void {
  if (style.enabled && style.opacity > 0) target.stroke = true;
}

function includeStyleOwner(
  target: MutableRasterEffectRendererReachability,
  owner: RasterEffectStyleOwner,
): void {
  includeStroke(target, owner.strokeStyle);
  includeBevel(target, owner.bevelStyle);
  includeOuterShadow(target, owner.outerShadowStyle);
  includeInnerShadow(target, owner.innerShadowStyle);
  includeColorOverlay(target, owner.colorOverlayStyle);
}

function includeMetadataAction(
  target: MutableRasterEffectRendererReachability,
  action: Extract<HistoryAction, { kind: "layer-metadata" }>,
): void {
  switch (action.property) {
    case "stroke":
      includeStroke(target, action.before);
      includeStroke(target, action.after);
      return;
    case "bevel":
      includeBevel(target, action.before);
      includeBevel(target, action.after);
      return;
    case "outer-shadow":
      includeOuterShadow(target, action.before);
      includeOuterShadow(target, action.after);
      return;
    case "inner-shadow":
      includeInnerShadow(target, action.before);
      includeInnerShadow(target, action.after);
      return;
    case "color-overlay":
      includeColorOverlay(target, action.before);
      includeColorOverlay(target, action.after);
      return;
    case "visibility":
    case "opacity":
    case "clipping":
      return;
  }
}

function includeOpenMetadataEdit(
  target: MutableRasterEffectRendererReachability,
  edit: RasterLayerMetadataHistoryState,
): void {
  switch (edit.property) {
    case "stroke":
      includeStroke(target, edit.value);
      return;
    case "bevel":
      includeBevel(target, edit.value);
      return;
    case "outer-shadow":
      includeOuterShadow(target, edit.value);
      return;
    case "inner-shadow":
      includeInnerShadow(target, edit.value);
      return;
    case "color-overlay":
      includeColorOverlay(target, edit.value);
      return;
    case "visibility":
    case "opacity":
    case "clipping":
      return;
  }
}

/**
 * Finds every effect renderer that can still be reached without creating a
 * new document action. Live layer records cover the current document; both
 * sides of retained metadata deltas and detached layer records cover every
 * state that Undo/Redo can still restore. Actions already cut from Redo are
 * deliberately absent from `historyActions`, so they stop retaining caches
 * immediately even if their seed cleanup continues incrementally.
 */
export function rasterEffectRendererReachability(
  liveLayers: readonly RasterEffectStyleOwner[],
  historyActions: readonly HistoryAction[],
  openMetadataEdit: RasterLayerMetadataHistoryState | null = null,
  historyFloorCursor = 0,
): RasterEffectRendererReachability {
  const reachable: MutableRasterEffectRendererReachability = {
    stroke: false,
    bevel: false,
    outerShadow: false,
    innerShadow: false,
  };

  const reachableLayerIds = new Set<number>();
  for (const layer of liveLayers) {
    reachableLayerIds.add(layer.id);
    includeStyleOwner(reachable, layer);
  }
  const retainedStart = Math.max(
    0,
    Math.min(historyActions.length, Math.trunc(historyFloorCursor)),
  );
  // Discover restorable records first. A metadata action for a layer that is
  // neither live nor owned by a retained structural action is an orphan: the
  // history gate cannot cross it, so it must not pin a renderer forever.
  for (let index = retainedStart; index < historyActions.length; index += 1) {
    const action = historyActions[index];
    if (
      action.kind === "vector-rasterize"
      || action.kind === "raster-import"
      || action.kind === "layer-add"
    ) {
      reachableLayerIds.add(action.layerRecord.id);
      includeStyleOwner(reachable, action.layerRecord);
    } else if (action.kind === "layer-delete") {
      for (const entry of action.entries) {
        reachableLayerIds.add(entry.layerRecord.id);
        includeStyleOwner(reachable, entry.layerRecord);
      }
    }
  }
  for (let index = retainedStart; index < historyActions.length; index += 1) {
    const action = historyActions[index];
    if (
      action.kind === "layer-metadata"
      && reachableLayerIds.has(action.layerId)
    ) {
      includeMetadataAction(reachable, action);
    }
  }
  if (openMetadataEdit && reachableLayerIds.has(openMetadataEdit.layerId)) {
    includeOpenMetadataEdit(reachable, openMetadataEdit);
  }
  return reachable;
}
