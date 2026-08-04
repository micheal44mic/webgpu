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
- Compared states: both controls resting; Size near the middle; Size at `1 px` and `1000 px`; Opacity at `0%`, `50%`, and `100%`; Paint/Blend availability; Tools and Layers overlays.
- The control is intentionally mirrored to the right edge and uses the app's existing dark background because those were explicit product requirements, not fidelity defects.

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- Fonts and typography: the compact numeric label is readable, single-line, and uses the existing UI family/weight without truncation.
- Spacing and layout rhythm: both 44 px discs remain half exposed at the right edge; their 52 × 56 px touch targets and vertical courses stay inside all tested viewports. The active panel remains within the canvas area.
- Colors and tokens: neutral off-white, muted inactive gray, app-background panel, and `#dd5c35` active outline follow the established mobile tokens.
- Image quality and asset fidelity: the preview is rendered on a dedicated DPR-aware Canvas2D surface from the selected tip shape and hardness; no placeholder image, GPU readback, or scaled raster asset is used.
- Copy and content: labels use the corrected `Size N px` contract; only `Opacity N%` remains percentage-based.
- At `1 px`, the stamp preview becomes effectively invisible; at `1000 px`, the Size indicator reaches the complete `41 px` usable diameter of the 44 px control.
- The Opacity indicator now uses the same fill language: `0%` is empty, `50%` measures `20.5 px`, and `100%` fills the complete `41 px` interior.

## Comparison history

- Iteration 1 — P2: the active Size thumb could be visually covered by the preview panel in the first capture (`C:\Users\michi\Downloads\webgpu-brush-engine-source\artifacts\mobile-brush-controls-size-active-prefix-393x852.png`).
  - Fix: assigned the active thumb stacking level above the preview panel.
  - Post-fix evidence: `C:\Users\michi\Downloads\webgpu-brush-engine-source\artifacts\mobile-brush-controls-size-active-postfix-430x932.png` and the focused comparison show the orange-outlined thumb attached visibly to the panel edge.
- Final pass: no further P0/P1/P2 issue was found in the normalized full-state or focused comparison.
- Iteration 2 — P1: Size was incorrectly exposed as `1–100%`, and the maximum inner indicator used only 18 px of the available disc.
  - Fix: changed the mobile and desktop UI contract to `1–1000 px`, kept only track position normalized, and expanded the maximum indicator to the full 41 px interior.
  - Post-fix evidence: the two new `1 px` and `1000 px` browser captures listed above; runtime measurements report exactly 1 px and 41 px indicator diameters.
- Iteration 3 — P1: Opacity retained a fixed 18 px inner disc and encoded the value only by fading its alpha, so `100%` did not fill the control.
  - Fix: changed Opacity to a proportional `0–41 px` diameter with a solid off-white fill, matching the Size control's visual language.
  - Post-fix evidence: browser runtime measurements at `430 × 932` report exactly `0 px`, `20.5 px`, and `41 px` at `0%`, `50%`, and `100%`; the console contains no warning or error.

## Interaction and runtime checks

- Vertical drag changes Size and Opacity; horizontal position is ignored.
- Size clamps to `1–1000 px`; Opacity clamps to `0–100%`; keyboard arrows, Home, and End are supported.
- The visible value and proportional inner disc update during the gesture; engine settings commit once at gesture end.
- The preview uses a dedicated Canvas2D surface and one `requestAnimationFrame` at a time; the drawing hot path and WebGPU submissions are untouched during slider movement.
- Size remains available for Paint and Blend; Opacity is disabled for Blend.
- Controls are suppressed while the Tools sheet or Layers panel is open.
- Browser console warnings/errors after the final initialized state: none.
- TypeScript, production build, layer, grain, stroke, and history verification suites: passed.

### Tools sheet closure follow-up

- A downward flick of at least `28 px` at `0.45 px/ms` closes directly from the expanded snap instead of stopping at peek.
- From peek, a `36 px` downward push closes the sheet; from expanded, a slow drag still lands on peek unless it passes that snap by `36 px`.
- Deterministic boundary checks cover fast/slow expanded gestures, `35/36 px` peek gestures, and the past-peek close path. Mobile browser QA confirms both anchors, full Tools-button closure, and a clean console.

## Implementation checklist

