import type { BrushEngine } from "./brush-engine";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH } from "./engine-limits";
import type { DirtyRect } from "./engine-stroke-types";
import type { MixedSceneActivePresentation } from "./engine-vector-text-resources";
import {
  layerDirtyRectToPresentationRect,
} from "./engine-layer-runtime";
import {
  ensureRasterStrokeRenderer,
  releaseRasterStrokeRenderer,
} from "./engine-resource-setup";
import {
  LayerBlendTileCompositor,
  type LayerBlendTileSource,
} from "./layer-blend-tile-compositor";
import type { LayerBlendMode } from "./layer-blend-modes";
import type { MixedSceneCompositionSegment } from "./mixed-scene-stack";
import { runGpuAllocationTransaction } from "./gpu-allocation-transaction";

export const LIVE_LAYER_BLEND_PRESENTATION_STRATEGY =
  "raster-only-document-space-tile-compose-before-filter-replace-cache-live-v2" as const;

const TILE_INDEX_A = 0 as const;
const TILE_INDEX_B = 1 as const;
const TILE_INDEX_SOURCE = 2 as const;

const clampDocumentRect = (rect: DirtyRect): DirtyRect | null => {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const right = Math.min(DOCUMENT_WIDTH, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(DOCUMENT_HEIGHT, Math.ceil(rect.y + rect.height));
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
};

const intersectRects = (left: DirtyRect, right: DirtyRect): DirtyRect | null => {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const maximumX = Math.min(left.x + left.width, right.x + right.width);
  const maximumY = Math.min(left.y + left.height, right.y + right.height);
  return maximumX > x && maximumY > y
    ? { x, y, width: maximumX - x, height: maximumY - y }
    : null;
};

const expandRect = (rect: DirtyRect, amount: number): DirtyRect => ({
  x: rect.x - amount,
  y: rect.y - amount,
  width: rect.width + amount * 2,
  height: rect.height + amount * 2,
});

const sourceBounds = (source: LayerBlendTileSource): DirtyRect => ({
  x: source.origin.x,
  y: source.origin.y,
  width: source.width / Math.max(1, source.scale),
  height: source.height / Math.max(1, source.scale),
});

const localRect = (documentRect: DirtyRect, tileRect: DirtyRect): DirtyRect => ({
  x: Math.max(0, Math.floor(documentRect.x - tileRect.x)),
  y: Math.max(0, Math.floor(documentRect.y - tileRect.y)),
  width: Math.max(0, Math.ceil(documentRect.width)),
  height: Math.max(0, Math.ceil(documentRect.height)),
});

const sourceForSurface = (
  surface: {
    samplingView: GPUTextureView;
    bounds: DirtyRect;
    resolutionScale: number;
    textureWidth: number;
    textureHeight: number;
  },
): LayerBlendTileSource => ({
  view: surface.samplingView,
  origin: { x: surface.bounds.x, y: surface.bounds.y },
  scale: surface.resolutionScale,
  width: surface.textureWidth,
  height: surface.textureHeight,
});

export function layerBlendTilePresentationRequired(engine: BrushEngine): boolean {
  return Boolean(engine.mixedSceneStack)
    && !engine.mixedSceneStack!.visibleSemanticCount
    && engine.layerStack.layers.some((record) => record.blendMode !== "normal");
}

export async function ensureLayerBlendTilePresentationResources(
  engine: BrushEngine,
): Promise<void> {
  if (
    engine.layerBlendTileCompositor
    && engine.layerBlendTileCompositor.format === engine.layerFormat
  ) {
    if (!engine.rasterStrokeRenderer) {
      await runGpuAllocationTransaction(
        engine.device,
        "Renderer Traccia per fusione livello",
        async (transaction) => {
          transaction.deferRollback(() => releaseRasterStrokeRenderer(engine, true));
          await ensureRasterStrokeRenderer(
            engine,
            engine.rasterStrokeStyle.width,
            engine.rasterStrokeStyle.enabled && engine.rasterStrokeStyle.width > 0,
          );
        },
      );
    }
    return;
  }
  const oldCompositor = engine.layerBlendTileCompositor;
  const compositor = await LayerBlendTileCompositor.create(engine);
  try {
    await runGpuAllocationTransaction(
      engine.device,
      "Renderer Traccia per compositore fusione livello",
      async (transaction) => {
        const hadRenderer = engine.rasterStrokeRenderer !== null;
        if (!hadRenderer) {
          transaction.deferRollback(() => releaseRasterStrokeRenderer(engine, true));
        }
        await ensureRasterStrokeRenderer(
          engine,
          engine.rasterStrokeStyle.width,
          engine.rasterStrokeStyle.enabled && engine.rasterStrokeStyle.width > 0,
        );
      },
    );
    engine.layerBlendTileCompositor = compositor;
    oldCompositor?.destroy();
  } catch (error) {
    compositor.destroy();
    throw error;
  }
}

export function releaseLayerBlendTilePresentationResources(engine: BrushEngine): void {
  engine.layerBlendTileCompositor?.destroy();
  engine.layerBlendTileCompositor = null;
  if (!engine.styleStackNeedsCompositor()) {
    releaseRasterStrokeRenderer(engine);
  }
}

function staticSegmentSource(
  engine: BrushEngine,
  segment: MixedSceneCompositionSegment,
): LayerBlendTileSource | null {
  if (segment.kind !== "raster-run") {
    return null;
  }
  const resources = engine.mixedSceneRasterSegments.find(
    (candidate) => candidate.key === segment.key,
  );
  if (!resources) {
    return null;
  }
  return sourceForSurface(resources.surface);
}

function activeSourceMode(
  activePresentation: MixedSceneActivePresentation,
): "permanent" | "light-glaze" | "thickness-tail" {
  if (activePresentation.kind === "raster-stroke") {
    return activePresentation.sourceMode;
  }
  if (activePresentation.kind === "light-glaze") {
    return "light-glaze";
  }
  if (activePresentation.kind === "thickness-tail") {
    return "thickness-tail";
  }
  return "permanent";
}

function alignedMipRect(rect: DirtyRect): DirtyRect | null {
  // WebGPU mip dimensions use floor(base / 2). An odd final document column or
  // row has no texel in mip 1, so it must not produce a fractional scissor or
  // fail the even-core invariant below.
  const mipSourceWidth = DOCUMENT_WIDTH - (DOCUMENT_WIDTH % 2);
  const mipSourceHeight = DOCUMENT_HEIGHT - (DOCUMENT_HEIGHT % 2);
  const x = Math.max(0, Math.floor(rect.x / 2) * 2);
  const y = Math.max(0, Math.floor(rect.y / 2) * 2);
  const right = Math.min(mipSourceWidth, Math.ceil((rect.x + rect.width) / 2) * 2);
  const bottom = Math.min(mipSourceHeight, Math.ceil((rect.y + rect.height) / 2) * 2);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}

function alignedTileCores(rect: DirtyRect, coreExtent: number): DirtyRect[] {
  const result: DirtyRect[] = [];
  const startX = Math.floor(rect.x / coreExtent) * coreExtent;
  const startY = Math.floor(rect.y / coreExtent) * coreExtent;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  for (let y = startY; y < bottom; y += coreExtent) {
    for (let x = startX; x < right; x += coreExtent) {
      const core = intersectRects(
        { x, y, width: coreExtent, height: coreExtent },
        { x: 0, y: 0, width: DOCUMENT_WIDTH, height: DOCUMENT_HEIGHT },
      );
      if (core && intersectRects(core, rect)) {
        result.push(core);
      }
    }
  }
  return result;
}

/**
 * Partial updates start exactly at their bounded dirty rectangle. Expanding a
 * one-pixel edit to the global 1022² tile grid would otherwise recompose about
 * one million document texels. Mip updates require even document-space edges
 * because every core is reduced by an exact 2×2 box into mip 1.
 */
function dirtyTileCores(
  rect: DirtyRect,
  coreExtent: number,
  requireEvenEdges: boolean,
): DirtyRect[] {
  if (
    requireEvenEdges
    && (
      rect.x % 2 !== 0
      || rect.y % 2 !== 0
      || rect.width % 2 !== 0
      || rect.height % 2 !== 0
      || coreExtent % 2 !== 0
    )
  ) {
    throw new Error("Core dirty mip non allineato alla griglia 2×2.");
  }
  const result: DirtyRect[] = [];
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  for (let y = rect.y; y < bottom; y += coreExtent) {
    for (let x = rect.x; x < right; x += coreExtent) {
      result.push({
        x,
        y,
        width: Math.min(coreExtent, right - x),
        height: Math.min(coreExtent, bottom - y),
      });
    }
  }
  return result;
}

/**
 * Conservative document-space bounds of the current screen. At LOD 0 a full
 * cache rebuild only needs pixels that can reach the viewport; the two-pixel
 * document margin covers bilinear/apron reads at every edge. The four-corner
 * transform is the exact inverse used by the display shader, including view
 * rotation.
 */
function visibleLodZeroDocumentRect(engine: BrushEngine): DirtyRect | null {
  const canvasWidth = engine.canvas.width;
  const canvasHeight = engine.canvas.height;
  if (
    canvasWidth <= 0
    || canvasHeight <= 0
    || !Number.isFinite(engine.zoom)
    || engine.zoom <= 0
  ) {
    return null;
  }
  const inverseZoom = 1 / engine.zoom;
  const halfWidth = canvasWidth * 0.5;
  const halfHeight = canvasHeight * 0.5;
  const corners = [
    [0, 0],
    [canvasWidth, 0],
    [0, canvasHeight],
    [canvasWidth, canvasHeight],
  ] as const;
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const [screenX, screenY] of corners) {
    const displayX = (screenX - halfWidth) * inverseZoom;
    const displayY = (screenY - halfHeight) * inverseZoom;
    const documentX = engine.viewCenterX
      + engine.viewRotationCos * displayX
      + engine.viewRotationSin * displayY;
    const documentY = engine.viewCenterY
      - engine.viewRotationSin * displayX
      + engine.viewRotationCos * displayY;
    minimumX = Math.min(minimumX, documentX);
    minimumY = Math.min(minimumY, documentY);
    maximumX = Math.max(maximumX, documentX);
    maximumY = Math.max(maximumY, documentY);
  }
  const margin = 2;
  return clampDocumentRect({
    x: minimumX - margin,
    y: minimumY - margin,
    width: maximumX - minimumX + margin * 2,
    height: maximumY - minimumY + margin * 2,
  });
}

