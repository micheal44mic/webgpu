/**
 * Ammissione delle allocazioni **prima** che avvengano.
 *
 * Il registro delle risorse osserva cio' che e' gia' stato creato: e' una
 * misura, non un freno. Le transazioni di allocazione proteggono dallo stato
 * applicativo incompleto, ma non dal picco: se l'allocazione sfonda il tetto
 * del processo, Safari termina la scheda e il rollback non viene mai eseguito.
 *
 * La disciplina non e' nuova. Il motore la applica gia' a mano nei punti in cui
 * l'ha imparata a caro prezzo — il cambio livello espelle la texture uscente
 * prima di allocare la candidata, e la ricostruzione delle superfici merged non
 * tiene mai due coppie complete insieme. Qui quella regola diventa una sola,
 * invece di ripetersi sito per sito.
 *
 * Il modulo e' puro: non conosce WebGPU, non alloca nulla e gira in Node, cosi'
 * la politica resta verificabile senza un dispositivo. I numeri iniziali sono
 * dichiarati come tali: la loro calibrazione arriva dai run del test di limite
 * memoria, non da questo file.
 */

export const MEMORY_GOVERNOR_STRATEGY =
  "preflight-peak-reservation-zoned-reclaim-v1" as const;

const MEBIBYTE_BYTES = 1024 * 1024;

/**
 * Quota del tetto osservato che il motore si concede.
 *
 * Il test di limite memoria riporta l'ultimo totale **contato** sopravvissuto.
 * Cio' che uccide la scheda e' quel totale piu' tutto cio' che il registro non
 * vede: padding e allineamenti del backend, allocazioni del driver, command
 * buffer in volo, cache delle pipeline, swapchain e heap JavaScript. Il tetto
 * interno deve percio' stare **sotto** il valore osservato, non su di esso.
 *
 * Valore iniziale da calibrare: va rialzato solo se una misura end-to-end
 * mostra che lo scarto fra contato e reale e' minore di cosi'.
 */
export const MEMORY_GOVERNOR_OBSERVED_CEILING_MARGIN = 0.85;

/** Frazione del tetto oltre la quale la cache smette di crescere. */
export const MEMORY_GOVERNOR_SOFT_CAP_RATIO = 0.75;

/** Frazione del tetto oltre la quale si fa writeback e si taglia il prefetch. */
export const MEMORY_GOVERNOR_ORANGE_CAP_RATIO = 0.9;

/**
 * Riserva che pennelli, effetti e cache non possono toccare.
 *
 * Serve a garantire che resti memoria per journal, salvataggio, messaggio di
 * interfaccia e recupero del device. Il difetto che previene e' preciso: l'app
 * che consuma proprio l'ultima memoria che le serviva per salvarsi.
 */
export const MEMORY_GOVERNOR_EMERGENCY_RESERVE_RATIO = 0.05;
export const MEMORY_GOVERNOR_EMERGENCY_RESERVE_FLOOR_BYTES = 24 * MEBIBYTE_BYTES;

/**
 * Quota della riserva d'emergenza che una richiesta interattiva puo' toccare
 * mentre un tratto e' vivo.
 *
 * "Rifiuta l'operazione prima di allocare" funziona per un effetto, non per una
 * penna gia' appoggiata: la' l'unica cosa liberabile e' cio' che stai usando.
 * Il tratto ottiene percio' un margine in piu', ma non tutta la riserva —
 * altrimenti finire il tratto e salvare diventerebbe di nuovo impossibile.
 */
export const MEMORY_GOVERNOR_STROKE_RESERVE_RATIO = 0.5;

export type MemoryZone = "green" | "yellow" | "orange" | "red";

export type MemoryPriority = "interactive" | "normal" | "background";

export type MemoryAdmissionOutcome =
  /** Puo' partire subito. */
  | "admit"
  /** Puo' partire dopo aver liberato `reclaimBytes`. */
  | "reclaim"
  /** Non deve partire: non c'e' spazio nemmeno liberando tutto il liberabile. */
  | "refuse"
  /**
   * Come `refuse`, ma la richiesta appartiene a un tratto vivo. Fallire
   * un'allocazione a meta' tratto lascerebbe il documento in uno stato che
   * l'utente non ha chiesto: il chiamante deve invece chiudere il tratto in
   * modo pulito e solo allora rifiutare il resto.
   */
  | "end-stroke";

