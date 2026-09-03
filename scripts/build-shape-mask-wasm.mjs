import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const crateRoot = resolve(repositoryRoot, "wasm", "shape-mask-kernel");
const targetRoot = resolve(crateRoot, ".build");
const outputDirectory = resolve(crateRoot, "dist");
const outputPath = resolve(outputDirectory, "shape_mask_kernel.wasm");
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
  "shape_mask_kernel.wasm",
);
await mkdir(outputDirectory, { recursive: true });
await copyFile(artifactPath, outputPath);
const bytes = await readFile(outputPath);
const digest = createHash("sha256").update(bytes).digest("hex");
console.log(`Built ${outputPath} · ${bytes.byteLength} bytes · sha256 ${digest}`);
