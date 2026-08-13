import "./verification/vector-text/adaptive-presentation.mjs";
import "./verification/vector-text/transform-contracts.mjs";
import "./verification/vector-text/effect-geometry.mjs";
import "./verification/vector-text/gpu-effects.mjs";
import "./verification/vector-text/runtime-presentation.mjs";
import "./verification/vector-text/adaptive-zoom-labs.mjs";
import "./verification/vector-text/worker-cache-contracts.mjs";
import "./verification/vector-text/gpu-resource-contracts.mjs";
import "./verification/vector-text/svg-contracts.mjs";
import "./verification/vector-text/rasterization-contracts.mjs";
import "./verification/vector-text/ui-bootstrap-contracts.mjs";

console.log(
  "Testo vettoriale verificato: Distort/Arch/Circle/Wave Kittl, Slug analitico, Clipper64/Worker, outline fused senza seam, 0 no-op, "
  + "Block Shadow canonica, SVG semantici sanitizzati con palette/effetti GPU, blur Gaussian R16F GPU, raster testo/SVG RGBA16F byte-exact, swap di nodo atomici, coda latest-only e nessun fallback bitmap.",
);

await import("./verification/vector-text/rasterization-regressions.mjs");
