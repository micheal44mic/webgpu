/**
 * Session cache for immutable, content-addressed application assets.
 *
 * The production worker gives hashed `/assets/*` responses a long-lived HTTP
 * cache lifetime. This map removes even the repeated Cache API/fetch lookup and
 * ArrayBuffer allocation while one editor page stays alive. Values are source
 * bytes only: decoded canvases and GPU textures remain owned by the engine's
 * existing memory governor and are never accumulated per document.
 */
const sourcePromises = new Map<string, Promise<ArrayBuffer>>();

function canonicalAssetUrl(source: string | URL): string {
  return source instanceof URL ? source.href : new URL(source, document.baseURI).href;
}

export function loadCachedAssetSource(source: string | URL): Promise<ArrayBuffer> {
  const url = canonicalAssetUrl(source);
  const cached = sourcePromises.get(url);
  if (cached) return cached;

  const loading = fetch(url, {
    cache: "force-cache",
    credentials: "same-origin",
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Could not load asset ${url} (${response.status}).`);
    }
    return await response.arrayBuffer();
  }).catch((error) => {
    if (sourcePromises.get(url) === loading) sourcePromises.delete(url);
    throw error;
  });
  sourcePromises.set(url, loading);
  return loading;
}

export function cachedAssetSourceCount(): number {
  return sourcePromises.size;
}
