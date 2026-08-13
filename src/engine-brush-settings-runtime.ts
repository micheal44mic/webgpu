import type { BrushEngine } from "./brush-engine";
import type { BrushSettings } from "./engine-types";
import type { LightGlazeStorageMode } from "./engine-strategies";
import { clamp } from "./color";
import { normalizeGrainAssetId, normalizeShapeAssetId } from "./engine-brush-assets";
import {
  isTexturizedGrainActive,
  lightGlazeStorageModeFor,
  usesBlendRenderer,
  usesStrokeGlazeRenderer,
} from "./engine-strategies";
import { prepareAdaptivePreviewShapePalette } from "./engine-adaptive-preview-runtime";
import {
  destroyStrokeStabilizationSnapshot,
  maybeReleaseIdleLightGlazeResources,
  requestLightGlazeResources,
} from "./engine-glaze-runtime";
import {
  maybeReleaseIdleBlendScratch,
  maybeReleaseIdleGrainResources,
  maybeReleaseIdleShapeResources,
} from "./engine-resource-setup";
import {
  flushPendingWorkBeforeSettingsChange,
  requestGrainLoad,
  requestShapeLoad,
} from "./engine-runtime-misc";

export interface BrushSettingsRuntimePort {
  readonly setLightGlazeDesiredStorageMode: (mode: LightGlazeStorageMode) => void;
}

