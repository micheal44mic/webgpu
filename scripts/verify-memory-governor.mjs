import assert from "node:assert/strict";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const corePath = path.join(root, "src", "memory-governor-core.ts");
const coreSource = fs.readFileSync(corePath, "utf8");

async function importCore(source) {
  const runtimeSource = stripTypeScriptTypes(source, { mode: "transform" });
  const moduleUrl = `data:text/javascript;base64,${
    Buffer.from(runtimeSource).toString("base64")
  }#${Date.now()}-${Math.random()}`;
  return import(moduleUrl);
}

const core = await importCore(coreSource);
const {
  MEMORY_GOVERNOR_STRATEGY,
  MEMORY_GOVERNOR_OBSERVED_CEILING_MARGIN,
  MemoryReservationLedger,
  assertMemoryGovernorLimits,
  assertMemoryLedger,
  emptyMemoryLedger,
  memoryGovernorLimitsFromObservedCeiling,
  memoryLedgerUsedBytes,
  memoryZoneFor,
  planMemoryAdmission,
  planMemoryReclaim,
  usableCeilingBytes,
} = core;

const MiB = 1024 * 1024;

function ledger(overrides = {}) {
  return { ...emptyMemoryLedger(), ...overrides };
}

function request(overrides = {}) {
  return {
    category: "test",
    steadyBytes: 0,
    peakBytes: 0,
    priority: "normal",
    ...overrides,
  };
}

/** Tetto giocattolo con numeri tondi, cosi' le asserzioni restano leggibili. */
const LIMITS = {
  hardCapBytes: 1000 * MiB,
  softCapBytes: 750 * MiB,
  orangeCapBytes: 900 * MiB,
  emergencyReserveBytes: 50 * MiB,
  strokeReserveRatio: 0.5,
};

// ---------------------------------------------------------------------------
// Identita' della strategia
// ---------------------------------------------------------------------------
{
  assert.equal(MEMORY_GOVERNOR_STRATEGY, "preflight-peak-reservation-zoned-reclaim-v1");
  assert.ok(
    MEMORY_GOVERNOR_OBSERVED_CEILING_MARGIN > 0
      && MEMORY_GOVERNOR_OBSERVED_CEILING_MARGIN < 1,
    "il tetto interno deve stare sotto quello osservato",
  );
}

// ---------------------------------------------------------------------------
// Il liberabile e' un sottoinsieme del committed, non un termine addizionale
// ---------------------------------------------------------------------------
{
  assert.throws(
    () => assertMemoryLedger(ledger({ committedBytes: 10, reclaimableBytes: 11 })),
    /subset/,
    "reclaimable maggiore di committed deve essere rifiutato",
  );

  const used = memoryLedgerUsedBytes(ledger({
    committedBytes: 100 * MiB,
    reclaimableBytes: 40 * MiB,
    reservedBytes: 10 * MiB,
    inFlightBytes: 5 * MiB,
  }));
  assert.equal(
    used,
    115 * MiB,
    "il liberabile e' gia' dentro il committed: sommarlo sarebbe doppio conteggio",
  );
}

// ---------------------------------------------------------------------------
// Calibrazione dal tetto osservato sul dispositivo
// ---------------------------------------------------------------------------
{
  const observed = 900 * MiB;
  const limits = memoryGovernorLimitsFromObservedCeiling(observed);
  assertMemoryGovernorLimits(limits);
  assert.ok(
    limits.hardCapBytes < observed,
    "il tetto interno non puo' coincidere col valore osservato: il registro non "
    + "vede driver, swapchain e heap JavaScript",
  );
  assert.ok(limits.softCapBytes < limits.orangeCapBytes);
  assert.ok(limits.orangeCapBytes < limits.hardCapBytes);
  assert.ok(limits.emergencyReserveBytes > 0);
  assert.ok(limits.emergencyReserveBytes < limits.hardCapBytes);

  // Un dispositivo minuscolo non deve produrre una riserva che si mangia il tetto.
  const tiny = memoryGovernorLimitsFromObservedCeiling(32 * MiB);
  assertMemoryGovernorLimits(tiny);
  assert.ok(
    tiny.emergencyReserveBytes <= tiny.hardCapBytes * 0.5,
    "la riserva non puo' superare meta' del tetto",
  );

  assert.throws(
    () => memoryGovernorLimitsFromObservedCeiling(900 * MiB, { margin: 1.4 }),
    /margin/,
    "un margine sopra 1 alzerebbe il tetto oltre l'osservato",
  );
  assert.throws(
    () => memoryGovernorLimitsFromObservedCeiling(900 * MiB, {
      softCapRatio: 0.95,
      orangeCapRatio: 0.9,
    }),
    /softCapRatio/,
  );
  assert.throws(
    () => assertMemoryGovernorLimits({ ...LIMITS, emergencyReserveBytes: 1000 * MiB }),
    /emergency reserve/,
  );
}

