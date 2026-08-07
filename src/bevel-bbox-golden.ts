import {
  DEFAULT_RASTER_BEVEL_STYLE,
  RASTER_BEVEL_MODES,
  RASTER_BEVEL_TECHNIQUES,
  copyRasterBevelStyle,
  rasterBevelInfluenceBounds,
  type RasterBevelMode,
  type RasterBevelRect,
  type RasterBevelStyle,
  type RasterBevelTechnique,
} from "./bevel-core";
import {
  RasterBevelRenderer,
  type RasterBevelEncodeResult,
} from "./bevel-renderer";
import {
  RasterStrokeRenderer,
  type RasterBevelBoundingFieldTestMutation,
} from "./stroke-renderer";
import {
  DEFAULT_RASTER_STROKE_STYLE,
  copyRasterStrokeStyle,
} from "./stroke-core";
import { EffectsWorkbench } from "./effects-workbench";

export const RASTER_BEVEL_BBOX_GOLDEN_VERSION = 2 as const;
export const RASTER_BEVEL_BBOX_GOLDEN_WIDTH = 512;
export const RASTER_BEVEL_BBOX_GOLDEN_HEIGHT = 512;
export const RASTER_BEVEL_BBOX_GOLDEN_FORMAT = "rgba16float" as const;

const GOLDEN_RGBA16F_BYTES_PER_PIXEL = 8;
const GOLDEN_RGBA16F_ALPHA_BYTE_OFFSET = 6;
const GOLDEN_R16F_BYTES_PER_CHANNEL = 2;

const float32Bits = new Uint32Array(1);
const float32Value = new Float32Array(float32Bits.buffer);

function float32ToFloat16Bits(value: number): number {
  float32Value[0] = value;
  const bits = float32Bits[0];
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  const mantissa = bits & 0x7fffff;
  if (exponent === 0xff) {
    return sign | (mantissa === 0 ? 0x7c00 : 0x7e00);
  }
  const halfExponent = exponent - 127 + 15;
  if (halfExponent >= 0x1f) return sign | 0x7c00;
  if (halfExponent <= 0) {
    if (halfExponent < -10) return sign;
    const normalizedMantissa = mantissa | 0x800000;
    const shift = 14 - halfExponent;
    return sign | ((normalizedMantissa + (1 << (shift - 1)) - 1
      + ((normalizedMantissa >>> shift) & 1)) >>> shift);
  }
  const roundedMantissa = mantissa + 0xfff + ((mantissa >>> 13) & 1);
  if ((roundedMantissa & 0x800000) !== 0) {
    const roundedExponent = halfExponent + 1;
    return roundedExponent >= 0x1f
      ? sign | 0x7c00
      : sign | (roundedExponent << 10);
  }
  return sign | (halfExponent << 10) | (roundedMantissa >>> 13);
}

function packRgba8FixtureAsRgba16FloatBytes(pixels: Uint8Array): Uint8Array {
  if (pixels.byteLength % 4 !== 0) {
    throw new RangeError("Fixture bbox RGBA8 non allineata a quattro canali.");
  }
  const packed = new Uint16Array(pixels.byteLength);
  for (let index = 0; index < pixels.length; index += 1) {
    packed[index] = float32ToFloat16Bits(pixels[index] / 255);
  }
  return new Uint8Array(packed.buffer);
}

const FULL_RECT: RasterBevelRect = {
  x: 0,
  y: 0,
  width: RASTER_BEVEL_BBOX_GOLDEN_WIDTH,
  height: RASTER_BEVEL_BBOX_GOLDEN_HEIGHT,
};
const CONTENT_BOUNDS: RasterBevelRect = {
  x: 326,
  y: 302,
  width: 142,
  height: 132,
};
const MEBIBYTE = 1024 * 1024;
const REPRESENTATIVE_ORIGIN_MUTATION_ID = "emboss-smooth-contour-off";

type ContourCase = "off" | "linear";

