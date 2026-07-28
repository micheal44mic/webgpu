export const VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY =
  "paint-webgpu-m1-single-shadow-plan-roi-canvas2d-native-gaussian-v1" as const;

export const VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM = 300;
export const VECTOR_TEXT_SINGLE_SHADOW_CACHE_MAX_BYTES = 32 * 1024 * 1024;
export const VECTOR_TEXT_SINGLE_SHADOW_MAX_PIXELS = 4 * 1024 * 1024;
export const VECTOR_TEXT_SINGLE_SHADOW_MAX_TEXTURE_SIZE = 4096;
export const VECTOR_TEXT_SINGLE_SHADOW_MAX_SIGMA_PIXELS = 8;
export const VECTOR_TEXT_SINGLE_SHADOW_MAX_KERNEL_RADIUS = 24;

export interface VectorTextSingleShadowBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface VectorTextSingleShadowBlurPlan {
  readonly bounds: Float64Array;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly sigmaPixels: number;
  readonly radius: number;
}

export interface VectorTextSingleShadowBlurLedger {
  readonly browserBytes: number;
  readonly cacheBytes: number;
  readonly scratchBytes: number;
  readonly entries: number;
}

interface VectorTextSingleShadowCacheEntry {
  readonly key: string;
  readonly nodeId: number;
  readonly bounds: Float64Array;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly canvas: HTMLCanvasElement;
  readonly bytes: number;
  lastUsed: number;
}

interface VectorTextSingleShadowDrawOptions {
  nodeId: number;
  geometryKey: string;
  path: Path2D;
  bounds: VectorTextSingleShadowBounds;
  color: string;
  opacity: number;
  blur: number;
  offsetX: number;
  offsetY: number;
  pixelScale: number;
}

function finite(
  value: number,
  fallback: number,
  minimum = -Infinity,
  maximum = Infinity,
): number {
  return Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

export function vectorTextSingleShadowBlurSupport(value: number): number {
  const blur = finite(value, 0, 0, VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM);
  return blur > 0 ? blur * 3 + 1 : 0;
}

/**
 * Port del planner di paint-webgpu-m1/geom/vector-shadow-blur-renderer.js.
 * Il blur resta in coordinate locali, ma la mask viene rasterizzata soltanto
 * alla densità utile per la vista corrente. Sigma e kernel sono limitati e
 * l'area non può superare quattro megapixel.
 */
export function planVectorTextSingleShadowBlur(
  bounds: VectorTextSingleShadowBounds,
  blur: number,
  pixelScale: number,
  {
    maxTextureSize = VECTOR_TEXT_SINGLE_SHADOW_MAX_TEXTURE_SIZE,
    maxPixels = VECTOR_TEXT_SINGLE_SHADOW_MAX_PIXELS,
  }: {
    maxTextureSize?: number;
    maxPixels?: number;
  } = {},
): VectorTextSingleShadowBlurPlan {
  const sigmaLocal = finite(
    blur,
    0,
    0,
    VECTOR_TEXT_SINGLE_SHADOW_BLUR_MAXIMUM,
  );
  const support = vectorTextSingleShadowBlurSupport(sigmaLocal);
  const paddedBounds = new Float64Array([
    Number(bounds.left) - support,
    Number(bounds.top) - support,
    Number(bounds.right) + support,
    Number(bounds.bottom) + support,
  ]);
  const logicalWidth = Math.max(1e-6, paddedBounds[2] - paddedBounds[0]);
  const logicalHeight = Math.max(1e-6, paddedBounds[3] - paddedBounds[1]);
  let scale = finite(pixelScale, 1, 0.0001, 1_000_000);
  if (sigmaLocal > 0 && sigmaLocal * scale > VECTOR_TEXT_SINGLE_SHADOW_MAX_SIGMA_PIXELS) {
    scale = VECTOR_TEXT_SINGLE_SHADOW_MAX_SIGMA_PIXELS / sigmaLocal;
  }
  const sizeAtScale = () => ({
    width: Math.max(2, Math.ceil(logicalWidth * scale)),
    height: Math.max(2, Math.ceil(logicalHeight * scale)),
  });
  let size = sizeAtScale();
  const dimensionRatio = Math.min(
    1,
    maxTextureSize / size.width,
    maxTextureSize / size.height,
  );
  const pixelRatio = Math.min(
    1,
    Math.sqrt(maxPixels / Math.max(1, size.width * size.height)),
  );
  const ratio = Math.min(dimensionRatio, pixelRatio);
  if (ratio < 1) {
    scale = Math.max(0.0001, scale * ratio * 0.999);
    size = sizeAtScale();
  }
  const sigmaPixels = Math.max(0.01, sigmaLocal * scale);
  return Object.freeze({
    bounds: paddedBounds,
    width: Math.min(maxTextureSize, size.width),
    height: Math.min(maxTextureSize, size.height),
    scale,
    sigmaPixels,
    radius: Math.max(
      1,
      Math.min(
        VECTOR_TEXT_SINGLE_SHADOW_MAX_KERNEL_RADIUS,
        Math.ceil(sigmaPixels * 3),
      ),
    ),
  });
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function requiredContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", {
    alpha: true,
    desynchronized: true,
  });
  if (!context) {
    throw new Error("Canvas2D non disponibile per il blur dell'ombra testo.");
  }
  return context;
}

