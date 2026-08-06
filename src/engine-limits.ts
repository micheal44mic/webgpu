/**
 * Dimensioni fisse, budget e taglie dei buffer uniform. Sono i numeri che
 * determinano l'allocazione statica del motore: toccarli cambia la memoria
 * misurata dai benchmark.
 */

const DOCUMENT_SIZE_CHOICES = [2048, 4096] as const;

const MOBILE_MAX_SCREEN_EDGE = 700;

function queryOverride(name: string, environmentName: string): string | null {
  return (typeof location !== "undefined" && typeof URLSearchParams === "function"
    ? new URLSearchParams(location.search).get(name)
    : null)
    ?? (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.[environmentName]
    ?? null;
}

/**
 * Classe del dispositivo, decisa una sola volta all'import di questo modulo.
 *
 * Il criterio e' lo **schermo fisico**, non il viewport. Un iPhone in landscape
 * e' largo `844 px`: con una media query sul viewport la rotazione cambierebbe
 * classe a meta' sessione, che e' esattamente il difetto che aveva il budget
 * History prima di questa costante. Un tablet (iPad `820×1180`) resta desktop,
 * e uno schermo che dichiara `0` e' un runtime che non sa rispondere, non un
 * telefono. Senza `screen`/`matchMedia` (Node, suite `*:verify`) e' desktop.
 *
 * Ogni scelta legata al dispositivo deve derivare da qui e non risondare i
 * media query per conto proprio, altrimenti torna a divergere.
 */
function resolveMobileDeviceClass(): boolean {
  const override = queryOverride("deviceClass", "BRUSH_DEVICE_CLASS");
  if (override === "mobile") return true;
  if (override === "desktop") return false;
  if (typeof matchMedia !== "function" || typeof screen === "undefined") return false;
  const shortestScreenEdge = Math.min(screen.width, screen.height);
  return matchMedia("(pointer: coarse)").matches
    && shortestScreenEdge > 0
    && shortestScreenEdge <= MOBILE_MAX_SCREEN_EDGE;
}

export const MOBILE_DEVICE_CLASS = resolveMobileDeviceClass();

/**
 * Dimensione del documento, derivata dalla classe del dispositivo.
 *
 * `engine-limits` non importa nulla: il suo body gira prima di ogni modulo che
 * lo consuma, quindi le stringhe WGSL che interpolano `${LAYER_SIZE}` e le
 * costanti derivate a module-eval leggono gia' il valore giusto. Per questo il
 * valore va deciso qui e non passato da `main.ts`.
 *
 * I telefoni usano 2048²: un livello rgba16float costa 32 MiB invece di 128 e
 * ogni pass full-document costa un quarto del fill-rate.
 *
 * `?documentSize=2048` e `BRUSH_DOCUMENT_SIZE=2048` forzano la sola taglia;
 * `?deviceClass=mobile` e `BRUSH_DEVICE_CLASS=mobile` forzano l'intero profilo
 * mobile, budget History incluso. Servono a riprodurre il percorso mobile da
 * desktop nella QA browser e a girare le verifiche su entrambi i profili.
 */
function resolveDocumentSize(): number {
  const raw = queryOverride("documentSize", "BRUSH_DOCUMENT_SIZE");
  const parsed = raw === null ? Number.NaN : Number(raw);
  if ((DOCUMENT_SIZE_CHOICES as readonly number[]).includes(parsed)) return parsed;
  return MOBILE_DEVICE_CLASS ? 2048 : 4096;
}

export const LAYER_SIZE = resolveDocumentSize();

/**
 * Il documento e' sempre diviso in una griglia 16×16 di tile: e' il lato del
 * tile a scalare con `LAYER_SIZE`, non il numero di tile. Cosi' ogni maschera
 * tile del motore (Selezione, Riempimento, cold storage, transform) resta di
 * 8 word e le maschere restano interscambiabili a qualsiasi taglia.
 */
export const DOCUMENT_TILE_GRID_SIZE = 16;

export const DOCUMENT_TILE_SIZE = LAYER_SIZE / DOCUMENT_TILE_GRID_SIZE;

export const DOCUMENT_TILE_MASK_WORDS =
  DOCUMENT_TILE_GRID_SIZE * DOCUMENT_TILE_GRID_SIZE / 32;

export const MEBIBYTE_BYTES = 1024 * 1024;

export const PAINT_DISPLAY_MIP_LEVEL_COUNT = Math.floor(Math.log2(LAYER_SIZE)) + 1;

export const STAMP_STRIDE_BYTES = 32;

export const MAX_STAMPS_PER_BATCH = 65_536;

export const STABILIZATION_TAIL_TEXTURE_QUANTUM = 128;

// Il drenaggio dei batch Blend è limitato dai pixel-pass per frame, non da un
// conteggio fisso per size: col renderer compute un segmento costa il deposit
// sulla propria writeRect più la quota di gather/scatter del gruppo (~2 pass
// equivalenti sulla readRect). Un budget in pixel lascia alle size piccole
// centinaia di segmenti per frame (il tratto resta attaccato al puntatore) e
// continua a proteggere il frame time sulle size grandi.
export const DRY_BLEND_FRAME_PIXEL_BUDGET = 24_000_000;

export const DRY_BLEND_MAX_BATCHES_PER_FRAME = 256;

export const STAMP_VERTICES_PER_COPY = 4;

export const THICKNESS_TAIL_TEXTURE_QUANTUM = 256;

export const THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION = LAYER_SIZE;

export const SHAPE_MASK_SIZE = 2048;

export const GRAIN_TEXTURE_SIZE = 2500;

export const GRAIN_TEXTURE_MIP_LEVEL_COUNT = Math.floor(Math.log2(GRAIN_TEXTURE_SIZE)) + 1;

export const GRAIN_TEXTURE_PIXEL_COUNT = Array.from(
  { length: GRAIN_TEXTURE_MIP_LEVEL_COUNT },
  (_, mipLevel) => {
    const dimension = Math.max(1, Math.floor(GRAIN_TEXTURE_SIZE / (2 ** mipLevel)));
    return dimension * dimension;
  },
).reduce((sum, pixels) => sum + pixels, 0);

export const SHAPE_MASK_PIXEL_COUNT = Array.from(
  { length: Math.log2(SHAPE_MASK_SIZE) + 1 },
  (_, mipLevel) => {
    const dimension = Math.max(1, SHAPE_MASK_SIZE >> mipLevel);
    return dimension * dimension;
  },
).reduce((sum, pixels) => sum + pixels, 0);

export const SHAPE_OCCUPANCY_GRID_SIZE = 256;

export const SHAPE_OCCUPANCY_CELL_SIZE = SHAPE_MASK_SIZE / SHAPE_OCCUPANCY_GRID_SIZE;

export const SHAPE_OCCUPANCY_CELL_COUNT = SHAPE_OCCUPANCY_GRID_SIZE * SHAPE_OCCUPANCY_GRID_SIZE;

export const SHAPE_OCCUPANCY_WORDS_PER_MAP = SHAPE_OCCUPANCY_CELL_COUNT / 32;

export const SHAPE_OCCUPANCY_MAX_MIP = 4;

export const SHAPE_OCCUPANCY_MAP_COUNT = SHAPE_OCCUPANCY_MAX_MIP + 1;

export const SHAPE_OCCUPANCY_MIN_RADIUS = 128;

export const SHAPE_OCCUPANCY_MAX_COVERAGE_RATIO = 0.5;

export const SHAPE_OCCUPANCY_MAP_BYTES = SHAPE_OCCUPANCY_WORDS_PER_MAP * 4;

export const BRUSH_UNIFORM_BYTES = 96;

export const GRAIN_UNIFORM_BYTES = 32;

// The first 64 bytes retain the historical display ABI. The final 32 bytes
// describe the one live clipping group (mode, parent opacity and two cropped
// auxiliary surfaces) shared by every presentation shader.
export const DISPLAY_UNIFORM_BYTES = 96;

export const VECTOR_TEXT_CAPTURE_UNIFORM_BYTES = 32;

export const VECTOR_TEXT_GPU_MAXIMUM_DRAWS = 512;

export const VIEW_ROTATION_SNAP_ENTER_RADIANS = 3 * Math.PI / 180;

export const VIEW_ROTATION_SNAP_RELEASE_RADIANS = 7 * Math.PI / 180;

// Destination origin/scale + opacity, followed by source origin/scale and
// dimensions. This lets the same fold shader consume either a full document
// layer or a cropped clipping-group carrier.
export const LAYER_COMPOSITE_UNIFORM_BYTES = 48;

export const LIGHT_GLAZE_UNIFORM_BYTES = 32;

export const LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BYTES = 16;

export const LIGHT_GLAZE_COMMIT_TILE_UNIFORM_STRIDE_BYTES = 256;

export const LIGHT_GLAZE_COMMIT_TILE_EXTENT = 1024;

export const LIGHT_GLAZE_COMMIT_TILE_SLOT_COUNT =
  (LAYER_SIZE / LIGHT_GLAZE_COMMIT_TILE_EXTENT) ** 2;

export const LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BUFFER_BYTES =
  LIGHT_GLAZE_COMMIT_TILE_UNIFORM_STRIDE_BYTES * LIGHT_GLAZE_COMMIT_TILE_SLOT_COUNT;

export const THICKNESS_TAIL_UNIFORM_BYTES = 32;

export const STATIC_PAINT_BUFFER_BYTES =
  BRUSH_UNIFORM_BYTES * 2
  + GRAIN_UNIFORM_BYTES
  + DISPLAY_UNIFORM_BYTES
  + VECTOR_TEXT_CAPTURE_UNIFORM_BYTES
  + LAYER_COMPOSITE_UNIFORM_BYTES
  + THICKNESS_TAIL_UNIFORM_BYTES
  + LIGHT_GLAZE_UNIFORM_BYTES
  + LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BUFFER_BYTES
  + MAX_STAMPS_PER_BATCH * STAMP_STRIDE_BYTES * 2
  + SHAPE_OCCUPANCY_MAP_BYTES * SHAPE_OCCUPANCY_MAP_COUNT;
