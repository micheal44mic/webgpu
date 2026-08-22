export const STARTUP_TIMING_SCHEMA = "m1m4-startup-timing-v1" as const;

export type StartupTimingDetailValue = string | number | boolean | null;
export type StartupTimingDetail = Readonly<Record<string, StartupTimingDetailValue>>;
export type StartupTimingStatus = "running" | "ok" | "error";

export interface StartupTimingEntry {
  readonly sequence: number;
  readonly name: string;
  readonly startMs: number;
  readonly durationMs: number | null;
  readonly status: StartupTimingStatus;
  readonly detail: StartupTimingDetail | null;
}

export interface StartupTimingSnapshot {
  readonly schema: typeof STARTUP_TIMING_SCHEMA;
  readonly capturedAt: string;
  readonly elapsedMs: number;
  readonly entries: readonly StartupTimingEntry[];
}

export interface StartupTimingSpan {
  end(detail?: StartupTimingDetail | null): void;
  fail(error?: unknown, detail?: StartupTimingDetail | null): void;
}

const STARTUP_TIMING_ENTRY_LIMIT = 128;
const startedAt = timingNow();
const entries: Array<{
  sequence: number;
  name: string;
  startMs: number;
  durationMs: number | null;
  status: StartupTimingStatus;
  detail: StartupTimingDetail | null;
}> = [];
const once = new Set<string>();
let nextSequence = 1;

function timingNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function rounded(value: number): number {
  return Math.round(Math.max(0, value) * 10) / 10;
}

function normalizedName(name: string): string {
  const trimmed = name.trim();
  return (trimmed || "unnamed").slice(0, 160);
}

function normalizedDetail(detail?: StartupTimingDetail | null): StartupTimingDetail | null {
  if (!detail) return null;
  return Object.fromEntries(
    Object.entries(detail)
      .slice(0, 24)
      .map(([key, value]) => [
        key.slice(0, 80),
        typeof value === "string" ? value.slice(0, 240) : value,
      ]),
  );
}

function appendEntry(
  name: string,
  status: StartupTimingStatus,
  detail?: StartupTimingDetail | null,
): (typeof entries)[number] {
  const entry = {
    sequence: nextSequence,
    name: normalizedName(name),
    startMs: rounded(timingNow() - startedAt),
    durationMs: status === "running" ? null : 0,
    status,
    detail: normalizedDetail(detail),
  };
  nextSequence += 1;
  if (entries.length === STARTUP_TIMING_ENTRY_LIMIT) entries.shift();
  entries.push(entry);
  return entry;
}

function errorDetail(error: unknown): StartupTimingDetail {
  if (error instanceof Error) return { errorName: error.name || "Error" };
  return { errorName: typeof error };
}

export function markStartupTiming(
  name: string,
  detail?: StartupTimingDetail | null,
): void {
  appendEntry(name, "ok", detail);
}

export function markStartupTimingOnce(
  name: string,
  detail?: StartupTimingDetail | null,
): void {
  if (once.has(name)) return;
  once.add(name);
  markStartupTiming(name, detail);
}

export function beginStartupTiming(
  name: string,
  detail?: StartupTimingDetail | null,
): StartupTimingSpan {
  const entry = appendEntry(name, "running", detail);
  const absoluteStart = timingNow();
  let finished = false;
  const finish = (
    status: Exclude<StartupTimingStatus, "running">,
    finalDetail?: StartupTimingDetail | null,
  ): void => {
    if (finished) return;
    finished = true;
    entry.durationMs = rounded(timingNow() - absoluteStart);
    entry.status = status;
    entry.detail = normalizedDetail(finalDetail ?? detail);
  };
  return {
    end: (finalDetail) => finish("ok", finalDetail),
    fail: (error, finalDetail) => finish("error", {
      ...errorDetail(error),
      ...(finalDetail ?? detail ?? {}),
    }),
  };
}

export async function measureStartupTiming<Value>(
  name: string,
  task: () => Promise<Value>,
  detail?: StartupTimingDetail | null,
): Promise<Value> {
  const span = beginStartupTiming(name, detail);
  try {
    const value = await task();
    span.end(detail);
    return value;
  } catch (error) {
    span.fail(error, detail);
    throw error;
  }
}

export function captureStartupTiming(): StartupTimingSnapshot {
  return {
    schema: STARTUP_TIMING_SCHEMA,
    capturedAt: new Date().toISOString(),
    elapsedMs: rounded(timingNow() - startedAt),
    entries: entries.map((entry) => ({
      ...entry,
      detail: entry.detail ? { ...entry.detail } : null,
    })),
  };
}

function startupConsoleEnabled(): boolean {
  if (typeof location === "undefined") return false;
  try {
    return new URLSearchParams(location.search).get("startupDebug") === "1";
  } catch {
    return false;
  }
}

export function publishStartupTiming(reason: string): void {
  if (!startupConsoleEnabled()) return;
  const payload = { reason, ...captureStartupTiming() };
  console.info(`[M1M4 startup timing] ${JSON.stringify(payload)}`);
}

declare global {
  interface Window {
    readonly __m1m4StartupTiming?: () => StartupTimingSnapshot;
  }
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "__m1m4StartupTiming", {
    configurable: true,
    value: captureStartupTiming,
  });
}
