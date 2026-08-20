export const EDITOR_CANVAS_TOOLS = [
  "paint",
  "erase",
  "blend",
  "fill",
  "pan",
  "selection",
  "transform",
  "warp",
  "perspective",
] as const;

export type EditorCanvasTool = (typeof EDITOR_CANVAS_TOOLS)[number];

export const EDITOR_TOOL_SETTINGS_KINDS = [
  "fill",
  "selection",
  "transform",
  "warp",
  "perspective",
  "svg-style",
  "text",
  "text-warp",
  "text-outline",
  "text-drop-shadow",
  "text-inner-shadow",
  "text-block-shadow",
] as const;

export type EditorToolSettingsKind = (typeof EDITOR_TOOL_SETTINGS_KINDS)[number];

export const EDITOR_VECTOR_COMMANDS = ["import-svg", "import-image"] as const;

export type EditorVectorCommand = (typeof EDITOR_VECTOR_COMMANDS)[number];

export const EDITOR_RASTER_EFFECT_KINDS = NON_DESTRUCTIVE_RASTER_EFFECT_KINDS;

export type EditorRasterEffectKind = NonDestructiveRasterEffectKind;

function includesValue<T extends string>(
  values: readonly T[],
  value: string | undefined,
): value is T {
  return value !== undefined && (values as readonly string[]).includes(value);
}

export function isEditorCanvasTool(
  value: string | undefined,
): value is EditorCanvasTool {
  return includesValue(EDITOR_CANVAS_TOOLS, value);
}

export function isEditorToolSettingsKind(
  value: string | undefined,
): value is EditorToolSettingsKind {
  return includesValue(EDITOR_TOOL_SETTINGS_KINDS, value);
}

export function isEditorVectorCommand(
  value: string | undefined,
): value is EditorVectorCommand {
  return includesValue(EDITOR_VECTOR_COMMANDS, value);
}

export function isEditorRasterEffectKind(
  value: string | undefined,
): value is EditorRasterEffectKind {
  return isNonDestructiveRasterEffectKind(value);
}
import {
  NON_DESTRUCTIVE_RASTER_EFFECT_KINDS,
  isNonDestructiveRasterEffectKind,
  type NonDestructiveRasterEffectKind,
} from "./raster-effects-contract.ts";
