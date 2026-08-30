import type { BrushEngine } from "./brush-engine";
import { assertShaderCompiled, createRenderPipelineAsync } from "./engine-gpu-utils";
import {
  mixedSceneClearShader,
  mixedScenePresentShader,
} from "./mixed-scene-compositor-shader";

const creationPromises = new WeakMap<BrushEngine, Promise<void>>();

function resourcesReady(engine: BrushEngine): boolean {
  return Boolean(
    engine.mixedScenePresentShaderModule
      && engine.mixedScenePresentBindGroupLayout
      && engine.mixedScenePresentPipeline
      && engine.mixedSceneClearShaderModule
      && engine.mixedSceneBackgroundBindGroupLayout
      && engine.mixedSceneBackgroundBindGroup,
  );
}

/**
 * Prepares only the checker, bounded-clear and document-background resources
 * shared by raster-only layer blending and the full mixed-scene compositor.
 */
export async function ensureMixedScenePresentationResources(
  engine: BrushEngine,
): Promise<void> {
  if (resourcesReady(engine)) return;
  const existing = creationPromises.get(engine);
  if (existing) {
    await existing;
    if (!resourcesReady(engine)) {
      await ensureMixedScenePresentationResources(engine);
    }
    return;
  }

  const initialization = (async (): Promise<void> => {
    const shaderModule = engine.mixedScenePresentShaderModule
      ?? engine.device.createShaderModule({
        label: "Mixed scene checker presentation WGSL",
        code: mixedScenePresentShader,
      });
    const clearShaderModule = engine.mixedSceneClearShaderModule
      ?? engine.device.createShaderModule({
        label: "Mixed scene partial clear WGSL",
        code: mixedSceneClearShader,
      });
    await Promise.all([
      assertShaderCompiled(shaderModule, "mixed scene checker presentation"),
      assertShaderCompiled(clearShaderModule, "mixed scene partial clear"),
    ]);
    const bindGroupLayout = engine.mixedScenePresentBindGroupLayout
      ?? engine.device.createBindGroupLayout({
        label: "Mixed scene presentation bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        ],
      });
    const backgroundBindGroupLayout = engine.mixedSceneBackgroundBindGroupLayout
      ?? engine.device.createBindGroupLayout({
        label: "Mixed scene document background bind group layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        ],
      });
    const backgroundBindGroup = engine.mixedSceneBackgroundBindGroup
      ?? engine.device.createBindGroup({
        label: "Mixed scene document background bind group",
        layout: backgroundBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
        ],
      });
    const pipeline = engine.mixedScenePresentPipeline
      ?? await createRenderPipelineAsync(engine.device, {
        label: "Mixed scene checker presentation pipeline",
        layout: engine.device.createPipelineLayout({
          label: "Mixed scene checker presentation pipeline layout",
          bindGroupLayouts: [bindGroupLayout],
        }),
        vertex: { module: shaderModule, entryPoint: "vertexMain" },
        fragment: {
          module: shaderModule,
          entryPoint: "fragmentMain",
          targets: [{ format: engine.canvasFormat }],
        },
        primitive: { topology: "triangle-list" },
      });

    // Publish the mutually compatible set only after compilation succeeds.
    engine.mixedScenePresentShaderModule = shaderModule;
    engine.mixedSceneClearShaderModule = clearShaderModule;
    engine.mixedScenePresentBindGroupLayout = bindGroupLayout;
    engine.mixedScenePresentPipeline = pipeline;
    engine.mixedSceneBackgroundBindGroupLayout = backgroundBindGroupLayout;
    engine.mixedSceneBackgroundBindGroup = backgroundBindGroup;
  })();
  creationPromises.set(engine, initialization);
  try {
    await initialization;
  } finally {
    if (creationPromises.get(engine) === initialization) {
      creationPromises.delete(engine);
    }
  }
  if (!resourcesReady(engine)) {
    throw new Error("The mixed-scene presentation resources are unavailable.");
  }
}
