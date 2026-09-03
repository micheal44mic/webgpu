import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  repositoryRoot,
  sha256,
  vectorGeometryArtifactMetadataPath,
  vectorGeometryArtifactPath,
  vectorGeometryCrateRoot,
  vectorGeometrySourceSha256,
} from "./vector-geometry-artifact.mjs";

const targetRoot = resolve(vectorGeometryCrateRoot, ".build");
const outputDirectory = resolve(vectorGeometryCrateRoot, "dist");
const manifestPath = resolve(vectorGeometryCrateRoot, "Cargo.toml");
const result = spawnSync("cargo", [
  "build",
  "--locked",
  "--manifest-path",
  manifestPath,
  "--target",
  "wasm32-unknown-unknown",
  "--release",
  "--target-dir",
  targetRoot,
], { cwd: repositoryRoot, encoding: "utf8", stdio: "pipe" });
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}

const builtPath = resolve(
  targetRoot,
  "wasm32-unknown-unknown",
  "release",
  "vector_geometry_kernel.wasm",
);
await mkdir(outputDirectory, { recursive: true });
await copyFile(builtPath, vectorGeometryArtifactPath);
const bytes = await readFile(vectorGeometryArtifactPath);
const digest = sha256(bytes);
const sourceDigest = await vectorGeometrySourceSha256();
await writeFile(vectorGeometryArtifactMetadataPath, `${JSON.stringify({
  version: 1,
  sourceSha256: sourceDigest,
  wasmSha256: digest,
  wasmByteLength: bytes.byteLength,
}, null, 2)}\n`, "utf8");
console.log(`Built ${vectorGeometryArtifactPath} · ${bytes.byteLength} bytes · sha256 ${digest}`);
