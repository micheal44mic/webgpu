/**
 * Tetti di memoria per classe di dispositivo.
 *
 * Il governor non puo' ricavare il proprio tetto dal browser: il web non espone
 * l'impronta di processo. L'unica fonte possibile e' una **misura**, e nel
 * motore ne esiste gia' una — il test di limite memoria registra per ogni
 * dispositivo l'ultimo totale contato sopravvissuto (`lastSafeMiB`) e il picco
 * piu' alto osservato. Questo modulo e' il punto in cui quei run diventano un
 * numero operativo.
 *
 * I valori qui sotto sono **provvisori** e dichiarati tali: reggono finche' non
 * arrivano i run reali, e vanno sostituiti dal minimo dei `lastSafeMiB` per
 * classe di dispositivo. Un tetto inventato che nessuno rivede e' esattamente
 * il difetto che questo repo ha gia' pagato altrove.
 */
import { MOBILE_DEVICE_CLASS } from "./engine-limits";
import {
  type MemoryGovernorLimits,
  memoryGovernorLimitsFromObservedCeiling,
} from "./memory-governor-core";

const MEBIBYTE_BYTES = 1024 * 1024;

/**
 * Tetto osservato su iPhone. WebKit termina la scheda intorno al gibibyte di
 * memoria **di processo**, quindi il valore include heap JavaScript e RAM dei
 * livelli compressi, non solo le risorse GPU. Il margine applicato dal core
 * copre proprio la parte che il registro non vede.
 *
 * Provvisorio: da sostituire col minimo dei `lastSafeMiB` misurati.
 */
export const MOBILE_OBSERVED_CEILING_BYTES = 1000 * MEBIBYTE_BYTES;

/**
 * Su desktop non c'e' un muro equivalente. Il tetto resta utile come rete
 * contro una crescita fuori controllo, quindi e' largo ma non infinito: un
 * governor senza tetto non e' un governor.
 *
 * Provvisorio.
 */
export const DESKTOP_OBSERVED_CEILING_BYTES = 4096 * MEBIBYTE_BYTES;

export const MEMORY_GOVERNOR_CALIBRATION_SOURCE =
  "provisional-not-yet-measured" as const;

export function observedCeilingBytesForDeviceClass(mobile: boolean): number {
  return mobile ? MOBILE_OBSERVED_CEILING_BYTES : DESKTOP_OBSERVED_CEILING_BYTES;
}

export function memoryGovernorLimitsForDeviceClass(
  mobile: boolean = MOBILE_DEVICE_CLASS,
): MemoryGovernorLimits {
  return memoryGovernorLimitsFromObservedCeiling(
    observedCeilingBytesForDeviceClass(mobile),
  );
}
