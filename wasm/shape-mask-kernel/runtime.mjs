const ABI_VERSION = 1;
const FLAG_INVERT = 1 << 0;
const FLAG_QUANTIZE_R8 = 1 << 1;
const WASM_PAGE_BYTES = 64 * 1024;
const MAXIMUM_DIMENSION = 16_384;

const align = (value, alignment) => Math.ceil(value / alignment) * alignment;

function normalizeRequest(source, sourceWidth, sourceHeight, options = {}) {
  if (!(source instanceof Uint16Array)) {
    throw new TypeError("Scalar mask source must be a Uint16Array.");
  }
  if (
    !Number.isSafeInteger(sourceWidth)
    || !Number.isSafeInteger(sourceHeight)
    || sourceWidth < 1
    || sourceHeight < 1
    || sourceWidth > MAXIMUM_DIMENSION
    || sourceHeight > MAXIMUM_DIMENSION
  ) {
    throw new RangeError("Scalar mask source dimensions are invalid.");
  }
  if (source.length !== sourceWidth * sourceHeight) {
    throw new RangeError("Scalar mask sample count does not match its dimensions.");
  }
  const targetSize = options.targetSize ?? 2048;
  if (
    !Number.isSafeInteger(targetSize)
    || targetSize < 1
    || targetSize > MAXIMUM_DIMENSION
  ) {
    throw new RangeError("Scalar mask target size is invalid.");
  }
  const outputSamples = targetSize * targetSize;
  const sourceBytes = source.byteLength;
  const outputBytes = outputSamples;
  if (
    !Number.isSafeInteger(outputSamples)
    || !Number.isSafeInteger(sourceBytes + outputBytes * 2)
    || sourceBytes + outputBytes * 2 > 0xffff_ffff
  ) {
    throw new RangeError("Scalar mask request exceeds the kernel address space.");
  }
  return {
    emitBase: options.emitBase !== false,
    emitSupport: options.emitSupport !== false,
    invert: options.invert === true,
    outputSamples,
    quantizeR8: options.quantizeR8 === true,
    sourceBytes,
    sourceHeight,
    sourceWidth,
    targetSize,
  };
}

function hashU16LittleEndian(source) {
  let hash = 0x811c9dc5;
  for (const value of source) {
    hash = Math.imul(hash ^ (value & 0xff), 0x01000193) >>> 0;
    hash = Math.imul(hash ^ (value >>> 8), 0x01000193) >>> 0;
  }
  return hash;
}

const roundedU16ToU8 = (value) => Math.max(0, Math.min(255, Math.round(value / 257)));
const quantizedSource = (value, quantizeR8) => (
  quantizeR8 ? roundedU16ToU8(value) * 257 : value
);

/** Exact JavaScript fallback and executable specification for the Wasm ABI. */
export function prepareScalarMaskJs(source, sourceWidth, sourceHeight, options = {}) {
  const request = normalizeRequest(source, sourceWidth, sourceHeight, options);
  const scalar16 = request.invert ? source.slice() : source;
  if (request.invert) {
    for (let index = 0; index < scalar16.length; index += 1) {
      scalar16[index] = 65535 - scalar16[index];
    }
  }
  const identity = hashU16LittleEndian(scalar16);
  const baseMask = request.emitBase ? new Uint8Array(request.outputSamples) : null;
  const supportMask = request.emitSupport ? new Uint8Array(request.outputSamples) : null;
  if (!baseMask && !supportMask) {
    return { backend: "js", scalar16, baseMask, supportMask, identity };
  }

  if (sourceWidth === request.targetSize && sourceHeight === request.targetSize) {
    for (let index = 0; index < scalar16.length; index += 1) {
      const value = quantizedSource(scalar16[index], request.quantizeR8);
      if (baseMask) baseMask[index] = roundedU16ToU8(value);
      if (supportMask) supportMask[index] = value > 0 ? 255 : 0;
    }
    return { backend: "js", scalar16, baseMask, supportMask, identity };
  }

  const sample = (x, y) => scalar16[
    Math.min(sourceHeight - 1, Math.max(0, y)) * sourceWidth
      + Math.min(sourceWidth - 1, Math.max(0, x))
  ];
  for (let targetY = 0; targetY < request.targetSize; targetY += 1) {
    const sourceY = (targetY + 0.5) * sourceHeight / request.targetSize - 0.5;
    const y0 = Math.floor(sourceY);
    const fy = sourceY - y0;
    const targetRow = targetY * request.targetSize;
    for (let targetX = 0; targetX < request.targetSize; targetX += 1) {
      const sourceX = (targetX + 0.5) * sourceWidth / request.targetSize - 0.5;
      const x0 = Math.floor(sourceX);
      const fx = sourceX - x0;
      const topLeft = quantizedSource(sample(x0, y0), request.quantizeR8);
      const topRight = quantizedSource(sample(x0 + 1, y0), request.quantizeR8);
      const bottomLeft = quantizedSource(sample(x0, y0 + 1), request.quantizeR8);
      const bottomRight = quantizedSource(sample(x0 + 1, y0 + 1), request.quantizeR8);
      const top = topLeft + (topRight - topLeft) * fx;
      const bottom = bottomLeft + (bottomRight - bottomLeft) * fx;
      const index = targetRow + targetX;
      if (baseMask) baseMask[index] = Math.round((top + (bottom - top) * fy) / 257);
      if (supportMask) {
        supportMask[index] = Math.max(topLeft, topRight, bottomLeft, bottomRight) > 0
          ? 255
          : 0;
      }
    }
  }
  return { backend: "js", scalar16, baseMask, supportMask, identity };
}

