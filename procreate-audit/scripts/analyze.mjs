import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPng, rgbaAt } from "./png-tools.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const auditDirectory = dirname(scriptDirectory);
const defaultExportDirectory = join(auditDirectory, "exports");
const colorGuidePath = join(auditDirectory, "guides", "02-color-space-guide.png");

const ACCUMULATION_TARGETS = [
  { id: "C1", x: 200, y: 240 },
  { id: "C2", x: 600, y: 240 },
  { id: "C4", x: 1000, y: 240 },
  { id: "G1", x: 200, y: 640 },
  { id: "G2", x: 600, y: 640 },
  { id: "G4", x: 1000, y: 640 },
];

const COLOR_TARGETS = [
  { id: "whiteOnTransparent", x: 200, y: 300 },
  { id: "whiteOnBlack", x: 600, y: 300 },
  { id: "blackOnWhite", x: 1000, y: 300 },
  { id: "redOnGreen", x: 1400, y: 300 },
];

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function patchMedian(image, centerX, centerY, radius = 6) {
  const channels = [[], [], [], []];
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const rgba = rgbaAt(image, x, y);
      for (let channel = 0; channel < 4; channel += 1) {
        channels[channel].push(rgba[channel]);
      }
    }
  }
  return channels.map(median);
}

function patchAverageAlpha(image, centerX, centerY, radius = 6) {
  let total = 0;
  let count = 0;
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      total += rgbaAt(image, x, y)[3];
      count += 1;
    }
  }
  return total / count;
}

function findBestAlphaPatch(image, targetX, targetY) {
  let best = { x: targetX, y: targetY, score: -1 };
  for (let y = targetY - 100; y <= targetY + 100; y += 3) {
    for (let x = targetX - 100; x <= targetX + 100; x += 3) {
      const score = patchAverageAlpha(image, x, y);
      if (score > best.score) {
        best = { x, y, score };
      }
    }
  }
  return {
    ...best,
    rgba: patchMedian(image, best.x, best.y),
  };
}

function patchDifference(output, baseline, centerX, centerY, radius = 6) {
  let total = 0;
  let count = 0;
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const actual = rgbaAt(output, x, y);
      const original = rgbaAt(baseline, x, y);
      for (let channel = 0; channel < 4; channel += 1) {
        total += Math.abs(actual[channel] - original[channel]);
      }
      count += 4;
    }
  }
  return total / count;
}

function findBestChangedPatch(output, baseline, targetX, targetY) {
  let best = { x: targetX, y: targetY, score: -1 };
  for (let y = targetY - 95; y <= targetY + 95; y += 3) {
    for (let x = targetX - 95; x <= targetX + 95; x += 3) {
      const score = patchDifference(output, baseline, x, y);
      if (score > best.score) {
        best = { x, y, score };
      }
    }
  }
  return {
    ...best,
    rgba: patchMedian(output, best.x, best.y),
    baselineRgba: patchMedian(baseline, best.x, best.y),
  };
}

function rootMeanSquareError(actual, expected) {
  const squared = actual.map((value, index) => {
    const difference = value - expected[index];
    return difference * difference;
  });
  return Math.sqrt(squared.reduce((sum, value) => sum + value, 0) / squared.length);
}

function sourceOverAlpha(alpha, count) {
  return 1 - (1 - alpha) ** count;
}

