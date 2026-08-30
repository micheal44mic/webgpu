/**
 * Dimensioni fisse, budget e taglie dei buffer uniform. Sono i numeri che
 * determinano l'allocazione statica del motore: toccarli cambia la memoria
 * misurata dai benchmark.
 */

export const DOCUMENT_MINIMUM_EDGE = 64;

export const DOCUMENT_MAXIMUM_EDGE = 4000;

/** Existing 4096-square documents remain readable after the custom-size migration. */
export const LEGACY_DOCUMENT_EDGE = 4096;

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
 * Dimensioni iniziali del documento, risolte prima che i moduli GPU vengano
 * valutati. Dopo l'avvio il composition root puo' sostituirle attraverso
 * `reconfigureDocumentDimensions`: i consumatori devono quindi leggere i live
 * binding al momento dell'uso e non copiarli in costanti module-scoped.
 *
 * I telefoni usano 2048² in assenza di una scelta esplicita. I nuovi documenti
 * accettano bordi interi 64..4000; 4096² resta supportato esclusivamente per
 * aprire i documenti legacy creati dalla versione precedente.
 *
 * `?documentWidth=1080&documentHeight=1920` forza i due bordi. Il vecchio
 * `?documentSize=2048` resta un alias quadrato compatibile.
 * `?deviceClass=mobile` e `BRUSH_DEVICE_CLASS=mobile` forzano l'intero profilo
 * mobile, budget History incluso. Servono a riprodurre il percorso mobile da
 * desktop nella QA browser e a girare le verifiche su entrambi i profili.
 */
function validDocumentEdge(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed)
    && parsed >= DOCUMENT_MINIMUM_EDGE
    && parsed <= DOCUMENT_MAXIMUM_EDGE
    ? parsed
    : null;
}

function resolveDocumentDimensions(): readonly [number, number] {
  const legacyRaw = queryOverride("documentSize", "BRUSH_DOCUMENT_SIZE");
  const legacy = validDocumentEdge(legacyRaw);
  const legacy4096 = legacyRaw !== null && Number(legacyRaw) === LEGACY_DOCUMENT_EDGE;
  const width = validDocumentEdge(queryOverride("documentWidth", "BRUSH_DOCUMENT_WIDTH"));
  const height = validDocumentEdge(queryOverride("documentHeight", "BRUSH_DOCUMENT_HEIGHT"));
  if (width !== null && height !== null) return [width, height];
  if (legacy !== null) return [legacy, legacy];
  if (legacy4096) return [LEGACY_DOCUMENT_EDGE, LEGACY_DOCUMENT_EDGE];
  const fallback = MOBILE_DEVICE_CLASS ? 2048 : LEGACY_DOCUMENT_EDGE;
  return [fallback, fallback];
}

const DOCUMENT_DIMENSIONS = resolveDocumentDimensions();

/**
 * The application owns one active GPU document at a time. These bindings are
 * live so a verified project switch can replace document-scoped resources
 * without replacing the adapter, device, or session-owned program cache.
 */
export let DOCUMENT_WIDTH = DOCUMENT_DIMENSIONS[0];

export let DOCUMENT_HEIGHT = DOCUMENT_DIMENSIONS[1];

export let DOCUMENT_MAX_EDGE = Math.max(DOCUMENT_WIDTH, DOCUMENT_HEIGHT);

/** @deprecated Prefer DOCUMENT_WIDTH / DOCUMENT_HEIGHT. Kept for report compatibility. */
export let LAYER_SIZE = DOCUMENT_MAX_EDGE;

/**
 * Il documento e' sempre diviso in una griglia logica 16×16. I tile sono
 * rettangolari e arrotondati verso l'alto; l'ultima riga/colonna viene ritagliata
 * sul bordo reale. Le maschere restano quindi sempre di 8 word.
 */
export const DOCUMENT_TILE_GRID_SIZE = 16;

export let DOCUMENT_TILE_WIDTH = Math.ceil(DOCUMENT_WIDTH / DOCUMENT_TILE_GRID_SIZE);

export let DOCUMENT_TILE_HEIGHT = Math.ceil(DOCUMENT_HEIGHT / DOCUMENT_TILE_GRID_SIZE);

/** @deprecated Square-only compatibility value. */
export let DOCUMENT_TILE_SIZE = Math.max(DOCUMENT_TILE_WIDTH, DOCUMENT_TILE_HEIGHT);

export const DOCUMENT_TILE_MASK_WORDS =
  DOCUMENT_TILE_GRID_SIZE * DOCUMENT_TILE_GRID_SIZE / 32;

export const MEBIBYTE_BYTES = 1024 * 1024;

export let PAINT_DISPLAY_MIP_LEVEL_COUNT = Math.floor(Math.log2(DOCUMENT_MAX_EDGE)) + 1;

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

export let THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION = DOCUMENT_MAX_EDGE;

export const SHAPE_MASK_SIZE = 2048;

// The logical Shape remains 2048². Only the derived sampling texture reserves
// this transparent reconstruction guard, so imported/source pixels, previews
// and brush geometry keep their authored coordinate system.
export const SHAPE_MASK_FILTER_GUARD_TEXELS = 64;

export const SHAPE_MASK_FILTER_CONTENT_SIZE =
  SHAPE_MASK_SIZE - SHAPE_MASK_FILTER_GUARD_TEXELS * 2;

export const SHAPE_MASK_FILTER_UV_SCALE =
  SHAPE_MASK_FILTER_CONTENT_SIZE / SHAPE_MASK_SIZE;

