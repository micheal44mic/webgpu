import type { HistoryState } from "./engine-types";

export type HistoryOperation = "undo" | "redo";

export interface HistoryFailure {
  readonly operation: HistoryOperation;
  readonly action: string;
  readonly cursor: number;
  readonly message: string;
}

export interface HistoryControlsEnginePort {
  state(): HistoryState;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  crossedAction(operation: HistoryOperation): {
    readonly action: string | null;
    readonly cursor: number;
  };
}

export interface HistoryControlsControllerOptions {
  readonly engine: HistoryControlsEnginePort;
  readonly browser: Window;
  readonly undoButton: HTMLButtonElement;
  readonly redoButton: HTMLButtonElement;
  readonly initialState: HistoryState;
  readonly interactionLocked: () => boolean;
  readonly requestLocked: () => boolean;
  readonly onStateChange: (state: HistoryState) => void;
  readonly onControlsLockChange: (locked: boolean) => void;
  readonly onReplayComplete: () => void;
  readonly setStatus: (message: string, kind?: "working" | "ok" | "error") => void;
  readonly recordDiagnostic: (name: string, detail: string, error?: unknown) => void;
}

const HISTORY_QUEUE_MAXIMUM = 32;

/**
 * Serializes Undo/Redo intent and owns the visible availability state.
 *
 * The engine remains authoritative for the journal. This controller owns the
 * UI queue, busy state, failure context and keyboard/button bindings so rapid
 * repeated commands cannot overlap or disappear during a long replay.
 */
export class HistoryControlsController {
  private readonly engine: HistoryControlsEnginePort;
  private readonly browser: Window;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly interactionLocked: () => boolean;
  private readonly requestLocked: () => boolean;
  private readonly onStateChange: (state: HistoryState) => void;
  private readonly onControlsLockChange: (locked: boolean) => void;
  private readonly onReplayComplete: () => void;
  private readonly setStatus: HistoryControlsControllerOptions["setStatus"];
  private readonly recordDiagnostic: HistoryControlsControllerOptions["recordDiagnostic"];
  private readonly operationQueue: HistoryOperation[] = [];
  private readonly handleUndoClick = (): void => this.request("undo");
  private readonly handleRedoClick = (): void => this.request("redo");
  private readonly handleWindowKeyDown = (event: KeyboardEvent): void => {
    this.handleKeyboard(event);
  };

  // UI cache only. The engine journal remains the single source of truth.
  private currentState: HistoryState;
  private replayBusy = false;
  private queueDraining = false;
  private failure: HistoryFailure | null = null;

  constructor(options: HistoryControlsControllerOptions) {
    this.engine = options.engine;
    this.browser = options.browser;
    this.undoButton = options.undoButton;
    this.redoButton = options.redoButton;
    this.currentState = options.initialState;
    this.interactionLocked = options.interactionLocked;
    this.requestLocked = options.requestLocked;
    this.onStateChange = options.onStateChange;
    this.onControlsLockChange = options.onControlsLockChange;
    this.onReplayComplete = options.onReplayComplete;
    this.setStatus = options.setStatus;
    this.recordDiagnostic = options.recordDiagnostic;

    this.undoButton.addEventListener("click", this.handleUndoClick);
    this.redoButton.addEventListener("click", this.handleRedoClick);
    options.browser.addEventListener("keydown", this.handleWindowKeyDown);
  }

  get uiBusy(): boolean {
    return this.replayBusy;
  }

  get isQueueDraining(): boolean {
    return this.queueDraining;
  }

  get queuedOperationCount(): number {
    return this.operationQueue.length;
  }

  get lastFailure(): HistoryFailure | null {
    return this.failure;
  }

  dispose(): void {
    this.undoButton.removeEventListener("click", this.handleUndoClick);
    this.redoButton.removeEventListener("click", this.handleRedoClick);
    this.browser.removeEventListener("keydown", this.handleWindowKeyDown);
    this.operationQueue.length = 0;
  }

  acceptState(state: HistoryState): void {
    this.currentState = state;
    this.onStateChange(state);
    this.refreshControls();
  }

  refreshFromEngine(): HistoryState {
    const state = this.engine.state();
    this.acceptState(state);
    return state;
  }