interface RendererPair {
  workbench: EffectsWorkbench;
  bevel: RasterBevelRenderer;
  stroke: RasterStrokeRenderer;
  bounded: boolean;
  mutation: RasterBevelBoundingFieldTestMutation;
}

export interface RasterBevelBboxGoldenCase {
  id: string;
  mode: RasterBevelMode;
  technique: RasterBevelTechnique;
  contour: ContourCase;
  fullSha256: string;
  bboxSha256: string;
  zeroMutationSha256: string;
  bboxMatchesFull: boolean;
  zeroMutationMatchesFull: boolean;
  zeroMutationExpectedToMatch: boolean;
  zeroMutationOraclePassed: boolean;
  differingBytes: number;
  maxByteDelta: number;
  firstDifference?: {
    byteIndex: number;
    x: number;
    y: number;
    channel: "r" | "g" | "b" | "a";
    full: number;
    bbox: number;
  };
  bboxFieldBounds: RasterBevelRect | null;
  bboxHeightMemoryMiB: number;
  fullResolvedPixels: number;
  bboxResolvedPixels: number;
  bboxReallocated: boolean;
  bboxFullRebuild: boolean;
}

export interface RasterBevelBboxGoldenReport {
  version: typeof RASTER_BEVEL_BBOX_GOLDEN_VERSION;
  format: typeof RASTER_BEVEL_BBOX_GOLDEN_FORMAT;
  width: number;
  height: number;
  contentBounds: RasterBevelRect;
  sourceNonZeroAlphaPixels: number;
  combinationCount: number;
  matrixComplete: boolean;
  independentRenderers: boolean;
  bboxOriginNonZero: boolean;
  bboxSmallerThanDocument: boolean;
  bboxReallocationStayedInsideNewBounds: boolean;
  styledOutputDistinctFromSource: boolean;
  parityMatches: boolean;
  zeroMutationOracleMatches: boolean;
  originMutationDetected: boolean;
  originMutationDifferingBytes: number;
  fullHeightMemoryMiB: number;
  bboxHeightMemoryMiB: number;
  passed: boolean;
  cases: RasterBevelBboxGoldenCase[];
}

function createFixture(): Uint8Array {
  const pixels = new Uint8Array(
    RASTER_BEVEL_BBOX_GOLDEN_WIDTH * RASTER_BEVEL_BBOX_GOLDEN_HEIGHT * 4,
  );
  const centerX = 397.5;
  const centerY = 365.5;
  for (let y = CONTENT_BOUNDS.y; y < CONTENT_BOUNDS.y + CONTENT_BOUNDS.height; y += 1) {
    for (let x = CONTENT_BOUNDS.x; x < CONTENT_BOUNDS.x + CONTENT_BOUNDS.width; x += 1) {
      const ellipse = Math.hypot((x - centerX) / 68, (y - centerY) / 59);
      const notch = x > 405 && x < 438 && y > 342 && y < 382;
      let alpha = 0;
      if (ellipse < 0.91 && !notch) {
        alpha = 235;
      } else if (ellipse < 0.94 && !notch) {
        alpha = 192;
      } else if (ellipse < 0.97 && !notch) {
        alpha = (x + y) % 2 === 0 ? 128 : 127;
      } else if (ellipse < 1 && !notch) {
        alpha = 58;
      }
      if (alpha === 0) {
        continue;
      }
      const offset = (y * RASTER_BEVEL_BBOX_GOLDEN_WIDTH + x) * 4;
      const red = (x * 29 + y * 11 + 71) & 255;
      const green = (x * 7 + y * 37 + 113) & 255;
      const blue = (x * 19 + y * 5 + 197) & 255;
      pixels[offset] = Math.round(red * alpha / 255);
      pixels[offset + 1] = Math.round(green * alpha / 255);
      pixels[offset + 2] = Math.round(blue * alpha / 255);
      pixels[offset + 3] = alpha;
    }
  }
  return pixels;
}

