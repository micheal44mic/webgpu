import assert from "node:assert/strict";
import { copyFile, cp, mkdir, readFile, readdir, stat } from "node:fs/promises";

const labsDirectory = new URL("../dist-labs/", import.meta.url);
const labsAssetsDirectory = new URL("assets/", labsDirectory);
const labsHtmlFile = new URL("labs.html", labsDirectory);
const gpuDiagnosticsDirectory = new URL("../dist-gpu-diagnostics/", import.meta.url);
const gpuDiagnosticsAssetsDirectory = new URL("assets/", gpuDiagnosticsDirectory);
const gpuDiagnosticsHtmlFile = new URL("gpu-startup-diagnostics.html", gpuDiagnosticsDirectory);
const siteClientDirectory = new URL("../dist/client/", import.meta.url);
const siteAssetsDirectory = new URL("assets/", siteClientDirectory);
const siteLabsHtmlFile = new URL("labs.html", siteClientDirectory);

async function copyAssetsCollisionSafe(sourceDirectory, destinationDirectory) {
  await mkdir(destinationDirectory, { recursive: true });
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    const source = new URL(entry.name + (entry.isDirectory() ? "/" : ""), sourceDirectory);
    const destination = new URL(
      entry.name + (entry.isDirectory() ? "/" : ""),
      destinationDirectory,
    );
    if (entry.isDirectory()) {
      await copyAssetsCollisionSafe(source, destination);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported diagnostic asset entry: ${entry.name}`);
    }
    const sourceBytes = await readFile(source);
    let destinationBytes;
    try {
      destinationBytes = await readFile(destination);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await copyFile(source, destination);
      continue;
    }
    if (!sourceBytes.equals(destinationBytes)) {
      throw new Error(`Diagnostic asset collision has different bytes: ${entry.name}`);
    }
  }
}

await stat(labsHtmlFile);
await stat(labsAssetsDirectory);
await stat(gpuDiagnosticsHtmlFile);
await stat(gpuDiagnosticsAssetsDirectory);
await stat(siteClientDirectory);

await cp(labsAssetsDirectory, siteAssetsDirectory, { recursive: true, force: true });
await cp(labsHtmlFile, siteLabsHtmlFile, { force: true });
await copyAssetsCollisionSafe(gpuDiagnosticsAssetsDirectory, siteAssetsDirectory);

const labsHtml = await readFile(siteLabsHtmlFile, "utf8");
assert.match(labsHtml, /src="\.\/assets\/[^\"]+\.js"/);
assert.match(labsHtml, /href="\.\/assets\/[^\"]+\.css"/);

const gpuDiagnosticsHtml = await readFile(gpuDiagnosticsHtmlFile, "utf8");
assert.match(gpuDiagnosticsHtml, /inline-bootstrap-started/);
assert.match(gpuDiagnosticsHtml, /src="\.\/assets\/[^\"]+\.js"/);

console.log("Laboratory surfaces attached to the Sites build.");
