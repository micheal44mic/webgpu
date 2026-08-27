export const EDITOR_FILTER_KINDS = [
  "glass",
  "curves",
  "color-adjust",
  "color-balance",
] as const;

export type EditorFilterKind = (typeof EDITOR_FILTER_KINDS)[number];

export function isEditorFilterKind(
  value: string | undefined,
): value is EditorFilterKind {
  return value !== undefined
    && (EDITOR_FILTER_KINDS as readonly string[]).includes(value);
}
