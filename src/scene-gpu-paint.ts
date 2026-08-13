import type { VectorSvgGradient } from "./vector-svg-import.ts";
import type { VectorTextGpuGradient } from "./vector-text-types";

export type GpuRgbColor = readonly [number, number, number];

function normalizedHexColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : "000000";
}

export function srgbChannelToLinear(value: number): number {
  const normalized = Math.min(1, Math.max(0, value));
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function gpuLinearColor(color: string): GpuRgbColor {
  const normalized = normalizedHexColor(color);
  return [
    srgbChannelToLinear(Number.parseInt(normalized.slice(0, 2), 16) / 255),
    srgbChannelToLinear(Number.parseInt(normalized.slice(2, 4), 16) / 255),
    srgbChannelToLinear(Number.parseInt(normalized.slice(4, 6), 16) / 255),
  ];
}

export function gpuSrgbColor(color: string): GpuRgbColor {
  const normalized = normalizedHexColor(color);
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}

export function svgGradientGpuData(gradient: VectorSvgGradient): VectorTextGpuGradient {
  return {
    kind: gradient.kind,
    spread: gradient.spread,
    transform: [...gradient.transform] as [number, number, number, number, number, number],
    geometry: [...gradient.geometry] as [number, number, number, number],
    focal: [...gradient.focal] as [number, number],
    stops: gradient.stops.map((stop) => ({
      offset: stop.offset,
      color: gpuSrgbColor(stop.color),
      opacity: stop.opacity,
    })),
  };
}

export function sameGpuLinearColor(first: string, second: string): boolean {
  const firstLinear = gpuLinearColor(first);
  const secondLinear = gpuLinearColor(second);
  return firstLinear[0] === secondLinear[0]
    && firstLinear[1] === secondLinear[1]
    && firstLinear[2] === secondLinear[2];
}