// ---------------------------------------------------------------------------
// Zone
// ---------------------------------------------------------------------------
{
  assert.equal(memoryZoneFor(ledger({ committedBytes: 0 }), LIMITS), "green");
  assert.equal(memoryZoneFor(ledger({ committedBytes: 749 * MiB }), LIMITS), "green");
  assert.equal(memoryZoneFor(ledger({ committedBytes: 750 * MiB }), LIMITS), "yellow");
  assert.equal(memoryZoneFor(ledger({ committedBytes: 899 * MiB }), LIMITS), "yellow");
  assert.equal(memoryZoneFor(ledger({ committedBytes: 900 * MiB }), LIMITS), "orange");
  assert.equal(memoryZoneFor(ledger({ committedBytes: 1000 * MiB }), LIMITS), "red");

  // Le prenotazioni vive spostano la zona quanto le allocazioni gia' fatte.
  assert.equal(
    memoryZoneFor(ledger({ committedBytes: 700 * MiB, reservedBytes: 60 * MiB }), LIMITS),
    "yellow",
  );
}

// ---------------------------------------------------------------------------
// E' il picco a decidere, non il residuo
// ---------------------------------------------------------------------------
{
  const state = ledger({ committedBytes: 800 * MiB });
  // Un retarget che tiene insieme sorgente e destinazione: 80 MiB restano,
  // ma per un istante ne servono 160. Il residuo entra sotto 950, il picco no.
  const decision = planMemoryAdmission(
    state,
    LIMITS,
    request({ category: "retarget", steadyBytes: 80 * MiB, peakBytes: 160 * MiB }),
  );
  assert.equal(
    decision.outcome,
    "refuse",
    "un'operazione il cui residuo entra ma il cui picco no deve essere rifiutata",
  );

  const settled = planMemoryAdmission(
    state,
    LIMITS,
    request({ category: "retarget", steadyBytes: 80 * MiB, peakBytes: 80 * MiB }),
  );
  assert.equal(
    settled.outcome,
    "admit",
    "lo stesso residuo, senza il picco, entra: e' il picco a decidere",
  );

  assert.throws(
    () => planMemoryAdmission(
      state,
      LIMITS,
      request({ steadyBytes: 100, peakBytes: 10 }),
    ),
    /peakBytes/,
    "un picco sotto il residuo descrive un'operazione impossibile",
  );
}

// ---------------------------------------------------------------------------
// Il caso che il rollback non copre: due operazioni asincrone insieme
// ---------------------------------------------------------------------------
{
  const reservations = new MemoryReservationLedger();
  let state = ledger({ committedBytes: 800 * MiB });

  const first = request({ category: "glaze", steadyBytes: 60 * MiB, peakBytes: 70 * MiB });
  const firstDecision = planMemoryAdmission(state, LIMITS, first);
  assert.equal(firstDecision.outcome, "admit", "la prima operazione entra: 800+70 < 950");
  const token = reservations.reserve(first);
  state = { ...state, reservedBytes: reservations.pendingBytes };

  // Senza il termine `reserved`, questa seconda vedrebbe ancora 150 MiB liberi
  // e partirebbe: insieme sfonderebbero il tetto che nessuna delle due sfonda
  // da sola. E' esattamente il buco che il solo rollback non chiude.
  const second = request({ category: "effetti", steadyBytes: 80 * MiB, peakBytes: 90 * MiB });
  assert.ok(
    800 * MiB + 90 * MiB <= LIMITS.hardCapBytes - LIMITS.emergencyReserveBytes,
    "presupposto del test: da sola la seconda operazione entrerebbe",
  );
  const secondDecision = planMemoryAdmission(state, LIMITS, second);
  assert.equal(
    secondDecision.outcome,
    "refuse",
    "la memoria promessa a un'operazione in corso deve pesare sul tetto",
  );

  // Chiusa la prima, il picco si ritira e resta solo il residuo: 800+60=860.
  // La seconda ora entra esattamente al tetto, il che dimostra che a bloccarla
  // era la prenotazione e non un'allocazione gia' avvenuta.
  const steady = reservations.settle(token);
  assert.equal(steady, 60 * MiB);
  assert.equal(reservations.pendingBytes, 0);
  assert.equal(reservations.pendingCount, 0);
  state = ledger({ committedBytes: 860 * MiB });
  assert.equal(
    planMemoryAdmission(state, LIMITS, second).outcome,
    "admit",
    "860+90 = 950 sta esattamente al tetto utilizzabile",
  );
  assert.equal(
    planMemoryAdmission(
      ledger({ committedBytes: 860 * MiB + 1 }),
      LIMITS,
      second,
    ).outcome,
    "refuse",
    "un byte oltre il tetto e' fuori: il confine e' inclusivo, non elastico",
  );

  assert.throws(() => reservations.settle(token), /already closed/);
  assert.throws(() => reservations.release(token), /already closed/);
}

