import type { BrushEngine } from "./brush-engine";
import { destroyLayerColdStorage } from "./engine-cold-storage";
import { rebuildActiveLayerFromHistory } from "./engine-history-runtime";
import type { RasterTransformHistoryAction } from "./engine-history-types";
import {
  beginRasterLayerTransform,
  cancelRasterLayerTransform,
  materializeRasterLayerTransformHistoryAction,
  updateRasterLayerTransform,
} from "./engine-raster-transform-runtime";
import {
  clearVectorTextPresentationForTransaction,
  publishMixedScene,
  requireMixedSceneStack,
} from "./engine-vector-text-runtime";
import type { MixedSceneGroupTransformUpdate } from "./mixed-scene-controller-contract";
import type { MixedSceneRasterTransformPreview } from "./mixed-scene-raster-transform-preview";
import type {
  MixedSceneItem,
  MixedSceneVectorHistoryDelta,
  MixedSceneVectorHistoryState,
  MixedSceneVectorKey,
} from "./mixed-scene-stack";
import { cloneRasterLayerSource, type RasterLayerSource } from "./raster-layer-source";

interface MixedSceneGroupRasterMember {
  readonly key: `raster:${number}`;
  readonly layerId: number;
  readonly pivotX: number;
  readonly pivotY: number;
  readonly rasterSourceBefore: RasterLayerSource | null;
  update: MixedSceneGroupTransformUpdate;
}

interface MixedSceneGroupSemanticMember {
  readonly key: MixedSceneVectorKey;
  readonly before: MixedSceneVectorHistoryState;
  update: MixedSceneGroupTransformUpdate;
}

export interface ActiveMixedSceneGroupTransformSession {
  readonly orderedKeys: readonly MixedSceneItem["key"][];
  readonly selectedKeyBefore: MixedSceneItem["key"];
  readonly activeRasterLayerIdBefore: number;
  readonly historyCursorBefore: number;
  readonly rasters: readonly MixedSceneGroupRasterMember[];
  readonly semantics: readonly MixedSceneGroupSemanticMember[];
  internalRasterOperation: boolean;
  terminal: boolean;
}

const MINIMUM_GROUP_SCALE = 0.0001;

function identityUpdate(
  key: MixedSceneItem["key"],
  x: number,
  y: number,
  scaleX = 1,
  scaleY = 1,
  rotation = 0,
): MixedSceneGroupTransformUpdate {
  return { key, x, y, scale: scaleX, scaleX, scaleY, rotation };
}

function normalizeGroupUpdate(
  value: Readonly<MixedSceneGroupTransformUpdate>,
): MixedSceneGroupTransformUpdate {
  const numeric = [
    value.x,
    value.y,
    value.scale,
    value.scaleX,
    value.scaleY,
    value.rotation,
  ];
  if (numeric.some((candidate) => !Number.isFinite(candidate))) {
    throw new RangeError(`Group Transform update ${value.key} must be finite.`);
  }
  if (
    Math.abs(value.scaleX) < MINIMUM_GROUP_SCALE
    || Math.abs(value.scaleY) < MINIMUM_GROUP_SCALE
  ) {
    throw new RangeError(`Group Transform update ${value.key} must remain invertible.`);
  }
  return { ...value };
}

function rasterPreview(
  member: Readonly<MixedSceneGroupRasterMember>,
): MixedSceneRasterTransformPreview {
  return {
    key: member.key,
    pivotX: member.pivotX,
    pivotY: member.pivotY,
    translationX: member.update.x - member.pivotX,
    translationY: member.update.y - member.pivotY,
    scaleX: member.update.scaleX,
    scaleY: member.update.scaleY,
    rotation: member.update.rotation,
  };
}

function rasterUpdateIsIdentity(member: Readonly<MixedSceneGroupRasterMember>): boolean {
  return Math.abs(member.update.x - member.pivotX) < 1e-7
    && Math.abs(member.update.y - member.pivotY) < 1e-7
    && Math.abs(member.update.scaleX - 1) < 1e-7
    && Math.abs(member.update.scaleY - 1) < 1e-7
    && Math.abs(member.update.rotation) < 1e-7;
}

/**
 * Converts the pivot used by the live group preview into the pivot owned by
 * the authoritative per-layer Transform. Both paths must describe the same
 * document-space affine even when their source pivots differ.
 */
export function mixedSceneGroupRasterMaterializationPivot(
  previewPivot: Readonly<{ x: number; y: number }>,
  sourcePivot: Readonly<{ x: number; y: number }>,
  update: Pick<
    MixedSceneGroupTransformUpdate,
    "x" | "y" | "scaleX" | "scaleY" | "rotation"
  >,
): { x: number; y: number } {
  const cosine = Math.cos(update.rotation);
  const sine = Math.sin(update.rotation);
  const deltaX = sourcePivot.x - previewPivot.x;
  const deltaY = sourcePivot.y - previewPivot.y;
  return {
    x: update.x
      + cosine * update.scaleX * deltaX
      - sine * update.scaleY * deltaY,
    y: update.y
      + sine * update.scaleX * deltaX
      + cosine * update.scaleY * deltaY,
  };
}

