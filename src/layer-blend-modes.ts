/**
 * Shared layer blend-mode contract, independent from the current renderers.
 *
 * Storage is linear-light RGBA with premultiplied RGB. Blend functions B(Cb,Cs)
 * run on unassociated sRGB, matching the conventional encoded-sRGB blend
 * interpretation, then return to linear before W3C source-over compositing.
 * Source alpha must already include layer opacity.
 *
 * Dissolve is intentionally absent: it requires coordinate-dependent random
 * coverage and cannot be represented by a deterministic two-color function.
 * Shade has no calibrated transfer function yet; its current fallback is
 * explicitly provisional and must not be described as pixel-identical.
 */

export const LAYER_BLEND_MODE_STRATEGY =
  "srgb-encoded-blend-functions-over-linear-premultiplied-storage-w3c-alpha-v1" as const;

export const DEFAULT_LAYER_BLEND_MODE = "normal" as const;

/** Canonical blend-mode menu order used by the editor. */
export const LAYER_BLEND_MODE_ORDER = [
  "multiply",
  "darken",
  "shade",
  "color-burn",
  "linear-burn",
  "darker-color",
  "normal",
  "lighten",
  "screen",
  "color-dodge",
  "add",
  "lighter-color",
  "overlay",
  "soft-light",
  "hard-light",
  "vivid-light",
  "linear-light",
  "pin-light",
  "hard-mix",
  "difference",
  "exclusion",
  "subtract",
  "divide",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

export type LayerBlendMode = (typeof LAYER_BLEND_MODE_ORDER)[number];

export const LAYER_BLEND_MODE_CATEGORY_ORDER = [
  "darken",
  "normal",
  "lighten",
  "contrast",
  "difference",
  "component",
] as const;

export type LayerBlendModeCategoryId =
  (typeof LAYER_BLEND_MODE_CATEGORY_ORDER)[number];

export interface LayerBlendModeCategory {
  readonly id: LayerBlendModeCategoryId;
  readonly label: string;
  readonly modes: readonly LayerBlendMode[];
}

export const LAYER_BLEND_MODE_LABELS: Readonly<Record<LayerBlendMode, string>> = {
  multiply: "Multiply",
  darken: "Darken",
  shade: "Shade (provisional)",
  "color-burn": "Color Burn",
  "linear-burn": "Linear Burn",
  "darker-color": "Darker Color",
  normal: "Normal",
  lighten: "Lighten",
  screen: "Screen",
  "color-dodge": "Color Dodge",
  add: "Add (Linear Dodge)",
  "lighter-color": "Lighter Color",
  overlay: "Overlay",
  "soft-light": "Soft Light",
  "hard-light": "Hard Light",
  "vivid-light": "Vivid Light",
  "linear-light": "Linear Light",
  "pin-light": "Pin Light",
  "hard-mix": "Hard Mix",
  difference: "Difference",
  exclusion: "Exclusion",
  subtract: "Subtract",
  divide: "Divide",
  hue: "Hue",
  saturation: "Saturation",
  color: "Color",
  luminosity: "Luminosity",
};

/** Stable numeric ABI shared by TypeScript metadata and WGSL. */
export const LAYER_BLEND_MODE_CODES: Readonly<Record<LayerBlendMode, number>> = {
  multiply: 0,
  darken: 1,
  shade: 2,
  "color-burn": 3,
  "linear-burn": 4,
  "darker-color": 5,
  normal: 6,
  lighten: 7,
  screen: 8,
  "color-dodge": 9,
  add: 10,
  "lighter-color": 11,
  overlay: 12,
  "soft-light": 13,
  "hard-light": 14,
  "vivid-light": 15,
  "linear-light": 16,
  "pin-light": 17,
  "hard-mix": 18,
  difference: 19,
  exclusion: 20,
  subtract: 21,
  divide: 22,
  hue: 23,
  saturation: 24,
  color: 25,
  luminosity: 26,
};

export const PROVISIONAL_LAYER_BLEND_MODES = ["shade"] as const satisfies
  readonly LayerBlendMode[];

export const LAYER_BLEND_SHADE_COMPATIBILITY_NOTE =
  "Temporary fallback: Shade uses Darken until its transfer function is calibrated." as const;

const LAYER_BLEND_MODE_SET: ReadonlySet<string> = new Set(LAYER_BLEND_MODE_ORDER);

export function isLayerBlendMode(value: unknown): value is LayerBlendMode {
  return typeof value === "string" && LAYER_BLEND_MODE_SET.has(value);
}

export function normalizeLayerBlendMode(value: unknown): LayerBlendMode {
  return isLayerBlendMode(value) ? value : DEFAULT_LAYER_BLEND_MODE;
}

export const LAYER_BLEND_MODE_CATEGORIES: readonly LayerBlendModeCategory[] = [
  {
    id: "darken",
    label: "Darken",
    modes: ["multiply", "darken", "shade", "color-burn", "linear-burn", "darker-color"],
  },
  { id: "normal", label: "Normal", modes: ["normal"] },
  {
    id: "lighten",
    label: "Lighten",
    modes: ["lighten", "screen", "color-dodge", "add", "lighter-color"],
  },
  {
    id: "contrast",
    label: "Contrast",
    modes: [
      "overlay",
      "soft-light",
      "hard-light",
      "vivid-light",
      "linear-light",
      "pin-light",
      "hard-mix",
    ],
  },
  {
    id: "difference",
    label: "Difference",
    modes: ["difference", "exclusion", "subtract", "divide"],
  },
  {
    id: "component",
    label: "Component",
    modes: ["hue", "saturation", "color", "luminosity"],
  },
];

export type LinearPremultipliedRgba = readonly [
  red: number,
  green: number,
  blue: number,
  alpha: number,
];

type Rgb = readonly [red: number, green: number, blue: number];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const linearToSrgbChannel = (value: number): number => {
  const channel = clamp01(value);
  return channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * channel ** (1 / 2.4) - 0.055;
};

const srgbToLinearChannel = (value: number): number => {
  const channel = clamp01(value);
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
};

const linearToSrgb = (color: Rgb): Rgb => [
  linearToSrgbChannel(color[0]),
  linearToSrgbChannel(color[1]),
  linearToSrgbChannel(color[2]),
];

const srgbToLinear = (color: Rgb): Rgb => [
  srgbToLinearChannel(color[0]),
  srgbToLinearChannel(color[1]),
  srgbToLinearChannel(color[2]),
];

const luminosity = (color: Rgb): number =>
  0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2];

