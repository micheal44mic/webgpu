import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const core = source("src/labs/rgba8-performance-core.ts");
const renderers = source("src/labs/rgba8-performance-renderers.ts");
const lab = source("src/labs/rgba8-performance-lab.ts");
const styles = source("src/labs/rgba8-performance-lab.css");
const html = source("rgba8-performance-lab.html");
const vite = source("vite.config.ts");
const attachment = source("scripts/attach-human-replay-site-build.mjs");
const siteBuild = source("scripts/prepare-sites-build.mjs");
const packageJson = JSON.parse(source("package.json"));

const rgba8LabSources = [core, renderers, lab, styles, html].join("\n");
assert.doesNotMatch(
  rgba8LabSources,
  /(?:r16float|rgba16float|rgba16f|rgba32float)/i,
  "the RGBA8 benchmark must not contain floating-point texture formats",
);
assert.match(renderers, /format: "rgba8unorm"/);
assert.match(renderers, /gl\.RGBA8/);
assert.match(lab, /textureFormats: \["rgba8"\]/);
assert.match(lab, /floatingPointTextures: false/);

assert.match(core, /export const WARMUP_RUNS = 2/);
assert.match(core, /export const MEASURED_RUNS = 7/);
assert.match(core, /export const TARGET_SIZE = 2048/);
assert.match(core, /maximumChannelError <= 2 && differentPixelRatio <= 0\.001/);
for (const category of ["upload", "vertex", "fill", "texture", "pass", "copy", "e2e", "sustained"]) {
  assert.match(core, new RegExp(`category: "${category}"`));
}
assert.match(
  core,
  /export type SamplingProfile = "simple" \| "shape" \| "grain" \| "shape-grain"/,
);
assert.match(core, /const passCounts = quick \? \[1, 8\] : \[1, 2, 4, 8, 32\]/);
assert.match(core, /for \(const copies of \[1, 2, 4\]\)/);
assert.match(core, /sustainedMs: 30_000/);

assert.match(renderers, /queue\.writeBuffer\(this\.instanceBuffer/);
assert.match(renderers, /gl\.bufferSubData\(gl\.ARRAY_BUFFER/);
assert.match(renderers, /copyTextureToTexture/);
assert.match(renderers, /gl\.blitFramebuffer/);
assert.match(renderers, /queue\.onSubmittedWorkDone\(\)/);
assert.match(renderers, /gl\.fenceSync/);
assert.match(renderers, /timestamp-query/);
assert.match(renderers, /EXT_disjoint_timer_query_webgl2/);
assert.match(renderers, /gl\.blendFunc\(gl\.ONE, gl\.ONE_MINUS_SRC_ALPHA\)/);

assert.match(lab, /beginPreparedGeometrySession/);
assert.match(lab, /mode === "paced"/);
assert.match(lab, /mode === "saturation"/);
assert.match(lab, /inputToGpuDeadlineMisses/);
assert.match(lab, /maximumBacklogFrames/);
assert.match(lab, /thermalDriftPercent/);
assert.match(lab, /Il browser non misura direttamente watt o temperatura/);
assert.match(lab, /sustainedCooldownMs: SUSTAINED_COOLDOWN_MS/);
assert.match(lab, /fetch\("\/api\/benchmark-runs"/);
assert.match(lab, /byteLength > 1_048_576/);
assert.match(lab, /Invia risultati e dati tecnici/);

assert.match(html, /id="rgba8PerformanceLab"/);
assert.match(vite, /"rgba8-performance-lab": resolve\(__dirname, "rgba8-performance-lab\.html"\)/);
assert.match(attachment, /const rgba8PerformanceHtmlFile/);
assert.match(attachment, /await cp\(rgba8PerformanceHtmlFile, siteRgba8PerformanceHtmlFile/);
assert.match(siteBuild, /contentLength > 1_048_576/);
assert.match(siteBuild, /Origine del risultato non valida/);
assert.match(siteBuild, /headers: \{ Allow: "POST" \}/);
assert.equal(
  packageJson.scripts?.["rgba8-performance-lab:verify"],
  "node scripts/verify-rgba8-performance-lab.mjs",
);

const productNames =
  /\b(?:ibispaint|figma|adobe|photoshop|illustrator|affinity|canva|coreldraw|krita|gimp|procreate|sketch)\b/i;
assert.doesNotMatch(rgba8LabSources, productNames, "the benchmark must use product-neutral language");

console.log("RGBA8 performance lab matrix, methodology, and hosted wiring verified.");