function classifyAccumulation(values) {
  const measured = [values.C1[3], values.C2[3], values.C4[3]];
  const exactModels = [
    { id: "M1-per-stamp-source-over-no-cap", expected: [64, 112, 174] },
    { id: "M2-per-stamp-source-over-opacity-cap", expected: [64, 112, 128] },
    { id: "M3-stroke-buffer-source-over-then-opacity-scale", expected: [64, 96, 120] },
    { id: "M4-max-deposit-then-opacity-scale", expected: [64, 64, 64] },
    { id: "M5-stroke-buffer-source-over-then-hard-cap", expected: [128, 128, 128] },
    { id: "M6-additive-buffer-then-opacity-scale", expected: [64, 128, 128] },
  ].map((model) => ({
    ...model,
    rmseBytes: rootMeanSquareError(measured, model.expected),
  })).sort((a, b) => a.rmseBytes - b.rmseBytes);

  const opacity = 0.5;
  const first = measured[0] / 255;
  const inferredRawFlow = clamp(first / opacity, 0, 1);
  const adaptiveModels = [
    {
      id: "per-stamp-source-over-from-observed-C1",
      expected: [1, 2, 4].map((count) =>
        Math.round(sourceOverAlpha(first, count) * 255)),
    },
    {
      id: "per-stamp-source-over-with-50pct-cap-from-observed-C1",
      expected: [1, 2, 4].map((count) =>
        Math.round(Math.min(opacity, sourceOverAlpha(first, count)) * 255)),
    },
    {
      id: "stroke-buffer-scale-from-observed-C1",
      expected: [1, 2, 4].map((count) =>
        Math.round(opacity * sourceOverAlpha(inferredRawFlow, count) * 255)),
    },
    {
      id: "max-from-observed-C1",
      expected: [measured[0], measured[0], measured[0]],
    },
    {
      id: "additive-from-observed-C1",
      expected: [1, 2, 4].map((count) =>
        Math.round(Math.min(1, first * count) * 255)),
    },
  ].map((model) => ({
    ...model,
    rmseBytes: rootMeanSquareError(measured, model.expected),
  })).sort((a, b) => a.rmseBytes - b.rmseBytes);

  const gestureFirst = values.G1[3] / 255;
  const gestureExpected = [1, 2, 4].map((count) =>
    Math.round(sourceOverAlpha(gestureFirst, count) * 255));
  const gestureMeasured = [values.G1[3], values.G2[3], values.G4[3]];

  return {
    measuredBytes: {
      sameGestureCount: measured,
      separateGestures: gestureMeasured,
    },
    exactFiftyPercentModelRanking: exactModels,
    observedSingleStampModelRanking: adaptiveModels,
    separateGestureSourceOverCheck: {
      expectedBytesFromG1: gestureExpected,
      measuredBytes: gestureMeasured,
      rmseBytes: rootMeanSquareError(gestureMeasured, gestureExpected),
    },
  };
}

function validateTransparentAccumulation(image) {
  if (image.width !== 1200 || image.height !== 800) {
    throw new Error(
      `${image.path}: dimensioni ${image.width}x${image.height}; attese 1200x800.`,
    );
  }
  const corners = [
    rgbaAt(image, 4, 4)[3],
    rgbaAt(image, image.width - 5, 4)[3],
    rgbaAt(image, 4, image.height - 5)[3],
    rgbaAt(image, image.width - 5, image.height - 5)[3],
  ];
  if (Math.max(...corners) > 8) {
    throw new Error(
      `${image.path}: il fondo o la guida sembrano visibili. Esporta solo il layer TEST con Background Color e guida nascosti.`,
    );
  }
}

function analyzeAccumulation(image) {
  validateTransparentAccumulation(image);
  const samples = {};
  const sampleLocations = {};
  for (const target of ACCUMULATION_TARGETS) {
    const best = findBestAlphaPatch(image, target.x, target.y);
    if (best.rgba[3] === 0) {
      throw new Error(`${image.path}: nessun segno trovato nella casella ${target.id}.`);
    }
    samples[target.id] = best.rgba;
    sampleLocations[target.id] = {
      x: best.x,
      y: best.y,
      rgba: best.rgba,
    };
  }
  return {
    kind: "accumulation",
    file: image.path,
    png: {
      width: image.width,
      height: image.height,
      bitDepth: image.bitDepth,
      colorType: image.colorType,
      chunks: image.chunks,
    },
    samples: sampleLocations,
    classification: classifyAccumulation(samples),
  };
}

function srgbEncode(linear) {
  const value = clamp(linear, 0, 1);
  if (value <= 0.0031308) return value * 12.92;
  return 1.055 * value ** (1 / 2.4) - 0.055;
}

function colorSpacePrediction(alpha, mode) {
  const encode = mode === "linear" ? srgbEncode : (value) => value;
  const whiteOnBlack = Math.round(encode(alpha) * 255);
  const blackOnWhite = Math.round(encode(1 - alpha) * 255);
  return {
    whiteOnBlack: [whiteOnBlack, whiteOnBlack, whiteOnBlack],
    blackOnWhite: [blackOnWhite, blackOnWhite, blackOnWhite],
    redOnGreen: [whiteOnBlack, blackOnWhite, 0],
  };
}

function flattenPrediction(prediction) {
  return [
    ...prediction.whiteOnBlack,
    ...prediction.blackOnWhite,
    ...prediction.redOnGreen,
  ];
}

