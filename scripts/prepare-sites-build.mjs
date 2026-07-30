import { cp, copyFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";

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
await cp(
  new URL("../.openai/drizzle/", import.meta.url),
  new URL("drizzle/", hostingDirectory),
  { recursive: true, force: true },
);
const indexHtmlFile = new URL("index.html", clientDirectory);
const indexHtml = (await readFile(indexHtmlFile, "utf8")).replace(/\r\n?/g, "\n");
await writeFile(indexHtmlFile, indexHtml);
await writeFile(
  workerFile,
  `const INDEX_HTML = ${JSON.stringify(indexHtml)};
const HUMAN_STROKE_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS human_stroke_benchmark (id TEXT PRIMARY KEY NOT NULL CHECK (id = 'canonical'), payload_json TEXT NOT NULL, captured_at TEXT NOT NULL)";
const HUMAN_STROKE_ID = "canonical";
const HUMAN_STROKE_PRESET_REVISION = 4;
const BENCHMARK_RUNS_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS benchmark_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, payload_json TEXT NOT NULL)";
const BENCHMARK_RUNS_INDEX_SQL = "CREATE INDEX IF NOT EXISTS benchmark_runs_created_at_idx ON benchmark_runs (created_at DESC)";
const IPHONE_MEMORY_LIMIT_BUILD = "iphone-real-layer-cold-tiles-checkpoint-before-each-operation-v1";
const IPHONE_MEMORY_LIMIT_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS iphone_memory_limit_runs (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL)";
const IPHONE_MEMORY_LIMIT_INDEX_SQL = "CREATE INDEX IF NOT EXISTS iphone_memory_limit_runs_updated_at_idx ON iphone_memory_limit_runs (updated_at DESC)";
const IPHONE_MEMORY_LIMIT_STATUSES = new Set(["running", "completed", "interrupted", "error"]);
const LAYER_COMPRESSION_BUILD = "lossless-gzip-256-tile-1mib-streamed-measurement-v1";
const LAYER_COMPRESSION_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS layer_compression_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, payload_json TEXT NOT NULL)";
const LAYER_COMPRESSION_INDEX_SQL = "CREATE INDEX IF NOT EXISTS layer_compression_runs_created_at_idx ON layer_compression_runs (created_at DESC)";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function ensureHumanStrokeSchema(db) {
  await db.prepare(HUMAN_STROKE_SCHEMA_SQL).run();
}

async function ensureBenchmarkRunsSchema(db) {
  await db.batch([
    db.prepare(BENCHMARK_RUNS_SCHEMA_SQL),
    db.prepare(BENCHMARK_RUNS_INDEX_SQL),
  ]);
}

async function ensureIphoneMemoryLimitSchema(db) {
  await db.batch([
    db.prepare(IPHONE_MEMORY_LIMIT_SCHEMA_SQL),
    db.prepare(IPHONE_MEMORY_LIMIT_INDEX_SQL),
  ]);
}

async function ensureLayerCompressionSchema(db) {
  await db.batch([
    db.prepare(LAYER_COMPRESSION_SCHEMA_SQL),
    db.prepare(LAYER_COMPRESSION_INDEX_SQL),
  ]);
}

function normalizeHumanStrokeBenchmark(payload) {
  if (!payload || typeof payload !== "object" || !payload.settings || typeof payload.settings !== "object") {
    return payload;
  }

  if (
    payload.presetRevision === HUMAN_STROKE_PRESET_REVISION &&
    payload.settings.blendIntensity === 1 &&
    !Object.hasOwn(payload.settings, "speedThickness") &&
    !Object.hasOwn(payload.settings, "pressureSize") &&
    !Object.hasOwn(payload.settings, "pressureOpacity")
  ) {
    return payload;
  }

  const settings = {
    ...payload.settings,
    blendIntensity: 1,
  };
  delete settings.speedThickness;
  delete settings.pressureSize;
  delete settings.pressureOpacity;

  return {
    ...payload,
    presetRevision: HUMAN_STROKE_PRESET_REVISION,
    settings,
  };
}

async function handleHumanStroke(request, env) {
  if (!env.DB) {
    return jsonResponse({ error: "Benchmark storage non disponibile." }, 503);
  }

  await ensureHumanStrokeSchema(env.DB);

  if (request.method === "GET") {
    const record = await env.DB
      .prepare("SELECT payload_json FROM human_stroke_benchmark WHERE id = ?1")
      .bind(HUMAN_STROKE_ID)
      .first();
    if (!record) {
      return jsonResponse({ error: "Nessun tratto registrato." }, 404);
    }
    const canonical = normalizeHumanStrokeBenchmark(JSON.parse(record.payload_json));
    const canonicalJson = JSON.stringify(canonical);
    if (canonicalJson !== record.payload_json) {
      await env.DB
        .prepare("UPDATE human_stroke_benchmark SET payload_json = ?1 WHERE id = ?2")
        .bind(canonicalJson, HUMAN_STROKE_ID)
        .run();
    }
    return new Response(canonicalJson, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (request.method === "POST") {
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (contentLength > 900_000) {
      return jsonResponse({ error: "Il tratto registrato è troppo grande." }, 413);
    }

    const payload = await request.json();
    if (
      !payload ||
      payload.version !== 1 ||
      !payload.settings ||
      !Array.isArray(payload.points) ||
      payload.points.length < 2 ||
      payload.points.length > 20000
    ) {
      return jsonResponse({ error: "Il tratto registrato non è valido." }, 400);
    }

    const canonical = normalizeHumanStrokeBenchmark(payload);
    const payloadJson = JSON.stringify(canonical);
    if (payloadJson.length > 900_000) {
      return jsonResponse({ error: "Il tratto registrato è troppo grande." }, 413);
    }

    const insert = await env.DB
      .prepare("INSERT OR IGNORE INTO human_stroke_benchmark (id, payload_json, captured_at) VALUES (?1, ?2, ?3)")
      .bind(HUMAN_STROKE_ID, payloadJson, String(payload.capturedAt ?? new Date().toISOString()))
      .run();

    if ((insert.meta?.changes ?? 0) === 0) {
      const existing = await env.DB
        .prepare("SELECT payload_json FROM human_stroke_benchmark WHERE id = ?1")
        .bind(HUMAN_STROKE_ID)
        .first();
      return new Response(existing?.payload_json ?? "{}", {
        status: 409,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    return jsonResponse(canonical, 201);
  }

  return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
}

async function handleBenchmarkRuns(request, env) {
  if (!env.DB) {
    return jsonResponse({ error: "Benchmark storage non disponibile." }, 503);
  }

  await ensureBenchmarkRunsSchema(env.DB);

  if (request.method === "POST") {
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (contentLength > 100_000) {
      return jsonResponse({ error: "Il risultato del benchmark è troppo grande." }, 413);
    }

    const payload = await request.json();
    if (
      !payload ||
      payload.version !== 1 ||
      !payload.benchmark ||
      !payload.playback ||
      !payload.performance ||
      !payload.environment
    ) {
      return jsonResponse({ error: "Il risultato del benchmark non è valido." }, 400);
    }

    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > 100_000) {
      return jsonResponse({ error: "Il risultato del benchmark è troppo grande." }, 413);
    }

    const createdAt = new Date().toISOString();
    const insert = await env.DB
      .prepare("INSERT INTO benchmark_runs (created_at, payload_json) VALUES (?1, ?2)")
      .bind(createdAt, payloadJson)
      .run();
    return jsonResponse({ id: Number(insert.meta?.last_row_id ?? 0), createdAt }, 201);
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") ?? "1000");
    const limit = Math.min(1000, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 1000));
    const result = await env.DB
      .prepare("SELECT id, created_at, payload_json FROM benchmark_runs ORDER BY id ASC LIMIT ?1")
      .bind(limit)
      .all();
    const runs = (result.results ?? []).map((record) => ({
      id: Number(record.id),
      createdAt: record.created_at,
      ...JSON.parse(record.payload_json),
    }));
    return jsonResponse({ version: 1, exportedAt: new Date().toISOString(), runs });
  }

  return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
}

async function handleIphoneMemoryLimitRuns(request, env) {
  if (!env.DB) {
    return jsonResponse({ error: "Archivio limite iPhone non disponibile." }, 503);
  }

  await ensureIphoneMemoryLimitSchema(env.DB);

  if (request.method === "POST") {
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (contentLength > 100_000) {
      return jsonResponse({ error: "Il checkpoint del limite iPhone è troppo grande." }, 413);
    }

    const payload = await request.json();
    if (
      !payload
      || payload.version !== 1
      || payload.build !== IPHONE_MEMORY_LIMIT_BUILD
      || typeof payload.runId !== "string"
      || !/^iphone-[a-z0-9-]{12,80}$/i.test(payload.runId)
      || typeof payload.createdAt !== "string"
      || typeof payload.updatedAt !== "string"
      || !IPHONE_MEMORY_LIMIT_STATUSES.has(payload.status)
      || !payload.plan
      || !payload.environment
      || !Array.isArray(payload.events)
      || payload.events.length > 64
      || !Number.isFinite(payload.lastSafeMiB)
      || !Number.isFinite(payload.highestObservedPeakMiB)
      || !payload.latestMemory
    ) {
      return jsonResponse({ error: "Il checkpoint del limite iPhone non è valido." }, 400);
    }

    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > 100_000) {
      return jsonResponse({ error: "Il checkpoint del limite iPhone è troppo grande." }, 413);
    }

    await env.DB
      .prepare("INSERT INTO iphone_memory_limit_runs (id, created_at, updated_at, status, payload_json) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, status = excluded.status, payload_json = excluded.payload_json")
      .bind(payload.runId, payload.createdAt, payload.updatedAt, payload.status, payloadJson)
      .run();
    return jsonResponse({
      runId: payload.runId,
      status: payload.status,
      updatedAt: payload.updatedAt,
    }, 201);
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    const runId = url.searchParams.get("id");
    if (runId) {
      if (!/^iphone-[a-z0-9-]{12,80}$/i.test(runId)) {
        return jsonResponse({ error: "Identificativo run non valido." }, 400);
      }
      const record = await env.DB
        .prepare("SELECT payload_json FROM iphone_memory_limit_runs WHERE id = ?1")
        .bind(runId)
        .first();
      if (!record) {
        return jsonResponse({ error: "Run limite iPhone non trovata." }, 404);
      }
      return jsonResponse({ run: JSON.parse(record.payload_json) });
    }

    const requestedLimit = Number(url.searchParams.get("limit") ?? "20");
    const limit = Math.min(
      100,
      Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 20),
    );
    const result = await env.DB
      .prepare("SELECT payload_json FROM iphone_memory_limit_runs ORDER BY updated_at DESC LIMIT ?1")
      .bind(limit)
      .all();
    const runs = (result.results ?? []).map((record) => JSON.parse(record.payload_json));
    return jsonResponse({
      version: 1,
      exportedAt: new Date().toISOString(),
      runs,
    });
  }

  return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
}

async function handleLayerCompressionRuns(request, env) {
  if (!env.DB) {
    return jsonResponse({ error: "Archivio compressione livelli non disponibile." }, 503);
  }

  await ensureLayerCompressionSchema(env.DB);

  if (request.method === "POST") {
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (contentLength > 100_000) {
      return jsonResponse({ error: "Il report compressione è troppo grande." }, 413);
    }
    const payload = await request.json();
    if (
      !payload
      || payload.version !== 1
      || payload.build !== LAYER_COMPRESSION_BUILD
      || payload.passed !== true
      || payload.measurementOnly !== true
      || payload.byteIdentical !== true
      || payload.codec !== "compression-stream-gzip"
      || !Number.isFinite(payload.rawMiB)
      || !Number.isFinite(payload.adaptiveStoredMiB)
      || !Number.isFinite(payload.encodeMs)
      || !Number.isFinite(payload.decodeMs)
      || !payload.environment
      || !Array.isArray(payload.layers)
      || payload.layers.length < 1
      || payload.layers.length > 16
    ) {
      return jsonResponse({ error: "Il report compressione non è valido." }, 400);
    }
    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > 100_000) {
      return jsonResponse({ error: "Il report compressione è troppo grande." }, 413);
    }
    const createdAt = new Date().toISOString();
    const insert = await env.DB
      .prepare("INSERT INTO layer_compression_runs (created_at, payload_json) VALUES (?1, ?2)")
      .bind(createdAt, payloadJson)
      .run();
    return jsonResponse({
      id: Number(insert.meta?.last_row_id ?? 0),
      createdAt,
    }, 201);
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") ?? "20");
    const limit = Math.min(
      100,
      Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 20),
    );
    const result = await env.DB
      .prepare("SELECT id, created_at, payload_json FROM layer_compression_runs ORDER BY id DESC LIMIT ?1")
      .bind(limit)
      .all();
    const runs = (result.results ?? []).map((record) => ({
      id: Number(record.id),
      createdAt: record.created_at,
      ...JSON.parse(record.payload_json),
    }));
    return jsonResponse({ version: 1, exportedAt: new Date().toISOString(), runs });
  }

  return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/human-stroke") {
      return handleHumanStroke(request, env);
    }

    if (url.pathname === "/api/benchmark-runs") {
      return handleBenchmarkRuns(request, env);
    }

    if (url.pathname === "/api/layer-compression-runs") {
      return handleLayerCompressionRuns(request, env);
    }
    if (url.pathname === "/api/iphone-memory-limit-runs") {
      return handleIphoneMemoryLimitRuns(request, env);
    }

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
