import type { BrushEngine } from "../../brush-engine";
import { setLayerPresentation } from "../../engine-layer-runtime";
import { decodeFloat16 } from "../../float16";
import type { MixedSceneGroupTransformUpdate } from "../../mixed-scene-controller-contract";
import type { MixedSceneItem } from "../../mixed-scene-stack";
import { setLayerCompositeTestView } from "../engine-lab-operations";

export const GROUP_TRANSFORM_GPU_TEST_VERSION = 1 as const;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface RasterFixture {
  readonly key: `raster:${number}`;
  readonly layerIndex: number;
  readonly bounds: Rect;
  readonly marker: Point;
}

interface ScenarioDefinition {
  readonly name: string;
  readonly memberIndices: readonly number[];
  readonly translation: Point;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;
}

interface ByteComparison {
  readonly differingBytes: number;
  readonly maximumDelta: number;
}

interface ScenarioReport {
  readonly name: string;
  readonly memberCount: number;
  readonly liveCommitCentroidDistance: number;
  readonly maximumMarkerError: number;
  readonly cancelDifferingBytes: number;
  readonly undoDifferingBytes: number;
  readonly redoDifferingBytes: number;
  readonly reverseOrderDifferingBytes: number;
  readonly historyCursorBefore: number;
  readonly historyCursorAfter: number;
}

interface PresentationParityReport {
  readonly zoom: number;
  readonly inactivePeerDifferingBytes: number;
  readonly activePeerDifferingBytes: number;
  readonly activeInactiveDifferingBytes: number;
  readonly inactiveEdgeEnergySpread: number;
  readonly activeEdgeEnergySpread: number;
  readonly activeInactiveEdgeEnergyDifference: number;
}

interface SequentialScaleReport {
  readonly memberCount: number;
  readonly shrinkScale: number;
  readonly upscaleScale: number;
  readonly sourceBackedAfterShrink: number;
  readonly sourceBackedAfterUpscale: number;
  readonly shrinkPeerDifferingBytes: number;
  readonly upscalePeerDifferingBytes: number;
  readonly shrinkUndoDifferingBytes: number;
  readonly upscaleRedoDifferingBytes: number;
  readonly baselineRestoreDifferingBytes: number;
  readonly presentationPeerDifferingBytes: number;
  readonly presentationEdgeEnergySpread: number;
  readonly presentationActiveInactiveDifferingBytes: number;
  readonly presentationActiveInactiveEdgeEnergyDifference: number;
  readonly presentationParity: readonly PresentationParityReport[];
  readonly historyCursorBefore: number;
  readonly historyCursorAfter: number;
}

interface NonUniformProvenanceReport {
  readonly memberCount: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly sourceBackedAfterApply: number;
  readonly peerDifferingBytes: number;
  readonly undoDifferingBytes: number;
  readonly redoDifferingBytes: number;
  readonly baselineRestoreDifferingBytes: number;
}

export interface GroupTransformGpuTestReport {
  readonly version: typeof GROUP_TRANSFORM_GPU_TEST_VERSION;
  readonly passed: true;
  readonly durationMs: number;
  readonly layerCount: number;
  readonly sourceBackedLayerCount: number;
  readonly expandedLayerHasRasterSource: boolean;
  readonly paintUndoRestoredRasterSource: boolean;
  readonly paintRedoDroppedRasterSource: boolean;
  readonly paintUndoDifferingBytes: number;
  readonly paintRedoDifferingBytes: number;
  readonly scenarios: readonly ScenarioReport[];
  readonly sequentialScales: readonly SequentialScaleReport[];
  readonly nonUniformProvenance: NonUniformProvenanceReport;
  readonly browserErrors: readonly string[];
  readonly gpuErrors: readonly string[];
}

const DOCUMENT_SIZE = 512;
const MARKER_TOLERANCE_PX = 1.75;
const PRESENTATION_TOLERANCE_PX = 1.5;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function distance(left: Readonly<Point>, right: Readonly<Point>): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function compareBytes(left: Uint8Array, right: Uint8Array): ByteComparison {
  assert(left.byteLength === right.byteLength, "Pixel payload lengths differ.");
  let differingBytes = 0;
  let maximumDelta = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    const delta = Math.abs(left[index] - right[index]);
    differingBytes += Number(delta !== 0);
    maximumDelta = Math.max(maximumDelta, delta);
  }
  return { differingBytes, maximumDelta };
}

function maximumDifferingBytes(
  left: ReadonlyMap<string, Uint8Array>,
  right: ReadonlyMap<string, Uint8Array>,
): number {
  let maximum = 0;
  for (const [key, pixels] of left) {
    const candidate = right.get(key);
    assert(candidate, `Missing raster payload for ${key}.`);
    maximum = Math.max(maximum, compareBytes(pixels, candidate).differingBytes);
  }
  return maximum;
}

function maximumPeerDifferingBytes(
  pixels: ReadonlyMap<string, Uint8Array>,
  fixtures: readonly RasterFixture[],
): number {
  const referenceKey = fixtures[0]?.key;
  assert(referenceKey, "Pixel parity requires at least one raster fixture.");
  const reference = pixels.get(referenceKey);
  assert(reference, `Missing reference raster payload for ${referenceKey}.`);
  let maximum = 0;
  for (const fixture of fixtures.slice(1)) {
    const candidate = pixels.get(fixture.key);
    assert(candidate, `Missing raster payload for ${fixture.key}.`);
    maximum = Math.max(maximum, compareBytes(reference, candidate).differingBytes);
  }
  return maximum;
}

function sourceBackedCount(
  engine: BrushEngine,
  fixtures: readonly RasterFixture[],
): number {
  return fixtures.filter((fixture) => (
    engine.layerStack.at(fixture.layerIndex).rasterSource !== null
  )).length;
}

function assertEquivalentRasterSources(
  engine: BrushEngine,
  fixtures: readonly RasterFixture[],
  message: string,
): void {
  const sources = fixtures.map((fixture) => (
    engine.layerStack.at(fixture.layerIndex).rasterSource
  ));
  assert(sources.every(Boolean), `${message}: a raster source is missing.`);
  const reference = sources[0]!;
  for (const source of sources.slice(1)) {
    assert(source, `${message}: a raster source is missing.`);
    assert(
      source.document.assetId === reference.document.assetId
        && Math.abs(source.x - reference.x) <= 1e-7
        && Math.abs(source.y - reference.y) <= 1e-7
        && Math.abs(source.scale - reference.scale) <= 1e-7
        && Math.abs(source.rotation - reference.rotation) <= 1e-7,
      `${message}: duplicate raster-source transforms diverged.`,
    );
  }
}

