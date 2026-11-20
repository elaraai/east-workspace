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

import { isPlainObject } from "./util.js";

/** The file of a kind's template that holds its release's pins: never scaffolded, as its name starts `_`. */
export const RELEASE_PINS_FILE = "_release-pins.json";

/** The start of the first line of the block a project's pins are written in. */
const BLOCK_START = "# >>> east release pins";

/** The last line of that block. */
const BLOCK_END = "# <<< east release pins";

/** The header of uv's table, however it is spaced or quoted. */
const UV_TABLE = /^\s*\[\s*(tool|"tool"|'tool')\s*\.\s*(uv|"uv"|'uv')\s*\]\s*(#.*)?$/;

/** A distribution's name, as PEP 508 writes one. */
const NAME = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** A pin as the release's constraints hold one: `name==version`, with its marker. */
const PIN = /^[A-Za-z0-9][A-Za-z0-9._-]*==[^\s;]+( ; .+)?$/;

/** An east release's pins, as a project's uv workspace takes them. */
export interface ReleasePins {
  /** The release, as python writes its version (PEP 440: `1.0.111`, `1.0.112b0`) */
  release: string;
  /** Each pin as uv's `constraint-dependencies` takes it, `name==version ; marker`:
   *  the release's own distributions first, at the release, then what they depend on */
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
 *   and of the overrides; and the release's own python distributions, which
 *   the export leaves out (`scripts/set-python-version.mjs`'s
 *   `eastPyDistributions`)
 * @returns The release's pins: its own distributions at the release, then
 *   each pin of the constraints with its marker, and the overrides
 * @throws {Error} When a file names no release in its first line, the two
 *   name different releases, a constraint is not `name==version` with its
 *   marker, or no distribution of the release's own is given
 */
export function parseReleasePins(files: { constraints: string; overrides: string; distributions: readonly string[] }): ReleasePins {
  const release = releaseOf(files.constraints, "constraints");
  if (releaseOf(files.overrides, "overrides") !== release) throw new Error("the release's constraints and overrides are of different releases");
  if (files.distributions.length === 0 || files.distributions.some((name) => !NAME.test(name))) {
    throw new Error(`the release's own distributions are not names of distributions: ${JSON.stringify(files.distributions)}`);
  }
  const pins = requirements(files.constraints);
  const odd = pins.find((pin) => !PIN.test(pin));
  if (odd !== undefined) throw new Error(`the release's constraints hold a pin that is not name==version with its marker: ${odd}`);
  return {
    release,
    constraints: [...files.distributions.map((name) => `${name}==${release}`), ...pins],
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

/** A distribution's name as PEP 503 normalizes it, which uv compares names by. */
function normalized(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/** The name a pin is of. */
function pinName(pin: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*/.exec(pin)?.[0] ?? pin;
}

/** A TOML array of strings, one to a line. */
function tomlArray(key: string, values: readonly string[]): string[] {
  return [`${key} = [`, ...values.map((value) => `  ${JSON.stringify(value)},`), "]"];
}

/** The lines of the block a project's pins are written in: keys of its `[tool.uv]` table. */
function pinsBlock(release: string, constraints: readonly string[], overrides: readonly string[]): string[] {
  return [
    `${BLOCK_START}: written by create-e3, and replaced by`,
    "# `npm create @elaraai/e3@<version> -- --update` with that release's.",
    `# The versions east release ${release}'s python packages were tested with,`,
    "# which its python images hold: locked under them, an environment built over",
    "# a rack's tier image leaves nearly all it installs to the image. Edit your",
    "# dependencies, not these lines. To pin by hand, replace this block with",
    "# constraint-dependencies of your own: --update then leaves them alone.",
    ...tomlArray("constraint-dependencies", constraints),
    ...tomlArray("override-dependencies", overrides),
    BLOCK_END,
  ];
}

/** A line of a text, with the ending it has: `\r\n`, `\n`, or none, at the text's end. */
interface Line {
  readonly text: string;
  readonly eol: string;
}

/** A text's lines, each with its own ending: joined again, they are the text. */
function linesOf(text: string): Line[] {
  const parts = text.split(/(\r?\n)/);
  const lines: Line[] = [];
  for (let i = 0; i < parts.length; i += 2) lines.push({ text: parts[i]!, eol: parts[i + 1] ?? "" });
  return lines;
}

/** The lines, each with its own ending. */
const textOf = (lines: readonly Line[]): string => lines.map((line) => line.text + line.eol).join("");

/** The lines as a TOML reader takes them. */
const tomlOf = (lines: readonly Line[]): string => lines.map((line) => line.text).join("\n");

/** The ending most of a text's lines have: `\n` when none has one. */
function commonEol(lines: readonly Line[]): string {
  const crlf = lines.filter((line) => line.eol === "\r\n").length;
  const lf = lines.filter((line) => line.eol === "\n").length;
  return crlf > lf ? "\r\n" : "\n";
}

/** The block's lines, each ending as the lines they are written among. */
function blockLines(block: readonly string[], eol: string, lastEol: string): Line[] {
  return block.map((text, i) => ({ text, eol: i === block.length - 1 ? lastEol : eol }));
}

/**
 * Where a project's block is, by its first and last lines, however they are
 * indented: null when it has none.
 *
 * @throws {Error} When the block has lost its last line
 */
function blockAt(lines: readonly Line[]): { start: number; end: number } | null {
  const start = lines.findIndex((line) => line.text.trimStart().startsWith(BLOCK_START));
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && line.text.trim() === BLOCK_END);
  if (end === -1) {
    throw new Error(`pyproject.toml's east release pins have lost their last line (${BLOCK_END}): ` +
      "put it back after their override-dependencies, or remove them all");
  }
  return { start, end };
}

/** A TOML document's `[tool.uv]` table, read: empty when it has none. */
function uvTable(document: Record<string, unknown>): Record<string, unknown> {
  const tool = document["tool"];
  const uv = isPlainObject(tool) ? tool["uv"] : undefined;
  return isPlainObject(uv) ? uv : {};
}

/** Whether two lists hold the same strings in the same order. */
function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return isStrings(value) && value.length === expected.length && value.every((item, i) => item === expected[i]);
}

/** Whether a text is TOML whose `[tool.uv]` table holds exactly these pins. */
function holdsPins(text: string, constraints: readonly string[], overrides: readonly string[]): boolean {
  let uv: Record<string, unknown>;
  try {
    uv = uvTable(parseToml(text));
  } catch {
    return false;
  }
  return sameStrings(uv["constraint-dependencies"], constraints) && sameStrings(uv["override-dependencies"], overrides);
}

/**
 * Whether a project's `pyproject.toml` carries a release's pins: the block a
 * scaffold wrote, of any release.
 *
 * @throws {Error} When the block has lost its last line
 */
export function hasReleasePins(pyproject: string): boolean {
  return blockAt(linesOf(pyproject)) !== null;
}

/**
 * Writes a release's pins into a project's `pyproject.toml`, in a block of
 * its `[tool.uv]` table: an earlier release's block is replaced where it
 * stands, and a file with none is given one, in its `[tool.uv]` table or a new
 * one at its end. The file is read as TOML first, and what is written is read
 * again and must hold the pins, or nothing is returned.
 *
 * @remarks
 * A pin of a package the project is itself is left out, as uv takes the
 * project for that package and refuses a pin of it: the project's own name,
 * every package it takes from a source of its own (`[tool.uv.sources]`: a
 * workspace member, a path, a repository), and `own`. Each line keeps its own
 * ending, and the block's take those of the lines around them, so the same
 * pins again give back the same bytes.
 *
 * @param pyproject - The project's `pyproject.toml`
 * @param pins - The release's pins
 * @param own - More names of packages the project is: its workspace members
 * @returns The `pyproject.toml` with them
 * @throws {Error} When the file is not TOML, sets uv's constraints or
 *   overrides itself, outside the block, defines `[tool.uv]` in a form the
 *   block cannot be added to (dotted keys, an inline table), or its block has
 *   lost its last line
 */
export function withReleasePins(pyproject: string, pins: ReleasePins, own: readonly string[] = []): string {
  const lines = linesOf(pyproject);
  const at = blockAt(lines);
  const rest = at === null ? lines : [...lines.slice(0, at.start), ...lines.slice(at.end + 1)];
  let document: Record<string, unknown>;
  try {
    document = parseToml(tomlOf(rest));
  } catch (err) {
    throw new Error(`pyproject.toml is not TOML: ${(err instanceof Error ? err.message : String(err)).split("\n")[0]}`);
  }
  const uv = uvTable(document);
  if (uv["constraint-dependencies"] !== undefined || uv["override-dependencies"] !== undefined) {
    throw new Error("pyproject.toml sets its own [tool.uv] constraint-dependencies or override-dependencies: " +
      "remove them to take the release's pins, or keep them and pin by hand");
  }
  const project = document["project"];
  const sources = uv["sources"];
  const ownNames = new Set([
    ...(isPlainObject(project) && typeof project["name"] === "string" ? [project["name"]] : []),
    ...(isPlainObject(sources) ? Object.keys(sources) : []),
    ...own,
  ].map(normalized));
  const constraints = pins.constraints.filter((pin) => !ownNames.has(normalized(pinName(pin))));
  const block = pinsBlock(pins.release, constraints, pins.overrides);

  // Where the block may go, in turn: where it stood; under each line that
  // reads as the [tool.uv] header; in a table of its own at the end. The first
  // whose text holds the pins, read, is the one written: a header inside a
  // multi-line string, or a [tool.uv] of dotted keys, takes none.
  const candidates: Line[][] = [];
  if (at !== null) {
    candidates.push([...lines.slice(0, at.start), ...blockLines(block, lines[at.start]!.eol, lines[at.end]!.eol), ...lines.slice(at.end + 1)]);
  }
  const eol = commonEol(rest);
  rest.forEach((line, i) => {
    if (!UV_TABLE.test(line.text)) return;
    const header = { text: line.text, eol: line.eol === "" ? eol : line.eol };
    candidates.push([...rest.slice(0, i), header, ...blockLines(block, header.eol, line.eol), ...rest.slice(i + 1)]);
  });
  const body = [...rest];
  while (body.length > 0 && body[body.length - 1]!.text.trim() === "") body.pop();
  const tail = body.length === 0 ? [] : [{ text: body[body.length - 1]!.text, eol: body[body.length - 1]!.eol || eol }];
  candidates.push([...body.slice(0, -1), ...tail, ...(body.length > 0 ? [{ text: "", eol }] : []), { text: "[tool.uv]", eol }, ...blockLines(block, eol, eol)]);
  const pinned = candidates.find((candidate) => holdsPins(tomlOf(candidate), constraints, pins.overrides));
  if (pinned === undefined) {
    throw new Error("pyproject.toml defines [tool.uv] in a form the release's pins cannot be added to (dotted keys or an " +
      "inline table): write it as a [tool.uv] table, or pin by hand");
  }
  return textOf(pinned);
}
