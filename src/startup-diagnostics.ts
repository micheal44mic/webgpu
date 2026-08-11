export interface StartupDiagnosticBridge {
  mark(phase: string, detail?: string): void;
  fail(error: unknown): void;
  ready(): void;
}

declare global {
  interface Window {
    __WEBGPU_BRUSH_STARTUP__?: StartupDiagnosticBridge;
  }
}

function startupDiagnosticBridge(): StartupDiagnosticBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__WEBGPU_BRUSH_STARTUP__;
}

export function markStartupPhase(phase: string, detail?: string): void {
  startupDiagnosticBridge()?.mark(phase, detail);
}

export function reportStartupFailure(error: unknown): void {
  startupDiagnosticBridge()?.fail(error);
}

export function completeStartupDiagnostics(): void {
  startupDiagnosticBridge()?.ready();
}
