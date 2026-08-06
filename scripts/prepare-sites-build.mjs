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
const IPHONE_MEMORY_LIMIT_BUILD = "iphone-gpu-plus-compressed-cpu-peaks-v2";
const IPHONE_MEMORY_LIMIT_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS iphone_memory_limit_runs (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL)";
const IPHONE_MEMORY_LIMIT_INDEX_SQL = "CREATE INDEX IF NOT EXISTS iphone_memory_limit_runs_updated_at_idx ON iphone_memory_limit_runs (updated_at DESC)";
const IPHONE_MEMORY_LIMIT_STATUSES = new Set(["running", "completed", "interrupted", "error"]);
const LAYER_COMPRESSION_BUILD = "lossless-gzip-256-tile-1mib-streamed-measurement-v1";
const LAYER_COMPRESSION_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS layer_compression_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, payload_json TEXT NOT NULL)";
const LAYER_COMPRESSION_INDEX_SQL = "CREATE INDEX IF NOT EXISTS layer_compression_runs_created_at_idx ON layer_compression_runs (created_at DESC)";
const VECTOR_ZOOM_C_STRATEGY = "ten-semantic-text-dual-gpu-fallback-auto-post-raster-window2-zoom8-to-0.3-v6";
const VECTOR_ZOOM_RUNS_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS vector_zoom_runs (run_code TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL, payload_json TEXT NOT NULL)";
const VECTOR_ZOOM_RUN_CODE = /^[2-9A-HJ-NP-Z]{8}$/;
const VECTOR_ZOOM_CHECK_NAMES = [
  "exactlyTenDistributedTexts",
  "fixedFastZoomOutCompleted",
  "fallbackPreparedBeforeGesture",
  "fallbackPixelsPresent",
  "rasterLifecycleRebuiltFallback",
  "finalFastFrameAcknowledged",
  "fastCompositePixelsPresent",
  "witnessesExerciseReveal",
  "everyZoomStepCovered",
  "noClippedOrExactWorkDuringGesture",
  "fastPresentationFlowed",
  "framePacingWithinBudget",
  "recoveryWithinBudget",
  "exactRecoveryLatestOnly",
  "finalModePrecise",
  "effectsStayedSettled",
  "environmentStayedStable",
];
const VECTOR_ZOOM_PROFILE_ORDER = [
  "arch", "drop-shadow", "block-shadow", "inner-shadow", "arch",
  "drop-shadow", "block-shadow", "inner-shadow", "arch", "drop-shadow",
];

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

async function ensureVectorZoomRunsSchema(db) {
  await db.prepare(VECTOR_ZOOM_RUNS_SCHEMA_SQL).run();
}

function finiteNumberArray(value, maximumLength = 360) {
  return Array.isArray(value)
    && value.length <= maximumLength
    && value.every((entry) => Number.isFinite(entry));
}

