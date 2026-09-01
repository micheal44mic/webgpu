import assert from "node:assert/strict";
import fs from "node:fs";

import {
  createGpuDeviceSessionPrewarmer,
  gpuAdapterRequestOptionsForUserAgent,
  gpuDeviceSessionIsUsable,
  requestGpuAdapterForDeviceSession,
  requestGpuDeviceForSession,
  requestGpuDeviceSession,
} from "../src/gpu-device-session.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeDevice(lost = deferred()) {
  const counters = {
    bufferCreates: 0,
    textureCreates: 0,
  };
  const device = {
    features: new Set(),
    lost: lost.promise,
    createTexture(descriptor) {
      counters.textureCreates += 1;
      return { label: descriptor.label ?? "", destroy() {} };
    },
    createBuffer(descriptor) {
      counters.bufferCreates += 1;
      return { label: descriptor.label ?? "", destroy() {} };
    },
  };
  return { device, lost, counters };
}

function fakeAdapter(deviceFactory, features = []) {
  const descriptors = [];
  const adapter = {
    features: new Set(features),
    limits: { maxTextureDimension2D: 8192 },
    async requestDevice(descriptor) {
      descriptors.push(descriptor);
      return deviceFactory(descriptor);
    },
  };
  return { adapter, descriptors };
}

// Platform selection retains the production policy: neutral on Android and
// Windows, preferred GPU elsewhere.
assert.equal(gpuAdapterRequestOptionsForUserAgent("Mozilla Windows NT 10.0"), undefined);
assert.equal(gpuAdapterRequestOptionsForUserAgent("Mozilla Android 15"), undefined);
assert.deepEqual(
  gpuAdapterRequestOptionsForUserAgent("Mozilla Macintosh"),
  { powerPreference: "high-performance" },
);

{
  const device = fakeDevice();
  const { adapter } = fakeAdapter(() => device.device);
  const calls = [];
  const gpu = {
    async requestAdapter(options) {
      calls.push(options);
      return calls.length === 1 ? null : adapter;
    },
  };
  const selected = await requestGpuAdapterForDeviceSession({
    gpu,
    userAgent: "Mozilla Macintosh",
  });
  assert.equal(selected.adapter, adapter);
  assert.deepEqual(calls, [{ powerPreference: "high-performance" }, undefined]);
}

{
  const device = fakeDevice();
  const { adapter } = fakeAdapter(() => device.device);
  const calls = [];
  const gpu = {
    async requestAdapter(options) {
      calls.push(options);
      return calls.length === 1 ? null : adapter;
    },
  };
  const selected = await requestGpuAdapterForDeviceSession({
    gpu,
    userAgent: "Mozilla Android 15",
  });
  assert.equal(selected.adapter, adapter);
  assert.deepEqual(calls, [undefined, { featureLevel: "compatibility" }]);
}

{
  const primaryError = new Error("neutral adapter failed");
  const calls = [];
  const gpu = {
    async requestAdapter(options) {
      calls.push(options);
      if (calls.length === 1) throw primaryError;
      return null;
    },
  };
  await assert.rejects(
    requestGpuAdapterForDeviceSession({ gpu, userAgent: "Mozilla Android 15" }),
    (error) => error === primaryError,
  );
  assert.deepEqual(calls, [undefined, { featureLevel: "compatibility" }]);
}

// Production remains feature-neutral. Diagnostic timestamp support retries
// without the optional feature when the driver advertises it incorrectly.
{
  const device = fakeDevice();
  const { adapter, descriptors } = fakeAdapter(() => device.device, ["timestamp-query"]);
  const production = await requestGpuDeviceForSession(adapter);
  assert.equal(production.device, device.device);
  assert.deepEqual(descriptors, [{ requiredFeatures: [] }]);
}

{
  const device = fakeDevice();
  let attempt = 0;
  const { adapter, descriptors } = fakeAdapter(() => {
    attempt += 1;
    if (attempt === 1) throw new Error("optional feature rejected");
    return device.device;
  }, ["timestamp-query"]);
  const diagnostic = await requestGpuDeviceForSession(adapter, {
    diagnosticTimestampQueryEnabled: true,
  });
  assert.equal(diagnostic.device, device.device);
  assert.deepEqual(descriptors, [
    { requiredFeatures: ["timestamp-query"] },
    { requiredFeatures: [] },
  ]);
  assert.deepEqual(diagnostic.requiredFeatures, []);
}