function analyzeColorSpace(image) {
  const baseline = readPng(colorGuidePath);
  if (image.width !== baseline.width || image.height !== baseline.height) {
    throw new Error(
      `${image.path}: dimensioni ${image.width}x${image.height}; attese ${baseline.width}x${baseline.height}.`,
    );
  }

  const samples = {};
  for (const target of COLOR_TARGETS) {
    const best = findBestChangedPatch(image, baseline, target.x, target.y);
    if (best.score < 1) {
      throw new Error(`${image.path}: nessuna pittura rilevata nel target ${target.id}.`);
    }
    samples[target.id] = {
      x: best.x,
      y: best.y,
      rgba: best.rgba,
      before: best.baselineRgba,
      meanAbsoluteChange: best.score,
    };
  }

  const alphaByte = samples.whiteOnTransparent.rgba[3];
  const alpha = alphaByte / 255;
  const measured = [
    ...samples.whiteOnBlack.rgba.slice(0, 3),
    ...samples.blackOnWhite.rgba.slice(0, 3),
    ...samples.redOnGreen.rgba.slice(0, 3),
  ];
  const candidates = ["gamma", "linear"].map((mode) => {
    const prediction = colorSpacePrediction(alpha, mode);
    return {
      mode,
      alphaFromTransparentStamp: alpha,
      alphaByte,
      expected: prediction,
      rmseBytes: rootMeanSquareError(measured, flattenPrediction(prediction)),
    };
  }).sort((a, b) => a.rmseBytes - b.rmseBytes);

  return {
    kind: "color-space",
    file: image.path,
    png: {
      width: image.width,
      height: image.height,
      bitDepth: image.bitDepth,
      colorType: image.colorType,
      chunks: image.chunks,
    },
    samples,
    measuredRgb: {
      whiteOnBlack: samples.whiteOnBlack.rgba.slice(0, 3),
      blackOnWhite: samples.blackOnWhite.rgba.slice(0, 3),
      redOnGreen: samples.redOnGreen.rgba.slice(0, 3),
    },
    modelRanking: candidates,
  };
}

function discoverInputs(arguments_) {
  if (arguments_.length > 0) {
    return arguments_.map((path) => resolve(path));
  }
  if (!existsSync(defaultExportDirectory)) return [];
  return readdirSync(defaultExportDirectory)
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .map((name) => join(defaultExportDirectory, name));
}

function printHumanSummary(report) {
  process.stdout.write("\n=== PROCREATE PIXEL AUDIT ===\n");
  for (const result of report.results) {
    process.stdout.write(`\n${basename(result.file)}\n`);
    if (result.kind === "accumulation") {
      const measured = result.classification.measuredBytes;
      const best = result.classification.observedSingleStampModelRanking[0];
      process.stdout.write(
        `  Count nella stessa gesture C1/C2/C4: ${measured.sameGestureCount.join(" / ")}\n`,
      );
      process.stdout.write(
        `  Gesture separate G1/G2/G4:       ${measured.separateGestures.join(" / ")}\n`,
      );
      process.stdout.write(
        `  Miglior candidato: ${best.id} (RMSE ${best.rmseBytes.toFixed(2)} byte)\n`,
      );
      process.stdout.write(
        `  Check source-over tra gesture: RMSE ${result.classification.separateGestureSourceOverCheck.rmseBytes.toFixed(2)} byte\n`,
      );
    } else {
      const best = result.modelRanking[0];
      process.stdout.write(
        `  Alpha stamp trasparente: ${best.alphaByte}/255 (${(best.alphaFromTransparentStamp * 100).toFixed(2)}%)\n`,
      );
      process.stdout.write(
        `  Miglior spazio colore: ${best.mode} (RMSE ${best.rmseBytes.toFixed(2)} byte)\n`,
      );
      process.stdout.write(
        `  RGB misurati: ${JSON.stringify(result.measuredRgb)}\n`,
      );
    }
  }
  process.stdout.write(`\nReport JSON: ${report.outputPath}\n`);
}

const inputs = discoverInputs(process.argv.slice(2));
if (inputs.length === 0) {
  process.stderr.write(
    `Nessun PNG trovato. Copia gli export in ${defaultExportDirectory} oppure passali come argomenti.\n`,
  );
  process.exitCode = 1;
} else {
  const results = [];
  for (const input of inputs) {
    const image = readPng(input);
    if (image.width === 1200 && image.height === 800) {
      results.push(analyzeAccumulation(image));
    } else if (image.width === 1600 && image.height === 500) {
      results.push(analyzeColorSpace(image));
    } else {
      throw new Error(
        `${input}: dimensioni ${image.width}x${image.height} non riconosciute.`,
      );
    }
  }

  const outputDirectory = dirname(inputs[0]);
  const outputPath = join(outputDirectory, "procreate-analysis.json");
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    inputs,
    results,
    outputPath,
    caveat:
      "Count testa repliche nello stesso punto. Una seconda fase con overlap spaziali reali resta necessaria prima di dichiarare equivalenza completa.",
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  printHumanSummary(report);
}
