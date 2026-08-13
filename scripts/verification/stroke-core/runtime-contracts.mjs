import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "../../engine-source.mjs";

const rendererSource = readFileSync(new URL("../../../src/stroke-renderer.ts", import.meta.url), "utf8");
const engineSource = readEngineSource();
const workbenchSource = readFileSync(new URL("../../../src/effects-workbench.ts", import.meta.url), "utf8");
const effectsBenchmarkSource = readFileSync(new URL("../../../src/labs/benchmarks/effects-benchmark.ts", import.meta.url), "utf8");

assert.match(
  rendererSource,
  /style-stack-webgpu-v16-alpha-clipped-normal-color-overlay-before-inner-shadow-bevel-stroke-lazy-stroke-geometry-independent-outer-inner-shadows-three-surface-layer-composite-transient-bake-bbox-bevel-field-shared-effects-scratch-retargetable-layer-heightfield-v2-then-stroke-direct-lod0-coarse-mips-fwidth-display-nearest-raster-at-581pct/,
);
assert.match(rendererSource, /const PARAMETER_BYTES = 96/);
assert.ok(
  (rendererSource.match(/colorOverlay: vec4<f32>/g) ?? []).length === 3,
  "Ogni copia WGSL di StrokeParameters deve mantenere la stessa ABI da 96 B.",
);
assert.match(
  rendererSource,
  /mix\(base\.rgb, parameters\.colorOverlay\.rgb \* base\.a, opacity\)/,
);
assert.match(
  rendererSource,
  /if \(opacity <= 0\.0\) \{\s*return base;/,
  "Color Overlay disattivata deve saltare il lavoro RGB per-pixel.",
);
assert.match(
  rendererSource,
  /let base = colorOverlayNode\(sourceTexel\(position\)\)/,
);
assert.ok(
  rendererSource.indexOf("let base = colorOverlayNode(sourceTexel(position))")
    < rendererSource.indexOf("let shadowedBase = innerShadowNode(base, position)"),
  "Color Overlay deve precedere Ombra interna, Smusso e Traccia.",
);
assert.match(rendererSource, /colorOverlayStyle\?: RasterColorOverlayStyle/);
assert.match(rendererSource, /this\.displayParameterUploadF32\[23\] = colorOverlayStyle\.enabled/);
assert.match(rendererSource, /this\.parameterUploadF32\[word \+ 23\] = colorOverlayStyle\.enabled/);
assert.ok(
  rendererSource.indexOf("bevelNode(base, position)")
    < rendererSource.indexOf("combinedStrokeNode(base.a, node, coverage)"),
  "The style stack must compose bevel before stroke.",
);
assert.match(rendererSource, /style\.enabled && style\.width > 0 \? 1 : 0/);
assert.match(rendererSource, /let dt = 0\.5 \* fwidth\(t\)/);
assert.match(rendererSource, /persistent alpha-threshold bit mask/);
assert.match(rendererSource, /persistent packed f16 coverage/);
assert.match(rendererSource, /const COVERAGE_WORD_PIXELS = 2/);
assert.match(rendererSource, /return clamp\(coverage, 0\.0, 1\.0\);/);
assert.match(
  rendererSource,
  /const coverageWordsPerRow = Math\.ceil\(documentWidth \/ COVERAGE_WORD_PIXELS\);[\s\S]*?let wordIndex = firstDocumentPosition\.y \* \$\{coverageWordsPerRow\}u\s*\+ \(firstDocumentPosition\.x >> 1u\);\s*coverageField\[wordIndex\] = pack2x16float\(coveragePair\)/,
  "packed Stroke coverage must use a per-row word stride for rectangular documents",
);
const packedCoverageWordIndex = (width, x, y) => y * Math.ceil(width / 2) + (x >> 1);
assert.equal(packedCoverageWordIndex(5, 0, 1), 3);
assert.equal(packedCoverageWordIndex(5, 4, 1), 5);
assert.match(
  rendererSource,
  /unpack2x16float\(coverageField\[linearIndex >> 1u\]\)/,
);
assert.doesNotMatch(rendererSource, /resolveCoverageByte/);
assert.doesNotMatch(rendererSource, /0\.75 \/ 255\.0/);
assert.match(rendererSource, /direct-lod0-plus-derived-mips-1-through-12/);
assert.match(rendererSource, /fn directStyledSample/);
assert.match(rendererSource, /fn storedLightCoverage/);
assert.match(
  rendererSource,
  /fn storedLightCoverage\(value: f32\) -> f32 \{\s*return clamp\(value, 0\.0, 1\.0\);\s*\}/,
);
assert.match(rendererSource, /Traccia styled derived mip 1\+/);
assert.match(engineSource, /rasterStrokeDisplayPipeline/);
assert.match(engineSource, /presentationCacheLod0FullRebuildTraceEnabledCpuEncodingMs/);
assert.match(engineSource, /presentationCacheLod0FullRebuildTraceDisabledCpuEncodingMs/);
assert.match(rendererSource, /threshold changes or existing coverage overlap/);
assert.doesNotMatch(rendererSource, /distanceBuffer/);
assert.match(rendererSource, /array<atomic<u32>>/);
assert.ok(
  rendererSource.match(/dispatchWorkgroupsIndirect/g)?.length >= 3,
  "The threshold gate must cover seed/JFA, resolve and conditional compose.",
);
assert.match(engineSource, /changeDetectionRect = mutationRect;/);
assert.match(
  engineSource,
  /composeRect = mergeDirtyRects\(composeRect, mutationRect\);/,
);
assert.match(engineSource, /conditionalComposeRect = rebuildRect;/);
assert.match(rendererSource, /allocate-on-stroke-enable-release-when-idle-disabled/);
assert.match(rendererSource, /strokeGeometryEnabled\?: boolean/);
assert.match(rendererSource, /options\.strokeGeometryEnabled !== false/);
assert.match(rendererSource, /private async allocateStrokeGeometryResources\(\): Promise<boolean>/);
assert.match(rendererSource, /runGpuAllocationTransaction\(/);
assert.match(rendererSource, /private releaseStrokeGeometryResources\(\): boolean/);
assert.match(rendererSource, /async setStrokeGeometryEnabled\(enabled: boolean\): Promise<boolean>/);
assert.match(rendererSource, /return this\.strokeCoverageBuffer \?\? this\.coveragePlaceholderBuffer/);
assert.match(rendererSource, /return this\.strokeThresholdMaskBuffer \?\? this\.thresholdMaskPlaceholderBuffer/);
assert.match(
  rendererSource,
  /this\.strokeGeometryResourcesAllocated \? this\.fullCoverageMemoryBytes : 0/,
);
assert.match(
  rendererSource,
  /this\.strokeGeometryResourcesAllocated \? this\.fullThresholdMaskMemoryBytes : 0/,
);
assert.match(rendererSource, /this\.rebuildIndirectGateBindGroup\(\)/);
assert.match(rendererSource, /Encode Traccia rifiutato: le risorse geometriche non sono allocate/);
assert.match(engineSource, /strokeGeometryEnabled: strokeGeometryActive/);
const geometrySwapHelperStart = engineSource.indexOf(
  "export async function setRasterStrokeGeometryEnabled(",
);
assert.notEqual(
  geometrySwapHelperStart,
  -1,
  "Il lifecycle geometria Traccia deve passare dall'helper che aggiorna anche il display.",
);
const geometrySwapHelperBody = engineSource.slice(
  geometrySwapHelperStart,
  geometrySwapHelperStart + 1_200,
);
assert.match(
  geometrySwapHelperBody,
  /await renderer\.setStrokeGeometryEnabled\(enabled\)/,
);
assert.match(
  geometrySwapHelperBody,
  /engine\.rebuildRasterStrokeDisplayBindGroups\(\)/,
  "Lo swap real buffer/placeholder deve ricostruire i bind group display esterni.",
);
assert.ok(
  geometrySwapHelperBody.indexOf("await renderer.setStrokeGeometryEnabled(enabled)")
    < geometrySwapHelperBody.indexOf("engine.rebuildRasterStrokeDisplayBindGroups()"),
  "I bind group display vanno ricostruiti dopo che il renderer ha pubblicato il nuovo buffer.",
);
assert.equal(
  engineSource.match(/\.setStrokeGeometryEnabled\(/g)?.length,
  1,
  "Nessun call site deve bypassare l'helper engine del lifecycle geometria Traccia.",
);
assert.match(engineSource, /await setRasterStrokeGeometryEnabled\(engine, false\)/);
assert.match(engineSource, /rasterStrokeGeometryResident/);
assert.match(rendererSource, /parameters\.scratchExtent/);
assert.match(rendererSource, /resizeScratch\(requestedExtent: number\)/);
assert.match(rendererSource, /readbackEnabled\?: boolean/);
assert.match(rendererSource, /async readStyledPixels\(/);
assert.match(rendererSource, /encodeBake\(options: RasterStrokeBakeOptions\)/);
assert.match(rendererSource, /Style stack layer bake analytic mip 0/);
assert.match(
  rendererSource,
  /const readbackComposeModule = this\.device\.createShaderModule\(/,
  "il compositore analitico mip 0 deve esistere anche fuori dal golden",
);
assert.doesNotMatch(
  rendererSource,
  /const readbackComposeModule = this\.readbackEnabled/,
  "readbackEnabled può controllare la texture golden, non la pipeline bake runtime",
);
assert.match(rendererSource, /retarget\(\s*layerView: GPUTextureView,/);
assert.ok(
  (rendererSource.match(/this\.rebuildSourceBindGroups\([012]\)/g) ?? []).length >= 3,
  "Retarget Traccia deve ricostruire i bind group di tutte le source mode.",
);
assert.match(workbenchSource, /single-retargetable-active-layer-source/);
assert.match(workbenchSource, /this\._bevelRenderer\?\.retarget\(source\.view\)/);
assert.match(workbenchSource, /this\._strokeRenderer\?\.retarget\(source\.view, source\.format\)/);
assert.match(engineSource, /async retargetEffectsWorkingSet\(/);
assert.match(engineSource, /this\.rebuildRasterStrokeDisplayBindGroups\(\)/);
assert.match(engineSource, /rebuildDomain: LayerEffectsRebuildDomain = "full-document"/);
assert.match(
  engineSource,
  /styleStackRetargetBounds = rebuildDomain === "content-bounds"\s*\? boundedContentRect\s*: fullDocumentRect/,
  "il retarget attivo/pubblico deve conservare il default documento completo",
);
assert.match(engineSource, /styleStackRetargetBounds,\s*styleStackRetargetBounds,\s*true/);
assert.match(effectsBenchmarkSource, /destroy-recreate/);
assert.match(effectsBenchmarkSource, /onSubmittedWorkDone\(\)/);
assert.match(effectsBenchmarkSource, /4096|documentWidth/);
assert.match(rendererSource, /async readChangeStateFlags\(/);
assert.match(rendererSource, /updateDisplayParameters\(/);
assert.match(rendererSource, /displayParameterBuffers: Record<SourceModeCode, GPUBuffer>/);
assert.match(rendererSource, /GPUTextureUsage\.COPY_SRC/);
