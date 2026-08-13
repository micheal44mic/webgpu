import assert from "node:assert/strict";
import { HISTORY_RETENTION_STRATEGY } from "../src/history-retention-core.ts";

assert.equal(
  HISTORY_RETENTION_STRATEGY,
  "byte-budget-exact-tiled-checkpoints-idle-fenced-chunked-v1",
);

await import("./verification/history-retention/budget-and-storage.mjs");
await import("./verification/history-retention/long-session.mjs");
await import("./verification/history-retention/spill-planning.mjs");
await import("./verification/history-retention/accounting.mjs");
await import("./verification/history-retention/recovery-and-admission.mjs");
await import("./verification/history-retention/checkpoint-representation.mjs");
await import("./verification/history-retention/failure-surfacing.mjs");
await import("./verification/history-retention/rapid-input.mjs");
await import("./verification/history-retention/storage-protocol.mjs");