  refreshControls(): void {
    const locked = this.interactionLocked();
    const requestLocked = this.requestLocked();
    const replayBusy = this.replayBusy || this.currentState.busy;
    const undoBlocked = requestLocked || (!replayBusy && !this.currentState.canUndo);
    const redoBlocked = requestLocked || (!replayBusy && !this.currentState.canRedo);
    const undoReason = requestLocked && this.currentState.undoBlockedReason === null
      ? "Finish the current operation before undoing."
      : replayBusy ? null : this.currentState.undoBlockedReason;
    const redoReason = requestLocked && this.currentState.redoBlockedReason === null
      ? "Finish the current operation before redoing."
      : replayBusy ? null : this.currentState.redoBlockedReason;

    // During replay the controls remain clickable: additional intent is queued
    // and revalidated when its turn starts.
    this.undoButton.disabled = false;
    this.redoButton.disabled = false;
    for (const [button, blocked, reason, label] of [
      [this.undoButton, undoBlocked, undoReason, "Undo"],
      [this.redoButton, redoBlocked, redoReason, "Redo"],
    ] as const) {
      button.setAttribute("aria-disabled", String(blocked));
      button.classList.toggle("is-disabled", blocked);
      button.title = blocked && reason ? reason : label;
      button.setAttribute("aria-label", blocked && reason ? `${label}: ${reason}` : label);
    }
    this.onControlsLockChange(locked);
  }

  request(operation: HistoryOperation): void {
    if (this.operationQueue.length >= HISTORY_QUEUE_MAXIMUM) return;
    this.operationQueue.push(operation);
    void this.drainOperations();
  }

  private async drainOperations(): Promise<void> {
    if (this.queueDraining) return;
    this.queueDraining = true;
    try {
      while (this.operationQueue.length > 0) {
        const operation = this.operationQueue.shift();
        if (!operation) break;
        if (!await this.runOperation(operation)) {
          this.operationQueue.length = 0;
          break;
        }
      }
    } finally {
      this.queueDraining = false;
    }
  }

  private async runOperation(operation: HistoryOperation): Promise<boolean> {
    if (this.interactionLocked()) {
      const reason = operation === "undo"
        ? this.currentState.undoBlockedReason
        : this.currentState.redoBlockedReason;
      this.setStatus(reason ?? "Finish the current operation and try again.");
      return false;
    }
    if (operation === "undo" ? !this.currentState.canUndo : !this.currentState.canRedo) {
      const reason = operation === "undo"
        ? this.currentState.undoBlockedReason
        : this.currentState.redoBlockedReason;
      this.setStatus(reason ?? "History operation unavailable.");
      return false;
    }

    this.replayBusy = true;
    this.refreshControls();
    let moved = false;
    try {
      moved = operation === "undo" ? await this.engine.undo() : await this.engine.redo();
      if (!moved) {
        const fresh = this.engine.state();
        this.setStatus(
          (operation === "undo" ? fresh.undoBlockedReason : fresh.redoBlockedReason)
            ?? "This history step cannot be performed right now.",
        );
        this.recordDiagnostic(
          "history-step-refused",
          JSON.stringify({
            operation,
            cursor: fresh.cursor,
            reason: operation === "undo"
              ? fresh.undoBlockedReason
              : fresh.redoBlockedReason,
          }),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const crossed = this.engine.crossedAction(operation);
      this.failure = {
        operation,
        action: crossed.action ?? "unknown",
        cursor: crossed.cursor,
        message,
      };
      this.recordDiagnostic(
        "history-step-failed",
        JSON.stringify({
          operation,
          action: crossed.action,
          cursor: crossed.cursor,
        }),
        error,
      );
      this.setStatus(message, "error");
    } finally {
      this.replayBusy = false;
      this.refreshFromEngine();
      this.onReplayComplete();
    }
    return moved;
  }

  private handleKeyboard(event: KeyboardEvent): void {
    if (
      event.defaultPrevented
      || event.isComposing
      || event.altKey
      || (!event.ctrlKey && !event.metaKey)
      || event.key.toLowerCase() !== "z"
    ) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable]")) return;

    const operation = event.shiftKey ? "redo" : "undo";
    event.preventDefault();
    if (this.requestLocked()) {
      const reason = operation === "undo"
        ? this.currentState.undoBlockedReason
        : this.currentState.redoBlockedReason;
      this.setStatus(reason ?? "Finish the current operation and try again.");
      return;
    }
    this.request(operation);
  }
}
