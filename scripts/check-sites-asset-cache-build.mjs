import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

const workerUrl = pathToFileURL(path.resolve("dist/server/index.js"));
workerUrl.searchParams.set("verification", String(Date.now()));
const { default: worker } = await import(workerUrl.href);
const upstreamCacheControl = "public, max-age=0, must-revalidate";
const env = {
  ASSETS: {
    fetch: async () => new Response("asset", {
      status: 200,
      headers: { "Cache-Control": upstreamCacheControl },
    }),
  },
};

const immutable = await worker.fetch(
  new Request("https://example.test/assets/main-deadbeef.js"),
  env,
);
assert.equal(
  immutable.headers.get("Cache-Control"),
  "public, max-age=31536000, immutable",
);

const unversioned = await worker.fetch(
  new Request("https://example.test/assets/main.js"),
  env,
);
assert.equal(unversioned.headers.get("Cache-Control"), upstreamCacheControl);

const html = await worker.fetch(new Request("https://example.test/"), env);
assert.equal(html.headers.get("Cache-Control"), upstreamCacheControl);

console.log("Sites immutable asset cache build verified.");