function finiteNumberInRange(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function integerInRange(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function finiteNonNegativeNumberArray(value, maximumLength = 360) {
  return finiteNumberArray(value, maximumLength)
    && value.every((entry) => entry >= 0 && entry <= 60_000);
}

async function readLimitedJson(request, maximumBytes) {
  if (!request.body) return { error: "invalid" };
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      return { error: "too-large" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { error: "invalid" };
  }
}

function normalizeHumanStrokeBenchmark(payload) {
  if (!payload || typeof payload !== "object" || !payload.settings || typeof payload.settings !== "object") {
    return payload;
  }

  if (
    payload.presetRevision === HUMAN_STROKE_PRESET_REVISION &&
    payload.settings.blendIntensity === 1 &&
    payload.settings.stabilization === 0 &&
    !Object.hasOwn(payload.settings, "speedThickness") &&
    !Object.hasOwn(payload.settings, "pressureSize") &&
    !Object.hasOwn(payload.settings, "pressureOpacity")
  ) {
    return payload;
  }

  const settings = {
    ...payload.settings,
    blendIntensity: 1,
    stabilization: 0,
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
      || !payload.variant
      || typeof payload.variant.layerColdCompressionEnabled !== "boolean"
      || !(
        payload.variant.layerColdCompressionRuntimeBuild === null
        || typeof payload.variant.layerColdCompressionRuntimeBuild === "string"
      )
      || typeof payload.variant.layerColdDirectHotHydrationEnabled !== "boolean"
      || typeof payload.variant.layerColdAdjacentPrefetchEnabled !== "boolean"
      || !Array.isArray(payload.events)
      || payload.events.length > 64
      || !Number.isFinite(payload.lastSafeMiB)
      || !Number.isFinite(payload.highestObservedPeakMiB)
      || !Number.isFinite(payload.lastSafeCountedGpuPlusCompressedCpuMiB)
      || !Number.isFinite(payload.highestObservedCountedGpuPlusCompressedCpuPeakMiB)
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

async function handleVectorZoomRuns(request, env) {
  if (!env.DB) {
    return jsonResponse({ error: "Archivio test zoom vettoriale non disponibile." }, 503);
  }
  await ensureVectorZoomRunsSchema(env.DB);

  if (request.method === "POST") {
    const requestOrigin = request.headers.get("Origin");
    if (requestOrigin !== new URL(request.url).origin) {
      return jsonResponse({ error: "Origine non consentita." }, 403);
    }
    if (!(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")) {
      return jsonResponse({ error: "Content-Type JSON richiesto." }, 415);
    }
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (contentLength > 65_536) {
      return jsonResponse({ error: "Il report zoom è troppo grande." }, 413);
    }
    const decoded = await readLimitedJson(request, 65_536);
    if (decoded.error === "too-large") {
      return jsonResponse({ error: "Il report zoom è troppo grande." }, 413);
    }
    if (decoded.error) {
      return jsonResponse({ error: "JSON del report zoom non valido." }, 400);
    }
    const payload = decoded.value;
    const report = payload?.report;
    const checks = report && typeof report.checks === "object" && report.checks
      ? report.checks
      : null;
    const timingFields = report ? [
      report.idleFrameMedianMs,
      report.gestureDurationMs,
      report.frameP50Ms,
      report.frameP95Ms,
      report.frameMaximumMs,
      report.eventToNextFrameP95Ms,
      report.queuePrefixAndCallbackWaitMs,
      report.finalFastAckDurationMs,
      report.fastCompositeProbeDurationMs,
      report.fastVerificationDurationMs,
      report.recoveryDurationMs,
      report.totalMeasuredDurationMs,
    ] : [];
    const counterFields = report ? [
      report.framesOver20Ms,
      report.framesOver33Ms,
      report.normalizedMissedFrameCount,
      report.exactRenderDeltaDuringGesture,
      report.exactRenderDeltaDuringRecovery,
      report.safeReprojectionDelta,
      report.fallbackReprojectionDelta,
      report.clippedReprojectionDelta,
      report.unsafeExactRefreshStartedDelta,
      report.unsafeExactRefreshCompletedDelta,
      report.fastPresentationSubmitDelta,
      report.fastPresentationCoalescedDelta,
      report.requiredFastPresentationSubmitCount,
      report.fastPresentationMaximumInFlight,
      report.fastPresentationInFlightAtTraceEnd,
      report.rasterLayerCountAfterFallbackRebuild,
      report.automaticFallbackRebuildDelta,
      report.latestViewRevision,
      report.finalFastRequestedRevision,
      report.finalFastSubmittedRevision,
      report.finalFastCompletedRevision,
    ] : [];
    const greenReportIsConsistent = !report?.passed || (
      report.initialRasterWasEmpty === true
      && report.textCount === 10
      && Math.abs(report.startZoom - 8) <= 1e-4
      && Math.abs(report.finalZoom - 0.3) <= 1e-4
      && Math.abs(report.fallbackCaptureZoom - 0.2) <= 1e-4
      && report.fallbackTextureCount === 1
      && report.fallbackRunCount === 1
      && report.fallbackGpuMemoryMiB > 0
      && report.fallbackGpuMemoryMiB <= 16
      && Array.isArray(report.fallbackProbeAlphaPixelCounts)
      && report.fallbackProbeAlphaPixelCounts.length === 10
      && report.fallbackProbeAlphaPixelCounts.every((count) => count > 0)
      && report.rasterLayerCountAfterFallbackRebuild === 2
      && report.selectedRasterAfterFallbackRebuild === true
      && report.automaticFallbackRebuildDelta >= 1
      && Array.isArray(report.fastCompositeProbeAlphaPixelCounts)
      && report.fastCompositeProbeAlphaPixelCounts.length === 10
      && report.fastCompositeProbeAlphaPixelCounts.every((count) => count > 0)
      && report.witnessesOutsideStartCount >= 8
      && report.witnessesInsideTargetCount === 10
      && Array.isArray(report.presentationModes)
      && report.presentationModes.every((mode) => (
        mode === "reproject" || mode === "reproject-fallback"
      ))
      && report.exactRenderDeltaDuringGesture === 0
      && report.clippedReprojectionDelta === 0
      && report.unsafeExactRefreshStartedDelta === 0
      && report.unsafeExactRefreshCompletedDelta === 0
      && report.fallbackReprojectionDelta > 0
      && report.fastPresentationSubmitDelta >= report.requiredFastPresentationSubmitCount
      && report.fastPresentationCoalescedDelta <= Math.ceil(report.sampleCount * 0.1)
      && report.fastPresentationMaximumInFlight >= 1
      && report.fastPresentationMaximumInFlight <= 2
      && report.fastPresentationInFlightAtTraceEnd <= 2
      && report.fastSubmittedRevisionLagMaximum <= 2
      && report.fastCompletedRevisionLagP95 <= 2
      && report.fastCompletedRevisionLagMaximum <= 2
      && report.finalFastSubmittedRevision === report.finalFastRequestedRevision
      && report.finalFastCompletedRevision === report.finalFastRequestedRevision
      && report.finalFastAckDurationMs <= 250
      && report.queuePrefixAndCallbackWaitMs <= 250
      && report.recoveryDurationMs <= 1200
      && report.exactRecoveryDelta === 1
      && Array.isArray(report.profileOrder)
      && report.profileOrder.every((profile, index) => (
        profile === VECTOR_ZOOM_PROFILE_ORDER[index]
      ))
    );
    if (
      !payload
      || payload.version !== 1
      || payload.kind !== "vector-zoom-c"
      || typeof payload.runCode !== "string"
      || !VECTOR_ZOOM_RUN_CODE.test(payload.runCode)
      || !report
      || report.version !== 1
      || report.strategy !== VECTOR_ZOOM_C_STRATEGY
      || report.variant !== "C"
      || report.runCode !== payload.runCode
      || typeof report.passed !== "boolean"
      || typeof report.initialRasterWasEmpty !== "boolean"
      || typeof report.traceFingerprint !== "string"
      || report.traceFingerprint.length > 512
      || !integerInRange(report.textCount, 0, 100)
      || report.idleFrameCount !== 30
      || !Number.isInteger(report.sampleCount)
      || report.sampleCount < 2
      || report.sampleCount > 120
      || report.gestureTargetDurationMs !== 650
      || !finiteNumberInRange(report.startZoom, 0.02, 64)
      || report.targetZoom !== 0.3
      || !finiteNumberInRange(report.finalZoom, 0.02, 64)
      || !finiteNumberInRange(report.fallbackCaptureZoom, 0, 64)
      || !integerInRange(report.fallbackTextureCount, 0, 64)
      || !integerInRange(report.fallbackRunCount, 0, 64)
      || !finiteNumberInRange(report.fallbackGpuMemoryMiB, 0, 1024)
      || !finiteNumberArray(report.fallbackProbeAlphaPixelCounts, 10)
      || !report.fallbackProbeAlphaPixelCounts.every((count) => (
        integerInRange(count, 0, 16_384)
      ))
      || !integerInRange(report.rasterLayerCountAfterFallbackRebuild, 0, 64)
      || typeof report.selectedRasterAfterFallbackRebuild !== "boolean"
      || !integerInRange(report.automaticFallbackRebuildDelta, 0, 1_000_000)
      || !finiteNumberArray(report.fastCompositeProbeAlphaPixelCounts, 10)
      || !report.fastCompositeProbeAlphaPixelCounts.every((count) => (
        integerInRange(count, 0, 16_384)
      ))
      || !integerInRange(report.witnessesOutsideStartCount, 0, 10)
      || !integerInRange(report.witnessesInsideTargetCount, 0, 10)
      || !finiteNonNegativeNumberArray(report.idleFrameIntervalsMs)
      || !finiteNonNegativeNumberArray(report.gestureFrameIntervalsMs, 120)
      || !finiteNonNegativeNumberArray(report.eventToNextFrameMs, 120)
      || !finiteNonNegativeNumberArray(report.fastSubmittedRevisionLagSamples, 120)
      || !finiteNonNegativeNumberArray(report.fastCompletedRevisionLagSamples, 120)
      || report.idleFrameIntervalsMs.length !== report.idleFrameCount
      || report.gestureFrameIntervalsMs.length !== report.sampleCount
      || report.eventToNextFrameMs.length !== report.sampleCount
      || report.fastSubmittedRevisionLagSamples.length !== report.sampleCount
      || report.fastCompletedRevisionLagSamples.length !== report.sampleCount
      || !Array.isArray(report.presentationModes)
      || report.presentationModes.length !== report.sampleCount
      || !report.presentationModes.every((mode) => (
        mode === "precise"
        || mode === "reproject"
        || mode === "reproject-fallback"
        || mode === "reproject-clipped"
      ))
      || timingFields.length !== 12
      || !timingFields.every((value) => finiteNumberInRange(value, 0, 60_000))
      || !counterFields.every((value) => integerInRange(value, -1_000_000, 1_000_000_000))
      || !finiteNumberInRange(report.fastSubmittedRevisionLagMaximum, 0, 1_000_000)
      || !finiteNumberInRange(report.fastCompletedRevisionLagP95, 0, 1_000_000)
      || !finiteNumberInRange(report.fastCompletedRevisionLagMaximum, 0, 1_000_000)
      || !finiteNumberInRange(report.fastPresentationRateHz, 0, 10_000)
      || !integerInRange(report.fastPresentationMaximumInFlight, 0, 1_000_000)
      || !integerInRange(report.fastPresentationInFlightAtTraceEnd, 0, 1_000_000)
      || (report.fastVerificationError !== null && (
        typeof report.fastVerificationError !== "string"
        || report.fastVerificationError.length > 1024
      ))
      || !report.environment
      || typeof report.environment.userAgent !== "string"
      || report.environment.userAgent.length > 1024
      || typeof report.environment.gpuLabel !== "string"
      || report.environment.gpuLabel.length > 512
      || typeof report.environment.visibilityAtStart !== "string"
      || typeof report.environment.visibilityAtEnd !== "string"
      || !finiteNumberInRange(report.environment.devicePixelRatioAtStart, 0.1, 20)
      || !finiteNumberInRange(report.environment.devicePixelRatioAtEnd, 0.1, 20)
      || !integerInRange(report.environment.viewportWidthAtStart, 1, 32_768)
      || !integerInRange(report.environment.viewportHeightAtStart, 1, 32_768)
      || !integerInRange(report.environment.viewportWidthAtEnd, 1, 32_768)
      || !integerInRange(report.environment.viewportHeightAtEnd, 1, 32_768)
      || !integerInRange(report.environment.canvasWidthAtStart, 1, 32_768)
      || !integerInRange(report.environment.canvasHeightAtStart, 1, 32_768)
      || !integerInRange(report.environment.canvasWidthAtEnd, 1, 32_768)
      || !integerInRange(report.environment.canvasHeightAtEnd, 1, 32_768)
      || !Array.isArray(report.profileOrder)
      || report.profileOrder.length !== 10
      || !report.profileOrder.every((profile) => (
        typeof profile === "string" && profile.length <= 64
      ))
      || !integerInRange(report.exactRecoveryDelta, -1_000_000, 1_000_000_000)
      || !checks
      || Object.keys(checks).length !== VECTOR_ZOOM_CHECK_NAMES.length
      || !VECTOR_ZOOM_CHECK_NAMES.every((name) => typeof checks[name] === "boolean")
      || report.passed !== VECTOR_ZOOM_CHECK_NAMES.every((name) => checks[name])
      || !greenReportIsConsistent
    ) {
      return jsonResponse({ error: "Il report zoom vettoriale non è valido." }, 400);
    }
    const payloadJson = JSON.stringify(report);
    if (new TextEncoder().encode(payloadJson).byteLength > 65_536) {
      return jsonResponse({ error: "Il report zoom è troppo grande." }, 413);
    }
    const createdAt = new Date().toISOString();
    await env.DB
      .prepare("INSERT INTO vector_zoom_runs (run_code, created_at, payload_json) VALUES (?1, ?2, ?3) ON CONFLICT(run_code) DO UPDATE SET created_at = excluded.created_at, payload_json = excluded.payload_json")
      .bind(payload.runCode, createdAt, payloadJson)
      .run();
    return jsonResponse({ runCode: payload.runCode, createdAt }, 201);
  }

  if (request.method === "GET") {
    const runCode = new URL(request.url).searchParams.get("code")?.toUpperCase() ?? "";
    if (!VECTOR_ZOOM_RUN_CODE.test(runCode)) {
      return jsonResponse({ error: "Codice del test zoom non valido." }, 400);
    }
    const record = await env.DB
      .prepare("SELECT created_at, payload_json FROM vector_zoom_runs WHERE run_code = ?1")
      .bind(runCode)
      .first();
    if (!record) {
      return jsonResponse({ error: "Report zoom non trovato." }, 404);
    }
    return jsonResponse({
      version: 1,
      runCode,
      createdAt: record.created_at,
      report: JSON.parse(record.payload_json),
    });
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
    if (url.pathname === "/api/vector-zoom-runs") {
      return handleVectorZoomRuns(request, env);
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
