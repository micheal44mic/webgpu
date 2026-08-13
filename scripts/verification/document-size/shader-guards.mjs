import assert from "node:assert/strict";
import { DOCUMENT_HEIGHT, DOCUMENT_WIDTH, LAYER_SIZE, at, read } from "./profile-context.mjs";
const { FILL_TILE_HEIGHT, FILL_TILE_WIDTH } = await import("../../../src/fill-core.ts");

// --- Nessun 4096 residuo nel WGSL -------------------------------------------
// Gli shader interpolano `${LAYER_SIZE}`: a 2048 nessuna stringa emessa deve
// contenere ancora l'estensione del documento precedente.
if (LAYER_SIZE !== 4096) {
  const {
    fillComputeShader,
    fillRenderShader,
    fillSelectionIntersectionShader,
  } = await import("../../../src/fill-shaders.ts");
  const {
    selectionComputeShader,
    selectionOverlayShader,
  } = await import("../../../src/selection-shaders.ts");
  const emittedShaders = [
    ["fill compute", fillComputeShader],
    ["fill render", fillRenderShader],
    ["fill selection intersection", fillSelectionIntersectionShader],
    ["selection compute", selectionComputeShader],
    ["selection overlay", selectionOverlayShader],
  ];
  for (const [label, code] of emittedShaders) {
    assert.ok(
      typeof code === "string" && code.length > 0,
      at(`Shader ${label} vuoto: il controllo sul 4096 residuo sarebbe inerte`),
    );
    assert.ok(
      !/\b4096\b/.test(code),
      at(`Lo shader ${label} contiene ancora un 4096 cablato`),
    );
  }
}

// Il compositore mixed-scene e il compositore a tile della fusione non passano
// da Node (importano moduli WebGPU): li controlliamo sul sorgente, perche' un
// 4096 cablato li' e' esattamente il difetto che questa suite deve intercettare.
for (
  const [path, pattern, message] of [
    [
      "../src/mixed-scene-compositor-shader.ts",
      /all\(layerPosition < vec2<f32>\(\$\{DOCUMENT_WIDTH\}\.0, \$\{DOCUMENT_HEIGHT\}\.0\)\)/,
      "il compositore mixed-scene deve interpolare entrambi gli assi",
    ],
    [
      "../src/layer-blend-tile-compositor.ts",
      /this\.mipUniformU32\[word \+ 2\] = DOCUMENT_WIDTH;\n\s*this\.mipUniformU32\[word \+ 3\] = DOCUMENT_HEIGHT;/,
      "l'uniforme mip della fusione a tile deve usare entrambi gli assi",
    ],
    [
      "../src/fill-shaders.ts",
      /reduceMinX\[0\] \/ \$\{FILL_TILE_WIDTH\}u, reduceMinY\[0\] \/ \$\{FILL_TILE_HEIGHT\}u[\s\S]*?\(reduceMaxX\[0\] - 1u\) \/ \$\{FILL_TILE_WIDTH\}u,[\s\S]*?\(reduceMaxY\[0\] - 1u\) \/ \$\{FILL_TILE_HEIGHT\}u/,
      "il Riempimento deve marcare ogni tile rettangolare toccata dai pixel selezionati",
    ],
  ]
) {
  assert.match(read(path), pattern, at(message));
}

console.log(`  documento ${DOCUMENT_WIDTH}×${DOCUMENT_HEIGHT}: invarianti ok`);
