import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LAYER_STACK_MAXIMUM,
  LAYER_STACK_STRATEGY,
  LayerStack,
  layerEffectRendererRequirements,
} from "../src/layer-stack.ts";
import { runGpuAllocationTransaction } from "../src/gpu-allocation-transaction.ts";

assert.equal(
  LAYER_STACK_STRATEGY,
  "ordered-records-single-active-index-monotonic-ids",
);

// Stand-in for the engine's real factory: shape-compatible, and deliberately
// returning a fresh object graph on every call so the tests below can tell
// "the stack asked for new styles" apart from "the stack reused one object".
let styleFactoryCalls = 0;
const createStyles = () => {
  styleFactoryCalls += 1;
  return {
    strokeStyle: { enabled: false, width: 14, position: "outside", color: [1, 0.643, 0.282, 1] },
    bevelStyle: { enabled: false, mode: "inner", technique: "smooth", size: 32, soften: 4 },
  };
};
const newStack = () => new LayerStack(createStyles);

// A document always has exactly one layer to begin with, and it is selected.
{
  const stack = newStack();
  assert.equal(stack.count, 1);
  assert.equal(stack.activeIndex, 0);
  assert.equal(stack.active.id, 1);
  assert.equal(stack.active.visible, true);
  assert.equal(stack.active.opacity, 1);
  assert.equal(stack.active.hasContent, false);
  assert.equal(stack.active.contentBounds, null);
  assert.equal(stack.active.mipValidThroughLevel, 0);
  assert.deepEqual(stack.below(), []);
  assert.deepEqual(stack.above(), []);
}

// add() inserts ABOVE the active layer and selects the new one.
{
  const stack = newStack();
  const index = stack.add();
  assert.equal(index, 1);
  assert.equal(stack.count, 2);
  assert.equal(stack.activeIndex, 1);
  assert.equal(stack.active.id, 2);
  // Inserting while a middle layer is selected must not append to the top.
  stack.setActiveIndex(0);
  const middle = stack.add();
  assert.equal(middle, 1);
  assert.deepEqual(stack.layers.map((l) => l.id), [1, 3, 2]);
  assert.equal(stack.activeIndex, 1);
}

// THE aliasing invariant: two records must never share one style object, or
// editing the bevel on one layer would silently change it on another. This is
// the whole point of per-layer effect state.
{
  const stack = newStack();
  stack.add();
  const [first, second] = stack.layers;
  assert.notEqual(first.strokeStyle, second.strokeStyle);
  assert.notEqual(first.bevelStyle, second.bevelStyle);
  assert.notEqual(first.strokeStyle.color, second.strokeStyle.color);
  first.bevelStyle.size = 47;
  first.strokeStyle.width = 93;
  first.strokeStyle.color[0] = 0.125;
  assert.notEqual(second.bevelStyle.size, 47, "bevelStyle è aliasato fra livelli");
  assert.notEqual(second.strokeStyle.width, 93, "strokeStyle è aliasato fra livelli");
  assert.notEqual(
    second.strokeStyle.color[0],
    0.125,
    "il colore Traccia è aliasato fra livelli",
  );
  // And neither may alias the frozen defaults.
  assert.doesNotThrow(() => { second.bevelStyle.size = 3; });
}

// The factory must be invoked once per record. Asserting only "the objects
// differ" would still pass if the stack called the factory once and deep-cloned
// the result, which would silently drop any per-layer default the engine wants
// to vary later.
{
  const before = styleFactoryCalls;
  const stack = newStack();
  assert.equal(styleFactoryCalls - before, 1, "il livello iniziale deve chiedere i propri stili");
  stack.add();
  stack.add();
  assert.equal(styleFactoryCalls - before, 3, "ogni livello aggiunto deve chiedere i propri stili");
  stack.remove(2);
  assert.equal(styleFactoryCalls - before, 3, "eliminare un livello non deve creare stili");
}

