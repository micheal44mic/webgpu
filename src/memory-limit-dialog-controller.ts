import type { MemoryAdmissionWarning } from "./engine-types";

export interface MemoryLimitDialogControllerOptions {
  readonly root: HTMLDialogElement;
  readonly action: HTMLElement;
  readonly peak: HTMLElement;
  readonly available: HTMLElement;
  readonly cancelButton: HTMLButtonElement;
  readonly proceedButton: HTMLButtonElement;
}

type FocusTarget = {
  readonly isConnected?: boolean;
  focus(options?: FocusOptions): void;
};

function focusTarget(value: unknown): FocusTarget | null {
  if (
    typeof value !== "object"
    || value === null
    || !("focus" in value)
    || typeof value.focus !== "function"
  ) {
    return null;
  }
  return value as FocusTarget;
}

function formatMebibytes(bytes: number): string {
  const mebibytes = Math.max(0, bytes) / (1024 * 1024);
  return `${mebibytes.toFixed(1)} MiB`;
}

/**
 * Presents one explicit, non-persistent escape hatch when the memory governor
 * refuses an allocation. A second request cannot borrow the visible prompt:
 * it remains blocked unless it receives its own confirmation later.
 */
export class MemoryLimitDialogController {
  private readonly options: MemoryLimitDialogControllerOptions;
  private pendingResolution: ((approved: boolean) => void) | null = null;
  private previousFocus: FocusTarget | null = null;
  private disposed = false;

  constructor(options: MemoryLimitDialogControllerOptions) {
    this.options = options;
    options.cancelButton.addEventListener("click", this.handleCancelClick);
    options.proceedButton.addEventListener("click", this.handleProceedClick);
    options.root.addEventListener("cancel", this.handleNativeCancel);
    options.root.addEventListener("close", this.handleUnexpectedClose);
  }

  confirm(warning: MemoryAdmissionWarning): Promise<boolean> {
    if (this.disposed || this.pendingResolution || this.options.root.open) {
      return Promise.resolve(false);
    }

    this.options.action.textContent = warning.action;
    this.options.peak.textContent = formatMebibytes(warning.requiredBytes);
    this.options.available.textContent = formatMebibytes(warning.availableBytes);
    this.previousFocus = focusTarget(this.options.root.ownerDocument.activeElement);

    return new Promise<boolean>((resolve) => {
      this.pendingResolution = resolve;
      try {
        this.options.root.showModal();
        this.options.cancelButton.focus({ preventScroll: true });
      } catch {
        this.finish(false);
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.options.cancelButton.removeEventListener("click", this.handleCancelClick);
    this.options.proceedButton.removeEventListener("click", this.handleProceedClick);
    this.options.root.removeEventListener("cancel", this.handleNativeCancel);
    this.options.root.removeEventListener("close", this.handleUnexpectedClose);
    this.finish(false);
  }

  private readonly handleCancelClick = (): void => {
    this.finish(false);
  };

  private readonly handleProceedClick = (): void => {
    this.finish(true);
  };

  private readonly handleNativeCancel = (event: Event): void => {
    event.preventDefault();
    this.finish(false);
  };

  private readonly handleUnexpectedClose = (): void => {
    this.finish(false);
  };

  private finish(approved: boolean): void {
    const resolve = this.pendingResolution;
    if (!resolve) return;
    const previousFocus = this.previousFocus;
    this.pendingResolution = null;
    this.previousFocus = null;
    if (this.options.root.open) this.options.root.close();
    resolve(approved);
    if (previousFocus?.isConnected !== false) {
      previousFocus?.focus({ preventScroll: true });
    }
  }
}
