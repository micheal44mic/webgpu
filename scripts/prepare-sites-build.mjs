import { mkdir, writeFile } from "node:fs/promises";

const serverDirectory = new URL("../dist/server/", import.meta.url);
const workerFile = new URL("index.js", serverDirectory);

await mkdir(serverDirectory, { recursive: true });
await writeFile(
  workerFile,
  `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    return response.status === 404
      ? env.ASSETS.fetch(new URL("/", request.url))
      : response;
  },
};
`,
);
