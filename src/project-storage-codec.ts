import {
  GENERATION_ID_PATTERN,
  LAYER_BLEND_MODES,
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  PROJECT_ID_PATTERN,
  PROJECT_MANIFEST_MAGIC,
  PROJECT_STORAGE_LEGACY_DOCUMENT_DIMENSION,
  PROJECT_STORAGE_MAX_CHUNK_BYTES,
  PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION,
  PROJECT_STORAGE_MAX_LAYERS,
  PROJECT_STORAGE_MAX_THUMBNAIL_BYTES,
  PROJECT_STORAGE_MAX_TITLE_LENGTH,
  PROJECT_STORAGE_MIN_DOCUMENT_DIMENSION,
  PROJECT_STORAGE_TILE_COUNT,
  PROJECT_STORAGE_TILE_GRID_SIZE,
  PROJECT_STORAGE_TILE_MASK_WORDS,
  ProjectStorageValidationError,
  type ProjectChunkWriteV1,
  type ProjectDocumentDescriptorV1,
  type ProjectLayerChunkDescriptorV1,
  type ProjectLayerPixelsV1,
  type ProjectLayerV1,
  type ProjectLoadResultV1,
  type ProjectManifestV1,
  type ProjectMixedSceneStateV1,
  type ProjectRectV1,
  type ProjectSaveRequestV1,
  type ProjectSnapshotV1,
  type ProjectSummaryV1,
} from "./project-storage-schema.ts";
import {
  projectChunkKey,
  projectManifestKey,
} from "./project-storage-keys.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new ProjectStorageValidationError(message, path);
}

function assertSchemaVersion(value: unknown, path: string): void {
  if (value !== PROJECT_DOCUMENT_SCHEMA_VERSION) {
    fail(path, `unsupported schema version ${String(value)}`);
  }
}

function assertFinite(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "must be a finite number");
  }
}

export function assertNonNegativeInteger(
  value: unknown,
  path: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(path, "must be a non-negative safe integer");
  }
}

function assertPositiveInteger(
  value: unknown,
  path: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail(path, "must be a positive safe integer");
  }
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") fail(path, "must be boolean");
}

export function assertString(
  value: unknown,
  path: string,
  maximum = 16_384,
): asserts value is string {
  if (typeof value !== "string" || value.length > maximum) {
    fail(path, `must be a string of at most ${maximum} characters`);
  }
}

function assertUnitInterval(value: unknown, path: string): asserts value is number {
  assertFinite(value, path);
  if (value < 0 || value > 1) fail(path, "must be between 0 and 1");
}

export function assertProjectId(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !PROJECT_ID_PATTERN.test(value)) {
    fail(path, "contains unsupported project-id characters");
  }
}

function assertGenerationId(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !GENERATION_ID_PATTERN.test(value)) {
    fail(path, "contains unsupported generation-id characters");
  }
}

function assertPlainStructuredValue(
  value: unknown,
  path: string,
  seen = new WeakSet<object>(),
): void {
  if (
    value === null
    || value === undefined
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "contains a non-finite number");
    return;
  }
  if (typeof value !== "object") {
    fail(path, `contains non-cloneable ${typeof value}`);
  }
  const objectValue = value as object;
  if (seen.has(objectValue)) fail(path, "must not contain cyclic references");
  if (value instanceof ArrayBuffer) return;
  if (ArrayBuffer.isView(value)) {
    if (!(value.buffer instanceof ArrayBuffer)) {
      fail(path, "SharedArrayBuffer-backed views are not supported");
    }
    return;
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) return;

  seen.add(objectValue);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertPlainStructuredValue(entry, `${path}[${index}]`, seen);
    });
    seen.delete(objectValue);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, "contains a non-DTO object (DOM, GPU, Map, Set, or class instance)");
  }
  for (const [key, entry] of Object.entries(value)) {
    assertPlainStructuredValue(entry, `${path}.${key}`, seen);
  }
  seen.delete(objectValue);
}

export function normalizeProjectTitle(name: string): string {
  const normalized = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PROJECT_STORAGE_MAX_TITLE_LENGTH);
  return normalized || "Untitled Artwork";
}

function assertRect(
  value: unknown,
  document: ProjectDocumentDescriptorV1,
  path: string,
): asserts value is ProjectRectV1 {
  if (!isRecord(value)) fail(path, "must be a rectangle object");
  assertFinite(value.x, `${path}.x`);
  assertFinite(value.y, `${path}.y`);
  assertFinite(value.width, `${path}.width`);
  assertFinite(value.height, `${path}.height`);
  if (value.width <= 0 || value.height <= 0) {
    fail(path, "must have positive dimensions");
  }
  if (
    value.x < 0
    || value.y < 0
    || value.x + value.width > document.width
    || value.y + value.height > document.height
  ) {
    fail(path, "must stay inside the document");
  }
}