function publishSemanticMutation(engine: BrushEngine): void {
  engine.presentationCacheNeedsFullRebuild = true;
  engine.displayDirty = true;
  engine.requestRender();
  publishMixedScene(engine);
  engine.publishStats();
}

function restoreSemanticMembers(
  engine: BrushEngine,
  session: Readonly<ActiveMixedSceneGroupTransformSession>,
): void {
  const scene = requireMixedSceneStack(engine);
  const ordered = [...session.semantics].sort(
    (left, right) => left.before.index - right.before.index,
  );
  for (const member of ordered) scene.restoreVectorHistoryState(member.before);
  scene.select(session.selectedKeyBefore);
  clearVectorTextPresentationForTransaction(engine);
  publishSemanticMutation(engine);
}

async function runInternalRasterOperation<T>(
  session: ActiveMixedSceneGroupTransformSession,
  operation: () => Promise<T>,
): Promise<T> {
  session.internalRasterOperation = true;
  try {
    return await operation();
  } finally {
    session.internalRasterOperation = false;
  }
}

async function switchActiveRaster(
  engine: BrushEngine,
  session: ActiveMixedSceneGroupTransformSession,
  layerId: number,
): Promise<void> {
  const index = engine.layerStack.indexOfId(layerId);
  if (index < 0) throw new Error(`Group Transform raster ${layerId} is missing.`);
  if (index === engine.layerStack.activeIndex) return;
  await runInternalRasterOperation(session, async () => {
    await engine.setActiveLayer(index);
  });
}

function destroyUnpublishedRasterActions(
  actions: readonly RasterTransformHistoryAction[],
): void {
  for (const action of actions) destroyLayerColdStorage(action.seed);
}

async function restoreMaterializedRasters(
  engine: BrushEngine,
  session: ActiveMixedSceneGroupTransformSession,
  actions: readonly RasterTransformHistoryAction[],
): Promise<void> {
  if (engine.historyCursor !== session.historyCursorBefore) {
    throw new Error("History changed during the unpublished group Transform.");
  }
  if (engine.activeRasterTransformSession) {
    await runInternalRasterOperation(session, async () => {
      await cancelRasterLayerTransform(engine);
    });
  }
  for (const action of actions) {
    await switchActiveRaster(engine, session, action.layerId);
    const member = session.rasters.find((candidate) => candidate.layerId === action.layerId);
    if (!member) throw new Error(`Raster rollback state ${action.layerId} is missing.`);
    engine.layerStack.active.rasterSource = cloneRasterLayerSource(member.rasterSourceBefore);
    await runInternalRasterOperation(session, async () => {
      await rebuildActiveLayerFromHistory(engine);
    });
    engine.layerStack.active.rasterSource = cloneRasterLayerSource(member.rasterSourceBefore);
  }
}

async function restoreGroupIdentity(
  engine: BrushEngine,
  session: ActiveMixedSceneGroupTransformSession,
): Promise<void> {
  await switchActiveRaster(engine, session, session.activeRasterLayerIdBefore);
  const scene = requireMixedSceneStack(engine);
  scene.select(session.selectedKeyBefore);
  engine.vectorTextPreviewExcludedNodeId = scene.selected.kind === "text"
    ? scene.selected.textNodeId
    : null;
  clearVectorTextPresentationForTransaction(engine);
  publishSemanticMutation(engine);
}