export interface MemoryGovernorLimits {
  /** Tetto interno, gia' scontato rispetto al valore osservato sul dispositivo. */
  hardCapBytes: number;
  softCapBytes: number;
  orangeCapBytes: number;
  emergencyReserveBytes: number;
  strokeReserveRatio: number;
}

export interface MemoryLedger {
  /** Byte gia' allocati e vivi, misurati dal registro delle risorse. */
  committedBytes: number;
  /** Byte promessi a operazioni asincrone non ancora concluse. */
  reservedBytes: number;
  /**
   * Sottoinsieme di `committedBytes` liberabile senza perdere informazione.
   * **Non** e' un termine addizionale: sommarlo al totale sarebbe un doppio
   * conteggio, ed e' l'errore che rende un budget silenziosamente ottimista.
   */
  reclaimableBytes: number;
  /**
   * Copie temporanee che il registro GPU non vede: buffer dei worker, output
   * della compressione, copie in volo fra thread. Governare le sole texture e
   * i soli buffer GPU lascia fuori proprio la memoria che cresce durante la
   * compressione dei livelli freddi.
   */
  inFlightBytes: number;
}

export interface MemoryRequest {
  category: string;
  /** Byte che resteranno vivi dopo l'operazione. */
  steadyBytes: number;
  /**
   * Massimo temporaneo durante l'operazione, `steadyBytes` inclusi. E' questo
   * il numero che uccide la scheda: un retarget che tiene insieme sorgente e
   * destinazione costa il doppio del suo risultato.
   */
  peakBytes: number;
  priority: MemoryPriority;
}

export interface MemoryGovernorContext {
  /** Un tratto e' appoggiato: le sue risorse non sono espellibili. */
  strokeActive: boolean;
}

export interface MemoryReclaimSource {
  id: string;
  bytes: number;
  /** Ordine di sacrificio: 0 si butta per primo. */
  rank: number;
}

export interface MemoryReclaimStep {
  id: string;
  bytes: number;
}

export interface MemoryReclaimPlan {
  steps: readonly MemoryReclaimStep[];
  reclaimedBytes: number;
  sufficient: boolean;
}

