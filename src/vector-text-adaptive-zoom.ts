/**
 * Il renderer vettoriale non usa mai cache bitmap di ripiego durante lo zoom.
 * I mesh effect LOD vengono compilati nel Worker e scambiati atomicamente;
 * Slug resta analitico per la sorgente in ogni frame.
 */
export const VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY =
  "disabled-always-vector-lod-worker-atomic-swap-v2" as const;