/**
 * Conserva una sola bitmap sfocata per nodo/stato e uno scratch condiviso.
 * Offset, angolo e opacità restano parametri di compositing e non invalidano
 * la mask; il colore invalida soltanto la bitmap RGBA, non la geometria.
 */
export class VectorTextSingleShadowBlurRenderer {
  readonly strategy = VECTOR_TEXT_SINGLE_SHADOW_BLUR_STRATEGY;

  private readonly cache = new Map<string, VectorTextSingleShadowCacheEntry>();
  private readonly keyByNodeId = new Map<number, string>();
  private cacheBytes = 0;
  private scratchCanvas: HTMLCanvasElement | null = null;
  private readonly maxCacheBytes: number;

  constructor(maxCacheBytes = VECTOR_TEXT_SINGLE_SHADOW_CACHE_MAX_BYTES) {
    this.maxCacheBytes = maxCacheBytes;
  }

  draw(
    target: CanvasRenderingContext2D,
    options: VectorTextSingleShadowDrawOptions,
  ): boolean {
    if (!(options.opacity > 0) || !(options.blur > 0)) {
      this.invalidateNode(options.nodeId);
      return false;
    }
    const plan = planVectorTextSingleShadowBlur(
      options.bounds,
      options.blur,
      options.pixelScale,
    );
    const key = [
      options.nodeId,
      options.geometryKey,
      options.blur,
      options.color,
      plan.width,
      plan.height,
      plan.scale.toFixed(6),
    ].join(":");
    const previousKey = this.keyByNodeId.get(options.nodeId);
    if (previousKey && previousKey !== key) {
      const previous = this.cache.get(previousKey);
      if (previous) {
        this.deleteEntry(previous);
      }
    }

    let entry = this.cache.get(key);
    if (!entry) {
      entry = this.buildEntry(options, plan, key);
      this.cache.set(key, entry);
      this.keyByNodeId.set(options.nodeId, key);
      this.cacheBytes += entry.bytes;
      this.prune(key);
    }
    entry.lastUsed = performance.now();

    const logicalWidth = entry.bounds[2] - entry.bounds[0];
    const logicalHeight = entry.bounds[3] - entry.bounds[1];
    target.save();
    target.globalAlpha = options.opacity;
    target.globalCompositeOperation = "source-over";
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = "high";
    target.drawImage(
      entry.canvas,
      entry.bounds[0] + options.offsetX,
      entry.bounds[1] + options.offsetY,
      logicalWidth,
      logicalHeight,
    );
    target.restore();
    return true;
  }

