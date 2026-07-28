import opentype from "opentype.js";
import {
  buildShadow3dPath,
  type Shadow3dPathData,
} from "./vector-shadow-3d.js";

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
  getPath(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    options?: { kerning?: boolean },
  ): OpenTypePath;
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

export interface VectorTextOutlineGeometry {
  pathData: Shadow3dPathData;
  canvasPath: Path2D;
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
}

export interface VectorTextBlockShadowGeometry {
  pathData: Shadow3dPathData;
  canvasPath: Path2D;
  logicalBytes: number;
}

export const VECTOR_TEXT_FONT_GEOMETRY_STRATEGY =
  "local-opentype-outline-canvas-path-v1" as const;
export const VECTOR_TEXT_BLOCK_SHADOW_VECTOR_STRATEGY =
  "paint-webgpu-m1-shadow3d-v2-single-extruded-vector-silhouette" as const;

export const VECTOR_TEXT_FONT_MANIFEST: readonly VectorTextFontEntry[] = [
  {
    family: "Anton",
    label: "Anton / condensato",
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

function finiteCoordinate(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function vectorPathLogicalBytes(path: Shadow3dPathData): number {
  return path.verbs.byteLength + path.coords.byteLength + path.contourOffsets.byteLength;
}

export function vectorPathDataToCanvasPath(path: Shadow3dPathData): Path2D {
  const canvasPath = new Path2D();
  let coordinateOffset = 0;
  for (const verb of path.verbs) {
    if (verb === 0) {
      canvasPath.moveTo(
        path.coords[coordinateOffset],
        path.coords[coordinateOffset + 1],
      );
      coordinateOffset += 2;
    } else if (verb === 1) {
      canvasPath.lineTo(
        path.coords[coordinateOffset],
        path.coords[coordinateOffset + 1],
      );
      coordinateOffset += 2;
    } else if (verb === 2) {
      canvasPath.quadraticCurveTo(
        path.coords[coordinateOffset],
        path.coords[coordinateOffset + 1],
        path.coords[coordinateOffset + 2],
        path.coords[coordinateOffset + 3],
      );
      coordinateOffset += 4;
    } else if (verb === 3) {
      canvasPath.bezierCurveTo(
        path.coords[coordinateOffset],
        path.coords[coordinateOffset + 1],
        path.coords[coordinateOffset + 2],
        path.coords[coordinateOffset + 3],
        path.coords[coordinateOffset + 4],
        path.coords[coordinateOffset + 5],
      );
      coordinateOffset += 6;
    } else if (verb === 4) {
      canvasPath.closePath();
    } else {
      throw new Error(`Verbo outline testo non supportato: ${verb}`);
    }
  }
  if (coordinateOffset !== path.coords.length) {
    throw new Error("Coordinate outline testo incoerenti.");
  }
  return canvasPath;
}

function buildOutlineGeometry(
  font: OpenTypeFont,
  text: string,
  fontSize: number,
): VectorTextOutlineGeometry {
  const normalizedText = text || " ";
  const size = Math.max(1, Number(fontSize));
  const sourcePath = font.getPath(normalizedText, 0, 0, size, { kerning: true });
  const box = sourcePath.getBoundingBox();
  const emScale = size / Math.max(1, Number(font.unitsPerEm));
  const advance = Math.max(
    0,
    Number(font.getAdvanceWidth(normalizedText, size, { kerning: true })) || 0,
  );
  const rawLeft = Math.min(0, finiteCoordinate(box.x1));
  const rawRight = Math.max(
    rawLeft + size * 0.2,
    advance,
    finiteCoordinate(box.x2),
  );
  const rawTop = Math.min(
    -finiteCoordinate(font.ascender) * emScale,
    finiteCoordinate(box.y1),
  );
  const rawBottom = Math.max(
    -finiteCoordinate(font.descender) * emScale,
    finiteCoordinate(box.y2),
  );
  const centerX = (rawLeft + rawRight) * 0.5;
  const centerY = (rawTop + rawBottom) * 0.5;
  const verbs: number[] = [];
  const coords: number[] = [];
  const contourOffsets: number[] = [];

  for (const command of sourcePath.commands) {
    const type = String(command.type || "").toUpperCase();
    if (type === "M") {
      contourOffsets.push(verbs.length);
      verbs.push(0);
      coords.push(
        finiteCoordinate(command.x) - centerX,
        finiteCoordinate(command.y) - centerY,
      );
    } else if (type === "L") {
      verbs.push(1);
      coords.push(
        finiteCoordinate(command.x) - centerX,
        finiteCoordinate(command.y) - centerY,
      );
    } else if (type === "Q") {
      verbs.push(2);
      coords.push(
        finiteCoordinate(command.x1) - centerX,
        finiteCoordinate(command.y1) - centerY,
        finiteCoordinate(command.x) - centerX,
        finiteCoordinate(command.y) - centerY,
      );
    } else if (type === "C") {
      verbs.push(3);
      coords.push(
        finiteCoordinate(command.x1) - centerX,
        finiteCoordinate(command.y1) - centerY,
        finiteCoordinate(command.x2) - centerX,
        finiteCoordinate(command.y2) - centerY,
        finiteCoordinate(command.x) - centerX,
        finiteCoordinate(command.y) - centerY,
      );
    } else if (type === "Z") {
      verbs.push(4);
    } else {
      throw new Error(`Comando OpenType non supportato: ${type || "(vuoto)"}`);
    }
  }

  const pathData: Shadow3dPathData = {
    verbs: new Uint8Array(verbs),
    coords: new Float64Array(coords),
    contourOffsets: new Uint32Array(contourOffsets),
    fillRule: 0,
  };
  return {
    pathData,
    canvasPath: vectorPathDataToCanvasPath(pathData),
    left: rawLeft - centerX,
    top: rawTop - centerY,
    right: rawRight - centerX,
    bottom: rawBottom - centerY,
    inkLeft: finiteCoordinate(box.x1) - centerX,
    inkTop: finiteCoordinate(box.y1) - centerY,
    inkRight: finiteCoordinate(box.x2) - centerX,
    inkBottom: finiteCoordinate(box.y2) - centerY,
    baseline: -centerY,
    logicalBytes: vectorPathLogicalBytes(pathData),
  };
}

export function buildVectorTextBlockShadowGeometry(
  outline: VectorTextOutlineGeometry,
  offset: number,
  angleDegrees: number,
): VectorTextBlockShadowGeometry {
  const pathData = buildShadow3dPath(
    outline.pathData,
    {
      enabled: true,
      mode: "3d",
      offset: Math.max(0, Number.isFinite(offset) ? offset : 0),
      // Il core originale usa Y cartesiana; il canvas cresce verso il basso.
      angle: -(Number.isFinite(angleDegrees) ? angleDegrees : 0),
      outlineWidth: 0,
      outlineJoin: 0,
    },
    { tolerance: 0.3 },
  );
  return {
    pathData,
    canvasPath: vectorPathDataToCanvasPath(pathData),
    logicalBytes: vectorPathLogicalBytes(pathData),
  };
}

export class VectorTextFontGeometryRegistry {
  private readonly records = new Map<string, LoadedVectorTextFont>();

  async preload(): Promise<void> {
    await Promise.all(VECTOR_TEXT_FONT_MANIFEST.map((entry) => this.load(entry)));
  }

  outline(family: string, text: string, fontSize: number): VectorTextOutlineGeometry {
    const record = this.records.get(family);
    if (!record) {
      throw new Error(`Font vettoriale non precaricato: ${family}`);
    }
    return buildOutlineGeometry(record.font, text, fontSize);
  }

  get logicalFontBytes(): number {
    return [...this.records.values()].reduce(
      (total, record) => total + record.byteLength,
      0,
    );
  }

  private async load(entry: VectorTextFontEntry): Promise<void> {
    const response = await fetch(entry.fileUrl);
    if (!response.ok) {
      throw new Error(`Font vettoriale mancante (${entry.label}): HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const font = opentype.parse(buffer) as OpenTypeFont;
    if (
      !font
      || !Number.isFinite(font.unitsPerEm)
      || typeof font.getPath !== "function"
      || typeof font.getAdvanceWidth !== "function"
    ) {
      throw new Error(`Font vettoriale non valido: ${entry.label}`);
    }
    let face: FontFace | null = null;
    if (typeof FontFace === "function" && document.fonts) {
      try {
        face = new FontFace(entry.family, buffer.slice(0), {
          style: "normal",
          weight: entry.weight,
        });
        await face.load();
        document.fonts.add(face);
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
