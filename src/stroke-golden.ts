import {
  RASTER_STROKE_RENDERER_BUILD,
  RasterStrokeRenderer,
  type RasterStrokeEncodeOptions,
} from "./stroke-renderer";
import type { RasterStrokeRect, RasterStrokeStyle } from "./stroke-core";
import rasterStrokeGoldenBaseline from "../goldens/raster-stroke-rgba8-v1.json";

export const RASTER_STROKE_GOLDEN_VERSION = 1 as const;
export const RASTER_STROKE_GOLDEN_WIDTH = 256;
export const RASTER_STROKE_GOLDEN_HEIGHT = 192;
export const RASTER_STROKE_GOLDEN_FORMAT = "rgba8unorm" as const;

export interface RasterStrokeGoldenCase {
  id: string;
  sha256: string;
  byteLength: number;
  nonZeroAlphaPixels: number;
}

export interface RasterStrokeGoldenReport {
  version: typeof RASTER_STROKE_GOLDEN_VERSION;
  rendererBuild: string;
  format: typeof RASTER_STROKE_GOLDEN_FORMAT;
  width: number;
  height: number;
  fixtureSha256: string;
  combinedSha256: string;
  baselineMatches: boolean;
  baselineMismatches: string[];
  cases: RasterStrokeGoldenCase[];
}

const FULL_RECT: RasterStrokeRect = {
  x: 0,
  y: 0,
  width: RASTER_STROKE_GOLDEN_WIDTH,
  height: RASTER_STROKE_GOLDEN_HEIGHT,
};
const INTERIOR_MUTATION_RECT: RasterStrokeRect = {
  x: 50,
  y: 60,
  width: 18,
  height: 14,
};
const THRESHOLD_MUTATION_RECT: RasterStrokeRect = {
  x: 181,
  y: 72,
  width: 12,
  height: 16,
};

const OUTSIDE_STYLE: RasterStrokeStyle = {
  enabled: true,
  width: 14,
  position: "outside",
  color: [1, 0.18, 0.035, 0.78],
};
const INSIDE_STYLE: RasterStrokeStyle = {
  enabled: true,
  width: 9,
  position: "inside",
  color: [0.04, 0.82, 0.28, 0.64],
};
const CENTER_STYLE: RasterStrokeStyle = {
  enabled: true,
  width: 31,
  position: "center",
  color: [0.13, 0.36, 1, 0.72],
};
const WIDE_STYLE: RasterStrokeStyle = {
  enabled: true,
  width: 129,
  position: "outside",
  color: [0.72, 0.08, 0.92, 0.51],
};

function pixelOffset(x: number, y: number): number {
  return (y * RASTER_STROKE_GOLDEN_WIDTH + x) * 4;
}

function setPremultipliedPixel(
  pixels: Uint8Array,
  x: number,
  y: number,
  alpha: number,
  phase = 0,
): void {
  const normalizedAlpha = Math.max(0, Math.min(255, Math.round(alpha)));
  const offset = pixelOffset(x, y);
  const red = (x * 37 + y * 17 + 53 + phase * 29) & 255;
  const green = (x * 11 + y * 43 + 101 + phase * 47) & 255;
  const blue = (x * 23 + y * 7 + 191 + phase * 61) & 255;
  pixels[offset] = Math.round(red * normalizedAlpha / 255);
  pixels[offset + 1] = Math.round(green * normalizedAlpha / 255);
  pixels[offset + 2] = Math.round(blue * normalizedAlpha / 255);
  pixels[offset + 3] = normalizedAlpha;
}

export function createRasterStrokeGoldenFixture(): Uint8Array {
  const pixels = new Uint8Array(
    RASTER_STROKE_GOLDEN_WIDTH * RASTER_STROKE_GOLDEN_HEIGHT * 4,
  );
  for (let y = 0; y < RASTER_STROKE_GOLDEN_HEIGHT; y += 1) {
    for (let x = 0; x < RASTER_STROKE_GOLDEN_WIDTH; x += 1) {
      const circleDistance = Math.hypot(x - 74.5, y - 79.5);
      let alpha = 0;
      if (circleDistance < 40) {
        alpha = 230;
      } else if (circleDistance < 41) {
        alpha = 192;
      } else if (circleDistance < 42) {
        alpha = (x + y) % 2 === 0 ? 128 : 127;
      } else if (circleDistance < 43) {
        alpha = 64;
      }

      if (x >= 146 && x < 226 && y >= 38 && y < 128) {
        alpha = 255;
        if (x >= 176 && x < 201 && y >= 66 && y < 99) {
          alpha = 0;
        } else if (
          x === 146
          || x === 225
          || y === 38
          || y === 127
        ) {
          alpha = (x + y) % 2 === 0 ? 128 : 127;
        }
      }

      const diagonalDistance = Math.abs(y - (0.42 * x + 84));
      if (x >= 18 && x < 190 && diagonalDistance < 2.4) {
        alpha = Math.max(alpha, diagonalDistance < 1.1 ? 210 : 128);
      }

      if (
        (x === 118 && y === 28)
        || (x === 120 && y === 28)
        || (x === 119 && y === 30)
      ) {
        alpha = 128;
      }

      setPremultipliedPixel(pixels, x, y, alpha);
    }
  }
  return pixels;
}

