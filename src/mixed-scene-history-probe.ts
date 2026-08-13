import type { MixedSceneSnapshot } from "./engine-types";
import type { VectorTextNodeSeed } from "./scene-text-model";
import type { VectorSvgNodeSeed } from "./scene-svg-model";
import { parseVectorSvg } from "./vector-svg-import.ts";
import type {
  MixedSceneHost,
  VectorRasterHistoryGpuProbe,
  VectorRasterHistoryGpuTestReport,
  VectorRasterizationResult,
} from "./mixed-scene-controller-contract";

interface MixedSceneHistoryProbeContext {
  readonly host: MixedSceneHost;
  readonly syncScene: (snapshot: MixedSceneSnapshot) => void;
  readonly defaultTextSeed: (index: number, color?: string) => VectorTextNodeSeed;
  readonly defaultSvgSeed: (
    documentValue: ReturnType<typeof parseVectorSvg>,
  ) => VectorSvgNodeSeed;
  readonly rasterizeSelectedText: () => Promise<VectorRasterizationResult | null>;
  readonly rasterizeSelectedSvg: () => Promise<VectorRasterizationResult | null>;
}

function uint8ArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function countNonZeroRgba16fAlpha(pixels: Uint8Array): number {
  if (pixels.byteLength % 8 !== 0) return 0;
  let count = 0;
  for (let offset = 6; offset < pixels.byteLength; offset += 8) {
    const alphaBits = pixels[offset] | (pixels[offset + 1] << 8);
    count += Number((alphaBits & 0x7fff) !== 0);
  }
  return count;
}

