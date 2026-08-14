import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = resolve(root, "src");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|js)$/.test(entry.name) ? [absolute] : [];
  });
}

function moduleSpecifiers(source) {
  const matches = source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g,
  );
  return [...matches].map((match) => match[1]);
}

function pointsIntoLabs(specifier) {
  const normalized = specifier.replaceAll("\\", "/");
  return normalized === "./labs"
    || normalized.endsWith("/labs")
    || normalized.includes("/labs/");
}

const violations = [];
for (const file of sourceFiles(sourceRoot)) {
  const repositoryPath = relative(root, file).replaceAll("\\", "/");
  if (repositoryPath.startsWith("src/labs/")) continue;
  const source = readFileSync(file, "utf8");
  for (const specifier of moduleSpecifiers(source)) {
    if (pointsIntoLabs(specifier)) violations.push(`${repositoryPath} -> ${specifier}`);
  }
}

assert.deepEqual(
  violations,
  [],
  `I moduli di produzione non possono dipendere dai laboratori:\n${violations.join("\n")}`,
);

const indexHtml = readFileSync(resolve(root, "index.html"), "utf8");
const labsHtml = readFileSync(resolve(root, "labs.html"), "utf8");
const labsStartup = readFileSync(resolve(sourceRoot, "labs/startup.ts"), "utf8");
const editorLabs = readFileSync(resolve(sourceRoot, "labs/editor-labs.ts"), "utf8");
const mainSource = readFileSync(resolve(sourceRoot, "main.ts"), "utf8");
const extensionContract = readFileSync(
  resolve(sourceRoot, "editor-extension-contract.ts"),
  "utf8",
);
assert.match(indexHtml, /src="\/src\/startup\.ts"/);
assert.doesNotMatch(indexHtml, /src\/labs|Editor Labs/);
assert.match(labsHtml, /src="\/src\/labs\/startup\.ts"/);
assert.match(labsStartup, /import \{ createEditorLabController \} from "\.\/editor-labs"/);
assert.match(editorLabs, /export function createEditorLabController/);
assert.match(extensionContract, /restorePersistedBrushOnStartup\?: boolean/);
assert.match(labsStartup, /restorePersistedBrushOnStartup: false/);
assert.match(
  mainSource,
  /editorExtensionBootstrap\?\.restorePersistedBrushOnStartup \?\? true/,
  "la produzione deve conservare il restore pennello, mentre Labs puo disattivarlo",
);

console.log("Confini sorgente verificati: produzione -> labs vietato, entry Labs esplicito.");