// Session creation instruments exactly once without allocating any GPU
// resource, and preserves the raw object identity used by device-keyed caches.
{
  const raw = fakeDevice();
  const originalCreateTexture = raw.device.createTexture;
  const { adapter } = fakeAdapter(() => raw.device);
  const session = await requestGpuDeviceSession({
    gpu: { requestAdapter: async () => adapter },
    userAgent: "Mozilla Windows NT 10.0",
  });
  assert.equal(session.device, raw.device);
  assert.notEqual(session.device.createTexture, originalCreateTexture);
  assert.equal(raw.counters.textureCreates, 0);
  assert.equal(raw.counters.bufferCreates, 0);
  assert.equal(session.registry.snapshot().createdCount, 0);
  assert.equal(session.registry.snapshot().currentBytes, 0);

  const texture = session.device.createTexture({
    label: "Session identity test texture",
    format: "rgba8unorm",
    size: [4, 4],
    usage: 0,
  });
  assert.equal(raw.counters.textureCreates, 1);
  assert.equal(session.registry.snapshot().createdCount, 1);
  assert.equal(session.registry.snapshot().liveCount, 1);
  texture.destroy();
  assert.equal(session.registry.snapshot().liveCount, 0);
  assert.equal(session.registry.snapshot().destroyedCount, 1);
}

// A prewarmer is single-entry while pending and while healthy.
{
  const adapterGate = deferred();
  const raw = fakeDevice();
  const { adapter } = fakeAdapter(() => raw.device);
  let adapterRequests = 0;
  const prewarmer = createGpuDeviceSessionPrewarmer({
    gpu: {
      requestAdapter() {
        adapterRequests += 1;
        return adapterGate.promise;
      },
    },
    userAgent: "Mozilla Windows NT 10.0",
  });
  const first = prewarmer.prepare();
  const second = prewarmer.prepare();
  assert.equal(first, second);
  assert.equal(adapterRequests, 1);
  adapterGate.resolve(adapter);
  const session = await first;
  const third = prewarmer.prepare();
  assert.equal(third, first);
  assert.equal(await third, session);
  assert.equal(adapterRequests, 1);
}

// Failure and device loss invalidate only the owning attempt, allowing the
// engine's later call to take a fresh cold path.
{
  const firstDevice = fakeDevice();
  const secondDevice = fakeDevice();
  const devices = [firstDevice.device, secondDevice.device];
  let adapterRequests = 0;
  let deviceRequests = 0;
  const { adapter } = fakeAdapter(() => {
    const device = devices[deviceRequests];
    deviceRequests += 1;
    return device;
  });
  const prewarmer = createGpuDeviceSessionPrewarmer({
    gpu: {
      async requestAdapter() {
        adapterRequests += 1;
        return adapter;
      },
    },
    userAgent: "Mozilla Windows NT 10.0",
  });
  const firstSession = await prewarmer.prepare();
  assert.equal(gpuDeviceSessionIsUsable(firstSession), true);
  firstDevice.lost.resolve({ reason: "destroyed", message: "test" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(gpuDeviceSessionIsUsable(firstSession), false);
  const replacement = await prewarmer.prepare();
  assert.equal(replacement.device, secondDevice.device);
  assert.equal(adapterRequests, 2);
  assert.equal(deviceRequests, 2);
}

{
  const raw = fakeDevice();
  let adapterRequests = 0;
  const { adapter } = fakeAdapter(() => raw.device);
  const prewarmer = createGpuDeviceSessionPrewarmer({
    gpu: {
      async requestAdapter() {
        adapterRequests += 1;
        if (adapterRequests === 1) throw new Error("warm-up failed");
        return adapter;
      },
    },
    userAgent: "Mozilla Windows NT 10.0",
  });
  await assert.rejects(prewarmer.prepare(), /warm-up failed/);
  const recovered = await prewarmer.prepare();
  assert.equal(recovered.device, raw.device);
  assert.equal(adapterRequests, 2);
}

// Static integration guards: every engine device, warm or cold, comes from the
// session helper, and the engine never stacks a second instrumentation layer.
const engineTypes = fs.readFileSync(new URL("../src/engine-types.ts", import.meta.url), "utf8");
const brushEngine = fs.readFileSync(new URL("../src/brush-engine.ts", import.meta.url), "utf8");
const gpuDeviceSession = fs.readFileSync(
  new URL("../src/gpu-device-session.ts", import.meta.url),
  "utf8",
);
assert.match(engineTypes, /prewarmedGpuSession\?: GpuDeviceSession/);
assert.match(brushEngine, /this\.device = deviceSession\.device;/);
assert.match(brushEngine, /this\.gpuResourceRegistry = deviceSession\.registry;/);
assert.match(brushEngine, /requestGpuDeviceSessionFromAdapter\(adapter/);
assert.doesNotMatch(brushEngine, /instrumentGpuDevice/);
assert.equal((gpuDeviceSession.match(/instrumentGpuDevice\(/g) ?? []).length, 1);
assert.doesNotMatch(gpuDeviceSession, /\.create(?:Texture|Buffer)\(/);

console.log("GPU device session verification passed.");
