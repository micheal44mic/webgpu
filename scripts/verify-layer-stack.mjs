import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "./engine-source.mjs";

// Il motore è diviso in più moduli concatenati: un marcatore di fine che non
// esiste più fa tornare -1 a indexOf, e `slice(start, -1)` allargherebbe la
// finestra a quasi tutto il sorgente, rendendo vera per caso ogni asserzione
// di ordine e falsa per caso ogni asserzione negativa. Ogni sezione va chiusa.
const SECTION_MAXIMUM_BYTES = 60_000;
const assertSection = (label, start, end) => {
  assert.ok(start >= 0, `sezione ${label}: marcatore iniziale assente`);
  assert.ok(end > start, `sezione ${label}: marcatore finale assente o precedente all'inizio`);
  assert.ok(
    end - start <= SECTION_MAXIMUM_BYTES,
    `sezione ${label}: ${end - start} byte, oltre il limite di ${SECTION_MAXIMUM_BYTES}`
    + " — il marcatore è disallineato e l'asserzione non verificherebbe più nulla",
  );
};
import {
  LAYER_STACK_MAXIMUM,
  LAYER_STACK_STRATEGY,
  LayerStack,
  layerEffectRendererRequirements,
} from "../src/layer-stack.ts";
import { runGpuAllocationTransaction } from "../src/gpu-allocation-transaction.ts";
import {
  DEFAULT_RASTER_INNER_SHADOW_STYLE,
  DEFAULT_RASTER_OUTER_SHADOW_STYLE,
  copyRasterInnerShadowStyle,
  copyRasterOuterShadowStyle,
} from "../src/shadow-core.ts";
import {
  LAYER_STORAGE_GRID_SIZE,
  LAYER_STORAGE_MASK_WORD_COUNT,
  LAYER_STORAGE_STRATEGY,
  LAYER_STORAGE_TILE_COUNT,
  alignedBoundsTileCount,
  clearLayerStorageTileMask,
  compareLayerStorageMasks,
  countLayerStorageTiles,
  createLayerStorageTileMask,
  exactLayerStorageTileMask,
  layerStorageTileMemoryMiB,
  markLayerStorageRect,
  layerStorageTileIndices,
} from "../src/layer-storage-study.ts";

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
    outerShadowStyle: copyRasterOuterShadowStyle(DEFAULT_RASTER_OUTER_SHADOW_STYLE),
    innerShadowStyle: copyRasterInnerShadowStyle(DEFAULT_RASTER_INNER_SHADOW_STYLE),
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

