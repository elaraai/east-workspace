/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

/**
 * The specs' shared fixtures: the source tree's templates, a template that
 * carries an east release's pins as create-e3's build gives its template, and
 * a reading of TOML as uv's own reader would take it. Not part of the scaffold.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PINS_DIR, PINS_FILES } from "./pins.js";

/** The source tree's template roots. */
export const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "templates");

/** The repository's release pins: `@elaraai/e3-core`'s `tier/`, which create-e3's build copies. */
export const TIER_DIR = join(TEMPLATES, "..", "..", "..", "libs", "e3", "packages", "e3-core", "tier");

/** A `[tool.uv]` table a scaffold gave the release's pins, LF-normalized: its header, then their block. */
export const PINNED_UV_TABLE = /\n\[tool\.uv\]\n# >>> east release pins/;

/**
 * A file a scaffold wrote, LF-normalized: a Windows checkout carries the
 * templates with CRLF, and the scaffold copies their bodies verbatim and
 * writes what it adds in the file's own line endings.
 *
 * @param dir - The scaffolded project
 * @param rel - The file, relative to it
 * @returns Its text, every line ending `\n`
 */
export function readScaffolded(dir: string, rel: string): string {
  return readFileSync(join(dir, rel), "utf8").replaceAll("\r\n", "\n");
}

/**
 * A copy of the e3 template carrying pins: the repository's release pins, or
 * the files given.
 *
 * @param files - The pins files' texts; the repository's when not given
 * @returns The template root, in a directory of its own
 */
export function templateWithPins(files?: { constraints: string; overrides: string }): string {
  const template = join(mkdtempSync(join(tmpdir(), "create-pins-")), "e3");
  cpSync(join(TEMPLATES, "e3"), template, { recursive: true });
  mkdirSync(join(template, PINS_DIR));
  if (files === undefined) {
    for (const name of Object.values(PINS_FILES)) cpSync(join(TIER_DIR, name), join(template, PINS_DIR, name));
  } else {
    writeFileSync(join(template, PINS_DIR, PINS_FILES.constraints), files.constraints);
    writeFileSync(join(template, PINS_DIR, PINS_FILES.overrides), files.overrides);
  }
  return template;
}

/**
 * A TOML document as python's `tomllib` reads it, which holds to the
 * specification as uv's own reader does, and refuses what it refuses: run by
 * uv on Python 3.12, the uv and Python the repository's suites take.
 *
 * @returns The document
 * @throws {Error} When `tomllib` refuses it, with what it said, or uv cannot run it
 */
export function readToml(text: string): Record<string, unknown> {
  const read = "import json, sys, tomllib; print(json.dumps(tomllib.loads(sys.stdin.read())))";
  const out = execFileSync("uv", ["run", "--no-project", "--python", "3.12", "python", "-c", read], { input: text, encoding: "utf8" });
  return JSON.parse(out) as Record<string, unknown>;
}
