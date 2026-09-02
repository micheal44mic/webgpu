import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const startup = fs.readFileSync(new URL("../src/startup.ts", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const canvasStartupOverlay = fs.readFileSync(
  new URL("../src/canvas-startup-overlay-controller.ts", import.meta.url),
  "utf8",
);
const brushEngine = fs.readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
const engineTypes = fs.readFileSync(new URL("../src/engine-types.ts", import.meta.url), "utf8");
const projectSession = fs.readFileSync(
  new URL("../src/project-session-controller.ts", import.meta.url),
  "utf8",
);
const styles = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const {
  createCanvasStartupOverlayState,
  reduceCanvasStartupOverlayState,
} = await import("../src/canvas-startup-overlay-controller.ts");

function expect(source, value, label) {
  if (!source.includes(value)) throw new Error(`Missing ${label}: ${value}`);
}

function reject(source, value, label) {
  if (source.includes(value)) throw new Error(`Unexpected ${label}: ${value}`);
}

function assert(condition, label) {
  if (!condition) throw new Error(`Failed ${label}.`);
}

expect(html, '<html lang="en">', "English document language");
expect(html, 'id="projectHome"', "project home surface");
expect(html, 'role="tablist"', "tab semantics");
expect(html, 'id="projectsTab"', "Projects tab");
expect(html, 'id="newCanvasTab"', "New Canvas tab");
expect(html, 'id="projectGrid"', "recent-project grid");
expect(html, 'id="newCanvasForm"', "canvas form");
expect(html, 'data-canvas-width="2048"', "2048 square preset");
expect(html, 'data-canvas-width="4000"', "4000 square preset");
expect(html, 'data-canvas-width="1080"', "portrait preset");
expect(html, 'data-canvas-height="1080"', "landscape preset");
expect(html, 'id="newCanvasWidth"', "custom width input");
expect(html, 'id="newCanvasHeight"', "custom height input");
expect(html, 'id="canvasDimensionLink"', "dimension link toggle");
expect(html, 'min="64"', "minimum canvas dimension");
expect(html, 'max="4000"', "maximum canvas dimension");
expect(html, 'id="saveProjectButton"', "editor save control");
expect(html, 'id="projectHomeButton"', "editor home control");
expect(html, 'src="/src/startup.ts"', "deferred editor entrypoint");
expect(html, 'id="canvasStartupOverlay"', "canvas startup overlay");
assert(
  (html.match(/id="canvasStartupOverlay"/g) ?? []).length === 1,
  "one shared startup/runtime loading overlay",
);
reject(html, 'id="layerLoadingOverlay"', "obsolete secondary loading overlay");
expect(html, 'aria-label="M1M4.COM"', "stable startup wordmark label");
expect(
  html,
  '<span>M</span><span>1</span><span>M</span><span>4</span><span>.</span><span>C</span><span>O</span><span>M</span>',
  "complete animated startup wordmark",
);
expect(html, 'id="canvasStartupProgress"', "canvas startup progressbar");
expect(html, 'role="progressbar"', "canvas startup progress semantics");
expect(html, 'aria-valuemin="0"', "canvas startup progress minimum");
expect(html, 'aria-valuemax="100"', "canvas startup progress maximum");
reject(html, 'aria-describedby="canvasStartupLabel"', "duplicate canvas startup progress label");
const startupOverlayMarkupStart = html.indexOf('id="canvasStartupOverlay"');
const startupOverlayMarkupEnd = html.indexOf('<header id="editorTopbar"', startupOverlayMarkupStart);
assert(
  startupOverlayMarkupStart >= 0 && startupOverlayMarkupEnd > startupOverlayMarkupStart,
  "canvas startup overlay markup boundary",
);
const startupOverlayMarkup = html.slice(startupOverlayMarkupStart, startupOverlayMarkupEnd);
expect(startupOverlayMarkup, "hidden", "initially hidden canvas startup overlay");
expect(startupOverlayMarkup, 'aria-busy="true"', "canvas startup busy state");
expect(startupOverlayMarkup, 'role="status"', "single canvas startup live status");
expect(startupOverlayMarkup, 'aria-live="polite"', "polite canvas startup live status");
expect(startupOverlayMarkup, 'aria-atomic="true"', "atomic canvas startup live status");

expect(startup, 'await import("./main")', "dynamic editor boot");
expect(startup, "storageReady", "parallel project storage startup");
expect(startup, "preloadedProject", "project read overlapped with WebGPU startup");
expect(startup, 'window.history.pushState(null, "", url)', "warm Home/editor navigation");
expect(startup, 'showApplicationSurface("editor")', "warm editor surface reuse");
expect(startup, "window.__projectEditorSessionLifecycle", "stable editor session lifecycle endpoint");
expect(
  startup,
  'suspendedEditorUrl.searchParams.get("project") !== url.searchParams.get("project")',
  "same-project identity gate",
);
expect(startup, "const suspended = explicitEditorDimensions(suspendedEditorUrl)",
  "canonical suspended dimensions");
reject(startup, "sameSuspendedDimensions(url)", "same-size-only in-place switch gate");
expect(startup, 'get("projectSwitch") !== "reload"', "document switch kill switch");
expect(startup, "await lifecycle.switchProject(switchRequest)", "in-place project switch request");
expect(startup, 'routeProjectId: url.searchParams.get("project")', "new-project reload identity");
expect(startup, 'await lifecycle.returnHome("none")', "settled popstate return Home");
expect(startup, "queuedHistoryTarget = target", "serialized history navigation");
expect(startup, 'result.fallback.action === "reload-target"', "target runtime reload route");
expect(
  startup,
  "window.location.assign(reloadUrl)",
  "target runtime reload navigation",
);
expect(startup, "window.location.replace(reloadUrl)", "target popstate reload navigation");
expect(startup, 'result.fallback.action === "reload-source"', "verified source recovery route");
expect(
  startup,
  "const startupOverlay = getCanvasStartupOverlayController();",
  "canvas startup overlay composition",
);
expect(startup, "startupOverlay.reset();", "canvas startup overlay reset");
expect(startup, "startupOverlay.fail();", "canvas startup import failure cleanup");
expect(
  startup,
  "The editor application code could not load. Reload the page to try again.",
  "visible editor module failure status",
);
const startupOverlayReset = startup.indexOf("startupOverlay.reset();");
const editorSurfaceShow = startup.indexOf('showApplicationSurface("editor")', startupOverlayReset);
const editorImport = startup.indexOf('await import("./main")', startupOverlayReset);
assert(
  startupOverlayReset >= 0
    && editorSurfaceShow > startupOverlayReset
    && editorImport > editorSurfaceShow,
  "canvas startup overlay reset before editor surface and module import",
);
reject(startup, "this.browser.location.assign", "Home-triggered full-page navigation");
expect(startup, 'this.storage.listProjects()', "recent project loading");
expect(startup, 'this.storage.renameProject', "project rename");
expect(startup, 'this.storage.deleteProject', "project delete");
expect(startup, 'url.searchParams.set("documentSize"', "size route");
expect(startup, 'url.searchParams.set("documentWidth"', "width route");
expect(startup, 'url.searchParams.set("documentHeight"', "height route");
expect(startup, "width === height", "square compatibility route");
expect(startup, "Number.isInteger(width)", "integer width validation");
expect(startup, "Number.isInteger(height)", "integer height validation");
expect(startup, "MAX_CANVAS_DIMENSION = 4000", "new-canvas size cap");
expect(startup, 'event.key !== "ArrowLeft"', "keyboard tabs");
expect(startup, "interface ProjectHomeControllerOptions", "explicit Home dependencies");
expect(startup, "readonly root: ParentNode", "Home DOM root port");
expect(startup, "readonly browser: Window", "Home browser port");
expect(startup, "options.root.querySelectorAll", "root-scoped preset discovery");
reject(startup, "private readonly home = element", "global Home field lookup");

expect(main, "new ProjectSessionController({", "project session composition");
expect(
  main,
  "const canvasStartupOverlay = getCanvasStartupOverlayController();",
  "shared canvas startup overlay controller",
);
expect(main, "canvasStartupOverlay.report(progress);", "real engine startup progress forwarding");
expect(
  main,
  "if (editorExtensionBootstrap?.startupProgressEnabled)",
  "diagnostic startup progress forwarding gate",
);
expect(main, "canvasStartupOverlay.fail();", "engine startup failure cleanup");
expect(
  main,
  "const canvasStartupProgressObserved =",
  "shared visible UI or diagnostic startup observer gate",
);
expect(
  main,
  "onStartupProgress: canvasStartupProgressObserved",
  "hidden non-diagnostic startup fast path",
);
expect(
  main,
  "startupProgressPresentationYieldEnabled: canvasStartupProgressObserved",
  "startup presentation turns share the observer gate",
);
const overlayProgressForward = main.indexOf("canvasStartupOverlay.report(progress);");
const diagnosticProgressGate = main.indexOf(
  "if (editorExtensionBootstrap?.startupProgressEnabled)",
  overlayProgressForward,
);
assert(
  overlayProgressForward >= 0 && diagnosticProgressGate > overlayProgressForward,
  "canvas progress before optional diagnostic forwarding",
);
expect(main, "captureDocument: () => engine.captureProjectDocument()", "capture engine port");
expect(main, "restoreDocument: (project) => engine.restoreProjectDocument(project)", "restore engine port");
const projectSessionCompositionStart = main.indexOf("new ProjectSessionController({");
const projectSessionCompositionEnd = main.indexOf(
  "appDiagnosticsController = new AppDiagnosticsController({",
  projectSessionCompositionStart,
);
assert(
  projectSessionCompositionStart >= 0
    && projectSessionCompositionEnd > projectSessionCompositionStart,
  "project session composition boundary",
);
const projectSessionComposition = main.slice(
  projectSessionCompositionStart,
  projectSessionCompositionEnd,
);
expect(
  projectSessionComposition,
  "prepareProjectPresentation: async (project) => {",
  "saved semantic-project presentation warm-up port",
);
expect(
  projectSessionComposition,
  'project.manifest.snapshot.mixedScene.items.some((item) => item.kind !== "raster")',
  "semantic-project warm-up eligibility gate",
);
expect(
  projectSessionComposition,
  'await initializeMixedSceneController("semantic-scene");',
  "semantic-project resource warm-up",
);
expect(
  projectSessionComposition,
  "waitForDocumentFirstFrame: async () => {\n      await prepareCurrentProjectPresentation();",
  "restored-project presentation readiness port",
);
expect(
  projectSessionComposition,
  "projectEditorBootstrap = undefined;",
  "module bootstrap preload release",
);
expect(
  projectSessionComposition,
  "window.__projectEditorBootstrap = undefined;",
  "global bootstrap preload release",
);
const projectPresentationStart = main.indexOf(
  "async function prepareCurrentProjectPresentation(): Promise<void>",
);
const projectPresentationEnd = main.indexOf(
  "async function startConfiguredVectorDeviceStressTest(): Promise<void>",
  projectPresentationStart,
);
assert(
  projectPresentationStart >= 0 && projectPresentationEnd > projectPresentationStart,
  "current-project presentation readiness boundary",
);
const projectPresentation = main.slice(projectPresentationStart, projectPresentationEnd);
expect(
  projectPresentation,
  "await controller.prepareCurrentScenePresentation();",
  "exact semantic-scene presentation barrier",
);
expect(projectPresentation, "engine.requestRender();", "final restored-project canvas frame");
expect(projectPresentation, "await engine.waitForIdle();", "final restored-project GPU fence");
assert(
  projectPresentation.indexOf("await controller.prepareCurrentScenePresentation();")
    < projectPresentation.indexOf("engine.requestRender();")
    && projectPresentation.indexOf("engine.requestRender();")
      < projectPresentation.indexOf("await engine.waitForIdle();"),
  "semantic presentation before final canvas GPU fence",
);
expect(
  main,
  "await engine.resetForDocumentSwitch(target.documentWidth, target.documentHeight);",
  "cross-dimension engine document reset",
);
expect(main, "onDocumentSwitchPreReset", "pre-destructive composition boundary");
expect(main, "await sceneImportBridge.resetForDocument();", "outgoing import generation drain");
expect(main, "layerThumbnailController.resetForDocument();", "outgoing thumbnail invalidation");
expect(main, "await canvasToolController?.resetForDocument();", "queued tool invalidation");
expect(main, "await mixedSceneController?.resetForDocument();", "mixed-scene cache reset");
expect(main, "historyControlsController.resetForDocument(historyState);", "history UI rebase");
expect(main, "await mobileStrokeSheet?.settleDocumentEdits();", "stroke draft drain");
expect(main, "await mobileRasterEffectsSheet?.settleDocumentEdits();", "effect draft drain");
expect(main, "await mobileToolSettingsSheet?.settleDocumentEdits();", "tool settings drain");
expect(main, "projectSessionController?.noteHistoryState(state)", "history dirty tracking port");
expect(main, "projectSessionController?.noteSceneSnapshot(snapshot)", "scene dirty tracking port");
expect(main, "settleTransientEdits: settleTransientProjectEdits", "preview settlement gate");
const transientSettlementStart = main.indexOf(
  "async function settleTransientProjectEdits(): Promise<void>",
);
const transientSettlementEnd = main.indexOf(
  'window.addEventListener("pagehide"',
  transientSettlementStart,
);
if (transientSettlementStart < 0 || transientSettlementEnd <= transientSettlementStart) {
  throw new Error("Missing transient project-edit settlement boundary.");
}
const transientSettlement = main.slice(transientSettlementStart, transientSettlementEnd);
expect(
  transientSettlement,
  "rasterAdjustmentsController?.needsAdjustmentSettlementForToolChange(historyState) === true",
  "generic live raster-adjustment settlement detection",
);
expect(
  transientSettlement,
  "await rasterAdjustmentsController.commitActiveAdjustmentForToolChange()",
  "generic live raster-adjustment settlement before Save or Home",
);
expect(
  transientSettlement,
  'throw new Error("The active raster adjustment could not finish safely.")',
  "product-neutral failed adjustment settlement status",
);
expect(
  transientSettlement,
  'throw new Error("The active raster adjustment is still open.")',
  "product-neutral incomplete adjustment settlement status",
);
reject(
  transientSettlement,
  "active color adjustment",
  "color-only wording for the generic adjustment settlement gate",
);
expect(main, "await engine.setFillToolSelected(false)", "awaited Fill finalization");
expect(main, "const fillToolActive = engine.fillToolSelected", "selected Fill cleanup without a preview");
expect(main, 'canvasToolController?.activeTool === "fill"', "Fill sheet cleanup before Home suspension");
reject(main, 'document.addEventListener("visibilitychange"', "background-triggered Fill commit");
expect(projectSession, "this.storage.saveProject({", "durable save");
expect(projectSession, "await this.engine.restoreDocument(saved)", "complete project restore");
expect(
  projectSession,
  "await this.performSave({ captureThumbnail: false }, true)",
  "thumbnail-free internal initial project save",
);
expect(
  projectSession,
  "options.captureThumbnail !== false",
  "manual thumbnail capture remains opt-out",
);
expect(projectSession, "await this.captureThumbnailBlob()", "thumbnail capture remains available on save");
expect(projectSession, "this.storageReady ?? this.storage.initialize()", "shared storage readiness");
expect(
  projectSession,
  "validateDocumentDimensions(request.documentWidth, request.documentHeight)",
  "custom target dimension validation",
);
reject(
  projectSession,
  "The requested canvas dimensions require a different GPU document runtime.",
  "obsolete cross-dimension rejection",
);
expect(projectSession, "if (this.onReturnHome)", "warm return to project Home");
expect(projectSession, 'event.key.toLowerCase() !== "s"', "save shortcut");
expect(
  projectSession,
  'async returnHome(historyMode: "push" | "none" = "push")',
  "save-before-home lifecycle flow",
);
expect(projectSession, "await this.settleTransientEdits?.();", "settled previews before save/home");
const saveSettlement = projectSession.indexOf("await this.settleTransientEdits?.();");
const documentCapture = projectSession.indexOf("const captured = await this.engine.captureDocument();");
if (saveSettlement < 0 || saveSettlement >= documentCapture) {
  throw new Error("Fill preview settlement must complete before project capture.");
}
expect(projectSession, "capturedMutationRevision", "concurrent edit save boundary");
expect(projectSession, 'this.browser.addEventListener("beforeunload"', "unsaved exit guard");
reject(main, "async function saveCurrentProject", "legacy project save in main");
reject(main, "async function initializeCurrentProject", "legacy project initialization in main");
reject(main, "async function returnToProjectHome", "legacy project navigation in main");

expect(styles, ".project-home", "home styling");
expect(styles, ".project-grid", "recent-project styling");
expect(styles, ".canvas-preset-grid", "canvas selector styling");
expect(styles, "--app-accent: #dd5c35", "shared orange application accent");
const startupStylesStart = styles.indexOf(".canvas-startup-overlay {");
const startupStylesEnd = styles.indexOf(".stats {", startupStylesStart);
assert(startupStylesStart >= 0 && startupStylesEnd > startupStylesStart, "startup style boundary");
const startupStyles = styles.slice(startupStylesStart, startupStylesEnd);
expect(startupStyles, "backdrop-filter: blur(6px)", "canvas startup background blur");
expect(startupStyles, "background: #2a2e37", "canvas startup progress track");
expect(startupStyles, "background: var(--app-accent)", "canvas startup progress fill");
expect(startupStyles, "border-radius: 0", "square canvas startup progress track");
expect(startupStyles, "@keyframes canvas-startup-character-eighth", "complete wordmark reveal loop");
expect(
  startupStyles,
  '.canvas-startup-overlay[data-mode="runtime"][data-state="loading"]',
  "runtime loading mode on the same overlay",
);
expect(startupStyles, "@keyframes canvas-runtime-progress", "runtime progress animation");
expect(
  startupStyles,
  ".canvas-startup-wordmark-characters > span {\n    animation: none;\n    opacity: 1;",
  "static reduced-motion wordmark",
);
expect(startupStyles, "transition: none", "reduced-motion startup transitions");
expect(styles, "@media (max-width: 680px)", "mobile layout");
expect(styles, "@media (prefers-reduced-motion: reduce)", "reduced-motion support");

expect(canvasStartupOverlay, '"document-pipelines": { started: 40, completed: 70 }', "pipeline progress range");
expect(canvasStartupOverlay, "Math.max(current.percent, phasePercent)", "monotonic startup progress");
expect(
  canvasStartupOverlay,
  "const complete = !failed && firstFrameGpuReady && editorReady;",
  "first GPU frame and editor-ready completion gate",
);
expect(canvasStartupOverlay, "percent: complete ? 100", "terminal canvas startup progress");
expect(canvasStartupOverlay, 'complete ? "Canvas ready"', "terminal canvas startup label");
expect(canvasStartupOverlay, 'overlay.dataset.state = "complete"', "canvas startup completion state");
expect(canvasStartupOverlay, "overlay.hidden = true", "canvas startup overlay dismissal");
expect(canvasStartupOverlay, "child.inert = true", "blocked editor interaction during startup");
expect(canvasStartupOverlay, "element.inert = false", "restored editor interaction after startup");
expect(canvasStartupOverlay, "isVisible(): boolean", "visible startup overlay presentation gate");
expect(canvasStartupOverlay, "dismiss(): void", "unchanged project overlay dismissal");
expect(canvasStartupOverlay, "beginRuntimeOperation(label: string)", "reference-counted runtime loading entry");
expect(canvasStartupOverlay, "runRuntimeOperation<Result>", "promise-scoped runtime loading helper");
expect(canvasStartupOverlay, "this.runtimeOperations.delete(operationId)", "idempotent runtime settlement");
expect(
  canvasStartupOverlay,
  'progressBar.removeAttribute("aria-valuenow")',
  "indeterminate runtime progress semantics",
);
expect(main, "canvasStartupOverlay.runRuntimeOperation", "runtime loading composition");
expect(main, 'beginRasterGaussianBlur: "Preparing Gaussian Blur"', "filter preparation loading label");
expect(main, 'commitRasterGradientMap: "Applying Gradient Map"', "filter apply loading label");
expect(main, 'cancelRasterLiquify: "Cancelling Liquify"', "filter cancel loading label");
expect(main, '"Preparing Clone"', "Clone preparation loading label");
expect(main, '"Updating selection"', "selection loading label");
expect(projectSession, '"Saving Project"', "project save loading label");
expect(main, "documentSwitchGeneration += 1", "document switch continuation generation");
expect(main, 'return "reload-target";', "cross-profile project runtime handoff");
expect(
  main,
  'result.fallback.action === "reload-target"',
  "target reload keeps the loading overlay visible until navigation",
);
expect(main, '|| (result.status === "failed" && !result.destructive)',
  "post-switch control unlock gate");
expect(brushEngine, "this.notifyViewChange(false);", "presentation-only canvas resize view signal");
expect(main, "if (documentViewChanged) projectSessionController?.markDirty", "durable view gate");
expect(
  main,
  "requestedDocumentSwitchGeneration === documentSwitchGeneration",
  "deferred tool settings document guard",
);
expect(
  main,
  "return documentSwitchInProgress\n    || !engineInitialized",
  "global shortcut document switch lock",
);
reject(canvasStartupOverlay, "BrushEngine", "engine implementation dependency in startup overlay");
reject(canvasStartupOverlay, "createTexture", "GPU resource creation in startup overlay");
reject(canvasStartupOverlay, "requestDevice", "GPU device change in startup overlay");

expect(
  engineTypes,
  "startupProgressPresentationYieldEnabled?: boolean;",
  "opt-in startup presentation-turn option",
);
expect(
  brushEngine,
  "options.startupProgressPresentationYieldEnabled === true",
  "startup presentation-turn default-off gate",
);
expect(
  brushEngine,
  "if (!this.startupProgressPresentationYieldEnabled) return;",
  "startup presentation turn independent from observer presence",
);

const startupEvent = (phase, state, label = phase) => ({
  phase,
  label,
  state,
  totalElapsedMs: 0,
  phaseElapsedMs: 0,
  detail: null,
});
const initialStartupState = createCanvasStartupOverlayState();
assert(initialStartupState.percent === 4, "initial canvas startup progress");
const unknownStartupState = reduceCanvasStartupOverlayState(
  initialStartupState,
  startupEvent("unknown-phase", "completed"),
);
assert(unknownStartupState.percent === 4, "unknown startup phase stability");
const pipelineStartupState = reduceCanvasStartupOverlayState(
  unknownStartupState,
  startupEvent("document-pipelines", "completed"),
);
const outOfOrderStartupState = reduceCanvasStartupOverlayState(
  pipelineStartupState,
  startupEvent("adapter-request", "started"),
);
assert(outOfOrderStartupState.percent === 70, "out-of-order monotonic startup progress");
const documentSwitchStartupState = reduceCanvasStartupOverlayState(
  createCanvasStartupOverlayState(),
  startupEvent("document-switch-restore-target", "completed", "Restoring project"),
);
assert(
  documentSwitchStartupState.percent === 78
    && documentSwitchStartupState.label === "Restoring project",
  "same-runtime document switch progress",
);
const editorFirstStartupState = reduceCanvasStartupOverlayState(
  outOfOrderStartupState,
  startupEvent("editor-ready", "completed"),
);
assert(
  editorFirstStartupState.percent === 99 && !editorFirstStartupState.complete,
  "editor-ready waits for first GPU frame",
);
const editorThenGpuStartupState = reduceCanvasStartupOverlayState(
  editorFirstStartupState,
  startupEvent("first-frame-gpu", "completed"),
);
assert(
  editorThenGpuStartupState.percent === 100
    && editorThenGpuStartupState.complete
    && editorThenGpuStartupState.label === "Canvas ready",
  "editor-then-GPU terminal startup state",
);
const gpuFirstStartupState = reduceCanvasStartupOverlayState(
  createCanvasStartupOverlayState(),
  startupEvent("first-frame-gpu", "completed"),
);
assert(!gpuFirstStartupState.complete, "first GPU frame waits for editor-ready");
const gpuThenEditorStartupState = reduceCanvasStartupOverlayState(
  gpuFirstStartupState,
  startupEvent("editor-ready", "completed"),
);
assert(
  gpuThenEditorStartupState.percent === 100 && gpuThenEditorStartupState.complete,
  "GPU-then-editor terminal startup state",
);
const failedStartupState = reduceCanvasStartupOverlayState(
  createCanvasStartupOverlayState(),
  startupEvent("device-request", "failed"),
);
const postFailureStartupState = reduceCanvasStartupOverlayState(
  failedStartupState,
  startupEvent("editor-ready", "completed"),
);
assert(failedStartupState.failed && !postFailureStartupState.complete, "terminal startup failure");

console.info("Project home verification passed.");
