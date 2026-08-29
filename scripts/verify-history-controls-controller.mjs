import assert from "node:assert/strict";
import { HistoryControlsController } from "../src/history-controls-controller.ts";

class FakeClassList {
  values = new Set();

  toggle(name, enabled) {
    if (enabled) this.values.add(name);
    else this.values.delete(name);
  }
}

class FakeButton {
  disabled = false;
  title = "";
  classList = new FakeClassList();
  attributes = new Map();
  listeners = new Map();

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  click() {
    this.listeners.get("click")?.({});
  }
}

class FakeWindow {
  listeners = new Map();

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  dispatch(type, event) {
    this.listeners.get(type)?.(event);
  }
}

class FakeElement {
  constructor(insideEditor = false) {
    this.insideEditor = insideEditor;
  }

  closest() {
    return this.insideEditor ? this : null;
  }
}

globalThis.Element = FakeElement;

function historyState(overrides = {}) {
  return {
    canUndo: true,
    canRedo: true,
    busy: false,
    inconsistent: false,
    actionCount: 3,
    cursor: 2,
    storedBaseStamps: 0,
    logicalStampBytes: 0,
    undoBlockedReason: null,
    redoBlockedReason: null,
    openEdit: null,
    ...overrides,
  };
}

function waitFor(predicate, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > 1_000) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 0);
    };
    poll();
  });
}

function controllerHarness({
  engine,
  interactionLocked,
  requestLocked,
  prepareOperation,
} = {}) {
  const browser = new FakeWindow();
  const undoButton = new FakeButton();
  const redoButton = new FakeButton();
  const statuses = [];
  const publishedStates = [];
  const lockStates = [];
  let replayCompletions = 0;
  const fallbackEngine = {
    state: () => historyState(),
    undo: async () => true,
    redo: async () => true,
    crossedAction: () => ({ action: "stroke", cursor: 2 }),
  };
  const controller = new HistoryControlsController({
    engine: engine ?? fallbackEngine,
    browser,
    undoButton,
    redoButton,
    initialState: historyState(),
    interactionLocked: interactionLocked ?? (() => false),
    requestLocked: requestLocked ?? (() => false),
    prepareOperation,
    onStateChange: (state) => publishedStates.push(state),
    onControlsLockChange: (locked) => lockStates.push(locked),
    onReplayComplete: () => {
      replayCompletions += 1;
    },
    setStatus: (message, kind = "working") => statuses.push({ message, kind }),
    recordDiagnostic: () => {},
  });
  return {
    browser,
    controller,
    undoButton,
    redoButton,
    statuses,
    publishedStates,
    lockStates,
    replayCompletions: () => replayCompletions,
  };
}

// A controller-owned transient edit is settled before lock and journal
// availability are re-read. Undo then crosses the newly visible atomic action.
{
  const calls = [];
  let transientOpen = true;
  let currentState = historyState({
    canUndo: false,
    openEdit: "transform",
    undoBlockedReason: "Finish Transform before undoing.",
  });
  const harness = controllerHarness({
    engine: {
      state: () => currentState,
      undo: async () => {
        calls.push("undo");
        return true;
      },
      redo: async () => true,
      crossedAction: () => ({ action: "group-transform", cursor: 3 }),
    },
    interactionLocked: () => transientOpen,
    prepareOperation: async (operation) => {
      calls.push(`prepare-${operation}`);
      transientOpen = false;
      currentState = historyState({ cursor: 3 });
      return true;
    },
  });
  harness.controller.request("undo");
  await waitFor(() => !harness.controller.isQueueDraining, "prepared history step");
  assert.deepEqual(calls, ["prepare-undo", "undo"]);
  assert.equal(harness.publishedStates.at(0).openEdit, null);
}

// Availability is semantic (`aria-disabled`), never native-disabled: queued
// intent must remain clickable while the engine is replaying.
{
  let locked = false;
  const harness = controllerHarness({
    interactionLocked: () => locked,
    requestLocked: () => locked,
  });
  harness.controller.refreshControls();
  assert.equal(harness.undoButton.disabled, false);
  assert.equal(harness.redoButton.disabled, false);
  assert.equal(harness.undoButton.attributes.get("aria-disabled"), "false");
  locked = true;
  harness.controller.refreshControls();
  assert.equal(harness.undoButton.attributes.get("aria-disabled"), "true");
  assert(harness.undoButton.classList.values.has("is-disabled"));
  assert.equal(harness.lockStates.at(-1), true);
  harness.controller.dispose();
  assert.equal(harness.undoButton.listeners.has("click"), false);
  assert.equal(harness.redoButton.listeners.has("click"), false);
  assert.equal(harness.browser.listeners.has("keydown"), false);
}

// Multiple requests execute strictly one at a time and preserve their order.
{
  const calls = [];
  const releases = [];
  let inFlight = 0;
  let maximumInFlight = 0;
  const step = (operation) => new Promise((resolve) => {
    calls.push(operation);
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    releases.push(() => {
      inFlight -= 1;
      resolve(true);
    });
  });
  const harness = controllerHarness({
    engine: {
      state: () => historyState(),
      undo: () => step("undo"),
      redo: () => step("redo"),
      crossedAction: () => ({ action: "stroke", cursor: 2 }),
    },
  });
  harness.controller.request("undo");
  harness.controller.request("redo");
  harness.controller.request("undo");
  assert.equal(harness.controller.queuedOperationCount, 2);
  releases.shift()();
  await waitFor(() => calls.length === 2, "second queued history step");
  releases.shift()();
  await waitFor(() => calls.length === 3, "third queued history step");
  releases.shift()();
  await waitFor(() => !harness.controller.isQueueDraining, "history queue drain");
  assert.deepEqual(calls, ["undo", "redo", "undo"]);
  assert.equal(maximumInFlight, 1);
  assert.equal(harness.replayCompletions(), 3);
}