function encodeHigherFinalMips(
  engine: BrushEngine,
  encoder: GPUCommandEncoder,
  documentRect: DirtyRect,
  selectedMipLevel: number,
  fullRebuild: boolean,
): void {
  let sourceRect: DirtyRect = {
    x: Math.floor(documentRect.x / 2),
    y: Math.floor(documentRect.y / 2),
    width: Math.ceil((documentRect.x + documentRect.width) / 2)
      - Math.floor(documentRect.x / 2),
    height: Math.ceil((documentRect.y + documentRect.height) / 2)
      - Math.floor(documentRect.y / 2),
  };
  for (let mipLevel = 2; mipLevel <= selectedMipLevel; mipLevel += 1) {
    const width = Math.max(1, DOCUMENT_WIDTH >> mipLevel);
    const height = Math.max(1, DOCUMENT_HEIGHT >> mipLevel);
    const targetRect = {
      x: Math.max(0, Math.floor(sourceRect.x / 2)),
      y: Math.max(0, Math.floor(sourceRect.y / 2)),
      width: 0,
      height: 0,
    };
    const targetRight = Math.min(width, Math.ceil((sourceRect.x + sourceRect.width) / 2));
    const targetBottom = Math.min(height, Math.ceil((sourceRect.y + sourceRect.height) / 2));
    targetRect.width = Math.max(0, targetRight - targetRect.x);
    targetRect.height = Math.max(0, targetBottom - targetRect.y);
    if (targetRect.width <= 0 || targetRect.height <= 0) {
      break;
    }
    const pass = encoder.beginRenderPass({
      label: `Layer blend final pyramid mip ${mipLevel}`,
      colorAttachments: [{
        view: engine.paintMipViews[mipLevel],
        loadOp: fullRebuild ? "clear" : "load",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(engine.paintMipDownsamplePipeline);
    pass.setBindGroup(0, engine.paintMipDownsampleBindGroups[mipLevel - 1]);
    if (!fullRebuild) {
      pass.setScissorRect(
        targetRect.x,
        targetRect.y,
        targetRect.width,
        targetRect.height,
      );
    }
    pass.draw(3, 1, 0, 0);
    pass.end();
    sourceRect = targetRect;
  }
}

/**
 * Encodes an exact raster-only stack. Every blend function runs on native
 * document texels; screen bilinear and the paint pyramid consume only the
 * completed result, never independently filtered layer operands.
 */
export function encodeLayerBlendTilePresentation(
  engine: BrushEngine,
  encoder: GPUCommandEncoder,
  presentationDirtyRect: DirtyRect,
  layerDirtyRect: DirtyRect | null,
  requiresFullRebuild: boolean,
  activePresentation: MixedSceneActivePresentation,
  label: string,
): void {
  if (!layerBlendTilePresentationRequired(engine)) {
    throw new Error("Presentazione fusione a tile richiesta fuori dal percorso raster-only.");
  }
  const compositor = engine.layerBlendTileCompositor;
  const renderer = engine.rasterStrokeRenderer;
  if (
    !compositor
    || !renderer
    || !engine.mixedSceneLinearView
    || !engine.mixedScenePresentBindGroup
    || !engine.mixedScenePresentPipeline
    || !engine.presentationCacheView
  ) {
    throw new Error("Compositore live fusioni a tile non pronto.");
  }
  const activeSegmentIndex = engine.mixedSceneCompositionSegments.findIndex(
    (segment) => segment.kind === "active-raster",
  );
  if (activeSegmentIndex < 0) {
    throw new Error("Programma fusione a tile privo del raster attivo.");
  }
  // Hidden semantic records may remain in the ordered program even when its
  // visible semantic count is zero. `staticSegmentSource` intentionally skips
  // them; only visible semantic content selects the viewport compatibility path.

  const selectedMipLevel = engine.paintDisplaySelectedMipLevel;
  const fullDocumentRect = {
    x: 0,
    y: 0,
    width: DOCUMENT_WIDTH,
    height: DOCUMENT_HEIGHT,
  };
  const reuseFinalPyramid = requiresFullRebuild
    && selectedMipLevel > 0
    && layerDirtyRect === null
    && engine.paintDisplayPyramidContent === "final-raster-stack"
    && engine.paintDisplayMipValidThroughLevel >= selectedMipLevel;
  const requestedDocumentRect = reuseFinalPyramid
    ? null
    : requiresFullRebuild
    ? selectedMipLevel === 0
      ? visibleLodZeroDocumentRect(engine)
      : fullDocumentRect
    : layerDirtyRect
      ? expandRect(layerDirtyRect, selectedMipLevel > 0 ? 2 ** selectedMipLevel : 2)
      : fullDocumentRect;
  const documentRect = requestedDocumentRect
    ? selectedMipLevel > 0
      ? alignedMipRect(requestedDocumentRect)
      : clampDocumentRect(requestedDocumentRect)
    : null;
  const coreExtent = selectedMipLevel > 0 ? compositor.extent : compositor.extent - 2;
  const cores = documentRect
    ? requiresFullRebuild
      ? selectedMipLevel > 0
        ? alignedTileCores(documentRect, coreExtent)
        : dirtyTileCores(documentRect, coreExtent, false)
      : dirtyTileCores(documentRect, coreExtent, selectedMipLevel > 0)
    : [];
  compositor.beginFrame();

  // A completed tile replaces its cache pixels, including transparent ones.
  // Clearing the screen-space AABB of a rotated dirty rect would also erase
  // unchanged pixels in its corners, which are outside the transformed core.
  // Only a full rebuild clears the cache; partial updates preserve those
  // corners and overwrite the exact owned pixels through the tile shaders.
  if (requiresFullRebuild) {
    const clearLinearPass = encoder.beginRenderPass({
      label: `${label} · clear full linear cache`,
      colorAttachments: [{
        view: engine.mixedSceneLinearView,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    clearLinearPass.end();
  }

  const activeNeedsBake = activePresentation.kind !== "base";
  if (cores.length > 0 && activeNeedsBake) {
    renderer.prepareBakeStyle(engine.rasterBevelStyle);
  }
  let bakeParameterSlot = 0;
  for (const core of cores) {
    const textureRect = selectedMipLevel > 0
      ? core
      : clampDocumentRect(expandRect(core, 1))!;
    // With no live style/effect contribution the authoritative layer can be
    // sampled directly. Otherwise materialize only this tile analytically.
    if (activeNeedsBake) {
      renderer.encodeBake({
        encoder,
        targetView: compositor.views[TILE_INDEX_SOURCE],
        sourceMode: activeSourceMode(activePresentation),
        style: engine.rasterStrokeStyle,
        bevelStyle: engine.rasterBevelStyle,
        colorOverlayStyle: engine.rasterColorOverlayStyle,
        rect: textureRect,
        targetStorageOrigin: { x: 0, y: 0 },
        parameterSlot: bakeParameterSlot++,
        deferParameterUpload: true,
        sharedStylePrepared: true,
      });
    }
    const activeSource: LayerBlendTileSource = activeNeedsBake
      ? {
        view: compositor.views[TILE_INDEX_SOURCE],
        origin: { x: textureRect.x, y: textureRect.y },
        scale: 1,
        width: textureRect.width,
        height: textureRect.height,
      }
      : {
        view: engine.layerView,
        origin: { x: 0, y: 0 },
        scale: 1,
        width: DOCUMENT_WIDTH,
        height: DOCUMENT_HEIGHT,
      };

    const activeRecord = engine.layerStack.active;
    const activeUnit = engine.layerStack.clippingUnit(activeRecord.id);
    const parent = activeUnit[0];
    const activeGroup = engine.activeClippingGroup;
    let activeOperandMode: LayerBlendMode = activeRecord.blendMode;
    let activeOperandOpacity = activeRecord.opacity;
    let activeCompositeSource = activeSource;

    const applyToTile = (
      currentTile: 0 | 1,
      source: LayerBlendTileSource,
      mode: LayerBlendMode,
      opacity: number,
      operator: "source-over" | "source-atop",
      stepLabel: string,
    ): 0 | 1 => {
      const overlap = intersectRects(textureRect, sourceBounds(source));
      if (!overlap || opacity <= 0) {
        return currentTile;
      }
      const scissor = localRect(overlap, textureRect);
      if (mode === "normal") {
        compositor.encodeFold({
          encoder,
          targetTile: currentTile,
          source,
          tileDocumentRect: textureRect,
          localScissor: scissor,
          opacity,
          mode,
          operator,
          label: stepLabel,
        });
        return currentTile;
      }
      const nextTile = currentTile === TILE_INDEX_A ? TILE_INDEX_B : TILE_INDEX_A;
      const overwritesWholeTile = scissor.x === 0
        && scissor.y === 0
        && scissor.width === textureRect.width
        && scissor.height === textureRect.height;
      if (!overwritesWholeTile) {
        compositor.copyTile(
          encoder,
          currentTile,
          nextTile,
          textureRect.width,
          textureRect.height,
        );
      }
      compositor.encodeFold({
        encoder,
        targetTile: nextTile,
        backdropTile: currentTile,
        source,
        tileDocumentRect: textureRect,
        localScissor: scissor,
        opacity,
        mode,
        operator,
        label: stepLabel,
      });
      return nextTile;
    };

    const applyClippingSuffix = (initialTile: 0 | 1): 0 | 1 => {
      let groupTile = initialTile;
      if (activeGroup?.suffixSteps.length) {
        for (const step of activeGroup.suffixSteps) {
          groupTile = applyToTile(
            groupTile,
            sourceForSurface(step.surface),
            step.blendMode,
            step.opacity,
            "source-atop",
            `${label} · clipping child ${step.layerId} (${step.blendMode})`,
          );
        }
        return groupTile;
      }
      if (activeGroup?.suffix) {
        groupTile = applyToTile(
          groupTile,
          sourceForSurface(activeGroup.suffix),
          "normal",
          1,
          "source-atop",
          `${label} · clipping suffix Normal aggregate`,
        );
      }
      return groupTile;
    };

    // Build the clipping unit into operand tile 2 before it meets the external backdrop.
    if (activeGroup?.mode === "active-child") {
      compositor.clearTile(
        encoder,
        TILE_INDEX_A,
        `${label} · clear clipping prefix tile`,
        textureRect.width,
        textureRect.height,
      );
      let groupTile: 0 | 1 = TILE_INDEX_A;
      if (activeGroup.prefix) {
        groupTile = applyToTile(
          groupTile,
          sourceForSurface(activeGroup.prefix),
          "normal",
          1,
          "source-over",
          `${label} · clipping prefix`,
        );
      }
      groupTile = applyToTile(
        groupTile,
        activeSource,
        activeRecord.blendMode,
        activeRecord.visible ? activeRecord.opacity : 0,
        "source-atop",
        `${label} · active clipping child ${activeRecord.id}`,
      );
      groupTile = applyClippingSuffix(groupTile);
      compositor.copyTile(
        encoder,
        groupTile,
        TILE_INDEX_SOURCE,
        textureRect.width,
        textureRect.height,
      );
      activeOperandMode = parent.blendMode;
      activeOperandOpacity = activeGroup.parentOpacity;
      activeCompositeSource = {
        view: compositor.views[TILE_INDEX_SOURCE],
        origin: { x: textureRect.x, y: textureRect.y },
        scale: 1,
        width: textureRect.width,
        height: textureRect.height,
      };
    } else if (activeGroup?.mode === "active-parent") {
      if (activeGroup.suffix || activeGroup.suffixSteps.length > 0) {
        compositor.clearTile(
          encoder,
          TILE_INDEX_A,
          `${label} · clear parent group tile`,
          textureRect.width,
          textureRect.height,
        );
        const parentTile = applyToTile(
          TILE_INDEX_A,
          activeSource,
          "normal",
          1,
          "source-over",
          `${label} · active clipping parent ${activeRecord.id}`,
        );
        const groupTile = applyClippingSuffix(parentTile);
        compositor.copyTile(
          encoder,
          groupTile,
          TILE_INDEX_SOURCE,
          textureRect.width,
          textureRect.height,
        );
        activeCompositeSource = {
          view: compositor.views[TILE_INDEX_SOURCE],
          origin: { x: textureRect.x, y: textureRect.y },
          scale: 1,
          width: textureRect.width,
          height: textureRect.height,
        };
      }
      activeOperandMode = parent.blendMode;
      activeOperandOpacity = activeGroup.parentOpacity;
    }

    compositor.seedTileWithDocumentBackground(
      encoder,
      TILE_INDEX_A,
      `${label} · seed document background tile`,
      textureRect.width,
      textureRect.height,
    );
    let currentTile: 0 | 1 = TILE_INDEX_A;
    for (let index = 0; index < activeSegmentIndex; index += 1) {
      const segment = engine.mixedSceneCompositionSegments[index];
      const source = staticSegmentSource(engine, segment);
      if (!source) continue;
      currentTile = applyToTile(
        currentTile,
        source,
        engine.compositionSegmentBlendMode(segment),
        1,
        "source-over",
        `${label} · below ${segment.key}`,
      );
    }
    currentTile = applyToTile(
      currentTile,
      activeCompositeSource,
      activeOperandMode,
      activeGroup ? activeOperandOpacity : activeRecord.visible ? activeOperandOpacity : 0,
      "source-over",
      `${label} · active group`,
    );
    for (
      let index = activeSegmentIndex + 1;
      index < engine.mixedSceneCompositionSegments.length;
      index += 1
    ) {
      const segment = engine.mixedSceneCompositionSegments[index];
      const source = staticSegmentSource(engine, segment);
      if (!source) continue;
      currentTile = applyToTile(
        currentTile,
        source,
        engine.compositionSegmentBlendMode(segment),
        1,
        "source-over",
        `${label} · above ${segment.key}`,
      );
    }

    if (selectedMipLevel > 0) {
      compositor.encodeMipOne({
        encoder,
        sourceTile: currentTile,
        textureOrigin: { x: textureRect.x, y: textureRect.y },
        targetRect: {
          x: core.x / 2,
          y: core.y / 2,
          width: core.width / 2,
          height: core.height / 2,
        },
      });
    } else {
      const screenRect = layerDirtyRectToPresentationRect(engine, core, 0);
      const scissor = screenRect && intersectRects(screenRect, presentationDirtyRect);
      if (scissor) {
        const tilePass = encoder.beginRenderPass({
          label: `${label} · present document tile`,
          colorAttachments: [{
            view: engine.mixedSceneLinearView,
            loadOp: "load",
            storeOp: "store",
          }],
        });
        compositor.encodeTilePresentation({
          pass: tilePass,
          sourceTile: currentTile,
          textureOrigin: { x: textureRect.x, y: textureRect.y },
          core,
          textureSize: { width: textureRect.width, height: textureRect.height },
          scissor,
        });
        tilePass.end();
      }
    }
  }

  renderer.flushBakeParameters(bakeParameterSlot);
  if (selectedMipLevel > 0 && (documentRect || reuseFinalPyramid)) {
    if (documentRect) {
      encodeHigherFinalMips(
        engine,
        encoder,
        documentRect,
        selectedMipLevel,
        requiresFullRebuild,
      );
      engine.paintDisplayPyramidContent = "final-raster-stack";
      engine.paintDisplayMipValidThroughLevel = selectedMipLevel;
    }
    const pyramidPass = encoder.beginRenderPass({
      label: `${label} · present final raster pyramid`,
      colorAttachments: [{
        view: engine.mixedSceneLinearView,
        loadOp: "load",
        storeOp: "store",
      }],
    });
    pyramidPass.setScissorRect(
      presentationDirtyRect.x,
      presentationDirtyRect.y,
      presentationDirtyRect.width,
      presentationDirtyRect.height,
    );
    compositor.encodePyramidPresentation(pyramidPass);
    pyramidPass.end();
  }

  compositor.finishEncoding();

  const presentPass = encoder.beginRenderPass({
    label: `${label} · checker finale`,
    colorAttachments: [{
      view: engine.presentationCacheView,
      loadOp: requiresFullRebuild ? "clear" : "load",
      storeOp: "store",
      clearValue: { r: 0.02, g: 0.02, b: 0.025, a: 1 },
    }],
  });
  presentPass.setPipeline(engine.mixedScenePresentPipeline);
  presentPass.setBindGroup(0, engine.mixedScenePresentBindGroup);
  presentPass.setScissorRect(
    presentationDirtyRect.x,
    presentationDirtyRect.y,
    presentationDirtyRect.width,
    presentationDirtyRect.height,
  );
  presentPass.draw(3, 1, 0, 0);
  presentPass.end();
}
