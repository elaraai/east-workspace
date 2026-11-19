/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 */

/**
 * The pins of an east release, written into a project's `pyproject.toml`:
 * the versions the release's python packages were tested with, which its
 * python images hold. A project locked under them resolves what a rack's tier
 * image holds, so an environment built over that image leaves nearly all of
 * it to the image instead of sending it.
 *
 * create-e3's build reads the release's pin files from `@elaraai/e3-core`'s
 * `tier/` ({@link parseReleasePins}), checks they are of its own version, and
 * ships what it read in its template ({@link RELEASE_PINS_FILE}): a create-e3
 * of a release scaffolds and updates projects at that release's pins, and a
 * change of the files' form fails its build, not a scaffold.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";

/** The file of a kind's template that holds its release's pins: never scaffolded, as its name starts `_`. */
export const RELEASE_PINS_FILE = "_release-pins.json";

/** The east python distributions a project installs, each at its release's own version. */
export const EAST_PY_DISTRIBUTIONS = [
  "elaraai-east-py",
  "elaraai-east-py-std",
  "elaraai-east-py-io",
  "elaraai-east-py-datascience",
  "elaraai-east-py-cli",
] as const;

/** The start of the first line of the block a project's pins are written in. */
const BLOCK_START = "# >>> east release pins";

/** The last line of that block. */
const BLOCK_END = "# <<< east release pins";

/** The header of uv's table, however it is spaced or quoted. */
const UV_TABLE = /^\s*\[\s*(tool|"tool"|'tool')\s*\.\s*(uv|"uv"|'uv')\s*\]\s*(#.*)?$/;

/** A pin as the release's constraints hold one: `name==version`, with its marker. */
const PIN = /^[A-Za-z0-9][A-Za-z0-9._-]*==[^\s;]+( ; .+)?$/;

/** An east release's pins, as a project's uv workspace takes them. */
export interface ReleasePins {
  /** The release, as python writes its version (PEP 440: `1.0.111`, `1.0.112b0`) */
  release: string;
  /** Each pin as uv's `constraint-dependencies` takes it, `name==version ; marker`:
   *  the east distributions first, at the release, then what they depend on */
  constraints: string[];
  /** The release's overrides, as uv's `override-dependencies` takes them */
  overrides: string[];
}

/**
 * The requirements of a requirements file, as `uv export` writes one: each
 * line with its continuations, without its hashes, its notes or its options.
 */
function requirements(text: string): string[] {
  return text.replace(/\\\r?\n/g, " ").split(/\r?\n/)
    .map((line) => line.split(/\s--hash[=\s]/)[0]!.trim())
    .filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("-"));
}

/**
 * The release a pin file is of: its first line names it, as
 * `scripts/east-py-constraints.py` writes it (`… of release 1.0.111 …`).
 *
 * @throws {Error} When its first line names no release
 */
function releaseOf(text: string, file: string): string {
  const release = / of release (\S+) /.exec(text.split(/\r?\n/, 1)[0] ?? "")?.[1];
  if (release === undefined) throw new Error(`the release's ${file} name no release in their first line`);
  return release;
}

/**
 * Reads an east release's two pin files, as `scripts/east-py-constraints.py`
 * writes them. create-e3's build reads them, once.
 *
 * @param files - The texts of the constraints, the release's lock exported,
 *   and of the overrides
 * @returns The release's pins: the east distributions at the release, then
 *   each pin of the constraints with its marker, and the overrides
 * @throws {Error} When a file names no release in its first line, the two
 *   name different releases, or a constraint is not `name==version` with its
 *   marker
 */
export function parseReleasePins(files: { constraints: string; overrides: string }): ReleasePins {
  const release = releaseOf(files.constraints, "constraints");
  if (releaseOf(files.overrides, "overrides") !== release) throw new Error("the release's constraints and overrides are of different releases");
  const pins = requirements(files.constraints);
  const odd = pins.find((pin) => !PIN.test(pin));
  if (odd !== undefined) throw new Error(`the release's constraints hold a pin that is not name==version with its marker: ${odd}`);
  return {
    release,
    constraints: [...EAST_PY_DISTRIBUTIONS.map((name) => `${name}==${release}`), ...pins],
    overrides: requirements(files.overrides),
  };
}

/** Whether a value is a list of strings. */
function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Reads the pins a template carries, as create-e3's build wrote them.
 *
 * @param templateDir - A kind's template root
 * @returns Its release's pins, or null when it carries none: a template read
 *   from the source tree, or create-east's
 * @throws {Error} When the file it carries is not a release's pins
 */
export function readReleasePins(templateDir: string): ReleasePins | null {
  const path = join(templateDir, RELEASE_PINS_FILE);
  if (!existsSync(path)) return null;
  const pins = JSON.parse(readFileSync(path, "utf8")) as Partial<ReleasePins> | null;
  if (pins === null || typeof pins.release !== "string" || !isStrings(pins.constraints) || !isStrings(pins.overrides)) {
    throw new Error(`internal: the template's ${RELEASE_PINS_FILE} is not a release's pins`);
  }
  return { release: pins.release, constraints: pins.constraints, overrides: pins.overrides };
}

/** A TOML array of strings, one to a line. */
function tomlArray(key: string, values: readonly string[]): string[] {
  return [`${key} = [`, ...values.map((value) => `  ${JSON.stringify(value)},`), "]"];
}