function assertColorTuple(
  value: unknown,
  length: 3 | 4,
  path: string,
): void {
  if (!Array.isArray(value) || value.length !== length) {
    fail(path, `must contain ${length} color channels`);
  }
  value.forEach((channel, index) => {
    assertFinite(channel, `${path}[${index}]`);
    if (channel < 0 || channel > 1) {
      fail(`${path}[${index}]`, "must be between 0 and 1");
    }
  });
}

function assertLayerStyles(layer: Record<string, unknown>, path: string): void {
  const stroke = layer.strokeStyle;
  if (!isRecord(stroke)) fail(`${path}.strokeStyle`, "must be an object");
  assertBoolean(stroke.enabled, `${path}.strokeStyle.enabled`);
  assertFinite(stroke.width, `${path}.strokeStyle.width`);
  if (stroke.width < 0) fail(`${path}.strokeStyle.width`, "must be non-negative");
  if (!new Set(["inside", "center", "outside"]).has(String(stroke.position))) {
    fail(`${path}.strokeStyle.position`, "is unsupported");
  }
  assertColorTuple(stroke.color, 4, `${path}.strokeStyle.color`);

  const bevel = layer.bevelStyle;
  if (!isRecord(bevel)) fail(`${path}.bevelStyle`, "must be an object");
  assertBoolean(bevel.enabled, `${path}.bevelStyle.enabled`);

  const outer = layer.outerShadowStyle;
  if (!isRecord(outer)) fail(`${path}.outerShadowStyle`, "must be an object");
  assertBoolean(outer.enabled, `${path}.outerShadowStyle.enabled`);

  const inner = layer.innerShadowStyle;
  if (!isRecord(inner)) fail(`${path}.innerShadowStyle`, "must be an object");
  assertBoolean(inner.enabled, `${path}.innerShadowStyle.enabled`);

  const overlay = layer.colorOverlayStyle;
  if (!isRecord(overlay)) fail(`${path}.colorOverlayStyle`, "must be an object");
  assertBoolean(overlay.enabled, `${path}.colorOverlayStyle.enabled`);
  assertColorTuple(overlay.color, 3, `${path}.colorOverlayStyle.color`);
  assertFinite(overlay.opacity, `${path}.colorOverlayStyle.opacity`);
  if (overlay.opacity < 0 || overlay.opacity > 100) {
    fail(`${path}.colorOverlayStyle.opacity`, "must be between 0 and 100");
  }
}

function tileMaskIndices(mask: Uint32Array): number[] {
  const indices: number[] = [];
  for (let tileIndex = 0; tileIndex < PROJECT_STORAGE_TILE_COUNT; tileIndex += 1) {
    const word = mask[tileIndex >>> 5] >>> 0;
    if (((word >>> (tileIndex & 31)) & 1) !== 0) indices.push(tileIndex);
  }
  return indices;
}

function tileOriginIsInsideDocument(
  tileIndex: number,
  document: ProjectDocumentDescriptorV1,
): boolean {
  const tileWidth = Math.ceil(document.width / document.tileGridSize);
  const tileHeight = Math.ceil(document.height / document.tileGridSize);
  const tileX = tileIndex % document.tileGridSize;
  const tileY = Math.floor(tileIndex / document.tileGridSize);
  return tileX * tileWidth < document.width
    && tileY * tileHeight < document.height;
}