- [x] Right-edge resting controls and value indicators.
- [x] Vertical drag, bounds, keyboard semantics, and ARIA values.
- [x] Live Size/Opacity panel and actual tip preview.
- [x] Paint/Blend and overlay integration.
- [x] Compact mobile responsiveness.
- [x] No per-move engine/GPU setting commits.

final result: passed

# Design QA — Mobile Stroke Effect Sheet

## Visual sources and normalization

- Source visual truth: `C:\Users\michi\AppData\Local\Temp\codex-clipboard-ffd73bba-7aed-43a6-bf79-b5f44f50f204.png` (`554 × 186` pixels).
- Primary implementation: [mobile-stroke-sheet-393x852.png](design-qa-assets/mobile-stroke-sheet-393x852.png), captured at a `393 × 852` CSS viewport and density `1`.
- Open dropdown: [mobile-stroke-alignment-menu-393x852.png](design-qa-assets/mobile-stroke-alignment-menu-393x852.png).
- Compact implementation: [mobile-stroke-sheet-360x640.png](design-qa-assets/mobile-stroke-sheet-360x640.png), captured at a `360 × 640` CSS viewport and density `1`.
- Focused same-frame comparison: [mobile-stroke-reference-comparison.png](design-qa-assets/mobile-stroke-reference-comparison.png). The implementation control was cropped to `285 × 96` and bicubic-scaled to the source frame's `554 × 186` pixels; their aspect ratios differ by less than `0.5%`.
- Compared states: sheet at its only open snap, default `Outside`, alignment listbox open, and committed `Inside` selection.

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- Fonts and typography: `Stroke`, field labels, and alignment values use the existing mobile UI family and hierarchy. The implementation label is deliberately firmer than the reference's generic system font to remain consistent with every existing tool surface.
- Spacing and layout rhythm: the sheet exposes exactly `222 px` at `393 × 852` (`top = 630 px`) and `166 px` at `360 × 640` (`top = 474 px`), matching the Tools peek formula `clamp(160 px, 26dvh, 240 px)`. Controls end at `614.23 px` in the compact viewport, with no clipping or root scroll (`app.scrollTop = 0`).
- Colors and visual tokens: background `#0d0f13`, neutral card `#292c33`, off-white icon/text, muted labels, and orange focus/selection reuse the established mobile tokens. There are no shadows or decorative gradients.
- Image and icon fidelity: the source's square affordance and dropdown marker are represented by official Lucide `SquareDashed`, `ChevronDown`, and `Check` icons. No inline SVG, CSS drawing, emoji, or raster placeholder was introduced.
- Copy and content: all visible copy is English: `Stroke`, `Color`, `Alignment`, `Outside`, `Inside`, and `Centered`. The UI label `Centered` maps to the authoritative engine value `center`.
- The focused comparison confirms the reference's dark rounded card, left square icon, central value, and right-side dropdown affordance while adapting the control to the product's smaller mobile density.

## Comparison history

- Initial QA found one P2 semantic mismatch: the tool card still announced `Toggle Stroke`, although its new behavior opens and activates the settings rather than toggling the effect off.
  - Fix: changed the accessible name to `Open Stroke settings` and added a static regression.
  - Post-fix evidence: the initialized compact browser state exposes the corrected action; `stroke-ui:verify` passes.
- Final focused and full-view comparisons found no remaining P0/P1/P2 issue.

## Interaction and runtime checks

- Opening Stroke from the filtered Tools result closes Tools and opens this sheet at the low snap; it never opens at the expanded Tools position.
- Selecting `Inside` updates the trigger and the authoritative desktop mirror: `data-stroke-alignment = inside` and `#rasterStrokePosition = inside`.
- The listbox exposes exactly three options with one selected state, keyboard focus, outside-click/Escape closure, and 44 px option targets.
- An upward synthetic drag left the measured sheet top unchanged at `630 px`, confirming the no-expand clamp.
- Handle tap closes the sheet and restores `aria-hidden = true`. The in-app browser could not reliably synthesize a captured-pointer release for the downward drag; deterministic controller assertions cover the `36 px` close threshold and the same code remains to be checked on physical Safari/iPhone.
- Browser console warnings/errors after initialization: none.
- All `25` `*:verify` suites (including `stroke-ui:verify`), TypeScript, production Sites build, and `git diff --check`: passed.

final result: passed

# Design QA — Mobile Brush Library

## Scope and evidence

- Local browser QA: `430 × 932` and compact `375 × 667` mobile viewports.
- States checked: Painting selected, Pencil empty, open/close, Paint-from-Blend
  first tap, Paint-active second tap, Tools mutual exclusion, Size/Opacity
  suppression and responsive overflow.
