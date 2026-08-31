import assert from "node:assert/strict";

import {
  pruneVectorTextGpuResourceCache,
  vectorTextGpuResourceKey,
} from "../src/engine-vector-text-resources.ts";
import {
  createVectorTextGpuMeshResources,
  destroyVectorTextGpuResources,
} from "../src/vector-text-gpu-resources.ts";

Object.defineProperty(globalThis, "GPUBufferUsage", {
  configurable: true,
  value: Object.freeze({
    COPY_DST: 1 << 0,
    INDEX: 1 << 1,
    VERTEX: 1 << 2,
  }),
});

const createdBuffers = [];
const uploadedBuffers = [];
const device = {
  createBuffer(descriptor) {
    const record = {
      descriptor,
      destroyCount: 0,
      destroy() {
        record.destroyCount += 1;
      },
    };
    createdBuffers.push(record);
    return record;
  },
  queue: {
    writeBuffer(buffer, offset, data) {
      uploadedBuffers.push({ buffer, offset, byteLength: data.byteLength });
    },
  },
};

const sharedMesh = {
  revision: "geometry:shared",
  vertices: new Float32Array([
    0, 0,
    32, 0,
    0, 32,
  ]),
  indices: new Uint32Array([0, 1, 2]),
};

function meshDraw(meshKey) {
  return {
    mode: "mesh-direct",
    meshKey,
    mesh: sharedMesh,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    localOffsetX: 0,
    localOffsetY: 0,
    color: [0, 0, 0],
    opacity: 1,
  };
}

const firstNodeDraw = meshDraw("node:first");
const secondNodeDraw = meshDraw("node:second");
const sharingEnabled = true;
const resourceCache = new Map();

function resourceForDraw(draw) {
  const key = vectorTextGpuResourceKey(draw, sharingEnabled);
  let resources = resourceCache.get(key);
  if (!resources) {
    resources = createVectorTextGpuMeshResources(device, draw);
    resourceCache.set(key, resources);
  }
  return { key, resources };
}

function activeResourceKeys(draws) {
  return new Set(
    draws.map((draw) => vectorTextGpuResourceKey(draw, sharingEnabled)),
  );
}

const firstNode = resourceForDraw(firstNodeDraw);
const secondNode = resourceForDraw(secondNodeDraw);

assert.equal(firstNode.key, "mesh:geometry:shared");
assert.equal(secondNode.key, firstNode.key);
assert.equal(secondNode.resources, firstNode.resources);
assert.equal(resourceCache.size, 1);
assert.equal(createdBuffers.length, 2, "one shared mesh owns one vertex/index pair");
assert.equal(uploadedBuffers.length, 2, "the shared mesh must upload only once");

pruneVectorTextGpuResourceCache(
  resourceCache,
  activeResourceKeys([secondNodeDraw]),
  destroyVectorTextGpuResources,
);

assert.equal(resourceCache.size, 1, "removing one owner must preserve shared geometry");
assert.deepEqual(
  createdBuffers.map((buffer) => buffer.destroyCount),
  [0, 0],
  "shared buffers must stay live while one owner remains",
);

pruneVectorTextGpuResourceCache(
  resourceCache,
  activeResourceKeys([]),
  destroyVectorTextGpuResources,
);

assert.equal(resourceCache.size, 0, "removing the last owner must prune shared geometry");
assert.deepEqual(
  createdBuffers.map((buffer) => buffer.destroyCount),
  [1, 1],
  "the vertex and index buffers must each be destroyed exactly once",
);

pruneVectorTextGpuResourceCache(
  resourceCache,
  activeResourceKeys([]),
  destroyVectorTextGpuResources,
);

assert.deepEqual(
  createdBuffers.map((buffer) => buffer.destroyCount),
  [1, 1],
  "repeated pruning must not destroy an already removed resource",
);

console.log("Vector GPU shared-resource lifecycle verified.");
