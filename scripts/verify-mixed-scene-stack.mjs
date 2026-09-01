import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readEngineSource } from "./engine-source.mjs";
import {
  MIXED_SCENE_STACK_STRATEGY,
  MixedSceneStack,
  RASTER_IMAGE_NODE_MAXIMUM,
  VECTOR_SVG_NODE_MAXIMUM,
  VECTOR_TEXT_NODE_MAXIMUM,
  reusableMixedSceneRasterRunKeys,
  uniqueLayerDuplicateName,
} from "../src/mixed-scene-stack.ts";
import {
  MIXED_MEMORY_BENCHMARK_INTERLEAVED_TEXT_RUNS,
  MIXED_MEMORY_BENCHMARK_STAGED_INTERLEAVED_TILE_COUNT,
  MIXED_MEMORY_BENCHMARK_STAGED_STRATEGY,
  MIXED_MEMORY_BENCHMARK_STAGED_TARGET_MIB,
  MIXED_MEMORY_BENCHMARK_STAGED_TEXT_BATCH_SIZE,
  MIXED_MEMORY_BENCHMARK_STRATEGY,
  MIXED_MEMORY_BENCHMARK_TARGET_MIB,
  mixedMemoryBenchmarkStrategy,
  mixedMemoryBenchmarkTextSeed,
} from "../src/labs/memory/mixed-memory-benchmark-model.ts";

const seed = (text = "STREETWEAR") => ({
  text,
  fontFamily: "Impact, sans-serif",
  fontSize: 360,
  color: "#f4c95d",
  outlineWidth: 0,
  outlineColor: "#111111",
  outlineJoin: "round",
  blockShadowEnabled: true,
  blockShadowColor: "#727272",
  blockShadowOpacity: 1,
  blockShadowOffset: 23,
  blockShadowAngle: -104,
  blockShadowOutlineWidth: 0,
  singleShadowEnabled: false,
  singleShadowColor: "#727272",
  singleShadowOpacity: 1,
  singleShadowOffset: 54,
  singleShadowAngle: -180,
  singleShadowBlur: 6,
  innerShadowEnabled: false,
  innerShadowColor: "#000000",
  innerShadowOpacity: 0.65,
  innerShadowOffset: 12,
  innerShadowAngle: -135,
  innerShadowBlur: 12,
  x: 2048,
  y: 2048,
  scale: 1,
  rotation: 0,
});
const svgDocument = (sourceName = "fixture.svg") => {
  const path = {
    verbs: new Uint8Array([0, 1, 1, 1, 4]),
    coords: new Float64Array([0, 0, 10, 0, 10, 10, 0, 10]),
    contourOffsets: new Uint32Array([0]),
    fillRule: 0,
  };
  const strokeSource = {
    verbs: new Uint8Array([0, 1]),
    coords: new Float64Array([0, 5, 10, 5]),
    contourOffsets: new Uint32Array([0]),
    fillRule: 0,
  };
  return {
    strategy: "sanitized-semantic-svg-gradients-retained-strokes-worker-lod-mesh-webgpu-v2",
    sourceName,
    sourceBytes: 128,
    sourceHash: `hash:${sourceName}`,
    sourceRevision: `source:${sourceName}`,
    viewBox: [0, 0, 10, 10],
    bounds: { left: 0, top: 0, right: 10, bottom: 10 },
    width: 10,
    height: 10,
    paints: [{
      id: 0,
      color: "#ff5500",
      opacity: 1,
      fillRule: 0,
      path,
      gradient: {
        kind: "linear",
        spread: "pad",
        transform: [10, 0, 0, 10, 0, 0],
        geometry: [0, 0, 1, 0],
        focal: [0, 0],
        stops: [
          { offset: 0, color: "#ff5500", opacity: 1 },
          { offset: 1, color: "#0055ff", opacity: 1 },
        ],
      },
      strokes: [{
        sourcePath: strokeSource,
        transform: [1, 0, 0, 1, 0, 0],
        width: 2,
        linecap: "round",
        linejoin: "round",
        miterLimit: 4,
        dashArray: [4, 2],
        dashOffset: 0,
      }],
      revision: `paint:${sourceName}`,
    }],
    silhouettePath: path,
    silhouetteRevision: `silhouette:${sourceName}`,
    elementCount: 1,
    contourCount: 1,
    commandCount: 5,
    logicalVectorBytes: 128,
  };
};
const svgSeed = (sourceName = "fixture.svg") => ({
  document: svgDocument(sourceName),
  x: 2048,
  y: 2048,
  scale: 1,
  rotation: 0,
});
const imageSeed = (assetId = "asset:1", sourceName = "fixture.png") => ({
  document: {
    assetId,
    sourceName,
    mimeType: "image/png",
    sourceBytes: 1024,
    width: 640,
    height: 480,
  },
  x: 2048,
  y: 2048,
  scale: 1,
  rotation: 0,
});
const flattenedCompositionKeys = (segments) => segments.flatMap((segment) => {
  if (segment.kind === "active-raster" || segment.kind === "image") {
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
  "heterogeneous-bottom-up-raster-vector-image-segmented-composition-vector-raster-replacement-v7",
);
assert.equal(RASTER_IMAGE_NODE_MAXIMUM, 64);

assert.equal(uniqueLayerDuplicateName("Logo", ["Logo"]), "Logo copy");
assert.equal(
  uniqueLayerDuplicateName("Logo copy", ["Logo", "Logo copy", "Logo copy 2"]),
  "Logo copy 3",
);

// Semantic Duplicate keeps mutable presentation independent while sharing only
// immutable, potentially large document payloads.
{
  const stack = new MixedSceneStack([1]);
  const sourceText = stack.addTextAboveSelection(seed("COPY TEXT"), "Titolo");
  stack.setTextVisibility(sourceText.id, false);
  stack.setTextOpacity(sourceText.id, 0.42);
  stack.updateText(sourceText.id, {
    transformType: "distort",
    distortPoints: Array.from({ length: 10 }, (_, index) => ({ x: index * 10, y: index * -5 })),
  });
  const duplicateText = stack.duplicateSelectedSemanticAboveSelection();
  assert.equal(duplicateText.kind, "text");
  assert.equal(duplicateText.name, "Titolo copy");
  assert.equal(duplicateText.visible, false);
  assert.equal(duplicateText.opacity, 0.42);
  assert.notEqual(duplicateText.id, sourceText.id);
  assert.notEqual(duplicateText.distortPoints, sourceText.distortPoints);
  stack.updateText(duplicateText.id, { text: "ONLY COPY" });
  assert.equal(stack.textById(sourceText.id).text, "COPY TEXT");

  stack.select("raster:1");
  const sourceSvg = stack.addSvgAboveSelection(svgSeed("shared.svg"), "Marchio");
  const duplicateSvg = stack.duplicateSelectedSemanticAboveSelection();
  assert.equal(duplicateSvg.kind, "svg");
  assert.equal(duplicateSvg.document, sourceSvg.document);
  assert.notEqual(duplicateSvg.paintColors, sourceSvg.paintColors);
  duplicateSvg.paintColors[0] = "#000000";
  assert.notEqual(sourceSvg.paintColors[0], duplicateSvg.paintColors[0]);

  stack.select("raster:1");
  const sourceImage = stack.addImageAboveSelection(imageSeed("shared-image"), "Foto");
  const duplicateImage = stack.duplicateSelectedSemanticAboveSelection();
  assert.equal(duplicateImage.kind, "image");
  assert.equal(duplicateImage.document, sourceImage.document);
  assert.equal(stack.selected.key, `image:${duplicateImage.id}`);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    [
      "raster:1",
      `image:${sourceImage.id}`,
      `image:${duplicateImage.id}`,
      `svg:${sourceSvg.id}`,
      `svg:${duplicateSvg.id}`,
      `text:${sourceText.id}`,
      `text:${duplicateText.id}`,
    ],
  );
}

// A vector-only edit must keep exact raster runs resident. Crossing a raster
// invalidates only the groups whose membership changed, never an unrelated run.
{
  const stack = new MixedSceneStack([1, 2, 3, 4]);
  stack.select("raster:2");
  const text = stack.addTextAboveSelection(seed("CACHE"));
  const before = stack.compositionSegments(2);
  stack.updateText(text.id, { text: "CACHE UPDATED", opacity: 0.75 });
  const propertyEdit = stack.compositionSegments(2);
  assert.deepEqual(
    [...reusableMixedSceneRasterRunKeys(before, propertyEdit)],
    ["raster-run:1", "raster-run:3,4"],
    "un edit vettoriale non deve ricostruire raster-run identici",
  );

  assert.equal(stack.moveText(text.id, 1), true);
  const crossedRaster = stack.compositionSegments(2);
  assert.deepEqual(
    [...reusableMixedSceneRasterRunKeys(propertyEdit, crossedRaster)],
    ["raster-run:1"],
    "attraversare raster 3 deve invalidare solo il vecchio gruppo 3,4",
  );
  assert.deepEqual(
    [...reusableMixedSceneRasterRunKeys(crossedRaster, stack.compositionSegments(3))],
    [],
    "un cambio del raster attivo deve rifiutare ogni riuso vettoriale",
  );
}

// SVG -> raster is a same-slot structural replacement. Undo restores the
// compact semantic SVG state and Redo can use the same exact slot again.
{
  const stack = new MixedSceneStack([1, 2]);
  stack.select("raster:1");
  const svg = stack.addSvgAboveSelection(svgSeed("raster-source.svg"));
  const svgKey = `svg:${svg.id}`;
  const historyState = stack.captureVectorHistoryState(svgKey);
  const sceneIndex = stack.indexOfKey(svgKey);
  assert.equal(stack.rasterIndexForSceneIndex(sceneIndex), 1);

  assert.equal(stack.replaceVectorWithRaster(svgKey, 99), sceneIndex);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "raster:99", "raster:2"],
  );
  assert.equal(stack.selected.key, "raster:99");
  assert.throws(() => stack.svgById(svg.id), /does not exist/);

  assert.equal(stack.replaceRasterWithVector(99, historyState), sceneIndex);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", svgKey, "raster:2"],
  );
  assert.equal(stack.selected.key, svgKey);
  assert.equal(stack.svgById(svg.id).document.sourceName, "raster-source.svg");
  assert.equal(stack.rasterIndexForSceneIndex(stack.items.length), 2);
  assert.throws(() => stack.rasterIndexForSceneIndex(-1), /out of range/);
}

