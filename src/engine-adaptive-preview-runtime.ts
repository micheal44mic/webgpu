import type { BrushEngine } from "./brush-engine";
import { type Stamp } from "./engine-stroke-types";
import {
  ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS,
  ADAPTIVE_PREVIEW_SHAPE_PALETTE_SIZE,
  adaptivePreviewRgb,
  type AdaptivePreviewCandidate,
  type AdaptivePreviewConcreteActivationReason,
  type AdaptivePreviewShapePaletteEntry,
} from "./adaptive-preview-runtime";
import { type BrushSettings } from "./engine-types";
import { clamp, hexToHsl } from "./color";
import { previewHash32 } from "./engine-math";

export function freezeAdaptivePreviewAtLift(engine: BrushEngine): void {
  if (!engine.adaptivePreviewActive) {
    engine.invalidateAdaptivePreview();
    return;
  }
  if (engine.adaptivePreviewFrameRequest !== null) {
    cancelAnimationFrame(engine.adaptivePreviewFrameRequest);
    engine.adaptivePreviewFrameRequest = null;
  }
  if (engine.adaptivePreviewRetirementFrame !== null) {
    cancelAnimationFrame(engine.adaptivePreviewRetirementFrame);
    engine.adaptivePreviewRetirementFrame = null;
  }

  const stroke = engine.activeStroke;
  if (stroke) {
    const pendingTip: Stamp[] = [];
    let pendingCandidatesAdded = 0;
    const candidateLimit = ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS;
    for (
      let index = engine.pendingStamps.length - 1;
      index >= 0 && pendingTip.length < candidateLimit;
      index -= 1
    ) {
      const stamp = engine.pendingStamps[index];
      if (stamp.historyActionId === stroke.historyActionId) {
        pendingTip.unshift(stamp);
      }
    }
    for (const stamp of pendingTip) {
      if (!engine.adaptivePreviewCandidates.some((candidate) => candidate.stamp === stamp)) {
        engine.adaptivePreviewCandidates.push({
          serial: null,
          stamp,
          settings: engine.settings,
          presented: false,
        });
        pendingCandidatesAdded += 1;
      }
    }
    engine.adaptivePreviewCandidates = engine.adaptivePreviewCandidates
      .slice(-candidateLimit);
    if (engine.activeStrokeProfile) {
      engine.activeStrokeProfile.adaptivePreviewLiftPendingBaseStamps += pendingCandidatesAdded;
    }
  }

  engine.adaptivePreviewFrozen = true;
  engine.drawAdaptivePreviewFrame();
  if (
    engine.adaptivePreviewLastPresentedSerial <= 0
    && !hasAdaptivePreviewPresentedUnboundCandidate(engine)
  ) {
    engine.invalidateAdaptivePreview();
    return;
  }
  engine.adaptivePreviewRetirementTargetSerial = engine.adaptivePreviewLastPresentedSerial;
  if (engine.activeStrokeProfile) {
    engine.activeStrokeProfile.adaptivePreviewFrozenAtLift += 1;
  }
  if (hasAdaptivePreviewPresentedUnboundCandidate(engine)) {
    return;
  }
  if (engine.adaptivePreviewConfirmedSerial >= engine.adaptivePreviewRetirementTargetSerial) {
    scheduleAdaptivePreviewRetirement(engine);
    return;
  }
  engine.startAdaptivePreviewProbe(true);
}

