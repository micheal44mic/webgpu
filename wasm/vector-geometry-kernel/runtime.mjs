const ABI_VERSION = 1;
const METADATA_LENGTH = 9;
const STATUS_OK = 0;
const STATUS_EMPTY = 1;
const MAXIMUM_VERB_COUNT = 5_000_000;
const MAXIMUM_COORDINATE_COUNT = 30_000_000;
const MAXIMUM_REGISTERED_PATH_BYTES = 32 * 1024 * 1024;

const EFFECT_KIND = Object.freeze({
  "source-fill": 0,
  "source-outline-outside": 1,
  "source-outline-filled": 2,
  block: 3,
  "block-outline": 4,
});

const JOIN_KIND = Object.freeze({
  round: 0,
  bevel: 1,
  miter: 2,
});

function requiredExport(exports, name) {
  const value = exports[name];
  if (typeof value !== "function") {
    throw new Error(`Vector geometry Wasm export ${name} is missing.`);
  }
  return value;
}

function checkedRegion(memory, pointer, elementCount, bytesPerElement, label) {
  if (!Number.isSafeInteger(pointer) || pointer < 0) {
    throw new Error(`${label} returned an invalid pointer.`);
  }
  if (!Number.isSafeInteger(elementCount) || elementCount < 0) {
    throw new Error(`${label} returned an invalid element count.`);
  }
  const byteLength = elementCount * bytesPerElement;
  const end = pointer + byteLength;
  if (!Number.isSafeInteger(end) || end > memory.buffer.byteLength) {
    throw new Error(`${label} lies outside Wasm memory.`);
  }
  if (elementCount > 0 && pointer === 0) {
    throw new Error(`${label} returned a null pointer for non-empty data.`);
  }
}

function normalizePath(path) {
  if (!path || !(path.verbs instanceof Uint8Array) || !(path.coords instanceof Float64Array)) {
    throw new TypeError("Vector geometry requires Uint8Array verbs and Float64Array coordinates.");
  }
  if (path.verbs.length > MAXIMUM_VERB_COUNT || path.coords.length > MAXIMUM_COORDINATE_COUNT) {
    throw new RangeError("Vector geometry input exceeds the bounded kernel limits.");
  }
  const retainedBytes = path.verbs.byteLength + path.coords.byteLength;
  if (retainedBytes > MAXIMUM_REGISTERED_PATH_BYTES) {
    throw new RangeError("Vector geometry input exceeds the registered-path memory limit.");
  }
  if (path.verbs.length === 0) {
    return null;
  }
  return {
    fillRule: Number(path.fillRule) === 1 ? 1 : 0,
    verbs: path.verbs,
    coords: path.coords,
  };
}

function normalizeLod(lod) {
  if (!lod) throw new TypeError("Vector geometry LOD is missing.");
  for (const key of [
    "bucket",
    "bucketScale",
    "cubicToQuadraticTolerance",
    "polygonFlattenTolerance",
    "roundArcSagittaTolerance",
    "integerScale",
  ]) {
    if (!Number.isFinite(lod[key])) {
      throw new TypeError(`Vector geometry LOD ${key} must be finite.`);
    }
  }
  if (
    lod.bucketScale <= 0
    || lod.cubicToQuadraticTolerance <= 0
    || lod.polygonFlattenTolerance <= 0
    || lod.roundArcSagittaTolerance <= 0
    || lod.integerScale < 1
  ) {
    throw new RangeError("Vector geometry LOD contains a non-positive scale or tolerance.");
  }
  return lod;
}

