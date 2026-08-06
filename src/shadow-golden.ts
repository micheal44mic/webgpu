import { DEFAULT_RASTER_BEVEL_STYLE } from "./bevel-core";
import { EffectsWorkbench } from "./effects-workbench";
import {
  DEFAULT_RASTER_INNER_SHADOW_STYLE,
  DEFAULT_RASTER_OUTER_SHADOW_STYLE,
  type RasterInnerShadowStyle,
  type RasterOuterShadowStyle,
  type RasterShadowRect,
} from "./shadow-core";
import {
  RASTER_SHADOW_RENDERER_BUILD,
  RasterShadowRenderer,
} from "./shadow-renderer";
import { paintMipDownsampleShader } from "./shaders";
import {
  createRasterStrokeGoldenFixture,
  RASTER_STROKE_GOLDEN_FORMAT,
  RASTER_STROKE_GOLDEN_HEIGHT,
  RASTER_STROKE_GOLDEN_WIDTH,
} from "./stroke-golden";
import type { RasterStrokeStyle } from "./stroke-core";
import {
  RASTER_STROKE_RENDERER_BUILD,
  RasterStrokeRenderer,
} from "./stroke-renderer";
import rasterShadowGoldenBaseline from "../goldens/raster-shadow-rgba8-v1.json";

export const RASTER_SHADOW_GOLDEN_VERSION = 1 as const;
export const RASTER_SHADOW_GOLDEN_MIP_CHAIN_VERSION = 1 as const;

interface RasterShadowGoldenBaseline {
  fixtureSha256: string;
  combinedSha256: string;
  mipCombinedSha256: string;
  cases: {
    id: string;
    sha256: string;
    mips: { level: number; sha256: string }[];
  }[];
}

const goldenBaseline =
  rasterShadowGoldenBaseline as unknown as RasterShadowGoldenBaseline;

export interface RasterShadowGoldenMip {
  level: number;
  width: number;
  height: number;
  sha256: string;
  byteLength: number;
  nonZeroAlphaPixels: number;
}

export interface RasterShadowGoldenCase {
  id: string;
  sha256: string;
  byteLength: number;
  nonZeroAlphaPixels: number;
  outerStyle: RasterOuterShadowStyle;
  innerStyle: RasterInnerShadowStyle;
  mips: RasterShadowGoldenMip[];
}

export interface RasterShadowGoldenReport {
  version: typeof RASTER_SHADOW_GOLDEN_VERSION;
  mipChainVersion: typeof RASTER_SHADOW_GOLDEN_MIP_CHAIN_VERSION;
  rendererBuild: string;
  compositorBuild: string;
  format: typeof RASTER_STROKE_GOLDEN_FORMAT;
  width: number;
  height: number;
  fixtureSha256: string;
  combinedSha256: string;
  mipCombinedSha256: string;
  baselineMatches: boolean;
  repeatMatches: boolean;
  baselineMismatches: string[];
  cases: RasterShadowGoldenCase[];
}

interface GoldenStyleCase {
  id: string;
  outerStyle?: RasterOuterShadowStyle;
  innerStyle?: RasterInnerShadowStyle;
}

const FULL_RECT: RasterShadowRect = {
  x: 0,
  y: 0,
  width: RASTER_STROKE_GOLDEN_WIDTH,
  height: RASTER_STROKE_GOLDEN_HEIGHT,
};

const DISABLED_STROKE_STYLE: RasterStrokeStyle = {
  enabled: false,
  width: 0,
  position: "outside",
  color: [0, 0, 0, 0],
};

const OUTER_SOFT: RasterOuterShadowStyle = {
  ...DEFAULT_RASTER_OUTER_SHADOW_STYLE,
  enabled: true,
  blendMode: "multiply",
  opacity: 73,
  angle: 120,
  distance: 11.5,
  spread: 0,
  size: 17.25,
  contour: "linear",
  contourAA: true,
  noise: 0,
  layerKnocksOut: true,
};

const OUTER_HARD_NOISY: RasterOuterShadowStyle = {
  ...DEFAULT_RASTER_OUTER_SHADOW_STYLE,
  enabled: true,
  blendMode: "normal",
  color: [0.08, 0.21, 0.76],
  opacity: 61,
  angle: 33,
  distance: 8.75,
  spread: 82,
  size: 14,
  contour: "ring",
  contourAA: false,
  noise: 37,
  layerKnocksOut: false,
};