// Text -> raster uses the same structural slot and restores the exact semantic
// node, including its editable text payload, on Undo.
{
  const stack = new MixedSceneStack([1, 2]);
  stack.select("raster:1");
  const text = stack.addTextAboveSelection(seed("RASTER TEXT"));
  const textKey = "text:" + text.id;
  const historyState = stack.captureVectorHistoryState(textKey);
  const sceneIndex = stack.indexOfKey(textKey);

  assert.equal(stack.replaceVectorWithRaster(textKey, 77), sceneIndex);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", "raster:77", "raster:2"],
  );
  assert.throws(() => stack.textById(text.id), /does not exist/);

  assert.equal(stack.replaceRasterWithVector(77, historyState), sceneIndex);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", textKey, "raster:2"],
  );
  assert.equal(stack.selected.key, textKey);
  assert.equal(stack.textById(text.id).text, "RASTER TEXT");
}

{
  const stack = new MixedSceneStack([1]);
  assert.deepEqual(stack.items.map((item) => item.key), ["raster:1"]);
  assert.equal(stack.selected.key, "raster:1");
  assert.equal(stack.textCount, 0);

  const first = stack.addTextAboveSelection(seed("FIRST"));
  const second = stack.addTextAboveSelection(seed("SECOND"));
  assert.equal(first.id, 1);
  assert.equal(second.id, 2);
  assert.equal(first.transformType, "none");
  assert.equal(first.transformCurve, 80);
  assert.equal(first.circleRadiusPercent, 50);
  assert.equal(first.circleInverted, false);
  assert.equal(first.distortPoints, null);
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
    ["text-run:text:1", "active-raster:1", "raster-run:2", "text-run:text:2"],
  );
  const activeTwoSegments = assertCompositionPreservesDocumentOrder(stack, 2);
  assert.deepEqual(
    activeTwoSegments.map((segment) => segment.key),
    ["text-run:text:1", "raster-run:1", "active-raster:2", "text-run:text:2"],
  );

  stack.updateText(1, {
    text: "UPDATED",
    x: 100,
    y: 200,
    opacity: 2,
    transformType: "wave",
    transformCurve: 999,
    circleRadiusPercent: 1,
    circleInverted: true,
    outlineWidth: 999,
    outlineColor: "#123456",
    outlineJoin: "bevel",
    blockShadowOpacity: 2,
    blockShadowOffset: 999,
    blockShadowAngle: -999,
    blockShadowOutlineWidth: 999,
    singleShadowEnabled: true,
    singleShadowColor: "#654321",
    singleShadowOpacity: 2,
    singleShadowOffset: 999,
    singleShadowAngle: 999,
    singleShadowBlur: 999,
    innerShadowEnabled: true,
    innerShadowColor: "#abcdef",
    innerShadowOpacity: 2,
    innerShadowOffset: 999,
    innerShadowAngle: -999,
    innerShadowBlur: 999,
  });
  assert.equal(stack.textById(1).text, "UPDATED");
  assert.equal(stack.textById(1).x, 100);
  assert.equal(stack.textById(1).y, 200);
  assert.equal(stack.textById(1).opacity, 1);
  assert.equal(stack.textById(1).transformType, "wave");
  assert.equal(stack.textById(1).transformCurve, 100);
  assert.equal(stack.textById(1).circleRadiusPercent, 16);
  assert.equal(stack.textById(1).circleInverted, true);
  assert.equal(stack.textById(1).outlineWidth, 100);
  assert.equal(stack.textById(1).outlineColor, "#123456");
  assert.equal(stack.textById(1).outlineJoin, "bevel");
  assert.equal(stack.textById(1).blockShadowOpacity, 1);
  assert.equal(stack.textById(1).blockShadowOffset, 100);
  assert.equal(stack.textById(1).blockShadowAngle, -180);
  assert.equal(stack.textById(1).blockShadowOutlineWidth, 100);
  assert.equal(stack.textById(1).singleShadowEnabled, true);
  assert.equal(stack.textById(1).singleShadowColor, "#654321");
  assert.equal(stack.textById(1).singleShadowOpacity, 1);
  assert.equal(stack.textById(1).singleShadowOffset, 100);
  assert.equal(stack.textById(1).singleShadowAngle, 180);
  assert.equal(stack.textById(1).singleShadowBlur, 300);
  assert.equal(stack.textById(1).innerShadowEnabled, true);
  assert.equal(stack.textById(1).innerShadowColor, "#abcdef");
  assert.equal(stack.textById(1).innerShadowOpacity, 1);
  assert.equal(stack.textById(1).innerShadowOffset, 100);
  assert.equal(stack.textById(1).innerShadowAngle, -180);
  assert.equal(stack.textById(1).innerShadowBlur, 300);

  const distortPoints = [
    { x: -500, y: -200 },
    { x: 0, y: -240 },
    { x: 500, y: -200 },
    { x: 500, y: 200 },
    { x: 0, y: 240 },
    { x: -500, y: 200 },
    { x: -250, y: -240 },
    { x: 250, y: -240 },
    { x: -250, y: 240 },
    { x: 250, y: 240 },
  ];
  stack.updateText(1, { transformType: "distort", distortPoints });
  assert.equal(stack.textById(1).transformType, "distort");
  assert.deepEqual(stack.textById(1).distortPoints, distortPoints);
  assert.notEqual(stack.textById(1).distortPoints, distortPoints);
  const distortState = stack.captureState();
  stack.updateText(1, {
    distortPoints: distortPoints.map((point) => ({ x: point.x + 99, y: point.y })),
  });
  stack.restoreState(distortState);
  assert.deepEqual(stack.textById(1).distortPoints, distortPoints);
  assert.notEqual(stack.textById(1).distortPoints, distortState.textNodes[0].distortPoints);

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
  const stack = new MixedSceneStack([1]);
  const text = stack.addTextAboveSelection(seed(""));
  assert.equal(
    stack.visibleSemanticCount,
    1,
    "empty visible text must retain ordered presentation across synchronous content edits",
  );
  stack.updateText(text.id, { text: "restored" });
  assert.equal(stack.visibleSemanticCount, 1);
  stack.setTextVisibility(text.id, false);
  assert.equal(stack.visibleSemanticCount, 0);
}

