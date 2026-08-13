import assert from "node:assert/strict";

export const seed = (text = "STREETWEAR") => ({
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
export const svgDocument = (sourceName = "fixture.svg") => {
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
export const svgSeed = (sourceName = "fixture.svg") => ({
  document: svgDocument(sourceName),
  x: 2048,
  y: 2048,
  scale: 1,
  rotation: 0,
});
export const imageSeed = (assetId = "asset:1", sourceName = "fixture.png") => ({
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
export const flattenedCompositionKeys = (segments) => segments.flatMap((segment) => {
  if (segment.kind === "active-raster" || segment.kind === "image") {
    return [segment.item.key];
  }
  return segment.items.map((item) => item.key);
});

export const assertCompositionPreservesDocumentOrder = (stack, activeRasterLayerId) => {
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