/** The lines of the block a project's pins are written in: keys of its `[tool.uv]` table. */
function pinsBlock(pins: ReleasePins): string[] {
  return [
    `${BLOCK_START}: written by create-e3, and replaced by`,
    "# `npm create @elaraai/e3@<version> -- --update` with that release's.",
    `# The versions east release ${pins.release}'s python packages were tested with,`,
    "# which its python images hold: locked under them, an environment built over",
    "# a rack's tier image leaves nearly all it installs to the image. Edit your",
    "# dependencies, not these lines. To pin by hand, replace this block with",
    "# constraint-dependencies of your own: --update then leaves them alone.",
    ...tomlArray("constraint-dependencies", pins.constraints),
    ...tomlArray("override-dependencies", pins.overrides),
    BLOCK_END,
  ];
}

/**
 * Where a project's block is, by its first and last lines, however they are
 * indented: null when it has none.
 *
 * @throws {Error} When the block has lost its last line
 */
function blockAt(lines: readonly string[]): { start: number; end: number } | null {
  const start = lines.findIndex((line) => line.trimStart().startsWith(BLOCK_START));
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && line.trim() === BLOCK_END);
  if (end === -1) {
    throw new Error(`pyproject.toml's east release pins have lost their last line (${BLOCK_END}): ` +
      "put it back after their override-dependencies, or remove them all");
  }
  return { start, end };
}

/** Whether a value is a TOML table, read. */
function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A TOML document's `[tool.uv]` table, read: empty when it has none. */
function uvTable(document: Record<string, unknown>): Record<string, unknown> {
  const tool = document["tool"];
  const uv = isTable(tool) ? tool["uv"] : undefined;
  return isTable(uv) ? uv : {};
}

/** Whether two lists hold the same strings in the same order. */
function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return isStrings(value) && value.length === expected.length && value.every((item, i) => item === expected[i]);
}

/** Whether a text is TOML whose `[tool.uv]` table holds exactly these pins. */
function holdsPins(text: string, pins: ReleasePins): boolean {
  let uv: Record<string, unknown>;
  try {
    uv = uvTable(parseToml(text));
  } catch {
    return false;
  }
  return sameStrings(uv["constraint-dependencies"], pins.constraints) && sameStrings(uv["override-dependencies"], pins.overrides);
}

/**
 * Whether a project's `pyproject.toml` carries a release's pins: the block a
 * scaffold wrote, of any release.
 *
 * @throws {Error} When the block has lost its last line
 */
export function hasReleasePins(pyproject: string): boolean {
  return blockAt(pyproject.replaceAll("\r\n", "\n").split("\n")) !== null;
}

/**
 * Writes a release's pins into a project's `pyproject.toml`, in a block of
 * its `[tool.uv]` table: an earlier release's block is replaced where it
 * stands, and a file with none is given one, in its `[tool.uv]` table or a new
 * one at its end. The file is read as TOML first, and what is written is read
 * again and must hold the pins, or nothing is returned. It keeps its line
 * endings.
 *
 * @param pyproject - The project's `pyproject.toml`
 * @param pins - The release's pins
 * @returns The `pyproject.toml` with them
 * @throws {Error} When the file is not TOML, sets uv's constraints or
 *   overrides itself, outside the block, defines `[tool.uv]` in a form the
 *   block cannot be added to (dotted keys, an inline table), or its block has
 *   lost its last line
 */
export function withReleasePins(pyproject: string, pins: ReleasePins): string {
  const eol = pyproject.includes("\r\n") ? "\r\n" : "\n";
  const lines = pyproject.replaceAll("\r\n", "\n").split("\n");
  const block = pinsBlock(pins);
  const at = blockAt(lines);
  const rest = at === null ? lines : [...lines.slice(0, at.start), ...lines.slice(at.end + 1)];
  let own: Record<string, unknown>;
  try {
    own = uvTable(parseToml(rest.join("\n")));
  } catch (err) {
    throw new Error(`pyproject.toml is not TOML: ${(err instanceof Error ? err.message : String(err)).split("\n")[0]}`);
  }
  if (own["constraint-dependencies"] !== undefined || own["override-dependencies"] !== undefined) {
    throw new Error("pyproject.toml sets its own [tool.uv] constraint-dependencies or override-dependencies: " +
      "remove them to take the release's pins, or keep them and pin by hand");
  }
  // Where the block may go, in turn: where it stood; under the [tool.uv]
  // header; in a table of its own at the end. The first whose text holds the
  // pins, read, is the one written: a header inside a multi-line string, or a
  // [tool.uv] of dotted keys, takes none.
  const candidates: string[][] = [];
  if (at !== null) candidates.push([...lines.slice(0, at.start), ...block, ...lines.slice(at.end + 1)]);
  const table = rest.findIndex((line) => UV_TABLE.test(line));
  if (table !== -1) candidates.push([...rest.slice(0, table + 1), ...block, ...rest.slice(table + 1)]);
  const body = [...rest];
  while (body.length > 0 && body[body.length - 1]!.trim() === "") body.pop();
  candidates.push([...body, ...(body.length > 0 ? [""] : []), "[tool.uv]", ...block, ""]);
  const pinned = candidates.find((candidate) => holdsPins(candidate.join("\n"), pins));
  if (pinned === undefined) {
    throw new Error("pyproject.toml defines [tool.uv] in a form the release's pins cannot be added to (dotted keys or an " +
      "inline table): write it as a [tool.uv] table, or pin by hand");
  }
  return pinned.join(eol);
}