// Removing the active layer selects the one below; the last one cannot go.
{
  const stack = newStack();
  stack.add();
  stack.add();
  assert.equal(stack.activeIndex, 2);
  const removed = stack.remove(2);
  assert.equal(removed.id, 3);
  assert.equal(stack.count, 2);
  assert.equal(stack.activeIndex, 1);
  // Removing below the active index shifts the selection with it.
  stack.setActiveIndex(1);
  stack.remove(0);
  assert.equal(stack.activeIndex, 0);
  assert.equal(stack.active.id, 2);
  assert.throws(() => stack.remove(0), /ultimo livello/);
}

// ids are monotonic and never reused, so GPU resources keyed by id cannot be
// handed to a different layer after a delete.
{
  const stack = newStack();
  stack.add();
  stack.remove(1);
  const index = stack.add();
  assert.equal(stack.at(index).id, 3);
  assert.equal(stack.byId(2), null);
  assert.equal(stack.byId(3)?.id, 3);
  assert.equal(stack.indexOfId(99), -1);
}

// Selection changes report whether anything actually moved: the engine uses the
// boolean to decide whether to pay for a switch.
{
  const stack = newStack();
  stack.add();
  assert.equal(stack.setActiveIndex(1), false);
  assert.equal(stack.setActiveIndex(0), true);
  assert.throws(() => stack.setActiveIndex(7), /fuori intervallo/);
  assert.throws(() => stack.at(-1), /fuori intervallo/);
}

// Reorder keeps the same RECORD selected, not the same slot.
{
  const stack = newStack();
  stack.add();
  stack.add();
  stack.setActiveIndex(0);
  const activeId = stack.active.id;
  assert.equal(stack.move(0, 2), true);
  assert.deepEqual(stack.layers.map((l) => l.id), [2, 3, 1]);
  assert.equal(stack.active.id, activeId);
  assert.equal(stack.activeIndex, 2);
  assert.equal(stack.move(2, 2), false);
  assert.throws(() => stack.move(0, 9), /fuori intervallo/);
}

// below()/above() partition the stack around the active index, bottom-up.
{
  const stack = newStack();
  stack.add();
  stack.add();
  stack.setActiveIndex(1);
  assert.deepEqual(stack.layers.map((l) => l.id), [1, 2, 3]);
  assert.deepEqual(stack.below().map((l) => l.id), [1]);
  assert.deepEqual(stack.above().map((l) => l.id), [3]);
  assert.equal(stack.below().length + stack.above().length + 1, stack.count);
}

// The cap is enforced, because each layer costs 85,3 MiB eagerly.
{
  const stack = newStack();
  while (stack.count < LAYER_STACK_MAXIMUM) {
    stack.add();
  }
  assert.equal(stack.count, LAYER_STACK_MAXIMUM);
  assert.throws(() => stack.add(), /Massimo/);
}

{
  const stack = newStack();
  assert.equal(stack.anyHasContent(), false);
  stack.add();
  stack.at(0).hasContent = true;
  assert.equal(stack.anyHasContent(), true);
}

// Smusso is displayed by the shared RasterStrokeRenderer even when Traccia is
// disabled. This is the lifecycle case that previously returned with the
// Smusso checkbox checked but no composed effect after another layer released
// the renderers.
{
  assert.deepEqual(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: true },
    ),
    {
      needsStrokeRenderer: true,
      needsBevelRenderer: true,
      strokeWidth: 14,
    },
  );
  assert.equal(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: false },
    ).needsStrokeRenderer,
    false,
  );
  assert.equal(
    layerEffectRendererRequirements(
      { enabled: true, width: 512 },
      { enabled: false },
    ).needsStrokeRenderer,
    true,
  );
}