function assertLayerPixels(
  value: unknown,
  document: ProjectDocumentDescriptorV1,
  maskIndices: readonly number[],
  path: string,
): asserts value is ProjectLayerPixelsV1 {
  if (!isRecord(value)) fail(path, "must be an object");
  assertSchemaVersion(value.schemaVersion, `${path}.schemaVersion`);
  if (value.format !== document.layerFormat) {
    fail(`${path}.format`, "must match the document layer format");
  }
  if (!Array.isArray(value.tileIndices)) {
    fail(`${path}.tileIndices`, "must be an array");
  }
  const tileIndices = value.tileIndices as unknown[];
  let previousTile = -1;
  tileIndices.forEach((tileIndex, index) => {
    assertNonNegativeInteger(tileIndex, `${path}.tileIndices[${index}]`);
    if (tileIndex >= PROJECT_STORAGE_TILE_COUNT) {
      fail(`${path}.tileIndices[${index}]`, "is outside the document tile grid");
    }
    const tileWidth = Math.ceil(document.width / document.tileGridSize);
    const tileHeight = Math.ceil(document.height / document.tileGridSize);
    const tileX = (tileIndex as number) % document.tileGridSize;
    const tileY = Math.floor((tileIndex as number) / document.tileGridSize);
    if (tileX * tileWidth >= document.width || tileY * tileHeight >= document.height) {
      fail(`${path}.tileIndices[${index}]`, "starts outside the document extent");
    }
    if (tileIndex <= previousTile) {
      fail(`${path}.tileIndices`, "must be strictly increasing and unique");
    }
    previousTile = tileIndex;
  });
  if (
    tileIndices.length !== maskIndices.length
    || tileIndices.some((tileIndex, index) => tileIndex !== maskIndices[index])
  ) {
    const differingIndex = tileIndices.findIndex(
      (tileIndex, index) => tileIndex !== maskIndices[index],
    );
    const firstMismatch = differingIndex >= 0
      ? differingIndex
      : Math.min(tileIndices.length, maskIndices.length);
    fail(
      `${path}.tileIndices`,
      "must exactly match storageTileMask "
        + `(pixels=${tileIndices.length}, mask=${maskIndices.length}, `
        + `first=${String(tileIndices[firstMismatch])}/${String(maskIndices[firstMismatch])})`,
    );
  }

  if (!Array.isArray(value.chunks)) fail(`${path}.chunks`, "must be an array");
  assertNonNegativeInteger(value.rawBytes, `${path}.rawBytes`);
  assertNonNegativeInteger(value.storedBytes, `${path}.storedBytes`);
  assertNonNegativeInteger(value.sourceHash, `${path}.sourceHash`);
  if (value.sourceHash > 0xffff_ffff) {
    fail(`${path}.sourceHash`, "must be an unsigned 32-bit integer");
  }
  assertNonNegativeInteger(value.generation, `${path}.generation`);

  // The logical mask always has 16 × 16 slots. Non-divisible and rectangular
  // documents store each slot in a normalized, zero-padded rectangular tile;
  // edge clipping is an engine concern and does not change the payload stride.
  const tileWidth = Math.ceil(document.width / document.tileGridSize);
  const tileHeight = Math.ceil(document.height / document.tileGridSize);
  const bytesPerPixel = document.layerFormat === "rgba16float" ? 8 : 4;
  const tileBytes = tileWidth * tileHeight * bytesPerPixel;
  const expectedRawBytes = tileIndices.length * tileBytes;
  if (value.rawBytes !== expectedRawBytes) {
    fail(`${path}.rawBytes`, `must equal ${expectedRawBytes} bytes for its tiles`);
  }

  let firstTileOffset = 0;
  let rawBytes = 0;
  let storedBytes = 0;
  (value.chunks as unknown[]).forEach((entry, index) => {
    const chunkPath = `${path}.chunks[${index}]`;
    if (!isRecord(entry)) fail(chunkPath, "must be an object");
    assertSchemaVersion(entry.schemaVersion, `${chunkPath}.schemaVersion`);
    if (entry.chunkIndex !== index) {
      fail(`${chunkPath}.chunkIndex`, "must be contiguous from zero");
    }
    if (entry.firstTileOffset !== firstTileOffset) {
      fail(`${chunkPath}.firstTileOffset`, "must continue the prior chunk");
    }
    assertPositiveInteger(entry.tileCount, `${chunkPath}.tileCount`);
    if (!new Set(["gzip", "gzip-shuffle16", "raw"]).has(String(entry.storage))) {
      fail(`${chunkPath}.storage`, "is not a supported compression storage mode");
    }
    assertPositiveInteger(entry.rawBytes, `${chunkPath}.rawBytes`);
    assertPositiveInteger(entry.storedBytes, `${chunkPath}.storedBytes`);
    if (entry.storedBytes > PROJECT_STORAGE_MAX_CHUNK_BYTES) {
      fail(`${chunkPath}.storedBytes`, "exceeds the chunk size limit");
    }
    if (entry.rawBytes !== entry.tileCount * tileBytes) {
      fail(`${chunkPath}.rawBytes`, "does not match tileCount");
    }
    assertNonNegativeInteger(entry.sourceHash, `${chunkPath}.sourceHash`);
    if (entry.sourceHash > 0xffff_ffff) {
      fail(`${chunkPath}.sourceHash`, "must be an unsigned 32-bit integer");
    }
    firstTileOffset += entry.tileCount;
    rawBytes += entry.rawBytes;
    storedBytes += entry.storedBytes;
  });
  if (firstTileOffset !== tileIndices.length) {
    fail(`${path}.chunks`, "must cover every packed tile exactly once");
  }
  if (rawBytes !== value.rawBytes || storedBytes !== value.storedBytes) {
    fail(path, "chunk byte totals do not match the layer totals");
  }
}

function assertDocument(
  value: unknown,
  path: string,
): asserts value is ProjectDocumentDescriptorV1 {
  if (!isRecord(value)) fail(path, "must be an object");
  assertSchemaVersion(value.schemaVersion, `${path}.schemaVersion`);
  assertDocumentDimensions(value.width, value.height, path);
  if (value.layerFormat !== "rgba8unorm" && value.layerFormat !== "rgba16float") {
    fail(`${path}.layerFormat`, "is unsupported");
  }
  if (value.tileGridSize !== PROJECT_STORAGE_TILE_GRID_SIZE) {
    fail(`${path}.tileGridSize`, "is unsupported");
  }
  if (value.colorSpace !== "linear-premultiplied") {
    fail(`${path}.colorSpace`, "is unsupported");
  }
}

