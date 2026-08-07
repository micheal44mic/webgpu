import type { BrushEngine } from "./brush-engine";
import type { EngineStats } from "./engine-stats";
import type { LayerSwitchResult } from "./engine-types";
import { LAYER_STACK_MAXIMUM } from "./layer-stack";
import { LAYER_STORAGE_TILE_SIZE } from "./layer-storage-study";

export const IPHONE_MEMORY_LIMIT_TEST_VERSION = 1 as const;
export const IPHONE_MEMORY_LIMIT_TEST_BUILD =
  "iphone-rgba16f-gpu-plus-compressed-cpu-peaks-v3" as const;
export const IPHONE_MEMORY_LIMIT_API_URL = "/api/iphone-memory-limit-runs";
export const IPHONE_MEMORY_LIMIT_STORAGE_TILE_PLAN = Object.freeze([
  224, 224, 224, 224, 224,
  224, 224, 224, 224, 224,
  224, 224, 224, 224, 192,
]) as readonly number[];

const LOCAL_STORAGE_KEY = "webgpu-brush-engine.iphone-memory-limit.v1";
const HASH_PARAMETER = "memoryRun";
const RGBA16F_BYTES_PER_PIXEL = 8;
const MEBIBYTE_BYTES = 1024 * 1024;
const TILE_MEMORY_MIB_RGBA16F =
  LAYER_STORAGE_TILE_SIZE ** 2 * RGBA16F_BYTES_PER_PIXEL / MEBIBYTE_BYTES;
const CHECKPOINT_RETRY_DELAYS_MS = [0, 450, 1_200] as const;
const SETTLE_BETWEEN_STEPS_MS = 900;

export type IphoneMemoryLimitRunStatus =
  | "running"
  | "completed"
  | "interrupted"
  | "error";

export type IphoneMemoryLimitOperation =
  | "add-layer"
  | "arm-final-layer"
  | "switch-middle"
  | "switch-top";

export interface IphoneMemorySnapshot {
  layerCount: number;
  activeLayerIndex: number;
  countedTotalMiB: number;
  countedGpuPlusCompressedCpuMiB: number;
  layerBaseMiB: number;
  layerColdMiB: number;
  layerCompressedCpuMiB: number;
  layerHydrationMiB: number;
  layerMipChainMiB: number;
  layerBakeMiB: number;
  layerCompositeMiB: number;
  effectsScratchPoolMiB: number;
  lightGlazeMiB: number;
  stabilizationTailMiB: number;
  thicknessTailMiB: number;
  historyGpuMiB: number;
  presentationCacheMiB: number;
  vectorTextPresentationMiB: number;
  rasterImageMiB: number;
}

export interface IphoneMemoryLimitEvent {
  sequence: number;
  kind: "attempt" | "completed" | "interrupted" | "error";
  operation: IphoneMemoryLimitOperation;
  recordedAt: string;
  step: number;
  storageTileCount?: number;
  storageMiB?: number;
  targetLayerCount?: number;
  targetLayerIndex?: number;
  attemptSequence?: number;
  before?: IphoneMemorySnapshot;
  after?: IphoneMemorySnapshot;
  peakCountedTotalMiB?: number;
  peakCountedGpuPlusCompressedCpuMiB?: number;
  switch?: {
    fromIndex: number;
    toIndex: number;
    totalMs: number;
    effectsMs: number;
    compositeMs: number;
  };
  reason?: string;
}

export interface IphoneMemoryLimitEnvironment {
  userAgent: string;
  platform: string;
  language: string;
  maxTouchPoints: number;
  devicePixelRatio: number;
  screenWidth: number;
  screenHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  hardwareConcurrency: number | null;
  deviceMemoryGiB: number | null;
  gpuLabel: string;
  layerFormat: string;
  deviceLabel: string | null;
}

export interface IphoneMemoryLimitVariant {
  layerColdCompressionEnabled: boolean;
  layerColdCompressionRuntimeBuild: string | null;
  layerColdDirectHotHydrationEnabled: boolean;
  layerColdAdjacentPrefetchEnabled: boolean;
}

