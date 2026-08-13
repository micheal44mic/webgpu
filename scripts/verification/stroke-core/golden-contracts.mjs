import { readEditorHtml } from "../../ui-shell-source.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const goldenSource = readFileSync(new URL("../../../src/labs/goldens/stroke-golden.ts", import.meta.url), "utf8");
const goldenBaseline = JSON.parse(readFileSync(new URL("../../../goldens/raster-stroke-rgba8-v1.json", import.meta.url), "utf8"));
const goldenMipBaseline = JSON.parse(readFileSync(new URL("../../../goldens/raster-stroke-rgba8-mips-v1.json", import.meta.url), "utf8"));
const editorLabsSource = readFileSync(new URL("../../../src/labs/editor-labs.ts", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../../../src/main.ts", import.meta.url), "utf8");
const htmlSource = readEditorHtml();

assert.match(goldenSource, /opaque-interior-paint-no-new-edge/);
assert.match(goldenSource, /threshold-island-new-edge/);
assert.match(goldenSource, /gate-deep-interior-skips-rebuild/);
assert.match(goldenSource, /gate-subthreshold-alpha-near-outer-coverage/);
assert.match(goldenSource, /light-glaze-source-over-opacity-0\.43/);
assert.match(goldenSource, /light-glaze-m1-r16float-max-coverage-opacity-0\.37/);
assert.match(goldenSource, /RASTER_STROKE_GOLDEN_VERSION = 2/);
assert.match(goldenSource, /RASTER_STROKE_GOLDEN_FORMAT = "rgba16float"/);
assert.match(goldenSource, /RASTER_STROKE_GOLDEN_MIP_CHAIN_VERSION = 2/);
assert.match(goldenSource, /RASTER_STROKE_GOLDEN_DIAGNOSTICS_VERSION = 9/);
assert.match(goldenSource, /packRgba8UnormToRgba16FloatBytes/);
assert.match(goldenSource, /format: "r16float"/);
assert.doesNotMatch(goldenSource, /format: "r8unorm"/);
assert.match(goldenSource, /unsigned\[1\] = 1/);
assert.match(goldenSource, /GOLDEN_RGBA16F_BYTES_PER_PIXEL = 8/);
assert.match(goldenSource, /thickness-tail-source-over/);
assert.match(goldenSource, /analytic-layer-bake-matches-golden-mip0/);
assert.match(goldenSource, /renderer!\.encodeBake\(/);
assert.match(goldenSource, /encoded\.pixels === RASTER_STROKE_GOLDEN_WIDTH \* RASTER_STROKE_GOLDEN_HEIGHT/);
assert.match(goldenSource, /diagnosticsMatch/);
assert.match(goldenSource, /differingBytes/);
// Il pool sostituisce il buffer fisico quando cresce e distrugge il vecchio: se
// i renderer non rileggessero il lease, i loro bind group punterebbero a un
// buffer distrutto. Nessun altro caso raggiunge quello stato.
assert.match(goldenSource, /stroke-bevel-pool-growth-resync/);
assert.match(goldenSource, /declareEffect\("golden-growth-probe"/);
assert.match(goldenSource, /releaseRequirement\("golden-growth-probe"\)/);
assert.match(
  goldenSource,
  /const poolBufferWasReplaced = generationAfterGrowth > generationBeforeGrowth/,
);
assert.ok(
  /passed:\s*\n\s*resyncDifferingBytes === 0[\s\S]{0,320}&& poolBufferWasReplaced\s*\n\s*&& sourceContentDistinct,/
    .test(goldenSource),
  "Il caso di crescita del pool deve fallire se il buffer non è stato davvero sostituito.",
);
// Il retarget ricostruisce i bind group da solo: se avvenisse DOPO la crescita
// del pool riparerebbe le bindings stantie dello Smusso e maschererebbe il
// difetto. L'ordine è parte dell'invariante, non uno stile.
assert.ok(
  goldenSource.indexOf('label: "Traccia/Smusso pool growth resync view"')
    < goldenSource.indexOf('declareEffect("golden-growth-probe"'),
  "Il retarget deve precedere la crescita del pool, altrimenti il caso non prova nulla.",
);
assert.match(goldenSource, /stroke-bevel-same-view-retarget/);
// Il caso same-view passerebbe anche con un retarget inerte: il caso
// cross-texture e la sua guardia anti-tautologia sono ciò che lo dimostra.
assert.match(goldenSource, /stroke-bevel-cross-texture-retarget/);
assert.match(goldenSource, /createRetargetSourceFixture\(\)/);
assert.match(goldenSource, /const sourceContentDistinct = afterMip0Sha256 !== crossReferenceMip0Sha256/);
assert.ok(
  /passed:\s*\n\s*crossDifferingBytes === 0[\s\S]{0,240}&& sourceContentDistinct,/.test(goldenSource),
  "Il caso cross-texture deve fallire se le due sorgenti non sono distinguibili.",
);
assert.ok(
  (goldenSource.match(/await encodeRetargetStyleStack\(/g) ?? []).length >= 4,
  "Retarget e riferimento nativo devono usare lo stesso stack di encode.",
);
assert.match(goldenSource, /referenceStrokeRenderer = await RasterStrokeRenderer\.create/);
assert.match(goldenSource, /referenceWorkbench\?\.destroy\(\)/);
assert.match(goldenSource, /maxByteDelta/);
assert.match(goldenSource, /firstDifference/);
assert.match(goldenSource, /combinedSha256/);
assert.equal(
  goldenBaseline.combinedSha256,
  "8d5a75a6abb9f47cdf4a794d560b5795aa4b4c85520db2dd1466833157f6dcb0",
);
assert.equal(goldenBaseline.cases.length, 7);
assert.equal(goldenBaseline.cases[2].sha256, goldenBaseline.cases[4].sha256);
assert.equal(goldenMipBaseline.cases.length, 7);
assert.ok(goldenMipBaseline.cases.every((goldenCase) => goldenCase.mips.length === 9));
const goldenMipIdentity = Buffer.from(JSON.stringify({
  mipChainVersion: goldenMipBaseline.mipChainVersion,
  format: goldenMipBaseline.format,
  width: goldenMipBaseline.width,
  height: goldenMipBaseline.height,
  fixtureSha256: goldenMipBaseline.fixtureSha256,
  cases: goldenMipBaseline.cases.map(({ id, mips }) => ({
    id,
    mips: mips.map(({ level, width, height, sha256 }) => ({
      level,
      width,
      height,
      sha256,
    })),
  })),
}));
assert.equal(
  createHash("sha256").update(goldenMipIdentity).digest("hex"),
  "f7f534721e4ca863fb9cecf379d2efa05e6e5f9840f92aa667c032a1fcdd441f",
);
assert.match(goldenSource, /mipCombinedSha256/);
assert.match(goldenSource, /export async function runRasterStrokeGolden\(/);
assert.match(editorLabsSource, /case "stroke-golden"/);
assert.match(editorLabsSource, /import\("\.\/goldens\/stroke-golden"\)/);
assert.doesNotMatch(mainSource, /runRasterStrokeGolden|rasterStrokeGoldenSection/);
assert.doesNotMatch(htmlSource, /id="runRasterStrokeGolden"/);
