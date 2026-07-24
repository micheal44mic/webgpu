import {
  RASTER_STROKE_RENDERER_BUILD,
  RasterStrokeRenderer,
  type RasterStrokeEncodeOptions,
  type RasterStrokeSourceMode,
} from "./stroke-renderer";
import { RasterBevelRenderer } from "./bevel-renderer";
import {
  DEFAULT_RASTER_BEVEL_STYLE,
  copyRasterBevelStyle,
} from "./bevel-core";
import { EffectsWorkbench } from "./effects-workbench";
import type { RasterStrokeRect, RasterStrokeStyle } from "./stroke-core";
import { paintMipDownsampleShader } from "./shaders";
import rasterStrokeGoldenBaseline from "../goldens/raster-stroke-rgba8-v1.json";
import rasterStrokeMipGoldenBaseline from "../goldens/raster-stroke-rgba8-mips-v1.json";

export const RASTER_STROKE_GOLDEN_VERSION = 1 as const;
export const RASTER_STROKE_GOLDEN_WIDTH = 256;
export const RASTER_STROKE_GOLDEN_HEIGHT = 192;
export const RASTER_STROKE_GOLDEN_FORMAT = "rgba8unorm" as const;
export const RASTER_STROKE_GOLDEN_MIP_CHAIN_VERSION = 1 as const;
export const RASTER_STROKE_GOLDEN_DIAGNOSTICS_VERSION = 5 as const;

export interface RasterStrokeGoldenMip {
  level: number;
  width: number;
  height: number;
  sha256: string;
  byteLength: number;
  nonZeroAlphaPixels: number;
}

export interface RasterStrokeGoldenCase {
  id: string;
  sha256: string;
  byteLength: number;
  nonZeroAlphaPixels: number;
  mips: RasterStrokeGoldenMip[];
}

export interface RasterStrokeGoldenDiagnostic {
  id: string;
  kind: "mutation-gate" | "source-mode-mip" | "retarget-identity";
  passed: boolean;
  expectedGateFlags?: number;
  gateFlags?: number;
  gatedMip1Sha256?: string;
  forcedMip1Sha256?: string;
  runtimeMip0Sha256?: string;
  referenceMip0Sha256?: string;
  runtimeMip1Sha256?: string;
  referenceMip1Sha256?: string;
  differingBytes?: number;
  beforeMip0Sha256?: string;
  afterMip0Sha256?: string;
  beforeMip1Sha256?: string;
  afterMip1Sha256?: string;
  sourceContentDistinct?: boolean;
  maxByteDelta?: number;
  firstDifference?: {
    byteIndex: number;
    x: number;
    y: number;
    channel: "r" | "g" | "b" | "a";
    runtime: number;
    reference: number;
  };
}

