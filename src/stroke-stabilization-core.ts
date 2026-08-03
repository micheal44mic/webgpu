/**
 * Causal, allocation-free position stabilization for Paint input samples.
 *
 * The authoritative centreline is a first-order exponential moving average
 * integrated exactly for the linear motion between two input samples. Its
 * time constant makes the spatial lag grow with pointer speed. Recent samples
 * stay revisionable: their displayed position blends from the filtered
 * centreline to the raw input with a cubic smoothstep, so the newest point is
 * always exactly under the pointer while the mature prefix remains fully
 * stabilized.
 *
 * The class only plans geometry. Callers must keep `tail*` revisionable (for
 * example in a WebGPU overlay) and commit only `mature*` to permanent pixels.
 * Committing tail points eagerly would defeat stabilization because a later
 * update is allowed to move them.
 */

export const STROKE_STABILIZATION_STRATEGY =
  "causal-linear-input-ema-speed-lag-mature-prefix-smoothstep-revision-tail-endpoint-exact-v1" as const;

export const STROKE_STABILIZATION_MAXIMUM_TIME_CONSTANT_MS = 160;
export const STROKE_STABILIZATION_DEFAULT_CAPACITY = 1024;

const MINIMUM_CAPACITY = 4;

export interface StrokeStabilizationSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly timeMs: number;
}

/**
 * Reused view returned by begin/push/finish. Its typed-array contents remain
 * valid only until the next call on the same stabilizer.
 */
