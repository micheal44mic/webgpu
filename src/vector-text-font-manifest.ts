export interface VectorTextFontManifestEntry {
  readonly family: string;
  readonly label: string;
  readonly fileUrl: URL;
  readonly weight: string;
}

/** Lightweight source registry shared by Home preloading and text geometry. */
export const VECTOR_TEXT_FONT_MANIFEST: readonly VectorTextFontManifestEntry[] = [
  {
    family: "Anton",
    label: "Anton / Condensed",
    fileUrl: new URL("../assets/vector-text-fonts/Anton-Regular.ttf", import.meta.url),
    weight: "400",
  },
  {
    family: "Bebas Neue",
    label: "Bebas Neue",
    fileUrl: new URL("../assets/vector-text-fonts/BebasNeue-Regular.ttf", import.meta.url),
    weight: "400",
  },
  {
    family: "Poppins",
    label: "Poppins",
    fileUrl: new URL("../assets/vector-text-fonts/Poppins-Regular.ttf", import.meta.url),
    weight: "400",
  },
] as const;