// Darker/Lighter Color compare the composite value of the three encoded RGB
// channels, not perceptual luminosity. Keeping this separate from `luminosity`
// is important for saturated colors (for example blue versus a dark gray).
const channelTotal = (color: Rgb): number => color[0] + color[1] + color[2];

const saturation = (color: Rgb): number =>
  Math.max(color[0], color[1], color[2]) - Math.min(color[0], color[1], color[2]);

const clipColor = (color: Rgb): Rgb => {
  const lightness = luminosity(color);
  const minimum = Math.min(color[0], color[1], color[2]);
  const maximum = Math.max(color[0], color[1], color[2]);
  let result = [...color] as [number, number, number];
  if (minimum < 0) {
    const denominator = lightness - minimum;
    result = denominator > 0
      ? result.map((component) =>
        lightness + (component - lightness) * lightness / denominator,
      ) as [number, number, number]
      : [0, 0, 0];
  }
  if (maximum > 1) {
    const denominator = maximum - lightness;
    result = denominator > 0
      ? result.map((component) =>
        lightness + (component - lightness) * (1 - lightness) / denominator,
      ) as [number, number, number]
      : [1, 1, 1];
  }
  return [clamp01(result[0]), clamp01(result[1]), clamp01(result[2])];
};

const setLuminosity = (color: Rgb, target: number): Rgb => {
  const delta = target - luminosity(color);
  return clipColor([color[0] + delta, color[1] + delta, color[2] + delta]);
};

const setSaturation = (color: Rgb, target: number): Rgb => {
  const minimum = Math.min(color[0], color[1], color[2]);
  const maximum = Math.max(color[0], color[1], color[2]);
  if (maximum <= minimum) return [0, 0, 0];
  const scale = clamp01(target) / (maximum - minimum);
  return [
    (color[0] - minimum) * scale,
    (color[1] - minimum) * scale,
    (color[2] - minimum) * scale,
  ];
};

