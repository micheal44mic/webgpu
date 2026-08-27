import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const startup = fs.readFileSync(new URL("../src/startup.ts", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const projectSession = fs.readFileSync(
  new URL("../src/project-session-controller.ts", import.meta.url),
  "utf8",
);
const styles = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function expect(source, value, label) {
  if (!source.includes(value)) throw new Error(`Missing ${label}: ${value}`);
}

function reject(source, value, label) {
  if (source.includes(value)) throw new Error(`Unexpected ${label}: ${value}`);
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

expect(startup, 'await import("./main")', "dynamic editor boot");
expect(startup, "storageReady", "parallel project storage startup");
expect(startup, "preloadedProject", "project read overlapped with WebGPU startup");
expect(startup, 'window.history.pushState(null, "", url)', "warm Home/editor navigation");
expect(startup, 'showApplicationSurface("editor")', "warm editor surface reuse");
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
expect(main, "captureDocument: () => engine.captureProjectDocument()", "capture engine port");
expect(main, "restoreDocument: (project) => engine.restoreProjectDocument(project)", "restore engine port");
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
  "rasterAdjustmentsController?.isAutoCommitAdjustmentActive(historyState) === true",
  "generic live color-adjustment settlement detection",
);
expect(
  transientSettlement,
  "await rasterAdjustmentsController.commitActiveAdjustmentForToolChange()",
  "generic live color-adjustment commit before Save or Home",
);
expect(main, "await engine.setFillToolSelected(false)", "awaited Fill finalization");
expect(main, "const fillToolActive = engine.fillToolSelected", "selected Fill cleanup without a preview");
expect(main, 'canvasToolController?.activeTool === "fill"', "Fill sheet cleanup before Home suspension");
reject(main, 'document.addEventListener("visibilitychange"', "background-triggered Fill commit");
expect(projectSession, "this.storage.saveProject({", "durable save");
expect(projectSession, "await this.engine.restoreDocument(saved)", "complete project restore");
expect(projectSession, "this.storageReady ?? this.storage.initialize()", "shared storage readiness");
expect(projectSession, "if (this.onReturnHome)", "warm return to project Home");
expect(projectSession, 'event.key.toLowerCase() !== "s"', "save shortcut");
expect(projectSession, "private async returnHome()", "save-before-home flow");
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
expect(styles, "@media (max-width: 680px)", "mobile layout");
expect(styles, "@media (prefers-reduced-motion: reduce)", "reduced-motion support");

console.info("Project home verification passed.");
