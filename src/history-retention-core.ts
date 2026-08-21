/**
 * Pure planning primitives for bounded, checkpoint-aware Undo/Redo.
 *
 * This module deliberately owns no GPU resources and imports no engine code.
 * The runtime can therefore make every allocation/destruction decision after
 * a queue fence, while the policy and its long-session behaviour stay
 * deterministic and testable in Node.
 */

export const HISTORY_RETENTION_STRATEGY =
  "byte-budget-exact-tiled-checkpoints-idle-fenced-chunked-v1" as const;

export const HISTORY_CHECKPOINT_BASE_ACTION_INTERVAL = 24;
export const HISTORY_CHECKPOINT_MAX_REPLAY_BATCHES = 32;
export const HISTORY_CHECKPOINT_PAYLOAD_INTERVAL_BYTES = 8 * 1024 * 1024;
export const HISTORY_MAINTENANCE_CHUNK_ITEMS = 64;

/**
 * Il termine dominante della memoria History e' il checkpoint, che costa
 * esattamente un livello intero (`LAYER_SIZE² × byte per pixel`). Misurato a
 * 2048²/rgba8: `16 MiB` a checkpoint contro `~62 KiB` di comandi per tratto,
 * cioe' l'85% del totale dopo `223` azioni. Esprimere il budget come multiplo
 * di quel costo mantiene costante la **profondita'** di Undo quando cambiano
 * documento o formato, invece di farla collassare al crescere del livello.
 *
 * Il tetto assoluto resta perche' un telefono ha un limite suo: senza, a
 * rgba16float il multiplo riporterebbe il budget dove stava prima.
 */
export const HISTORY_MOBILE_CHECKPOINT_ALLOWANCE = 6;
export const HISTORY_DESKTOP_CHECKPOINT_ALLOWANCE = 16;
/**
 * Alzato da 96 a 200 MiB.
 *
 * A 96 il tetto veniva raggiunto quasi subito, e superarlo faceva partire
 * l'eviction, che libera memoria **distruggendo** i passi piu' vecchi: si
 * finiva a pagare i checkpoint e ad avere due soli annullamenti disponibili.
 * Il costo del tetto basso non era meno memoria — la memoria restava, perche'
 * il consolidamento era bloccato — era meno profondita' di Undo.
 *
 * A 200 il travaso, che parte al 70% cioe' a 140 MiB, ha spazio per agire
 * prima: pubblica su storage locale i payload lontani e ne libera la copia
 * residente, cosi' l'eviction non ha piu' motivo di distruggere passi.
 */
export const HISTORY_MOBILE_MAXIMUM_BYTES = 200 * 1024 * 1024;
export const HISTORY_DESKTOP_MAXIMUM_BYTES = 512 * 1024 * 1024;
export const HISTORY_MINIMUM_BUDGET_BYTES = 16 * 1024 * 1024;

/**
 * Travaso della cronologia lontana dalla memoria residente allo storage locale.
 *
 * L'eviction butta via; questo **sposta**. Un payload travasato resta
 * annullabile: costa una lettura/reidratazione quando il replay lo raggiunge,
 * e non occupa RAM/GPU finche' non lo raggiunge.
 *
 * Una soglia sola: oltre `HIGH` si travasa **tutto** quello che si puo'.
 *
 * C'era anche una soglia bassa a cui fermarsi, per isteresi. Si e' rivelata
 * inutile e dannosa. Inutile perche' l'isteresi c'e' gia' gratis: un checkpoint
 * travasato e' escluso dai candidati, quindi finito il giro non resta nulla da
 * rifare e il travaso non puo' riaccendersi da solo. Dannosa perche' fermarsi a
 * meta' lascia sulla GPU byte che non servono a niente — la profondita' di Undo
 * non dipende dai checkpoint residenti, quelli servono solo a **velocizzare** un
 * ritorno lontano.
 *
 * I checkpoint piu' recenti non si toccano mai, a nessuna pressione. E' la
 * regola che rende accettabile tutto il resto: i primi annullamenti — quelli
 * che l'utente fa davvero — restano immediati, e si paga solo quando si torna
 * indietro parecchio, che e' raro e dove un'attesa e' tollerata.
 */
export const HISTORY_SPILL_HIGH_WATER_BYTES = 200 * 1024 * 1024;