export async function beginMixedSceneGroupTransform(
  engine: BrushEngine,
  orderedKeys: readonly MixedSceneItem["key"][],
): Promise<boolean> {
  const existing = engine.activeMixedSceneGroupTransformSession;
  const uniqueKeys = [...new Set(orderedKeys)];
  if (existing) {
    return existing.orderedKeys.length === uniqueKeys.length
      && existing.orderedKeys.every((key, index) => key === uniqueKeys[index]);
  }
  if (
    !engine.initialized
    || uniqueKeys.length < 2
    || engine.activeStroke !== null
    || engine.straightLineAdjustment !== null
    || engine.historyBusy
    || engine.layerSwitchBusy
    || engine.selectionBusy
    || engine.activeVectorHistoryEdit
    || engine.activeRasterLayerMetadataHistoryEdit
    || engine.activeFillPreviewSession
    || engine.activeRasterTransformSession
    || engine.activeRasterGaussianBlurSession
    || engine.activeRasterSpatialBlurSession
    || engine.activeRasterMotionBlurSession
    || engine.activeRasterNoiseSession
    || engine.activeRasterGlassSession
    || engine.activeRasterToneCurvesSession
    || engine.activeRasterColorAdjustSession
    || engine.activeRasterColorBalanceSession
    || engine.activeRasterLiquifySession
  ) {
    return false;
  }

  const scene = requireMixedSceneStack(engine);
  engine.persistActiveLayerState();
  const rasters: MixedSceneGroupRasterMember[] = [];
  const semantics: MixedSceneGroupSemanticMember[] = [];
  for (const key of uniqueKeys) {
    const item = scene.itemByKey(key);
    if (item.kind === "raster") {
      const record = engine.layerStack.byId(item.rasterLayerId);
      if (!record) throw new Error(`Group Transform raster ${item.rasterLayerId} is missing.`);
      if (!record.hasContent || !record.contentBounds) continue;
      const pivotX = record.contentBounds.x + record.contentBounds.width * 0.5;
      const pivotY = record.contentBounds.y + record.contentBounds.height * 0.5;
      rasters.push({
        key: item.key,
        layerId: item.rasterLayerId,
        pivotX,
        pivotY,
        rasterSourceBefore: cloneRasterLayerSource(record.rasterSource),
        update: identityUpdate(item.key, pivotX, pivotY),
      });
      continue;
    }
    const before = scene.captureVectorHistoryState(item.key);
    const node = before.node;
    if (!node) continue;
    semantics.push({
      key: item.key,
      before,
      update: identityUpdate(
        item.key,
        node.x,
        node.y,
        node.scaleX ?? node.scale,
        node.scaleY ?? node.scale,
        node.rotation,
      ),
    });
  }
  if (
    rasters.length + semantics.length < 2
    || rasters.length + semantics.length !== uniqueKeys.length
  ) return false;

  const session: ActiveMixedSceneGroupTransformSession = {
    orderedKeys: uniqueKeys,
    selectedKeyBefore: scene.selected.key,
    activeRasterLayerIdBefore: engine.layerStack.active.id,
    historyCursorBefore: engine.historyCursor,
    rasters,
    semantics,
    internalRasterOperation: false,
    terminal: false,
  };
  engine.activeMixedSceneGroupTransformSession = session;
  engine.cancelLayerColdCompressionIdle();
  engine.publishHistoryState();
  try {
    await engine.setMixedSceneRasterTransformPreview(
      rasters.map((member) => rasterPreview(member)),
    );
  } catch (error) {
    engine.activeMixedSceneGroupTransformSession = null;
    engine.scheduleLayerColdCompression();
    engine.publishHistoryState();
    throw error;
  }
  engine.publishStatus(`${uniqueKeys.length} layers ready for Transform.`, "ok");
  return true;
}

export function updateMixedSceneGroupTransform(
  engine: BrushEngine,
  updates: readonly MixedSceneGroupTransformUpdate[],
): void {
  const session = engine.activeMixedSceneGroupTransformSession;
  if (!session) throw new Error("No group Transform session is open.");
  if (session.terminal) throw new Error("The group Transform is already finishing.");
  const normalized = new Map<MixedSceneItem["key"], MixedSceneGroupTransformUpdate>();
  for (const update of updates) {
    if (normalized.has(update.key)) {
      throw new Error(`Group Transform update ${update.key} appears more than once.`);
    }
    normalized.set(update.key, normalizeGroupUpdate(update));
  }
  const allowedKeys = new Set([
    ...session.rasters.map((member) => member.key),
    ...session.semantics.map((member) => member.key),
  ]);
  for (const key of normalized.keys()) {
    if (!allowedKeys.has(key)) throw new Error(`Group Transform does not own ${key}.`);
  }

  const scene = requireMixedSceneStack(engine);
  for (const member of session.semantics) {
    const update = normalized.get(member.key);
    if (!update) continue;
    member.update = update;
    const item = scene.itemByKey(member.key);
    const transform = {
      x: update.x,
      y: update.y,
      scale: update.scale,
      scaleX: update.scaleX,
      scaleY: update.scaleY,
      rotation: update.rotation,
    };
    if (item.kind === "text") scene.updateText(item.textNodeId, transform);
    else if (item.kind === "svg") scene.updateSvg(item.svgNodeId, transform);
    else if (item.kind === "image") scene.updateImage(item.imageNodeId, transform);
  }
  for (const member of session.rasters) {
    const update = normalized.get(member.key);
    if (update) member.update = update;
  }
  engine.updateMixedSceneRasterTransformPreview(
    session.rasters.map((member) => rasterPreview(member)),
  );
  publishSemanticMutation(engine);
}

