import type {
  EditorExtension,
  EditorExtensionHost,
} from "../editor-extension-contract";
import {
  benchmarkEffectsWorkingSet,
  measureLayerColdCompressionStudy,
  runBenchmark,
} from "./engine-lab-operations";
import type { PointerSample } from "../engine-types";
import { HumanStrokeLab } from "./human-stroke-lab";

const LABS = [
  ["stroke-golden", "Golden tratto raster"],
  ["shadow-golden", "Golden ombre raster"],
  ["bevel-golden", "Golden bevel bounding-box"],
  ["paint-benchmark", "Benchmark Paint sintetico"],
  ["effects-benchmark", "Benchmark banco effetti"],
  ["layer-history", "GPU test cronologia livelli"],
  ["cold-tile", "GPU test cold tile"],
  ["clipping", "GPU test clipping group"],
  ["layer-blend", "GPU test fusioni livello"],
  ["layer-merge-raster", "GPU test merge raster"],
  ["layer-merge-clipping", "GPU test merge clipping"],
  ["layer-merge-mixed", "GPU test merge mixed"],
  ["layer-merge-memory", "GPU test merge memoria"],
  ["layer-merge-reject", "GPU test merge reject"],
  ["memory-stress", "Stress memoria livelli"],
  ["mixed-memory", "Benchmark memoria mista"],
  ["iphone-memory", "Ricerca limite iPhone"],
  ["layer-compression", "Studio compressione lossless"],
  ["vector-zoom-stress", "Stress zoom vettoriale"],
  ["vector-zoom-during", "A/B zoom · refresh durante il gesto"],
  ["vector-zoom-release", "A/B zoom · refresh al rilascio"],
  ["vector-zoom-coverage", "Zoom-out vettoriale · copertura C"],
  ["human-record", "Registra tratto umano canonico"],
  ["human-replay", "Replay tratto umano canonico"],
  ["human-blend", "Replay Blend su sfondo multicolore"],
  ["human-suite", "Suite tratto umano · 3 rendering"],
] as const;
const DESTRUCTIVE_GPU_LAB_TIMEOUT_MS = 180_000;

type LabId = (typeof LABS)[number][0];

function isLabId(value: string | null): value is LabId {
  return LABS.some(([id]) => id === value);
}

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Uint8Array || item instanceof Uint16Array) {
      return { type: item.constructor.name, byteLength: item.byteLength };
    }
    return item;
  }, 2);
}

async function saveLabReport(endpoint: string, report: unknown): Promise<number> {
  if (import.meta.env.DEV) return 0;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  });
  if (!response.ok) {
    throw new Error("Misura completata, ma il report non è stato salvato nel progetto.");
  }
  const payload = await response.json() as { id?: unknown };
  return typeof payload.id === "number" ? payload.id : 0;
}

class EditorLabController implements EditorExtension {
  readonly #host: EditorExtensionHost;
  readonly #select: HTMLSelectElement;
  readonly #runButton: HTMLButtonElement;
  readonly #result: HTMLParagraphElement;
  readonly #report: HTMLPreElement;
  #busy = false;
  #latchedBusy = false;
  readonly #humanStroke: HumanStrokeLab;