// WebGPU reports texture OOM asynchronously when error scopes are popped. The
// allocation transaction must destroy a candidate even when its factory
// returned normally, and must leave a successful candidate alive.
{
  const pushed = [];
  const errors = [null, { message: "OOM simulato" }];
  const host = {
    pushErrorScope(filter) {
      pushed.push(filter);
    },
    async popErrorScope() {
      return errors.shift() ?? null;
    },
  };
  let destroyed = false;
  await assert.rejects(
    runGpuAllocationTransaction(host, "Texture test", (transaction) => {
      transaction.deferRollback(() => { destroyed = true; });
      return { candidate: true };
    }),
    /Texture test: OOM simulato/,
  );
  assert.deepEqual(pushed, ["out-of-memory", "validation"]);
  assert.equal(errors.length, 0, "entrambi gli error scope devono essere chiusi");
  assert.equal(destroyed, true, "il candidato OOM deve essere distrutto");
}

{
  const host = {
    pushErrorScope() {},
    async popErrorScope() { return null; },
  };
  let destroyed = false;
  const candidate = await runGpuAllocationTransaction(
    host,
    "Texture valida",
    (transaction) => {
      transaction.deferRollback(() => { destroyed = true; });
      return { candidate: true };
    },
  );
  assert.deepEqual(candidate, { candidate: true });
  assert.equal(destroyed, false, "il commit non deve distruggere il candidato valido");
}

// The pixel probe is what makes multi-layer claims falsifiable: correctness
// cannot be read off the screen, because the display shows one composite and a
// dropped submit leaves the previous image in place. Guard it against silent
// removal, and against losing its dev gate.
const engineSource = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
assert.match(
  engineSource,
  /async readLayerPixels\(rect\?: DirtyRect, layerIndex\?: number\): Promise<Uint8Array>/,
);
// Reading a NAMED layer is what makes the test bilateral: "A kept its pixels
// while B was rebuilt" needs both textures, and the active one cannot say it.
assert.match(
  engineSource,
  /const target = layerIndex === undefined\s*\?\s*this\.layerTexture\s*:\s*this\.requireLayerGpu\(this\.layerStack\.at\(layerIndex\)\.id\)\.texture/,
);
const probeStart = engineSource.indexOf("async readLayerPixels(");
const probeBody = engineSource.slice(probeStart, probeStart + 2_600);
assert.match(probeBody, /import\.meta\.env\.DEV/, "la sonda deve restare solo-dev");
assert.match(probeBody, /copyTextureToBuffer/);
assert.match(probeBody, /texture: target, mipLevel: 0/,
  "la sonda deve leggere il mip 0 autorevole, non un livello derivato");
assert.match(probeBody, /Math\.ceil\(unpaddedBytesPerRow \/ 256\) \* 256/,
  "bytesPerRow deve restare allineato a 256");
assert.match(probeBody, /readbackBuffer\.destroy\(\)/, "la sonda non deve perdere il buffer");

