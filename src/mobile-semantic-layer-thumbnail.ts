import type { VectorTextNode } from "./scene-text-model.ts";
import type { VectorSvgNode } from "./scene-svg-model.ts";
import type { Shadow3dPathData } from "./vector-shadow-3d.ts";
import type { VectorSvgGradient } from "./vector-svg-import.ts";

export const MOBILE_SEMANTIC_LAYER_THUMBNAIL_STRATEGY =
  "lazy-canvas2d-semantic-text-svg-document-aspect-64-signature-cache-v2" as const;
export const MOBILE_SEMANTIC_LAYER_THUMBNAIL_SIZE = 64 as const;

/** Keep an imported SVG from monopolising the UI thread merely to draw 64 px. */
export const MOBILE_SEMANTIC_THUMBNAIL_MAXIMUM_COMMANDS = 25_000;

type MobileTextThumbnailNode = Pick<
  VectorTextNode,
  "text" | "fontFamily" | "fontSize" | "color"
>;

type MobileSvgThumbnailNode = Pick<VectorSvgNode, "document" | "paintColors">;

function thumbnailGradient(
  context: CanvasRenderingContext2D,
  source: VectorSvgGradient,
): CanvasGradient {
  context.save();
  context.transform(...source.transform);
  const gradient = source.kind === "linear"
    ? context.createLinearGradient(...source.geometry)
    : context.createRadialGradient(
      source.focal[0],
      source.focal[1],
      Math.max(0, source.geometry[3]),
      source.geometry[0],
      source.geometry[1],
      Math.max(0.000001, source.geometry[2]),
    );
  context.restore();
  for (const stop of source.stops) {
    const red = Number.parseInt(stop.color.slice(1, 3), 16);
    const green = Number.parseInt(stop.color.slice(3, 5), 16);
    const blue = Number.parseInt(stop.color.slice(5, 7), 16);
    gradient.addColorStop(
      Math.min(1, Math.max(0, stop.offset)),
      `rgba(${red}, ${green}, ${blue}, ${Math.min(1, Math.max(0, stop.opacity))})`,
    );
  }
  return gradient;
}

export type MobileSemanticLayerThumbnailSource =
  | {
    readonly kind: "text";
    readonly node: Readonly<MobileTextThumbnailNode>;
  }
  | {
    readonly kind: "svg";
    readonly node: Readonly<MobileSvgThumbnailNode>;
  };

const textThumbnailFontUrls: Readonly<Record<string, string>> = {
  Anton: new URL(
    "../assets/vector-text-fonts/Anton-Regular.ttf",
    import.meta.url,
  ).href,
  "Bebas Neue": new URL(
    "../assets/vector-text-fonts/BebasNeue-Regular.ttf",
    import.meta.url,
  ).href,
  Poppins: new URL(
    "../assets/vector-text-fonts/Poppins-Regular.ttf",
    import.meta.url,
  ).href,
};

type MobileThumbnailFontState = "loading" | "ready" | "failed";
const textThumbnailFontStates = new Map<string, MobileThumbnailFontState>();

/**
 * Registers only the font actually requested by an open Layers panel. The
 * callback is fired once after the exact document font becomes available, so
 * the existing row can replace its temporary system-font fallback.
 */
export function requestMobileTextThumbnailFont(
  fontFamily: string,
  onReady: () => void,
): boolean {
  const fontUrl = textThumbnailFontUrls[fontFamily];
  if (!fontUrl || typeof FontFace === "undefined" || !document.fonts) return false;
  const state = textThumbnailFontStates.get(fontFamily);
  if (state === "ready") return true;
  if (state === "loading" || state === "failed") return false;

  textThumbnailFontStates.set(fontFamily, "loading");
  const face = new FontFace(fontFamily, `url("${fontUrl}")`, {
    style: "normal",
    weight: "400",
  });
  void face.load().then((loadedFace) => {
    document.fonts.add(loadedFace);
    textThumbnailFontStates.set(fontFamily, "ready");
    onReady();
  }).catch(() => {
    textThumbnailFontStates.set(fontFamily, "failed");
  });
  return false;
}

export function mobileSemanticLayerThumbnailSignature(
  source: MobileSemanticLayerThumbnailSource,
): string {
  if (source.kind === "text") {
    const { text, fontFamily, fontSize, color } = source.node;
    return `text:${JSON.stringify([text, fontFamily, fontSize, color])}`;
  }
  const { document: documentValue, paintColors } = source.node;
  return `svg:${documentValue.sourceRevision}:${paintColors.join(",")}`;
}

