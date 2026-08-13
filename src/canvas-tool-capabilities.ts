import type { BrushTool } from "./engine-types";
import type { EditorCanvasInteractionTool } from "./editor-tools-contract";
import type { RasterStrokeOperation } from "./raster-stroke-operation";

export type CanvasPointerInteraction =
  | "raster-stroke"
  | "fill"
  | "selection"
  | "transform"
  | "liquify";

export type BrushQuickControlsMode = "paint" | "eraser" | "blend" | null;

/**
 * One authoritative description of how an editor tool reaches the canvas.
 *
 * Keep product identity (for example Eraser) separate from persisted brush
 * settings and from the lower-level pointer mode. Future canvas tools should
 * be added here first so input, quick controls and BrushEngine wiring cannot
 * silently disagree.
 */
export interface CanvasToolCapabilities {
  readonly pointerInteraction: CanvasPointerInteraction;
  readonly brushTool: BrushTool | null;
  readonly rasterStrokeOperation: RasterStrokeOperation | null;
  readonly quickControls: BrushQuickControlsMode;
  readonly holdsTouchPaintIntent: boolean;
  readonly recordsPaintExtension: boolean;
}

const CANVAS_TOOL_CAPABILITIES = {
  paint: {
    pointerInteraction: "raster-stroke",
    brushTool: "paint",
    rasterStrokeOperation: "paint",
    quickControls: "paint",
    holdsTouchPaintIntent: true,
    recordsPaintExtension: true,
  },
  eraser: {
    pointerInteraction: "raster-stroke",
    brushTool: "paint",
    rasterStrokeOperation: "erase",
    quickControls: "eraser",
    holdsTouchPaintIntent: true,
    recordsPaintExtension: false,
  },
  blend: {
    pointerInteraction: "raster-stroke",
    brushTool: "blend",
    rasterStrokeOperation: "paint",
    quickControls: "blend",
    holdsTouchPaintIntent: false,
    recordsPaintExtension: true,
  },
  fill: {
    pointerInteraction: "fill",
    brushTool: null,
    rasterStrokeOperation: null,
    quickControls: null,
    holdsTouchPaintIntent: false,
    recordsPaintExtension: false,
  },
  selection: {
    pointerInteraction: "selection",
    brushTool: null,
    rasterStrokeOperation: null,
    quickControls: null,
    holdsTouchPaintIntent: false,
    recordsPaintExtension: false,
  },
  transform: {
    pointerInteraction: "transform",
    brushTool: null,
    rasterStrokeOperation: null,
    quickControls: null,
    holdsTouchPaintIntent: false,
    recordsPaintExtension: false,
  },
  liquify: {
    pointerInteraction: "liquify",
    brushTool: null,
    rasterStrokeOperation: null,
    quickControls: null,
    holdsTouchPaintIntent: false,
    recordsPaintExtension: false,
  },
} as const satisfies Readonly<
  Record<EditorCanvasInteractionTool, CanvasToolCapabilities>
>;

export function canvasToolCapabilities(
  tool: EditorCanvasInteractionTool,
): CanvasToolCapabilities {
  return CANVAS_TOOL_CAPABILITIES[tool];
}
