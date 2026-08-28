import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const html = read("gpu-startup-diagnostics.html");
const moduleSource = read("src/labs/gpu-startup-diagnostics.ts");
const workerBuilder = read("scripts/prepare-sites-build.mjs");
const migration = read(".openai/drizzle/0006_gpu_startup_diagnostic_runs.sql");
const vite = read("vite.config.ts");
const attach = read("scripts/attach-human-replay-site-build.mjs");
const indexHtml = read("index.html");
const startup = read("src/startup.ts");

const inlineBootstrapIndex = html.indexOf("inline-bootstrap-started");
const moduleScriptIndex = html.indexOf('type="module" src="/src/labs/gpu-startup-diagnostics.ts"');
assert.ok(inlineBootstrapIndex >= 0, "Missing early inline diagnostic bootstrap.");
assert.ok(moduleScriptIndex > inlineBootstrapIndex, "The diagnostic bootstrap must run before its module asset.");
assert.match(html, /window\.history\.replaceState\(null, "", window\.location\.pathname \+ window\.location\.search\)/);
assert.match(html, /window\.addEventListener\("error"/);
assert.match(html, /window\.addEventListener\("unhandledrejection"/);
assert.match(html, /window\.addEventListener\("pagehide"/);
assert.match(html, /navigator\.sendBeacon/);
assert.match(html, /keepalive: true/);
assert.match(html, /startup-heartbeat/);
assert.doesNotMatch(html, /localStorage|sessionStorage|clipboard\./);

assert.match(moduleSource, /requestAdapter\(adapterOptions\)/);
assert.match(moduleSource, /featureLevel: "compatibility"/);
assert.match(moduleSource, /format: "rgba16float"/);
assert.match(moduleSource, /GPUTextureUsage\.STORAGE_BINDING/);
assert.match(moduleSource, /vertex-stage-storage-buffer-layout/);
assert.match(moduleSource, /compute-workgroup-256-pipeline/);
assert.match(moduleSource, /import\("\.\.\/brush-engine"\)/);
assert.match(moduleSource, /engine\.initialize\(\)/);
assert.match(moduleSource, /engine-initialize-completed/);

assert.match(workerBuilder, /GPU_STARTUP_DIAGNOSTIC_HTML/);
assert.match(workerBuilder, /GPU_STARTUP_DIAGNOSTIC_PAGE_PATH = "\/gpu-startup-lab"/);
assert.match(workerBuilder, /readLimitedJson\(request, 64 \* 1024\)/);
assert.match(workerBuilder, /sha256Hex\(payload\.writeToken\)/);
assert.match(workerBuilder, /write_token_hash/);
assert.match(workerBuilder, /DELETE FROM gpu_startup_diagnostic_runs WHERE expires_at < \?1/);
assert.match(workerBuilder, /url\.pathname === "\/api\/gpu-startup-diagnostics"/);
assert.match(workerBuilder, /"Cache-Control": "private, no-store, max-age=0"/);
assert.match(workerBuilder, /"Cloudflare-CDN-Cache-Control": "no-store"/);
assert.doesNotMatch(workerBuilder, /SELECT \* FROM gpu_startup_diagnostic_runs/);

assert.match(migration, /run_code TEXT PRIMARY KEY NOT NULL/);
assert.match(migration, /write_token_hash TEXT NOT NULL/);
assert.match(migration, /expires_at TEXT NOT NULL/);
assert.match(migration, /gpu_startup_diagnostic_runs_expires_at_idx/);

assert.match(vite, /mode === "gpu-diagnostics"/);
assert.match(vite, /outDir: "dist-gpu-diagnostics"/);
assert.match(attach, /siteGpuDiagnosticsHtmlFile/);
assert.doesNotMatch(indexHtml, /gpu-startup-diagnostics/);
assert.doesNotMatch(startup, /gpu-startup-diagnostics/);

const builtWorkerPath = resolve(root, "dist/server/index.js");
if (existsSync(builtWorkerPath)) {
  class FakeStatement {
    constructor(database, sql) {
      this.database = database;
      this.sql = sql;
      this.values = [];
    }

    bind(...values) {
      this.values = values;
      return this;
    }

    async run() {
      if (this.sql.startsWith("INSERT OR IGNORE INTO gpu_startup_diagnostic_runs")) {
        const [runCode, createdAt, expiresAt, payloadJson] = this.values;
        if (!this.database.rows.has(runCode)) {
          this.database.rows.set(runCode, {
            run_code: runCode,
            write_token_hash: "",
            created_at: createdAt,
            updated_at: createdAt,
            expires_at: expiresAt,
            status: "html-requested",
            sequence: 0,
            payload_json: payloadJson,
          });
        }
      } else if (this.sql.startsWith("INSERT INTO gpu_startup_diagnostic_runs")) {
        const [runCode, tokenHash, createdAt, updatedAt, expiresAt, status, sequence, payloadJson] = this.values;
        const existing = this.database.rows.get(runCode);
        if (!existing || sequence >= existing.sequence) {
          this.database.rows.set(runCode, {
            run_code: runCode,
            write_token_hash: existing?.write_token_hash || tokenHash,
            created_at: existing?.created_at || createdAt,
            updated_at: updatedAt,
            expires_at: expiresAt,
            status,
            sequence,
            payload_json: payloadJson,
          });
        }
      }
      return { meta: { changes: 1 } };
    }

    async first() {
      if (this.sql.startsWith("SELECT write_token_hash")) {
        return this.database.rows.get(this.values[0]) ?? null;
      }
      return null;
    }
  }

  class FakeDatabase {
    rows = new Map();

    prepare(sql) {
      return new FakeStatement(this, sql);
    }

    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  }

  const workerUrl = pathToFileURL(builtWorkerPath);
  workerUrl.searchParams.set("gpu-diagnostic-verification", String(Date.now()));
  const { default: worker } = await import(workerUrl.href);
  const database = new FakeDatabase();
  const environment = {
    DB: database,
    ASSETS: {
      fetch: async () => new Response("<!doctype html><title>diagnostic</title>", {
        headers: { "Content-Type": "text/html" },
      }),
    },
  };
  const runCode = `diag-${"a".repeat(32)}`;
  const writeToken = "b".repeat(64);
  const pageResponse = await worker.fetch(
    new Request(`https://example.test/gpu-startup-lab?run=${runCode}`, {
      headers: { "User-Agent": "Diagnostic Test Browser" },
    }),
    environment,
  );
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get("Cache-Control") ?? "", /\bno-store\b/);
  assert.equal(pageResponse.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(database.rows.get(runCode)?.status, "html-requested");

  const clientNow = new Date().toISOString();
  const sequence = Date.now() * 1000 + 1;
  const payload = {
    version: 1,
    build: "gpu-startup-rgba16f-probe-v1",
    runCode,
    writeToken,
    sequence,
    createdAt: clientNow,
    updatedAt: clientNow,
    status: "running",
    privacy: "Technical data only.",
    environment: { secureContext: true },
    events: [{ sequence, at: clientNow, name: "inline-bootstrap-started", detail: null }],
    summary: { latestEvent: "inline-bootstrap-started", moduleLoaded: false, completed: false },
  };
  const upload = (body) => worker.fetch(new Request("https://example.test/api/gpu-startup-diagnostics", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "Origin": "https://example.test",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  }), environment);

  const uploadResponse = await upload(payload);
  assert.equal(uploadResponse.status, 201);
  const stored = database.rows.get(runCode);
  assert.equal(stored.status, "running");
  assert.notEqual(stored.write_token_hash, writeToken);
  assert.ok(stored.write_token_hash.length === 64);
  assert.doesNotMatch(stored.payload_json, new RegExp(writeToken));

  const staleResponse = await upload({
    ...payload,
    sequence: sequence - 1,
    events: [{ ...payload.events[0], sequence: sequence - 1 }],
  });
  assert.equal(staleResponse.status, 202);

  const invalidTokenResponse = await upload({ ...payload, writeToken: "c".repeat(64) });
  assert.equal(invalidTokenResponse.status, 403);

  const readResponse = await worker.fetch(
    new Request("https://example.test/api/gpu-startup-diagnostics"),
    environment,
  );
  assert.equal(readResponse.status, 405, "The diagnostic API must not expose a public read route.");
}

console.log("GPU startup diagnostic laboratory verified.");
