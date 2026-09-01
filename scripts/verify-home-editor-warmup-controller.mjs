import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

// The application module intentionally uses Vite-style extensionless imports.
// Transpile it in memory and make only that import explicit so this focused
// Node verification executes the production source without a generated file.
const controllerUrl = new URL("../src/home-editor-warmup-controller.ts", import.meta.url);
const gpuSessionUrl = new URL("../src/gpu-device-session.ts", import.meta.url).href;
const controllerSource = readFileSync(controllerUrl, "utf8").replace(
  'from "./gpu-device-session";',
  `from ${JSON.stringify(gpuSessionUrl)};`,
);
const originalEmitWarning = process.emitWarning;
process.emitWarning = () => {};
let controllerJavaScript;
try {
  controllerJavaScript = stripTypeScriptTypes(controllerSource, {
    mode: "transform",
    sourceUrl: controllerUrl.href,
  });
} finally {
  process.emitWarning = originalEmitWarning;
}
const controllerModuleUrl = `data:text/javascript;base64,${Buffer.from(controllerJavaScript).toString("base64")}`;
const { createHomeEditorWarmupController } = await import(controllerModuleUrl);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class DeterministicBrowser {
  constructor(clock, userAgent = "Deterministic desktop") {
    this.clock = clock;
    this.performance = { now: () => this.clock.nowMs };
    this.navigator = { userAgent };
    this.nextCallbackId = 1;
    this.animationFrames = new Map();
    this.idleCallbacks = new Map();
    this.timeouts = new Map();
    this.listeners = new Map();
    this.__homeEditorWarmupReport = undefined;
  }

  requestAnimationFrame(callback) {
    const id = this.nextCallbackId++;
    this.animationFrames.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id) {
    this.animationFrames.delete(id);
  }

  requestIdleCallback(callback) {
    const id = this.nextCallbackId++;
    this.idleCallbacks.set(id, callback);
    return id;
  }

  cancelIdleCallback(id) {
    this.idleCallbacks.delete(id);
  }

  setTimeout(callback, delay = 0) {
    const id = this.nextCallbackId++;
    this.timeouts.set(id, { callback, delay });
    return id;
  }

  clearTimeout(id) {
    this.timeouts.delete(id);
  }

  addEventListener(name, listener) {
    let listeners = this.listeners.get(name);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(name, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(name, listener) {
    this.listeners.get(name)?.delete(listener);
  }

  dispatch(name) {
    for (const listener of this.listeners.get(name) ?? []) listener({ type: name });
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }

  flushAnimationFrame(deltaMs = 16) {
    this.clock.nowMs += deltaMs;
    const callbacks = [...this.animationFrames.values()];
    this.animationFrames.clear();
    for (const callback of callbacks) callback(this.clock.nowMs);
  }

  flushIdle() {
    const callbacks = [...this.idleCallbacks.values()];
    this.idleCallbacks.clear();
    for (const callback of callbacks) {
      callback({ didTimeout: false, timeRemaining: () => 50 });
    }
  }

  flushTimeouts() {
    const callbacks = [...this.timeouts.values()];
    this.timeouts.clear();
    this.clock.nowMs += Math.max(0, ...callbacks.map((entry) => entry.delay));
    for (const entry of callbacks) entry.callback();
  }

  advanceTime(deltaMs) {
    this.clock.nowMs += deltaMs;
    const due = [];
    for (const [id, entry] of this.timeouts) {
      entry.delay -= deltaMs;
      if (entry.delay <= 0) {
        this.timeouts.delete(id);
        due.push(entry.callback);
      }
    }
    for (const callback of due) callback();
  }
}

class DeterministicDocument {
  constructor() {
    this.visibilityState = "visible";
    this.listeners = new Map();
  }

  addEventListener(name, listener) {
    let listeners = this.listeners.get(name);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(name, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(name, listener) {
    this.listeners.get(name)?.delete(listener);
  }

  setVisibility(state) {
    this.visibilityState = state;
    for (const listener of this.listeners.get("visibilitychange") ?? []) {
      listener({ type: "visibilitychange" });
    }
  }
}

function fakeSession(overrides = {}) {
  const gpu = {
    currentBytes: 0,
    peakBytes: 0,
    textureCount: 0,
    bufferCount: 0,
    createdCount: 0,
    ...overrides,
  };
  return {
    adapter: { limits: { maxTextureDimension2D: 8192 } },
    device: { lost: new Promise(() => {}) },
    requiredFeatures: [],
    lost: false,
    registry: {
      snapshot() {
        return { ...gpu };
      },
    },
  };
}

function fakePrewarmer(sessionPromise) {
  let prepareCount = 0;
  return {
    get prepareCount() {
      return prepareCount;
    },
    prepare() {
      prepareCount += 1;
      return sessionPromise;
    },
    invalidate() {},
  };
}

async function microtasks(count = 6) {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

async function driveUntil(controller, browser, predicate, limit = 40) {
  for (let step = 0; step < limit; step += 1) {
    if (predicate()) return;
    browser.flushAnimationFrame();
    await microtasks();
    browser.flushIdle();
    browser.flushTimeouts();
    await microtasks();
  }
  assert.fail(`Warm-up did not reach the expected state: ${JSON.stringify(controller.snapshot())}`);
}

async function driveWithoutTimeoutsUntil(controller, browser, predicate, deltas = [16], limit = 40) {
  for (let step = 0; step < limit; step += 1) {
    if (predicate()) return;
    browser.flushAnimationFrame(deltas[Math.min(step, deltas.length - 1)] ?? 16);
    await microtasks();
    browser.flushIdle();
    await microtasks();
  }
  assert.fail(`Warm-up did not reach the expected pre-timeout state: ${JSON.stringify(controller.snapshot())}`);
}

const clock = { nowMs: 1_000 };

// Touch devices start on the same short gate as desktop; the 3-second path is
// only a measured fallback, not an unconditional mobile tax.
{
  const browser = new DeterministicBrowser(clock, "Mozilla/5.0 (iPhone)");
  const controller = createHomeEditorWarmupController({
    enabled: true,
    browser,
    document: new DeterministicDocument(),
    prewarmer: fakePrewarmer(Promise.resolve(fakeSession())),
    tasks: [],
  });
  assert.equal(controller.snapshot().policy.initialQuietPeriodMs, 1_200);
  assert.equal(controller.snapshot().policy.maximumGpuQuietPeriodMs, 3_000);
  assert.equal(controller.snapshot().policy.gpuQuietReason, "pending");
  assert.equal(controller.snapshot().policy.betweenTaskQuietPeriodMs, 600);
  controller.handOffToEditor();
}

  // Disabled is a true no-work control: no task or GPU request can start, and
  // no session is handed to the editor.
  {
    const browser = new DeterministicBrowser(clock);
    const document = new DeterministicDocument();
    const prewarmer = fakePrewarmer(Promise.resolve(fakeSession()));
    let taskRuns = 0;
    const controller = createHomeEditorWarmupController({
      enabled: false,
      browser,
      document,
      prewarmer,
      tasks: [{ id: "disabled-task", run: async () => { taskRuns += 1; } }],
    });

    await controller.start();
    assert.equal(controller.prepareGpuSessionForEditor(), null);
    assert.equal(taskRuns, 0);
    assert.equal(prewarmer.prepareCount, 0);
    assert.equal(controller.snapshot().state, "disabled");
    assert.equal(controller.snapshot().tasks[0].state, "skipped");
    assert.equal(browser.animationFrames.size, 0);
    assert.equal(browser.listenerCount(), 0);
    assert.deepEqual(browser.__homeEditorWarmupReport, controller.snapshot());
  }

  // A smooth touch Home uses the short 1.2-second path. Early jank keeps the
  // conservative 3-second safety path, based on measured frames rather than UA
  // alone. Neither path may request the adapter before its gate settles.
  {
    const smoothBrowser = new DeterministicBrowser(clock, "Mozilla/5.0 (iPhone)");
    const smoothPrewarmer = fakePrewarmer(Promise.resolve(fakeSession()));
    const smoothController = createHomeEditorWarmupController({
      enabled: true,
      browser: smoothBrowser,
      document: new DeterministicDocument(),
      prewarmer: smoothPrewarmer,
      tasks: [],
    });
    const smoothRun = smoothController.start();
    await driveWithoutTimeoutsUntil(
      smoothController,
      smoothBrowser,
      () => smoothController.snapshot().policy.gpuQuietReason !== "pending",
      [16, 16, 16],
    );
    assert.equal(smoothController.snapshot().policy.gpuQuietReason, "smooth");
    assert.equal(smoothController.snapshot().policy.initialQuietPeriodMs, 1_200);
    assert.equal(smoothPrewarmer.prepareCount, 0);
    smoothController.handOffToEditor();
    await smoothRun;

    const jankyBrowser = new DeterministicBrowser(clock, "Mozilla/5.0 (Android)");
    const jankyPrewarmer = fakePrewarmer(Promise.resolve(fakeSession()));
    const jankyController = createHomeEditorWarmupController({
      enabled: true,
      browser: jankyBrowser,
      document: new DeterministicDocument(),
      prewarmer: jankyPrewarmer,
      tasks: [],
    });
    const jankyRun = jankyController.start();
    await driveWithoutTimeoutsUntil(
      jankyController,
      jankyBrowser,
      () => jankyController.snapshot().policy.gpuQuietReason !== "pending",
      [16, 90, 16],
    );
    assert.equal(jankyController.snapshot().policy.gpuQuietReason, "early-jank");
    assert.equal(jankyController.snapshot().policy.initialQuietPeriodMs, 3_000);
    assert.equal(jankyPrewarmer.prepareCount, 0);
    jankyController.handOffToEditor();
    await jankyRun;
  }

  // Input received during the short gate restarts its quiet clock. The old
  // timeout may fire, but it must schedule the remaining quiet time instead of
  // allowing a device request into the interaction.
  {
    const browser = new DeterministicBrowser(clock, "Mozilla/5.0 (iPhone)");
    const prewarmer = fakePrewarmer(Promise.resolve(fakeSession()));
    const controller = createHomeEditorWarmupController({
      enabled: true,
      browser,
      document: new DeterministicDocument(),
      prewarmer,
      tasks: [],
    });
    const runPromise = controller.start();
    await driveWithoutTimeoutsUntil(
      controller,
      browser,
      () => controller.snapshot().policy.gpuQuietReason === "smooth",
    );
    const firstDelay = Math.max(...[...browser.timeouts.values()].map((entry) => entry.delay));
    browser.advanceTime(Math.floor(firstDelay / 2));
    browser.dispatch("pointerdown");
    browser.advanceTime(Math.ceil(firstDelay / 2));
    await microtasks();
    assert.equal(prewarmer.prepareCount, 0);
    assert.ok(browser.timeouts.size > 0, "input must leave a restarted quiet timeout");
    browser.flushTimeouts();
    await microtasks();
    browser.flushIdle();
    await microtasks();
    assert.equal(prewarmer.prepareCount, 1);
    controller.handOffToEditor();
    await runPromise;
  }

  // Device-free work begins after paint/idle while prepareCount is still zero.
  // Handoff requests the exact editor session immediately and does not wait for
  // an in-flight CPU/module-cache task that can only stop at its next boundary.
  {
    const browser = new DeterministicBrowser(clock);
    const session = fakeSession();
    const prewarmer = fakePrewarmer(Promise.resolve(session));
    const preGpuGate = deferred();
    let firstPreGpuStarted = false;
    let laterPreGpuRuns = 0;
    let gpuTaskRuns = 0;
    const controller = createHomeEditorWarmupController({
      enabled: true,
      browser,
      document: new DeterministicDocument(),
      prewarmer,
      preGpuTasks: [
        {
          id: "device-free-in-flight",
          run: async (context) => {
            assert.equal("session" in context, false);
            firstPreGpuStarted = true;
            await preGpuGate.promise;
          },
        },
        { id: "device-free-later", run: async () => { laterPreGpuRuns += 1; } },
      ],
      tasks: [{ id: "gpu-later", run: async () => { gpuTaskRuns += 1; } }],
    });
    const runPromise = controller.start();
    await driveWithoutTimeoutsUntil(controller, browser, () => firstPreGpuStarted);
    assert.equal(prewarmer.prepareCount, 0);
    const editorSessionPromise = controller.prepareGpuSessionForEditor();
    controller.handOffToEditor();
    assert.equal(await editorSessionPromise, session);
    assert.equal(prewarmer.prepareCount, 1);
    assert.equal(laterPreGpuRuns, 0);
    assert.equal(gpuTaskRuns, 0);
    preGpuGate.resolve();
    await runPromise;
    assert.deepEqual(
      controller.snapshot().preGpuTasks.map((task) => task.state),
      ["completed", "skipped"],
    );
    assert.equal(controller.snapshot().tasks[0].state, "skipped");
  }

  // A best-effort pre-GPU cache failure is isolated: later pre-GPU work and
  // exact-session GPU tasks still run, while diagnostics retain the error.
  {
    const browser = new DeterministicBrowser(clock);
    const session = fakeSession();
    const prewarmer = fakePrewarmer(Promise.resolve(session));
    let secondPreGpuRuns = 0;
    let gpuTaskSession = null;
    const loggedErrors = [];
    const originalConsoleError = console.error;
    console.error = (...values) => loggedErrors.push(values);
    try {
      const controller = createHomeEditorWarmupController({
        enabled: true,
        browser,
        document: new DeterministicDocument(),
        prewarmer,
        preGpuTasks: [
          { id: "failing-source", run: async () => { throw new Error("source miss"); } },
          { id: "following-source", run: async () => { secondPreGpuRuns += 1; } },
        ],
        tasks: [
          {
            id: "gpu-after-source-failure",
            run: async ({ session: taskSession }) => { gpuTaskSession = taskSession; },
          },
        ],
      });
      const runPromise = controller.start();
      await driveUntil(controller, browser, () => controller.snapshot().state === "ready");
      await runPromise;
      assert.equal(secondPreGpuRuns, 1);
      assert.equal(gpuTaskSession, session);
      assert.equal(prewarmer.prepareCount, 1);
      assert.deepEqual(
        controller.snapshot().preGpuTasks.map((task) => task.state),
        ["failed", "completed"],
      );
      assert.match(controller.snapshot().errors[0], /pre-gpu failing-source: source miss/);
      assert.equal(loggedErrors.length, 1);
    } finally {
      console.error = originalConsoleError;
    }
  }

  // Tasks run one at a time, keep their declared order, share one session and
  // wait through Home's paint/idle checkpoints before doing work.
  {
    const browser = new DeterministicBrowser(clock);
    const document = new DeterministicDocument();
    const session = fakeSession();
    const preparedPromise = Promise.resolve(session);
    const prewarmer = fakePrewarmer(preparedPromise);
    const order = [];
    const controller = createHomeEditorWarmupController({
      enabled: true,
      browser,
      document,
      prewarmer,
      tasks: [
        {
          id: "first",
          run: async (context) => {
            assert.equal(context.session, session);
            order.push("first:start");
            await context.yieldToHome();
            order.push("first:end");
            return { compiled: 2 };
          },
        },
        {
          id: "second",
          run: async (context) => {
            assert.equal(context.session, session);
            order.push("second");
            // Model the main-thread part of a final program compile. The
            // controller must sample the following frame before it stops.
            clock.nowMs += 120;
            return undefined;
          },
        },
      ],
    });

    const runPromise = controller.start();
    // A recent Home gesture must keep GPU work out of the same interaction
    // window; the dedicated reset test above covers the full timeout restart.
    browser.flushAnimationFrame();
    await microtasks();
    browser.flushAnimationFrame();
    await microtasks();
    browser.dispatch("pointerdown");
    browser.flushIdle();
    await microtasks();
    assert.deepEqual(order, []);
    assert.equal(prewarmer.prepareCount, 0);

    await driveUntil(controller, browser, () => controller.snapshot().state === "ready");
    await runPromise;
    assert.deepEqual(order, ["first:start", "first:end", "second"]);
    assert.equal(prewarmer.prepareCount, 1);
    const report = controller.snapshot();
    assert.equal(report.state, "ready");
    assert.equal(report.gpuSessionReady, true);
    assert.equal(report.gpu.createdCount, 0);
    assert.deepEqual(report.tasks.map((task) => task.state), ["completed", "completed"]);
    assert.deepEqual(report.tasks[0].detail, { compiled: 2 });
    assert.equal(report.tasks[1].detail, null);
    assert.deepEqual(report.errors, []);
    assert.ok(report.responsiveness.maximumFrameGapMs >= 120);
    assert.ok(report.responsiveness.framesOver33Ms >= 1);
    assert.equal(browser.listenerCount(), 0);
  }

  // A click during an active task adopts the exact same session promise. The
  // in-flight bounded task may settle, while all later optional work is skipped.
  {
    const browser = new DeterministicBrowser(clock);
    const document = new DeterministicDocument();
    const session = fakeSession();
    const preparedPromise = Promise.resolve(session);
    const prewarmer = fakePrewarmer(preparedPromise);
    const taskGate = deferred();
    let taskSession = null;
    let secondRuns = 0;
    const controller = createHomeEditorWarmupController({
      enabled: true,
      browser,
      document,
      prewarmer,
      tasks: [
        {
          id: "in-flight",
          blocksEditorDeviceUse: true,
          run: async (context) => {
            taskSession = context.session;
            await taskGate.promise;
          },
        },
        { id: "later", run: async () => { secondRuns += 1; } },
      ],
    });

    const runPromise = controller.start();
    await driveUntil(controller, browser, () => taskSession !== null);
    const editorSessionPromise = controller.prepareGpuSessionForEditor();
    assert.equal(taskSession, session);
    controller.handOffToEditor();
    assert.equal(controller.snapshot().state, "handed-off");
    assert.equal(controller.snapshot().editorOpening, true);
    assert.equal(controller.snapshot().tasks[1].state, "skipped");
    let editorSessionSettled = false;
    void editorSessionPromise.then(() => { editorSessionSettled = true; });
    await microtasks();
    assert.equal(
      editorSessionSettled,
      false,
      "exclusive Stroke work must settle its device-global scope before editor adoption",
    );
    taskGate.resolve();
    assert.equal(await editorSessionPromise, session);
    await runPromise;
    assert.equal(secondRuns, 0);
    assert.equal(prewarmer.prepareCount, 1);
    assert.deepEqual(
      controller.snapshot().tasks.map((task) => task.state),
      ["completed", "skipped"],
    );
    assert.equal(browser.listenerCount(), 0);
  }

  // Handoff before the first Home paint cancels all optional work and must not
  // accidentally request a device on behalf of the abandoned Home run.
  {
    const browser = new DeterministicBrowser(clock);
    const document = new DeterministicDocument();
    const prewarmer = fakePrewarmer(Promise.resolve(fakeSession()));
    let taskRuns = 0;
    const controller = createHomeEditorWarmupController({
      enabled: true,
      browser,
      document,
      prewarmer,
      tasks: [{ id: "never", run: async () => { taskRuns += 1; } }],
    });

    const runPromise = controller.start();
    controller.handOffToEditor();
    // Pending paint checkpoints must be cancelled and resolved by handoff;
    // hidden/background Home must not leave this lifecycle promise hanging.
    await runPromise;
    assert.equal(prewarmer.prepareCount, 0);
    assert.equal(taskRuns, 0);
    assert.equal(controller.snapshot().state, "handed-off");
    assert.equal(controller.snapshot().tasks[0].state, "skipped");
    assert.equal(browser.animationFrames.size, 0);
    assert.equal(browser.listenerCount(), 0);
  }

  // GPU preparation failure is reported and contained by Home. The same
  // editor handoff retries once; its own cold fallback still contains a second
  // failure without making Home unusable.
  {
    const browser = new DeterministicBrowser(clock);
    const document = new DeterministicDocument();
    const preparationError = new Error("synthetic device rejection");
    const rejectedPromise = Promise.reject(preparationError);
    // Attach a handler before the controller receives it; the controller also
    // observes the same promise, but Node's strict rejection mode is immediate.
    void rejectedPromise.catch(() => {});
    const prewarmer = fakePrewarmer(rejectedPromise);
    let taskRuns = 0;
    const loggedErrors = [];
    const originalConsoleError = console.error;
    console.error = (...values) => loggedErrors.push(values);
    try {
      const controller = createHomeEditorWarmupController({
        enabled: true,
        browser,
        document,
        prewarmer,
        tasks: [{ id: "skipped-after-failure", run: async () => { taskRuns += 1; } }],
      });
      const runPromise = controller.start();
      await driveUntil(controller, browser, () => controller.snapshot().state === "failed");
      await runPromise;

      const report = controller.snapshot();
      assert.equal(report.state, "failed");
      assert.equal(report.gpuSessionReady, false);
      assert.deepEqual(report.errors, [preparationError.message]);
      assert.equal(report.tasks[0].state, "skipped");
      assert.equal(taskRuns, 0);
      assert.equal(prewarmer.prepareCount, 1);
      assert.equal(loggedErrors.length, 1);
      assert.equal(browser.listenerCount(), 0);
      const editorSessionPromise = controller.prepareGpuSessionForEditor();
      await assert.rejects(editorSessionPromise, (error) => error === preparationError);
      assert.equal(prewarmer.prepareCount, 2);
    } finally {
      console.error = originalConsoleError;
    }
  }
console.log("Home editor warm-up controller verification passed.");
