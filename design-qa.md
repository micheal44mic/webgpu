# Design QA — Ombra singola testo

## Evidence

- Reference: `C:\Users\michi\AppData\Local\Temp\vector-text-single-shadow-qa\reference-kittl-single-shadow-blur-6.jpg`
- Implementation: `C:\Users\michi\AppData\Local\Temp\vector-text-single-shadow-qa\implementation-local-single-shadow-blur-6.jpg`
- Focused comparison: `C:\Users\michi\AppData\Local\Temp\vector-text-single-shadow-qa\comparison-focused-single-shadow-blur-6.png`
- Full comparison: `C:\Users\michi\AppData\Local\Temp\vector-text-single-shadow-qa\comparison-full-single-shadow-blur-6.png`
- Browser viewport and screenshot size: `1138 × 912`, identical for reference and implementation.

## Compared state

- Kittl: single text shadow, color `#727272`, opacity `100%`, Offset `54`, Angle `-180°`, Blur `6`, Outline Width `0`.
- Local app: the same shadow parameters, Block Shadow disabled, text selected at high zoom.
- Comparison scope: the shadow behavior and its relationship to the source glyph and selection bounds. Kittl's project font, photographic canvas, editor chrome, and the local app's checkerboard are context rather than clone targets.

## Findings

- One offset silhouette is rendered; the implementation does not build repeated text copies.
- Blur softens the silhouette's alpha edge while its central coverage stays full.
- The source text remains sharp and is composited above the shadow.
- Outline Width is fixed and disabled at `0`.
- The text selection bounds are unchanged between Blur `0` and Blur `6`; neither offset nor blur expands the node bbox.
- No P0, P1, or P2 visual mismatch was found in the scoped behavior.

## Interaction and runtime checks

- Blur `0 → 6 → 0 → 6`: passed.
- Block Shadow and Single Shadow mutual exclusion in both directions: passed.
- Blur cache creation, release at Blur `0`/effect OFF, and rebuild: passed.
- Fit view logical browser cache at Blur `6`: `0.18 MiB`.
- High-zoom logical browser cache at Blur `6`: `1.97 MiB`.
- App-owned GPU allocation attributable to this effect: `+0 MiB`.
- Console warnings/errors after the interaction sequence: none.

## Verification

- All 13 project verification suites: passed.
- TypeScript check and production Vite build: passed.
- Build warning about the existing large main chunk is unchanged and unrelated to the effect.

## Result

passed