function assertDocumentDimensions(
  width: unknown,
  height: unknown,
  path: string,
): asserts width is number {
  if (!Number.isInteger(width)) fail(`${path}.width`, "must be a whole number of pixels");
  if (!Number.isInteger(height)) fail(`${path}.height`, "must be a whole number of pixels");
  if (
    width === PROJECT_STORAGE_LEGACY_DOCUMENT_DIMENSION
    && height === PROJECT_STORAGE_LEGACY_DOCUMENT_DIMENSION
  ) {
    return;
  }
  if (
    (width as number) < PROJECT_STORAGE_MIN_DOCUMENT_DIMENSION
    || (width as number) > PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION
  ) {
    fail(
      `${path}.width`,
      `must be between ${PROJECT_STORAGE_MIN_DOCUMENT_DIMENSION} and `
        + `${PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION} pixels`,
    );
  }
  if (
    (height as number) < PROJECT_STORAGE_MIN_DOCUMENT_DIMENSION
    || (height as number) > PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION
  ) {
    fail(
      `${path}.height`,
      `must be between ${PROJECT_STORAGE_MIN_DOCUMENT_DIMENSION} and `
        + `${PROJECT_STORAGE_MAX_DOCUMENT_DIMENSION} pixels`,
    );
  }
}

function assertLayer(
  value: unknown,
  document: ProjectDocumentDescriptorV1,
  path: string,
): asserts value is ProjectLayerV1 {
  if (!isRecord(value)) fail(path, "must be an object");
  assertSchemaVersion(value.schemaVersion, `${path}.schemaVersion`);
  assertPositiveInteger(value.id, `${path}.id`);
  assertString(value.name, `${path}.name`, 160);
  if (value.name.trim().length === 0) fail(`${path}.name`, "must not be blank");
  assertBoolean(value.visible, `${path}.visible`);
  assertUnitInterval(value.opacity, `${path}.opacity`);
  if (typeof value.blendMode !== "string" || !LAYER_BLEND_MODES.has(value.blendMode)) {
    fail(`${path}.blendMode`, "is unsupported");
  }
  if (value.clippingParentId !== null) {
    assertPositiveInteger(value.clippingParentId, `${path}.clippingParentId`);
  }
  assertBoolean(value.hasContent, `${path}.hasContent`);
  assertBoolean(value.noiseMipSmoothing, `${path}.noiseMipSmoothing`);
  if (!(value.storageTileMask instanceof Uint32Array)) {
    fail(`${path}.storageTileMask`, "must be a Uint32Array");
  }
  if (value.storageTileMask.length !== PROJECT_STORAGE_TILE_MASK_WORDS) {
    fail(`${path}.storageTileMask`, `must contain ${PROJECT_STORAGE_TILE_MASK_WORDS} words`);
  }
  assertLayerStyles(value, path);

  if (value.contentBounds !== null) {
    assertRect(value.contentBounds, document, `${path}.contentBounds`);
  }
  const maskIndices = tileMaskIndices(value.storageTileMask);
  maskIndices.forEach((tileIndex) => {
    if (!tileOriginIsInsideDocument(tileIndex, document)) {
      fail(
        `${path}.storageTileMask`,
        `contains tile ${tileIndex}, whose origin lies outside the document`,
      );
    }
  });
  if (value.hasContent) {
    if (value.contentBounds === null) fail(`${path}.contentBounds`, "is required for content");
    if (maskIndices.length === 0) fail(`${path}.storageTileMask`, "must retain content tiles");
    assertLayerPixels(value.pixels, document, maskIndices, `${path}.pixels`);
  } else {
    if (value.contentBounds !== null) fail(`${path}.contentBounds`, "must be null when empty");
    if (maskIndices.length !== 0) fail(`${path}.storageTileMask`, "must be empty when no content exists");
    if (value.pixels !== null) fail(`${path}.pixels`, "must be null when no content exists");
  }
}

function assertSemanticNodeBasics(
  value: unknown,
  expectedKind: "text" | "svg" | "image",
  path: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail(path, "must be an object");
  assertPositiveInteger(value.id, `${path}.id`);
  if (value.kind !== expectedKind) fail(`${path}.kind`, `must be ${expectedKind}`);
  assertString(value.name, `${path}.name`, 160);
  assertBoolean(value.visible, `${path}.visible`);
  assertUnitInterval(value.opacity, `${path}.opacity`);
  for (const coordinate of ["x", "y", "scale", "rotation"] as const) {
    assertFinite(value[coordinate], `${path}.${coordinate}`);
  }
  if ((value.scale as number) <= 0) fail(`${path}.scale`, "must be positive");
}

