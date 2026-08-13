import assert from "node:assert/strict";
import { readEngineSource } from "../../engine-source.mjs";
import {
  VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT,
  VECTOR_TEXT_ZOOM_AB_IDLE_FRAME_COUNT,
  VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT,
  vectorTextExactRecoveryIsCurrent,
  vectorTextWideFallbackView,
} from "../../../src/vector-text-adaptive-zoom.ts";
import { readRepositorySource } from "../source-contract.mjs";

const engineSource = readEngineSource();
const controllerSource = readRepositorySource("src/mixed-scene-controller.ts");
const controllerContractSource = readRepositorySource("src/mixed-scene-controller-contract.ts");
const controllerDomSource = readRepositorySource("src/mixed-scene-dom.ts");
const commandHistorySource = readRepositorySource(
  "src/mixed-scene-command-history-runtime.ts",
);
const mobileToolSettingsSource = readRepositorySource("src/mobile-tool-settings-sheet.ts");
const adaptiveSource = readRepositorySource("src/vector-text-adaptive-zoom.ts");
const mixedCompositorSource = readRepositorySource("src/mixed-scene-compositor-shader.ts");
const vectorRasterSource = readRepositorySource("src/engine-vector-raster-runtime.ts");
const mainSource = readRepositorySource("src/main.ts");
const canvasInputSource = readRepositorySource("src/canvas-input-controller.ts");
const editorLabsSource = readRepositorySource("src/labs/editor-labs.ts");
const labsStartupSource = readRepositorySource("src/labs/startup.ts");
const vectorZoomLabSource = readRepositorySource("src/labs/vector/vector-zoom-labs.ts");

