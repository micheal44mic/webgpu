import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const poolPath = path.join(root, "src", "effects-scratch-pool.ts");
const enginePath = path.join(root, "src", "brush-engine.ts");
const bevelPath = path.join(root, "src", "bevel-renderer.ts");
const strokePath = path.join(root, "src", "stroke-renderer.ts");
const poolSource = fs.readFileSync(poolPath, "utf8");
const engineSource = fs.readFileSync(enginePath, "utf8");
const bevelSource = fs.readFileSync(bevelPath, "utf8");
const strokeSource = fs.readFileSync(strokePath, "utf8");

const runtimeSource = stripTypeScriptTypes(poolSource, {
  mode: "transform",
});
globalThis.GPUBufferUsage = { STORAGE: 1 };
const moduleUrl = `data:text/javascript;base64,${
  Buffer.from(runtimeSource).toString("base64")
}#${Date.now()}`;
const {
  EffectsScratchPool,
  EFFECTS_SCRATCH_POOL_IDLE_SHRINK_DELAY_MS,
  EFFECTS_SCRATCH_MINIMUM_SHRINK_BYTES,
  effectsScratchCanShrink,
  effectsScratchShrinkIsWorthwhile,
} = await import(moduleUrl);

function createMockDevice() {
  const allocations = [];
  return {
    allocations,
    device: {
      limits: {
        minStorageBufferOffsetAlignment: 256,
        maxBufferSize: 1_048_576,
        maxStorageBufferBindingSize: 524_288,
      },
      createBuffer(descriptor) {
        const buffer = {
          ...descriptor,
          destroyed: false,
          destroy() {
            this.destroyed = true;
          },
        };
        allocations.push(buffer);
        return buffer;
      },
    },
  };
}

{
  const { device, allocations } = createMockDevice();
  const pool = new EffectsScratchPool(device);
  const stroke = pool.declareEffect("stroke", [
    { id: "ping-a", label: "A", size: 256 },
    { id: "ping-b", label: "B", size: 256 },
  ]);
  assert.ok(stroke);
  assert.equal(stroke.ranges["ping-a"].offset, 0);
  assert.equal(stroke.ranges["ping-b"].offset, 256);
  assert.equal(pool.currentBytes, 512);
  assert.equal(pool.allocationCount, 1);

  const bevel = pool.declareEffect("bevel", [
    { id: "common", label: "common", size: 128 },
  ]);
  assert.ok(bevel);
  assert.equal(bevel.ranges.common.offset, 0, "effect layouts must alias at byte zero");
  assert.equal(pool.currentBytes, 512);
  assert.equal(pool.allocationCount, 1, "smaller requests must reuse current capacity");

  pool.declareEffect("stroke", [
    { id: "single", label: "smaller stroke layout", size: 256 },
  ]);
  assert.equal(pool.currentBytes, 512);
  assert.equal(pool.allocationCount, 1, "downsized declarations must not reallocate");

  const fill = pool.declareEffect("fill", []);
  assert.equal(fill, null);
  assert.equal(pool.snapshot().requirements.fill, 0);
  assert.equal(pool.allocationCount, 1, "zero-scratch effects must not allocate");
  assert.equal(allocations.length, 1);
}

{
  let activeStroke = false;
  const { device } = createMockDevice();
  const pool = new EffectsScratchPool(device, {
    canReallocate: () => !activeStroke,
  });
  pool.declareEffect("stroke", [
    { id: "ping-a", label: "A", size: 256 },
    { id: "ping-b", label: "B", size: 256 },
  ]);
  pool.releaseRequirement("stroke");

  activeStroke = true;
  assert.throws(
    () => pool.shrinkToFit(),
    /vietata durante una pennellata attiva/,
    "the physical pool must reject active-stroke shrink",
  );
  assert.equal(pool.currentBytes, 512);

  activeStroke = false;
  assert.equal(pool.shrinkToFit(), true);
  assert.equal(pool.currentBytes, 0);
  assert.equal(pool.shrinkCount, 1);
}

const idleState = {
  initialized: true,
  activeStroke: false,
  historyBusy: false,
  rasterStrokeBusy: false,
  rasterBevelBusy: false,
  queuedWork: false,
};
assert.equal(effectsScratchCanShrink(idleState), true);
assert.equal(
  effectsScratchCanShrink({ ...idleState, activeStroke: true }),
  false,
  "active strokes must block shrink",
);
assert.equal(
  effectsScratchCanShrink({ ...idleState, queuedWork: true }),
  false,
  "queued work must block shrink",
);
assert.equal(EFFECTS_SCRATCH_POOL_IDLE_SHRINK_DELAY_MS, 1_500);

{
  const { device } = createMockDevice();
  const pool = new EffectsScratchPool(device);
  assert.throws(
    () => pool.declareEffect("too-large", [
      { id: "range", label: "oversized binding", size: 524_292 },
    ]),
    /maxStorageBufferBindingSize/,
  );
  assert.equal(pool.currentBytes, 0);
}

