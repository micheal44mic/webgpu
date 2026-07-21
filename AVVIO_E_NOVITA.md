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

- **Laterale** — sposta casualmente ogni copia fisica a destra o sinistra, in modo perpendicolare alla direzione della pennellata.
- **Lineare** — sposta casualmente ogni copia fisica in avanti o indietro, lungo la direzione della pennellata.

I due valori sono espressi in percentuale. Al 100%, lo scostamento massimo in ogni asse è pari al diametro corrente del pennello. Entrambi partono da `100%`, così un click mostra subito le copie fisiche impostate da `Count`.

Il jitter posizione è separato dal **Color jitter**: il suo valore di intensità globale non modifica gli spostamenti laterale e lineare. `Count` indica quante copie fisiche vengono create per ogni punto di spacing; con jitter a `0%` queste copie sono sovrapposte, mentre aumentando Laterale o Lineare diventano visibili come stamp distinti.

## Prova consigliata

Per verificare velocemente l'effetto:

1. Imposta **Dimensione** a `300 px` o più.
2. Porta **Laterale** a `25%`.
3. Disegna una linea continua: le impronte si distribuiranno ai lati del percorso.
4. Aggiungi **Lineare** tra `10%` e `20%` per variare anche la posizione lungo il percorso.
5. Riporta entrambi a `0%` per tornare a un tratto regolare.

Per un effetto organico ma ancora controllato, un buon punto di partenza è Laterale `15–30%` e Lineare `5–15%`.

## Benchmark con tratto umano

La sezione **Benchmark** include un test ripetibile basato su una tua pennellata reale.

1. Premi **Registra tratto umano**.
2. Disegna una pennellata continua sul canvas: vengono registrati posizione nel layer, pressione e tempo di ogni campione.
3. Premi **Play tratto registrato** per riprodurla con la stessa durata e gli stessi campioni.

La registrazione applica il preset di confronto: dimensione `750 px`, spacing `1%`, Count `16`, Flow `100%`, Hardness `100%`, Hue al massimo (`180°`), Saturation `100%`, color jitter per copia e jitter Laterale/Lineare al `100%`. Le altre impostazioni vengono salvate assieme al tratto.

Alla fine di ogni Play compaiono durata, numero di campioni, stamps base, copie fisiche, tempo di coda GPU e ultimo CPU frame. Prima di ogni Play il seed del jitter viene resettato, quindi posizione, pressione, tempi e casualità restano identici tra le ripetizioni. Il tratto resta salvato solo nel browser del dispositivo, quindi può essere ripetuto dopo un refresh senza inviare dati all'esterno.