export const SHAPE_MASK_FILTER_UV_OFFSET =
  SHAPE_MASK_FILTER_GUARD_TEXELS / SHAPE_MASK_SIZE;

export const SHAPE_MASK_FILTER_UV_HALF_EXTENT =
  SHAPE_MASK_FILTER_UV_SCALE / 2;

export const GRAIN_TEXTURE_SIZE = 800;

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

// The final 16 bytes carry the document extent independently from a cropped
// render target. This keeps symmetry dimension-neutral while preserving the
// target-size/origin lanes used by deferred previews.
export const BRUSH_UNIFORM_BYTES = 112;

export const GRAIN_UNIFORM_BYTES = 32;

// The first 64 bytes retain the historical display ABI. The next 32 bytes
// describe the one live clipping group, followed by the structural backdrop
// and the active document extent used by dimension-neutral presentation code.
export const DISPLAY_UNIFORM_BYTES = 128;

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

// This buffer is tiny compared with document textures, so reserve the largest
// supported legacy grid once and keep its binding valid across every canvas.
export const LIGHT_GLAZE_COMMIT_TILE_SLOT_COUNT =
  Math.ceil(LEGACY_DOCUMENT_EDGE / LIGHT_GLAZE_COMMIT_TILE_EXTENT) ** 2;

export const LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BUFFER_BYTES =
  LIGHT_GLAZE_COMMIT_TILE_UNIFORM_STRIDE_BYTES * LIGHT_GLAZE_COMMIT_TILE_SLOT_COUNT;

export const THICKNESS_TAIL_UNIFORM_BYTES = 32;

export const STATIC_PAINT_BUFFER_BYTES =
  BRUSH_UNIFORM_BYTES * 2
  + GRAIN_UNIFORM_BYTES
  + DISPLAY_UNIFORM_BYTES
  + VECTOR_TEXT_CAPTURE_UNIFORM_BYTES * 2
  + LAYER_COMPOSITE_UNIFORM_BYTES
  + THICKNESS_TAIL_UNIFORM_BYTES
  + LIGHT_GLAZE_UNIFORM_BYTES
  + LIGHT_GLAZE_COMMIT_TILE_UNIFORM_BUFFER_BYTES
  + MAX_STAMPS_PER_BATCH * STAMP_STRIDE_BYTES * 2
  + SHAPE_OCCUPANCY_MAP_BYTES * SHAPE_OCCUPANCY_MAP_COUNT;

export interface RuntimeDocumentDimensions {
  readonly width: number;
  readonly height: number;
  readonly maxEdge: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly mipLevelCount: number;
}

export interface ReconfigureDocumentDimensionsOptions {
  /** Existing 4096-square projects are the only supported legacy exception. */
  readonly allowLegacy4096?: boolean;
}

export function validateDocumentDimensions(
  width: number,
  height: number,
  options: ReconfigureDocumentDimensionsOptions = {},
): void {
  const standard = Number.isInteger(width)
    && Number.isInteger(height)
    && width >= DOCUMENT_MINIMUM_EDGE
    && height >= DOCUMENT_MINIMUM_EDGE
    && width <= DOCUMENT_MAXIMUM_EDGE
    && height <= DOCUMENT_MAXIMUM_EDGE;
  const legacy = options.allowLegacy4096 === true
    && width === LEGACY_DOCUMENT_EDGE
    && height === LEGACY_DOCUMENT_EDGE;
  if (!standard && !legacy) {
    throw new RangeError(
      `Document dimensions must be whole pixels from ${DOCUMENT_MINIMUM_EDGE} to `
      + `${DOCUMENT_MAXIMUM_EDGE}, or the exact legacy 4096-square extent.`,
    );
  }
}

export function currentDocumentDimensions(): RuntimeDocumentDimensions {
  return Object.freeze({
    width: DOCUMENT_WIDTH,
    height: DOCUMENT_HEIGHT,
    maxEdge: DOCUMENT_MAX_EDGE,
    tileWidth: DOCUMENT_TILE_WIDTH,
    tileHeight: DOCUMENT_TILE_HEIGHT,
    mipLevelCount: PAINT_DISPLAY_MIP_LEVEL_COUNT,
  });
}

export function reconfigureDocumentDimensions(
  width: number,
  height: number,
  options: ReconfigureDocumentDimensionsOptions = {},
): RuntimeDocumentDimensions {
  validateDocumentDimensions(width, height, options);

  DOCUMENT_WIDTH = width;
  DOCUMENT_HEIGHT = height;
  DOCUMENT_MAX_EDGE = Math.max(width, height);
  LAYER_SIZE = DOCUMENT_MAX_EDGE;
  DOCUMENT_TILE_WIDTH = Math.ceil(width / DOCUMENT_TILE_GRID_SIZE);
  DOCUMENT_TILE_HEIGHT = Math.ceil(height / DOCUMENT_TILE_GRID_SIZE);
  DOCUMENT_TILE_SIZE = Math.max(DOCUMENT_TILE_WIDTH, DOCUMENT_TILE_HEIGHT);
  PAINT_DISPLAY_MIP_LEVEL_COUNT = Math.floor(Math.log2(DOCUMENT_MAX_EDGE)) + 1;
  THICKNESS_TAIL_MAXIMUM_TEXTURE_DIMENSION = DOCUMENT_MAX_EDGE;
  return currentDocumentDimensions();
}