/**
 * Frazione del budget oltre la quale il travaso comincia.
 *
 * Deve stare **sotto** 1: il travaso ha senso solo se arriva prima
 * dell'eviction, perche' l'eviction libera memoria distruggendo passi di Undo
 * mentre il travaso li conserva. Arrivare insieme o dopo significa lasciarle
 * fare il danno e poi comprimere quel che resta.
 */
export const HISTORY_SPILL_BUDGET_FRACTION = 0.7;

/**
 * Zero: non ci si ferma a meta'. Resta un parametro invece di sparire perche'
 * il pianificatore possa essere provato anche con una soglia d'arresto, e
 * perche' rimetterne una sia un numero da cambiare e non codice da riscrivere.
 */
export const HISTORY_SPILL_LOW_WATER_BYTES = 0;

/** Quanti checkpoint recenti restano sempre sulla GPU, pressione o no. */
export const HISTORY_SPILL_KEEP_HOT_CHECKPOINTS = 2;

export interface HistorySpillMarks {
  highWaterBytes: number;
  lowWaterBytes: number;
  keepHotCheckpoints: number;
}

export interface HistorySpillCandidate {
  id: number;
  /** Distanza dal cursore: 0 e' il checkpoint piu' recente. */
  distance: number;
  /** Byte che questo checkpoint occupa **sulla GPU** adesso. */
  gpuBytes: number;
  /** Gia' in RAM compressa: non libera altri byte. */
  spilled: boolean;
  /** In uso da un replay in corso: spostarlo romperebbe l'operazione. */
  pinned: boolean;
}

export interface HistorySpillStep {
  id: number;
  bytes: number;
}

export interface HistorySpillPlan {
  required: boolean;
  steps: readonly HistorySpillStep[];
  spilledBytes: number;
  /** Byte GPU che resteranno dopo aver eseguito il piano. */
  projectedBytes: number;
  /** Vero quando non resta piu' nessun candidato travasabile. */
  exhaustedEligible: boolean;
  reason:
    /** Sotto la soglia: non si tocca niente. */
    | "within-high-water"
    /** Travasato tutto il travasabile. */
    | "spilled-all-eligible"
    /** Fermato da una soglia d'arresto configurata, con candidati ancora liberi. */
    | "spilled-to-low-water"
    /**
     * Sopra la soglia ma senza nulla da travasare: restano solo i checkpoint
     * recenti, che per contratto non si toccano. Non e' un errore, e' il limite
     * della politica — e va detto invece che nascosto.
     */
    | "no-eligible-checkpoints";
}

export function defaultHistorySpillMarks(): HistorySpillMarks {
  return {
    highWaterBytes: HISTORY_SPILL_HIGH_WATER_BYTES,
    lowWaterBytes: HISTORY_SPILL_LOW_WATER_BYTES,
    keepHotCheckpoints: HISTORY_SPILL_KEEP_HOT_CHECKPOINTS,
  };
}

export function assertHistorySpillMarks(marks: HistorySpillMarks): void {
  if (!Number.isFinite(marks.highWaterBytes) || marks.highWaterBytes <= 0) {
    throw new RangeError("highWaterBytes must be positive.");
  }
  if (!Number.isFinite(marks.lowWaterBytes) || marks.lowWaterBytes < 0) {
    throw new RangeError("lowWaterBytes must be non-negative.");
  }
  if (marks.lowWaterBytes >= marks.highWaterBytes) {
    throw new RangeError(
      "lowWaterBytes must be below highWaterBytes: without space between the two "
      + "thresholds, spillover restarts immediately after it stops.",
    );
  }
  if (
    !Number.isInteger(marks.keepHotCheckpoints)
    || marks.keepHotCheckpoints < 0
  ) {
    throw new RangeError("keepHotCheckpoints must be a non-negative integer.");
  }
}

/**
 * Sceglie quali checkpoint mandare in RAM, dal piu' lontano verso il piu'
 * recente, fermandosi appena il proiettato scende sotto `LOW`.
 *
 * L'ordine e' per distanza decrescente, non per taglia: travasare il checkpoint
 * grosso ma vicino libererebbe piu' byte subito, e li ripagherebbe al primo
 * annullamento. La cosa che conta e' la probabilita' di essere richiesto, e
 * quella scende con la distanza.
 */
