import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

export function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|js)$/.test(entry.name) ? [absolute] : [];
  });
}

function clauseIsTypeOnly(clause) {
  const normalized = clause.trim();
  if (normalized.startsWith("type ")) return true;
  if (!normalized.startsWith("{") || !normalized.endsWith("}")) return false;
  const bindings = normalized.slice(1, -1)
    .split(",")
    .map((binding) => binding.trim())
    .filter(Boolean);
  return bindings.length > 0 && bindings.every((binding) => binding.startsWith("type "));
}

export function moduleImportRecords(source) {
  const records = [];
  const staticImports = /(^|\n)\s*import\s+(?!\()([\s\S]*?);/g;
  for (const match of source.matchAll(staticImports)) {
    const statement = match[2].trim();
    const sideEffect = statement.match(/^["']([^"']+)["']$/);
    if (sideEffect) {
      records.push({ specifier: sideEffect[1], kind: "runtime" });
      continue;
    }
    const from = statement.match(/^([\s\S]*?)\s+from\s+["']([^"']+)["']$/);
    if (!from) continue;
    records.push({
      specifier: from[2],
      kind: clauseIsTypeOnly(from[1]) ? "type" : "runtime",
    });
  }

  const reExports = /(^|\n)\s*export\s+((?:type\s+)?(?:\{|\*)[\s\S]*?\s+from\s+["'][^"']+["'])\s*;/g;
  for (const match of source.matchAll(reExports)) {
    const statement = match[2].trim();
    const from = statement.match(/^([\s\S]*?)\s+from\s+["']([^"']+)["']$/);
    if (!from) continue;
    records.push({
      specifier: from[2],
      kind: clauseIsTypeOnly(from[1]) ? "type" : "runtime",
    });
  }

  for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    records.push({ specifier: match[1], kind: "runtime" });
  }
  return records;
}

function resolveSourceModule(importer, specifier, knownFiles) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(importer), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.js`,
    resolve(base, "index.ts"),
    resolve(base, "index.js"),
  ];
  return candidates.find((candidate) => knownFiles.has(candidate)) ?? null;
}

export function buildSourceImportGraph(sourceRoot, { include = () => true } = {}) {
  const files = sourceFiles(sourceRoot).filter(include);
  const knownFiles = new Set(files.map((file) => resolve(file)));
  const runtime = new Map(files.map((file) => [resolve(file), new Set()]));
  const type = new Map(files.map((file) => [resolve(file), new Set()]));
  const imports = [];

  for (const file of files) {
    const absolute = resolve(file);
    const source = readFileSync(absolute, "utf8");
    for (const record of moduleImportRecords(source)) {
      const target = resolveSourceModule(absolute, record.specifier, knownFiles);
      imports.push({ importer: absolute, target, ...record });
      if (target) {
        (record.kind === "runtime" ? runtime : type).get(absolute).add(target);
      }
    }
  }
  return { files: knownFiles, imports, runtime, type };
}

export function stronglyConnectedComponents(graph, sourceRoot) {
  let nextIndex = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  function visit(node) {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of graph.get(node) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(target)));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(target)));
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(normalizePath(relative(sourceRoot, member)));
    } while (member !== node);
    components.push(component.sort());
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node);
  }
  return components
    .filter((component) => component.length > 1)
    .sort((left, right) => right.length - left.length || left[0].localeCompare(right[0]));
}

export function repositoryPath(root, file) {
  return normalizePath(relative(root, file));
}

export function existingSourceFile(pathname) {
  return existsSync(pathname);
}