- The implementation has no custom/preset storage yet, so the only truthful
  library item is `Current Brush`; Pencil and Spray Paint intentionally show
  `Brushes coming soon`.

## Findings

- No actionable P0, P1 or P2 issue remains in the tested states.
- The expanded sheet begins at `y = 77 px`, preserving the requested `25 px`
  gap below the 52 px header, and ends at the bottom safe edge.
- At `375 px` viewport width the two-column layout has `347 px` client and
  scroll width: there is no horizontal overflow. The category column remains
  `88 px`; the brush card measures `247 px`.
- The selected card uses the orange border and darker active surface; its name
  remains off-white at the top-right and the representative stroke remains
  off-white for legibility on the dark sheet.
- The stroke preview is DPR-aware Canvas2D and is rendered lazily from current
  tip/Hardness plus representative settings. It does not submit GPU work,
  read textures back, or mutate brush settings.
- Console warnings/errors after initialization: none.

## Verification

- [x] TypeScript and production Sites build.
- [x] Layer/mobile UI static regression, including a no-GPU preview guard.
- [x] Grain, Stroke and History verification suites.
- [x] Mobile layout at `430 × 932` and `375 × 667`.
- [x] Category empty state and first/second Brush tap semantics.
- [x] Tools/Layers/Brush Library mutual exclusion.

final result: passed

# Design QA — Mobile Brush Studio

## Visual sources

- Rendering selector: `C:\Users\michi\AppData\Local\Temp\codex-clipboard-b0d58a89-5ac6-4f8e-a25a-2f1d22464832.png`
- Source card: `C:\Users\michi\AppData\Local\Temp\codex-clipboard-f62e90f6-21ba-4db3-8320-046787a5b7e4.png`
- Verified implementation: [brush-studio-pencil-393x852.png](design-qa-assets/brush-studio-pencil-393x852.png)
- Combined comparison: [brush-studio-reference-comparison.png](design-qa-assets/brush-studio-reference-comparison.png)

## Scope and viewports

- Primary comparison viewport: `393 × 852`.
- Compact-phone regression viewport: `360 × 640`.
- Mobile sheet top: `77 px`; bottom and sticky category bar remain aligned with the viewport.
- Source card intentionally omits the reference curve graph and Color button, as requested.
- Rendering labels intentionally use the three real engine modes: Light Glaze, Uniformed Glaze, and Intense Blending.

## Visual review

- The selected segmented option preserves the light active fill and dark inactive rail from the reference while using the product's existing neutral and orange tokens.
- Shape and Grain source cards use a real thumbnail, Invert, Replace, and Remove without decorative effects or shadows.
- Preview, scrollable controls, and the four-category footer fit without horizontal overflow at both tested phone sizes.
- One P1 layout issue was found during QA: switching footer tabs could programmatically scroll the hidden app root. Mobile root scrolling is now clipped and the controller restores root scroll after a tab change. Recapture confirms `app.scrollTop = 0`, sheet top `77 px`, and footer bottom equal to viewport height.
- One P2 accessibility issue was fixed: Shape and Grain file inputs now have distinct accessible names instead of inheriting both Select and Replace labels.

## Functional review

- A first tap selects Pencil; a second tap on the selected card opens Brush Studio expanded.
- Size changes update the live preview once per animation frame.
- Cancel restores the exact opening settings; verified with Size `96 → 300 → 96`.
- Done persists settings; verified with Size `96 → 222`, Studio reopen, and full page reload.
- The sheet handle tap uses Cancel semantics and restores `333 → 222`; drag-close uses the same tested close-threshold helper as the Tools and Library sheets.
- Real PNG Shape import registered a `custom-shape:*` asset, loaded the GPU Shape resource, and Cancel restored `pencil-shape`.
- Shape, Grain, and Dynamics tabs expose the Pencil values supplied by the user, including Scatter `51%`, Count `1`, Moving Grain, Scale `43%`, Movement `99%`, and thickness `100% / 60%`.
- Console review found zero warnings and zero errors.
- TypeScript, production build, all `*:verify` suites, `brush-studio:verify`, and `git diff --check` passed.

Physical Safari/iPhone touch QA and canonical performance measurement remain separate follow-up work; this pass validates the local mobile browser implementation and does not claim a new performance baseline.

final result: passed