export interface MemoryAdmissionDecision {
  outcome: MemoryAdmissionOutcome;
  zone: MemoryZone;
  /** Byte da liberare prima di allocare; 0 quando l'esito e' `admit`. */
  reclaimBytes: number;
  /** Spazio residuo sotto il tetto utilizzabile, dopo la richiesta. */
  headroomBytes: number;
  usedBytes: number;
  ceilingBytes: number;
  reason: string;
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number.`);
  }
  return value;
}

export function assertMemoryLedger(ledger: MemoryLedger): void {
  finiteNonNegative(ledger.committedBytes, "committedBytes");
  finiteNonNegative(ledger.reservedBytes, "reservedBytes");
  finiteNonNegative(ledger.reclaimableBytes, "reclaimableBytes");
  finiteNonNegative(ledger.inFlightBytes, "inFlightBytes");
  if (ledger.reclaimableBytes > ledger.committedBytes) {
    throw new RangeError(
      "reclaimableBytes is a subset of committedBytes and cannot exceed it.",
    );
  }
}

export function emptyMemoryLedger(): MemoryLedger {
  return {
    committedBytes: 0,
    reservedBytes: 0,
    reclaimableBytes: 0,
    inFlightBytes: 0,
  };
}

/**
 * Byte che pesano sul tetto. `reclaimableBytes` non compare: e' gia' dentro
 * `committedBytes`, e comparirebbe due volte.
 */
export function memoryLedgerUsedBytes(ledger: MemoryLedger): number {
  assertMemoryLedger(ledger);
  return ledger.committedBytes + ledger.reservedBytes + ledger.inFlightBytes;
}

/**
 * Costruisce i limiti a partire dal tetto **osservato** su un dispositivo, cioe'
 * dal totale contato piu' alto che una sessione ha superato senza essere
 * terminata. E' il ponte fra il test di limite memoria e il governor: senza di
 * esso il governor non avrebbe alcun numero contro cui governare, perche' il
 * web non espone l'impronta di processo.
 */
export function memoryGovernorLimitsFromObservedCeiling(
  observedSafeBytes: number,
  options: {
    margin?: number;
    softCapRatio?: number;
    orangeCapRatio?: number;
    emergencyReserveRatio?: number;
    emergencyReserveFloorBytes?: number;
    strokeReserveRatio?: number;
  } = {},
): MemoryGovernorLimits {
  finiteNonNegative(observedSafeBytes, "observedSafeBytes");
  const margin = options.margin ?? MEMORY_GOVERNOR_OBSERVED_CEILING_MARGIN;
  const softCapRatio = options.softCapRatio ?? MEMORY_GOVERNOR_SOFT_CAP_RATIO;
  const orangeCapRatio = options.orangeCapRatio ?? MEMORY_GOVERNOR_ORANGE_CAP_RATIO;
  const emergencyRatio =
    options.emergencyReserveRatio ?? MEMORY_GOVERNOR_EMERGENCY_RESERVE_RATIO;
  const emergencyFloor =
    options.emergencyReserveFloorBytes ?? MEMORY_GOVERNOR_EMERGENCY_RESERVE_FLOOR_BYTES;
  const strokeReserveRatio =
    options.strokeReserveRatio ?? MEMORY_GOVERNOR_STROKE_RESERVE_RATIO;

  for (const [label, ratio] of [
    ["margin", margin],
    ["softCapRatio", softCapRatio],
    ["orangeCapRatio", orangeCapRatio],
    ["emergencyReserveRatio", emergencyRatio],
    ["strokeReserveRatio", strokeReserveRatio],
  ] as const) {
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
      throw new RangeError(`${label} must be in (0, 1].`);
    }
  }
  if (softCapRatio >= orangeCapRatio) {
    throw new RangeError("softCapRatio must be below orangeCapRatio.");
  }

  const hardCapBytes = Math.floor(observedSafeBytes * margin);
  const emergencyReserveBytes = Math.min(
    // Una riserva che si mangia il tetto lascerebbe zero spazio utile: sotto
    // questa soglia e' il dispositivo a essere troppo piccolo, non la riserva
    // a essere troppo grande.
    Math.floor(hardCapBytes * 0.5),
    Math.max(emergencyFloor, Math.floor(hardCapBytes * emergencyRatio)),
  );
  return {
    hardCapBytes,
    softCapBytes: Math.floor(hardCapBytes * softCapRatio),
    orangeCapBytes: Math.floor(hardCapBytes * orangeCapRatio),
    emergencyReserveBytes,
    strokeReserveRatio,
  };
}

export function assertMemoryGovernorLimits(limits: MemoryGovernorLimits): void {
  finiteNonNegative(limits.hardCapBytes, "hardCapBytes");
  finiteNonNegative(limits.softCapBytes, "softCapBytes");
  finiteNonNegative(limits.orangeCapBytes, "orangeCapBytes");
  finiteNonNegative(limits.emergencyReserveBytes, "emergencyReserveBytes");
  if (!(limits.softCapBytes < limits.orangeCapBytes)) {
    throw new RangeError("softCapBytes must be below orangeCapBytes.");
  }
  if (!(limits.orangeCapBytes < limits.hardCapBytes)) {
    throw new RangeError("orangeCapBytes must be below hardCapBytes.");
  }
  if (limits.emergencyReserveBytes >= limits.hardCapBytes) {
    throw new RangeError("The emergency reserve cannot occupy the entire cap.");
  }
  if (
    !Number.isFinite(limits.strokeReserveRatio)
    || limits.strokeReserveRatio < 0
    || limits.strokeReserveRatio > 1
  ) {
    throw new RangeError("strokeReserveRatio must be in [0, 1].");
  }
}

export function memoryZoneFor(
  ledger: MemoryLedger,
  limits: MemoryGovernorLimits,
): MemoryZone {
  assertMemoryGovernorLimits(limits);
  const used = memoryLedgerUsedBytes(ledger);
  if (used >= limits.hardCapBytes) return "red";
  if (used >= limits.orangeCapBytes) return "orange";
  if (used >= limits.softCapBytes) return "yellow";
  return "green";
}

/**
 * Tetto realmente utilizzabile da una richiesta. La riserva d'emergenza e'
 * sottratta sempre; solo una richiesta interattiva con un tratto vivo puo'
 * intaccarne una quota.
 */
export function usableCeilingBytes(
  limits: MemoryGovernorLimits,
  request: MemoryRequest,
  context: MemoryGovernorContext,
): number {
  assertMemoryGovernorLimits(limits);
  const base = limits.hardCapBytes - limits.emergencyReserveBytes;
  if (context.strokeActive && request.priority === "interactive") {
    return base + Math.floor(limits.emergencyReserveBytes * limits.strokeReserveRatio);
  }
  return base;
}

function assertMemoryRequest(request: MemoryRequest): void {
  finiteNonNegative(request.steadyBytes, "steadyBytes");
  finiteNonNegative(request.peakBytes, "peakBytes");
  if (request.peakBytes < request.steadyBytes) {
    throw new RangeError(
      "peakBytes includes steadyBytes and cannot be lower: "
      + "a peak below the retained allocation describes an impossible operation.",
    );
  }
  if (typeof request.category !== "string" || request.category.length === 0) {
    throw new RangeError("Every memory request must declare a category.");
  }
}

/**
 * Decide se una richiesta puo' partire.
 *
 * Il confronto non e' `committed + nuova allocazione < tetto` ma
 * `committed + reserved + inFlight + picco < tetto - riserva`. La differenza
 * conta: due operazioni asincrone possono entrambe vedere spazio libero e
 * allocare insieme, sfondando un tetto che nessuna delle due avrebbe sfondato
 * da sola. E' `reservedBytes` a impedirlo.
 */
export function planMemoryAdmission(
  ledger: MemoryLedger,
  limits: MemoryGovernorLimits,
  request: MemoryRequest,
  context: MemoryGovernorContext = { strokeActive: false },
): MemoryAdmissionDecision {
  assertMemoryLedger(ledger);
  assertMemoryGovernorLimits(limits);
  assertMemoryRequest(request);

  const usedBytes = memoryLedgerUsedBytes(ledger);
  const zone = memoryZoneFor(ledger, limits);
  const ceilingBytes = usableCeilingBytes(limits, request, context);
  const projectedBytes = usedBytes + request.peakBytes;
  const headroomBytes = ceilingBytes - projectedBytes;

  const base = {
    zone,
    usedBytes,
    ceilingBytes,
    headroomBytes,
  };

  // Il lavoro di sfondo non compete con l'utente. Sotto pressione non viene
  // ammesso nemmeno quando entrerebbe: e' proprio il prefetch che, continuando
  // a crescere in arancione, trasforma una soglia gestita in un muro.
  if (request.priority === "background" && (zone === "orange" || zone === "red")) {
    return {
      ...base,
      outcome: "refuse",
      reclaimBytes: 0,
      reason: `Background work "${request.category}" is suspended in the ${zone} zone.`,
    };
  }

  if (headroomBytes >= 0) {
    return {
      ...base,
      outcome: "admit",
      reclaimBytes: 0,
      reason: `"${request.category}" fits with ${headroomBytes} bytes of headroom.`,
    };
  }

  const shortfallBytes = -headroomBytes;
  if (shortfallBytes <= ledger.reclaimableBytes) {
    return {
      ...base,
      outcome: "reclaim",
      reclaimBytes: shortfallBytes,
      reason:
        `"${request.category}" fits after releasing ${shortfallBytes} bytes `
        + "of rebuildable cache.",
    };
  }

  if (context.strokeActive && request.priority === "interactive") {
    return {
      ...base,
      outcome: "end-stroke",
      reclaimBytes: ledger.reclaimableBytes,
      reason:
        `"${request.category}" does not fit even after releasing all reclaimable memory `
        + "while a stroke is active: end the stroke before refusing the request.",
    };
  }

  return {
    ...base,
    outcome: "refuse",
    reclaimBytes: ledger.reclaimableBytes,
    reason:
      `"${request.category}" needs ${shortfallBytes} bytes beyond reclaimable memory `
      + `(${ledger.reclaimableBytes} bytes).`,
  };
}

/**
 * Ordina il sacrificio delle sorgenti recuperabili. `rank` esprime il costo di
 * ricostruzione: prima le cache che si rifanno da sole, poi cio' che costa una
 * decompressione, infine cio' che costa una lettura da storage. A parita' di
 * rank vince la sorgente piu' grande, perche' libera lo stesso spazio con meno
 * operazioni.
 */
export function planMemoryReclaim(
  sources: readonly MemoryReclaimSource[],
  requiredBytes: number,
): MemoryReclaimPlan {
  finiteNonNegative(requiredBytes, "requiredBytes");
  const ordered = [...sources]
    .filter((source) => source.bytes > 0)
    .sort((left, right) =>
      left.rank !== right.rank ? left.rank - right.rank : right.bytes - left.bytes
    );

  const steps: MemoryReclaimStep[] = [];
  let reclaimedBytes = 0;
  for (const source of ordered) {
    if (reclaimedBytes >= requiredBytes) break;
    steps.push({ id: source.id, bytes: source.bytes });
    reclaimedBytes += source.bytes;
  }
  return {
    steps,
    reclaimedBytes,
    sufficient: reclaimedBytes >= requiredBytes,
  };
}

/**
 * Ranghi di sacrificio delle cache ricostruibili.
 *
 * L'ordine e' il costo di ricostruzione, non la taglia. La cache di
 * presentazione si rifa' al primo frame sporco e non costa altro che un frame;
 * le miniature si rifanno a richiesta; le superfici merged costano una
 * ricomposizione dello stack, che e' la piu' cara delle tre. A parita' di rango
 * `planMemoryReclaim` preferisce la sorgente piu' grande, perche' libera lo
 * stesso spazio con meno operazioni.
 */
export const MEMORY_RECLAIM_RANK = Object.freeze({
  presentationCache: 0,
  layerThumbnail: 1,
  mergedSurfaces: 2,
});

export interface MemoryReservation {
  readonly id: number;
  readonly category: string;
  readonly peakBytes: number;
  readonly steadyBytes: number;
}

/**
 * Contabilita' delle prenotazioni vive.
 *
 * Una prenotazione nasce col **picco** e viene chiusa in due modi: `settle`
 * quando l'operazione riesce (il picco si ritira e restano i byte a regime, che
 * da quel momento il registro misura come committed) e `release` quando
 * fallisce o viene annullata. Dimenticare di chiuderla lascia il tetto piu'
 * basso di quanto sia: e' un errore conservativo, non pericoloso, ed e' la
 * ragione per cui `pendingBytes` resta ispezionabile.
 */
export class MemoryReservationLedger {
  private readonly live = new Map<number, MemoryReservation>();
  private nextId = 1;

  reserve(request: MemoryRequest): MemoryReservation {
    assertMemoryRequest(request);
    const reservation: MemoryReservation = {
      id: this.nextId,
      category: request.category,
      peakBytes: request.peakBytes,
      steadyBytes: request.steadyBytes,
    };
    this.nextId += 1;
    this.live.set(reservation.id, reservation);
    return reservation;
  }

  /** L'operazione e' riuscita: il picco si ritira, il residuo passa al registro. */
  settle(reservation: MemoryReservation): number {
    if (!this.live.delete(reservation.id)) {
      throw new Error(
        `Reservation ${reservation.id} ("${reservation.category}") is already closed.`,
      );
    }
    return reservation.steadyBytes;
  }

  /** L'operazione e' fallita o e' stata annullata: non resta nulla. */
  release(reservation: MemoryReservation): void {
    if (!this.live.delete(reservation.id)) {
      throw new Error(
        `Reservation ${reservation.id} ("${reservation.category}") is already closed.`,
      );
    }
  }

  get pendingBytes(): number {
    let total = 0;
    for (const reservation of this.live.values()) total += reservation.peakBytes;
    return total;
  }

  get pendingCount(): number {
    return this.live.size;
  }

  snapshot(): readonly MemoryReservation[] {
    return [...this.live.values()];
  }
}