export function planHistorySpill(
  candidates: readonly HistorySpillCandidate[],
  currentGpuBytes: number,
  marks: HistorySpillMarks = defaultHistorySpillMarks(),
): HistorySpillPlan {
  assertHistorySpillMarks(marks);
  const current = finiteNonNegative(currentGpuBytes);
  if (current <= marks.highWaterBytes) {
    return {
      required: false,
      steps: [],
      spilledBytes: 0,
      projectedBytes: current,
      exhaustedEligible: false,
      reason: "within-high-water",
    };
  }

  const eligible = [...candidates]
    .filter((candidate) =>
      !candidate.spilled
      && !candidate.pinned
      && candidate.gpuBytes > 0
      && candidate.distance >= marks.keepHotCheckpoints
    )
    .sort((left, right) => right.distance - left.distance);

  const steps: HistorySpillStep[] = [];
  let projectedBytes = current;
  for (const candidate of eligible) {
    if (projectedBytes <= marks.lowWaterBytes) break;
    steps.push({ id: candidate.id, bytes: candidate.gpuBytes });
    projectedBytes -= candidate.gpuBytes;
  }

  const exhaustedEligible = steps.length === eligible.length;
  return {
    required: steps.length > 0,
    steps,
    spilledBytes: current - projectedBytes,
    projectedBytes,
    exhaustedEligible,
    // Con la soglia d'arresto a zero il ciclo esaurisce sempre i candidati:
    // `spilled-to-low-water` resta raggiungibile solo configurando una soglia,
    // e `no-eligible-checkpoints` e' il caso in cui restano solo i recenti.
    reason: steps.length === 0
      ? "no-eligible-checkpoints"
      : exhaustedEligible
      ? "spilled-all-eligible"
      : "spilled-to-low-water",
  };
}

/**
 * Cosa il ledger della cronologia aveva osservato l'ultima volta.
 *
 * Il ledger e' incrementale: dopo ogni gesto visita solo cio' che e' stato
 * aggiunto, invece di riscandire tutto. Perche' regga, ogni cosa che il ledger
 * **descrive** deve comparire qui — altrimenti quella cosa puo' cambiare senza
 * che nessuno se ne accorga, e il ledger continua a sembrare sano mentendo.
 *
 * Il cursore era esattamente il campo mancante, ed e' costato caro: la
 * ricostruzione indicizza solo le azioni sotto il cursore ma registrava di aver
 * visto l'intero journal, quindi una ricostruzione avvenuta a meta' sessione
 * restava valida per sempre. Da li' il motore poteva ancorare un checkpoint a
 * un'azione vecchia riempiendolo con i pixel di adesso, e un Undo successivo
 * ricostruiva un disegno mai fatto.
 */
export interface HistoryAccountingWatermark {
  initialized: boolean;
  /** Cursore: il ledger descrive il mondo **a quel punto** della cronologia. */
  cursor: number;
  actionsLength: number;
  actionsTail: object | null;
  batchesLength: number;
  batchesTail: object | null;
  discardedVectorLength: number;
  discardedVectorTail: object | null;
  discardedImportLength: number;
  discardedImportTail: object | null;
  discardedTransformLength: number;
  discardedTransformTail: object | null;
  discardedStructuralLength: number;
  discardedStructuralTail: object | null;
  selectionRevisionSize: number;
  selectionActionSize: number;
}

export interface HistoryAccountingObservation {
  cursor: number;
  actions: readonly object[];
  batches: readonly object[];
  discardedVector: readonly object[];
  discardedImport: readonly object[];
  discardedTransform: readonly object[];
  discardedStructural: readonly object[];
  selectionRevisionSize: number;
  selectionActionSize: number;
}

/**
 * Una sequenza e' cresciuta solo in coda se non si e' accorciata e se
 * l'elemento che chiudeva la parte gia' vista e' ancora quello. Il confronto e'
 * per identita': un elemento sostituito in posizione non e' un append.
 */
function grownOnlyAtTail(
  values: readonly object[],
  observedLength: number,
  observedTail: object | null,
): boolean {
  return observedLength <= values.length
    && (observedLength === 0 || values[observedLength - 1] === observedTail);
}

/**
 * Decide se il ledger puo' aggiornarsi in modo incrementale o va rifatto.
 *
 * E' pura apposta: e' la decisione piu' delicata del sottosistema, e l'unico
 * modo di provarla davvero e' poterla esercitare senza un motore e senza una
 * GPU. Il runtime le passa cio' che vede; qui non si tocca niente.
 */
