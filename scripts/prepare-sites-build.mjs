import { mkdir, readdir, rename, writeFile } from "node:fs/promises";

const distDirectory = new URL("../dist/", import.meta.url);
const clientDirectory = new URL("client/", distDirectory);
const serverDirectory = new URL("server/", distDirectory);
const workerFile = new URL("index.js", serverDirectory);

await mkdir(clientDirectory, { recursive: true });

for (const entry of await readdir(distDirectory, { withFileTypes: true })) {
  if (entry.name === "client" || entry.name === "server") {
    continue;
  }

  await rename(
    new URL(entry.name, distDirectory),
    new URL(entry.name, clientDirectory),
  );
}

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
