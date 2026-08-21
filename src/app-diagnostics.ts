/**
 * Bounded, content-free diagnostics for failures that happen on mobile where
 * the browser console is not available. The log deliberately stores ids,
 * operation kinds and document order, never raster bytes or text/SVG source.
 */
import type { EngineStats } from "./engine-stats";
import type { HistoryAction } from "./engine-history-types";
import type { HistoryState } from "./engine-types";
import { assertValidMixedSceneOrder } from "./mixed-scene-reorder-core.ts";

export const APP_DIAGNOSTIC_SCHEMA = "webgpu-brush-session-diagnostic-v2" as const;
export const APP_DIAGNOSTIC_EVENT_LIMIT = 30;

export interface AppDiagnosticError {
  readonly name: string;
  readonly message: string;
  readonly stack: string | null;
}

export interface AppDiagnosticState {
  readonly history: {
    readonly cursor: number;
    readonly actionCount: number;
    readonly busy: boolean;
    readonly inconsistent: boolean;
    readonly openEdit: HistoryState["openEdit"];
    readonly canUndo: boolean;
    readonly canRedo: boolean;
    readonly undoBlockedReason: string | null;
    readonly redoBlockedReason: string | null;
  };
  readonly scene: {
    readonly selectedKey: string | null;
    readonly activeRasterLayerId: number;
    readonly bottomUpKeys: readonly string[];
  };
  readonly rasterLayers: readonly {
    readonly id: number;
    readonly index: number;
    readonly visible: boolean;
    readonly clippingParentId: number | null;
    readonly hasContent: boolean;
    readonly storage: "hot" | "cold" | "compressed" | "empty";
  }[];
  readonly memory: {
    readonly governorZone: string;
    readonly registeredCurrentMiB: number;
    readonly countedTotalMiB: number;
    readonly compressedCpuMiB: number;
    readonly countedGpuPlusCompressedCpuMiB: number;
  };
}

export interface AppDiagnosticEvent {
  readonly sequence: number;
  readonly capturedAt: string;
  readonly category: "history" | "scene" | "operation" | "error" | "status";
  readonly name: string;
  readonly detail: string | null;
  readonly error: AppDiagnosticError | null;
  readonly state: AppDiagnosticState | null;
}

export interface AppDiagnosticEventInput {
  readonly category: AppDiagnosticEvent["category"];
  readonly name: string;
  readonly detail?: string | null;
  readonly error?: unknown;
  readonly state?: AppDiagnosticState | null;
}