function uploadFixture(
  device: GPUDevice,
  texture: GPUTexture,
  pixels: Uint8Array,
): void {
  const packed = packRgba8FixtureAsRgba16FloatBytes(pixels);
  device.queue.writeTexture(
    { texture },
    packed,
    {
      bytesPerRow:
        RASTER_BEVEL_BBOX_GOLDEN_WIDTH * GOLDEN_RGBA16F_BYTES_PER_PIXEL,
      rowsPerImage: RASTER_BEVEL_BBOX_GOLDEN_HEIGHT,
    },
    {
      width: RASTER_BEVEL_BBOX_GOLDEN_WIDTH,
      height: RASTER_BEVEL_BBOX_GOLDEN_HEIGHT,
      depthOrArrayLayers: 1,
    },
  );
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const stable = new Uint8Array(bytes.byteLength);
  stable.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stable.buffer);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")).join("");
}

function countNonZeroAlphaPixels(pixels: Uint8Array): number {
  let total = 0;
  for (
    let offset = GOLDEN_RGBA16F_ALPHA_BYTE_OFFSET;
    offset < pixels.length;
    offset += GOLDEN_RGBA16F_BYTES_PER_PIXEL
  ) {
    total += (pixels[offset] | (pixels[offset + 1] & 0x7f)) !== 0 ? 1 : 0;
  }
  return total;
}

function comparePixels(
  full: Uint8Array,
  bbox: Uint8Array,
): Pick<
  RasterBevelBboxGoldenCase,
  "differingBytes" | "maxByteDelta" | "firstDifference"
> {
  let differingBytes = 0;
  let maxByteDelta = 0;
  let firstDifference: RasterBevelBboxGoldenCase["firstDifference"];
  const channels = ["r", "g", "b", "a"] as const;
  for (let byteIndex = 0; byteIndex < full.length; byteIndex += 1) {
    if (full[byteIndex] === bbox[byteIndex]) {
      continue;
    }
    differingBytes += 1;
    maxByteDelta = Math.max(
      maxByteDelta,
      Math.abs(full[byteIndex] - bbox[byteIndex]),
    );
    if (!firstDifference) {
      const pixelIndex = Math.floor(
        byteIndex / GOLDEN_RGBA16F_BYTES_PER_PIXEL,
      );
      firstDifference = {
        byteIndex,
        x: pixelIndex % RASTER_BEVEL_BBOX_GOLDEN_WIDTH,
        y: Math.floor(pixelIndex / RASTER_BEVEL_BBOX_GOLDEN_WIDTH),
        channel: channels[
          Math.floor(byteIndex / GOLDEN_R16F_BYTES_PER_CHANNEL) % 4
        ],
        full: full[byteIndex],
        bbox: bbox[byteIndex],
      };
    }
  }
  return {
    differingBytes,
    maxByteDelta,
    ...(firstDifference ? { firstDifference } : {}),
  };
}

function styleForCase(
  mode: RasterBevelMode,
  technique: RasterBevelTechnique,
  contour: ContourCase,
): RasterBevelStyle {
  const style = copyRasterBevelStyle(DEFAULT_RASTER_BEVEL_STYLE);
  style.enabled = true;
  style.mode = mode;
  style.technique = technique;
  style.size = 12;
  style.soften = 3;
  style.bevelContourEnabled = contour === "linear";
  style.bevelContour = "linear";
  style.bevelRange = 67;
  style.depth = 137;
  style.angle = 133;
  style.altitude = 31;
  style.fill = 83;
  style.contourAA = true;
  return style;
}

