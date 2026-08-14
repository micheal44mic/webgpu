import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSourceImportGraph,
  repositoryPath,
  stronglyConnectedComponents,
} from "./verification/source-import-graph.mjs";

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

const productionGraph = buildSourceImportGraph(sourceRoot, {
  include: (file) => !repositoryPath(sourceRoot, file).startsWith("labs/"),
});
const staticGraph = new Map(
  [...productionGraph.runtime].map(([file, runtimeEdges]) => [
    file,
    new Set([...runtimeEdges, ...(productionGraph.type.get(file) ?? [])]),
  ]),
);
const cycleBaseline = JSON.parse(readFileSync(
  resolve(root, "scripts/verification/source-cycle-baseline.json"),
  "utf8",
));

function unexpectedCycleDomains(components, permittedDomains) {
  return components.filter((component) => !permittedDomains.some(
    (domain) => component.every((member) => domain.includes(member)),
  ));
}

const runtimeCycles = stronglyConnectedComponents(productionGraph.runtime, sourceRoot);
const staticCycles = stronglyConnectedComponents(staticGraph, sourceRoot);
assert.deepEqual(
  unexpectedCycleDomains(runtimeCycles, cycleBaseline.runtimeDomains),
  [],
  "nessun nuovo modulo puo entrare in un ciclo runtime",
);
assert.deepEqual(
  unexpectedCycleDomains(staticCycles, cycleBaseline.staticDomains),
  [],
  "nessun nuovo modulo puo allargare i cicli statici, inclusi gli import type-only",
);
for (const [file, edges] of productionGraph.runtime) {
  assert.equal(edges.has(file), false, `self-import runtime: ${repositoryPath(root, file)}`);
}

const allSourceGraph = buildSourceImportGraph(sourceRoot);
const brushEnginePath = resolve(sourceRoot, "brush-engine.ts");
const brushEngineImports = allSourceGraph.imports.filter(
  (record) => record.target === brushEnginePath,
);
const runtimeBrushEngineImporters = [...new Set(
  brushEngineImports
    .filter((record) => record.kind === "runtime")
    .map((record) => repositoryPath(root, record.importer)),
)].sort();
assert.deepEqual(
  runtimeBrushEngineImporters,
  ["src/main.ts"],
  "BrushEngine puo essere importato a runtime soltanto dalla composition root",
);
const permittedTypeImporters = new Set(JSON.parse(readFileSync(
  resolve(root, "scripts/verification/brush-engine-type-importers.json"),
  "utf8",
)));
const unexpectedTypeImporters = [...new Set(
  brushEngineImports
    .filter((record) => record.kind === "type")
    .map((record) => repositoryPath(root, record.importer))
    .filter((file) => !permittedTypeImporters.has(file)),
)].sort();
assert.deepEqual(
  unexpectedTypeImporters,
  [],
  "le nuove dipendenze dall'intera facade devono usare una porta ristretta",
);

const implicitDomBusViolations = [];
for (const file of sourceFiles(sourceRoot)) {
  const path = repositoryPath(root, file);
  if (path.startsWith("src/labs/")) continue;
  const source = readFileSync(file, "utf8");
  if (/\b(?:dispatchEvent\s*\(|new\s+CustomEvent\b)/.test(source)) {
    implicitDomBusViolations.push(`${path}: evento DOM usato come bus`);
  }
  if (!new Set(["src/main.ts", "src/startup.ts"]).has(path)
    && /\bdocument\.(?:getElementById|querySelector|querySelectorAll)\s*\(/.test(source)) {
    implicitDomBusViolations.push(`${path}: lookup DOM globale fuori dalla composition root`);
  }
  if (path !== "src/main.ts" && /\bwindow\.addEventListener\s*\(/.test(source)) {
    implicitDomBusViolations.push(`${path}: listener window globale senza proprietario`);
  }
}
assert.deepEqual(implicitDomBusViolations, []);

assert.ok(mainSource.split(/\r?\n/).length <= 1_800, "main.ts non deve tornare monolitico");
assert.doesNotMatch(mainSource, /^\s*(?:export\s+)?class\s+/m);
assert.doesNotMatch(
  mainSource,
  /\.(?:createTexture|createBuffer|createRenderPipeline|createComputePipeline)\s*\(/,
  "la composition root non deve possedere allocazioni o pipeline WebGPU",
);
for (const owner of [
  "BrushEngine",
  "ProjectSessionController",
  "HistoryControlsController",
  "CanvasInputController",
  "SceneEditorController",
  "EditorToolsController",
]) {
  assert.match(mainSource, new RegExp(`new ${owner}\\(`), `owner non composto da main.ts: ${owner}`);
}

console.log(
  `Confini sorgente verificati: produzione -> Labs vietato; ${runtimeCycles.length} domini ciclici runtime confinati; BrushEngine value-only da main.`,
);