// ---------------------------------------------------------------------------
// Recupero: ammissione condizionata a liberare
// ---------------------------------------------------------------------------
{
  const state = ledger({ committedBytes: 900 * MiB, reclaimableBytes: 200 * MiB });
  const decision = planMemoryAdmission(
    state,
    LIMITS,
    request({ category: "blur", steadyBytes: 60 * MiB, peakBytes: 100 * MiB }),
  );
  assert.equal(decision.outcome, "reclaim");
  assert.equal(
    decision.reclaimBytes,
    50 * MiB,
    "va liberato esattamente lo scarto, non tutto il liberabile",
  );

  const insufficient = planMemoryAdmission(
    ledger({ committedBytes: 900 * MiB, reclaimableBytes: 10 * MiB }),
    LIMITS,
    request({ category: "blur", steadyBytes: 60 * MiB, peakBytes: 100 * MiB }),
  );
  assert.equal(insufficient.outcome, "refuse");
}

// ---------------------------------------------------------------------------
// La riserva d'emergenza non e' spendibile dal lavoro ordinario
// ---------------------------------------------------------------------------
{
  const state = ledger({ committedBytes: 940 * MiB });
  const normal = planMemoryAdmission(
    state,
    LIMITS,
    request({ category: "effetto", steadyBytes: 20 * MiB, peakBytes: 20 * MiB }),
  );
  assert.equal(
    normal.outcome,
    "refuse",
    "sotto il tetto ma dentro la riserva: deve restare spazio per salvare",
  );
  assert.equal(
    usableCeilingBytes(LIMITS, request({ priority: "normal" }), { strokeActive: false }),
    950 * MiB,
  );
}

// ---------------------------------------------------------------------------
// Il lavoro di sfondo si ritira sotto pressione anche quando entrerebbe
// ---------------------------------------------------------------------------
{
  const state = ledger({ committedBytes: 910 * MiB });
  const fits = request({ category: "prefetch", steadyBytes: 1 * MiB, peakBytes: 1 * MiB });
  assert.equal(memoryZoneFor(state, LIMITS), "orange");
  assert.equal(
    planMemoryAdmission(state, LIMITS, { ...fits, priority: "normal" }).outcome,
    "admit",
    "presupposto del test: c'e' spazio",
  );
  assert.equal(
    planMemoryAdmission(state, LIMITS, { ...fits, priority: "background" }).outcome,
    "refuse",
    "in arancione il prefetch si ferma anche se entrerebbe",
  );
  assert.equal(
    planMemoryAdmission(
      ledger({ committedBytes: 700 * MiB }),
      LIMITS,
      { ...fits, priority: "background" },
    ).outcome,
    "admit",
    "in verde il lavoro di sfondo procede",
  );
}

