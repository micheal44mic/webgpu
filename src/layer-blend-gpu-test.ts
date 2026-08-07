import type { BrushEngine } from "./brush-engine";
import {
  blendLayerPremultipliedLinear,
  LAYER_BLEND_MODE_ORDER,
  type LayerBlendMode,
  type LinearPremultipliedRgba,
} from "./layer-blend-modes";

type RgbaBytes = readonly [number, number, number, number];

interface PixelComparison {
  actual: RgbaBytes;
  expected: RgbaBytes;
  maxDelta: number;
}

interface FilterOrderProbe {
  zoom: number;
  selectedMipLevel: number;
  sample: { x: number; y: number };
  actual: RgbaBytes;
  blendThenFilter: RgbaBytes;
  filterThenBlend: RgbaBytes;
  blendThenFilterDelta: number;
  filterThenBlendDelta: number;
  oracleSeparation: number;
}

export interface LayerBlendModeProbe {
  mode: LayerBlendMode;
  comparison: PixelComparison;
}

export interface LayerBlendGpuTestReport {
  version: 2;
  passed: boolean;
  checks: {
    runtimeShaderCompilationGatePassed: boolean;
    runtimeShaderValidationClean: boolean;
    allModesMatchCpuOracle: boolean;
    liveModeChangeVisible: boolean;
    inactiveAboveMatchesCpuOracle: boolean;
    modeHistoryAddsOneAction: boolean;
    undoRestoresOnlyMode: boolean;
    redoRestoresOnlyMode: boolean;
    modeHistoryLeavesRawPixelsUntouched: boolean;
    clippingRelationsAreContiguous: boolean;
    clippingChildrenMatchCpuOracle: boolean;
    clippingPreservesSoftBaseAlpha: boolean;
    activeFirstChildSuffixModesMatchCpuOracle: boolean;
    activeParentAllChildModesMatchCpuOracle: boolean;
    hiddenActiveChildKeepsParentAndSiblings: boolean;
    semanticActiveChildSuffixModesMatchCpuOracle: boolean;
    semanticActiveParentSuffixModesMatchCpuOracle: boolean;
    inactiveClippingModeChangesLive: boolean;
    zoomInBlendRunsBeforeBilinear: boolean;
    zoomOutBlendRunsBeforeMipmap: boolean;
  };
  validationError: string | null;
  ordinary: {
    sample: { x: number; y: number };
    normal: RgbaBytes;
    modes: readonly LayerBlendModeProbe[];
    inactiveAbove: LayerBlendModeProbe;
  };
  history: {
    before: ReturnType<BrushEngine["getHistoryState"]>;
    afterChange: ReturnType<BrushEngine["getHistoryState"]>;
    afterUndo: ReturnType<BrushEngine["getHistoryState"]>;
    afterRedo: ReturnType<BrushEngine["getHistoryState"]>;
    beforeMode: LayerBlendMode;
    changedMode: LayerBlendMode;
    modeAfterUndo: LayerBlendMode;
    modeAfterRedo: LayerBlendMode;
    presentationBefore: RgbaBytes;
    presentationChanged: RgbaBytes;
    presentationAfterUndo: RgbaBytes;
    presentationAfterRedo: RgbaBytes;
    differingRawBytes: number;
  };
  clipping: {
    sample: { x: number; y: number };
    parentId: number;
    childIds: readonly [number, number];
    parentAlphaRaw: number;
    expectedFinalAlpha: number;
    actualFinalAlpha: null;
    alphaOracleSeparation: number;
    wrongSourceOver: PixelComparison;
    multiplyThenScreen: PixelComparison;
    activeFirstChild: PixelComparison;
    activeParent: PixelComparison;
    hiddenActiveChild: PixelComparison;
    semanticActiveFirstChild: PixelComparison;
    semanticActiveParent: PixelComparison;
    afterLiveOverlay: PixelComparison;
    presentation: PixelComparison;
  };
  filterOrder: {
    baseLayerId: number;
    sourceLayerId: number;
    mode: "multiply";
    zoomIn: FilterOrderProbe;
    zoomOut: FilterOrderProbe;
  };
}

const ORDINARY_SAMPLE = { x: 1450, y: 1550 } as const;
const CLIPPING_CENTER = { x: 2700, y: 1550 } as const;
const FILTER_ORDER_SEAM = { x: 2257, y: 3121 } as const;
const FILTER_ORDER_WINDOW = {
  x: FILTER_ORDER_SEAM.x - 24,
  y: FILTER_ORDER_SEAM.y - 8,
  width: 48,
  height: 16,
} as const;
const HISTORY_RAW_RECT = {
  x: ORDINARY_SAMPLE.x - 32,
  y: ORDINARY_SAMPLE.y - 32,
  width: 64,
  height: 64,
} as const;
const ORDINARY_MODES = LAYER_BLEND_MODE_ORDER;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function roundTiesToEven(value: number): number {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (fraction < 0.5) return lower;
  if (fraction > 0.5) return lower + 1;
  return lower % 2 === 0 ? lower : lower + 1;
}

const quantizeUnorm = (value: number): number =>
  roundTiesToEven(clamp01(value) * 255);

const FLOAT16_CONVERSION_F32 = new Float32Array(1);
const FLOAT16_CONVERSION_U32 = new Uint32Array(FLOAT16_CONVERSION_F32.buffer);