export function applyBrushSettings(
  engine: BrushEngine,
  next: Partial<BrushSettings>,
  port: BrushSettingsRuntimePort,
): void {
    if (engine.initialized && (engine.layerSwitchBusy || engine.historyBusy)) {
      throw new Error(
        "Le impostazioni non possono cambiare durante uno switch o un replay della cronologia.",
      );
    }
    flushPendingWorkBeforeSettingsChange(engine);
    const previousUsesBlendRenderer = usesBlendRenderer(engine.settings);
    const tool = next.tool === "paint" || next.tool === "blend"
      ? next.tool
      : engine.settings.tool;
    const blendMode = next.blendMode === "normal"
      || next.blendMode === "additive"
      || next.blendMode === "light-glaze"
      || next.blendMode === "uniformed-glaze"
      || next.blendMode === "intense-blending"
      || next.blendMode === "m1-glaze"
      ? next.blendMode
      : engine.settings.blendMode;
    engine.settings = {
      ...engine.settings,
      ...next,
      tool,
      shape: next.shape === "shape" || next.shape === "circle" ? next.shape : engine.settings.shape,
      shapeAssetId: normalizeShapeAssetId(next.shapeAssetId ?? engine.settings.shapeAssetId),
      shapeInvert: typeof next.shapeInvert === "boolean"
        ? next.shapeInvert
        : engine.settings.shapeInvert,
      shapeRotation: next.shapeRotation === "follow-stroke" || next.shapeRotation === "fixed"
        ? next.shapeRotation
        : engine.settings.shapeRotation,
      shapeScatter: clamp(next.shapeScatter ?? engine.settings.shapeScatter, 0, 1),
      grainMode: next.grainMode === "off"
        || next.grainMode === "texturized"
        || next.grainMode === "moving"
        ? next.grainMode
        : engine.settings.grainMode,
      grainAssetId: normalizeGrainAssetId(next.grainAssetId ?? engine.settings.grainAssetId),
      grainScale: clamp(next.grainScale ?? engine.settings.grainScale, 0.1, 4),
      grainMovement: clamp(next.grainMovement ?? engine.settings.grainMovement, 0, 1),
      grainDepth: clamp(next.grainDepth ?? engine.settings.grainDepth, 0, 1),
      grainBrightness: clamp(next.grainBrightness ?? engine.settings.grainBrightness, -1, 1),
      grainContrast: clamp(next.grainContrast ?? engine.settings.grainContrast, -1, 1),
      grainInvert: typeof next.grainInvert === "boolean"
        ? next.grainInvert
        : engine.settings.grainInvert,
      grainFiltering: next.grainFiltering === "no"
        || next.grainFiltering === "classic"
        || next.grainFiltering === "improved"
        ? next.grainFiltering
        : engine.settings.grainFiltering,
      grainBlendMode: next.grainBlendMode === "multiply"
        ? next.grainBlendMode
        : engine.settings.grainBlendMode,
      count: clamp(Math.round(next.count ?? engine.settings.count), 1, 24),
      size: clamp(
        next.size ?? engine.settings.size,
        1,
        // The public mobile control stops at 1000 px. Keep the historical
        // internal headroom used by the canonical Blend background fixture.
        tool === "blend" ? 1024 : 1500,
      ),
      spacingPercent: clamp(
        next.spacingPercent ?? engine.settings.spacingPercent,
        tool === "blend" ? 1 : 0.25,
        tool === "blend" ? 400 : 99,
      ),
      stabilization: clamp(next.stabilization ?? engine.settings.stabilization, 0, 1),
      startThickness: clamp(next.startThickness ?? engine.settings.startThickness, 0, 2),
      endThickness: clamp(next.endThickness ?? engine.settings.endThickness, 0, 2),
      flow: clamp(next.flow ?? engine.settings.flow, 0.001, 1),
      opacity: clamp(next.opacity ?? engine.settings.opacity, 0, 1),
      // Brush Studio intentionally has no Paint hardness control. Preserve the
      // dry Blend setting, while every Paint setting/history batch is authored at 100%.
      hardness: tool === "paint" ? 1 : clamp(next.hardness ?? engine.settings.hardness, 0, 1),
      // Kept in the history ABI only. Rendering now has one unambiguous Flow control.
      blendIntensity: 1,
      blendMode,
      blendStretch: clamp(next.blendStretch ?? engine.settings.blendStretch, 0, 1),
      blendPaint: clamp(next.blendPaint ?? engine.settings.blendPaint, 0, 1),
      blendBlur: clamp(next.blendBlur ?? engine.settings.blendBlur, 0, 1),
      // Legacy presets may still carry engine field, but the four Color Dynamics
      // controls are authoritative and must never be scaled a second time.
      jitterMaster: 1,
      hueJitterDegrees: clamp(next.hueJitterDegrees ?? engine.settings.hueJitterDegrees, 0, 180),
      saturationJitter: clamp(next.saturationJitter ?? engine.settings.saturationJitter, 0, 1),
      lightnessJitter: clamp(next.lightnessJitter ?? engine.settings.lightnessJitter, 0, 1),
      darknessJitter: clamp(next.darknessJitter ?? engine.settings.darknessJitter, 0, 1),
      positionJitterLateral: clamp(next.positionJitterLateral ?? engine.settings.positionJitterLateral, 0, 1),
      positionJitterLinear: clamp(next.positionJitterLinear ?? engine.settings.positionJitterLinear, 0, 1),
    };
    prepareAdaptivePreviewShapePalette(engine, engine.settings);

    if (engine.initialized) {
      const nextUsesBlendRenderer = usesBlendRenderer(engine.settings);
      const glazeSelected = usesStrokeGlazeRenderer(engine.settings);
      port.setLightGlazeDesiredStorageMode(glazeSelected
        ? lightGlazeStorageModeFor(engine.settings.blendMode)
        : "none");

      if (!glazeSelected) {
        maybeReleaseIdleLightGlazeResources(engine);
      }
      if (
        engine.settings.stabilization === 0
        && !engine.activeStroke
        && !engine.lightGlazeSession
      ) {
        destroyStrokeStabilizationSnapshot(engine);
      }
      if (!nextUsesBlendRenderer && previousUsesBlendRenderer) {
        maybeReleaseIdleBlendScratch(engine);
      }
      if (nextUsesBlendRenderer) {
        // Prewarm on selection so allocation never lands inside the first stroke.
        engine.blendRenderer?.prewarmScratch();
      }
      if (
        glazeSelected
        && !engine.lightGlazeSession
        && !engine.activeStroke
      ) {
        // Prewarm at selection (including R16F coverage↔RGBA16F retarget).
        requestLightGlazeResources(engine, engine.settings.blendMode);
      }
      if (engine.settings.grainMode !== "off") {
        requestGrainLoad(engine);
      } else {
        maybeReleaseIdleGrainResources(engine);
      }
      if (engine.settings.shape === "shape") {
        requestShapeLoad(engine);
      } else {
        maybeReleaseIdleShapeResources(engine);
      }
      engine.invalidateAdaptivePreview();
      engine.writeBrushUniforms();
      if (isTexturizedGrainActive(engine.settings)) {
        engine.writeGrainUniforms(engine.settings);
      }
      engine.displayDirty = true;
      engine.requestRender();
    }
  }
