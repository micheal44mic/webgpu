export interface MixedSceneDomElements {
  readonly presentationCanvas: HTMLCanvasElement;
  readonly interactionCanvas: HTMLCanvasElement;
  readonly interactionContext: CanvasRenderingContext2D;
  readonly textRasterStatus: HTMLElement;
  readonly svgFileInput: HTMLInputElement;
  readonly svgImportStatus: HTMLElement;
  readonly imageFileInput: HTMLInputElement;
  readonly imageImportStatus: HTMLElement;
  readonly transformCommitBar: HTMLElement;
  readonly transformCommitLabel: HTMLElement;
  readonly transformApplyButton: HTMLButtonElement;
  readonly transformCancelButton: HTMLButtonElement;
  readonly status: HTMLElement;
}

function requiredElement<ElementType extends HTMLElement>(
  root: ParentNode,
  id: string,
): ElementType {
  const rootElement = root as ParentNode & Partial<HTMLElement>;
  const found = rootElement.id === id
    ? rootElement as HTMLElement
    : root.querySelector<HTMLElement>(`#${id}`);
  if (!found) {
    throw new Error(`Elemento #${id} mancante per la scena testo/raster.`);
  }
  return found as ElementType;
}

export function resolveMixedSceneDom(root: ParentNode): MixedSceneDomElements {
  const presentationCanvas = requiredElement<HTMLCanvasElement>(
    root,
    "vectorTextPresentationCanvas",
  );
  const interactionCanvas = requiredElement<HTMLCanvasElement>(
    root,
    "vectorTextInteractionCanvas",
  );
  const interactionContext = interactionCanvas.getContext("2d", {
    alpha: true,
    desynchronized: true,
  });
  if (!interactionContext) {
    throw new Error("Canvas2D non disponibile per l'overlay di interazione testo.");
  }
  return {
    presentationCanvas,
    interactionCanvas,
    interactionContext,
    textRasterStatus: requiredElement<HTMLElement>(root, "vectorTextRasterStatus"),
    svgFileInput: requiredElement<HTMLInputElement>(root, "vectorSvgFileInput"),
    svgImportStatus: requiredElement<HTMLElement>(root, "vectorSvgImportStatus"),
    imageFileInput: requiredElement<HTMLInputElement>(root, "rasterImageFileInput"),
    imageImportStatus: requiredElement<HTMLElement>(root, "rasterImageImportStatus"),
    transformCommitBar: requiredElement<HTMLElement>(root, "transformCommitBar"),
    transformCommitLabel: requiredElement<HTMLElement>(root, "transformCommitLabel"),
    transformApplyButton: requiredElement<HTMLButtonElement>(root, "transformApply"),
    transformCancelButton: requiredElement<HTMLButtonElement>(root, "transformCancel"),
    status: requiredElement<HTMLElement>(root, "vectorTextStatus"),
  };
}