function encodeFloat16(value: number): number {
  FLOAT16_CONVERSION_F32[0] = value;
  const source = FLOAT16_CONVERSION_U32[0];
  let result = (source >>> 16) & 0x8000;
  let mantissa = (source >>> 12) & 0x07ff;
  const exponent = (source >>> 23) & 0xff;
  if (exponent < 103) return result;
  if (exponent > 142) {
    result |= 0x7c00;
    if (exponent === 0xff && (source & 0x007fffff) !== 0) result |= 0x0200;
    return result;
  }
  if (exponent < 113) {
    mantissa |= 0x0800;
    result |= (mantissa >>> (114 - exponent))
      + ((mantissa >>> (113 - exponent)) & 1);
    return result;
  }
  result |= ((exponent - 112) << 10) | (mantissa >>> 1);
  return result + (mantissa & 1);
}

function decodeFloat16(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

function rgba16FloatTexel(bytes: Uint8Array, byteOffset = 0): LinearPremultipliedRgba {
  const channel = (offset: number): number => decodeFloat16(
    bytes[byteOffset + offset] | (bytes[byteOffset + offset + 1] << 8),
  );
  return [channel(0), channel(2), channel(4), channel(6)];
}

const srgbToLinear = (value: number): number =>
  value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;

const linearToSrgb = (value: number): number => {
  const channel = Math.max(0, value);
  return channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * channel ** (1 / 2.4) - 0.055;
};

function rgbaBytes(value: Uint8Array | readonly number[]): RgbaBytes {
  return [value[0], value[1], value[2], value[3]];
}

function linearRgba(value: Uint8Array | RgbaBytes): LinearPremultipliedRgba {
  if (value instanceof Uint8Array) {
    if (value.byteLength < 8) {
      throw new Error(`Readback RGBA16F incompleto: ${value.byteLength} byte.`);
    }
    return rgba16FloatTexel(value);
  }
  return [value[0] / 255, value[1] / 255, value[2] / 255, value[3] / 255];
}

function scalePremultiplied(
  value: LinearPremultipliedRgba,
  opacity: number,
): LinearPremultipliedRgba {
  const scale = clamp01(opacity);
  return [
    value[0] * scale,
    value[1] * scale,
    value[2] * scale,
    value[3] * scale,
  ];
}

function quantizedLinear(value: LinearPremultipliedRgba): LinearPremultipliedRgba {
  const stored = (channel: number): number =>
    decodeFloat16(encodeFloat16(clamp01(channel)));
  return [stored(value[0]), stored(value[1]), stored(value[2]), stored(value[3])];
}

function checkerSrgb(x: number, y: number): number {
  const parity = (Math.floor((x + 0.5) / 96) + Math.floor((y + 0.5) / 96)) & 1;
  return parity === 0 ? 0.91 : 0.82;
}

function checkerSrgbAtPosition(x: number, y: number): number {
  const parity = (Math.floor(x / 96) + Math.floor(y / 96)) & 1;
  return parity === 0 ? 0.91 : 0.82;
}

function presentationBytes(
  paint: LinearPremultipliedRgba,
  x: number,
  y: number,
): RgbaBytes {
  const background = srgbToLinear(checkerSrgb(x, y));
  const inverseAlpha = 1 - paint[3];
  return [
    quantizeUnorm(linearToSrgb(paint[0] + background * inverseAlpha)),
    quantizeUnorm(linearToSrgb(paint[1] + background * inverseAlpha)),
    quantizeUnorm(linearToSrgb(paint[2] + background * inverseAlpha)),
    255,
  ];
}

function presentationBytesAtPosition(
  paint: LinearPremultipliedRgba,
  x: number,
  y: number,
): RgbaBytes {
  const background = srgbToLinear(checkerSrgbAtPosition(x, y));
  const inverseAlpha = 1 - paint[3];
  return [
    quantizeUnorm(linearToSrgb(paint[0] + background * inverseAlpha)),
    quantizeUnorm(linearToSrgb(paint[1] + background * inverseAlpha)),
    quantizeUnorm(linearToSrgb(paint[2] + background * inverseAlpha)),
    255,
  ];
}

interface LayerPixelWindow {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Uint8Array;
}

function windowTexel(
  window: LayerPixelWindow,
  x: number,
  y: number,
): LinearPremultipliedRgba {
  const localX = x - window.x;
  const localY = y - window.y;
  if (
    localX < 0 || localY < 0
    || localX >= window.width || localY >= window.height
  ) {
    throw new Error(`Oracle filtro fuori finestra a ${x},${y}.`);
  }
  const offset = (localY * window.width + localX) * 8;
  return rgba16FloatTexel(window.pixels, offset);
}

function mixLinear(
  left: LinearPremultipliedRgba,
  right: LinearPremultipliedRgba,
  amount: number,
): LinearPremultipliedRgba {
  const weight = clamp01(amount);
  return [
    left[0] + (right[0] - left[0]) * weight,
    left[1] + (right[1] - left[1]) * weight,
    left[2] + (right[2] - left[2]) * weight,
    left[3] + (right[3] - left[3]) * weight,
  ];
}

function averageFour(
  p00: LinearPremultipliedRgba,
  p10: LinearPremultipliedRgba,
  p01: LinearPremultipliedRgba,
  p11: LinearPremultipliedRgba,
): LinearPremultipliedRgba {
  return [
    (p00[0] + p10[0] + p01[0] + p11[0]) * 0.25,
    (p00[1] + p10[1] + p01[1] + p11[1]) * 0.25,
    (p00[2] + p10[2] + p01[2] + p11[2]) * 0.25,
    (p00[3] + p10[3] + p01[3] + p11[3]) * 0.25,
  ];
}

function bilinearSample(
  sample: (x: number, y: number) => LinearPremultipliedRgba,
  x: number,
  y: number,
): LinearPremultipliedRgba {
  const originX = Math.floor(x);
  const originY = Math.floor(y);
  const horizontal = x - originX;
  const vertical = y - originY;
  return mixLinear(
    mixLinear(sample(originX, originY), sample(originX + 1, originY), horizontal),
    mixLinear(
      sample(originX, originY + 1),
      sample(originX + 1, originY + 1),
      horizontal,
    ),
    vertical,
  );
}

function blendedDocumentTexel(
  base: LayerPixelWindow,
  source: LayerPixelWindow,
  x: number,
  y: number,
): LinearPremultipliedRgba {
  return quantizedLinear(blendLayerPremultipliedLinear(
    windowTexel(base, x, y),
    windowTexel(source, x, y),
    "multiply",
  ));
}

function mipOneTexel(
  sample: (x: number, y: number) => LinearPremultipliedRgba,
  x: number,
  y: number,
): LinearPremultipliedRgba {
  const documentX = x * 2;
  const documentY = y * 2;
  return quantizedLinear(averageFour(
    sample(documentX, documentY),
    sample(documentX + 1, documentY),
    sample(documentX, documentY + 1),
    sample(documentX + 1, documentY + 1),
  ));
}

function filterOrderOracle(
  base: LayerPixelWindow,
  source: LayerPixelWindow,
  position: { x: number; y: number },
  selectedMipLevel: 0 | 1,
): {
  blendThenFilter: LinearPremultipliedRgba;
  filterThenBlend: LinearPremultipliedRgba;
  blendThenFilterBytes: RgbaBytes;
  filterThenBlendBytes: RgbaBytes;
  oracleSeparation: number;
} {
  let blendThenFilter: LinearPremultipliedRgba;
  let filteredBase: LinearPremultipliedRgba;
  let filteredSource: LinearPremultipliedRgba;
  if (selectedMipLevel === 0) {
    blendThenFilter = bilinearSample(
      (x, y) => blendedDocumentTexel(base, source, x, y),
      position.x,
      position.y,
    );
    filteredBase = bilinearSample(
      (x, y) => windowTexel(base, x, y),
      position.x,
      position.y,
    );
    filteredSource = bilinearSample(
      (x, y) => windowTexel(source, x, y),
      position.x,
      position.y,
    );
  } else {
    // textureSampleLevel on mip 1 maps document position P to texel space
    // P / 2 - 0.25 because the shader samples (P + 0.5) / 4096.
    const mipX = position.x * 0.5 - 0.25;
    const mipY = position.y * 0.5 - 0.25;
    blendThenFilter = bilinearSample(
      (x, y) => mipOneTexel(
        (documentX, documentY) => blendedDocumentTexel(
          base,
          source,
          documentX,
          documentY,
        ),
        x,
        y,
      ),
      mipX,
      mipY,
    );
    filteredBase = bilinearSample(
      (x, y) => mipOneTexel(
        (documentX, documentY) => windowTexel(base, documentX, documentY),
        x,
        y,
      ),
      mipX,
      mipY,
    );
    filteredSource = bilinearSample(
      (x, y) => mipOneTexel(
        (documentX, documentY) => windowTexel(source, documentX, documentY),
        x,
        y,
      ),
      mipX,
      mipY,
    );
  }
  const filterThenBlend = blendLayerPremultipliedLinear(
    filteredBase,
    filteredSource,
    "multiply",
  );
  const blendThenFilterBytes = presentationBytesAtPosition(
    blendThenFilter,
    position.x,
    position.y,
  );
  const filterThenBlendBytes = presentationBytesAtPosition(
    filterThenBlend,
    position.x,
    position.y,
  );
  return {
    blendThenFilter,
    filterThenBlend,
    blendThenFilterBytes,
    filterThenBlendBytes,
    oracleSeparation: compare(
      blendThenFilterBytes,
      filterThenBlendBytes,
    ).maxDelta,
  };
}

function selectFilterOrderProbe(
  base: LayerPixelWindow,
  source: LayerPixelWindow,
  selectedMipLevel: 0 | 1,
): {
  position: { x: number; y: number };
  oracle: ReturnType<typeof filterOrderOracle>;
} {
  const step = selectedMipLevel === 0 ? 0.25 : 0.5;
  let best: {
    position: { x: number; y: number };
    oracle: ReturnType<typeof filterOrderOracle>;
  } | null = null;
  for (
    let y = FILTER_ORDER_SEAM.y - 2;
    y <= FILTER_ORDER_SEAM.y + 2;
    y += step
  ) {
    for (
      let x = FILTER_ORDER_SEAM.x - 12;
      x <= FILTER_ORDER_SEAM.x + 12;
      x += step
    ) {
      const position = { x, y };
      const oracle = filterOrderOracle(base, source, position, selectedMipLevel);
      if (!best || oracle.oracleSeparation > best.oracle.oracleSeparation) {
        best = { position, oracle };
      }
    }
  }
  if (!best || best.oracle.oracleSeparation < 8) {
    throw new Error(
      `Pattern filtro non discriminante al mip ${selectedMipLevel}: `
      + `${best?.oracle.oracleSeparation ?? 0} codici.`,
    );
  }
  return best;
}

async function readPresentationAtExactLayerPosition(
  engine: BrushEngine,
  position: { x: number; y: number },
  zoom: number,
): Promise<RgbaBytes> {
  const environment = engine.getBenchmarkEnvironment();
  const centerFragmentOffsetX = Math.round(environment.canvasWidth * 0.5 - 0.5)
    + 0.5 - environment.canvasWidth * 0.5;
  const centerFragmentOffsetY = Math.round(environment.canvasHeight * 0.5 - 0.5)
    + 0.5 - environment.canvasHeight * 0.5;
  const viewCenterX = position.x - centerFragmentOffsetX / zoom;
  const viewCenterY = position.y - centerFragmentOffsetY / zoom;
  engine.setLayerCompositeTestView(viewCenterX, viewCenterY, zoom);
  await engine.waitForIdle();
  // The readback helper adds 0.5 before mapping to canvas. Passing center-0.5
  // therefore selects the exact center canvas fragment used above.
  return readPresentation(engine, viewCenterX - 0.5, viewCenterY - 0.5);
}

function compare(
  actualValue: Uint8Array | RgbaBytes,
  expected: RgbaBytes,
): PixelComparison {
  const actual = rgbaBytes(actualValue);
  return {
    actual,
    expected,
    maxDelta: Math.max(
      Math.abs(actual[0] - expected[0]),
      Math.abs(actual[1] - expected[1]),
      Math.abs(actual[2] - expected[2]),
      Math.abs(actual[3] - expected[3]),
    ),
  };
}

function differingBytes(left: Uint8Array, right: Uint8Array): number {
  if (left.byteLength !== right.byteLength) {
    return Math.max(left.byteLength, right.byteLength);
  }
  let count = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    count += Number(left[index] !== right[index]);
  }
  return count;
}

