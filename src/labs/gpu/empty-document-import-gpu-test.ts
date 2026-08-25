import type { BrushEngine } from "../../brush-engine";

export type EmptyDocumentImportGpuTestKind = "svg" | "image";

export interface EmptyDocumentImportGpuTestReport {
  readonly version: 1;
  readonly kind: EmptyDocumentImportGpuTestKind;
  readonly passed: true;
  readonly durationMs: number;
  readonly document: Readonly<{ width: number; height: number }>;
  readonly initialPixel: readonly number[];
  readonly importedPixel: readonly number[];
  readonly restoredPixel: readonly number[];
  readonly importedSceneKinds: readonly string[];
  readonly historyAfterImport: Readonly<{
    actionCount: number;
    cursor: number;
    canUndo: boolean;
  }>;
  readonly browserErrors: readonly string[];
  readonly gpuErrors: readonly string[];
}

const TEST_TIMEOUT_MS = 90_000;
const REQUIRED_DOCUMENT_SIZE = 2_048;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rgba(pixel: Uint8Array): readonly number[] {
  return [...pixel.slice(0, 4)];
}

function pixelsDiffer(left: Uint8Array, right: Uint8Array): boolean {
  return left.some((value, index) => value !== right[index]);
}

function pixelsNearlyEqual(left: Uint8Array, right: Uint8Array, tolerance = 1): boolean {
  return left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
}

async function waitUntil(
  predicate: () => boolean,
  description: string,
  timeoutMs = TEST_TIMEOUT_MS,
): Promise<void> {
  const startedAt = performance.now();
  while (!predicate()) {
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error(`Timeout while waiting for ${description}.`);
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
  }
}

function createSvgFile(): File {
  const source = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
    '<rect x="16" y="16" width="480" height="480" rx="48" fill="#ff2aa1"/>',
    '<circle cx="256" cy="256" r="112" fill="#20e0ff"/>',
    "</svg>",
  ].join("");
  return new File([source], "empty-document-smoke.svg", { type: "image/svg+xml" });
}

async function createImageFile(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  assert(context, "The browser did not provide a 2D canvas for the PNG fixture.");
  context.fillStyle = "#ff2aa1";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#20e0ff";
  context.fillRect(24, 24, 48, 48);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((candidate) => {
      if (candidate) resolve(candidate);
      else reject(new Error("The browser could not encode the PNG fixture."));
    }, "image/png");
  });
  return new File([blob], "empty-document-smoke.png", { type: "image/png" });
}