{
  const stack = new MixedSceneStack([1, 2]);
  const image = stack.addImageAboveSelection(imageSeed(), "Foto");
  assert.equal(image.kind, "image");
  assert.equal(stack.imageCount, 1);
  assert.equal(stack.semanticCount, 1);
  assert.equal(stack.visibleSemanticCount, 1);
  assert.equal(stack.vectorCount, 1);
  stack.addTextAboveSelection(seed("SOPRA"));
  stack.select("raster:2");
  stack.addSvgAboveSelection(svgSeed("logo-over.svg"));
  assert.deepEqual(
    stack.compositionSegments(1).map((segment) => segment.key),
    ["active-raster:1", "image:1", "text-run:text:1", "raster-run:2", "text-run:svg:1"],
    "un’immagine deve interrompere le run senza cambiare l’ordine del documento",
  );
  assertCompositionPreservesDocumentOrder(stack, 1);

  const before = stack.captureVectorHistoryState("image:1");
  stack.updateImage(image.id, { x: 777, y: 333, scale: 2, rotation: 0.5 });
  const after = stack.captureVectorHistoryState("image:1");
  assert.equal(after.node?.document, stack.imageById(image.id).document);
  stack.restoreVectorHistoryState(before);
  assert.equal(stack.imageById(image.id).x, 2048);
  assert.equal(stack.imageById(image.id).document, before.node.document);
  stack.restoreVectorHistoryState(after);
  assert.equal(stack.imageById(image.id).x, 777);
  assert.equal(stack.setImageVisibility(image.id, false), true);
  assert.equal(stack.visibleSemanticCount, 2);
  assert.deepEqual(
    stack.compositionSegments(1).map((segment) => segment.key),
    ["active-raster:1", "text-run:text:1", "raster-run:2", "text-run:svg:1"],
    "un’immagine nascosta non deve spezzare o moltiplicare le run",
  );
  assert.equal(stack.setImageVisibility(image.id, true), true);
  assert.equal(stack.setImageOpacity(image.id, 0), true);
  assert.equal(stack.visibleSemanticCount, 2);
  assert.deepEqual(
    stack.compositionSegments(1).map((segment) => segment.key),
    ["active-raster:1", "text-run:text:1", "raster-run:2", "text-run:svg:1"],
    "un’immagine trasparente non deve spezzare o moltiplicare le run",
  );
  assert.equal(stack.setImageOpacity(image.id, 0.25), true);
  assert.equal(stack.moveImage(image.id, 1), true);
  stack.select("image:1");
  const deleted = stack.deleteImage(image.id, 1);
  assert.equal(deleted.id, image.id);
  assert.equal(stack.imageCount, 0);
  assert.equal(stack.selected.key, "raster:1");
}