export function historyAccountingIsAppendOnly(
  watermark: HistoryAccountingWatermark,
  observation: HistoryAccountingObservation,
): boolean {
  return watermark.initialized
    && watermark.cursor === observation.cursor
    // Il cursore per primo: e' il termine che mancava, ed e' quello che
    // trasforma un errore momentaneo in un errore permanente quando manca.
    && grownOnlyAtTail(observation.actions, watermark.actionsLength, watermark.actionsTail)
    && grownOnlyAtTail(observation.batches, watermark.batchesLength, watermark.batchesTail)
    && grownOnlyAtTail(
      observation.discardedVector,
      watermark.discardedVectorLength,
      watermark.discardedVectorTail,
    )
    && grownOnlyAtTail(
      observation.discardedImport,
      watermark.discardedImportLength,
      watermark.discardedImportTail,
    )
    && grownOnlyAtTail(
      observation.discardedTransform,
      watermark.discardedTransformLength,
      watermark.discardedTransformTail,
    )
    && grownOnlyAtTail(
      observation.discardedStructural,
      watermark.discardedStructuralLength,
      watermark.discardedStructuralTail,
    )
    && watermark.selectionRevisionSize <= observation.selectionRevisionSize
    && watermark.selectionActionSize <= observation.selectionActionSize;
}

/**
 * Recupero del budget buttando la **cache**, non la cronologia.
 *
 * E' la correzione dell'errore centrale del sottosistema. I checkpoint periodici
 * sono acceleratori: servono a non rigiocare dall'inizio, e se spariscono il
 * replay riparte da piu' lontano — piu' lento, mai sbagliato. Il journal delle
 * azioni invece e' l'unica copia: distruggerlo toglie all'utente passi di Undo
 * che nessuno puo' ricostruire.
 *
 * Il motore faceva esattamente il contrario. Sopra budget alzava il pavimento —
 * distruggendo l'insostituibile — e lasciava intatti i checkpoint, che sono la
 * parte pesante e rimpiazzabile. Da qui il caso misurato: pavimento a 54 su 55
 * azioni con 246 MiB di checkpoint ancora residenti.
 *
 * Questo pianificatore sacrifica prima cio' che si rifa' da solo, e non produce
 * mai un pavimento.
 */
export interface HistoryCheckpointCacheEntry {
  id: number;
  layerId: number;
  /** Catena delta: un figlio non e' ricostruibile senza il suo genitore. */
  parentId: number | null;
  kind: "full" | "delta" | "blank";
  /** Posizione nel journal; piu' basso vuol dire piu' vecchio. */
  actionIndex: number;
  bytes: number;
}

export interface HistoryBudgetRecoveryPlan {
  required: boolean;
  checkpointIdsToDrop: readonly number[];
  droppedBytes: number;
  projectedBytes: number;
  /** Vero quando la sola cache basta a rientrare sotto il bersaglio. */
  reachedTarget: boolean;
  /**
   * `cache-insufficient` non e' un fallimento: dice che la cache da sola non
   * basta e che serve una decisione piu' costosa. Va detto, perche' e' l'unico
   * caso in cui toccare il journal e' difendibile.
   */
  reason: "within-budget" | "recovered-by-cache" | "cache-insufficient";
}

