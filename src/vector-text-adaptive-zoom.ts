export const VECTOR_TEXT_ADAPTIVE_ZOOM_STRATEGY =
  "exact-until-frame-pressure-then-frozen-viewport-gpu-reprojection-idle-reraster-v1" as const;

export const VECTOR_TEXT_ADAPTIVE_ZOOM_SLOW_RENDER_MS = 20;
export const VECTOR_TEXT_ADAPTIVE_ZOOM_SLOW_END_TO_END_MS = 36;
export const VECTOR_TEXT_ADAPTIVE_ZOOM_SEVERE_RENDER_MS = 40;
export const VECTOR_TEXT_ADAPTIVE_ZOOM_SEVERE_END_TO_END_MS = 60;
export const VECTOR_TEXT_ADAPTIVE_ZOOM_SLOW_FRAME_COUNT = 2;
export const VECTOR_TEXT_ADAPTIVE_ZOOM_SETTLE_MS = 250;

export interface VectorTextZoomFrameSample {
  readonly renderMs: number;
  readonly endToEndMs: number;
}

export interface VectorTextZoomFrameAssessment {
  readonly slow: boolean;
  readonly severe: boolean;
  readonly slowFrameStreak: number;
  readonly shouldArmFastMode: boolean;
}

/**
 * The detector observes only exact view rerenders. Normal text edits and scene
 * mutations never enter this state machine, so a heavy effect change cannot
 * accidentally lower the quality of a later zoom.
 */
export class VectorTextAdaptiveZoomDetector {
  private slowFrameStreak = 0;

  observe(sample: VectorTextZoomFrameSample): VectorTextZoomFrameAssessment {
    const renderMs = Number.isFinite(sample.renderMs)
      ? Math.max(0, sample.renderMs)
      : Number.POSITIVE_INFINITY;
    const endToEndMs = Number.isFinite(sample.endToEndMs)
      ? Math.max(0, sample.endToEndMs)
      : Number.POSITIVE_INFINITY;
    const severe =
      renderMs >= VECTOR_TEXT_ADAPTIVE_ZOOM_SEVERE_RENDER_MS
      || endToEndMs >= VECTOR_TEXT_ADAPTIVE_ZOOM_SEVERE_END_TO_END_MS;
    const slow =
      severe
      || renderMs >= VECTOR_TEXT_ADAPTIVE_ZOOM_SLOW_RENDER_MS
      || endToEndMs >= VECTOR_TEXT_ADAPTIVE_ZOOM_SLOW_END_TO_END_MS;

    if (severe) {
      this.slowFrameStreak = VECTOR_TEXT_ADAPTIVE_ZOOM_SLOW_FRAME_COUNT;
    } else if (slow) {
      this.slowFrameStreak += 1;
    } else {
      this.slowFrameStreak = 0;
    }

    return {
      slow,
      severe,
      slowFrameStreak: this.slowFrameStreak,
      shouldArmFastMode:
        this.slowFrameStreak >= VECTOR_TEXT_ADAPTIVE_ZOOM_SLOW_FRAME_COUNT,
    };
  }

  reset(): void {
    this.slowFrameStreak = 0;
  }

  get streak(): number {
    return this.slowFrameStreak;
  }
}
