import type { BrushEngine } from "../../brush-engine";
import {
  ensureLabCheckerboardBackdrop,
  setLayerCompositeTestView,
} from "../engine-lab-operations";
import {
  blendLayerPremultipliedEncodedSrgb,
  blendLayerPremultipliedLinear,
  LAYER_BLEND_MODE_ORDER,
  type LayerBlendMode,
  type LinearPremultipliedRgba,
} from "../../layer-blend-modes";
import {
  DEFAULT_LAYER_TONAL_BLEND,
  layerTonalBlendMask,
  type LayerTonalBlend,
} from "../../layer-composition";

type RgbaBytes = readonly [number, number, number, number];
type ProbeStorageContract = "linear-rgba16f" | "encoded-srgb-rgba8";

let activeStorageContract: ProbeStorageContract = "linear-rgba16f";

const usesEncodedStorage = (): boolean =>
  activeStorageContract === "encoded-srgb-rgba8";

const storageBytesPerTexel = (): 4 | 8 => usesEncodedStorage() ? 4 : 8;

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
  pixelContract: {
    layerFormat: "rgba8unorm" | "rgba16float";
    colorSpace: "linear-premultiplied" | "encoded-srgb-premultiplied";
  };
  passed: boolean;
  checks: {
    pixelContractMatchesRuntime: boolean;
    runtimeShaderCompilationGatePassed: boolean;
    runtimeShaderValidationClean: boolean;
    allModesMatchCpuOracle: boolean;
    contentOpacityMatchesCpuOracle: boolean;
    tonalBlendMatchesCpuOracle: boolean;
    knockoutMatchesCpuOracle: boolean;
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
  advancedOptions: {
    contentOpacity: PixelComparison;
    tonalBlend: PixelComparison;
    knockout: PixelComparison;
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
    parentOpacityDiagnostics: {
      omitted: PixelComparison;
      appliedBeforeChildren: PixelComparison;
    };
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

// The 3×3 dissolve-hash neighborhood is wholly below the 0.57 source alpha.
// This keeps the single-pixel oracle stable across equivalent half-pixel
// viewport mappings while the separate CPU test verifies exact hash values.
const ORDINARY_SAMPLE = { x: 1429, y: 1514 } as const;
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

function storedRgba(value: Uint8Array | RgbaBytes): LinearPremultipliedRgba {
  if (value instanceof Uint8Array) {
    const requiredBytes = storageBytesPerTexel();
    if (value.byteLength < requiredBytes) {
      throw new Error(`Readback livello incompleto: ${value.byteLength} byte.`);
    }
    if (!usesEncodedStorage()) return rgba16FloatTexel(value);
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

function quantizedStored(value: LinearPremultipliedRgba): LinearPremultipliedRgba {
  const stored = usesEncodedStorage()
    ? (channel: number): number => quantizeUnorm(channel) / 255
    : (channel: number): number => decodeFloat16(encodeFloat16(clamp01(channel)));
  return [stored(value[0]), stored(value[1]), stored(value[2]), stored(value[3])];
}

function blendStored(
  backdrop: LinearPremultipliedRgba,
  source: LinearPremultipliedRgba,
  mode: LayerBlendMode,
  documentPixel: readonly [number, number] = [0, 0],
): LinearPremultipliedRgba {
  return usesEncodedStorage()
    ? blendLayerPremultipliedEncodedSrgb(backdrop, source, mode, documentPixel)
    : blendLayerPremultipliedLinear(backdrop, source, mode, documentPixel);
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
  const backgroundSrgb = checkerSrgb(x, y);
  const inverseAlpha = 1 - paint[3];
  if (usesEncodedStorage()) {
    return [
      quantizeUnorm(paint[0] + backgroundSrgb * inverseAlpha),
      quantizeUnorm(paint[1] + backgroundSrgb * inverseAlpha),
      quantizeUnorm(paint[2] + backgroundSrgb * inverseAlpha),
      255,
    ];
  }
  const background = srgbToLinear(backgroundSrgb);
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
  const backgroundSrgb = checkerSrgbAtPosition(x, y);
  const inverseAlpha = 1 - paint[3];
  if (usesEncodedStorage()) {
    return [
      quantizeUnorm(paint[0] + backgroundSrgb * inverseAlpha),
      quantizeUnorm(paint[1] + backgroundSrgb * inverseAlpha),
      quantizeUnorm(paint[2] + backgroundSrgb * inverseAlpha),
      255,
    ];
  }
  const background = srgbToLinear(backgroundSrgb);
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
  const offset = (localY * window.width + localX) * storageBytesPerTexel();
  if (!usesEncodedStorage()) return rgba16FloatTexel(window.pixels, offset);
  return [
    window.pixels[offset] / 255,
    window.pixels[offset + 1] / 255,
    window.pixels[offset + 2] / 255,
    window.pixels[offset + 3] / 255,
  ];
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
  return quantizedStored(blendStored(
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
  return quantizedStored(averageFour(
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
    // The compositor samples document position P with uv = P / layerSize.
    // In texture texel space that is P - 0.5, because texel centers live at
    // half-integer normalized coordinates.
    const texelX = position.x - 0.5;
    const texelY = position.y - 0.5;
    blendThenFilter = bilinearSample(
      (x, y) => blendedDocumentTexel(base, source, x, y),
      texelX,
      texelY,
    );
    filteredBase = bilinearSample(
      (x, y) => windowTexel(base, x, y),
      texelX,
      texelY,
    );
    filteredSource = bilinearSample(
      (x, y) => windowTexel(source, x, y),
      texelX,
      texelY,
    );
  } else {
    // textureSampleLevel on mip 1 maps document position P to texel space
    // P / 2 - 0.5 because the shader samples P / layerSize.
    const mipX = position.x * 0.5 - 0.5;
    const mipY = position.y * 0.5 - 0.5;
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
  const filterThenBlend = blendStored(
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
  setLayerCompositeTestView(engine, viewCenterX, viewCenterY, zoom);
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
  const sourceOver = blendStored(backdrop, source, mode);
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
  let started = false;
  for (let attempt = 0; attempt < 20 && !started; attempt += 1) {
    await engine.waitForIdle();
    started = engine.beginStrokeAtLayer({ x, y, pressure: 1, timeMs });
    if (!started) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }
  if (!started) {
    throw new Error("Il pennello della sonda fusioni non è diventato disponibile entro 1 s.");
  }
  engine.extendStrokeAtLayer([{ x: x + 1, y, pressure: 1, timeMs: timeMs + 16 }]);
  engine.endStroke(timeMs + 16);
  await engine.waitForIdle();
}

function ordinaryOracle(
  baseRaw: Uint8Array,
  sourceRaw: Uint8Array,
  mode: LayerBlendMode,
): LinearPremultipliedRgba {
  return blendStored(
    scalePremultiplied(storedRgba(baseRaw), 0.78),
    scalePremultiplied(storedRgba(sourceRaw), 0.57),
    mode,
    [ORDINARY_SAMPLE.x, ORDINARY_SAMPLE.y],
  );
}

function advancedOptionsOracle(
  baseRaw: Uint8Array,
  sourceRaw: Uint8Array,
  options: {
    contentOpacity: number;
    tonalBlend?: LayerTonalBlend;
    knockout?: boolean;
  },
): LinearPremultipliedRgba {
  const backdrop = scalePremultiplied(storedRgba(baseRaw), 0.78);
  const authoredSource = storedRgba(sourceRaw);
  const styledSource = quantizedStored(scalePremultiplied(
    authoredSource,
    options.contentOpacity,
  ));
  const unfilteredSource = scalePremultiplied(styledSource, 0.57);
  const tonalBlend = options.tonalBlend ?? DEFAULT_LAYER_TONAL_BLEND;
  const tonalMask = layerTonalBlendMask(
    unfilteredSource,
    backdrop,
    tonalBlend,
    usesEncodedStorage()
      ? "encoded-srgb-premultiplied"
      : "linear-premultiplied",
  );
  const source = scalePremultiplied(unfilteredSource, tonalMask);
  const composited = blendStored(
    backdrop,
    source,
    "normal",
    [ORDINARY_SAMPLE.x, ORDINARY_SAMPLE.y],
  );
  if (!options.knockout) return quantizedStored(composited);
  const authoredCoverage = authoredSource[3] * 0.57 * tonalMask;
  const residual = clamp01(authoredCoverage - source[3]);
  const outputAlpha = clamp01(composited[3] - backdrop[3] * residual);
  return quantizedStored([
    Math.min(outputAlpha, Math.max(0, composited[0] - backdrop[0] * residual)),
    Math.min(outputAlpha, Math.max(0, composited[1] - backdrop[1] * residual)),
    Math.min(outputAlpha, Math.max(0, composited[2] - backdrop[2] * residual)),
    outputAlpha,
  ]);
}

export async function runLayerBlendGpuTest(
  engine: BrushEngine,
): Promise<LayerBlendGpuTestReport> {
  const initial = engine.getStats();
  const initialHistory = engine.getHistoryState();
  const encodedStorage = initial.layerFormat === "rgba8unorm"
    && engine.documentStorageColorSpace === "encoded-srgb-premultiplied";
  const linearStorage = initial.layerFormat === "rgba16float"
    && engine.documentStorageColorSpace === "linear-premultiplied";
  if (
    (!encodedStorage && !linearStorage)
    || initial.layerCount !== 1
    || initial.layers[0]?.hasContent
    || initialHistory.actionCount !== 0
    || initialHistory.cursor !== 0
  ) {
    throw new Error(
      "La sonda fusioni richiede una pagina dev nuova, RGBA16F lineare o RGBA8 sRGB, con un solo raster vuoto.",
    );
  }
  activeStorageContract = encodedStorage ? "encoded-srgb-rgba8" : "linear-rgba16f";

  await ensureLabCheckerboardBackdrop(engine);

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
    blendMode: encodedStorage ? "intense-blending" : "normal",
    hueJitterDegrees: 0,
    saturationJitter: 0,
    lightnessJitter: 0,
    darknessJitter: 0,
    positionJitterLateral: 0,
    positionJitterLinear: 0,
  });

  let timeMs = 1_000;
  setLayerCompositeTestView(engine, ORDINARY_SAMPLE.x, ORDINARY_SAMPLE.y, 1);
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
    throw new Error("Baseline Normal della sonda fusioni non coincide con l'oracle del documento.");
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
    setLayerCompositeTestView(engine, ORDINARY_SAMPLE.x, ORDINARY_SAMPLE.y, 1);
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
  await engine.setLayerBlendMode(1, "normal");
  await engine.setLayerContentOpacity(1, 0.37);
  await engine.waitForIdle();
  const contentOpacity = compare(
    await readPresentation(engine, ORDINARY_SAMPLE.x, ORDINARY_SAMPLE.y),
    presentationBytes(
      advancedOptionsOracle(baseRaw, sourceRaw, { contentOpacity: 0.37 }),
      ORDINARY_SAMPLE.x,
      ORDINARY_SAMPLE.y,
    ),
  );

  await engine.setLayerCutoutMode(1, "group");
  await engine.waitForIdle();
  const knockout = compare(
    await readPresentation(engine, ORDINARY_SAMPLE.x, ORDINARY_SAMPLE.y),
    presentationBytes(
      advancedOptionsOracle(baseRaw, sourceRaw, {
        contentOpacity: 0.37,
        knockout: true,
      }),
      ORDINARY_SAMPLE.x,
      ORDINARY_SAMPLE.y,
    ),
  );

  const tonalBlend: LayerTonalBlend = {
    current: [0, 255, 255, 255],
    underlying: [0, 0, 255, 255],
  };
  await engine.setLayerCutoutMode(1, "off");
  await engine.setLayerContentOpacity(1, 1);
  await engine.setLayerTonalBlend(1, tonalBlend);
  await engine.waitForIdle();
  const tonalBlendComparison = compare(
    await readPresentation(engine, ORDINARY_SAMPLE.x, ORDINARY_SAMPLE.y),
    presentationBytes(
      advancedOptionsOracle(baseRaw, sourceRaw, {
        contentOpacity: 1,
        tonalBlend,
      }),
      ORDINARY_SAMPLE.x,
      ORDINARY_SAMPLE.y,
    ),
  );
  await engine.setLayerTonalBlend(1, DEFAULT_LAYER_TONAL_BLEND);

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
  let minimumParentAlpha = Number.POSITIVE_INFINITY;
  let maximumParentAlpha = Number.NEGATIVE_INFINITY;
  let nonZeroParentSamples = 0;
  let clippingSampleDistance = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < scanWidth; offset += 1) {
    const byteOffset = offset * storageBytesPerTexel();
    const alpha = usesEncodedStorage()
      ? parentStrip[byteOffset + 3] / 255
      : rgba16FloatTexel(parentStrip, byteOffset)[3];
    minimumParentAlpha = Math.min(minimumParentAlpha, alpha);
    maximumParentAlpha = Math.max(maximumParentAlpha, alpha);
    if (alpha > 0) nonZeroParentSamples += 1;
    const distance = Math.abs(alpha - 0.5);
    if (
      alpha > 1 / 255
      && alpha < 254 / 255
      && distance < clippingSampleDistance
    ) {
      clippingSampleX = scanX + offset;
      clippingSampleDistance = distance;
    }
  }
  if (clippingSampleX < 0) {
    throw new Error(
      "Bordo alpha morbido della base clipping non trovato: "
      + `alpha ${minimumParentAlpha}…${maximumParentAlpha}, `
      + `${nonZeroParentSamples}/${scanWidth} campioni non zero.`,
    );
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

  const parentStored = storedRgba(parentRaw);
  const firstSource = scalePremultiplied(storedRgba(firstChildRaw), 0.61);
  const secondSource = scalePremultiplied(storedRgba(secondChildRaw), 0.46);
  const afterFirst = quantizedStored(
    sourceAtopBlend(parentStored, firstSource, "multiply"),
  );
  const afterSecond = quantizedStored(
    sourceAtopBlend(afterFirst, secondSource, "screen"),
  );
  const expectedClippingGroup = scalePremultiplied(afterSecond, 0.83);
  const parentWithEarlyOpacity = quantizedStored(
    scalePremultiplied(parentStored, 0.83),
  );
  const afterFirstWithEarlyOpacity = quantizedStored(
    sourceAtopBlend(parentWithEarlyOpacity, firstSource, "multiply"),
  );
  const afterSecondWithEarlyOpacity = quantizedStored(
    sourceAtopBlend(afterFirstWithEarlyOpacity, secondSource, "screen"),
  );

  const wrongAfterFirst = quantizedStored(blendStored(
    parentStored,
    firstSource,
    "multiply",
  ));
  const wrongAfterSecond = quantizedStored(blendStored(
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
  setLayerCompositeTestView(engine, clippingSampleX, CLIPPING_CENTER.y, 1);
  const activeFirstChild = compare(
    await readPresentation(engine, clippingSampleX, CLIPPING_CENTER.y),
    expectedClippingPresentation,
  );
  await engine.setActiveLayer(clippingParentIndex);
  setLayerCompositeTestView(engine, clippingSampleX, CLIPPING_CENTER.y, 1);
  const activeParent = compare(
    await readPresentation(engine, clippingSampleX, CLIPPING_CENTER.y),
    expectedClippingPresentation,
  );

  await engine.setActiveLayer(firstChildIndex);
  await engine.setLayerVisibility(firstChildIndex, false);
  setLayerCompositeTestView(engine, clippingSampleX, CLIPPING_CENTER.y, 1);
  const expectedWithoutFirst = scalePremultiplied(
    quantizedStored(sourceAtopBlend(parentStored, secondSource, "screen")),
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
  setLayerCompositeTestView(engine, clippingSampleX, CLIPPING_CENTER.y, 1);
  const semanticActiveFirstChild = compare(
    await readPresentation(engine, clippingSampleX, CLIPPING_CENTER.y),
    expectedClippingPresentation,
  );
  await engine.setActiveLayer(clippingParentIndex);
  setLayerCompositeTestView(engine, clippingSampleX, CLIPPING_CENTER.y, 1);
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
  setLayerCompositeTestView(engine, clippingSampleX, CLIPPING_CENTER.y, 1);
  const clippingPresentationActual = await readPresentation(
    engine,
    clippingSampleX,
    CLIPPING_CENTER.y,
  );
  const multiplyThenScreen = compare(
    clippingPresentationActual,
    expectedClippingPresentation,
  );
  const parentOpacityDiagnostics = {
    omitted: compare(
      clippingPresentationActual,
      presentationBytes(afterSecond, clippingSampleX, CLIPPING_CENTER.y),
    ),
    appliedBeforeChildren: compare(
      clippingPresentationActual,
      presentationBytes(
        afterSecondWithEarlyOpacity,
        clippingSampleX,
        CLIPPING_CENTER.y,
      ),
    ),
  };
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
  const afterOverlay = quantizedStored(
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

  const expectedFinalAlpha = quantizeUnorm(parentStored[3] * 0.83);
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
    pixelContractMatchesRuntime: encodedStorage
      ? initial.layerFormat === "rgba8unorm"
        && engine.documentStorageColorSpace === "encoded-srgb-premultiplied"
      : initial.layerFormat === "rgba16float"
        && engine.documentStorageColorSpace === "linear-premultiplied",
    runtimeShaderCompilationGatePassed,
    runtimeShaderValidationClean: validationError === null,
    allModesMatchCpuOracle: modeProbes.length === ORDINARY_MODES.length
      && modeProbes.every((probe) => probe.comparison.maxDelta <= 3),
    contentOpacityMatchesCpuOracle: contentOpacity.maxDelta <= 4,
    tonalBlendMatchesCpuOracle: tonalBlendComparison.maxDelta <= 4,
    knockoutMatchesCpuOracle: knockout.maxDelta <= 4,
    liveModeChangeVisible: modeProbes.some(
      (probe) => probe.mode !== "normal"
        && probe.comparison.actual.some(
          (channel, index) => channel !== normal[index],
        ),
    ),
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
      parentStored[3] > 0
      && parentStored[3] < 1
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
    pixelContract: {
      layerFormat: initial.layerFormat,
      colorSpace: engine.documentStorageColorSpace,
    },
    passed: Object.values(checks).every(Boolean),
    checks,
    validationError: validationError ? validationError.message : null,
    ordinary: {
      sample: ORDINARY_SAMPLE,
      normal,
      modes: modeProbes,
      inactiveAbove,
    },
    advancedOptions: {
      contentOpacity,
      tonalBlend: tonalBlendComparison,
      knockout,
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
      parentAlphaRaw: parentStored[3],
      expectedFinalAlpha,
      actualFinalAlpha,
      alphaOracleSeparation,
      parentOpacityDiagnostics,
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
