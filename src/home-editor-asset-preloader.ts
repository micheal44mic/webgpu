import { loadCachedAssetSource } from "./asset-source-cache.ts";
import { BUILTIN_BRUSH_ASSETS } from "./brush-builtin-assets.ts";
import { VECTOR_TEXT_FONT_MANIFEST } from "./vector-text-font-manifest.ts";

export type HomeEditorAssetFamily = "brush-sources" | "vector-font-sources";

export interface HomeEditorAssetPreloadEntry {
  readonly family: HomeEditorAssetFamily;
  readonly url: URL;
}

export interface HomeEditorAssetPreloadResult {
  readonly loadedEntries: number;
  readonly loadedBytes: number;
  readonly failedEntries: number;
  readonly skippedEntries: number;
  readonly failureMessages: readonly string[];
}

export interface HomeEditorAssetPreloadOptions {
  /** Lets the Home scheduler yield between immutable source reads on mobile. */
  readonly yieldBetweenEntries?: () => Promise<void>;
  /** Stops before the next source when ownership is handed to the editor. */
  readonly continueWhile?: () => boolean;
}

export function homeEditorAssetPreloadManifest(): readonly HomeEditorAssetPreloadEntry[] {
  const entries: HomeEditorAssetPreloadEntry[] = [];
  const seen = new Set<string>();
  for (const asset of Object.values(BUILTIN_BRUSH_ASSETS)) {
    if (seen.has(asset.url.href)) continue;
    seen.add(asset.url.href);
    entries.push({ family: "brush-sources", url: asset.url });
  }
  for (const font of VECTOR_TEXT_FONT_MANIFEST) {
    if (seen.has(font.fileUrl.href)) continue;
    seen.add(font.fileUrl.href);
    entries.push({ family: "vector-font-sources", url: font.fileUrl });
  }
  return Object.freeze(entries);
}

/**
 * Populates the session's immutable source-byte cache only. Decoded images,
 * parsed font objects and GPU resources remain lazy and memory-governed.
 */
export async function preloadHomeEditorAssetSources(
  options: HomeEditorAssetPreloadOptions = {},
): Promise<HomeEditorAssetPreloadResult> {
  let loadedEntries = 0;
  let loadedBytes = 0;
  const failureMessages: string[] = [];
  const manifest = homeEditorAssetPreloadManifest();
  let visitedEntries = 0;
  for (let index = 0; index < manifest.length; index += 1) {
    if (options.continueWhile?.() === false) break;
    const entry = manifest[index];
    visitedEntries += 1;
    try {
      const source = await loadCachedAssetSource(entry.url);
      loadedEntries += 1;
      loadedBytes += source.byteLength;
    } catch (error) {
      failureMessages.push(error instanceof Error ? error.message : String(error));
    }
    if (index + 1 < manifest.length) {
      await options.yieldBetweenEntries?.();
    }
  }
  return Object.freeze({
    loadedEntries,
    loadedBytes,
    failedEntries: failureMessages.length,
    skippedEntries: manifest.length - visitedEntries,
    failureMessages: Object.freeze(failureMessages),
  });
}
