import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LAYER_STACK_MAXIMUM,
  LAYER_STACK_STRATEGY,
  LayerStack,
} from "../src/layer-stack.ts";

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

// The pixel probe is what makes multi-layer claims falsifiable: correctness
// cannot be read off the screen, because the display shows one composite and a
// dropped submit leaves the previous image in place. Guard it against silent
// removal, and against losing its dev gate.
const engineSource = readFileSync(
  new URL("../src/brush-engine.ts", import.meta.url),
  "utf8",
);
assert.match(engineSource, /async readLayerPixels\(rect\?: DirtyRect\): Promise<Uint8Array>/);
const probeStart = engineSource.indexOf("async readLayerPixels(");
const probeBody = engineSource.slice(probeStart, probeStart + 2_600);
assert.match(probeBody, /import\.meta\.env\.DEV/, "la sonda deve restare solo-dev");
assert.match(probeBody, /copyTextureToBuffer/);
assert.match(probeBody, /texture: this\.layerTexture, mipLevel: 0/,
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
  /const \{ texture, view, samplingView, mipViews \} = this\.allocateLayerTexture\(format\)/,
  "recreateLayerResources deve usare l'helper, non una copia del codice",
);
assert.equal(
  (engineSource.match(/label: `4096² paint layer \$\{format\}`/g) ?? []).length,
  1,
  "la creazione della texture di livello deve esistere in un solo punto",
);

console.log("Layer stack verification passed.");
