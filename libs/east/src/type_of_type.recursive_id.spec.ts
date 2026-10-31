/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A recursive type is written under a hash of its type table, so its id, and
 * the IR that holds it, depends on the type alone: not on what the process
 * built before it, nor on which runtime wrote it, nor on whether the type was
 * built in code or read off the wire.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  ArrayType, EastTypeType, IntegerType, OptionType, RecursiveType, StringType, StructType, VariantType,
  encodeBeast2For, equalFor, none, readBeast2Type, toEastTypeValue, type EastTypeValue,
} from "./index.js";
import { IRType } from "./ir.js";
import { recursiveIdFromDigest } from "./serialization/beast2/v4/type-table.js";

/** East's entry, as a child process imports it. */
const EAST = JSON.stringify(new URL("./index.js", import.meta.url).href);

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

/** The id a recursive type's type value gives its outermost wrapper. */
function wrapperId(type: EastTypeValue): bigint {
  assert.ok(type.type === "Recursive" && type.value.type === "wrapper", "a recursive type is written as a wrapper");
  return type.value.value.id;
}

const Tree = RecursiveType((self) => VariantType({ leaf: IntegerType, node: ArrayType(self) }));
const Forest = RecursiveType((self) => StructType({ trees: ArrayType(Tree), name: StringType, next: OptionType(self) }));

describe("recursive type ids", () => {
  test("a recursive type's id is the first 62 bits of the SHA-256 of its type table, the same in every runtime", () => {
    // east-c's and east-py's specs pin the same four ids.
    assert.equal(wrapperId(toEastTypeValue(Tree)), 1820754330669801663n);
    assert.equal(wrapperId(toEastTypeValue(Forest)), 3797356837675649521n);
    assert.equal(wrapperId(toEastTypeValue(EastTypeType)), 1407501298113036788n);
    assert.equal(wrapperId(toEastTypeValue(IRType)), 4094604686657949362n);
  });

  test("a recursive type keeps its id inside another, so one type is written once", () => {
    const forest = toEastTypeValue(Forest);
    assert.ok(forest.type === "Recursive" && forest.value.type === "wrapper");
    const fields = forest.value.value.inner as EastTypeValue;
    assert.ok(fields.type === "Struct");
    const trees = fields.value[0]!.type as EastTypeValue;
    assert.ok(trees.type === "Array");
    assert.equal(wrapperId(trees.value), wrapperId(toEastTypeValue(Tree)));
  });

  test("two types that differ inside their bodies have different ids", () => {
    const Strings = RecursiveType((self) => VariantType({ leaf: StringType, node: ArrayType(self) }));
    assert.notEqual(wrapperId(toEastTypeValue(Strings)), wrapperId(toEastTypeValue(Tree)));
  });

  test("a function's IR is the same in two processes, whatever each built before it", () => {
    const script = [
      `const { East, RecursiveType, VariantType, StructType, ArrayType, IntegerType, encodeEastIR, sha256Hex } = await import(${EAST});`,
      'if (process.env.OTHERS_FIRST === "yes") for (let i = 0; i < 3; i++) RecursiveType((self) => StructType({ [`f${i}`]: ArrayType(self) }));',
      "const Tree = RecursiveType((self) => VariantType({ leaf: IntegerType, node: ArrayType(self) }));",
      "const same = East.function([Tree], Tree, ($, tree) => tree);",
      "console.log(JSON.stringify(sha256Hex(encodeEastIR(same.toIR()))));",
    ].join("\n");
    const alone = inProcess<string>(script, { OTHERS_FIRST: "no" });
    const afterOthers = inProcess<string>(script, { OTHERS_FIRST: "yes" });
    assert.equal(afterOthers, alone);
  });

  for (const version of [4, 5] as const) {
    test(`a type read off a v${version} blob is the type built in code, ids included`, () => {
      const bytes = encodeBeast2For(Forest, { version })({ trees: [], name: "x", next: none });
      assert.ok(equalFor(EastTypeType)(readBeast2Type(bytes), toEastTypeValue(Forest)));
    });
  }

  test("a second type whose table hashes to an id another has taken is refused", () => {
    const taken = `${"5".repeat(16)}${"0".repeat(48)}`;
    const other = `${"5".repeat(16)}${"1".repeat(48)}`;
    const id = recursiveIdFromDigest(taken);
    assert.equal(recursiveIdFromDigest(taken), id, "the same type names its id again");
    assert.throws(() => recursiveIdFromDigest(other), /Two recursive types have the id/);
  });
});
