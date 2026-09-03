import {
  DIRTY_REGION_TILE_SIZES,
  buildDirtyAabb,
  buildDirtyTileBands,
  buildMipRegionPlan,
  compareDirtyRegionCoverage,
  type DirtyRegionCoverage,
  type DirtyRegionMipPlan,
  type DirtyRegionRect,
} from "./dirty-region-lab-model";
import {
  loadHumanDirtyRegionWorkload,
  type HumanDirtyRegionFrame,
  type HumanDirtyRegionWorkload,
} from "./dirty-region-human-workload";

const REPORT_VERSION = 2;
const TARGET_SIZE = 2048;
const DEFAULT_MAXIMUM_MIP_LEVEL = 2;
const WARMUP_RUNS = 1;
const MEASURED_RUNS = 7;
const CPU_WORKLOAD_REPETITIONS = 3;
const CPU_MEASURED_RUNS = 7;

type StrategyId = "aabb" | `tiles-${number}`;

interface TimingSummary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly minimumMs: number;
  readonly maximumMs: number;
  readonly samplesMs: readonly number[];
}

interface GpuTimingSample {
  readonly cpuEncodeMs: number;
  readonly queueCompletionMs: number;
  readonly totalMs: number;
  readonly liveGpuTimestampMs: number | null;
  readonly commitGpuTimestampMs: number | null;
  readonly gpuTimestampMs: number | null;
}

interface GpuTimingSummary {
  readonly cpuEncode: TimingSummary;
  readonly queueCompletion: TimingSummary;
  readonly total: TimingSummary;
  readonly liveGpuTimestamp: TimingSummary | null;
  readonly commitGpuTimestamp: TimingSummary | null;
  readonly gpuTimestamp: TimingSummary | null;
  readonly raw: readonly GpuTimingSample[];
}

interface PreparedFrame {
  readonly regions: readonly DirtyRegionRect[];
  readonly plan: DirtyRegionMipPlan;
  readonly coverage: DirtyRegionCoverage;
}

interface PreparedStrategy {
  readonly id: StrategyId;
  readonly label: string;
  readonly tileSize: number | null;
  readonly frames: readonly PreparedFrame[];
  readonly commit: PreparedFrame;
  readonly cpuBuild: TimingSummary;
  readonly livePixels: number;
  readonly commitPixels: number;
  readonly totalPixels: number;
  readonly liveDraws: number;
  readonly commitDraws: number;
  readonly totalDraws: number;
  readonly missedPixels: number;
  gpu?: GpuTimingSummary;
}

interface DirtyRegionGpuRenderer {
  run(livePlans: readonly DirtyRegionMipPlan[], commitPlan: DirtyRegionMipPlan):
    Promise<GpuTimingSample>;
  destroy(): void;
}

export interface DirtyRegionLabProgress {
  readonly completed: number;
  readonly total: number;
  readonly message: string;
}

export interface DirtyRegionLabOptions {
  readonly onProgress?: (progress: DirtyRegionLabProgress) => void;
}

interface StrategyDefinition {
  readonly id: StrategyId;
  readonly label: string;
  readonly tileSize: number | null;
}

const STRATEGIES: readonly StrategyDefinition[] = [
  { id: "aabb", label: "AABB unico", tileSize: null },
  ...DIRTY_REGION_TILE_SIZES.map((tileSize) => ({
    id: `tiles-${tileSize}` as const,
    label: `Tile ${tileSize}px fuse`,
    tileSize,
  })),
];

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function timingSummary(samples: readonly number[]): TimingSummary {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    minimumMs: sorted[0] ?? 0,
    maximumMs: sorted.at(-1) ?? 0,
    samplesMs: [...samples],
  };
}

function optionalTimingSummary(samples: readonly (number | null)[]): TimingSummary | null {
  const present = samples.filter((sample): sample is number => sample !== null);
  return present.length === samples.length ? timingSummary(present) : null;
}