{
  const stack = new MixedSceneStack([1]);
  const svg = stack.addSvgAboveSelection(svgSeed("logo.svg"));
  assert.equal(svg.id, 1);
  assert.equal(svg.name, "logo.svg");
  assert.equal(stack.svgCount, 1);
  assert.equal(stack.vectorCount, 1);
  assert.deepEqual(stack.items.map((item) => item.key), ["raster:1", "svg:1"]);
  assert.equal(stack.selected.key, "svg:1");
  assert.equal(svg.paintColors[0], "#ff5500");
  assert.equal(svg.outlineWidth, 0);
  assert.equal(svg.blockShadowEnabled, false);

  stack.updateSvg(1, {
    paintColors: ["#123456"],
    outlineWidth: 999,
    blockShadowEnabled: true,
    blockShadowOffset: 999,
    singleShadowEnabled: true,
    singleShadowBlur: 999,
    innerShadowEnabled: true,
    innerShadowBlur: 999,
    opacity: 2,
  });
  assert.equal(stack.svgById(1).paintColors[0], "#123456");
  assert.equal(stack.svgById(1).outlineWidth, 100);
  assert.equal(stack.svgById(1).blockShadowEnabled, true);
  assert.equal(stack.svgById(1).blockShadowOffset, 100);
  assert.equal(stack.svgById(1).singleShadowBlur, 300);
  assert.equal(stack.svgById(1).innerShadowBlur, 300);
  assert.equal(stack.svgById(1).opacity, 1);

  const captured = stack.captureState();
  stack.updateSvg(1, { paintColors: ["#abcdef"], x: 100 });
  stack.restoreState(captured);
  assert.equal(stack.svgById(1).paintColors[0], "#123456");
  assert.equal(stack.svgById(1).x, 2048);
  assert.notEqual(stack.svgById(1).document, captured.svgNodes[0].document);
  assert.notEqual(
    stack.svgById(1).document.paints[0].gradient,
    captured.svgNodes[0].document.paints[0].gradient,
  );
  assert.notEqual(
    stack.svgById(1).document.paints[0].gradient.transform,
    captured.svgNodes[0].document.paints[0].gradient.transform,
  );
  assert.notEqual(
    stack.svgById(1).document.paints[0].strokes[0].sourcePath.coords,
    captured.svgNodes[0].document.paints[0].strokes[0].sourcePath.coords,
  );
  assert.notEqual(
    stack.svgById(1).document.paints[0].strokes[0].dashArray,
    captured.svgNodes[0].document.paints[0].strokes[0].dashArray,
  );

  stack.addTextAboveSelection(seed("ABOVE SVG"));
  assert.equal(stack.vectorCount, 2);
  assert.deepEqual(
    stack.compositionSegments(1).map((segment) => segment.key),
    ["active-raster:1", "text-run:svg:1,text:1"],
  );
  assert.equal(stack.moveSvg(1, 1), true);
  assert.deepEqual(stack.items.map((item) => item.key), ["raster:1", "text:1", "svg:1"]);
  assert.equal(stack.setSvgVisibility(1, false), true);
  assert.equal(stack.setSvgVisibility(1, false), false);
  assert.equal(stack.setSvgOpacity(1, -1), true);
  assert.equal(stack.svgById(1).opacity, 0);
  stack.select("svg:1");
  const deleted = stack.deleteSvg(1, 1);
  assert.equal(deleted.id, 1);
  assert.equal(stack.selected.key, "raster:1");
  assert.equal(stack.svgCount, 0);
}

