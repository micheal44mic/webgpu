import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "../../engine-source.mjs";
import { readRepositorySource } from "../source-contract.mjs";

const engineSource = readEngineSource();
const rasterStyleRuntimeSource = readRepositorySource(
  "src/engine-raster-style-runtime.ts",
);

// Le allocazioni delle risorse di livello vivono in `engine-layer-runtime`:
// la sezione parte dalla definizione, non dalla prima chiamata.
// `allocateLayerTexture` è rimasta un membro del motore, la piramide e le
// superfici fuse sono in `engine-layer-runtime`: la sezione le copre entrambe.
const allocationStart = engineSource.indexOf("  allocateLayerTexture(format: LayerFormat)");
assert.ok(allocationStart >= 0, "allocateLayerTexture non trovata");
const pyramidStart = engineSource.indexOf("export function allocateActiveLayerDisplayPyramid(");
assert.ok(pyramidStart >= 0, "allocateActiveLayerDisplayPyramid non trovata");
const mergedSurfaceStart = engineSource.indexOf("export function allocateMergedSurface(");
assert.ok(mergedSurfaceStart >= 0, "allocateMergedSurface non trovata");
const allocationBody = engineSource.slice(allocationStart, allocationStart + 1_500)
  + engineSource.slice(pyramidStart, pyramidStart + 2_000)
  + engineSource.slice(mergedSurfaceStart, mergedSurfaceStart + 4_000);
assert.match(allocationBody, /mipLevelCount: 1/,
  "ogni layer inattivo deve possedere soltanto il mip 0 autorevole");
// `allocateActiveLayerDisplayPyramid(` e `allocateMergedSurface(` non vanno
// asseriti qui: la finestra è costruita partendo da quelle stesse stringhe,
// quindi l'asserzione sarebbe vera per costruzione. Restano i vincoli sul
// contenuto, che sono l'unica cosa che può regredire.
assert.match(allocationBody, /mipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT - 1/);
assert.match(allocationBody, /const fullMipLevelCount = mergedSurfaceMipLevelCount\(physicalBounds\)/);
assert.match(allocationBody, /const mipLevelCount = maintainMipChain \? fullMipLevelCount : 1/,
  "gli operandi live-only devono poter evitare la piramide che non campionano");
assert.match(allocationBody, /const textureWidth = normalizedBounds\.width \* resolutionScale/);
assert.match(allocationBody, /const textureHeight = normalizedBounds\.height \* resolutionScale/);
assert.match(allocationBody, /mip0MemoryBytes: memory\.mip0Bytes/);
assert.match(allocationBody, /mipChainMemoryBytes: maintainMipChain \? memory\.mipChainBytes : 0/);
assert.match(allocationBody, /GPUTextureUsage\.COPY_DST/,
  "la superficie fusa deve accettare il percorso veloce byte-esatto");
