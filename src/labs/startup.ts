import "./styles.css";
import { createEditorLabController } from "./editor-labs";
import type { EditorExtensionBootstrap } from "../editor-extension-contract";

const search = new URLSearchParams(window.location.search);
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
