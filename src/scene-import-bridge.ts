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

  constructor(options: SceneImportBridgeOptions) {
    this.#options = options;
    options.svgInput.addEventListener("change", this.#onSvgChange);
    options.imageInput.addEventListener("change", this.#onImageChange);
  }

  request(command: EditorVectorCommand): void {
    if (this.#disposed) return;
    const input = command === "import-svg"
      ? this.#options.svgInput
      : this.#options.imageInput;
    input.click();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
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
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const settlement = this.#options.beforeAccept?.() ?? Promise.resolve(true);
    void settlement
      .then((readyForImport) => {
        if (!readyForImport) {
          throw new Error("The active raster adjustment could not finish before import.");
        }
        const current = this.#options.currentController();
        if (!current) this.#options.onQueued?.(kind, file);
        return current ? current : this.#options.ensureController();
      })
      .then((ready) => kind === "svg"
        ? ready.importSvgFile(file)
        : ready.importRasterImageFile(file))
      .catch((error) => this.#options.onFailure?.(kind, error));
  }
}