function summarizeGpu(samples: readonly GpuTimingSample[]): GpuTimingSummary {
  return {
    cpuEncode: timingSummary(samples.map((sample) => sample.cpuEncodeMs)),
    queueCompletion: timingSummary(samples.map((sample) => sample.queueCompletionMs)),
    total: timingSummary(samples.map((sample) => sample.totalMs)),
    liveGpuTimestamp: optionalTimingSummary(samples.map((sample) => sample.liveGpuTimestampMs)),
    commitGpuTimestamp: optionalTimingSummary(
      samples.map((sample) => sample.commitGpuTimestampMs),
    ),
    gpuTimestamp: optionalTimingSummary(samples.map((sample) => sample.gpuTimestampMs)),
    raw: [...samples],
  };
}

function percentSaved(baseline: number, candidate: number): number | null {
  return baseline > 0 ? (baseline - candidate) / baseline * 100 : null;
}

function primaryGpuMs(strategy: PreparedStrategy): number {
  return strategy.gpu!.gpuTimestamp?.medianMs ?? strategy.gpu!.total.medianMs;
}

function maximumMipLevelFromUrl(): number {
  const requested = Number(new URLSearchParams(location.search).get("dirtyMip"));
  return Number.isInteger(requested) && requested >= 0 && requested <= 4
    ? requested
    : DEFAULT_MAXIMUM_MIP_LEVEL;
}

function regionsFor(
  definition: StrategyDefinition,
  footprints: readonly DirtyRegionRect[],
  width: number,
  height: number,
): readonly DirtyRegionRect[] {
  return definition.tileSize === null
    ? buildDirtyAabb(footprints, width, height)
    : buildDirtyTileBands(footprints, width, height, definition.tileSize);
}

function prepareFrame(
  definition: StrategyDefinition,
  footprints: readonly DirtyRegionRect[],
  width: number,
  height: number,
  maximumMipLevel: number,
): PreparedFrame {
  const regions = regionsFor(definition, footprints, width, height);
  return {
    regions,
    plan: buildMipRegionPlan(regions, width, height, maximumMipLevel),
    coverage: compareDirtyRegionCoverage(footprints, regions, width, height),
  };
}

function executeCpuWorkload(
  definition: StrategyDefinition,
  workload: HumanDirtyRegionWorkload,
  maximumMipLevel: number,
): number {
  let checksum = 0;
  const consume = (footprints: readonly DirtyRegionRect[]): void => {
    const plan = buildMipRegionPlan(
      regionsFor(
        definition,
        footprints,
        workload.targetWidth,
        workload.targetHeight,
      ),
      workload.targetWidth,
      workload.targetHeight,
      maximumMipLevel,
    );
    checksum += plan.totalPixels + plan.totalDraws;
  };
  for (const frame of workload.frames) consume(frame.footprints);
  consume(workload.footprints);
  return checksum;
}

function benchmarkCpuPlanner(
  definition: StrategyDefinition,
  workload: HumanDirtyRegionWorkload,
  maximumMipLevel: number,
): TimingSummary {
  let checksum = executeCpuWorkload(definition, workload, maximumMipLevel);
  const samples: number[] = [];
  for (let run = 0; run < CPU_MEASURED_RUNS; run += 1) {
    const startedAt = performance.now();
    for (let repetition = 0; repetition < CPU_WORKLOAD_REPETITIONS; repetition += 1) {
      checksum += executeCpuWorkload(definition, workload, maximumMipLevel);
    }
    samples.push((performance.now() - startedAt) / CPU_WORKLOAD_REPETITIONS);
  }
  if (!Number.isFinite(checksum) || checksum <= 0) {
    throw new Error("Dirty-region CPU benchmark produced no observable result.");
  }
  return timingSummary(samples);
}

function prepareStrategy(
  definition: StrategyDefinition,
  workload: HumanDirtyRegionWorkload,
  maximumMipLevel: number,
): PreparedStrategy {
  const frames = workload.frames.map((frame) => prepareFrame(
    definition,
    frame.footprints,
    workload.targetWidth,
    workload.targetHeight,
    maximumMipLevel,
  ));
  const commit = prepareFrame(
    definition,
    workload.footprints,
    workload.targetWidth,
    workload.targetHeight,
    maximumMipLevel,
  );
  const livePixels = frames.reduce((sum, frame) => sum + frame.plan.totalPixels, 0);
  const liveDraws = frames.reduce((sum, frame) => sum + frame.plan.totalDraws, 0);
  return {
    id: definition.id,
    label: definition.label,
    tileSize: definition.tileSize,
    frames,
    commit,
    cpuBuild: benchmarkCpuPlanner(definition, workload, maximumMipLevel),
    livePixels,
    commitPixels: commit.plan.totalPixels,
    totalPixels: livePixels + commit.plan.totalPixels,
    liveDraws,
    commitDraws: commit.plan.totalDraws,
    totalDraws: liveDraws + commit.plan.totalDraws,
    missedPixels: frames.reduce((sum, frame) => sum + frame.coverage.missedPixels, 0)
      + commit.coverage.missedPixels,
  };
}