export interface StrokeStabilizationUpdate {
  bypassed: boolean;
  finished: boolean;
  amount: number;
  timeConstantMs: number;
  tailDurationMs: number;
  latestSequence: number;
  bypassX: number;
  bypassY: number;
  bypassPressure: number;
  bypassTimeMs: number;
  matureCount: number;
  forcedMatureCount: number;
  readonly matureX: Float64Array;
  readonly matureY: Float64Array;
  readonly maturePressure: Float64Array;
  readonly matureTimeMs: Float64Array;
  readonly matureSequence: Float64Array;
  tailCount: number;
  readonly tailX: Float64Array;
  readonly tailY: Float64Array;
  readonly tailPressure: Float64Array;
  readonly tailTimeMs: Float64Array;
  readonly tailSequence: Float64Array;
  readonly tailRawX: Float64Array;
  readonly tailRawY: Float64Array;
  readonly tailFilteredX: Float64Array;
  readonly tailFilteredY: Float64Array;
  readonly tailWeight: Float64Array;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeStrokeStabilizationAmount(amount: number): number {
  return Number.isFinite(amount) ? clamp(amount, 0, 1) : 0;
}

export function strokeStabilizationTimeConstantMs(amount: number): number {
  const normalized = normalizeStrokeStabilizationAmount(amount);
  return STROKE_STABILIZATION_MAXIMUM_TIME_CONSTANT_MS
    * normalized * normalized;
}

/** Cubic Hermite 0 -> 1 with zero first derivative at both boundaries. */
export function strokeStabilizationSmoothstep(progress: number): number {
  const normalized = clamp(progress, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

/**
 * Computes `x - (1 - exp(-x))` without losing the small positive remainder
 * to cancellation when x is close to zero.
 */
function linearInputAdvanceFactor(normalizedDelta: number): number {
  if (normalizedDelta < 1e-3) {
    const squared = normalizedDelta * normalizedDelta;
    return squared * (
      0.5
      + normalizedDelta * (
        -1 / 6
        + normalizedDelta * (
          1 / 24
          - normalizedDelta / 120
        )
      )
    );
  }
  return normalizedDelta + Math.expm1(-normalizedDelta);
}

export class CausalFadedStrokeStabilizer {
  readonly capacity: number;
  readonly update: StrokeStabilizationUpdate;

  private readonly rawX: Float64Array;
  private readonly rawY: Float64Array;
  private readonly filteredX: Float64Array;
  private readonly filteredY: Float64Array;
  private readonly pressure: Float64Array;
  private readonly timeMs: Float64Array;
  private readonly sequence: Float64Array;

  private head = 0;
  private count = 0;
  private active = false;
  private bypassed = true;
  private amount = 0;
  private timeConstantMs = 0;
  private tailDurationMs = 0;
  private latestSequence = 0;
  private lastRawX = 0;
  private lastRawY = 0;
  private lastFilteredX = 0;
  private lastFilteredY = 0;
  private lastPressure = 1;
  private lastTimeMs = 0;
  private seamX = 0;
  private seamY = 0;
  private seamPressure = 1;
  private seamTimeMs = 0;
  private seamSequence = 0;

  constructor(capacity = STROKE_STABILIZATION_DEFAULT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < MINIMUM_CAPACITY) {
      throw new RangeError(
        `La capacità della stabilizzazione deve essere un intero >= ${MINIMUM_CAPACITY}.`,
      );
    }
    this.capacity = capacity;
    this.rawX = new Float64Array(capacity);
    this.rawY = new Float64Array(capacity);
    this.filteredX = new Float64Array(capacity);
    this.filteredY = new Float64Array(capacity);
    this.pressure = new Float64Array(capacity);
    this.timeMs = new Float64Array(capacity);
    this.sequence = new Float64Array(capacity);

    this.update = {
      bypassed: true,
      finished: false,
      amount: 0,
      timeConstantMs: 0,
      tailDurationMs: 0,
      latestSequence: 0,
      bypassX: 0,
      bypassY: 0,
      bypassPressure: 1,
      bypassTimeMs: 0,
      matureCount: 0,
      forcedMatureCount: 0,
      matureX: new Float64Array(capacity),
      matureY: new Float64Array(capacity),
      maturePressure: new Float64Array(capacity),
      matureTimeMs: new Float64Array(capacity),
      matureSequence: new Float64Array(capacity),
      tailCount: 0,
      tailX: new Float64Array(capacity + 1),
      tailY: new Float64Array(capacity + 1),
      tailPressure: new Float64Array(capacity + 1),
      tailTimeMs: new Float64Array(capacity + 1),
      tailSequence: new Float64Array(capacity + 1),
      tailRawX: new Float64Array(capacity + 1),
      tailRawY: new Float64Array(capacity + 1),
      tailFilteredX: new Float64Array(capacity + 1),
      tailFilteredY: new Float64Array(capacity + 1),
      tailWeight: new Float64Array(capacity + 1),
    };
  }

  begin(
    sample: Readonly<StrokeStabilizationSample>,
    amount: number,
  ): Readonly<StrokeStabilizationUpdate> {
    this.active = true;
    this.head = 0;
    this.count = 0;
    this.amount = normalizeStrokeStabilizationAmount(amount);
    this.timeConstantMs = strokeStabilizationTimeConstantMs(this.amount);
    this.tailDurationMs = this.timeConstantMs;
    this.bypassed = this.amount === 0;
    this.latestSequence = 0;
    this.lastRawX = sample.x;
    this.lastRawY = sample.y;
    this.lastFilteredX = sample.x;
    this.lastFilteredY = sample.y;
    this.lastPressure = sample.pressure;
    this.lastTimeMs = sample.timeMs;
    this.seamX = sample.x;
    this.seamY = sample.y;
    this.seamPressure = sample.pressure;
    this.seamTimeMs = sample.timeMs;
    this.seamSequence = 0;

    this.resetUpdate(
      sample.x,
      sample.y,
      sample.pressure,
      sample.timeMs,
      false,
    );
    if (!this.bypassed) {
      this.rebuildTail();
    }
    return this.update;
  }

  push(
    sample: Readonly<StrokeStabilizationSample>,
  ): Readonly<StrokeStabilizationUpdate> {
    if (!this.active) {
      throw new Error("Stabilizzazione non inizializzata: chiamare begin() prima di push().");
    }

    const normalizedTimeMs = Math.max(
      this.lastTimeMs,
      Number.isFinite(sample.timeMs) ? sample.timeMs : this.lastTimeMs,
    );
    this.latestSequence += 1;
    this.resetUpdate(
      sample.x,
      sample.y,
      sample.pressure,
      normalizedTimeMs,
      false,
    );

    if (this.bypassed) {
      this.lastRawX = sample.x;
      this.lastRawY = sample.y;
      this.lastFilteredX = sample.x;
      this.lastFilteredY = sample.y;
      this.lastPressure = sample.pressure;
      this.lastTimeMs = normalizedTimeMs;
      return this.update;
    }

    const deltaTimeMs = normalizedTimeMs - this.lastTimeMs;
    let nextFilteredX = this.lastFilteredX;
    let nextFilteredY = this.lastFilteredY;
    if (deltaTimeMs > 0) {
      const normalizedDelta = deltaTimeMs / this.timeConstantMs;
      const oneMinusDecay = -Math.expm1(-normalizedDelta);
      const advanceMs = this.timeConstantMs
        * linearInputAdvanceFactor(normalizedDelta);
      const velocityX = (sample.x - this.lastRawX) / deltaTimeMs;
      const velocityY = (sample.y - this.lastRawY) / deltaTimeMs;
      nextFilteredX = this.lastFilteredX
        + (this.lastRawX - this.lastFilteredX) * oneMinusDecay
        + velocityX * advanceMs;
      nextFilteredY = this.lastFilteredY
        + (this.lastRawY - this.lastFilteredY) * oneMinusDecay
        + velocityY * advanceMs;
    }

    if (this.count === this.capacity) {
      this.promoteHead(true);
    }
    const writeIndex = (this.head + this.count) % this.capacity;
    this.rawX[writeIndex] = sample.x;
    this.rawY[writeIndex] = sample.y;
    this.filteredX[writeIndex] = nextFilteredX;
    this.filteredY[writeIndex] = nextFilteredY;
    this.pressure[writeIndex] = sample.pressure;
    this.timeMs[writeIndex] = normalizedTimeMs;
    this.sequence[writeIndex] = this.latestSequence;
    this.count += 1;

    this.lastRawX = sample.x;
    this.lastRawY = sample.y;
    this.lastFilteredX = nextFilteredX;
    this.lastFilteredY = nextFilteredY;
    this.lastPressure = sample.pressure;
    this.lastTimeMs = normalizedTimeMs;

    while (
      this.count > 0
      && normalizedTimeMs - this.timeMs[this.head] >= this.tailDurationMs
    ) {
      this.promoteHead(false);
    }
    this.rebuildTail();
    return this.update;
  }

  /**
   * Finalizes exactly the geometry shown by the latest update. It deliberately
   * does not age the tail with pointer-up time or pull the centreline to raw.
   */
  finish(): Readonly<StrokeStabilizationUpdate> {
    if (!this.active) {
      throw new Error("Stabilizzazione non inizializzata: chiamare begin() prima di finish().");
    }
    this.update.matureCount = 0;
    this.update.forcedMatureCount = 0;
    this.update.finished = true;
    this.update.bypassed = this.bypassed;
    this.update.latestSequence = this.latestSequence;
    if (!this.bypassed) {
      this.rebuildTail();
    }
    this.active = false;
    return this.update;
  }

  private resetUpdate(
    x: number,
    y: number,
    pressure: number,
    timeMs: number,
    finished: boolean,
  ): void {
    const update = this.update;
    update.bypassed = this.bypassed;
    update.finished = finished;
    update.amount = this.amount;
    update.timeConstantMs = this.timeConstantMs;
    update.tailDurationMs = this.tailDurationMs;
    update.latestSequence = this.latestSequence;
    update.bypassX = x;
    update.bypassY = y;
    update.bypassPressure = pressure;
    update.bypassTimeMs = timeMs;
    update.matureCount = 0;
    update.forcedMatureCount = 0;
    update.tailCount = 0;
  }

  private promoteHead(forced: boolean): void {
    const sourceIndex = this.head;
    const outputIndex = this.update.matureCount;
    this.update.matureX[outputIndex] = this.filteredX[sourceIndex];
    this.update.matureY[outputIndex] = this.filteredY[sourceIndex];
    this.update.maturePressure[outputIndex] = this.pressure[sourceIndex];
    this.update.matureTimeMs[outputIndex] = this.timeMs[sourceIndex];
    this.update.matureSequence[outputIndex] = this.sequence[sourceIndex];
    this.update.matureCount += 1;
    if (forced) {
      this.update.forcedMatureCount += 1;
    }

    this.seamX = this.filteredX[sourceIndex];
    this.seamY = this.filteredY[sourceIndex];
    this.seamPressure = this.pressure[sourceIndex];
    this.seamTimeMs = this.timeMs[sourceIndex];
    this.seamSequence = this.sequence[sourceIndex];
    this.head = (this.head + 1) % this.capacity;
    this.count -= 1;
  }

  private rebuildTail(): void {
    const update = this.update;
    // Slot 0 is a geometry anchor only. It is the already-authoritative seam
    // (and can equal the final entry of mature* in this same update); callers
    // continue spacing from it but must not emit it as a second stamp.
    update.tailX[0] = this.seamX;
    update.tailY[0] = this.seamY;
    update.tailPressure[0] = this.seamPressure;
    update.tailTimeMs[0] = this.seamTimeMs;
    update.tailSequence[0] = this.seamSequence;
    update.tailRawX[0] = this.seamX;
    update.tailRawY[0] = this.seamY;
    update.tailFilteredX[0] = this.seamX;
    update.tailFilteredY[0] = this.seamY;
    update.tailWeight[0] = 1;

    for (let offset = 0; offset < this.count; offset += 1) {
      const sourceIndex = (this.head + offset) % this.capacity;
      const outputIndex = offset + 1;
      const isLatest = offset === this.count - 1;
      const ageMs = isLatest
        ? 0
        : Math.max(0, this.lastTimeMs - this.timeMs[sourceIndex]);
      const weight = isLatest
        ? 0
        : strokeStabilizationSmoothstep(ageMs / this.tailDurationMs);
      const rawX = this.rawX[sourceIndex];
      const rawY = this.rawY[sourceIndex];
      const filteredX = this.filteredX[sourceIndex];
      const filteredY = this.filteredY[sourceIndex];

      update.tailX[outputIndex] = rawX + (filteredX - rawX) * weight;
      update.tailY[outputIndex] = rawY + (filteredY - rawY) * weight;
      update.tailPressure[outputIndex] = this.pressure[sourceIndex];
      update.tailTimeMs[outputIndex] = this.timeMs[sourceIndex];
      update.tailSequence[outputIndex] = this.sequence[sourceIndex];
      update.tailRawX[outputIndex] = rawX;
      update.tailRawY[outputIndex] = rawY;
      update.tailFilteredX[outputIndex] = filteredX;
      update.tailFilteredY[outputIndex] = filteredY;
      update.tailWeight[outputIndex] = weight;
    }
    update.tailCount = this.count + 1;
  }
}
