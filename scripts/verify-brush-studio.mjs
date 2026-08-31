import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const html = readFileSync(`${root}/index.html`, "utf8");
const main = readFileSync(`${root}/src/main.ts`, "utf8");
const studio = readFileSync(`${root}/src/mobile-brush-studio.ts`, "utf8");
const library = readFileSync(`${root}/src/brush-library-controller.ts`, "utf8");
const storage = readFileSync(`${root}/src/brush-studio-storage.ts`, "utf8");
const catalog = readFileSync(`${root}/src/brush-catalog.ts`, "utf8");
const definition = readFileSync(`${root}/src/brush-definition.ts`, "utf8");
const transfer = readFileSync(`${root}/src/brush-studio-transfer.ts`, "utf8");
const engine = readFileSync(`${root}/src/brush-engine.ts`, "utf8");
const assetRegistry = readFileSync(`${root}/src/brush-asset-registry.ts`, "utf8");
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
  "mobileBrushStudioShapeSequenceList",
  "mobileBrushStudioShapeSequenceCount",
  "mobileBrushStudioShapeAdd",
  "mobileBrushStudioShapeMoveEarlier",
  "mobileBrushStudioShapeMoveLater",
  "mobileBrushStudioShapeSequenceMode",
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
  html,
  /mobileBrushStudioShapeMaskFormat|data-mobile-brush-shape-mask-format/,
  "Brush Studio must not duplicate the global Brush Precision selector",
);
assert.doesNotMatch(
  studio,
  /shapeMaskFormatButtons|mobileBrushStudioShapeMaskFormat|mobileBrushShapeMaskFormat|data-mobile-brush-shape-mask-format/,
  "Brush Studio must not retain the removed precision property or DOM query",
);
assert.match(
  studio,
  /getBrushPrecision\(\): BrushShapeMaskFormat;/,
  "Brush Studio must receive the global precision through an explicit boundary",
);
assert.match(
  studio,
  /private withBrushPrecision\(settings: Readonly<BrushSettings>\): BrushSettings \{[\s\S]*?shapeMaskFormat: this\.options\.getBrushPrecision\(\),[\s\S]*?\}/,
  "Brush Studio must centralize the global precision override",
);
assert.match(
  studio,
  /private withBrushPrecision[\s\S]*?const shapeAssetIds = shapeAssetIdsForSettings\(settings\)[\s\S]*?shapeAssetIds,/,
  "Studio snapshots must clone the Shape sequence instead of aliasing editable arrays",
);
assert.match(
  studio,
  /shapeSequenceMode: settings\.shapeSequenceMode === "random" \? "random" : "ordered"/,
  "Studio must migrate invalid or absent sequence modes to ordered",
);
assert.match(
  studio,
  /rememberSettings\([\s\S]*?settingsCache\.set\(brushId, this\.withBrushPrecision\(settings\)\)/,
  "cached brush settings must adopt the current global precision",
);
const settingsSnapshotStart = studio.indexOf("settingsSnapshot(");
const settingsSnapshotEnd = studio.indexOf("async resolveBrushSettings(", settingsSnapshotStart);
assert.ok(
  settingsSnapshotStart >= 0 && settingsSnapshotEnd > settingsSnapshotStart,
  "Brush Studio settingsSnapshot boundary missing",
);
const settingsSnapshotBody = studio.slice(settingsSnapshotStart, settingsSnapshotEnd);
assert.match(
  settingsSnapshotBody,
  /return this\.withBrushPrecision\(/,
  "every settingsSnapshot result must cross the global precision boundary",
);
assert.equal(
  (settingsSnapshotBody.match(/return this\.withBrushPrecision\(/g) ?? []).length,
  3,
  "cached, fallback and saved settings snapshots must all use global precision",
);
const resolveSettingsStart = studio.indexOf("async resolveBrushSettings(");
const resolveSettingsEnd = studio.indexOf("async releasePreviewAssets(", resolveSettingsStart);
assert.ok(
  resolveSettingsStart >= 0 && resolveSettingsEnd > resolveSettingsStart,
  "Brush Studio resolveBrushSettings boundary missing",
);
const resolveSettingsBody = studio.slice(resolveSettingsStart, resolveSettingsEnd);
assert.match(
  resolveSettingsBody,
  /this\.withBrushPrecision\(/,
  "resolved brush settings must adopt the current global precision",
);
assert.match(
  studio,
  /open\([\s\S]*?originalSettings = this\.withBrushPrecision\(originalSettings\)[\s\S]*?draftSettings = this\.withBrushPrecision\(/,
  "opening Brush Studio must pin both restore and draft settings to global precision",
);
assert.match(
  studio,
  /private applyDraftNow\(\): void \{[\s\S]*?this\.options\.applySettings\(this\.withBrushPrecision\(this\.draftSettings\)\)/,
  "live Studio apply must cross the global precision boundary",
);
const brushStudioMarkup = html.slice(
  html.indexOf('id="mobileBrushStudioSheet"'),
  html.indexOf('id="mobileToolsSheet"'),
);
assert.doesNotMatch(
  brushStudioMarkup,
  /16-bit|16F|R16F|HEX16/i,
  "Brush Studio must not expose implementation precision copy",
);
assert.doesNotMatch(
  brushStudioMarkup,
  /mobileBrushStudioColor16|mobileBrushColor16|SourcePrecision/,
  "Brush Studio must not restore removed precision presentation elements",
);
assert.doesNotMatch(
  studio,
  /bindColor16Controls|syncColor16Controls|syncSourcePrecisionLabels|assetPrecisionLabel/,
  "Brush Studio must not keep inactive precision-presentation code",
);
assert.doesNotMatch(
  studio,
  /shapeMaskFormat\s*=\s*"r16float"/,
  "Brush Studio must never silently force Full 16F over the global choice",
);
assert.doesNotMatch(
  main,
  /readBrushSettings|applyBrushControls/,
  "Brush Library and Studio must not use hidden form controls as state",
);
assert.match(
  main,
  /function applyBrushSettings\(\s*settings: Readonly<BrushSettings>,\s*options: Readonly<\{ preserveCanvasTool\?: boolean \}> = \{\},/,
);
assert.match(
  main,
  /brushSettingsController\.replace\(\{[\s\S]*?\.\.\.settings,[\s\S]*?shapeMaskFormat: editorSettingsController\?\.preferences\.brushPrecision[\s\S]*?\?\? DEFAULT_EDITOR_GUIDE_PREFERENCES\.brushPrecision,[\s\S]*?\}\)/,
  "the composition root must apply global Brush Precision over every brush definition",
);
assert.doesNotMatch(
  brushSettingsController,
  /toolSnapshots|spacingPercent: 10,[\s\S]*?flow: 0\.45/,
  "tool switches must not replace the active Brush Studio definition",
);
assert.match(brushSettingsController, /selectTool\(tool: BrushTool, _restoreSnapshot: boolean\)/);
assert.match(engine, /tool === "blend" \? 400 : 99/);
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
  /const candidate = restored\?\.activeBrushId;[\s\S]*?builtinBrushPreset\(candidate\)[\s\S]*?candidate as BrushLibraryBrushId/,
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
  /for \(const \[index, importedShapeAsset\] of imported\.shapeAssets\.entries\(\)\)[\s\S]*?saveBrushStudioAsset\([\s\S]*?"shape",\s*importedShapeAsset\.blob,/,
  "portable import must store every validated Shape PNG byte-exactly",
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
  /runStartupPhase\(\s*"restore-active-brush"[\s\S]*?if \(\s*mobileBrushStudio\s*&& \(editorExtensionBootstrap\?\.restorePersistedBrushOnStartup \?\? true\)\s*\) \{\s*await brushLibraryController\.restoreActiveBrush\(\{ prepareResources: false \}\);\s*\}[\s\S]*?runStartupPhase\(\s*"project-session"[\s\S]*?projectSessionController\.initialize\(\)/,
  "startup must restore the active brush definition without warming its GPU resources",
);
assert.doesNotMatch(main, /deferred-brush-restore/);
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
  /normalizedBrushSourceBlob\(this\.document, decoded, file\)[\s\S]*?blob: normalizedBlob/,
  "Shape and Grain must persist the precision-preserving source selected during decode",
);
assert.match(
  studio,
  /private renderShapeSequenceControls[\s\S]*?aria-pressed[\s\S]*?String\.fromCharCode\(65 \+ index\)/,
  "Shape slots must expose their A-D order and selected state",
);
assert.match(
  studio,
  /mobileBrushStudioShapeSequenceList[\s\S]*?data-mobile-brush-shape-slot[\s\S]*?this\.selectedShapeIndex = index/,
  "dynamic Shape slots must use the controller's abortable event delegation",
);
assert.match(
  studio,
  /private handleRadioButtonKeydown[\s\S]*?ArrowLeft[\s\S]*?ArrowRight[\s\S]*?next\.click\(\)/,
  "segmented radio groups must support standard arrow-key navigation",
);
assert.match(
  studio,
  /shapeImportMode === "append"[\s\S]*?ids\.push\(id\)[\s\S]*?ids\[this\.selectedShapeIndex\] = id/,
  "Shape import must support both adding a slot and replacing the selected slot",
);
assert.match(
  studio,
  /private moveSelectedShape[\s\S]*?\[ids\[this\.selectedShapeIndex\], ids\[targetIndex\]\]/,
  "Shape order must be editable without changing Count",
);
assert.match(
  studio,
  /for \(const assetId of this\.customShapeAssetIds\(settings\)\)[\s\S]*?shapeAssetRefs\.push\(\{ assetId, storageKey \}\)[\s\S]*?shapeAssetRefs,/,
  "Done must persist every unique custom Shape source and its storage reference",
);
assert.match(
  studio,
  /const shapeRefs = new Map\([\s\S]*?for \(const assetId of this\.customShapeAssetIds\(resolved\)\)[\s\S]*?restoreSavedAsset/,
  "saved multi-Shape brushes must hydrate every custom source",
);
assert.match(
  studio,
  /private async releaseTransientAssets[\s\S]*?this\.openState && this\.draftSettings[\s\S]*?customShapeAssetIds\(this\.draftSettings\)/,
  "an asynchronous release must never remove a custom Shape still owned by the open draft",
);
assert.match(
  studio,
  /shapeImportMode === "append" && this\.shapeIdsForStudio\(\)\.length >= 4[\s\S]*?up to four Shape sources/,
  "a completed Add request must not silently replace a slot when the sequence is already full",
);
assert.match(
  studio,
  /directGrayscalePng[\s\S]*?decodeGrayscalePng\(await blob\.arrayBuffer\(\)\)[\s\S]*?scalar16: decoded\.pixels[\s\S]*?sourceBitDepth: decoded\.sourceBitDepth/,
  "native grayscale PNGs must bypass browser bitmap and Canvas decoding",
);
assert.match(
  studio,
  /if \(source\.scalar16 && originalBlob\)[\s\S]*?originalBlob\.slice\(0, originalBlob\.size, "image\/png"\)/,
  "native grayscale PNG storage and transfer must preserve the original byte stream",
);
assert.match(assetRegistry, /readonly scalar16: Uint16Array/);
assert.match(assetRegistry, /readonly sourceBitDepth: 8 \| 16/);
assert.match(assetRegistry, /scalar16FromRgba\(rgba!, kind\)/);
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
assert.match(engine, /hardness: tool === "blend"[\s\S]*?: 1,/);

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root,
  server: { middlewareMode: true },
});
let MobileBrushStudioController;
let BrushSettingsController;
let defaultBrushSettings;
try {
  ({ MobileBrushStudioController } = await moduleServer.ssrLoadModule(
    "/src/mobile-brush-studio.ts",
  ));
  ({ BrushSettingsController } = await moduleServer.ssrLoadModule(
    "/src/brush-settings-controller.ts",
  ));
  ({ defaultBrushSettings } = await moduleServer.ssrLoadModule(
    "/src/engine-types.ts",
  ));
} finally {
  await moduleServer.close();
}

// Paint, Eraser and Blend are operations over one active Brush Studio tip.
// Switching tools may change `tool`, but never the shared authored fields.
{
  let runtime = {
    ...defaultBrushSettings,
    size: 347,
    spacingPercent: 37,
    flow: 0.63,
    opacity: 0.41,
    shapeMaskFormat: "r16float",
    shapeRotation: "fixed",
    shapeScatter: 0.28,
    grainMode: "moving",
    grainScale: 2.2,
    count: 7,
    positionJitterLateral: 0.31,
  };
  const port = {
    getSettings: () => ({ ...runtime }),
    setBrushSettings: (patch) => { runtime = { ...runtime, ...patch }; },
  };
  const settingsController = new BrushSettingsController(port);
  const shared = [
    "size",
    "spacingPercent",
    "flow",
    "opacity",
    "shapeMaskFormat",
    "shapeRotation",
    "shapeScatter",
    "grainMode",
    "grainScale",
    "count",
    "positionJitterLateral",
  ];
  for (const tool of ["blend", "erase", "paint"]) {
    const before = settingsController.snapshot();
    const after = settingsController.selectTool(tool, true);
    assert.equal(after.tool, tool);
    for (const field of shared) assert.equal(after[field], before[field], `${tool}/${field}`);
  }
}

// Cached brush definitions can carry an older per-brush precision value, but
// every cache read and write must follow the current global Settings choice.
{
  let globalPrecision = "r16float";
  const settingsCache = new Map([
    ["legacy-8", { ...defaultBrushSettings, shapeMaskFormat: "r8unorm" }],
    ["legacy-16", { ...defaultBrushSettings, shapeMaskFormat: "r16float" }],
  ]);
  const controller = Object.assign(
    Object.create(MobileBrushStudioController.prototype),
    {
      settingsCache,
      options: { getBrushPrecision: () => globalPrecision },
    },
  );
  const fallback = { ...defaultBrushSettings, color: "#123412341234" };

  const fullPrecisionSnapshot = controller.settingsSnapshot("legacy-8", fallback);
  assert.equal(fullPrecisionSnapshot.shapeMaskFormat, "r16float");

  globalPrecision = "r8unorm";
  const compactPrecisionSnapshot = controller.settingsSnapshot("legacy-16", fallback);
  assert.equal(compactPrecisionSnapshot.shapeMaskFormat, "r8unorm");

  controller.rememberSettings("remembered", {
    ...defaultBrushSettings,
    shapeMaskFormat: "r16float",
  });
  assert.equal(settingsCache.get("remembered").shapeMaskFormat, "r8unorm");

  globalPrecision = "r16float";
  controller.rememberSettings("remembered", {
    ...defaultBrushSettings,
    shapeMaskFormat: "r8unorm",
  });
  assert.equal(settingsCache.get("remembered").shapeMaskFormat, "r16float");
}

// Teardown is an idempotent ownership boundary: the draft is restored once,
// listeners are aborted once, in-flight persistence settles, and failed asset
// ids remain queued for a later History/resource retry.
{
  let closeCount = 0;
  let abortCount = 0;
  let releaseCount = 0;
  const applied = [];
  let finishCommit;
  let finishImport;
  const commitPromise = new Promise((resolve) => { finishCommit = resolve; });
  const importPromise = new Promise((resolve) => { finishImport = resolve; });
  const controller = Object.assign(
    Object.create(MobileBrushStudioController.prototype),
    {
      disposed: false,
      disposePromise: null,
      openState: true,
      originalSettings: { tool: "paint", color: "#123456" },
      importRevision: 4,
      sourcePreviewRevision: 8,
      commitPromise,
      importPromise,
      options: {
        getBrushPrecision: () => "r16float",
        applySettings: (settings) => applied.push(settings),
      },
      eventAbortController: { abort: () => { abortCount += 1; } },
      closeSheet() {
        closeCount += 1;
        this.openState = false;
      },
      cancelScheduledWork() {
        assert.fail("open teardown must close through the shared sheet lifecycle");
      },
      async requestTransientAssetRelease() {
        releaseCount += 1;
      },
      settingsCache: new Map([["brush", {}]]),
      importedAssets: new Map([["asset", {}]]),
      transientAssetIds: new Set(["asset"]),
      imagePromises: new Map([["image", Promise.resolve({})]]),
      sourceCanvases: new Map([["canvas", {}]]),
      resolvedSources: new Map([["source", {}]]),
    },
  );
  const firstDispose = controller.dispose();
  const secondDispose = controller.dispose();
  assert.equal(firstDispose, secondDispose);
  assert.equal(controller.disposed, true);
  assert.equal(controller.settingsCache.size, 1, "cleanup ran before persistence settled");
  finishCommit();
  await Promise.resolve();
  assert.equal(releaseCount, 0, "asset sweep ran before import settled");
  finishImport();
  await firstDispose;
  assert.equal(closeCount, 1);
  assert.equal(abortCount, 1);
  assert.equal(releaseCount, 1);
  assert.equal(applied.length, 1);
  assert.equal(controller.importRevision, 5);
  assert.equal(controller.sourcePreviewRevision, 9);
  assert.equal(controller.settingsCache.size, 0);
  assert.equal(controller.importedAssets.size, 0);
  assert.equal(controller.transientAssetIds.size, 1);
  assert.equal(controller.imagePromises.size, 0);
  assert.equal(controller.sourceCanvases.size, 0);
  assert.equal(controller.resolvedSources.size, 0);
}

// Cancel cannot race an import/catalog commit and restore stale settings while
// the durable operation is still running.
{
  const controller = Object.assign(
    Object.create(MobileBrushStudioController.prototype),
    {
      openState: true,
      busy: true,
      importRevision: 3,
      cancelScheduledWork: () => assert.fail("busy Cancel must be ignored"),
      closeSheet: () => assert.fail("busy Cancel must not close the Studio"),
      options: {
        applySettings: () => assert.fail("busy Cancel must not restore settings"),
        setBrushLibraryOpen: () => assert.fail("busy Cancel must not reopen Library"),
      },
    },
  );
  controller.cancel(true);
  assert.equal(controller.openState, true);
  assert.equal(controller.importRevision, 3);
}

// Registry removal failures caused by active GPU/History references stay in a
// serialized retry queue and disappear only after the engine accepts removal.
{
  let attempts = 0;
  const controller = Object.assign(
    Object.create(MobileBrushStudioController.prototype),
    {
      transientAssetIds: new Set(["custom-shape:retry"]),
      assetReleaseRequested: false,
      assetReleasePromise: null,
      importedAssets: new Map([["custom-shape:retry", {}]]),
      sourceCanvases: new Map([["custom-shape:retry", {}]]),
      resolvedSources: new Map([["custom-shape:retry", {}]]),
      options: {
        runtime: {
          waitForIdle: async () => {},
        },
        settings: {
          getSettings: () => ({
            shapeAssetId: "legacy-shape",
            grainAssetId: "pencil-grain",
          }),
        },
        assets: {
          removeCustomBrushAsset: () => {
            attempts += 1;
            if (attempts === 1) throw new Error("retained by History");
            return true;
          },
        },
      },
    },
  );
  await controller.requestTransientAssetRelease();
  assert.equal(controller.transientAssetIds.has("custom-shape:retry"), true);
  await controller.requestTransientAssetRelease();
  assert.equal(controller.transientAssetIds.size, 0);
  assert.equal(attempts, 2);
}

// Preview requests collapse to one active render and at most one dirty rerun.
{
  const frames = [];
  const renders = [];
  let finishRender;
  const controller = Object.assign(
    Object.create(MobileBrushStudioController.prototype),
    {
      disposed: false,
      openState: true,
      previewFrame: null,
      previewInFlight: false,
      previewDirty: false,
      browser: {
        requestAnimationFrame: (callback) => {
          frames.push(callback);
          return frames.length;
        },
      },
      renderPreview() {
        renders.push(renders.length + 1);
        return new Promise((resolve) => { finishRender = resolve; });
      },
    },
  );
  controller.schedulePreview();
  controller.schedulePreview();
  assert.equal(frames.length, 1);
  frames.shift()(0);
  assert.equal(renders.length, 1);
  controller.schedulePreview();
  assert.equal(frames.length, 0);
  finishRender();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(frames.length, 1);
}

console.log("Brush Studio verification passed.");