function normalizeEffect(effect) {
  if (!effect || typeof effect.kind !== "string") {
    throw new TypeError("Vector effect description is missing.");
  }
  if (effect.kind === "source-fill") {
    return { kind: EFFECT_KIND["source-fill"], x: 0, y: 0, width: 0, join: 0 };
  }
  if (effect.kind === "source-outline") {
    if (!Number.isFinite(effect.width)) throw new TypeError("Vector outline width must be finite.");
    const join = JOIN_KIND[effect.join];
    if (join === undefined) throw new TypeError("Vector outline join is invalid.");
    return {
      kind: effect.includeFill === true
        ? EFFECT_KIND["source-outline-filled"]
        : EFFECT_KIND["source-outline-outside"],
      x: 0,
      y: 0,
      width: effect.width,
      join,
    };
  }
  if (effect.kind === "block") {
    if (!Number.isFinite(effect.vectorX) || !Number.isFinite(effect.vectorY)) {
      throw new TypeError("Vector block direction must be finite.");
    }
    return {
      kind: EFFECT_KIND.block,
      x: effect.vectorX,
      y: effect.vectorY,
      width: 0,
      join: 0,
    };
  }
  if (effect.kind === "block-outline") {
    if (
      !Number.isFinite(effect.vectorX)
      || !Number.isFinite(effect.vectorY)
      || !Number.isFinite(effect.width)
    ) {
      throw new TypeError("Vector block outline values must be finite.");
    }
    const join = JOIN_KIND[effect.join];
    if (join === undefined) throw new TypeError("Vector outline join is invalid.");
    return {
      kind: EFFECT_KIND["block-outline"],
      x: effect.vectorX,
      y: effect.vectorY,
      width: effect.width,
      join,
    };
  }
  throw new TypeError(`Unsupported vector effect kind: ${effect.kind}.`);
}

function decodeKernelError(memory, exports) {
  const pointer = Number(exports.vector_geometry_error_pointer());
  const length = Number(exports.vector_geometry_error_length());
  checkedRegion(memory, pointer, length, 1, "Vector geometry error");
  if (length === 0) return "Vector geometry compilation failed.";
  return new TextDecoder().decode(new Uint8Array(memory.buffer, pointer, length));
}