assert.match(
  engineSource,
  /export async function allocateLayerGpuResources\([\s\S]*?runGpuAllocationTransaction\(engine\.device, label/,
  "l'allocazione completa del mip 0 deve chiudere validation e OOM scope prima del commit",
);
assert.equal(
  (engineSource.match(
    /label: `\$\{DOCUMENT_WIDTH\}×\$\{DOCUMENT_HEIGHT\} authoritative paint layer \$\{format\}`/g,
  ) ?? []).length,
  1,
  "la creazione della texture autorevole deve esistere in un solo punto",
);

// Every display path receives below/active/above before checkerboard and sRGB.
assert.match(engineSource, /this\.displayUniformUpload\[9\] = this\.mergedBelow\?\.resolutionScale \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[10\] = this\.mergedAbove\?\.resolutionScale \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[11\] = this\.layerStack\.active\.visible/);
assert.match(engineSource, /this\.displayUniformUpload\[12\] = this\.mergedBelow\?\.bounds\.x \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[15\] = this\.mergedAbove\?\.bounds\.y \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[16\] = clippingGroup\?\.mode === "active-parent"/);
assert.match(engineSource, /this\.displayUniformUpload\[17\] = clippingGroup\?\.parentOpacity \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[18\] = clippingGroup\?\.prefix\?\.resolutionScale \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[19\] = clippingGroup\?\.suffix\?\.resolutionScale \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[23\] = clippingGroup\?\.suffix\?\.bounds\.y \?\? 0/);
const shaderSource = readFileSync(new URL("../../../src/shaders.ts", import.meta.url), "utf8");
const mergedSurfaceShaderSource = readFileSync(
  new URL("../../../src/merged-surface-shader.ts", import.meta.url),
  "utf8",
);
assert.match(shaderSource, /fn composeLayerStackSamples\(/);
assert.match(shaderSource, /return composeActiveClippingGroupTexel\(activeTexel, pixel\)/,
  "il mip 0 deve comporre il gruppo live direttamente dal texel autorevole");
assert.match(shaderSource, /let activeContribution = select\([\s\S]*?display\.clippingMode < 0\.5/,
  "il compositore stack non deve applicare due volte l'opacità al gruppo isolato");
assert.match(mergedSurfaceShaderSource, /sampleMergedAbove\(layerPosition/);
assert.match(mergedSurfaceShaderSource, /layerPosition - display\.mergedAboveOrigin/);
assert.equal(
  (shaderSource.match(/fn composeLayerStackSamples\(/g) ?? []).length,
  1,
  "il display base deve avere un solo compositore per i campioni raster",
);
assert.equal(
  (shaderSource.match(/fn composeLayerStack\(\s*activePaint: vec4<f32>,\s*layerPosition: vec2<f32>,\s*fragmentPosition: vec2<f32>/g) ?? []).length,
  2,
  "coda e Light Glaze devono accettare le coordinate viewport del testo",
);
assert.match(shaderSource, /composeLayerStackSamples\(activePaint, belowPaint, abovePaint\)/);
assert.equal(
  (shaderSource.match(/paint = composeLayerStack\(paint, layerPosition, fragmentPosition\.xy\);/g) ?? []).length,
  2,
  "coda e Light Glaze devono comporre merged e testo in coordinate documento\/viewport",
);
const strokeRendererSource = readFileSync(
  new URL("../../../src/stroke-renderer.ts", import.meta.url),
  "utf8",
);
assert.match(strokeRendererSource, /paint = composeLayerStack\(paint, layerPosition, fragmentPosition\.xy\);/);
assert.match(strokeRendererSource, /@group\(1\) @binding\(15\) var mergedBelowTexture/);
assert.match(strokeRendererSource, /@group\(1\) @binding\(16\) var mergedAboveTexture/);
assert.ok(
  shaderSource.indexOf("paint = composeLayerStack(paint, layerPosition, fragmentPosition.xy);")
    < shaderSource.indexOf(
      "let checkerCell",
      shaderSource.indexOf("paint = composeLayerStack(paint, layerPosition, fragmentPosition.xy);"),
    ),
  "la coda spessore deve comporre layer e testo prima della scacchiera e della conversione sRGB",
);
// All five effect styles must live on the layer record, not on the engine, or a
// switch would show the outgoing layer's effects on the incoming one.
// Accessors keep existing call sites working while making the styles
// follow the active layer by construction rather than by remembering to copy.
assert.match(engineSource, /readonly layerStack = new LayerStack\(\(\) => \(\{/);
assert.match(
  engineSource,
  /get rasterStrokeStyle\(\): RasterStrokeStyle \{\s*return this\.layerStack\.active\.strokeStyle;/,
);
assert.match(
  engineSource,
  /get rasterBevelStyle\(\): RasterBevelStyle \{\s*return this\.layerStack\.active\.bevelStyle;/,
);
assert.match(
  engineSource,
  /get rasterOuterShadowStyle\(\): RasterOuterShadowStyle \{\s*return this\.layerStack\.active\.outerShadowStyle;/,
);
assert.match(
  engineSource,
  /get rasterInnerShadowStyle\(\): RasterInnerShadowStyle \{\s*return this\.layerStack\.active\.innerShadowStyle;/,
);
assert.match(
  engineSource,
  /get rasterColorOverlayStyle\(\): RasterColorOverlayStyle \{\s*return this\.layerStack\.active\.colorOverlayStyle;/,
);
assert.doesNotMatch(
  engineSource,
  /(private )?rasterStrokeStyle: RasterStrokeStyle =/,
  "lo stile Traccia non può tornare a essere un campo del motore",
);
assert.doesNotMatch(
  engineSource,
  /(private )?rasterBevelStyle: RasterBevelStyle =/,
  "lo stile Smusso non può tornare a essere un campo del motore",
);
assert.doesNotMatch(
  engineSource,
  /(private )?rasterOuterShadowStyle: RasterOuterShadowStyle =/,
  "lo stile Ombra esterna non può tornare a essere un campo del motore",
);
assert.doesNotMatch(
  engineSource,
  /(private )?rasterInnerShadowStyle: RasterInnerShadowStyle =/,
  "lo stile Ombra interna non può tornare a essere un campo del motore",
);
const colorOverlaySetterStart = rasterStyleRuntimeSource.indexOf(
  "export async function applyRasterColorOverlayStyle(",
);
const colorOverlaySetterEnd = rasterStyleRuntimeSource.indexOf(
  "export async function applyRasterStrokeStyle(",
  colorOverlaySetterStart,
);
assert.notEqual(colorOverlaySetterStart, -1);
assert.notEqual(colorOverlaySetterEnd, -1);
const colorOverlaySetterBody = rasterStyleRuntimeSource.slice(
  colorOverlaySetterStart,
  colorOverlaySetterEnd,
);
assert.match(
  colorOverlaySetterBody,
  /if \(rendererWillBeReleased\) \{\s*await engine\.waitForIdle\(\);/,
  "solo la distruzione del compositore può imporre queue-idle a Color Overlay",
);
assert.match(
  colorOverlaySetterBody,
  /previousDisplayUsesStyle !== nextDisplayUsesStyle/,
  "un cambio colore caldo non deve ricostruire tutta la cache di presentazione",
);