const INNER_SOFT: RasterInnerShadowStyle = {
  ...DEFAULT_RASTER_INNER_SHADOW_STYLE,
  enabled: true,
  blendMode: "multiply",
  opacity: 68,
  angle: 211,
  distance: 9.25,
  choke: 0,
  size: 19.5,
  contour: "gaussian",
  contourAA: true,
  noise: 0,
};

const INNER_HARD_NOISY: RasterInnerShadowStyle = {
  ...DEFAULT_RASTER_INNER_SHADOW_STYLE,
  enabled: true,
  blendMode: "normal",
  color: [0.86, 0.17, 0.06],
  opacity: 57,
  angle: 74,
  distance: 5.5,
  choke: 88,
  size: 12,
  contour: "cone",
  contourAA: false,
  noise: 29,
};

const COMBINED_OUTER: RasterOuterShadowStyle = {
  ...OUTER_SOFT,
  blendMode: "normal",
  color: [0.12, 0.03, 0.31],
  opacity: 66,
  angle: 148,
  distance: 15.25,
  spread: 31,
  size: 21,
  contour: "cone",
  noise: 13,
};

const COMBINED_INNER: RasterInnerShadowStyle = {
  ...INNER_SOFT,
  color: [0.03, 0.42, 0.18],
  opacity: 52,
  angle: 318,
  distance: 7.75,
  choke: 46,
  size: 15,
  contour: "ring",
  noise: 17,
};

const GOLDEN_CASES: readonly GoldenStyleCase[] = [
  { id: "outer-soft-linear", outerStyle: OUTER_SOFT },
  { id: "outer-hard-ring-noise", outerStyle: OUTER_HARD_NOISY },
  { id: "inner-soft-gaussian", innerStyle: INNER_SOFT },
  { id: "inner-hard-cone-noise", innerStyle: INNER_HARD_NOISY },
  {
    id: "outer-inner-combined-order",
    outerStyle: COMBINED_OUTER,
    innerStyle: COMBINED_INNER,
  },
  {
    id: "outer-inner-combined-restored",
    outerStyle: COMBINED_OUTER,
    innerStyle: COMBINED_INNER,
  },
];

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

