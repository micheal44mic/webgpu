import assert from "node:assert/strict";
import { area } from "clipper2-ts";
import { triangulateCanonicalVectorTextSet } from "../../../src/vector-text-effect-geometry.ts";

export function polygonPath(rings, fillRule = 0) {
  const verbs = [];
  const coords = [];
  const contourOffsets = [];
  for (const ring of rings) {
    assert.ok(ring.length >= 3);
    contourOffsets.push(verbs.length);
    verbs.push(0);
    coords.push(ring[0][0], ring[0][1]);
    for (let index = 1; index < ring.length; index += 1) {
      verbs.push(1);
      coords.push(ring[index][0], ring[index][1]);
    }
    verbs.push(4);
  }
  return {
    verbs: new Uint8Array(verbs),
    coords: new Float64Array(coords),
    contourOffsets: new Uint32Array(contourOffsets),
    fillRule,
  };
}

export function reverseRing(ring) {
  return [...ring].reverse();
}

export function assertCanonical(set, label) {
  for (const group of set.groups) {
    assert.ok(area(group.outer) > 0, `${label}: outer non positivo`);
    for (const hole of group.holes) {
      assert.ok(area(hole) < 0, `${label}: hole non negativo`);
    }
  }
  for (const ring of set.paths) {
    assert.ok(ring.length >= 3, `${label}: ring corto`);
    for (let index = 0; index < ring.length; index += 1) {
      const current = ring[index];
      const next = ring[(index + 1) % ring.length];
      assert.notDeepEqual(current, next, `${label}: punti consecutivi duplicati`);
      assert.ok(Number.isSafeInteger(current.x), `${label}: x non safe integer`);
      assert.ok(Number.isSafeInteger(current.y), `${label}: y non safe integer`);
    }
  }
}

export function canonicalArea(set, integerScale) {
  return set.paths.reduce((total, ring) => total + area(ring), 0)
    / (integerScale * integerScale);
}

export function meshTriangleArea(mesh) {
  let total = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const ia = mesh.indices[index] * 2;
    const ib = mesh.indices[index + 1] * 2;
    const ic = mesh.indices[index + 2] * 2;
    assert.ok(ic + 1 < mesh.vertices.length, "indice Earcut fuori range");
    const ax = mesh.vertices[ia];
    const ay = mesh.vertices[ia + 1];
    const bx = mesh.vertices[ib];
    const by = mesh.vertices[ib + 1];
    const cx = mesh.vertices[ic];
    const cy = mesh.vertices[ic + 1];
    const twice = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    assert.ok(Math.abs(twice) > 1e-10, "triangolo Earcut degenere");
    total += Math.abs(twice) * 0.5;
  }
  return total;
}

export function assertTriangulation(set, lod, label) {
  const mesh = triangulateCanonicalVectorTextSet(
    set,
    lod.integerScale,
    `verify:${label}`,
    lod.bucket,
  );
  assert.equal(mesh.indices.length % 3, 0);
  const expected = canonicalArea(set, lod.integerScale);
  const actual = meshTriangleArea(mesh);
  const tolerance = Math.max(1e-5, Math.abs(expected) * 2e-6);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: area mesh ${actual} != area canonica ${expected}`,
  );
  return mesh;
}

export function canonicalKey(set) {
  return JSON.stringify(set.groups.map((group) => ({
    outer: group.outer.map(({ x, y }) => [x, y]),
    holes: group.holes.map((ring) => ring.map(({ x, y }) => [x, y])),
  })));
}

export function absoluteMeshBounds(mesh) {
  return {
    left: mesh.left + mesh.originX,
    top: mesh.top + mesh.originY,
    right: mesh.right + mesh.originX,
    bottom: mesh.bottom + mesh.originY,
  };
}
