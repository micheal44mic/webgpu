import { renderCanvasGuides } from "./canvas-guides-renderer";
import type { EditorGuidePreferences } from "./editor-settings-storage";
import type { SceneSnapMatch } from "./scene-transform-snap";
import type { VectorTextViewState } from "./vector-text-types";

export interface CanvasGuidesControllerOptions {
  readonly browser: Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame">;
  readonly canvas: HTMLCanvasElement;
  readonly getDocumentSize: () => Readonly<{ width: number; height: number }>;
  readonly getViewportInsets: () => Readonly<{ top: number; left: number }>;
  readonly getView: () => Readonly<VectorTextViewState>;
  readonly getPreferences: () => Readonly<EditorGuidePreferences>;
}

/** Lightweight Canvas2D overlay owner for rulers, adaptive grid and snap lines. */
export class CanvasGuidesController {
  private readonly context: CanvasRenderingContext2D;
  private renderRequest: number | null = null;
  private smartGuides: readonly SceneSnapMatch[] = [];
  private disposed = false;

  constructor(private readonly options: CanvasGuidesControllerOptions) {
    const context = options.canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!context) throw new Error("Canvas2D is unavailable for canvas guides.");
    this.context = context;
  }

  scheduleRender(): void {
    if (this.disposed || this.renderRequest !== null) return;
    this.renderRequest = this.options.browser.requestAnimationFrame(() => {
      this.renderRequest = null;
      this.renderNow();
    });
  }

  setSmartGuides(guides: readonly SceneSnapMatch[]): void {
    if (this.sameGuides(guides)) return;
    this.smartGuides = guides.map((guide) => ({ ...guide }));
    this.scheduleRender();
  }

  preferencesChanged(): void {
    if (!this.options.getPreferences().snapping) this.smartGuides = [];
    this.scheduleRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.renderRequest !== null) {
      this.options.browser.cancelAnimationFrame(this.renderRequest);
      this.renderRequest = null;
    }
    this.smartGuides = [];
    this.options.canvas.width = 1;
    this.options.canvas.height = 1;
    this.context.clearRect(0, 0, 1, 1);
    this.options.canvas.hidden = true;
  }

  private renderNow(): void {
    const preferences = this.options.getPreferences();
    const documentSize = this.options.getDocumentSize();
    renderCanvasGuides({
      canvas: this.options.canvas,
      context: this.context,
      view: this.options.getView(),
      documentWidth: documentSize.width,
      documentHeight: documentSize.height,
      viewportInsetsCss: this.options.getViewportInsets(),
      preferences,
      smartGuides: preferences.snapping ? this.smartGuides : [],
    });
  }

  private sameGuides(guides: readonly SceneSnapMatch[]): boolean {
    return guides.length === this.smartGuides.length
      && guides.every((guide, index) => {
        const current = this.smartGuides[index];
        return current
          && current.axis === guide.axis
          && current.position === guide.position
          && current.kind === guide.kind
          && current.anchor === guide.anchor
          && current.key === guide.key;
      });
  }
}
