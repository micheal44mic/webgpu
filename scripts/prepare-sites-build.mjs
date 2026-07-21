import { copyFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";

const distDirectory = new URL("../dist/", import.meta.url);
const clientDirectory = new URL("client/", distDirectory);
const serverDirectory = new URL("server/", distDirectory);
const hostingDirectory = new URL(".openai/", distDirectory);
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
await mkdir(hostingDirectory, { recursive: true });
await copyFile(
  new URL("../.openai/hosting.json", import.meta.url),
  new URL("hosting.json", hostingDirectory),
);
const indexHtml = await readFile(new URL("index.html", clientDirectory), "utf8");
await writeFile(
  workerFile,
  `const INDEX_HTML = ${JSON.stringify(indexHtml)};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      (url.pathname === "/" || url.pathname === "/index.html")
    ) {
      return new Response(request.method === "HEAD" ? null : INDEX_HTML, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=0, must-revalidate",
        },
      });
    }

    const response = await env.ASSETS.fetch(request);
    return response;
  },
};
`,
);