const REGION_SHADER = /* wgsl */ `
struct VertexOutput { @builtin(position) position: vec4<f32> };

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

fn safeLoad(coordinate: vec2<i32>) -> vec4<f32> {
  let dimensions = vec2<i32>(textureDimensions(sourceTexture));
  return textureLoad(
    sourceTexture,
    clamp(coordinate, vec2<i32>(0), dimensions - vec2<i32>(1)),
    0,
  );
}

@fragment
fn compositeMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let color = safeLoad(vec2<i32>(input.position.xy));
  return vec4<f32>(color.rgb * 0.997 + vec3<f32>(0.001), max(color.a, 0.001));
}

@fragment
fn downsampleMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let base = vec2<i32>(input.position.xy) * 2;
  return (safeLoad(base) + safeLoad(base + vec2<i32>(1, 0))
    + safeLoad(base + vec2<i32>(0, 1)) + safeLoad(base + vec2<i32>(1, 1))) * 0.25;
}
`;

async function createGpuRenderer(
  device: GPUDevice,
  size: number,
  maximumMipLevel: number,
): Promise<DirtyRegionGpuRenderer> {
  const format: GPUTextureFormat = "rgba8unorm";
  const module = device.createShaderModule({
    label: "Dirty-region human-workload shader",
    code: REGION_SHADER,
  });
  const pipeline = async (entryPoint: "compositeMain" | "downsampleMain") => (
    device.createRenderPipelineAsync({
      label: `Dirty-region human-workload ${entryPoint}`,
      layout: "auto",
      vertex: { module, entryPoint: "vertexMain" },
      fragment: { module, entryPoint, targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    })
  );
  const [compositePipeline, downsamplePipeline] = await Promise.all([
    pipeline("compositeMain"),
    pipeline("downsampleMain"),
  ]);
  const source = device.createTexture({
    label: "Dirty-region human-workload source",
    size: [size, size],
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
  const target = device.createTexture({
    label: "Dirty-region human-workload target",
    size: [size, size],
    mipLevelCount: maximumMipLevel + 1,
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const views = Array.from({ length: maximumMipLevel + 1 }, (_, level) => (
    target.createView({ baseMipLevel: level, mipLevelCount: 1 })
  ));
  const compositeBindGroup = device.createBindGroup({
    layout: compositePipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: source.createView() }],
  });
  const downsampleBindGroups = Array.from({ length: maximumMipLevel }, (_, level) => (
    device.createBindGroup({
      layout: downsamplePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: views[level] }],
    })
  ));
  const querySet = device.features.has("timestamp-query")
    ? device.createQuerySet({ type: "timestamp", count: 4 })
    : null;
  const resolveBuffer = querySet
    ? device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      })
    : null;
  const readbackBuffer = querySet
    ? device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
    : null;

  const encode = (
    livePlans: readonly DirtyRegionMipPlan[],
    commitPlan: DirtyRegionMipPlan,
  ): GPUCommandBuffer => {
    const encoder = device.createCommandEncoder();
    const plans = [...livePlans, commitPlan];
    const livePasses = livePlans.reduce((sum, plan) => sum + plan.levels.length, 0);
    const totalPasses = livePasses + commitPlan.levels.length;
    let passIndex = 0;
    for (const plan of plans) {
      for (const level of plan.levels) {
        const firstLive = passIndex === 0;
        const lastLive = passIndex === livePasses - 1;
        const firstCommit = passIndex === livePasses;
        const lastCommit = passIndex === totalPasses - 1;
        const timestamp = querySet && (firstLive || lastLive || firstCommit || lastCommit);
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: views[level.level], loadOp: "load", storeOp: "store" }],
          ...(timestamp ? {
            timestampWrites: {
              querySet,
              ...(firstLive ? { beginningOfPassWriteIndex: 0 } : {}),
              ...(lastLive ? { endOfPassWriteIndex: 1 } : {}),
              ...(firstCommit ? { beginningOfPassWriteIndex: 2 } : {}),
              ...(lastCommit ? { endOfPassWriteIndex: 3 } : {}),
            },
          } : {}),
        });
        if (level.level === 0) {
          pass.setPipeline(compositePipeline);
          pass.setBindGroup(0, compositeBindGroup);
        } else {
          pass.setPipeline(downsamplePipeline);
          pass.setBindGroup(0, downsampleBindGroups[level.level - 1]);
        }
        for (const region of level.regions) {
          pass.setScissorRect(region.x, region.y, region.width, region.height);
          pass.draw(3);
        }
        pass.end();
        passIndex += 1;
      }
    }
    if (querySet && resolveBuffer && readbackBuffer) {
      encoder.resolveQuerySet(querySet, 0, 4, resolveBuffer, 0);
      encoder.copyBufferToBuffer(resolveBuffer, 0, readbackBuffer, 0, 32);
    }
    return encoder.finish();
  };

  return {
    async run(livePlans, commitPlan) {
      await device.queue.onSubmittedWorkDone();
      const startedAt = performance.now();
      const command = encode(livePlans, commitPlan);
      const encodedAt = performance.now();
      device.queue.submit([command]);
      const submittedAt = performance.now();
      await device.queue.onSubmittedWorkDone();
      const completedAt = performance.now();
      let liveGpuTimestampMs: number | null = null;
      let commitGpuTimestampMs: number | null = null;
      if (readbackBuffer) {
        await readbackBuffer.mapAsync(GPUMapMode.READ);
        const timestamp = new BigUint64Array(readbackBuffer.getMappedRange());
        liveGpuTimestampMs = timestamp[1] >= timestamp[0]
          ? Number(timestamp[1] - timestamp[0]) / 1_000_000
          : 0;
        commitGpuTimestampMs = timestamp[3] >= timestamp[2]
          ? Number(timestamp[3] - timestamp[2]) / 1_000_000
          : 0;
        readbackBuffer.unmap();
      }
      return {
        cpuEncodeMs: encodedAt - startedAt,
        queueCompletionMs: completedAt - submittedAt,
        totalMs: completedAt - startedAt,
        liveGpuTimestampMs,
        commitGpuTimestampMs,
        gpuTimestampMs: liveGpuTimestampMs === null || commitGpuTimestampMs === null
          ? null
          : liveGpuTimestampMs + commitGpuTimestampMs,
      };
    },
    destroy() {
      readbackBuffer?.destroy();
      resolveBuffer?.destroy();
      querySet?.destroy();
      source.destroy();
      target.destroy();
    },
  };
}