async function createRendererPair(
  device: GPUDevice,
  layerView: GPUTextureView,
  lightGlazeUniformBuffer: GPUBuffer,
  thicknessTailUniformBuffer: GPUBuffer,
  bounded: boolean,
  mutation: RasterBevelBoundingFieldTestMutation = "none",
): Promise<RendererPair> {
  const workbench = new EffectsWorkbench({
    device,
    view: layerView,
    format: RASTER_BEVEL_BBOX_GOLDEN_FORMAT,
  });
  try {
    const bevel = await RasterBevelRenderer.create({
      device,
      scratchPool: workbench.scratchPool,
      documentWidth: RASTER_BEVEL_BBOX_GOLDEN_WIDTH,
      documentHeight: RASTER_BEVEL_BBOX_GOLDEN_HEIGHT,
      layerView,
      lightGlazeUniformBuffer,
      thicknessTailUniformBuffer,
      boundingFieldEnabled: bounded,
    });
    workbench.attachBevelRenderer(bevel);
    const stroke = await RasterStrokeRenderer.create({
      device,
      scratchPool: workbench.scratchPool,
      documentWidth: RASTER_BEVEL_BBOX_GOLDEN_WIDTH,
      documentHeight: RASTER_BEVEL_BBOX_GOLDEN_HEIGHT,
      layerFormat: RASTER_BEVEL_BBOX_GOLDEN_FORMAT,
      layerView,
      lightGlazeUniformBuffer,
      thicknessTailUniformBuffer,
      scratchExtent: 512,
      readbackEnabled: true,
      bevelBoundingFieldEnabled: bounded,
      bevelBoundingFieldTestMutation: mutation,
    });
    workbench.attachStrokeRenderer(stroke);
    stroke.setBevelResources(bevel.heightView, bevel.glossView);
    stroke.updateBevelFieldParameters(bevel.fieldState);
    return { workbench, bevel, stroke, bounded, mutation };
  } catch (error) {
    workbench.destroy();
    throw error;
  }
}

async function renderCase(
  device: GPUDevice,
  pair: RendererPair,
  style: RasterBevelStyle,
): Promise<{
  pixels: Uint8Array;
  bevel: RasterBevelEncodeResult;
}> {
  const influenceBounds = rasterBevelInfluenceBounds(
    CONTENT_BOUNDS,
    style,
    RASTER_BEVEL_BBOX_GOLDEN_WIDTH,
    RASTER_BEVEL_BBOX_GOLDEN_HEIGHT,
  );
  if (!influenceBounds) {
    throw new Error("Il caso golden bbox non ha prodotto bounds di influenza.");
  }
  const fieldBounds = pair.bounded ? influenceBounds : FULL_RECT;
  const encoder = device.createCommandEncoder({
    label: `Golden Smusso ${pair.bounded ? "bbox" : "full"} ${style.mode}/${style.technique}`,
  });
  const bevel = pair.bevel.encode({
    encoder,
    style,
    sourceMode: "permanent",
    rebuildRect: fieldBounds,
    changeDetectionRect: null,
    clearHeight: true,
    fieldBounds,
    allowFieldShrink: pair.bounded,
  });
  if (bevel.fieldReallocated) {
    pair.stroke.setBevelResources(pair.bevel.heightView, pair.bevel.glossView);
  }
  pair.stroke.updateBevelFieldParameters(bevel.fieldState);
  pair.stroke.updateBevelParameters(style);
  pair.stroke.encode({
    encoder,
    sourceMode: "permanent",
    style: copyRasterStrokeStyle(DEFAULT_RASTER_STROKE_STYLE),
    bevelStyle: style,
    rebuildRect: FULL_RECT,
    changeDetectionRect: null,
    composeRect: FULL_RECT,
    conditionalComposeRect: null,
    clearStyled: true,
    resetThresholdMask: true,
  });
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  return {
    pixels: await pair.stroke.readStyledPixels(undefined, 0),
    bevel,
  };
}

