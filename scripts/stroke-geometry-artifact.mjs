import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const strokeGeometryCrateRoot = resolve(
  repositoryRoot,
  "wasm",
  "stroke-geometry-kernel",
);
export const strokeGeometryArtifactPath = resolve(
  strokeGeometryCrateRoot,
  "dist",
  "stroke_geometry_kernel.wasm",
);
export const strokeGeometryArtifactMetadataPath = resolve(
  strokeGeometryCrateRoot,
  "dist",
  "stroke_geometry_kernel.meta.json",
);

const sourceControlFiles = [
  resolve(strokeGeometryCrateRoot, ".cargo", "config.toml"),
  resolve(strokeGeometryCrateRoot, "Cargo.lock"),
  resolve(strokeGeometryCrateRoot, "Cargo.toml"),
];

async function rustSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await rustSourceFiles(absolute));
    } else if (entry.isFile() && entry.name.endsWith(".rs")) {
      files.push(absolute);
    }
  }
  return files;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function strokeGeometrySourceSha256() {
  const files = [
    ...sourceControlFiles,
    ...await rustSourceFiles(resolve(strokeGeometryCrateRoot, "src")),
  ].sort((left, right) => left.localeCompare(right, "en"));
  const hash = createHash("sha256");
  for (const file of files) {
    const name = relative(strokeGeometryCrateRoot, file).replaceAll("\\", "/");
    const bytes = await readFile(file);
    hash.update(`${name.length}:${name}\n${bytes.byteLength}:`);
    hash.update(bytes);
    hash.update("\n");
  }
  return hash.digest("hex");
}

export async function verifyStrokeGeometryArtifactFreshness() {
  let wasmBytes;
  let metadataSource;
  try {
    [wasmBytes, metadataSource] = await Promise.all([
      readFile(strokeGeometryArtifactPath),
      readFile(strokeGeometryArtifactMetadataPath, "utf8"),
    ]);
  } catch (cause) {
    throw new Error(
      "The stroke geometry Wasm artifact or its metadata is missing; run npm run wasm:stroke:build.",
      { cause },
    );
  }

  let metadata;
  try {
    metadata = JSON.parse(metadataSource);
  } catch (cause) {
    throw new Error(
      "The stroke geometry Wasm artifact metadata is invalid; run npm run wasm:stroke:build.",
      { cause },
    );
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(
      "The stroke geometry Wasm artifact metadata is incompatible; run npm run wasm:stroke:build.",
    );
  }
  const fields = Object.keys(metadata).sort();
  if (
    fields.length !== 4
    || fields[0] !== "sourceSha256"
    || fields[1] !== "version"
    || fields[2] !== "wasmByteLength"
    || fields[3] !== "wasmSha256"
    || metadata.version !== 1
  ) {
    throw new Error(
      "The stroke geometry Wasm artifact metadata is incompatible; run npm run wasm:stroke:build.",
    );
  }

  const sourceDigest = await strokeGeometrySourceSha256();
  if (metadata.sourceSha256 !== sourceDigest) {
    throw new Error(
      "The stroke geometry Wasm artifact is stale; run npm run wasm:stroke:build.",
    );
  }
  const wasmDigest = sha256(wasmBytes);
  if (
    metadata.wasmSha256 !== wasmDigest
    || metadata.wasmByteLength !== wasmBytes.byteLength
  ) {
    throw new Error(
      "The stroke geometry Wasm bytes do not match their metadata; run npm run wasm:stroke:build.",
    );
  }
  return { metadata, wasmBytes };
}