async function measureStrategies(
  renderer: DirtyRegionGpuRenderer,
  strategies: readonly PreparedStrategy[],
  onProgress: DirtyRegionLabOptions["onProgress"],
): Promise<void> {
  const total = strategies.length * (WARMUP_RUNS + MEASURED_RUNS);
  let completed = 0;
  const run = (strategy: PreparedStrategy) => renderer.run(
    strategy.frames.map((frame) => frame.plan),
    strategy.commit.plan,
  );
  for (const strategy of strategies) {
    await run(strategy);
    completed += 1;
    onProgress?.({ completed, total, message: `Tratto umano · warmup ${strategy.label}` });
  }
  const samples = new Map<StrategyId, GpuTimingSample[]>();
  for (const strategy of strategies) samples.set(strategy.id, []);
  for (let measured = 0; measured < MEASURED_RUNS; measured += 1) {
    const order = measured % 2 === 0 ? strategies : [...strategies].reverse();
    for (const strategy of order) {
      samples.get(strategy.id)!.push(await run(strategy));
      completed += 1;
      onProgress?.({
        completed,
        total,
        message: `Tratto umano · ${strategy.label} · ${measured + 1}/${MEASURED_RUNS}`,
      });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }
  for (const strategy of strategies) strategy.gpu = summarizeGpu(samples.get(strategy.id)!);
}

function strategyById(strategies: readonly PreparedStrategy[], id: StrategyId): PreparedStrategy {
  const result = strategies.find((strategy) => strategy.id === id);
  if (!result) throw new Error(`Missing dirty-region strategy ${id}.`);
  return result;
}

function bestStrategy(
  strategies: readonly PreparedStrategy[],
  includeBaseline: boolean,
): PreparedStrategy {
  const candidates = includeBaseline
    ? strategies
    : strategies.filter((strategy) => strategy.id !== "aabb");
  const result = [...candidates].sort((left, right) => primaryGpuMs(left) - primaryGpuMs(right))[0];
  if (!result) throw new Error("No measured dirty-region strategy is available.");
  return result;
}

function formatMs(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(value < 1 ? 3 : 2)} ms`;
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatRelativeCost(baseline: number, candidate: number): string {
  if (baseline <= 0) return "—";
  const delta = (candidate - baseline) / baseline * 100;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`;
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("it-IT");
}

