export interface DocumentBackgroundState {
  readonly visible: boolean;
  readonly color: string;
}

export const DEFAULT_DOCUMENT_BACKGROUND = Object.freeze({
  visible: true,
  color: "#ffffff",
}) satisfies DocumentBackgroundState;

export function normalizeDocumentBackgroundColor(
  color: string,
  fallback: string = DEFAULT_DOCUMENT_BACKGROUND.color,
): string {
  const normalized = color.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
}

export function normalizeDocumentBackground(
  state: Partial<DocumentBackgroundState> | null | undefined,
): DocumentBackgroundState {
  return {
    visible: state?.visible === undefined
      ? DEFAULT_DOCUMENT_BACKGROUND.visible
      : Boolean(state.visible),
    color: normalizeDocumentBackgroundColor(
      state?.color ?? DEFAULT_DOCUMENT_BACKGROUND.color,
    ),
  };
}

export function documentBackgroundSrgb(
  color: string,
): readonly [number, number, number] {
  const normalized = normalizeDocumentBackgroundColor(color);
  return [
    Number.parseInt(normalized.slice(1, 3), 16) / 255,
    Number.parseInt(normalized.slice(3, 5), 16) / 255,
    Number.parseInt(normalized.slice(5, 7), 16) / 255,
  ];
}

function srgbChannelToLinear(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

export function documentBackgroundLinearPremultiplied(
  state: DocumentBackgroundState,
): readonly [number, number, number, number] {
  if (!state.visible) return [0, 0, 0, 0];
  const [red, green, blue] = documentBackgroundSrgb(state.color);
  return [
    srgbChannelToLinear(red),
    srgbChannelToLinear(green),
    srgbChannelToLinear(blue),
    1,
  ];
}

/** Returns the background in the encoded-sRGB premultiplied storage contract. */
export function documentBackgroundEncodedSrgbPremultiplied(
  state: DocumentBackgroundState,
): readonly [number, number, number, number] {
  if (!state.visible) return [0, 0, 0, 0];
  const [red, green, blue] = documentBackgroundSrgb(state.color);
  return [red, green, blue, 1];
}
