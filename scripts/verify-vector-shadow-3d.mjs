import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  SHADOW_3D_VERSION,
  SHADOW_MODE_SINGLE,
  buildShadow3dPath,
  normalizeShadow3d,
  serializeShadow3d,
  shadow3dBounds,
  shadow3dGeometryKey,
  shadow3dVector,
  updateShadow3d,
} from "../src/vector-shadow-3d.ts";

const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("src/vector-shadow-3d.ts", root), "utf8");

assert.equal(existsSync(new URL("src/vector-shadow-3d.js", root)), false);
assert.equal(existsSync(new URL("src/vector-shadow-3d.d.ts", root)), false);
assert.match(source, /interface ShadowSegment|type ShadowSegment/);
assert.doesNotMatch(source, /@ts-nocheck|:\s*any\b/);
assert.doesNotMatch(source, /SHADOW_3D_NAME/, "unused public label must stay removed");

const migrated = normalizeShadow3d({ version: 1, enabled: true });
assert.equal(migrated.version, SHADOW_3D_VERSION);
assert.equal(migrated.blur, 0, "v1 migration must preserve its zero-blur default");
assert.deepEqual(migrated.color, [0.04, 0.055, 0.07, 1]);

const normalized = normalizeShadow3d({
  enabled: true,
  color: [-1, 0.5, 4, Number.NaN],
  offset: -20,
  angle: 405,
  blur: 1_000,
  outlineJoin: 12,
});
assert.deepEqual(normalized.color, [0, 0.5, 1, 1]);
assert.equal(normalized.offset, 0);
assert.equal(normalized.angle, 45);
assert.equal(normalized.blur, 300);
assert.equal(normalized.outlineJoin, 0);
assert.throws(() => normalizeShadow3d({ version: 99 }), RangeError);

const updated = updateShadow3d(normalized, { mode: SHADOW_MODE_SINGLE, offset: 12 });
assert.equal(updated.mode, SHADOW_MODE_SINGLE);
assert.equal(updated.offset, 12);
assert.deepEqual(serializeShadow3d(updated), {
  version: 2,
  enabled: true,
  mode: "single",
  color: [0, 0.5, 1, 1],
  offset: 12,
  angle: 45,
  blur: 300,
  outlineWidth: 0,
  outlineJoin: 0,
});
assert.equal(shadow3dGeometryKey(updated), "shadow3d-v2:single");

const horizontal = normalizeShadow3d({ enabled: true, offset: 10, angle: 0 });
assert.deepEqual(shadow3dVector(horizontal), { x: 10, y: 0 });
assert.deepEqual([...shadow3dBounds([0, 0, 20, 10], horizontal)], [0, 0, 30, 10]);

const square = {
  verbs: new Uint8Array([0, 1, 1, 1, 4]),
  coords: new Float64Array([0, 0, 20, 0, 20, 20, 0, 20]),
  contourOffsets: new Uint32Array([0]),
  fillRule: 0,
};
assert.equal(buildShadow3dPath(square, { enabled: false }), square);
const extrusion = buildShadow3dPath(square, horizontal);
assert.ok(extrusion.verbs.length > square.verbs.length);
assert.ok(extrusion.coords.length > square.coords.length);
assert.ok(extrusion.contourOffsets.length >= 1);
assert.equal(extrusion.fillRule, 0);

console.log("Vector 3D shadow: typed normalization, migration, bounds and path extrusion verified.");