export async function runRasterBevelBboxGolden(
  device: GPUDevice,
): Promise<RasterBevelBboxGoldenReport> {
  const sourceTexture = device.createTexture({
    label: "Golden Smusso bbox deterministic corner source",
    size: {
      width: RASTER_BEVEL_BBOX_GOLDEN_WIDTH,
      height: RASTER_BEVEL_BBOX_GOLDEN_HEIGHT,
      depthOrArrayLayers: 1,
    },
    format: RASTER_BEVEL_BBOX_GOLDEN_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const fixture = createFixture();
  const packedFixture = packRgba8FixtureAsRgba16FloatBytes(fixture);
  uploadFixture(device, sourceTexture, fixture);
  const lightGlazeUniformBuffer = device.createBuffer({
    label: "Golden Smusso bbox Light Glaze uniforms",
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const thicknessTailUniformBuffer = device.createBuffer({
    label: "Golden Smusso bbox thickness tail uniforms",
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const lightGlazeUniforms = new Uint32Array(8);
  lightGlazeUniforms[1] = 1;
  device.queue.writeBuffer(lightGlazeUniformBuffer, 0, lightGlazeUniforms);
  device.queue.writeBuffer(thicknessTailUniformBuffer, 0, new Uint8Array(32));

  let fullPair: RendererPair | null = null;
  let bboxPair: RendererPair | null = null;
  let zeroMutationPair: RendererPair | null = null;
  let originMutationPair: RendererPair | null = null;
  try {
    const sourceView = sourceTexture.createView();
    fullPair = await createRendererPair(
      device,
      sourceView,
      lightGlazeUniformBuffer,
      thicknessTailUniformBuffer,
      false,
    );
    bboxPair = await createRendererPair(
      device,
      sourceView,
      lightGlazeUniformBuffer,
      thicknessTailUniformBuffer,
      true,
    );
    zeroMutationPair = await createRendererPair(
      device,
      sourceView,
      lightGlazeUniformBuffer,
      thicknessTailUniformBuffer,
      true,
      "zero-outside",
    );

    const cases: RasterBevelBboxGoldenCase[] = [];
    let representativeCorrectPixels: Uint8Array | null = null;
    let representativeStyle: RasterBevelStyle | null = null;
    let representativeOutputSha256 = "";
    let bboxOriginNonZero = false;
    let bboxSmallerThanDocument = false;
    let bboxReallocationStayedInsideNewBounds = true;

    for (const mode of RASTER_BEVEL_MODES) {
      for (const technique of RASTER_BEVEL_TECHNIQUES) {
        for (const contour of ["off", "linear"] as const) {
          const style = styleForCase(mode, technique, contour);
          const id = `${mode}-${technique}-contour-${contour}`;
          const full = await renderCase(device, fullPair, style);
          const bbox = await renderCase(device, bboxPair, style);
          const zeroMutation = await renderCase(device, zeroMutationPair, style);
          const fullSha256 = await sha256(full.pixels);
          const bboxSha256 = await sha256(bbox.pixels);
          const zeroMutationSha256 = await sha256(zeroMutation.pixels);
          const comparison = comparePixels(full.pixels, bbox.pixels);
          const zeroComparison = comparePixels(full.pixels, zeroMutation.pixels);
          const zeroMutationMatchesFull = zeroComparison.differingBytes === 0;
          const zeroMutationExpectedToMatch = mode !== "pillow";
          const fieldBounds = bbox.bevel.fieldState.validBounds;
          bboxOriginNonZero ||= Boolean(
            fieldBounds && (fieldBounds.x > 0 || fieldBounds.y > 0),
          );
          bboxSmallerThanDocument ||= Boolean(
            fieldBounds
            && fieldBounds.width * fieldBounds.height
              < RASTER_BEVEL_BBOX_GOLDEN_WIDTH * RASTER_BEVEL_BBOX_GOLDEN_HEIGHT,
          );
          bboxReallocationStayedInsideNewBounds &&= Boolean(
            fieldBounds
            && bbox.bevel.resolvedPixels
              === fieldBounds.width * fieldBounds.height,
          );
          cases.push({
            id,
            mode,
            technique,
            contour,
            fullSha256,
            bboxSha256,
            zeroMutationSha256,
            bboxMatchesFull: comparison.differingBytes === 0,
            zeroMutationMatchesFull,
            zeroMutationExpectedToMatch,
            zeroMutationOraclePassed:
              zeroMutationMatchesFull === zeroMutationExpectedToMatch,
            ...comparison,
            bboxFieldBounds: fieldBounds ? { ...fieldBounds } : null,
            bboxHeightMemoryMiB: bbox.bevel.fieldState.memoryBytes / MEBIBYTE,
            fullResolvedPixels: full.bevel.resolvedPixels,
            bboxResolvedPixels: bbox.bevel.resolvedPixels,
            bboxReallocated: bbox.bevel.fieldReallocated,
            bboxFullRebuild: bbox.bevel.fieldFullRebuild,
          });
          if (id === REPRESENTATIVE_ORIGIN_MUTATION_ID) {
            representativeCorrectPixels = new Uint8Array(bbox.pixels);
            representativeStyle = copyRasterBevelStyle(style);
            representativeOutputSha256 = bboxSha256;
          }
        }
      }
    }

    if (!representativeCorrectPixels || !representativeStyle) {
      throw new Error("Caso rappresentativo della mutazione origine non eseguito.");
    }
    originMutationPair = await createRendererPair(
      device,
      sourceView,
      lightGlazeUniformBuffer,
      thicknessTailUniformBuffer,
      true,
      "omit-origin",
    );
    const originMutation = await renderCase(
      device,
      originMutationPair,
      representativeStyle,
    );
    const originComparison = comparePixels(
      representativeCorrectPixels,
      originMutation.pixels,
    );

    const matrixComplete = cases.length
      === RASTER_BEVEL_MODES.length * RASTER_BEVEL_TECHNIQUES.length * 2;
    const parityMatches = cases.every((entry) => entry.bboxMatchesFull);
    const zeroMutationOracleMatches = cases.every(
      (entry) => entry.zeroMutationOraclePassed,
    );
    const originMutationDetected = originComparison.differingBytes > 0;
    const styledOutputDistinctFromSource =
      representativeOutputSha256 !== await sha256(packedFixture);
    const fullHeightMemoryMiB = fullPair.bevel.heightMemoryBytes / MEBIBYTE;
    const bboxHeightMemoryMiB = bboxPair.bevel.heightMemoryBytes / MEBIBYTE;
    const sourceNonZeroAlphaPixels = countNonZeroAlphaPixels(packedFixture);
    const independentRenderers =
      fullPair.workbench !== bboxPair.workbench
      && fullPair.stroke !== bboxPair.stroke
      && fullPair.bevel !== bboxPair.bevel;
    const passed =
      matrixComplete
      && parityMatches
      && zeroMutationOracleMatches
      && originMutationDetected
      && bboxOriginNonZero
      && bboxSmallerThanDocument
      && bboxReallocationStayedInsideNewBounds
      && styledOutputDistinctFromSource
      && sourceNonZeroAlphaPixels > 0
      && independentRenderers;
    return {
      version: RASTER_BEVEL_BBOX_GOLDEN_VERSION,
      format: RASTER_BEVEL_BBOX_GOLDEN_FORMAT,
      width: RASTER_BEVEL_BBOX_GOLDEN_WIDTH,
      height: RASTER_BEVEL_BBOX_GOLDEN_HEIGHT,
      contentBounds: { ...CONTENT_BOUNDS },
      sourceNonZeroAlphaPixels,
      combinationCount: cases.length,
      matrixComplete,
      independentRenderers,
      bboxOriginNonZero,
      bboxSmallerThanDocument,
      bboxReallocationStayedInsideNewBounds,
      styledOutputDistinctFromSource,
      parityMatches,
      zeroMutationOracleMatches,
      originMutationDetected,
      originMutationDifferingBytes: originComparison.differingBytes,
      fullHeightMemoryMiB,
      bboxHeightMemoryMiB,
      passed,
      cases,
    };
  } finally {
    originMutationPair?.workbench.destroy();
    zeroMutationPair?.workbench.destroy();
    bboxPair?.workbench.destroy();
    fullPair?.workbench.destroy();
    sourceTexture.destroy();
    lightGlazeUniformBuffer.destroy();
    thicknessTailUniformBuffer.destroy();
  }
}