function truncateDiagnosticText(value: string, maximum = 8_000): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}… [truncated]`;
}

export function describeAppDiagnosticError(error: unknown): AppDiagnosticError {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: truncateDiagnosticText(error.message || String(error)),
      stack: error.stack ? truncateDiagnosticText(error.stack) : null,
    };
  }
  if (
    typeof error === "object"
    && error !== null
    && "message" in error
    && typeof error.message === "string"
  ) {
    return {
      name: "name" in error && typeof error.name === "string" ? error.name : "Error",
      message: truncateDiagnosticText(error.message),
      stack: "stack" in error && typeof error.stack === "string"
        ? truncateDiagnosticText(error.stack)
        : null,
    };
  }
  return {
    name: "NonError",
    message: truncateDiagnosticText(String(error)),
    stack: null,
  };
}

/** Fixed-size FIFO: at 30 entries it remains negligible even after hours. */
export class BoundedAppDiagnosticLog {
  private readonly events: AppDiagnosticEvent[] = [];
  private readonly limit: number;
  private nextSequence = 1;

  constructor(limit = APP_DIAGNOSTIC_EVENT_LIMIT) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("The diagnostics limit must be a positive integer.");
    }
    this.limit = limit;
  }

  record(input: AppDiagnosticEventInput): AppDiagnosticEvent {
    const event: AppDiagnosticEvent = {
      sequence: this.nextSequence,
      capturedAt: new Date().toISOString(),
      category: input.category,
      name: truncateDiagnosticText(input.name, 240),
      detail: input.detail ? truncateDiagnosticText(input.detail, 2_000) : null,
      error: input.error === undefined ? null : describeAppDiagnosticError(input.error),
      state: input.state ?? null,
    };
    this.nextSequence += 1;
    if (this.events.length === this.limit) this.events.shift();
    this.events.push(event);
    return event;
  }

  snapshot(): readonly AppDiagnosticEvent[] {
    return this.events.map((event) => ({ ...event }));
  }
}

export function captureAppDiagnosticState(
  stats: EngineStats,
  history: HistoryState,
): AppDiagnosticState {
  const memoryById = new Map(stats.gpuMemory.layers.map((layer) => [layer.id, layer.state]));
  return {
    history: {
      cursor: history.cursor,
      actionCount: history.actionCount,
      busy: history.busy,
      inconsistent: history.inconsistent,
      openEdit: history.openEdit,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      undoBlockedReason: history.undoBlockedReason,
      redoBlockedReason: history.redoBlockedReason,
    },
    scene: {
      selectedKey: stats.mixedScene?.selectedKey ?? null,
      activeRasterLayerId: stats.activeLayerId,
      bottomUpKeys: stats.mixedScene?.items.map((item) => item.key) ??
        stats.layers.map((layer) => `raster:${layer.id}`),
    },
    rasterLayers: stats.layers.map((layer, index) => ({
      id: layer.id,
      index,
      visible: layer.visible,
      clippingParentId: layer.clippingParentId,
      hasContent: layer.hasContent,
      storage: memoryById.get(layer.id) ?? "empty",
    })),
    memory: {
      governorZone: stats.gpuMemory.governorZone,
      registeredCurrentMiB: stats.gpuMemory.registeredCurrentMiB,
      countedTotalMiB: stats.gpuMemory.countedTotalMiB,
      compressedCpuMiB: stats.gpuMemory.layerCompressedCpuMiB,
      countedGpuPlusCompressedCpuMiB: stats.gpuMemory.countedGpuPlusCompressedCpuMiB,
    },
  };
}

export interface AppDiagnosticInvariantReport {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

/**
 * Checks the CPU models only. It performs no GPU work and is therefore safe to
 * run from the Copy button even after the editor has latched itself read-only.
 */
export function inspectAppDiagnosticInvariants(
  stats: EngineStats,
  history: HistoryState,
): AppDiagnosticInvariantReport {
  const issues: string[] = [];
  if (history.cursor < 0 || history.cursor > history.actionCount) {
    issues.push(
      `History cursor ${history.cursor} is outside 0..${history.actionCount}.`,
    );
  }
  const layerIds = stats.layers.map((layer) => layer.id);
  if (new Set(layerIds).size !== layerIds.length) {
    issues.push("LayerStack contains duplicate raster IDs.");
  }
  if (!layerIds.includes(stats.activeLayerId)) {
    issues.push(`Active raster ${stats.activeLayerId} is missing from LayerStack.`);
  }
  if (stats.referenceLayerId !== null && !layerIds.includes(stats.referenceLayerId)) {
    issues.push(`Reference raster ${stats.referenceLayerId} is missing from LayerStack.`);
  }

  const scene = stats.mixedScene;
  if (scene) {
    const keys = scene.items.map((item) => item.key);
    try {
      assertValidMixedSceneOrder(
        keys,
        stats.layers.map((layer) => ({
          id: layer.id,
          clippingParentId: layer.clippingParentId,
        })),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`Scene invariant: ${message}`);
    }
    if (scene.activeRasterLayerId !== stats.activeLayerId) {
      issues.push(
        `Scene active raster ${scene.activeRasterLayerId} differs from engine raster `
        + `${stats.activeLayerId}.`,
      );
    }
    const selected = scene.items.find((item) => item.key === scene.selectedKey);
    if (!selected) {
      issues.push(`Selection ${scene.selectedKey} is missing from the scene.`);
    } else if (
      selected.kind === "raster"
      && selected.rasterLayerId !== stats.activeLayerId
    ) {
      issues.push(
        `Selected raster ${selected.rasterLayerId} differs from active raster `
        + `${stats.activeLayerId}.`,
      );
    }
    for (const item of scene.items) {
      if (item.kind !== "raster") continue;
      const layer = stats.layers[item.rasterLayerIndex];
      if (!layer || layer.id !== item.rasterLayerId) {
        issues.push(
          `Scene index for raster ${item.rasterLayerId} points to `
          + `${layer?.id ?? "no layer"}.`,
        );
      } else if (item.rasterClippingParentId !== layer.clippingParentId) {
        issues.push(`Clipping parent differs for raster ${item.rasterLayerId}.`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

function historyVectorTransition(action: Extract<HistoryAction, { kind: "vector" }>) {
  return {
    key: action.delta.after.key,
    beforeIndex: action.delta.before.index,
    afterIndex: action.delta.after.index,
    beforePresent: action.delta.before.node !== null,
    afterPresent: action.delta.after.node !== null,
    selectedBefore: action.delta.before.selectedKey,
    selectedAfter: action.delta.after.selectedKey,
  };
}

/** Converts History GPU-owning actions to small JSON-safe metadata. */
export function summarizeAppDiagnosticHistoryAction(
  action: HistoryAction,
  index: number,
  cursor: number,
): Readonly<Record<string, unknown>> {
  const common = {
    index,
    side: index < cursor ? "applied" : "redo",
    id: action.id,
    kind: action.kind,
  };
  switch (action.kind) {
    case "stroke":
    case "fill":
    case "clear":
      return { ...common, layerId: action.layerId };
    case "vector":
      return { ...common, ...historyVectorTransition(action) };
    case "document-background":
      return {
        ...common,
        before: action.before,
        after: action.after,
      };
    case "layer-blend-mode":
      return {
        ...common,
        layerId: action.layerId,
        before: action.before,
        after: action.after,
      };
    case "layer-metadata":
      return { ...common, layerId: action.layerId, property: action.property };
    case "scene-reorder":
      return {
        ...common,
        beforeKeys: action.before.bottomUpKeys,
        afterKeys: action.after.bottomUpKeys,
        beforeRasterIds: action.before.rasterLayerIds,
        afterRasterIds: action.after.rasterLayerIds,
      };
    case "vector-rasterize":
      return {
        ...common,
        sourceKind: action.sourceKind,
        sourceKey: action.vectorState.key,
        outputLayerId: action.layerRecord.id,
        rasterLayerIndex: action.rasterLayerIndex,
        activeRasterLayerIdBefore: action.activeRasterLayerIdBefore,
      };
    case "raster-import":
      return {
        ...common,
        outputLayerId: action.layerRecord.id,
        rasterLayerIndex: action.rasterLayerIndex,
        sceneIndex: action.sceneIndex,
        selectedKeyBefore: action.selectedKeyBefore,
        source: {
          mimeType: action.source.mimeType,
          width: action.source.width,
          height: action.source.height,
        },
      };
    case "raster-transform":
      return {
        ...common,
        layerId: action.layerId,
        scope: action.scope,
        filterStrategy: action.filterStrategy,
        baseBounds: action.baseBounds,
      };
    case "raster-filter":
      return {
        ...common,
        layerId: action.layerId,
        filter: action.filter,
        baseBounds: action.baseBounds,
      };
    case "layer-add":
      return {
        ...common,
        creation: action.creation,
        sourceLayerId: action.sourceLayerId,
        outputLayerId: action.layerRecord.id,
        rasterLayerIndex: action.rasterLayerIndex,
        sceneIndex: action.sceneIndex,
        clippingParentId: action.clippingParentId,
        selectedKeyBefore: action.selectedKeyBefore,
      };
    case "layer-delete":
      return {
        ...common,
        deleted: action.entries.map((entry) => ({
          layerId: entry.layerRecord.id,
          rasterLayerIndex: entry.rasterLayerIndex,
          sceneIndex: entry.sceneIndex,
          clippingParentId: entry.clippingParentId,
        })),
        selectedKeyBefore: action.selectedKeyBefore,
        selectedKeyAfter: action.selectedKeyAfter,
      };
    case "layer-merge":
      return {
        ...common,
        inputKeys: action.inputs.map((input) => input.key),
        outputLayerId: action.output.layerRecord.id,
        outputRasterLayerIndex: action.output.rasterLayerIndex,
        outputSceneIndex: action.output.sceneIndex,
        selectedKeyBefore: action.selectedKeyBefore,
        selectedKeyAfter: action.selectedKeyAfter,
      };
  }
}

export function summarizeAppDiagnosticHistoryWindow(
  actions: readonly HistoryAction[],
  cursor: number,
  maximum = APP_DIAGNOSTIC_EVENT_LIMIT,
): readonly Readonly<Record<string, unknown>>[] {
  const normalizedCursor = Number.isInteger(cursor)
    ? Math.min(actions.length, Math.max(0, cursor))
    : 0;
  const end = Math.min(actions.length, normalizedCursor + 3);
  const start = Math.max(0, end - maximum);
  return actions.slice(start, end).map((action, offset) =>
    summarizeAppDiagnosticHistoryAction(action, start + offset, normalizedCursor)
  );
}
