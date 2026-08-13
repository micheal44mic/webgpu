import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import {
  assembleEditorHtml,
  readEditorHtml,
} from "./scripts/ui-shell-source.mjs";

// In produzione /api/human-stroke è servito dal worker Sites (D1). In dev il
// La fixture canonica vive con gli asset autorevoli dei Labs: senza questo
// middleware la suite rendering one-tap resta disabilitata in locale.
function devHumanStrokeApi(): Plugin {
  const fixturePath = resolve(
    __dirname,
    "src/labs/fixtures/human-stroke/canonical-v1.json",
  );
  return {
    name: "dev-human-stroke-api",
    apply: "serve",
    configureServer(server) {
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

function editorHtmlShell(): Plugin {
  return {
    name: "editor-html-shell",
    enforce: "pre",
    async transformIndexHtml(html, context) {
      if (context.path.endsWith("/labs.html")) {
        return readEditorHtml()
          .replace(
            '<script type="module" src="/src/startup.ts"></script>',
            '<script type="module" src="/src/labs/startup.ts"></script>',
          )
          .replace(
            "<title>WebGPU Brush Engine</title>",
            "<title>WebGPU Brush Engine Labs</title>",
          );
      }
      return context.path.endsWith("/index.html") || context.path === "/"
        ? assembleEditorHtml(html)
        : html;
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [
    editorHtmlShell(),
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
