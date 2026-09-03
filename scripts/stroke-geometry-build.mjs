import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  repositoryRoot,
  sha256,
  strokeGeometryArtifactMetadataPath,
  strokeGeometryArtifactPath,
  strokeGeometryCrateRoot,
  strokeGeometrySourceSha256,
} from "./stroke-geometry-artifact.mjs";

const crateRoot = strokeGeometryCrateRoot;
const targetRoot = resolve(crateRoot, ".build");
const outputDirectory = resolve(crateRoot, "dist");
const outputPath = strokeGeometryArtifactPath;
const manifestPath = resolve(crateRoot, "Cargo.toml");

const result = spawnSync(
  "cargo",
  [
    "build",
    "--locked",
    "--manifest-path",
    manifestPath,
    "--target",
    "wasm32-unknown-unknown",
    "--release",
    "--target-dir",
    targetRoot,
  ],
  { cwd: repositoryRoot, encoding: "utf8", stdio: "pipe" },
);
if (result.status !== 0) {
  process.stderr.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}

const artifactPath = resolve(
  targetRoot,
  "wasm32-unknown-unknown",
  "release",
  "stroke_geometry_kernel.wasm",
);
await mkdir(outputDirectory, { recursive: true });
await copyFile(artifactPath, outputPath);
const bytes = await readFile(outputPath);
const digest = sha256(bytes);
const sourceDigest = await strokeGeometrySourceSha256();
await writeFile(
  strokeGeometryArtifactMetadataPath,
  `${JSON.stringify({
    version: 1,
    sourceSha256: sourceDigest,
    wasmSha256: digest,
    wasmByteLength: bytes.byteLength,
  }, null, 2)}\n`,
  "utf8",
);
console.log(`Built ${outputPath} · ${bytes.byteLength} bytes · sha256 ${digest}`);
