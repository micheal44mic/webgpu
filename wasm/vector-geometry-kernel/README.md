# Vector geometry kernel

This crate compiles registered path data into vector-effect GPU meshes. The
entire flatten, fixed-point polygon, offset, boolean and triangulation pipeline
runs in one WebAssembly call inside the geometry Worker.

Build the checked artifact with:

```text
npm run wasm:vector:build
```

The editor treats this module as required for vector effects. Initialization or
validation failures are reported to the caller; there is no JavaScript runtime
fallback.
