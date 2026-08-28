import assert from "node:assert/strict";
import { cp, readFile, stat } from "node:fs/promises";

const labsDirectory = new URL("../dist-labs/", import.meta.url);
const labsAssetsDirectory = new URL("assets/", labsDirectory);
const labsHtmlFile = new URL("labs.html", labsDirectory);
const gpuDiagnosticsDirectory = new URL("../dist-gpu-diagnostics/", import.meta.url);
const gpuDiagnosticsAssetsDirectory = new URL("assets/", gpuDiagnosticsDirectory);
const gpuDiagnosticsHtmlFile = new URL("gpu-startup-diagnostics.html", gpuDiagnosticsDirectory);
const siteClientDirectory = new URL("../dist/client/", import.meta.url);
const siteAssetsDirectory = new URL("assets/", siteClientDirectory);
const siteLabsHtmlFile = new URL("labs.html", siteClientDirectory);
const siteGpuDiagnosticsHtmlFile = new URL("gpu-startup-diagnostics.html", siteClientDirectory);

await stat(labsHtmlFile);
await stat(labsAssetsDirectory);
await stat(gpuDiagnosticsHtmlFile);
await stat(gpuDiagnosticsAssetsDirectory);
await stat(siteClientDirectory);

await cp(labsAssetsDirectory, siteAssetsDirectory, { recursive: true, force: true });
await cp(labsHtmlFile, siteLabsHtmlFile, { force: true });
await cp(gpuDiagnosticsAssetsDirectory, siteAssetsDirectory, { recursive: true, force: true });
await cp(gpuDiagnosticsHtmlFile, siteGpuDiagnosticsHtmlFile, { force: true });

const labsHtml = await readFile(siteLabsHtmlFile, "utf8");
assert.match(labsHtml, /src="\.\/assets\/[^\"]+\.js"/);
assert.match(labsHtml, /href="\.\/assets\/[^\"]+\.css"/);

const gpuDiagnosticsHtml = await readFile(siteGpuDiagnosticsHtmlFile, "utf8");
assert.match(gpuDiagnosticsHtml, /inline-bootstrap-started/);
assert.match(gpuDiagnosticsHtml, /src="\.\/assets\/[^\"]+\.js"/);

console.log("Laboratory surfaces attached to the Sites build.");