function dispatchFileSelection(inputId: string, file: File): void {
  const input = document.getElementById(inputId);
  assert(input instanceof HTMLInputElement, `Missing file input #${inputId}.`);
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function expectedImportReached(engine: BrushEngine, kind: EmptyDocumentImportGpuTestKind): boolean {
  const snapshot = engine.getMixedSceneSnapshot();
  const history = engine.getHistoryState();
  if (!snapshot || history.busy || history.actionCount !== 1 || history.cursor !== 1) return false;
  if (kind === "svg") return snapshot.items.some((item) => item.kind === "svg");
  return snapshot.items.filter((item) => item.kind === "raster").length === 2
    && snapshot.items.some((item) => item.kind === "raster" && item.rasterHasContent);
}

export async function runEmptyDocumentImportGpuTest(
  engine: BrushEngine,
  kind: EmptyDocumentImportGpuTestKind,
): Promise<EmptyDocumentImportGpuTestReport> {
  assert(
    engine.documentWidth === REQUIRED_DOCUMENT_SIZE
      && engine.documentHeight === REQUIRED_DOCUMENT_SIZE,
    `This cold-start smoke test requires a ${REQUIRED_DOCUMENT_SIZE}×${REQUIRED_DOCUMENT_SIZE} document.`,
  );
  await engine.waitForIdle();

  const initialScene = engine.getMixedSceneSnapshot();
  const initialHistory = engine.getHistoryState();
  assert(initialScene, "Mixed-scene state is unavailable on the empty document.");
  assert(
    initialScene.items.length === 1
      && initialScene.items[0]?.kind === "raster"
      && !initialScene.items[0].rasterHasContent,
    "The import smoke test must start from exactly one empty raster layer.",
  );
  assert(
    initialHistory.actionCount === 0 && initialHistory.cursor === 0,
    "The import smoke test must start with empty history.",
  );

  const sampleX = Math.floor(engine.documentWidth * 0.5);
  const sampleY = Math.floor(engine.documentHeight * 0.5);
  const initialPixel = await engine.readPresentationPixelAtLayer(sampleX, sampleY);
  const browserErrors: string[] = [];
  const gpuErrors: string[] = [];
  const onError = (event: ErrorEvent): void => {
    browserErrors.push(event.error instanceof Error ? event.error.message : event.message);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    browserErrors.push(event.reason instanceof Error ? event.reason.message : String(event.reason));
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  engine.device.pushErrorScope("validation");
  engine.device.pushErrorScope("internal");
  engine.device.pushErrorScope("out-of-memory");

  const startedAt = performance.now();
  let importedPixel = initialPixel;
  let restoredPixel = initialPixel;
  let importedSceneKinds: readonly string[] = [];
  let historyAfterImport = { actionCount: 0, cursor: 0, canUndo: false };
  let failure: unknown = null;
  try {
    const file = kind === "svg" ? createSvgFile() : await createImageFile();
    dispatchFileSelection(
      kind === "svg" ? "vectorSvgFileInput" : "rasterImageFileInput",
      file,
    );
    await waitUntil(() => expectedImportReached(engine, kind), `${kind} import and history commit`);
    await engine.waitForIdle();

    const importedScene = engine.getMixedSceneSnapshot();
    assert(importedScene, "The mixed scene disappeared after import.");
    importedSceneKinds = importedScene.items.map((item) => item.kind);
    importedPixel = await engine.readPresentationPixelAtLayer(sampleX, sampleY);
    assert(
      pixelsDiffer(initialPixel, importedPixel),
      `The ${kind} import committed, but the center presentation pixel did not change.`,
    );

    const importedHistory = engine.getHistoryState();
    historyAfterImport = {
      actionCount: importedHistory.actionCount,
      cursor: importedHistory.cursor,
      canUndo: importedHistory.canUndo,
    };
    assert(importedHistory.canUndo, `The ${kind} import did not create an Undo action.`);

    assert(await engine.undo(), `Undo refused the ${kind} import action.`);
    await engine.waitForIdle();
    const restoredScene = engine.getMixedSceneSnapshot();
    const restoredHistory = engine.getHistoryState();
    assert(
      restoredScene?.items.length === 1
        && restoredScene.items[0]?.kind === "raster"
        && !restoredScene.items[0].rasterHasContent,
      `Undo did not restore the empty document after ${kind} import.`,
    );
    assert(
      restoredHistory.actionCount === 1 && restoredHistory.cursor === 0,
      `Undo left inconsistent history after ${kind} import.`,
    );
    restoredPixel = await engine.readPresentationPixelAtLayer(sampleX, sampleY);
    assert(
      pixelsNearlyEqual(initialPixel, restoredPixel),
      `Undo did not restore the original presentation pixel after ${kind} import.`,
    );
  } catch (error) {
    failure = error;
  } finally {
    const outOfMemoryError = await engine.device.popErrorScope();
    const internalError = await engine.device.popErrorScope();
    const validationError = await engine.device.popErrorScope();
    for (const error of [validationError, internalError, outOfMemoryError]) {
      if (error) gpuErrors.push(error.message);
    }
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  }

  if (failure) throw failure;
  assert(browserErrors.length === 0, `Browser errors during ${kind} import: ${browserErrors.join("; ")}`);
  assert(gpuErrors.length === 0, `WebGPU errors during ${kind} import: ${gpuErrors.join("; ")}`);

  return {
    version: 1,
    kind,
    passed: true,
    durationMs: performance.now() - startedAt,
    document: { width: engine.documentWidth, height: engine.documentHeight },
    initialPixel: rgba(initialPixel),
    importedPixel: rgba(importedPixel),
    restoredPixel: rgba(restoredPixel),
    importedSceneKinds,
    historyAfterImport,
    browserErrors,
    gpuErrors,
  };
}