function heapBaseValue(exports) {
  const heapBase = exports.__heap_base;
  const value = heapBase instanceof WebAssembly.Global ? heapBase.value : heapBase;
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 0) {
    throw new Error("Scalar mask kernel does not export a valid heap base.");
  }
  return Number(value);
}

function instanceFromResult(result) {
  return result instanceof WebAssembly.Instance ? result : result.instance;
}

/** Instantiates a dependency-free module and returns its allocation-free adapter. */
export async function instantiateScalarMaskKernel(moduleOrBytes) {
  const result = moduleOrBytes instanceof WebAssembly.Module
    ? await WebAssembly.instantiate(moduleOrBytes, {})
    : await WebAssembly.instantiate(moduleOrBytes, {});
  const instance = instanceFromResult(result);
  const exports = instance.exports;
  if (!(exports.memory instanceof WebAssembly.Memory)) {
    throw new Error("Scalar mask kernel does not export linear memory.");
  }
  if (typeof exports.prepare_scalar_mask_u16 !== "function") {
    throw new Error("Scalar mask kernel entry point is missing.");
  }
  if (
    typeof exports.shape_mask_kernel_abi_version !== "function"
    || exports.shape_mask_kernel_abi_version() !== ABI_VERSION
  ) {
    throw new Error("Scalar mask kernel ABI version is incompatible.");
  }
  const heapBase = align(heapBaseValue(exports), 16);

  return {
    backend: "wasm",
    memoryBytes() {
      return exports.memory.buffer.byteLength;
    },
    prepare(source, sourceWidth, sourceHeight, options = {}) {
      const request = normalizeRequest(source, sourceWidth, sourceHeight, options);
      const sourcePtr = heapBase;
      const basePtr = request.emitBase ? align(sourcePtr + request.sourceBytes, 16) : 0;
      const supportStart = request.emitBase
        ? basePtr + request.outputSamples
        : sourcePtr + request.sourceBytes;
      const supportPtr = request.emitSupport ? align(supportStart, 16) : 0;
      const end = request.emitSupport
        ? supportPtr + request.outputSamples
        : request.emitBase
          ? basePtr + request.outputSamples
          : sourcePtr + request.sourceBytes;
      const missingBytes = end - exports.memory.buffer.byteLength;
      if (missingBytes > 0) {
        exports.memory.grow(Math.ceil(missingBytes / WASM_PAGE_BYTES));
      }
      new Uint16Array(exports.memory.buffer, sourcePtr, source.length).set(source);
      let flags = 0;
      if (request.invert) flags |= FLAG_INVERT;
      if (request.quantizeR8) flags |= FLAG_QUANTIZE_R8;
      const identity = exports.prepare_scalar_mask_u16(
        sourcePtr,
        sourceWidth,
        sourceHeight,
        request.targetSize,
        flags,
        basePtr,
        supportPtr,
      ) >>> 0;
      const scalar16 = request.invert
        ? new Uint16Array(
            new Uint16Array(exports.memory.buffer, sourcePtr, source.length),
          )
        : source;
      const baseMask = request.emitBase
        ? new Uint8Array(
            new Uint8Array(exports.memory.buffer, basePtr, request.outputSamples),
          )
        : null;
      const supportMask = request.emitSupport
        ? new Uint8Array(
            new Uint8Array(exports.memory.buffer, supportPtr, request.outputSamples),
          )
        : null;
      return { backend: "wasm", scalar16, baseMask, supportMask, identity };
    },
  };
}

/** Loads the module lazily; initialization failure selects the exact JS path. */
export async function createScalarMaskPreprocessor(options = {}) {
  try {
    let moduleOrBytes = options.moduleOrBytes;
    if (!moduleOrBytes) {
      const url = options.url ?? new URL("./dist/shape_mask_kernel.wasm", import.meta.url);
      const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
      if (typeof fetchImplementation !== "function") {
        throw new Error("fetch is unavailable for scalar mask kernel loading.");
      }
      const response = await fetchImplementation(url);
      if (!response.ok) throw new Error(`Scalar mask kernel fetch failed (${response.status}).`);
      moduleOrBytes = await response.arrayBuffer();
    }
    return await instantiateScalarMaskKernel(moduleOrBytes);
  } catch (initializationError) {
    return {
      backend: "js",
      initializationError,
      prepare: prepareScalarMaskJs,
    };
  }
}