// Allocating a layer must not go through recreateLayerResources, whose tail
// destroys the outgoing texture, the blend renderer and the effects workbench.
// These two helpers are the seam that makes "give me a second layer" possible,
// so keep them from being folded back in.
assert.match(engineSource, /private allocateLayerTexture\(format: LayerFormat\): LayerTextureResources/);
assert.match(
  engineSource,
  /private createLayerBindGroups\(\s*format: LayerFormat,\s*samplingView: GPUTextureView,\s*mipViews: readonly GPUTextureView\[\],\s*\): LayerBindGroups/,
);
assert.match(
  engineSource,
  /private async allocateLayerGpuResources\([\s\S]*?runGpuAllocationTransaction\(this\.device, label/,
  "l'allocazione completa deve chiudere validation e OOM scope prima del commit",
);
assert.equal(
  (engineSource.match(/label: `4096² paint layer \$\{format\}`/g) ?? []).length,
  1,
  "la creazione della texture di livello deve esistere in un solo punto",
);

// The effect styles must live on the layer record, not on the engine, or a
// switch would show the outgoing layer's stroke and bevel on the incoming one.
// Accessors keep all 68 existing call sites working while making the styles
// follow the active layer by construction rather than by remembering to copy.
assert.match(engineSource, /private readonly layerStack = new LayerStack\(\(\) => \(\{/);
assert.match(
  engineSource,
  /private get rasterStrokeStyle\(\): RasterStrokeStyle \{\s*return this\.layerStack\.active\.strokeStyle;/,
);
assert.match(
  engineSource,
  /private get rasterBevelStyle\(\): RasterBevelStyle \{\s*return this\.layerStack\.active\.bevelStyle;/,
);
assert.doesNotMatch(
  engineSource,
  /private rasterStrokeStyle: RasterStrokeStyle =/,
  "lo stile Traccia non può tornare a essere un campo del motore",
);
assert.doesNotMatch(
  engineSource,
  /private rasterBevelStyle: RasterBevelStyle =/,
  "lo stile Smusso non può tornare a essere un campo del motore",
);

// After a switch the effect controls must be re-read from the engine, or the
// panel would show the outgoing layer's Traccia and Smusso while the brush
// paints on the incoming one — wrong in a way that looks like a rendering bug.
const mainSource = readFileSync(
  new URL("../src/main.ts", import.meta.url),
  "utf8",
);
assert.match(mainSource, /function syncActiveLayerControls\(\): void \{/);
const syncStart = mainSource.indexOf("function syncActiveLayerControls(");
const syncBody = mainSource.slice(syncStart, syncStart + 600);
assert.match(syncBody, /syncRasterStrokeControls\(engine\.getRasterStrokeStyle\(\)\)/);
assert.match(syncBody, /syncRasterBevelControls\(engine\.getRasterBevelStyle\(\)\)/);
const selectStart = mainSource.indexOf("async function selectLayer(");
assert.notEqual(selectStart, -1, "selectLayer deve esistere");
assert.match(
  mainSource.slice(selectStart, selectStart + 900),
  /await engine\.setActiveLayer\(index\);\s*syncActiveLayerControls\(\);/,
  "il cambio livello deve risincronizzare i controlli degli effetti",
);
assert.match(
  mainSource,
  /const result = await engine\.addLayer\(\);\s*syncActiveLayerControls\(\);/,
  "anche la creazione di un livello deve risincronizzare i controlli",
);

// The record's hasContent is only written back when a layer stops being active,
// so reading it for the ACTIVE layer would report "empty" while the user paints.
assert.match(
  engineSource,
  /hasContent: record\.id === this\.layerStack\.active\.id\s*\?\s*this\.layerHasContent\s*:\s*record\.hasContent/,
  "hasContent del livello attivo deve venire dal campo vivo, non dal record",
);
// The switch result must not claim to report a rebuilt pyramid level: the switch
// only invalidates the pyramid, and the next frame rebuilds it.
assert.doesNotMatch(engineSource, /rebuiltPyramidThroughLevel/);

// Replay is layer-aware through the same pure selector exercised behaviorally by
// history:verify. This assertion is only the integration seam: it prevents the
// engine from drifting back to a second, untested implementation.
const rebuildStart = engineSource.indexOf("private async rebuildActiveLayerFromHistory(");
assert.notEqual(rebuildStart, -1, "il replay deve dichiarare di ricostruire il livello ATTIVO");
const rebuildBody = engineSource.slice(rebuildStart, rebuildStart + 1_500);
assert.match(
  rebuildBody,
  /\} = selectLayerReplay\(\s*this\.historyActions,\s*this\.historyCursor,\s*this\.historyBatches,\s*layerId,\s*\)/,
  "il replay reale deve usare il selettore per-livello testato",
);
// Nothing in the replay may index the unfiltered array, or a single stray index
// would reintroduce another layer's batch.
assert.doesNotMatch(
  engineSource.slice(rebuildStart, rebuildStart + 5_000),
  /this\.historyBatches\[/,
  "il replay non deve indicizzare l'array non filtrato",
);

// A step that crosses another layer's action still needs the switch to happen
// inside the history transaction, so it is refused rather than misapplied. The
// refusal lives in the engine as well as the button state.
assert.match(
  engineSource,
  /private historyStepBlockedByLayer\(delta: -1 \| 1\): boolean \{/,
);
assert.match(
  engineSource.slice(engineSource.indexOf("private historyStepBlockedByLayer("), rebuildStart),
  /return historyStepTargetsOtherLayer\(/,
  "anche il gate per-passo deve usare la funzione pura testata",
);
assert.match(engineSource, /&& !this\.historyStepBlockedByLayer\(-1\)/);
assert.match(engineSource, /&& !this\.historyStepBlockedByLayer\(1\)/);
const cursorStart = engineSource.indexOf("private async moveHistoryCursor(");
assert.match(
  engineSource.slice(cursorStart, cursorStart + 1_400),
  /if \(this\.historyStepBlockedByLayer\(delta\)\) \{/,
  "il gate deve valere anche chiamando l'API, non solo il bottone",
);
assert.match(
  engineSource.slice(cursorStart, cursorStart + 1_800),
  /delta < 0[\s\S]*selezionalo per annullarlo[\s\S]*selezionalo per ripristinarlo/,
  "il messaggio del gate deve distinguere Undo da Redo",
);

// The promised bilateral GPU regression is a persistent, fresh-page dev route,
// not a one-off console transcript. It must read both named textures and compare
// the untouched one byte-for-byte across undo and redo.
const layerHistoryGpuTestSource = readFileSync(
  new URL("../src/layer-history-gpu-test.ts", import.meta.url),
  "utf8",
);
assert.match(mainSource, /pageSearchParams\.get\("layerHistoryTest"\) === "1"/);
assert.match(mainSource, /await import\("\.\/layer-history-gpu-test"\)/);
assert.match(mainSource, /await runLayerHistoryGpuTest\(engine\)/);
assert.match(layerHistoryGpuTestSource, /readLayerPixels\(auditRect, 0\)/);
assert.match(layerHistoryGpuTestSource, /readLayerPixels\(auditRect, 1\)/);
assert.match(layerHistoryGpuTestSource, /const undoReturned = await engine\.undo\(\)/);
assert.match(layerHistoryGpuTestSource, /const redoReturned = await engine\.redo\(\)/);
assert.match(layerHistoryGpuTestSource, /layerAAfterUndo: countDifferingBytes\(layerABaseline, layerAAfterUndo\)/);
assert.match(layerHistoryGpuTestSource, /layerBRedoVersusBeforeUndo: countDifferingBytes\(layerBBeforeUndo, layerBAfterRedo\)/);

// The switch lock has to be held across the awaits, or a pointerdown landing
// during the 150-215 ms rebuild starts a stroke on a half-swapped layer.
assert.match(engineSource, /private layerSwitchBusy = false;/);
assert.match(
  engineSource,
  /if \(this\.historyBusy \|\| this\.activeStroke \|\| this\.layerSwitchBusy\) \{/,
  "beginStrokeAtLayer deve rifiutare durante uno switch",
);
assert.match(mainSource, /return !engineInitialized\s*\|\| layerSwitching/,
  "il lock di switch deve entrare in operationLocked, non solo nella lista");

// The workbench is one retargetable instance, so a layer whose record says
// Traccia OR Smusso is enabled can arrive after another layer released the
// renderer. Without this the checkbox returns on and the effect stays absent.
assert.match(engineSource, /private async ensureEffectRenderersForActiveLayer\(\): Promise<void>/);
assert.match(
  engineSource,
  /await this\.ensureEffectRenderersForActiveLayer\(\);/,
  "activateLayer deve garantire i renderer del livello entrante",
);
const ensureStart = engineSource.indexOf("private async ensureEffectRenderersForActiveLayer(");
const ensureBody = engineSource.slice(ensureStart, ensureStart + 1_400);
assert.match(ensureBody, /layerEffectRendererRequirements\(/,
  "la decisione Smusso-only deve passare dall'invariante testato");
assert.match(ensureBody, /if \(requirements\.needsStrokeRenderer\)/,
  "Smusso deve ricreare anche il compositore Traccia");
assert.match(ensureBody, /rasterStrokeScratchExtentForWidth\(requirements\.strokeWidth\)/,
  "il tier di scratch dipende dalla width del livello entrante");
assert.match(ensureBody, /this\.rasterStrokeRenderer\.resizeScratch\(scratchExtent\)/);

// A failed activation mutates Blend, effects and live content fields before it
// can reject. Rollback therefore has to run the complete activation path back
// to the outgoing layer; rebinding only the texture is not sufficient.
const selectMethodStart = engineSource.indexOf("async setActiveLayer(");
const selectMethodBody = engineSource.slice(selectMethodStart, selectMethodStart + 2_200);
assert.match(selectMethodBody, /activationStarted = true/);
assert.match(selectMethodBody, /this\.layerStack\.setActiveIndex\(fromIndex\);[\s\S]*?await this\.activateLayer\(index\);/,
  "il rollback dello switch deve ritargettare tutti i sottosistemi");
const addMethodStart = engineSource.indexOf("async addLayer(");
const addMethodBody = engineSource.slice(addMethodStart, addMethodStart + 2_800);
assert.match(addMethodBody, /await this\.allocateLayerGpuResources\(/);
assert.match(addMethodBody, /await this\.activateLayer\(index\);[\s\S]*?this\.layerGpu\.delete\(record\.id\);[\s\S]*?gpu\.texture\.destroy\(\)/,
  "un livello fallito va distrutto solo dopo il ripristino completo");

// Measurement setups reset the GLOBAL journal but clear only the active layer.
assert.match(engineSource, /private get documentWideResetBlockedByLayers\(\): boolean/);
assert.match(engineSource, /if \(this\.documentWideResetBlockedByLayers\) \{/);
// Allocation must precede destruction, or an OOM partway through a format change
// leaves the document with neither the old textures nor the new ones.
assert.ok(
  engineSource.indexOf("const replacement = new Map<number, LayerGpuResources>();")
    < engineSource.indexOf("const supersededLayerGpu = [...this.layerGpu.values()];"),
  "il cambio formato deve allocare prima di distruggere",
);
const recreateStart = engineSource.indexOf("private async recreateLayerResources(");
const recreateBody = engineSource.slice(recreateStart, recreateStart + 30_000);
assert.match(recreateBody, /runGpuAllocationTransaction\(\s*this\.device,\s*`Pipeline formato layer/,
  "anche pipeline e layout devono chiudere validation/OOM scope");
assert.match(recreateBody, /for \(const record of this\.layerStack\.layers\)[\s\S]*?await this\.allocateLayerGpuResources\(/,
  "ogni texture sostitutiva deve essere validata prima dello swap");
assert.match(recreateBody, /for \(const gpu of replacement\.values\(\)\) \{\s*gpu\.texture\.destroy\(\);/,
  "un fallimento deve eliminare tutti i candidati, incluso quello attivo");
assert.doesNotMatch(recreateBody, /layerId !== this\.layerStack\.active\.id/,
  "il cleanup non può saltare il candidato del livello attivo");

// Public mutations must not interleave with the awaited layer switch.
assert.match(engineSource, /setBrushSettings\([\s\S]*?this\.initialized && this\.layerSwitchBusy/);
assert.match(engineSource, /async setLayerFormat\([\s\S]*?this\.layerSwitchBusy/);
assert.match(engineSource, /async benchmarkEffectsWorkingSet\([\s\S]*?this\.layerSwitchBusy/);
assert.match(engineSource, /\(!allowLayerSwitch && this\.layerSwitchBusy\)/,
  "solo il retarget interno dello switch può attraversare il lock");
// Telemetry has to sign the layer count, or runs with one and several layers
// look equivalent in the log.
assert.match(engineSource, /layerCount: this\.layerStack\.count/);
assert.match(
  engineSource,
  /layerMemoryMiB: \(this\.layerFormat === "rgba16float" \? 128 : 64\) \* this\.layerGpu\.size/,
);
assert.match(mainSource, /layerCount: number;/);
assert.match(mainSource, /activeLayerId: number;/);

console.log("Layer stack verification passed.");
