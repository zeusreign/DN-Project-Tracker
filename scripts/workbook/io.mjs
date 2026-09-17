// Output helper shared by the workbook import scripts.
//
// Its only job is to make a missing output directory a non-event. Before this,
// pointing --out at a directory that did not exist yet failed with ENOENT after
// the work had already been done — the parse or the reconciliation had run, the
// database had been read, and the result was thrown away for want of a mkdir.
//
// It changes nothing about what is written, only that the destination is ready.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Writes `content` to `outputPath`, resolved against `projectRoot`, creating any
// missing parent directories. Returns the absolute path actually written.
export function writeOutput(projectRoot, outputPath, content) {
  const absolute = resolve(projectRoot, outputPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

// The same, for a value that should be stored as pretty-printed JSON with a
// trailing newline — the shape every report in this pipeline uses.
export function writeJson(projectRoot, outputPath, value) {
  return writeOutput(projectRoot, outputPath, JSON.stringify(value, null, 2) + "\n");
}