function resetThumbnailCanvas(context: CanvasRenderingContext2D): void {
  const width = context.canvas.width;
  const height = context.canvas.height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.clearRect(
    0,
    0,
    width,
    height,
  );
  context.fillStyle = "#ffffff";
  context.fillRect(
    0,
    0,
    width,
    height,
  );
}

function renderTextThumbnail(
  context: CanvasRenderingContext2D,
  node: Readonly<MobileTextThumbnailNode>,
): boolean {
  const text = node.text.replace(/\s+/g, " ").trim();
  if (!text) return false;
  resetThumbnailCanvas(context);
  const width = context.canvas.width;
  const height = context.canvas.height;
  const padding = Math.max(1, Math.min(width, height) * 0.08);
  context.save();
  context.beginPath();
  context.rect(
    padding,
    padding,
    Math.max(1, width - padding * 2),
    Math.max(1, height - padding * 2),
  );
  context.clip();
  context.fillStyle = /^#[0-9a-f]{6}$/i.test(node.color) ? node.color : "#2d3036";
  context.font = `400 ${Math.max(1, height * 0.6)}px "${node.fontFamily}", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    text,
    width * 0.5,
    height * 0.53,
    Math.max(1, width - padding * 2),
  );
  context.restore();
  return true;
}

function traceSemanticPath(
  context: CanvasRenderingContext2D,
  path: Shadow3dPathData,
): boolean {
  let coordinateIndex = 0;
  context.beginPath();
  for (const verb of path.verbs) {
    if (verb === 0 || verb === 1) {
      const x = path.coords[coordinateIndex];
      const y = path.coords[coordinateIndex + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      if (verb === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
      coordinateIndex += 2;
    } else if (verb === 2) {
      const values = path.coords.subarray(coordinateIndex, coordinateIndex + 4);
      if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
        return false;
      }
      context.quadraticCurveTo(values[0], values[1], values[2], values[3]);
      coordinateIndex += 4;
    } else if (verb === 3) {
      const values = path.coords.subarray(coordinateIndex, coordinateIndex + 6);
      if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) {
        return false;
      }
      context.bezierCurveTo(
        values[0],
        values[1],
        values[2],
        values[3],
        values[4],
        values[5],
      );
      coordinateIndex += 6;
    } else if (verb === 4) {
      context.closePath();
    } else {
      return false;
    }
  }
  return coordinateIndex === path.coords.length;
}

function renderSvgThumbnail(
  context: CanvasRenderingContext2D,
  node: Readonly<MobileSvgThumbnailNode>,
): boolean {
  const { document: documentValue } = node;
  const commandCount = documentValue.paints.reduce(
    (sum, paint) => sum + paint.path.verbs.length,
    0,
  );
  if (
    commandCount === 0
    || commandCount > MOBILE_SEMANTIC_THUMBNAIL_MAXIMUM_COMMANDS
  ) {
    return false;
  }
  const { left, top, right, bottom } = documentValue.bounds;
  const width = right - left;
  const height = bottom - top;
  if (!(width > 0) || !(height > 0)) return false;

  resetThumbnailCanvas(context);
  const canvasWidth = context.canvas.width;
  const canvasHeight = context.canvas.height;
  const padding = Math.max(1, Math.min(canvasWidth, canvasHeight) * 0.08);
  const availableWidth = Math.max(1, canvasWidth - padding * 2);
  const availableHeight = Math.max(1, canvasHeight - padding * 2);
  const scale = Math.min(availableWidth / width, availableHeight / height);
  const translateX = (
    canvasWidth - width * scale
  ) * 0.5 - left * scale;
  const translateY = (
    canvasHeight - height * scale
  ) * 0.5 - top * scale;
  context.save();
  context.setTransform(scale, 0, 0, scale, translateX, translateY);
  for (const [index, paint] of documentValue.paints.entries()) {
    if (!traceSemanticPath(context, paint.path)) {
      context.restore();
      return false;
    }
    const color = node.paintColors[index] ?? paint.color;
    const preservesImportedGradient = Boolean(
      paint.gradient && color.toLowerCase() === paint.color.toLowerCase()
    );
    context.fillStyle = preservesImportedGradient
      ? thumbnailGradient(context, paint.gradient!)
      : /^#[0-9a-f]{6}$/i.test(color) ? color : paint.color;
    context.globalAlpha = Math.min(1, Math.max(0, paint.opacity));
    context.fill(paint.fillRule === 1 ? "evenodd" : "nonzero");
  }
  context.restore();
  return true;
}

export function renderMobileSemanticLayerThumbnail(
  context: CanvasRenderingContext2D,
  source: MobileSemanticLayerThumbnailSource,
): boolean {
  try {
    return source.kind === "text"
      ? renderTextThumbnail(context, source.node)
      : renderSvgThumbnail(context, source.node);
  } catch {
    return false;
  }
}
