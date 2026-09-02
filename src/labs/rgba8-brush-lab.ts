import { directDepositReferenceSettings } from "../direct-deposit-brush-core";
import type { CustomBrushShapeAssetId } from "../engine-types";
import type {
  EditorExtension,
  EditorExtensionHost,
} from "../editor-extension-contract";
import { decodeGrayscalePng } from "../png-mask";
import {
  probeRgba8PerDabAccumulation,
  type Rgba8AccumulationProbeResult,
} from "../rgba8-accumulation-probe";

const REFERENCE_SHAPE_ID = "custom-shape:direct-deposit-lab-v1";
const REFERENCE_SHAPE_URL = new URL(
  "../../assets/labs/direct-deposit-tip.png",
  import.meta.url,
).href;

type LabTipProfile = "gaussian" | "custom-shape";

function formatMiB(mib: number): string {
  return Number.isInteger(mib) ? String(mib) : mib.toFixed(1);
}

class Rgba8BrushLabController implements EditorExtension {
  readonly #host: EditorExtensionHost;
  readonly #controls: HTMLFieldSetElement;
  readonly #size: HTMLInputElement;
  readonly #sizeValue: HTMLOutputElement;
  readonly #deposit: HTMLInputElement;
  readonly #depositValue: HTMLOutputElement;
  readonly #spacingValue: HTMLElement;
  readonly #status: HTMLElement;
  readonly #reset: HTMLButtonElement;
  readonly #workingBadge: HTMLElement;
  readonly #probeResult: HTMLElement;
  readonly #precisionToggle: HTMLButtonElement;
  readonly #tipProfile: HTMLSelectElement;
  readonly #customShapePreview: HTMLImageElement;
  readonly #gaussianPreview: HTMLElement;
  readonly #tipDescription: HTMLElement;
  readonly #blurRadius: HTMLInputElement;
  readonly #blurRadiusValue: HTMLOutputElement;
  readonly #blurPreview: HTMLButtonElement;
  readonly #blurApply: HTMLButtonElement;
  readonly #blurCancel: HTMLButtonElement;
  readonly #blurStatus: HTMLElement;
  #shapeAssetPromise: Promise<CustomBrushShapeAssetId> | null = null;
  #probeRevision = 0;
  #activationRevision = 0;
  #editorLocked = false;
  #busy = true;
  #blurBusy = false;
  #blurSessionOpen = false;