function assertMixedScene(
  value: unknown,
  layers: readonly ProjectLayerV1[],
  path: string,
): asserts value is ProjectMixedSceneStateV1 {
  if (!isRecord(value)) fail(path, "must be an object");
  assertSchemaVersion(value.schemaVersion, `${path}.schemaVersion`);
  if (!Array.isArray(value.items)) fail(`${path}.items`, "must be an array");
  if (!Array.isArray(value.textNodes)) fail(`${path}.textNodes`, "must be an array");
  if (!Array.isArray(value.svgNodes)) fail(`${path}.svgNodes`, "must be an array");
  if (!Array.isArray(value.imageNodes)) fail(`${path}.imageNodes`, "must be an array");

  const nodesByKind = {
    text: new Set<number>(),
    svg: new Set<number>(),
    image: new Set<number>(),
  };
  (value.textNodes as unknown[]).forEach((node, index) => {
    const nodePath = `${path}.textNodes[${index}]`;
    assertSemanticNodeBasics(node, "text", nodePath);
    if (nodesByKind.text.has(node.id as number)) fail(`${nodePath}.id`, "is duplicated");
    nodesByKind.text.add(node.id as number);
  });
  (value.svgNodes as unknown[]).forEach((node, index) => {
    const nodePath = `${path}.svgNodes[${index}]`;
    assertSemanticNodeBasics(node, "svg", nodePath);
    if (!isRecord(node.document)) fail(`${nodePath}.document`, "must be an SVG DTO");
    if (!Array.isArray(node.paintColors)) fail(`${nodePath}.paintColors`, "must be an array");
    if (nodesByKind.svg.has(node.id as number)) fail(`${nodePath}.id`, "is duplicated");
    nodesByKind.svg.add(node.id as number);
  });
  (value.imageNodes as unknown[]).forEach((node, index) => {
    const nodePath = `${path}.imageNodes[${index}]`;
    assertSemanticNodeBasics(node, "image", nodePath);
    if (!isRecord(node.document)) fail(`${nodePath}.document`, "must be an image DTO");
    assertString(node.document.assetId, `${nodePath}.document.assetId`, 256);
    assertString(node.document.mimeType, `${nodePath}.document.mimeType`, 256);
    assertPositiveInteger(node.document.width, `${nodePath}.document.width`);
    assertPositiveInteger(node.document.height, `${nodePath}.document.height`);
    if (nodesByKind.image.has(node.id as number)) fail(`${nodePath}.id`, "is duplicated");
    nodesByKind.image.add(node.id as number);
  });

  const rasterIds = new Set(layers.map((layer) => layer.id));
  const seenRasterIds = new Set<number>();
  const seenTextIds = new Set<number>();
  const seenSvgIds = new Set<number>();
  const seenImageIds = new Set<number>();
  const seenKeys = new Set<string>();
  (value.items as unknown[]).forEach((item, index) => {
    const itemPath = `${path}.items[${index}]`;
    if (!isRecord(item)) fail(itemPath, "must be an object");
    assertString(item.key, `${itemPath}.key`, 192);
    if (seenKeys.has(item.key)) fail(`${itemPath}.key`, "is duplicated");
    seenKeys.add(item.key);
    if (item.kind === "raster") {
      assertPositiveInteger(item.rasterLayerId, `${itemPath}.rasterLayerId`);
      if (item.key !== `raster:${item.rasterLayerId}`) fail(`${itemPath}.key`, "does not match id");
      if (!rasterIds.has(item.rasterLayerId)) fail(itemPath, "references a missing raster layer");
      if (seenRasterIds.has(item.rasterLayerId)) fail(itemPath, "duplicates a raster layer");
      seenRasterIds.add(item.rasterLayerId);
    } else if (item.kind === "text") {
      assertPositiveInteger(item.textNodeId, `${itemPath}.textNodeId`);
      if (item.key !== `text:${item.textNodeId}`) fail(`${itemPath}.key`, "does not match id");
      if (!nodesByKind.text.has(item.textNodeId)) fail(itemPath, "references missing text");
      seenTextIds.add(item.textNodeId);
    } else if (item.kind === "svg") {
      assertPositiveInteger(item.svgNodeId, `${itemPath}.svgNodeId`);
      if (item.key !== `svg:${item.svgNodeId}`) fail(`${itemPath}.key`, "does not match id");
      if (!nodesByKind.svg.has(item.svgNodeId)) fail(itemPath, "references missing SVG");
      seenSvgIds.add(item.svgNodeId);
    } else if (item.kind === "image") {
      assertPositiveInteger(item.imageNodeId, `${itemPath}.imageNodeId`);
      if (item.key !== `image:${item.imageNodeId}`) fail(`${itemPath}.key`, "does not match id");
      if (!nodesByKind.image.has(item.imageNodeId)) fail(itemPath, "references missing image");
      seenImageIds.add(item.imageNodeId);
    } else {
      fail(`${itemPath}.kind`, "is unsupported");
    }
  });
  if (seenRasterIds.size !== rasterIds.size) {
    fail(`${path}.items`, "must contain every raster layer exactly once");
  }
  if (
    seenTextIds.size !== nodesByKind.text.size
    || seenSvgIds.size !== nodesByKind.svg.size
    || seenImageIds.size !== nodesByKind.image.size
  ) {
    fail(`${path}.items`, "must contain every semantic node exactly once");
  }
  const sceneIndexByRasterId = new Map<number, number>();
  (value.items as Record<string, unknown>[]).forEach((item, index) => {
    if (item.kind === "raster") sceneIndexByRasterId.set(item.rasterLayerId as number, index);
  });
  layers.forEach((base) => {
    if (base.clippingParentId !== null) return;
    const dependents = layers.filter((layer) => layer.clippingParentId === base.id);
    const baseSceneIndex = sceneIndexByRasterId.get(base.id);
    if (baseSceneIndex === undefined) return;
    dependents.forEach((dependent, offset) => {
      if (sceneIndexByRasterId.get(dependent.id) !== baseSceneIndex + offset + 1) {
        fail(
          `${path}.items`,
          `clipping group for raster ${base.id} must remain contiguous in the mixed scene`,
        );
      }
    });
  });
  if (typeof value.selectedKey !== "string" || !seenKeys.has(value.selectedKey)) {
    fail(`${path}.selectedKey`, "must select an existing scene item");
  }
  for (const [kind, idSet, nextName] of [
    ["text", nodesByKind.text, "nextTextNodeId"],
    ["svg", nodesByKind.svg, "nextSvgNodeId"],
    ["image", nodesByKind.image, "nextImageNodeId"],
  ] as const) {
    const nextId = value[nextName];
    assertPositiveInteger(nextId, `${path}.${nextName}`);
    const maximum = idSet.size > 0 ? Math.max(...idSet) : 0;
    if (nextId <= maximum) fail(`${path}.${nextName}`, `must exceed every ${kind} id`);
  }
}

