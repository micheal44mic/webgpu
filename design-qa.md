# M1M4 Project Home — Design QA

Date: 2026-08-12

## Visual target

- Implementation capture: `design-qa-assets/project-home-393x852.png`
- Product hierarchy: brand header, icon navigation, one primary content surface, canvas creation flow, recent-project grid.
- `M1M4.COM` is top-right, navigation has exactly `Projects` and `New Canvas`, and the established orange/dark editor tokens define the palette.

## Responsive checks

- 393 × 852: passed. Brand, two tabs, empty state, primary action, safe-area footer, and vertical scrolling fit without horizontal overflow.
- 1440 × 900: passed. Content remains centered, recent-project grid expands, and the brand remains top-right.
- Narrow mobile behavior is covered by the 390 px breakpoint: the project grid switches to one column and the canvas form remains scrollable.

## Interaction checks

- Projects/New Canvas pointer navigation: passed.
- ArrowLeft/ArrowRight tab navigation and roving `tabIndex`: passed.
- Compact preset synchronizes Width and Height to 2048 and updates `aria-pressed`: passed.
- Studio preset exposes 4096 × 4096 and remains the recommended default: passed.
- Create 2048 project → editor: passed in WebGPU browser.
- Initial blank project commit: passed; Save reports `Project saved` and the URL is replaced with the durable project id.
- Back to Projects → recent card: passed; card shows title, date, resolution and stored size.
- Rename/Delete controls are present with explicit accessible labels.

## Visual review and corrections

- Replaced the clipped full-tab focus outline with an inset rounded focus ring.
- Kept 44 px minimum interactive targets on mobile.
- Added reduced-motion handling for card transitions and the save indicator.
- Replaced unreliable HTML WebGPU canvas serialization with a GPU presentation-cache readback for full-composite thumbnails; thumbnail failure cannot block the authoritative project save.
- Blank-state density and vertical rhythm support the requested two-tab first screen without promotional actions.

## Verification

- `npm run projects:verify`
- `npm run ui-parity:verify`
- `npm run document:verify`
- `npm run layer-structure:verify`
- `npx tsc --noEmit`
- `npm run build`

---

# Color Adjust — Design QA

Date: 2026-08-27

## Visual target

- Three always-visible controls in one floating bottom dock: Hue, Saturation and Brightness.
- The dock follows the editor's existing dark surface, border, radius, icon and focus styles.
- Hue uses a full spectrum track; Saturation and Brightness use semantic low-to-high tracks.
- Reset and Cancel appear in a compact two-button menu at the canvas press position.

## Responsive checks

- 390 × 844: passed. All three controls remain on one row, the quick-tool lane stays clear and touch targets remain usable.
- 844 × 390: passed. The dock stays above the lower safe area without hiding the active canvas region.
- 834 × 1194: passed after widening the dock for the tablet portrait proportion.
- 1194 × 834: passed. The horizontal layout matches the supplied landscape composition and remains centered around the working area.
- The supplied portrait and landscape references were compared directly beside the corresponding implementation captures.

## Interaction checks

- Live Hue, Saturation and Brightness preview: passed on the WebGPU device path.
- Fifty-one consecutive slider updates: passed; the latest value won, the UI stayed responsive and no new browser errors were reported.
- Reset returns all controls to neutral and keeps the session open: passed.
- Cancel restores the byte-exact source and creates no history action: passed.
- Switching to Move or selecting the active Paint tool commits once and closes the surface: passed.
- Long-press lifecycle, movement threshold, second-pointer cancellation and menu clamping are covered by the surface-controller verification.
- Keyboard focus, Escape handling and minimum touch targets: passed.

## Rendering and transaction checks

- Immutable cropped `rgba16float` source and authoritative `rgba16float` output: passed.
- One compute dispatch per accepted preview, one in-flight submission and latest-wins scheduling: passed.
- Alpha and raster bounds preservation: passed.
- One history action on commit and no history action on neutral commit or cancel: passed.
- Native-raster target guard and semantic-layer rejection: passed.
- The 32-byte uniform ABI was validated on a real WebGPU device and is protected by regression assertions.

## Verification

- `npm run verify` — 116/116 suites passed.
- `npm run typecheck` — passed.
- `npm run build:bundle` — passed.
- `npm run labs:build` — passed.
- Production bundle boundary check — passed.
- Source-language audit — no external creative-product references.

Final result: passed.

---

# Gradient Map — Design QA

Date: 2026-08-27

- Compared the supplied portrait reference and the local implementation in one visual review at a matching portrait viewport.
- The initial preset chooser uses the same dark, translucent, rounded dock as the existing color controls.
- The chooser has no visible title or helper copy, and preset ramps have no bright leading edge or individual backing card.
- Verified desktop, 390 × 844 portrait, 844 × 390 landscape, and 768 × 1100 portrait layouts without document overflow.
- Verified the contextual Reset/Cancel controls remain centered on the touch point and clamped inside the viewport.
- Verified the color picker anchor aligns with the selected stop and sits 3 px above its visible color swatch, including the rightmost stop on a 390 px viewport.
- Verified the workflow with a real imported photograph, including live preview, stop insertion, preset reset, Reverse, interpolation, automatic commit, and one-step Undo/Redo.
- Verified the real WebGPU RGBA16F laboratory, raster imports, selected-only SVG/text conversion, clipping, alpha/bounds preservation, and empty GPU error scope.
- Verified production and laboratory builds, type checking, focused controller verifiers, and product-neutral source naming.

final result: passed