// A held shortcut (`repeat`) is intentionally accepted, while editable fields
// keep their native text Undo behavior.
{
  const calls = [];
  let requestLocked = false;
  const harness = controllerHarness({
    engine: {
      state: () => historyState(),
      undo: async () => {
        calls.push("undo");
        return true;
      },
      redo: async () => {
        calls.push("redo");
        return true;
      },
      crossedAction: () => ({ action: "stroke", cursor: 2 }),
    },
    requestLocked: () => requestLocked,
  });
  let prevented = false;
  harness.browser.dispatch("keydown", {
    defaultPrevented: false,
    isComposing: false,
    altKey: false,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    repeat: true,
    key: "z",
    target: null,
    preventDefault: () => {
      prevented = true;
    },
  });
  await waitFor(() => calls.length === 1, "keyboard Undo");
  assert.equal(prevented, true);

  harness.browser.dispatch("keydown", {
    defaultPrevented: false,
    isComposing: false,
    altKey: false,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    key: "z",
    target: new FakeElement(true),
    preventDefault: () => assert.fail("editable Undo must stay native"),
  });
  assert.equal(calls.length, 1);

  requestLocked = true;
  harness.browser.dispatch("keydown", {
    defaultPrevented: false,
    isComposing: false,
    altKey: false,
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    key: "z",
    target: null,
    preventDefault() {},
  });
  assert.equal(calls.length, 1);
  assert.match(harness.statuses.at(-1).message, /Finish the current operation/);
}

// A document switch keeps the active authoritative replay, discards only
// intent that has not started, then re-bases the reusable controls on the new
// engine journal.
{
  const calls = [];
  let releaseActive;
  const harness = controllerHarness({
    engine: {
      state: () => historyState(),
      undo: () => new Promise((resolve) => {
        calls.push("undo");
        releaseActive = () => resolve(true);
      }),
      redo: async () => {
        calls.push("redo");
        return true;
      },
      crossedAction: () => ({ action: "stroke", cursor: 2 }),
    },
  });
  harness.controller.request("undo");
  harness.controller.request("redo");
  harness.controller.request("undo");
  assert.equal(harness.controller.queuedOperationCount, 2);
  harness.controller.discardPendingOperations();
  assert.equal(harness.controller.queuedOperationCount, 0);
  releaseActive();
  await waitFor(() => !harness.controller.isQueueDraining, "outgoing history replay");
  assert.deepEqual(calls, ["undo"]);

  const freshState = historyState({
    canUndo: false,
    canRedo: false,
    actionCount: 0,
    cursor: 0,
    undoBlockedReason: "There are no actions to undo.",
    redoBlockedReason: "There are no actions to redo.",
  });
  harness.controller.resetForDocument(freshState);
  assert.equal(harness.publishedStates.at(-1), freshState);
  assert.equal(harness.controller.lastFailure, null);
}

// Failures retain the crossed action and cursor for the diagnostics panel.
{
  const diagnostics = [];
  const harness = controllerHarness({
    engine: {
      state: () => historyState(),
      undo: async () => {
        throw new Error("fault injection");
      },
      redo: async () => true,
      crossedAction: () => ({ action: "layer-merge", cursor: 7 }),
    },
  });
  // Replace the diagnostic callback through a dedicated instance so the
  // assertion covers both stored and emitted context.
  const controller = new HistoryControlsController({
    engine: {
      state: () => historyState(),
      undo: async () => {
        throw new Error("fault injection");
      },
      redo: async () => true,
      crossedAction: () => ({ action: "layer-merge", cursor: 7 }),
    },
    browser: new FakeWindow(),
    undoButton: new FakeButton(),
    redoButton: new FakeButton(),
    initialState: historyState(),
    interactionLocked: () => false,
    requestLocked: () => false,
    onStateChange: () => {},
    onControlsLockChange: () => {},
    onReplayComplete: () => {},
    setStatus: () => {},
    recordDiagnostic: (name, detail, error) => diagnostics.push({ name, detail, error }),
  });
  void harness;
  controller.request("undo");
  await waitFor(() => !controller.isQueueDraining, "failed history step");
  assert.deepEqual(controller.lastFailure, {
    operation: "undo",
    action: "layer-merge",
    cursor: 7,
    message: "fault injection",
  });
  assert.equal(diagnostics.at(-1).name, "history-step-failed");
  controller.resetForDocument(historyState({ actionCount: 0, cursor: 0 }));
  assert.equal(controller.lastFailure, null);
}

// The active replay is removed before capacity is counted; at most 32 further
// human requests remain pending.
{
  const harness = controllerHarness({
    engine: {
      state: () => historyState(),
      undo: () => new Promise(() => {}),
      redo: async () => true,
      crossedAction: () => ({ action: "stroke", cursor: 2 }),
    },
  });
  for (let index = 0; index < 50; index += 1) harness.controller.request("undo");
  assert.equal(harness.controller.queuedOperationCount, 32);
}

console.info("History controls controller verification passed.");