// Clipping is one scene relation for raster, editable text and SVG in every
// supported direction. Any group containing a vector layer remains segmented
// until the ordered GPU compositor.
{
  const rasterBase = new MixedSceneStack([1]);
  const svgChild = rasterBase.addSvgAboveSelection(svgSeed("child.svg"));
  assert.equal(rasterBase.setClippingEnabled(`svg:${svgChild.id}`, true), true);
  assert.deepEqual(rasterBase.clippingRelations(), [{
    childKey: "svg:1",
    parentKey: "raster:1",
  }]);
  assert.equal(rasterBase.hasHeterogeneousClipping, true);
  assert.deepEqual(
    rasterBase.compositionSegments(1).map((segment) => segment.key),
    ["active-raster:1", "text-run:svg:1"],
  );

  const svgBase = new MixedSceneStack([1, 2]);
  svgBase.select("raster:1");
  const base = svgBase.addSvgAboveSelection(svgSeed("base.svg"));
  assert.deepEqual(
    svgBase.items.map((item) => item.key),
    ["raster:1", "svg:1", "raster:2"],
  );
  assert.equal(svgBase.setClippingEnabled("raster:2", true), true);
  assert.deepEqual(svgBase.clippingRelations(), [{
    childKey: "raster:2",
    parentKey: `svg:${base.id}`,
  }]);
  assert.deepEqual(
    svgBase.rasterClippingProjection([1, 2]),
    [
      { layerId: 1, parentId: null },
      { layerId: 2, parentId: null },
    ],
    "a vector base must not leak an invalid parent into the raster projection",
  );
  assert.deepEqual(
    svgBase.compositionSegments(2).map((segment) => segment.key),
    ["raster-run:1", "text-run:svg:1", "active-raster:2"],
  );

  const vectorPair = new MixedSceneStack([1]);
  vectorPair.addSvgAboveSelection(svgSeed("vector-base.svg"));
  vectorPair.addSvgAboveSelection(svgSeed("vector-child.svg"));
  assert.equal(vectorPair.setClippingEnabled("svg:2", true), true);
  assert.deepEqual(
    vectorPair.compositionSegments(1).map((segment) => segment.key),
    ["active-raster:1", "text-run:svg:1", "text-run:svg:2"],
  );

  const translucentRuns = new MixedSceneStack([1]);
  translucentRuns.addSvgAboveSelection(svgSeed("opaque-before.svg"));
  const translucent = translucentRuns.addSvgAboveSelection(svgSeed("translucent.svg"));
  translucentRuns.setSvgOpacity(translucent.id, 0.5);
  translucentRuns.addSvgAboveSelection(svgSeed("opaque-after.svg"));
  assert.deepEqual(
    translucentRuns.compositionSegments(1).map((segment) => segment.key),
    [
      "active-raster:1",
      "text-run:svg:1",
      "text-run:svg:2",
      "text-run:svg:3",
    ],
    "a translucent vector must own one run so opacity can be applied after its internal draws",
  );

  // Rasterizing a vector clipping base is a same-slot replacement: the
  // vector child must stay attached to the replacement raster and both
  // members must remain isolated for the ordered clipping compositor. Undo
  // restores the exact vector-only relation and program inputs.
  const rasterizedVectorBase = new MixedSceneStack([1]);
  rasterizedVectorBase.addSvgAboveSelection(svgSeed("rasterized-base.svg"));
  rasterizedVectorBase.addSvgAboveSelection(svgSeed("retained-vector-child.svg"));
  assert.equal(rasterizedVectorBase.setClippingEnabled("svg:2", true), true);
  const vectorBaseHistory = rasterizedVectorBase.captureVectorHistoryState("svg:1");
  const vectorOnlyOrder = rasterizedVectorBase.items.map((item) => item.key);
  const vectorOnlyProgram = rasterizedVectorBase
    .compositionSegments(1)
    .map((segment) => segment.key);

  assert.equal(rasterizedVectorBase.replaceVectorWithRaster("svg:1", 99), 1);
  assert.deepEqual(
    rasterizedVectorBase.items.map((item) => item.key),
    ["raster:1", "raster:99", "svg:2"],
  );
  assert.deepEqual(rasterizedVectorBase.clippingRelations(), [{
    childKey: "svg:2",
    parentKey: "raster:99",
  }]);
  assert.deepEqual(rasterizedVectorBase.clippingGroupKeys("svg:2"), [
    "raster:99",
    "svg:2",
  ]);
  assert.equal(rasterizedVectorBase.clippingGroupRequiresSegmentedComposition("raster:99"), true);
  assert.deepEqual(
    rasterizedVectorBase.compositionSegments(99).map((segment) => segment.key),
    ["raster-run:1", "active-raster:99", "text-run:svg:2"],
    "a rasterized vector base and its vector child must remain separate clipping sources",
  );
  assert.deepEqual(
    rasterizedVectorBase.compositionSegments(1).map((segment) => segment.key),
    ["active-raster:1", "raster-run:99@scene-clipping-source", "text-run:svg:2"],
    "an inactive rasterized base must remain an isolated clipping source",
  );

  assert.equal(rasterizedVectorBase.replaceRasterWithVector(99, vectorBaseHistory), 1);
  assert.deepEqual(
    rasterizedVectorBase.items.map((item) => item.key),
    vectorOnlyOrder,
  );
  assert.deepEqual(rasterizedVectorBase.clippingRelations(), [{
    childKey: "svg:2",
    parentKey: "svg:1",
  }]);
  assert.deepEqual(
    rasterizedVectorBase.compositionSegments(1).map((segment) => segment.key),
    vectorOnlyProgram,
  );

  const rasterPair = new MixedSceneStack([1, 2]);
  assert.equal(rasterPair.setClippingEnabled("raster:2", true), true);
  assert.equal(rasterPair.hasHeterogeneousClipping, false);
  assert.deepEqual(rasterPair.rasterClippingProjection([1, 2]), [
    { layerId: 1, parentId: null },
    { layerId: 2, parentId: 1 },
  ]);

  const restored = new MixedSceneStack([1]);
  restored.restoreState(rasterBase.captureState());
  assert.deepEqual(restored.clippingRelations(), rasterBase.clippingRelations());
  restored.select("svg:1");
  const duplicate = restored.duplicateSelectedSemanticAboveSelection();
  assert.equal(duplicate.kind, "svg");
  assert.deepEqual(restored.clippingRelations(), [
    { childKey: "svg:1", parentKey: "raster:1" },
    { childKey: "svg:2", parentKey: "raster:1" },
  ]);
  assert.equal(restored.setClippingEnabled("svg:1", false), true);
  assert.deepEqual(restored.clippingRelations(), [{
    childKey: "svg:2",
    parentKey: "svg:1",
  }]);

  const rasterText = new MixedSceneStack([1]);
  const textChild = rasterText.addTextAboveSelection(seed("TEXT CHILD"));
  assert.equal(rasterText.setClippingEnabled(`text:${textChild.id}`, true), true);
  assert.deepEqual(rasterText.clippingRelations(), [{
    childKey: "text:1",
    parentKey: "raster:1",
  }]);
  assert.deepEqual(
    rasterText.compositionSegments(1).map((segment) => segment.key),
    ["active-raster:1", "text-run:text:1"],
  );

  const textRaster = new MixedSceneStack([1, 2]);
  textRaster.select("raster:1");
  const textBase = textRaster.addTextAboveSelection(seed("TEXT BASE"));
  assert.equal(textRaster.setClippingEnabled("raster:2", true), true);
  assert.deepEqual(textRaster.clippingRelations(), [{
    childKey: "raster:2",
    parentKey: `text:${textBase.id}`,
  }]);
  assert.deepEqual(
    textRaster.compositionSegments(2).map((segment) => segment.key),
    ["raster-run:1", "text-run:text:1", "active-raster:2"],
  );
  assert.deepEqual(textRaster.rasterClippingProjection([1, 2]), [
    { layerId: 1, parentId: null },
    { layerId: 2, parentId: null },
  ]);

  const textPair = new MixedSceneStack([1]);
  textPair.addTextAboveSelection(seed("BASE"));
  textPair.addTextAboveSelection(seed("CHILD"));
  assert.equal(textPair.setClippingEnabled("text:2", true), true);
  textPair.select("text:2");
  const duplicateText = textPair.duplicateSelectedSemanticAboveSelection();
  assert.equal(duplicateText.kind, "text");
  assert.deepEqual(textPair.clippingRelations(), [
    { childKey: "text:2", parentKey: "text:1" },
    { childKey: "text:3", parentKey: "text:1" },
  ]);
  const clippedTextOrder = textPair.items.map((item) => item.key);
  assert.equal(textPair.moveText(1, 1), false);
  assert.equal(textPair.moveText(2, -1), false);
  assert.deepEqual(
    textPair.items.map((item) => item.key),
    clippedTextOrder,
    "legacy single-row text moves must not split a clipping unit",
  );
  assert.deepEqual(
    textPair.compositionSegments(1).map((segment) => segment.key),
    [
      "active-raster:1",
      "text-run:text:1",
      "text-run:text:2",
      "text-run:text:3",
    ],
  );

  const textChildHistory = textPair.captureVectorHistoryState("text:2");
  textPair.deleteText(2, 1);
  assert.deepEqual(textPair.clippingRelations(), [{
    childKey: "text:3",
    parentKey: "text:1",
  }]);
  textPair.restoreVectorHistoryState(textChildHistory);
  assert.deepEqual(textPair.clippingRelations(), [
    { childKey: "text:2", parentKey: "text:1" },
    { childKey: "text:3", parentKey: "text:1" },
  ]);

  const mixedChildren = new MixedSceneStack([1, 2]);
  mixedChildren.select("raster:1");
  mixedChildren.addTextAboveSelection(seed("MIXED CHILD"));
  assert.equal(mixedChildren.setClippingEnabled("text:1", true), true);
  assert.equal(mixedChildren.setClippingEnabled("raster:2", true), true);
  assert.deepEqual(mixedChildren.clippingRelations(), [
    { childKey: "text:1", parentKey: "raster:1" },
    { childKey: "raster:2", parentKey: "raster:1" },
  ]);
  assert.deepEqual(
    mixedChildren.compositionSegments(1, [1, 2]).map((segment) => segment.key),
    [
      "active-raster:1",
      "text-run:text:1",
      "raster-run:2@scene-clipping-source",
    ],
    "a mixed clipping unit must remain segmented when its raster base is active",
  );
  assert.deepEqual(
    mixedChildren.compositionSegments(2, [1, 2]).map((segment) => segment.key),
    [
      "raster-run:1@scene-clipping-source",
      "text-run:text:1",
      "active-raster:2",
    ],
    "a mixed clipping unit must remain segmented when its raster child is active",
  );

  const textIntruder = new MixedSceneStack([1, 2]);
  textIntruder.setClippingEnabled("raster:2", true);
  textIntruder.select("raster:2");
  textIntruder.addTextAboveSelection(seed("OUTSIDE"));
  const textIntruderOrder = textIntruder.items.map((item) => item.key);
  assert.equal(textIntruder.moveText(1, -1), false);
  assert.deepEqual(textIntruder.items.map((item) => item.key), textIntruderOrder);

  const svgIntruder = new MixedSceneStack([1, 2]);
  svgIntruder.setClippingEnabled("raster:2", true);
  svgIntruder.select("raster:2");
  svgIntruder.addSvgAboveSelection(svgSeed("outside.svg"));
  const svgIntruderOrder = svgIntruder.items.map((item) => item.key);
  assert.equal(svgIntruder.moveSvg(1, -1), false);
  assert.deepEqual(svgIntruder.items.map((item) => item.key), svgIntruderOrder);
}

