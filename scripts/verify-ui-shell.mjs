import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EDITOR_SHELL_PARTIALS,
  EDITOR_STYLE_PARTIALS,
  readEditorHtml,
  readEditorStyleSource,
} from "./ui-shell-source.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (relativePath) => readFileSync(`${root}/${relativePath}`, "utf8")
  .replace(/\r\n/g, "\n");
const template = read("index.html");
const html = readEditorHtml();
const styleEntry = read("src/styles.css");
const styles = readEditorStyleSource();
const expectedIds = JSON.parse(read("scripts/verification/ui-shell-id-manifest.json"));

for (const name of EDITOR_SHELL_PARTIALS) {
  const marker = `<!-- @ui:${name} -->`;
  assert.equal(
    template.split(marker).length - 1,
    1,
    `${marker} deve avere un solo proprietario nella shell`,
  );
  const partial = read(`src/ui-shell/${name}.html`);
  assert.ok(partial.trim().length > 0, `frammento HTML vuoto: ${name}`);
  assert.doesNotMatch(partial, /<script\b/i, `gli script restano proprieta della shell: ${name}`);
}
assert.doesNotMatch(html, /<!--\s*@ui:/);
assert.equal(
  (html.match(/<script type="module" src="\/src\/startup\.ts"><\/script>/g) ?? []).length,
  1,
);

const actualIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(actualIds, expectedIds, "ID e ordine DOM della shell devono restare stabili");
assert.equal(new Set(actualIds).size, actualIds.length, "gli ID della shell devono essere univoci");
const idSet = new Set(actualIds);
for (const match of html.matchAll(/\b(?:aria-controls|aria-labelledby|aria-describedby|for)="([^"]+)"/g)) {
  for (const referencedId of match[1].split(/\s+/)) {
    assert.ok(idSet.has(referencedId), `riferimento accessibile senza target: ${referencedId}`);
  }
}

const expectedStyleEntry = EDITOR_STYLE_PARTIALS
  .map((name) => `@import "./styles/${name}.css";`)
  .join("\n") + "\n";
assert.equal(styleEntry, expectedStyleEntry, "l'ordine della cascata deve essere esplicito e stabile");
assert.doesNotMatch(styles, /@import\b/);
for (const name of EDITOR_STYLE_PARTIALS) {
  assert.ok(read(`src/styles/${name}.css`).length > 0, `frammento CSS vuoto: ${name}`);
}
const cascadeAnchors = [
  ":root {",
  ".project-home {",
  ".topbar {",
  "/* Superficie editor condivisa.",
  "#vectorTextPresentationCanvas {",
  "@media (min-width: 700px) {",
];
let previousAnchor = -1;
for (const anchor of cascadeAnchors) {
  const index = styles.indexOf(anchor);
  assert.ok(index > previousAnchor, `ordine cascata non valido presso ${anchor}`);
  previousAnchor = index;
}

console.log(`UI shell verificata: ${EDITOR_SHELL_PARTIALS.length} HTML, ${EDITOR_STYLE_PARTIALS.length} CSS, ${actualIds.length} ID.`);
