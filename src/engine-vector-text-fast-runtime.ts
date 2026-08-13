import type {
  BrushEngine,
} from "./brush-engine";
import {
  VECTOR_TEXT_GPU_UNIFORM_STRIDE,
} from "./vector-text-gpu-shader";
import {
  VECTOR_TEXT_GPU_MAXIMUM_DRAWS,
} from "./engine-limits";
import {
  vectorTextGpuDrawUsesBlur,
  vectorTextGpuDrawUsesMesh,
  type VectorTextGpuBlurCacheResources,
  type VectorTextGpuDrawResources,
} from "./engine-vector-text-resources";
import {
  type VectorTextGpuBlurSourceDraw,
} from "./vector-text-types";
import {
  vectorTextGpuClearBounds,
} from "./engine-geometry";

import {
  ensureVectorTextGpuBlurScratch,
  ensureVectorTextGpuScratch,
  writeVectorTextGpuBlurFilterUniform,
  writeVectorTextGpuBlurSourceUniform,
  writeVectorTextGpuDrawUniform,
} from "./engine-vector-text-resources-runtime";

export function flushVectorTextGpuPresentations(engine: BrushEngine): void {
  if (engine.vectorTextGpuPendingRuns.length === 0) {
    return;
  }
  let scratchWidth = 1;
  let scratchHeight = 1;
  let blurScratchWidth = 0;
  let blurScratchHeight = 0;
  for (const run of engine.vectorTextGpuPendingRuns) {
    scratchWidth = Math.max(scratchWidth, run.bounds.width);
    scratchHeight = Math.max(scratchHeight, run.bounds.height);
    for (let index = 0; index < run.draws.length; index += 1) {
      const draw = run.draws[index];
      const cache = run.blurResources[index];
      if (vectorTextGpuDrawUsesBlur(draw) && cache?.needsBuild) {
        blurScratchWidth = Math.max(blurScratchWidth, draw.blurWidth);
        blurScratchHeight = Math.max(blurScratchHeight, draw.blurHeight);
      }
    }
  }
  ensureVectorTextGpuScratch(engine, scratchWidth, scratchHeight);
  if (blurScratchWidth > 0 && blurScratchHeight > 0) {
    ensureVectorTextGpuBlurScratch(engine, blurScratchWidth, blurScratchHeight);
  }

  const uniformBuffer = engine.vectorTextGpuUniformBuffer;
  const uniformBindGroup = engine.vectorTextGpuUniformBindGroup;
  const filterUniformBuffer = engine.vectorTextGpuBlurFilterUniformBuffer;
  const msaaView = engine.vectorTextGpuMsaaView;
  const resolvedTexture = engine.vectorTextGpuResolvedTexture;
  const resolvedView = engine.vectorTextGpuResolvedView;
  const fillPipeline = engine.vectorTextGpuFillPipeline;
  const slugPipeline = engine.vectorTextGpuSlugPipeline;
  const blurMaskPipeline = engine.vectorTextGpuBlurMaskPipeline;
  const meshBlurMaskPipeline = engine.vectorTextGpuMeshBlurMaskPipeline;
  const blurHorizontalPipeline = engine.vectorTextGpuBlurHorizontalPipeline;
  const blurVerticalPipeline = engine.vectorTextGpuBlurVerticalPipeline;
  const blurCompositePipeline = engine.vectorTextGpuBlurCompositePipeline;
  const innerShadowDirectPipeline = engine.vectorTextGpuInnerShadowDirectPipeline;
  const innerShadowBlurPipeline = engine.vectorTextGpuInnerShadowBlurPipeline;
  const meshInnerShadowBlurPipeline = engine.vectorTextGpuMeshInnerShadowBlurPipeline;
  const clearPipeline = engine.vectorTextGpuClearPipeline;
  if (
    !uniformBuffer
    || !uniformBindGroup
    || !filterUniformBuffer
    || !msaaView
    || !resolvedTexture
    || !resolvedView
    || !fillPipeline
    || !slugPipeline
    || !blurMaskPipeline
    || !meshBlurMaskPipeline
    || !blurHorizontalPipeline
    || !blurVerticalPipeline
    || !blurCompositePipeline
    || !innerShadowDirectPipeline
    || !innerShadowBlurPipeline
    || !meshInnerShadowBlurPipeline
    || !clearPipeline
  ) {
    throw new Error("Pipeline batch del testo vettoriale GPU non pronta.");
  }

  const totalMainDraws = engine.vectorTextGpuPendingRuns.reduce(
    (total, run) => total + run.draws.length,
    0,
  );
  if (totalMainDraws > VECTOR_TEXT_GPU_MAXIMUM_DRAWS) {
    throw new Error(
      `Batch testo GPU oltre ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS} draw call.`,
    );
  }
  let mainDrawIndex = 0;
  for (const run of engine.vectorTextGpuPendingRuns) {
    for (const draw of run.draws) {
      writeVectorTextGpuDrawUniform(engine,
        draw,
        run.view,
        mainDrawIndex,
        run.bounds,
      );
      mainDrawIndex += 1;
    }
  }

  const blurBuilds: {
    draw: VectorTextGpuBlurSourceDraw;
    resources: VectorTextGpuDrawResources;
    cache: VectorTextGpuBlurCacheResources;
    sourceUniformIndex: number;
    filterIndex: number;
  }[] = [];
  const queuedCaches = new Set<VectorTextGpuBlurCacheResources>();
  let nextSourceUniformIndex = totalMainDraws;
  for (const run of engine.vectorTextGpuPendingRuns) {
    for (let index = 0; index < run.draws.length; index += 1) {
      const draw = run.draws[index];
      const drawResources = run.drawResources[index];
      const cache = run.blurResources[index];
      if (
        !vectorTextGpuDrawUsesBlur(draw)
        || !cache?.needsBuild
        || queuedCaches.has(cache)
      ) {
        continue;
      }
      if (drawResources.kind !== (vectorTextGpuDrawUsesMesh(draw) ? "mesh" : "slug")) {
        throw new Error("Risorsa vettoriale incoerente con la mask blur GPU.");
      }
      if (nextSourceUniformIndex >= VECTOR_TEXT_GPU_MAXIMUM_DRAWS) {
        throw new Error(
          `Uniform testo GPU oltre ${VECTOR_TEXT_GPU_MAXIMUM_DRAWS} slot.`,
        );
      }
      const filterIndex = blurBuilds.length;
      writeVectorTextGpuBlurSourceUniform(engine,
        draw,
        nextSourceUniformIndex,
      );
      writeVectorTextGpuBlurFilterUniform(engine, draw, filterIndex);
      blurBuilds.push({
        draw,
        resources: drawResources,
        cache,
        sourceUniformIndex: nextSourceUniformIndex,
        filterIndex,
      });
      queuedCaches.add(cache);
      nextSourceUniformIndex += 1;
    }
  }

  if (nextSourceUniformIndex > 0) {
    engine.device.queue.writeBuffer(
      uniformBuffer,
      0,
      engine.vectorTextGpuUniformUpload,
      0,
      nextSourceUniformIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4,
    );
  }
  if (blurBuilds.length > 0) {
    engine.device.queue.writeBuffer(
      filterUniformBuffer,
      0,
      engine.vectorTextGpuBlurFilterUniformUpload,
      0,
      blurBuilds.length * VECTOR_TEXT_GPU_UNIFORM_STRIDE / 4,
    );
  }

  const encoder = engine.device.createCommandEncoder({
    label: `Vector text GPU batched exact redraw · ${engine.vectorTextGpuPendingRuns.length} runs`,
  });

  if (blurBuilds.length > 0) {
    const scratchATexture = engine.vectorTextGpuBlurScratchATexture;
    const scratchAView = engine.vectorTextGpuBlurScratchAView;
    const scratchBView = engine.vectorTextGpuBlurScratchBView;
    const filterAToB = engine.vectorTextGpuBlurFilterBindGroupAToB;
    const filterBToA = engine.vectorTextGpuBlurFilterBindGroupBToA;
    if (
      !scratchATexture
      || !scratchAView
      || !scratchBView
      || !filterAToB
      || !filterBToA
    ) {
      throw new Error("Scratch GPU del blur testo non pronto.");
    }
    for (const build of blurBuilds) {
      const width = build.draw.blurWidth;
      const height = build.draw.blurHeight;
      const sourcePass = encoder.beginRenderPass({
        label: `Vector text GPU blur analytic mask ${build.draw.blurKey}`,
        colorAttachments: [{
          view: scratchAView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      sourcePass.setViewport(0, 0, width, height, 0, 1);
      sourcePass.setScissorRect(0, 0, width, height);
      const sourceDynamicOffset =
        build.sourceUniformIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE;
      if (vectorTextGpuDrawUsesMesh(build.draw)) {
        if (build.resources.kind !== "mesh") {
          throw new Error("Mesh SVG incoerente con la mask blur GPU.");
        }
        sourcePass.setPipeline(meshBlurMaskPipeline);
        sourcePass.setBindGroup(0, uniformBindGroup, [sourceDynamicOffset]);
        sourcePass.setVertexBuffer(0, build.resources.vertexBuffer);
        sourcePass.setIndexBuffer(build.resources.indexBuffer, "uint32");
        sourcePass.drawIndexed(build.resources.indexCount, 1, 0, 0, 0);
      } else {
        if (build.resources.kind !== "slug") {
          throw new Error("Slug incoerente con la mask blur GPU.");
        }
        sourcePass.setPipeline(blurMaskPipeline);
        sourcePass.setBindGroup(0, build.resources.bindGroup, [sourceDynamicOffset]);
        sourcePass.draw(6, 1, 0, 0);
      }
      sourcePass.end();

      const filterOffset = build.filterIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE;
      const horizontalPass = encoder.beginRenderPass({
        label: `Vector text GPU blur horizontal ${build.draw.blurKey}`,
        colorAttachments: [{
          view: scratchBView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      horizontalPass.setViewport(0, 0, width, height, 0, 1);
      horizontalPass.setScissorRect(0, 0, width, height);
      horizontalPass.setPipeline(blurHorizontalPipeline);
      horizontalPass.setBindGroup(0, filterAToB, [filterOffset]);
      horizontalPass.draw(3, 1, 0, 0);
      horizontalPass.end();

      const verticalPass = encoder.beginRenderPass({
        label: `Vector text GPU blur vertical ${build.draw.blurKey}`,
        colorAttachments: [{
          view: scratchAView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      verticalPass.setViewport(0, 0, width, height, 0, 1);
      verticalPass.setScissorRect(0, 0, width, height);
      verticalPass.setPipeline(blurVerticalPipeline);
      verticalPass.setBindGroup(0, filterBToA, [filterOffset]);
      verticalPass.draw(3, 1, 0, 0);
      verticalPass.end();

      encoder.copyTextureToTexture(
        { texture: scratchATexture },
        { texture: build.cache.texture },
        { width, height, depthOrArrayLayers: 1 },
      );
      build.cache.needsBuild = false;
    }
  }

  let drawOffset = 0;
  for (const run of engine.vectorTextGpuPendingRuns) {
    const pass = encoder.beginRenderPass({
      label: `Vector text GPU exact camera redraw ${run.placement}`,
      colorAttachments: [
        {
          view: msaaView,
          resolveTarget: resolvedView,
          loadOp: "clear",
          storeOp: "discard",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });

    for (let index = 0; index < run.draws.length; index += 1) {
      const draw = run.draws[index];
      const resourcesForDraw = run.drawResources[index];
      const blurResources = run.blurResources[index];
      const uniformIndex = drawOffset + index;
      if (draw.opacity <= 0) {
        continue;
      }
      const dynamicOffset = uniformIndex * VECTOR_TEXT_GPU_UNIFORM_STRIDE;
      if (draw.mode === "slug-blur" || draw.mode === "mesh-blur") {
        if (!blurResources) {
          throw new Error("Cache GPU del blur vettoriale mancante.");
        }
        pass.setPipeline(blurCompositePipeline);
        pass.setBindGroup(0, blurResources.compositeBindGroup, [dynamicOffset]);
        pass.draw(6, 1, 0, 0);
      } else if (draw.mode === "slug-inner-shadow-direct") {
        if (resourcesForDraw.kind !== "slug") {
          throw new Error("Risorsa Slug incoerente con l’ombra interna GPU.");
        }
        if (resourcesForDraw.curveCount === 0) {
          continue;
        }
        pass.setPipeline(innerShadowDirectPipeline);
        pass.setBindGroup(0, resourcesForDraw.bindGroup, [dynamicOffset]);
        pass.draw(6, 1, 0, 0);
      } else if (draw.mode === "slug-inner-shadow-blur") {
        if (!blurResources) {
          throw new Error("Cache GPU dell’ombra interna sfocata mancante.");
        }
        if (resourcesForDraw.kind !== "slug") {
          throw new Error("Risorsa Slug incoerente con l’ombra interna sfocata.");
        }
        if (resourcesForDraw.curveCount === 0) {
          continue;
        }
        pass.setPipeline(innerShadowBlurPipeline);
        pass.setBindGroup(0, resourcesForDraw.bindGroup, [dynamicOffset]);
        pass.setBindGroup(1, blurResources.innerShadowBindGroup);
        pass.draw(6, 1, 0, 0);
      } else if (draw.mode === "mesh-inner-shadow-blur") {
        if (!blurResources) {
          throw new Error("Cache GPU dell’ombra interna SVG mancante.");
        }
        if (resourcesForDraw.kind !== "mesh") {
          throw new Error("Risorsa mesh incoerente con l’ombra interna SVG.");
        }
        if (resourcesForDraw.indexCount === 0) {
          continue;
        }
        pass.setPipeline(meshInnerShadowBlurPipeline);
        pass.setBindGroup(0, uniformBindGroup, [dynamicOffset]);
        pass.setBindGroup(1, blurResources.innerShadowBindGroup);
        pass.setVertexBuffer(0, resourcesForDraw.vertexBuffer);
        pass.setIndexBuffer(resourcesForDraw.indexBuffer, "uint32");
        pass.drawIndexed(resourcesForDraw.indexCount, 1, 0, 0, 0);
      } else if (draw.mode === "mesh-direct") {
        if (resourcesForDraw.kind !== "mesh") {
          throw new Error("Risorsa mesh vettoriale incoerente con la draw call.");
        }
        if (resourcesForDraw.indexCount === 0) {
          continue;
        }
        pass.setPipeline(fillPipeline);
        pass.setBindGroup(0, uniformBindGroup, [dynamicOffset]);
        pass.setVertexBuffer(0, resourcesForDraw.vertexBuffer);
        pass.setIndexBuffer(resourcesForDraw.indexBuffer, "uint32");
        pass.drawIndexed(resourcesForDraw.indexCount, 1, 0, 0, 0);
      } else {
        if (resourcesForDraw.kind !== "slug") {
          throw new Error("Risorsa Slug testo incoerente con la draw call.");
        }
        if (resourcesForDraw.curveCount === 0) {
          continue;
        }
        pass.setPipeline(slugPipeline);
        pass.setBindGroup(0, resourcesForDraw.bindGroup, [dynamicOffset]);
        pass.draw(6, 1, 0, 0);
      }
    }
    pass.end();

    const isPrimary = run.target === "primary";
    const wasInitialized = isPrimary && run.resources.initialized;
    const clearBounds = isPrimary
      ? vectorTextGpuClearBounds(run.resources.lastBounds, run.bounds)
      : run.bounds;
    const clearPass = encoder.beginRenderPass({
      label: `Vector text GPU clear ${run.target} crop ${run.placement}`,
      colorAttachments: [
        {
          view: run.targetView,
          loadOp: wasInitialized ? "load" : "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
    });
    if (wasInitialized) {
      clearPass.setPipeline(clearPipeline);
      clearPass.setScissorRect(
        clearBounds.x,
        clearBounds.y,
        clearBounds.width,
        clearBounds.height,
      );
      clearPass.draw(3, 1, 0, 0);
    }
    clearPass.end();
    encoder.copyTextureToTexture(
      {
        texture: resolvedTexture,
        origin: { x: 0, y: 0, z: 0 },
      },
      {
        texture: run.targetTexture,
        origin: { x: run.bounds.x, y: run.bounds.y, z: 0 },
      },
      {
        width: run.bounds.width,
        height: run.bounds.height,
        depthOrArrayLayers: 1,
      },
    );
    if (isPrimary) {
      run.resources.lastBounds = run.bounds;
      run.resources.initialized = true;
    }
    drawOffset += run.draws.length;
  }
  engine.vectorTextGpuPendingRuns.length = 0;
  engine.device.queue.submit([encoder.finish()]);
  engine.displayDirty = true;
  engine.presentationCacheNeedsFullRebuild = true;
  engine.requestRender();
}
