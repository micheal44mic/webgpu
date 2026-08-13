import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// --- Input rapidi e pavimento visibile -------------------------------------
// Durante un replay getHistoryState espone canUndo/canRedo=false perche' il
// motore e' occupato. Quello stato non e' un verdetto sul comando successivo:
// filtrarlo nel keydown o rendere nativo-disabled il pulsante fa sparire gli
// input proprio mentre la coda dovrebbe conservarli. Al pavimento, viceversa,
// il comando deve arrivare a runHistoryOperation per mostrarne il motivo.
{
  const historyControls = readFileSync(
    new URL("../../../src/history-controls-controller.ts", import.meta.url),
    "utf8",
  );
  assert(
    historyControls.includes("const replayBusy = this.replayBusy || this.currentState.busy;"),
    "i controlli devono distinguere un replay accodabile da un blocco reale",
  );
  assert(
    historyControls.includes("this.undoButton.disabled = false;")
      && historyControls.includes("this.redoButton.disabled = false;"),
    "i pulsanti visibili non devono diventare nativo-disabled durante il replay o al pavimento",
  );
  assert(
    historyControls.includes("[this.undoButton, undoBlocked, undoReason")
      && historyControls.includes("[this.redoButton, redoBlocked, redoReason"),
    "i pulsanti visibili devono esporre aria-disabled e il motivo del blocco",
  );
  assert(
    historyControls.includes("const HISTORY_QUEUE_MAXIMUM = 32;")
      && historyControls.includes("this.operationQueue.push(operation);"),
    "la coda rapida deve restare limitata e serializzata",
  );
  assert(
    !historyControls.includes("this.undoButton.disabled = undoBlocked")
      && !historyControls.includes("this.redoButton.disabled = redoBlocked"),
    "canUndo/canRedo temporaneamente falsi non devono disabilitare fisicamente la coda",
  );

  const shortcutStart = historyControls.indexOf("private handleKeyboard(");
  const shortcut = historyControls.slice(
    shortcutStart,
    historyControls.lastIndexOf("\n  }") + 4,
  );
  assert(shortcutStart >= 0, "blocco scorciatoia Undo/Redo non trovato");
  assert(
    !shortcut.includes("const available =")
      && !shortcut.includes("!this.currentState.canUndo")
      && !shortcut.includes("!this.currentState.canRedo"),
    "la scorciatoia non deve scartare input mentre il replay espone canUndo/canRedo=false",
  );
  assert(
    shortcut.includes("if (this.requestLocked())")
      && shortcut.includes("this.request(operation);"),
    "la scorciatoia deve filtrare solo i lock reali e poi affidarsi alla coda",
  );
  assert(
    shortcut.indexOf("event.preventDefault();")
      < shortcut.indexOf("if (this.requestLocked())"),
    "anche un Undo bloccato deve restare nell'app e mostrare il proprio motivo",
  );
}

console.log("History rapid-input queue and retention-floor feedback verified.");