function mutateOpaqueInterior(pixels: Uint8Array): void {
  const right = INTERIOR_MUTATION_RECT.x + INTERIOR_MUTATION_RECT.width;
  const bottom = INTERIOR_MUTATION_RECT.y + INTERIOR_MUTATION_RECT.height;
  for (let y = INTERIOR_MUTATION_RECT.y; y < bottom; y += 1) {
    for (let x = INTERIOR_MUTATION_RECT.x; x < right; x += 1) {
      setPremultipliedPixel(pixels, x, y, 202 + ((x + y) % 29), 3);
    }
  }
}

function mutateThresholdIsland(pixels: Uint8Array): void {
  const right = THRESHOLD_MUTATION_RECT.x + THRESHOLD_MUTATION_RECT.width;
  const bottom = THRESHOLD_MUTATION_RECT.y + THRESHOLD_MUTATION_RECT.height;
  for (let y = THRESHOLD_MUTATION_RECT.y; y < bottom; y += 1) {
    for (let x = THRESHOLD_MUTATION_RECT.x; x < right; x += 1) {
      const edge = x === THRESHOLD_MUTATION_RECT.x
        || x === right - 1
        || y === THRESHOLD_MUTATION_RECT.y
        || y === bottom - 1;
      setPremultipliedPixel(pixels, x, y, edge ? 128 : 244, 5);
    }
  }
}

function expandedEffectRect(
  rect: RasterStrokeRect,
  width: number,
): RasterStrokeRect {
  const margin = Math.ceil(Math.max(0, width) + 1.5);
  const x = Math.max(0, Math.floor(rect.x) - margin);
  const y = Math.max(0, Math.floor(rect.y) - margin);
  const right = Math.min(
    RASTER_STROKE_GOLDEN_WIDTH,
    Math.ceil(rect.x + rect.width) + margin,
  );
  const bottom = Math.min(
    RASTER_STROKE_GOLDEN_HEIGHT,
    Math.ceil(rect.y + rect.height) + margin,
  );
  return { x, y, width: right - x, height: bottom - y };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const stableBytes = new Uint8Array(bytes.byteLength);
  stableBytes.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBytes.buffer);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")).join("");
}

function countNonZeroAlphaPixels(pixels: Uint8Array): number {
  let count = 0;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] !== 0) {
      count += 1;
    }
  }
  return count;
}

function uploadFixture(device: GPUDevice, texture: GPUTexture, pixels: Uint8Array): void {
  device.queue.writeTexture(
    { texture },
    pixels,
    {
      bytesPerRow: RASTER_STROKE_GOLDEN_WIDTH * 4,
      rowsPerImage: RASTER_STROKE_GOLDEN_HEIGHT,
    },
    {
      width: RASTER_STROKE_GOLDEN_WIDTH,
      height: RASTER_STROKE_GOLDEN_HEIGHT,
      depthOrArrayLayers: 1,
    },
  );
}

