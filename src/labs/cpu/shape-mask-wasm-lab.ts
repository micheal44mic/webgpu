import shapeSourceUrl from "../../../Shape.png?url";
import { decodeGrayscalePng } from "../../png-mask";
import type {
  ShapeMaskBenchmarkBackend,
  ShapeMaskBenchmarkRequest,
  ShapeMaskBenchmarkResponse,
  ShapeMaskBenchmarkSuccess,
} from "./shape-mask-wasm-protocol";

const TARGET_SIZE = 2048;
const MEASURED_RUNS = 5;

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
}

function arraysEqual(left: Uint8Array | Uint16Array, right: Uint8Array | Uint16Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

class ShapeMaskBenchmarkWorkerClient {
  readonly #worker = new Worker(
    new URL("./shape-mask-wasm-worker.ts", import.meta.url),
    { type: "module" },
  );
  readonly #pending = new Map<number, {
    readonly resolve: (value: ShapeMaskBenchmarkSuccess) => void;
    readonly reject: (reason: Error) => void;
  }>();
  #sequence = 0;

  constructor() {
    this.#worker.onmessage = (event: MessageEvent<ShapeMaskBenchmarkResponse>) => {
      const response = event.data;
      const pending = this.#pending.get(response.id);
      if (!pending) return;
      this.#pending.delete(response.id);
      if (response.type === "failed") {
        pending.reject(new Error(response.message));
      } else {
        pending.resolve(response);
      }
    };
    this.#worker.onerror = (event) => {
      const error = new Error(event.message || "Shape mask benchmark Worker failed.");
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
    };
  }

  run(
    backend: ShapeMaskBenchmarkBackend,
    source: Uint16Array,
    width: number,
    height: number,
    targetSize = TARGET_SIZE,
  ): Promise<ShapeMaskBenchmarkSuccess> {
    const id = ++this.#sequence;
    const transferred = source.slice().buffer;
    const request: ShapeMaskBenchmarkRequest = {
      type: "prepare",
      id,
      backend,
      source: transferred,
      sourceWidth: width,
      sourceHeight: height,
      targetSize,
      invert: true,
      quantizeR8: false,
    };
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage(request, [transferred]);
    });
  }

  destroy(): void {
    this.#worker.terminate();
    const error = new Error("Shape mask benchmark Worker was terminated.");
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}

export async function runShapeMaskWasmBenchmark(): Promise<Record<string, unknown>> {
  const sourceResponse = await fetch(shapeSourceUrl);
  if (!sourceResponse.ok) {
    throw new Error(`Shape benchmark source failed to load (${sourceResponse.status}).`);
  }
  const decoded = await decodeGrayscalePng(await sourceResponse.arrayBuffer());
  const client = new ShapeMaskBenchmarkWorkerClient();
  try {
    // A small request pays module fetch/compile before the measured full-size runs.
    const warmSource = Uint16Array.of(0, 16384, 32768, 65535);
    const warmup = await client.run("wasm", warmSource, 2, 2, 2);
    const expected = await client.run("js", decoded.pixels, decoded.width, decoded.height);
    const actual = await client.run("wasm", decoded.pixels, decoded.width, decoded.height);
    const parity = {
      identity: actual.identity === expected.identity,
      scalar16: arraysEqual(
        new Uint16Array(actual.scalar16),
        new Uint16Array(expected.scalar16),
      ),
      baseMask: arraysEqual(
        new Uint8Array(actual.baseMask),
        new Uint8Array(expected.baseMask),
      ),
      supportMask: arraysEqual(
        new Uint8Array(actual.supportMask),
        new Uint8Array(expected.supportMask),
      ),
    };
    const passed = Object.values(parity).every(Boolean);
    if (!passed) throw new Error("Shape mask Wasm output differs from JavaScript.");

    const jsTimes: number[] = [];
    const wasmTimes: number[] = [];
    for (let run = 0; run < MEASURED_RUNS; run += 1) {
      jsTimes.push((await client.run("js", decoded.pixels, decoded.width, decoded.height)).computeMs);
      wasmTimes.push((await client.run("wasm", decoded.pixels, decoded.width, decoded.height)).computeMs);
    }
    const jsMedianMs = median(jsTimes);
    const wasmMedianMs = median(wasmTimes);
    return {
      lab: "shape-mask-wasm",
      passed,
      source: {
        width: decoded.width,
        height: decoded.height,
        samples: decoded.pixels.length,
      },
      targetSize: TARGET_SIZE,
      measuredRuns: MEASURED_RUNS,
      parity,
      warmup: {
        initializationMs: warmup.initializationMs,
      },
      javascript: {
        medianMs: jsMedianMs,
        runsMs: jsTimes,
      },
      wasm: {
        medianMs: wasmMedianMs,
        runsMs: wasmTimes,
        retainedLinearMemoryMiB: actual.wasmMemoryBytes / (1024 * 1024),
      },
      speedup: wasmMedianMs > 0 ? jsMedianMs / wasmMedianMs : null,
      scope: "Worker compute includes copies into and out of Wasm linear memory.",
    };
  } finally {
    client.destroy();
  }
}