function assertUnselectedLayersUnchanged(
  allFixtures: readonly RasterFixture[],
  selectedKeys: ReadonlySet<string>,
  baselinePixels: ReadonlyMap<string, Uint8Array>,
  currentPixels: ReadonlyMap<string, Uint8Array>,
  message: string,
): void {
  for (const fixture of allFixtures) {
    if (selectedKeys.has(fixture.key)) continue;
    const baseline = baselinePixels.get(fixture.key);
    const current = currentPixels.get(fixture.key);
    assert(baseline && current, `${message}: an unselected raster payload is missing.`);
    assert(
      compareBytes(baseline, current).differingBytes === 0,
      `${message}: unselected raster ${fixture.key} changed.`,
    );
  }
}

function float16At(bytes: Uint8Array, byteOffset: number): number {
  return decodeFloat16(bytes[byteOffset] | (bytes[byteOffset + 1] << 8));
}

function cyanMarkerCentroid(pixels: Uint8Array, rect: Readonly<Rect>): Point {
  assert(
    pixels.byteLength === rect.width * rect.height * 8,
    "RGBA16F marker payload has an unexpected length.",
  );
  let total = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const offset = (y * rect.width + x) * 8;
      const red = float16At(pixels, offset);
      const green = float16At(pixels, offset + 2);
      const blue = float16At(pixels, offset + 4);
      const alpha = float16At(pixels, offset + 6);
      if (alpha <= 0.05 || red >= 0.12 || green <= 0.3 || blue <= 0.3) continue;
      const weight = alpha * Math.min(green, blue) * (1 - red);
      total += weight;
      weightedX += (rect.x + x + 0.5) * weight;
      weightedY += (rect.y + y + 0.5) * weight;
    }
  }
  assert(total > 1, "The cyan marker disappeared from a raster layer.");
  return { x: weightedX / total, y: weightedY / total };
}

function presentationCyanCentroid(pixels: Uint8Array, rect: Readonly<Rect>): Point {
  assert(
    pixels.byteLength === rect.width * rect.height * 4,
    "Presentation payload has an unexpected length.",
  );
  let total = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const offset = (y * rect.width + x) * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const alpha = pixels[offset + 3] / 255;
      if (alpha <= 0.05 || red >= 80 || green <= 100 || blue <= 100) continue;
      const weight = (Math.min(green, blue) - red) * alpha;
      total += weight;
      weightedX += (rect.x + x + 0.5) * weight;
      weightedY += (rect.y + y + 0.5) * weight;
    }
  }
  assert(total > 1, "The group presentation contains no measurable cyan marker.");
  return { x: weightedX / total, y: weightedY / total };
}

function presentationEdgeEnergy(pixels: Uint8Array, rect: Readonly<Rect>): number {
  assert(
    pixels.byteLength === rect.width * rect.height * 4,
    "Presentation edge payload has an unexpected length.",
  );
  const luminance = (pixelIndex: number): number => {
    const offset = pixelIndex * 4;
    return pixels[offset] * 54 + pixels[offset + 1] * 183 + pixels[offset + 2] * 19;
  };
  let energy = 0;
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const index = y * rect.width + x;
      const center = luminance(index);
      if (x + 1 < rect.width) energy += Math.abs(center - luminance(index + 1));
      if (y + 1 < rect.height) energy += Math.abs(center - luminance(index + rect.width));
    }
  }
  return energy;
}

async function readPresentationCanvas(engine: BrushEngine): Promise<Uint8Array> {
  await engine.waitForIdle();
  const texture = engine.presentationCacheTexture;
  assert(texture, "The presentation cache is unavailable.");
  const width = engine.canvas.width;
  const height = engine.canvas.height;
  assert(width > 0 && height > 0, "The presentation canvas has invalid dimensions.");
  const unpaddedBytesPerRow = width * 4;
  const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
  const buffer = engine.device.createBuffer({
    label: `Group Transform presentation probe ${width}×${height}`,
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = engine.device.createCommandEncoder({
      label: "Group Transform presentation probe",
    });
    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    engine.device.queue.submit([encoder.finish()]);
    let timer = 0;
    try {
      await Promise.race([
        buffer.mapAsync(GPUMapMode.READ),
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(
            () => reject(new Error("Presentation canvas probe timed out after 10 s.")),
            10_000,
          );
        }),
      ]);
    } finally {
      if (timer !== 0) window.clearTimeout(timer);
    }
    const mapped = new Uint8Array(buffer.getMappedRange());
    const rgba = new Uint8Array(unpaddedBytesPerRow * height);
    const bgra = engine.canvasFormat.startsWith("bgra");
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const sourceOffset = row * bytesPerRow + column * 4;
        const targetOffset = row * unpaddedBytesPerRow + column * 4;
        rgba[targetOffset] = mapped[sourceOffset + (bgra ? 2 : 0)];
        rgba[targetOffset + 1] = mapped[sourceOffset + 1];
        rgba[targetOffset + 2] = mapped[sourceOffset + (bgra ? 0 : 2)];
        rgba[targetOffset + 3] = mapped[sourceOffset + 3];
      }
    }
    buffer.unmap();
    return rgba;
  } finally {
    buffer.destroy();
  }
}

