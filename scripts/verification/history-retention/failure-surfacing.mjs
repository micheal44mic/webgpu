import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// --- Guasto di cronologia visibile ------------------------------------------
// Il messaggio d'errore vero vive un istante nella barra di stato e il primo
// aggiornamento lo cancella; su telefono non c'e' console, quindi in mano
// restano solo le righe ripetute che ne sono la conseguenza. Senza la causa
// una diagnosi e' impossibile: il pannello deve conservarla e mostrarla.
{
  const gpuMemoryPanel = readFileSync(
    new URL("../../../src/gpu-memory-panel-controller.ts", import.meta.url),
    "utf8",
  );
  const historyControls = readFileSync(
    new URL("../../../src/history-controls-controller.ts", import.meta.url),
    "utf8",
  );
  assert(
    historyControls.includes("this.failure = {"),
    "HistoryControlsController deve registrare il guasto, non solo mostrarlo",
  );
  for (const campo of ["operation,", "action:", "cursor:", "message,"]) {
    assert(
      historyControls.includes(campo),
      `il guasto registrato deve riportare ${campo}`,
    );
  }
  const diagnostica = gpuMemoryPanel.slice(
    gpuMemoryPanel.indexOf("private updateHistoryDiagnostics(): void"),
    gpuMemoryPanel.indexOf("private updateGpuMemoryAudit("),
  );
  assert(
    diagnostica.includes("ULTIMO GUASTO"),
    "il pannello deve mostrare l'ultimo guasto di cronologia",
  );
  assert(
    diagnostica.includes("lastFailure.message"),
    "il pannello deve riportare il messaggio originale, non solo che c'e' stato un guasto",
  );
}

console.log("History failure surfacing verified.");