export function prepareAdaptivePreviewShapePalette(engine: BrushEngine, settings: BrushSettings): void {
  const source = engine.adaptivePreviewShapeSprite;
  if (settings.shape !== "shape" || !source || !engine.adaptivePreviewContext) {
    return;
  }
  const key = [
    settings.color,
    settings.hueJitterDegrees,
    settings.saturationJitter,
    settings.lightnessJitter,
    settings.darknessJitter,
    settings.hardness,
  ].join("|");
  if (key === engine.adaptivePreviewShapePaletteKey) {
    return;
  }

  const baseHsl = hexToHsl(settings.color);
  const coverageSource = document.createElement("canvas");
  coverageSource.width = source.width;
  coverageSource.height = source.height;
  const coverageContext = coverageSource.getContext("2d");
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!coverageContext || !sourceContext) {
    engine.adaptivePreviewShapePalette = [];
    engine.adaptivePreviewShapePaletteKey = key;
    return;
  }
  const coverageImage = sourceContext.getImageData(0, 0, source.width, source.height);
  const hardness = clamp(settings.hardness, 0, 1);
  for (let index = 3; index < coverageImage.data.length; index += 4) {
    const sourceCoverage = coverageImage.data[index] / 255;
    const coverage = sourceCoverage * sourceCoverage * (1 - hardness)
      + sourceCoverage * hardness;
    coverageImage.data[index] = Math.round(clamp(coverage, 0, 1) * 255);
  }
  coverageContext.putImageData(coverageImage, 0, 0);

  const entries: AdaptivePreviewShapePaletteEntry[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < ADAPTIVE_PREVIEW_SHAPE_PALETTE_SIZE; index += 1) {
    const seed = previewHash32(Math.imul(index + 1, 0x9e3779b1) ^ 0xa511e9b3);
    const [red, green, blue] = adaptivePreviewRgb(seed, settings, baseHsl);
    const color = `rgb(${red} ${green} ${blue})`;
    if (seen.has(color)) {
      continue;
    }
    const sprite = document.createElement("canvas");
    sprite.width = source.width;
    sprite.height = source.height;
    const context = sprite.getContext("2d");
    if (!context) {
      continue;
    }
    context.drawImage(coverageSource, 0, 0);
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, sprite.width, sprite.height);
    entries.push({ red, green, blue, sprite });
    seen.add(color);
  }
  engine.adaptivePreviewShapePalette = entries;
  engine.adaptivePreviewShapePaletteKey = key;
}

export function activateAdaptivePreview(engine: BrushEngine, 
  reason: AdaptivePreviewConcreteActivationReason,
): void {
  if (
    engine.adaptivePreviewActive
    || engine.adaptivePreviewFrozen
    || !engine.adaptivePreviewContext
    || engine.adaptivePreviewCandidates.length === 0
  ) {
    return;
  }
  const settings = engine.adaptivePreviewCandidates[engine.adaptivePreviewCandidates.length - 1].settings;
  if (settings.blendMode !== "normal") {
    if (engine.activeStrokeProfile) {
      engine.activeStrokeProfile.adaptivePreviewUnsupportedBlendSkips += 1;
    }
    return;
  }

  engine.adaptivePreviewActive = true;
  const activatedAt = performance.now();
  engine.adaptivePreviewStartedAt = activatedAt;
  const profile = engine.activeStrokeProfile;
  if (profile) {
    const activationOffsetMs = activatedAt - profile.startedAt;
    if (profile.adaptivePreviewActivations === 0) {
      profile.adaptivePreviewFirstActivationReason = reason;
      profile.adaptivePreviewFirstActivationMs = activationOffsetMs;
    } else if (profile.adaptivePreviewActivations === 1) {
      profile.adaptivePreviewSecondActivationReason = reason;
      profile.adaptivePreviewSecondActivationMs = activationOffsetMs;
    }
    profile.adaptivePreviewActivations += 1;
    profile.adaptivePreviewActivationReason = profile.adaptivePreviewActivationReason === "none"
      ? reason
      : profile.adaptivePreviewActivationReason === reason
        ? reason
        : "mixed";
  }
  requestAdaptivePreviewDraw(engine);
}

export function requestAdaptivePreviewIncompleteFrameRetry(engine: BrushEngine, 
  candidates: readonly AdaptivePreviewCandidate[],
): void {
  if (!engine.adaptivePreviewActive || engine.adaptivePreviewFrozen) {
    return;
  }

  let latestSerial = 0;
  for (const candidate of candidates) {
    if (candidate.serial !== null) {
      latestSerial = Math.max(latestSerial, candidate.serial);
    }
  }
  if (
    latestSerial <= 0
    || latestSerial <= engine.adaptivePreviewLastIncompleteRetrySerial
  ) {
    return;
  }

  // Un solo tentativo aggiuntivo per ogni nuovo tip: evita un loop rAF
  // quando il dispositivo non riesce stabilmente a rispettare il budget.
  engine.adaptivePreviewLastIncompleteRetrySerial = latestSerial;
  if (engine.activeStrokeProfile) {
    engine.activeStrokeProfile.adaptivePreviewIncompleteFrameRetryRequests += 1;
  }
  requestAdaptivePreviewDraw(engine);
}