async function isolatedPresentationParity(
  engine: BrushEngine,
  fixtures: readonly RasterFixture[],
): Promise<readonly PresentationParityReport[]> {
  const historyCursorBefore = engine.getHistoryState().cursor;
  const visibilityBefore = engine.layerStack.layers.map((record) => record.visible);
  const activeIndexBefore = engine.layerStack.activeIndex;
  const fixtureIndices = new Set(fixtures.map((fixture) => fixture.layerIndex));
  const inactiveHostIndex = fixtureIndices.has(activeIndexBefore)
    ? engine.layerStack.layers.findIndex((_, index) => !fixtureIndices.has(index))
    : activeIndexBefore;
  assert(inactiveHostIndex >= 0, "Active/inactive presentation parity requires a host layer.");
  const reports: PresentationParityReport[] = [];
  try {
    for (const zoom of [1, 0.6, 0.5, 0.25]) {
      setLayerCompositeTestView(engine, DOCUMENT_SIZE * 0.5, DOCUMENT_SIZE * 0.5, zoom);
      await waitForRenderedFrame(engine);
      const inactivePresentations = new Map<string, Uint8Array>();
      const activePresentations = new Map<string, Uint8Array>();
      for (const fixture of fixtures) {
        if (engine.layerStack.activeIndex !== inactiveHostIndex) {
          await engine.setActiveLayer(inactiveHostIndex);
        }
        for (let index = 0; index < engine.layerStack.count; index += 1) {
          await setLayerPresentation(engine, index, index === fixture.layerIndex, undefined);
        }
        await waitForRenderedFrame(engine);
        inactivePresentations.set(fixture.key, await readPresentationCanvas(engine));
        await engine.setActiveLayer(fixture.layerIndex);
        await waitForRenderedFrame(engine);
        activePresentations.set(fixture.key, await readPresentationCanvas(engine));
      }
      const canvasRect = {
        x: 0,
        y: 0,
        width: engine.canvas.width,
        height: engine.canvas.height,
      };
      const inactiveEnergies = fixtures.map((fixture) => {
        const pixels = inactivePresentations.get(fixture.key);
        assert(pixels, `Missing inactive presentation for ${fixture.key}.`);
        return presentationEdgeEnergy(pixels, canvasRect);
      });
      const activeEnergies = fixtures.map((fixture) => {
        const pixels = activePresentations.get(fixture.key);
        assert(pixels, `Missing active presentation for ${fixture.key}.`);
        return presentationEdgeEnergy(pixels, canvasRect);
      });
      let activeInactiveDifferingBytes = 0;
      let activeInactiveEdgeEnergyDifference = 0;
      for (let index = 0; index < fixtures.length; index += 1) {
        const fixture = fixtures[index];
        const inactive = inactivePresentations.get(fixture.key);
        const active = activePresentations.get(fixture.key);
        assert(inactive && active, `Missing active/inactive presentation for ${fixture.key}.`);
        activeInactiveDifferingBytes = Math.max(
          activeInactiveDifferingBytes,
          compareBytes(inactive, active).differingBytes,
        );
        activeInactiveEdgeEnergyDifference = Math.max(
          activeInactiveEdgeEnergyDifference,
          Math.abs(inactiveEnergies[index] - activeEnergies[index]),
        );
      }
      reports.push({
        zoom,
        inactivePeerDifferingBytes: maximumPeerDifferingBytes(
          inactivePresentations,
          fixtures,
        ),
        activePeerDifferingBytes: maximumPeerDifferingBytes(activePresentations, fixtures),
        activeInactiveDifferingBytes,
        inactiveEdgeEnergySpread: Math.max(...inactiveEnergies) - Math.min(...inactiveEnergies),
        activeEdgeEnergySpread: Math.max(...activeEnergies) - Math.min(...activeEnergies),
        activeInactiveEdgeEnergyDifference,
      });
    }
  } finally {
    if (engine.layerStack.activeIndex !== activeIndexBefore) {
      await engine.setActiveLayer(activeIndexBefore);
    }
    for (let index = 0; index < visibilityBefore.length; index += 1) {
      await setLayerPresentation(engine, index, visibilityBefore[index], undefined);
    }
    setLayerCompositeTestView(engine, DOCUMENT_SIZE * 0.5, DOCUMENT_SIZE * 0.5, 1);
    await waitForRenderedFrame(engine);
  }
  assert(
    engine.getHistoryState().cursor === historyCursorBefore,
    "Isolated presentation parity changed History.",
  );
  assert(
    engine.layerStack.activeIndex === activeIndexBefore,
    "Isolated presentation parity did not restore the active layer.",
  );
  assert(
    engine.layerStack.layers.every((record, index) => record.visible === visibilityBefore[index]),
    "Isolated presentation parity did not restore layer visibility.",
  );
  return reports;
}

function transformVector(
  point: Readonly<Point>,
  scaleX: number,
  scaleY: number,
  rotation: number,
): Point {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return {
    x: cosine * scaleX * point.x - sine * scaleY * point.y,
    y: sine * scaleX * point.x + cosine * scaleY * point.y,
  };
}

function unionBounds(fixtures: readonly RasterFixture[]): Rect {
  const left = Math.min(...fixtures.map((entry) => entry.bounds.x));
  const top = Math.min(...fixtures.map((entry) => entry.bounds.y));
  const right = Math.max(...fixtures.map((entry) => entry.bounds.x + entry.bounds.width));
  const bottom = Math.max(...fixtures.map((entry) => entry.bounds.y + entry.bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function groupUpdates(
  fixtures: readonly RasterFixture[],
  scenario: Readonly<ScenarioDefinition>,
): readonly MixedSceneGroupTransformUpdate[] {
  const bounds = unionBounds(fixtures);
  const groupPivot = {
    x: bounds.x + bounds.width * 0.5,
    y: bounds.y + bounds.height * 0.5,
  };
  const destinationGroupPivot = {
    x: groupPivot.x + scenario.translation.x,
    y: groupPivot.y + scenario.translation.y,
  };
  return fixtures.map((fixture) => {
    const previewPivot = {
      x: fixture.bounds.x + fixture.bounds.width * 0.5,
      y: fixture.bounds.y + fixture.bounds.height * 0.5,
    };
    const offset = transformVector(
      { x: previewPivot.x - groupPivot.x, y: previewPivot.y - groupPivot.y },
      scenario.scaleX,
      scenario.scaleY,
      scenario.rotation,
    );
    return {
      key: fixture.key,
      x: destinationGroupPivot.x + offset.x,
      y: destinationGroupPivot.y + offset.y,
      scale: scenario.scaleX,
      scaleX: scenario.scaleX,
      scaleY: scenario.scaleY,
      rotation: scenario.rotation,
    };
  });
}

function expectedMarker(
  fixture: Readonly<RasterFixture>,
  update: Readonly<MixedSceneGroupTransformUpdate>,
): Point {
  const previewPivot = {
    x: fixture.bounds.x + fixture.bounds.width * 0.5,
    y: fixture.bounds.y + fixture.bounds.height * 0.5,
  };
  const offset = transformVector(
    { x: fixture.marker.x - previewPivot.x, y: fixture.marker.y - previewPivot.y },
    update.scaleX,
    update.scaleY,
    update.rotation,
  );
  return { x: update.x + offset.x, y: update.y + offset.y };
}

async function createFixtureFile(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 80;
  const context = canvas.getContext("2d");
  assert(context, "The browser did not provide a canvas for the raster fixture.");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#00d9ff";
  context.fillRect(88, 20, 32, 40);
  context.fillStyle = "#ffd21f";
  context.fillRect(58, 30, 18, 20);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((candidate) => {
      if (candidate) resolve(candidate);
      else reject(new Error("The browser could not encode the raster fixture."));
    }, "image/png");
  });
  return new File([blob], "group-transform-fixture.png", { type: "image/png" });
}

async function waitForRenderedFrame(engine: BrushEngine): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  await engine.waitForIdle();
}

