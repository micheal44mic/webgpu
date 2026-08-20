import assert from "node:assert/strict";

const originalDocument = globalThis.document;
const originalFetch = globalThis.fetch;
let fetchCalls = 0;

globalThis.document = { baseURI: "https://example.test/app/" };
globalThis.fetch = async (url, options) => {
  fetchCalls += 1;
  assert.equal(url, "https://example.test/app/assets/example-deadbeef.bin");
  assert.equal(options.cache, "force-cache");
  assert.equal(options.credentials, "same-origin");
  return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
};

try {
  const cache = await import("../src/asset-source-cache.ts");
  const [first, second] = await Promise.all([
    cache.loadCachedAssetSource("assets/example-deadbeef.bin"),
    cache.loadCachedAssetSource("assets/example-deadbeef.bin"),
  ]);
  assert.equal(fetchCalls, 1, "concurrent and repeated reads must share one source request");
  assert.equal(first, second, "immutable source bytes must remain shared in one session");
  assert.deepEqual([...new Uint8Array(first)], [1, 2, 3, 4]);
  assert.equal(cache.cachedAssetSourceCount(), 1);
} finally {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  globalThis.fetch = originalFetch;
}

console.log("Immutable asset source cache verified.");
