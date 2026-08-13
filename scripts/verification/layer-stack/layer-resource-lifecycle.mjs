import assert from "node:assert/strict";
import { layerEffectRendererRequirements } from "../../../src/layer-stack.ts";
import { runGpuAllocationTransaction } from "../../../src/gpu-allocation-transaction.ts";

// Smusso is displayed by the shared RasterStrokeRenderer even when Traccia is
// disabled. This is the lifecycle case that previously returned with the
// Smusso checkbox checked but no composed effect after another layer released
// the renderers.
{
  assert.deepEqual(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: true },
    ),
    {
      needsStrokeRenderer: true,
      needsBevelRenderer: true,
      needsOuterShadowRenderer: false,
      needsInnerShadowRenderer: false,
      needsColorOverlayRenderer: false,
      colorOverlayScratchBytes: 0,
      strokeWidth: 14,
    },
  );
  assert.equal(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: false },
    ).needsStrokeRenderer,
    false,
  );
  assert.equal(
    layerEffectRendererRequirements(
      { enabled: true, width: 512 },
      { enabled: false },
    ).needsStrokeRenderer,
    true,
  );
  assert.deepEqual(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: false },
      { enabled: true },
      { enabled: false },
    ),
    {
      needsStrokeRenderer: true,
      needsBevelRenderer: false,
      needsOuterShadowRenderer: true,
      needsInnerShadowRenderer: false,
      needsColorOverlayRenderer: false,
      colorOverlayScratchBytes: 0,
      strokeWidth: 14,
    },
  );
  assert.equal(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: false },
      { enabled: false },
      { enabled: true },
    ).needsInnerShadowRenderer,
    true,
  );
  assert.deepEqual(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: false },
      { enabled: false },
      { enabled: false },
      { enabled: true, opacity: 65 },
    ),
    {
      needsStrokeRenderer: true,
      needsBevelRenderer: false,
      needsOuterShadowRenderer: false,
      needsInnerShadowRenderer: false,
      needsColorOverlayRenderer: true,
      colorOverlayScratchBytes: 0,
      strokeWidth: 14,
    },
  );
  assert.equal(
    layerEffectRendererRequirements(
      { enabled: false, width: 14 },
      { enabled: false },
      { enabled: false },
      { enabled: false },
      { enabled: true, opacity: 0 },
    ).needsStrokeRenderer,
    false,
    "opacity zero non deve trattenere il compositore condiviso",
  );
}

// WebGPU reports texture OOM asynchronously when error scopes are popped. The
// allocation transaction must destroy a candidate even when its factory
// returned normally, and must leave a successful candidate alive.
{
  const pushed = [];
  const errors = [null, { message: "OOM simulato" }];
  const host = {
    pushErrorScope(filter) {
      pushed.push(filter);
    },
    async popErrorScope() {
      return errors.shift() ?? null;
    },
  };
  let destroyed = false;
  await assert.rejects(
    runGpuAllocationTransaction(host, "Texture test", (transaction) => {
      transaction.deferRollback(() => { destroyed = true; });
      return { candidate: true };
    }),
    /Texture test: OOM simulato/,
  );
  assert.deepEqual(pushed, ["out-of-memory", "validation"]);
  assert.equal(errors.length, 0, "entrambi gli error scope devono essere chiusi");
  assert.equal(destroyed, true, "il candidato OOM deve essere distrutto");
}

{
  const host = {
    pushErrorScope() {},
    async popErrorScope() { return null; },
  };
  let destroyed = false;
  const candidate = await runGpuAllocationTransaction(
    host,
    "Texture valida",
    (transaction) => {
      transaction.deferRollback(() => { destroyed = true; });
      return { candidate: true };
    },
  );
  assert.deepEqual(candidate, { candidate: true });
  assert.equal(destroyed, false, "il commit non deve distruggere il candidato valido");
}