async function readLayers(
  engine: BrushEngine,
  fixtures: readonly RasterFixture[],
  rect: Readonly<Rect>,
): Promise<Map<string, Uint8Array>> {
  const pixels = new Map<string, Uint8Array>();
  for (const fixture of fixtures) {
    pixels.set(fixture.key, await engine.readLayerPixels(rect, fixture.layerIndex));
  }
  return pixels;
}

function currentRasterFixtures(
  engine: BrushEngine,
  keys: readonly MixedSceneItem["key"][],
  baselineMarkers: ReadonlyMap<string, Point>,
): RasterFixture[] {
  const snapshot = engine.getMixedSceneSnapshot();
  assert(snapshot, "Mixed-scene state is unavailable.");
  return keys.map((key) => {
    const item = snapshot.items.find((candidate) => candidate.key === key);
    assert(item?.kind === "raster", `Raster ${key} is missing from the scene.`);
    assert(item.rasterContentBounds, `Raster ${key} has no content bounds.`);
    const marker = baselineMarkers.get(key);
    assert(marker, `Raster ${key} has no marker baseline.`);
    return {
      key: item.key,
      layerIndex: item.rasterLayerIndex,
      bounds: { ...item.rasterContentBounds },
      marker,
    };
  });
}

async function runScenario(
  engine: BrushEngine,
  allFixtures: readonly RasterFixture[],
  baselinePixels: ReadonlyMap<string, Uint8Array>,
  baselineMarkers: ReadonlyMap<string, Point>,
  rect: Readonly<Rect>,
  definition: Readonly<ScenarioDefinition>,
): Promise<ScenarioReport> {
  const selected = definition.memberIndices.map((index) => allFixtures[index]);
  assert(selected.every(Boolean), `${definition.name} selected an invalid fixture.`);
  const selectedKeys = selected.map((entry) => entry.key);
  const fixtures = currentRasterFixtures(engine, selectedKeys, baselineMarkers);
  const updates = groupUpdates(fixtures, definition);

  assert(await engine.beginMixedSceneGroupTransform(selectedKeys), `${definition.name} preview refused.`);
  engine.updateMixedSceneGroupTransform(updates);
  await waitForRenderedFrame(engine);
  const previewPixels = await readLayers(engine, allFixtures, rect);
  const cancelDifferingBytes = maximumDifferingBytes(baselinePixels, previewPixels);
  assert(cancelDifferingBytes === 0, `${definition.name} preview changed authoritative pixels.`);
  assert(await engine.cancelMixedSceneGroupTransform(), `${definition.name} Cancel refused.`);
  await waitForRenderedFrame(engine);
  const canceledPixels = await readLayers(engine, allFixtures, rect);
  assert(
    maximumDifferingBytes(baselinePixels, canceledPixels) === 0,
    `${definition.name} Cancel did not restore the baseline.`,
  );

  const historyBefore = engine.getHistoryState();
  assert(await engine.beginMixedSceneGroupTransform(selectedKeys), `${definition.name} Apply refused.`);
  engine.updateMixedSceneGroupTransform(updates);
  await waitForRenderedFrame(engine);
  const livePresentation = await engine.readPresentationLayerRect(rect);
  assert(await engine.commitMixedSceneGroupTransform(), `${definition.name} commit refused.`);
  await waitForRenderedFrame(engine);
  const committedPresentation = await engine.readPresentationLayerRect(rect);
  const liveCommitCentroidDistance = distance(
    presentationCyanCentroid(livePresentation, rect),
    presentationCyanCentroid(committedPresentation, rect),
  );
  assert(
    liveCommitCentroidDistance <= PRESENTATION_TOLERANCE_PX,
    `${definition.name} shifted ${liveCommitCentroidDistance.toFixed(2)} px after Apply.`,
  );
  const historyAfter = engine.getHistoryState();
  assert(
    historyAfter.cursor === historyBefore.cursor + 1
      && engine.historyActions[historyAfter.cursor - 1]?.kind === "group-transform",
    `${definition.name} did not publish exactly one group history step.`,
  );

  const appliedPixels = await readLayers(engine, allFixtures, rect);
  let maximumMarkerError = 0;
  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index];
    const pixels = appliedPixels.get(fixture.key);
    assert(pixels, `${definition.name} lost ${fixture.key} after Apply.`);
    const markerError = distance(
      cyanMarkerCentroid(pixels, rect),
      expectedMarker(fixture, updates[index]),
    );
    maximumMarkerError = Math.max(maximumMarkerError, markerError);
    assert(
      markerError <= MARKER_TOLERANCE_PX,
      `${definition.name} moved ${fixture.key} marker by ${markerError.toFixed(2)} px.`,
    );
  }
  for (const fixture of allFixtures) {
    if (selectedKeys.includes(fixture.key)) continue;
    const pixels = appliedPixels.get(fixture.key);
    const baseline = baselinePixels.get(fixture.key);
    assert(pixels && baseline, `${definition.name} lost an unselected raster.`);
    assert(
      compareBytes(pixels, baseline).differingBytes === 0,
      `${definition.name} changed unselected raster ${fixture.key}.`,
    );
  }

  assert(await engine.undo(), `${definition.name} Undo refused.`);
  await waitForRenderedFrame(engine);
  const undoPixels = await readLayers(engine, allFixtures, rect);
  const undoDifferingBytes = maximumDifferingBytes(baselinePixels, undoPixels);
  assert(undoDifferingBytes === 0, `${definition.name} Undo did not restore every raster.`);

  assert(await engine.redo(), `${definition.name} Redo refused.`);
  await waitForRenderedFrame(engine);
  const redoPixels = await readLayers(engine, allFixtures, rect);
  const redoDifferingBytes = maximumDifferingBytes(appliedPixels, redoPixels);
  assert(redoDifferingBytes === 0, `${definition.name} Redo differs from Apply.`);
  assert(await engine.undo(), `${definition.name} second Undo refused.`);
  await waitForRenderedFrame(engine);

  const reverseKeys = [...selectedKeys].reverse();
  const reverseFixtures = currentRasterFixtures(engine, reverseKeys, baselineMarkers);
  const reverseUpdates = groupUpdates(reverseFixtures, definition);
  assert(
    await engine.beginMixedSceneGroupTransform(reverseKeys),
    `${definition.name} reverse-order Apply refused.`,
  );
  engine.updateMixedSceneGroupTransform(reverseUpdates);
  await waitForRenderedFrame(engine);
  assert(await engine.commitMixedSceneGroupTransform(), `${definition.name} reverse commit refused.`);
  await waitForRenderedFrame(engine);
  const reversePixels = await readLayers(engine, allFixtures, rect);
  const reverseOrderDifferingBytes = maximumDifferingBytes(appliedPixels, reversePixels);
  assert(
    reverseOrderDifferingBytes === 0,
    `${definition.name} depends on layer-key order.`,
  );
  assert(await engine.undo(), `${definition.name} reverse Undo refused.`);
  await waitForRenderedFrame(engine);
  assert(
    maximumDifferingBytes(baselinePixels, await readLayers(engine, allFixtures, rect)) === 0,
    `${definition.name} reverse Undo did not restore the baseline.`,
  );
  assert(!engine.activeMixedSceneGroupTransformSession, `${definition.name} left a group session open.`);
  assert(!engine.activeRasterTransformSession, `${definition.name} left a raster session open.`);
  assert(!engine.historyBusy && !engine.layerSwitchBusy, `${definition.name} left the engine locked.`);
  assert(engine.presentationTransactionDepth === 0, `${definition.name} left presentation blocked.`);

  return {
    name: definition.name,
    memberCount: fixtures.length,
    liveCommitCentroidDistance,
    maximumMarkerError,
    cancelDifferingBytes,
    undoDifferingBytes,
    redoDifferingBytes,
    reverseOrderDifferingBytes,
    historyCursorBefore: historyBefore.cursor,
    historyCursorAfter: historyAfter.cursor,
  };
}

