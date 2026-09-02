import type { BrushEngine } from "../../brush-engine";
import {
  ensureLabCheckerboardBackdrop,
  setLayerCompositeTestView,
} from "../engine-lab-operations";

export interface ClippingGroupGpuTestReport {
  version: 1;
  passed: boolean;
  checks: {
    emptyAdvancedBaseIsTransparent: boolean;
    relationIsContiguous: boolean;
    softAlphaIsContinuous: boolean;
    parentChangesVisibleBeforeLift: boolean;
    liveEqualsCommitted: boolean;
  };
  emptyBasePresented: number[];
  parentAlphaLevels: number[];
  softEdge: {
    x: number;
    parentAlpha: number;
    expectedRgb: number;
    presented: number[];
    maximumRgbError: number;
  } | null;
  live: {
    before: number[];
    duringGesture: number[];
    committed: number[];
  };
}

const srgbToLinear = (value: number): number =>
  value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;

const linearToSrgb = (value: number): number => {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
};

const drawTap = async (
  engine: BrushEngine,
  x: number,
  y: number,
  timeMs: number,
): Promise<void> => {
  if (!engine.beginStrokeAtLayer({ x, y, pressure: 1, timeMs })) {
    throw new Error("The clipping fixture stroke did not start.");
  }
  engine.extendStrokeAtLayer([{ x: x + 1, y, pressure: 1, timeMs: timeMs + 16 }]);
  engine.endStroke(timeMs + 16);
  await engine.waitForIdle();
};

const rgba = (value: Uint8Array): number[] => Array.from(value.slice(0, 4));