// The global journal stores one affected vector node, its order and selection:
// unrelated nodes and immutable SVG path data are never duplicated per action.
{
  const stack = new MixedSceneStack([1]);
  const textBeforeAdd = stack.captureVectorHistoryState("text:1");
  const text = stack.addTextAboveSelection(seed("HISTORY"));
  const textAfterAdd = stack.captureVectorHistoryState("text:1");
  assert.equal(textBeforeAdd.node, null);
  assert.equal(textBeforeAdd.index, -1);
  assert.equal(textAfterAdd.node?.id, text.id);

  stack.restoreVectorHistoryState(textBeforeAdd);
  assert.equal(stack.textCount, 0);
  assert.equal(stack.selected.key, "raster:1");
  stack.restoreVectorHistoryState(textAfterAdd);
  assert.equal(stack.textById(text.id).text, "HISTORY");
  assert.notEqual(stack.textById(text.id), textAfterAdd.node);

  const textBeforeEdit = stack.captureVectorHistoryState("text:1");
  stack.updateText(text.id, { text: "EDITED", x: 321, y: 654 });
  const textAfterEdit = stack.captureVectorHistoryState("text:1");
  stack.restoreVectorHistoryState(textBeforeEdit);
  assert.equal(stack.textById(text.id).text, "HISTORY");
  assert.equal(stack.textById(text.id).x, 2048);
  stack.restoreVectorHistoryState(textAfterEdit);
  assert.equal(stack.textById(text.id).text, "EDITED");
  assert.equal(stack.textById(text.id).x, 321);

  const textBeforeDistort = stack.captureVectorHistoryState("text:1");
  const fontFamilyBeforeDistort = stack.textById(text.id).fontFamily;
  const fontSizeBeforeDistort = stack.textById(text.id).fontSize;
  const distortPoints = Array.from({ length: 10 }, (_, index) => ({
    x: index * 17,
    y: index * -9,
  }));
  stack.updateText(text.id, { transformType: "distort", distortPoints });
  const textAfterDistort = stack.captureVectorHistoryState("text:1");
  assert.equal(stack.textById(text.id).fontFamily, fontFamilyBeforeDistort);
  assert.equal(stack.textById(text.id).fontSize, fontSizeBeforeDistort);
  stack.restoreVectorHistoryState(textBeforeDistort);
  assert.equal(stack.textById(text.id).transformType, "none");
  assert.equal(stack.textById(text.id).fontFamily, fontFamilyBeforeDistort);
  assert.equal(stack.textById(text.id).fontSize, fontSizeBeforeDistort);
  stack.restoreVectorHistoryState(textAfterDistort);
  assert.equal(stack.textById(text.id).transformType, "distort");
  assert.deepEqual(stack.textById(text.id).distortPoints, distortPoints);
  assert.equal(stack.textById(text.id).fontFamily, fontFamilyBeforeDistort);
  assert.equal(stack.textById(text.id).fontSize, fontSizeBeforeDistort);

  stack.select("raster:1");
  const svgBeforeAdd = stack.captureVectorHistoryState("svg:1");
  const svg = stack.addSvgAboveSelection(svgSeed("history.svg"));
  const svgAfterAdd = stack.captureVectorHistoryState("svg:1");
  assert.equal(svgBeforeAdd.node, null);
  assert.equal(svgAfterAdd.node?.document, stack.svgById(svg.id).document);
  stack.updateSvg(svg.id, {
    outlineWidth: 18,
    outlineColor: "#102030",
    outlineJoin: "bevel",
    blockShadowEnabled: true,
    blockShadowColor: "#405060",
    blockShadowOpacity: 0.7,
    blockShadowOffset: 34,
    blockShadowAngle: -72,
    blockShadowOutlineWidth: 6,
    singleShadowEnabled: true,
    singleShadowColor: "#708090",
    singleShadowOpacity: 0.6,
    singleShadowOffset: 28,
    singleShadowAngle: 41,
    singleShadowBlur: 13,
    innerShadowEnabled: true,
    innerShadowColor: "#90a0b0",
    innerShadowOpacity: 0.5,
    innerShadowOffset: 9,
    innerShadowAngle: -33,
    innerShadowBlur: 7,
  });
  const svgAfterEffects = stack.captureVectorHistoryState("svg:1");
  assert.equal(svgAfterEffects.node?.document, svgAfterAdd.node?.document);
  stack.restoreVectorHistoryState(svgAfterAdd);
  assert.equal(stack.svgById(svg.id).outlineWidth, 0);
  assert.equal(stack.svgById(svg.id).blockShadowEnabled, false);
  assert.equal(stack.svgById(svg.id).singleShadowEnabled, false);
  assert.equal(stack.svgById(svg.id).innerShadowEnabled, false);
  stack.restoreVectorHistoryState(svgAfterEffects);
  assert.equal(stack.svgById(svg.id).outlineWidth, 18);
  assert.equal(stack.svgById(svg.id).outlineColor, "#102030");
  assert.equal(stack.svgById(svg.id).blockShadowEnabled, true);
  assert.equal(stack.svgById(svg.id).singleShadowBlur, 13);
  assert.equal(stack.svgById(svg.id).innerShadowBlur, 7);
  assert.equal(stack.svgById(svg.id).document, svgAfterAdd.node?.document);
  stack.updateSvg(svg.id, { paintColors: ["#abcdef"], x: 777 });
  stack.restoreVectorHistoryState(svgAfterAdd);
  assert.equal(stack.svgById(svg.id).paintColors[0], "#ff5500");
  assert.equal(stack.svgById(svg.id).x, 2048);
  assert.notEqual(stack.svgById(svg.id), svgAfterAdd.node);
  assert.equal(
    stack.svgById(svg.id).document,
    svgAfterAdd.node.document,
    "il documento SVG immutabile deve essere condiviso dalla cronologia compatta",
  );
  stack.restoreVectorHistoryState(svgBeforeAdd);
  assert.equal(stack.svgCount, 0);
}

