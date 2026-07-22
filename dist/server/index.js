const INDEX_HTML = "<!doctype html>\n<html lang=\"it\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, viewport-fit=cover\" />\n    <meta name=\"theme-color\" content=\"#111318\" />\n    <title>WebGPU Brush Engine 4096²</title>\n    <script type=\"module\" crossorigin src=\"./assets/index-BSGLKWkT.js\"></script>\n    <link rel=\"stylesheet\" crossorigin href=\"./assets/index-DVGmclji.css\">\n  </head>\n  <body>\n    <div id=\"app\">\n      <header class=\"topbar\">\n        <div>\n          <strong>WebGPU Brush Engine</strong>\n          <span class=\"muted\">4096 × 4096</span>\n        </div>\n        <div class=\"topbar-actions\">\n          <button id=\"zoomOut\" type=\"button\" title=\"Riduci zoom\">−</button>\n          <button id=\"fitView\" type=\"button\">Fit</button>\n          <button id=\"zoomIn\" type=\"button\" title=\"Aumenta zoom\">+</button>\n          <button id=\"clearLayer\" class=\"danger\" type=\"button\">Pulisci</button>\n        </div>\n      </header>\n\n      <aside class=\"controls\" aria-label=\"Impostazioni pennello\">\n        <section>\n          <h2>Pennello</h2>\n\n          <label class=\"control\">\n            <span>Forma</span>\n            <select id=\"brushShape\">\n              <option value=\"circle\">Cerchio</option>\n              <option value=\"shape\">Shape 2K</option>\n            </select>\n          </label>\n\n          <label class=\"control\">\n            <span>Scatter rotazione <output id=\"shapeScatterOut\">0%</output></span>\n            <input id=\"shapeScatter\" type=\"range\" min=\"0\" max=\"100\" step=\"1\" value=\"0\" />\n          </label>\n\n          <label class=\"control color-control\">\n            <span>Colore</span>\n            <input id=\"brushColor\" type=\"color\" value=\"#ff5b35\" />\n          </label>\n\n          <label class=\"control\">\n            <span>Dimensione <output id=\"brushSizeOut\">96 px</output></span>\n            <input id=\"brushSize\" type=\"range\" min=\"4\" max=\"1500\" step=\"1\" value=\"96\" />\n          </label>\n\n          <label class=\"control\">\n            <span>Spacing <output id=\"spacingOut\">1.00%</output></span>\n            <input id=\"spacing\" type=\"range\" min=\"0.25\" max=\"25\" step=\"0.25\" value=\"1\" />\n          </label>\n\n          <label class=\"control\">\n            <span>Count <output id=\"countOut\">24</output></span>\n            <input id=\"count\" type=\"range\" min=\"1\" max=\"24\" step=\"1\" value=\"24\" />\n          </label>\n\n          <label class=\"control\">\n            <span>Flow <output id=\"flowOut\">7%</output></span>\n            <input id=\"flow\" type=\"range\" min=\"0.1\" max=\"100\" step=\"0.1\" value=\"7\" />\n          </label>\n\n          <label class=\"control\">\n            <span>Hardness <output id=\"hardnessOut\">88%</output></span>\n            <input id=\"hardness\" type=\"range\" min=\"0\" max=\"100\" step=\"1\" value=\"88\" />\n          </label>\n\n          <label class=\"control\">\n            <span>Blend intensity <output id=\"blendIntensityOut\">1.00×</output></span>\n            <input id=\"blendIntensity\" type=\"range\" min=\"0.1\" max=\"4\" step=\"0.05\" value=\"1\" />\n          </label>\n\n          <label class=\"control\">\n            <span>Blend mode</span>\n            <select id=\"blendMode\">\n              <option value=\"normal\">Normal premultiplied</option>\n              <option value=\"additive\">Intense additive</option>\n            </select>\n          </label>\n        </section>\n\n        <section>\n          <h2>Color jitter</h2>\n\n          <label class=\"control\">\n            <span>Intensità globale <output id=\"jitterMasterOut\">100%</output></span>\n            <input id=\"jitterMaster\" type=\"range\" min=\"0\" max=\"100\" step=\"1\" value=\"100\" />\n          </label>\n\n          <label class=\"control\">\n            <span>Hue <output id=\"hueJitterOut\">12°</output></span>\n            <input id=\"hueJitter\" type=\"range\" min=\"0\" max=\"180\" step=\"1\" value=\"12\" />\n          </label>\n\n          <label class=\"control\">\n            <span>Saturation <output id=\"saturationJitterOut\">18%</output></span>\n            <input id=\"saturationJitter\" type=\"range\" min=\"0\" max=\"100\" step=\"1\" value=\"18\" />\n          </label>\n\n          <label class=\"control\">\n            <span>Lightness <output id=\"lightnessJitterOut\">12%</output></span>\n            <input id=\"lightnessJitter\" type=\"range\" min=\"0\" max=\"100\" step=\"1\" value=\"12\" />\n          </label>\n\n          <label class=\"control\">\n            <span>Darkness <output id=\"darknessJitterOut\">18%</output></span>\n            <input id=\"darknessJitter\" type=\"range\" min=\"0\" max=\"100\" step=\"1\" value=\"18\" />\n          </label>\n\n          <label class=\"check-control\">\n            <input id=\"jitterPerCopy\" type=\"checkbox\" />\n            <span>\n              Color jitter diverso per ciascuna copia\n              <small>Il jitter di posizione è sempre indipendente per ogni copia fisica.</small>\n            </span>\n          </label>\n        </section>\n\n        <section>\n          <h2>Jitter posizione</h2>\n\n          <label class=\"control\">\n            <span>Laterale <output id=\"positionJitterLateralOut\">100%</output></span>\n            <input id=\"positionJitterLateral\" type=\"range\" min=\"0\" max=\"100\" step=\"1\" value=\"100\" />\n          </label>\n\n          <label class=\"control\">\n            <span>Lineare <output id=\"positionJitterLinearOut\">100%</output></span>\n            <input id=\"positionJitterLinear\" type=\"range\" min=\"0\" max=\"100\" step=\"1\" value=\"100\" />\n          </label>\n        </section>\n\n        <section>\n          <h2>Pressure & layer</h2>\n\n          <label class=\"control\">\n            <span>Pressure → size <output id=\"pressureSizeOut\">65%</output></span>\n            <input id=\"pressureSize\" type=\"range\" min=\"0\" max=\"100\" step=\"1\" value=\"65\" />\n          </label>\n\n          <label class=\"control\">\n            <span>Pressure → alpha <output id=\"pressureOpacityOut\">35%</output></span>\n            <input id=\"pressureOpacity\" type=\"range\" min=\"0\" max=\"100\" step=\"1\" value=\"35\" />\n          </label>\n\n          <label class=\"control\">\n            <span>Precisione layer</span>\n            <select id=\"layerFormat\">\n              <option value=\"rgba8unorm\">RGBA8 linear — 64 MiB</option>\n              <option value=\"rgba16float\">RGBA16F linear — 128 MiB</option>\n            </select>\n          </label>\n        </section>\n\n        <section>\n          <h2>Benchmark</h2>\n          <label class=\"control\">\n            <span>Base stamps <output id=\"benchmarkStampsOut\">2000</output></span>\n            <input id=\"benchmarkStamps\" type=\"range\" min=\"250\" max=\"12000\" step=\"250\" value=\"2000\" />\n          </label>\n          <button id=\"runBenchmark\" class=\"primary wide\" type=\"button\">Esegui benchmark GPU</button>\n          <p id=\"benchmarkResult\" class=\"result\">Nessun benchmark eseguito.</p>\n\n          <label class=\"check-control\">\n            <span>\n              Benchmark tratto umano\n              <small>Registra una volta la pennellata di riferimento: poi la stessa sequenza viene usata su ogni dispositivo.</small>\n            </span>\n          </label>\n          <label class=\"control\">\n            <span>Variante test</span>\n            <select id=\"humanStrokeTestVariant\">\n              <option value=\"base\">Base — cerchio</option>\n              <option value=\"fur\">Fur — Shape 2K + Scatter 100%</option>\n            </select>\n          </label>\n          <button id=\"recordHumanStroke\" class=\"primary wide\" type=\"button\">Registra tratto umano</button>\n          <button id=\"playHumanStroke\" class=\"wide\" type=\"button\" disabled>Play tratto registrato</button>\n          <p id=\"humanStrokeResult\" class=\"result\">Caricamento tratto umano di riferimento…</p>\n        </section>\n\n        <section class=\"stats-section\">\n          <h2>Telemetria</h2>\n          <dl class=\"stats\">\n            <div><dt>FPS render</dt><dd id=\"fpsStat\">—</dd></div>\n            <div><dt>CPU frame</dt><dd id=\"cpuStat\">—</dd></div>\n            <div><dt>Stamps base</dt><dd id=\"stampStat\">0</dd></div>\n            <div><dt>Draw logiche evitate</dt><dd id=\"avoidedStat\">0</dd></div>\n            <div><dt>Memoria layer</dt><dd id=\"memoryStat\">64 MiB</dd></div>\n            <div><dt>GPU</dt><dd id=\"gpuStat\">—</dd></div>\n          </dl>\n          <p id=\"status\" class=\"status\">Inizializzazione WebGPU…</p>\n        </section>\n      </aside>\n\n      <main class=\"stage\">\n        <canvas id=\"gpuCanvas\" aria-label=\"Canvas di disegno WebGPU\"></canvas>\n        <div class=\"hint\">Disegna con mouse, dito o penna · Shift/medio/destro per pan · rotella per zoom</div>\n      </main>\n    </div>\n\n  </body>\n</html>\n";
const HUMAN_STROKE_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS human_stroke_benchmark (id TEXT PRIMARY KEY NOT NULL CHECK (id = 'canonical'), payload_json TEXT NOT NULL, captured_at TEXT NOT NULL)";
const HUMAN_STROKE_ID = "canonical";
const HUMAN_STROKE_PRESET_REVISION = 2;
const BENCHMARK_RUNS_SCHEMA_SQL = "CREATE TABLE IF NOT EXISTS benchmark_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, payload_json TEXT NOT NULL)";
const BENCHMARK_RUNS_INDEX_SQL = "CREATE INDEX IF NOT EXISTS benchmark_runs_created_at_idx ON benchmark_runs (created_at DESC)";

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

function normalizeHumanStrokeBenchmark(payload) {
  if (!payload || typeof payload !== "object" || !payload.settings || typeof payload.settings !== "object") {
    return payload;
  }

  if (
    payload.presetRevision === HUMAN_STROKE_PRESET_REVISION &&
    payload.settings.blendIntensity === 4 &&
    payload.settings.pressureSize === 0 &&
    payload.settings.pressureOpacity === 0
  ) {
    return payload;
  }

  return {
    ...payload,
    presetRevision: HUMAN_STROKE_PRESET_REVISION,
    settings: {
      ...payload.settings,
      blendIntensity: 4,
      pressureSize: 0,
      pressureOpacity: 0,
    },
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/human-stroke") {
      return handleHumanStroke(request, env);
    }

    if (url.pathname === "/api/benchmark-runs") {
      return handleBenchmarkRuns(request, env);
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
