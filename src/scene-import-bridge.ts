import type { EditorVectorCommand } from "./editor-tools-contract";
import type { MixedSceneController } from "./mixed-scene-controller";

type SceneImportController = Pick<
  MixedSceneController,
  "importSvgFile" | "importRasterImageFile"
>;

export interface SceneImportBridgeOptions {
  readonly svgInput: HTMLInputElement;
  readonly imageInput: HTMLInputElement;
  readonly currentController: () => SceneImportController | null;
  readonly ensureController: () => Promise<SceneImportController>;
  readonly beforeAccept?: () => Promise<boolean>;
  readonly onQueued?: (kind: "svg" | "image", file: File) => void;
  readonly onFailure?: (kind: "svg" | "image", error: unknown) => void;
}

/**
 * Keeps native file-picker activation synchronous while the optional editor
 * controller and its WebGPU pipelines are still warming in the background.
 */
export class SceneImportBridge {
  readonly #options: SceneImportBridgeOptions;
  #disposed = false;
  #documentGeneration = 0;
  readonly #activeImports = new Set<Promise<void>>();
  readonly #pickerGeneration: Record<"svg" | "image", number | null> = {
    svg: null,
    image: null,
  };

  constructor(options: SceneImportBridgeOptions) {
    this.#options = options;
    options.svgInput.addEventListener("change", this.#onSvgChange);
    options.imageInput.addEventListener("change", this.#onImageChange);
  }

  request(command: EditorVectorCommand): void {
    if (this.#disposed) return;
    const kind = command === "import-svg" ? "svg" : "image";
    const input = kind === "svg" ? this.#options.svgInput : this.#options.imageInput;
    this.#pickerGeneration[kind] = this.#documentGeneration;
    input.click();
  }

  get activeDocumentGeneration(): number {
    return this.#documentGeneration;
  }

  get isImportInFlight(): boolean {
    return this.#activeImports.size > 0;
  }

  /**
   * Invalidates picker selections and queued controller warm-up from the old
   * document. Controller imports that already started cannot be cancelled, so
   * the returned promise settles only after those operations finish. Await it
   * before replacing document-owned engine state.
   */
  async resetForDocument(): Promise<number> {
    if (this.#disposed) return this.#documentGeneration;
    this.#documentGeneration += 1;
    this.#options.svgInput.value = "";
    this.#options.imageInput.value = "";
    const activeImports = [...this.#activeImports];
    if (activeImports.length > 0) {
      await Promise.allSettled(activeImports);
    }
    return this.#documentGeneration;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#documentGeneration += 1;
    this.#options.svgInput.value = "";
    this.#options.imageInput.value = "";
    this.#options.svgInput.removeEventListener("change", this.#onSvgChange);
    this.#options.imageInput.removeEventListener("change", this.#onImageChange);
  }

  readonly #onSvgChange = (): void => {
    this.#accept("svg", this.#options.svgInput);
  };

  readonly #onImageChange = (): void => {
    this.#accept("image", this.#options.imageInput);
  };

  #accept(kind: "svg" | "image", input: HTMLInputElement): void {
    if (this.#disposed) return;
    const documentGeneration =
      this.#pickerGeneration[kind] ?? this.#documentGeneration;
    this.#pickerGeneration[kind] = null;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    void this.#acceptFile(kind, file, documentGeneration);
  }

  async #acceptFile(
    kind: "svg" | "image",
    file: File,
    documentGeneration: number,
  ): Promise<void> {
    try {
      const readyForImport = await (
        this.#options.beforeAccept?.() ?? Promise.resolve(true)
      );
      if (!this.#isCurrentDocument(documentGeneration)) return;
      if (!readyForImport) {
        throw new Error("The active raster adjustment could not finish before import.");
      }
      const current = this.#options.currentController();
      if (!current) this.#options.onQueued?.(kind, file);
      const ready = current ?? await this.#options.ensureController();
      if (!this.#isCurrentDocument(documentGeneration)) return;

      const operation = kind === "svg"
        ? ready.importSvgFile(file)
        : ready.importRasterImageFile(file);
      this.#activeImports.add(operation);
      try {
        await operation;
      } finally {
        this.#activeImports.delete(operation);
      }
    } catch (error) {
      if (!this.#isCurrentDocument(documentGeneration)) return;
      this.#options.onFailure?.(kind, error);
    }
  }

  #isCurrentDocument(documentGeneration: number): boolean {
    return !this.#disposed && documentGeneration === this.#documentGeneration;
  }
}
