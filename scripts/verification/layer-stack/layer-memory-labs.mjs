import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LAYER_STACK_MAXIMUM } from "../../../src/layer-stack.ts";
import { LAYER_STORAGE_TILE_COUNT } from "../../../src/layer-storage-study.ts";
import { readRepositorySource } from "../source-contract.mjs";

const mainSource = readRepositorySource("src/main.ts");
const labsStartupSource = readRepositorySource("src/labs/startup.ts");
const editorLabsSource = readRepositorySource("src/labs/editor-labs.ts");
const labOperationsSource = readRepositorySource("src/labs/engine-lab-operations.ts");

// The production-query stress fixture must be explicit, isolated and leave the
// ordinary layer controls available after it has built real ~1 GiB residency.
const layerMemoryStressSource = readFileSync(
  new URL("../../../src/labs/memory/layer-memory-stress-test.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(mainSource, /layerMemoryStressTestRequested|runLayerMemoryStressTest/);
assert.match(labsStartupSource, /layerMemoryStressTestEnabled: true/);
assert.match(editorLabsSource, /\["memory-stress", "Stress memoria livelli"\]/);
assert.match(editorLabsSource, /import\("\.\/memory\/layer-memory-stress-test"\)/);
assert.match(labOperationsSource, /async function seedActiveLayerMemoryStress\([\s\S]*?storageTileCount = LAYER_STORAGE_TILE_COUNT/);
const memoryStressSeedStart = labOperationsSource.indexOf("export async function seedActiveLayerMemoryStress(");
const memoryStressSeedBody = labOperationsSource.slice(memoryStressSeedStart, memoryStressSeedStart + 4_000);
assert.match(memoryStressSeedBody, /engine\.layerMemoryStressTestEnabled/);
assert.match(memoryStressSeedBody, /const markerSize = 64/);
assert.match(memoryStressSeedBody, /storageTileMask\.fill\(0\)/);
assert.match(memoryStressSeedBody, /markStorageTile\(markerTileIndex\)/);
assert.match(layerMemoryStressSource, /LAYER_MEMORY_STRESS_TARGET_MIB = 1000/);
assert.match(layerMemoryStressSource, /initial\.layerCount !== 1/);
assert.match(layerMemoryStressSource, /layer\.coldTileCount !== 256/);
assert.match(layerMemoryStressSource, /layer\.conservativeTileCount !== 256/);
assert.match(layerMemoryStressSource, /manualSwitchReady: true/);

// The iPhone fixture advances in real cold-tile increments and writes a remote
// checkpoint before each allocation/switch. A restored page converts the last
// pending attempt into an interrupted result, so the user never has to copy it.
const iphoneMemoryLimitSource = readFileSync(
  new URL("../../../src/labs/memory/iphone-memory-limit-test.ts", import.meta.url),
  "utf8",
);
const sitesBuildSource = readFileSync(
  new URL("../../../scripts/prepare-sites-build.mjs", import.meta.url),
  "utf8",
);
const iphoneMemoryMigrationSource = readFileSync(
  new URL("../../../.openai/drizzle/0003_iphone_memory_limit_runs.sql", import.meta.url),
  "utf8",
);
assert.match(iphoneMemoryLimitSource,
  /iphone-rgba16f-gpu-plus-compressed-cpu-peaks-v3/);
assert.match(sitesBuildSource, /iphone-rgba16f-gpu-plus-compressed-cpu-peaks-v3/);
assert.match(
  iphoneMemoryLimitSource,
  /TILE_MEMORY_MIB_RGBA16F\s*=\s*\n?\s*LAYER_STORAGE_TILE_WIDTH \* LAYER_STORAGE_TILE_HEIGHT\s*\* RGBA16F_BYTES_PER_PIXEL \/ MEBIBYTE_BYTES;/,
);
assert.doesNotMatch(
  iphoneMemoryLimitSource,
  /LAYER_STORAGE_TILE_SIZE \*\* 2/,
  "il piano memoria iPhone non deve sovrastimare i tile rettangolari come quadrati",
);
assert.match(iphoneMemoryLimitSource, /initialStats\.layerFormat !== "rgba16float"/);
assert.match(iphoneMemoryLimitSource, /countedGpuPlusCompressedCpuMiB/);
assert.match(iphoneMemoryLimitSource, /peakCountedGpuPlusCompressedCpuMiB/);
assert.match(
  iphoneMemoryLimitSource,
  /variant: \{[\s\S]*?layerColdCompressionEnabled: stats\.layerColdCompressionEnabled[\s\S]*?layerColdCompressionRuntimeBuild: stats\.layerColdCompressionRuntimeBuild[\s\S]*?layerColdDirectHotHydrationEnabled:[\s\S]*?stats\.layerColdDirectHotHydrationEnabled[\s\S]*?layerColdAdjacentPrefetchEnabled:[\s\S]*?stats\.layerColdAdjacentPrefetchEnabled/,
  "ogni run iPhone deve firmare la variante lifecycle per impedire aggregazioni spurie",
);
const iphoneStoragePlanMatch = iphoneMemoryLimitSource.match(
  /IPHONE_MEMORY_LIMIT_STORAGE_TILE_PLAN = Object\.freeze\(\[([\s\S]*?)\]\)/,
);
assert.ok(iphoneStoragePlanMatch);
const iphoneStorageTilePlan = [...iphoneStoragePlanMatch[1].matchAll(/\d+/g)]
  .map((match) => Number(match[0]));
assert.equal(iphoneStorageTilePlan.length, LAYER_STACK_MAXIMUM - 1);
assert.equal(
  iphoneStorageTilePlan.reduce((sum, tileCount) => sum + tileCount, 0),
  3_328,
);
assert.ok(iphoneStorageTilePlan.every(
  (tileCount) => Number.isInteger(tileCount) && tileCount > 0 && tileCount <= 256,
));
assert.doesNotMatch(mainSource, /iphoneMemoryLimitTest|recoverInterruptedIphoneMemoryLimitRun/);
assert.match(editorLabsSource, /\["iphone-memory", "Ricerca limite iPhone"\]/);
assert.match(editorLabsSource, /recoverInterruptedIphoneMemoryLimitRun/);
assert.match(editorLabsSource, /serverRequired,/);
assert.match(iphoneMemoryLimitSource, /LOCAL_STORAGE_KEY/);
assert.match(iphoneMemoryLimitSource, /publishRunIdToHash\(run\.runId\)/);
assert.match(iphoneMemoryLimitSource, /recoverInterruptedIphoneMemoryLimitRun/);
assert.match(iphoneMemoryLimitSource, /kind: "interrupted"/);
assert.match(iphoneMemoryLimitSource, /\n\s+"switch-middle",/);
assert.match(iphoneMemoryLimitSource, /\n\s+"switch-top",/);
const firstIphoneAttempt = iphoneMemoryLimitSource.indexOf('kind: "attempt"');
const firstIphoneCheckpoint = iphoneMemoryLimitSource.indexOf(
  "await postCheckpoint(run, serverRequired)",
  firstIphoneAttempt,
);
const firstIphoneAllocation = iphoneMemoryLimitSource.indexOf(
  "await seedActiveLayerMemoryStress(engine, planIndex, storageTileCount)",
  firstIphoneAttempt,
);
assert.ok(firstIphoneAttempt >= 0 && firstIphoneCheckpoint > firstIphoneAttempt);
assert.ok(firstIphoneAllocation > firstIphoneCheckpoint);
assert.match(sitesBuildSource, /handleIphoneMemoryLimitRuns/);
assert.match(sitesBuildSource, /\/api\/iphone-memory-limit-runs/);
assert.match(sitesBuildSource, /ON CONFLICT\(id\) DO UPDATE/);
assert.match(iphoneMemoryMigrationSource, /CREATE TABLE IF NOT EXISTS iphone_memory_limit_runs/);