export function retireAdaptivePreview(engine: BrushEngine, countRetirement: boolean): void {
  const hadPreview = engine.adaptivePreviewActive
    || engine.adaptivePreviewFrozen
    || engine.adaptivePreviewLastPresentedSerial > 0;
  finishAdaptivePreviewLifetime(engine);
  engine.adaptivePreviewGeneration += 1;
  cancelAdaptivePreviewProbe(engine);
  if (engine.adaptivePreviewFrameRequest !== null) {
    cancelAnimationFrame(engine.adaptivePreviewFrameRequest);
    engine.adaptivePreviewFrameRequest = null;
  }
  if (engine.adaptivePreviewRetirementFrame !== null) {
    cancelAnimationFrame(engine.adaptivePreviewRetirementFrame);
    engine.adaptivePreviewRetirementFrame = null;
  }
  engine.adaptivePreviewCandidates.length = 0;
  engine.adaptivePreviewActive = false;
  engine.adaptivePreviewFrozen = false;
  engine.adaptivePreviewForceStroke = false;
  engine.adaptivePreviewRetirementTargetSerial = 0;
  engine.adaptivePreviewSubmissionsSinceProbe = 0;
  engine.adaptivePreviewLastIncompleteRetrySerial = 0;
  engine.adaptivePreviewConsecutiveSlowProbes = 0;
  clearAdaptivePreviewCanvas(engine);
  if (hadPreview && countRetirement && engine.activeStrokeProfile) {
    engine.activeStrokeProfile.adaptivePreviewRetirements += 1;
  }
}

export function hideConfirmedStaleAdaptivePreviewBitmap(engine: BrushEngine): boolean {
  const canvas = engine.adaptivePreviewCanvas;
  if (
    !canvas
    || canvas.style.opacity !== "1"
    || engine.adaptivePreviewLastPresentedSerial <= 0
    || engine.adaptivePreviewLastPresentedSerial > engine.adaptivePreviewConfirmedSerial
    || hasAdaptivePreviewPresentedUnboundCandidate(engine)
  ) {
    return false;
  }

  // Il backing resta intatto e verrà sostituito atomicamente con `copy` al
  // prossimo commit riuscito. Nascondere soltanto l'elemento evita di
  // aggiungere un clear Canvas2D proprio nel frame che ha già sforato il
  // budget, ma impedisce a un tip ormai raggiunto dalla GPU di restare fermo
  // sopra stamp esatti più recenti.
  canvas.style.opacity = "0";
  engine.adaptivePreviewLastPresentedSerial = 0;
  for (const candidate of engine.adaptivePreviewCandidates) {
    candidate.presented = false;
  }
  if (engine.activeStrokeProfile) {
    engine.activeStrokeProfile.adaptivePreviewConfirmedStaleBitmapHides += 1;
  }
  return true;
}

export function clearAdaptivePreviewCanvas(engine: BrushEngine): void {
  const canvas = engine.adaptivePreviewCanvas;
  const context = engine.adaptivePreviewContext;
  if (!canvas || !context) {
    return;
  }
  const hasVisibleBitmap = canvas.style.opacity === "1"
    || engine.adaptivePreviewLastPresentedSerial > 0
    || engine.adaptivePreviewCandidates.some((candidate) => candidate.presented);
  if (!hasVisibleBitmap) {
    engine.adaptivePreviewLastPresentedSerial = 0;
    return;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, canvas.width, canvas.height);
  canvas.style.opacity = "0";
  canvas.style.left = "-10000px";
  canvas.style.top = "-10000px";
  engine.adaptivePreviewLastPresentedSerial = 0;
  for (const candidate of engine.adaptivePreviewCandidates) {
    candidate.presented = false;
  }
}

export function scheduleAdaptivePreviewCatchUpClear(engine: BrushEngine): void {
  if (engine.adaptivePreviewRetirementFrame !== null) {
    return;
  }
  const generation = engine.adaptivePreviewGeneration;
  const targetSerial = engine.adaptivePreviewLastPresentedSerial;
  engine.adaptivePreviewRetirementFrame = requestAnimationFrame(() => {
    engine.adaptivePreviewRetirementFrame = null;
    if (
      generation !== engine.adaptivePreviewGeneration
      || !engine.adaptivePreviewActive
      || engine.adaptivePreviewFrozen
      || engine.adaptivePreviewConfirmedSerial < targetSerial
      || hasAdaptivePreviewUnconfirmedCandidate(engine)
    ) {
      return;
    }
    if (engine.adaptivePreviewForceStroke && engine.activeStroke) {
      clearAdaptivePreviewCanvas(engine);
    } else {
      retireAdaptivePreview(engine, true);
    }
  });
}

