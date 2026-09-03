import "./styles.css";
import { createEditorLabController } from "./editor-labs";
import type { EditorExtensionBootstrap } from "../editor-extension-contract";

const search = new URLSearchParams(window.location.search);
const encodedRgba8Profile = search.get("pixelProfile") === "encoded-rgba8";
const fixedBrushWorkload = search.get("fixedWork") === "1";
const requestedStrokeBackend = search.get("strokeBackend");
const strokeGeometryBackend = requestedStrokeBackend === "javascript"
  || requestedStrokeBackend === "wasm"
  || requestedStrokeBackend === "wasm-packed-required"
  ? requestedStrokeBackend
  : search.get("lab") === "stroke-geometry-wasm"
      || search.get("lab") === "stroke-packed-wasm"
    ? "javascript"
    : null;
const projectHome = document.getElementById("projectHome");
const app = document.getElementById("app");
if (!projectHome || !app) {
  throw new Error("La shell editor non è disponibile per i laboratori.");
}

projectHome.hidden = true;
app.hidden = false;
document.documentElement.dataset.editorEntry = "labs";
document.title = "WebGPU Brush Engine Labs";

const bootstrap: EditorExtensionBootstrap = {
  restorePersistedBrushOnStartup: false,
  engineOptions: {
    ...(fixedBrushWorkload ? { adaptiveSpacingMaxExtraPercentPoints: 0 } : {}),
    ...(strokeGeometryBackend ? { strokeGeometryBackend } : {}),
    ...(encodedRgba8Profile ? {
      layerFormat: "rgba8unorm" as const,
      presentationFormat: "rgba8unorm" as const,
      paintDabProfile: "encoded-srgb-rgba8" as const,
      displayCompositingColorSpace: "stored-encoded-srgb" as const,
    } : {}),
    bevelBoundingFieldEnabled: search.get("bevelField") === "bbox",
    layerMemoryStressTestEnabled: true,
    layerCompressionTestEnabled: true,
    mixedSceneEnabled: true,
  },
  vectorTextClippedRefreshPolicy:
    search.get("lab") === "vector-zoom-release" ? "on-release" : "during-gesture",
  create: createEditorLabController,
};

window.__editorExtensionBootstrap = bootstrap;
await import("../main");