const colorBurn = (backdrop: number, source: number): number => {
  if (backdrop >= 1) return 1;
  if (source <= 0) return 0;
  return 1 - Math.min(1, (1 - backdrop) / source);
};

const colorDodge = (backdrop: number, source: number): number => {
  if (backdrop <= 0) return 0;
  if (source >= 1) return 1;
  return Math.min(1, backdrop / (1 - source));
};

const softLight = (backdrop: number, source: number): number => {
  if (source <= 0.5) {
    return backdrop - (1 - 2 * source) * backdrop * (1 - backdrop);
  }
  const curve = backdrop <= 0.25
    ? ((16 * backdrop - 12) * backdrop + 4) * backdrop
    : Math.sqrt(backdrop);
  return backdrop + (2 * source - 1) * (curve - backdrop);
};

const vividLight = (backdrop: number, source: number): number =>
  source <= 0.5
    ? colorBurn(backdrop, 2 * source)
    : colorDodge(backdrop, 2 * source - 1);

const separable = (
  backdrop: Rgb,
  source: Rgb,
  operation: (backdrop: number, source: number) => number,
): Rgb => [
  operation(backdrop[0], source[0]),
  operation(backdrop[1], source[1]),
  operation(backdrop[2], source[2]),
];

/** Evaluates B(Cb,Cs) on unassociated sRGB channels. */
export function blendLayerSrgb(
  backdrop: Rgb,
  source: Rgb,
  mode: LayerBlendMode,
): Rgb {
  switch (mode) {
    case "multiply": return separable(backdrop, source, (base, blend) => base * blend);
    case "darken": return separable(backdrop, source, Math.min);
    // Provisional legacy fallback: intentionally explicit and separately tagged.
    case "shade": return separable(backdrop, source, Math.min);
    case "color-burn": return separable(backdrop, source, colorBurn);
    case "linear-burn": return separable(
      backdrop,
      source,
      (base, blend) => Math.max(0, base + blend - 1),
    );
    case "darker-color": return channelTotal(source) < channelTotal(backdrop) ? source : backdrop;
    case "normal": return source;
    case "lighten": return separable(backdrop, source, Math.max);
    case "screen": return separable(
      backdrop,
      source,
      (base, blend) => base + blend - base * blend,
    );
    case "color-dodge": return separable(backdrop, source, colorDodge);
    case "add": return separable(
      backdrop,
      source,
      (base, blend) => Math.min(1, base + blend),
    );
    case "lighter-color": return channelTotal(source) > channelTotal(backdrop) ? source : backdrop;
    case "overlay": return separable(
      backdrop,
      source,
      (base, blend) => base <= 0.5
        ? 2 * base * blend
        : 1 - 2 * (1 - base) * (1 - blend),
    );
    case "soft-light": return separable(backdrop, source, softLight);
    case "hard-light": return separable(
      backdrop,
      source,
      (base, blend) => blend <= 0.5
        ? 2 * base * blend
        : 1 - 2 * (1 - base) * (1 - blend),
    );
    case "vivid-light": return separable(backdrop, source, vividLight);
    case "linear-light": return separable(
      backdrop,
      source,
      (base, blend) => clamp01(base + 2 * blend - 1),
    );
    case "pin-light": return separable(
      backdrop,
      source,
      (base, blend) => blend <= 0.5
        ? Math.min(base, 2 * blend)
        : Math.max(base, 2 * blend - 1),
    );
    case "hard-mix": return separable(
      backdrop,
      source,
      (base, blend) => vividLight(base, blend) < 0.5 ? 0 : 1,
    );
    case "difference": return separable(
      backdrop,
      source,
      (base, blend) => Math.abs(base - blend),
    );
    case "exclusion": return separable(
      backdrop,
      source,
      (base, blend) => base + blend - 2 * base * blend,
    );
    case "subtract": return separable(
      backdrop,
      source,
      (base, blend) => Math.max(0, base - blend),
    );
    case "divide": return separable(
      backdrop,
      source,
      (base, blend) => blend <= 0 ? 1 : Math.min(1, base / blend),
    );
    case "hue": return setLuminosity(
      setSaturation(source, saturation(backdrop)),
      luminosity(backdrop),
    );
    case "saturation": return setLuminosity(
      setSaturation(backdrop, saturation(source)),
      luminosity(backdrop),
    );
    case "color": return setLuminosity(source, luminosity(backdrop));
    case "luminosity": return setLuminosity(backdrop, luminosity(source));
  }
}