  invalidateNode(nodeId: number): void {
    const key = this.keyByNodeId.get(nodeId);
    if (!key) {
      return;
    }
    const entry = this.cache.get(key);
    if (entry) {
      this.deleteEntry(entry);
    } else {
      this.keyByNodeId.delete(nodeId);
    }
  }

  retainNodes(nodeIds: ReadonlySet<number>): void {
    for (const entry of [...this.cache.values()]) {
      if (!nodeIds.has(entry.nodeId)) {
        this.deleteEntry(entry);
      }
    }
  }

  ledger(): VectorTextSingleShadowBlurLedger {
    const scratchBytes = this.scratchCanvas
      ? this.scratchCanvas.width * this.scratchCanvas.height * 4
      : 0;
    return {
      browserBytes: this.cacheBytes + scratchBytes,
      cacheBytes: this.cacheBytes,
      scratchBytes,
      entries: this.cache.size,
    };
  }

  private buildEntry(
    options: VectorTextSingleShadowDrawOptions,
    plan: VectorTextSingleShadowBlurPlan,
    key: string,
  ): VectorTextSingleShadowCacheEntry {
    const scratch = this.ensureScratch(plan.width, plan.height);
    const scratchContext = requiredContext(scratch);
    scratchContext.save();
    scratchContext.setTransform(1, 0, 0, 1, 0, 0);
    scratchContext.globalAlpha = 1;
    scratchContext.globalCompositeOperation = "source-over";
    scratchContext.filter = "none";
    scratchContext.clearRect(0, 0, plan.width, plan.height);
    scratchContext.setTransform(
      plan.scale,
      0,
      0,
      plan.scale,
      -plan.bounds[0] * plan.scale,
      -plan.bounds[1] * plan.scale,
    );
    scratchContext.fillStyle = options.color;
    scratchContext.fill(options.path);
    scratchContext.restore();

    const canvas = createCanvas(plan.width, plan.height);
    const context = requiredContext(canvas);
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, plan.width, plan.height);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.filter = `blur(${plan.sigmaPixels}px)`;
    context.drawImage(scratch, 0, 0);
    context.restore();

    return {
      key,
      nodeId: options.nodeId,
      bounds: plan.bounds,
      width: plan.width,
      height: plan.height,
      scale: plan.scale,
      canvas,
      bytes: plan.width * plan.height * 4,
      lastUsed: performance.now(),
    };
  }

  private ensureScratch(width: number, height: number): HTMLCanvasElement {
    if (!this.scratchCanvas) {
      this.scratchCanvas = createCanvas(width, height);
    } else if (
      this.scratchCanvas.width !== width
      || this.scratchCanvas.height !== height
    ) {
      this.scratchCanvas.width = width;
      this.scratchCanvas.height = height;
    }
    return this.scratchCanvas;
  }

  private prune(protectedKey: string): void {
    if (this.cacheBytes <= this.maxCacheBytes) {
      return;
    }
    const entries = [...this.cache.values()]
      .sort((left, right) => left.lastUsed - right.lastUsed);
    for (const entry of entries) {
      if (this.cacheBytes <= this.maxCacheBytes) {
        break;
      }
      if (entry.key !== protectedKey) {
        this.deleteEntry(entry);
      }
    }
  }

  private deleteEntry(entry: VectorTextSingleShadowCacheEntry): void {
    if (!this.cache.delete(entry.key)) {
      return;
    }
    if (this.keyByNodeId.get(entry.nodeId) === entry.key) {
      this.keyByNodeId.delete(entry.nodeId);
    }
    this.cacheBytes = Math.max(0, this.cacheBytes - entry.bytes);
    entry.canvas.width = 1;
    entry.canvas.height = 1;
    if (this.cache.size === 0 && this.scratchCanvas) {
      this.scratchCanvas.width = 1;
      this.scratchCanvas.height = 1;
      this.scratchCanvas = null;
    }
  }
}
