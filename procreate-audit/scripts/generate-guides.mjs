import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRgbaImage,
  drawCenteredText,
  fillCircle,
  fillRect,
  strokeCircle,
  strokeRect,
  writeRgbaPng,
} from "./png-tools.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const auditDirectory = dirname(scriptDirectory);
const guideDirectory = join(auditDirectory, "guides");
mkdirSync(guideDirectory, { recursive: true });

const WHITE = [244, 247, 255, 255];
const MUTED = [154, 167, 196, 255];
const BLUE = [94, 123, 255, 255];
const GREEN = [82, 214, 151, 255];
const RED = [255, 91, 110, 255];

function drawTarget(image, centerX, centerY, color, centerDot = true) {
  strokeCircle(image, centerX, centerY, 78, 5, color);
  fillRect(image, centerX - 3, centerY - 104, 6, 18, color);
  fillRect(image, centerX - 3, centerY + 86, 6, 18, color);
  fillRect(image, centerX - 104, centerY - 3, 18, 6, color);
  fillRect(image, centerX + 86, centerY - 3, 18, 6, color);
  if (centerDot) {
    fillCircle(image, centerX, centerY, 5, color);
  }
}

function createAccumulationGuide() {
  const image = createRgbaImage(1200, 800, [12, 17, 28, 255]);
  fillRect(image, 0, 0, 1200, 84, [18, 25, 40, 255]);
  fillRect(image, 0, 400, 1200, 76, [18, 25, 40, 255]);
  drawCenteredText(
    image,
    "ONE GESTURE - CHANGE COUNT - ONE TAP",
    600,
    24,
    5,
    WHITE,
  );
  drawCenteredText(
    image,
    "SEPARATE GESTURES - COUNT 1 - LIFT EACH TAP",
    600,
    424,
    4,
    WHITE,
  );

  const cells = [
    { x: 0, y: 84, label: "C1", centerX: 200, centerY: 240, accent: BLUE },
    { x: 400, y: 84, label: "C2", centerX: 600, centerY: 240, accent: BLUE },
    { x: 800, y: 84, label: "C4", centerX: 1000, centerY: 240, accent: BLUE },
    { x: 0, y: 476, label: "G1", centerX: 200, centerY: 640, accent: GREEN },
    { x: 400, y: 476, label: "G2", centerX: 600, centerY: 640, accent: GREEN },
    { x: 800, y: 476, label: "G4", centerX: 1000, centerY: 640, accent: GREEN },
  ];

  for (const cell of cells) {
    fillRect(image, cell.x + 12, cell.y + 12, 376, 300, [23, 32, 50, 255]);
    strokeRect(image, cell.x + 12, cell.y + 12, 376, 300, 3, [46, 60, 88, 255]);
    drawCenteredText(image, cell.label, cell.centerX, cell.y + 28, 7, WHITE);
    drawTarget(image, cell.centerX, cell.centerY, cell.accent);
    const instruction = cell.label[0] === "C"
      ? `COUNT ${cell.label[1]} - 1 TAP`
      : `${cell.label[1]} SEPARATE TAPS`;
    drawCenteredText(image, instruction, cell.centerX, cell.y + 272, 3, MUTED);
  }

  return image;
}

function createColorSpaceGuide() {
  const image = createRgbaImage(1600, 500, [0, 0, 0, 0]);
  const cells = [
    {
      x: 0,
      background: [0, 0, 0, 0],
      label: "WHITE / TRANSPARENT",
      targetColor: BLUE,
    },
    {
      x: 400,
      background: [0, 0, 0, 255],
      label: "WHITE / BLACK",
      targetColor: WHITE,
    },
    {
      x: 800,
      background: [255, 255, 255, 255],
      label: "BLACK / WHITE",
      targetColor: [22, 29, 42, 255],
    },
    {
      x: 1200,
      background: [0, 255, 0, 255],
      label: "RED / GREEN",
      targetColor: [22, 29, 42, 255],
    },
  ];

  for (const cell of cells) {
    fillRect(image, cell.x, 0, 400, 500, cell.background);
    const darkLabel = cell.background[3] === 0
      || (cell.background[0] + cell.background[1] + cell.background[2]) < 500;
    const barColor = darkLabel ? [18, 25, 40, 235] : [232, 237, 247, 245];
    const textColor = darkLabel ? WHITE : [22, 29, 42, 255];
    fillRect(image, cell.x + 12, 12, 376, 78, barColor);
    strokeRect(image, cell.x + 12, 12, 376, 78, 3, cell.targetColor);
    drawCenteredText(image, cell.label, cell.x + 200, 39, 3, textColor);
    drawTarget(image, cell.x + 200, 300, cell.targetColor, false);
  }

  return image;
}

function createShapeSource(inverted = false) {
  const background = inverted ? [255, 255, 255, 255] : [0, 0, 0, 255];
  const foreground = inverted ? [0, 0, 0, 255] : [255, 255, 255, 255];
  const image = createRgbaImage(512, 512, background);
  fillCircle(image, 256, 256, 210, foreground);
  return image;
}

const outputs = [
  ["01-accumulation-guide.png", createAccumulationGuide()],
  ["02-color-space-guide.png", createColorSpaceGuide()],
  ["03-shape-hard-circle-white-on-black.png", createShapeSource(false)],
  ["04-shape-hard-circle-black-on-white.png", createShapeSource(true)],
];

for (const [name, image] of outputs) {
  const path = join(guideDirectory, name);
  writeRgbaPng(path, image);
  process.stdout.write(`${path}\n`);
}
