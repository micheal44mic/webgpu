import type { EngineCallbacks } from "./engine-types";

export interface EditorStartupLoadingUpdate {
  readonly percent: number;
  readonly title: string;
  readonly detail: string;
  readonly step?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/** Owns the blocking editor-startup surface; engine domains only report data. */
export class EditorStartupLoadingController {
  private readonly browser: Window;
  private readonly app: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly step: HTMLElement;
  private readonly percent: HTMLElement;
  private readonly progress: HTMLProgressElement;
  private readonly error: HTMLElement;
  private readonly copyDiagnostics: HTMLButtonElement;
  private currentPercent = 0;
  private active = false;
  private failed = false;
  private copyDiagnosticsHandler: (() => void | Promise<void>) | null = null;

  constructor(elements: {
    readonly app: HTMLElement;
    readonly overlay: HTMLElement;
    readonly title: HTMLElement;
    readonly detail: HTMLElement;
    readonly step: HTMLElement;
    readonly percent: HTMLElement;
    readonly progress: HTMLProgressElement;
    readonly error: HTMLElement;
    readonly copyDiagnostics: HTMLButtonElement;
  }, browser: Window) {
    this.browser = browser;
    this.app = elements.app;
    this.overlay = elements.overlay;
    this.title = elements.title;
    this.detail = elements.detail;
    this.step = elements.step;
    this.percent = elements.percent;
    this.progress = elements.progress;
    this.error = elements.error;
    this.copyDiagnostics = elements.copyDiagnostics;
    this.copyDiagnostics.addEventListener("click", () => {
      void this.copyDiagnosticsHandler?.();
    });
  }

  begin(): void {
    this.active = true;
    this.failed = false;
    this.currentPercent = 0;
    this.overlay.dataset.state = "loading";
    this.overlay.hidden = false;
    this.error.hidden = true;
    this.copyDiagnostics.hidden = true;
    this.app.inert = true;
    this.app.setAttribute("aria-busy", "true");
    this.update({
      percent: 2,
      title: "Preparazione dell’editor",
      detail: "Caricamento del motore grafico…",
      step: "Avvio in corso…",
    });
  }

  update(update: EditorStartupLoadingUpdate): void {
    if (!this.active || this.failed) return;
    const requested = Number.isFinite(update.percent) ? Math.round(update.percent) : 0;
    this.currentPercent = Math.max(this.currentPercent, Math.min(99, Math.max(0, requested)));
    this.title.textContent = update.title;
    this.detail.textContent = update.detail;
    if (update.step !== undefined) this.step.textContent = update.step;
    this.percent.textContent = `${this.currentPercent}%`;
    this.progress.value = this.currentPercent;
  }

  checkpoint(name:
    | "composition"
    | "project-opening"
    | "project-open"
    | "selection"
    | "blend"
    | "brush"
    | "final"
  ): void {
    const updates: Record<typeof name, EditorStartupLoadingUpdate> = {
      composition: { percent: 4, title: "Preparazione dell’editor", detail: "Collegamento dell’interfaccia e degli strumenti…", step: "Composizione dell’applicazione." },
      "project-opening": { percent: 66, title: "Apertura del progetto", detail: "Ripristino di livelli, cronologia e contenuto salvato…", step: "Lettura del documento locale." },
      "project-open": { percent: 73, title: "Progetto aperto", detail: "Il canvas è visibile; completo tutti gli strumenti prima di sbloccarlo.", step: "Preparazione degli strumenti avanzati." },
      selection: { percent: 86, title: "Preparazione della selezione", detail: "Compilazione delle varianti esatte dei pennelli…", step: "Selezione pixel." },
      blend: { percent: 94, title: "Preparazione di Blend", detail: "Compilazione del motore di fusione…", step: "Blend WebGPU." },
      brush: { percent: 98, title: "Ripristino del pennello", detail: "Caricamento dell’ultimo pennello utilizzato…", step: "Asset Shape e Grain del pennello." },
      final: { percent: 99, title: "Controllo finale", detail: "Verifico che tutti i controller siano collegati…", step: "Ultima barriera di readiness." },
    };
    this.update(updates[name]);
  }

