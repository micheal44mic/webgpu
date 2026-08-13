import "./verification/layer-stack/layer-model.mjs";
import "./verification/layer-stack/layer-storage-model.mjs";
import "./verification/layer-stack/layer-resource-lifecycle.mjs";
import "./verification/layer-stack/layer-compositing-clipping.mjs";
import "./verification/layer-stack/layer-resource-allocation.mjs";
import "./verification/layer-stack/layer-editor-thumbnails.mjs";
import "./verification/layer-stack/layer-editor-interaction.mjs";
import "./verification/layer-stack/layer-history-switch.mjs";
import "./verification/layer-stack/layer-switch-atomicity.mjs";
import "./verification/layer-stack/layer-cold-storage.mjs";
import "./verification/layer-stack/layer-memory-labs.mjs";
import "./verification/layer-stack/layer-ui-affordances.mjs";

console.log("Layer stack verification passed.");
console.log("Layer delete messaging verified.");
console.log("Undo/Redo affordance verified.");
