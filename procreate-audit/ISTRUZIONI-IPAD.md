# Test reale Procreate — primo giro

Obiettivo: misurare dai byte PNG, senza giudizi visivi:

1. come Light Glaze accumula gli stamp nella stessa gesture;
2. come Uniformed Glaze accumula gli stamp nella stessa gesture;
3. cosa cambia quando si alza il dito;
4. se il compositing colore è più vicino a gamma/sRGB encoded oppure lineare.

Non usare screenshot, WhatsApp o Discord: possono ridimensionare o convertire i
colori. Salva sempre gli originali PNG nell'app File.

## File da portare sull'iPad

Dalla cartella `guides`:

- `01-accumulation-guide.png`
- `02-color-space-guide.png`
- `03-shape-hard-circle-white-on-black.png`
- `04-shape-hard-circle-black-on-white.png` solo se la prima Shape appare
  invertita.

## 1. Crea il pennello AUDIT-1

In Procreate:

1. Apri Brushes, premi `+`, poi `Create new brush`.
2. In Shape apri `Edit → Import → Import a file` e scegli
   `03-shape-hard-circle-white-on-black.png`.
3. Se l'anteprima mostra l'esterno pieno e il cerchio vuoto, inverti la Shape
   oppure importa il file `04-...black-on-white.png`.
4. Imposta i controlli seguenti.

### Stroke Path

- Spacing `100%`
- Spacing Jitter `0%`
- Jitter Lateral `0%`
- Jitter Linear `0%`
- Fall Off `None/0`

### Stabilization

- StreamLine Amount e Pressure `0`
- Stabilization `0`
- Motion Filtering Amount ed Expression `0`

### Taper

- Pressure Taper e Touch Taper: lunghezza zero
- Size, Opacity, Pressure e Tip `0`

### Shape

- Input style `Touch only`
- Rotation `0`
- Scatter `0`
- Count Jitter `0`
- Randomized, Flip X e Flip Y disattivati
- Pressure/Tilt Roundness e Roundness Jitter `0`
- Shape Filtering `No Filtering`

### Grain

- Depth `0%`
- Depth Minimum e Depth Jitter `0`
- Offset Jitter disattivato
- Grain Blend Mode `Normal`
- Grain Filtering `No Filtering`

### Rendering

- Flow: verrà indicato per ogni prova
- Wet Edges `0`
- Burnt Edges `0`
- Blend Mode `Normal`
- Luminance Blending disattivato
- Alpha Threshold disattivato
- Classic Normal Combine disattivato

### Wet Mix

- Dilution `0`
- Charge `100`
- Attack `0`
- Pull, Grade e Blur `0`
- Blur Jitter e Wetness Jitter `0`

### Color Dynamics e Dynamics

- Tutti i Color Jitter e Secondary Color `0`
- Speed Size/Opacity/Spacing `0`
- Jitter Size/Opacity `0`

### Apple Pencil e Properties

Useremo il dito, ma per sicurezza:

- Apple Pencil Pressure Size/Opacity/Flow/Bleed `0`
- Tilt e Barrel Roll che cambiano Size/Opacity/Color `0`
- Properties: Maximum Opacity `100%`, Minimum Opacity `0%`

Salva il pennello e rinominalo `AUDIT-1`.

## 2. Light Glaze

1. Apri `01-accumulation-guide.png` dall'app File in Procreate.
2. Spegni `Background Color`.
3. Crea sopra la guida un nuovo layer trasparente chiamato `TEST`.
4. Seleziona `AUDIT-1`.
5. Rendering Mode `Light Glaze`.
6. Rendering Flow `50%`.
7. Sidebar Opacity `50%`.
8. Colore `#FFFFFF`.
9. Regola la Size affinché un singolo stamp resti dentro il cerchio bersaglio.
10. Usa il **dito**, non Apple Pencil.

Esegui i bersagli:

- `C1`: Shape Count `1`, un solo tap.
- `C2`: Shape Count `2`, un solo tap.
- `C4`: Shape Count `4`, un solo tap.
- Riporta Shape Count a `1`.
- `G1`: un tap.
- `G2`: due tap, alzando completamente il dito tra i due.
- `G4`: quattro tap, alzando completamente il dito ogni volta.

Per esportare:

1. Nascondi la guida.
2. Controlla che `Background Color` sia ancora spento.
3. Deve restare visibile soltanto il layer `TEST`.
4. `Actions → Share → PNG → Save to Files`.
5. Nome esatto: `light-glaze.png`.

## 3. Uniformed Glaze

1. Riattiva la guida.
2. Cancella il layer TEST e creane uno nuovo trasparente.
3. Cambia soltanto Rendering Mode in `Uniformed Glaze`.
4. Lascia Flow `50%`, sidebar Opacity `50%`, bianco e Count `1`.
5. Ripeti esattamente C1/C2/C4 e G1/G2/G4.
6. Nascondi guida e Background Color.
7. Esporta PNG col nome `uniformed-glaze.png`.

## 4. Spazio colore

1. Apri una nuova copia di `02-color-space-guide.png` in Procreate.
2. Spegni `Background Color`.
3. Dipingi **direttamente sul layer della guida**, non su un nuovo layer.
4. Seleziona `AUDIT-1`.
5. Rendering Mode `Uniformed Glaze`.
6. Rendering Flow `100%`.
7. Sidebar Opacity `50%`.
8. Shape Count `1`.
9. Usa il dito e fai esattamente un tap per bersaglio:

   - primo bersaglio: colore bianco `#FFFFFF`;
   - secondo bersaglio: ancora bianco `#FFFFFF`;
   - terzo bersaglio: nero `#000000`;
   - quarto bersaglio: rosso `#FF0000`.

10. Esporta PNG col nome `color-space.png`.

## 5. Esporta il pennello

Nella libreria Brushes:

1. scorri verso sinistra sul pennello `AUDIT-1`;
2. premi `Share`;
3. salva `AUDIT-1.brush` nell'app File.

## File da rimandare

- `light-glaze.png`
- `uniformed-glaze.png`
- `color-space.png`
- `AUDIT-1.brush`
- una foto/screenshot della schermata che mostra versione/build di Procreate

Non serve interpretare il risultato: l'analizzatore troverà automaticamente il
centro effettivo dei tocchi e confronterà i byte con i modelli candidati.
