# Stroke geometry kernel

Dependency-light `wasm32-unknown-unknown` kernel for the CPU geometry portion of
an interactive raster stroke. It keeps one gesture's state in caller-owned
linear memory and processes input samples in batches using `f64` throughout.

The kernel covers:

- causal faded position stabilization;
- predictive cubic curve planning and flattening;
- fixed-distance and pressure-dependent dab resampling;
- the revisionable stabilization tail required by a live preview.

## ABI

ABI version 1 uses caller-owned, non-overlapping linear-memory regions. All
numeric arrays are little-endian `f64`:

- input sample stride 4: `x, y, pressure, timeMs`;
- dab stride 6: `x, y, pressure, timeMs, directionX, directionY`;
- tail stride 10: stabilized `x, y, pressure, timeMs, sequence`, then raw
  `x, y`, filtered `x, y`, and fade weight;
- summary stride 16: status, consumed inputs, emitted dabs, total dabs,
  mature/forced/tail/maximum-tail counts, four curve counters, spacing carry,
  latest sequence, stabilization time constant, and finished flag.

The exported functions are `stroke_geometry_begin`,
`stroke_geometry_set_fixed_spacing`, `stroke_geometry_process_batch`,
`stroke_geometry_finish`, and `stroke_geometry_copy_state`, plus ABI/state-size
queries. The current state allocation is 57,600 bytes, queried at runtime
rather than hard-coded by the adapter.

It deliberately does not handle pointer events, brush resources, color,
history, GPU uploads or pixel rendering. The JavaScript adapter retains an
exact fallback and selects one backend for the complete gesture.

The synchronous streaming adapter is intended to be called once per input
sample (or per coalesced batch):

```js
const session = processor.begin(firstSample, options);
const update = session.processBatch(samples, {
  includeTail: false,
  includePreviewTail: true,
  spacing: nextFixedSpacing,
});
const completed = session.finish();
```

`includeTail: false` avoids copying diagnostic tail lanes across the Wasm
boundary. Preview dabs are produced by cloning the compact authoritative state
and finishing the clone, so preview generation cannot change the real stroke.
If one input, a preview, or pointer-up exceeds the ordinary live dab arena, the
adapter restores that snapshot and retries in a separate geometrically grown,
bounded arena; the common streaming allocation therefore stays small without
truncating a valid dense tail.
Changing fixed spacing preserves the accumulated distance since the previous
dab. Buffers and the two state slots are reused for the life of the processor;
only one streaming session may be active on a processor at a time.

The verifier compares the deterministic fixture at final-`f32` precision and
also runs seeded randomized and threshold cases. Cross-runtime transcendental
math is not promised to be universally bit-identical, so that audit reports
its observed absolute and `f32`-ULP envelope as well as any structural/count
divergence.

Build, verify and benchmark from the repository root with the matching scripts
under `scripts/stroke-geometry-*`.

The build also writes `dist/stroke_geometry_kernel.meta.json`, which binds the
checked-in Wasm bytes to the crate configuration, lockfile and Rust sources.
The verifier, benchmark and browser bundle commands reject a stale or
mismatched artifact and direct the caller to run `npm run wasm:stroke:build`.
