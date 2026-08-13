import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  readEditorHtml,
  readEditorStyleSource,
} from "../ui-shell-source.mjs";

const REPOSITORY_ROOT = new URL("../../", import.meta.url);
export const SOURCE_SECTION_MAXIMUM_BYTES = 60_000;

export function readRepositorySource(relativePath) {
  const source = relativePath === "index.html"
    ? readEditorHtml()
    : relativePath === "src/styles.css"
      ? readEditorStyleSource()
      : readFileSync(new URL(relativePath, REPOSITORY_ROOT), "utf8")
        .replace(/\r\n?/g, "\n");
  assert.ok(source.trim().length > 0, `${relativePath}: sorgente assente o vuoto`);
  return source;
}

export function assertBoundedSourceSection(
  label,
  start,
  end,
  maximumBytes = SOURCE_SECTION_MAXIMUM_BYTES,
) {
  assert.ok(start >= 0, `sezione ${label}: marcatore iniziale assente`);
  assert.ok(end > start, `sezione ${label}: marcatore finale assente o precedente all'inizio`);
  assert.ok(
    end - start <= maximumBytes,
    `sezione ${label}: ${end - start} byte, oltre il limite di ${maximumBytes}`
      + " — il marcatore e disallineato e l'asserzione non verificherebbe piu nulla",
  );
}

export function boundedSourceSection(
  source,
  { label, startMarker, endMarker, from = 0, maximumBytes },
) {
  const start = source.indexOf(startMarker, from);
  const end = source.indexOf(endMarker, start < 0 ? from : start + startMarker.length);
  assertBoundedSourceSection(label, start, end, maximumBytes);
  return source.slice(start, end);
}