  constructor(host: EditorExtensionHost) {
    this.#host = host;
    const documentLabel = host.engine.documentWidth === host.engine.documentHeight
      ? `${host.engine.documentWidth}²`
      : `${host.engine.documentWidth}×${host.engine.documentHeight}`;
    const panel = document.createElement("aside");
    panel.className = "editor-labs-panel direct-deposit-lab-panel";
    panel.setAttribute("aria-label", "Laboratorio pennello RGBA8");
    panel.innerHTML = `
      <details open>
        <summary>RGBA8 · Direct Deposit Lab</summary>
        <div class="direct-deposit-lab-badges" aria-label="Configurazione attiva">
          <span>Canvas ${documentLabel}</span><span data-working-badge>layer —</span>
          <span>output RGBA8/sRGB</span><span>storage sRGB</span><span>colore libero</span>
        </div>
        <p>
          La punta Gaussian viene valutata analiticamente dalla GPU, senza una
          texture della punta e senza un canvas RGBA16F. Gli stamp sommano il
          deposito nello scratch R16F nascosto a un solo canale; il livello
          permanente e ogni frame visibile restano RGBA8. Preview e commit usano la stessa
          soglia spaziale a bassa discrepanza, ancorata ai pixel del documento:
          pan e zoom non spostano il pattern e il lift non cambia i toni.
        </p>
        <fieldset data-lab-controls disabled>
          <label>
            <span>Punta</span>
            <select data-tip-profile>
              <option value="gaussian" selected>Gaussian analitica · 3σ</option>
              <option value="custom-shape">Forma personalizzata · 2K</option>
            </select>
          </label>
          <div class="direct-deposit-lab-shape">
            <span class="direct-deposit-lab-gaussian-preview" data-gaussian-preview aria-hidden="true"></span>
            <img data-custom-shape-preview src="${REFERENCE_SHAPE_URL}"
              alt="Anteprima della punta personalizzata" hidden />
            <span data-tip-description>Gaussian normalizzata: centro 100%, bordo 0%, supporto 3σ</span>
          </div>
          <label>
            <span>Dimensione <output data-size-value>96 px</output></span>
            <input data-size type="range" min="1" max="500" step="1" value="96" />
          </label>
          <label>
            <span>Deposito per stamp <output data-deposit-value>6%</output></span>
            <input data-deposit type="range" min="1" max="100" step="1" value="6" />
          </label>
          <p class="direct-deposit-lab-metric">
            Spacing dinamico: <strong data-spacing-value>—</strong>
          </p>
          <button type="button" data-reset>Ripristina pennello di prova</button>
        </fieldset>
        <section class="direct-deposit-lab-blur" aria-label="Gaussian Blur RGBA8">
          <strong>Gaussian Blur · output RGBA8</strong>
          <p>
            Due passaggi separabili in lineare premoltiplicato: calcolo f32 e
            strisce temporanee RGBA16 UNORM impacchettate. Sorgente e risultato
            restano RGBA8/sRGB; la quantizzazione ad alta frequenza avviene una
            sola volta all’uscita.
          </p>
          <label>
            <span>Raggio <output data-blur-radius-value>24 px</output></span>
            <input data-blur-radius type="range" min="1" max="160" step="1" value="24" />
          </label>
          <div class="direct-deposit-lab-blur-actions">
            <button type="button" data-blur-preview>Anteprima</button>
            <button type="button" data-blur-apply disabled>Applica</button>
            <button type="button" data-blur-cancel disabled>Annulla</button>
          </div>
          <p data-blur-status>Disegna qualcosa, poi avvia l’anteprima per cercare eventuali onde.</p>
        </section>
        <p class="editor-labs-result" data-lab-status>Inizializzazione WebGPU…</p>
        <div class="direct-deposit-lab-probe" aria-live="polite">
          <strong>Probe storage RGBA8: 256 codici per asse</strong>
          <p data-probe-result>Misurazione GPU RGBA8…</p>
          <button type="button" data-precision-toggle>Riesegui test GPU</button>
        </div>
        <p class="direct-deposit-lab-hint">
          Parti dal nero, poi scegli qualunque colore dall’interfaccia. Incrocia
          lo stesso tratto e ripassalo: deve convergere al colore scelto senza
          l’effetto di fogli trasparenti sovrapposti.
        </p>
      </details>
    `;
    document.body.append(panel);
    this.#controls = panel.querySelector("[data-lab-controls]") as HTMLFieldSetElement;
    this.#size = panel.querySelector("[data-size]") as HTMLInputElement;
    this.#sizeValue = panel.querySelector("[data-size-value]") as HTMLOutputElement;
    this.#deposit = panel.querySelector("[data-deposit]") as HTMLInputElement;
    this.#depositValue = panel.querySelector("[data-deposit-value]") as HTMLOutputElement;
    this.#spacingValue = panel.querySelector("[data-spacing-value]") as HTMLElement;
    this.#status = panel.querySelector("[data-lab-status]") as HTMLElement;
    this.#reset = panel.querySelector("[data-reset]") as HTMLButtonElement;
    this.#workingBadge = panel.querySelector("[data-working-badge]") as HTMLElement;
    this.#probeResult = panel.querySelector("[data-probe-result]") as HTMLElement;
    this.#precisionToggle = panel.querySelector("[data-precision-toggle]") as HTMLButtonElement;
    this.#tipProfile = panel.querySelector("[data-tip-profile]") as HTMLSelectElement;
    this.#customShapePreview = panel.querySelector(
      "[data-custom-shape-preview]",
    ) as HTMLImageElement;
    this.#gaussianPreview = panel.querySelector("[data-gaussian-preview]") as HTMLElement;
    this.#tipDescription = panel.querySelector("[data-tip-description]") as HTMLElement;
    this.#blurRadius = panel.querySelector("[data-blur-radius]") as HTMLInputElement;
    this.#blurRadiusValue = panel.querySelector(
      "[data-blur-radius-value]",
    ) as HTMLOutputElement;
    this.#blurPreview = panel.querySelector("[data-blur-preview]") as HTMLButtonElement;
    this.#blurApply = panel.querySelector("[data-blur-apply]") as HTMLButtonElement;
    this.#blurCancel = panel.querySelector("[data-blur-cancel]") as HTMLButtonElement;
    this.#blurStatus = panel.querySelector("[data-blur-status]") as HTMLElement;

    this.#tipProfile.addEventListener("change", () => {
      void this.#activateSelectedBrush(false);
    });
    this.#size.addEventListener("input", () => this.#applyQuickControls());
    this.#deposit.addEventListener("input", () => this.#applyQuickControls());
    this.#deposit.addEventListener("change", () => {
      void this.#refreshAccumulationProbe();
    });
    this.#reset.addEventListener("click", () => {
      void this.#activateSelectedBrush(true);
    });
    this.#precisionToggle.addEventListener("click", () => {
      void this.#refreshAccumulationProbe();
    });
    this.#blurRadius.addEventListener("input", () => this.#updateBlurRadius());
    this.#blurPreview.addEventListener("click", () => {
      void this.#openGaussianBlur();
    });
    this.#blurApply.addEventListener("click", () => {
      void this.#applyGaussianBlur();
    });
    this.#blurCancel.addEventListener("click", () => {
      void this.#cancelGaussianBlur();
    });
  }

  isBusy(): boolean {
    return this.#busy || this.#blurBusy;
  }

  syncControls(editorLocked: boolean): void {
    this.#editorLocked = editorLocked;
    this.#controls.disabled = this.#busy || editorLocked;
    this.#syncBlurControls();
  }

  async afterEngineInitialized(): Promise<void> {
    await this.#activateSelectedBrush(true);
  }

  handleEngineInitializationError(error: unknown): void {
    this.#busy = false;
    this.#status.textContent = error instanceof Error ? error.message : String(error);
    this.#status.classList.add("error");
    this.#syncBlurControls();
  }

  async #activateSelectedBrush(resetParameters: boolean): Promise<void> {
    const activationRevision = ++this.#activationRevision;
    const tipProfile = this.#selectedTipProfile();
    this.#busy = true;
    this.#controls.disabled = true;
    this.#status.classList.remove("error");
    this.#status.textContent = tipProfile === "gaussian"
      ? "Preparazione della punta Gaussian analitica…"
      : "Preparazione della punta personalizzata…";
    window.__editorLabReport = {
      lab: "rgba8-direct-deposit-brush",
      passed: false,
      status: "preparing",
      tipProfile,
    };
    this.#host.setStatus("Preparazione del laboratorio RGBA8…", "working");
    this.#host.refreshControls();
    try {
      const shapeAssetId = tipProfile === "custom-shape"
        ? await this.#ensureReferenceShape()
        : null;
      if (activationRevision !== this.#activationRevision) return;
      this.#host.engine.setDocumentBackgroundColor("#ffffff");
      this.#host.engine.setDocumentBackgroundVisibility(true);
      const currentSettings = this.#host.engine.getSettings();
      const baseSettings = resetParameters
        ? directDepositReferenceSettings(currentSettings)
        : currentSettings;
      this.#host.applyBrushSettings(
        tipProfile === "gaussian"
          ? {
            ...baseSettings,
            shape: "circle",
            tipFalloff: "gaussian",
          }
          : {
            ...baseSettings,
            shape: "shape",
            tipFalloff: "standard",
            shapeAssetId: shapeAssetId!,
            shapeAssetIds: [shapeAssetId!],
            shapeSequenceMode: "ordered",
            shapeInvert: false,
            shapeMaskFormat: "r16float",
            shapeRotation: "fixed",
          },
      );
      await this.#host.engine.ensureCurrentBrushResources();
      if (activationRevision !== this.#activationRevision) return;
      this.#syncFromEngine();
      this.#syncPrecisionControls();
      const accumulationProbe = await this.#refreshAccumulationProbe();
      if (activationRevision !== this.#activationRevision) return;
      const storageProbePassed = accumulationProbe.redCodesExact === 256
        && accumulationProbe.greenCodesExact === 256
        && accumulationProbe.blueCodesExact === 256
        && accumulationProbe.encodedRampMaximumError === 0;
      const permanentLayerMiB = (
        this.#host.engine.documentWidth
        * this.#host.engine.documentHeight
        * 4
      ) / (1024 * 1024);
      const activeStrokeScratchMiB = (
        this.#host.engine.documentWidth
        * this.#host.engine.documentHeight
        * 2
      ) / (1024 * 1024);
      const activeSettings = this.#host.engine.getSettings();
      const selectedTipReady = tipProfile === "gaussian"
        ? activeSettings.shape === "circle" && activeSettings.tipFalloff === "gaussian"
        : activeSettings.shape === "shape" && activeSettings.tipFalloff !== "gaussian";
      const report = {
        lab: "rgba8-direct-deposit-brush",
        passed: this.#host.engine.layerFormat === "rgba8unorm"
          && this.#host.engine.canvasFormat === "rgba8unorm"
          && this.#host.engine.displayCompositingColorSpace === "stored-encoded-srgb"
          && selectedTipReady
          && storageProbePassed,
        document: `${this.#host.engine.documentWidth}×${this.#host.engine.documentHeight}`,
        layerFormat: this.#host.engine.layerFormat,
        presentationFormat: this.#host.engine.canvasFormat,
        canvasColorSpace: "srgb",
        backgroundCompositing: this.#host.engine.displayCompositingColorSpace,
        presentationTransferContract: "stored-encoded-srgb-direct",
        storageEncoding: this.#host.engine.documentStorageColorSpace,
        accumulation: "r16float-optical-depth-per-gesture",
        quantization: "document-spatial-low-discrepancy-adjacent-code",
        gaussianBlur: {
          source: "rgba8unorm",
          workingColorSpace: "linear-premultiplied",
          intermediate: "packed-rgba16unorm-horizontal-and-vertical-strips",
          accumulation: "f32",
          output: "rgba8unorm-document-stable-high-frequency-adjacent-code",
        },
        permanentLayerMiB,
        activeStrokeScratchMiB,
        pressure: "size-only",
        color: activeSettings.color,
        tipProfile,
        shapeAssetId,
        shapeSource: tipProfile === "gaussian"
          ? "analytic-normalized-gaussian-three-sigma"
          : "2048x2048-grayscale8-continuous-filtering",
        controls: "flow-is-per-dab-deposit; opacity-is-one; color-is-unrestricted",
        accumulationProbe,
      } as const;
      window.__editorLabReport = report;
      if (!report.passed) {
        throw new Error(
          "Questa scheda usa ancora il vecchio percorso colore. Ricaricala per attivare RGBA8 sRGB.",
        );
      }
      this.#status.textContent =
        `${report.document} · layer RGBA8 (${formatMiB(permanentLayerMiB)} MiB)`
        + ` · scratch nascosto R16F (${formatMiB(activeStrokeScratchMiB)} MiB)`
        + ` · ${tipProfile === "gaussian" ? "Gaussian GPU analitica" : "forma 2K"}`
        + " · preview e commit RGBA8 document-space · pronto.";
      this.#host.setStatus(
        tipProfile === "gaussian"
          ? "Punta Gaussian RGBA8 pronta."
          : "Punta personalizzata RGBA8 pronta.",
        "ok",
      );
    } catch (error) {
      if (activationRevision !== this.#activationRevision) return;
      const message = error instanceof Error ? error.message : String(error);
      this.#status.textContent = message;
      this.#status.classList.add("error");
      this.#host.setStatus(message, "error");
    } finally {
      if (activationRevision !== this.#activationRevision) return;
      this.#busy = false;
      this.#controls.disabled = this.#editorLocked;
      this.#syncBlurControls();
      this.#host.refreshStats();
      this.#host.refreshControls();
    }
  }

  async #refreshAccumulationProbe(): Promise<Rgba8AccumulationProbeResult> {
    const revision = ++this.#probeRevision;
    const deposit = Number(this.#deposit.value) / 100;
    this.#probeResult.textContent =
      `Misurazione GPU di 256 ripassi al ${Math.round(deposit * 100)}%…`;
    const result = await probeRgba8PerDabAccumulation(
      this.#host.engine.device,
      deposit,
      256,
    );
    if (revision !== this.#probeRevision) return result;
    const exact = result.preciseOutputBlackOverWhite;
    this.#probeResult.textContent =
      `Scrittura per stamp: il nero si ferma a RGB ${result.visibleBlackOverWhite} dopo `
      + `${result.lastChangingRepetition} cambi. Nuovo accumulo nello stesso gesto: RGB ${exact}. `
      + `In ${result.repetitions} gesti separati: RGB ${result.spatialOutputBlackOverWhite}. `
      + `Rampa encoded-sRGB: R ${result.redCodesExact}/256, `
      + `G ${result.greenCodesExact}/256, B ${result.blueCodesExact}/256 `
      + `(errore max ${result.encodedRampMaximumError}).`;
    return result;
  }

  #syncPrecisionControls(): void {
    this.#workingBadge.textContent = "layer RGBA8 · scratch R16F";
    this.#precisionToggle.textContent = "Riesegui test GPU";
  }

  #selectedTipProfile(): LabTipProfile {
    return this.#tipProfile.value === "custom-shape" ? "custom-shape" : "gaussian";
  }

  #syncTipPresentation(tipProfile: LabTipProfile): void {
    const gaussian = tipProfile === "gaussian";
    this.#gaussianPreview.hidden = !gaussian;
    this.#customShapePreview.hidden = gaussian;
    this.#tipDescription.textContent = gaussian
      ? "Gaussian normalizzata: centro 100%, bordo 0%, supporto 3σ"
      : "Punta personalizzata 2048² · sorgente gray8, filtro continuo";
    this.#reset.textContent = gaussian
      ? "Ripristina Gaussian di prova"
      : "Ripristina forma di prova";
  }

  #ensureReferenceShape(): Promise<CustomBrushShapeAssetId> {
    if (this.#shapeAssetPromise) return this.#shapeAssetPromise;
    const pending = (async () => {
      const response = await fetch(REFERENCE_SHAPE_URL);
      if (!response.ok) {
        throw new Error(`Caricamento della punta non riuscito (${response.status}).`);
      }
      const decoded = await decodeGrayscalePng(await response.arrayBuffer());
      if (decoded.width !== 2048 || decoded.height !== 2048) {
        throw new Error(
          `La punta di prova deve essere 2048×2048; trovata ${decoded.width}×${decoded.height}.`,
        );
      }
      return this.#host.engine.registerCustomShapeAsset(
        {
          width: decoded.width,
          height: decoded.height,
          scalar16: decoded.pixels,
          sourceBitDepth: decoded.sourceBitDepth,
          name: "Direct Deposit Lab Shape",
          mimeType: "image/png",
        },
        REFERENCE_SHAPE_ID,
      );
    })();
    this.#shapeAssetPromise = pending;
    void pending.catch(() => {
      if (this.#shapeAssetPromise === pending) this.#shapeAssetPromise = null;
    });
    return pending;
  }

  #syncBlurControls(): void {
    const editorBlocksOpen = this.#editorLocked && !this.#blurSessionOpen;
    this.#blurRadius.disabled = this.#blurBusy;
    this.#blurPreview.disabled = this.#busy
      || this.#blurBusy
      || this.#blurSessionOpen
      || editorBlocksOpen;
    this.#blurApply.disabled = this.#blurBusy || !this.#blurSessionOpen;
    this.#blurCancel.disabled = this.#blurBusy || !this.#blurSessionOpen;
  }

  #updateBlurRadius(): void {
    const requestedRadius = Number(this.#blurRadius.value);
    this.#blurRadiusValue.value = `${Math.round(requestedRadius)} px`;
    if (!this.#blurSessionOpen || this.#blurBusy) return;
    try {
      const preview = this.#host.engine.updateRasterGaussianBlur(requestedRadius);
      this.#blurRadius.value = String(preview.radius);
      this.#blurRadiusValue.value = `${Math.round(preview.radius)} px`;
      this.#blurStatus.textContent =
        `Anteprima attiva · raggio ${Math.round(preview.radius)} px · `
        + `σ ${preview.sigma.toFixed(2)} · output RGBA8.`;
      this.#blurStatus.classList.remove("error");
    } catch (error) {
      this.#blurStatus.textContent = error instanceof Error ? error.message : String(error);
      this.#blurStatus.classList.add("error");
    }
  }

  async #openGaussianBlur(): Promise<void> {
    if (this.#busy || this.#blurBusy || this.#blurSessionOpen || this.#editorLocked) return;
    this.#blurBusy = true;
    this.#blurStatus.classList.remove("error");
    this.#blurStatus.textContent = "Preparazione dell’anteprima Gaussian Blur…";
    this.#syncBlurControls();
    this.#host.refreshControls();
    try {
      const preview = await this.#host.engine.beginRasterGaussianBlur(
        Number(this.#blurRadius.value),
      );
      if (!preview) throw new Error("Seleziona un livello raster prima di usare il blur.");
      this.#blurSessionOpen = true;
      this.#blurRadius.value = String(preview.radius);
      this.#blurRadiusValue.value = `${Math.round(preview.radius)} px`;
      this.#blurStatus.textContent =
        `Anteprima attiva · raggio ${Math.round(preview.radius)} px · `
        + `σ ${preview.sigma.toFixed(2)} · temporanei totali `
        + `${formatMiB(preview.memoryBytes / (1024 * 1024))} MiB · `
        + "due strisce packed RGBA16 UNORM, unica uscita RGBA8/sRGB.";
      this.#host.setStatus("Anteprima Gaussian Blur RGBA8 attiva.", "ok");
    } catch (error) {
      this.#blurSessionOpen =
        this.#host.engine.getHistoryState().openEdit === "gaussian-blur";
      const message = error instanceof Error ? error.message : String(error);
      this.#blurStatus.textContent = message;
      this.#blurStatus.classList.add("error");
      this.#host.setStatus(message, "error");
    } finally {
      this.#blurBusy = false;
      this.#syncBlurControls();
      this.#host.refreshStats();
      this.#host.refreshControls();
    }
  }

  async #applyGaussianBlur(): Promise<void> {
    if (this.#blurBusy || !this.#blurSessionOpen) return;
    this.#blurBusy = true;
    this.#blurStatus.classList.remove("error");
    this.#blurStatus.textContent = "Applicazione del Gaussian Blur RGBA8…";
    this.#syncBlurControls();
    try {
      await this.#host.engine.commitRasterGaussianBlur();
      this.#blurSessionOpen = false;
      this.#blurStatus.textContent =
        "Blur applicato: il livello salvato e il risultato visibile sono RGBA8.";
      this.#host.setStatus("Gaussian Blur RGBA8 applicato.", "ok");
    } catch (error) {
      this.#blurSessionOpen =
        this.#host.engine.getHistoryState().openEdit === "gaussian-blur";
      const message = error instanceof Error ? error.message : String(error);
      this.#blurStatus.textContent = message;
      this.#blurStatus.classList.add("error");
      this.#host.setStatus(message, "error");
    } finally {
      this.#blurBusy = false;
      this.#syncBlurControls();
      this.#host.refreshStats();
      this.#host.refreshControls();
    }
  }

  async #cancelGaussianBlur(): Promise<void> {
    if (this.#blurBusy || !this.#blurSessionOpen) return;
    this.#blurBusy = true;
    this.#blurStatus.classList.remove("error");
    this.#blurStatus.textContent = "Ripristino dei pixel originali…";
    this.#syncBlurControls();
    try {
      await this.#host.engine.cancelRasterGaussianBlur();
      this.#blurSessionOpen = false;
      this.#blurStatus.textContent = "Anteprima annullata: pixel originali ripristinati.";
      this.#host.setStatus("Gaussian Blur annullato.", "ok");
    } catch (error) {
      this.#blurSessionOpen =
        this.#host.engine.getHistoryState().openEdit === "gaussian-blur";
      const message = error instanceof Error ? error.message : String(error);
      this.#blurStatus.textContent = message;
      this.#blurStatus.classList.add("error");
      this.#host.setStatus(message, "error");
    } finally {
      this.#blurBusy = false;
      this.#syncBlurControls();
      this.#host.refreshStats();
      this.#host.refreshControls();
    }
  }

  #applyQuickControls(): void {
    if (this.#busy) return;
    const size = Number(this.#size.value);
    const deposit = Number(this.#deposit.value) / 100;
    this.#host.applyBrushSettings({
      ...this.#host.engine.getSettings(),
      tool: "paint",
      size,
      flow: deposit,
      opacity: 1,
    });
    this.#syncFromEngine();
    this.#host.refreshControls();
  }

  #syncFromEngine(): void {
    const settings = this.#host.engine.getSettings();
    const tipProfile: LabTipProfile = settings.shape === "circle"
      && settings.tipFalloff === "gaussian"
      ? "gaussian"
      : "custom-shape";
    this.#tipProfile.value = tipProfile;
    this.#syncTipPresentation(tipProfile);
    this.#size.value = String(Math.round(settings.size));
    this.#deposit.value = String(Math.round(settings.flow * 100));
    this.#sizeValue.value = `${Math.round(settings.size)} px`;
    this.#depositValue.value = `${Math.round(settings.flow * 100)}%`;
    this.#spacingValue.textContent =
      `${settings.spacingPercent.toFixed(1)}% · `
      + `${(settings.size * settings.spacingPercent / 100).toFixed(1)} px a pressione piena`;
  }
}

export function createRgba8BrushLabController(
  host: EditorExtensionHost,
): EditorExtension {
  return new Rgba8BrushLabController(host);
}
