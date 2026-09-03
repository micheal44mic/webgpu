import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginStrokeGeometryJs,
  instantiateStrokeGeometryKernel,
  processStrokeGeometryJs,
} from "../wasm/stroke-geometry-kernel/runtime.mjs";
import { verifyStrokeGeometryArtifactFreshness } from "./stroke-geometry-artifact.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { wasmBytes } = await verifyStrokeGeometryArtifactFreshness();
const initializationStartedAt = performance.now();
const kernel = await instantiateStrokeGeometryKernel(wasmBytes);
const initializationMs = performance.now() - initializationStartedAt;
let fixture = createBuiltInFixture();
let fixtureSource = "checked deterministic fixture";
const requestedFixturePath = process.env.STROKE_GEOMETRY_FIXTURE_PATH;
if (requestedFixturePath) {
  const resolvedFixturePath = resolve(repositoryRoot, requestedFixturePath);
  fixture = JSON.parse(await readFile(resolvedFixturePath, "utf8"));
  fixtureSource = resolvedFixturePath;
}
const fixtureSpacing = Math.max(
  0.1,
  fixture.settings.size * fixture.settings.spacingPercent / 100,
);

const median = (values) => [...values].sort((left, right) => left - right)[
  Math.floor(values.length / 2)
];

function measure(operation, runs = 11) {
  for (let index = 0; index < 4; index += 1) operation();
  const durations = [];
  let result = null;
  for (let run = 0; run < runs; run += 1) {
    const startedAt = performance.now();
    result = operation();
    durations.push(performance.now() - startedAt);
  }
  return { durationMs: median(durations), result };
}

const synthetic = (count, frequencyHz) => Array.from({ length: count }, (_, index) => ({
  x: index * 0.8,
  y: 200 + Math.sin(index * 0.021) * 90 + Math.sin(index * 0.071) * 8,
  pressure: 0.52 + Math.sin(index * 0.013) * 0.43,
  timeMs: index * 1000 / frequencyHz,
}));

const scenarios = [
  ...[0, 0.5, 1].map((stabilization) => ({
    label: `canonical · stabilization ${Math.round(stabilization * 100)}%`,
    samples: fixture.points,
    options: { stabilization, spacing: fixtureSpacing, batchSize: 16 },
  })),
  {
    label: "stress 4096 samples · 240 Hz · stabilization 100%",
    samples: synthetic(4096, 240),
    options: { stabilization: 1, spacing: 0.5, batchSize: 16 },
  },
  {
    label: "stress 4096 samples · 1000 Hz · stabilization 100%",
    samples: synthetic(4096, 1000),
    options: { stabilization: 1, spacing: 0.5, batchSize: 16 },
  },
  {
    label: "dense spacing 0.25 px · stabilization 100%",
    samples: synthetic(2048, 240),
    options: { stabilization: 1, spacing: 0.25, batchSize: 16 },
  },
];

console.log(
  `Stroke geometry module: ${wasmBytes.byteLength} bytes · initialization ${initializationMs.toFixed(3)} ms · ${fixtureSource} · ${fixture.points.length} points · size ${fixture.settings.size} · spacing ${fixture.settings.spacingPercent}%.`,
);
for (const scenario of scenarios) {
  const js = measure(() => processStrokeGeometryJs(scenario.samples, scenario.options));
  const wasm = measure(() => kernel.processStroke(scenario.samples, scenario.options));
  if (js.result.dabs.length !== wasm.result.dabs.length) {
    throw new Error(`${scenario.label}: benchmark backends emitted different dab counts.`);
  }
  const ratio = js.durationMs / wasm.durationMs;
  const savedMs = js.durationMs - wasm.durationMs;
  console.log(
    `${scenario.label}: JS ${js.durationMs.toFixed(3)} ms · `
    + `Wasm ${wasm.durationMs.toFixed(3)} ms · ${ratio.toFixed(2)}× · `
    + `${savedMs.toFixed(3)} ms saved · ${wasm.result.stats.totalDabs} dabs.`,
  );
}

const streamingScenarios = [
  {
    label: "canonical live · stabilization 100% · preview per 4 samples",
    samples: fixture.points,
    options: { stabilization: 1, spacing: fixtureSpacing },
    previewInterval: 4,
  },
  {
    label: "stress live 4096 · 240 Hz · stabilization 100% · preview per 4 samples",
    samples: synthetic(4096, 240),
    options: { stabilization: 1, spacing: 0.5 },
    previewInterval: 4,
  },
  {
    label: "stress live 4096 · 1000 Hz · stabilization 100% · preview per 16 samples",
    samples: synthetic(4096, 1000),
    options: { stabilization: 1, spacing: 0.5 },
    previewInterval: 16,
  },
];

console.log("Live streaming path (singleton processing; tail copied only for preview clones):");
for (const scenario of streamingScenarios) {
  const js = measure(
    () => runStreaming(beginStrokeGeometryJs, scenario),
    scenario.samples.length > 1000 ? 7 : 11,
  );
  const wasm = measure(
    () => runStreaming(kernel.begin, scenario),
    scenario.samples.length > 1000 ? 7 : 11,
  );
  if (js.result.totalDabs !== wasm.result.totalDabs) {
    throw new Error(`${scenario.label}: streaming backends emitted different dab counts.`);
  }
  const ratio = js.durationMs / wasm.durationMs;
  const savedMs = js.durationMs - wasm.durationMs;
  console.log(
    `${scenario.label}: JS ${js.durationMs.toFixed(3)} ms · `
    + `Wasm ${wasm.durationMs.toFixed(3)} ms · ${ratio.toFixed(2)}× · `
    + `${savedMs.toFixed(3)} ms saved · ${wasm.result.totalDabs} dabs · `
    + `checksum ${wasm.result.checksum.toFixed(3)}.`,
  );
}
console.log(`Retained Wasm linear memory: ${(kernel.memoryBytes() / 1048576).toFixed(2)} MiB.`);

function runStreaming(begin, scenario) {
  const { samples, options, previewInterval } = scenario;
  const session = begin(samples[0], {
    ...options,
    maximumBatchSize: 1,
  });
  let checksum = session.initialDab[0] + session.initialDab[1];
  for (let index = 1; index < samples.length; index += 1) {
    const includePreviewTail = index % previewInterval === 0 || index === samples.length - 1;
    const result = session.processBatch([samples[index]], {
      includePreviewTail,
      includeTail: false,
    });
    checksum += result.dabs.length + result.previewDabs.length;
    if (result.dabs.length > 0) checksum += result.dabs[result.dabs.length - 1];
    if (result.previewDabs.length > 0) {
      checksum += result.previewDabs[result.previewDabs.length - 1];
    }
  }
  const finished = session.finish();
  checksum += finished.dabs.length + finished.tail.length;
  return {
    checksum,
    totalDabs: finished.stats.totalDabs,
  };
}

function createBuiltInFixture() {
  const points = Array.from({ length: 257 }, (_, index) => {
    const phase = index / 256;
    return {
      x: 64 + phase * 1536 + Math.sin(phase * Math.PI * 7) * 83,
      y: 512 + Math.sin(phase * Math.PI * 3.5) * 270 + Math.sin(phase * Math.PI * 19) * 13,
      pressure: 0.08 + 0.88 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2.7 - 0.6)),
      timeMs: index * 1000 / 240,
    };
  });
  return {
    settings: { size: 72, spacingPercent: 4.5 },
    points,
  };
}