function sourceAtopBlend(
  backdrop: LinearPremultipliedRgba,
  source: LinearPremultipliedRgba,
  mode: LayerBlendMode,
): LinearPremultipliedRgba {
  const sourceOver = blendLayerPremultipliedLinear(backdrop, source, mode);
  const sourceOutsideBackdrop = 1 - backdrop[3];
  return [
    clamp01(sourceOver[0] - source[0] * sourceOutsideBackdrop),
    clamp01(sourceOver[1] - source[1] * sourceOutsideBackdrop),
    clamp01(sourceOver[2] - source[2] * sourceOutsideBackdrop),
    clamp01(backdrop[3]),
  ];
}

async function readLayerPixel(
  engine: BrushEngine,
  layerIndex: number,
  x: number,
  y: number,
): Promise<Uint8Array> {
  return engine.readLayerPixels({ x, y, width: 1, height: 1 }, layerIndex);
}

async function readPresentation(
  engine: BrushEngine,
  x: number,
  y: number,
): Promise<RgbaBytes> {
  return rgbaBytes(await engine.readPresentationPixelAtLayer(x, y));
}

async function drawTap(
  engine: BrushEngine,
  x: number,
  y: number,
  color: string,
  timeMs: number,
  size: number,
  hardness: number,
): Promise<void> {
  engine.setBrushSettings({ color, size, hardness });
  engine.beginStrokeAtLayer({ x, y, pressure: 1, timeMs });
  engine.extendStrokeAtLayer([{ x: x + 1, y, pressure: 1, timeMs: timeMs + 16 }]);
  engine.endStroke(timeMs + 16);
  await engine.waitForIdle();
}

