import assert from "node:assert/strict";
import {
  MIXED_SCENE_STACK_STRATEGY,
  MixedSceneStack,
  VECTOR_TEXT_NODE_MAXIMUM,
} from "../src/mixed-scene-stack.ts";

const seed = (text = "STREETWEAR") => ({
  text,
  fontFamily: "Impact, sans-serif",
  fontSize: 360,
  color: "#f4c95d",
  outlineWidth: 0,
  outlineColor: "#111111",
  outlineJoin: "round",
  x: 2048,
  y: 2048,
  scale: 1,
  rotation: 0,
});
const flattenedCompositionKeys = (segments) => segments.flatMap((segment) => {
  if (segment.kind === "active-raster") {
    return [segment.item.key];
  }
  return segment.items.map((item) => item.key);
});

const assertCompositionPreservesDocumentOrder = (stack, activeRasterLayerId) => {
  const segments = stack.compositionSegments(activeRasterLayerId);
  assert.deepEqual(
    flattenedCompositionKeys(segments),
    stack.items.map((item) => item.key),
    `la composizione con raster ${activeRasterLayerId} attivo non deve cambiare gerarchia`,
  );
  assert.equal(
    segments.filter((segment) => segment.kind === "active-raster").length,
    1,
  );
  for (let index = 1; index < segments.length; index += 1) {
    assert.notEqual(
      segments[index - 1].kind,
      segments[index].kind,
      "due run adiacenti dello stesso tipo devono essere fusi",
    );
  }
  return segments;
};

assert.equal(
  MIXED_SCENE_STACK_STRATEGY,
  "heterogeneous-bottom-up-raster-text-segmented-composition-selected-insertion-v3",
);

{
  const stack = new MixedSceneStack([1]);
  assert.deepEqual(stack.items.map((item) => item.key), ["raster:1"]);
  assert.equal(stack.selected.key, "raster:1");
  assert.equal(stack.textCount, 0);

  const first = stack.addTextAboveSelection(seed("FIRST"));
  const second = stack.addTextAboveSelection(seed("SECOND"));
  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "text:1", "text:2"],
  );
  assert.equal(stack.selected.key, "text:2");

  stack.select("text:1");
  stack.addRasterAboveSelection(2);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "text:1", "raster:2", "text:2"],
  );
  assert.equal(stack.selected.key, "raster:2");

  const captured = stack.captureState();
  stack.select("text:2");
  stack.updateText(2, { text: "TEMPORARY" });
  stack.deleteText(1, 2);
  stack.restoreState(captured);
  assert.equal(stack.selected.key, "raster:2");
  assert.equal(stack.textById(2).text, "SECOND");
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "text:1", "raster:2", "text:2"],
  );

  stack.select("text:1");
  assert.equal(stack.moveText(1, -1), true);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["text:1", "raster:1", "raster:2", "text:2"],
  );
  assert.deepEqual(
    stack.partitionAroundRaster(2).below.map((item) => item.key),
    ["text:1", "raster:1"],
  );
  assert.deepEqual(
    stack.partitionAroundRaster(2).above.map((item) => item.key),
    ["text:2"],
  );
  const activeOneSegments = assertCompositionPreservesDocumentOrder(stack, 1);
  assert.deepEqual(
    activeOneSegments.map((segment) => segment.key),
    ["text-run:1", "active-raster:1", "raster-run:2", "text-run:2"],
  );
  const activeTwoSegments = assertCompositionPreservesDocumentOrder(stack, 2);
  assert.deepEqual(
    activeTwoSegments.map((segment) => segment.key),
    ["text-run:1", "raster-run:1", "active-raster:2", "text-run:2"],
  );

  stack.updateText(1, {
    text: "UPDATED",
    x: 100,
    y: 200,
    opacity: 2,
    outlineWidth: 999,
    outlineColor: "#123456",
    outlineJoin: "bevel",
  });
  assert.equal(stack.textById(1).text, "UPDATED");
  assert.equal(stack.textById(1).x, 100);
  assert.equal(stack.textById(1).y, 200);
  assert.equal(stack.textById(1).opacity, 1);
  assert.equal(stack.textById(1).outlineWidth, 100);
  assert.equal(stack.textById(1).outlineColor, "#123456");
  assert.equal(stack.textById(1).outlineJoin, "bevel");
  assert.equal(stack.setTextOpacity(1, -4), true);
  assert.equal(stack.textById(1).opacity, 0);
  assert.equal(stack.setTextVisibility(1, false), true);
  assert.equal(stack.setTextVisibility(1, false), false);

  stack.select("text:1");
  const deleted = stack.deleteText(1, 2);
  assert.equal(deleted.id, 1);
  assert.equal(stack.selected.key, "raster:2");
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "raster:2", "text:2"],
  );

  stack.removeRaster(2, 1);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "text:2"],
  );
}

{
  assert.throws(() => new MixedSceneStack([]), /almeno un livello raster/);
  assert.throws(() => new MixedSceneStack([1, 1]), /univoci/);
  const stack = new MixedSceneStack([1]);
  assert.throws(() => stack.select("text:99"), /inesistente/);
  assert.throws(() => stack.partitionAroundRaster(99), /assente/);
  assert.throws(() => stack.compositionSegments(99), /inesistente|assente/);
  stack.addRasterAboveSelection(2);
  assert.throws(() => stack.addRasterAboveSelection(2), /già presente/);
}

{
  const stack = new MixedSceneStack([1, 2]);
  stack.addTextAboveSelection(seed("BETWEEN"));
  stack.select("raster:2");
  stack.addTextAboveSelection(seed("TOP"));

  stack.select("text:1");
  stack.addRasterAboveSelection(3);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "text:1", "raster:3", "raster:2", "text:2"],
    "un raster aggiunto con un testo selezionato deve nascere subito sopra quel testo",
  );

  stack.select("raster:2");
  stack.addRasterAboveSelection(4);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "text:1", "raster:3", "raster:2", "raster:4", "text:2"],
    "la regola resta identica quando la selezione è raster",
  );
}

{
  const stack = new MixedSceneStack([1]);
  for (let index = 0; index < VECTOR_TEXT_NODE_MAXIMUM; index += 1) {
    stack.addTextAboveSelection(seed(`T${index}`));
  }
  assert.equal(stack.textCount, VECTOR_TEXT_NODE_MAXIMUM);
  assert.throws(() => stack.addTextAboveSelection(seed("overflow")), /Massimo/);
}

console.log("Mixed raster/text scene stack verification passed.");
