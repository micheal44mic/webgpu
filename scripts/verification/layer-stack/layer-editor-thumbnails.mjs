import { readEditorHtml, readEditorStyleSource } from "../../ui-shell-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "../../engine-source.mjs";
import { assertBoundedSourceSection as assertSection } from "../source-contract.mjs";
import { LAYER_STACK_MAXIMUM } from "../../../src/layer-stack.ts";
import {
  MOBILE_TOOLS_SHEET_CLOSE_FLICK_MIN_DISTANCE_PX,
  MOBILE_TOOLS_SHEET_CLOSE_FLICK_MIN_VELOCITY_PX_PER_MS,
  MOBILE_TOOLS_SHEET_CLOSE_FROM_PEEK_DISTANCE_PX,
  MOBILE_TOOLS_SHEET_CLOSE_PAST_PEEK_DISTANCE_PX,
  shouldCloseMobileToolsSheetDrag,
} from "../../../src/mobile-tools-sheet-gesture.ts";
import {
  MOBILE_SEMANTIC_LAYER_THUMBNAIL_STRATEGY,
  MOBILE_SEMANTIC_LAYER_THUMBNAIL_SIZE,
  MOBILE_SEMANTIC_THUMBNAIL_MAXIMUM_COMMANDS,
  mobileSemanticLayerThumbnailSignature,
} from "../../../src/mobile-semantic-layer-thumbnail.ts";
import { layerThumbnailDimensions } from "../../../src/layer-thumbnail-geometry.ts";
import {
  BoundedMobileRasterThumbnailCache,
  MOBILE_RASTER_THUMBNAIL_CACHE_GENERATIONS,
  MOBILE_RASTER_THUMBNAIL_CACHE_MAXIMUM,
  MOBILE_RASTER_THUMBNAIL_CACHE_MAXIMUM_BYTES,
  MOBILE_RASTER_THUMBNAIL_EDGE_PX,
  MOBILE_RASTER_THUMBNAIL_RGBA_BYTES,
} from "../../../src/mobile-raster-thumbnail-cache.ts";

const engineSource = readEngineSource();
const layerThumbnailSource = readFileSync(
  new URL("../../../src/layer-thumbnail-renderer.ts", import.meta.url),
  "utf8",
);
const layerThumbnailControllerSource = readFileSync(
  new URL("../../../src/layer-thumbnail-controller.ts", import.meta.url),
  "utf8",
);
const layerPanelSource = readFileSync(
  new URL("../../../src/layer-panel-controller.ts", import.meta.url),
  "utf8",
);
const layerThumbnailGeometrySource = readFileSync(
  new URL("../../../src/layer-thumbnail-geometry.ts", import.meta.url),
  "utf8",
);
const mobileSemanticThumbnailSource = readFileSync(
  new URL("../../../src/mobile-semantic-layer-thumbnail.ts", import.meta.url),
  "utf8",
);