{
  const { device } = createMockDevice();
  const pool = new EffectsScratchPool(device);
  assert.throws(
    () => pool.declareEffect("buffer-too-large", [
      { id: "a", label: "A", size: 524_288 },
      { id: "b", label: "B", size: 524_288 },
      { id: "c", label: "C", size: 4 },
    ]),
    /maxBufferSize/,
  );
  assert.equal(pool.currentBytes, 0);
}

assert.match(
  engineSource,
  /canReallocateScratch:\s*\(\)\s*=>\s*this\.activeStroke\s*===\s*null/,
);
assert.match(engineSource, /EFFECTS_SCRATCH_POOL_IDLE_SHRINK_DELAY_MS/);
assert.match(engineSource, /await this\.device\.queue\.onSubmittedWorkDone\(\)/);
const bevelPrewarmIndex = engineSource.indexOf(
  "this.rasterBevelRenderer?.prewarmWorkspace(this.rasterBevelStyle);",
);
const activeStrokeAssignmentIndex = engineSource.indexOf("this.activeStroke = {");
assert.notEqual(bevelPrewarmIndex, -1, "Bevel scratch prewarm call must exist");
assert.notEqual(activeStrokeAssignmentIndex, -1, "activeStroke assignment must exist");
assert.ok(
  bevelPrewarmIndex < activeStrokeAssignmentIndex,
  "Bevel scratch prewarm must precede activeStroke assignment",
);
assert.match(bevelSource, /releaseIdleWorkspace\(\): boolean/);
assert.match(
  strokeSource,
  /@binding\(1\) var<storage, read_write> inputSeeds: array<vec2<u32>>;/,
  "shared-buffer JFA input must use the same storage usage class as its output",
);
assert.match(
  strokeSource,
  /\{ binding: 1, visibility: GPUShaderStage\.COMPUTE, buffer: \{ type: "storage" \} \},/,
);

// A refused reallocation must leave the pool exactly as it was: if the
// requirement were committed before the capacity check, the map would claim a
// footprint the buffer does not have and every later lease would hand out
// ranges past its end.
{
  const { device } = createMockDevice();
  let reallocationAllowed = true;
  const pool = new EffectsScratchPool(device, {
    canReallocate: () => reallocationAllowed,
  });
  pool.declareEffect("stroke", [
    { id: "a", label: "a", size: 1_024 },
    { id: "b", label: "b", size: 1_024 },
  ]);
  const bytesBefore = pool.currentBytes;
  const snapshotBefore = pool.snapshot();
  reallocationAllowed = false;
  assert.throws(
    () => pool.declareEffect("stroke", [
      { id: "a", label: "a", size: 65_536 },
      { id: "b", label: "b", size: 65_536 },
    ]),
    /pennellata attiva/,
    "A refused growth must throw",
  );
  assert.equal(pool.currentBytes, bytesBefore, "Refused growth must not change capacity");
  assert.deepEqual(
    pool.snapshot().requirements,
    snapshotBefore.requirements,
    "Refused growth must not commit the new requirement",
  );
  const lease = pool.lease("stroke");
  for (const range of Object.values(lease.ranges)) {
    assert.ok(
      range.offset + range.size <= pool.currentBytes,
      `Lease range ${range.offset}+${range.size} must stay inside the ${pool.currentBytes} byte buffer`,
    );
  }
  reallocationAllowed = true;
  assert.equal(pool.shrinkToFit(), false, "Nothing to reclaim after a refused growth");
}

// Shrinking costs a buffer replacement plus a bind group rebuild, so it must
// only happen when it reclaims something material. Otherwise a releasable
// effect that is merely a little larger than the retained one turns every idle
// gap between two strokes into a free/regrow cycle.
assert.equal(EFFECTS_SCRATCH_MINIMUM_SHRINK_BYTES, 8 * 1024 * 1024);
assert.equal(
  effectsScratchShrinkIsWorthwhile(18 * 1024 * 1024, 16 * 1024 * 1024),
  false,
  "A 2 MiB swing must not pay for a reallocation",
);
assert.equal(
  effectsScratchShrinkIsWorthwhile(64 * 1024 * 1024, 16 * 1024 * 1024),
  true,
  "Dropping from the 2048² tier must still shrink",
);
assert.equal(
  effectsScratchShrinkIsWorthwhile(16 * 1024 * 1024, 0),
  true,
  "Disabling every effect must still return the pool to zero",
);
assert.match(
  engineSource,
  /effectsScratchShrinkIsWorthwhile\(snapshot\.currentBytes, retainedBytes\)/,
  "The engine shrink policy must go through the worthwhile threshold",
);

// The peak is a session statistic: recreating the workbench must not reset it.
{
  const { device } = createMockDevice();
  const pool = new EffectsScratchPool(device, { initialPeakBytes: 4_096 });
  assert.equal(pool.peakBytes, 4_096, "The carried peak must survive construction");
  pool.declareEffect("stroke", [{ id: "a", label: "a", size: 1_024 }]);
  assert.equal(pool.peakBytes, 4_096, "A smaller allocation must not lower the peak");
}
assert.match(
  engineSource,
  /initialScratchPeakBytes: previousScratchPeakBytes/,
  "recreateLayerResources must carry the pool peak across the workbench replacement",
);

console.log("Effects scratch pool verification passed.");