function assertSnapshot(
  value: unknown,
  path: string,
): asserts value is ProjectSnapshotV1 {
  if (!isRecord(value)) fail(path, "must be an object");
  assertSchemaVersion(value.schemaVersion, `${path}.schemaVersion`);
  const document = value.document;
  assertDocument(document, `${path}.document`);
  if (!Array.isArray(value.layers)) fail(`${path}.layers`, "must be an array");
  if (value.layers.length < 1 || value.layers.length > PROJECT_STORAGE_MAX_LAYERS) {
    fail(`${path}.layers`, `must contain 1 to ${PROJECT_STORAGE_MAX_LAYERS} layers`);
  }
  const layers = value.layers as unknown[];
  const layerIds = new Set<number>();
  layers.forEach((layer, index) => {
    assertLayer(layer, document, `${path}.layers[${index}]`);
    if (layerIds.has(layer.id)) fail(`${path}.layers[${index}].id`, "is duplicated");
    layerIds.add(layer.id);
  });

  layers.forEach((layer, index) => {
    if (!isRecord(layer) || layer.clippingParentId === null) return;
    const parentIndex = layers.findIndex(
      (candidate) => isRecord(candidate) && candidate.id === layer.clippingParentId,
    );
    if (parentIndex < 0) fail(`${path}.layers[${index}].clippingParentId`, "is missing");
    if (parentIndex >= index) {
      fail(`${path}.layers[${index}].clippingParentId`, "must be below the clipped layer");
    }
    const parent = layers[parentIndex] as Record<string, unknown>;
    if (parent.clippingParentId !== null) {
      fail(`${path}.layers[${index}].clippingParentId`, "must target an unclipped base");
    }
  });
  layers.forEach((parent, parentIndex) => {
    if (!isRecord(parent) || parent.clippingParentId !== null) return;
    const dependents = layers
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => isRecord(candidate) && candidate.clippingParentId === parent.id)
      .map(({ index }) => index);
    dependents.forEach((dependentIndex, offset) => {
      if (dependentIndex !== parentIndex + offset + 1) {
        fail(`${path}.layers`, `clipping group for layer ${String(parent.id)} is not contiguous`);
      }
    });
  });

  assertPositiveInteger(value.activeRasterLayerId, `${path}.activeRasterLayerId`);
  if (!layerIds.has(value.activeRasterLayerId)) {
    fail(`${path}.activeRasterLayerId`, "does not exist in layers");
  }
  if (value.referenceRasterLayerId !== null) {
    assertPositiveInteger(value.referenceRasterLayerId, `${path}.referenceRasterLayerId`);
    if (!layerIds.has(value.referenceRasterLayerId)) {
      fail(`${path}.referenceRasterLayerId`, "does not exist in layers");
    }
  }
  assertMixedScene(value.mixedScene, value.layers, `${path}.mixedScene`);

  if (!isRecord(value.view)) fail(`${path}.view`, "must be an object");
  assertSchemaVersion(value.view.schemaVersion, `${path}.view.schemaVersion`);
  assertFinite(value.view.centerX, `${path}.view.centerX`);
  assertFinite(value.view.centerY, `${path}.view.centerY`);
  assertFinite(value.view.zoom, `${path}.view.zoom`);
  if (value.view.zoom <= 0) fail(`${path}.view.zoom`, "must be positive");
  assertFinite(value.view.rotationRadians, `${path}.view.rotationRadians`);

  if (!isRecord(value.brushSettings)) {
    fail(`${path}.brushSettings`, "must be an object");
  }
  assertString(value.brushSettings.color, `${path}.brushSettings.color`, 64);
  assertFinite(value.brushSettings.size, `${path}.brushSettings.size`);
  if (value.brushSettings.size <= 0) fail(`${path}.brushSettings.size`, "must be positive");
}