// Structural history needs exact-position insertion and identity-preserving
// reattachment of the detached raster record.
{
  const stack = newStack();
  const insertedIndex = stack.insertAt(0, "Raster vettore");
  assert.equal(insertedIndex, 0);
  assert.deepEqual(stack.layers.map((layer) => layer.id), [2, 1]);
  assert.equal(stack.active.id, 2);

  const detached = stack.remove(0);
  assert.equal(detached.id, 2);
  const attachedIndex = stack.attach(detached, 1);
  assert.equal(attachedIndex, 1);
  assert.equal(stack.at(attachedIndex), detached, "il record storico va riusato, non clonato");
  assert.equal(stack.active, detached);
  assert.deepEqual(stack.layers.map((layer) => layer.id), [1, 2]);
  assert.throws(
    () => stack.attach(detached, 0),
    /già presente/,
    "lo stesso record non può essere collegato due volte",
  );
  assert.throws(() => stack.insertAt(-1), /fuori intervallo/);
  assert.throws(() => stack.insertAt(stack.count + 1), /fuori intervallo/);
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
  assert.notEqual(first.outerShadowStyle, second.outerShadowStyle);
  assert.notEqual(first.innerShadowStyle, second.innerShadowStyle);
  assert.notEqual(first.outerShadowStyle.color, second.outerShadowStyle.color);
  assert.notEqual(first.innerShadowStyle.color, second.innerShadowStyle.color);
  assert.notEqual(first.strokeStyle.color, second.strokeStyle.color);
  first.bevelStyle.size = 47;
  first.strokeStyle.width = 93;
  first.strokeStyle.color[0] = 0.125;
  first.outerShadowStyle.size = 61;
  first.innerShadowStyle.choke = 42;
  assert.notEqual(second.bevelStyle.size, 47, "bevelStyle è aliasato fra livelli");
  assert.notEqual(second.strokeStyle.width, 93, "strokeStyle è aliasato fra livelli");
  assert.notEqual(
    second.strokeStyle.color[0],
    0.125,
    "il colore Traccia è aliasato fra livelli",
  );
  assert.notEqual(
    second.outerShadowStyle.size,
    61,
    "outerShadowStyle è aliasato fra livelli",
  );
  assert.notEqual(
    second.innerShadowStyle.choke,
    42,
    "innerShadowStyle è aliasato fra livelli",
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

// The cap is enforced. Only the authoritative mip 0 scales per layer
// (64 MiB RGBA8 / 128 MiB RGBA16F); display pyramids are shared.
{
  const stack = newStack();
  while (stack.count < LAYER_STACK_MAXIMUM) {
    stack.add();
  }
  assert.equal(stack.count, LAYER_STACK_MAXIMUM);
  assert.throws(() => stack.add(), /Massimo/);
}

// Commit 14b keeps one active full canvas and stores each inactive layer as a
// deterministic 256² texture array keyed by the 32-byte conservative mask.
assert.equal(
  LAYER_STORAGE_STRATEGY,
  "single-active-full-inactive-256-array-tiles-rehydrate-fold",
);
assert.equal(LAYER_STORAGE_GRID_SIZE, 16);
assert.equal(LAYER_STORAGE_TILE_COUNT, 256);
assert.equal(LAYER_STORAGE_MASK_WORD_COUNT * Uint32Array.BYTES_PER_ELEMENT, 32);

// Every record owns a fresh mask. Sharing one would make painting on B mark A.
{
  const stack = newStack();
  stack.add();
  assert.notEqual(stack.at(0).storageTileMask, stack.at(1).storageTileMask);
  assert.equal(countLayerStorageTiles(stack.at(0).storageTileMask), 0);
  assert.equal(countLayerStorageTiles(stack.at(1).storageTileMask), 0);
  markLayerStorageRect(stack.at(0).storageTileMask, {
    x: 32,
    y: 48,
    width: 8,
    height: 12,
  });
  assert.equal(countLayerStorageTiles(stack.at(0).storageTileMask), 1);
  assert.equal(countLayerStorageTiles(stack.at(1).storageTileMask), 0);
}

// A rect straddling both 256-pixel seams touches exactly four tiles. Clamping a
// document-sized rect must cover all 256 without writing outside the bitset.
{
  const mask = createLayerStorageTileMask();
  markLayerStorageRect(mask, { x: 255, y: 255, width: 2, height: 2 });
  assert.equal(countLayerStorageTiles(mask), 4);
  clearLayerStorageTileMask(mask);
  markLayerStorageRect(mask, { x: -50, y: -80, width: 5000, height: 5000 });
  assert.equal(countLayerStorageTiles(mask), LAYER_STORAGE_TILE_COUNT);
  clearLayerStorageTileMask(mask);
  assert.equal(countLayerStorageTiles(mask), 0);
}

// Sparse corners demonstrate the storage win: two occupied
// pages versus a full-document aligned bbox.
{
  const mask = createLayerStorageTileMask();
  markLayerStorageRect(mask, { x: 0, y: 0, width: 1, height: 1 });
  markLayerStorageRect(mask, { x: 4095, y: 4095, width: 1, height: 1 });
  assert.equal(countLayerStorageTiles(mask), 2);
  assert.equal(
    alignedBoundsTileCount({ x: 0, y: 0, width: 4096, height: 4096 }),
    256,
  );
  assert.equal(layerStorageTileMemoryMiB(1, 4), 0.25);
  assert.equal(layerStorageTileMemoryMiB(1, 8), 0.5);
  assert.equal(layerStorageTileMemoryMiB(256, 4), 64);
  assert.equal(layerStorageTileMemoryMiB(256, 8), 128);
}

// Array slices must be deterministic because hydration uses the same ordered
// list to map each slice back to its document tile.
{
  const mask = createLayerStorageTileMask();
  markLayerStorageRect(mask, { x: 4095, y: 4095, width: 1, height: 1 });
  markLayerStorageRect(mask, { x: 0, y: 256, width: 1, height: 1 });
  markLayerStorageRect(mask, { x: 3840, y: 0, width: 1, height: 1 });
  markLayerStorageRect(mask, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(layerStorageTileIndices(mask), [0, 15, 16, 255]);
}
// Exact occupancy means any non-zero raw byte, not alpha. This preserves a
// future or malformed transparent-RGB texel byte-for-byte.
{
  const pixels = new Uint8Array(512 * 512 * 4);
  pixels[0] = 17; // RGB non-zero, alpha remains zero.
  pixels[(300 * 512 + 300) * 4 + 3] = 255;
  const exact = exactLayerStorageTileMask(pixels, 512, 512, 4);
  assert.equal(countLayerStorageTiles(exact), 2);

  const conservative = createLayerStorageTileMask();
  markLayerStorageRect(conservative, { x: 0, y: 0, width: 1, height: 1 });
  markLayerStorageRect(conservative, { x: 300, y: 300, width: 1, height: 1 });
  assert.deepEqual(compareLayerStorageMasks(exact, conservative), {
    missedReferenceTiles: 0,
    extraCandidateTiles: 0,
  });

  const underMarked = createLayerStorageTileMask();
  markLayerStorageRect(underMarked, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(compareLayerStorageMasks(exact, underMarked).missedReferenceTiles, 1);
}

// RGBA16F is scanned as raw bytes too: a non-zero high half in the second word
// of a texel must still keep the tile.
{
  const pixels = new Uint8Array(256 * 256 * 8);
  pixels[7] = 0x80;
  assert.equal(
    countLayerStorageTiles(exactLayerStorageTileMask(pixels, 256, 256, 8)),
    1,
  );
}

// Deterministic differential fuzz: every non-zero texel chosen inside a dirty
// rect must be covered by the conservative mask. Over-marking is allowed.
{
  let state = 0x12345678;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const pixels = new Uint8Array(512 * 512 * 4);
  const conservative = createLayerStorageTileMask();
  for (let index = 0; index < 128; index += 1) {
    const x = Math.floor(random() * 500);
    const y = Math.floor(random() * 500);
    const width = 1 + Math.floor(random() * (512 - x));
    const height = 1 + Math.floor(random() * (512 - y));
    markLayerStorageRect(conservative, { x, y, width, height });
    const pixelX = x + Math.floor(random() * width);
    const pixelY = y + Math.floor(random() * height);
    pixels[(pixelY * 512 + pixelX) * 4] = 1;
  }
  const exact = exactLayerStorageTileMask(pixels, 512, 512, 4);
  assert.equal(compareLayerStorageMasks(exact, conservative).missedReferenceTiles, 0);
}

assert.throws(
  () => exactLayerStorageTileMask(new Uint8Array(3), 1, 1, 4),
  /Readback non valido/,
);

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
      needsOuterShadowRenderer: false,
      needsInnerShadowRenderer: false,
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
  assert.deepEqual(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: false },
      { enabled: true },
      { enabled: false },
    ),
    {
      needsStrokeRenderer: true,
      needsBevelRenderer: false,
      needsOuterShadowRenderer: true,
      needsInnerShadowRenderer: false,
      strokeWidth: 14,
    },
  );
  assert.equal(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: false },
      { enabled: false },
      { enabled: true },
    ).needsInnerShadowRenderer,
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
const engineSource = readEngineSource();
assert.match(
  engineSource,
  /async readLayerPixels\(rect\?: DirtyRect, layerIndex\?: number\): Promise<Uint8Array>/,
);
// Reading a NAMED layer is what makes the test bilateral: "A kept its pixels
// while B was rebuilt" needs both records. Cold records are rehydrated only for
// the probe and the temporary full texture must be released in finally.
const probeStart = engineSource.indexOf("async readLayerPixels(");
const probeBody = engineSource.slice(probeStart, probeStart + 2_600);
assert.match(probeBody, /import\.meta\.env\.DEV/, "la sonda deve restare solo-dev");
assert.match(probeBody, /const record = layerIndex === undefined/);
assert.match(probeBody, /if \(gpu\.hot\)/);
assert.match(probeBody, /await createHydratedLayerTexture\(this,/);
assert.match(
  probeBody,
  /finally \{\s*destroyTransientLayerHydration\(this, hydration\);/,
  "la sonda cold deve sempre rilasciare la reidratazione full-canvas",
);
const textureProbeStart = engineSource.indexOf("async readTexturePixels(");
const textureProbeBody = engineSource.slice(textureProbeStart, textureProbeStart + 3_000);
assert.match(textureProbeBody, /copyTextureToBuffer/);
assert.match(textureProbeBody, /\{ texture: target, mipLevel, origin:/,
  "la sonda deve inoltrare esplicitamente il mip richiesto");
assert.match(textureProbeBody, /Math\.ceil\(unpaddedBytesPerRow \/ 256\) \* 256/,
  "bytesPerRow deve restare allineato a 256");
assert.match(
  textureProbeBody,
  /destroyTrackedReadbackBuffer\(this, readbackBuffer, readbackBytes\)/,
  "la sonda deve rilasciare il buffer attraverso la contabilità dev",
);
const destroyReadbackStart = engineSource.indexOf("export function destroyTrackedReadbackBuffer(");
const destroyReadbackBody = engineSource.slice(destroyReadbackStart, destroyReadbackStart + 500);
assert.match(destroyReadbackBody, /buffer\.destroy\(\)/, "il rilascio tracciato deve distruggere il buffer");
assert.match(destroyReadbackBody, /engine\.devReadbackActiveBytes -= size/,
  "il rilascio tracciato deve azzerare la residenza temporanea");

// Steps 12–14: analytic bakes are transactional, transient and bounded by the
// conservative union of every active effect's final-pixel domain. A successful
// rebuild folds them into at most two persistent surfaces, then releases every
// per-layer bake. Raw inactive layers own no mip chain.
assert.match(engineSource, /LAYER_BAKE_STRATEGY =\s*\n\s*"transient-analytic-bounded-visual-rect-no-handoff-residency-mip0-fused-into-two-merged-surfaces"/);
assert.match(
  engineSource,
  /LAYER_COMPOSITE_STRATEGY =\s*\n\s*"merged-above-over-active-over-merged-below-source-over-evict-derived-before-rebuild-deferred-to-fold-fence-bounded-visual-rect"/,
);
assert.ok(
  (engineSource.match(/layerBakeStrategy: LAYER_BAKE_STRATEGY/g) ?? []).length >= 2,
  "stats e benchmark devono firmare la strategia dei bake",
);
assert.ok(
  (engineSource.match(/layerCompositeStrategy: LAYER_COMPOSITE_STRATEGY/g) ?? []).length >= 2,
  "stats e benchmark devono firmare la strategia di compositing",
);
const retargetStart = engineSource.indexOf("export async function retargetEffectsWorkingSetInternal(");
const retargetEnd = engineSource.indexOf("export async function benchmarkEffectsWorkingSet(", retargetStart);
const retargetBody = engineSource.slice(retargetStart, retargetEnd);
assert.match(retargetBody, /completionPolicy: LayerGpuCompletionPolicy = "await-immediately"/);
assert.match(retargetBody, /rebuildDomain: LayerEffectsRebuildDomain = "full-document"/);
assert.match(retargetBody, /styleStackRetargetBounds = rebuildDomain === "content-bounds"/,
  "solo il fold inattivo può restringere il dominio del rebuild analitico");
assert.match(retargetBody, /if \(completionPolicy === "await-immediately"\) \{\s*await engine\.waitForIdle\(\);/,
  "il retarget pubblico deve conservare il fence iniziale");
assert.match(retargetBody, /if \(completionPolicy === "await-immediately"\) \{\s*await engine\.waitForGpuCapped\(`Retarget banco effetti #\$\{generation\}`\);/,
  "solo la catena fold può rinviare il timeout GPU al fence del record");
const bakeCandidateStart = engineSource.indexOf("async createLayerBakeCandidate(");
const bakeCandidateEnd = engineSource.indexOf("async bakeActiveLayerForSwitch(", bakeCandidateStart);
const bakeCandidateBody = engineSource.slice(bakeCandidateStart, bakeCandidateEnd);
assert.match(bakeCandidateBody, /runGpuAllocationTransaction\(/,
  "il bake deve restare dentro allocation, validation, submit e rollback atomici");
assert.match(bakeCandidateBody, /GPUTextureUsage\.STORAGE_BINDING/);
assert.match(bakeCandidateBody, /GPUTextureUsage\.TEXTURE_BINDING/);
assert.match(bakeCandidateBody, /GPUTextureUsage\.COPY_SRC/);
assert.match(bakeCandidateBody, /renderer\.encodeBake\(/,
  "la fusione deve partire dal compositore analitico promosso dal golden");
assert.match(bakeCandidateBody, /const nonTransparentBounds = layerCompositeVisualBounds\(this, record\)/);
assert.match(bakeCandidateBody, /rect: nonTransparentBounds/,
  "il bake analitico inattivo non deve tornare al dispatch 4096²");
assert.match(bakeCandidateBody, /nonTransparentBounds: \{ \.\.\.nonTransparentBounds \}/);
assert.match(bakeCandidateBody, /await this\.waitForGpuCapped\(`/,
  "ogni nuovo submit atteso deve avere un timeout");
assert.match(bakeCandidateBody, /maybeInjectLayerBakeFault\(this, "after-candidate-submit"\)/);
assert.match(engineSource, /readonly liveLayerBakeTextures = new Map<GPUTexture, number>\(\)/);
assert.match(engineSource, /transaction\.deferRollback\(\(\) => destroyLayerBakeTexture\(this, texture\)\)/,
  "il fault post-submit deve rendere osservabile anche il rilascio del candidato");

// Il percorso raster è condiviso anche dallo stack misto; includi l'helper
// estratto nel corpo verificato, non soltanto il wrapper legacy.
const mergedStart = engineSource.indexOf(
  "export async function foldRasterRecordIntoMergedSurface(",
);
const mergedEnd = engineSource.indexOf(
  "export async function restoreEffectsWorkbenchToActiveLayer(",
  mergedStart,
);
assert.ok(mergedStart >= 0 && mergedEnd > mergedStart, "sezione merged surface non trovata");
const mergedBody = engineSource.slice(mergedStart, mergedEnd);
assert.match(mergedBody, /record\.visible && record\.opacity > 0 && record\.hasContent/);
assert.match(mergedBody, /await materializeLayerCompositeSource\(engine, record, caller\)/);
assert.match(
  engineSource,
  /layerCompositeVisualBounds\([\s\S]*?rasterStrokeEffectRect[\s\S]*?rasterBevelEffectRect[\s\S]*?rasterOuterShadowEffectRect[\s\S]*?rasterInnerShadowEffectRect/,
  "i bounds del bake devono unire Traccia, Smusso e le due Ombre",
);
assert.match(
  engineSource,
  /export async function materializeLayerCompositeSource\([\s\S]*?"defer-to-fold-fence"[\s\S]*?"defer-to-fold-fence"[\s\S]*?"defer-to-fold-fence"/,
  "hydrate, retarget e bake temporanei devono appartenere allo stesso fence del fold",
);
assert.ok(
  mergedBody.indexOf("this.device.queue.submit([encoder.finish()]);")
    < mergedBody.indexOf("await engine.waitForGpuCapped(`Fold livello ${record.id}`);"),
  "il fence unico del record deve seguire il submit del fold",
);
assert.match(mergedBody, /if \(first && record\.opacity >= 1 && surface\.resolutionScale === 1\)/,
  "il primo livello opaco deve evitare il pass full-document");
assert.match(mergedBody, /encoder\.copyTextureToTexture\(/,
  "il percorso veloce deve conservare esattamente i texel sorgente");
assert.match(mergedBody, /pass\.setScissorRect\(/,
  "i fold renderizzati devono restare limitati ai bounds conservativi");
assert.match(mergedBody, /new ArrayBuffer\(LAYER_COMPOSITE_UNIFORM_BYTES\)/);
assert.match(mergedBody, /uniformF32\[0\] = surface\.bounds\.x/);
assert.match(mergedBody, /uniformF32\[1\] = surface\.bounds\.y/);
assert.match(mergedBody, /uniformF32\[2\] = surface\.resolutionScale/);
assert.match(mergedBody, /uniformF32\[3\] = record\.opacity/);
assert.match(mergedBody, /mergedSurfacePhysicalRect\(/);
assert.match(mergedBody, /engine\.layerCompositePipeline/);
assert.match(mergedBody, /engine\.destroyLayerBake\(source\.transientBake\)/);
assert.match(
  engineSource,
  /async rebuildMergedLayerSurfaces\(\s*caller: EffectsRetargetCaller = "layer-switch",\s*view: VectorTextViewState = this\.getVectorTextViewState\(\),\s*options: RebuildMergedLayerSurfacesOptions = \{\},\s*\): Promise<void>/,
);
const rebuildMethodStart = engineSource.indexOf("async rebuildMergedLayerSurfaces(");
const rebuildMethodEnd = engineSource.indexOf("  async addLayer(", rebuildMethodStart);
const rebuildMethodBody = engineSource.slice(rebuildMethodStart, rebuildMethodEnd);
const rebuildFreeze = rebuildMethodBody.indexOf("this.layerPresentationFrozen = true;");
const rebuildDestroyBelow = rebuildMethodBody.indexOf("this.destroyMergedSurface(previousBelow);");
const rebuildDestroyAbove = rebuildMethodBody.indexOf("this.destroyMergedSurface(previousAbove);");
const rebuildFirstCandidate = rebuildMethodBody.indexOf("candidateBelow = await buildMergedSurfaceCandidate(this, ");
assert.ok(
  rebuildFreeze >= 0
    && rebuildDestroyBelow > rebuildFreeze
    && rebuildDestroyAbove > rebuildFreeze
    && rebuildFirstCandidate > rebuildDestroyBelow
    && rebuildFirstCandidate > rebuildDestroyAbove,
  "le superfici fuse precedenti devono essere evacuate prima di allocare i candidati",
);
assert.match(
  rebuildMethodBody,
  /rebuildLayerDisplayBindGroups\(this\);[\s\S]*?this\.layerPresentationFrozen = false;/,
  "la presentazione può ripartire solo dopo la pubblicazione dei nuovi bind group",
);
assert.match(
  engineSource,
  /renderFrame\(timestamp: number\): void \{[\s\S]*?if \(this\.layerPresentationFrozen\) \{[\s\S]*?return;/,
  "nessun frame deve referenziare view evacuate durante la ricostruzione",
);
assert.match(
  engineSource,
  /record\.visible = previousVisible;[\s\S]*?record\.opacity = previousOpacity;[\s\S]*?await engine\.rebuildMergedLayerSurfaces\("layer-switch"\)/,
  "il rollback dello stile deve ricostruire le superfici evacuate dai raw autorevoli",
);
assert.match(
  engineSource,
  /export async function materializeLayerCompositeSource\([\s\S]*?caller: EffectsRetargetCaller,[\s\S]*?retargetEffectsWorkingSetInternal\([\s\S]*?caller,/,
  "la fusione deve conservare l'esenzione history-replay durante i retarget temporanei",
);
assert.match(
  engineSource,
  /foldRasterRecordIntoMergedSurface\([\s\S]*?caller: EffectsRetargetCaller,[\s\S]*?materializeLayerCompositeSource\(engine, record, caller\)/,
);
assert.match(
  engineSource,
  /async activateLayer\([\s\S]*?caller: EffectsRetargetCaller = "layer-switch",[\s\S]*?rebuildMergedLayerSurfaces\(caller\)/,
  "Undo/Redo cross-layer deve propagare il caller anche al compositing dei livelli",
);
assert.match(engineSource, /maybeInjectLayerCompositeFault\(this, "after-candidate-submit"\)/);
assert.match(engineSource, /let activeWorkbenchRestored = false;/);
assert.match(engineSource, /if \(!activeWorkbenchRestored\) \{[\s\S]*?restoreEffectsWorkbenchToActiveLayer\(this, caller, true\)/,
  "un errore durante la fusione deve forzare il retarget inverso del banco");
assert.match(engineSource, /Stato incoerente dopo il compositing: ricarica prima di continuare/);
assert.match(engineSource, /latchDocumentStateInconsistent\(message: string\): void/);
assert.match(engineSource, /this\.historyStateInconsistent = true;[\s\S]*?this\.historyBusy = true;/,
  "il latch documentale deve bloccare ogni mutazione successiva");
assert.match(engineSource, /releaseFusedLayerBakes\(this\)/);
assert.match(engineSource, /readonly liveMergedSurfaceTextures = new Map<GPUTexture, MergedSurfaceResources>\(\)/);
assert.match(engineSource, /layerCompositeMiB/,
  "le superfici fuse e i bake transitori devono avere righe di memoria distinte");
const compositePipelineStart = engineSource.indexOf("const layerCompositePipeline = engine.device.createRenderPipeline(");
const compositePipelineBody = engineSource.slice(compositePipelineStart, compositePipelineStart + 1_100);
assert.match(
  compositePipelineBody,
  /srcFactor: "one", dstFactor: "one-minus-src-alpha"/,
  "la fusione deve usare source-over premoltiplicato",
);
assert.match(mergedBody, /loadOp: first \? "clear" : "load"/,
  "il primo livello pulisce la superficie, i successivi si fondono sul risultato");

// Le allocazioni delle risorse di livello vivono in `engine-layer-runtime`:
// la sezione parte dalla definizione, non dalla prima chiamata.
// `allocateLayerTexture` è rimasta un membro del motore, la piramide e le
// superfici fuse sono in `engine-layer-runtime`: la sezione le copre entrambe.
const allocationStart = engineSource.indexOf("  allocateLayerTexture(format: LayerFormat)");
assert.ok(allocationStart >= 0, "allocateLayerTexture non trovata");
const pyramidStart = engineSource.indexOf("export function allocateActiveLayerDisplayPyramid(");
assert.ok(pyramidStart >= 0, "allocateActiveLayerDisplayPyramid non trovata");
const mergedSurfaceStart = engineSource.indexOf("export function allocateMergedSurface(");
assert.ok(mergedSurfaceStart >= 0, "allocateMergedSurface non trovata");
const allocationBody = engineSource.slice(allocationStart, allocationStart + 1_500)
  + engineSource.slice(pyramidStart, pyramidStart + 2_000)
  + engineSource.slice(mergedSurfaceStart, mergedSurfaceStart + 4_000);
assert.match(allocationBody, /mipLevelCount: 1/,
  "ogni layer inattivo deve possedere soltanto il mip 0 autorevole");
// `allocateActiveLayerDisplayPyramid(` e `allocateMergedSurface(` non vanno
// asseriti qui: la finestra è costruita partendo da quelle stesse stringhe,
// quindi l'asserzione sarebbe vera per costruzione. Restano i vincoli sul
// contenuto, che sono l'unica cosa che può regredire.
assert.match(allocationBody, /mipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT - 1/);
assert.match(allocationBody, /const mipLevelCount = mergedSurfaceMipLevelCount\(physicalBounds\)/);
assert.match(allocationBody, /const textureWidth = normalizedBounds\.width \* resolutionScale/);
assert.match(allocationBody, /const textureHeight = normalizedBounds\.height \* resolutionScale/);
assert.match(allocationBody, /mip0MemoryBytes: memory\.mip0Bytes/);
assert.match(allocationBody, /mipChainMemoryBytes: memory\.mipChainBytes/);
assert.match(allocationBody, /GPUTextureUsage\.COPY_DST/,
  "la superficie fusa deve accettare il percorso veloce byte-esatto");
assert.match(
  engineSource,
  /export async function allocateLayerGpuResources\([\s\S]*?runGpuAllocationTransaction\(engine\.device, label/,
  "l'allocazione completa del mip 0 deve chiudere validation e OOM scope prima del commit",
);
assert.equal(
  (engineSource.match(/label: `4096² authoritative paint layer \$\{format\}`/g) ?? []).length,
  1,
  "la creazione della texture autorevole deve esistere in un solo punto",
);

// Every display path receives below/active/above before checkerboard and sRGB.
assert.match(engineSource, /this\.displayUniformUpload\[9\] = this\.mergedBelow\?\.resolutionScale \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[10\] = this\.mergedAbove\?\.resolutionScale \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[11\] = this\.layerStack\.active\.visible/);
assert.match(engineSource, /this\.displayUniformUpload\[12\] = this\.mergedBelow\?\.bounds\.x \?\? 0/);
assert.match(engineSource, /this\.displayUniformUpload\[15\] = this\.mergedAbove\?\.bounds\.y \?\? 0/);
const shaderSource = readFileSync(new URL("../src/shaders.ts", import.meta.url), "utf8");
const mergedSurfaceShaderSource = readFileSync(
  new URL("../src/merged-surface-shader.ts", import.meta.url),
  "utf8",
);
assert.match(shaderSource, /fn composeLayerStack\(activePaint: vec4<f32>, layerPosition: vec2<f32>\)/);
assert.match(shaderSource, /paint = sourceOver\(activePaint \* display\.activeLayerAlpha, paint\)/);
assert.match(mergedSurfaceShaderSource, /sampleMergedAbove\(layerPosition/);
assert.match(mergedSurfaceShaderSource, /layerPosition - display\.mergedAboveOrigin/);
assert.equal(
  (shaderSource.match(/fn composeLayerStack\(activePaint: vec4<f32>, layerPosition: vec2<f32>\)/g) ?? []).length,
  1,
  "il display base conserva la firma raster senza texture testo",
);
assert.equal(
  (shaderSource.match(/fn composeLayerStack\(\s*activePaint: vec4<f32>,\s*layerPosition: vec2<f32>,\s*fragmentPosition: vec2<f32>/g) ?? []).length,
  2,
  "coda e Light Glaze devono accettare le coordinate viewport del testo",
);
assert.match(shaderSource, /composeLayerStack\(sampleActiveLayer\(uv\), layerPosition\)/);
assert.equal(
  (shaderSource.match(/paint = composeLayerStack\(paint, layerPosition, fragmentPosition\.xy\);/g) ?? []).length,
  2,
  "coda e Light Glaze devono comporre merged e testo in coordinate documento\/viewport",
);
const strokeRendererSource = readFileSync(
  new URL("../src/stroke-renderer.ts", import.meta.url),
  "utf8",
);
assert.match(strokeRendererSource, /paint = composeLayerStack\(paint, layerPosition, fragmentPosition\.xy\);/);
assert.match(strokeRendererSource, /@group\(1\) @binding\(15\) var mergedBelowTexture/);
assert.match(strokeRendererSource, /@group\(1\) @binding\(16\) var mergedAboveTexture/);
assert.ok(
  shaderSource.indexOf("paint = composeLayerStack(paint, layerPosition, fragmentPosition.xy);")
    < shaderSource.indexOf(
      "let checkerCell",
      shaderSource.indexOf("paint = composeLayerStack(paint, layerPosition, fragmentPosition.xy);"),
    ),
  "la coda spessore deve comporre layer e testo prima della scacchiera e della conversione sRGB",
);// All four effect styles must live on the layer record, not on the engine, or a
// switch would show the outgoing layer's effects on the incoming one.
// Accessors keep existing call sites working while making the styles
// follow the active layer by construction rather than by remembering to copy.
assert.match(engineSource, /readonly layerStack = new LayerStack\(\(\) => \(\{/);
assert.match(
  engineSource,
  /get rasterStrokeStyle\(\): RasterStrokeStyle \{\s*return this\.layerStack\.active\.strokeStyle;/,
);
assert.match(
  engineSource,
  /get rasterBevelStyle\(\): RasterBevelStyle \{\s*return this\.layerStack\.active\.bevelStyle;/,
);
assert.match(
  engineSource,
  /get rasterOuterShadowStyle\(\): RasterOuterShadowStyle \{\s*return this\.layerStack\.active\.outerShadowStyle;/,
);
assert.match(
  engineSource,
  /get rasterInnerShadowStyle\(\): RasterInnerShadowStyle \{\s*return this\.layerStack\.active\.innerShadowStyle;/,
);
assert.doesNotMatch(
  engineSource,
  /(private )?rasterStrokeStyle: RasterStrokeStyle =/,
  "lo stile Traccia non può tornare a essere un campo del motore",
);
assert.doesNotMatch(
  engineSource,
  /(private )?rasterBevelStyle: RasterBevelStyle =/,
  "lo stile Smusso non può tornare a essere un campo del motore",
);
assert.doesNotMatch(
  engineSource,
  /(private )?rasterOuterShadowStyle: RasterOuterShadowStyle =/,
  "lo stile Ombra esterna non può tornare a essere un campo del motore",
);
assert.doesNotMatch(
  engineSource,
  /(private )?rasterInnerShadowStyle: RasterInnerShadowStyle =/,
  "lo stile Ombra interna non può tornare a essere un campo del motore",
);

// After a switch the effect controls must be re-read from the engine, or the
// panel would show the outgoing layer's Traccia and Smusso while the brush
// paints on the incoming one — wrong in a way that looks like a rendering bug.
const mainSource = readFileSync(
  new URL("../src/main.ts", import.meta.url),
  "utf8",
);
const indexSource = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
assert.equal(
  (mainSource.match(/performanceTelemetryRevision: 58/g) ?? []).length,
  2,
  "tipo persistito e runtime devono avanzare insieme alla revisione 54",
);
assert.match(mainSource, /layerBakeStrategy: string;/);
assert.match(mainSource, /layerCompositeStrategy: string;/);
assert.match(mainSource, /async function changeLayerVisibility\(/);
assert.match(mainSource, /async function changeLayerOpacity\(/);
assert.match(mainSource, /function syncActiveLayerControls\(\): void \{/);
const syncStart = mainSource.indexOf("function syncActiveLayerControls(");
const syncBody = mainSource.slice(syncStart, syncStart + 600);
assert.match(syncBody, /syncRasterStrokeControls\(engine\.getRasterStrokeStyle\(\)\)/);
assert.match(syncBody, /syncRasterOuterShadowControls\(engine\.getRasterOuterShadowStyle\(\)\)/);
assert.match(syncBody, /syncRasterInnerShadowControls\(engine\.getRasterInnerShadowStyle\(\)\)/);
assert.match(syncBody, /syncRasterBevelControls\(engine\.getRasterBevelStyle\(\)\)/);
const selectStart = mainSource.indexOf("async function selectLayer(");
assert.notEqual(selectStart, -1, "selectLayer deve esistere");
assert.match(
  mainSource.slice(selectStart, selectStart + 1_400),
  /await engine\.setActiveLayer\(index\);\s*syncActiveLayerControls\(\);/,
  "il cambio livello deve risincronizzare i controlli degli effetti",
);
assert.match(
  mainSource,
  /const result = await engine\.addLayer\(\);\s*syncActiveLayerControls\(\);/,
  "anche la creazione di un livello deve risincronizzare i controlli",
);
assert.match(
  indexSource,
  /id="layerLoadingOverlay"[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?hidden/,
  "il cambio livello deve avere un indicatore fullscreen annunciato e inizialmente nascosto",
);
assert.match(stylesSource, /\.layer-loading-overlay \{[\s\S]*?position: fixed;[\s\S]*?inset: 0;/);
assert.match(stylesSource, /\.layer-loading-overlay\[hidden\] \{\s*display: none;/);
const loadingStyles = stylesSource.slice(
  stylesSource.indexOf(".layer-loading-overlay {"),
  stylesSource.indexOf(".layer-loading-overlay[hidden]"),
);
assert.match(loadingStyles, /background: rgba\(9, 11, 15, 0\.38\);/);
assert.match(loadingStyles, /-webkit-backdrop-filter: blur\(3px\);/);
assert.match(loadingStyles, /backdrop-filter: blur\(3px\);/);
assert.doesNotMatch(
  loadingStyles,
  /background: #0d0f13;/,
  "il loader non deve più sembrare un ricaricamento opaco dell'intera app",
);
assert.match(
  stylesSource,
  /\.layer-loading-content \{[\s\S]*?background: rgba\(20, 23, 31, 0\.84\);/,
  "spinner e testo devono restare in una piccola scheda semitrasparente",
);
const loadingStart = mainSource.indexOf("async function showLayerLoading(");
const loadingBody = mainSource.slice(loadingStart, loadingStart + 900);
assert.match(loadingBody, /layerLoadingOverlay\.hidden = false;/);
assert.match(
  loadingBody,
  /await nextAnimationFrame\(\);\s*await nextAnimationFrame\(\);/,
  "il loader deve ricevere un paint prima del lavoro di cambio livello",
);
assert.match(loadingBody, /layerLoadingOverlay\.hidden = true;/);
const selectUiBody = mainSource.slice(selectStart, selectStart + 2_300);
assert.match(
  selectUiBody,
  /await showLayerLoading\("Caricamento livello…"\);[\s\S]*?await engine\.setActiveLayer\(index\);[\s\S]*?await engine\.waitForIdle\(\);/,
  "il loader dello switch deve coprire anche presentazione e completamento GPU",
);
assert.match(selectUiBody, /finally \{[\s\S]*?hideLayerLoading\(\);/);
const addUiStart = mainSource.indexOf('addLayerButton.addEventListener("click"');
const addUiBody = mainSource.slice(addUiStart, addUiStart + 1_300);
assert.match(
  addUiBody,
  /await showLayerLoading\("Creazione livello…"\);[\s\S]*?await engine\.addLayer\(\);[\s\S]*?await engine\.waitForIdle\(\);/,
  "anche il nuovo livello deve restare coperto finché il frame è pronto",
);
assert.match(addUiBody, /finally \{[\s\S]*?hideLayerLoading\(\);/);

// The record's hasContent is only written back when a layer stops being active,
// so reading it for the ACTIVE layer would report "empty" while the user paints.
assert.match(
  engineSource,
  /hasContent: record\.id === engine\.layerStack\.active\.id\s*\?\s*engine\.layerHasContent\s*:\s*record\.hasContent/,
  "hasContent del livello attivo deve venire dal campo vivo, non dal record",
);
// The switch result must not claim to report a rebuilt pyramid level: the switch
// only invalidates the pyramid, and the next frame rebuilds it.
assert.doesNotMatch(engineSource, /rebuiltPyramidThroughLevel/);

// Replay is layer-aware through the same pure selector exercised behaviorally by
// history:verify. This assertion is only the integration seam: it prevents the
// engine from drifting back to a second, untested implementation.
const rebuildStart = engineSource.indexOf("export async function rebuildActiveLayerFromHistory(");
assert.notEqual(rebuildStart, -1, "il replay deve dichiarare di ricostruire il livello ATTIVO");
const rebuildBody = engineSource.slice(rebuildStart, rebuildStart + 1_500);
assert.match(
  rebuildBody,
  /\} = selectLayerReplay\(\s*engine\.historyActions,\s*engine\.historyCursor,\s*engine\.historyBatches,\s*layerId,\s*\)/,
  "il replay reale deve usare il selettore per-livello testato",
);
// Nothing in the replay may index the unfiltered array, or a single stray index
// would reintroduce another layer's batch.
// Il ricevitore è alternato: nella classe è `this`, nei moduli estratti è
// `engine`. Un negativo ancorato a un solo ricevitore non fallirebbe mai.
assert.doesNotMatch(
  engineSource.slice(rebuildStart, rebuildStart + 5_000),
  /(this|engine)\.historyBatches\[/,
  "il replay non deve indicizzare l'array non filtrato",
);

// Crossing another LIVE layer is supported transactionally. Only a step whose
// owner was deleted is refused, both in button state and in the engine API.
assert.match(
  engineSource,
  /export function historyStepBlockedByLayer\(engine: BrushEngine, delta: -1 \| 1\): boolean \{/,
);
const historyGateStart = engineSource.indexOf("export function historyStepBlockedByLayer(");
const historyGateEnd = engineSource.indexOf(
  "export function maybeInjectHistoryReplayFault(",
  historyGateStart,
);
assertSection("historyStepBlockedByLayer", historyGateStart, historyGateEnd);
const historyGateBody = engineSource.slice(historyGateStart, historyGateEnd);
assert.match(
  historyGateBody,
  /return historyStepTargetsMissingLayer\(/,
  "anche il gate per-passo deve usare la funzione pura testata",
);
assert.match(engineSource, /&& !historyStepBlockedByLayer\(this, -1\)/);
assert.match(engineSource, /&& !historyStepBlockedByLayer\(this, 1\)/);
const cursorStart = engineSource.indexOf("export async function moveHistoryCursor(");
const cursorEnd = engineSource.indexOf(
  "export async function rebuildActiveLayerFromHistory(",
  cursorStart,
);
const cursorBody = engineSource.slice(cursorStart, cursorEnd);
assert.match(
  cursorBody,
  /if \(historyStepBlockedByLayer\(engine, delta\)\) \{/,
  "il gate deve valere anche chiamando l'API, non solo il bottone",
);
assert.match(
  cursorBody,
  /delta < 0[\s\S]*impossibile annullarlo[\s\S]*impossibile ripristinarlo/,
  "il messaggio del gate deve distinguere Undo da Redo",
);

// The cross-layer transaction has three non-interchangeable phases: derive the
// switch before the awaited activation, restore a partially written TARGET under
// the old cursor, then reactivate the original layer. Reversing the last two loses
// pixels while CPU cursor/index state still looks correct.
const evictStart = engineSource.indexOf("export function evictReconstructibleLayerResources(");
const evictEnd = engineSource.indexOf("export async function ensureActiveLayerHot(", evictStart);
const evictBody = engineSource.slice(evictStart, evictEnd);
assert.match(
  evictBody,
  /if \(record\.hasContent && !gpu\.cold && !gpu\.compressed\)[\s\S]*?throw new Error/,
  "un hot con contenuto non può essere evacuato senza storage raw o compresso autorevole",
);
const evictFreeze = evictBody.indexOf("engine.layerPresentationFrozen = true;");
const evictBake = evictBody.indexOf("engine.destroyLayerBake(gpu.bake);");
const evictHot = evictBody.indexOf("destroyLayerHot(gpu.hot);");
assert.ok(
  evictFreeze >= 0 && evictBake > evictFreeze && evictHot > evictBake,
  "l'evizione deve congelare il display e liberare bake e hot in quest'ordine",
);
const prepareStart = engineSource.indexOf("async prepareActiveLayerForSwitch(");
const prepareBody = engineSource.slice(prepareStart, prepareStart + 1_800);
assert.match(
  prepareBody,
  /if \(import\.meta\.env\.DEV && this\.layerBakeFaultQueue\.length > 0\) \{\s*await bakeActiveLayerForSwitch\(this\);/,
  "il bake completo resta soltanto come sonda transazionale DEV",
);
const prepareFreeze = prepareBody.indexOf("await freezeActiveLayerToCold(this);");
const prepareEvict = prepareBody.indexOf(
  "evictReconstructibleLayerResources(this, this.layerStack.active);",
);
assert.ok(
  prepareFreeze >= 0 && prepareEvict > prepareFreeze,
  "la preparazione deve completare il cold autorevole prima dell'evizione",
);
assert.match(prepareBody, /catch \(error\)[\s\S]*?this\.destroyLayerBake\(gpu\.bake\)/,
  "un pack fallito deve rilasciare l'eventuale bake della sonda DEV");
const switchedDeclaration = cursorBody.indexOf("const switched =");
const historyOutgoingPrepare = cursorBody.indexOf("await engine.prepareActiveLayerForSwitch();");
const forwardIndexChange = cursorBody.indexOf("engine.layerStack.setActiveIndex(targetIndex);");
const forwardActivation = cursorBody.indexOf(
  'await engine.activateLayer(previousActiveIndex, "history-replay");',
);
assert.ok(switchedDeclaration >= 0 && switchedDeclaration < forwardActivation,
  "switched deve essere noto prima che activateLayer possa fallire");
assert.ok(
  historyOutgoingPrepare > switchedDeclaration && historyOutgoingPrepare < forwardIndexChange,
  "Undo/Redo cross-layer deve preparare il cold ed evacuare l'uscente prima del target",
);
const operationCatch = cursorBody.indexOf("catch (operationError)");
const cursorRestore = cursorBody.indexOf("engine.historyCursor = previousCursor;", operationCatch);
const targetRestore = cursorBody.indexOf(
  "await rebuildActiveLayerFromHistory(engine);",
  operationCatch,
);
const rollbackPrepare = cursorBody.indexOf(
  "await engine.prepareActiveLayerForSwitch();",
  operationCatch,
);
const reverseIndex = cursorBody.indexOf(
  "engine.layerStack.setActiveIndex(previousActiveIndex);",
  operationCatch,
);
const reverseActivation = cursorBody.indexOf(
  'await engine.activateLayer(targetIndex, "history-replay");',
  operationCatch,
);
assert.ok(
  operationCatch >= 0
    && cursorRestore > operationCatch
    && targetRestore > cursorRestore
    && rollbackPrepare > targetRestore
    && reverseIndex > rollbackPrepare
    && reverseActivation > reverseIndex,
  "il rollback deve ripristinare, impacchettare e poi lasciare il target",
);
const rollbackEvict = cursorBody.indexOf(
  "evictReconstructibleLayerResources(engine, engine.layerStack.at(targetIndex));",
  operationCatch,
);
assert.ok(
  rollbackEvict > rollbackPrepare && rollbackEvict < reverseIndex,
  "il rollback history deve evacuare il target fallito prima di reidratare l'origine",
);
assert.match(cursorBody, /engine\.historyStateInconsistent = true;/,
  "un rollback fallito deve alzare il latch fatale");
assert.match(cursorBody, /if \(switched && targetPreparedForRelease\)/,
  "un pack fallito deve conservare il full-canvas e impedire lo switch inverso distruttivo");
assert.match(cursorBody, /Ricarica la pagina prima di continuare/,
  "anche l'errore propagato alla UI deve dire che serve il reload");
assert.match(cursorBody, /engine\.historyBusy = engine\.historyStateInconsistent;/,
  "il latch fatale deve mantenere bloccate le mutazioni");
assert.match(cursorBody, /engine\.historyReplayFaultQueue = \[\];/,
  "un fault point non consumato non deve contaminare la transazione successiva");
assert.match(cursorBody, /engine\.layerColdStorageFaultQueue = \[\];/,
  "un fault cold non consumato non deve contaminare la transazione successiva");
assert.match(engineSource, /inconsistent: this\.historyStateInconsistent/,
  "lo stato fatale deve essere osservabile dalla UI e dai test");
// One fault point lands in the half-switch window, after engine/Blend changed
// source but before the workbench; the other lands only after a real GPU submit.
const activateStart = engineSource.indexOf("  async activateLayer(");
const activateEnd = engineSource.indexOf(
  "  destroyThicknessTailOverlayResources(): void",
  activateStart,
);
assertSection("activateLayer", activateStart, activateEnd);
const activateBody = engineSource.slice(activateStart, activateEnd);
const blendRetarget = activateBody.indexOf("this.blendRenderer?.retarget(");
const switchFault = activateBody.indexOf(
  'maybeInjectHistoryReplayFault(this, "during-switch-activation")',
);
const workbenchRetarget = activateBody.indexOf("retargetEffectsWorkingSetInternal(this, ");
assert.ok(
  blendRetarget >= 0 && switchFault > blendRetarget && workbenchRetarget > switchFault,
  "il fault di attivazione deve discriminare davvero uno switch parziale",
);
const replayEnd = engineSource.indexOf(
  "export async function applyVectorHistoryState(",
  rebuildStart,
);
assertSection("rebuildActiveLayerFromHistory", rebuildStart, replayEnd);
const replayBody = engineSource.slice(rebuildStart, replayEnd);
assert.match(replayBody, /maybeInjectHistoryReplayFault\(engine, "after-first-replay-submit"\)/);
assert.ok(
  [...replayBody.matchAll(/observeReplaySubmit\(\);/g)].length >= 4,
  "ogni variante del primo submit Paint/Blend/clear deve raggiungere il fault point",
);

// The GPU regression is persistent, destructive on a fresh page and capped.
// History rollback and the absolute three-surface compositor references run in
// the same `?layerHistoryTest=1` harness.
const layerHistoryGpuTestSource = readFileSync(
  new URL("../src/layer-history-gpu-test.ts", import.meta.url),
  "utf8",
);
const layerCompositeGpuTestSource = readFileSync(
  new URL("../src/layer-composite-gpu-test.ts", import.meta.url),
  "utf8",
);
assert.match(mainSource, /pageSearchParams\.get\("layerHistoryTest"\) === "1"/);
assert.match(mainSource, /await import\("\.\/layer-history-gpu-test"\)/);
assert.match(mainSource, /runLayerHistoryGpuTest\(engine\)/);
assert.match(
  mainSource,
  /const report = await Promise\.race\(\[\s*runLayerHistoryGpuTest\(engine\),/,
  "l'esecuzione dell'harness deve avere un tetto di tempo",
);
assert.match(mainSource, /Test livelli scaduto dopo 180 s/);
assert.match(mainSource, /180_000/);
assert.match(mainSource, /window\.clearTimeout\(timeoutId\)/,
  "il timer dell'harness deve essere disarmato dopo successo o errore");
assert.match(mainSource, /layerHistoryTestRunning = timedOut/,
  "dopo timeout la pagina deve restare bloccata perché Promise.race non cancella il test");
assert.match(mainSource, /const failure = \{ version: 10, passed: false/);
assert.match(layerHistoryGpuTestSource, /LAYER_HISTORY_GPU_TEST_VERSION = 10 as const/);
assert.match(layerCompositeGpuTestSource, /fiveLayerSwitchMemoryPeaks/);
assert.match(layerCompositeGpuTestSource, /fiveLayerMiddleSwitchMemoryPeaks/);
assert.match(layerCompositeGpuTestSource, /measureMemoryPeakDuring/);
assert.match(layerHistoryGpuTestSource, /measureActiveStyleBakeGap\(pRect\)/);
assert.match(layerHistoryGpuTestSource, /engine\.injectLayerBakeFault\("after-candidate-submit"\)/);
assert.match(layerHistoryGpuTestSource, /injectedBakeFailureReleasedCandidate/);
assert.match(layerHistoryGpuTestSource, /readLayerPixels\(auditRect, 0\)/);
assert.match(layerHistoryGpuTestSource, /readLayerPixels\(auditRect, 1\)/);
assert.match(layerHistoryGpuTestSource, /const undoReturned = await engine\.undo\(\)/);
assert.match(layerHistoryGpuTestSource, /const redoReturned = await engine\.redo\(\)/);
assert.match(
  layerHistoryGpuTestSource,
  /await engine\.setActiveLayer\(1\);\s*const activeBeforeCrossLayerRedo[\s\S]*?const crossLayerRedoReturned = await engine\.redo\(\)/,
  "il redo cross-layer deve partire deliberatamente dal livello sbagliato",
);
assert.match(layerHistoryGpuTestSource, /probeRollback\("after-first-replay-submit"\)/);
assert.match(layerHistoryGpuTestSource, /probeRollback\("during-switch-activation"\)/);
assert.match(
  layerHistoryGpuTestSource,
  /probeRollback\(\s*"after-first-replay-submit",\s*"during-switch-activation",\s*\)/,
  "il test deve esercitare anche un errore durante il rollback",
);
assert.match(layerHistoryGpuTestSource, /fatalRollbackLatchedInconsistent: fatalRollback\.historyInconsistent/);
assert.match(layerHistoryGpuTestSource, /fatalLatchRefusedAnotherUndo: !fatalFollowUpUndoReturned/);
assert.match(layerHistoryGpuTestSource, /twoAndFiveLayerMipMemoryIsConstant/);
assert.match(layerHistoryGpuTestSource, /twoAndFiveLayerCompositeMemoryIsConstant/);

assert.match(layerCompositeGpuTestSource, /expectedPresentation\(/);
assert.match(layerCompositeGpuTestSource, /sourceOver\(above, sourceOver\(active, below\)\)/,
  "il riferimento indipendente deve fissare sopra over attivo over sotto");
assert.match(layerCompositeGpuTestSource, /wrongSrgbSpacePresentation\(/,
  "il riferimento deve discriminare la composizione eseguita nello spazio sbagliato");
assert.match(layerCompositeGpuTestSource, /engine\.injectLayerCompositeFault\("after-candidate-submit"\)/);
assert.match(layerCompositeGpuTestSource, /setLayerOpacity\(2, 0\.25\)/);
assert.match(layerCompositeGpuTestSource, /setLayerVisibility\(2, false\)/);
assert.match(layerCompositeGpuTestSource, /readMergedLayerPixels\(\s*"above",[\s\S]*?2,\s*false,/,
  "il test zoom non deve riparare la piramide prima di leggerla");
assert.match(layerCompositeGpuTestSource, /zoomMip2MatchesIndependentBoxFilter/);
assert.match(layerCompositeGpuTestSource, /fiveLayerBakesWereReleased/);
assert.match(layerCompositeGpuTestSource, /opaqueRawFastPathIsByteExact/);
// The switch lock has to be held across the awaits, or a pointerdown landing
// during the 150-215 ms rebuild starts a stroke on a half-swapped layer.
// Ancorata alla dichiarazione del campo: un assegnamento dentro un `finally`
// soddisfarebbe il pattern senza provare che il campo esista ancora.
assert.match(engineSource, /^ {2}layerSwitchBusy = false;$/m);
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
assert.match(engineSource, /async ensureEffectRenderersForRecord\(record: LayerRecord\): Promise<void>/);
assert.match(
  engineSource,
  /await ensureEffectRenderersForRecord\(this, record\);/,
  "activateLayer deve garantire i renderer del livello entrante",
);
const ensureStart = engineSource.indexOf("export async function ensureEffectRenderersForRecord(");
const ensureBody = engineSource.slice(ensureStart, ensureStart + 1_800);
assert.match(ensureBody, /layerEffectRendererRequirements\(/,
  "la decisione Smusso-only deve passare dall'invariante testato");
assert.match(ensureBody, /if \(requirements\.needsStrokeRenderer\)/,
  "Smusso deve ricreare anche il compositore Traccia");
assert.match(
  ensureBody,
  /rasterStrokeScratchExtentForRenderer\([\s\S]*?strokeGeometryActive,[\s\S]*?requirements\.strokeWidth/,
  "il tier dipende dall'attività della Traccia e dalla width del livello entrante",
);
assert.match(ensureBody, /record\.strokeStyle\.enabled && record\.strokeStyle\.width > 0/,
  "un compositore senza Traccia deve usare lo scratch minimo");
assert.match(ensureBody, /renderer\.resizeScratch\(scratchExtent\)/);
assert.match(ensureBody, /setRasterStrokeGeometryEnabled\(engine, false\)/,
  "un livello senza Traccia deve liberare la geometria residente condivisa");
assert.match(engineSource, /strokeGeometryEnabled: strokeGeometryActive/,
  "la creazione del compositore deve rispettare la Traccia del livello entrante");

// A failed activation mutates Blend, effects and live content fields before it
// can reject. Rollback therefore has to run the complete activation path back
// to the outgoing layer; rebinding only the texture is not sufficient.
const selectMethodStart = engineSource.indexOf("async setActiveLayer(");
const selectMethodBody = engineSource.slice(selectMethodStart, selectMethodStart + 2_600);
assert.match(selectMethodBody, /activationStarted = true/);
const selectPrepare = selectMethodBody.indexOf("await this.prepareActiveLayerForSwitch();");
const selectIndexChange = selectMethodBody.indexOf("this.layerStack.setActiveIndex(index);");
assert.ok(
  selectPrepare >= 0 && selectIndexChange > selectPrepare,
  "setActiveLayer deve completare pack ed evizione prima di cambiare indice",
);
assert.match(selectMethodBody, /evictReconstructibleLayerResources\(this, this\.layerStack\.at\(index\)\);[\s\S]*?this\.layerStack\.setActiveIndex\(fromIndex\);[\s\S]*?await this\.activateLayer\(index\);/,
  "il rollback dello switch deve evacuare il target fallito prima di reidratare l'origine");
assert.match(selectMethodBody, /this\.layerStack\.setActiveIndex\(fromIndex\);[\s\S]*?await this\.activateLayer\(index\);/,
  "il rollback dello switch deve ritargettare tutti i sottosistemi");
assert.match(selectMethodBody, /Stato incoerente dopo il cambio livello:[\s\S]*?Ricarica la pagina/,
  "un doppio fallimento dello switch deve alzare il latch fatale");
const addMethodStart = engineSource.indexOf("async addLayer(");
// La transazione include ora anche il rollback dello stack misto raster/testo.
const addMethodBody = engineSource.slice(addMethodStart, addMethodStart + 6_000);
const addPrepare = addMethodBody.indexOf("await this.prepareActiveLayerForSwitch();");
const addRecord = addMethodBody.indexOf("this.layerStack.add(name)");
assert.ok(
  addPrepare >= 0 && addRecord > addPrepare,
  "addLayer deve congelare e impacchettare l'uscente prima del nuovo record",
);
assert.match(
  addMethodBody,
  /this\.mixedSceneStack\.addRasterAboveSelection\(record\.id\)/,
  "nella scena mista il nuovo raster deve seguire la selezione, incluso un testo",
);
assert.match(addMethodBody, /await allocateLayerGpuResources\(this,/);
const addActivation = addMethodBody.indexOf(
  "const result = await this.activateLayer(fromIndex);",
);
const addLiveTextClear = addMethodBody.indexOf("this.clearVectorTextPresentation();");
assert.ok(
  addActivation >= 0 && addLiveTextClear > addActivation,
  "addLayer deve liberare la preview testo soltanto dopo che activateLayer ha "
    + "sbloccato la presentazione, altrimenti waitForIdle resta su displayDirty",
);
assert.match(addMethodBody, /Stato incoerente dopo la creazione del livello:[\s\S]*?Ricarica la pagina/,
  "un doppio fallimento di addLayer deve alzare il latch fatale");
assert.match(addMethodBody, /this\.layerStack\.remove\(index\);[\s\S]*?this\.layerStack\.setActiveIndex\(fromIndex\);[\s\S]*?await this\.activateLayer\(fromIndex\);/,
  "un OOM del nuovo mip 0 deve reidratare l'uscente già evacuato");
assert.match(addMethodBody, /evictReconstructibleLayerResources\(this, record\);[\s\S]*?this\.layerStack\.setActiveIndex\(fromIndex\);[\s\S]*?await this\.activateLayer\(index\);/,
  "il rollback di addLayer deve evacuare il nuovo hot prima di reidratare l'origine");
assert.match(addMethodBody, /await this\.activateLayer\(index\);[\s\S]*?this\.layerGpu\.delete\(record\.id\);[\s\S]*?destroyLayerGpuResources\(this, gpu\)/,
  "un livello fallito va distrutto solo dopo il ripristino completo");

// Measurement setups reset the GLOBAL journal but clear only the active layer.
assert.match(engineSource, /get documentWideResetBlockedByLayers\(\): boolean/);
assert.match(engineSource, /if \(this\.documentWideResetBlockedByLayers\) \{/);
// A format change allocates the one active full texture before destruction; the
// inactive records are empty cold slots because the operation clears all layers.
assert.ok(
  engineSource.indexOf("const replacement = new Map<number, LayerGpuResources>();")
    < engineSource.indexOf("const supersededLayerGpu = [...engine.layerGpu.values()];"),
  "il cambio formato deve allocare prima di distruggere",
);
const recreateStart = engineSource.indexOf("export async function recreateLayerResources(");
const recreateBody = engineSource.slice(recreateStart, recreateStart + 50_000);
assert.match(recreateBody, /runGpuAllocationTransaction\(\s*engine\.device,\s*`Pipeline formato layer/,
  "anche pipeline e layout devono chiudere validation/OOM scope");
assert.match(recreateBody, /record\.id === engine\.layerStack\.active\.id[\s\S]*?await allocateLayerGpuResources\(engine,[\s\S]*?: createColdLayerGpuResources\(\)/,
  "il cambio formato deve allocare full solo per il livello attivo");
assert.match(recreateBody, /for \(const gpu of replacement\.values\(\)\) \{\s*destroyLayerGpuResources\(engine, gpu\);/,
  "un fallimento deve eliminare tutti i candidati, incluso quello attivo");
assert.doesNotMatch(recreateBody, /layerId !== (this|engine)\.layerStack\.active\.id/,
  "il cleanup non può saltare il candidato del livello attivo");

// Public mutations must not interleave with the awaited layer switch.
assert.match(
  engineSource,
  /setBrushSettings\([\s\S]*?this\.initialized && \(this\.layerSwitchBusy \|\| this\.historyBusy\)/,
  "le impostazioni non devono riattivare render o allocazioni dopo un latch fatale",
);
assert.match(engineSource, /async setLayerFormat\([\s\S]*?this\.layerSwitchBusy/);
assert.match(engineSource, /async benchmarkEffectsWorkingSet\([\s\S]*?this\.layerSwitchBusy/);
// Each caller's exemption is named rather than passed as an unreadable boolean.
// A layer switch may cross layerSwitchBusy because that flag is its own;
// history replay and structural SVG history may cross historyBusy because they
// are the history transaction.
assert.match(
  engineSource,
  /type EffectsRetargetCaller =[\s\S]*?\| "public"[\s\S]*?\| "layer-switch"[\s\S]*?\| "history-replay"[\s\S]*?\| "structural-history";/,
);
assert.match(engineSource, /\(!duringLayerSwitch && engine\.layerSwitchBusy\)/,
  "solo i retarget interni possono attraversare il lock di switch");
assert.match(engineSource, /\(!duringHistoryTransaction && engine\.historyBusy\)/,
  "solo le transazioni history nominate possono attraversare historyBusy");
assert.match(
  engineSource,
  /const duringHistoryTransaction =[\s\S]*?caller === "history-replay" \|\| caller === "structural-history";/,
);
// The public entry point must never grant itself an exemption.
assert.match(
  engineSource,
  /return retargetEffectsWorkingSetInternal\(this,\s*layerView,\s*layerFormat,\s*contentBounds,\s*"public",\s*\)/,
);
// Telemetry has to sign both layer identity and actual hot/cold storage.
assert.match(engineSource, /layerCount: engine\.layerStack\.count/);
assert.match(
  engineSource,
  /layerMemoryMiB:\s*gpuMemory\.layerBaseMiB\s*\+ gpuMemory\.layerColdMiB\s*\+ gpuMemory\.layerHydrationMiB/,
);
assert.match(mainSource, /layerCount: number;/);
assert.match(mainSource, /activeLayerId: number;/);

const layerStorageStudySource = readFileSync(
  new URL("../src/layer-storage-study.ts", import.meta.url),
  "utf8",
);
assert.match(
  layerStorageStudySource,
  /single-active-full-inactive-256-array-tiles-rehydrate-fold/,
);
assert.match(layerStorageStudySource, /"Occupied" deliberately means ANY non-zero byte/);
assert.doesNotMatch(
  layerStorageStudySource,
  /GPUTexture|GPUBuffer|GPUDevice|GPUQueue/,
  "la matematica delle tile deve restare pura e testabile senza WebGPU",
);
const mutationStart = engineSource.indexOf("noteLayerMutation(");
const mutationBody = engineSource.slice(mutationStart, mutationStart + 1_100);
assert.match(
  mutationBody,
  /clearLayerStorageTileMask\(this\.layerStack\.active\.storageTileMask\)/,
  "clear deve azzerare la maschera del solo livello attivo",
);
assert.match(
  mutationBody,
  /markLayerStorageRect\(this\.layerStack\.active\.storageTileMask, dirtyRect\)/,
  "ogni mutazione raw deve raggiungere il collo di bottiglia della maschera",
);
const packStart = engineSource.indexOf("export async function createLayerColdStorageCandidate(");
const packBody = engineSource.slice(packStart, packStart + 4_300);
assert.match(packBody, /depthOrArrayLayers: tileIndices\.length/);
assert.match(packBody, /tileIndices\.forEach\(\(tileIndex, arrayLayer\) =>/);
assert.match(packBody, /copyTextureToTexture\(/);
assert.ok(
  packBody.indexOf("await engine.waitForGpuCapped(")
    < packBody.indexOf('engine.maybeInjectLayerColdStorageFault("after-pack-submit")'),
  "il candidato cold non può essere pubblicato prima del completamento GPU",
);
const freezeStart = engineSource.indexOf("export async function freezeActiveLayerToCold(");
const freezeBody = engineSource.slice(freezeStart, freezeStart + 1_400);
assert.match(freezeBody, /const candidate = await createLayerColdStorageCandidate\(engine,/);
assert.match(freezeBody, /gpu\.cold = candidate;/);
assert.match(freezeBody, /record\.storageTileMask\.set\(mask\)/);
const hydrateStart = engineSource.indexOf("export async function createHydratedLayerTexture(");
const hydrateBody = engineSource.slice(hydrateStart, hydrateStart + 2_600);
assert.match(hydrateBody, /encodeLayerColdHydration\(encoder, cold, hot\)/);
assert.match(hydrateBody, /await engine\.waitForGpuCapped\(label\)/);
assert.match(hydrateBody, /engine\.liveLayerHydrationTextures\.set\(hot\.texture, memoryBytes\)/);
const activateStorageBody = engineSource.slice(activateStart, activateEnd);
assert.ok(
  activateStorageBody.indexOf("await ensureActiveLayerHot(this, record);")
    < activateStorageBody.indexOf("bindActiveLayerResources(this);"),
  "il livello entrante deve essere reidratato prima di legare i renderer",
);
assert.ok(
  activateStorageBody.indexOf("await this.rebuildMergedLayerSurfaces(caller);")
    < activateStorageBody.indexOf("commitActiveLayerResidency(this, fromIndex);"),
  "il cold duplicato dell'attivo può essere rilasciato solo dopo il compositing riuscito",
);
assert.match(engineSource, /const layerColdMiB = baseResourcesAllocated/);
assert.match(engineSource, /const layerHydrationMiB = \([\s\S]*?engine\.layerColdRestoreActiveBytes/);
assert.match(engineSource, /measurementOnly: false/);
assert.match(
  engineSource,
  /projectedConservativeRawMiB = activeFullMiB \+ inactiveConservativeTileMiB/,
  "la proiezione deve conservare il livello attivo full-canvas",
);
const exactStudyStart = engineSource.indexOf("export async function measureExactLayerStorageStudy(");
const exactStudyBody = engineSource.slice(exactStudyStart, exactStudyStart + 4_500);
assert.match(exactStudyBody, /import\.meta\.env\.DEV/);
assert.match(exactStudyBody, /await engine\.readLayerPixels\(undefined, index\)/);
assert.match(exactStudyBody, /compareLayerStorageMasks\(exactMask, record\.storageTileMask\)/);
assert.match(exactStudyBody, /countedGpuMiBBefore/);
assert.match(exactStudyBody, /countedGpuMiBAfter/);
assert.match(exactStudyBody, /temporaryReadbackPeakMiB/);
assert.match(
  layerCompositeGpuTestSource,
  /compositeSchedulingAndBoundsSignatureMatches:[\s\S]*?deferred-to-fold-fence-bounded-visual-rect/,
  "l'harness GPU deve firmare scheduling e bounds prima di leggere i tempi",
);
assert.match(
  layerCompositeGpuTestSource,
  /boundedBakeSignatureMatches:[\s\S]*?transient-analytic-bounded-visual-rect/,
  "l'harness GPU deve firmare anche il bake bounded",
);
assert.match(layerCompositeGpuTestSource, /fiveLayerAnalyticBakeDomainWasBounded/);
assert.match(layerCompositeGpuTestSource, /fiveLayerSwitchBreakdownIsConsistent/);
assert.match(layerHistoryGpuTestSource, /measureExactLayerStorageStudy\(\)/);
assert.match(layerHistoryGpuTestSource, /conservativeTilesContainEveryExactTile/);
assert.match(layerHistoryGpuTestSource, /exactReadbackReleasedItsTemporaryBuffers/);
assert.match(mainSource, /performanceTelemetryRevision: 58/);
assert.match(mainSource, /gpuMemoryLayerCold/);
assert.match(mainSource, /gpuMemoryLayerCompressed/);
assert.match(mainSource, /gpuMemoryLayerHydration/);
assert.match(mainSource, /Raw livelli · effettivo/);
assert.match(mainSource, /Memoria logica WebGPU realmente allocata/);
assert.match(mainSource, /non è memoria allocata/);

// The production-query stress fixture must be explicit, isolated and leave the
// ordinary layer controls available after it has built real ~1 GiB residency.
const layerMemoryStressSource = readFileSync(
  new URL("../src/layer-memory-stress-test.ts", import.meta.url),
  "utf8",
);
assert.match(mainSource, /pageSearchParams\.get\("layerMemoryStressTest"\) === "1"/);
const memoryStressGateStart = mainSource.indexOf("const layerMemoryStressTestRequested");
const memoryStressGateBody = mainSource.slice(memoryStressGateStart, memoryStressGateStart + 180);
assert.doesNotMatch(
  memoryStressGateBody,
  /import\.meta\.env\.DEV/,
  "la pagina pubblicata deve poter avviare lo stress solo tramite query esplicita",
);
assert.match(mainSource, /layerMemoryStressTestEnabled: layerMemoryFixtureRequested/);
assert.match(mainSource, /await import\("\.\/layer-memory-stress-test"\)/);
assert.match(mainSource, /layerMemoryStressTestCompleted = true/);
assert.match(mainSource, /stressSampler = window\.setInterval/);
assert.match(engineSource, /async seedActiveLayerMemoryStress\([\s\S]*?storageTileCount = LAYER_STORAGE_TILE_COUNT/);
const memoryStressSeedStart = engineSource.indexOf("export async function seedActiveLayerMemoryStress(");
const memoryStressSeedBody = engineSource.slice(memoryStressSeedStart, memoryStressSeedStart + 4_000);
assert.match(memoryStressSeedBody, /engine\.layerMemoryStressTestEnabled/);
assert.match(memoryStressSeedBody, /const markerSize = 64/);
assert.match(memoryStressSeedBody, /storageTileMask\.fill\(0\)/);
assert.match(memoryStressSeedBody, /markStorageTile\(markerTileIndex\)/);
assert.match(layerMemoryStressSource, /LAYER_MEMORY_STRESS_TARGET_MIB = 1000/);
assert.match(layerMemoryStressSource, /initial\.layerCount !== 1/);
assert.match(layerMemoryStressSource, /layer\.coldTileCount !== 256/);
assert.match(layerMemoryStressSource, /layer\.conservativeTileCount !== 256/);
assert.match(layerMemoryStressSource, /manualSwitchReady: true/);

// The iPhone fixture advances in real cold-tile increments and writes a remote
// checkpoint before each allocation/switch. A restored page converts the last
// pending attempt into an interrupted result, so the user never has to copy it.
const iphoneMemoryLimitSource = readFileSync(
  new URL("../src/iphone-memory-limit-test.ts", import.meta.url),
  "utf8",
);
const sitesBuildSource = readFileSync(
  new URL("../scripts/prepare-sites-build.mjs", import.meta.url),
  "utf8",
);
const iphoneMemoryMigrationSource = readFileSync(
  new URL("../.openai/drizzle/0003_iphone_memory_limit_runs.sql", import.meta.url),
  "utf8",
);
assert.match(iphoneMemoryLimitSource,
  /iphone-real-layer-cold-tiles-checkpoint-before-each-operation-v1/);
const iphoneStoragePlanMatch = iphoneMemoryLimitSource.match(
  /IPHONE_MEMORY_LIMIT_STORAGE_TILE_PLAN = Object\.freeze\(\[([\s\S]*?)\]\)/,
);
assert.ok(iphoneStoragePlanMatch);
const iphoneStorageTilePlan = [...iphoneStoragePlanMatch[1].matchAll(/\d+/g)]
  .map((match) => Number(match[0]));
assert.equal(iphoneStorageTilePlan.length, LAYER_STACK_MAXIMUM - 1);
assert.equal(
  iphoneStorageTilePlan.reduce((sum, tileCount) => sum + tileCount, 0),
  3_328,
);
assert.ok(iphoneStorageTilePlan.every(
  (tileCount) => Number.isInteger(tileCount) && tileCount > 0 && tileCount <= 256,
));
assert.match(mainSource, /pageSearchParams\.get\("iphoneMemoryLimitTest"\) === "1"/);
assert.match(mainSource, /recoverRequestedIphoneMemoryLimitTest/);
assert.match(mainSource, /serverRequired: iphoneMemoryLimitServerRequired/);
assert.match(mainSource, /salvato nel progetto/);
assert.match(iphoneMemoryLimitSource, /LOCAL_STORAGE_KEY/);
assert.match(iphoneMemoryLimitSource, /publishRunIdToHash\(run\.runId\)/);
assert.match(iphoneMemoryLimitSource, /recoverInterruptedIphoneMemoryLimitRun/);
assert.match(iphoneMemoryLimitSource, /kind: "interrupted"/);
assert.match(iphoneMemoryLimitSource, /\n\s+"switch-middle",/);
assert.match(iphoneMemoryLimitSource, /\n\s+"switch-top",/);
const firstIphoneAttempt = iphoneMemoryLimitSource.indexOf('kind: "attempt"');
const firstIphoneCheckpoint = iphoneMemoryLimitSource.indexOf(
  "await postCheckpoint(run, serverRequired)",
  firstIphoneAttempt,
);
const firstIphoneAllocation = iphoneMemoryLimitSource.indexOf(
  "await engine.seedActiveLayerMemoryStress(planIndex, storageTileCount)",
  firstIphoneAttempt,
);
assert.ok(firstIphoneAttempt >= 0 && firstIphoneCheckpoint > firstIphoneAttempt);
assert.ok(firstIphoneAllocation > firstIphoneCheckpoint);
assert.match(sitesBuildSource, /handleIphoneMemoryLimitRuns/);
assert.match(sitesBuildSource, /\/api\/iphone-memory-limit-runs/);
assert.match(sitesBuildSource, /ON CONFLICT\(id\) DO UPDATE/);
assert.match(iphoneMemoryMigrationSource, /CREATE TABLE IF NOT EXISTS iphone_memory_limit_runs/);
console.log("Layer stack verification passed.");