  constructor(host: EditorExtensionHost) {
    this.#host = host;
    const panel = document.createElement("aside");
    panel.className = "editor-labs-panel";
    panel.setAttribute("aria-label", "WebGPU Brush Engine Labs");
    panel.innerHTML = `
      <h1>Editor Labs</h1>
      <p>Entry separato: questi strumenti non entrano nel bundle dell'app.</p>
      <label>
        Laboratorio
        <select data-lab-select></select>
      </label>
      <button type="button" data-lab-run disabled>Avvia laboratorio</button>
      <p class="editor-labs-result" data-lab-result>Inizializzazione WebGPU…</p>
      <pre class="editor-labs-report" data-lab-report hidden></pre>
    `;
    document.body.append(panel);

    this.#select = panel.querySelector("[data-lab-select]") as HTMLSelectElement;
    this.#runButton = panel.querySelector("[data-lab-run]") as HTMLButtonElement;
    this.#result = panel.querySelector("[data-lab-result]") as HTMLParagraphElement;
    this.#report = panel.querySelector("[data-lab-report]") as HTMLPreElement;
    this.#humanStroke = new HumanStrokeLab(
      host.engine,
      (report) => this.#showExternalReport(report),
      (message, kind) => host.setStatus(message, kind),
      (settings) => host.applyBrushSettings(settings),
      () => host.collectInputDiagnostics(),
      () => host.refreshControls(),
    );
    for (const [id, label] of LABS) {
      this.#select.add(new Option(label, id));
    }
    const requested = new URLSearchParams(window.location.search).get("lab");
    if (isLabId(requested)) this.#select.value = requested;
    this.#runButton.addEventListener("click", () => {
      void this.#runSelected();
    });
  }

  isBusy(): boolean {
    return this.#busy || this.#latchedBusy || this.#humanStroke.isBusy();
  }

  syncControls(editorLocked: boolean): void {
    this.#select.disabled = this.isBusy();
    this.#runButton.disabled = this.isBusy() || editorLocked;
  }

  async afterEngineInitialized(): Promise<void> {
    this.#result.textContent = "Pronto. I test distruttivi richiedono una pagina nuova.";
    this.syncControls(false);
    const requested = new URLSearchParams(window.location.search).get("lab");
    if (isLabId(requested) && new URLSearchParams(window.location.search).get("autorun") === "1") {
      await this.#runSelected();
    }
  }

  handleEngineInitializationError(error: unknown): void {
    this.#result.textContent = error instanceof Error ? error.message : String(error);
    this.#result.classList.add("error");
  }

  wantsPaintRecording(): boolean {
    return this.#humanStroke.isArmed();
  }

  beginPaintRecording(event: PointerEvent, sample: PointerSample): void {
    this.#humanStroke.begin(event, sample);
  }

  capturePaintRecording(
    events: readonly PointerEvent[],
    samples: readonly PointerSample[],
  ): void {
    this.#humanStroke.capture(events, samples);
  }

  finishPaintRecording(commit: boolean): void {
    this.#humanStroke.finish(commit);
  }

  cancelPaintRecording(): void {
    this.#humanStroke.cancel();
  }

  #showExternalReport(report: unknown): void {
    window.__editorLabReport = report;
    this.#report.textContent = serialize(report);
    this.#report.hidden = false;
    this.#result.textContent = "Fixture tratto umano aggiornata.";
    this.#host.refreshControls();
  }

  async #runSelected(): Promise<void> {
    if (this.#busy) return;
    const id = this.#select.value;
    if (!isLabId(id)) throw new Error(`Laboratorio sconosciuto: ${id}`);
    this.#busy = true;
    this.#report.hidden = true;
    this.#result.classList.remove("error");
    this.#result.textContent = `Esecuzione ${id}…`;
    this.#host.setStatus(`Laboratorio ${id} in corso…`, "working");
    this.#host.refreshControls();
    try {
      const report = await this.#run(id);
      window.__editorLabReport = report;
      this.#report.textContent = serialize(report);
      this.#report.hidden = false;
      this.#result.textContent = `Completato: ${id}`;
      this.#host.setStatus(`Laboratorio ${id} completato.`, "ok");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = {
        lab: id,
        passed: false,
        error: message,
        ...(import.meta.env.DEV && error instanceof Error && error.stack
          ? { stack: error.stack }
          : {}),
      };
      window.__editorLabReport = failure;
      this.#report.textContent = serialize(failure);
      this.#report.hidden = false;
      this.#result.textContent = message;
      this.#result.classList.add("error");
      this.#host.setStatus(message, "error");
    } finally {
      this.#busy = false;
      this.#host.refreshStats();
      this.#host.refreshControls();
    }
  }

  async #run(id: LabId): Promise<unknown> {
    const { engine } = this.#host;
    switch (id) {
      case "stroke-golden": {
        await engine.waitForIdle();
        const { runRasterStrokeGolden } = await import("./goldens/stroke-golden");
        return runRasterStrokeGolden(engine.device, {
          bevelBoundingFieldEnabled: engine.bevelBoundingFieldEnabled,
        });
      }
      case "shadow-golden": {
        await engine.waitForIdle();
        const { runRasterShadowGolden } = await import("./goldens/shadow-golden");
        return runRasterShadowGolden(engine.device);
      }
      case "bevel-golden": {
        await engine.waitForIdle();
        const { runRasterBevelBboxGolden } = await import("./goldens/bevel-bbox-golden");
        return runRasterBevelBboxGolden(engine.device);
      }
      case "paint-benchmark":
        return runBenchmark(engine, 2_000);
      case "effects-benchmark":
        return benchmarkEffectsWorkingSet(engine, 5);
      case "layer-history": {
        const { runLayerHistoryGpuTest } = await import("./gpu/layer-history-gpu-test");
        let timeoutId = 0;
        try {
          return await Promise.race([
            runLayerHistoryGpuTest(engine),
            new Promise<never>((_resolve, reject) => {
              timeoutId = window.setTimeout(() => {
                this.#latchedBusy = true;
                reject(new Error("Test livelli scaduto dopo 180 s; ricarica la pagina Labs."));
              }, DESTRUCTIVE_GPU_LAB_TIMEOUT_MS);
            }),
          ]);
        } finally {
          window.clearTimeout(timeoutId);
        }
      }
      case "cold-tile": {
        const { runLayerColdTileCompositeGpuTest } = await import(
          "./gpu/layer-cold-tile-composite-gpu-test"
        );
        return runLayerColdTileCompositeGpuTest(engine);
      }
      case "clipping": {
        const { runClippingGroupGpuTest } = await import("./gpu/clipping-group-gpu-test");
        return runClippingGroupGpuTest(engine);
      }
      case "layer-blend": {
        const { runLayerBlendGpuTest } = await import("./gpu/layer-blend-gpu-test");
        return runLayerBlendGpuTest(engine);
      }
      case "layer-merge-raster":
      case "layer-merge-clipping":
      case "layer-merge-mixed":
      case "layer-merge-memory":
      case "layer-merge-reject": {
        const controller = await this.#host.ensureMixedSceneController();
        const { runLayerMergeGpuTest } = await import("./gpu/layer-merge-gpu-test");
        return runLayerMergeGpuTest(
          engine,
          controller,
          id.slice("layer-merge-".length) as "raster" | "clipping" | "mixed" | "memory" | "reject",
        );
      }
      case "memory-stress": {
        const { runLayerMemoryStressTest } = await import("./memory/layer-memory-stress-test");
        return runLayerMemoryStressTest(engine);
      }
      case "mixed-memory": {
        const controller = await this.#host.ensureMixedSceneController();
        const { runMixedMemoryBenchmarkStudy } = await import("./memory/mixed-memory-benchmark");
        const target = new URLSearchParams(window.location.search).get("targetMiB") === "600"
          ? 600
          : 800;
        return runMixedMemoryBenchmarkStudy(engine, controller, target, (progress) => {
          this.#host.setStatus(
            `Memoria mista: ${progress.textNodeCount} testi, ${progress.rasterLayerCount} raster, `
              + `${progress.countedTotalMiB.toFixed(1)}/${progress.targetMiB} MiB.`,
            "working",
          );
          this.#host.refreshStats();
        });
      }
      case "iphone-memory": {
        const {
          recoverInterruptedIphoneMemoryLimitRun,
          runIphoneMemoryLimitTest,
        } = await import("./memory/iphone-memory-limit-test");
        const search = new URLSearchParams(window.location.search);
        const serverRequired = search.get("localOnly") !== "1";
        const previousRun = await recoverInterruptedIphoneMemoryLimitRun(serverRequired);
        const report = await runIphoneMemoryLimitTest(engine, {
          deviceLabel: search.get("device") ?? undefined,
          serverRequired,
          onProgress: (progress) => {
            this.#host.setStatus(
              `Limite iPhone: ${progress.completedOperations}/${progress.totalOperations} operazioni.`,
              "working",
            );
            this.#host.refreshStats();
          },
        });
        return { previousRun, report };
      }
      case "layer-compression": {
        const report = await measureLayerColdCompressionStudy(engine, (progress) => {
          this.#host.setStatus(
            `Compressione: livello ${progress.layerNumber}/${progress.layerCount}, `
              + `${progress.completedTiles}/${progress.totalTiles} tile.`,
            "working",
          );
        });
        const savedRunId = await saveLabReport("/api/layer-compression-runs", report);
        return { report, savedRunId };
      }
      case "vector-zoom-stress":
      case "vector-zoom-during":
      case "vector-zoom-release":
      case "vector-zoom-coverage": {
        const controller = await this.#host.ensureMixedSceneController();
        const { runVectorZoomLab } = await import("./vector/vector-zoom-labs");
        const kind = id.slice("vector-zoom-".length) as
          | "stress" | "during" | "release" | "coverage";
        return runVectorZoomLab(engine, controller, this.#host.canvas, kind);
      }
      case "human-record":
        return this.#humanStroke.arm();
      case "human-replay": {
        const search = new URLSearchParams(window.location.search);
        const requestedBlendMode = search.get("blendMode");
        const blendMode = requestedBlendMode === "uniformed-glaze"
          || requestedBlendMode === "intense-blending"
          ? requestedBlendMode
          : "light-glaze";
        const fur = search.get("variant") === "fur";
        const texturized = search.get("grain") === "texturized";
        return this.#humanStroke.replay("canonical", {
          blendMode,
          ...(fur ? {
            shape: "shape" as const,
            shapeScatter: 1,
            positionJitterLateral: 0,
            positionJitterLinear: 0,
          } : {}),
          ...(texturized ? { grainMode: "texturized" as const } : {}),
        });
      }
      case "human-blend":
        return this.#humanStroke.replayBlendCarrier();
      case "human-suite":
        return this.#humanStroke.runRenderingSuite();
    }
  }
}

export function createEditorLabController(host: EditorExtensionHost): EditorExtension {
  return new EditorLabController(host);
}