// After a switch the effect controls must be re-read from the engine, or the
// panel would show the outgoing layer's Traccia and Smusso while the brush
// paints on the incoming one — wrong in a way that looks like a rendering bug.
const mainSource = readFileSync(
  new URL("../../../src/main.ts", import.meta.url),
  "utf8",
);
const gpuMemoryPanelSource = readFileSync(
  new URL("../../../src/gpu-memory-panel-controller.ts", import.meta.url),
  "utf8",
);
const canvasToolSource = readFileSync(
  new URL("../../../src/canvas-tool-controller.ts", import.meta.url),
  "utf8",
);
const rasterStyleSource = readFileSync(
  new URL("../../../src/raster-style-controller.ts", import.meta.url),
  "utf8",
);
const canvasInputSource = readFileSync(
  new URL("../../../src/canvas-input-controller.ts", import.meta.url),
  "utf8",
);
const documentInteractionSource = readFileSync(
  new URL("../../../src/document-interaction-controller.ts", import.meta.url),
  "utf8",
);
const brushQuickControlsSource = readFileSync(
  new URL("../../../src/brush-quick-controls-controller.ts", import.meta.url),
  "utf8",
);
const sceneEditorSource = readFileSync(
  new URL("../../../src/scene-editor-controller.ts", import.meta.url),
  "utf8",
);
const brushLibrarySource = readFileSync(
  new URL("../../../src/brush-library-controller.ts", import.meta.url),
  "utf8",
);
const editorToolsSource = readFileSync(
  new URL("../../../src/editor-tools-controller.ts", import.meta.url),
  "utf8",
);
const editorLabsSource = readFileSync(
  new URL("../../../src/labs/editor-labs.ts", import.meta.url),
  "utf8",
);
const labsStartupSource = readFileSync(
  new URL("../../../src/labs/startup.ts", import.meta.url),
  "utf8",
);
const labOperationsSource = readFileSync(
  new URL("../../../src/labs/engine-lab-operations.ts", import.meta.url),
  "utf8",
);
const humanLabSource = readFileSync(
  new URL("../../../src/labs/human-stroke-lab.ts", import.meta.url),
  "utf8",
);
const indexSource = readEditorHtml();
const stylesSource = readEditorStyleSource();
const mobileToolSettingsSource = readFileSync(
  new URL("../../../src/mobile-tool-settings-sheet.ts", import.meta.url),
  "utf8",
);
assert.match(layerThumbnailGeometrySource, /export const LAYER_THUMBNAIL_SIZE = 64 as const/);
assert.match(layerThumbnailSource, /export const LAYER_THUMBNAIL_SAMPLE_GRID = 8 as const/);
assert.match(
  layerThumbnailSource,
  /"lazy-idle-gpu-area-sample-document-aspect-64-readback-cache-v2" as const/,
);
assert.deepEqual(layerThumbnailDimensions(1080, 1920), { width: 36, height: 64 });
assert.deepEqual(layerThumbnailDimensions(1920, 1080), { width: 64, height: 36 });
assert.match(layerThumbnailSource, /copyTextureToBuffer\(/);
assert.match(layerThumbnailSource, /GPUBufferUsage\.COPY_DST \| GPUBufferUsage\.MAP_READ/);
assert.match(
  layerThumbnailSource,
  /readonly residentBytes = LAYER_THUMBNAIL_BYTE_LENGTH \+ LAYER_THUMBNAIL_TEXTURE_BYTES/,
);
assert.match(
  layerThumbnailSource,
  /Math\.ceil\(\s*LAYER_THUMBNAIL_TIGHT_BYTES_PER_ROW \/ 256,?\s*\) \* 256/,
);
assert.match(layerThumbnailSource, /mappedBytes\.subarray\(/);
assert.match(layerThumbnailSource, /rowsPerImage: LAYER_THUMBNAIL_HEIGHT/);
assert.match(
  layerThumbnailSource,
  /for \(var sampleY = 0; sampleY < \$\{LAYER_THUMBNAIL_SAMPLE_GRID\}/,
);
assert.match(
  layerThumbnailSource,
  /for \(var sampleX = 0; sampleX < \$\{LAYER_THUMBNAIL_SAMPLE_GRID\}/,
);
assert.doesNotMatch(
  layerThumbnailSource,
  /createHydratedLayerTexture|LayerColdStorage|onSubmittedWorkDone/,
  "la miniatura non deve reidratare cold store o imporre un drain globale della coda",
);
assert.match(engineSource, /async captureActiveLayerThumbnail\(\)/);
assert.match(engineSource, /engine\.layerThumbnailRenderer\?\.residentBytes/);
assert.match(layerThumbnailControllerSource, /new BoundedMobileRasterThumbnailCache/);
assert.doesNotMatch(
  layerThumbnailControllerSource,
  /liveRasterIds[\s\S]{0,300}this\.cache\.delete/,
  "merge must not purge previews for layer ids that structural undo can restore",
);
assert.match(
  mainSource,
  /captureBusy: \(\) => canvasInputController\?\.isPointerActive === true[\s\S]*?historyState\.busy/,
);
assert.match(mainSource, /function requestMobileLayerThumbnailCapture\(delayMs = 120\)/);
assert.match(
  layerThumbnailControllerSource,
  /new this\.options\.browser\.ImageData\([\s\S]*?capture\.width,[\s\S]*?capture\.height/,
);
assert.match(layerPanelSource, /thumbnailCanvas\.width = LAYER_THUMBNAIL_WIDTH/);
assert.match(layerPanelSource, /thumbnailCanvas\.height = LAYER_THUMBNAIL_HEIGHT/);
assert.match(layerPanelSource, /--mobile-layer-thumbnail-width/);
assert.match(layerPanelSource, /--mobile-layer-thumbnail-height/);
assert.equal(MOBILE_RASTER_THUMBNAIL_EDGE_PX, 64);
assert.equal(MOBILE_RASTER_THUMBNAIL_RGBA_BYTES, 64 * 64 * 4);
assert.equal(MOBILE_RASTER_THUMBNAIL_CACHE_GENERATIONS, 4);
assert.equal(
  MOBILE_RASTER_THUMBNAIL_CACHE_MAXIMUM,
  LAYER_STACK_MAXIMUM * MOBILE_RASTER_THUMBNAIL_CACHE_GENERATIONS,
);
assert.equal(MOBILE_RASTER_THUMBNAIL_CACHE_MAXIMUM_BYTES, 1024 * 1024);
const rasterThumbnailCache = new BoundedMobileRasterThumbnailCache(2);
rasterThumbnailCache.set(1, "detached-by-merge");
rasterThumbnailCache.set(2, "merged-result");
assert.equal(rasterThumbnailCache.get(1), "detached-by-merge");
rasterThumbnailCache.set(3, "newer-preview");
assert.equal(
  rasterThumbnailCache.get(1),
  "detached-by-merge",
  "reading a restored undo preview must keep it resident",
);
assert.equal(
  rasterThumbnailCache.get(2),
  undefined,
  "the least-recent preview must be evicted at the hard cap",
);
assert.equal(rasterThumbnailCache.get(3), "newer-preview");
assert.equal(
  MOBILE_SEMANTIC_LAYER_THUMBNAIL_STRATEGY,
  "lazy-canvas2d-semantic-text-svg-document-aspect-64-signature-cache-v2",
);
assert.equal(MOBILE_SEMANTIC_LAYER_THUMBNAIL_SIZE, 64);
assert.equal(MOBILE_SEMANTIC_THUMBNAIL_MAXIMUM_COMMANDS, 25_000);
assert.notEqual(
  mobileSemanticLayerThumbnailSignature({
    kind: "text",
    node: { text: "ONE", fontFamily: "Anton", fontSize: 360, color: "#112233" },
  }),
  mobileSemanticLayerThumbnailSignature({
    kind: "text",
    node: { text: "TWO", fontFamily: "Anton", fontSize: 360, color: "#112233" },
  }),
  "the text thumbnail signature must follow authoritative text content",
);
assert.notEqual(
  mobileSemanticLayerThumbnailSignature({
    kind: "svg",
    node: { document: { sourceRevision: "svg-a" }, paintColors: ["#112233"] },
  }),
  mobileSemanticLayerThumbnailSignature({
    kind: "svg",
    node: { document: { sourceRevision: "svg-a" }, paintColors: ["#445566"] },
  }),
  "the SVG thumbnail signature must follow its editable authoritative palette",
);
assert.match(mobileSemanticThumbnailSource, /context\.fillText\(/);
assert.match(mobileSemanticThumbnailSource, /const width = context\.canvas\.width/);
assert.match(mobileSemanticThumbnailSource, /const canvasHeight = context\.canvas\.height/);
assert.match(mobileSemanticThumbnailSource, /paint\.path\.verbs/);
assert.match(mobileSemanticThumbnailSource, /context\.bezierCurveTo\(/);
assert.match(mobileSemanticThumbnailSource, /paint\.fillRule === 1 \? "evenodd" : "nonzero"/);
assert.match(mobileSemanticThumbnailSource, /commandCount > MOBILE_SEMANTIC_THUMBNAIL_MAXIMUM_COMMANDS/);
assert.match(mobileSemanticThumbnailSource, /const textThumbnailFontStates = new Map/);
assert.doesNotMatch(
  mobileSemanticThumbnailSource,
  /navigator\.gpu|GPU(?:Device|Texture|Buffer|Queue|CommandEncoder)|copyTextureToBuffer|mapAsync|setInterval/,
  "semantic thumbnails must remain cached Canvas2D work without GPU readback or polling",
);
assert.match(layerPanelSource, /semanticThumbnailSignature: mobileSemanticLayerThumbnailSignature/);
assert.match(
  layerThumbnailControllerSource,
  /renderMobileSemanticLayerThumbnail\([\s\S]*?view\.semanticThumbnail/,
);
assert.match(stylesSource, /\.mobile-layers-panel \{[\s\S]*?right: 0;/);
assert.match(stylesSource, /\.mobile-layer-thumbnail-canvas \{[\s\S]*?background: #ffffff;/);
assert.match(
  stylesSource,
  /\.mobile-layer-select,\s*\.mobile-layer-select:hover,\s*\.mobile-layer-select:active\s*\{[^}]*padding: 5px 6px;/,
  "tap, hover and selected-row interaction must preserve the thumbnail padding",
);
assert.match(
  indexSource,
  /minimum-scale=1\.0, maximum-scale=1\.0, user-scalable=no/,
);
assert.equal(MOBILE_TOOLS_SHEET_CLOSE_FLICK_MIN_DISTANCE_PX, 28);
assert.equal(MOBILE_TOOLS_SHEET_CLOSE_FLICK_MIN_VELOCITY_PX_PER_MS, 0.45);
assert.equal(MOBILE_TOOLS_SHEET_CLOSE_FROM_PEEK_DISTANCE_PX, 36);
assert.equal(MOBILE_TOOLS_SHEET_CLOSE_PAST_PEEK_DISTANCE_PX, 36);
const mobileToolsSheetCloseGestureBase = {
  peekOffsetPx: 600,
  closedOffsetPx: 800,
};
assert.equal(shouldCloseMobileToolsSheetDrag({
  ...mobileToolsSheetCloseGestureBase,
  startSnap: "expanded",
  deltaY: 30,
  releaseVelocityY: 0.55,
  offsetPx: 30,
}), true, "un flick rapido deve chiudere direttamente dallo snap alto");
assert.equal(shouldCloseMobileToolsSheetDrag({
  ...mobileToolsSheetCloseGestureBase,
  startSnap: "expanded",
  deltaY: 80,
  releaseVelocityY: 0.1,
  offsetPx: 80,
}), false, "un trascinamento lento e corto dallo snap alto deve ancora fermarsi a peek");
assert.equal(shouldCloseMobileToolsSheetDrag({
  ...mobileToolsSheetCloseGestureBase,
  startSnap: "peek",
  deltaY: 36,
  releaseVelocityY: 0,
  offsetPx: 636,
}), true, "da peek devono bastare 36 px verso il basso per chiudere");
assert.equal(shouldCloseMobileToolsSheetDrag({
  ...mobileToolsSheetCloseGestureBase,
  startSnap: "peek",
  deltaY: 35,
  releaseVelocityY: 0,
  offsetPx: 635,
}), false, "un movimento sotto soglia da peek non deve chiudere accidentalmente");
assert.equal(shouldCloseMobileToolsSheetDrag({
  ...mobileToolsSheetCloseGestureBase,
  startSnap: "expanded",
  deltaY: 636,
  releaseVelocityY: 0,
  offsetPx: 636,
}), true, "superare peek di 36 px deve chiudere anche senza velocità");
assert.match(editorToolsSource, /const shouldClose = shouldCloseMobileToolsSheetDrag\(\{/);
assert.match(editorToolsSource, /this\.snap\(this\.dragStartSnap\)/);
assert.match(
  indexSource,
  /id="mobileBrushLibrarySheet"[\s\S]*?M1M4 BRUSHES[\s\S]*?data-mobile-brush-category="pencil"[\s\S]*?data-mobile-brush-category="painting"[\s\S]*?data-mobile-brush-category="spray-paint"/,
  "la Brush Library mobile deve conservare titolo e tre categorie reali",
);
assert.match(
  indexSource,
  /id="mobileCurrentBrushCard"[\s\S]*?Default Brush[\s\S]*?id="mobileBrushLibraryPreviewCanvas"/,
  "lo slot legacy deve avere un nome reale e una preview propria",
);
assert.match(
  brushLibrarySource,
  /private visibleBrushIds\(\)[\s\S]*?const visible = \[this\.activeBrushId\][\s\S]*?brushId !== this\.activeBrushId[\s\S]*?card\.dataset\.mobileBrushCategoryCard === this\.category[\s\S]*?visible\.push\(brushId\)/,
  "ogni categoria deve mostrare prima il pennello attivo e poi i propri pennelli non duplicati",
);
assert.match(
  brushLibrarySource,
  /private setCategory\(category:[\s\S]*?const ordered[\s\S]*?this\.activeBrushId[\s\S]*?dataset\.mobileBrushCategoryCard === category[\s\S]*?this\.elements\.list\.append\(card\)/,
  "la card attiva deve essere riordinata fisicamente al primo posto in ogni categoria",
);
assert.match(
  brushLibrarySource,
  /this\.activeBrushId = brushId;[\s\S]*?this\.setCategory\(this\.categoryFor\(brushId\)\)[\s\S]*?this\.syncSelection\(\)/,
  "la selezione deve aggiornare subito ordine e stato della categoria visibile",
);
assert.match(
  stylesSource,
  /\.mobile-brush-library-layout \{[\s\S]*?grid-template-columns: 88px minmax\(0, 1fr\);/,
);
assert.match(
  stylesSource,
  /\.mobile-brush-card\.is-selected \{[\s\S]*?border-color: #dd5c35;[\s\S]*?background: #1a1d23;/,
);
assert.match(
  canvasToolSource,
  /paintButton\.addEventListener\("click", \(\) => \{[\s\S]*?this\.activeCanvasTool === "paint"[\s\S]*?options\.toggleBrushLibrary\(\);[\s\S]*?this\.select\("paint"\);/,
  "il primo tap deve selezionare Paint e soltanto un tap sul Paint già attivo apre la library",
);
assert.match(
  mainSource + brushLibrarySource,
  /beforeOpen:[\s\S]*?editorToolsController\?\.setOpen\(false\)[\s\S]*?layerPanelController\?\.isOpen[\s\S]*?layerPanelController\.setOpen\(false\)[\s\S]*?setOpen\(open: boolean\)[\s\S]*?this\.setOffset\(0\)/,
  "la Brush Library deve aprirsi expanded ed escludere Tools e Layers",
);
assert.match(
  mainSource,
  /isSuppressedBySurface: \(\) =>[\s\S]*?layerPanelController\?\.isOpen[\s\S]*?editorToolsController\?\.isOpen[\s\S]*?brushLibraryController\.isOpen/,
  "Size e Opacity non devono restare sopra la Brush Library",
);
assert.match(
  brushQuickControlsSource,
  /const suppressed = !brushContext \|\| this\.options\.isSuppressedBySurface\(\)/,
);
assert.match(
  brushLibrarySource,
  /startSnap: "expanded",[\s\S]*?peekOffsetPx: Math\.min\(closedOffset, Math\.max\(96, closedOffset \* 0\.22\)\)/,
  "il drawer della Brush Library deve usare la gesture facile di chiusura senza snap intermedio",
);
const mobileBrushLibraryPreviewStart = brushLibrarySource.indexOf(
  "private renderPreview(): void",
);
const mobileBrushLibraryPreviewEnd = brushLibrarySource.indexOf(
  "private schedulePreview(): void",
  mobileBrushLibraryPreviewStart,
);
assertSection(
  "orchestrazione preview WebGPU Brush Library",
  mobileBrushLibraryPreviewStart,
  mobileBrushLibraryPreviewEnd,
);
const mobileBrushLibraryPreviewSource = brushLibrarySource.slice(
  mobileBrushLibraryPreviewStart,
  mobileBrushLibraryPreviewEnd,
);
assert.match(
  mobileBrushLibraryPreviewSource,
  /this\.previewRenderer[\s\S]*?\.render\(/,
);
assert.doesNotMatch(
  mobileBrushLibraryPreviewSource,
  /setBrushSettings|queue\.submit|copyTextureToBuffer|mapAsync|onSubmittedWorkDone/,
  "il controller deve soltanto orchestrare la cache: submit e readback vivono nel renderer WebGPU condiviso",
);
assert.match(documentInteractionSource, /DOUBLE_TAP_ZOOM_INTERVAL_MS = 350/);
assert.match(documentInteractionSource, /document\.addEventListener\("touchend",[\s\S]*?passive: false/);
assert.match(documentInteractionSource, /document\.addEventListener\("dblclick",[\s\S]*?preventDefault\(\)/);
assert.match(
  indexSource,
  /id="mobileBrushStudioSize" type="range" min="1" max="1000" step="1" value="30"/,
);
assert.match(
  indexSource,
  /id="mobileBrushSizeControl"[\s\S]*?aria-valuemin="1"[\s\S]*?aria-valuemax="1000"[\s\S]*?aria-valuenow="96"[\s\S]*?aria-valuetext="Size 96 px"/,
);
assert.match(
  indexSource,
  /id="mobileBrushStretchControl"[\s\S]*?aria-valuemin="0"[\s\S]*?aria-valuemax="100"[\s\S]*?aria-valuetext="Stretch 18%"/,
);
assert.match(
  indexSource,
  /id="mobileBrushPaintControl"[\s\S]*?aria-valuemin="0"[\s\S]*?aria-valuemax="100"[\s\S]*?aria-valuetext="Paint 14%"/,
);
assert.match(
  indexSource,
  /id="mobileBrushBlurControl"[\s\S]*?aria-valuemin="0"[\s\S]*?aria-valuemax="100"[\s\S]*?aria-valuetext="Blur 0%"/,
);
assert.match(brushQuickControlsSource, /this\.options\.settings\.quickControl\(kind\)/);
assert.match(brushQuickControlsSource, /const CONTROL_INDICATOR_MAX_CSS_PIXELS = 41;/);
assert.match(
  brushQuickControlsSource,
  /const diameter = kind === "size"[\s\S]*?: CONTROL_INDICATOR_MAX_CSS_PIXELS \* percent \/ 100;[\s\S]*?"--mobile-brush-opacity-indicator"[\s\S]*?`\$\{diameter\.toFixed\(2\)\}px`/,
);
assert.match(
  stylesSource,
  /\[data-mobile-brush-control="opacity"\] \.mobile-brush-control-value \{[\s\S]*?width: var\(--mobile-brush-opacity-indicator, 41px\);[\s\S]*?height: var\(--mobile-brush-opacity-indicator, 41px\);/,
);
assert.match(
  brushQuickControlsSource,
  /if \(kind === "size"\) return `Size \$\{Math\.round\(value\)\} px`;[\s\S]*?if \(kind === "opacity"\) return `Opacity \$\{Math\.round\(value\)\}%`;[\s\S]*?if \(kind === "stretch"\) return `Stretch \$\{Math\.round\(value\)\}%`;[\s\S]*?if \(kind === "paint"\) return `Paint \$\{Math\.round\(value\)\}%`;[\s\S]*?return `Blur \$\{Math\.round\(value\)\}%`/,
);
assert.match(
  brushQuickControlsSource,
  /tracks\.opacity\.hidden = blend;[\s\S]*?tracks\.stretch\.hidden = !blend;[\s\S]*?tracks\.paint\.hidden = !blend;[\s\S]*?tracks\.blur\.hidden = !blend;/,
  "Paint must retain Size and Opacity while Blend exposes Size, Stretch, Paint and Blur",
);
assert.match(
  stylesSource,
  /\.mobile-brush-controls\.is-blend \.mobile-brush-control-track \{[\s\S]*?height: clamp\(64px, 16%, 124px\);[\s\S]*?#mobileBrushSizeTrack \{[\s\S]*?top: 5%;[\s\S]*?#mobileBrushStretchTrack \{[\s\S]*?top: 29%;[\s\S]*?#mobileBrushPaintTrack \{[\s\S]*?top: 53%;[\s\S]*?#mobileBrushBlurTrack \{[\s\S]*?top: 77%;/,
  "the four Blend circles must use evenly spaced tracks",
);
assert.match(
  brushQuickControlsSource,
  /finishDrag\(commit: boolean\)[\s\S]*?if \(commit && drag\.currentValue !== drag\.startValue\) \{[\s\S]*?this\.options\.settings\.setQuickControl\(drag\.kind, drag\.currentValue\);/,
  "the four Blend controls must apply authoritative settings once on release",
);
assert.doesNotMatch(mainSource, /size\.max = blend \? "1024" : "1500"/);
