import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildMobileLayerMergeSelectionPlan,
  mobileLayerMergeCompletionMatches,
} from "../src/mobile-layer-multi-selection.ts";

const items = [
  { key: "raster:1", clippingParentKey: null },
  { key: "text:1", clippingParentKey: null },
  { key: "raster:2", clippingParentKey: null },
  { key: "raster:3", clippingParentKey: "raster:2" },
  { key: "raster:4", clippingParentKey: "raster:2" },
  { key: "svg:1", clippingParentKey: null },
];

const minimum = buildMobileLayerMergeSelectionPlan(items, ["text:1"]);
assert.equal(minimum.valid, false);
assert.equal(minimum.reasonCode, "minimum-two");
assert.match(minimum.reason ?? "", /almeno due/);

const contiguous = buildMobileLayerMergeSelectionPlan(
  items,
  new Set(["raster:2", "raster:3", "raster:4", "text:1"]),
);
assert.equal(contiguous.valid, true);
assert.deepEqual(
  contiguous.orderedKeys,
  ["text:1", "raster:2", "raster:3", "raster:4"],
  "the callback order must stay bottom-to-top even when taps arrive in another order",
);

const gap = buildMobileLayerMergeSelectionPlan(items, ["raster:1", "svg:1"]);
assert.equal(gap.valid, false);
assert.equal(gap.reasonCode, "non-contiguous");
assert.match(gap.reason ?? "", /adiacenti/);

const partialClipping = buildMobileLayerMergeSelectionPlan(
  items,
  ["raster:2", "raster:3"],
);
assert.equal(partialClipping.valid, false);
assert.equal(partialClipping.reasonCode, "partial-clipping-group");
assert.match(partialClipping.reason ?? "", /gruppo di clipping/);

const completeClipping = buildMobileLayerMergeSelectionPlan(
  items,
  ["raster:2", "raster:3", "raster:4"],
);
assert.equal(completeClipping.valid, true);

const stale = buildMobileLayerMergeSelectionPlan(
  items,
  ["text:1", "image:99"],
);
assert.equal(stale.valid, false);
assert.equal(stale.reasonCode, "missing-item");

assert.equal(
  mobileLayerMergeCompletionMatches(
    ["raster:1", "text:1", "raster:2", "svg:1"],
    ["text:1", "raster:2"],
    ["raster:1", "raster:99", "svg:1"],
    "raster:99",
  ),
  true,
);
assert.equal(
  mobileLayerMergeCompletionMatches(
    ["raster:1", "text:1", "raster:2", "svg:1"],
    ["text:1", "raster:2"],
    ["raster:1", "text:1", "raster:2", "svg:1"],
    "raster:99",
  ),
  false,
  "a controller success without an atomic scene replacement must be rejected",
);

const root = new URL("../", import.meta.url);
const main = readFileSync(new URL("src/main.ts", root), "utf8");
const css = readFileSync(new URL("src/styles.css", root), "utf8");
const html = readFileSync(new URL("index.html", root), "utf8");

assert.match(
  html,
  /id="mobileAddMask"[\s\S]*?id="mobileLayerMultiSelect"[\s\S]*?aria-pressed="false"/,
  "the multi-select toggle must sit beside the clipping-mask control",
);
assert.match(
  html,
  /id="mobileLayerMultiActions"[\s\S]*?id="mobileLayerMergeSelection"[\s\S]*?>\s*Unisci livelli\s*<\/button>[\s\S]*?<\/div>\s*<p[\s\S]*?id="mobileLayerMergeStatus"[\s\S]*?role="status"/,
  "merge feedback must remain outside the actions container that closes after success",
);
assert.match(
  html,
  /id="mobileLayerMerge"[\s\S]*?>\s*Unisci livelli\s*<\/button>[\s\S]*?id="mobileLayerMergeReason"[\s\S]*?role="status"/,
  "the hold menu must expose the merge request and its invalid-selection reason",
);
assert.match(css, /\.mobile-layer-row\.is-multi-selected/);
assert.match(
  css,
  /\.mobile-layers-panel\.is-multi-select[\s\S]*?\.mobile-layer-row\.is-multi-selected[\s\S]*?\.mobile-layer-select\s*\{[\s\S]*?touch-action:\s*none/,
  "every selected row must suppress native touch gestures while its hold action is armed",
);
assert.match(
  css,
  /\.mobile-layers-toolbar-action\[aria-pressed="true"\]/,
);
assert.match(main, /scene\.items\.map\(\(item\) => \(\{/);
assert.match(
  main,
  /mobileLayerMultiSelectEnabled[\s\S]*?toggleMobileLayerMultiSelection\(key\)[\s\S]*?return;[\s\S]*?selectMixedSceneItem\(item\.key\)/,
  "multi-select taps must stay local while ordinary taps retain single selection",
);
assert.match(
  main,
  /mobileLayerMultiSelectEnabled[\s\S]*?\.is-multi-selected[\s\S]*?openMobileLayerContextMenu/,
  "selected rows in multi mode must retain the existing hold-menu gesture",
);
assert.match(
  main,
  /gesture\.phase === "armed"[\s\S]*?mobileLayerMultiSelectEnabled[\s\S]*?event\.preventDefault\(\);[\s\S]*?return;/,
  "a held multi-selection must never transition into layer reorder",
);
assert.match(
  main,
  /controller\.mergeSceneItems\(plan\.orderedKeys\)/,
  "the UI must forward one typed, ordered request to the controller",
);
assert.match(
  main,
  /mobileLayerMergeCompletionMatches\([\s\S]*?setMobileLayerMergeStatus\(message, true\)/,
  "a failed or unpublished merge must remain visible inside the mobile panel",
);
assert.match(
  main,
  /setMobileLayerMultiSelectEnabled\(false, false\);[\s\S]*?setMobileLayerMergeStatus\(successMessage\)/,
  "success feedback must be published after multi-select closes",
);
assert.match(
  main,
  /runHistoryOperation[\s\S]*?historyUiBusy = false;[\s\S]*?syncActiveLayerControls\(\);[\s\S]*?mobileLayersRenderSignature = "";[\s\S]*?updateStats\(engine\.getStats\(\)\)/,
  "undo and redo must republish active controls and both layer lists immediately",
);
assert.match(
  main,
  /mobileLayerMergeSelectionButton\.addEventListener\("click"[\s\S]*?requestMobileLayerMerge\(\)/,
  "the persistent action must use the same controller request as the hold menu",
);
console.log(
  "Mobile layer multi-selection: order, clipping integrity, UI state and controller callback verified.",
);
