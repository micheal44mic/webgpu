import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const startup = fs.readFileSync(new URL("../src/startup.ts", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function expect(source, value, label) {
  if (!source.includes(value)) throw new Error(`Missing ${label}: ${value}`);
}

expect(html, '<html lang="en">', "English document language");
expect(html, 'id="projectHome"', "project home surface");
expect(html, 'role="tablist"', "tab semantics");
expect(html, 'id="projectsTab"', "Projects tab");
expect(html, 'id="newCanvasTab"', "New Canvas tab");
expect(html, 'id="projectGrid"', "recent-project grid");
expect(html, 'id="newCanvasForm"', "canvas form");
expect(html, 'data-canvas-size="2048"', "2048 preset");
expect(html, 'data-canvas-size="4096"', "4096 preset");
expect(html, 'id="saveProjectButton"', "editor save control");
expect(html, 'id="projectHomeButton"', "editor home control");
expect(html, 'src="/src/startup.ts"', "deferred editor entrypoint");

expect(startup, 'await import("./main")', "dynamic editor boot");
expect(startup, 'this.storage.listProjects()', "recent project loading");
expect(startup, 'this.storage.renameProject', "project rename");
expect(startup, 'this.storage.deleteProject', "project delete");
expect(startup, 'url.searchParams.set("documentSize"', "size route");
expect(startup, 'event.key !== "ArrowLeft"', "keyboard tabs");

expect(main, 'engine.captureProjectDocument()', "complete project capture");
expect(main, 'engine.restoreProjectDocument(saved)', "complete project restore");
expect(main, 'projectStorage.saveProject', "durable save");
expect(main, 'event.key.toLowerCase() !== "s"', "save shortcut");
expect(main, 'returnToProjectHome()', "save-before-home flow");

expect(styles, ".project-home", "home styling");
expect(styles, ".project-grid", "recent-project styling");
expect(styles, ".canvas-preset-grid", "canvas selector styling");
expect(styles, "@media (max-width: 680px)", "mobile layout");
expect(styles, "@media (prefers-reduced-motion: reduce)", "reduced-motion support");

console.info("Project home verification passed.");