// ---------------------------------------------------------------------------
// Pressione a meta' tratto: non si rifiuta, si chiude il tratto
// ---------------------------------------------------------------------------
{
  const stroke = { strokeActive: true };
  const idle = { strokeActive: false };
  const pen = request({ category: "tile-penna", steadyBytes: 20 * MiB, peakBytes: 20 * MiB, priority: "interactive" });

  // Il tratto vivo dispone di meta' riserva in piu'.
  assert.equal(usableCeilingBytes(LIMITS, pen, idle), 950 * MiB);
  assert.equal(usableCeilingBytes(LIMITS, pen, stroke), 975 * MiB);

  // 940+20 = 960: fuori dal tetto a riposo (950), dentro quello del tratto (975).
  const state = ledger({ committedBytes: 940 * MiB });
  assert.equal(
    planMemoryAdmission(state, LIMITS, pen, idle).outcome,
    "refuse",
    "a riposo la stessa richiesta e' fuori",
  );
  assert.equal(
    planMemoryAdmission(state, LIMITS, pen, stroke).outcome,
    "admit",
    "dentro il tetto esteso il tratto continua",
  );

  // Nulla da liberare e nemmeno il tetto esteso basta: l'esito non e' un
  // fallimento di allocazione ma l'ordine di chiudere il tratto in modo pulito.
  const cornered = planMemoryAdmission(
    ledger({ committedBytes: 990 * MiB }),
    LIMITS,
    pen,
    stroke,
  );
  assert.equal(cornered.outcome, "end-stroke");
  assert.match(cornered.reason, /stroke/);
  // La zona guarda il tetto duro, l'ammissione guarda il tetto utilizzabile: si
  // puo' essere ancora in arancione e gia' fuori, perche' in mezzo c'e' la
  // riserva. Sono due domande diverse e non vanno confuse.
  assert.equal(cornered.zone, "orange");

  // La stessa situazione fuori dal tratto resta un rifiuto secco.
  assert.equal(
    planMemoryAdmission(ledger({ committedBytes: 990 * MiB }), LIMITS, pen, idle).outcome,
    "refuse",
    "senza un tratto vivo non c'e' niente da chiudere: si rifiuta e basta",
  );

  // Con del liberabile, il tratto non viene chiuso: si libera e si continua.
  const rescued = planMemoryAdmission(
    ledger({ committedBytes: 990 * MiB, reclaimableBytes: 100 * MiB }),
    LIMITS,
    pen,
    stroke,
  );
  assert.equal(rescued.outcome, "reclaim");
  assert.equal(rescued.reclaimBytes, 35 * MiB);

  // Una richiesta non interattiva non guadagna nulla dal tratto vivo.
  assert.equal(
    usableCeilingBytes(LIMITS, request({ priority: "normal" }), stroke),
    950 * MiB,
  );
}

// ---------------------------------------------------------------------------
// Ordine del sacrificio
// ---------------------------------------------------------------------------
{
  const sources = [
    { id: "undo-hot", bytes: 40 * MiB, rank: 3 },
    { id: "preview", bytes: 8 * MiB, rank: 0 },
    { id: "tile-clean", bytes: 30 * MiB, rank: 1 },
    { id: "tile-clean-grande", bytes: 50 * MiB, rank: 1 },
    { id: "vuota", bytes: 0, rank: 0 },
  ];

  // L'ordine dichiarato dal motore deve essere per costo di ricostruzione:
  // la cache di presentazione si rifa' in un frame, le superfici merged
  // costano una ricomposizione dello stack.
  assert.ok(
    core.MEMORY_RECLAIM_RANK.presentationCache < core.MEMORY_RECLAIM_RANK.layerThumbnail
      && core.MEMORY_RECLAIM_RANK.layerThumbnail < core.MEMORY_RECLAIM_RANK.mergedSurfaces,
    "i ranghi di recupero devono seguire il costo di ricostruzione",
  );

  const plan = planMemoryReclaim(sources, 60 * MiB);
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ["preview", "tile-clean-grande", "tile-clean"],
    "prima cio' che si rifa' da solo; a parita' di rango prima la sorgente piu' grande",
  );
  assert.equal(plan.reclaimedBytes, 88 * MiB);
  assert.equal(plan.sufficient, true);
  assert.ok(
    !plan.steps.some((step) => step.id === "vuota"),
    "una sorgente vuota non entra nel piano",
  );

  const impossible = planMemoryReclaim(sources, 500 * MiB);
  assert.equal(impossible.sufficient, false);
  assert.equal(impossible.reclaimedBytes, 128 * MiB);

  assert.equal(planMemoryReclaim(sources, 0).steps.length, 0);
}

// ---------------------------------------------------------------------------
// Prova che la suite e' portante: mutando la riga che conta le prenotazioni,
// il caso delle due operazioni asincrone deve tornare a passare.
// ---------------------------------------------------------------------------
{
  const mutated = coreSource.replace(
    "return ledger.committedBytes + ledger.reservedBytes + ledger.inFlightBytes;",
    "return ledger.committedBytes + ledger.inFlightBytes;",
  );
  assert.notEqual(mutated, coreSource, "la mutazione deve applicarsi davvero");

  const broken = await importCore(mutated);
  const state = {
    committedBytes: 800 * MiB,
    reservedBytes: 70 * MiB,
    reclaimableBytes: 0,
    inFlightBytes: 0,
  };
  const decision = broken.planMemoryAdmission(
    state,
    LIMITS,
    request({ category: "effetti", steadyBytes: 80 * MiB, peakBytes: 90 * MiB }),
  );
  assert.equal(
    decision.outcome,
    "admit",
    "senza il termine `reserved` la seconda operazione verrebbe ammessa: "
    + "e' il difetto che questa suite deve intercettare",
  );
}

console.log("memory governor: OK");
