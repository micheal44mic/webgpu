export const CONNECTED_COLOR_MAX_DISTANCE = 0.25;
export const CONNECTED_DARK_INK_VALUE = 0.06;
export const COLOR_FAMILY_MIN_CHROMA = 2 / 255;
export const COLOR_FAMILY_MIN_SATURATION = 0.12;
export const COLOR_MATCH_EPSILON = 1e-6;

interface StraightSrgbProfile {
  readonly value: number;
  readonly chroma: number;
  readonly saturation: number;
  readonly hue: number;
  readonly chromatic: boolean;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function straightSrgbProfile(
  value: readonly [number, number, number, number],
): StraightSrgbProfile {
  const red = clampUnit(value[0]);
  const green = clampUnit(value[1]);
  const blue = clampUnit(value[2]);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const chroma = maximum - minimum;
  const saturation = maximum > COLOR_MATCH_EPSILON ? chroma / maximum : 0;
  let hue = 0;
  if (chroma > COLOR_MATCH_EPSILON) {
    if (maximum === red) hue = (green - blue) / chroma;
    else if (maximum === green) hue = 2 + (blue - red) / chroma;
    else hue = 4 + (red - green) / chroma;
    hue = ((hue / 6) % 1 + 1) % 1;
  }
  return {
    value: maximum,
    chroma,
    saturation,
    hue,
    chromatic: maximum >= COLOR_FAMILY_MIN_CHROMA
      && chroma >= COLOR_FAMILY_MIN_CHROMA
      && saturation >= COLOR_FAMILY_MIN_SATURATION,
  };
}

function hueDistance(left: number, right: number): number {
  const direct = Math.abs(left - right);
  return Math.min(direct, 1 - direct);
}

/**
 * Connected operations remain conservative at their maximum setting. A hard
 * per-channel cap keeps a one-pixel contrasting boundary ineligible, while the
 * hue-family gate prevents a dark chromatic seed from absorbing neutral black.
 */
export function connectedStraightSrgbColorsMatch(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
  maximumDistance: number,
): boolean {
  const distance = Math.min(
    CONNECTED_COLOR_MAX_DISTANCE,
    Math.max(0, Number.isFinite(maximumDistance) ? maximumDistance : 0),
  );
  const maximumDelta = Math.max(
    Math.abs(clampUnit(left[0]) - clampUnit(right[0])),
    Math.abs(clampUnit(left[1]) - clampUnit(right[1])),
    Math.abs(clampUnit(left[2]) - clampUnit(right[2])),
    Math.abs(clampUnit(left[3]) - clampUnit(right[3])),
  );
  if (maximumDelta > distance + COLOR_MATCH_EPSILON) return false;

  const first = straightSrgbProfile(left);
  const second = straightSrgbProfile(right);
  if (first.chromatic !== second.chromatic) return false;
  if (
    !first.chromatic
    && (first.value <= CONNECTED_DARK_INK_VALUE)
      !== (second.value <= CONNECTED_DARK_INK_VALUE)
  ) return false;
  const strength = distance / CONNECTED_COLOR_MAX_DISTANCE;
  if (first.chromatic) {
    return hueDistance(first.hue, second.hue)
      <= 55 * strength / 360 + COLOR_MATCH_EPSILON
      && Math.abs(first.saturation - second.saturation)
        <= 0.01 + 0.69 * strength + COLOR_MATCH_EPSILON;
  }
  return Math.abs(first.chroma - second.chroma)
    <= 0.005 + 0.08 * strength + COLOR_MATCH_EPSILON;
}

/**
 * Global Color Range may span light and dark variants, but even at maximum it
 * stays inside the target's chromatic/neutral family and a bounded hue arc.
 */
export function globalStraightSrgbColorsMatch(
  source: readonly [number, number, number, number],
  target: readonly [number, number, number, number],
  tolerance: number,
): boolean {
  const strength = clampUnit(Number.isFinite(tolerance) ? tolerance : 0);
  if (clampUnit(source[3]) <= COLOR_MATCH_EPSILON) return false;
  if (clampUnit(target[3]) <= COLOR_MATCH_EPSILON) return false;

  const sourceProfile = straightSrgbProfile(source);
  const targetProfile = straightSrgbProfile(target);
  if (sourceProfile.chromatic !== targetProfile.chromatic) return false;
  if (targetProfile.chromatic) {
    return hueDistance(sourceProfile.hue, targetProfile.hue)
        <= 55 * strength / 360 + COLOR_MATCH_EPSILON
      && Math.abs(sourceProfile.saturation - targetProfile.saturation)
        <= COLOR_MATCH_EPSILON + 0.75 * strength
      && Math.abs(sourceProfile.value - targetProfile.value)
        <= COLOR_MATCH_EPSILON + 0.85 * strength;
  }
  return Math.abs(sourceProfile.chroma - targetProfile.chroma)
      <= COLOR_MATCH_EPSILON + 0.1 * strength
    && Math.abs(sourceProfile.value - targetProfile.value)
      <= COLOR_MATCH_EPSILON + 0.45 * strength;
}

const wgslFloat = (value: number): string => value.toFixed(9);

/** Shared CPU/GPU color-family contract used by Fill, Magic Wand and Color Range. */
export const colorMatchShaderHelpers = /* wgsl */ `
const CONNECTED_COLOR_MAX_DISTANCE: f32 = ${wgslFloat(CONNECTED_COLOR_MAX_DISTANCE)};
const CONNECTED_DARK_INK_VALUE: f32 = ${wgslFloat(CONNECTED_DARK_INK_VALUE)};
const COLOR_FAMILY_MIN_CHROMA: f32 = ${wgslFloat(COLOR_FAMILY_MIN_CHROMA)};
const COLOR_FAMILY_MIN_SATURATION: f32 = ${wgslFloat(COLOR_FAMILY_MIN_SATURATION)};
const COLOR_MATCH_EPSILON: f32 = ${wgslFloat(COLOR_MATCH_EPSILON)};

fn colorFamilyProfile(rgb: vec3<f32>) -> vec4<f32> {
  let value = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
  let maximum = max(value.r, max(value.g, value.b));
  let minimum = min(value.r, min(value.g, value.b));
  let chroma = maximum - minimum;
  var saturation = 0.0;
  var hue = 0.0;
  if (maximum > COLOR_MATCH_EPSILON) { saturation = chroma / maximum; }
  if (chroma > COLOR_MATCH_EPSILON) {
    if (maximum == value.r) {
      hue = (value.g - value.b) / chroma;
    } else if (maximum == value.g) {
      hue = 2.0 + (value.b - value.r) / chroma;
    } else {
      hue = 4.0 + (value.r - value.g) / chroma;
    }
    hue = fract(hue / 6.0 + 1.0);
  }
  return vec4<f32>(maximum, chroma, saturation, hue);
}

fn colorFamilyIsChromatic(profile: vec4<f32>) -> bool {
  return profile.x >= COLOR_FAMILY_MIN_CHROMA
    && profile.y >= COLOR_FAMILY_MIN_CHROMA
    && profile.z >= COLOR_FAMILY_MIN_SATURATION;
}

fn colorFamilyHueDistance(left: f32, right: f32) -> f32 {
  let direct = abs(left - right);
  return min(direct, 1.0 - direct);
}

fn connectedStraightSrgbColorsMatch(
  left: vec4<f32>,
  right: vec4<f32>,
  requestedDistance: f32,
) -> bool {
  let distance = clamp(requestedDistance, 0.0, CONNECTED_COLOR_MAX_DISTANCE);
  let maximumDelta = max(
    max(abs(left.r - right.r), abs(left.g - right.g)),
    max(abs(left.b - right.b), abs(left.a - right.a)),
  );
  if (maximumDelta > distance + COLOR_MATCH_EPSILON) { return false; }
  let first = colorFamilyProfile(left.rgb);
  let second = colorFamilyProfile(right.rgb);
  let firstChromatic = colorFamilyIsChromatic(first);
  let secondChromatic = colorFamilyIsChromatic(second);
  if (firstChromatic != secondChromatic) { return false; }
  if (
    !firstChromatic
    && (first.x <= CONNECTED_DARK_INK_VALUE)
      != (second.x <= CONNECTED_DARK_INK_VALUE)
  ) { return false; }
  let strength = distance / CONNECTED_COLOR_MAX_DISTANCE;
  if (firstChromatic) {
    return colorFamilyHueDistance(first.w, second.w)
        <= 55.0 * strength / 360.0 + COLOR_MATCH_EPSILON
      && abs(first.z - second.z)
        <= 0.01 + 0.69 * strength + COLOR_MATCH_EPSILON;
  }
  return abs(first.y - second.y)
    <= 0.005 + 0.08 * strength + COLOR_MATCH_EPSILON;
}

fn globalStraightSrgbColorsMatch(
  source: vec4<f32>,
  targetColor: vec4<f32>,
  requestedTolerance: f32,
) -> bool {
  let strength = clamp(requestedTolerance, 0.0, 1.0);
  if (source.a <= COLOR_MATCH_EPSILON || targetColor.a <= COLOR_MATCH_EPSILON) {
    return false;
  }
  let sourceProfile = colorFamilyProfile(source.rgb);
  let targetProfile = colorFamilyProfile(targetColor.rgb);
  let sourceChromatic = colorFamilyIsChromatic(sourceProfile);
  let targetChromatic = colorFamilyIsChromatic(targetProfile);
  if (sourceChromatic != targetChromatic) { return false; }
  if (targetChromatic) {
    return colorFamilyHueDistance(sourceProfile.w, targetProfile.w)
        <= 55.0 * strength / 360.0 + COLOR_MATCH_EPSILON
      && abs(sourceProfile.z - targetProfile.z)
        <= COLOR_MATCH_EPSILON + 0.75 * strength
      && abs(sourceProfile.x - targetProfile.x)
        <= COLOR_MATCH_EPSILON + 0.85 * strength;
  }
  return abs(sourceProfile.y - targetProfile.y)
      <= COLOR_MATCH_EPSILON + 0.1 * strength
    && abs(sourceProfile.x - targetProfile.x)
      <= COLOR_MATCH_EPSILON + 0.45 * strength;
}
`;