async function applyGroupScale(
  engine: BrushEngine,
  fixtures: readonly RasterFixture[],
  baselineMarkers: ReadonlyMap<string, Point>,
  scaleX: number,
  scaleY: number,
): Promise<void> {
  const keys = fixtures.map((fixture) => fixture.key);
  const liveFixtures = currentRasterFixtures(engine, keys, baselineMarkers);
  const updates = groupUpdates(liveFixtures, {
    name: "sequential-scale",
    memberIndices: liveFixtures.map((_, index) => index),
    translation: { x: 0, y: 0 },
    scaleX,
    scaleY,
    rotation: 0,
  });
  assert(await engine.beginMixedSceneGroupTransform(keys), "Sequential group Transform refused.");
  engine.updateMixedSceneGroupTransform(updates);
  await waitForRenderedFrame(engine);
  assert(await engine.commitMixedSceneGroupTransform(), "Sequential group Transform Apply refused.");
  await waitForRenderedFrame(engine);
}

async function runSequentialScaleScenario(
  engine: BrushEngine,
  allFixtures: readonly RasterFixture[],
  cleanFixtures: readonly RasterFixture[],
  baselinePixels: ReadonlyMap<string, Uint8Array>,
  baselineMarkers: ReadonlyMap<string, Point>,
  rect: Readonly<Rect>,
  memberCount: number,
): Promise<SequentialScaleReport> {
  const fixtures = cleanFixtures.slice(0, memberCount);
  assert(fixtures.length === memberCount, `Sequential scale requires ${memberCount} clean rasters.`);
  const selectedKeys = new Set(fixtures.map((fixture) => fixture.key));
  const shrinkScale = 0.4;
  const upscaleScale = 1 / shrinkScale;
  const historyCursorBefore = engine.getHistoryState().cursor;

  assertEquivalentRasterSources(engine, fixtures, `${memberCount}-member baseline`);
  assert(
    maximumPeerDifferingBytes(baselinePixels, fixtures) === 0,
    `${memberCount}-member duplicate baseline pixels differ.`,
  );

  await applyGroupScale(engine, fixtures, baselineMarkers, shrinkScale, shrinkScale);
  const shrinkHistory = engine.getHistoryState();
  const shrinkAction = engine.historyActions[shrinkHistory.cursor - 1];
  assert(
    shrinkHistory.cursor === historyCursorBefore + 1
      && shrinkAction?.kind === "group-transform"
      && shrinkAction.rasters.length === memberCount
      && shrinkAction.rasters.every((entry) => entry.rasterSourceAfter !== null),
    `${memberCount}-member shrink did not preserve every immutable raster source.`,
  );
  const sourceBackedAfterShrink = sourceBackedCount(engine, fixtures);
  assert(
    sourceBackedAfterShrink === memberCount,
    `${memberCount}-member shrink retained ${sourceBackedAfterShrink} raster sources.`,
  );
  assertEquivalentRasterSources(engine, fixtures, `${memberCount}-member shrink`);
  const shrinkPixels = await readLayers(engine, allFixtures, rect);
  const shrinkPeerDifferingBytes = maximumPeerDifferingBytes(shrinkPixels, fixtures);
  assert(shrinkPeerDifferingBytes === 0, `${memberCount}-member shrink pixel quality diverged.`);
  assertUnselectedLayersUnchanged(
    allFixtures,
    selectedKeys,
    baselinePixels,
    shrinkPixels,
    `${memberCount}-member shrink`,
  );

  await applyGroupScale(engine, fixtures, baselineMarkers, upscaleScale, upscaleScale);
  const upscaleHistory = engine.getHistoryState();
  const upscaleAction = engine.historyActions[upscaleHistory.cursor - 1];
  assert(
    upscaleHistory.cursor === historyCursorBefore + 2
      && upscaleAction?.kind === "group-transform"
      && upscaleAction.rasters.length === memberCount
      && upscaleAction.rasters.every((entry) => entry.rasterSourceAfter !== null),
    `${memberCount}-member upscale did not preserve every immutable raster source.`,
  );
  const sourceBackedAfterUpscale = sourceBackedCount(engine, fixtures);
  assert(
    sourceBackedAfterUpscale === memberCount,
    `${memberCount}-member upscale retained ${sourceBackedAfterUpscale} raster sources.`,
  );
  assertEquivalentRasterSources(engine, fixtures, `${memberCount}-member upscale`);
  const upscalePixels = await readLayers(engine, allFixtures, rect);
  const upscalePeerDifferingBytes = maximumPeerDifferingBytes(upscalePixels, fixtures);
  assert(upscalePeerDifferingBytes === 0, `${memberCount}-member upscale pixel quality diverged.`);
  assertUnselectedLayersUnchanged(
    allFixtures,
    selectedKeys,
    baselinePixels,
    upscalePixels,
    `${memberCount}-member upscale`,
  );
  const presentationParity = memberCount === 2
    ? await isolatedPresentationParity(engine, fixtures)
    : [];
  const presentationPeerDifferingBytes = presentationParity.length > 0
    ? Math.max(...presentationParity.flatMap((entry) => [
      entry.inactivePeerDifferingBytes,
      entry.activePeerDifferingBytes,
    ]))
    : 0;
  const presentationEdgeEnergySpread = presentationParity.length > 0
    ? Math.max(...presentationParity.flatMap((entry) => [
      entry.inactiveEdgeEnergySpread,
      entry.activeEdgeEnergySpread,
    ]))
    : 0;
  const presentationActiveInactiveDifferingBytes = presentationParity.length > 0
    ? Math.max(...presentationParity.map((entry) => entry.activeInactiveDifferingBytes))
    : 0;
  const presentationActiveInactiveEdgeEnergyDifference = presentationParity.length > 0
    ? Math.max(...presentationParity.map((entry) => (
      entry.activeInactiveEdgeEnergyDifference
    )))
    : 0;
  assert(
    (memberCount === 2 && presentationParity.length === 4)
      || (memberCount !== 2 && presentationParity.length === 0),
    `${memberCount}-member presentation parity ran outside the two-copy policy probe.`,
  );
  assert(
    presentationPeerDifferingBytes === 0,
    `${memberCount}-member isolated presentation pixels differ after upscale.`,
  );
  assert(
    presentationEdgeEnergySpread === 0,
    `${memberCount}-member isolated presentation edge energy differs after upscale.`,
  );
  assert(
    presentationActiveInactiveDifferingBytes === 0,
    `${memberCount}-member active/inactive presentation pixels differ after upscale.`,
  );
  assert(
    presentationActiveInactiveEdgeEnergyDifference === 0,
    `${memberCount}-member active/inactive presentation edge energy differs after upscale.`,
  );

  assert(await engine.undo(), `${memberCount}-member upscale Undo refused.`);
  await waitForRenderedFrame(engine);
  const shrinkUndoDifferingBytes = maximumDifferingBytes(
    shrinkPixels,
    await readLayers(engine, allFixtures, rect),
  );
  assert(shrinkUndoDifferingBytes === 0, `${memberCount}-member upscale Undo differs from shrink.`);
  assertEquivalentRasterSources(engine, fixtures, `${memberCount}-member upscale Undo`);

  assert(await engine.redo(), `${memberCount}-member upscale Redo refused.`);
  await waitForRenderedFrame(engine);
  const upscaleRedoDifferingBytes = maximumDifferingBytes(
    upscalePixels,
    await readLayers(engine, allFixtures, rect),
  );
  assert(upscaleRedoDifferingBytes === 0, `${memberCount}-member upscale Redo differs from Apply.`);
  assertEquivalentRasterSources(engine, fixtures, `${memberCount}-member upscale Redo`);

  assert(await engine.undo(), `${memberCount}-member second upscale Undo refused.`);
  await waitForRenderedFrame(engine);
  assert(await engine.undo(), `${memberCount}-member shrink Undo refused.`);
  await waitForRenderedFrame(engine);
  const baselineRestoreDifferingBytes = maximumDifferingBytes(
    baselinePixels,
    await readLayers(engine, allFixtures, rect),
  );
  assert(
    baselineRestoreDifferingBytes === 0,
    `${memberCount}-member sequential Undo did not restore the baseline.`,
  );
  assertEquivalentRasterSources(engine, fixtures, `${memberCount}-member baseline restore`);
  assert(
    engine.getHistoryState().cursor === historyCursorBefore,
    `${memberCount}-member sequential Undo restored the wrong history cursor.`,
  );

  return {
    memberCount,
    shrinkScale,
    upscaleScale,
    sourceBackedAfterShrink,
    sourceBackedAfterUpscale,
    shrinkPeerDifferingBytes,
    upscalePeerDifferingBytes,
    shrinkUndoDifferingBytes,
    upscaleRedoDifferingBytes,
    baselineRestoreDifferingBytes,
    presentationPeerDifferingBytes,
    presentationEdgeEnergySpread,
    presentationActiveInactiveDifferingBytes,
    presentationActiveInactiveEdgeEnergyDifference,
    presentationParity,
    historyCursorBefore,
    historyCursorAfter: upscaleHistory.cursor,
  };
}