{
  assert.throws(() => new MixedSceneStack([]), /at least one raster layer/);
  assert.throws(() => new MixedSceneStack([1, 1]), /positive and unique/);
  const stack = new MixedSceneStack([1]);
  assert.throws(() => stack.select("text:99"), /does not exist/);
  assert.throws(() => stack.partitionAroundRaster(99), /missing/);
  assert.throws(() => stack.compositionSegments(99), /does not exist|missing/);
  stack.addRasterAboveSelection(2);
  assert.throws(() => stack.addRasterAboveSelection(2), /already present/);
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
  assert.throws(() => stack.addTextAboveSelection(seed("overflow")), /Maximum/);
}

{
  const stack = new MixedSceneStack([1]);
  for (let index = 0; index < VECTOR_SVG_NODE_MAXIMUM; index += 1) {
    stack.addSvgAboveSelection(svgSeed(`S${index}.svg`));
  }
  assert.equal(stack.svgCount, VECTOR_SVG_NODE_MAXIMUM);
  assert.throws(() => stack.addSvgAboveSelection(svgSeed("overflow.svg")), /Maximum/);
}

{
  const stack = new MixedSceneStack([1]);
  const text = stack.addTextAboveSelection({
    ...seed("AXIS TEXT"),
    scale: 2,
    scaleX: 1.5,
    scaleY: 0.75,
  });
  assert.deepEqual(
    [text.scale, text.scaleX, text.scaleY],
    [1.5, 1.5, 0.75],
    "new text nodes must retain independent axes and a horizontal legacy alias",
  );
  stack.updateText(text.id, { scaleY: 1.25 });
  assert.deepEqual([text.scale, text.scaleX, text.scaleY], [1.5, 1.5, 1.25]);
  stack.updateText(text.id, { scale: 3 });
  assert.deepEqual(
    [text.scale, text.scaleX, text.scaleY],
    [3, 3, 3],
    "a legacy scale update must remain uniform",
  );

  const svg = stack.addSvgAboveSelection({
    ...svgSeed("axis.svg"),
    scaleX: 2.25,
    scaleY: 0.5,
  });
  stack.updateSvg(svg.id, { scaleX: 1.75 });
  assert.deepEqual([svg.scale, svg.scaleX, svg.scaleY], [1.75, 1.75, 0.5]);

  const image = stack.addImageAboveSelection({
    ...imageSeed("axis-image"),
    scaleX: 0.8,
    scaleY: 1.4,
  });
  stack.updateImage(image.id, { scaleY: 1.1 });
  assert.deepEqual([image.scale, image.scaleX, image.scaleY], [0.8, 0.8, 1.1]);

  const legacyState = stack.captureState();
  for (const node of [
    ...legacyState.textNodes,
    ...legacyState.svgNodes,
    ...legacyState.imageNodes,
  ]) {
    delete node.scaleX;
    delete node.scaleY;
  }
  stack.restoreState(legacyState);
  for (const node of [
    stack.textById(text.id),
    stack.svgById(svg.id),
    stack.imageById(image.id),
  ]) {
    assert.equal(node.scaleX, node.scale);
    assert.equal(node.scaleY, node.scale);
  }
}

