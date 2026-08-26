import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const workspaceRoot = fileURLToPath(root);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const main = read("src/main.ts");
const canvasTools = read("src/canvas-tool-controller.ts");
const layerPanel = read("src/layer-panel-controller.ts");
const controller = read("src/mixed-scene-controller.ts");
const contract = read("src/mixed-scene-controller-contract.ts");
const node = read("src/mixed-scene-node.ts");
const geometry = read("src/scene-transform-geometry.ts");
const overlay = read("src/scene-interaction-overlay.ts");
const historyTypes = read("src/engine-history-types.ts");
const historyRuntime = read("src/engine-history-runtime.ts");

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `Missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `Missing section end after ${start}: ${end}`);
  return source.slice(startIndex, endIndex);
}

const panelCallback = section(
  main,
  "  onMultiSelectionChange: ({ enabled, orderedKeys }) => {",
  "  rasterizeLayer:",
);

assert.match(
  layerPanel,
  /onMultiSelectionChange\?:[\s\S]*?LayerPanelMultiSelectionSnapshot/,
  "The layer panel must expose its multiple selection to the editor shell.",
);
assert.match(
  layerPanel,
  /private notifyMultiSelection\([\s\S]*?selectionItems\(stats\)[\s\S]*?filter\(\(item\) => this\.selectedKeys\.has\(item\.key\)\)[\s\S]*?map\(\(item\) => item\.key\)[\s\S]*?onMultiSelectionChange/,
  "The callback must publish every selected key in stable scene order.",
);
assert.match(
  panelCallback,
  /const transformKeys = enabled && orderedKeys\.length >= 2 \? orderedKeys : \[\]/,
  "Transform must activate only after at least two selected layers exist.",
);
assert.match(
  panelCallback,
  /if \(transformKeys\.length === 0\) \{[\s\S]*?setTransformSelection\(\[\]\);[\s\S]*?return;[\s\S]*?\}/,
  "Zero or one selected layer must clear the group instead of changing tools.",
);
assert.match(
  panelCallback,
  /selectCanvasToolWithMixedScene\("transform"\)/,
  "A valid multiple selection must switch directly to Transform.",
);
assert.match(
  panelCallback,
  /controller\.setTransformSelection\(transformKeys\)/,
  "The exact callback keys must reach the Transform controller.",
);
assert.match(
  panelCallback,
  /const revision = \+\+layerMultiTransformSelectionRevision[\s\S]*?if \(revision !== layerMultiTransformSelectionRevision\) return;[\s\S]*?controller\.setTransformSelection\(transformKeys\)/,
  "A late controller initialization must not restore a stale multiple selection.",
);
assert.doesNotMatch(
  panelCallback,
  /merge|contiguous|adjacent|clippingParent|currentMergePlan|buildMobileLayerMergeSelectionPlan/i,
  "Transform selection must not inherit merge adjacency or clipping-group constraints.",
);

const toolExitCoordinator = section(
  main,
  "async function finishLayerMultiSelectionForToolChange()",
  "const engine = new BrushEngine(",
);
assert.match(
  toolExitCoordinator,
  /await controller\.applyTransform\(\)[\s\S]*?panel\.finishMultiSelection\(\)/,
  "Changing tools must apply the group before closing multiple selection.",
);
assert.doesNotMatch(
  toolExitCoordinator,
  /mergeLayers|mergeSceneItems|requestMerge/,
  "Leaving multiple selection through a tool must never merge layers.",
);
assert.match(
  canvasTools,
  /activeCanvasTool === "transform"[\s\S]*?tool !== "transform"[\s\S]*?isMultiSelectionActive\(\)[\s\S]*?queueToolAfterMultiSelection/,
  "Every canvas-tool route must pass through the shared multiple-selection exit gate.",
);
assert.match(
  canvasTools,
  /pendingMultiSelectionTool = \{ tool, preserveToolSettings \}[\s\S]*?if \(this\.multiSelectionExitPromise\) return/,
  "Concurrent tool requests must share one completion and retain the latest target.",
);
const canvasToolLock = section(
  main,
  "function canvasToolSelectionLocked(): boolean {",
  "/**\n * Pan, zoom e rotazione",
);
assert.match(
  canvasToolLock,
  /isMultiSelect === true[\s\S]*?activeTool === "transform"[\s\S]*?action\?\.active === true \|\| action\?\.preparing === true/,
  "Canvas-tool buttons must remain reachable while a group is preparing or awaiting Apply.",
);
const controllerExitReadiness = section(
  main,
  "  canFinishMultiSelectionForToolChange: () => {",
  "  finishMultiSelectionForToolChange:",
);
assert.match(controllerExitReadiness, /if \(action\?\.preparing\) return true;/);
assert.match(controllerExitReadiness, /if \(action\?\.active\) return action\.canApply;/);
assert.match(
  controllerExitReadiness,
  /return !interactionLocked\(\);/,
  "An unrelated engine lock must not inherit the group-selection escape hatch.",
);

const setSelection = section(
  controller,
  "  setTransformSelection(orderedKeys:",
  "  private transformNodeForGroupKey(",
);
assert.match(setSelection, /const uniqueKeys = \[\.\.\.new Set\(orderedKeys\)\]/);
assert.match(
  setSelection,
  /uniqueKeys\.length >= 2[\s\S]*?createGroupTransformSelection\(uniqueKeys\)/,
  "The controller must preserve an exact two-or-more key set, including gaps in scene order.",
);
assert.doesNotMatch(
  setSelection,
  /sort\(|splice\(|slice\(|merge|contiguous|adjacent|clippingParent/i,
  "The group-selection boundary must not fill gaps or add related layers.",
);

const groupCreation = section(
  controller,
  "  private createGroupTransformSelection(",
  "  private refreshGroupTransformSelection(",
);
assert.match(
  groupCreation,
  /const normalizedKeys = orderedKeys\.filter\(\(key\) => liveKeys\.has\(key\)\)/,
  "Only stale keys may be removed; non-adjacent live keys must remain exact.",
);
assert.match(groupCreation, /const members = normalizedKeys\.flatMap/);
assert.match(
  groupCreation,
  /members\.length < 2 \|\| members\.length !== normalizedKeys\.length/,
  "An exact selection must not silently drop empty or otherwise non-transformable layers.",
);
assert.match(
  groupCreation,
  /members\.reduce<SceneAxisAlignedBounds \| null>/,
  "The group must derive one bounding box from every selected member.",
);
for (const edge of ["left", "top", "right", "bottom"]) {
  const reducer = edge === "left" || edge === "top" ? "min" : "max";
  assert.match(
    groupCreation,
    new RegExp(`${edge}: Math\\.${reducer}\\(union\\.${edge}, next\\.${edge}\\)`),
    `The group bounding box must union its ${edge} edge.`,
  );
}
assert.match(groupCreation, /kind: "group-transform"/);
assert.match(groupCreation, /keys: normalizedKeys/);
assert.match(
  groupCreation,
  /localBounds: \{[\s\S]*?left: bounds\.left - x,[\s\S]*?top: bounds\.top - y,[\s\S]*?right: bounds\.right - x,[\s\S]*?bottom: bounds\.bottom - y/,
  "The one group box must be centered around the shared transform pivot.",
);
assert.match(
  controller,
  /if \(isSceneGroupTransformNode\(selectedTransformNode\)\) \{[\s\S]*?this\.metrics = \{ \.\.\.selectedTransformNode\.localBounds, baseline: 0 \}/,
  "The overlay must render the shared group box, not a member box.",
);
assert.match(node, /export interface SceneGroupTransformNode[\s\S]*?readonly keys:/);

assert.match(
  contract,
  /beginMixedSceneGroupTransform\([\s\S]*?orderedKeys:[\s\S]*?\): Promise<boolean>;[\s\S]*?updateMixedSceneGroupTransform\([\s\S]*?\): void;[\s\S]*?commitMixedSceneGroupTransform\(\): Promise<boolean>;[\s\S]*?cancelMixedSceneGroupTransform\(\): Promise<boolean>;/,
  "The host contract must expose the complete group transaction lifecycle.",
);
const preparation = section(
  controller,
  "  private async runGroupTransformPreparation(",
  "  private async runRasterTransformPreparation(",
);
assert.match(preparation, /beginMixedSceneGroupTransform\(orderedKeys\)/);
assert.match(
  preparation,
  /current\.orderedKeys\.some\(\(key, index\) => key !== orderedKeys\[index\]\)/,
  "An asynchronous begin must be cancelled if the exact selection changed.",
);
assert.match(preparation, /await this\.host\.cancelMixedSceneGroupTransform\(\)/);

const groupUpdate = section(
  controller,
  "  private updateGroupTransformNode(",
  "  private syncControlsFromSelection(",
);
assert.match(groupUpdate, /selection\.members\.map\(\(member\) =>/);
assert.match(groupUpdate, /key: member\.key/);
assert.match(groupUpdate, /this\.host\.updateMixedSceneGroupTransform\(updates\)/);

const apply = section(
  controller,
  "  private async applyTransformSession()",
  "  private async cancelTransformSession()",
);
assert.match(apply, /const groupSession = this\.transformSessionKind === "group"/);
assert.match(
  apply,
  /if \(groupSession\) \{[\s\S]*?await this\.host\.commitMixedSceneGroupTransform\(\)[\s\S]*?\} else if \(rasterSession\)/,
  "Apply must commit the group through one atomic host operation.",
);
const groupApplyBranch = section(apply, "      if (groupSession) {", "      } else if (rasterSession)");
assert.doesNotMatch(
  groupApplyBranch,
  /for \(|\.map\(|commitVectorHistoryEdit|commitRasterLayerTransform/,
  "Apply must not expose one history commit per selected member.",
);
assert.match(
  apply,
  /catch \(error\)[\s\S]*?if \(groupSession\) \{[\s\S]*?this\.transformSessionOpen = false;[\s\S]*?this\.transformSessionKind = null;/,
  "A rolled-back group Apply failure must not leave a stale UI session open.",
);

const cancel = section(
  controller,
  "  private async cancelTransformSession()",
  "  private abortActiveTransformInteraction()",
);
assert.match(cancel, /const groupSession = this\.transformSessionKind === "group"/);
assert.match(
  cancel,
  /groupSession[\s\S]*?await this\.host\.cancelMixedSceneGroupTransform\(\)[\s\S]*?: rasterSession/,
  "Cancel must restore the group through one atomic host operation.",
);
assert.match(
  historyTypes,
  /interface MixedSceneGroupTransformHistoryAction[\s\S]*?kind: "group-transform";[\s\S]*?vectors:[\s\S]*?rasters:/,
  "Undo/Redo must own every selected member in one group history action.",
);
const historyCommit = section(
  historyRuntime,
  "export function recordMixedSceneGroupTransformHistoryAction(",
  "export function captureMixedSceneOrderState(",
);
assert.match(historyCommit, /kind: "group-transform"/);
assert.equal(
  (historyCommit.match(/commitHistoryActionAtomically\(engine, action\)/g) ?? []).length,
  1,
  "One Apply must publish exactly one atomic history action.",
);

assert.match(
  geometry,
  /export type SceneTransformSideHandle =[\s\S]*?"north"[\s\S]*?"east"[\s\S]*?"south"[\s\S]*?"west"/,
  "Transform must expose four side-center handles.",
);
assert.match(overlay, /SCENE_TRANSFORM_SIDE_HANDLE_WIDTH_CSS_PX = 20/);
assert.match(overlay, /SCENE_TRANSFORM_SIDE_HANDLE_HEIGHT_CSS_PX = 6/);
assert.match(overlay, /function renderSceneBoundingBoxSideHandle[\s\S]*?context\.lineTo/);
assert.match(overlay, /SCENE_TRANSFORM_TOUCH_HIT_RADIUS_CSS_PX = 22/);
assert.match(
  overlay,
  /pointerType === "touch"[\s\S]*?SCENE_TRANSFORM_TOUCH_HIT_RADIUS_CSS_PX[\s\S]*?return \{ corner: radius, side: radius, rotation: radius \}/,
  "The small visual side handles must retain a larger touch target.",
);
assert.match(
  controller,
  /private touchInteractionAcceptsConstraint\([\s\S]*?interaction\.mode === "rotate"[\s\S]*?interaction\.mode === "scale"[\s\S]*?interaction\.handle === "north"[\s\S]*?interaction\.handle === "east"[\s\S]*?interaction\.handle === "south"[\s\S]*?interaction\.handle === "west"/,
  "Only rotation and side handles may consume the second touch as a transform modifier.",
);
assert.match(
  controller,
  /private sideScaleUpdate\([\s\S]*?centered: boolean[\s\S]*?sceneSideScaleUpdate\([\s\S]*?centered,/,
  "Side resizing must forward the desktop or touch center constraint to geometry.",
);
assert.match(
  controller,
  /event\.pointerId === this\.touchTransformModifierPointerId[\s\S]*?event\.preventDefault\(\);[\s\S]*?return;/,
  "The modifier touch must never contribute coordinates to the transform.",
);
assert.match(
  controller,
  /this\.interactionCanvas\.classList\.add\(`is-\$\{mode\}`\);\s*this\.updateTransformUi\(\);/,
  "Starting a transform gesture must immediately lock Apply and tool changes.",
);

const moduleServer = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: workspaceRoot,
  server: { middlewareMode: true },
});
let MixedSceneController;
try {
  ({ MixedSceneController } = await moduleServer.ssrLoadModule(
    "/src/mixed-scene-controller.ts",
  ));
} finally {
  await moduleServer.close();
}

function touchEvent(pointerId) {
  return {
    pointerId,
    pointerType: "touch",
    clientX: pointerId * 10,
    clientY: pointerId * 12,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

function touchShell(activeInteraction, options = {}) {
  let viewNavigationStarts = 0;
  const shell = Object.create(MixedSceneController.prototype);
  Object.assign(shell, {
    transformCommitBusy: false,
    rasterTransformRecoveryOnly: false,
    transformToolActive: true,
    activeInteraction,
    pendingRasterPointerId: options.pendingPointerId ?? null,
    pendingRasterPointerMove: null,
    touchContacts: new Map(options.contacts ?? [[1, { x: 10, y: 12 }]]),
    touchTransformModifierPointerId: options.modifierPointerId ?? null,
    touchNavigationActive: false,
    selectedTransformNode: () => ({}),
    interactionCanvas: {
      setPointerCapture() {},
    },
    enterTouchNavigation: () => {
      viewNavigationStarts += 1;
    },
  });
  return { shell, viewNavigationStarts: () => viewNavigationStarts };
}

const rotateTouch = touchShell({
  pointerId: 1,
  mode: "rotate",
  handle: "rotate",
});
rotateTouch.shell.onPointerDown(touchEvent(2));
assert.equal(rotateTouch.shell.touchTransformModifierPointerId, 2);
assert.equal(rotateTouch.viewNavigationStarts(), 0);

const sideTouch = touchShell({
  pointerId: 1,
  mode: "scale",
  handle: "east",
});
sideTouch.shell.onPointerDown(touchEvent(2));
assert.equal(sideTouch.shell.touchTransformModifierPointerId, 2);
assert.equal(sideTouch.viewNavigationStarts(), 0);

const modifierMove = touchEvent(2);
sideTouch.shell.onPointerMove(modifierMove);
assert.equal(modifierMove.defaultPrevented, true);
assert.equal(sideTouch.shell.activeInteraction.pointerId, 1);

const unsupportedTouch = touchShell({
  pointerId: 1,
  mode: "move",
  handle: null,
});
unsupportedTouch.shell.onPointerDown(touchEvent(2));
assert.equal(unsupportedTouch.shell.touchTransformModifierPointerId, null);
assert.equal(unsupportedTouch.viewNavigationStarts(), 1);

const pendingTouch = touchShell(null, { pendingPointerId: 1 });
pendingTouch.shell.onPointerDown(touchEvent(2));
assert.equal(pendingTouch.shell.touchTransformModifierPointerId, 2);
assert.equal(pendingTouch.viewNavigationStarts(), 0);

const extraTouch = touchShell({
  pointerId: 1,
  mode: "rotate",
  handle: "rotate",
}, {
  contacts: [[1, { x: 10, y: 12 }], [2, { x: 20, y: 24 }]],
  modifierPointerId: 2,
});
extraTouch.shell.onPointerDown(touchEvent(3));
assert.equal(extraTouch.shell.touchTransformModifierPointerId, 2);
assert.equal(extraTouch.viewNavigationStarts(), 0);

let releasePreparation;
const groupPreparationGate = new Promise((resolve) => {
  releasePreparation = resolve;
});
let preparedApplyCalls = 0;
const preparedApplyShell = Object.create(MixedSceneController.prototype);
Object.assign(preparedApplyShell, {
  groupTransformPreparation: groupPreparationGate,
  rasterTransformPreparation: null,
  transformSessionOpen: false,
  applyTransformSession: async () => {
    preparedApplyCalls += 1;
    return true;
  },
});
let preparedApplySettled = false;
const preparedApply = preparedApplyShell.applyTransform().then((result) => {
  preparedApplySettled = true;
  return result;
});
await Promise.resolve();
assert.equal(preparedApplySettled, false);
preparedApplyShell.transformSessionOpen = true;
releasePreparation();
assert.equal(await preparedApply, true);
assert.equal(preparedApplyCalls, 1);

let pointerFinishUiUpdates = 0;
const pointerFinishShell = Object.create(MixedSceneController.prototype);
const pointerInteraction = { pointerId: 17, mode: "move" };
Object.assign(pointerFinishShell, {
  pendingRasterPointerId: null,
  pendingRasterPointerMove: null,
  touchContacts: new Map(),
  touchTransformModifierPointerId: null,
  touchNavigationActive: false,
  activeInteraction: pointerInteraction,
  clearActiveInteraction(interaction) {
    if (this.activeInteraction === interaction) this.activeInteraction = null;
  },
  updateTransformUi() {
    pointerFinishUiUpdates += 1;
  },
  endViewGesture() {},
  restoreInteractionStart() {},
  closeNewNoopTransformSession() {},
  scheduleRender() {},
});
pointerFinishShell.finishPointer({
  pointerId: 17,
  pointerType: "mouse",
  type: "pointerup",
});
assert.equal(pointerFinishShell.activeInteraction, null);
assert.equal(
  pointerFinishUiUpdates,
  1,
  "releasing the pointer must immediately re-enable Apply and canvas-tool changes",
);

console.log(
  "Group Transform UI: exact layer selection, automatic activation, shared box, side handles and atomic Apply/Cancel verified.",
);
