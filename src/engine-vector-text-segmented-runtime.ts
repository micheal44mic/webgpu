import type {
  BrushEngine,
} from "./brush-engine";
import {
  type MixedSceneActivePresentation,
} from "./engine-vector-text-resources";
import {
  type DirtyRect,
} from "./engine-stroke-types";
import {
  MIXED_SCENE_COMPOSITOR_STRATEGY,
  MIXED_SCENE_LINEAR_FORMAT,
} from "./mixed-scene-compositor-shader";
import {
  type MixedSceneCompositionSegment,
} from "./mixed-scene-stack";
import {
  rasterImageBindGroupForNode,
} from "./engine-raster-image-runtime";
import {
  LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_SIZE,
} from "./layer-blend-compositor";
import {
  LAYER_BLEND_MODE_CODES,
  LAYER_BLEND_MODE_ORDER,
} from "./layer-blend-modes";
import {
  runGpuAllocationTransaction,
} from "./gpu-allocation-transaction";

export function encodeMixedSceneSegmentedPresentation(engine: BrushEngine,
  encoder: GPUCommandEncoder,
  presentationDirtyRect: DirtyRect,
  requiresFullRebuild: boolean,
  activePresentation: MixedSceneActivePresentation,
  label: string,
): void {
  const linearView = engine.mixedSceneLinearView;
  const presentBindGroup = engine.mixedScenePresentBindGroup;
  const clearPipeline = engine.mixedSceneClearPipeline;
  const rasterPipeline = engine.mixedSceneRasterSegmentPipeline;
  const textPipeline = engine.mixedSceneTextSegmentPipeline;
  const imagePipeline = engine.rasterImageMixedScenePipeline;
  const presentPipeline = engine.mixedScenePresentPipeline;
  if (
    !engine.usesOrderedScenePresentation()
    || !linearView
    || !presentBindGroup
    || !clearPipeline
    || !rasterPipeline
    || !textPipeline
    || !imagePipeline
    || !presentPipeline
    || !engine.presentationCacheView
  ) {
    throw new Error("Compositore segmentato raster/testo non pronto.");
  }

  const drawSegmentSource = (
    pass: GPURenderPassEncoder,
    segment: MixedSceneCompositionSegment,
  ): void => {
    if (segment.kind === "raster-run") {
      const resources = engine.mixedSceneRasterSegments.find(
        (candidate) => candidate.key === segment.key,
      );
      if (resources) {
        pass.setPipeline(rasterPipeline);
        pass.setBindGroup(0, resources.bindGroup);
        pass.draw(3, 1, 0, 0);
      }
      return;
    }
    if (segment.kind === "text-run") {
      const resources = engine.vectorTextRunTextures.get(segment.key);
      if (resources) {
        pass.setPipeline(textPipeline);
        pass.setBindGroup(0, resources.bindGroup);
        pass.draw(3, 1, 0, 0);
      }
      return;
    }
    if (segment.kind === "image") {
      const scene = engine.mixedSceneStack;
      if (!scene) {
        throw new Error("Nodo immagine senza scena mista.");
      }
      const node = scene.imageById(segment.item.imageNodeId);
      const bindGroup = rasterImageBindGroupForNode(engine, node);
      if (bindGroup) {
        pass.setPipeline(imagePipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(4, 1, 0, 0);
      }
      return;
    }

    if (segment.kind !== "active-raster") {
      return;
    }
    if (activePresentation.kind === "raster-stroke") {
      const pipeline = engine.mixedSceneActiveRasterStrokeDisplayPipeline;
      const sourceBindGroup = engine.rasterStrokeDisplayBindGroups.get(
        activePresentation.sourceMode,
      );
      if (!pipeline || !sourceBindGroup) {
        throw new Error("Pipeline del raster attivo con effetti non pronta.");
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, engine.rasterStrokeDisplayScreenBindGroup);
      pass.setBindGroup(1, sourceBindGroup);
    } else if (activePresentation.kind === "thickness-tail") {
      const pipeline = engine.mixedSceneActiveThicknessTailDisplayPipeline;
      if (!pipeline || !engine.thicknessTailDisplayBindGroup) {
        throw new Error("Pipeline del tail attivo non pronta.");
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, engine.thicknessTailDisplayBindGroup);
    } else if (activePresentation.kind === "light-glaze") {
      const pipeline = engine.mixedSceneActiveLightGlazeDisplayPipeline;
      if (!pipeline || !engine.lightGlazeDisplayBindGroup) {
        throw new Error("Pipeline Light Glaze del raster attivo non pronta.");
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, engine.lightGlazeDisplayBindGroup);
    } else {
      const pipeline = engine.mixedSceneActiveDisplayPipeline;
      if (!pipeline) {
        throw new Error("Pipeline base del raster attivo non pronta.");
      }
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, engine.displayBindGroup);
    }
    pass.draw(3, 1, 0, 0);
  };

  const setDirtyScissor = (pass: GPURenderPassEncoder): void => {
    pass.setScissorRect(
      presentationDirtyRect.x,
      presentationDirtyRect.y,
      presentationDirtyRect.width,
      presentationDirtyRect.height,
    );
  };
  let currentIsCanonical = true;
  let firstCanonicalPass = true;
  const beginScenePass = (): GPURenderPassEncoder => {
    const pass = encoder.beginRenderPass({
      label: `${label} · ${MIXED_SCENE_COMPOSITOR_STRATEGY}`,
      colorAttachments: [{
        view: currentIsCanonical
          ? linearView
          : engine.mixedSceneBlendScratchView!,
        loadOp: firstCanonicalPass && requiresFullRebuild ? "clear" : "load",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    setDirtyScissor(pass);
    if (firstCanonicalPass && !requiresFullRebuild) {
      pass.setPipeline(clearPipeline);
      pass.draw(3, 1, 0, 0);
    }
    firstCanonicalPass = false;
    return pass;
  };

  let scenePass: GPURenderPassEncoder | null = beginScenePass();
  for (const segment of engine.mixedSceneCompositionSegments) {
    const blendMode = engine.compositionSegmentBlendMode(segment);
    const clippingSuffixSteps = segment.kind === "active-raster"
      ? engine.activeClippingGroup?.suffixSteps ?? []
      : [];
    if (clippingSuffixSteps.length > 0) {
      scenePass?.end();
      scenePass = null;
      const scratchView = engine.mixedSceneBlendScratchView;
      const scratchTexture = engine.mixedSceneBlendScratchTexture;
      const operandView = engine.mixedSceneBlendOperandView;
      const operandTexture = engine.mixedSceneBlendOperandTexture;
      const groupView = engine.mixedSceneBlendGroupView;
      const groupTexture = engine.mixedSceneBlendGroupTexture;
      const blendPipeline = engine.layerBlendCompositorPipeline;
      const blendUniformStride = engine.layerBlendCompositorUniformStride;
      if (
        !scratchView
        || !scratchTexture
        || !operandView
        || !operandTexture
        || !groupView
        || !groupTexture
        || !blendPipeline
        || blendUniformStride <= 0
        || !engine.mixedSceneBlendFromGroupBindGroup
      ) {
        throw new Error("Ping-pong del gruppo di ritaglio avanzato non pronto.");
      }

      // Preserve the outer scene in its current target while constructing the
      // isolated clipping group in the otherwise-free peer plus one dedicated
      // group texture. The live active presenter supplies parent/prefix/active;
      // ordered suffix children are then folded source-atop one by one.
      const groupStartView = currentIsCanonical ? scratchView : linearView;
      const groupStartTexture = currentIsCanonical
        ? scratchTexture
        : engine.mixedSceneLinearTexture!;
      const groupStartPass = encoder.beginRenderPass({
        label: `${label} · base gruppo ritaglio live`,
        colorAttachments: [{
          view: groupStartView,
          loadOp: "load",
          storeOp: "store",
        }],
      });
      setDirtyScissor(groupStartPass);
      groupStartPass.setPipeline(clearPipeline);
      groupStartPass.draw(3, 1, 0, 0);
      drawSegmentSource(groupStartPass, segment);
      groupStartPass.end();

      let groupOnDedicatedTexture = false;
      for (const step of clippingSuffixSteps) {
        const operandPass = encoder.beginRenderPass({
          label: `${label} · sorgente clipping ${step.layerId} (${step.blendMode})`,
          colorAttachments: [{
            view: operandView,
            loadOp: "load",
            storeOp: "store",
          }],
        });
        setDirtyScissor(operandPass);
        operandPass.setPipeline(clearPipeline);
        operandPass.draw(3, 1, 0, 0);
        operandPass.setPipeline(rasterPipeline);
        operandPass.setBindGroup(0, step.viewportSegment.bindGroup);
        operandPass.draw(3, 1, 0, 0);
        operandPass.end();

        const groupBlendPass = encoder.beginRenderPass({
          label: `${label} · clipping atop ${step.blendMode}`,
          colorAttachments: [{
            view: groupOnDedicatedTexture ? groupStartView : groupView,
            loadOp: "load",
            storeOp: "store",
          }],
        });
        setDirtyScissor(groupBlendPass);
        groupBlendPass.setPipeline(blendPipeline);
        groupBlendPass.setBindGroup(
          0,
          groupOnDedicatedTexture
            ? engine.mixedSceneBlendFromGroupBindGroup
            : currentIsCanonical
              ? engine.mixedSceneBlendFromScratchBindGroup!
              : engine.mixedSceneBlendFromLinearBindGroup!,
          [
            (
              LAYER_BLEND_MODE_ORDER.length
              + LAYER_BLEND_MODE_CODES[step.blendMode]
            ) * blendUniformStride,
          ],
        );
        groupBlendPass.draw(3, 1, 0, 0);
        groupBlendPass.end();
        groupOnDedicatedTexture = !groupOnDedicatedTexture;
      }

      const completedGroupTexture = groupOnDedicatedTexture
        ? groupTexture
        : groupStartTexture;
      encoder.copyTextureToTexture(
        {
          texture: completedGroupTexture,
          origin: { x: presentationDirtyRect.x, y: presentationDirtyRect.y, z: 0 },
        },
        {
          texture: operandTexture,
          origin: { x: presentationDirtyRect.x, y: presentationDirtyRect.y, z: 0 },
        },
        {
          width: presentationDirtyRect.width,
          height: presentationDirtyRect.height,
          depthOrArrayLayers: 1,
        },
      );

      const outerBlendPass = encoder.beginRenderPass({
        label: `${label} · gruppo ritaglio esterno ${blendMode}`,
        colorAttachments: [{
          view: groupStartView,
          loadOp: "load",
          storeOp: "store",
        }],
      });
      setDirtyScissor(outerBlendPass);
      outerBlendPass.setPipeline(blendPipeline);
      outerBlendPass.setBindGroup(
        0,
        currentIsCanonical
          ? engine.mixedSceneBlendFromLinearBindGroup!
          : engine.mixedSceneBlendFromScratchBindGroup!,
        [LAYER_BLEND_MODE_CODES[blendMode] * blendUniformStride],
      );
      outerBlendPass.draw(3, 1, 0, 0);
      outerBlendPass.end();
      currentIsCanonical = !currentIsCanonical;
      continue;
    }
    if (blendMode === "normal") {
      scenePass ??= beginScenePass();
      drawSegmentSource(scenePass, segment);
      continue;
    }

    scenePass?.end();
    scenePass = null;
    const operandView = engine.mixedSceneBlendOperandView;
    const targetView = currentIsCanonical
      ? engine.mixedSceneBlendScratchView
      : linearView;
    const blendBindGroup = currentIsCanonical
      ? engine.mixedSceneBlendFromLinearBindGroup
      : engine.mixedSceneBlendFromScratchBindGroup;
    const blendPipeline = engine.layerBlendCompositorPipeline;
    if (
      !operandView
      || !targetView
      || !blendBindGroup
      || !blendPipeline
      || !engine.layerBlendCompositorUniformBuffer
      || engine.layerBlendCompositorUniformStride <= 0
    ) {
      throw new Error("Ping-pong WebGPU della fusione livello non pronto.");
    }

    const operandPass = encoder.beginRenderPass({
      label: `${label} · sorgente ${blendMode}`,
      colorAttachments: [{
        view: operandView,
        loadOp: "load",
        storeOp: "store",
      }],
    });
    setDirtyScissor(operandPass);
    operandPass.setPipeline(clearPipeline);
    operandPass.draw(3, 1, 0, 0);
    drawSegmentSource(operandPass, segment);
    operandPass.end();

    const blendPass = encoder.beginRenderPass({
      label: `${label} · fusione ${blendMode}`,
      colorAttachments: [{
        view: targetView,
        loadOp: "load",
        storeOp: "store",
      }],
    });
    setDirtyScissor(blendPass);
    blendPass.setPipeline(blendPipeline);
    blendPass.setBindGroup(
      0,
      blendBindGroup,
      [LAYER_BLEND_MODE_CODES[blendMode] * engine.layerBlendCompositorUniformStride],
    );
    blendPass.draw(3, 1, 0, 0);
    blendPass.end();
    currentIsCanonical = !currentIsCanonical;
  }
  scenePass?.end();

  if (!currentIsCanonical) {
    const scratchTexture = engine.mixedSceneBlendScratchTexture;
    const canonicalTexture = engine.mixedSceneLinearTexture;
    if (!scratchTexture || !canonicalTexture) {
      throw new Error("Copia finale del compositore fusione non pronta.");
    }
    encoder.copyTextureToTexture(
      {
        texture: scratchTexture,
        origin: { x: presentationDirtyRect.x, y: presentationDirtyRect.y, z: 0 },
      },
      {
        texture: canonicalTexture,
        origin: { x: presentationDirtyRect.x, y: presentationDirtyRect.y, z: 0 },
      },
      {
        width: presentationDirtyRect.width,
        height: presentationDirtyRect.height,
        depthOrArrayLayers: 1,
      },
    );
  }

  const presentPass = encoder.beginRenderPass({
    label: `${label} · checker finale`,
    colorAttachments: [
      {
        view: engine.presentationCacheView,
        loadOp: requiresFullRebuild ? "clear" : "load",
        storeOp: "store",
        clearValue: { r: 0.02, g: 0.02, b: 0.025, a: 1 },
      },
    ],
  });
  presentPass.setPipeline(presentPipeline);
  presentPass.setBindGroup(0, presentBindGroup);
  presentPass.setScissorRect(
    presentationDirtyRect.x,
    presentationDirtyRect.y,
    presentationDirtyRect.width,
    presentationDirtyRect.height,
  );
  presentPass.draw(3, 1, 0, 0);
  presentPass.end();
}


type MixedSceneBlendScratchCandidate = {
  texture: GPUTexture;
  view: GPUTextureView;
  operandTexture: GPUTexture;
  operandView: GPUTextureView;
  groupTexture: GPUTexture;
  groupView: GPUTextureView;
  fromLinear: GPUBindGroup;
  fromScratch: GPUBindGroup;
  fromGroup: GPUBindGroup;
};

function createMixedSceneBlendScratchCandidate(
  engine: BrushEngine,
  width: number,
  height: number,
  linearView: GPUTextureView,
): MixedSceneBlendScratchCandidate {
  const blendLayout = engine.layerBlendCompositorBindGroupLayout;
  const blendUniformBuffer = engine.layerBlendCompositorUniformBuffer;
  if (!blendLayout || !blendUniformBuffer) {
    throw new Error("Compositore GPU delle fusioni livello non inizializzato.");
  }
  let texture: GPUTexture | null = null;
  let operandTexture: GPUTexture | null = null;
  let groupTexture: GPUTexture | null = null;
  try {
    texture = engine.device.createTexture({
      label: `Ordered layer blend ping-pong ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: MIXED_SCENE_LINEAR_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC
        | GPUTextureUsage.COPY_DST,
    });
    operandTexture = engine.device.createTexture({
      label: `Ordered layer blend operand ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: MIXED_SCENE_LINEAR_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_DST,
    });
    groupTexture = engine.device.createTexture({
      label: `Ordered clipping-group blend ping-pong ${width}×${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: MIXED_SCENE_LINEAR_FORMAT,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT
        | GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_SRC,
    });
    const view = texture.createView({ label: "Ordered layer blend ping-pong view" });
    const operandView = operandTexture.createView({
      label: "Ordered layer blend operand view",
    });
    const groupView = groupTexture.createView({
      label: "Ordered clipping-group blend ping-pong view",
    });
    const blendEntries = (backdrop: GPUTextureView): GPUBindGroupEntry[] => [
      { binding: 0, resource: backdrop },
      { binding: 1, resource: operandView },
      {
        binding: 2,
        resource: {
          buffer: blendUniformBuffer,
          offset: 0,
          size: LAYER_BLEND_COMPOSITOR_UNIFORM_BYTE_SIZE,
        },
      },
    ];
    return {
      texture,
      view,
      operandTexture,
      operandView,
      groupTexture,
      groupView,
      fromLinear: engine.device.createBindGroup({
        label: "Layer blend canonical→ping-pong bind group",
        layout: blendLayout,
        entries: blendEntries(linearView),
      }),
      fromScratch: engine.device.createBindGroup({
        label: "Layer blend ping-pong→canonical bind group",
        layout: blendLayout,
        entries: blendEntries(view),
      }),
      fromGroup: engine.device.createBindGroup({
        label: "Clipping-group blend ping-pong bind group",
        layout: blendLayout,
        entries: blendEntries(groupView),
      }),
    };
  } catch (error) {
    texture?.destroy();
    operandTexture?.destroy();
    groupTexture?.destroy();
    throw error;
  }
}

function publishMixedSceneBlendScratchCandidate(
  engine: BrushEngine,
  candidate: MixedSceneBlendScratchCandidate | null,
): void {
  engine.mixedSceneBlendScratchTexture = candidate?.texture ?? null;
  engine.mixedSceneBlendScratchView = candidate?.view ?? null;
  engine.mixedSceneBlendOperandTexture = candidate?.operandTexture ?? null;
  engine.mixedSceneBlendOperandView = candidate?.operandView ?? null;
  engine.mixedSceneBlendGroupTexture = candidate?.groupTexture ?? null;
  engine.mixedSceneBlendGroupView = candidate?.groupView ?? null;
  engine.mixedSceneBlendFromLinearBindGroup = candidate?.fromLinear ?? null;
  engine.mixedSceneBlendFromScratchBindGroup = candidate?.fromScratch ?? null;
  engine.mixedSceneBlendFromGroupBindGroup = candidate?.fromGroup ?? null;
}

/**
 * Validates every viewport-sized resource needed by a candidate blend mode
 * before its metadata/history entry is published. Existing resources stay
 * authoritative until both WebGPU error scopes confirm the replacement.
 */
export async function prewarmMixedSceneLinearTextureForLayerBlend(
  engine: BrushEngine,
  width: number,
  height: number,
  needsAdvancedBlend: boolean,
): Promise<void> {
  const layout = engine.mixedScenePresentBindGroupLayout;
  if (!layout) {
    throw new Error("Layout di presentazione della scena mista non inizializzato.");
  }
  const sameLinearTexture = Boolean(
    engine.mixedSceneLinearTexture
      && engine.mixedSceneLinearView
      && engine.mixedSceneLinearWidth === width
      && engine.mixedSceneLinearHeight === height,
  );
  const scratchReady = Boolean(
    engine.mixedSceneBlendScratchTexture
      && engine.mixedSceneBlendScratchView
      && engine.mixedSceneBlendOperandTexture
      && engine.mixedSceneBlendOperandView
      && engine.mixedSceneBlendGroupTexture
      && engine.mixedSceneBlendGroupView
      && engine.mixedSceneBlendFromLinearBindGroup
      && engine.mixedSceneBlendFromScratchBindGroup
      && engine.mixedSceneBlendFromGroupBindGroup,
  );
  if (sameLinearTexture && (!needsAdvancedBlend || scratchReady)) {
    return;
  }

  const candidate = await runGpuAllocationTransaction(
    engine.device,
    `Prewarm fusione livello ${width}×${height}`,
    (transaction) => {
      if (sameLinearTexture) {
        const scratch = createMixedSceneBlendScratchCandidate(
          engine,
          width,
          height,
          engine.mixedSceneLinearView!,
        );
        transaction.deferRollback(() => {
          scratch.texture.destroy();
          scratch.operandTexture.destroy();
          scratch.groupTexture.destroy();
        });
        return { kind: "scratch" as const, scratch };
      }

      const texture = engine.device.createTexture({
        label: `Ordered mixed scene linear cache ${width}×${height}`,
        size: { width, height, depthOrArrayLayers: 1 },
        format: MIXED_SCENE_LINEAR_FORMAT,
        usage:
          GPUTextureUsage.RENDER_ATTACHMENT
          | GPUTextureUsage.TEXTURE_BINDING
          | GPUTextureUsage.COPY_DST
          | GPUTextureUsage.COPY_SRC,
      });
      transaction.deferRollback(() => texture.destroy());
      const view = texture.createView({ label: "Ordered mixed scene linear cache view" });
      const bindGroup = engine.device.createBindGroup({
        label: "Ordered mixed scene checker presentation bind group",
        layout,
        entries: [
          { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
          { binding: 1, resource: view },
        ],
      });
      const scratch = needsAdvancedBlend
        ? createMixedSceneBlendScratchCandidate(engine, width, height, view)
        : null;
      if (scratch) {
        transaction.deferRollback(() => {
          scratch.texture.destroy();
          scratch.operandTexture.destroy();
          scratch.groupTexture.destroy();
        });
      }

      return {
        kind: "linear" as const,
        texture,
        view,
        bindGroup,
        scratch,
      };
    },
  );

  const oldScratch = engine.mixedSceneBlendScratchTexture;
  const oldOperand = engine.mixedSceneBlendOperandTexture;
  const oldGroup = engine.mixedSceneBlendGroupTexture;
  if (candidate.kind === "scratch") {
    publishMixedSceneBlendScratchCandidate(engine, candidate.scratch);
    oldScratch?.destroy();
    oldOperand?.destroy();
    oldGroup?.destroy();
    engine.presentationCacheNeedsFullRebuild = true;
    return;
  }

  const oldTexture = engine.mixedSceneLinearTexture;
  engine.mixedSceneLinearTexture = candidate.texture;
  engine.mixedSceneLinearView = candidate.view;
  engine.mixedSceneLinearWidth = width;
  engine.mixedSceneLinearHeight = height;
  engine.mixedScenePresentBindGroup = candidate.bindGroup;
  publishMixedSceneBlendScratchCandidate(engine, candidate.scratch);
  oldTexture?.destroy();
  oldScratch?.destroy();
  oldOperand?.destroy();
  oldGroup?.destroy();
  engine.presentationCacheNeedsFullRebuild = true;
}

export function ensureMixedSceneLinearTexture(engine: BrushEngine, width: number, height: number): void {
  const releaseBlendScratch = () => {
    engine.mixedSceneBlendScratchTexture?.destroy();
    engine.mixedSceneBlendOperandTexture?.destroy();
    engine.mixedSceneBlendGroupTexture?.destroy();
    engine.mixedSceneBlendScratchTexture = null;
    engine.mixedSceneBlendScratchView = null;
    engine.mixedSceneBlendOperandTexture = null;
    engine.mixedSceneBlendOperandView = null;
    engine.mixedSceneBlendGroupTexture = null;
    engine.mixedSceneBlendGroupView = null;
    engine.mixedSceneBlendFromLinearBindGroup = null;
    engine.mixedSceneBlendFromScratchBindGroup = null;
    engine.mixedSceneBlendFromGroupBindGroup = null;
  };
  if (!engine.usesOrderedScenePresentation()) {
    engine.mixedSceneLinearTexture?.destroy();
    releaseBlendScratch();
    engine.mixedSceneLinearTexture = null;
    engine.mixedSceneLinearView = null;
    engine.mixedSceneLinearWidth = 0;
    engine.mixedSceneLinearHeight = 0;
    engine.mixedScenePresentBindGroup = null;
    return;
  }
  const needsAdvancedBlend = !engine.usesLayerBlendTilePresentation()
    && engine.layerStack.layers.some((record) => record.blendMode !== "normal");
  const blendScratchReady = !needsAdvancedBlend || Boolean(
    engine.mixedSceneBlendScratchTexture
      && engine.mixedSceneBlendScratchView
      && engine.mixedSceneBlendOperandTexture
      && engine.mixedSceneBlendOperandView
      && engine.mixedSceneBlendGroupTexture
      && engine.mixedSceneBlendGroupView
      && engine.mixedSceneBlendFromLinearBindGroup
      && engine.mixedSceneBlendFromScratchBindGroup
      && engine.mixedSceneBlendFromGroupBindGroup,
  );
  if (
    engine.mixedSceneLinearTexture
    && engine.mixedSceneLinearView
    && engine.mixedSceneLinearWidth === width
    && engine.mixedSceneLinearHeight === height
    && blendScratchReady
  ) {
    if (!needsAdvancedBlend) {
      releaseBlendScratch();
    }
    return;
  }
  const layout = engine.mixedScenePresentBindGroupLayout;
  if (!layout) {
    throw new Error("Layout di presentazione della scena mista non inizializzato.");
  }
  const oldTexture = engine.mixedSceneLinearTexture;
  const oldBlendScratch = engine.mixedSceneBlendScratchTexture;
  const oldBlendOperand = engine.mixedSceneBlendOperandTexture;
  const oldBlendGroup = engine.mixedSceneBlendGroupTexture;
  const texture = engine.device.createTexture({
    label: `Ordered mixed scene linear cache ${width}×${height}`,
    size: { width, height, depthOrArrayLayers: 1 },
    format: MIXED_SCENE_LINEAR_FORMAT,
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT
      | GPUTextureUsage.TEXTURE_BINDING
      | GPUTextureUsage.COPY_DST
      | GPUTextureUsage.COPY_SRC,
  });
  let blendScratch: GPUTexture | null = null;
  let blendOperand: GPUTexture | null = null;
  let blendGroup: GPUTexture | null = null;
  try {
    const view = texture.createView({ label: "Ordered mixed scene linear cache view" });
    const bindGroup = engine.device.createBindGroup({
      label: "Ordered mixed scene checker presentation bind group",
      layout,
      entries: [
        { binding: 0, resource: { buffer: engine.displayUniformBuffer } },
        { binding: 1, resource: view },
      ],
    });
    let blendScratchView: GPUTextureView | null = null;
    let blendOperandView: GPUTextureView | null = null;
    let blendGroupView: GPUTextureView | null = null;
    let fromLinear: GPUBindGroup | null = null;
    let fromScratch: GPUBindGroup | null = null;
    let fromGroup: GPUBindGroup | null = null;
    if (needsAdvancedBlend) {
      const scratch = createMixedSceneBlendScratchCandidate(engine, width, height, view);
      blendScratch = scratch.texture;
      blendScratchView = scratch.view;
      blendOperand = scratch.operandTexture;
      blendOperandView = scratch.operandView;
      blendGroup = scratch.groupTexture;
      blendGroupView = scratch.groupView;
      fromLinear = scratch.fromLinear;
      fromScratch = scratch.fromScratch;
      fromGroup = scratch.fromGroup;
    }
    engine.mixedSceneLinearTexture = texture;
    engine.mixedSceneLinearView = view;
    engine.mixedSceneLinearWidth = width;
    engine.mixedSceneLinearHeight = height;
    engine.mixedScenePresentBindGroup = bindGroup;
    engine.mixedSceneBlendScratchTexture = blendScratch;
    engine.mixedSceneBlendScratchView = blendScratchView;
    engine.mixedSceneBlendOperandTexture = blendOperand;
    engine.mixedSceneBlendOperandView = blendOperandView;
    engine.mixedSceneBlendGroupTexture = blendGroup;
    engine.mixedSceneBlendGroupView = blendGroupView;
    engine.mixedSceneBlendFromLinearBindGroup = fromLinear;
    engine.mixedSceneBlendFromScratchBindGroup = fromScratch;
    engine.mixedSceneBlendFromGroupBindGroup = fromGroup;
    engine.presentationCacheNeedsFullRebuild = true;
    oldTexture?.destroy();
    oldBlendScratch?.destroy();
    oldBlendOperand?.destroy();
    oldBlendGroup?.destroy();
  } catch (error) {
    texture.destroy();
    blendScratch?.destroy();
    blendOperand?.destroy();
    blendGroup?.destroy();
    throw error;
  }
}