function uploadFixture(
  device: GPUDevice,
  texture: GPUTexture,
  pixels: Uint8Array,
): void {
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

export async function runRasterShadowGolden(
  device: GPUDevice,
): Promise<RasterShadowGoldenReport> {
  const sourceTexture = device.createTexture({
    label: "Ombre golden deterministic source",
    size: {
      width: RASTER_STROKE_GOLDEN_WIDTH,
      height: RASTER_STROKE_GOLDEN_HEIGHT,
      depthOrArrayLayers: 1,
    },
    format: RASTER_STROKE_GOLDEN_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const lightGlazeUniformBuffer = device.createBuffer({
    label: "Ombre golden Light Glaze uniforms",
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const thicknessTailUniformBuffer = device.createBuffer({
    label: "Ombre golden thickness tail uniforms",
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(lightGlazeUniformBuffer, 0, new Uint8Array(32));
  device.queue.writeBuffer(thicknessTailUniformBuffer, 0, new Uint8Array(32));

  const fixture = createRasterStrokeGoldenFixture();
  const fixtureSha256 = await sha256(fixture);
  uploadFixture(device, sourceTexture, fixture);

  const workbench = new EffectsWorkbench({
    device,
    view: sourceTexture.createView(),
    format: RASTER_STROKE_GOLDEN_FORMAT,
  });
  let compositor: RasterStrokeRenderer | null = null;
  let outerRenderer: RasterShadowRenderer | null = null;
  let innerRenderer: RasterShadowRenderer | null = null;
  try {
    compositor = await RasterStrokeRenderer.create({
      device,
      scratchPool: workbench.scratchPool,
      documentWidth: RASTER_STROKE_GOLDEN_WIDTH,
      documentHeight: RASTER_STROKE_GOLDEN_HEIGHT,
      layerFormat: RASTER_STROKE_GOLDEN_FORMAT,
      layerView: sourceTexture.createView(),
      lightGlazeUniformBuffer,
      thicknessTailUniformBuffer,
      scratchExtent: 8,
      strokeGeometryEnabled: false,
      readbackEnabled: true,
    });
    outerRenderer = await RasterShadowRenderer.create({
      device,
      scratchPool: workbench.scratchPool,
      kind: "outer",
      documentWidth: RASTER_STROKE_GOLDEN_WIDTH,
      documentHeight: RASTER_STROKE_GOLDEN_HEIGHT,
      layerView: sourceTexture.createView(),
      lightGlazeUniformBuffer,
      thicknessTailUniformBuffer,
    });
    innerRenderer = await RasterShadowRenderer.create({
      device,
      scratchPool: workbench.scratchPool,
      kind: "inner",
      documentWidth: RASTER_STROKE_GOLDEN_WIDTH,
      documentHeight: RASTER_STROKE_GOLDEN_HEIGHT,
      layerView: sourceTexture.createView(),
      lightGlazeUniformBuffer,
      thicknessTailUniformBuffer,
    });
    compositor.setShadowResources(
      "outer",
      outerRenderer.coverageBuffer,
      outerRenderer.compositionUniformBuffer,
    );
    compositor.setShadowResources(
      "inner",
      innerRenderer.coverageBuffer,
      innerRenderer.compositionUniformBuffer,
    );

    const mipBindGroupLayout = device.createBindGroupLayout({
      label: "Ombre golden mip downsample bind group layout",
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
      }],
    });
    const mipShaderModule = device.createShaderModule({
      label: "Ombre golden mip downsample WGSL",
      code: paintMipDownsampleShader,
    });
    const mipPipeline = device.createRenderPipeline({
      label: "Ombre golden mip downsample pipeline",
      layout: device.createPipelineLayout({
        bindGroupLayouts: [mipBindGroupLayout],
      }),
      vertex: { module: mipShaderModule, entryPoint: "vertexMain" },
      fragment: {
        module: mipShaderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: RASTER_STROKE_GOLDEN_FORMAT }],
      },
      primitive: { topology: "triangle-list" },
    });
    const mipBindGroups = compositor.mipViews.slice(0, -1).map(
      (sourceView, mipLevel) => device.createBindGroup({
        label: `Ombre golden mip ${mipLevel + 1} to ${mipLevel + 2}`,
        layout: mipBindGroupLayout,
        entries: [{ binding: 0, resource: sourceView }],
      }),
    );

    const cases: RasterShadowGoldenCase[] = [];
    for (const goldenCase of GOLDEN_CASES) {
      const outerStyle = goldenCase.outerStyle ?? {
        ...DEFAULT_RASTER_OUTER_SHADOW_STYLE,
      };
      const innerStyle = goldenCase.innerStyle ?? {
        ...DEFAULT_RASTER_INNER_SHADOW_STYLE,
      };
      outerRenderer.updateStyle(outerStyle);
      innerRenderer.updateStyle(innerStyle);
      const encoder = device.createCommandEncoder({
        label: `Ombre golden ${goldenCase.id}`,
      });
      outerRenderer.encode({
        encoder,
        style: outerStyle,
        sourceMode: "permanent",
        rebuildRect: FULL_RECT,
        clearMatte: true,
      });
      innerRenderer.encode({
        encoder,
        style: innerStyle,
        sourceMode: "permanent",
        rebuildRect: FULL_RECT,
        clearMatte: true,
      });
      compositor.encode({
        encoder,
        style: DISABLED_STROKE_STYLE,
        bevelStyle: DEFAULT_RASTER_BEVEL_STYLE,
        sourceMode: "permanent",
        composeRect: FULL_RECT,
        clearStyled: true,
      });
      for (
        let mipLevel = 2;
        mipLevel < compositor.styledMipLevelCount;
        mipLevel += 1
      ) {
        const pass = encoder.beginRenderPass({
          label: `Ombre golden build full styled mip ${mipLevel}`,
          colorAttachments: [{
            view: compositor.mipViews[mipLevel - 1],
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          }],
        });
        pass.setPipeline(mipPipeline);
        pass.setBindGroup(0, mipBindGroups[mipLevel - 2]);
        pass.draw(3, 1, 0, 0);
        pass.end();
      }
      device.queue.submit([encoder.finish()]);

      const mips: RasterShadowGoldenMip[] = [];
      for (
        let mipLevel = 0;
        mipLevel < compositor.styledMipLevelCount;
        mipLevel += 1
      ) {
        const pixels = await compositor.readStyledPixels(undefined, mipLevel);
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
        id: goldenCase.id,
        sha256: baseMip.sha256,
        byteLength: baseMip.byteLength,
        nonZeroAlphaPixels: baseMip.nonZeroAlphaPixels,
        outerStyle,
        innerStyle,
        mips,
      });
    }

    const combinedSha256 = await sha256(new TextEncoder().encode(JSON.stringify({
      version: RASTER_SHADOW_GOLDEN_VERSION,
      format: RASTER_STROKE_GOLDEN_FORMAT,
      width: RASTER_STROKE_GOLDEN_WIDTH,
      height: RASTER_STROKE_GOLDEN_HEIGHT,
      fixtureSha256,
      cases: cases.map(({ id, sha256: caseSha256 }) => ({
        id,
        sha256: caseSha256,
      })),
    })));
    const mipCombinedSha256 = await sha256(
      new TextEncoder().encode(JSON.stringify({
        mipChainVersion: RASTER_SHADOW_GOLDEN_MIP_CHAIN_VERSION,
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
      })),
    );
    const baselineCases = new Map(
      goldenBaseline.cases.map((goldenCase) => [
        goldenCase.id,
        goldenCase,
      ]),
    );
    const baselineMismatches: string[] = [];
    for (const goldenCase of cases) {
      const baselineCase = baselineCases.get(goldenCase.id);
      if (baselineCase?.sha256 !== goldenCase.sha256) {
        baselineMismatches.push(goldenCase.id);
      }
      const baselineMips = new Map(
        (baselineCase?.mips ?? []).map((mip) => [mip.level, mip.sha256]),
      );
      for (const mip of goldenCase.mips) {
        if (baselineMips.get(mip.level) !== mip.sha256) {
          baselineMismatches.push(`${goldenCase.id}:mip-${mip.level}`);
        }
      }
    }
    if (fixtureSha256 !== goldenBaseline.fixtureSha256) {
      baselineMismatches.unshift("fixture");
    }
    if (combinedSha256 !== goldenBaseline.combinedSha256) {
      baselineMismatches.unshift("combined");
    }
    if (mipCombinedSha256 !== goldenBaseline.mipCombinedSha256) {
      baselineMismatches.unshift("mip-combined");
    }
    const combined = cases.find(
      (goldenCase) => goldenCase.id === "outer-inner-combined-order",
    );
    const restored = cases.find(
      (goldenCase) => goldenCase.id === "outer-inner-combined-restored",
    );
    const repeatMatches = Boolean(
      combined
      && restored
      && combined.mips.length === restored.mips.length
      && combined.mips.every(
        (mip, index) => mip.sha256 === restored.mips[index]?.sha256,
      ),
    );

    return {
      version: RASTER_SHADOW_GOLDEN_VERSION,
      mipChainVersion: RASTER_SHADOW_GOLDEN_MIP_CHAIN_VERSION,
      rendererBuild: RASTER_SHADOW_RENDERER_BUILD,
      compositorBuild: RASTER_STROKE_RENDERER_BUILD,
      format: RASTER_STROKE_GOLDEN_FORMAT,
      width: RASTER_STROKE_GOLDEN_WIDTH,
      height: RASTER_STROKE_GOLDEN_HEIGHT,
      fixtureSha256,
      combinedSha256,
      mipCombinedSha256,
      baselineMatches: baselineMismatches.length === 0,
      repeatMatches,
      baselineMismatches,
      cases,
    };
  } finally {
    innerRenderer?.destroy();
    outerRenderer?.destroy();
    compositor?.destroy();
    workbench.destroy();
    sourceTexture.destroy();
    lightGlazeUniformBuffer.destroy();
    thicknessTailUniformBuffer.destroy();
  }
}
