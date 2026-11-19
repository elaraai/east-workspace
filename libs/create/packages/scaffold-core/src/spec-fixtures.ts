/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

/**
 * The specs' shared fixtures: the source tree's templates, the repository's
 * own release pin files, a template that carries a release's pins as
 * create-e3's build gives its template, a release's pins to write, and
 * reading what a scaffold wrote. Not part of the scaffold.
 */

import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseToml } from "smol-toml";

import { RELEASE_PINS_FILE, parseReleasePins, type ReleasePins } from "./pins.js";

/** The source tree's template roots. */
export const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "templates");

/** The repository's root. */
const REPO_ROOT = join(TEMPLATES, "..", "..", "..");

/** Where the release keeps its pin files, and their names: the release script's own, which create-e3's build reads them by. */
const PIN_FILES = await import(pathToFileURL(join(REPO_ROOT, "scripts", "set-python-version.mjs")).href) as {
  EAST_PY_PINS_DIR: string;
  EAST_PY_CONSTRAINTS: string;
  EAST_PY_OVERRIDES: string;
};

/** The texts of the repository's own release pin files: `@elaraai/e3-core`'s `tier/`. */
export function repositoryPinTexts(): { constraints: string; overrides: string } {
  const dir = join(REPO_ROOT, PIN_FILES.EAST_PY_PINS_DIR);
  return {
    constraints: readFileSync(join(dir, PIN_FILES.EAST_PY_CONSTRAINTS), "utf8"),
    overrides: readFileSync(join(dir, PIN_FILES.EAST_PY_OVERRIDES), "utf8"),
  };
}

/** A `[tool.uv]` table a scaffold gave the release's pins, LF-normalized: its header, then their block. */
export const PINNED_UV_TABLE = /\n\[tool\.uv\]\n# >>> east release pins/;

/** A release's pins, small: its east-py, and one pin and one override of what it depends on. */
export const pinsOf = (release: string): ReleasePins => ({
  release, constraints: [`elaraai-east-py==${release}`, "numpy==2.4.4"], overrides: ["shap>=0.51.0"],
});

/**
 * A copy of the e3 template carrying a release's pins, as create-e3's build
 * gives its own.
 *
 * @param pins - The pins, or the text of the file that holds them; the
 *   repository's own release pins when not given
 * @returns The template root, in a directory of its own
 */
export function templateWithPins(pins: ReleasePins | string = parseReleasePins(repositoryPinTexts())): string {
  const template = join(mkdtempSync(join(tmpdir(), "create-pins-")), "e3");
  cpSync(join(TEMPLATES, "e3"), template, { recursive: true });
  writeFileSync(join(template, RELEASE_PINS_FILE), typeof pins === "string" ? pins : JSON.stringify(pins));
  return template;
}

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
 * A TOML document, read as e3 reads a project's `pyproject.toml` (smol-toml,
 * which holds to the specification as uv does, and refuses what it refuses).
 *
 * @throws {Error} When it is not TOML
 */
export function readToml(text: string): Record<string, unknown> {
  return parseToml(text) as Record<string, unknown>;
}