async function runNonUniformProvenanceScenario(
  engine: BrushEngine,
  allFixtures: readonly RasterFixture[],
  cleanFixtures: readonly RasterFixture[],
  baselinePixels: ReadonlyMap<string, Uint8Array>,
  baselineMarkers: ReadonlyMap<string, Point>,
  rect: Readonly<Rect>,
): Promise<NonUniformProvenanceReport> {
  const fixtures = cleanFixtures.slice(0, 5);
  assert(fixtures.length === 5, "Non-uniform provenance requires five clean rasters.");
  const selectedKeys = new Set(fixtures.map((fixture) => fixture.key));
  const scaleX = 0.58;
  const scaleY = 0.37;

  await applyGroupScale(engine, fixtures, baselineMarkers, scaleX, scaleY);
  const action = engine.historyActions[engine.getHistoryState().cursor - 1];
  assert(
    action?.kind === "group-transform"
      && action.rasters.length === fixtures.length
      && action.rasters.every((entry) => entry.rasterSourceAfter === null),
    "Non-uniform scale did not rasterize every selected source.",
  );
  const sourceBackedAfterApply = sourceBackedCount(engine, fixtures);
  assert(sourceBackedAfterApply === 0, "Non-uniform scale retained only part of the provenance.");
  const appliedPixels = await readLayers(engine, allFixtures, rect);
  const peerDifferingBytes = maximumPeerDifferingBytes(appliedPixels, fixtures);
  assert(peerDifferingBytes === 0, "Non-uniform scale produced unequal duplicate rasters.");
  assertUnselectedLayersUnchanged(
    allFixtures,
    selectedKeys,
    baselinePixels,
    appliedPixels,
    "Non-uniform scale",
  );

  assert(await engine.undo(), "Non-uniform scale Undo refused.");
  await waitForRenderedFrame(engine);
  const undoDifferingBytes = maximumDifferingBytes(
    baselinePixels,
    await readLayers(engine, allFixtures, rect),
  );
  assert(undoDifferingBytes === 0, "Non-uniform scale Undo did not restore the baseline.");
  assertEquivalentRasterSources(engine, fixtures, "Non-uniform scale Undo");

  assert(await engine.redo(), "Non-uniform scale Redo refused.");
  await waitForRenderedFrame(engine);
  const redoDifferingBytes = maximumDifferingBytes(
    appliedPixels,
    await readLayers(engine, allFixtures, rect),
  );
  assert(redoDifferingBytes === 0, "Non-uniform scale Redo differs from Apply.");
  assert(sourceBackedCount(engine, fixtures) === 0, "Non-uniform scale Redo restored provenance.");

  assert(await engine.undo(), "Non-uniform scale final Undo refused.");
  await waitForRenderedFrame(engine);
  const baselineRestoreDifferingBytes = maximumDifferingBytes(
    baselinePixels,
    await readLayers(engine, allFixtures, rect),
  );
  assert(
    baselineRestoreDifferingBytes === 0,
    "Non-uniform scale final Undo did not restore the baseline.",
  );
  assertEquivalentRasterSources(engine, fixtures, "Non-uniform scale final Undo");

  return {
    memberCount: fixtures.length,
    scaleX,
    scaleY,
    sourceBackedAfterApply,
    peerDifferingBytes,
    undoDifferingBytes,
    redoDifferingBytes,
    baselineRestoreDifferingBytes,
  };
}

