# Avvio rapido e novità del pennello

Questa guida serve per riprendere il progetto senza dover ricostruire ogni volta i passaggi di avvio e di prova delle ultime modifiche.

## Requisiti

- Node.js 22 o successivo.
- Un browser aggiornato con WebGPU attivo (Chrome, Edge o Safari recente).

## Avvio in sviluppo

Dalla cartella del progetto esegui:

```bash
npm install
npm run dev
```

Apri l'indirizzo indicato dal terminale; normalmente è `http://localhost:5173`.

`npm install` serve solo la prima volta, oppure quando cambiano le dipendenze. Per gli avvii successivi basta `npm run dev`.

## Build di produzione

Per controllare che TypeScript e la build del sito siano validi:

```bash
npm run build
```

Per aprire localmente la build generata:

```bash
npm run preview
```

## Nuove impostazioni

### Dimensione

Il cursore **Dimensione** ora va da **4 px a 1500 px**. Il motore applica lo stesso limite anche internamente, quindi il valore resta valido anche se impostato via codice.

### Jitter posizione

Nella sezione **Jitter posizione** ci sono due controlli indipendenti:

- **Laterale** — sposta casualmente ogni impronta a destra o sinistra, in modo perpendicolare alla direzione della pennellata.
- **Lineare** — sposta casualmente ogni impronta in avanti o indietro, lungo la direzione della pennellata.

I due valori sono espressi in percentuale. Al 100%, lo scostamento massimo in ogni asse è pari al raggio corrente del pennello. Entrambi partono da `0%`, quindi un pennello appena aperto mantiene il comportamento precedente.

Il jitter posizione è separato dal **Color jitter**: il suo valore di intensità globale non modifica gli spostamenti laterale e lineare.

## Prova consigliata

Per verificare velocemente l'effetto:

1. Imposta **Dimensione** a `300 px` o più.
2. Porta **Laterale** a `25%`.
3. Disegna una linea continua: le impronte si distribuiranno ai lati del percorso.
4. Aggiungi **Lineare** tra `10%` e `20%` per variare anche la posizione lungo il percorso.
5. Riporta entrambi a `0%` per tornare a un tratto regolare.

Per un effetto organico ma ancora controllato, un buon punto di partenza è Laterale `15–30%` e Lineare `5–15%`.