export async function runRasterStrokeGolden(
  device: GPUDevice,
): Promise<RasterStrokeGoldenReport> {
  const sourceTexture = device.createTexture({
    label: "Traccia golden deterministic source",
    size: {
      width: RASTER_STROKE_GOLDEN_WIDTH,
      height: RASTER_STROKE_GOLDEN_HEIGHT,
      depthOrArrayLayers: 1,
    },
    format: RASTER_STROKE_GOLDEN_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const lightGlazeUniformBuffer = device.createBuffer({
    label: "Traccia golden Light Glaze uniforms",
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const thicknessTailUniformBuffer = device.createBuffer({
    label: "Traccia golden thickness tail uniforms",
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(lightGlazeUniformBuffer, 0, new Uint8Array(32));
  device.queue.writeBuffer(thicknessTailUniformBuffer, 0, new Uint8Array(32));

  let renderer: RasterStrokeRenderer | null = null;
  try {
    renderer = await RasterStrokeRenderer.create({
      device,
      documentWidth: RASTER_STROKE_GOLDEN_WIDTH,
      documentHeight: RASTER_STROKE_GOLDEN_HEIGHT,
      layerFormat: RASTER_STROKE_GOLDEN_FORMAT,
      layerView: sourceTexture.createView(),
      lightGlazeUniformBuffer,
      thicknessTailUniformBuffer,
      scratchExtent: 512,
      readbackEnabled: true,
    });

    const fixture = createRasterStrokeGoldenFixture();
    const fixtureSha256 = await sha256(fixture);
    uploadFixture(device, sourceTexture, fixture);
    const cases: RasterStrokeGoldenCase[] = [];

    const capture = async (
      id: string,
      options: Omit<RasterStrokeEncodeOptions, "encoder" | "sourceMode">,
    ): Promise<void> => {
      const encoder = device.createCommandEncoder({
        label: "Traccia golden " + id,
      });
      renderer!.encode({
        ...options,
        encoder,
        sourceMode: "permanent",
      });
      device.queue.submit([encoder.finish()]);
      const pixels = await renderer!.readStyledPixels();
      cases.push({
        id,
        sha256: await sha256(pixels),
        byteLength: pixels.byteLength,
        nonZeroAlphaPixels: countNonZeroAlphaPixels(pixels),
      });
    };

    await capture("outside-14-full-build", {
      style: OUTSIDE_STYLE,
      rebuildRect: FULL_RECT,
      composeRect: FULL_RECT,
      clearStyled: true,
      resetThresholdMask: true,
    });
    await capture("inside-9-style-only", {
      style: INSIDE_STYLE,
      rebuildRect: FULL_RECT,
      composeRect: FULL_RECT,
    });
    await capture("center-31-style-only", {
      style: CENTER_STYLE,
      rebuildRect: FULL_RECT,
      composeRect: FULL_RECT,
    });
    await capture("outside-129-style-only", {
      style: WIDE_STYLE,
      rebuildRect: FULL_RECT,
      composeRect: FULL_RECT,
    });
    await capture("center-31-restored", {
      style: CENTER_STYLE,
      rebuildRect: FULL_RECT,
      composeRect: FULL_RECT,
    });

    mutateOpaqueInterior(fixture);
    uploadFixture(device, sourceTexture, fixture);
    await capture("opaque-interior-paint-no-new-edge", {
      style: CENTER_STYLE,
      rebuildRect: expandedEffectRect(INTERIOR_MUTATION_RECT, CENTER_STYLE.width),
      changeDetectionRect: INTERIOR_MUTATION_RECT,
      composeRect: INTERIOR_MUTATION_RECT,
      conditionalComposeRect: expandedEffectRect(
        INTERIOR_MUTATION_RECT,
        CENTER_STYLE.width,
      ),
    });

    mutateThresholdIsland(fixture);
    uploadFixture(device, sourceTexture, fixture);
    await capture("threshold-island-new-edge", {
      style: CENTER_STYLE,
      rebuildRect: expandedEffectRect(THRESHOLD_MUTATION_RECT, CENTER_STYLE.width),
      changeDetectionRect: THRESHOLD_MUTATION_RECT,
      composeRect: THRESHOLD_MUTATION_RECT,
      conditionalComposeRect: expandedEffectRect(
        THRESHOLD_MUTATION_RECT,
        CENTER_STYLE.width,
      ),
    });

    const combinedIdentity = new TextEncoder().encode(JSON.stringify({
      version: RASTER_STROKE_GOLDEN_VERSION,
      format: RASTER_STROKE_GOLDEN_FORMAT,
      width: RASTER_STROKE_GOLDEN_WIDTH,
      height: RASTER_STROKE_GOLDEN_HEIGHT,
      fixtureSha256,
      cases: cases.map(({ id, sha256: caseSha256 }) => ({
        id,
        sha256: caseSha256,
      })),
    }));
    const combinedSha256 = await sha256(combinedIdentity);
    const baselineCases = new Map(
      rasterStrokeGoldenBaseline.cases.map((goldenCase) => [
        goldenCase.id,
        goldenCase.sha256,
      ]),
    );
    const baselineMismatches = cases
      .filter((goldenCase) => baselineCases.get(goldenCase.id) !== goldenCase.sha256)
      .map((goldenCase) => goldenCase.id);
    if (fixtureSha256 !== rasterStrokeGoldenBaseline.fixtureSha256) {
      baselineMismatches.unshift("fixture");
    }
    if (combinedSha256 !== rasterStrokeGoldenBaseline.combinedSha256) {
      baselineMismatches.unshift("combined");
    }
    return {
      version: RASTER_STROKE_GOLDEN_VERSION,
      rendererBuild: RASTER_STROKE_RENDERER_BUILD,
      format: RASTER_STROKE_GOLDEN_FORMAT,
      width: RASTER_STROKE_GOLDEN_WIDTH,
      height: RASTER_STROKE_GOLDEN_HEIGHT,
      fixtureSha256,
      combinedSha256,
      baselineMatches: baselineMismatches.length === 0,
      baselineMismatches,
      cases,
    };
  } finally {
    renderer?.destroy();
    sourceTexture.destroy();
    lightGlazeUniformBuffer.destroy();
    thicknessTailUniformBuffer.destroy();
  }
}
