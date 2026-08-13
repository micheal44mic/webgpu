import assert from "node:assert/strict";
import {
  MIXED_SCENE_STACK_STRATEGY,
  MixedSceneStack,
  RASTER_IMAGE_NODE_MAXIMUM,
  VECTOR_SVG_NODE_MAXIMUM,
  VECTOR_TEXT_NODE_MAXIMUM,
  reusableMixedSceneRasterRunKeys,
  uniqueLayerDuplicateName,
} from "../../../src/mixed-scene-stack.ts";
import {
  assertCompositionPreservesDocumentOrder,
  imageSeed,
  seed,
  svgSeed,
} from "./fixtures.mjs";

assert.equal(
  MIXED_SCENE_STACK_STRATEGY,
  "heterogeneous-bottom-up-raster-vector-image-segmented-composition-vector-raster-replacement-v7",
);
assert.equal(RASTER_IMAGE_NODE_MAXIMUM, 64);

assert.equal(uniqueLayerDuplicateName("Logo", ["Logo"]), "Logo copia");
assert.equal(
  uniqueLayerDuplicateName("Logo copia", ["Logo", "Logo copia", "Logo copia 2"]),
  "Logo copia 3",
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
  assert.equal(duplicateText.name, "Titolo copia");
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
  assert.throws(() => stack.svgById(svg.id), /inesistente/);

  assert.equal(stack.replaceRasterWithVector(99, historyState), sceneIndex);
  assert.deepEqual(
    stack.items.map((item) => item.key),
    ["raster:1", svgKey, "raster:2"],
  );
  assert.equal(stack.selected.key, svgKey);
  assert.equal(stack.svgById(svg.id).document.sourceName, "raster-source.svg");
  assert.equal(stack.rasterIndexForSceneIndex(stack.items.length), 2);
  assert.throws(() => stack.rasterIndexForSceneIndex(-1), /fuori intervallo/);
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
  assert.throws(() => stack.textById(text.id), /inesistente/);

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

{
  const stack = new MixedSceneStack([1]);
  for (let index = 0; index < VECTOR_SVG_NODE_MAXIMUM; index += 1) {
    stack.addSvgAboveSelection(svgSeed(`S${index}.svg`));
  }
  assert.equal(stack.svgCount, VECTOR_SVG_NODE_MAXIMUM);
  assert.throws(() => stack.addSvgAboveSelection(svgSeed("overflow.svg")), /Massimo/);
}
