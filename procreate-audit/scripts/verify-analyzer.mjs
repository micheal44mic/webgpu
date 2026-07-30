import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createRgbaImage,
  fillCircle,
  readPng,
  writeRgbaPng,
} from "./png-tools.mjs";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "procreate-audit-"));
const accumulationPath = join(temporaryDirectory, "synthetic-light-glaze.png");
const colorPath = join(temporaryDirectory, "synthetic-color-space.png");

const accumulation = createRgbaImage(1200, 800, [0, 0, 0, 0]);
const accumulationSamples = [
  { x: 200, y: 240, alpha: 64 },
  { x: 600, y: 240, alpha: 64 },
  { x: 1000, y: 240, alpha: 64 },
  { x: 200, y: 640, alpha: 64 },
  { x: 600, y: 640, alpha: 112 },
  { x: 1000, y: 640, alpha: 174 },
];
for (const sample of accumulationSamples) {
  fillCircle(
    accumulation,
    sample.x + 7,
    sample.y - 5,
    55,
    [255, 255, 255, sample.alpha],
  );
}
writeRgbaPng(accumulationPath, accumulation);

const colorGuide = readPng(
  new URL("../guides/02-color-space-guide.png", import.meta.url),
);
const colorSamples = [
  { x: 200, rgba: [255, 255, 255, 128] },
  { x: 600, rgba: [128, 128, 128, 255] },
  { x: 1000, rgba: [128, 128, 128, 255] },
  { x: 1400, rgba: [128, 128, 0, 255] },
];
for (const sample of colorSamples) {
  const radius = 55;
  for (let y = 300 - radius; y <= 300 + radius; y += 1) {
    for (let x = sample.x - radius; x <= sample.x + radius; x += 1) {
      const dx = x + 0.5 - sample.x;
      const dy = y + 0.5 - 300;
      if (dx * dx + dy * dy > radius * radius) continue;
      const offset = (y * colorGuide.width + x) * 4;
      colorGuide.pixels.set(sample.rgba, offset);
    }
  }
}
writeRgbaPng(colorPath, colorGuide);

const analyzerPath = fileURLToPath(new URL("./analyze.mjs", import.meta.url));
const run = spawnSync(
  process.execPath,
  [analyzerPath, accumulationPath, colorPath],
  { encoding: "utf8" },
);
if (run.status !== 0) {
  process.stderr.write(run.stdout ?? "");
  process.stderr.write(run.stderr ?? "");
  process.exit(run.status ?? 1);
}

const report = JSON.parse(
  readFileSync(join(temporaryDirectory, "procreate-analysis.json"), "utf8"),
);
const accumulationResult = report.results.find(
  (result) => result.kind === "accumulation",
);
const colorResult = report.results.find((result) => result.kind === "color-space");
const bestAccumulation =
  accumulationResult.classification.observedSingleStampModelRanking[0];
const bestColor = colorResult.modelRanking[0];

if (bestAccumulation.id !== "max-from-observed-C1" || bestAccumulation.rmseBytes !== 0) {
  throw new Error(`Classificazione MAX errata: ${JSON.stringify(bestAccumulation)}`);
}
if (bestColor.mode !== "gamma" || bestColor.rmseBytes !== 0) {
  throw new Error(`Classificazione gamma errata: ${JSON.stringify(bestColor)}`);
}

process.stdout.write(run.stdout);
process.stdout.write(`\nVerifier PASS. Fixture temporanee: ${temporaryDirectory}\n`);
