import { readEditorStyleSource } from "../../ui-shell-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// --- Cancellazione: messaggi che spiegano ------------------------------------
{
  const engineSource = readFileSync(new URL("../../../src/brush-engine.ts", import.meta.url), "utf8");
  const panelSource = readFileSync(
    new URL("../../../src/layer-panel-controller.ts", import.meta.url),
    "utf8",
  );

  // Cancellare la base di un ritaglio si porta via l'intera unita'. Dire
  // "ultimo livello" mentre ne sta eliminando quattro sembra un blocco
  // arbitrario: l'utente non ha modo di capire cosa fare.
  const deleteLayer = engineSource.slice(
    engineSource.indexOf("  async deleteLayer(index: number): Promise<void> {"),
    engineSource.indexOf("this.assertLayerSwitchAllowed();",
      engineSource.indexOf("  async deleteLayer(index: number): Promise<void> {")),
  );
  assert.ok(deleteLayer.length > 0, "deleteLayer non individuata");
  assert.match(
    deleteLayer,
    /unit\.length > 1/,
    "il rifiuto deve distinguere l'unita' di ritaglio dal singolo livello",
  );
  assert.match(
    deleteLayer,
    /La base di ritaglio si elimina con tutta la sua unità/,
    "il messaggio deve spiegare che la base si porta via il gruppo",
  );
  assert.match(
    deleteLayer,
    /Elimina prima le maschere, /,
    "il messaggio deve dire cosa fare, non solo cosa non si puo' fare",
  );

  // Il livello bloccato usciva in silenzio: pulsante inerte, nessun messaggio,
  // indistinguibile da un guasto dell'app.
  const deleteButton = panelSource.slice(
    panelSource.indexOf("private async requestDelete(): Promise<void>"),
    panelSource.indexOf("private async duplicateSelected()", panelSource.indexOf(
      "private async requestDelete(): Promise<void>",
    )),
  );
  assert.ok(deleteButton.length > 0, "handler di eliminazione non individuato");
  assert.match(
    deleteButton,
    /if \(properties\.locked\) \{[\s\S]{0,320}Livello bloccato/,
    "il livello bloccato deve dire perche' non si elimina",
  );
}



// --- Frecce Undo/Redo: lo stato spento si deve vedere -------------------------
// Le frecce mobile restano toccabili di proposito, cosi' un'operazione bloccata
// puo' spiegarsi invece di sembrare un tocco perso: `disabled` resta `false` e
// lo stato passa per `aria-disabled` e `.is-disabled`. Il risultato e' che il
// segnale e' solo visivo, e va garantito qui — altrimenti le frecce sembrano
// sempre accese e non dicono piu' se puoi andare avanti o indietro.
{
  const historyControlsSource = readFileSync(
    new URL("../../../src/history-controls-controller.ts", import.meta.url),
    "utf8",
  );
  const cssSource = readEditorStyleSource();

  const controlli = historyControlsSource.slice(
    historyControlsSource.indexOf("refreshControls(): void {"),
    historyControlsSource.indexOf("request(operation: HistoryOperation)"),
  );
  assert.ok(controlli.length > 0, "HistoryControlsController.refreshControls non individuato");
  assert.match(
    controlli,
    /button\.setAttribute\("aria-disabled", String\(blocked\)\)/,
    "lo stato bloccato va esposto su aria-disabled",
  );
  assert.match(
    controlli,
    /button\.classList\.toggle\("is-disabled", blocked\)/,
    "lo stato bloccato va esposto anche come classe, per lo stile",
  );

  // Lo stato spento deve attenuare davvero. `opacity: 1` qui significa
  // "identico ad acceso": e' il bug che questa asserzione impedisce.
  const spento = cssSource.slice(
    cssSource.indexOf(".mobile-tool-action:disabled,"),
    cssSource.indexOf(".mobile-color-action,"),
  );
  assert.ok(spento.length > 0, "regola dello stato spento non individuata");
  const opacita = /opacity:\s*([0-9.]+)/.exec(spento);
  assert.ok(opacita, "lo stato spento deve dichiarare un'opacita'");
  assert.ok(
    Number(opacita[1]) < 0.9,
    `lo stato spento deve essere visibilmente attenuato, trovato opacity ${opacita[1]}`,
  );

  // La regola del colore "acceso" ha specificita' piu' alta di quella dello
  // stato disabilitato: senza escludere aria-disabled vince lei, e la freccia
  // bloccata resta a colore pieno.
  assert.match(
    cssSource,
    /\.mobile-tool-action:not\(:disabled\):not\(\[aria-pressed\]\):not\(\[aria-disabled="true"\]\)/,
    "la regola del colore acceso deve escludere aria-disabled, o vince per specificita'",
  );
}