function appendCell(row: HTMLTableRowElement, value: string, heading = false): void {
  const cell = document.createElement(heading ? "th" : "td");
  cell.textContent = value;
  row.append(cell);
}

function drawPreview(
  canvas: HTMLCanvasElement,
  workload: HumanDirtyRegionWorkload,
  humanFrame: HumanDirtyRegionFrame | null,
  prepared: PreparedFrame,
  candidate: boolean,
): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const scaleX = canvas.width / workload.targetWidth;
  const scaleY = canvas.height / workload.targetHeight;
  context.fillStyle = "#0b111a";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.beginPath();
  workload.points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x * scaleX, point.y * scaleY);
    else context.lineTo(point.x * scaleX, point.y * scaleY);
  });
  context.strokeStyle = "#71819890";
  context.lineWidth = 1.5;
  context.stroke();
  context.fillStyle = candidate ? "#67df9f24" : "#ff6f6f24";
  context.strokeStyle = candidate ? "#67df9f" : "#ff8181";
  context.setLineDash(candidate ? [] : [5, 4]);
  for (const rect of prepared.regions) {
    context.fillRect(rect.x * scaleX, rect.y * scaleY, rect.width * scaleX, rect.height * scaleY);
    context.strokeRect(rect.x * scaleX, rect.y * scaleY, rect.width * scaleX, rect.height * scaleY);
  }
  context.setLineDash([]);
  context.strokeStyle = "#72d7ff70";
  context.lineWidth = 0.6;
  for (const rect of humanFrame?.footprints ?? workload.footprints) {
    context.strokeRect(
      rect.x * scaleX,
      rect.y * scaleY,
      Math.max(0.5, rect.width * scaleX),
      Math.max(0.5, rect.height * scaleY),
    );
  }
  if (humanFrame) {
    const point = workload.points[Math.min(humanFrame.index, workload.points.length - 1)];
    context.beginPath();
    context.arc(point.x * scaleX, point.y * scaleY, 4, 0, Math.PI * 2);
    context.fillStyle = "white";
    context.fill();
  }
}