export async function instantiateVectorGeometryKernel(moduleOrBytes) {
  const wasmByteLength = moduleOrBytes instanceof WebAssembly.Module
    ? null
    : Number(moduleOrBytes.byteLength);
  const instantiated = await WebAssembly.instantiate(moduleOrBytes, {});
  const instance = instantiated instanceof WebAssembly.Instance
    ? instantiated
    : instantiated.instance;
  const exports = instance.exports;
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new Error("Vector geometry Wasm memory export is missing.");
  }
  const abiVersion = requiredExport(exports, "vector_geometry_abi_version");
  if (Number(abiVersion()) !== ABI_VERSION) {
    throw new Error(`Unsupported vector geometry Wasm ABI; expected ${ABI_VERSION}.`);
  }
  const allocateBytes = requiredExport(exports, "vector_geometry_allocate");
  const allocateF64 = requiredExport(exports, "vector_geometry_allocate_f64");
  const deallocateBytes = requiredExport(exports, "vector_geometry_deallocate");
  const deallocateF64 = requiredExport(exports, "vector_geometry_deallocate_f64");
  const compile = requiredExport(exports, "vector_geometry_compile");
  const registerPathExport = requiredExport(exports, "vector_geometry_register_path");
  const releasePathExport = requiredExport(exports, "vector_geometry_release_path");
  const compileRegisteredExport = requiredExport(exports, "vector_geometry_compile_registered");
  for (const name of [
    "vector_geometry_vertices_pointer",
    "vector_geometry_vertices_length",
    "vector_geometry_indices_pointer",
    "vector_geometry_indices_length",
    "vector_geometry_metadata_pointer",
    "vector_geometry_metadata_length",
    "vector_geometry_error_pointer",
    "vector_geometry_error_length",
    "vector_geometry_registered_path_count",
    "vector_geometry_registered_path_bytes",
    "vector_geometry_canonical_cache_entry_count",
    "vector_geometry_canonical_cache_bytes",
    "vector_geometry_canonical_cache_hits",
    "vector_geometry_canonical_cache_misses",
    "vector_geometry_canonical_cache_evictions",
  ]) {
    requiredExport(exports, name);
  }
  if (Number(exports.vector_geometry_metadata_length()) !== METADATA_LENGTH) {
    throw new Error("Vector geometry Wasm metadata layout is incompatible.");
  }

  const registeredHandles = new Set();
  const readCompilationResult = (status, revision, computeMs) => {
    if (status === STATUS_EMPTY) {
      return { mesh: null, computeMs, memoryBytes: memory.buffer.byteLength };
    }
    if (status !== STATUS_OK) {
      throw new Error(decodeKernelError(memory, exports));
    }
    const vertexPointer = Number(exports.vector_geometry_vertices_pointer());
    const vertexLength = Number(exports.vector_geometry_vertices_length());
    const indexPointer = Number(exports.vector_geometry_indices_pointer());
    const indexLength = Number(exports.vector_geometry_indices_length());
    const metadataPointer = Number(exports.vector_geometry_metadata_pointer());
    const metadataLength = Number(exports.vector_geometry_metadata_length());
    checkedRegion(memory, vertexPointer, vertexLength, 4, "Vector geometry vertices");
    checkedRegion(memory, indexPointer, indexLength, 4, "Vector geometry indices");
    checkedRegion(memory, metadataPointer, metadataLength, 8, "Vector geometry metadata");
    if (vertexLength % 2 !== 0 || metadataLength !== METADATA_LENGTH) {
      throw new Error("Vector geometry Wasm returned an invalid mesh layout.");
    }
    const vertices = new Float32Array(memory.buffer, vertexPointer, vertexLength).slice();
    const indices = new Uint32Array(memory.buffer, indexPointer, indexLength).slice();
    const metadata = new Float64Array(
      memory.buffer,
      metadataPointer,
      metadataLength,
    ).slice();
    for (const index of indices) {
      if (index >= vertexLength / 2) {
        throw new Error("Vector geometry Wasm returned an out-of-range index.");
      }
    }
    if (!metadata.every(Number.isFinite)) {
      throw new Error("Vector geometry Wasm returned non-finite metadata.");
    }
    return {
      mesh: {
        revision,
        vertices,
        indices,
        left: metadata[0],
        top: metadata[1],
        right: metadata[2],
        bottom: metadata[3],
        originX: metadata[4],
        originY: metadata[5],
        lodBucket: metadata[6],
        integerScale: metadata[7],
      },
      computeMs,
      memoryBytes: memory.buffer.byteLength,
    };
  };

  const validateHandle = (handle) => {
    if (!Number.isSafeInteger(handle) || handle <= 0 || handle > 0xffff_ffff) {
      throw new RangeError("Vector geometry handle must be a non-zero uint32 value.");
    }
  };

  return Object.freeze({
    backend: "wasm",
    abiVersion: ABI_VERSION,
    wasmByteLength,
    memoryBytes: () => memory.buffer.byteLength,
    diagnostics: () => ({
      registeredPaths: Number(exports.vector_geometry_registered_path_count()),
      registeredPathBytes: Number(exports.vector_geometry_registered_path_bytes()),
      canonicalCacheEntries: Number(exports.vector_geometry_canonical_cache_entry_count()),
      canonicalCacheBytes: Number(exports.vector_geometry_canonical_cache_bytes()),
      canonicalCacheHits: Number(exports.vector_geometry_canonical_cache_hits()),
      canonicalCacheMisses: Number(exports.vector_geometry_canonical_cache_misses()),
      canonicalCacheEvictions: Number(exports.vector_geometry_canonical_cache_evictions()),
      memoryBytes: memory.buffer.byteLength,
    }),
    registerPath(handle, pathSource) {
      validateHandle(handle);
      const path = normalizePath(pathSource);
      if (!path) throw new Error("Cannot register an empty vector path.");
      let verbsPointer = 0;
      let coordsPointer = 0;
      try {
        verbsPointer = Number(allocateBytes(path.verbs.byteLength));
        checkedRegion(memory, verbsPointer, path.verbs.byteLength, 1, "Vector verb input");
        if (path.coords.length > 0) {
          coordsPointer = Number(allocateF64(path.coords.length));
          checkedRegion(memory, coordsPointer, path.coords.length, 8, "Vector coordinate input");
        }
        new Uint8Array(memory.buffer, verbsPointer, path.verbs.byteLength).set(path.verbs);
        if (path.coords.length > 0) {
          new Float64Array(memory.buffer, coordsPointer, path.coords.length).set(path.coords);
        }
        const status = Number(registerPathExport(
          handle,
          verbsPointer,
          path.verbs.length,
          coordsPointer,
          path.coords.length,
          path.fillRule,
        ));
        if (status !== STATUS_OK) throw new Error(decodeKernelError(memory, exports));
        registeredHandles.add(handle);
      } finally {
        if (verbsPointer !== 0) deallocateBytes(verbsPointer, path.verbs.byteLength);
        if (coordsPointer !== 0) deallocateF64(coordsPointer, path.coords.length);
      }
    },
    releasePath(handle) {
      validateHandle(handle);
      releasePathExport(handle);
      registeredHandles.delete(handle);
    },
    compileRegistered(handle, lodSource, effectSource, revision) {
      validateHandle(handle);
      if (!registeredHandles.has(handle)) {
        throw new Error(`Vector geometry handle ${handle} is not registered.`);
      }
      const lod = normalizeLod(lodSource);
      const effect = normalizeEffect(effectSource);
      if (typeof revision !== "string" || revision.length === 0) {
        throw new TypeError("Vector geometry revision must be a non-empty string.");
      }
      const startedAt = performance.now();
      const status = Number(compileRegisteredExport(
        handle,
        lod.cubicToQuadraticTolerance,
        lod.polygonFlattenTolerance,
        lod.roundArcSagittaTolerance,
        lod.integerScale,
        lod.bucket,
        lod.bucketScale,
        effect.kind,
        effect.x,
        effect.y,
        effect.width,
        effect.join,
      ));
      return readCompilationResult(status, revision, performance.now() - startedAt);
    },
    compile(pathSource, lodSource, effectSource, revision) {
      const path = normalizePath(pathSource);
      if (!path) {
        return { mesh: null, computeMs: 0, memoryBytes: memory.buffer.byteLength };
      }
      const lod = normalizeLod(lodSource);
      const effect = normalizeEffect(effectSource);
      if (typeof revision !== "string" || revision.length === 0) {
        throw new TypeError("Vector geometry revision must be a non-empty string.");
      }
      let verbsPointer = 0;
      let coordsPointer = 0;
      try {
        verbsPointer = Number(allocateBytes(path.verbs.byteLength));
        checkedRegion(memory, verbsPointer, path.verbs.byteLength, 1, "Vector verb input");
        if (path.coords.length > 0) {
          coordsPointer = Number(allocateF64(path.coords.length));
          checkedRegion(memory, coordsPointer, path.coords.length, 8, "Vector coordinate input");
        }
        new Uint8Array(memory.buffer, verbsPointer, path.verbs.byteLength).set(path.verbs);
        if (path.coords.length > 0) {
          new Float64Array(memory.buffer, coordsPointer, path.coords.length).set(path.coords);
        }
        const startedAt = performance.now();
        const status = Number(compile(
          verbsPointer,
          path.verbs.length,
          coordsPointer,
          path.coords.length,
          path.fillRule,
          lod.cubicToQuadraticTolerance,
          lod.polygonFlattenTolerance,
          lod.roundArcSagittaTolerance,
          lod.integerScale,
          lod.bucket,
          lod.bucketScale,
          effect.kind,
          effect.x,
          effect.y,
          effect.width,
          effect.join,
        ));
        return readCompilationResult(status, revision, performance.now() - startedAt);
      } finally {
        if (verbsPointer !== 0) deallocateBytes(verbsPointer, path.verbs.byteLength);
        if (coordsPointer !== 0) deallocateF64(coordsPointer, path.coords.length);
      }
    },
  });
}

export async function createVectorGeometryKernel(options = {}) {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new Error("Vector geometry Wasm requires fetch support.");
  }
  const url = options.url ?? new URL("./dist/vector_geometry_kernel.wasm", import.meta.url);
  const response = await fetchImplementation(url);
  if (!response.ok) {
    throw new Error(`Vector geometry Wasm request failed with HTTP ${response.status}.`);
  }
  const bytes = await response.arrayBuffer();
  return instantiateVectorGeometryKernel(bytes);
}
