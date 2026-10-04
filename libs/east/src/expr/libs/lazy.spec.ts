/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East's integer, float and datetime libraries build each function the first
 * time it is read (#1127): importing East builds none of them and loads no
 * TypeScript, and a function's IR is the same whoever reads it first.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { East } from "../../index.js";
import { lazyLibrary } from "./lazy.js";

/** East's entry, as a child process imports it. */
const EAST = JSON.stringify(new URL("../../index.js", import.meta.url).href);

/**
 * Runs `script`, an ES module, in a process of its own, and gives what it
 * printed, as JSON.
 *
 * @param script - The module's source
 * @param env - Variables the process is given beside the test's own
 * @returns What the script printed, parsed
 */
function inProcess<T>(script: string, env: Record<string, string> = {}): T {
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(run.status, 0, `the script failed:\n${run.stderr}`);
  return JSON.parse(run.stdout) as T;
}

describe("East's standard libraries", () => {
  test("importing East builds none of their functions, and loads no TypeScript until a function is built", () => {
    const seen = inProcess<{ waiting: number; built: string[]; atImport: boolean; afterBuild: boolean }>([
      'import { createRequire } from "node:module";',
      `const { East, IntegerType } = await import(${EAST});`,
      "const typescript = () => Object.keys(createRequire(import.meta.url).cache).some((path) => /[\\\\/]typescript[\\\\/]/.test(path));",
      "let waiting = 0;",
      "const built = [];",
      'for (const lib of ["Integer", "Float", "DateTime"]) {',
      "  for (const [name, property] of Object.entries(Object.getOwnPropertyDescriptors(East[lib]))) {",
      "    if (property.get !== undefined) waiting++;",
      '    else if (typeof property.value?.toIR === "function") built.push(`${lib}.${name}`);',
      "  }",
      "}",
      "const atImport = typescript();",
      "East.function([IntegerType], IntegerType, ($, count) => count);",
      "console.log(JSON.stringify({ waiting, built, atImport, afterBuild: typescript() }));",
    ].join("\n"));
    assert.deepEqual(seen.built, [], "no library function is built at import");
    assert.equal(seen.waiting, 47, "every one waits to be read: 12 integer, 15 float and 20 datetime functions");
    assert.equal(seen.atImport, false, "importing East loads no TypeScript");
    assert.equal(seen.afterBuild, true, "a function's build loads it, to read its parameters' names");
  });

  test("a function is built the first time it is read, and kept", () => {
    const waiting = Object.getOwnPropertyDescriptor(East.Float, "printFixed");
    assert.ok(waiting?.get !== undefined, "nothing in this process has read it yet");
    const first = East.Float.printFixed;
    assert.equal(East.Float.printFixed, first, "a second read gives the same function");
    const kept = Object.getOwnPropertyDescriptor(East.Float, "printFixed");
    assert.ok(kept !== undefined && kept.get === undefined && kept.value === first && kept.writable === false,
      "the function is a property of its own once built");
    assert.equal(East.DateTime.fromEpochMilliseconds.name, "fromEpochMilliseconds", "a builder the library re-exports stays as it is");
  });

  test("a function's IR is the same whoever reads it first: a caller that builds it takes none of the caller's locations", () => {
    // One script, run twice: once reading each function before its caller is
    // built, and once reading it first inside the caller's body. The callers'
    // own nodes are built from the same lines both times.
    const script = [
      `const { East, DateTimeType, FloatType, IntegerType, StringType, encodeEastIR, sha256Hex } = await import(${EAST});`,
      "const irOf = (fn) => sha256Hex(encodeEastIR(fn.toIR()));",
      'if (process.env.READ_FIRST === "outside") void [East.Integer.printOrdinal, East.Float.printFixed, East.DateTime.roundUpWeek];',
      "const callers = [",
      "  East.function([IntegerType], StringType, ($, x) => East.Integer.printOrdinal(x)),",
      "  East.function([FloatType, IntegerType], StringType, ($, x, decimals) => East.Float.printFixed(x, decimals)),",
      "  East.function([DateTimeType, IntegerType], DateTimeType, ($, at, step) => East.DateTime.roundUpWeek(at, step)),",
      "];",
      "const own = [East.Integer.printOrdinal, East.Float.printFixed, East.DateTime.roundUpWeek];",
      "console.log(JSON.stringify({ own: own.map(irOf), callers: callers.map(irOf) }));",
    ].join("\n");
    const outside = inProcess<{ own: string[]; callers: string[] }>(script, { READ_FIRST: "outside" });
    const inside = inProcess<{ own: string[]; callers: string[] }>(script, { READ_FIRST: "inside" });
    assert.deepEqual(inside.own, outside.own, "each function's own IR, its source map included");
    assert.deepEqual(inside.callers, outside.callers, "and its callers' IR");
  });
});

describe("lazyLibrary", () => {
  test("builds each getter's value once, the first time it is read, and leaves a property that is no getter as it is", () => {
    let builds = 0;
    const library = lazyLibrary({
      kept: 1,
      get built() {
        builds++;
        return { at: builds };
      },
    });
    assert.equal(builds, 0, "nothing is built until it is read");
    const first = library.built;
    assert.equal(library.built, first);
    assert.equal(builds, 1, "built once");
    assert.equal(library.kept, 1);
    assert.deepEqual(Object.keys(library), ["kept", "built"], "both stay enumerable, in order");
  });
});