export interface RasterStrokeGoldenReport {
  version: typeof RASTER_STROKE_GOLDEN_VERSION;
  rendererBuild: string;
  format: typeof RASTER_STROKE_GOLDEN_FORMAT;
  width: number;
  height: number;
  fixtureSha256: string;
  combinedSha256: string;
  mipChainVersion: typeof RASTER_STROKE_GOLDEN_MIP_CHAIN_VERSION;
  mipCombinedSha256: string;
  baselineMatches: boolean;
  diagnosticsVersion: typeof RASTER_STROKE_GOLDEN_DIAGNOSTICS_VERSION;
  diagnosticsMatch: boolean;
  diagnostics: RasterStrokeGoldenDiagnostic[];
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

const DEEP_INTERIOR_MUTATION_RECT: RasterStrokeRect = {
  x: 70,
  y: 76,
  width: 8,
  height: 7,
};
const OUTER_COVERAGE_ALPHA_MUTATION_RECT: RasterStrokeRect = {
  x: 142,
  y: 64,
  width: 1,
  height: 64,
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


function mutateDeepInterior(pixels: Uint8Array): void {
  const right = DEEP_INTERIOR_MUTATION_RECT.x + DEEP_INTERIOR_MUTATION_RECT.width;
  const bottom = DEEP_INTERIOR_MUTATION_RECT.y + DEEP_INTERIOR_MUTATION_RECT.height;
  for (let y = DEEP_INTERIOR_MUTATION_RECT.y; y < bottom; y += 1) {
    for (let x = DEEP_INTERIOR_MUTATION_RECT.x; x < right; x += 1) {
      setPremultipliedPixel(pixels, x, y, 190 + ((x * 3 + y) % 38), 7);
    }
  }
}

function createOuterCoverageAlphaFixture(): Uint8Array {
  const pixels = new Uint8Array(
    RASTER_STROKE_GOLDEN_WIDTH * RASTER_STROKE_GOLDEN_HEIGHT * 4,
  );
  for (let y = 24; y < 168; y += 1) {
    for (let x = 32; x < 128; x += 1) {
      setPremultipliedPixel(pixels, x, y, 255, 9);
    }
    setPremultipliedPixel(pixels, 128, y, 127, 9);
  }
  for (
    let y = OUTER_COVERAGE_ALPHA_MUTATION_RECT.y;
    y < OUTER_COVERAGE_ALPHA_MUTATION_RECT.y
      + OUTER_COVERAGE_ALPHA_MUTATION_RECT.height;
    y += 1
  ) {
    setPremultipliedPixel(pixels, OUTER_COVERAGE_ALPHA_MUTATION_RECT.x, y, 100, 11);
  }
  return pixels;
}

function mutateOuterCoverageAlpha(pixels: Uint8Array): void {
  const bottom = OUTER_COVERAGE_ALPHA_MUTATION_RECT.y
    + OUTER_COVERAGE_ALPHA_MUTATION_RECT.height;
  for (let y = OUTER_COVERAGE_ALPHA_MUTATION_RECT.y; y < bottom; y += 1) {
    setPremultipliedPixel(pixels, OUTER_COVERAGE_ALPHA_MUTATION_RECT.x, y, 40, 13);
  }
}

// Geometria deliberatamente diversa dalla fixture principale: anello a destra e
// blocco in alto a sinistra. Serve al caso cross-texture, dove sorgente vecchia
// e nuova devono produrre stili distinguibili.
function createRetargetSourceFixture(): Uint8Array {
  const pixels = new Uint8Array(
    RASTER_STROKE_GOLDEN_WIDTH * RASTER_STROKE_GOLDEN_HEIGHT * 4,
  );
  for (let y = 0; y < RASTER_STROKE_GOLDEN_HEIGHT; y += 1) {
    for (let x = 0; x < RASTER_STROKE_GOLDEN_WIDTH; x += 1) {
      let alpha = 0;
      const ringDistance = Math.hypot(x - 188.5, y - 116.5);
      if (ringDistance > 26 && ringDistance < 52) {
        alpha = ringDistance < 28 || ringDistance > 50 ? 128 : 246;
      }
      if (x >= 24 && x < 96 && y >= 20 && y < 64) {
        alpha = Math.max(alpha, (x + y) % 3 === 0 ? 200 : 255);
      }
      setPremultipliedPixel(pixels, x, y, alpha, 17);
    }
  }
  return pixels;
}

function createLightGlazeTransientFixture(
  accumulationMode: "source-over" | "m1-max-coverage",
): Uint8Array {
  const pixels = new Uint8Array(
    RASTER_STROKE_GOLDEN_WIDTH * RASTER_STROKE_GOLDEN_HEIGHT * 4,
  );
  for (let y = 18; y < 174; y += 1) {
    for (let x = 16; x < 240; x += 1) {
      if (((x * 5 + y * 3) % 19) > 13) {
        continue;
      }
      const coverage = 32 + ((x * 17 + y * 29) % 211);
      if (accumulationMode === "m1-max-coverage") {
        const offset = pixelOffset(x, y);
        pixels[offset] = coverage;
        pixels[offset + 3] = 255;
      } else {
        setPremultipliedPixel(pixels, x, y, coverage, 17);
      }
    }
  }
  return pixels;
}

function createM1CoverageFixture(): Uint8Array {
  const rgba = createLightGlazeTransientFixture("m1-max-coverage");
  const coverage = new Uint8Array(
    RASTER_STROKE_GOLDEN_WIDTH * RASTER_STROKE_GOLDEN_HEIGHT,
  );
  for (let pixel = 0; pixel < coverage.length; pixel += 1) {
    coverage[pixel] = rgba[pixel * 4];
  }
  return coverage;
}

function createThicknessTailTransientFixture(): Uint8Array {
  const pixels = new Uint8Array(
    RASTER_STROKE_GOLDEN_WIDTH * RASTER_STROKE_GOLDEN_HEIGHT * 4,
  );
  for (let y = 0; y < 80; y += 1) {
    for (let x = 0; x < 96; x += 1) {
      const ellipse = ((x - 48) / 46) ** 2 + ((y - 40) / 35) ** 2;
      if (ellipse >= 1) {
        continue;
      }
      const alpha = Math.round((1 - ellipse) * 224);
      setPremultipliedPixel(pixels, x, y, alpha, 23);
    }
  }
  return pixels;
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

function uploadR8Fixture(
  device: GPUDevice,
  texture: GPUTexture,
  pixels: Uint8Array,
): void {
  device.queue.writeTexture(
    { texture },
    pixels,
    {
      bytesPerRow: RASTER_STROKE_GOLDEN_WIDTH,
      rowsPerImage: RASTER_STROKE_GOLDEN_HEIGHT,
    },
    {
      width: RASTER_STROKE_GOLDEN_WIDTH,
      height: RASTER_STROKE_GOLDEN_HEIGHT,
      depthOrArrayLayers: 1,
    },
  );
}

async function readRgba8Texture(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const unpaddedBytesPerRow = width * 4;
  const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
  const buffer = device.createBuffer({
    label: "Traccia golden reference texture readback",
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = device.createCommandEncoder({
      label: "Traccia golden reference texture readback encoder",
    });
    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    const compact = new Uint8Array(unpaddedBytesPerRow * height);
    for (let row = 0; row < height; row += 1) {
      compact.set(
        mapped.subarray(row * bytesPerRow, row * bytesPerRow + unpaddedBytesPerRow),
        row * unpaddedBytesPerRow,
      );
    }
    buffer.unmap();
    return compact;
  } finally {
    buffer.destroy();
  }
}

function writeGoldenLightGlazeUniforms(
  device: GPUDevice,
  buffer: GPUBuffer,
  opacity: number,
  accumulationMode: "source-over" | "m1-max-coverage",
): void {
  const upload = new ArrayBuffer(32);
  const floats = new Float32Array(upload);
  const unsigned = new Uint32Array(upload);
  floats[0] = opacity;
  unsigned[1] = 0;
  unsigned[2] = accumulationMode === "m1-max-coverage" ? 1 : 0;
  floats[4] = 0.12;
  floats[5] = 0.62;
  floats[6] = 0.88;
  floats[7] = 1;
  device.queue.writeBuffer(buffer, 0, upload);
}

function writeGoldenThicknessTailUniforms(
  device: GPUDevice,
  buffer: GPUBuffer,
): void {
  const upload = new ArrayBuffer(32);
  const floats = new Float32Array(upload);
  const unsigned = new Uint32Array(upload);
  floats[0] = 44;
  floats[1] = 52;
  floats[2] = 96;
  floats[3] = 80;
  unsigned[4] = 0;
  device.queue.writeBuffer(buffer, 0, upload);
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
  const transientTexture = device.createTexture({
    label: "Traccia golden transient source",
    size: {
      width: RASTER_STROKE_GOLDEN_WIDTH,
      height: RASTER_STROKE_GOLDEN_HEIGHT,
      depthOrArrayLayers: 1,
    },
    format: RASTER_STROKE_GOLDEN_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const retargetSourceTexture = device.createTexture({
    label: "Traccia golden cross-texture retarget source",
    size: {
      width: RASTER_STROKE_GOLDEN_WIDTH,
      height: RASTER_STROKE_GOLDEN_HEIGHT,
      depthOrArrayLayers: 1,
    },
    format: RASTER_STROKE_GOLDEN_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const m1CoverageTexture = device.createTexture({
    label: "Traccia golden M1 R8 coverage source",
    size: {
      width: RASTER_STROKE_GOLDEN_WIDTH,
      height: RASTER_STROKE_GOLDEN_HEIGHT,
      depthOrArrayLayers: 1,
    },
    format: "r8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const referenceMip1Texture = device.createTexture({
    label: "Traccia golden materialized mip 0 to reference mip 1",
    size: {
      width: RASTER_STROKE_GOLDEN_WIDTH >> 1,
      height: RASTER_STROKE_GOLDEN_HEIGHT >> 1,
      depthOrArrayLayers: 1,
    },
    format: RASTER_STROKE_GOLDEN_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
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
  let bevelRenderer: RasterBevelRenderer | null = null;
  let retargetWorkbench: EffectsWorkbench | null = null;
  let referenceWorkbench: EffectsWorkbench | null = null;
  try {
    retargetWorkbench = new EffectsWorkbench({
      device,
      view: sourceTexture.createView(),
      format: RASTER_STROKE_GOLDEN_FORMAT,
    });
    renderer = await RasterStrokeRenderer.create({
      device,
      scratchPool: retargetWorkbench.scratchPool,
      documentWidth: RASTER_STROKE_GOLDEN_WIDTH,
      documentHeight: RASTER_STROKE_GOLDEN_HEIGHT,
      layerFormat: RASTER_STROKE_GOLDEN_FORMAT,
      layerView: sourceTexture.createView(),
      lightGlazeUniformBuffer,
      thicknessTailUniformBuffer,
      scratchExtent: 512,
      readbackEnabled: true,
    });

    const mipBindGroupLayout = device.createBindGroupLayout({
      label: "Traccia golden mip downsample bind group layout",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
      }],
    });
    const mipShaderModule = device.createShaderModule({
      label: "Traccia golden mip downsample WGSL",
      code: paintMipDownsampleShader,
    });
    const mipPipeline = device.createRenderPipeline({
      label: "Traccia golden mip downsample pipeline",
      layout: device.createPipelineLayout({ bindGroupLayouts: [mipBindGroupLayout] }),
      vertex: { module: mipShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: mipShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: RASTER_STROKE_GOLDEN_FORMAT }],
      },
      primitive: { topology: "triangle-list" },
    });
    if (!renderer.goldenMip0SamplingView) {
      throw new Error("Vista golden mip 0 Traccia non disponibile.");
    }
    renderer.setLightGlazeView(transientTexture.createView());
    renderer.setThicknessTailView(transientTexture.createView());
    const referenceMip1BindGroup = device.createBindGroup({
      label: "Traccia golden materialized mip 0 reference bind group",
      layout: mipBindGroupLayout,
      entries: [{ binding: 0, resource: renderer.goldenMip0SamplingView }],
    });
    const mipBindGroups = renderer.mipViews.slice(0, -1).map((sourceView, mipLevel) =>
      device.createBindGroup({
        label: `Traccia golden mip ${mipLevel} to ${mipLevel + 1}`,
        layout: mipBindGroupLayout,
        entries: [{ binding: 0, resource: sourceView }],
      }));

    const fixture = createRasterStrokeGoldenFixture();
    const fixtureSha256 = await sha256(fixture);
    uploadFixture(device, sourceTexture, fixture);
    const cases: RasterStrokeGoldenCase[] = [];
    const diagnostics: RasterStrokeGoldenDiagnostic[] = [];

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
      for (let mipLevel = 2; mipLevel < renderer!.styledMipLevelCount; mipLevel += 1) {
        const mipPass = encoder.beginRenderPass({
          label: `Traccia golden build full styled mip ${mipLevel}`,
          colorAttachments: [{
            view: renderer!.mipViews[mipLevel - 1],
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          }],
        });
        mipPass.setPipeline(mipPipeline);
        mipPass.setBindGroup(0, mipBindGroups[mipLevel - 2]);
        mipPass.draw(3, 1, 0, 0);
        mipPass.end();
      }
      device.queue.submit([encoder.finish()]);

      const mips: RasterStrokeGoldenMip[] = [];
      for (let mipLevel = 0; mipLevel < renderer!.styledMipLevelCount; mipLevel += 1) {
        const pixels = await renderer!.readStyledPixels(undefined, mipLevel);
        mips.push({
          level: mipLevel,
          width: Math.max(1, RASTER_STROKE_GOLDEN_WIDTH >> mipLevel),
          height: Math.max(1, RASTER_STROKE_GOLDEN_HEIGHT >> mipLevel),
          sha256: await sha256(pixels),
          byteLength: pixels.byteLength,
          nonZeroAlphaPixels: countNonZeroAlphaPixels(pixels),
        });
      }
      const baseMip = mips[0];
      cases.push({
        id,
        sha256: baseMip.sha256,
        byteLength: baseMip.byteLength,
        nonZeroAlphaPixels: baseMip.nonZeroAlphaPixels,
        mips,
      });
    };

    const runMutationGateDiagnostic = async (
      id: string,
      baselinePixels: Uint8Array,
      mutate: (pixels: Uint8Array) => void,
      mutationRect: RasterStrokeRect,
      style: RasterStrokeStyle,
      expectedGateFlags: number,
    ): Promise<void> => {
      uploadFixture(device, sourceTexture, baselinePixels);
      const baselineEncoder = device.createCommandEncoder({
        label: `Traccia golden ${id} baseline`,
      });
      renderer!.encode({
        encoder: baselineEncoder,
        sourceMode: "permanent",
        style,
        rebuildRect: FULL_RECT,
        composeRect: FULL_RECT,
        clearStyled: true,
        resetThresholdMask: true,
      });
      device.queue.submit([baselineEncoder.finish()]);

      mutate(baselinePixels);
      uploadFixture(device, sourceTexture, baselinePixels);
      const effectRect = expandedEffectRect(mutationRect, style.width);
      const gatedEncoder = device.createCommandEncoder({
        label: `Traccia golden ${id} gated mutation`,
      });
      renderer!.encode({
        encoder: gatedEncoder,
        sourceMode: "permanent",
        style,
        rebuildRect: effectRect,
        changeDetectionRect: mutationRect,
        composeRect: mutationRect,
        conditionalComposeRect: effectRect,
      });
      device.queue.submit([gatedEncoder.finish()]);
      const gateFlags = await renderer!.readChangeStateFlags();
      const gatedMip1Sha256 = await sha256(
        await renderer!.readStyledPixels(undefined, 1),
      );

      const forcedEncoder = device.createCommandEncoder({
        label: `Traccia golden ${id} forced rebuild`,
      });
      renderer!.encode({
        encoder: forcedEncoder,
        sourceMode: "permanent",
        style,
        rebuildRect: effectRect,
        composeRect: effectRect,
        resetThresholdMask: true,
      });
      device.queue.submit([forcedEncoder.finish()]);
      const forcedMip1Sha256 = await sha256(
        await renderer!.readStyledPixels(undefined, 1),
      );
      diagnostics.push({
        id,
        kind: "mutation-gate",
        passed:
          gateFlags === expectedGateFlags
          && gatedMip1Sha256 === forcedMip1Sha256,
        expectedGateFlags,
        gateFlags,
        gatedMip1Sha256,
        forcedMip1Sha256,
      });
    };

    const runSourceModeMipDiagnostic = async (
      id: string,
      sourceMode: RasterStrokeSourceMode,
      style: RasterStrokeStyle,
    ): Promise<void> => {
      const encoder = device.createCommandEncoder({
        label: `Traccia golden ${id}`,
      });
      renderer!.encode({
        encoder,
        sourceMode,
        style,
        rebuildRect: FULL_RECT,
        composeRect: FULL_RECT,
        clearStyled: true,
        resetThresholdMask: true,
      });
      const referencePass = encoder.beginRenderPass({
        label: `Traccia golden ${id} materialized mip 0 reference`,
        colorAttachments: [{
          view: referenceMip1Texture.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      referencePass.setPipeline(mipPipeline);
      referencePass.setBindGroup(0, referenceMip1BindGroup);
      referencePass.draw(3, 1, 0, 0);
      referencePass.end();
      device.queue.submit([encoder.finish()]);

      const runtimeMip1Pixels = await renderer!.readStyledPixels(undefined, 1);
      const referenceMip1Pixels = await readRgba8Texture(
        device,
        referenceMip1Texture,
        RASTER_STROKE_GOLDEN_WIDTH >> 1,
        RASTER_STROKE_GOLDEN_HEIGHT >> 1,
      );
      const runtimeMip1Sha256 = await sha256(runtimeMip1Pixels);
      const referenceMip1Sha256 = await sha256(referenceMip1Pixels);
      let differingBytes = 0;
      let maxByteDelta = 0;
      let firstDifference: RasterStrokeGoldenDiagnostic["firstDifference"];
      const mip1Width = RASTER_STROKE_GOLDEN_WIDTH >> 1;
      const channels = ["r", "g", "b", "a"] as const;
      for (let byteIndex = 0; byteIndex < runtimeMip1Pixels.length; byteIndex += 1) {
        const runtime = runtimeMip1Pixels[byteIndex];
        const reference = referenceMip1Pixels[byteIndex];
        if (runtime === reference) {
          continue;
        }
        differingBytes += 1;
        maxByteDelta = Math.max(maxByteDelta, Math.abs(runtime - reference));
        if (!firstDifference) {
          const pixelIndex = Math.floor(byteIndex / 4);
          firstDifference = {
            byteIndex,
            x: pixelIndex % mip1Width,
            y: Math.floor(pixelIndex / mip1Width),
            channel: channels[byteIndex % 4],
            runtime,
            reference,
          };
        }
      }
      diagnostics.push({
        id,
        kind: "source-mode-mip",
        passed: differingBytes === 0,
        runtimeMip1Sha256,
        referenceMip1Sha256,
        differingBytes,
        maxByteDelta,
        ...(firstDifference ? { firstDifference } : {}),
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

    await runMutationGateDiagnostic(
      "gate-deep-interior-skips-rebuild",
      createRasterStrokeGoldenFixture(),
      mutateDeepInterior,
      DEEP_INTERIOR_MUTATION_RECT,
      CENTER_STYLE,
      0,
    );
    await runMutationGateDiagnostic(
      "gate-subthreshold-alpha-near-outer-coverage",
      createOuterCoverageAlphaFixture(),
      mutateOuterCoverageAlpha,
      OUTER_COVERAGE_ALPHA_MUTATION_RECT,
      OUTSIDE_STYLE,
      2,
    );

    const sourceModeBase = createRasterStrokeGoldenFixture();
    uploadFixture(device, sourceTexture, sourceModeBase);
    uploadFixture(
      device,
      transientTexture,
      createLightGlazeTransientFixture("source-over"),
    );
    writeGoldenLightGlazeUniforms(
      device,
      lightGlazeUniformBuffer,
      0.43,
      "source-over",
    );
    await runSourceModeMipDiagnostic(
      "light-glaze-source-over-opacity-0.43",
      "light-glaze",
      CENTER_STYLE,
    );

    uploadR8Fixture(device, m1CoverageTexture, createM1CoverageFixture());
    renderer.setLightGlazeView(m1CoverageTexture.createView());
    writeGoldenLightGlazeUniforms(
      device,
      lightGlazeUniformBuffer,
      0.37,
      "m1-max-coverage",
    );
    await runSourceModeMipDiagnostic(
      "light-glaze-m1-r8-max-coverage-opacity-0.37",
      "light-glaze",
      CENTER_STYLE,
    );

    renderer.setLightGlazeView(transientTexture.createView());
    uploadFixture(device, transientTexture, createThicknessTailTransientFixture());
    writeGoldenThicknessTailUniforms(device, thicknessTailUniformBuffer);
    await runSourceModeMipDiagnostic(
      "thickness-tail-source-over",
      "thickness-tail",
      OUTSIDE_STYLE,
    );

    const retargetBevelStyle = copyRasterBevelStyle(DEFAULT_RASTER_BEVEL_STYLE);
    retargetBevelStyle.enabled = true;
    retargetBevelStyle.size = 12;
    bevelRenderer = await RasterBevelRenderer.create({
      device,
      scratchPool: retargetWorkbench.scratchPool,
      documentWidth: RASTER_STROKE_GOLDEN_WIDTH,
      documentHeight: RASTER_STROKE_GOLDEN_HEIGHT,
      layerView: sourceTexture.createView(),
      lightGlazeUniformBuffer,
      thicknessTailUniformBuffer,
    });
    const retargetBevelRenderer = bevelRenderer;
    retargetWorkbench.attachStrokeRenderer(renderer);
    retargetWorkbench.attachBevelRenderer(retargetBevelRenderer);
    retargetBevelRenderer.updateStyleResources(retargetBevelStyle);
    renderer.setBevelResources(
      retargetBevelRenderer.heightView,
      retargetBevelRenderer.glossView,
    );
    renderer.updateBevelParameters(retargetBevelStyle);

    // Parametrizzato di proposito: il caso cross-texture deve eseguire
    // ESATTAMENTE lo stesso stack sul renderer retargettato e su quello di
    // riferimento, altrimenti il confronto non dimostrerebbe nulla.
    const encodeRetargetStyleStack = async (
      label: string,
      strokeTarget: RasterStrokeRenderer,
      bevelTarget: RasterBevelRenderer,
    ): Promise<void> => {
      const encoder = device.createCommandEncoder({ label });
      bevelTarget.encode({
        encoder,
        style: retargetBevelStyle,
        sourceMode: "permanent",
        rebuildRect: FULL_RECT,
        changeDetectionRect: null,
        clearHeight: true,
      });
      strokeTarget.encode({
        encoder,
        sourceMode: "permanent",
        style: CENTER_STYLE,
        bevelStyle: retargetBevelStyle,
        rebuildRect: FULL_RECT,
        changeDetectionRect: null,
        composeRect: FULL_RECT,
        conditionalComposeRect: null,
        clearStyled: true,
        resetThresholdMask: true,
      });
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
    };

    await encodeRetargetStyleStack(
      "Traccia/Smusso same-view retarget baseline",
      renderer,
      retargetBevelRenderer,
    );
    const beforeMip0 = await renderer.readStyledPixels(undefined, 0);
    const beforeMip1 = await renderer.readStyledPixels(undefined, 1);
    const sameTextureView = sourceTexture.createView({
      label: "Traccia/Smusso same-texture retarget view",
    });
    retargetWorkbench.retarget({
      view: sameTextureView,
      format: RASTER_STROKE_GOLDEN_FORMAT,
    });
    await encodeRetargetStyleStack(
      "Traccia/Smusso same-view retarget rebuilt",
      renderer,
      retargetBevelRenderer,
    );
    const afterMip0 = await renderer.readStyledPixels(undefined, 0);
    const afterMip1 = await renderer.readStyledPixels(undefined, 1);
    let retargetDifferingBytes = 0;
    let retargetMaxByteDelta = 0;
    for (const [before, after] of [
      [beforeMip0, afterMip0],
      [beforeMip1, afterMip1],
    ] as const) {
      for (let byteIndex = 0; byteIndex < before.length; byteIndex += 1) {
        if (before[byteIndex] === after[byteIndex]) {
          continue;
        }
        retargetDifferingBytes += 1;
        retargetMaxByteDelta = Math.max(
          retargetMaxByteDelta,
          Math.abs(before[byteIndex] - after[byteIndex]),
        );
      }
    }
    const beforeMip0Sha256 = await sha256(beforeMip0);
    const afterMip0Sha256 = await sha256(afterMip0);
    const beforeMip1Sha256 = await sha256(beforeMip1);
    const afterMip1Sha256 = await sha256(afterMip1);
    diagnostics.push({
      id: "stroke-bevel-same-view-retarget",
      kind: "retarget-identity",
      passed:
        retargetDifferingBytes === 0
        && beforeMip0Sha256 === afterMip0Sha256
        && beforeMip1Sha256 === afterMip1Sha256,
      beforeMip0Sha256,
      afterMip0Sha256,
      beforeMip1Sha256,
      afterMip1Sha256,
      differingBytes: retargetDifferingBytes,
      maxByteDelta: retargetMaxByteDelta,
    });

    // Il caso same-view non può distinguere un retarget funzionante da un
    // no-op: entrambi lasciano ogni binding sulla texture di partenza. Solo il
    // ricollegamento a una sorgente DIVERSA, confrontato con renderer creati
    // nativamente su quella sorgente, dimostra che il retarget ha ricostruito
    // ogni bind group che referenzia il layer.
    uploadFixture(device, retargetSourceTexture, createRetargetSourceFixture());
    retargetWorkbench.retarget({
      view: retargetSourceTexture.createView({
        label: "Traccia/Smusso cross-texture retarget view",
      }),
      format: RASTER_STROKE_GOLDEN_FORMAT,
    });
    await encodeRetargetStyleStack(
      "Traccia/Smusso cross-texture retarget rebuilt",
      renderer,
      retargetBevelRenderer,
    );
    const crossRetargetedMip0 = await renderer.readStyledPixels(undefined, 0);
    const crossRetargetedMip1 = await renderer.readStyledPixels(undefined, 1);

    referenceWorkbench = new EffectsWorkbench({
      device,
      view: retargetSourceTexture.createView(),
      format: RASTER_STROKE_GOLDEN_FORMAT,
    });
    const referenceBevelRenderer = await RasterBevelRenderer.create({
      device,
      scratchPool: referenceWorkbench.scratchPool,
      documentWidth: RASTER_STROKE_GOLDEN_WIDTH,
      documentHeight: RASTER_STROKE_GOLDEN_HEIGHT,
      layerView: retargetSourceTexture.createView(),
      lightGlazeUniformBuffer,
      thicknessTailUniformBuffer,
    });
    referenceWorkbench.attachBevelRenderer(referenceBevelRenderer);
    const referenceStrokeRenderer = await RasterStrokeRenderer.create({
      device,
      scratchPool: referenceWorkbench.scratchPool,
      documentWidth: RASTER_STROKE_GOLDEN_WIDTH,
      documentHeight: RASTER_STROKE_GOLDEN_HEIGHT,
      layerFormat: RASTER_STROKE_GOLDEN_FORMAT,
      layerView: retargetSourceTexture.createView(),
      lightGlazeUniformBuffer,
      thicknessTailUniformBuffer,
      scratchExtent: 512,
      readbackEnabled: true,
    });
    referenceWorkbench.attachStrokeRenderer(referenceStrokeRenderer);
    referenceBevelRenderer.updateStyleResources(retargetBevelStyle);
    referenceStrokeRenderer.setBevelResources(
      referenceBevelRenderer.heightView,
      referenceBevelRenderer.glossView,
    );
    referenceStrokeRenderer.updateBevelParameters(retargetBevelStyle);
    await encodeRetargetStyleStack(
      "Traccia/Smusso cross-texture riferimento nativo",
      referenceStrokeRenderer,
      referenceBevelRenderer,
    );
    const crossReferenceMip0 = await referenceStrokeRenderer.readStyledPixels(
      undefined,
      0,
    );
    const crossReferenceMip1 = await referenceStrokeRenderer.readStyledPixels(
      undefined,
      1,
    );

    let crossDifferingBytes = 0;
    let crossMaxByteDelta = 0;
    for (const [retargeted, reference] of [
      [crossRetargetedMip0, crossReferenceMip0],
      [crossRetargetedMip1, crossReferenceMip1],
    ] as const) {
      for (let byteIndex = 0; byteIndex < reference.length; byteIndex += 1) {
        if (retargeted[byteIndex] === reference[byteIndex]) {
          continue;
        }
        crossDifferingBytes += 1;
        crossMaxByteDelta = Math.max(
          crossMaxByteDelta,
          Math.abs(retargeted[byteIndex] - reference[byteIndex]),
        );
      }
    }
    const crossRetargetedMip0Sha256 = await sha256(crossRetargetedMip0);
    const crossRetargetedMip1Sha256 = await sha256(crossRetargetedMip1);
    const crossReferenceMip0Sha256 = await sha256(crossReferenceMip0);
    const crossReferenceMip1Sha256 = await sha256(crossReferenceMip1);
    // Guardia anti-tautologia: se le due sorgenti producessero lo stesso stile,
    // l'uguaglianza qui sopra sarebbe soddisfatta anche da un retarget inerte.
    const sourceContentDistinct = afterMip0Sha256 !== crossReferenceMip0Sha256;
    diagnostics.push({
      id: "stroke-bevel-cross-texture-retarget",
      kind: "retarget-identity",
      passed:
        crossDifferingBytes === 0
        && crossRetargetedMip0Sha256 === crossReferenceMip0Sha256
        && crossRetargetedMip1Sha256 === crossReferenceMip1Sha256
        && sourceContentDistinct,
      beforeMip0Sha256: afterMip0Sha256,
      beforeMip1Sha256: afterMip1Sha256,
      runtimeMip0Sha256: crossRetargetedMip0Sha256,
      referenceMip0Sha256: crossReferenceMip0Sha256,
      runtimeMip1Sha256: crossRetargetedMip1Sha256,
      referenceMip1Sha256: crossReferenceMip1Sha256,
      sourceContentDistinct,
      differingBytes: crossDifferingBytes,
      maxByteDelta: crossMaxByteDelta,
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
    const mipCombinedIdentity = new TextEncoder().encode(JSON.stringify({
      mipChainVersion: RASTER_STROKE_GOLDEN_MIP_CHAIN_VERSION,
      format: RASTER_STROKE_GOLDEN_FORMAT,
      width: RASTER_STROKE_GOLDEN_WIDTH,
      height: RASTER_STROKE_GOLDEN_HEIGHT,
      fixtureSha256,
      cases: cases.map(({ id, mips }) => ({
        id,
        mips: mips.map(({ level, width, height, sha256: mipSha256 }) => ({
          level,
          width,
          height,
          sha256: mipSha256,
        })),
      })),
    }));
    const mipCombinedSha256 = await sha256(mipCombinedIdentity);
    const baselineCases = new Map(
      rasterStrokeGoldenBaseline.cases.map((goldenCase) => [
        goldenCase.id,
        goldenCase.sha256,
      ]),
    );
    const baselineMismatches = cases
      .filter((goldenCase) => baselineCases.get(goldenCase.id) !== goldenCase.sha256)
      .map((goldenCase) => goldenCase.id);
    const baselineMips = new Map<string, string>(
      rasterStrokeMipGoldenBaseline.cases.flatMap((goldenCase) =>
        goldenCase.mips.map((mip) => [
          `${goldenCase.id}:mip-${mip.level}`,
          mip.sha256,
        ] as const)),
    );
    for (const goldenCase of cases) {
      for (const mip of goldenCase.mips) {
        const id = `${goldenCase.id}:mip-${mip.level}`;
        if (baselineMips.get(id) !== mip.sha256) {
          baselineMismatches.push(id);
        }
      }
    }
    if (fixtureSha256 !== rasterStrokeGoldenBaseline.fixtureSha256) {
      baselineMismatches.unshift("fixture");
    }
    if (combinedSha256 !== rasterStrokeGoldenBaseline.combinedSha256) {
      baselineMismatches.unshift("combined");
    }
    if (mipCombinedSha256 !== rasterStrokeMipGoldenBaseline.mipCombinedSha256) {
      baselineMismatches.unshift("mip-combined");
    }
    return {
      version: RASTER_STROKE_GOLDEN_VERSION,
      rendererBuild: RASTER_STROKE_RENDERER_BUILD,
      format: RASTER_STROKE_GOLDEN_FORMAT,
      width: RASTER_STROKE_GOLDEN_WIDTH,
      height: RASTER_STROKE_GOLDEN_HEIGHT,
      fixtureSha256,
      combinedSha256,
      mipChainVersion: RASTER_STROKE_GOLDEN_MIP_CHAIN_VERSION,
      mipCombinedSha256,
      diagnosticsVersion: RASTER_STROKE_GOLDEN_DIAGNOSTICS_VERSION,
      diagnosticsMatch: diagnostics.every((diagnostic) => diagnostic.passed),
      diagnostics,
      baselineMatches: baselineMismatches.length === 0,
      baselineMismatches,
      cases,
    };
  } finally {
    referenceWorkbench?.destroy();
    if (retargetWorkbench) {
      retargetWorkbench.destroy();
    } else {
      bevelRenderer?.destroy();
      renderer?.destroy();
    }
    sourceTexture.destroy();
    retargetSourceTexture.destroy();
    transientTexture.destroy();
    m1CoverageTexture.destroy();
    referenceMip1Texture.destroy();
    lightGlazeUniformBuffer.destroy();
    thicknessTailUniformBuffer.destroy();
  }
}
