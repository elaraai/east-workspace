/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * python → TypeScript (#628): functions authored in python
 * (`libs/east-py/packages/east-py/tests/fixtures/crosslang_functions.py`,
 * whose manifest `east-py` checks in at `test/fixtures/py-functions.beast2`
 * and keeps current) import into a TypeScript function by name, link into
 * pure IR, and run on the reference compiler with no python present. The
 * other direction lives in east-py's `test_cross_import.py`.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  East, EastIR, ArrayType, FloatType, FunctionType, IntegerType, StringType, StructType,
} from "./index.js";

const FIXTURE = new URL("../../test/fixtures/py-functions.beast2", import.meta.url);
const Row = StructType({ qty: IntegerType, price: FloatType });

describe("cross-language import: python-authored functions in TypeScript", () => {
  const manifest = East.decodeFunctionManifest(new Uint8Array(readFileSync(FIXTURE)));

  test("the manifest names the package and its functions", () => {
    assert.equal(manifest.package, "crosslang_py");
    assert.deepEqual(manifest.functions.map(f => f.name), ["greet", "score", "total"]);
    assert.deepEqual(manifest.functions.map(f => f.platforms.length), [0, 0, 0]);
  });

  test("imported python functions link and run, alone and inside callbacks", () => {
    const score = East.importFunction("crosslang_py", "score", FunctionType([Row], FloatType));
    const total = East.importFunction("crosslang_py", "total", FunctionType([ArrayType(Row)], FloatType));
    const greet = East.importFunction("crosslang_py", "greet", FunctionType([StringType, IntegerType], StringType));
    const user = East.function([ArrayType(Row), StringType], StringType, ($, rows, name) => {
      const best = $.const(rows.map(($, r) => score(r)).reduce(($, acc, x) => East.greater(x, acc).ifElse($ => x, $ => acc), 0.0));
      return greet(name, 2n).concat(" ").concat(East.print(total(rows))).concat(" ").concat(East.print(best));
    });
    const { ir, imports } = East.linkImports(user, [manifest]);
    assert.deepEqual(imports.map(i => i.name), ["score", "greet", "total"]);
    const run = new EastIR(ir as any).compile([]);
    assert.equal(run([{ qty: 2n, price: 1.5 }, { qty: 3n, price: 2.0 }], "hi"), "hi!hi! 9.0 6.0");
  });

  test("a wrong declared type is refused with both types named", () => {
    const score = East.importFunction("crosslang_py", "score", FunctionType([Row], IntegerType));
    const user = East.function([Row], IntegerType, ($, r) => score(r));
    assert.throws(() => East.linkImports(user, [manifest]), /crosslang_py\.score is imported as .* but exported as/);
  });
});