export function requestAdaptivePreviewDraw(engine: BrushEngine): void {
  if (
    !engine.adaptivePreviewActive
    || engine.adaptivePreviewFrozen
    || !engine.adaptivePreviewContext
    || engine.adaptivePreviewFrameRequest !== null
  ) {
    return;
  }
  const generation = engine.adaptivePreviewGeneration;
  engine.adaptivePreviewFrameRequest = requestAnimationFrame(() => {
    engine.adaptivePreviewFrameRequest = null;
    if (
      generation !== engine.adaptivePreviewGeneration
      || !engine.adaptivePreviewActive
      || engine.adaptivePreviewFrozen
    ) {
      return;
    }
    engine.drawAdaptivePreviewFrame();
  });
}

export function scheduleAdaptivePreviewRetirement(engine: BrushEngine): void {
  if (engine.adaptivePreviewRetirementFrame !== null) {
    return;
  }
  const generation = engine.adaptivePreviewGeneration;
  engine.adaptivePreviewRetirementFrame = requestAnimationFrame(() => {
    engine.adaptivePreviewRetirementFrame = null;
    const targetSerial = engine.adaptivePreviewRetirementTargetSerial;
    if (
      generation !== engine.adaptivePreviewGeneration
      || !engine.adaptivePreviewFrozen
      || hasAdaptivePreviewPresentedUnboundCandidate(engine)
      || targetSerial <= 0
      || engine.adaptivePreviewConfirmedSerial < targetSerial
    ) {
      return;
    }
    retireAdaptivePreview(engine, true);
  });
}

export function retireAdaptivePreviewAfterGpuIdle(engine: BrushEngine): void {
  if (
    engine.adaptivePreviewActive
    || engine.adaptivePreviewFrozen
    || engine.adaptivePreviewLastPresentedSerial > 0
  ) {
    engine.adaptivePreviewConfirmedSerial = Math.max(
      engine.adaptivePreviewConfirmedSerial,
      engine.adaptivePreviewSubmittedSerial,
    );
    if (engine.adaptivePreviewFrozen) {
      scheduleAdaptivePreviewRetirement(engine);
    } else {
      scheduleAdaptivePreviewCatchUpClear(engine);
    }
  } else {
    clearAdaptivePreviewCanvas(engine);
  }
}

export function finishAdaptivePreviewLifetime(engine: BrushEngine, timestamp = performance.now()): void {
  if (engine.adaptivePreviewStartedAt <= 0) {
    return;
  }
  if (engine.activeStrokeProfile) {
    engine.activeStrokeProfile.adaptivePreviewMaxLifetimeMs = Math.max(
      engine.activeStrokeProfile.adaptivePreviewMaxLifetimeMs,
      timestamp - engine.adaptivePreviewStartedAt,
    );
  }
  engine.adaptivePreviewStartedAt = 0;
}

export function finishIncompleteAdaptivePreviewFrame(engine: BrushEngine, 
  startedAt: number,
  budgetAlreadyCounted: boolean,
  candidates: readonly AdaptivePreviewCandidate[],
  retry: boolean,
): void {
  hideConfirmedStaleAdaptivePreviewBitmap(engine);
  if (retry) {
    requestAdaptivePreviewIncompleteFrameRetry(engine, candidates);
  }
  engine.recordAdaptivePreviewJsFrame(startedAt, budgetAlreadyCounted);
}

export function cancelAdaptivePreviewProbe(engine: BrushEngine): void {
  const probe = engine.adaptivePreviewProbe;
  if (!probe) {
    return;
  }
  window.clearTimeout(probe.timeout);
  engine.adaptivePreviewProbe = null;
  if (probe.telemetryProfile) {
    probe.telemetryProfile.adaptivePreviewProbeCancellations += 1;
  }
}

export function adaptivePreviewCandidatesForFrame(engine: BrushEngine): AdaptivePreviewCandidate[] {
  return engine.adaptivePreviewCandidates
    .filter((candidate) => candidate.serial === null
      || candidate.serial > engine.adaptivePreviewConfirmedSerial)
    .slice(-ADAPTIVE_PREVIEW_MAX_TIP_BASE_STAMPS);
}

export function hasAdaptivePreviewUnconfirmedCandidate(engine: BrushEngine): boolean {
  return engine.adaptivePreviewCandidates.some(
    (candidate) => candidate.serial === null
      || candidate.serial > engine.adaptivePreviewConfirmedSerial,
  );
}

export function hasAdaptivePreviewPresentedUnboundCandidate(engine: BrushEngine): boolean {
  return engine.adaptivePreviewCandidates.some(
    (candidate) => candidate.presented && candidate.serial === null,
  );
}
