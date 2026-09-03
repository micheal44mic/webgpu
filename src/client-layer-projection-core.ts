import { clamp } from "./color";
import type { LayerPoint, PointerSample } from "./engine-types";

interface ClientLayerProjectionCanvas {
  readonly width: number;
  readonly height: number;
  getBoundingClientRect(): Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">;
}

export interface ClientLayerProjectionContext {
  readonly canvas: ClientLayerProjectionCanvas;
  readonly viewCenterX: number;
  readonly viewCenterY: number;
  readonly viewRotationCos: number;
  readonly viewRotationSin: number;
  readonly zoom: number;
}

/**
 * Projects one browser-input batch through one immutable canvas/camera snapshot.
 * The arithmetic order matches the single-sample path so downstream f32 stamp
 * packing receives the same coordinates.
 */
export function projectClientSamplesToLayerPoints(
  context: Readonly<ClientLayerProjectionContext>,
  samples: readonly PointerSample[],
  now: () => number = () => performance.now(),
): LayerPoint[] {
  if (samples.length === 0) return [];

  const rectangle = context.canvas.getBoundingClientRect();
  const canvasWidth = context.canvas.width;
  const canvasHeight = context.canvas.height;
  const rectangleWidth = Math.max(1, rectangle.width);
  const rectangleHeight = Math.max(1, rectangle.height);
  const halfCanvasWidth = canvasWidth * 0.5;
  const halfCanvasHeight = canvasHeight * 0.5;
  const zoom = context.zoom;
  const rotationCos = context.viewRotationCos;
  const rotationSin = context.viewRotationSin;
  const viewCenterX = context.viewCenterX;
  const viewCenterY = context.viewCenterY;
  const points = new Array<LayerPoint>(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const screenX = (
      (sample.clientX - rectangle.left) / rectangleWidth
    ) * canvasWidth;
    const screenY = (
      (sample.clientY - rectangle.top) / rectangleHeight
    ) * canvasHeight;
    const scaledX = (screenX - halfCanvasWidth) / zoom;
    const scaledY = (screenY - halfCanvasHeight) / zoom;
    const layerOffsetX = rotationCos * scaledX + rotationSin * scaledY;
    const layerOffsetY = -rotationSin * scaledX + rotationCos * scaledY;
    points[index] = {
      x: viewCenterX + layerOffsetX,
      y: viewCenterY + layerOffsetY,
      pressure: clamp(sample.pressure, 0.01, 1),
      timeMs: Number.isFinite(sample.timeMs) ? sample.timeMs : now(),
    };
  }

  return points;
}