/**
 * Composites a premultiplied linear source over a premultiplied linear
 * backdrop. Normal is an exact source-over fast path without color conversion.
 */
export function blendLayerPremultipliedLinear(
  backdrop: LinearPremultipliedRgba,
  source: LinearPremultipliedRgba,
  mode: LayerBlendMode = DEFAULT_LAYER_BLEND_MODE,
): LinearPremultipliedRgba {
  const backdropAlpha = clamp01(backdrop[3]);
  const sourceAlpha = clamp01(source[3]);
  const backdropPremultiplied: Rgb = [
    Math.min(backdropAlpha, Math.max(0, backdrop[0])),
    Math.min(backdropAlpha, Math.max(0, backdrop[1])),
    Math.min(backdropAlpha, Math.max(0, backdrop[2])),
  ];
  const sourcePremultiplied: Rgb = [
    Math.min(sourceAlpha, Math.max(0, source[0])),
    Math.min(sourceAlpha, Math.max(0, source[1])),
    Math.min(sourceAlpha, Math.max(0, source[2])),
  ];
  const outputAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
  const sourceOverChannel = (channel: 0 | 1 | 2): number => Math.min(
    outputAlpha,
    sourcePremultiplied[channel] + backdropPremultiplied[channel] * (1 - sourceAlpha),
  );
  if (mode === "normal") {
    return [sourceOverChannel(0), sourceOverChannel(1), sourceOverChannel(2), outputAlpha];
  }

  const backdropLinear: Rgb = backdropAlpha > 0
    ? [
      backdropPremultiplied[0] / backdropAlpha,
      backdropPremultiplied[1] / backdropAlpha,
      backdropPremultiplied[2] / backdropAlpha,
    ]
    : [0, 0, 0];
  const sourceLinear: Rgb = sourceAlpha > 0
    ? [
      sourcePremultiplied[0] / sourceAlpha,
      sourcePremultiplied[1] / sourceAlpha,
      sourcePremultiplied[2] / sourceAlpha,
    ]
    : [0, 0, 0];
  const blendedLinear = srgbToLinear(
    blendLayerSrgb(linearToSrgb(backdropLinear), linearToSrgb(sourceLinear), mode),
  );
  const overlapAlpha = backdropAlpha * sourceAlpha;
  const compositeChannel = (channel: 0 | 1 | 2): number => Math.min(
    outputAlpha,
    Math.max(
      0,
      backdropPremultiplied[channel] * (1 - sourceAlpha)
        + sourcePremultiplied[channel] * (1 - backdropAlpha)
        + overlapAlpha * blendedLinear[channel],
    ),
  );
  return [compositeChannel(0), compositeChannel(1), compositeChannel(2), outputAlpha];
}

