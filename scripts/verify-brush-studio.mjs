import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const html = readFileSync(`${root}/index.html`, "utf8");
const main = readFileSync(`${root}/src/main.ts`, "utf8");
const studio = readFileSync(`${root}/src/mobile-brush-studio.ts`, "utf8");
const storage = readFileSync(`${root}/src/brush-studio-storage.ts`, "utf8");
const transfer = readFileSync(`${root}/src/brush-studio-transfer.ts`, "utf8");
const engine = readFileSync(`${root}/src/brush-engine.ts`, "utf8");
const previewRenderer = readFileSync(`${root}/src/brush-stroke-preview-renderer.ts`, "utf8");

for (const id of [
  "mobileBrushStudioSheet",
  "mobileBrushStudioHandle",
  "mobileBrushStudioCancel",
  "mobileBrushStudioDone",
  "mobileBrushStudioName",
  "mobileBrushStudioStatus",
  "mobileBrushStudioPreviewCanvas",
  "mobileBrushStudioStrokeTab",
  "mobileBrushStudioShapeTab",
  "mobileBrushStudioGrainTab",
  "mobileBrushStudioDynamicsTab",
  "mobileBrushStudioShapeFile",
  "mobileBrushStudioGrainFile",
  "mobileBrushLibraryAdd",
  "mobileBrushLibraryImport",
  "mobileBrushLibraryExport",
  "mobileBrushLibraryImportFile",
  "mobileBrushLibraryStatus",
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
}

assert.equal(
  (html.match(/data-mobile-brush-studio-tab=/g) ?? []).length,
  4,
  "Brush Studio must keep exactly four footer categories",
);
assert.doesNotMatch(
  html.slice(html.indexOf('id="mobileBrushStudioSheet"'), html.indexOf('id="mobileToolsSheet"')),
  /Hardness/i,
  "Paint Hardness must not be exposed in Brush Studio",
);
assert.match(main, /brushId === activeMobileBrushLibraryBrushId[\s\S]*?studio\.open\(/);
assert.match(studio, /this\.cancelButton\.addEventListener\("click"/);
assert.match(studio, /this\.doneButton\.addEventListener\("click"/);
assert.match(studio, /requestAnimationFrame\(\(\) => \{[\s\S]*?this\.applyDraftNow\(\)/);
assert.match(studio, /this\.cancel\(true\)/, "drag-close must use Cancel semantics");
assert.match(studio, /saveBrushStudioSavedBrush/);
assert.match(storage, /window\.indexedDB\.open/);
assert.match(
  storage,
  /assetId \? `\$\{brushId\}:\$\{kind\}:\$\{assetId\}`/,
  "custom asset blobs must use immutable per-asset keys",
);
assert.match(storage, /m1m4\.brush-studio\.library-state\.v1/);
assert.match(storage, /export function loadBrushStudioLibraryState/);
assert.match(storage, /export function saveBrushStudioLibraryState/);
assert.match(storage, /BRUSH_STUDIO_MAX_CUSTOM_BRUSHES = 8/);
assert.match(storage, /readonly customBrushes: readonly BrushStudioCustomBrush\[\]/);
assert.match(storage, /candidate\.version !== 1 && candidate\.version !== 2/);
assert.match(storage, /transaction\.addEventListener\("complete"/);
assert.match(storage, /export function deleteBrushStudioSavedBrush/);
assert.match(html, /id="mobileBrushStudioName"[\s\S]*?maxlength="48"/);
assert.match(html, /id="mobileBrushLibraryAdd"[\s\S]*?data-lucide="plus"/);
assert.match(html, /id="mobileBrushLibraryImport"[\s\S]*?aria-label="Import brush"/);
assert.match(html, /id="mobileBrushLibraryExport"[\s\S]*?aria-label="Export selected brush"/);
assert.match(html, /id="mobileBrushLibraryImportFile"[\s\S]*?\.m1m4brush/);
assert.match(html, /id="mobileBrushLibraryImportFile"[\s\S]*?application\/octet-stream/);
assert.match(
  main,
  /restoredMobileBrushLibraryBrushId[\s\S]*?activeMobileBrushLibraryBrushId[\s\S]*?restoredMobileBrushLibraryBrushId/,
  "the last active saved brush must remain selected after refresh",
);
assert.match(
  main,
  /onCommit: \(brushId, brushName,[\s\S]*?saveBrushStudioLibraryState\(committedBrushId, nextCustomBrushes\)/,
  "Done must atomically persist the custom catalog and its active card",
);
assert.match(
  main,
  /onCommit: \(brushId, brushName,[\s\S]*?loadBrushStudioLibraryState\(\)\?\.customBrushes[\s\S]*?saveBrushStudioLibraryState\(committedBrushId, nextCustomBrushes\)[\s\S]*?onCommitted:/,
  "each save must merge the latest cross-tab catalog before writing",
);
assert.match(
  main,
  /createMobileBrushLibraryBrush[\s\S]*?createBrushStudioCustomBrushId\(\)[\s\S]*?createBrushStudioBaseSettings/,
  "the + action must create an isolated base-brush draft",
);
assert.match(
  main,
  /exportActiveMobileBrush[\s\S]*?loadBrushStudioSavedBrush[\s\S]*?createBrushStudioTransferBlob/,
  "Export must package the selected saved custom brush",
);
assert.match(
  main,
  /importMobileBrush[\s\S]*?parseBrushStudioTransferBlob[\s\S]*?createBrushStudioCustomBrushId\(\)[\s\S]*?saveBrushStudioAsset[\s\S]*?resolveBrushSettings[\s\S]*?saveBrushStudioLibraryState/,
  "Import must validate and hydrate fresh assets before catalog publication",
);
assert.match(
  main,
  /rollbackMobileBrushImport[\s\S]*?releasePreviewAssets[\s\S]*?deleteBrushStudioSavedBrush[\s\S]*?deleteBrushStudioAsset/,
  "a failed import must roll back every newly allocated resource",
);
assert.match(transfer, /BRUSH_STUDIO_TRANSFER_MAX_FILE_BYTES = 42 \* 1024 \* 1024/);
assert.match(transfer, /validateAssetPairing/);
assert.match(transfer, /settings must not contain color or tool/);
const portableImportStart = main.indexOf("async function importMobileBrush(");
const portableImportEnd = main.indexOf(
  "async function selectMobileBrushLibraryBrush(",
  portableImportStart,
);
assert.ok(
  portableImportStart >= 0 && portableImportEnd > portableImportStart,
  "portable brush import section missing",
);
const portableImport = main.slice(portableImportStart, portableImportEnd);
assert.match(portableImport, /parseBrushStudioTransferBlob\(file\)/);
assert.match(
  portableImport,
  /saveBrushStudioAsset\([\s\S]*?"shape",\s*imported\.shapeAsset\.blob,/,
  "portable import must store the validated Shape PNG byte-exactly",
);
assert.match(
  portableImport,
  /saveBrushStudioAsset\([\s\S]*?"grain",\s*imported\.grainAsset\.blob,/,
  "portable import must store the validated Grain PNG byte-exactly",
);
assert.doesNotMatch(
  portableImport,
  /normalizeBrushStudioSourceBlob|normalized(?:Shape|Grain)Asset/,
  "portable assets must not pass through a second lossy Canvas normalization",
);
assert.match(main, /rollbackMobileBrushImport[\s\S]*?forgetSettings\(brushId\)/);
assert.match(main, /mobileBrushLibraryList\.inert = mobileBrushLibraryTransferBusy/);
assert.match(
  main,
  /restoreActiveMobileBrushLibraryBrush[\s\S]*?mobileUiMediaQuery\.addEventListener\("change"[\s\S]*?if \(engineInitialized\) void restoreActiveMobileBrushLibraryBrush\(\)/,
  "a desktop-to-mobile transition must hydrate the active custom brush",
);
assert.match(
  main,
  /mobileBrushLibraryList\.addEventListener\("click"[\s\S]*?selectMobileBrushLibraryBrush\(brushId\)/,
  "dynamic brush cards must select through event delegation",
);
assert.match(
  main,
  /mobileBrushStudio\.resolveBrushSettings\([\s\S]*?activeMobileBrushLibraryBrushId/,
  "startup must restore the active brush instead of always forcing the legacy brush",
);
assert.match(
  main,
  /async function mobileBrushLibrarySettingsForBrush[\s\S]*?previewIsActive[\s\S]*?resolveBrushSettings\(brushId, fallbackSettings\)/,
  "nonactive cards must hydrate saved Shape and Grain assets before preview",
);
assert.match(
  studio,
  /async releasePreviewAssets\([\s\S]*?waitForIdle\(\)[\s\S]*?removeCustomBrushAsset\(assetId\)[\s\S]*?settingsCache\.delete\(brushId\)/,
  "hydrated preview assets must be released after their compact card bitmap is ready",
);
assert.match(
  studio,
  /saveBrushStudioSavedBrush\([\s\S]*?await this\.options\.onCommit\(brushId, brushName, settings\)[\s\S]*?deleteSupersededStoredAssets\(/,
  "old custom blobs may be deleted only after settings and catalog both commit",
);
assert.match(
  studio,
  /normalizeBrushStudioCustomBrushName\(this\.nameElement\.value\)[\s\S]*?await this\.options\.onCommit\(brushId, brushName, settings\)/,
  "custom names and catalog commit must complete before Brush Studio closes",
);
assert.match(
  studio,
  /this\.reportStatus\("Saving brush…", "working"\)/,
  "save progress must be visible inside the mobile sheet",
);
assert.match(
  studio,
  /normalizedBrushSourceBlob\(decoded\)[\s\S]*?blob: normalizedBlob/,
  "Shape and Grain must persist their bounded normalized source, not the original file",
);
assert.match(
  studio,
  /brushSourceDimensionsFromBytes\(header\)[\s\S]*?brushSourceResizePlan[\s\S]*?createImageBitmap\(blob,[\s\S]*?resizeWidth: plan\.width/,
  "large images must be dimension-gated and resized during decode",
);
const customSourceDecodeStart = studio.indexOf("async function decodeBrushSource(");
const customSourceDecodeEnd = studio.indexOf("function canvasFromRgba(", customSourceDecodeStart);
assert.ok(
  customSourceDecodeStart >= 0 && customSourceDecodeEnd > customSourceDecodeStart,
  "custom Shape/Grain decode section missing",
);
const customSourceDecode = studio.slice(customSourceDecodeStart, customSourceDecodeEnd);
const customBitmapDecodeMatch = customSourceDecode.match(
  /source\s*=\s*await createImageBitmap\(blob,\s*\{([\s\S]*?)\}\s*\);/,
);
assert.ok(customBitmapDecodeMatch, "primary custom Shape/Grain bitmap decode missing");
const customBitmapDecodeOptions = customBitmapDecodeMatch[1];
assert.match(
  customBitmapDecodeOptions,
  /colorSpaceConversion:\s*"none"/,
  "custom Shape/Grain masks must bypass profile conversion so authored channel bytes survive",
);
assert.match(
  customBitmapDecodeOptions,
  /premultiplyAlpha:\s*"none"/,
  "custom Shape/Grain masks must decode without premultiplying their authored channels",
);
assert.doesNotMatch(
  customBitmapDecodeOptions,
  /colorSpaceConversion:\s*"default"|premultiplyAlpha:\s*"default"/,
  "custom mask decode must not silently restore browser color/alpha conversion",
);
assert.match(
  studio,
  /const declaredType = file\.type\.trim\(\)\.toLowerCase\(\)[\s\S]*?declaredType !== "application\/octet-stream"/,
  "Android providers with an empty or generic MIME type must fall through to magic-byte validation",
);
assert.match(
  studio,
  /rollbackPartialCommit\([\s\S]*?deleteBrushStudioSavedBrush\(brushId\)[\s\S]*?deleteBrushStudioAsset\(key\)/,
  "a failed catalog commit must roll back settings and newly stored blobs",
);
const restoreStart = studio.indexOf("private async restoreSavedAsset(");
const releaseStart = studio.indexOf("private async releaseTransientAssets(", restoreStart);
assert.ok(restoreStart >= 0 && releaseStart > restoreStart, "saved-asset restore section missing");
const restoreBody = studio.slice(restoreStart, releaseStart);
assert.match(restoreBody, /throw new Error\([\s\S]*?The saved \$\{kind\} source is unavailable/);
assert.doesNotMatch(
  restoreBody,
  /settings\.shape\s*=\s*"circle"|settings\.grainMode\s*=\s*"off"/,
  "a transient preview load error must not poison the saved brush settings",
);
assert.match(
  studio,
  /for \(const id of additionalCandidates\) this\.transientAssetIds\.add\(id\)/,
  "superseded registry assets must remain queued until release succeeds",
);
assert.doesNotMatch(
  main,
  /rememberSettings\("current", engine\.getSettings\(\)\)/,
  "landscape bootstrap must not shadow the persisted Default Brush before portrait restore",
);
assert.match(studio, /readonly previewRenderer: AuthoritativeBrushStrokePreviewRenderer/);
const renderStart = studio.indexOf("private async renderPreview(): Promise<void>");
const renderEnd = studio.indexOf("private async commit(): Promise<void>", renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart, "authoritative Studio render section missing");
const renderBody = studio.slice(renderStart, renderEnd);
assert.match(
  renderBody,
  /await this\.options\.previewRenderer\.render\(this\.previewCanvas, settings\)/,
  "Brush Studio must delegate its stroke to the shared WebGPU renderer",
);
assert.doesNotMatch(
  renderBody,
  /getContext\(|drawImage\(|putImageData\(|globalCompositeOperation|stampCount|spacingPixels|applyPreviewGrain|renderBrushTipPreview|\.noise\(/,
  "Brush Studio must not rebuild stamps, blend or grain in Canvas2D",
);
assert.match(studio, /this\.options\.previewRenderer\.invalidate\(this\.previewCanvas\)/);
assert.match(
  main,
  /new MobileBrushLibraryPreviewRenderer\(\s*authoritativeBrushStrokePreviewRenderer,?\s*\)/,
  "Brush Library must receive the shared authoritative renderer instance",
);
assert.match(
  main,
  /new MobileBrushStudioController\(\{[\s\S]*?previewRenderer: authoritativeBrushStrokePreviewRenderer,/,
  "Brush Studio must receive the same authoritative renderer instance",
);
assert.match(previewRenderer, /BRUSH_STROKE_PREVIEW_RENDERER_VERSION[\s\S]*authoritative-paint-stamps-webgpu-v1/);
assert.match(previewRenderer, /resamplePaintCurveSegment\(/);
assert.match(previewRenderer, /packStampsIntoUpload\(/);
assert.match(engine, /registerCustomShapeAsset\(/);
assert.match(engine, /registerCustomGrainAsset\(/);
assert.match(engine, /hardness: tool === "paint" \? 1/);

console.log("Brush Studio verification passed.");
