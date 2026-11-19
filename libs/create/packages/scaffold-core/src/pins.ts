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
 * create-e3's build copies the release's pins from `@elaraai/e3-core`'s
 * `tier/` into its template ({@link PINS_DIR}), so a create-e3 of a release
 * scaffolds and updates projects at that release's pins.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The directory of a kind's template that holds its release's pins. */
export const PINS_DIR = "_pins";

/** The files of a template's pins, named as `@elaraai/e3-core`'s `tier/` names them. */
export const PINS_FILES = {
  /** What the release's python packages depend on, pinned, as `uv export` writes a lock */
  constraints: "east-py-constraints.txt",
  /** The overrides their resolution takes over what a dependent asks */
  overrides: "east-py-overrides.txt",
} as const;

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

/** The header of uv's table, however it is spaced. */
const UV_TABLE = /^\s*\[\s*tool\s*\.\s*uv\s*\]\s*(#.*)?$/;

/** A key of uv's that the block sets, set by the project itself: under `[tool.uv]`, or dotted. */
const OWN_PINS = /^\s*(tool\s*\.\s*uv\s*\.\s*)?["']?(constraint|override)-dependencies["']?\s*=/;

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
 * The release a pins file is of: its first line names it, as
 * `scripts/east-py-constraints.py` writes it (`… of release 1.0.111 …`), and
 * the version drift check holds it to the release.
 *
 * @throws {Error} When its first line names no release
 */
function releaseOf(text: string, file: string): string {
  const release = / of release (\S+) /.exec(text.split(/\r?\n/, 1)[0] ?? "")?.[1];
  if (release === undefined) throw new Error(`internal: ${file} names no release in its first line`);
  return release;
}

/**
 * Reads the pins a template carries.
 *
 * @param templateDir - A kind's template root
 * @returns Its release's pins, or null when it carries none: a template read
 *   from the source tree, which create-e3's build has not given them
 * @throws {Error} When it carries one file of them alone, or files of two
 *   releases, or of none
 */
export function readReleasePins(templateDir: string): ReleasePins | null {
  const dir = join(templateDir, PINS_DIR);
  const files = Object.values(PINS_FILES);
  const present = files.filter((name) => existsSync(join(dir, name)));
  if (present.length === 0) return null;
  if (present.length !== files.length) throw new Error(`internal: the template's ${PINS_DIR} holds ${present.join(", ")} alone`);
  const constraints = readFileSync(join(dir, PINS_FILES.constraints), "utf8");
  const overrides = readFileSync(join(dir, PINS_FILES.overrides), "utf8");
  const release = releaseOf(constraints, PINS_FILES.constraints);
  if (releaseOf(overrides, PINS_FILES.overrides) !== release) {
    throw new Error(`internal: ${PINS_FILES.constraints} and ${PINS_FILES.overrides} are of different releases`);
  }
  return {
    release,
    constraints: [...EAST_PY_DISTRIBUTIONS.map((name) => `${name}==${release}`), ...requirements(constraints)],
    overrides: requirements(overrides),
  };
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
 * Writes a release's pins into a project's `pyproject.toml`, in a block of
 * its `[tool.uv]` table: the block an earlier release's pins were written in
 * is replaced, and a project that has none is given one, in its `[tool.uv]`
 * table or a new one at its end. The file keeps its line endings.
 *
 * @param pyproject - The project's `pyproject.toml`
 * @param pins - The release's pins
 * @returns The `pyproject.toml` with them
 * @throws {Error} When the project sets uv's constraints or overrides itself,
 *   outside the block, which its pins cannot be merged with, or the block has
 *   lost its last line
 */
export function withReleasePins(pyproject: string, pins: ReleasePins): string {
  const eol = pyproject.includes("\r\n") ? "\r\n" : "\n";
  const lines = pyproject.replaceAll("\r\n", "\n").split("\n");
  const block = pinsBlock(pins);
  const start = lines.findIndex((line) => line.startsWith(BLOCK_START));
  let pinned: string[];
  if (start !== -1) {
    const end = lines.findIndex((line, i) => i > start && line.trim() === BLOCK_END);
    if (end === -1) {
      throw new Error(`pyproject.toml's east release pins have lost their last line (${BLOCK_END}): ` +
        "put it back after their override-dependencies, or remove them all");
    }
    pinned = [...lines.slice(0, start), ...block, ...lines.slice(end + 1)];
  } else if (lines.some((line) => OWN_PINS.test(line))) {
    throw new Error("pyproject.toml sets its own [tool.uv] constraint-dependencies or override-dependencies: " +
      "remove them to take the release's pins, or keep them and pin by hand");
  } else {
    const table = lines.findIndex((line) => UV_TABLE.test(line));
    if (table !== -1) {
      pinned = [...lines.slice(0, table + 1), ...block, ...lines.slice(table + 1)];
    } else {
      while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
      pinned = [...lines, "", "[tool.uv]", ...block, ""];
    }
  }
  return pinned.join(eol);
}