export interface IphoneMemoryLimitRun {
  version: typeof IPHONE_MEMORY_LIMIT_TEST_VERSION;
  build: typeof IPHONE_MEMORY_LIMIT_TEST_BUILD;
  runId: string;
  createdAt: string;
  updatedAt: string;
  status: IphoneMemoryLimitRunStatus;
  plan: {
    maximumLayers: typeof LAYER_STACK_MAXIMUM;
    tileMemoryMiB: typeof TILE_MEMORY_MIB_RGBA16F;
    storageTileCounts: readonly number[];
    plannedColdMiB: number;
    automaticMiddleAndTopSwitches: true;
  };
  environment: IphoneMemoryLimitEnvironment;
  variant: IphoneMemoryLimitVariant;
  events: IphoneMemoryLimitEvent[];
  lastCompletedStep: number;
  lastSafeMiB: number;
  highestObservedPeakMiB: number;
  lastSafeCountedGpuPlusCompressedCpuMiB: number;
  highestObservedCountedGpuPlusCompressedCpuPeakMiB: number;
  latestMemory: IphoneMemorySnapshot;
  failure?: string;
}

export interface IphoneMemoryLimitProgress {
  run: IphoneMemoryLimitRun;
  event: IphoneMemoryLimitEvent;
  completedOperations: number;
  totalOperations: number;
}

export interface IphoneMemoryLimitOptions {
  deviceLabel?: string;
  serverRequired?: boolean;
  onProgress?: (progress: IphoneMemoryLimitProgress) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function snapshot(stats: EngineStats): IphoneMemorySnapshot {
  return {
    layerCount: stats.layerCount,
    activeLayerIndex: stats.activeLayerIndex,
    countedTotalMiB: stats.gpuMemory.countedTotalMiB,
    countedGpuPlusCompressedCpuMiB:
      stats.gpuMemory.countedGpuPlusCompressedCpuMiB,
    layerBaseMiB: stats.gpuMemory.layerBaseMiB,
    layerColdMiB: stats.gpuMemory.layerColdMiB,
    layerCompressedCpuMiB: stats.gpuMemory.layerCompressedCpuMiB,
    layerHydrationMiB: stats.gpuMemory.layerHydrationMiB,
    layerMipChainMiB: stats.gpuMemory.layerMipChainMiB,
    layerBakeMiB: stats.gpuMemory.layerBakeMiB,
    layerCompositeMiB: stats.gpuMemory.layerCompositeMiB,
    effectsScratchPoolMiB: stats.gpuMemory.effectsScratchPoolMiB,
    lightGlazeMiB: stats.gpuMemory.lightGlazeMiB,
    stabilizationTailMiB: stats.gpuMemory.stabilizationTailMiB,
    thicknessTailMiB: stats.gpuMemory.thicknessTailMiB,
    historyGpuMiB: stats.gpuMemory.historyGpuMiB,
    presentationCacheMiB: stats.gpuMemory.presentationCacheMiB,
    vectorTextPresentationMiB: stats.gpuMemory.vectorTextPresentationMiB,
    rasterImageMiB: stats.gpuMemory.rasterImageMiB,
  };
}

function compactSwitch(result: LayerSwitchResult | null): IphoneMemoryLimitEvent["switch"] {
  return result
    ? {
      fromIndex: result.fromIndex,
      toIndex: result.toIndex,
      totalMs: result.totalMs,
      effectsMs: result.effectsMs,
      compositeMs: result.compositeMs,
    }
    : undefined;
}

function makeRunId(): string {
  const random = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replaceAll("-", "")
    : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `iphone-${Date.now().toString(36)}-${random.slice(0, 24)}`;
}

function collectEnvironment(
  stats: EngineStats,
  deviceLabel: string | undefined,
): IphoneMemoryLimitEnvironment {
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    maxTouchPoints: navigator.maxTouchPoints,
    devicePixelRatio: window.devicePixelRatio || 1,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGiB: navigatorWithMemory.deviceMemory ?? null,
    gpuLabel: stats.gpuLabel,
    layerFormat: stats.layerFormat,
    deviceLabel: deviceLabel?.trim() || null,
  };
}

function writeLocalCheckpoint(run: IphoneMemoryLimitRun): void {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(run));
  } catch {
    // The server checkpoint remains authoritative when storage is unavailable.
  }
}