export async function runMixedSceneVectorRasterHistoryProbe(
  context: MixedSceneHistoryProbeContext,
): Promise<VectorRasterHistoryGpuTestReport> {
  const { host } = context;
  const initialScene = host.getMixedSceneSnapshot();
  const initialHistory = host.getHistoryState();
  const initialRasters = initialScene?.items.filter((item) => item.kind === "raster") ?? [];
  if (
    !initialScene
    || initialRasters.length !== 1
    || initialRasters[0].rasterHasContent
    || initialHistory.actionCount !== 0
    || initialHistory.cursor !== 0
  ) {
    throw new Error(
      "Il test raster vettoriale richiede una pagina dev nuova con un solo raster vuoto.",
    );
  }

  const auditWidth = Math.min(1536, host.documentWidth);
  const auditHeight = Math.min(1024, host.documentHeight);
  const auditRect = {
    x: Math.floor((host.documentWidth - auditWidth) * 0.5),
    y: Math.floor((host.documentHeight - auditHeight) * 0.5),
    width: auditWidth,
    height: auditHeight,
  };
  const refreshScene = (): MixedSceneSnapshot => {
    const snapshot = host.getMixedSceneSnapshot();
    if (!snapshot) throw new Error("Scena mista non disponibile durante il test.");
    context.syncScene(snapshot);
    return snapshot;
  };
  const readBackground = async (
    snapshot: MixedSceneSnapshot,
  ): Promise<Map<number, Uint8Array>> => {
    const result = new Map<number, Uint8Array>();
    for (const item of snapshot.items) {
      if (item.kind !== "raster") continue;
      result.set(
        item.rasterLayerId,
        await host.readLayerPixels(auditRect, item.rasterLayerIndex),
      );
    }
    return result;
  };

  const runProbe = async (
    sourceKind: "text" | "svg",
  ): Promise<VectorRasterHistoryGpuProbe> => {
    let vectorKey: `text:${number}` | `svg:${number}`;
    if (sourceKind === "text") {
      const seed = {
        ...context.defaultTextSeed(0, "#334455"),
        text: "RGBA16F",
        fontSize: 280,
        x: host.documentWidth * 0.5,
        y: host.documentHeight * 0.5,
      };
      const node = await host.addVectorTextNode(seed, "Test RGBA16F testo");
      vectorKey = `text:${node.id}`;
    } else {
      const documentValue = parseVectorSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
        + '<path fill="#4466aa" d="M32 64H480V448H32Z"/>'
        + '<circle fill="#dd8844" cx="256" cy="256" r="112"/>'
        + "</svg>",
        "regression-rgba16f.svg",
      );
      const node = await host.addVectorSvgNode(
        context.defaultSvgSeed(documentValue),
        "Test RGBA16F SVG",
      );
      vectorKey = `svg:${node.id}`;
    }

    const beforeRasterization = refreshScene();
    const backgroundBefore = await readBackground(beforeRasterization);
    const result = sourceKind === "text"
      ? await context.rasterizeSelectedText()
      : await context.rasterizeSelectedSvg();
    if (!result) {
      throw new Error(`Rasterizzazione ${sourceKind} non completata dal test WebGPU.`);
    }
    await host.waitForIdle();
    const rasterizedScene = refreshScene();
    const generated = rasterizedScene.items.find(
      (item) => item.kind === "raster" && item.rasterLayerId === result.layerId,
    );
    if (!generated || generated.kind !== "raster" || !generated.rasterContentBounds) {
      throw new Error(`Raster ${sourceKind} generato privo di bounds autorevoli.`);
    }
    const rawRect = generated.rasterContentBounds;
    const rawBeforeUndo = await host.readLayerPixels(rawRect, generated.rasterLayerIndex);
    const rawPixels = rawRect.width * rawRect.height;
    const rawBytesPerPixel = rawPixels > 0 ? rawBeforeUndo.byteLength / rawPixels : 0;

    const undoReturned = await host.undo();
    await host.waitForIdle();
    const undoScene = refreshScene();
    const undoRestoredVector = undoScene.items.some((item) => item.key === vectorKey)
      && !undoScene.items.some(
        (item) => item.kind === "raster" && item.rasterLayerId === result.layerId,
      );
    let undoPreservedBackgroundBytes = true;
    for (const [layerId, before] of backgroundBefore) {
      const item = undoScene.items.find(
        (candidate) => candidate.kind === "raster" && candidate.rasterLayerId === layerId,
      );
      if (!item || item.kind !== "raster") {
        undoPreservedBackgroundBytes = false;
        break;
      }
      const after = await host.readLayerPixels(auditRect, item.rasterLayerIndex);
      if (!uint8ArraysEqual(before, after)) {
        undoPreservedBackgroundBytes = false;
        break;
      }
    }

    const redoReturned = await host.redo();
    await host.waitForIdle();
    const redoScene = refreshScene();
    const redone = redoScene.items.find(
      (item) => item.kind === "raster" && item.rasterLayerId === result.layerId,
    );
    const redoRestoredRaster = Boolean(redone && redone.kind === "raster");
    const rawAfterRedo = redone && redone.kind === "raster"
      ? await host.readLayerPixels(rawRect, redone.rasterLayerIndex)
      : new Uint8Array();

    return {
      sourceKind,
      format: result.format,
      seedFormat: result.seedFormat,
      rawByteLength: rawBeforeUndo.byteLength,
      rawBytesPerPixel,
      nonZeroAlphaPixels: countNonZeroRgba16fAlpha(rawBeforeUndo),
      undoReturned,
      undoRestoredVector,
      undoPreservedBackgroundBytes,
      redoReturned,
      redoRestoredRaster,
      redoRestoredRawBytesExactly: uint8ArraysEqual(rawBeforeUndo, rawAfterRedo),
    };
  };

  const probes = [await runProbe("text"), await runProbe("svg")];
  return {
    probes,
    passed: probes.every((probe) =>
      probe.format === "rgba16float"
      && probe.seedFormat === "rgba16float"
      && probe.rawByteLength > 0
      && probe.rawBytesPerPixel === 8
      && probe.nonZeroAlphaPixels > 0
      && probe.undoReturned
      && probe.undoRestoredVector
      && probe.undoPreservedBackgroundBytes
      && probe.redoReturned
      && probe.redoRestoredRaster
      && probe.redoRestoredRawBytesExactly
    ),
  };
}
