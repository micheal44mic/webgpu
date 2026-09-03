import { verifyVectorGeometryArtifactFreshness } from "./vector-geometry-artifact.mjs";

const { metadata } = await verifyVectorGeometryArtifactFreshness();
console.log(
  `Vector geometry Wasm artifact verified: ${metadata.wasmByteLength} bytes · sha256 ${metadata.wasmSha256}.`,
);
