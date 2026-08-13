import { readEditorHtml, readEditorStyleSource } from "./ui-shell-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readEditorHtml();
const styles = readEditorStyleSource();
const sheet = readFileSync(
  new URL("../src/mobile-motion-blur-sheet.ts", import.meta.url),
  "utf8",
);

for (const id of [
  "mobileMotionBlurOpen",
  "mobileMotionBlurSheet",
  "mobileMotionBlurHandle",
  "mobileMotionBlurHeader",
  "mobileMotionBlurControlsRegion",
  "mobileMotionBlurDistance",
  "mobileMotionBlurDistanceOut",
  "mobileMotionBlurAngle",
  "mobileMotionBlurAngleOut",
  "mobileMotionBlurStatus",
  "mobileMotionBlurCancel",
  "mobileMotionBlurApply",
]) {
  assert.match(html, new RegExp(`id="${id}"`), `Manca #${id}.`);
}

const adjustmentsCategoryStart = html.indexOf(
  '<h2 class="mobile-tools-category-title">Adjustments</h2>',
);
const adjustmentsCategoryEnd = html.indexOf("</section>", adjustmentsCategoryStart);
const adjustmentsCategory = html.slice(adjustmentsCategoryStart, adjustmentsCategoryEnd);
const gaussianPosition = adjustmentsCategory.indexOf('id="mobileGaussianBlurOpen"');
const motionPosition = adjustmentsCategory.indexOf('id="mobileMotionBlurOpen"');
const noisePosition = adjustmentsCategory.indexOf('id="mobileNoiseOpen"');
assert.ok(gaussianPosition >= 0 && motionPosition > gaussianPosition);
assert.ok(noisePosition > motionPosition);
assert.match(adjustmentsCategory, /data-lucide="wind"/);
assert.match(adjustmentsCategory, /mobile-tools-item-label">Motion Blur</);

assert.match(
  html,
  /id="mobileMotionBlurDistance"[\s\S]{0,180}min="0"[\s\S]{0,80}max="500"/,
);
assert.match(
  html,
  /id="mobileMotionBlurAngle"[\s\S]{0,180}min="-180"[\s\S]{0,80}max="180"/,
);

assert.match(html, /mobile-stroke-sheet-content mobile-motion-blur-shell/);
assert.match(html, /id="mobileMotionBlurHeader" class="mobile-stroke-header"/);
assert.match(html, /class="mobile-stroke-title">Motion Blur/);
assert.match(html, /id="mobileMotionBlurStatus"[\s\S]{0,120}class="visually-hidden"/);
assert.match(html, /id="mobileMotionBlurCancel" type="button">Cancel/);
assert.match(html, /id="mobileMotionBlurApply" class="is-primary" type="button">Apply/);
assert.doesNotMatch(html, /id="desktopMotionBlur/);
assert.doesNotMatch(html, /Motion Blur[^<]*(?:RGBA16F|16-bit|f32|live preview)/i);

assert.match(sheet, /export class MobileMotionBlurSheetController/);
assert.match(sheet, /resolveMobileBottomSheetDrag/);
assert.match(sheet, /nextMobileBottomSheetTapSnap/);
assert.match(sheet, /onRequestCancel/);
assert.match(sheet, /MOBILE_MOTION_BLUR_MIN_PEEK_PX = 250/);
assert.match(sheet, /MOBILE_MOTION_BLUR_MAX_PEEK_PX = 320/);
assert.match(sheet, /MOBILE_MOTION_BLUR_PEEK_VIEWPORT_RATIO = 0\.36/);
assert.doesNotMatch(sheet, /from "\.\/engine/);

assert.match(styles, /\.mobile-motion-blur-sheet\s*\{/);
assert.match(styles, /\.mobile-gaussian-blur-controls,\s*\.mobile-motion-blur-controls/);

console.log("Motion Blur UI parity verification passed.");
