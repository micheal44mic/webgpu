/**
 * Funzioni numeriche pure usate dal motore: percentili, hash, conversioni di
 * colore. Nessuno stato, nessuna dipendenza da GPU o DOM.
 */
import { clamp } from "./color";

export function combineCompressionHashes(
  previous: number,
  next: number,
  byteLength: number,
): number {
  let hash = previous >>> 0;
  hash ^= next >>> 0;
  hash = Math.imul(hash, 0x01000193);
  hash ^= byteLength >>> 0;
  return Math.imul(hash, 0x01000193) >>> 0;
}

export function normalizeViewRotation(angle: number): number {
  if (!Number.isFinite(angle)) {
    return 0;
  }
  const turn = Math.PI * 2;
  let normalized = (angle + Math.PI) % turn;
  if (normalized < 0) {
    normalized += turn;
  }
  return normalized - Math.PI;
}

export function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

export function hashBytes(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash = Math.imul(hash ^ bytes[index], 0x01000193) >>> 0;
  }
  return hash;
}

export function maximum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

export function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function previewHash32(value: number): number {
  let result = value >>> 0;
  result = (result ^ (result >>> 16)) >>> 0;
  result = Math.imul(result, 0x7feb352d) >>> 0;
  result = (result ^ (result >>> 15)) >>> 0;
  result = Math.imul(result, 0x846ca68b) >>> 0;
  result = (result ^ (result >>> 16)) >>> 0;
  return result;
}

export function previewRandom01(seed: number, salt: number): number {
  const salted = (seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0;
  return (previewHash32(salted) & 0x00ffffff) / 16777216;
}

export function previewHueToRgb(p: number, q: number, input: number): number {
  const value = ((input % 1) + 1) % 1;
  if (value < 1 / 6) {
    return p + (q - p) * 6 * value;
  }
  if (value < 1 / 2) {
    return q;
  }
  if (value < 2 / 3) {
    return p + (q - p) * (2 / 3 - value) * 6;
  }
  return p;
}

export function previewHslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = ((hue % 1) + 1) % 1;
  const s = clamp(saturation, 0, 1);
  const l = clamp(lightness, 0, 1);
  if (s <= 0.00001) {
    const channel = Math.round(l * 255);
    return [channel, channel, channel];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(clamp(previewHueToRgb(p, q, h + 1 / 3), 0, 1) * 255),
    Math.round(clamp(previewHueToRgb(p, q, h), 0, 1) * 255),
    Math.round(clamp(previewHueToRgb(p, q, h - 1 / 3), 0, 1) * 255),
  ];
}

export function srgbByteToLinear(channel: number): number {
  const value = clamp(channel / 255, 0, 1);
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}
