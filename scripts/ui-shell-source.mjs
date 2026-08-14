import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

export const EDITOR_SHELL_PARTIALS = Object.freeze([
  "project-home",
  "editor-navigation",
  "brush-library-studio",
  "raster-adjustments",
  "tool-settings",
  "tools-menu",
  "layers-panel",
  "stage",
  "layer-loading",
  "startup-loading",
]);

export const EDITOR_STYLE_PARTIALS = Object.freeze([
  "foundation",
  "project-home",
  "editor-shell",
  "mobile-editor",
  "startup-loading",
  "effects-and-overlays",
  "wide-layout",
]);

function readRepositoryFile(relativePath) {
  return readFileSync(`${repositoryRoot}/${relativePath}`, "utf8")
    .replace(/\r\n/g, "\n");
}

export function assembleEditorHtml(template) {
  let assembled = template.replace(/\r\n/g, "\n");
  for (const name of EDITOR_SHELL_PARTIALS) {
    const marker = `<!-- @ui:${name} -->`;
    const occurrences = assembled.split(marker).length - 1;
    if (occurrences !== 1) {
      throw new Error(`Il marker ${marker} deve comparire esattamente una volta.`);
    }
    assembled = assembled.replace(
      marker,
      readRepositoryFile(`src/ui-shell/${name}.html`),
    );
  }
  if (/<!--\s*@ui:/.test(assembled)) {
    throw new Error("La shell editor contiene marker UI non risolti.");
  }
  return assembled;
}

export function readEditorHtml() {
  return assembleEditorHtml(readRepositoryFile("index.html"));
}

export function readEditorStyleSource() {
  return EDITOR_STYLE_PARTIALS
    .map((name) => readRepositoryFile(`src/styles/${name}.css`))
    .join("");
}
