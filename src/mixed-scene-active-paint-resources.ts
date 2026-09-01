import type { BrushEngine } from "./brush-engine";
import { createRenderPipelineAsync } from "./engine-gpu-utils";
import { MIXED_SCENE_LINEAR_FORMAT } from "./mixed-scene-compositor-shader";

const sourceOverBlend: GPUBlendState = {
  color: {
    srcFactor: "one",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  },
  alpha: {
    srcFactor: "one",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  },
};

const sourceAtopBlend: GPUBlendState = {
  color: {
    srcFactor: "dst-alpha",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  },
  alpha: {
    srcFactor: "zero",
    dstFactor: "one",
    operation: "add",
  },
};

const rasterStrokeCreationPromises = new WeakMap<BrushEngine, Promise<void>>();
const thicknessTailCreationPromises = new WeakMap<BrushEngine, Promise<void>>();
const lightGlazeCreationPromises = new WeakMap<BrushEngine, Promise<void>>();
const baseCreationPromises = new WeakMap<BrushEngine, Promise<void>>();

export function mixedSceneActiveBasePipelinesReady(engine: BrushEngine): boolean {
  return Boolean(
    engine.mixedSceneActiveDisplayPipeline
    && engine.mixedSceneActiveSourceDisplayPipeline
    && engine.mixedSceneActiveSourceAtopDisplayPipeline
    && engine.mixedSceneActiveCutoutDisplayPipeline,
  );
}

export function mixedSceneActiveRasterStrokePipelinesReady(engine: BrushEngine): boolean {
  return Boolean(
    engine.mixedSceneActiveRasterStrokeDisplayPipeline
    && engine.mixedSceneActiveRasterStrokeSourcePipeline
    && engine.mixedSceneActiveRasterStrokeSourceAtopPipeline
    && engine.mixedSceneActiveRasterStrokeCutoutPipeline,
  );
}

export function mixedSceneActiveThicknessTailPipelinesReady(engine: BrushEngine): boolean {
  return Boolean(
    engine.mixedSceneActiveThicknessTailDisplayPipeline
    && engine.mixedSceneActiveThicknessTailSourcePipeline
    && engine.mixedSceneActiveThicknessTailSourceAtopPipeline,
  );
}

export function mixedSceneActiveLightGlazePipelinesReady(engine: BrushEngine): boolean {
  return Boolean(
    engine.mixedSceneActiveLightGlazeDisplayPipeline
    && engine.mixedSceneActiveLightGlazeSourcePipeline
    && engine.mixedSceneActiveLightGlazeSourceAtopPipeline,
  );
}

/**
 * The base variants also supply authored mattes and isolated clipping sources
 * for the live families. Keep them complete even when the ordinary display
 * pipeline was already prepared by vector import.
 */
