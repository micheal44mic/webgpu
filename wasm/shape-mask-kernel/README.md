# Scalar mask WebAssembly kernel

This dependency-free kernel accelerates the scalar stage shared by
high-resolution shape masks and scalar grain sources. PNG/deflate decoding
uses browser-native APIs in a dedicated Worker.

One allocation-free WebAssembly call can:

- optionally invert the decoded `Uint16Array`;
- compute the existing little-endian FNV-1a source identity;
- bilinearly resample it into an 8-bit visual mask;
- derive conservative non-zero support from the same four source taps;
- emulate pre-interpolation R8 quantization when requested.

The JavaScript adapter owns linear-memory growth and validates dimensions. The
Rust ABI has no allocator and exports only `memory`, `__heap_base`,
`shape_mask_kernel_abi_version`, and `prepare_scalar_mask_u16`. A zero output
pointer skips that derivative. Initialization failure returns the exact
JavaScript implementation, so loading can remain lazy and non-critical.

Build and verify from the repository root:

```sh
node scripts/build-shape-mask-wasm.mjs
node scripts/verify-shape-mask-wasm.mjs
node scripts/benchmark-shape-mask-wasm.mjs
```

The build needs the installed Rust `wasm32-unknown-unknown` target but no Cargo
dependencies, `wasm-bindgen`, or `wasm-pack`. The benchmark includes copies into
and out of WebAssembly memory; it therefore measures the integration boundary,
not an unrealistically isolated inner loop.

Production loads the module lazily inside the Shape preprocessing Worker. That
Worker also performs PNG decoding, outline extraction, preview mip generation,
and occupancy-map construction before transferring only final buffers to the
renderer. It terminates after an idle interval, so the first canvas frame stays
free of Wasm compilation and retained linear memory is released when the brush
asset path is no longer active. Initialization or Worker failure retains an
exact JavaScript fallback.