function renderPresentation(
  workload: HumanDirtyRegionWorkload,
  strategies: readonly PreparedStrategy[],
  maximumMipLevel: number,
): void {
  const previous = document.querySelector("[data-dirty-region-lab-presentation]");
  if (previous instanceof HTMLDialogElement && previous.open) previous.close();
  previous?.remove();
  const baseline = strategyById(strategies, "aabb");
  const tile = bestStrategy(strategies, false);
  const winner = bestStrategy(strategies, true);
  const gpuSaving = percentSaved(primaryGpuMs(baseline), primaryGpuMs(tile));
  const referenceText = workload.recordedReferenceMatches === null
    ? "Timeline originale non disponibile."
    : workload.recordedReferenceMatches
      ? "Stamp, frame, batch e massimo per frame coincidono con la registrazione."
      : "La rigenerazione NON coincide con la registrazione.";

  const panel = document.createElement("dialog");
  panel.className = "dirty-region-lab-presentation";
  panel.dataset.dirtyRegionLabPresentation = "";
  panel.innerHTML = `
    <header>
      <div>
        <p class="dirty-region-lab-kicker">REPLAY UMANO · ${workload.targetWidth}×${workload.targetHeight} · MIP 0–${maximumMipLevel}</p>
        <h2 id="dirty-region-lab-title">Dirty regions sul tratto realmente registrato</h2>
      </div>
      <button type="button" data-close>Chiudi risultati</button>
    </header>
    <p class="dirty-region-lab-intro"></p>
    <p class="dirty-region-lab-scope"></p>
    <div class="dirty-region-lab-cards"></div>
    <h3>Intero gesto: frame durante il disegno + commit finale</h3>
    <div class="dirty-region-lab-table-scroll"><table><thead><tr></tr></thead><tbody></tbody></table></div>
    <h3>Guarda cosa viene ridisegnato, frame per frame</h3>
    <p class="dirty-region-lab-legend">Linea grigia: gesto completo · azzurro: bounds degli stamp · rosso: AABB · verde: tile fuse.</p>
    <div class="dirty-region-lab-scrubber"><input type="range" min="0" max="${workload.frames.length}" step="1" aria-label="Frame del tratto umano"><output></output></div>
    <div class="dirty-region-lab-preview-grid dirty-region-lab-preview-comparison">
      <figure><figcaption>${baseline.label}</figcaption><canvas width="420" height="420"></canvas></figure>
      <figure><figcaption>${tile.label}</figcaption><canvas width="420" height="420"></canvas></figure>
    </div>
    <p class="dirty-region-lab-scope" data-coverage></p>
  `;
  panel.setAttribute("aria-labelledby", "dirty-region-lab-title");
  const close = panel.querySelector("[data-close]") as HTMLButtonElement;
  close.addEventListener("click", () => panel.close());
  panel.addEventListener("close", () => panel.remove(), { once: true });
  const intro = panel.querySelector(".dirty-region-lab-intro") as HTMLParagraphElement;
  intro.textContent = winner.id === "aabb"
    ? `Sul gesto completo l'AABB resta più rapido. ${tile.label} esegue ${formatRelativeCost(baseline.totalPixels, tile.totalPixels)} pixel-pass e impiega ${formatRelativeCost(primaryGpuMs(baseline), primaryGpuMs(tile))} tempo GPU: la quantizzazione delle tile allarga i piccoli aggiornamenti live.`
    : `${winner.label} vince sul gesto completo: ${formatPercent(gpuSaving)} sul timestamp GPU rispetto all'AABB.`;
  const scope = panel.querySelector(".dirty-region-lab-scope") as HTMLParagraphElement;
  scope.textContent = `Il generatore WebAssembly ha ricostruito ${formatInteger(workload.baseStampCount)} stamp in ${workload.frames.length} batch dalla traccia salvata. ${referenceText} Il probe misura compositing e mip ritagliati; non modifica ancora il renderer principale e non include il deposito degli stamp.`;
  const cards = panel.querySelector(".dirty-region-lab-cards") as HTMLDivElement;
  for (const [label, value] of [
    ["Carico ricostruito", `${workload.frames.length} frame · ${formatInteger(workload.baseStampCount)} stamp`],
    ["Candidato tile", tile.label],
    ["Δ pixel-pass vs AABB", formatRelativeCost(baseline.totalPixels, tile.totalPixels)],
    ["Δ tempo GPU vs AABB", formatRelativeCost(primaryGpuMs(baseline), primaryGpuMs(tile))],
  ]) {
    const card = document.createElement("article");
    const caption = document.createElement("span");
    const strong = document.createElement("strong");
    caption.textContent = label;
    strong.textContent = value;
    card.append(caption, strong);
    cards.append(card);
  }
  const headerRow = panel.querySelector("thead tr") as HTMLTableRowElement;
  for (const value of [
    "Strategia", "Pixel live", "Pixel commit", "Draw", "Planner CPU",
    "GPU live", "GPU commit", "GPU totale", "Encode→fine coda",
  ]) appendCell(headerRow, value, true);
  const body = panel.querySelector("tbody") as HTMLTableSectionElement;
  for (const strategy of strategies) {
    const row = document.createElement("tr");
    for (const [index, value] of [
      strategy.label,
      formatInteger(strategy.livePixels),
      formatInteger(strategy.commitPixels),
      formatInteger(strategy.totalDraws),
      formatMs(strategy.cpuBuild.medianMs),
      formatMs(strategy.gpu!.liveGpuTimestamp?.medianMs ?? null),
      formatMs(strategy.gpu!.commitGpuTimestamp?.medianMs ?? null),
      formatMs(primaryGpuMs(strategy)),
      formatMs(strategy.gpu!.total.medianMs),
    ].entries()) appendCell(row, value, index === 0);
    body.append(row);
  }
  const slider = panel.querySelector("input[type=range]") as HTMLInputElement;
  const output = panel.querySelector("output") as HTMLOutputElement;
  const canvases = panel.querySelectorAll("canvas");
  slider.value = String(Math.min(80, workload.frames.length - 1));
  const update = (): void => {
    const index = Number(slider.value);
    const commit = index === workload.frames.length;
    const humanFrame = commit ? null : workload.frames[index];
    const baselineFrame = commit ? baseline.commit : baseline.frames[index];
    const tileFrame = commit ? tile.commit : tile.frames[index];
    drawPreview(canvases[0], workload, humanFrame, baselineFrame, false);
    drawPreview(canvases[1], workload, humanFrame, tileFrame, true);
    if (commit || !humanFrame) {
      output.textContent = `Commit finale · ${formatInteger(workload.baseStampCount)} stamp · AABB ${formatInteger(baselineFrame.plan.totalPixels)} pixel-pass · ${tile.label} ${formatInteger(tileFrame.plan.totalPixels)}`;
    } else {
      output.textContent = `Frame ${index + 1}/${workload.frames.length} · ${humanFrame.stampCount} stamp · t=${humanFrame.inputTimeMs.toFixed(1)} ms · AABB ${formatInteger(baselineFrame.plan.totalPixels)} pixel-pass · ${tile.label} ${formatInteger(tileFrame.plan.totalPixels)}`;
    }
  };
  slider.addEventListener("input", update);
  update();
  const coverage = panel.querySelector("[data-coverage]") as HTMLParagraphElement;
  coverage.textContent = `Copertura conservativa: ${strategies.every((strategy) => strategy.missedPixels === 0) ? "0 pixel dello stroke saltati" : "ERRORE"}. Δ wall time ${tile.label} rispetto all'AABB: ${formatRelativeCost(baseline.gpu!.total.medianMs, tile.gpu!.total.medianMs)}.`;
  document.body.append(panel);
  panel.showModal();
  close.focus({ preventScroll: true });
}

