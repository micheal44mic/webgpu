# Design QA — Mobile brush size and opacity controls

## Evidence

- Source visual truth:
  - `C:\Users\michi\AppData\Local\Temp\codex-clipboard-8ac23c25-08a7-4881-9191-962c8d9dc4ce.png` — resting state.
  - `C:\Users\michi\AppData\Local\Temp\codex-clipboard-a1f60da0-b3a5-4050-8d84-349b707eac30.png` — Size 50% active state.
  - `C:\Users\michi\AppData\Local\Temp\codex-clipboard-481b4d29-efdf-40f7-882a-ac49d1d4330f.png` — Size 1% active state.
- Browser-rendered implementation:
  - `C:\Users\michi\Downloads\webgpu-brush-engine-source\artifacts\mobile-brush-controls-idle-final-430x932.png`.
  - `C:\Users\michi\Downloads\webgpu-brush-engine-source\artifacts\mobile-brush-controls-size-active-postfix-430x932.png`.
  - `C:\Users\michi\Downloads\webgpu-brush-engine-source\artifacts\mobile-brush-controls-size-min-postfix-430x932.png`.
  - `C:\Users\michi\Downloads\webgpu-brush-engine-source\artifacts\mobile-brush-controls-opacity-393x852.png`.
  - Pixel-range correction at maximum: `C:\Users\michi\Downloads\webgpu-brush-engine-source\artifacts\mobile-brush-controls-size-max-1000px-430x932.png`.
  - Pixel-range correction at minimum: `C:\Users\michi\Downloads\webgpu-brush-engine-source\artifacts\mobile-brush-controls-size-min-1px-430x932.png`.
  - Compact responsive check: `C:\Users\michi\Downloads\webgpu-brush-engine-source\artifacts\mobile-brush-controls-idle-375x667.png`.
- Full-state comparison: `C:\Users\michi\Downloads\webgpu-brush-engine-source\artifacts\mobile-brush-controls-reference-comparison.png`.
- Focused control comparison: `C:\Users\michi\Downloads\webgpu-brush-engine-source\artifacts\mobile-brush-controls-focused-comparison.png`.

## Normalization and state

- Source pixels: `1290 × 2796`, corresponding to `430 × 932` CSS px at `3×` density.
- Primary implementation capture: `430 × 932` pixels at a `430 × 932` CSS viewport and device scale factor `1`.
- The source was downsampled to `430 × 932` for equal-size comparison; no crop or aspect-ratio change was applied.
- Additional implementation checks used `393 × 852` and `375 × 667` CSS viewports at density `1`.
- Compared states: both controls resting; Size near the middle; Size at `1 px` and `1000 px`; Opacity active; Paint/Blend availability; Tools and Layers overlays.
- The control is intentionally mirrored to the right edge and uses the app's existing dark background because those were explicit product requirements, not fidelity defects.

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- Fonts and typography: the compact numeric label is readable, single-line, and uses the existing UI family/weight without truncation.
- Spacing and layout rhythm: both 44 px discs remain half exposed at the right edge; their 52 × 56 px touch targets and vertical courses stay inside all tested viewports. The active panel remains within the canvas area.
- Colors and tokens: neutral off-white, muted inactive gray, app-background panel, and `#dd5c35` active outline follow the established mobile tokens.
- Image quality and asset fidelity: the preview is rendered on a dedicated DPR-aware Canvas2D surface from the selected tip shape and hardness; no placeholder image, GPU readback, or scaled raster asset is used.
- Copy and content: labels use the corrected `Size N px` contract; only `Opacity N%` remains percentage-based.
- At `1 px`, the stamp preview becomes effectively invisible; at `1000 px`, the inner indicator reaches the complete `41 px` usable diameter of the 44 px control.

## Comparison history

- Iteration 1 — P2: the active Size thumb could be visually covered by the preview panel in the first capture (`C:\Users\michi\Downloads\webgpu-brush-engine-source\artifacts\mobile-brush-controls-size-active-prefix-393x852.png`).
  - Fix: assigned the active thumb stacking level above the preview panel.
  - Post-fix evidence: `C:\Users\michi\Downloads\webgpu-brush-engine-source\artifacts\mobile-brush-controls-size-active-postfix-430x932.png` and the focused comparison show the orange-outlined thumb attached visibly to the panel edge.
- Final pass: no further P0/P1/P2 issue was found in the normalized full-state or focused comparison.
- Iteration 2 — P1: Size was incorrectly exposed as `1–100%`, and the maximum inner indicator used only 18 px of the available disc.
  - Fix: changed the mobile and desktop UI contract to `1–1000 px`, kept only track position normalized, and expanded the maximum indicator to the full 41 px interior.
  - Post-fix evidence: the two new `1 px` and `1000 px` browser captures listed above; runtime measurements report exactly 1 px and 41 px indicator diameters.

## Interaction and runtime checks

- Vertical drag changes Size and Opacity; horizontal position is ignored.
- Size clamps to `1–1000 px`; Opacity clamps to `0–100%`; keyboard arrows, Home, and End are supported.
- The visible value and inner disc update during the gesture; engine settings commit once at gesture end.
- The preview uses a dedicated Canvas2D surface and one `requestAnimationFrame` at a time; the drawing hot path and WebGPU submissions are untouched during slider movement.
- Size remains available for Paint and Blend; Opacity is disabled for Blend.
- Controls are suppressed while the Tools sheet or Layers panel is open.
- Browser console warnings/errors after the final initialized state: none.
- TypeScript, production build, layer, grain, stroke, and history verification suites: passed.

## Implementation checklist

- [x] Right-edge resting controls and value indicators.
- [x] Vertical drag, bounds, keyboard semantics, and ARIA values.
- [x] Live Size/Opacity panel and actual tip preview.
- [x] Paint/Blend and overlay integration.
- [x] Compact mobile responsiveness.
- [x] No per-move engine/GPU setting commits.

final result: passed