function expectedChunkDescriptors(
  snapshot: ProjectSnapshotV1,
): Map<string, ProjectLayerChunkDescriptorV1> {
  const expected = new Map<string, ProjectLayerChunkDescriptorV1>();
  for (const layer of snapshot.layers) {
    for (const descriptor of layer.pixels?.chunks ?? []) {
      expected.set(`${layer.id}:${descriptor.chunkIndex}`, descriptor);
    }
  }
  return expected;
}

function assertChunkWrite(
  value: unknown,
  path: string,
): asserts value is ProjectChunkWriteV1 {
  if (!isRecord(value)) fail(path, "must be an object");
  assertSchemaVersion(value.schemaVersion, `${path}.schemaVersion`);
  assertPositiveInteger(value.layerId, `${path}.layerId`);
  assertNonNegativeInteger(value.chunkIndex, `${path}.chunkIndex`);
  if (!new Set(["gzip", "gzip-shuffle16", "raw"]).has(String(value.storage))) {
    fail(`${path}.storage`, "is not supported");
  }
  assertPositiveInteger(value.rawBytes, `${path}.rawBytes`);
  assertPositiveInteger(value.storedBytes, `${path}.storedBytes`);
  if (value.storedBytes > PROJECT_STORAGE_MAX_CHUNK_BYTES) {
    fail(`${path}.storedBytes`, "exceeds the chunk size limit");
  }
  assertNonNegativeInteger(value.sourceHash, `${path}.sourceHash`);
  if (value.sourceHash > 0xffff_ffff) {
    fail(`${path}.sourceHash`, "must be an unsigned 32-bit integer");
  }
  if (!(value.bytes instanceof ArrayBuffer)) {
    fail(`${path}.bytes`, "must be an ArrayBuffer");
  }
  if (value.bytes.byteLength !== value.storedBytes) {
    fail(`${path}.bytes`, "byteLength must equal storedBytes");
  }
}

function assertChunkSetMatchesSnapshot(
  chunks: readonly ProjectChunkWriteV1[],
  snapshot: ProjectSnapshotV1,
  path: string,
): void {
  const expected = expectedChunkDescriptors(snapshot);
  const seen = new Set<string>();
  chunks.forEach((chunk, index) => {
    const chunkPath = `${path}[${index}]`;
    assertChunkWrite(chunk, chunkPath);
    const identity = `${chunk.layerId}:${chunk.chunkIndex}`;
    if (seen.has(identity)) fail(chunkPath, "duplicates a layer chunk");
    seen.add(identity);
    const descriptor = expected.get(identity);
    if (!descriptor) fail(chunkPath, "has no matching manifest descriptor");
    for (const field of [
      "storage",
      "rawBytes",
      "storedBytes",
      "sourceHash",
    ] as const) {
      if (chunk[field] !== descriptor[field]) {
        fail(`${chunkPath}.${field}`, "does not match the manifest descriptor");
      }
    }
  });
  if (seen.size !== expected.size) {
    const missing = [...expected.keys()].filter((identity) => !seen.has(identity));
    fail(path, `is missing ${missing.length} manifest chunk(s): ${missing.join(", ")}`);
  }
}

function assertThumbnail(value: unknown, path: string): asserts value is Blob | null {
  if (value === null) return;
  if (typeof Blob === "undefined" || !(value instanceof Blob)) {
    fail(path, "must be a Blob or null");
  }
  if (value.size > PROJECT_STORAGE_MAX_THUMBNAIL_BYTES) {
    fail(path, "exceeds the thumbnail size limit");
  }
  if (value.type && !value.type.startsWith("image/")) {
    fail(path, "must use an image MIME type");
  }
}

function assertTimestamp(value: unknown, path: string): asserts value is number {
  assertFinite(value, path);
  if (value < 0) fail(path, "must be non-negative");
}

export function assertSummary(
  value: unknown,
  path: string,
): asserts value is ProjectSummaryV1 {
  if (!isRecord(value)) fail(path, "must be an object");
  assertSchemaVersion(value.schemaVersion, `${path}.schemaVersion`);
  assertProjectId(value.id, `${path}.id`);
  assertString(value.name, `${path}.name`, PROJECT_STORAGE_MAX_TITLE_LENGTH);
  if (value.name !== normalizeProjectTitle(value.name)) {
    fail(`${path}.name`, "must be normalized and non-empty");
  }
  assertTimestamp(value.createdAt, `${path}.createdAt`);
  assertTimestamp(value.updatedAt, `${path}.updatedAt`);
  if (value.updatedAt < value.createdAt) {
    fail(`${path}.updatedAt`, "must not precede createdAt");
  }
  assertGenerationId(value.headGenerationId, `${path}.headGenerationId`);
  assertDocumentDimensions(
    value.documentWidth,
    value.documentHeight,
    `${path}.document`,
  );
  assertPositiveInteger(value.layerCount, `${path}.layerCount`);
  if (value.layerCount > PROJECT_STORAGE_MAX_LAYERS) {
    fail(`${path}.layerCount`, "exceeds the layer limit");
  }
  assertNonNegativeInteger(value.storedBytes, `${path}.storedBytes`);
  assertThumbnail(value.thumbnail, `${path}.thumbnail`);
}

