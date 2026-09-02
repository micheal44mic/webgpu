import "./styles.css";
import { createRgba8BrushLabController } from "./rgba8-brush-lab";
import type { EditorExtensionBootstrap } from "../editor-extension-contract";

const search = new URLSearchParams(window.location.search);
if (
  !search.has("documentWidth")
  && !search.has("documentHeight")
  && !search.has("documentSize")
) {
  search.set("documentSize", "4096");
  window.history.replaceState(null, "", `${window.location.pathname}?${search}${window.location.hash}`);
}

const projectHome = document.getElementById("projectHome");
const app = document.getElementById("app");
if (!projectHome || !app) {
  throw new Error("La shell editor non è disponibile per il laboratorio RGBA8.");
}

projectHome.hidden = true;
app.hidden = false;
document.documentElement.dataset.editorEntry = "rgba8-brush-lab";
document.documentElement.dataset.workingPrecision = "rgba8-optical-depth";
document.title = "sRGB 8-bit Output · Direct Deposit Brush Lab";

const bootstrap: EditorExtensionBootstrap = {
  restorePersistedBrushOnStartup: false,
  engineOptions: {
    // Document bytes stay RGBA8. The direct-deposit profile owns only a
    // temporary one-channel high-precision accumulation texture per gesture.
    layerFormat: "rgba8unorm",
    presentationFormat: "rgba8unorm",
    paintDabProfile: "direct-deposit-pressure-size",
    displayCompositingColorSpace: "stored-encoded-srgb",
    mixedSceneEnabled: true,
  },
  create: createRgba8BrushLabController,
};

window.__editorExtensionBootstrap = bootstrap;
await import("../main");
