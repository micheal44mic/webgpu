/**
 * Il renderer vettoriale non usa mai cache bitmap di ripiego durante lo zoom.
 * Le mesh effetto vengono compilate nel Worker con una coda latest-only. Il
 * nodo completo e la sua bbox restano sull’ultima revisione pronta finché
 * tutti gli effetti della revisione nuova possono essere scambiati insieme.
 * Slug resta analitico: non esiste alcun fallback bitmap.
 */
export const VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY =
  "disabled-vector-lod-worker-node-atomic-latest-only-v3" as const;