export function validateProjectSaveRequest(
  request: unknown,
): asserts request is ProjectSaveRequestV1 {
  assertPlainStructuredValue(request, "request");
  if (!isRecord(request)) fail("request", "must be an object");
  assertSchemaVersion(request.schemaVersion, "request.schemaVersion");
  if (request.projectId !== undefined) {
    assertProjectId(request.projectId, "request.projectId");
  }
  assertString(request.name, "request.name", 4_096);
  if (request.createdAt !== undefined) {
    assertTimestamp(request.createdAt, "request.createdAt");
  }
  if (request.thumbnail !== undefined) {
    assertThumbnail(request.thumbnail, "request.thumbnail");
  }
  assertSnapshot(request.snapshot, "request.snapshot");
  if (!Array.isArray(request.chunks)) fail("request.chunks", "must be an array");
  assertChunkSetMatchesSnapshot(
    request.chunks as readonly ProjectChunkWriteV1[],
    request.snapshot,
    "request.chunks",
  );
}

export function validateProjectManifest(
  manifest: unknown,
): asserts manifest is ProjectManifestV1 {
  assertPlainStructuredValue(manifest, "manifest");
  if (!isRecord(manifest)) fail("manifest", "must be an object");
  if (manifest.magic !== PROJECT_MANIFEST_MAGIC) {
    fail("manifest.magic", "is not an M1M4 project manifest");
  }
  assertSchemaVersion(manifest.schemaVersion, "manifest.schemaVersion");
  assertProjectId(manifest.projectId, "manifest.projectId");
  assertGenerationId(manifest.generationId, "manifest.generationId");
  assertString(manifest.projectName, "manifest.projectName", PROJECT_STORAGE_MAX_TITLE_LENGTH);
  if (manifest.projectName !== normalizeProjectTitle(manifest.projectName)) {
    fail("manifest.projectName", "must be normalized and non-empty");
  }
  assertTimestamp(manifest.createdAt, "manifest.createdAt");
  assertTimestamp(manifest.savedAt, "manifest.savedAt");
  if (manifest.savedAt < manifest.createdAt) {
    fail("manifest.savedAt", "must not precede createdAt");
  }
  assertSnapshot(manifest.snapshot, "manifest.snapshot");
}

export function validateLoadedProject(
  project: unknown,
): asserts project is ProjectLoadResultV1 {
  assertPlainStructuredValue(project, "project");
  if (!isRecord(project)) fail("project", "must be an object");
  const summary = project.summary;
  const manifest = project.manifest;
  assertSummary(summary, "project.summary");
  validateProjectManifest(manifest);
  if (!Array.isArray(project.chunks)) fail("project.chunks", "must be an array");
  if (summary.id !== manifest.projectId) {
    fail("project", "summary and manifest project ids differ");
  }
  if (summary.headGenerationId !== manifest.generationId) {
    fail("project", "summary does not point to the loaded manifest generation");
  }
  if (
    summary.documentWidth !== manifest.snapshot.document.width
    || summary.documentHeight !== manifest.snapshot.document.height
    || summary.layerCount !== manifest.snapshot.layers.length
  ) {
    fail("project.summary", "does not describe the manifest snapshot");
  }

  const plainChunks: ProjectChunkWriteV1[] = [];
  (project.chunks as unknown[]).forEach((value, index) => {
    const path = `project.chunks[${index}]`;
    if (!isRecord(value)) fail(path, "must be an object");
    assertChunkWrite(value, path);
    assertString(value.key, `${path}.key`, 512);
    assertProjectId(value.projectId, `${path}.projectId`);
    assertGenerationId(value.generationId, `${path}.generationId`);
    assertString(value.generationKey, `${path}.generationKey`, 384);
    if (
      value.projectId !== summary.id
      || value.generationId !== summary.headGenerationId
      || value.generationKey !== projectManifestKey(value.projectId, value.generationId)
      || value.key !== projectChunkKey(
        value.projectId,
        value.generationId,
        value.layerId as number,
        value.chunkIndex as number,
      )
    ) {
      fail(path, "has inconsistent storage keys");
    }
    plainChunks.push(value as unknown as ProjectChunkWriteV1);
  });
  assertChunkSetMatchesSnapshot(plainChunks, manifest.snapshot, "project.chunks");
  const storedBytes = plainChunks.reduce((sum, chunk) => sum + chunk.storedBytes, 0)
    + (summary.thumbnail?.size ?? 0);
  if (storedBytes !== summary.storedBytes) {
    fail("project.summary.storedBytes", "does not match chunks and thumbnail");
  }
}
