import "./generate-guides.mjs";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fillCircle,
  readPng,
  writeRgbaPng,
} from "./png-tools.mjs";

// The color-space guide must keep the exact destination color underneath each
// target. generate-guides.mjs draws a center dot for the accumulation guide;
// restore the four color-test centers before shipping the asset.
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const colorGuidePath = join(
  dirname(scriptDirectory),
  "guides",
  "02-color-space-guide.png",
);
const colorGuide = readPng(colorGuidePath);
const destinations = [
  { x: 200, color: [0, 0, 0, 0] },
  { x: 600, color: [0, 0, 0, 255] },
  { x: 1000, color: [255, 255, 255, 255] },
  { x: 1400, color: [0, 255, 0, 255] },
];
for (const destination of destinations) {
  fillCircle(colorGuide, destination.x, 300, 12, destination.color);
}
writeRgbaPng(colorGuidePath, colorGuide);