function readLocalCheckpoint(): IphoneMemoryLimitRun | null {
  try {
    const serialized = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!serialized) {
      return null;
    }
    const value = JSON.parse(serialized) as Partial<IphoneMemoryLimitRun>;
    return value.version === IPHONE_MEMORY_LIMIT_TEST_VERSION
      && value.build === IPHONE_MEMORY_LIMIT_TEST_BUILD
      && typeof value.runId === "string"
      && Array.isArray(value.events)
      ? value as IphoneMemoryLimitRun
      : null;
  } catch {
    return null;
  }
}

function runIdFromHash(): string | null {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  const runId = parameters.get(HASH_PARAMETER);
  return runId && /^iphone-[a-z0-9-]{12,80}$/i.test(runId) ? runId : null;
}

function publishRunIdToHash(runId: string): void {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  parameters.set(HASH_PARAMETER, runId);
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}#${parameters.toString()}`,
  );
}

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

async function postCheckpoint(
  run: IphoneMemoryLimitRun,
  serverRequired: boolean,
): Promise<void> {
  run.updatedAt = nowIso();
  writeLocalCheckpoint(run);
  if (!serverRequired) {
    return;
  }

  let lastError: unknown = null;
  for (const retryDelay of CHECKPOINT_RETRY_DELAYS_MS) {
    await delay(retryDelay);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(IPHONE_MEMORY_LIMIT_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(run),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Checkpoint server HTTP ${response.status}.`);
      }
      return;
    } catch (error) {
      lastError = error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw new Error(
    `Checkpoint non salvato nel progetto: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function getServerCheckpoint(runId: string): Promise<IphoneMemoryLimitRun | null> {
  const response = await fetch(
    `${IPHONE_MEMORY_LIMIT_API_URL}?id=${encodeURIComponent(runId)}`,
    { cache: "no-store" },
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Lettura checkpoint server HTTP ${response.status}.`);
  }
  const payload = await response.json() as { run?: unknown };
  const run = payload.run as Partial<IphoneMemoryLimitRun> | undefined;
  return run?.version === IPHONE_MEMORY_LIMIT_TEST_VERSION
    && run.build === IPHONE_MEMORY_LIMIT_TEST_BUILD
    && run.runId === runId
    && Array.isArray(run.events)
    ? run as IphoneMemoryLimitRun
    : null;
}

function addEvent(
  run: IphoneMemoryLimitRun,
  event: Omit<IphoneMemoryLimitEvent, "sequence" | "recordedAt">,
): IphoneMemoryLimitEvent {
  const complete: IphoneMemoryLimitEvent = {
    ...event,
    sequence: run.events.length + 1,
    recordedAt: nowIso(),
  };
  run.events.push(complete);
  return complete;
}

function updateSafeState(
  run: IphoneMemoryLimitRun,
  step: number,
  memory: IphoneMemorySnapshot,
  peaks: IphoneMemoryPeaks,
): void {
  run.lastCompletedStep = step;
  run.lastSafeMiB = memory.countedTotalMiB;
  run.highestObservedPeakMiB = Math.max(
    run.highestObservedPeakMiB,
    peaks.countedGpuMiB,
  );
  run.lastSafeCountedGpuPlusCompressedCpuMiB =
    memory.countedGpuPlusCompressedCpuMiB;
  run.highestObservedCountedGpuPlusCompressedCpuPeakMiB = Math.max(
    run.highestObservedCountedGpuPlusCompressedCpuPeakMiB,
    peaks.countedGpuPlusCompressedCpuMiB,
  );
  run.latestMemory = memory;
}

interface IphoneMemoryPeaks {
  countedGpuMiB: number;
  countedGpuPlusCompressedCpuMiB: number;
}

function startPeakSampler(engine: BrushEngine): {
  stop: () => IphoneMemoryPeaks;
} {
  const initial = engine.getStats().gpuMemory;
  const peaks: IphoneMemoryPeaks = {
    countedGpuMiB: initial.countedTotalMiB,
    countedGpuPlusCompressedCpuMiB: initial.countedGpuPlusCompressedCpuMiB,
  };
  const sample = (): void => {
    const memory = engine.getStats().gpuMemory;
    peaks.countedGpuMiB = Math.max(peaks.countedGpuMiB, memory.countedTotalMiB);
    peaks.countedGpuPlusCompressedCpuMiB = Math.max(
      peaks.countedGpuPlusCompressedCpuMiB,
      memory.countedGpuPlusCompressedCpuMiB,
    );
  };
  const interval = window.setInterval(() => {
    sample();
  }, 5);
  return {
    stop() {
      window.clearInterval(interval);
      sample();
      return peaks;
    },
  };
}

function createRun(
  stats: EngineStats,
  deviceLabel: string | undefined,
): IphoneMemoryLimitRun {
  const timestamp = nowIso();
  const initialMemory = snapshot(stats);
  return {
    version: IPHONE_MEMORY_LIMIT_TEST_VERSION,
    build: IPHONE_MEMORY_LIMIT_TEST_BUILD,
    runId: makeRunId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "running",
    plan: {
      maximumLayers: LAYER_STACK_MAXIMUM,
      tileMemoryMiB: TILE_MEMORY_MIB_RGBA16F,
      storageTileCounts: [...IPHONE_MEMORY_LIMIT_STORAGE_TILE_PLAN],
      plannedColdMiB: IPHONE_MEMORY_LIMIT_STORAGE_TILE_PLAN.reduce(
        (total, tileCount) => total + tileCount * TILE_MEMORY_MIB_RGBA16F,
        0,
      ),
      automaticMiddleAndTopSwitches: true,
    },
    environment: collectEnvironment(stats, deviceLabel),
    variant: {
      layerColdCompressionEnabled: stats.layerColdCompressionEnabled,
      layerColdCompressionRuntimeBuild: stats.layerColdCompressionRuntimeBuild,
      layerColdDirectHotHydrationEnabled:
        stats.layerColdDirectHotHydrationEnabled,
      layerColdAdjacentPrefetchEnabled:
        stats.layerColdAdjacentPrefetchEnabled,
    },
    events: [],
    lastCompletedStep: 0,
    lastSafeMiB: initialMemory.countedTotalMiB,
    highestObservedPeakMiB: initialMemory.countedTotalMiB,
    lastSafeCountedGpuPlusCompressedCpuMiB:
      initialMemory.countedGpuPlusCompressedCpuMiB,
    highestObservedCountedGpuPlusCompressedCpuPeakMiB:
      initialMemory.countedGpuPlusCompressedCpuMiB,
    latestMemory: initialMemory,
  };
}

async function executeMeasuredSwitch(
  engine: BrushEngine,
  run: IphoneMemoryLimitRun,
  operation: Extract<IphoneMemoryLimitOperation, "switch-middle" | "switch-top">,
  targetIndex: number,
  step: number,
  serverRequired: boolean,
  onProgress: IphoneMemoryLimitOptions["onProgress"],
  completedOperations: number,
  totalOperations: number,
): Promise<number> {
  const before = snapshot(engine.getStats());
  const attempt = addEvent(run, {
    kind: "attempt",
    operation,
    step,
    targetLayerIndex: targetIndex,
    before,
  });
  await postCheckpoint(run, serverRequired);
  onProgress?.({ run, event: attempt, completedOperations, totalOperations });

  const sampler = startPeakSampler(engine);
  let peaks: IphoneMemoryPeaks = {
    countedGpuMiB: before.countedTotalMiB,
    countedGpuPlusCompressedCpuMiB: before.countedGpuPlusCompressedCpuMiB,
  };
  let result: LayerSwitchResult | null = null;
  try {
    result = await engine.setActiveLayer(targetIndex);
    await engine.waitForIdle();
  } finally {
    peaks = sampler.stop();
  }

  const after = snapshot(engine.getStats());
  const completed = addEvent(run, {
    kind: "completed",
    operation,
    step,
    targetLayerIndex: targetIndex,
    attemptSequence: attempt.sequence,
    before,
    after,
    peakCountedTotalMiB: peaks.countedGpuMiB,
    peakCountedGpuPlusCompressedCpuMiB:
      peaks.countedGpuPlusCompressedCpuMiB,
    switch: compactSwitch(result),
  });
  updateSafeState(run, step, after, peaks);
  await postCheckpoint(run, serverRequired);
  onProgress?.({
    run,
    event: completed,
    completedOperations: completedOperations + 1,
    totalOperations,
  });
  return completedOperations + 1;
}

export async function recoverInterruptedIphoneMemoryLimitRun(
  serverRequired = true,
): Promise<IphoneMemoryLimitRun | null> {
  const local = readLocalCheckpoint();
  const runId = runIdFromHash() ?? local?.runId ?? null;
  if (!runId) {
    return null;
  }

  let run = local?.runId === runId ? local : null;
  if (serverRequired) {
    const server = await getServerCheckpoint(runId);
    if (server && (!run || server.updatedAt >= run.updatedAt)) {
      run = server;
    }
  }
  if (!run || run.status !== "running") {
    return run;
  }

  const pendingAttempt = run.events.at(-1);
  const reason = pendingAttempt?.kind === "attempt"
    ? "La pagina precedente è terminata durante questa operazione; crash/ricarica inferito."
    : "La pagina precedente è terminata fra due operazioni; nessun gradino fallito identificato.";
  addEvent(run, {
    kind: "interrupted",
    operation: pendingAttempt?.operation ?? "add-layer",
    step: pendingAttempt?.step ?? run.lastCompletedStep,
    storageTileCount: pendingAttempt?.storageTileCount,
    storageMiB: pendingAttempt?.storageMiB,
    targetLayerCount: pendingAttempt?.targetLayerCount,
    targetLayerIndex: pendingAttempt?.targetLayerIndex,
    attemptSequence: pendingAttempt?.kind === "attempt"
      ? pendingAttempt.sequence
      : undefined,
    before: pendingAttempt?.before ?? run.latestMemory,
    reason,
  });
  run.status = "interrupted";
  run.failure = reason;
  await postCheckpoint(run, serverRequired);
  writeLocalCheckpoint(run);
  return run;
}

export async function runIphoneMemoryLimitTest(
  engine: BrushEngine,
  options: IphoneMemoryLimitOptions = {},
): Promise<IphoneMemoryLimitRun> {
  const initialStats = engine.getStats();
  if (
    initialStats.layerFormat !== "rgba16float"
    || initialStats.layerCount !== 1
    || initialStats.activeLayerIndex !== 0
    || initialStats.layers[0]?.hasContent
  ) {
    throw new Error(
      "La ricerca del limite richiede una pagina nuova RGBA16F con un solo livello vuoto.",
    );
  }
  if (engine.getHistoryState().busy) {
    throw new Error("La cronologia è occupata: ricarica la pagina e riprova.");
  }

  const serverRequired = options.serverRequired !== false;
  const totalOperations = IPHONE_MEMORY_LIMIT_STORAGE_TILE_PLAN.length + 3;
  let completedOperations = 0;
  const run = createRun(initialStats, options.deviceLabel);
  publishRunIdToHash(run.runId);
  await postCheckpoint(run, serverRequired);

  try {
    for (
      let planIndex = 0;
      planIndex < IPHONE_MEMORY_LIMIT_STORAGE_TILE_PLAN.length;
      planIndex += 1
    ) {
      const storageTileCount = IPHONE_MEMORY_LIMIT_STORAGE_TILE_PLAN[planIndex];
      const step = planIndex + 1;
      const before = snapshot(engine.getStats());
      const attempt = addEvent(run, {
        kind: "attempt",
        operation: "add-layer",
        step,
        storageTileCount,
        storageMiB: storageTileCount * TILE_MEMORY_MIB_RGBA16F,
        targetLayerCount: before.layerCount + 1,
        before,
      });
      await postCheckpoint(run, serverRequired);
      options.onProgress?.({
        run,
        event: attempt,
        completedOperations,
        totalOperations,
      });

      const sampler = startPeakSampler(engine);
      let peaks: IphoneMemoryPeaks = {
        countedGpuMiB: before.countedTotalMiB,
        countedGpuPlusCompressedCpuMiB: before.countedGpuPlusCompressedCpuMiB,
      };
      let switchResult: LayerSwitchResult | null = null;
      try {
        await engine.seedActiveLayerMemoryStress(planIndex, storageTileCount);
        switchResult = await engine.addLayer(`Limite ${step + 1}`);
        await engine.waitForIdle();
      } finally {
        peaks = sampler.stop();
      }

      const after = snapshot(engine.getStats());
      const completed = addEvent(run, {
        kind: "completed",
        operation: "add-layer",
        step,
        storageTileCount,
        storageMiB: storageTileCount * TILE_MEMORY_MIB_RGBA16F,
        targetLayerCount: after.layerCount,
        attemptSequence: attempt.sequence,
        before,
        after,
        peakCountedTotalMiB: peaks.countedGpuMiB,
        peakCountedGpuPlusCompressedCpuMiB:
          peaks.countedGpuPlusCompressedCpuMiB,
        switch: compactSwitch(switchResult),
      });
      updateSafeState(run, step, after, peaks);
      completedOperations += 1;
      await postCheckpoint(run, serverRequired);
      options.onProgress?.({
        run,
        event: completed,
        completedOperations,
        totalOperations,
      });
      await delay(SETTLE_BETWEEN_STEPS_MS);
    }

    const armStep = IPHONE_MEMORY_LIMIT_STORAGE_TILE_PLAN.length + 1;
    const armBefore = snapshot(engine.getStats());
    const armAttempt = addEvent(run, {
      kind: "attempt",
      operation: "arm-final-layer",
      step: armStep,
      storageTileCount: 192,
      storageMiB: 48,
      before: armBefore,
    });
    await postCheckpoint(run, serverRequired);
    options.onProgress?.({
      run,
      event: armAttempt,
      completedOperations,
      totalOperations,
    });
    await engine.seedActiveLayerMemoryStress(
      IPHONE_MEMORY_LIMIT_STORAGE_TILE_PLAN.length,
      192,
    );
    const armAfter = snapshot(engine.getStats());
    const armed = addEvent(run, {
      kind: "completed",
      operation: "arm-final-layer",
      step: armStep,
      storageTileCount: 192,
      storageMiB: 48,
      attemptSequence: armAttempt.sequence,
      before: armBefore,
      after: armAfter,
      peakCountedTotalMiB: armAfter.countedTotalMiB,
      peakCountedGpuPlusCompressedCpuMiB:
        armAfter.countedGpuPlusCompressedCpuMiB,
    });
    updateSafeState(run, armStep, armAfter, {
      countedGpuMiB: armAfter.countedTotalMiB,
      countedGpuPlusCompressedCpuMiB:
        armAfter.countedGpuPlusCompressedCpuMiB,
    });
    completedOperations += 1;
    await postCheckpoint(run, serverRequired);
    options.onProgress?.({
      run,
      event: armed,
      completedOperations,
      totalOperations,
    });
    await delay(SETTLE_BETWEEN_STEPS_MS);

    const middleIndex = Math.floor((engine.getStats().layerCount - 1) / 2);
    completedOperations = await executeMeasuredSwitch(
      engine,
      run,
      "switch-middle",
      middleIndex,
      armStep + 1,
      serverRequired,
      options.onProgress,
      completedOperations,
      totalOperations,
    );
    await delay(SETTLE_BETWEEN_STEPS_MS);
    completedOperations = await executeMeasuredSwitch(
      engine,
      run,
      "switch-top",
      engine.getStats().layerCount - 1,
      armStep + 2,
      serverRequired,
      options.onProgress,
      completedOperations,
      totalOperations,
    );

    run.status = "completed";
    run.latestMemory = snapshot(engine.getStats());
    await postCheckpoint(run, serverRequired);
    return run;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lastEvent = run.events.at(-1);
    const failed = addEvent(run, {
      kind: "error",
      operation: lastEvent?.operation ?? "add-layer",
      step: lastEvent?.step ?? run.lastCompletedStep + 1,
      storageTileCount: lastEvent?.storageTileCount,
      storageMiB: lastEvent?.storageMiB,
      targetLayerCount: lastEvent?.targetLayerCount,
      targetLayerIndex: lastEvent?.targetLayerIndex,
      attemptSequence: lastEvent?.kind === "attempt"
        ? lastEvent.sequence
        : undefined,
      before: lastEvent?.before ?? run.latestMemory,
      after: snapshot(engine.getStats()),
      reason: message,
    });
    run.status = "error";
    run.failure = message;
    run.latestMemory = snapshot(engine.getStats());
    try {
      await postCheckpoint(run, serverRequired);
    } catch {
      writeLocalCheckpoint(run);
    }
    options.onProgress?.({
      run,
      event: failed,
      completedOperations,
      totalOperations,
    });
    throw error;
  }
}