  reportEnginePhase(
    event: Parameters<NonNullable<EngineCallbacks["onStartupPhase"]>>[0],
  ): void {
    if (event.state === "error") {
      this.fail(event.error);
      return;
    }
    const updates = {
      "webgpu-adapter": event.state === "start"
        ? { percent: 5, title: "Ricerca della GPU", detail: "Individuazione dell’adapter WebGPU…" }
        : { percent: 9, title: "GPU individuata", detail: "Adapter WebGPU disponibile." },
      "webgpu-device": event.state === "start"
        ? { percent: 10, title: "Apertura della GPU", detail: "Creazione del dispositivo WebGPU…" }
        : { percent: 13, title: "GPU pronta", detail: "Dispositivo WebGPU creato." },
      "core-renderer-resources": event.state === "start"
        ? { percent: 14, title: "Preparazione del renderer", detail: "Creazione delle risorse grafiche di base…" }
        : { percent: 22, title: "Renderer di base pronto", detail: "Le risorse comuni sono disponibili." },
      "initial-document-resources": event.state === "start"
        ? { percent: 23, title: "Preparazione di pennelli e livelli", detail: "Compilazione del documento iniziale…" }
        : { percent: 64, title: "Canvas pronto", detail: "Documento e livelli iniziali disponibili." },
    } as const;
    this.update(updates[event.name]);
  }

  reportPipeline(
    event: Parameters<NonNullable<EngineCallbacks["onStartupProgress"]>>[0],
  ): void {
    if (event.state === "error") {
      this.fail(event.error);
      return;
    }
    const ranges = {
      "core-renderer-pipelines": [14, 22, "Preparazione del renderer", "Pipeline di visualizzazione"],
      "document-pipelines": [23, 62, "Preparazione di pennelli e livelli", "Pipeline del documento"],
      "vector-editor-pipelines": [74, 86, "Preparazione di testo e importazioni", "Pipeline per testo, SVG e immagini"],
      "selection-pipelines": [86, 94, "Preparazione della selezione", "Varianti dei pennelli con selezione"],
      "blend-pipelines": [94, 98, "Preparazione di Blend", "Pipeline di fusione del colore"],
    } as const;
    const [from, to, title, detail] = ranges[event.phase];
    const ratio = event.total > 0 ? event.completed / event.total : 0;
    this.update({
      percent: from + (to - from) * ratio,
      title,
      detail: `${detail}: ${event.completed} di ${event.total}.`,
      step: event.label,
    });
  }

  setCopyDiagnosticsHandler(handler: () => void | Promise<void>): void {
    this.copyDiagnosticsHandler = handler;
    if (this.failed) this.copyDiagnostics.hidden = false;
  }

  complete(): void {
    if (!this.active || this.failed) return;
    this.currentPercent = 100;
    this.overlay.dataset.state = "complete";
    this.title.textContent = "Editor pronto";
    this.detail.textContent = "Pennelli, testo, immagini, selezione e Blend sono disponibili.";
    this.step.textContent = "Caricamento completato.";
    this.percent.textContent = "100%";
    this.progress.value = 100;
    this.app.inert = false;
    this.app.setAttribute("aria-busy", "false");
    this.browser.setTimeout(() => {
      if (this.failed) return;
      this.overlay.hidden = true;
      this.active = false;
    }, 180);
  }

  fail(cause: unknown): void {
    if (!this.active) this.begin();
    this.failed = true;
    this.overlay.dataset.state = "error";
    this.title.textContent = "Caricamento interrotto";
    this.detail.textContent = "L’editor non è stato sbloccato perché una risorsa non è pronta.";
    this.error.textContent = errorMessage(cause);
    this.error.hidden = false;
    this.copyDiagnostics.hidden = this.copyDiagnosticsHandler === null;
    this.app.inert = true;
    this.app.setAttribute("aria-busy", "true");
  }
}

let sharedController: EditorStartupLoadingController | null = null;

export function createEditorStartupLoadingController(
  elements: ConstructorParameters<typeof EditorStartupLoadingController>[0],
  browser: Window,
): EditorStartupLoadingController {
  sharedController ??= new EditorStartupLoadingController(elements, browser);
  return sharedController;
}

export function editorStartupLoadingController(): EditorStartupLoadingController {
  if (!sharedController) throw new Error("Editor startup loading controller is unavailable.");
  return sharedController;
}