{
  assert.equal(
    MIXED_MEMORY_BENCHMARK_STRATEGY,
    "mixed-raster-vector-64-text-nine-runs-counted-gpu-800mib-v1",
  );
  assert.equal(MIXED_MEMORY_BENCHMARK_TARGET_MIB, 800);
  assert.equal(
    MIXED_MEMORY_BENCHMARK_STAGED_STRATEGY,
    "mixed-raster-vector-64-text-nine-runs-counted-gpu-600mib-staged-v1",
  );
  assert.equal(MIXED_MEMORY_BENCHMARK_STAGED_TARGET_MIB, 600);
  assert.equal(MIXED_MEMORY_BENCHMARK_STAGED_INTERLEAVED_TILE_COUNT, 128);
  assert.equal(MIXED_MEMORY_BENCHMARK_STAGED_TEXT_BATCH_SIZE, 8);
  assert.equal(
    mixedMemoryBenchmarkStrategy(800),
    MIXED_MEMORY_BENCHMARK_STRATEGY,
  );
  assert.equal(
    mixedMemoryBenchmarkStrategy(600),
    MIXED_MEMORY_BENCHMARK_STAGED_STRATEGY,
  );
  assert.equal(MIXED_MEMORY_BENCHMARK_INTERLEAVED_TEXT_RUNS, 8);
  const stressSeeds = Array.from(
    { length: VECTOR_TEXT_NODE_MAXIMUM },
    (_, index) => mixedMemoryBenchmarkTextSeed(index, 4096),
  );
  assert.equal(stressSeeds.filter((entry) => entry.blockShadowEnabled).length, 32);
  assert.equal(stressSeeds.filter((entry) => entry.singleShadowEnabled).length, 32);
  assert(stressSeeds.every((entry) => entry.outlineWidth === 0));
  assert(stressSeeds.every((entry) => entry.blockShadowOutlineWidth === 0));
  assert(stressSeeds.every((entry) => entry.x > 0 && entry.x < 4096));
  assert(stressSeeds.every((entry) => entry.y > 0 && entry.y < 4096));

  const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const engineSource = readEngineSource();
  const mixedMemorySource = readFileSync(
    new URL("../src/labs/memory/mixed-memory-benchmark.ts", import.meta.url),
    "utf8",
  );
  const editorLabsSource = readFileSync(
    new URL("../src/labs/editor-labs.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    engineSource,
    /if \(item\.kind === "text"\) \{[\s\S]*?clippingParentKey: scene\.clippingParentKey\(item\.key\)/,
    "the published text snapshot must retain its clipping relation",
  );
  assert.doesNotMatch(mainSource, /mixedMemoryBenchmark|runMixedMemoryBenchmark/);
  assert.match(editorLabsSource, /\["mixed-memory", "Benchmark memoria mista"\]/);
  assert.match(editorLabsSource, /runMixedMemoryBenchmarkStudy/);
  assert.match(mixedMemorySource, /export async function runMixedMemoryBenchmarkStudy/);
  assert.match(mixedMemorySource, /knownLogicalWorkingSetMiB/);
  assert.match(engineSource, /async addVectorTextNodesBatch\(/);
  assert.match(
    engineSource,
    /if \(legacyBindingsChanged && !deferDisplayInvalidation\)/,
    "il clear transazionale non deve creare bind group contro texture evitte",
  );
  assert.match(
    engineSource,
    /if \(changed && this\.initialized && !deferDisplayInvalidation\)/,
    "il clear transazionale non deve schedulare frame mentre la scena è congelata",
  );
  assert(
    (engineSource.match(/reuseUnchangedRasterRuns: true/g) ?? []).length >= 4,
    "mutazioni e Undo/Redo vettoriali devono riusare i raster-run anche nel rollback",
  );
  assert.match(
    engineSource,
    /this\.mixedSceneRasterSegments = survivingPreviousSegments;/,
    "un rebuild fallito deve lasciare raggiungibili i raster-run riutilizzabili",
  );
  assert.match(
    engineSource,
    /if \(!reusedCandidateSegments\.has\(segment\)\)/,
    "il rollback non deve distruggere risorse raster riusate",
  );
  assert.match(
    engineSource,
    /if \(this\.layerPresentationFrozen\) \{[\s\S]*?Presentation is frozen with pending render work/,
    "waitForIdle deve fallire subito invece di attendere il watchdog per 10 secondi",
  );
  assert.match(
    engineSource,
    /async rebuildMergedLayerSurfaces\([\s\S]*?if \(hasPendingRenderWork\(this\)\) \{[\s\S]*?rendering must be idle before freezing/,
    "la transazione deve rifiutare lavoro render pendente prima di evacuare risorse",
  );
  const rasterSelection = engineSource.slice(
    engineSource.indexOf("async setActiveMixedSceneItem"),
    engineSource.indexOf("  updateVectorTextNode("),
  );
  const rasterSelectionClear = rasterSelection.indexOf(
    "clearVectorTextPresentationForTransaction(this);",
  );
  const rasterSelectionActivation = rasterSelection.indexOf(
    "return await this.setActiveLayer(index);",
  );
  assert(
    rasterSelectionClear >= 0 && rasterSelectionActivation > rasterSelectionClear,
    "la selezione raster deve pulire la preview prima di delegare l'attivazione al motore",
  );
  assert.doesNotMatch(
    rasterSelection.slice(rasterSelectionClear, rasterSelectionActivation),
    /waitForIdle\(\)/,
    "la selezione raster non deve duplicare il fence già posseduto da setActiveLayer",
  );
}

console.log("Mixed raster/vector scene stack verification passed.");