export async function cancelMixedSceneGroupTransform(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeMixedSceneGroupTransformSession;
  if (!session) return false;
  if (session.terminal) throw new Error("The group Transform is already finishing.");
  session.terminal = true;
  try {
    await engine.beginPresentationTransaction();
  } catch (error) {
    session.terminal = false;
    throw error;
  }
  try {
    restoreSemanticMembers(engine, session);
    await engine.clearMixedSceneRasterTransformPreview();
  } catch (error) {
    session.terminal = false;
    throw error;
  } finally {
    engine.endPresentationTransaction();
  }
  engine.activeMixedSceneGroupTransformSession = null;
  engine.scheduleLayerColdCompression();
  engine.publishHistoryState();
  engine.publishStatus("Group Transform canceled.", "ok");
  return true;
}

export async function commitMixedSceneGroupTransform(engine: BrushEngine): Promise<boolean> {
  const session = engine.activeMixedSceneGroupTransformSession;
  if (!session) return false;
  if (session.terminal) throw new Error("The group Transform is already finishing.");
  session.terminal = true;
  try {
    await engine.beginPresentationTransaction();
  } catch (error) {
    session.terminal = false;
    throw error;
  }
  const scene = requireMixedSceneStack(engine);
  const rasterActions: RasterTransformHistoryAction[] = [];
  try {
    await engine.clearMixedSceneRasterTransformPreview();
    for (const member of session.rasters) {
      if (rasterUpdateIsIdentity(member)) continue;
      await switchActiveRaster(engine, session, member.layerId);
      const snapshot = await runInternalRasterOperation(session, async () => (
        beginRasterLayerTransform(engine, "affine", {
          forceWholeLayer: true,
          allowSelectionMismatch: true,
        })
      ));
      if (!snapshot) throw new Error(`Raster ${member.layerId} could not open Transform.`);
      const sourcePivot = snapshot.sourcePivot ?? { x: snapshot.x, y: snapshot.y };
      const destinationPivot = mixedSceneGroupRasterMaterializationPivot(
        { x: member.pivotX, y: member.pivotY },
        sourcePivot,
        member.update,
      );
      updateRasterLayerTransform(engine, {
        x: destinationPivot.x,
        y: destinationPivot.y,
        scaleX: member.update.scaleX,
        scaleY: member.update.scaleY,
        rotation: member.update.rotation,
      });
      const action = await runInternalRasterOperation(session, async () => (
        materializeRasterLayerTransformHistoryAction(engine)
      ));
      if (action) rasterActions.push(action);
    }
    await restoreGroupIdentity(engine, session);
    const vectors: MixedSceneVectorHistoryDelta[] = session.semantics.map((member) => ({
      before: member.before,
      after: scene.captureVectorHistoryState(member.key),
    }));
    const changed = engine.recordMixedSceneGroupTransformHistoryAction({
      vectors,
      rasters: rasterActions,
      selectedKeyBefore: session.selectedKeyBefore,
      selectedKeyAfter: session.selectedKeyBefore,
      activeRasterLayerIdBefore: session.activeRasterLayerIdBefore,
      activeRasterLayerIdAfter: session.activeRasterLayerIdBefore,
    });
    engine.activeMixedSceneGroupTransformSession = null;
    engine.publishHistoryState();
    engine.scheduleLayerColdCompression();
    engine.publishStatus(
      changed ? "Group Transform applied: one Undo step." : "Group Transform unchanged.",
      "ok",
    );
    // The boolean acknowledges that the open session was closed successfully;
    // an unchanged group legitimately produces no history action.
    return true;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    try {
      restoreSemanticMembers(engine, session);
    } catch (restoreError) {
      rollbackErrors.push(restoreError);
    }
    try {
      await restoreMaterializedRasters(engine, session, rasterActions);
    } catch (restoreError) {
      rollbackErrors.push(restoreError);
    }
    try {
      await engine.clearMixedSceneRasterTransformPreview();
    } catch (restoreError) {
      rollbackErrors.push(restoreError);
    }
    try {
      await restoreGroupIdentity(engine, session);
    } catch (restoreError) {
      rollbackErrors.push(restoreError);
    }
    destroyUnpublishedRasterActions(rasterActions);
    if (rollbackErrors.length > 0) {
      const operationMessage = error instanceof Error ? error.message : String(error);
      const rollbackMessage = rollbackErrors.map((candidate) => (
        candidate instanceof Error ? candidate.message : String(candidate)
      )).join("; ");
      const combined = new Error(
        `Group Transform failed: ${operationMessage}; rollback failed: ${rollbackMessage}`,
      );
      engine.latchDocumentStateInconsistent(
        "Group Transform rollback was incomplete. Reload before continuing.",
        combined,
      );
      throw combined;
    }
    session.terminal = false;
    engine.activeMixedSceneGroupTransformSession = null;
    engine.publishHistoryState();
    engine.scheduleLayerColdCompression();
    throw error;
  } finally {
    engine.endPresentationTransaction();
  }
}
