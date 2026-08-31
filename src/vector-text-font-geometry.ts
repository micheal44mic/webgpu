import { loadCachedAssetSource } from "./asset-source-cache.ts";
import type { Shadow3dPathData } from "./vector-shadow-3d.ts";
import {
  buildVectorTextCurveGuide,
  mergeVectorTextPaths,
  normalizeVectorTextTransformParameters,
  shiftVectorTextPath,
  transformVectorTextPathAffine,
  vectorTextCircleAffine,
  vectorTextCircleEnvelopeBounds,
  vectorTextDistortBounds,
  vectorTextPathBounds,
  warpVectorTextPathAlongCurve,
  warpVectorTextPathFreeForm,
  type VectorTextBounds,
  type VectorTextPoint,
  type VectorTextTransformParameters,
} from "./vector-text-transform.ts";

interface OpenTypeCommand {
  type?: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

interface OpenTypePath {
  commands: OpenTypeCommand[];
  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
}

interface OpenTypeFont {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  tables?: { os2?: { sxHeight?: number } };
  getPath(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    options?: { kerning?: boolean },
  ): OpenTypePath;
  getPaths(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    options?: { kerning?: boolean },
  ): OpenTypePath[];
  getAdvanceWidth(
    text: string,
    fontSize: number,
    options?: { kerning?: boolean },
  ): number;
}

interface VectorTextFontEntry {
  family: string;
  label: string;
  fileUrl: URL;
  weight: string;
}

interface LoadedVectorTextFont {
  entry: VectorTextFontEntry;
  font: OpenTypeFont;
  byteLength: number;
  face: FontFace | null;
}

interface OpenTypeParser {
  parse(buffer: ArrayBuffer): OpenTypeFont;
}

let openTypeParserPromise: Promise<OpenTypeParser> | null = null;

async function loadOpenTypeParser(): Promise<OpenTypeParser> {
  if (openTypeParserPromise) return openTypeParserPromise;
  const pending = import("opentype.js").then((module) => {
    const parser = module.default as OpenTypeParser;
    if (!parser || typeof parser.parse !== "function") {
      throw new Error("The vector font parser is unavailable.");
    }
    return parser;
  });
  openTypeParserPromise = pending;
  try {
    return await pending;
  } catch (error) {
    if (openTypeParserPromise === pending) openTypeParserPromise = null;
    throw error;
  }
}

export type VectorTextTransformGuide =
  | {
    readonly kind: "curve";
    readonly points: readonly VectorTextPoint[];
  }
  | {
    readonly kind: "circle";
    readonly centerX: number;
    readonly centerY: number;
    readonly radius: number;
  };

export interface VectorTextOutlineGeometry {
  pathData: Shadow3dPathData;
  left: number;
  top: number;
  right: number;
  bottom: number;
  inkLeft: number;
  inkTop: number;
  inkRight: number;
  inkBottom: number;
  baseline: number;
  logicalBytes: number;
  guide: VectorTextTransformGuide | null;
}

export const VECTOR_TEXT_FONT_GEOMETRY_STRATEGY =
  "local-opentype-outline-transform-v4-distort" as const;

export const VECTOR_TEXT_FONT_MANIFEST: readonly VectorTextFontEntry[] = [
  {
    family: "Anton",
    label: "Anton / Condensed",
    fileUrl: new URL("../assets/vector-text-fonts/Anton-Regular.ttf", import.meta.url),
    weight: "400",
  },
  {
    family: "Bebas Neue",
    label: "Bebas Neue",
    fileUrl: new URL("../assets/vector-text-fonts/BebasNeue-Regular.ttf", import.meta.url),
    weight: "400",
  },
  {
    family: "Poppins",
    label: "Poppins",
    fileUrl: new URL("../assets/vector-text-fonts/Poppins-Regular.ttf", import.meta.url),
    weight: "400",
  },
] as const;

interface RawTextGeometry {
  readonly normalizedText: string;
  readonly size: number;
  readonly sourcePath: OpenTypePath;
  readonly pathData: Shadow3dPathData;
  readonly rawLeft: number;
  readonly rawTop: number;
  readonly rawRight: number;
  readonly rawBottom: number;
  readonly inkBounds: VectorTextBounds;
  readonly emScale: number;
}

function finiteCoordinate(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function finiteBoxCoordinate(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function vectorPathLogicalBytes(path: Shadow3dPathData): number {
  return path.verbs.byteLength + path.coords.byteLength + path.contourOffsets.byteLength;
}

function openTypePathData(sourcePath: OpenTypePath): Shadow3dPathData {
  const verbs: number[] = [];
  const coords: number[] = [];
  const contourOffsets: number[] = [];
  for (const command of sourcePath.commands) {
    const type = String(command.type || "").toUpperCase();
    if (type === "M") {
      contourOffsets.push(verbs.length);
      verbs.push(0);
      coords.push(finiteCoordinate(command.x), finiteCoordinate(command.y));
    } else if (type === "L") {
      verbs.push(1);
      coords.push(finiteCoordinate(command.x), finiteCoordinate(command.y));
    } else if (type === "Q") {
      verbs.push(2);
      coords.push(
        finiteCoordinate(command.x1),
        finiteCoordinate(command.y1),
        finiteCoordinate(command.x),
        finiteCoordinate(command.y),
      );
    } else if (type === "C") {
      verbs.push(3);
      coords.push(
        finiteCoordinate(command.x1),
        finiteCoordinate(command.y1),
        finiteCoordinate(command.x2),
        finiteCoordinate(command.y2),
        finiteCoordinate(command.x),
        finiteCoordinate(command.y),
      );
    } else if (type === "Z") {
      verbs.push(4);
    } else {
      throw new Error("Unsupported OpenType command: " + (type || "(empty)"));
    }
  }
  return {
    verbs: new Uint8Array(verbs),
    coords: new Float64Array(coords),
    contourOffsets: new Uint32Array(contourOffsets),
    fillRule: 0,
  };
}

function rawTextGeometry(
  font: OpenTypeFont,
  text: string,
  fontSize: number,
): RawTextGeometry {
  const normalizedText = text || " ";
  const size = Math.max(1, Number(fontSize));
  const sourcePath = font.getPath(normalizedText, 0, 0, size, { kerning: true });
  const box = sourcePath.getBoundingBox();
  const emScale = size / Math.max(1, Number(font.unitsPerEm));
  const advance = Math.max(
    0,
    Number(font.getAdvanceWidth(normalizedText, size, { kerning: true })) || 0,
  );
  const inkLeft = finiteBoxCoordinate(box.x1, 0);
  const inkTop = finiteBoxCoordinate(box.y1, 0);
  const inkRight = finiteBoxCoordinate(box.x2, inkLeft);
  const inkBottom = finiteBoxCoordinate(box.y2, inkTop);
  const rawLeft = Math.min(0, inkLeft);
  const rawRight = Math.max(rawLeft + size * 0.2, advance, inkRight);
  const rawTop = Math.min(-finiteCoordinate(font.ascender) * emScale, inkTop);
  const rawBottom = Math.max(-finiteCoordinate(font.descender) * emScale, inkBottom);
  return {
    normalizedText,
    size,
    sourcePath,
    pathData: openTypePathData(sourcePath),
    rawLeft,
    rawTop,
    rawRight,
    rawBottom,
    inkBounds: {
      left: inkLeft,
      top: inkTop,
      right: inkRight,
      bottom: inkBottom,
    },
    emScale,
  };
}

function unionBounds(first: VectorTextBounds, second: VectorTextBounds): VectorTextBounds {
  return {
    left: Math.min(first.left, second.left),
    top: Math.min(first.top, second.top),
    right: Math.max(first.right, second.right),
    bottom: Math.max(first.bottom, second.bottom),
  };
}

function shiftBounds(
  bounds: VectorTextBounds,
  deltaX: number,
  deltaY: number,
): VectorTextBounds {
  return {
    left: bounds.left + deltaX,
    top: bounds.top + deltaY,
    right: bounds.right + deltaX,
    bottom: bounds.bottom + deltaY,
  };
}

function finalizedGeometry(
  pathData: Shadow3dPathData,
  logicalBounds: VectorTextBounds,
  inkBounds: VectorTextBounds,
  baseline: number,
  guide: VectorTextTransformGuide | null,
): VectorTextOutlineGeometry {
  const centerX = (logicalBounds.left + logicalBounds.right) * 0.5;
  const centerY = (logicalBounds.top + logicalBounds.bottom) * 0.5;
  const shiftedPath = shiftVectorTextPath(pathData, -centerX, -centerY);
  const shiftedLogical = shiftBounds(logicalBounds, -centerX, -centerY);
  const shiftedInk = shiftBounds(inkBounds, -centerX, -centerY);
  const shiftedGuide = guide?.kind === "curve"
    ? {
      kind: "curve" as const,
      points: guide.points.map((point) => ({
        x: point.x - centerX,
        y: point.y - centerY,
      })),
    }
    : guide?.kind === "circle"
      ? {
        kind: "circle" as const,
        centerX: guide.centerX - centerX,
        centerY: guide.centerY - centerY,
        radius: guide.radius,
      }
      : null;
  return {
    pathData: shiftedPath,
    left: shiftedLogical.left,
    top: shiftedLogical.top,
    right: shiftedLogical.right,
    bottom: shiftedLogical.bottom,
    inkLeft: shiftedInk.left,
    inkTop: shiftedInk.top,
    inkRight: shiftedInk.right,
    inkBottom: shiftedInk.bottom,
    baseline: baseline - centerY,
    logicalBytes: vectorPathLogicalBytes(shiftedPath),
    guide: shiftedGuide,
  };
}

function geometryAtLocalOrigin(
  pathData: Shadow3dPathData,
  logicalBounds: VectorTextBounds,
  inkBounds: VectorTextBounds,
): VectorTextOutlineGeometry {
  return {
    pathData,
    left: logicalBounds.left,
    top: logicalBounds.top,
    right: logicalBounds.right,
    bottom: logicalBounds.bottom,
    inkLeft: inkBounds.left,
    inkTop: inkBounds.top,
    inkRight: inkBounds.right,
    inkBottom: inkBounds.bottom,
    baseline: 0,
    logicalBytes: vectorPathLogicalBytes(pathData),
    guide: null,
  };
}

function curveEnvelopeBounds(
  guide: ReturnType<typeof buildVectorTextCurveGuide>,
  width: number,
  top: number,
  bottom: number,
  sourceDistanceOffset: number,
): VectorTextBounds {
  let left = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  const sampleCount = 512;
  for (let index = 0; index <= sampleCount; index += 1) {
    const point = guide.pointAtDistance(
      sourceDistanceOffset + width * index / sampleCount,
    );
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    minimumY = Math.min(minimumY, point.y + top);
    maximumY = Math.max(maximumY, point.y + bottom);
  }
  return { left, top: minimumY, right, bottom: maximumY };
}

function fontXHeight(font: OpenTypeFont, size: number, emScale: number): number {
  const tableHeight = Number(font.tables?.os2?.sxHeight);
  if (Number.isFinite(tableHeight) && tableHeight > 0) {
    return tableHeight * emScale;
  }
  const xBox = font.getPath("x", 0, 0, size).getBoundingBox();
  const measured = Math.abs(xBox.y2 - xBox.y1);
  return Number.isFinite(measured) && measured > 0 ? measured : size * 0.5;
}

function buildOutlineGeometry(
  font: OpenTypeFont,
  text: string,
  fontSize: number,
  requestedTransform?: Partial<VectorTextTransformParameters>,
): VectorTextOutlineGeometry {
  const raw = rawTextGeometry(font, text, fontSize);
  const transform = normalizeVectorTextTransformParameters(requestedTransform);
  const logicalBounds: VectorTextBounds = {
    left: raw.rawLeft,
    top: raw.rawTop,
    right: raw.rawRight,
    bottom: raw.rawBottom,
  };
  if (transform.type === "none") {
    return finalizedGeometry(
      raw.pathData,
      logicalBounds,
      raw.inkBounds,
      0,
      null,
    );
  }

  if (transform.type === "distort") {
    if (!transform.distortPoints) {
      return finalizedGeometry(
        raw.pathData,
        logicalBounds,
        raw.inkBounds,
        0,
        null,
      );
    }
    const transformedPath = warpVectorTextPathFreeForm(
      raw.pathData,
      raw.inkBounds,
      transform.distortPoints,
    );
    const transformedInk = vectorTextPathBounds(transformedPath);
    const envelope = vectorTextDistortBounds(transform.distortPoints);
    return geometryAtLocalOrigin(
      transformedPath,
      unionBounds(envelope, transformedInk),
      transformedInk,
    );
  }

  const width = Math.max(1, raw.rawRight - raw.rawLeft);
  const lineHeight = Math.max(1, raw.rawBottom - raw.rawTop);
  if (transform.type === "arch" || transform.type === "wave") {
    const curveGuide = buildVectorTextCurveGuide(
      transform.type,
      width,
      lineHeight,
      transform.curve,
    );
    // The text layout uses the curve's real arc length, then applies centered
    // line alignment before H5.transformCustom maps x to getPointAt.
    // A curved guide is longer than its horizontal projection: without this
    // offset, even a perfectly symmetric Arch places the text left of its apex.
    const sourceDistanceOffset = Math.max(
      0,
      (curveGuide.length - width) * 0.5,
    );
    const transformedPath = warpVectorTextPathAlongCurve(
      raw.pathData,
      curveGuide,
      raw.rawLeft,
      0,
      sourceDistanceOffset,
    );
    const transformedInk = vectorTextPathBounds(transformedPath);
    const envelope = curveEnvelopeBounds(
      curveGuide,
      width,
      raw.rawTop,
      raw.rawBottom,
      sourceDistanceOffset,
    );
    const guidePoints = curveGuide.sample(65);
    return finalizedGeometry(
      transformedPath,
      unionBounds(envelope, transformedInk),
      transformedInk,
      0,
      { kind: "curve", points: guidePoints },
    );
  }

  const textCenterX = (raw.rawLeft + raw.rawRight) * 0.5;
  const radius = Math.max(1, width * transform.circleRadiusPercent / 100);
  const pivotY = -fontXHeight(font, raw.size, raw.emScale) * 0.5;
  const circumference = Math.PI * 2 * radius;
  const transformedGlyphs: Shadow3dPathData[] = [];
  for (const glyphPath of font.getPaths(
    raw.normalizedText,
    0,
    0,
    raw.size,
    { kerning: true },
  )) {
    if (glyphPath.commands.length === 0) {
      continue;
    }
    const glyphBox = glyphPath.getBoundingBox();
    if (![glyphBox.x1, glyphBox.x2].every(Number.isFinite)) {
      continue;
    }
    const pivotX = (glyphBox.x1 + glyphBox.x2) * 0.5;
    if (Math.abs(pivotX - textCenterX) > circumference * 0.5) {
      continue;
    }
    const glyphData = openTypePathData(glyphPath);
    transformedGlyphs.push(transformVectorTextPathAffine(
      glyphData,
      vectorTextCircleAffine(
        pivotX,
        pivotY,
        textCenterX,
        radius,
        transform.circleInverted,
      ),
    ));
  }
  const transformedPath = mergeVectorTextPaths(transformedGlyphs);
  const transformedInk = vectorTextPathBounds(transformedPath);
  const envelope = vectorTextCircleEnvelopeBounds(
    raw.rawLeft,
    raw.rawTop,
    raw.rawRight,
    raw.rawBottom,
    pivotY,
    radius,
    transform.circleInverted,
  );
  return finalizedGeometry(
    transformedPath,
    unionBounds(envelope, transformedInk),
    transformedInk,
    0,
    { kind: "circle", centerX: 0, centerY: 0, radius },
  );
}

export class VectorTextFontGeometryRegistry {
  private readonly records = new Map<string, LoadedVectorTextFont>();
  private readonly loadPromises = new Map<string, Promise<void>>();

  get isPreloaded(): boolean {
    return VECTOR_TEXT_FONT_MANIFEST.every((entry) => this.records.has(entry.family));
  }

  hasFamily(family: string): boolean {
    return this.records.has(family);
  }

  hasFamilies(families: Iterable<string>): boolean {
    for (const family of families) {
      if (!this.hasFamily(family)) return false;
    }
    return true;
  }

  async preload(): Promise<void> {
    await this.ensureFamilies(VECTOR_TEXT_FONT_MANIFEST.map((entry) => entry.family));
  }

  async ensureFamilies(families: Iterable<string>): Promise<void> {
    await Promise.all([...new Set(families)].map((family) => this.ensureFamily(family)));
  }

  async ensureFamily(family: string): Promise<void> {
    if (this.records.has(family)) return;
    const existing = this.loadPromises.get(family);
    if (existing) return existing;
    const entry = VECTOR_TEXT_FONT_MANIFEST.find((candidate) => candidate.family === family);
    if (!entry) throw new Error("Unknown vector font: " + family);
    const pending = this.load(entry);
    this.loadPromises.set(family, pending);
    try {
      await pending;
    } finally {
      if (this.loadPromises.get(family) === pending) {
        this.loadPromises.delete(family);
      }
    }
  }

  outline(
    family: string,
    text: string,
    fontSize: number,
    transform?: Partial<VectorTextTransformParameters>,
  ): VectorTextOutlineGeometry {
    const record = this.records.get(family);
    if (!record) {
      throw new Error("Vector font was not preloaded: " + family);
    }
    return buildOutlineGeometry(record.font, text, fontSize, transform);
  }

  get logicalFontBytes(): number {
    return [...this.records.values()].reduce(
      (total, record) => total + record.byteLength,
      0,
    );
  }

  private async load(entry: VectorTextFontEntry): Promise<void> {
    if (this.records.has(entry.family)) return;
    const [buffer, parser] = await Promise.all([
      loadCachedAssetSource(entry.fileUrl),
      loadOpenTypeParser(),
    ]);
    const font = parser.parse(buffer);
    if (
      !font
      || !Number.isFinite(font.unitsPerEm)
      || typeof font.getPath !== "function"
      || typeof font.getPaths !== "function"
      || typeof font.getAdvanceWidth !== "function"
    ) {
      throw new Error("Invalid vector font: " + entry.label);
    }
    let face: FontFace | null = null;
    if (typeof FontFace === "function" && document.fonts) {
      try {
        face = new FontFace(entry.family, buffer.slice(0), {
          style: "normal",
          weight: entry.weight,
        });
        void face.load().then((loadedFace) => {
          document.fonts.add(loadedFace);
        }).catch(() => undefined);
      } catch {
        face = null;
      }
    }
    this.records.set(entry.family, {
      entry,
      font,
      byteLength: buffer.byteLength,
      face,
    });
  }
}