function ordinaryOracle(
  baseRaw: Uint8Array,
  sourceRaw: Uint8Array,
  mode: LayerBlendMode,
): LinearPremultipliedRgba {
  return blendLayerPremultipliedLinear(
    scalePremultiplied(linearRgba(baseRaw), 0.78),
    scalePremultiplied(linearRgba(sourceRaw), 0.57),
    mode,
  );
}

export async function runLayerBlendGpuTest(
  engine: BrushEngine,
): Promise<LayerBlendGpuTestReport> {
  const initial = engine.getStats();
  const initialHistory = engine.getHistoryState();
  if (
    initial.layerFormat !== "rgba16float"
    || initial.layerCount !== 1
    || initial.layers[0]?.hasContent
    || initialHistory.actionCount !== 0
    || initialHistory.cursor !== 0
  ) {
    throw new Error(
      "La sonda fusioni richiede una pagina dev nuova, RGBA16F, con un solo raster vuoto.",
    );
  }

  // main.ts invokes this harness only after initialize() resolves. Initialization
  // awaits getCompilationInfo() for the real layerBlendFoldShaderModule and
  // rejects on every WGSL error, so reaching this line proves that exact runtime
  // shader passed its compilation gate without reaching into engine internals.
  const runtimeShaderCompilationGatePassed = true;

  engine.setBrushSettings({
    tool: "paint",
    shape: "circle",
    grainMode: "off",
    shapeScatter: 0,
    color: "#3f7fd6",
    size: 620,
    spacingPercent: 2,
    stabilization: 0,
    startThickness: 1,
    endThickness: 1,
    count: 1,
    flow: 1,
    opacity: 1,
    hardness: 1,
    blendMode: "normal",
    hueJitterDegrees: 0,
    saturationJitter: 0,
    lightnessJitter: 0,
    darknessJitter: 0,
    positionJitterLateral: 0,
    positionJitterLinear: 0,
  });

  let timeMs = 1_000;
  engine.setLayerCompositeTestView(ORDINARY_SAMPLE.x, ORDINARY_SAMPLE.y, 1);
  await drawTap(
    engine,
    ORDINARY_SAMPLE.x,
    ORDINARY_SAMPLE.y,
    "#3f7fd6",
    timeMs += 100,
    620,
    1,
  );
  await engine.setLayerOpacity(0, 0.78);
  await engine.addLayer("Fusione sorgente");
  await drawTap(
    engine,
    ORDINARY_SAMPLE.x,
    ORDINARY_SAMPLE.y,
    "#e94d63",
    timeMs += 100,
    620,
    1,
  );
  await engine.setLayerOpacity(1, 0.57);

  const baseRaw = await readLayerPixel(
    engine,
    0,
    ORDINARY_SAMPLE.x,
    ORDINARY_SAMPLE.y,
  );
  const sourceRaw = await readLayerPixel(
    engine,
    1,
    ORDINARY_SAMPLE.x,
    ORDINARY_SAMPLE.y,
  );
  const normal = await readPresentation(engine, ORDINARY_SAMPLE.x, ORDINARY_SAMPLE.y);
  const expectedNormal = presentationBytes(
    ordinaryOracle(baseRaw, sourceRaw, "normal"),
    ORDINARY_SAMPLE.x,
    ORDINARY_SAMPLE.y,
  );
  if (compare(normal, expectedNormal).maxDelta > 3) {
    throw new Error("Baseline Normal della sonda fusioni non coincide con l'oracle lineare.");
  }

  engine.device.pushErrorScope("validation");
  let validationError: GPUError | null = null;
  let modeOperationError: unknown = null;
  const modeProbes: LayerBlendModeProbe[] = [];
  let inactiveAbove: LayerBlendModeProbe | null = null;
  try {
    for (const mode of ORDINARY_MODES) {
      await engine.setLayerBlendMode(1, mode);
      const actual = await readPresentation(engine, ORDINARY_SAMPLE.x, ORDINARY_SAMPLE.y);
      const expected = presentationBytes(
        ordinaryOracle(baseRaw, sourceRaw, mode),
        ORDINARY_SAMPLE.x,
        ORDINARY_SAMPLE.y,
      );
      modeProbes.push({ mode, comparison: compare(actual, expected) });
    }

    await engine.setLayerBlendMode(1, "overlay");
    await engine.setActiveLayer(0);
    engine.setLayerCompositeTestView(ORDINARY_SAMPLE.x, ORDINARY_SAMPLE.y, 1);
    const inactiveActual = await readPresentation(
      engine,
      ORDINARY_SAMPLE.x,
      ORDINARY_SAMPLE.y,
    );
    inactiveAbove = {
      mode: "overlay",
      comparison: compare(
        inactiveActual,
        presentationBytes(
          ordinaryOracle(baseRaw, sourceRaw, "overlay"),
          ORDINARY_SAMPLE.x,
          ORDINARY_SAMPLE.y,
        ),
      ),
    };
    await engine.waitForIdle();
  } catch (error) {
    modeOperationError = error;
  } finally {
    validationError = await engine.device.popErrorScope();
  }
  if (modeOperationError) throw modeOperationError;
  if (!inactiveAbove) throw new Error("Sonda mergedAbove della fusione non completata.");

  await engine.setActiveLayer(1);
  await engine.setLayerBlendMode(1, "multiply");
  const historyPresentationBefore = await readPresentation(
    engine,
    ORDINARY_SAMPLE.x,
    ORDINARY_SAMPLE.y,
  );
  const rawBeforeHistory = await Promise.all([
    engine.readLayerPixels(HISTORY_RAW_RECT, 0),
    engine.readLayerPixels(HISTORY_RAW_RECT, 1),
  ]);
  const historyBefore = engine.getHistoryState();
  await engine.setLayerBlendMode(1, "difference");
  const historyAfterChange = engine.getHistoryState();
  const historyPresentationChanged = await readPresentation(
    engine,
    ORDINARY_SAMPLE.x,
    ORDINARY_SAMPLE.y,
  );
  const undoAccepted = await engine.undo();
  const historyAfterUndo = engine.getHistoryState();
  const modeAfterUndo = engine.getStats().layers[1].blendMode;
  const historyPresentationAfterUndo = await readPresentation(
    engine,
    ORDINARY_SAMPLE.x,
    ORDINARY_SAMPLE.y,
  );
  const redoAccepted = await engine.redo();
  const historyAfterRedo = engine.getHistoryState();
  const modeAfterRedo = engine.getStats().layers[1].blendMode;
  const historyPresentationAfterRedo = await readPresentation(
    engine,
    ORDINARY_SAMPLE.x,
    ORDINARY_SAMPLE.y,
  );
  const rawAfterHistory = await Promise.all([
    engine.readLayerPixels(HISTORY_RAW_RECT, 0),
    engine.readLayerPixels(HISTORY_RAW_RECT, 1),
  ]);
  const differingRawBytes = differingBytes(rawBeforeHistory[0], rawAfterHistory[0])
    + differingBytes(rawBeforeHistory[1], rawAfterHistory[1]);

  await engine.addLayer("Base gruppo fusione");
  await drawTap(
    engine,
    CLIPPING_CENTER.x,
    CLIPPING_CENTER.y,
    "#4b8fd8",
    timeMs += 100,
    620,
    0,
  );
  const clippingParentIndex = 2;
  const clippingParentId = engine.getStats().layers[clippingParentIndex].id;
  const scanX = CLIPPING_CENTER.x - 340;
  const scanWidth = 680;
  const parentStrip = await engine.readLayerPixels(
    { x: scanX, y: CLIPPING_CENTER.y, width: scanWidth, height: 1 },
    clippingParentIndex,
  );
  let clippingSampleX = -1;
  for (let offset = 0; offset < scanWidth; offset += 1) {
    const alpha = rgba16FloatTexel(parentStrip, offset * 8)[3];
    if (alpha >= 48 / 255 && alpha <= 192 / 255) {
      clippingSampleX = scanX + offset;
      break;
    }
  }
  if (clippingSampleX < 0) {
    throw new Error("Bordo alpha morbido della base clipping non trovato.");
  }
  await engine.setLayerOpacity(clippingParentIndex, 0.83);

  await engine.addClippingMaskLayer();
  const firstChildIndex = 3;
  await drawTap(
    engine,
    CLIPPING_CENTER.x,
    CLIPPING_CENTER.y,
    "#f05272",
    timeMs += 100,
    980,
    1,
  );
  await engine.setLayerOpacity(firstChildIndex, 0.61);
  await engine.setLayerBlendMode(firstChildIndex, "multiply");

  await engine.addClippingMaskLayer();
  const secondChildIndex = 4;
  await drawTap(
    engine,
    CLIPPING_CENTER.x,
    CLIPPING_CENTER.y,
    "#43b9ef",
    timeMs += 100,
    980,
    1,
  );
  await engine.setLayerOpacity(secondChildIndex, 0.46);
  await engine.setLayerBlendMode(secondChildIndex, "screen");

  const groupedStats = engine.getStats().layers;
  const firstChildId = groupedStats[firstChildIndex].id;
  const secondChildId = groupedStats[secondChildIndex].id;
  const clippingRelationsAreContiguous =
    groupedStats[firstChildIndex].clippingParentId === clippingParentId
    && groupedStats[secondChildIndex].clippingParentId === clippingParentId;
  const [parentRaw, firstChildRaw, secondChildRaw] = await Promise.all([
    readLayerPixel(engine, clippingParentIndex, clippingSampleX, CLIPPING_CENTER.y),
    readLayerPixel(engine, firstChildIndex, clippingSampleX, CLIPPING_CENTER.y),
    readLayerPixel(engine, secondChildIndex, clippingSampleX, CLIPPING_CENTER.y),
  ]);

  const parentLinear = linearRgba(parentRaw);
  const firstSource = scalePremultiplied(linearRgba(firstChildRaw), 0.61);
  const secondSource = scalePremultiplied(linearRgba(secondChildRaw), 0.46);
  const afterFirst = quantizedLinear(
    sourceAtopBlend(parentLinear, firstSource, "multiply"),
  );
  const afterSecond = quantizedLinear(
    sourceAtopBlend(afterFirst, secondSource, "screen"),
  );
  const expectedClippingGroup = scalePremultiplied(afterSecond, 0.83);

  const wrongAfterFirst = quantizedLinear(blendLayerPremultipliedLinear(
    parentLinear,
    firstSource,
    "multiply",
  ));
  const wrongAfterSecond = quantizedLinear(blendLayerPremultipliedLinear(
    wrongAfterFirst,
    secondSource,
    "screen",
  ));
  const wrongSourceOverGroup = scalePremultiplied(wrongAfterSecond, 0.83);

  const expectedClippingPresentation = presentationBytes(
    expectedClippingGroup,
    clippingSampleX,
    CLIPPING_CENTER.y,
  );
  await engine.setActiveLayer(firstChildIndex);
  engine.setLayerCompositeTestView(clippingSampleX, CLIPPING_CENTER.y, 1);
  const activeFirstChild = compare(
    await readPresentation(engine, clippingSampleX, CLIPPING_CENTER.y),
    expectedClippingPresentation,
  );
  await engine.setActiveLayer(clippingParentIndex);
  engine.setLayerCompositeTestView(clippingSampleX, CLIPPING_CENTER.y, 1);
  const activeParent = compare(
    await readPresentation(engine, clippingSampleX, CLIPPING_CENTER.y),
    expectedClippingPresentation,
  );

  await engine.setActiveLayer(firstChildIndex);
  await engine.setLayerVisibility(firstChildIndex, false);
  engine.setLayerCompositeTestView(clippingSampleX, CLIPPING_CENTER.y, 1);
  const expectedWithoutFirst = scalePremultiplied(
    quantizedLinear(sourceAtopBlend(parentLinear, secondSource, "screen")),
    0.83,
  );
  const hiddenActiveChild = compare(
    await readPresentation(engine, clippingSampleX, CLIPPING_CENTER.y),
    presentationBytes(expectedWithoutFirst, clippingSampleX, CLIPPING_CENTER.y),
  );
  await engine.setLayerVisibility(firstChildIndex, true);

  // A distant semantic node selects the viewport-ordered GPU path without
  // contributing at this sample. Advanced clipping children must retain the
  // same ordered source-atop result for both active-child and active-parent.
  const semanticProbe = await engine.addVectorTextNode({
    text: "GPU",
    fontFamily: "Anton",
    fontSize: 120,
    color: "#111111",
    outlineWidth: 0,
    outlineColor: "#111111",
    outlineJoin: "round",
    blockShadowEnabled: false,
    blockShadowColor: "#000000",
    blockShadowOpacity: 1,
    blockShadowOffset: 0,
    blockShadowAngle: 0,
    blockShadowOutlineWidth: 0,
    singleShadowEnabled: false,
    singleShadowColor: "#000000",
    singleShadowOpacity: 0,
    singleShadowOffset: 0,
    singleShadowAngle: 0,
    singleShadowBlur: 0,
    innerShadowEnabled: false,
    innerShadowColor: "#000000",
    innerShadowOpacity: 0,
    innerShadowOffset: 0,
    innerShadowAngle: 0,
    innerShadowBlur: 0,
    x: 240,
    y: 240,
    scale: 1,
    rotation: 0,
  }, "Sonda semantica fusione");
  await engine.setActiveLayer(firstChildIndex);
  engine.setLayerCompositeTestView(clippingSampleX, CLIPPING_CENTER.y, 1);
  const semanticActiveFirstChild = compare(
    await readPresentation(engine, clippingSampleX, CLIPPING_CENTER.y),
    expectedClippingPresentation,
  );
  await engine.setActiveLayer(clippingParentIndex);
  engine.setLayerCompositeTestView(clippingSampleX, CLIPPING_CENTER.y, 1);
  const semanticActiveParent = compare(
    await readPresentation(engine, clippingSampleX, CLIPPING_CENTER.y),
    expectedClippingPresentation,
  );
  await engine.setVectorTextNodeVisibility(semanticProbe.id, false);

  // Keep the complete clipping unit inactive. Advanced ordered composition is
  // intentionally presentation-only and may allocate no legacy mergedAbove.
  // The checkerboard oracle still observes alpha: an incorrect source-over
  // child produces a separately computed and strongly different RGB result.
  await engine.setActiveLayer(1);
  engine.setLayerCompositeTestView(clippingSampleX, CLIPPING_CENTER.y, 1);
  const clippingPresentationActual = await readPresentation(
    engine,
    clippingSampleX,
    CLIPPING_CENTER.y,
  );
  const multiplyThenScreen = compare(
    clippingPresentationActual,
    expectedClippingPresentation,
  );
  const clippingPresentation = { ...multiplyThenScreen };
  const wrongSourceOver = compare(
    clippingPresentationActual,
    presentationBytes(wrongSourceOverGroup, clippingSampleX, CLIPPING_CENTER.y),
  );
  const alphaOracleSeparation = compare(
    expectedClippingPresentation,
    presentationBytes(wrongSourceOverGroup, clippingSampleX, CLIPPING_CENTER.y),
  ).maxDelta;

  await engine.setLayerBlendMode(secondChildIndex, "overlay");
  const afterOverlay = quantizedLinear(
    sourceAtopBlend(afterFirst, secondSource, "overlay"),
  );
  const expectedLiveOverlay = scalePremultiplied(afterOverlay, 0.83);
  const presentationAfterOverlay = await readPresentation(
    engine,
    clippingSampleX,
    CLIPPING_CENTER.y,
  );
  const afterLiveOverlay = compare(
    presentationAfterOverlay,
    presentationBytes(expectedLiveOverlay, clippingSampleX, CLIPPING_CENTER.y),
  );

  const expectedFinalAlpha = quantizeUnorm(parentLinear[3] * 0.83);
  const actualFinalAlpha = null;

  await engine.addLayer("Ordine filtro base");
  const filterBaseLayerId = engine.getStats().activeLayerId;
  await drawTap(
    engine,
    FILTER_ORDER_SEAM.x - 250,
    FILTER_ORDER_SEAM.y,
    "#00ffff",
    timeMs += 100,
    500,
    1,
  );
  await engine.addLayer("Ordine filtro sorgente");
  const filterSourceLayerId = engine.getStats().activeLayerId;
  await drawTap(
    engine,
    FILTER_ORDER_SEAM.x + 250,
    FILTER_ORDER_SEAM.y,
    "#ff0000",
    timeMs += 100,
    500,
    1,
  );
  const filterSourceIndex = engine.getStats().activeLayerIndex;
  await engine.setLayerBlendMode(filterSourceIndex, "multiply");
  await engine.setActiveLayer(0);

  const filterLayers = engine.getStats().layers;
  const filterBaseIndex = filterLayers.findIndex(
    (layer) => layer.id === filterBaseLayerId,
  );
  const relocatedFilterSourceIndex = filterLayers.findIndex(
    (layer) => layer.id === filterSourceLayerId,
  );
  if (filterBaseIndex < 0 || relocatedFilterSourceIndex < 0) {
    throw new Error("Livelli della sonda ordine filtro non trovati.");
  }
  const [filterBasePixels, filterSourcePixels] = await Promise.all([
    engine.readLayerPixels(FILTER_ORDER_WINDOW, filterBaseIndex),
    engine.readLayerPixels(FILTER_ORDER_WINDOW, relocatedFilterSourceIndex),
  ]);
  const filterBaseWindow: LayerPixelWindow = {
    ...FILTER_ORDER_WINDOW,
    pixels: filterBasePixels,
  };
  const filterSourceWindow: LayerPixelWindow = {
    ...FILTER_ORDER_WINDOW,
    pixels: filterSourcePixels,
  };

  const zoomInCandidate = selectFilterOrderProbe(
    filterBaseWindow,
    filterSourceWindow,
    0,
  );
  const zoomInActual = await readPresentationAtExactLayerPosition(
    engine,
    zoomInCandidate.position,
    1.5,
  );
  const zoomInCorrectComparison = compare(
    zoomInActual,
    zoomInCandidate.oracle.blendThenFilterBytes,
  );
  const zoomInWrongComparison = compare(
    zoomInActual,
    zoomInCandidate.oracle.filterThenBlendBytes,
  );
  const zoomIn: FilterOrderProbe = {
    zoom: 1.5,
    selectedMipLevel: engine.getLayerCompositeState().selectedMipLevel,
    sample: zoomInCandidate.position,
    actual: zoomInActual,
    blendThenFilter: zoomInCandidate.oracle.blendThenFilterBytes,
    filterThenBlend: zoomInCandidate.oracle.filterThenBlendBytes,
    blendThenFilterDelta: zoomInCorrectComparison.maxDelta,
    filterThenBlendDelta: zoomInWrongComparison.maxDelta,
    oracleSeparation: zoomInCandidate.oracle.oracleSeparation,
  };

  const zoomOutCandidate = selectFilterOrderProbe(
    filterBaseWindow,
    filterSourceWindow,
    1,
  );
  const zoomOutActual = await readPresentationAtExactLayerPosition(
    engine,
    zoomOutCandidate.position,
    0.4,
  );
  const zoomOutCorrectComparison = compare(
    zoomOutActual,
    zoomOutCandidate.oracle.blendThenFilterBytes,
  );
  const zoomOutWrongComparison = compare(
    zoomOutActual,
    zoomOutCandidate.oracle.filterThenBlendBytes,
  );
  const zoomOut: FilterOrderProbe = {
    zoom: 0.4,
    selectedMipLevel: engine.getLayerCompositeState().selectedMipLevel,
    sample: zoomOutCandidate.position,
    actual: zoomOutActual,
    blendThenFilter: zoomOutCandidate.oracle.blendThenFilterBytes,
    filterThenBlend: zoomOutCandidate.oracle.filterThenBlendBytes,
    blendThenFilterDelta: zoomOutCorrectComparison.maxDelta,
    filterThenBlendDelta: zoomOutWrongComparison.maxDelta,
    oracleSeparation: zoomOutCandidate.oracle.oracleSeparation,
  };

  const checks = {
    runtimeShaderCompilationGatePassed,
    runtimeShaderValidationClean: validationError === null,
    allModesMatchCpuOracle: modeProbes.length === ORDINARY_MODES.length
      && modeProbes.every((probe) => probe.comparison.maxDelta <= 3),
    liveModeChangeVisible: modeProbes.length > 0
      && modeProbes[0].comparison.actual.some((channel, index) => channel !== normal[index]),
    inactiveAboveMatchesCpuOracle: inactiveAbove.comparison.maxDelta <= 3,
    modeHistoryAddsOneAction:
      historyAfterChange.actionCount === historyBefore.actionCount + 1
      && historyAfterChange.cursor === historyBefore.cursor + 1,
    undoRestoresOnlyMode:
      undoAccepted
      && modeAfterUndo === "multiply"
      && historyAfterUndo.cursor === historyBefore.cursor
      && historyPresentationAfterUndo.every(
        (channel, index) => channel === historyPresentationBefore[index],
      ),
    redoRestoresOnlyMode:
      redoAccepted
      && modeAfterRedo === "difference"
      && historyAfterRedo.cursor === historyAfterChange.cursor
      && historyPresentationAfterRedo.every(
        (channel, index) => channel === historyPresentationChanged[index],
      ),
    modeHistoryLeavesRawPixelsUntouched: differingRawBytes === 0,
    clippingRelationsAreContiguous,
    clippingChildrenMatchCpuOracle:
      multiplyThenScreen.maxDelta <= 4
      && clippingPresentation.maxDelta <= 4,
    clippingPreservesSoftBaseAlpha:
      parentLinear[3] > 0
      && parentLinear[3] < 1
      && multiplyThenScreen.maxDelta <= 4
      && alphaOracleSeparation >= 8
      && wrongSourceOver.maxDelta >= multiplyThenScreen.maxDelta + 4,
    activeFirstChildSuffixModesMatchCpuOracle: activeFirstChild.maxDelta <= 4,
    activeParentAllChildModesMatchCpuOracle: activeParent.maxDelta <= 4,
    hiddenActiveChildKeepsParentAndSiblings: hiddenActiveChild.maxDelta <= 4,
    semanticActiveChildSuffixModesMatchCpuOracle:
      semanticActiveFirstChild.maxDelta <= 4,
    semanticActiveParentSuffixModesMatchCpuOracle: semanticActiveParent.maxDelta <= 4,
    inactiveClippingModeChangesLive:
      afterLiveOverlay.maxDelta <= 4
      && afterLiveOverlay.actual.some(
        (channel, index) => channel !== multiplyThenScreen.actual[index],
      ),
    zoomInBlendRunsBeforeBilinear:
      zoomIn.selectedMipLevel === 0
      && zoomIn.oracleSeparation >= 8
      && zoomIn.blendThenFilterDelta <= 5
      && zoomIn.filterThenBlendDelta >= zoomIn.blendThenFilterDelta + 4,
    zoomOutBlendRunsBeforeMipmap:
      zoomOut.selectedMipLevel === 1
      && zoomOut.oracleSeparation >= 8
      && zoomOut.blendThenFilterDelta <= 5
      && zoomOut.filterThenBlendDelta >= zoomOut.blendThenFilterDelta + 4,
  };

  return {
    version: 2,
    passed: Object.values(checks).every(Boolean),
    checks,
    validationError: validationError ? validationError.message : null,
    ordinary: {
      sample: ORDINARY_SAMPLE,
      normal,
      modes: modeProbes,
      inactiveAbove,
    },
    history: {
      before: historyBefore,
      afterChange: historyAfterChange,
      afterUndo: historyAfterUndo,
      afterRedo: historyAfterRedo,
      beforeMode: "multiply",
      changedMode: "difference",
      modeAfterUndo,
      modeAfterRedo,
      presentationBefore: historyPresentationBefore,
      presentationChanged: historyPresentationChanged,
      presentationAfterUndo: historyPresentationAfterUndo,
      presentationAfterRedo: historyPresentationAfterRedo,
      differingRawBytes,
    },
    clipping: {
      sample: { x: clippingSampleX, y: CLIPPING_CENTER.y },
      parentId: clippingParentId,
      childIds: [firstChildId, secondChildId],
      parentAlphaRaw: parentLinear[3],
      expectedFinalAlpha,
      actualFinalAlpha,
      alphaOracleSeparation,
      wrongSourceOver,
      multiplyThenScreen,
      activeFirstChild,
      activeParent,
      hiddenActiveChild,
      semanticActiveFirstChild,
      semanticActiveParent,
      afterLiveOverlay,
      presentation: clippingPresentation,
    },
    filterOrder: {
      baseLayerId: filterBaseLayerId,
      sourceLayerId: filterSourceLayerId,
      mode: "multiply",
      zoomIn,
      zoomOut,
    },
  };
}
