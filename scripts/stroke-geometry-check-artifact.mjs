import { verifyStrokeGeometryArtifactFreshness } from "./stroke-geometry-artifact.mjs";

const { metadata } = await verifyStrokeGeometryArtifactFreshness();
console.log(
  `Stroke geometry Wasm artifact verified: ${metadata.wasmByteLength} bytes · sha256 ${metadata.wasmSha256}.`,
);
