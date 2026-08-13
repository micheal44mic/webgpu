/**
 * Compatibility seam for the name used while the mixed scene was still an
 * experiment. Production code must use `mixedSceneEnabled`; only persisted or
 * third-party option bags may still reach the legacy field here.
 */
export interface MixedSceneEnablementOptions {
  readonly mixedSceneEnabled?: boolean;
  readonly vectorTextPrototypeEnabled?: boolean;
}

export function resolveMixedSceneEnabled(
  options: Readonly<MixedSceneEnablementOptions>,
  fallback = false,
): boolean {
  return options.mixedSceneEnabled
    ?? options.vectorTextPrototypeEnabled
    ?? fallback;
}
