import { readEditorHtml } from "../../ui-shell-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const html = readEditorHtml();
const main = readFileSync(`${root}/src/main.ts`, "utf8");
const studio = readFileSync(`${root}/src/mobile-brush-studio.ts`, "utf8");
const library = readFileSync(`${root}/src/brush-library-controller.ts`, "utf8");
const storage = readFileSync(`${root}/src/brush-studio-storage.ts`, "utf8");
const catalog = readFileSync(`${root}/src/brush-catalog.ts`, "utf8");
const definition = readFileSync(`${root}/src/brush-definition.ts`, "utf8");
const transfer = readFileSync(`${root}/src/brush-studio-transfer.ts`, "utf8");
const engine = readFileSync(`${root}/src/brush-engine.ts`, "utf8");
const brushSettingsRuntime = readFileSync(
  `${root}/src/engine-brush-settings-runtime.ts`,
  "utf8",
);
const previewRenderer = readFileSync(`${root}/src/brush-stroke-preview-renderer.ts`, "utf8");
const brushSettingsController = readFileSync(
  `${root}/src/brush-settings-controller.ts`,
  "utf8",
);

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
assert.match(library, /brushId === this\.activeBrushId[\s\S]*?studio\.open\(/);
assert.match(studio, /this\.listen\(this\.cancelButton, "click"/);
assert.match(studio, /this\.listen\(this\.doneButton, "click"/);
assert.match(studio, /this\.browser\.requestAnimationFrame\(\(\) => \{[\s\S]*?this\.applyDraftNow\(\)/);
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
assert.match(catalog, /BRUSH_STUDIO_MAX_CUSTOM_BRUSHES = 8/);
assert.match(storage, /readonly customBrushes: readonly BrushStudioCustomBrush\[\]/);
assert.match(storage, /candidate\.version !== 1 && candidate\.version !== 2/);
assert.match(storage, /transaction\.addEventListener\("complete"/);
assert.match(storage, /export function deleteBrushStudioSavedBrush/);
assert.match(html, /id="mobileBrushStudioName"[\s\S]*?maxlength="48"/);
assert.match(html, /id="mobileBrushStudioSpacing"[^>]*max="99"/);
assert.doesNotMatch(
  main,
  /readBrushSettings|applyBrushControls/,
  "Brush Library and Studio must not use hidden form controls as state",
);
assert.match(main, /applyBrushSettings\(settings: Readonly<BrushSettings>\)/);
assert.match(main, /brushSettingsController\.replace\(settings\)/);
assert.match(brushSettingsController, /spacingPercent: 10,[\s\S]*?flow: 0\.45/);
assert.match(brushSettingsController, /selectTool\(tool: BrushTool, restoreSnapshot: boolean\)/);
assert.match(brushSettingsRuntime, /tool === "blend" \? 400 : 99/);
assert.match(
  transfer,
  /normalizeBrushDefinitionSettings\(value, \{ strict \}\)/,
);
assert.match(definition, /"spacingPercent"[\s\S]*?0\.25,[\s\S]*?99,/);
assert.match(html, /id="mobileBrushLibraryAdd"[\s\S]*?data-lucide="plus"/);
assert.match(html, /id="mobileBrushLibraryImport"[\s\S]*?aria-label="Import brush"/);
assert.match(html, /id="mobileBrushLibraryExport"[\s\S]*?aria-label="Export selected brush"/);
assert.match(html, /id="mobileBrushLibraryImportFile"[\s\S]*?\.m1m4brush/);
assert.match(html, /id="mobileBrushLibraryImportFile"[\s\S]*?application\/octet-stream/);
assert.match(
  library,
  /const candidate = restored\?\.activeBrushId;[\s\S]*?this\.activeBrushId = candidate[\s\S]*?candidate as BrushLibraryBrushId/,
  "the last active saved brush must remain selected after refresh",
);
const studioCommitStart = library.indexOf("private async commitStudioBrush(");
const studioCommitEnd = library.indexOf("private finishStudioCommit(", studioCommitStart);
assert.ok(
  studioCommitStart >= 0 && studioCommitEnd > studioCommitStart,
  "Brush Studio async catalog commit callback missing",
);
const studioCommit = library.slice(studioCommitStart, studioCommitEnd);
assert.match(
  studioCommit,
  /saveBrushStudioLibraryState\(committedId, next\)/,
  "Done must atomically persist the custom catalog and its active card",
);
assert.match(
  library,
  /private latestCatalog\(\)[\s\S]*?loadBrushStudioLibraryState\(\)\?\.customBrushes[\s\S]*?private async commitStudioBrush\([\s\S]*?const latest = this\.latestCatalog\(\)/,
  "each save must merge the latest cross-tab catalog before writing",
);
assert.ok(
  studioCommit.indexOf("ensureCurrentBrushResources")
    < studioCommit.indexOf("saveBrushStudioLibraryState"),
  "Brush Studio must make resources ready before publishing the catalog",
);
assert.match(
  library,
  /private async createBrush[\s\S]*?createBrushStudioCustomBrushId\(\)[\s\S]*?createBrushStudioBaseSettings/,
  "the + action must create an isolated base-brush draft",
);
assert.match(
  library,
  /exportActiveBrush[\s\S]*?loadBrushStudioSavedBrush[\s\S]*?createBrushStudioTransferBlob/,
  "Export must package the selected saved custom brush",
);
assert.match(
  library,
  /importBrush[\s\S]*?parseBrushStudioTransferBlob[\s\S]*?createBrushStudioCustomBrushId\(\)[\s\S]*?saveBrushStudioAsset[\s\S]*?resolveBrushSettings[\s\S]*?saveBrushStudioLibraryState/,
  "Import must validate and hydrate fresh assets before catalog publication",
);
assert.match(
  library,
  /rollbackImport[\s\S]*?releasePreviewAssets[\s\S]*?deleteBrushStudioSavedBrush[\s\S]*?deleteBrushStudioAsset/,
  "a failed import must roll back every newly allocated resource",
);
assert.match(transfer, /BRUSH_STUDIO_TRANSFER_MAX_FILE_BYTES = 42 \* 1024 \* 1024/);
assert.match(transfer, /validateAssetPairing/);
assert.match(definition, /"color" in record \|\| "tool" in record/);
const portableImportStart = library.indexOf("private async importBrush(");
const portableImportEnd = library.indexOf(
  "private async selectBrush(",
  portableImportStart,
);
assert.ok(
  portableImportStart >= 0 && portableImportEnd > portableImportStart,
  "portable brush import section missing",
);
const portableImport = library.slice(portableImportStart, portableImportEnd);
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
assert.match(library, /rollbackImport[\s\S]*?forgetSettings\(brushId\)/);
assert.match(library, /this\.elements\.list\.inert = busy/);
assert.match(
  main,
  /if \(\s*mobileBrushStudio\s*&& \(editorExtensionBootstrap\?\.restorePersistedBrushOnStartup \?\? true\)\s*\) \{[\s\S]*?"deferred-brush-restore"[\s\S]*?brushLibraryController\.restoreActiveBrush\(\)/,
  "the shared editor startup must hydrate the active custom brush on every layout",
);
assert.doesNotMatch(main, /mobileUiMediaQuery|mobileMediaQuery/);
assert.match(
  library,
  /this\.elements\.list\.addEventListener\("click", this\.handleListClick\)[\s\S]*?this\.selectBrush\(brushId\)/,
  "dynamic brush cards must select through event delegation",
);
assert.match(
  library,
  /performActiveBrushRestore[\s\S]*?studio\.resolveBrushSettings\(this\.activeBrushId/,
  "startup must restore the active brush instead of always forcing the legacy brush",
);
assert.match(
  library,
  /performBrushSelection[\s\S]*?previousBrushId[\s\S]*?ensureCurrentBrushResources\(\)[\s\S]*?studio\.releasePreviewAssets\(previousBrushId, current\)/,
  "a successful brush switch must queue the previous custom assets for safe release",
);
assert.match(
  library,
  /private async settingsForPreview[\s\S]*?brushId === this\.activeBrushId[\s\S]*?resolveBrushSettings\(brushId, fallback\)/,
  "nonactive cards must hydrate saved Shape and Grain assets before preview",
);
assert.match(
  library,
  /try \{[\s\S]*?this\.previewRenderer\.render\([\s\S]*?\} finally \{[\s\S]*?releasePreviewAssets/,
  "nonactive preview assets must be released even when rendering fails",
);
assert.match(
  studio,
  /async releasePreviewAssets\([\s\S]*?transientAssetIds\.add\(assetId\)[\s\S]*?requestTransientAssetRelease\(\)[\s\S]*?settingsCache\.delete\(brushId\)/,
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
  /normalizedBrushSourceBlob\(this\.document, decoded\)[\s\S]*?blob: normalizedBlob/,
  "Shape and Grain must persist their bounded normalized source, not the original file",
);
assert.match(
  studio,
  /brushSourceDimensionsFromBytes\(header\)[\s\S]*?brushSourceResizePlan[\s\S]*?browser\.createImageBitmap\(blob,[\s\S]*?resizeWidth: plan\.width/,
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
  /source\s*=\s*await browser\.createImageBitmap\(blob,\s*\{([\s\S]*?)\}\s*\);/,
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
  /for \(const id of supersededAssetIds\) this\.transientAssetIds\.add\(id\)[\s\S]*?requestTransientAssetRelease\(\)/,
  "superseded registry assets must remain queued until release succeeds",
);
assert.doesNotMatch(
  main,
  /rememberSettings\("current", engine\.getSettings\(\)\)/,
  "landscape bootstrap must not shadow the persisted Default Brush before portrait restore",
);
assert.match(studio, /readonly previewRenderer: MobileBrushStudioPreviewPort/);
assert.match(studio, /readonly settings: MobileBrushStudioSettingsPort/);
assert.match(studio, /readonly assets: MobileBrushStudioAssetPort/);
assert.match(studio, /readonly runtime: MobileBrushStudioRuntimePort/);
assert.match(studio, /readonly root: HTMLElement/);
assert.doesNotMatch(studio, /import type \{ BrushEngine \}/);
assert.doesNotMatch(studio, /AuthoritativeBrushStrokePreviewRenderer/);
assert.match(studio, /requiredDescendant<T extends HTMLElement>\(root: HTMLElement/);
assert.doesNotMatch(studio, /document\.getElementById|document\.querySelector/);
assert.match(studio, /target\.addEventListener\(type, listener as EventListener, \{[\s\S]*?signal:/);
assert.match(
  studio,
  /dispose\(\): Promise<void> \{[\s\S]*?this\.disposed = true[\s\S]*?eventAbortController\.abort\(\)[\s\S]*?commitPromise[\s\S]*?importPromise[\s\S]*?requestTransientAssetRelease/,
  "Brush Studio must tear down listeners, scheduled work and transient assets",
);
assert.doesNotMatch(
  studio.slice(studio.indexOf("dispose(): Promise<void>"), studio.indexOf("rememberSettings(")),
  /transientAssetIds\.clear\(\)/,
  "teardown must preserve asset ids still retained by GPU resources or History",
);
assert.match(
  studio,
  /private setBusy\(busy: boolean\)[\s\S]*?cancelButton\.disabled = busy[\s\S]*?handle\.disabled = busy[\s\S]*?scrollElement\.inert = busy[\s\S]*?tab\.disabled = busy/,
  "saving/importing must lock the complete interactive Studio surface",
);
assert.match(
  studio,
  /private schedulePreview\(\)[\s\S]*?previewDirty = true[\s\S]*?previewInFlight[\s\S]*?renderPreview\(\)\.finally/,
  "Studio preview must allow at most one render with one dirty rerun",
);
assert.match(
  main,
  /new MobileBrushStudioController\(\{[\s\S]*?root: element<HTMLElement>\("mobileBrushStudioSheet"\)[\s\S]*?appRoot: appElement[\s\S]*?browser: window/,
  "the composition root must inject the Studio DOM/browser boundary",
);
assert.match(
  main,
  /new MobileBrushStudioController\(\{[\s\S]*?settings: \{ getSettings:[\s\S]*?assets: \{[\s\S]*?registerCustomShapeAsset:[\s\S]*?removeCustomBrushAsset:[\s\S]*?runtime: \{ waitForIdle:/,
  "the composition root must adapt BrushEngine to separate Studio ports",
);
assert.match(
  main,
  /function nonHistoryOperationLocked[\s\S]*?mobileBrushStudio\?\.isOpen === true/,
  "Undo/Redo and document operations must remain locked for the whole Studio session",
);
assert.match(
  main,
  /onStateChange: \(state\) => \{[\s\S]*?mobileBrushStudio\?\.retryPendingAssetRelease\(\)/,
  "History publication must retry assets that an older journal entry retained",
);
assert.match(
  main,
  /window\.addEventListener\("pagehide"[\s\S]*?mobileBrushStudio\?\.dispose\(\)/,
  "the composition root must dispose Brush Studio on page teardown",
);
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
assert.match(brushSettingsRuntime, /hardness: tool === "paint" \? 1/);
