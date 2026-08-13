import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RASTER_TRANSFORM_DOCUMENT_HEIGHT,
  RASTER_TRANSFORM_DOCUMENT_WIDTH,
  RASTER_TRANSFORM_TILE_HEIGHT,
  RASTER_TRANSFORM_TILE_WIDTH,
  packRasterTransformUniforms,
  rasterTransformScratchRect,
  tileMaskCoveringRect,
} from "../../../src/raster-transform-math.ts";

// --- Invariante contenuto/tile ------------------------------------------------
// Lo scratch si deriva dalla maschera di tile, e `packRasterTransformUniforms`
// pretende che il contenuto ci stia dentro. Bounds e maschera nascono pero' da
// calcoli diversi — continui i primi, per tile proiettata la seconda — e
// divergono di pochi pixel a ogni Applica. Misurato in browser dopo due
// Applica: contenuto `0,0 903x490` contro maschera `0,0 896x512`, sette pixel
// fuori a destra. Da li' Trasforma non si riapriva piu' su quel livello.
{
  const documentWidth = RASTER_TRANSFORM_DOCUMENT_WIDTH;
  const documentHeight = RASTER_TRANSFORM_DOCUMENT_HEIGHT;
  const tileWidth = RASTER_TRANSFORM_TILE_WIDTH;
  const tileHeight = RASTER_TRANSFORM_TILE_HEIGHT;
  const gridWidth = Math.ceil(documentWidth / tileWidth);
  const gridHeight = Math.ceil(documentHeight / tileHeight);
  const parole = Math.ceil((gridWidth * gridHeight) / 32);
  const accendi = (mask, tileX, tileY) => {
    const indice = tileY * gridWidth + tileX;
    mask[indice >>> 5] |= 1 << (indice & 31);
  };
  const identita = { translationX: 0, translationY: 0, scale: 1, rotation: 0 };

  const maschera = new Uint32Array(parole);
  for (let tileY = 0; tileY < 4; tileY += 1) {
    for (let tileX = 0; tileX < 7; tileX += 1) accendi(maschera, tileX, tileY);
  }
  const scratchPrima = rasterTransformScratchRect(
    maschera,
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  );
  assert.equal(scratchPrima.width, 7 * tileWidth, "scratch di partenza inatteso");

  // Il caso reale: il contenuto sfora la maschera di 7 px a destra.
  const contenuto = {
    x: 0,
    y: 0,
    width: 7 * tileWidth + 7,
    height: 4 * tileHeight - 22,
  };
  assert.throws(
    () => packRasterTransformUniforms({
      sourceScratchRect: scratchPrima,
      sourceContentBounds: contenuto,
      sourcePivot: { x: 0, y: 0 },
      transform: identita,
    }),
    /sourceContentBounds deve essere contenuto nello scratch/,
    "senza copertura il caso misurato deve ancora fallire: e' la regressione",
  );

  const coperta = tileMaskCoveringRect(
    maschera,
    contenuto,
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  );
  const scratchDopo = rasterTransformScratchRect(
    coperta,
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  );
  assert.equal(scratchDopo.width, 8 * tileWidth, "la copertura deve accendere la colonna mancante");
  packRasterTransformUniforms({
    sourceScratchRect: scratchDopo,
    sourceContentBounds: contenuto,
    sourcePivot: { x: 0, y: 0 },
    transform: identita,
  });

  // Non deve mutare l'ingresso: la maschera del record e' condivisa.
  assert.equal(rasterTransformScratchRect(
    maschera,
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  ).width, 7 * tileWidth,
    "tileMaskCoveringRect non deve mutare la maschera ricevuta");

  // Bordo esatto: `right` e' esclusivo, quindi un rettangolo che finisce sul
  // confine non deve accendere la colonna successiva.
  const esatto = tileMaskCoveringRect(
    maschera,
    { x: 0, y: 0, width: 7 * tileWidth, height: 4 * tileHeight },
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  );
  assert.equal(rasterTransformScratchRect(
    esatto,
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  ).width, 7 * tileWidth,
    "un rettangolo allineato al tile non deve accendere una colonna vuota");

  // La maschera puo' solo crescere, e un rettangolo nullo la lascia com'e'.
  const nulla = tileMaskCoveringRect(
    maschera,
    null,
    documentWidth,
    tileWidth,
    documentHeight,
    tileHeight,
  );
  assert.deepEqual([...nulla], [...maschera], "rect nullo deve lasciare la maschera invariata");
  for (let parola = 0; parola < parole; parola += 1) {
    assert.equal(coperta[parola] & maschera[parola], maschera[parola],
      "la copertura non puo' spegnere tile gia' accesi");
  }
}

// --- Guardie del runtime ------------------------------------------------------
{
  const engine = readFileSync(new URL("../../../src/brush-engine.ts", import.meta.url), "utf8");
  const guardia = engine.slice(
    engine.indexOf("  assertLayerSwitchAllowed(): void {"),
    engine.indexOf("  assertLayerSwitchAllowed(): void {") + 1_400,
  );
  // La sessione Trasforma tiene viva la texture hot del sorgente: un cambio di
  // livello la evacua e l'Applica successivo la trova mancante, perdendo la
  // trasformazione in silenzio. L'Undo era gia' protetto, `addLayer` no.
  assert.ok(
    guardia.includes("this.activeRasterTransformSession"),
    "il cambio livello va rifiutato mentre una sessione Trasforma e' aperta",
  );
  assert.ok(
    guardia.indexOf("this.activeRasterTransformSession")
      < guardia.indexOf("this.activeStroke"),
    "il caso Trasforma va controllato per primo, per dare il messaggio che dice cosa fare",
  );

  const runtime = readFileSync(
    new URL("../../../src/engine-raster-transform-runtime.ts", import.meta.url),
    "utf8",
  );
  const metadati = runtime.slice(
    runtime.indexOf("function setAuthoritativeMetadata("),
    runtime.indexOf("function encodeTransformPass("),
  );
  assert.match(
    metadati,
    /record\.storageTileMask\.set\(\s*\n?\s*tileMaskCoveringRect\(tileMask, bounds\),?\s*\n?\s*\)/,
    "bounds e maschera vanno scritti insieme rispettando l'invariante",
  );
  assert.match(
    runtime,
    /const sourceTileMask = tileMaskCoveringRect\(\s*\n\s*record\.storageTileMask,\s*\n\s*sourceBounds,/,
    "anche in lettura, per riparare un livello gia' divergente",
  );
}

console.log("Raster transform tile/bounds invariant verified.");