export function planHistoryBudgetRecovery(options: {
  currentBytes: number;
  budget: HistoryBudget;
  checkpoints: readonly HistoryCheckpointCacheEntry[];
  /** In uso da un replay in corso: buttarli romperebbe l'operazione. */
  pinnedIds?: readonly number[];
}): HistoryBudgetRecoveryPlan {
  const currentBytes = finiteNonNegative(options.currentBytes);
  const target = finiteNonNegative(options.budget.targetBytes);
  if (currentBytes <= finiteNonNegative(options.budget.hardBytes)) {
    return {
      required: false,
      checkpointIdsToDrop: [],
      droppedBytes: 0,
      projectedBytes: currentBytes,
      reachedTarget: true,
      reason: "within-budget",
    };
  }

  const pinned = new Set(options.pinnedIds ?? []);
  const retained = new Map(options.checkpoints.map((entry) => [entry.id, entry]));
  const dropped: number[] = [];
  let projectedBytes = currentBytes;

  // Si sacrificano solo le **foglie**: un checkpoint di cui nessun altro e'
  // figlio. Buttare un genitore lasciando il figlio renderebbe la catena
  // inservibile, e il replay la rifiuta perche' non termina piu' su un full.
  // Ripetendo, la catena si consuma dalla punta verso la base senza rompersi.
  const hasRetainedChild = (id: number): boolean => {
    for (const entry of retained.values()) {
      if (entry.parentId === id) return true;
    }
    return false;
  };

  // Delta per primi: costano meno da rifare di un full, e un full e' la base su
  // cui i delta rimasti poggiano. A parita' di tipo si comincia dal piu'
  // vecchio, che e' quello con meno probabilita' di essere richiesto.
  for (const kind of ["delta", "full", "blank"] as const) {
    let progressed = true;
    while (progressed && projectedBytes > target) {
      progressed = false;
      const candidates = [...retained.values()]
        .filter((entry) =>
          entry.kind === kind
          && entry.bytes > 0
          && !pinned.has(entry.id)
          && !hasRetainedChild(entry.id)
        )
        .sort((left, right) => left.actionIndex - right.actionIndex);
      const candidate = candidates[0];
      if (!candidate) break;
      retained.delete(candidate.id);
      dropped.push(candidate.id);
      projectedBytes -= candidate.bytes;
      progressed = true;
    }
  }

  const reachedTarget = projectedBytes <= target;
  return {
    required: dropped.length > 0,
    checkpointIdsToDrop: dropped,
    droppedBytes: currentBytes - projectedBytes,
    projectedBytes,
    reachedTarget,
    reason: reachedTarget ? "recovered-by-cache" : "cache-insufficient",
  };
}

export type HistoryMemoryCategory =
  | "gpuPayloadBytes"
  | "checkpointBytes"
  | "selectionFillMaskBytes"
  | "cpuVectorBytes"
  | "assetBytes";

export interface HistoryMemoryLedger {
  /** Logical payload bytes, useful for attribution but not the budget ceiling. */
  gpuPayloadBytes: number;
  /** Reserved bytes inside live GPU history slices. */
  gpuReservedBytes: number;
  /** Physical page bytes currently allocated by the paged GPU allocator. */
  gpuAllocatedBytes: number;
  checkpointBytes: number;
  selectionFillMaskBytes: number;
  cpuVectorBytes: number;
  assetBytes: number;
}

export interface HistoryBudget {
  /** Hard accounting ceiling. Maintenance must converge below this value. */
  hardBytes: number;
  /** Hysteresis target after eviction, preventing one-action maintenance loops. */
  targetBytes: number;
}

export interface HistoryCheckpointPressure {
  actionsSinceCheckpoint: number;
  replayBatchesSinceCheckpoint: number;
  payloadBytesSinceCheckpoint: number;
  /** 0 while comfortably below budget; 1 at the hard budget. */
  budgetPressure: number;
}

export type HistoryCheckpointReason =
  | "action-interval"
  | "replay-tail"
  | "payload-bytes"
  | "budget-pressure";

export interface HistoryCheckpointPlan {
  capture: boolean;
  reason: HistoryCheckpointReason | null;
  effectiveActionInterval: number;
}

export interface HistoryCompactionChunk {
  start: number;
  end: number;
  done: boolean;
}

export interface HistoryIncrementalWorkResult {
  completed: boolean;
  processedItems: number;
  chunks: number;
  yields: number;
}

export interface HistoryIncrementalWorkHooks {
  shouldContinue(): boolean;
  yieldTurn(): Promise<void>;
}

/** A stable checkpoint anchor; `afterActionId=null` is the blank baseline. */
export interface HistoryCheckpointAnchor {
  id: number;
  layerId: number;
  afterActionId: number | null;
}

export interface HistoryActionAnchor {
  id: number;
  kind: string;
  layerId?: number;
}

/**
 * A global boundary is eligible for prefix eviction only when every live
 * raster layer has an exact snapshot for the state at this cursor.
 */
export interface HistoryExactBoundary {
  cursor: number;
  retainedBytes: number;
  baselineBytes: number;
  exactLayerCount: number;
  liveLayerCount: number;
}