export async function runGroupTransformGpuTest(
  engine: BrushEngine,
): Promise<GroupTransformGpuTestReport> {
  assert(
    engine.documentWidth === DOCUMENT_SIZE && engine.documentHeight === DOCUMENT_SIZE,
    `Group Transform GPU test requires a ${DOCUMENT_SIZE}×${DOCUMENT_SIZE} document.`,
  );
  assert(engine.layerFormat === "rgba16float", "Group Transform GPU test requires RGBA16F.");
  const initialScene = engine.getMixedSceneSnapshot();
  assert(
    initialScene?.items.length === 1
      && initialScene.items[0]?.kind === "raster"
      && !initialScene.items[0].rasterHasContent,
    "Group Transform GPU test requires a fresh empty document.",
  );
  assert(engine.getHistoryState().actionCount === 0, "Group Transform GPU test requires empty history.");

  const browserErrors: string[] = [];
  const gpuErrors: string[] = [];
  const onError = (event: ErrorEvent): void => {
    browserErrors.push(event.error instanceof Error ? event.error.message : event.message);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    browserErrors.push(event.reason instanceof Error ? event.reason.message : String(event.reason));
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  engine.device.pushErrorScope("validation");
  engine.device.pushErrorScope("internal");
  engine.device.pushErrorScope("out-of-memory");

  const startedAt = performance.now();
  let scenarios: ScenarioReport[] = [];
  let sequentialScales: SequentialScaleReport[] = [];
  let nonUniformProvenance: NonUniformProvenanceReport | null = null;
  let sourceBackedLayerCount = 0;
  let expandedLayerHasRasterSource = true;
  let paintUndoRestoredRasterSource = false;
  let paintRedoDroppedRasterSource = false;
  let paintUndoDifferingBytes = 0;
  let paintRedoDifferingBytes = 0;
  let failure: unknown = null;
  try {
    setLayerCompositeTestView(engine, DOCUMENT_SIZE * 0.5, DOCUMENT_SIZE * 0.5, 1);
    await engine.importRasterImageFile(await createFixtureFile());
    await engine.waitForIdle();
    const imported = await engine.beginRasterLayerTransform("affine");
    assert(imported, "The imported raster could not open Transform.");
    engine.updateRasterLayerTransform({ x: 30, y: 256, scaleX: 1, scaleY: 1, rotation: 0 });
    assert(await engine.commitRasterLayerTransform(), "The fixture positioning Transform failed.");
    await engine.waitForIdle();

    for (let index = 0; index < 5; index += 1) {
      const duplicate = await engine.duplicateSelectedLayer();
      assert(duplicate.kind === "raster", "The fixture duplicate was not raster.");
      await engine.waitForIdle();
    }
    engine.setBrushSettings({
      tool: "paint",
      shape: "circle",
      grainMode: "off",
      color: "#ff2aa1",
      size: 18,
      hardness: 1,
      spacingPercent: 2,
      stabilization: 0,
      startThickness: 1,
      endThickness: 1,
      count: 1,
      flow: 1,
      opacity: 1,
      blendMode: "normal",
      shapeScatter: 0,
      hueJitterDegrees: 0,
      saturationJitter: 0,
      lightnessJitter: 0,
      darknessJitter: 0,
      positionJitterLateral: 0,
      positionJitterLinear: 0,
    });
    await engine.ensureCurrentBrushResources();
    assert(
      engine.beginStrokeAtLayer({ x: 130, y: 128, pressure: 1, timeMs: 100 }),
      "The bounding-box extension stroke did not start.",
    );
    engine.extendStrokeAtLayer([
      { x: 165, y: 128, pressure: 1, timeMs: 116 },
      { x: 200, y: 128, pressure: 1, timeMs: 132 },
      { x: 235, y: 128, pressure: 1, timeMs: 148 },
    ]);
    engine.endStroke(148);
    await waitForRenderedFrame(engine);

    const scene = engine.getMixedSceneSnapshot();
    assert(scene, "The fixture scene is unavailable.");
    const rasterItems = scene.items.filter(
      (item): item is Extract<typeof item, { kind: "raster" }> => (
        item.kind === "raster" && item.rasterHasContent
      ),
    ).sort((left, right) => left.rasterLayerIndex - right.rasterLayerIndex);
    assert(rasterItems.length === 6, `Expected 6 raster fixtures, received ${rasterItems.length}.`);
    sourceBackedLayerCount = rasterItems.filter((item) => (
      engine.layerStack.at(item.rasterLayerIndex).rasterSource !== null
    )).length;
    const expanded = rasterItems.at(-1)!;
    expandedLayerHasRasterSource = engine.layerStack.at(expanded.rasterLayerIndex).rasterSource !== null;
    assert(
      sourceBackedLayerCount === 5,
      `Exactly five rasters must retain raster provenance; received ${sourceBackedLayerCount}.`,
    );
    assert(!expandedLayerHasRasterSource, "The painted copy must leave immutable raster provenance.");

    const rect = { x: 0, y: 0, width: DOCUMENT_SIZE, height: DOCUMENT_SIZE };
    const expandedPixelsBeforeUndo = await engine.readLayerPixels(rect, expanded.rasterLayerIndex);
    assert(
      engine.historyActions[engine.getHistoryState().cursor - 1]?.kind === "stroke",
      "The bounding-box extension must be the latest history action.",
    );
    assert(await engine.undo(), "The painted-copy provenance Undo refused.");
    await waitForRenderedFrame(engine);
    paintUndoRestoredRasterSource = engine.layerStack.at(expanded.rasterLayerIndex).rasterSource !== null;
    assert(
      paintUndoRestoredRasterSource,
      "Undo must restore the painted copy's immutable raster provenance.",
    );
    paintUndoDifferingBytes = compareBytes(
      expandedPixelsBeforeUndo,
      await engine.readLayerPixels(rect, expanded.rasterLayerIndex),
    ).differingBytes;
    assert(paintUndoDifferingBytes > 0, "Undo did not remove the bounding-box extension stroke.");
    assert(await engine.redo(), "The painted-copy provenance Redo refused.");
    await waitForRenderedFrame(engine);
    paintRedoDroppedRasterSource = engine.layerStack.at(expanded.rasterLayerIndex).rasterSource === null;
    assert(
      paintRedoDroppedRasterSource,
      "Redo must discard stale immutable raster provenance again.",
    );
    paintRedoDifferingBytes = compareBytes(
      expandedPixelsBeforeUndo,
      await engine.readLayerPixels(rect, expanded.rasterLayerIndex),
    ).differingBytes;
    assert(paintRedoDifferingBytes === 0, "Redo did not restore the extension stroke byte-for-byte.");

    const provisional = rasterItems.map((item) => ({
      key: item.key,
      layerIndex: item.rasterLayerIndex,
      bounds: { ...item.rasterContentBounds! },
      marker: { x: 0, y: 0 },
    }));
    const baselinePixels = await readLayers(engine, provisional, rect);
    const baselineMarkers = new Map(provisional.map((fixture) => {
      const pixels = baselinePixels.get(fixture.key);
      assert(pixels, `Missing baseline for ${fixture.key}.`);
      return [fixture.key, cyanMarkerCentroid(pixels, rect)] as const;
    }));
    const allFixtures = currentRasterFixtures(
      engine,
      provisional.map((entry) => entry.key),
      baselineMarkers,
    );
    const definitions: readonly ScenarioDefinition[] = [
      {
        name: "two-uniform-shrink",
        memberIndices: [0, 5],
        translation: { x: 24, y: -10 },
        scaleX: 0.55,
        scaleY: 0.55,
        rotation: 0,
      },
      {
        name: "three-independent-axes",
        memberIndices: [1, 2, 5],
        translation: { x: 38, y: -14 },
        scaleX: 0.62,
        scaleY: 0.38,
        rotation: 0,
      },
      {
        name: "three-rotation",
        memberIndices: [0, 3, 5],
        translation: { x: 32, y: 12 },
        scaleX: 0.72,
        scaleY: 0.72,
        rotation: 33 * Math.PI / 180,
      },
      {
        name: "five-combined-affine",
        memberIndices: [0, 1, 2, 4, 5],
        translation: { x: 45, y: -20 },
        scaleX: 0.48,
        scaleY: 0.71,
        rotation: 31 * Math.PI / 180,
      },
    ];
    for (const definition of definitions) {
      scenarios.push(await runScenario(
        engine,
        allFixtures,
        baselinePixels,
        baselineMarkers,
        rect,
        definition,
      ));
    }
    const cleanFixtures = allFixtures.slice(0, 5);
    for (const memberCount of [2, 3, 5]) {
      sequentialScales.push(await runSequentialScaleScenario(
        engine,
        allFixtures,
        cleanFixtures,
        baselinePixels,
        baselineMarkers,
        rect,
        memberCount,
      ));
    }
    nonUniformProvenance = await runNonUniformProvenanceScenario(
      engine,
      allFixtures,
      cleanFixtures,
      baselinePixels,
      baselineMarkers,
      rect,
    );
  } catch (error) {
    failure = error;
  } finally {
    const outOfMemoryError = await engine.device.popErrorScope();
    const internalError = await engine.device.popErrorScope();
    const validationError = await engine.device.popErrorScope();
    for (const error of [validationError, internalError, outOfMemoryError]) {
      if (error) gpuErrors.push(error.message);
    }
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  }

  if (failure) throw failure;
  assert(nonUniformProvenance, "The non-uniform provenance scenario did not run.");
  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join("; ")}`);
  assert(gpuErrors.length === 0, `WebGPU errors: ${gpuErrors.join("; ")}`);
  return {
    version: GROUP_TRANSFORM_GPU_TEST_VERSION,
    passed: true,
    durationMs: performance.now() - startedAt,
    layerCount: 6,
    sourceBackedLayerCount,
    expandedLayerHasRasterSource,
    paintUndoRestoredRasterSource,
    paintRedoDroppedRasterSource,
    paintUndoDifferingBytes,
    paintRedoDifferingBytes,
    scenarios,
    sequentialScales,
    nonUniformProvenance,
    browserErrors,
    gpuErrors,
  };
}
