/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A call nested too deeply, on the TypeScript runtime (#948): JavaScript's
 * stack overflow is the East error `call stack exhausted: East calls nested
 * too deeply` every time, however often a process overflows.
 *
 * The cross-runtime cases are the exported "Function" compliance suite's;
 * this file pins what only the TypeScript runtime can get wrong. The overflow
 * is converted at the stack's end, where a regular expression, which V8
 * compiles again natively once it has run, fails to compile with a
 * `SyntaxError` no call site converts. A search for the deepest nesting that
 * completes, overflowing again and again, saw that escape the program's
 * try/catch in 8 processes of 10.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { East, BooleanType, FunctionType, IntegerType } from "../src/index.js";

/** Whether f(n), k + f(k - 1) nested n deep through a captured variable,
 *  completes, rather than being refused as nested too deeply. */
const completes = East.function([IntegerType], BooleanType, ($, n) => {
  const f = $.let(East.function([IntegerType], IntegerType, (_$, _k) => 0n), FunctionType([IntegerType], IntegerType));
  $.assign(f, East.function([IntegerType], IntegerType, (_$, k) => East.lessEqual(k, 0n).ifElse(() => 0n, () => k.add(f(k.subtract(1n))))));
  const done = $.let(true);
  $.try(($) => { $(f(n)); }).catch(($, _message) => { $.assign(done, false); });
  return done;
}).toIR().compile([]) as (n: bigint) => boolean;

describe("a call nested too deeply", () => {
  test("is the East error each time it overflows, however often the process does", () => {
    // A search for the deepest nesting that completes: every probe past it
    // overflows, and each is caught by the program
    let lo = 0n;
    let hi = 10_000_000n;
    let overflows = 0;
    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n;
      if (completes(mid)) {
        lo = mid;
      } else {
        hi = mid - 1n;
        overflows++;
      }
    }
    assert.ok(overflows >= 10, `the search overflowed ${overflows} times`);
    assert.ok(lo >= 200n, `nesting ${lo} deep completes`);
  });
});
