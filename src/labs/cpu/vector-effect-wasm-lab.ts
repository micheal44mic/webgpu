import complexVectorFixture from "../../vector-stress/fixtures/complex-curved-strokes.svg?raw";
import {
  compileVectorTextEffect,
  VectorTextCanonicalFillCache,
  type VectorTextEffectDescription,
  type VectorTextGpuMeshData,
} from "../../vector-text-effect-geometry";
import { vectorTextLodForSigma } from "../../vector-text-lod";
import { parseVectorSvg } from "../../vector-svg-import";
import { createVectorGeometryKernel } from "../../../wasm/vector-geometry-kernel/runtime.mjs";

interface TimedMesh {
  readonly totalMs: number;
  readonly kernelMs: number | null;
  readonly mesh: VectorTextGpuMeshData | null;
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))];
}

function hashBytes(bytes: Uint8Array): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const value of bytes) {
    first = Math.imul(first ^ value, 0x01000193) >>> 0;
    second = Math.imul(second ^ (value + 0x9d), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function triangleArea(mesh: VectorTextGpuMeshData): number {
  let sum = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const a = mesh.indices[offset] * 2;
    const b = mesh.indices[offset + 1] * 2;
    const c = mesh.indices[offset + 2] * 2;
    sum += Math.abs(
      (mesh.vertices[b] - mesh.vertices[a])
        * (mesh.vertices[c + 1] - mesh.vertices[a + 1])
      - (mesh.vertices[b + 1] - mesh.vertices[a + 1])
        * (mesh.vertices[c] - mesh.vertices[a]),
    ) * 0.5;
  }
  return sum;
}

function meshWitness(mesh: VectorTextGpuMeshData | null): Record<string, unknown> | null {
  if (!mesh) return null;
  return {
    vertexCount: mesh.vertices.length / 2,
    triangleCount: mesh.indices.length / 3,
    vertexHash: hashBytes(new Uint8Array(
      mesh.vertices.buffer,
      mesh.vertices.byteOffset,
      mesh.vertices.byteLength,
    )),
    triangleArea: triangleArea(mesh),
    bounds: [mesh.left, mesh.top, mesh.right, mesh.bottom],
    origin: [mesh.originX, mesh.originY],
  };
}

function witnessesMatch(
  left: VectorTextGpuMeshData | null,
  right: VectorTextGpuMeshData | null,
): boolean {
  if (!left || !right) return left === right;
  for (const key of [
    "left", "top", "right", "bottom", "originX", "originY", "lodBucket", "integerScale",
  ] as const) {
    if (left[key] !== right[key]) return false;
  }
  const leftArea = triangleArea(left);
  const rightArea = triangleArea(right);
  if (Math.abs(leftArea - rightArea) > Math.max(1e-6, leftArea * 1e-8)) {
    return false;
  }
  const vertexHash = (mesh: VectorTextGpuMeshData): string => hashBytes(new Uint8Array(
    mesh.vertices.buffer,
    mesh.vertices.byteOffset,
    mesh.vertices.byteLength,
  ));
  if (
    left.vertices.length === right.vertices.length
    && left.indices.length === right.indices.length
    && vertexHash(left) === vertexHash(right)
  ) {
    return true;
  }
  const covered = (mesh: VectorTextGpuMeshData, x: number, y: number): boolean => {
    const epsilon = 1e-7;
    for (let offset = 0; offset < mesh.indices.length; offset += 3) {
      const a = mesh.indices[offset] * 2;
      const b = mesh.indices[offset + 1] * 2;
      const c = mesh.indices[offset + 2] * 2;
      const ab = (mesh.vertices[b] - mesh.vertices[a]) * (y - mesh.vertices[a + 1])
        - (mesh.vertices[b + 1] - mesh.vertices[a + 1]) * (x - mesh.vertices[a]);
      const bc = (mesh.vertices[c] - mesh.vertices[b]) * (y - mesh.vertices[b + 1])
        - (mesh.vertices[c + 1] - mesh.vertices[b + 1]) * (x - mesh.vertices[b]);
      const ca = (mesh.vertices[a] - mesh.vertices[c]) * (y - mesh.vertices[c + 1])
        - (mesh.vertices[a + 1] - mesh.vertices[c + 1]) * (x - mesh.vertices[c]);
      if (
        (ab >= -epsilon && bc >= -epsilon && ca >= -epsilon)
        || (ab <= epsilon && bc <= epsilon && ca <= epsilon)
      ) {
        return true;
      }
    }
    return false;
  };
  const steps = 19;
  for (let row = 0; row < steps; row += 1) {
    for (let column = 0; column < steps; column += 1) {
      const x = left.left + (left.right - left.left) * (column + 0.371) / steps;
      const y = left.top + (left.bottom - left.top) * (row + 0.619) / steps;
      if (covered(left, x, y) !== covered(right, x, y)) return false;
    }
  }
  return true;
}

function requestedRunCount(): number {
  const value = Number(new URLSearchParams(window.location.search).get("runs"));
  return Number.isSafeInteger(value) ? Math.max(3, Math.min(15, value)) : 7;
}

export async function runVectorEffectWasmBenchmark(): Promise<unknown> {
  const fixtureStartedAt = performance.now();
  const documentValue = parseVectorSvg(complexVectorFixture, "vector-effect-benchmark.svg");
  const fixtureParseMs = performance.now() - fixtureStartedAt;
  const path = documentValue.silhouettePath;
  const lod = vectorTextLodForSigma(1);
  const effects: readonly VectorTextEffectDescription[] = [
    { kind: "source-fill" },
    { kind: "source-outline", width: 4, join: "round" },
    { kind: "block", vectorX: 14, vectorY: 10 },
    { kind: "block-outline", vectorX: -11, vectorY: 13, width: 2.5, join: "round" },
  ];
  const initializationStartedAt = performance.now();
  const kernel = await createVectorGeometryKernel();
  const initializationMs = performance.now() - initializationStartedAt;
  const registrationStartedAt = performance.now();
  kernel.registerPath(1, path);
  const registrationMs = performance.now() - registrationStartedAt;
  const jsCache = new VectorTextCanonicalFillCache();
  const jsTimes: number[] = [];
  const wasmTimes: number[] = [];
  const wasmKernelTimes: number[] = [];
  const comparisons: Array<Record<string, unknown>> = [];
  const parityByEffect = new Map<number, boolean>();
  const runs = requestedRunCount();

  const runJs = (effect: VectorTextEffectDescription, revision: string): TimedMesh => {
    const startedAt = performance.now();
    const isOutline = effect.kind === "source-outline" || effect.kind === "block-outline";
    const canonicalFill = !isOutline || effect.width > 0
      ? jsCache.getOrCreate("complex-vector-fixture", path, lod, isOutline ? effect.width : 0)
      : undefined;
    const mesh = compileVectorTextEffect(path, lod, effect, revision, canonicalFill);
    return { mesh, totalMs: performance.now() - startedAt, kernelMs: null };
  };
  const runWasm = (effect: VectorTextEffectDescription, revision: string): TimedMesh => {
    const startedAt = performance.now();
    const result = kernel.compileRegistered(1, lod, effect, revision);
    return {
      mesh: result.mesh,
      totalMs: performance.now() - startedAt,
      kernelMs: result.computeMs,
    };
  };

  try {
    for (let run = 0; run < runs; run += 1) {
      for (let effectIndex = 0; effectIndex < effects.length; effectIndex += 1) {
        const effect = effects[effectIndex];
        const revision = `vector-effect-wasm-lab:${run}:${effectIndex}`;
        let js: TimedMesh;
        let wasm: TimedMesh;
        if ((run + effectIndex) % 2 === 0) {
          js = runJs(effect, revision);
          wasm = runWasm(effect, revision);
        } else {
          wasm = runWasm(effect, revision);
          js = runJs(effect, revision);
        }
        jsTimes.push(js.totalMs);
        wasmTimes.push(wasm.totalMs);
        wasmKernelTimes.push(wasm.kernelMs ?? 0);
        const parity = parityByEffect.get(effectIndex)
          ?? witnessesMatch(js.mesh, wasm.mesh);
        parityByEffect.set(effectIndex, parity);
        comparisons.push({
          run,
          effect: effect.kind,
          passed: parity,
          javascriptMs: js.totalMs,
          wasmTotalMs: wasm.totalMs,
          wasmKernelMs: wasm.kernelMs,
          javascript: meshWitness(js.mesh),
          wasm: meshWitness(wasm.mesh),
        });
      }
    }
  } finally {
    kernel.releasePath(1);
  }

  const javascriptMedianMs = percentile(jsTimes, 0.5);
  const wasmMedianMs = percentile(wasmTimes, 0.5);
  const passed = comparisons.every((value) => value.passed === true);
  return {
    lab: "vector-effect-wasm",
    version: 1,
    passed,
    strictRuntimeFallback: false,
    workload: {
      fixtureBytes: new TextEncoder().encode(complexVectorFixture).byteLength,
      fixtureParseMs,
      commandCount: documentValue.commandCount,
      contourCount: documentValue.contourCount,
      inputBytes: path.verbs.byteLength + path.coords.byteLength + path.contourOffsets.byteLength,
      runs,
      effects: effects.map((effect) => effect.kind),
    },
    startup: {
      initializationMs,
      registrationMs,
      wasmByteLength: kernel.wasmByteLength,
    },
    timing: {
      javascriptMedianMs,
      javascriptP95Ms: percentile(jsTimes, 0.95),
      wasmTotalMedianMs: wasmMedianMs,
      wasmTotalP95Ms: percentile(wasmTimes, 0.95),
      wasmKernelMedianMs: percentile(wasmKernelTimes, 0.5),
      wasmKernelP95Ms: percentile(wasmKernelTimes, 0.95),
      speedup: wasmMedianMs > 0 ? javascriptMedianMs / wasmMedianMs : null,
      savedPercent: javascriptMedianMs > 0
        ? (javascriptMedianMs - wasmMedianMs) / javascriptMedianMs * 100
        : null,
    },
    memory: kernel.diagnostics(),
    canonicalReferenceCache: jsCache.diagnostics(),
    comparisons,
  };
}
