import assert from "node:assert/strict";
import { cp, readFile, stat } from "node:fs/promises";

const labsDirectory = new URL("../dist-labs/", import.meta.url);
const labsAssetsDirectory = new URL("assets/", labsDirectory);
const labsHtmlFile = new URL("labs.html", labsDirectory);
const siteClientDirectory = new URL("../dist/client/", import.meta.url);
const siteAssetsDirectory = new URL("assets/", siteClientDirectory);
const siteLabsHtmlFile = new URL("labs.html", siteClientDirectory);

await stat(labsHtmlFile);
await stat(labsAssetsDirectory);
await stat(siteClientDirectory);

await cp(labsAssetsDirectory, siteAssetsDirectory, { recursive: true, force: true });
await cp(labsHtmlFile, siteLabsHtmlFile, { force: true });

const labsHtml = await readFile(siteLabsHtmlFile, "utf8");
assert.match(labsHtml, /src="\.\/assets\/[^\"]+\.js"/);
assert.match(labsHtml, /href="\.\/assets\/[^\"]+\.css"/);

console.log("Human replay laboratory attached to the Sites build.");
