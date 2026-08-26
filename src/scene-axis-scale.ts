/**
 * Backward-compatible axis-scale contract for semantic scene nodes.
 *
 * `scale` remains the horizontal compatibility alias. Older documents that
 * only contain `scale` resolve to a uniform transform, while newer documents
 * can retain independent horizontal and vertical values.
 */
export interface SceneAxisScale {
  readonly scale: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
}

export interface NormalizedSceneAxisScale extends SceneAxisScale {
  readonly scale: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export type SceneAxisScaleUpdate = Partial<SceneAxisScale>;

export function sceneScaleX(value: Readonly<SceneAxisScale>): number {
  return value.scaleX ?? value.scale;
}

export function sceneScaleY(value: Readonly<SceneAxisScale>): number {
  return value.scaleY ?? value.scale;
}

export function normalizeSceneAxisScale(
  value: Readonly<SceneAxisScale>,
): NormalizedSceneAxisScale {
  const scaleX = sceneScaleX(value);
  return {
    scale: scaleX,
    scaleX,
    scaleY: sceneScaleY(value),
  };
}

/**
 * Applies a partial update without making legacy uniform callers aware of the
 * axis fields. A legacy `scale` update changes both axes; explicit axis values
 * take precedence in the same update.
 */
export function updateSceneAxisScale(
  current: Readonly<SceneAxisScale>,
  update: Readonly<SceneAxisScaleUpdate>,
): NormalizedSceneAxisScale {
  const uniform = update.scale;
  const scaleX = update.scaleX ?? uniform ?? sceneScaleX(current);
  const scaleY = update.scaleY ?? uniform ?? sceneScaleY(current);
  return { scale: scaleX, scaleX, scaleY };
}
