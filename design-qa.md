# M1M4 Project Home — Design QA

Date: 2026-08-12

## Visual target

- Reference: `C:\Users\michi\AppData\Local\Temp\codex-clipboard-03d9ed05-df83-431d-b5ef-916d2755244e.png`
- Implementation capture: `design-qa-assets/project-home-393x852.png`
- Target hierarchy retained: brand header, icon navigation, one primary content surface, canvas creation flow, recent-project grid.
- Product-specific direction applied: `M1M4.COM` is top-right, navigation has exactly `Projects` and `New Canvas`, and the existing orange/dark editor tokens replace Infinite Painter's coral palette.

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
- Blank-state density and vertical rhythm intentionally differ from the reference because the requested first screen has two tabs and no promotional/challenge actions.

## Verification

- `npm run projects:verify`
- `npm run ui-parity:verify`
- `npm run document:verify`
- `npm run layer-structure:verify`
- `npx tsc --noEmit`
- `npm run build`
