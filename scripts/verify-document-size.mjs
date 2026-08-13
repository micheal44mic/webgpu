// Il documento espone larghezza e altezza indipendenti. Questa suite conserva
// i due profili quadrati storici (2048 telefono, 4096 desktop/legacy), mentre
// `verify-custom-document-dimensions.mjs` esercita la matrice rettangolare.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DOCUMENT_SIZES = [2048, 4096];

if (!process.env.BRUSH_DOCUMENT_SIZE) {
  for (const documentSize of DOCUMENT_SIZES) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      stdio: "inherit",
      env: { ...process.env, BRUSH_DOCUMENT_SIZE: String(documentSize) },
    });
    assert.equal(result.status, 0, `Gli invarianti del documento falliscono a ${documentSize}².`);
  }
  console.log(`document:verify ok (${DOCUMENT_SIZES.map((size) => `${size}²`).join(", ")})`);
  process.exit(0);
}

await import("./verification/document-size/routing-format.mjs");
await import("./verification/document-size/tile-geometry.mjs");
await import("./verification/document-size/memory-model.mjs");
await import("./verification/document-size/gpu-memory-audit.mjs");
await import("./verification/document-size/gpu-resource-accounting.mjs");
await import("./verification/document-size/shader-guards.mjs");