export async function runDirtyRegionPerformanceLab(
  device: GPUDevice,
  options: DirtyRegionLabOptions = {},
): Promise<unknown> {
  const size = Math.min(TARGET_SIZE, device.limits.maxTextureDimension2D);
  if (size < 512) throw new Error("The GPU texture limit is too small for this lab.");
  const maximumMipLevel = Math.min(maximumMipLevelFromUrl(), Math.floor(Math.log2(size)));
  options.onProgress?.({ completed: 0, total: 1, message: "Rigenerazione del tratto umano…" });
  const workload = await loadHumanDirtyRegionWorkload(size, size);
  options.onProgress?.({ completed: 0, total: 1, message: "Preparazione delle regioni temporali…" });
  const strategies = STRATEGIES.map((definition) => (
    prepareStrategy(definition, workload, maximumMipLevel)
  ));

  device.pushErrorScope("validation");
  let renderer: DirtyRegionGpuRenderer | null = null;
  let executionError: unknown = null;
  try {
    renderer = await createGpuRenderer(device, size, maximumMipLevel);
    await measureStrategies(renderer, strategies, options.onProgress);
  } catch (error) {
    executionError = error;
  } finally {
    renderer?.destroy();
  }
  const validationError = await device.popErrorScope();
  if (executionError) throw executionError;
  if (validationError) throw validationError;

  const baseline = strategyById(strategies, "aabb");
  const tile = bestStrategy(strategies, false);
  const winner = bestStrategy(strategies, true);
  const coveragePassed = strategies.every((strategy) => strategy.missedPixels === 0);
  const referencePassed = workload.recordedReferenceMatches !== false;
  let presentationError: string | null = null;
  try {
    renderPresentation(workload, strategies, maximumMipLevel);
  } catch (error) {
    presentationError = error instanceof Error ? error.message : String(error);
  }

  return {
    lab: "dirty-region-performance-ab",
    version: REPORT_VERSION,
    passed: coveragePassed && referencePassed,
    productionClaim: false,
    target: {
      width: size,
      height: size,
      maximumMipLevel,
      captureExtent: workload.captureExtent,
      coordinateScale: workload.coordinateScale,
    },
    trace: {
      source: workload.source,
      capturedAt: workload.capturedAt,
      fingerprint: workload.fingerprint,
      pointCount: workload.capturePointCount,
      durationMs: workload.captureDurationMs,
      frameCount: workload.frames.length,
      baseStamps: workload.baseStampCount,
      physicalCopies: workload.physicalCopyCount,
      largestFrameStamps: workload.largestFrameStampCount,
      releaseStamps: workload.releaseStampCount,
      recordedReference: workload.recordedReference,
      recordedReferenceMatches: workload.recordedReferenceMatches,
    },
    methodology: {
      workload: "The saved human input trace is regenerated by the packed WebAssembly stroke kernel. Each recorded input sample remains a live frame, followed by one whole-stroke commit.",
      gpuWork: "Each frame runs one base composite and progressive four-tap downsample passes. Shaders, textures and pass count stay identical; only scissor regions and draw count change.",
      baseline: "One conservative union AABB per live frame and for the final commit.",
      candidate: "Touched power-of-two tiles converted into disjoint horizontal runs, with vertically identical runs fused.",
      correctness: "Every frame and the commit are checked against the exact union of conservative bounds decoded from generated 32-byte stamp records. Zero missed pixels is required.",
      scope: "Isolated probe of region planning and composite/mip scheduling; it does not modify the production renderer and excludes stamp deposition.",
      warmupRunsPerStrategy: WARMUP_RUNS,
      measuredRunsPerStrategy: MEASURED_RUNS,
      cpuMeasuredRuns: CPU_MEASURED_RUNS,
      cpuWorkloadRepetitions: CPU_WORKLOAD_REPETITIONS,
      timestampQueryAvailable: device.features.has("timestamp-query"),
    },
    summary: {
      winner: winner.id,
      bestFixedTile: tile.id,
      bestFixedTilePixelSavedPercent: percentSaved(baseline.totalPixels, tile.totalPixels),
      bestFixedTileLivePixelSavedPercent: percentSaved(baseline.livePixels, tile.livePixels),
      bestFixedTileCommitPixelSavedPercent: percentSaved(
        baseline.commitPixels,
        tile.commitPixels,
      ),
      bestFixedTileGpuSavedPercent: percentSaved(primaryGpuMs(baseline), primaryGpuMs(tile)),
      bestFixedTileWallSavedPercent: percentSaved(
        baseline.gpu!.total.medianMs,
        tile.gpu!.total.medianMs,
      ),
      coveragePassed,
      recordedReferencePassed: referencePassed,
      presentationError,
    },
    strategies: strategies.map((strategy) => ({
      id: strategy.id,
      label: strategy.label,
      tileSize: strategy.tileSize,
      livePixels: strategy.livePixels,
      commitPixels: strategy.commitPixels,
      totalPixels: strategy.totalPixels,
      liveDraws: strategy.liveDraws,
      commitDraws: strategy.commitDraws,
      totalDraws: strategy.totalDraws,
      missedPixels: strategy.missedPixels,
      cpuBuild: strategy.cpuBuild,
      gpu: strategy.gpu,
      pixelSavedPercent: percentSaved(baseline.totalPixels, strategy.totalPixels),
      gpuSavedPercent: percentSaved(primaryGpuMs(baseline), primaryGpuMs(strategy)),
      wallSavedPercent: percentSaved(
        baseline.gpu!.total.medianMs,
        strategy.gpu!.total.medianMs,
      ),
    })),
  };
}
