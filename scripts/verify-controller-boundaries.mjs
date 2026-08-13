import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const sourceRoot = new URL("../src/", import.meta.url);
const controllerFiles = readdirSync(sourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => name.endsWith("-controller.ts") || name.endsWith("-sheet.ts"));

assert.ok(controllerFiles.length >= 20, "The production controller inventory looks incomplete.");
for (const name of controllerFiles) {
  const source = readFileSync(new URL(name, sourceRoot), "utf8");
  assert.doesNotMatch(
    source,
    /(?<!\.)document\.(?:getElementById|querySelector|querySelectorAll)/,
    `${name} must not discover application DOM through the global document`,
  );
  assert.doesNotMatch(
    source,
    /(?<!\.)window\./,
    `${name} must receive browser services through an explicit port`,
  );
  assert.doesNotMatch(
    source,
    /(?<!\.)performance\.now\(/,
    `${name} must receive its clock through an explicit browser port`,
  );
}

const startup = readFileSync(new URL("startup.ts", sourceRoot), "utf8");
const homeStart = startup.indexOf("class ProjectHomeController");
const homeEnd = startup.indexOf("\nasync function boot", homeStart);
assert.ok(homeStart >= 0 && homeEnd > homeStart, "ProjectHomeController is not delimited.");
const homeController = startup.slice(homeStart, homeEnd);
assert.doesNotMatch(homeController, /(?<!\.)document\.(?:getElementById|querySelector|querySelectorAll)/);
assert.doesNotMatch(homeController, /(?<!\.)window\./);
assert.match(homeController, /root: ParentNode;[\s\S]*?browser: Window;[\s\S]*?document: Document;/);

console.log(`Controller boundaries verified for ${controllerFiles.length + 1} production owners.`);