export async function ensureMixedSceneActiveBasePipelines(
  engine: BrushEngine,
): Promise<void> {
  if (mixedSceneActiveBasePipelinesReady(engine)) return;
  const existing = baseCreationPromises.get(engine);
  if (existing) {
    await existing;
    if (!mixedSceneActiveBasePipelinesReady(engine)) {
      await ensureMixedSceneActiveBasePipelines(engine);
    }
    return;
  }

  const initialization = (async (): Promise<void> => {
    const layout = engine.device.createPipelineLayout({
      label: "Mixed scene active base layer pipeline layout",
      bindGroupLayouts: [engine.displayBindGroupLayout],
    });
    const [display, source, sourceAtop, cutout] = await Promise.all([
      engine.mixedSceneActiveDisplayPipeline
        ? Promise.resolve(engine.mixedSceneActiveDisplayPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene active base layer source-over pipeline",
          layout,
          vertex: { module: engine.displayShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: engine.displayShaderModule,
            entryPoint: "activeFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
      engine.mixedSceneActiveSourceDisplayPipeline
        ? Promise.resolve(engine.mixedSceneActiveSourceDisplayPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene active base source-only pipeline",
          layout,
          vertex: { module: engine.displayShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: engine.displayShaderModule,
            entryPoint: "activeSourceFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
      engine.mixedSceneActiveSourceAtopDisplayPipeline
        ? Promise.resolve(engine.mixedSceneActiveSourceAtopDisplayPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene active source-atop pipeline",
          layout,
          vertex: { module: engine.displayShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: engine.displayShaderModule,
            entryPoint: "activeSourceFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceAtopBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
      engine.mixedSceneActiveCutoutDisplayPipeline
        ? Promise.resolve(engine.mixedSceneActiveCutoutDisplayPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene active authored matte pipeline",
          layout,
          vertex: { module: engine.displayShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: engine.displayShaderModule,
            entryPoint: "activeCutoutFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
    ]);
    if (engine.deviceLostError) throw engine.deviceLostError;
    engine.mixedSceneActiveDisplayPipeline = display;
    engine.mixedSceneActiveSourceDisplayPipeline = source;
    engine.mixedSceneActiveSourceAtopDisplayPipeline = sourceAtop;
    engine.mixedSceneActiveCutoutDisplayPipeline = cutout;
  })();
  baseCreationPromises.set(engine, initialization);
  try {
    await initialization;
  } finally {
    if (baseCreationPromises.get(engine) === initialization) {
      baseCreationPromises.delete(engine);
    }
  }
  if (!mixedSceneActiveBasePipelinesReady(engine)) {
    throw new Error("The mixed-scene active base pipelines are unavailable.");
  }
}

/**
 * Compiles the active styled-raster family as one capability. Publishing only
 * after every compatible pipeline resolves prevents a render frame from
 * observing a half-created family while optional editor warm-up is in flight.
 */
export async function ensureMixedSceneActiveRasterStrokePipelines(
  engine: BrushEngine,
): Promise<void> {
  if (mixedSceneActiveRasterStrokePipelinesReady(engine)) return;
  const existing = rasterStrokeCreationPromises.get(engine);
  if (existing) {
    await existing;
    if (!mixedSceneActiveRasterStrokePipelinesReady(engine)) {
      await ensureMixedSceneActiveRasterStrokePipelines(engine);
    }
    return;
  }

  const initialization = (async (): Promise<void> => {
    const layout = engine.device.createPipelineLayout({
      label: "Stroke display pipeline layout",
      bindGroupLayouts: [
        engine.rasterStrokeDisplayScreenBindGroupLayout,
        engine.rasterStrokeDisplaySourceBindGroupLayout,
      ],
    });
    const [display, source, sourceAtop, cutout] = await Promise.all([
      engine.mixedSceneActiveRasterStrokeDisplayPipeline
        ? Promise.resolve(engine.mixedSceneActiveRasterStrokeDisplayPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene active Stroke/effects source-over pipeline",
          layout,
          vertex: { module: engine.rasterStrokeDisplayShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: engine.rasterStrokeDisplayShaderModule,
            entryPoint: "activeFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
      engine.mixedSceneActiveRasterStrokeSourcePipeline
        ? Promise.resolve(engine.mixedSceneActiveRasterStrokeSourcePipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene active Stroke/effects source-only pipeline",
          layout,
          vertex: { module: engine.rasterStrokeDisplayShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: engine.rasterStrokeDisplayShaderModule,
            entryPoint: "activeSourceFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
      engine.mixedSceneActiveRasterStrokeSourceAtopPipeline
        ? Promise.resolve(engine.mixedSceneActiveRasterStrokeSourceAtopPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene active Stroke/effects source-atop pipeline",
          layout,
          vertex: { module: engine.rasterStrokeDisplayShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: engine.rasterStrokeDisplayShaderModule,
            entryPoint: "activeSourceFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceAtopBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
      engine.mixedSceneActiveRasterStrokeCutoutPipeline
        ? Promise.resolve(engine.mixedSceneActiveRasterStrokeCutoutPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene active Stroke authored-matte pipeline",
          layout,
          vertex: { module: engine.rasterStrokeDisplayShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: engine.rasterStrokeDisplayShaderModule,
            entryPoint: "activeCutoutFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
    ]);
    if (engine.deviceLostError) throw engine.deviceLostError;
    engine.mixedSceneActiveRasterStrokeDisplayPipeline = display;
    engine.mixedSceneActiveRasterStrokeSourcePipeline = source;
    engine.mixedSceneActiveRasterStrokeSourceAtopPipeline = sourceAtop;
    engine.mixedSceneActiveRasterStrokeCutoutPipeline = cutout;
  })();
  rasterStrokeCreationPromises.set(engine, initialization);
  try {
    await initialization;
  } finally {
    if (rasterStrokeCreationPromises.get(engine) === initialization) {
      rasterStrokeCreationPromises.delete(engine);
    }
  }
  if (!mixedSceneActiveRasterStrokePipelinesReady(engine)) {
    throw new Error("The mixed-scene active Stroke pipelines are unavailable.");
  }
}

export async function ensureMixedSceneActiveThicknessTailPipelines(
  engine: BrushEngine,
): Promise<void> {
  if (mixedSceneActiveThicknessTailPipelinesReady(engine)) return;
  const existing = thicknessTailCreationPromises.get(engine);
  if (existing) {
    await existing;
    if (!mixedSceneActiveThicknessTailPipelinesReady(engine)) {
      await ensureMixedSceneActiveThicknessTailPipelines(engine);
    }
    return;
  }

  const initialization = (async (): Promise<void> => {
    const layout = engine.device.createPipelineLayout({
      label: "Predictive thickness tail display pipeline layout",
      bindGroupLayouts: [engine.thicknessTailDisplayBindGroupLayout],
    });
    const [display, source, sourceAtop] = await Promise.all([
      engine.mixedSceneActiveThicknessTailDisplayPipeline
        ? Promise.resolve(engine.mixedSceneActiveThicknessTailDisplayPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene active thickness tail source-over pipeline",
          layout,
          vertex: { module: engine.thicknessTailDisplayShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: engine.thicknessTailDisplayShaderModule,
            entryPoint: "activeFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
      engine.mixedSceneActiveThicknessTailSourcePipeline
        ? Promise.resolve(engine.mixedSceneActiveThicknessTailSourcePipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene active thickness tail source-only pipeline",
          layout,
          vertex: { module: engine.thicknessTailDisplayShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: engine.thicknessTailDisplayShaderModule,
            entryPoint: "activeSourceFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
      engine.mixedSceneActiveThicknessTailSourceAtopPipeline
        ? Promise.resolve(engine.mixedSceneActiveThicknessTailSourceAtopPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene active thickness tail source-atop pipeline",
          layout,
          vertex: { module: engine.thicknessTailDisplayShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: engine.thicknessTailDisplayShaderModule,
            entryPoint: "activeSourceFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceAtopBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
    ]);
    if (engine.deviceLostError) throw engine.deviceLostError;
    engine.mixedSceneActiveThicknessTailDisplayPipeline = display;
    engine.mixedSceneActiveThicknessTailSourcePipeline = source;
    engine.mixedSceneActiveThicknessTailSourceAtopPipeline = sourceAtop;
  })();
  thicknessTailCreationPromises.set(engine, initialization);
  try {
    await initialization;
  } finally {
    if (thicknessTailCreationPromises.get(engine) === initialization) {
      thicknessTailCreationPromises.delete(engine);
    }
  }
  if (!mixedSceneActiveThicknessTailPipelinesReady(engine)) {
    throw new Error("The mixed-scene active thickness-tail pipelines are unavailable.");
  }
}

export async function ensureMixedSceneActiveLightGlazePipelines(
  engine: BrushEngine,
): Promise<void> {
  if (mixedSceneActiveLightGlazePipelinesReady(engine)) return;
  const existing = lightGlazeCreationPromises.get(engine);
  if (existing) {
    await existing;
    if (!mixedSceneActiveLightGlazePipelinesReady(engine)) {
      await ensureMixedSceneActiveLightGlazePipelines(engine);
    }
    return;
  }

  const initialization = (async (): Promise<void> => {
    const layout = engine.device.createPipelineLayout({
      label: "Light Glaze live display pipeline layout",
      bindGroupLayouts: [engine.lightGlazeDisplayBindGroupLayout],
    });
    const [display, source, sourceAtop] = await Promise.all([
      engine.mixedSceneActiveLightGlazeDisplayPipeline
        ? Promise.resolve(engine.mixedSceneActiveLightGlazeDisplayPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene active Light Glaze source-over pipeline",
          layout,
          vertex: { module: engine.lightGlazeDisplayShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: engine.lightGlazeDisplayShaderModule,
            entryPoint: "activeFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
      engine.mixedSceneActiveLightGlazeSourcePipeline
        ? Promise.resolve(engine.mixedSceneActiveLightGlazeSourcePipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene active Light Glaze source-only pipeline",
          layout,
          vertex: { module: engine.lightGlazeDisplayShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: engine.lightGlazeDisplayShaderModule,
            entryPoint: "activeSourceFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceOverBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
      engine.mixedSceneActiveLightGlazeSourceAtopPipeline
        ? Promise.resolve(engine.mixedSceneActiveLightGlazeSourceAtopPipeline)
        : createRenderPipelineAsync(engine.device, {
          label: "Mixed scene active Light Glaze source-atop pipeline",
          layout,
          vertex: { module: engine.lightGlazeDisplayShaderModule, entryPoint: "vertexMain" },
          fragment: {
            module: engine.lightGlazeDisplayShaderModule,
            entryPoint: "activeSourceFragmentMain",
            targets: [{ format: MIXED_SCENE_LINEAR_FORMAT, blend: sourceAtopBlend }],
          },
          primitive: { topology: "triangle-list" },
        }),
    ]);
    if (engine.deviceLostError) throw engine.deviceLostError;
    engine.mixedSceneActiveLightGlazeDisplayPipeline = display;
    engine.mixedSceneActiveLightGlazeSourcePipeline = source;
    engine.mixedSceneActiveLightGlazeSourceAtopPipeline = sourceAtop;
  })();
  lightGlazeCreationPromises.set(engine, initialization);
  try {
    await initialization;
  } finally {
    if (lightGlazeCreationPromises.get(engine) === initialization) {
      lightGlazeCreationPromises.delete(engine);
    }
  }
  if (!mixedSceneActiveLightGlazePipelinesReady(engine)) {
    throw new Error("The mixed-scene active Light Glaze pipelines are unavailable.");
  }
}
