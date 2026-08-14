import "./build-guides.mjs";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPng, writeRgbaPng } from "./png-tools.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const path = join(dirname(scriptDirectory), "guides", "02-color-space-guide.png");
const image = readPng(path);
const centers = [
  { x: 200, rgba: [0, 0, 0, 0] },
  { x: 600, rgba: [0, 0, 0, 255] },
  { x: 1000, rgba: [255, 255, 255, 255] },
  { x: 1400, rgba: [0, 255, 0, 255] },
];

for (const center of centers) {
  const radius = 12;
  for (let y = 300 - radius; y <= 300 + radius; y += 1) {
    for (let x = center.x - radius; x <= center.x + radius; x += 1) {
      const dx = x + 0.5 - center.x;
      const dy = y + 0.5 - 300;
      if (dx * dx + dy * dy > radius * radius) continue;
      const offset = (y * image.width + x) * 4;
      image.pixels[offset] = center.rgba[0];
      image.pixels[offset + 1] = center.rgba[1];
      image.pixels[offset + 2] = center.rgba[2];
      image.pixels[offset + 3] = center.rgba[3];
    }
  }
}

writeRgbaPng(path, image);