/** WGSL implementation sharing the numeric mode codes declared above. */
export const LAYER_BLEND_MODE_WGSL = /* wgsl */ `
const LAYER_BLEND_MULTIPLY: u32 = 0u;
const LAYER_BLEND_DARKEN: u32 = 1u;
const LAYER_BLEND_SHADE_PROVISIONAL: u32 = 2u;
const LAYER_BLEND_COLOR_BURN: u32 = 3u;
const LAYER_BLEND_LINEAR_BURN: u32 = 4u;
const LAYER_BLEND_DARKER_COLOR: u32 = 5u;
const LAYER_BLEND_NORMAL: u32 = 6u;
const LAYER_BLEND_LIGHTEN: u32 = 7u;
const LAYER_BLEND_SCREEN: u32 = 8u;
const LAYER_BLEND_COLOR_DODGE: u32 = 9u;
const LAYER_BLEND_LINEAR_DODGE_ADD: u32 = 10u;
const LAYER_BLEND_LIGHTER_COLOR: u32 = 11u;
const LAYER_BLEND_OVERLAY: u32 = 12u;
const LAYER_BLEND_SOFT_LIGHT: u32 = 13u;
const LAYER_BLEND_HARD_LIGHT: u32 = 14u;
const LAYER_BLEND_VIVID_LIGHT: u32 = 15u;
const LAYER_BLEND_LINEAR_LIGHT: u32 = 16u;
const LAYER_BLEND_PIN_LIGHT: u32 = 17u;
const LAYER_BLEND_HARD_MIX: u32 = 18u;
const LAYER_BLEND_DIFFERENCE: u32 = 19u;
const LAYER_BLEND_EXCLUSION: u32 = 20u;
const LAYER_BLEND_SUBTRACT: u32 = 21u;
const LAYER_BLEND_DIVIDE: u32 = 22u;
const LAYER_BLEND_HUE: u32 = 23u;
const LAYER_BLEND_SATURATION: u32 = 24u;
const LAYER_BLEND_COLOR: u32 = 25u;
const LAYER_BLEND_LUMINOSITY: u32 = 26u;

fn layerBlendLinearToSrgbChannel(value: f32) -> f32 {
  let channel = clamp(value, 0.0, 1.0);
  if (channel <= 0.0031308) { return channel * 12.92; }
  return 1.055 * pow(channel, 1.0 / 2.4) - 0.055;
}

fn layerBlendSrgbToLinearChannel(value: f32) -> f32 {
  let channel = clamp(value, 0.0, 1.0);
  if (channel <= 0.04045) { return channel / 12.92; }
  return pow((channel + 0.055) / 1.055, 2.4);
}

fn layerBlendLinearToSrgb(color: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    layerBlendLinearToSrgbChannel(color.r),
    layerBlendLinearToSrgbChannel(color.g),
    layerBlendLinearToSrgbChannel(color.b),
  );
}

fn layerBlendSrgbToLinear(color: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    layerBlendSrgbToLinearChannel(color.r),
    layerBlendSrgbToLinearChannel(color.g),
    layerBlendSrgbToLinearChannel(color.b),
  );
}

fn layerBlendLuminosity(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.3, 0.59, 0.11));
}

fn layerBlendChannelTotal(color: vec3<f32>) -> f32 {
  return color.r + color.g + color.b;
}

fn layerBlendSaturation(color: vec3<f32>) -> f32 {
  return max(max(color.r, color.g), color.b) - min(min(color.r, color.g), color.b);
}

fn layerBlendClipColor(color: vec3<f32>) -> vec3<f32> {
  let lightness = layerBlendLuminosity(color);
  let minimum = min(min(color.r, color.g), color.b);
  let maximum = max(max(color.r, color.g), color.b);
  var result = color;
  if (minimum < 0.0) {
    let denominator = lightness - minimum;
    if (denominator > 0.0) {
      result = vec3<f32>(lightness)
        + (result - vec3<f32>(lightness)) * lightness / denominator;
    } else {
      result = vec3<f32>(0.0);
    }
  }
  if (maximum > 1.0) {
    let denominator = maximum - lightness;
    if (denominator > 0.0) {
      result = vec3<f32>(lightness)
        + (result - vec3<f32>(lightness)) * (1.0 - lightness) / denominator;
    } else {
      result = vec3<f32>(1.0);
    }
  }
  return clamp(result, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn layerBlendSetLuminosity(color: vec3<f32>, desiredLuminosity: f32) -> vec3<f32> {
  return layerBlendClipColor(
    color + vec3<f32>(desiredLuminosity - layerBlendLuminosity(color))
  );
}

fn layerBlendSetSaturation(color: vec3<f32>, desiredSaturation: f32) -> vec3<f32> {
  let minimum = min(min(color.r, color.g), color.b);
  let maximum = max(max(color.r, color.g), color.b);
  if (maximum <= minimum) { return vec3<f32>(0.0); }
  return (color - vec3<f32>(minimum))
    * clamp(desiredSaturation, 0.0, 1.0)
    / (maximum - minimum);
}

fn layerBlendColorBurn(backdrop: f32, source: f32) -> f32 {
  if (backdrop >= 1.0) { return 1.0; }
  if (source <= 0.0) { return 0.0; }
  return 1.0 - min(1.0, (1.0 - backdrop) / source);
}

fn layerBlendColorDodge(backdrop: f32, source: f32) -> f32 {
  if (backdrop <= 0.0) { return 0.0; }
  if (source >= 1.0) { return 1.0; }
  return min(1.0, backdrop / (1.0 - source));
}

fn layerBlendSoftLight(backdrop: f32, source: f32) -> f32 {
  if (source <= 0.5) {
    return backdrop - (1.0 - 2.0 * source) * backdrop * (1.0 - backdrop);
  }
  var curve = sqrt(backdrop);
  if (backdrop <= 0.25) {
    curve = ((16.0 * backdrop - 12.0) * backdrop + 4.0) * backdrop;
  }
  return backdrop + (2.0 * source - 1.0) * (curve - backdrop);
}

fn layerBlendVividLight(backdrop: f32, source: f32) -> f32 {
  if (source <= 0.5) { return layerBlendColorBurn(backdrop, 2.0 * source); }
  return layerBlendColorDodge(backdrop, 2.0 * source - 1.0);
}

fn layerBlendSrgb(backdrop: vec3<f32>, source: vec3<f32>, mode: u32) -> vec3<f32> {
  var result = source;
  switch mode {
    case LAYER_BLEND_MULTIPLY: { result = backdrop * source; }
    case LAYER_BLEND_DARKEN: { result = min(backdrop, source); }
    // Shade is not calibrated yet: use the temporary Darken fallback.
    case LAYER_BLEND_SHADE_PROVISIONAL: { result = min(backdrop, source); }
    case LAYER_BLEND_COLOR_BURN: {
      result = vec3<f32>(
        layerBlendColorBurn(backdrop.r, source.r),
        layerBlendColorBurn(backdrop.g, source.g),
        layerBlendColorBurn(backdrop.b, source.b),
      );
    }
    case LAYER_BLEND_LINEAR_BURN: { result = max(vec3<f32>(0.0), backdrop + source - 1.0); }
    case LAYER_BLEND_DARKER_COLOR: {
      result = select(
        backdrop,
        source,
        layerBlendChannelTotal(source) < layerBlendChannelTotal(backdrop),
      );
    }
    case LAYER_BLEND_LIGHTEN: { result = max(backdrop, source); }
    case LAYER_BLEND_SCREEN: { result = backdrop + source - backdrop * source; }
    case LAYER_BLEND_COLOR_DODGE: {
      result = vec3<f32>(
        layerBlendColorDodge(backdrop.r, source.r),
        layerBlendColorDodge(backdrop.g, source.g),
        layerBlendColorDodge(backdrop.b, source.b),
      );
    }
    case LAYER_BLEND_LINEAR_DODGE_ADD: { result = min(vec3<f32>(1.0), backdrop + source); }
    case LAYER_BLEND_LIGHTER_COLOR: {
      result = select(
        backdrop,
        source,
        layerBlendChannelTotal(source) > layerBlendChannelTotal(backdrop),
      );
    }
    case LAYER_BLEND_OVERLAY: {
      result = select(
        2.0 * backdrop * source,
        vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - backdrop) * (vec3<f32>(1.0) - source),
        backdrop > vec3<f32>(0.5),
      );
    }
    case LAYER_BLEND_SOFT_LIGHT: {
      result = vec3<f32>(
        layerBlendSoftLight(backdrop.r, source.r),
        layerBlendSoftLight(backdrop.g, source.g),
        layerBlendSoftLight(backdrop.b, source.b),
      );
    }
    case LAYER_BLEND_HARD_LIGHT: {
      result = select(
        2.0 * backdrop * source,
        vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - backdrop) * (vec3<f32>(1.0) - source),
        source > vec3<f32>(0.5),
      );
    }
    case LAYER_BLEND_VIVID_LIGHT: {
      result = vec3<f32>(
        layerBlendVividLight(backdrop.r, source.r),
        layerBlendVividLight(backdrop.g, source.g),
        layerBlendVividLight(backdrop.b, source.b),
      );
    }
    case LAYER_BLEND_LINEAR_LIGHT: {
      result = clamp(backdrop + 2.0 * source - 1.0, vec3<f32>(0.0), vec3<f32>(1.0));
    }
    case LAYER_BLEND_PIN_LIGHT: {
      result = select(
        min(backdrop, 2.0 * source),
        max(backdrop, 2.0 * source - 1.0),
        source > vec3<f32>(0.5),
      );
    }
    case LAYER_BLEND_HARD_MIX: {
      let vivid = vec3<f32>(
        layerBlendVividLight(backdrop.r, source.r),
        layerBlendVividLight(backdrop.g, source.g),
        layerBlendVividLight(backdrop.b, source.b),
      );
      result = select(vec3<f32>(0.0), vec3<f32>(1.0), vivid >= vec3<f32>(0.5));
    }
    case LAYER_BLEND_DIFFERENCE: { result = abs(backdrop - source); }
    case LAYER_BLEND_EXCLUSION: { result = backdrop + source - 2.0 * backdrop * source; }
    case LAYER_BLEND_SUBTRACT: { result = max(vec3<f32>(0.0), backdrop - source); }
    case LAYER_BLEND_DIVIDE: {
      result = vec3<f32>(
        select(1.0, min(1.0, backdrop.r / source.r), source.r > 0.0),
        select(1.0, min(1.0, backdrop.g / source.g), source.g > 0.0),
        select(1.0, min(1.0, backdrop.b / source.b), source.b > 0.0),
      );
    }
    case LAYER_BLEND_HUE: {
      result = layerBlendSetLuminosity(
        layerBlendSetSaturation(source, layerBlendSaturation(backdrop)),
        layerBlendLuminosity(backdrop),
      );
    }
    case LAYER_BLEND_SATURATION: {
      result = layerBlendSetLuminosity(
        layerBlendSetSaturation(backdrop, layerBlendSaturation(source)),
        layerBlendLuminosity(backdrop),
      );
    }
    case LAYER_BLEND_COLOR: {
      result = layerBlendSetLuminosity(source, layerBlendLuminosity(backdrop));
    }
    case LAYER_BLEND_LUMINOSITY: {
      result = layerBlendSetLuminosity(backdrop, layerBlendLuminosity(source));
    }
    default: {}
  }
  return clamp(result, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn layerBlendPremultipliedLinearSourceOver(
  backdropInput: vec4<f32>,
  sourceInput: vec4<f32>,
  mode: u32
) -> vec4<f32> {
  let backdropAlpha = clamp(backdropInput.a, 0.0, 1.0);
  let sourceAlpha = clamp(sourceInput.a, 0.0, 1.0);
  let backdropPremultiplied = clamp(
    backdropInput.rgb,
    vec3<f32>(0.0),
    vec3<f32>(backdropAlpha),
  );
  let sourcePremultiplied = clamp(
    sourceInput.rgb,
    vec3<f32>(0.0),
    vec3<f32>(sourceAlpha),
  );
  let outputAlpha = sourceAlpha + backdropAlpha * (1.0 - sourceAlpha);
  if (mode == LAYER_BLEND_NORMAL) {
    let sourceOver = sourcePremultiplied + backdropPremultiplied * (1.0 - sourceAlpha);
    return vec4<f32>(
      clamp(sourceOver, vec3<f32>(0.0), vec3<f32>(outputAlpha)),
      outputAlpha,
    );
  }

  // Transparent operands cannot contribute to an advanced blend function.
  // These coherent branches avoid transfer functions and mode math across the
  // empty majority of sparse brush and layer bounds without changing pixels.
  if (sourceAlpha <= 0.0) {
    return vec4<f32>(backdropPremultiplied, backdropAlpha);
  }
  if (backdropAlpha <= 0.0) {
    return vec4<f32>(sourcePremultiplied, sourceAlpha);
  }

  var backdropLinear = vec3<f32>(0.0);
  var sourceLinear = vec3<f32>(0.0);
  if (backdropAlpha > 0.0) { backdropLinear = backdropPremultiplied / backdropAlpha; }
  if (sourceAlpha > 0.0) { sourceLinear = sourcePremultiplied / sourceAlpha; }
  let blendedSrgb = layerBlendSrgb(
    layerBlendLinearToSrgb(backdropLinear),
    layerBlendLinearToSrgb(sourceLinear),
    mode,
  );
  let blendedLinear = layerBlendSrgbToLinear(blendedSrgb);
  let outputRgb = backdropPremultiplied * (1.0 - sourceAlpha)
    + sourcePremultiplied * (1.0 - backdropAlpha)
    + blendedLinear * (backdropAlpha * sourceAlpha);
  return vec4<f32>(
    clamp(outputRgb, vec3<f32>(0.0), vec3<f32>(outputAlpha)),
    outputAlpha,
  );
}
`;
