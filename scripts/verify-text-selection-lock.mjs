import { readEditorStyleSource } from "./ui-shell-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [styles, interaction] = await Promise.all([
  Promise.resolve(readEditorStyleSource()),
  readFile(new URL("../src/document-interaction-controller.ts", import.meta.url), "utf8"),
]);

assert.match(
  styles,
  /html,\s*body,\s*body \*\s*\{[^}]*user-select:\s*none;[^}]*-webkit-user-select:\s*none;[^}]*-webkit-touch-callout:\s*none;/s,
  "The complete app must suppress selection and the iOS callout.",
);
assert.match(
  styles,
  /input:not\(\[type\]\)[\s\S]*textarea,[\s\S]*\[contenteditable\]:not\(\[contenteditable="false"\]\)[\s\S]*\.allow-text-selection[\s\S]*\{[^}]*user-select:\s*text;[^}]*-webkit-user-select:\s*text;[^}]*-webkit-touch-callout:\s*default;/s,
  "Editable controls and explicit opt-outs must keep native text editing.",
);
assert.match(
  interaction,
  /document\.addEventListener\("selectstart",[\s\S]*target\?\.closest\(EDITABLE_TEXT_SELECTOR\)[\s\S]*event\.preventDefault\(\);/,
  "A capture-phase guard must cover engines that ignore inherited user-select.",
);

console.log("Global text-selection lock and editable-control exceptions verified.");