// Controller/Worker: sempre GPU, scambio atomico, coda coalescente e bbox semantica.
assert.match(controllerSource, /updateVectorTextGpuPresentation\(/);
assert.doesNotMatch(controllerSource, /updateVectorTextPresentation\(/);
assert.equal((controllerDomSource.match(/getContext\("2d"/g) ?? []).length, 1);
assert.match(controllerSource, /resolveMixedSceneDom\(options\.root\)/);
assert.match(controllerDomSource, /interactionCanvas\.getContext\("2d"/);
assert.match(controllerSource, /this\.presentationCanvas\.width = 1/);
assert.match(controllerSource, /this\.presentationCanvas\.hidden = true/);
assert.match(controllerContractSource, /root: ParentNode;[\s\S]*?browser: Window;/);
assert.match(controllerDomSource, /root\.querySelector<HTMLElement>\(`/);
assert.doesNotMatch(controllerSource, /document\.getElementById|\bwindow\./);
assert.match(
  mainSource,
  /new MixedSceneController\(engine, \{[\s\S]*?root: appElement,[\s\S]*?browser: window,/,
  "il controller vettoriale deve ricevere root e runtime browser dal bootstrap",
);
const controllerInitializeStart = controllerSource.indexOf("  async initialize(): Promise<void> {");
const controllerInitializeEnd = controllerSource.indexOf(
  "\n  syncScene(",
  controllerInitializeStart,
);
assert.ok(
  controllerInitializeStart >= 0 && controllerInitializeEnd > controllerInitializeStart,
);
const controllerInitializeSource = controllerSource.slice(
  controllerInitializeStart,
  controllerInitializeEnd,
);
assert.doesNotMatch(
  controllerInitializeSource,
  /addVectorTextNode|defaultSeed/,
  "l'avvio non deve creare automaticamente un livello testo",
);
assert.match(
  mobileToolSettingsSource,
  /private bindVectorHistoryControl\(control: HTMLElement\)/,
);
assert.match(
  mobileToolSettingsSource,
  /control\.type === "range"[\s\S]*pointerup[\s\S]*pointercancel[\s\S]*keyup[\s\S]*blur/,
);
assert.match(controllerSource, /beginSelectedVectorPropertyEdit\(\): boolean/);
assert.match(controllerSource, /commitSelectedVectorPropertyEdit\(\): boolean/);
assert.doesNotMatch(mobileToolSettingsSource, /sourceControl|dispatchMirrored|dispatchEvent/);
assert.match(
  controllerSource,
  /beginMixedSceneVectorTransformHistory\(this\.host\)/,
);
assert.match(
  commandHistorySource,
  /action === "apply"[\s\S]*host\.commitRasterLayerTransform\(\)[\s\S]*host\.commitVectorHistoryEdit\(\)/,
);
assert.match(
  commandHistorySource,
  /host\.cancelRasterLayerTransform\(\)[\s\S]*host\.cancelVectorHistoryEdit\(\)/,
);
assert.match(commandHistorySource, /host\.beginVectorHistoryEdit\("transform"\)/);
assert.doesNotMatch(
  controllerSource.slice(
    controllerSource.indexOf("  private finishPointer(event: PointerEvent): void {"),
  ),
  /this\.host\.commitVectorHistoryEdit\(\)/,
  "pointerup non deve creare una voce Undo prima di Applica",
);
assert.match(engineSource, /beginVectorHistoryEdit\(scope: "property" \| "transform" = "property"\): boolean/);
assert.match(engineSource, /commitVectorHistoryEdit\(\): boolean/);
assert.match(engineSource, /async cancelVectorHistoryEdit\(\): Promise<boolean>/);
assert.match(engineSource, /kind: "vector"[\s\S]*delta: MixedSceneVectorHistoryDelta/);
// Non un'asserzione di ordine sulla concatenazione (che codificherebbe solo la
// posizione dei moduli): due presenze distinte, con il ripristino vincolato a
// stare dentro la funzione che applica lo stato vettoriale.
assert.match(engineSource, /action\.kind === "vector"/);
const applyVectorStart = engineSource.indexOf("export async function applyVectorHistoryState(");
const applyVectorEnd = engineSource.indexOf("\nexport ", applyVectorStart + 1);
assert.ok(
  applyVectorStart >= 0 && applyVectorEnd > applyVectorStart,
  "applyVectorHistoryState non delimitabile",
);
assert.match(
  engineSource.slice(applyVectorStart, applyVectorEnd),
  /restoreVectorHistoryState\(/,
  "l'applicazione dello stato vettoriale deve ripristinare la scena",
);
assert.match(controllerSource, /scheduleViewSync\(\): void \{[\s\S]*this\.enterFastZoomMode\(\)/);
assert.match(
  controllerSource,
  /!this\.hasVectorPresentationNodes\(\) \|\| !this\.adaptiveZoomEnabled[\s\S]{0,300}this\.exitFastAfterScheduledRender = true/,
);
assert.match(controllerSource, /beginViewGesture\(\): void/);
assert.match(controllerSource, /endViewGesture\(\): void/);
assert.match(controllerSource, /requestExactRecovery\(revision: number\): void/);
assert.match(controllerSource, /requestUnsafeExactRefresh\(revision: number\): void/);
assert.match(controllerSource, /this\.unsafeExactRefreshInFlight[\s\S]*zoomUnsafeExactCoalescedCount/);
assert.match(controllerSource, /waitForVectorTextPresentationCompletion\(\)\.then/);
assert.match(
  controllerContractSource,
  /export type VectorTextClippedRefreshPolicy = "during-gesture" \| "on-release"/,
);
assert.match(
  controllerSource,
  /private readonly clippedRefreshPolicy: VectorTextClippedRefreshPolicy/,
  "la variante A/B deve essere immutabile per l'intera vita del controller",
);
assert.match(
  controllerSource,
  /if \(this\.clippedRefreshPolicy === "during-gesture"\) \{\s*this\.requestUnsafeExactRefresh/,
);
assert.doesNotMatch(controllerSource, /setExactRefreshDuringViewGestureEnabled/);
assert.match(
  controllerSource,
  /waitForVectorTextPresentationCompletion\(\)\.then\(\(\) => \{\s*this\.zoomUnsafeExactRefreshCompletedCount \+= 1/,
  "un refresh iniziato non basta: il report deve sapere se è stato completato prima del rilascio",
);
assert.match(controllerSource, /zoomUnsafeExactRefreshInFlight: this\.unsafeExactRefreshInFlight/);
assert.match(
  controllerSource,
  /zoomUnsafeExactRefreshRequestPending: this\.unsafeExactRefreshRequest !== null/,
);
assert.match(controllerSource, /vectorTextExactRecoveryIsCurrent\(/);
assert.match(controllerSource, /setAdaptiveZoomEnabled\(enabled: boolean\): void/);
assert.match(
  controllerSource,
  /if \(!enabled && this\.zoomRenderMode === "fast"\)[\s\S]{0,700}this\.viewGestureActive = false[\s\S]{0,700}this\.exitFastAfterScheduledRender = true/,
  "disabilitare il fast path durante un gesto deve forzare un redraw preciso senza attendere pointer-up",
);
assert.match(vectorZoomLabSource, /effectRefinementRenderDelta = Math\.max\([\s\S]{0,150}exactRenderDeltaDuringRecovery - 1/);
assert.doesNotMatch(
  vectorZoomLabSource,
  /exactRecoveryLatestOnly:[\s\S]{0,300}exactRenderDeltaDuringRecovery === 1/,
  "gli swap atomici LOD degli effetti possono raffinare la singola recovery senza creare altre recovery zoom",
);
assert.match(editorLabsSource, /this\.#report\.textContent = serialize\(report\)/);
assert.match(labsStartupSource, /search\.get\("lab"\) === "vector-zoom-release" \? "on-release" : "during-gesture"/);
assert.match(vectorZoomLabSource, /refreshMode === "during" \? "A" : "B"/);
assert.match(vectorZoomLabSource, /engine\.panByClientDelta\(1, 0\)/);
assert.match(vectorZoomLabSource, /VECTOR_TEXT_ZOOM_AB_IDLE_FRAME_COUNT/);
assert.match(vectorZoomLabSource, /VECTOR_TEXT_ZOOM_AB_SAMPLE_COUNT/);
assert.match(vectorZoomLabSource, /__vectorZoomAbReport/);
assert.match(vectorZoomLabSource, /unsafeExactRefreshCompletedDelta > 0/);
assert.match(
  vectorZoomLabSource,
  /unsafeExactRefreshStartedDelta === 0[\s\S]{0,220}exactRenderDeltaDuringGesture === 0/,
);
assert.ok(
  (canvasInputSource.match(/getVectorController\(\)\?\.beginViewGesture\(\)/g) ?? []).length >= 2,
  "pinch e pan/rotate devono armare il fast mode prima del primo movimento",
);
assert.ok(
  (canvasInputSource.match(/getVectorController\(\)\?\.endViewGesture\(\)/g) ?? []).length >= 2,
  "pointer-up deve richiedere il recovery preciso senza attendere il debounce",
);
assert.doesNotMatch(controllerSource, /zoomModeIndicator|updateAdaptiveZoomIndicator|Zoom vettori · GPU/);
assert.match(adaptiveSource, /gesture-window2-dual-gpu-auto-fallback-exact-settle-v7/);
assert.match(adaptiveSource, /for \(const \[x, y\] of \[/);
assert.match(engineSource, /vectorTextFastPresentationInFlightCount/);
assert.match(engineSource, /VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT/);
assert.match(engineSource, /vectorTextFastPresentationLatestRequested/);
assert.match(engineSource, /vectorTextFastPresentationCoalescedRequestCount \+= 1/);
assert.match(engineSource, /vectorTextFastRequestedRevision \+= 1/);
assert.match(engineSource, /vectorTextFastSubmittedRevision = Math\.max/);
assert.match(engineSource, /vectorTextFastCompletedRevision = Math\.max/);
assert.match(engineSource, /waitForVectorTextFastPresentationRevision/);
assert.match(
  engineSource,
  /vectorTextFastPresentationInFlightCount[\s\S]{0,120}>= VECTOR_TEXT_FAST_PRESENTATION_MAX_IN_FLIGHT[\s\S]{0,120}vectorTextFastPresentationLatestRequested = true/,
  "solo il terzo frame fast deve entrare nel singolo slot latest-only",
);
assert.match(
  engineSource,
  /if \(this\.vectorTextFastPresentationEnabled\) \{\s*this\.trackVectorTextFastPresentationSubmission\(\)/,
  "anche un submit autoritativo concorrente deve consumare e ackare la camera più recente",
);
assert.match(engineSource, /device\.queue\.onSubmittedWorkDone\(\)\.then/);
assert.match(
  engineSource,
  /function writeCaptureViewUniform[\s\S]*if \(changed\) \{[\s\S]*queue\.writeBuffer/,
);
assert.doesNotMatch(
  mixedCompositorSource,
  /if \(capture\.fastMode > 1\.5\)/,
  "nessun fast mode deve bypassare la camera con un frame screen-space",
);
assert.match(mixedCompositorSource, /@group\(0\) @binding\(5\) var fallbackTexture/);
assert.match(mixedCompositorSource, /return mix\(fallbackColor, sourceColor, smoothstep/);
assert.match(engineSource, /captureVectorTextFallbackPresentation/);
assert.match(engineSource, /rebuildVectorTextGpuFallbackPresentation/);
assert.match(engineSource, /vectorTextFallbackPresentationComplete/);
assert.match(engineSource, /probeVectorTextFallbackAlpha/);
assert.match(engineSource, /probeVectorTextFastCompositeAlpha/);
assert.match(engineSource, /const texture = engine\.mixedSceneLinearTexture/);
assert.match(engineSource, /x \* bytesPerPixel \+ 6/);
assert.match(engineSource, /GPUTextureUsage\.COPY_SRC/);
assert.match(
  engineSource,
  /vectorTextFallbackCaptureView = null;\s*writeVectorTextFallbackCaptureUniforms\(engine\);\s*writeVectorTextCaptureUniforms\(engine\)/,
  "invalidare la fallback deve riclassificare subito il fast mode prima del frame successivo",
);
assert.match(controllerSource, /zoomFallbackReprojectionCount/);
assert.match(controllerContractSource, /readonly documentWidth: number;/);
assert.match(controllerContractSource, /readonly documentHeight: number;/);
assert.match(
  controllerSource,
  /vectorTextWideFallbackView\(\s*view,\s*this\.host\.documentWidth,\s*this\.host\.documentHeight,\s*\)/,
);
assert.match(
  controllerSource,
  /canvasWidth: this\.host\.documentWidth,[\s\S]{0,180}canvasHeight: this\.host\.documentHeight/,
);
assert.match(
  vectorRasterSource,
  /canvasWidth: engine\.documentWidth,[\s\S]{0,180}canvasHeight: engine\.documentHeight/,
);
assert.match(controllerSource, /fallbackPresentationDirty/);
