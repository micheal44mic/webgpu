import { mkdir, writeFile } from "node:fs/promises";

const defaultOrigin = "https://webgpu-brush-engine-michi.m1m4brand.chatgpt.site";
const origin = (process.env.BENCHMARK_API_ORIGIN ?? defaultOrigin).replace(/\/$/, "");
const response = await fetch(`${origin}/api/benchmark-runs?limit=1000`, {
  headers: { Accept: "application/json" },
});

if (!response.ok) {
  throw new Error(`Impossibile sincronizzare il registro benchmark (${response.status}).`);
}

const payload = await response.json();
if (!payload || payload.version !== 1 || !Array.isArray(payload.runs)) {
  throw new Error("Il registro benchmark ricevuto non è valido.");
}

const outputDirectory = new URL("../benchmarks/", import.meta.url);
const outputFile = new URL("results.json", outputDirectory);
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Sincronizzate ${payload.runs.length} run in benchmarks/results.json.`);
