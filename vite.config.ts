import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

// In produzione /api/human-stroke è servito dal worker Sites (D1). In dev il
// fixture canonico vive in .tmp-canonical-human-stroke.json: senza questo
// middleware la suite rendering one-tap resta disabilitata in locale.
function devHumanStrokeApi(): Plugin {
  const fixturePath = resolve(__dirname, ".tmp-canonical-human-stroke.json");
  const timelinePath = resolve(__dirname, ".tmp-human-stroke-timeline.json");
  return {
    name: "dev-human-stroke-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/stroke-timeline", (request, response, next) => {
        if (request.method === "GET") {
          readFile(timelinePath, "utf8").then(
            (payload) => {
              response.setHeader("Content-Type", "application/json");
              response.setHeader("Cache-Control", "no-store");
              response.end(payload);
            },
            () => {
              response.statusCode = 404;
              response.end();
            },
          );
          return;
        }
        if (request.method === "POST") {
          const chunks: Buffer[] = [];
          request.on("data", (chunk) => chunks.push(chunk));
          request.on("end", () => {
            writeFile(timelinePath, Buffer.concat(chunks).toString("utf8")).then(
              () => {
                response.statusCode = 204;
                response.end();
              },
              () => {
                response.statusCode = 500;
                response.end();
              },
            );
          });
          return;
        }
        next();
      });
      server.middlewares.use("/api/human-stroke", (request, response, next) => {
        if (request.method === "GET") {
          readFile(fixturePath, "utf8").then(
            (payload) => {
              response.setHeader("Content-Type", "application/json");
              response.end(payload);
            },
            () => {
              response.statusCode = 404;
              response.end();
            },
          );
          return;
        }
        if (request.method === "POST") {
          const chunks: Buffer[] = [];
          request.on("data", (chunk) => chunks.push(chunk));
          request.on("end", () => {
            writeFile(fixturePath, Buffer.concat(chunks).toString("utf8")).then(
              () => {
                response.statusCode = 204;
                response.end();
              },
              () => {
                response.statusCode = 500;
                response.end();
              },
            );
          });
          return;
        }
        next();
      });
    },
  };
}

function labsHtmlShell(): Plugin {
  return {
    name: "labs-html-shell",
    enforce: "pre",
    async transformIndexHtml(html, context) {
      if (!context.path.endsWith("/labs.html")) {
        return html;
      }
      const editorHtml = await readFile(resolve(__dirname, "index.html"), "utf8");
      return editorHtml
        .replace(
          '<script type="module" src="/src/startup.ts"></script>',
          '<script type="module" src="/src/labs/startup.ts"></script>',
        )
        .replace(
          "<title>WebGPU Brush Engine</title>",
          "<title>WebGPU Brush Engine Labs</title>",
        );
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [
    labsHtmlShell(),
    ...(mode === "labs" ? [devHumanStrokeApi()] : []),
  ],
  build: mode === "labs"
    ? {
        outDir: "dist-labs",
        emptyOutDir: true,
        rollupOptions: {
          input: resolve(__dirname, "labs.html"),
        },
      }
    : undefined,
}));