export interface HistoryEvictionPlan {
  required: boolean;
  boundaryCursor: number | null;
  projectedBytes: number;
  reason: "within-budget" | "exact-boundary" | "checkpoint-required";
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function emptyHistoryMemoryLedger(): HistoryMemoryLedger {
  return {
    gpuPayloadBytes: 0,
    gpuReservedBytes: 0,
    gpuAllocatedBytes: 0,
    checkpointBytes: 0,
    selectionFillMaskBytes: 0,
    cpuVectorBytes: 0,
    assetBytes: 0,
  };
}

export function historyMemoryTotalBytes(ledger: HistoryMemoryLedger): number {
  const logicalPagedBytes = finiteNonNegative(ledger.gpuPayloadBytes)
    + finiteNonNegative(ledger.selectionFillMaskBytes);
  // Pages are the amount the process really owns. `max` keeps synthetic or
  // legacy ledgers conservative even when physical stats are unavailable.
  const physicalPagedBytes = Math.max(
    logicalPagedBytes,
    finiteNonNegative(ledger.gpuReservedBytes),
    finiteNonNegative(ledger.gpuAllocatedBytes),
  );
  return physicalPagedBytes
    + finiteNonNegative(ledger.checkpointBytes)
    + finiteNonNegative(ledger.cpuVectorBytes)
    + finiteNonNegative(ledger.assetBytes);
}

/**
 * Tetto di classe dispositivo, prima che gli effetti vivi prenotino la loro
 * quota. E' un multiplo del costo di un checkpoint, limitato dal tetto assoluto
 * del dispositivo: cosi' la profondita' di Undo resta stabile al variare di
 * documento e formato, ma il telefono non supera mai la sua soglia.
 */
export function historyBaseBudgetBytes(options: {
  checkpointBytes: number;
  mobile: boolean;
}): number {
  const checkpointBytes = finiteNonNegative(options.checkpointBytes);
  const allowance = options.mobile
    ? HISTORY_MOBILE_CHECKPOINT_ALLOWANCE
    : HISTORY_DESKTOP_CHECKPOINT_ALLOWANCE;
  const maximumBytes = options.mobile
    ? HISTORY_MOBILE_MAXIMUM_BYTES
    : HISTORY_DESKTOP_MAXIMUM_BYTES;
  // Il tetto del dispositivo non puo' scendere sotto un checkpoint intero: un
  // budget che non ne regge nemmeno uno non ha alcun boundary di eviction, e
  // l'unico effetto sarebbe restare permanentemente sopra il tetto con
  // `budgetCheckpointBlocked` acceso. Sotto quella soglia il costo del
  // checkpoint vince sul tetto, ed e' il documento a dover scendere.
  return Math.max(
    HISTORY_MINIMUM_BUDGET_BYTES,
    checkpointBytes,
    Math.min(maximumBytes, Math.floor(checkpointBytes * allowance)),
  );
}

/**
 * Builds a byte budget from an explicit amount of memory made available to
 * History. It intentionally never accepts an action count as a proxy for cost.
 */
export function createHistoryBudget(availableBytes: number): HistoryBudget {
  if (!Number.isFinite(availableBytes) || availableBytes < HISTORY_MINIMUM_BUDGET_BYTES) {
    throw new RangeError("The History budget must be at least 16 MiB.");
  }
  const hardBytes = Math.floor(availableBytes);
  return {
    hardBytes,
    targetBytes: Math.floor(hardBytes * 0.82),
  };
}

export function historyBudgetPressure(
  ledger: HistoryMemoryLedger,
  budget: HistoryBudget,
): number {
  return Math.min(1, historyMemoryTotalBytes(ledger) / budget.hardBytes);
}

/**
 * Checkpoint cadence tightens under memory pressure but stays bounded. Replay
 * tail and payload bytes are independent triggers, so a single huge Fill or a
 * stamp-heavy brush does not wait for an arbitrary number of gestures.
 */
/**
 * Se un checkpoint **facoltativo** puo' essere allocato adesso.
 *
 * Un checkpoint e' un acceleratore: se non lo scatti, il replay riparte da piu'
 * lontano. Se lo scatti quando la memoria e' finita, non ottieni velocita' — la
 * paghi in profondita' di Undo, perche' e' l'eviction a dover recuperare quei
 * byte e l'unico modo che ha e' distruggere il journal.
 *
 * Prima la pressione **accelerava** le catture invece di frenarle: a budget
 * pieno l'intervallo si accorciava a otto azioni e ogni checkpoint diventava
 * full. Sforare faceva produrre fotografie piu' grosse piu' spesso, il che
 * faceva sforare di piu'. Adesso la pressione fa l'unica cosa sensata: dice no.
 *
 * `mandatory` esiste perche' alcuni full non sono acceleratori ma basi
 * necessarie alla correttezza della catena: quelli devono passare comunque.
 */
export function admitHistoryCheckpoint(options: {
  currentBytes: number;
  candidateBytes: number;
  budget: HistoryBudget;
  mandatory: boolean;
}): { admitted: boolean; reason: "mandatory" | "within-target" | "would-exceed-target" } {
  if (options.mandatory) return { admitted: true, reason: "mandatory" };
  const projected = finiteNonNegative(options.currentBytes)
    + finiteNonNegative(options.candidateBytes);
  return projected <= finiteNonNegative(options.budget.targetBytes)
    ? { admitted: true, reason: "within-target" }
    : { admitted: false, reason: "would-exceed-target" };
}

/**
 * Quale rappresentazione scattare: full, delta, o niente.
 *
 * Esiste separata dall'ammissione perche' il difetto stava proprio qui, ed era
 * invisibile finche' la scelta viveva dentro il runtime.
 *
 * L'ordinale del full periodico avanza **solo al commit**. Quando l'ottavo
 * checkpoint imponeva un full da 32 MiB e l'ammissione lo rifiutava, non si
 * committava nulla: l'ordinale restava otto, il tentativo successivo riproponeva
 * lo stesso full, e un delta da 2 MiB non veniva mai considerato. La coda di
 * replay cresceva senza fine. Una preferenza non deve poter diventare un blocco.
 *
 * `fullRequired` e' l'unico caso in cui il delta non e' un'alternativa valida:
 * li' il full serve alla correttezza, non alla velocita'.
 */
export function selectCheckpointRepresentation(options: {
  fullRequired: boolean;
  /** A byte-bounded replay chain may rebase only to a full, but can skip it. */
  rebaseRequired?: boolean;
  rebasePreferred: boolean;
  fullValid: boolean;
  fullAdmitted: boolean;
  deltaValid: boolean;
  deltaAdmitted: boolean;
}): "full" | "delta" | "none" {
  const full = options.fullValid && options.fullAdmitted ? "full" : null;
  const delta = options.deltaValid && options.deltaAdmitted ? "delta" : null;
  if (options.fullRequired || options.rebaseRequired) return full ?? "none";
  return (options.rebasePreferred ? full ?? delta : delta ?? full) ?? "none";
}

export function planHistoryCheckpoint(
  pressure: HistoryCheckpointPressure,
): HistoryCheckpointPlan {
  const normalizedPressure = Math.min(1, finiteNonNegative(pressure.budgetPressure));
  // L'intervallo non dipende piu' dalla pressione. Accorciarlo sotto pressione
  // era un acceleratore travestito da prudenza: produceva piu' checkpoint
  // proprio quando non c'era spazio per tenerli. Il freno ora e'
  // `admitHistoryCheckpoint`, che agisce sui byte invece che sulla cadenza.
  const effectiveActionInterval = HISTORY_CHECKPOINT_BASE_ACTION_INTERVAL;
  if (pressure.replayBatchesSinceCheckpoint >= HISTORY_CHECKPOINT_MAX_REPLAY_BATCHES) {
    return { capture: true, reason: "replay-tail", effectiveActionInterval };
  }
  if (pressure.payloadBytesSinceCheckpoint >= HISTORY_CHECKPOINT_PAYLOAD_INTERVAL_BYTES) {
    return { capture: true, reason: "payload-bytes", effectiveActionInterval };
  }
  if (pressure.actionsSinceCheckpoint >= effectiveActionInterval) {
    return {
      capture: true,
      reason: normalizedPressure >= 0.75 ? "budget-pressure" : "action-interval",
      effectiveActionInterval,
    };
  }
  return { capture: false, reason: null, effectiveActionInterval };
}

/** Returns the newest checkpoint whose anchor remains in the visible prefix. */
export function nearestHistoryCheckpoint(
  actions: readonly HistoryActionAnchor[],
  cursor: number,
  layerId: number,
  checkpoints: readonly HistoryCheckpointAnchor[],
): { checkpoint: HistoryCheckpointAnchor; actionIndex: number } | null {
  const end = Math.max(0, Math.min(actions.length, Math.floor(cursor)));
  const actionIndexById = new Map<number, number>();
  let latestClearIndex = -1;
  for (let index = 0; index < end; index += 1) {
    const action = actions[index];
    actionIndexById.set(action.id, index);
    if (action.kind === "clear" && action.layerId === layerId) {
      latestClearIndex = index;
    }
  }
  let selected: { checkpoint: HistoryCheckpointAnchor; actionIndex: number } | null = null;
  for (const checkpoint of checkpoints) {
    if (checkpoint.layerId !== layerId) continue;
    const actionIndex = checkpoint.afterActionId === null
      ? -1
      : actionIndexById.get(checkpoint.afterActionId);
    if (actionIndex === undefined || actionIndex < latestClearIndex || actionIndex >= end) {
      continue;
    }
    if (!selected || actionIndex > selected.actionIndex) {
      selected = { checkpoint, actionIndex };
    }
  }
  return selected;
}

export function nextHistoryCompactionChunk(
  itemCount: number,
  start: number,
  maximumItems = HISTORY_MAINTENANCE_CHUNK_ITEMS,
): HistoryCompactionChunk {
  const count = Math.max(0, Math.floor(itemCount));
  const safeStart = Math.max(0, Math.min(count, Math.floor(start)));
  if (!Number.isInteger(maximumItems) || maximumItems <= 0) {
    throw new RangeError("The History maintenance chunk must be positive.");
  }
  const end = Math.min(count, safeStart + maximumItems);
  return { start: safeStart, end, done: end >= count };
}

/**
 * Processes at most one bounded chunk per browser turn. The continuation gate
 * is checked both before work and after every real yield, so pointer-down or a
 * new transaction can stop maintenance without waiting for the full journal.
 */
export async function processHistoryMaintenanceChunks(
  itemCount: number,
  processChunk: (start: number, end: number) => void,
  hooks: HistoryIncrementalWorkHooks,
  maximumItems = HISTORY_MAINTENANCE_CHUNK_ITEMS,
): Promise<HistoryIncrementalWorkResult> {
  const count = Math.max(0, Math.floor(itemCount));
  let cursor = 0;
  let chunks = 0;
  let yields = 0;
  while (cursor < count) {
    if (!hooks.shouldContinue()) {
      return {
        completed: false,
        processedItems: cursor,
        chunks,
        yields,
      };
    }
    const chunk = nextHistoryCompactionChunk(count, cursor, maximumItems);
    processChunk(chunk.start, chunk.end);
    cursor = chunk.end;
    chunks += 1;
    if (!chunk.done) {
      await hooks.yieldTurn();
      yields += 1;
      if (!hooks.shouldContinue()) {
        return {
          completed: false,
          processedItems: cursor,
          chunks,
          yields,
        };
      }
    }
  }
  return {
    completed: true,
    processedItems: cursor,
    chunks,
    yields,
  };
}

/**
 * Chooses the earliest exact boundary that reaches the hysteresis target,
 * thereby retaining the maximum possible Undo tail. A partial checkpoint set
 * is never considered an eviction boundary.
 */
export function planHistoryBudgetEviction(
  ledger: HistoryMemoryLedger,
  budget: HistoryBudget,
  boundaries: readonly HistoryExactBoundary[],
): HistoryEvictionPlan {
  const currentBytes = historyMemoryTotalBytes(ledger);
  if (currentBytes <= budget.hardBytes) {
    return {
      required: false,
      boundaryCursor: null,
      projectedBytes: currentBytes,
      reason: "within-budget",
    };
  }
  const eligible = boundaries
    .filter((boundary) => (
      Number.isInteger(boundary.cursor)
      && boundary.cursor > 0
      && boundary.liveLayerCount === boundary.exactLayerCount
      && boundary.retainedBytes + boundary.baselineBytes <= budget.targetBytes
    ))
    .sort((left, right) => left.cursor - right.cursor);
  const selected = eligible[0];
  if (!selected) {
    return {
      required: true,
      boundaryCursor: null,
      projectedBytes: currentBytes,
      reason: "checkpoint-required",
    };
  }
  return {
    required: true,
    boundaryCursor: selected.cursor,
    projectedBytes: selected.retainedBytes + selected.baselineBytes,
    reason: "exact-boundary",
  };
}