export async function runClippingGroupGpuTest(
  engine: BrushEngine,
): Promise<ClippingGroupGpuTestReport> {
  const initial = engine.getStats();
  if (initial.layerCount !== 1 || initial.layers[0]?.hasContent) {
    throw new Error("La sonda clipping richiede una pagina nuova con un solo livello vuoto.");
  }
  const storedEncodedSrgb = engine.layerFormat === "rgba8unorm"
    && engine.documentStorageColorSpace === "encoded-srgb-premultiplied";
  if (
    !storedEncodedSrgb
    && !(
      engine.layerFormat === "rgba16float"
      && engine.documentStorageColorSpace === "linear-premultiplied"
    )
  ) {
    throw new Error("La sonda clipping richiede un contratto pixel nativo supportato.");
  }

  await ensureLabCheckerboardBackdrop(engine);

  setLayerCompositeTestView(engine, 2048, 2048, 1);
  const parentId = engine.getStats().layers[0].id;
  await engine.setLayerBlendMode(0, "multiply");
  await engine.setLayerContentOpacity(0, 0.42);
  await engine.setLayerCutoutMode(0, "group");
  await engine.setLayerTonalBlend(0, {
    current: [0, 0, 255, 255],
    underlying: [32, 64, 255, 255],
  });
  await engine.addClippingMaskLayer();
  await engine.waitForIdle();
  const emptyGrouped = engine.getStats().layers;
  const emptyBasePresented = rgba(
    await engine.readPresentationPixelAtLayer(2048, 2048),
  );
  const expectedEmptyBackground = Math.round(0.91 * 255);
  const emptyAdvancedBaseIsTransparent = emptyGrouped.length === 2
    && emptyGrouped[0].id === parentId
    && emptyGrouped[1].clippingParentId === parentId
    && emptyBasePresented.slice(0, 3).every(
      (channel) => Math.abs(channel - expectedEmptyBackground) <= 2,
    )
    && emptyBasePresented[3] === 255;

  await engine.setActiveLayer(0);
  await engine.setLayerBlendMode(0, "normal");
  await engine.setLayerContentOpacity(0, 1);
  await engine.setLayerCutoutMode(0, "off");
  await engine.setLayerTonalBlend(0, {
    current: [0, 0, 255, 255],
    underlying: [0, 0, 255, 255],
  });
  engine.setBrushSettings({
    tool: "paint",
    shape: "circle",
    grainMode: "off",
    shapeScatter: 0,
    color: "#ff0000",
    size: 512,
    spacingPercent: 2,
    stabilization: 0,
    startThickness: 1,
    endThickness: 1,
    count: 1,
    flow: 0.25,
    opacity: 1,
    hardness: 0,
    blendMode: "intense-blending",
    hueJitterDegrees: 0,
    saturationJitter: 0,
    lightnessJitter: 0,
    darknessJitter: 0,
    positionJitterLateral: 0,
    positionJitterLinear: 0,
  });
  await engine.ensureCurrentBrushResources();
  await drawTap(engine, 2048, 2048, 1_000);

  await engine.setActiveLayer(1);
  engine.setBrushSettings({
    color: "#000000",
    size: 1400,
    count: 1,
    flow: 1,
    opacity: 1,
    hardness: 1,
    blendMode: "intense-blending",
  });
  await engine.ensureCurrentBrushResources();
  await drawTap(engine, 2048, 1900, 2_000);

  const grouped = engine.getStats().layers;
  const relationIsContiguous = grouped.length === 2
    && grouped[0].id === parentId
    && grouped[1].clippingParentId === parentId;

  // Cover the complete soft stamp plus transparent margins. The engine's
  // authored size is a radius, so a narrow diameter-assuming strip can miss
  // the low-alpha shoulder even when it is continuous.
  const stripX = 1400;
  const stripWidth = 1296;
  const parentStrip = await engine.readLayerPixels(
    { x: stripX, y: 2048, width: stripWidth, height: 1 },
    0,
  );
  const parentAlphaLevels = Array.from(new Set(
    Array.from({ length: stripWidth }, (_, column) => parentStrip[column * 4 + 3]),
  )).sort((left, right) => left - right);
  let softEdge: ClippingGroupGpuTestReport["softEdge"] = null;
  for (let column = 0; column < stripWidth; column += 1) {
    const alphaByte = parentStrip[column * 4 + 3];
    if (alphaByte < 16 || alphaByte > 64) {
      continue;
    }
    const x = stripX + column;
    const presented = rgba(await engine.readPresentationPixelAtLayer(x, 2048));
    const checkerParity = (Math.floor(x / 96) + Math.floor(2048 / 96)) & 1;
    const backgroundSrgb = checkerParity === 0 ? 0.91 : 0.82;
    const parentAlpha = alphaByte / 255;
    const expectedRgb = Math.round((storedEncodedSrgb
      ? backgroundSrgb * (1 - parentAlpha)
      : linearToSrgb(srgbToLinear(backgroundSrgb) * (1 - parentAlpha))) * 255);
    softEdge = {
      x,
      parentAlpha: alphaByte,
      expectedRgb,
      presented,
      maximumRgbError: Math.max(
        ...presented.slice(0, 3).map((channel) => Math.abs(channel - expectedRgb)),
      ),
    };
    break;
  }
  const softAlphaIsContinuous = softEdge !== null
    && softEdge.parentAlpha > 0
    && softEdge.parentAlpha < 255
    && softEdge.maximumRgbError <= 3;

  await engine.setActiveLayer(0);
  setLayerCompositeTestView(engine, 2048, 1600, 1);
  engine.setBrushSettings({
    color: "#ffffff",
    size: 220,
    count: 1,
    flow: 1,
    opacity: 1,
    hardness: 1,
    blendMode: "light-glaze",
  });
  await engine.ensureLightGlazeResources("light-glaze");

  const before = rgba(await engine.readPresentationPixelAtLayer(2048, 1600));
  engine.beginStrokeAtLayer({ x: 2048, y: 1600, pressure: 1, timeMs: 3_000 });
  engine.extendStrokeAtLayer([{
    x: 2049,
    y: 1600,
    pressure: 1,
    timeMs: 3_016,
  }]);
  await engine.waitForIdle();
  const duringGesture = rgba(await engine.readPresentationPixelAtLayer(2048, 1600));
  engine.endStroke(3_016);
  await engine.waitForIdle();
  const committed = rgba(await engine.readPresentationPixelAtLayer(2048, 1600));

  const parentChangesVisibleBeforeLift = duringGesture.some(
    (channel, index) => index < 3 && Math.abs(channel - before[index]) >= 32,
  );
  const liveEqualsCommitted = duringGesture.every(
    (channel, index) => channel === committed[index],
  );
  const checks = {
    emptyAdvancedBaseIsTransparent,
    relationIsContiguous,
    softAlphaIsContinuous,
    parentChangesVisibleBeforeLift,
    liveEqualsCommitted,
  };
  return {
    version: 1,
    passed: Object.values(checks).every(Boolean),
    checks,
    emptyBasePresented,
    parentAlphaLevels,
    softEdge,
    live: { before, duringGesture, committed },
  };
}
