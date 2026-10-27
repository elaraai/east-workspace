/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The compiled `return`, `continue` and `break` (`compile/flow.ts`): signals a
 * closure gives where a value would be, never thrown, but where the IR puts
 * one under a node that computes a value. The cross-runtime cases are the
 * exported "Block" suite's; this file pins what only the TypeScript runtime
 * can get wrong — the positions that keep an exception, which the builders
 * never write, built here as IR; a `continue` or `break` naming no loop; a
 * control statement in a `finally`, as this runtime has always run one; a
 * function value given to TypeScript, decoded, or compiled while another
 * compiles; and errors' messages and locations.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  East, ArrayType, AsyncFunctionType, EastError, EastIR, AsyncEastIR, FunctionType, IntegerType, OptionType,
  decodeBeast2For, encodeBeast2For, toEastTypeValue, variant, some, none,
  type AsyncFunctionIR, type FunctionIR, type IR,
} from "./index.js";

const Int = toEastTypeValue(IntegerType);
const Never = variant("Never", null);

/** An Integer literal. */
function int(n: bigint): IR {
  return variant("Value", { type: Int, loc_id: 0n, value: variant("Integer", n) });
}

/** A `return` of `value`. */
function ret(value: IR): IR {
  return variant("Return", { type: Never, loc_id: 0n, value });
}

/** A function of no inputs giving an Integer, its body `body`. */
function fn(body: IR): FunctionIR {
  return variant("Function", { type: toEastTypeValue(FunctionType([], IntegerType)), loc_id: 0n, captures: [], parameters: [], body });
}

describe("a control statement under a node that computes a value", () => {
  // The builders never write these: a `return` there has the type the
  // function gives, and they take none but where a statement goes. The IR
  // allows them, so the compiler throws the signal there and the statement
  // around it gives it back.

  test("a return in a builtin's argument leaves the function", () => {
    const body = variant("Builtin", { type: Int, loc_id: 0n, builtin: "IntegerAdd" as const, type_parameters: [], arguments: [ret(int(5n)), int(1n)] });
    assert.equal(new EastIR<[], bigint>(fn(body)).compile([])(), 5n);
  });

  test("a return in a call's argument leaves the function", () => {
    const x = variant("Variable", { type: Int, name: "x", loc_id: 0n, mutable: false, captured: false });
    const same = variant("Function", { type: toEastTypeValue(FunctionType([IntegerType], IntegerType)), loc_id: 0n, captures: [], parameters: [x], body: x });
    const body = variant("Call", { type: Int, loc_id: 0n, function: same, arguments: [ret(int(7n))] });
    assert.equal(new EastIR<[], bigint>(fn(body)).compile([])(), 7n);
  });

  test("a return in an array's element leaves the function, past the let it was bound by", () => {
    const xs = variant("Variable", { type: toEastTypeValue(ArrayType(IntegerType)), name: "xs", loc_id: 0n, mutable: false, captured: false });
    const body = variant("Block", {
      type: Int, loc_id: 0n, statements: [
        variant("Let", { type: toEastTypeValue(ArrayType(IntegerType)), loc_id: 0n, variable: xs, value: variant("NewArray", { type: toEastTypeValue(ArrayType(IntegerType)), loc_id: 0n, values: [int(1n), ret(int(9n))] }) }),
        int(0n),
      ],
    });
    assert.equal(new EastIR<[], bigint>(fn(body)).compile([])(), 9n);
  });

  test("a return in an awaited call's argument leaves the async function", async () => {
    const x = variant("Variable", { type: Int, name: "x", loc_id: 0n, mutable: false, captured: false });
    const same = variant("AsyncFunction", { type: toEastTypeValue(AsyncFunctionType([IntegerType], IntegerType)), loc_id: 0n, captures: [], parameters: [x], body: x });
    const body = variant("CallAsync", { type: Int, loc_id: 0n, function: same, arguments: [ret(int(11n))] });
    const ir: AsyncFunctionIR = variant("AsyncFunction", { type: toEastTypeValue(AsyncFunctionType([], IntegerType)), loc_id: 0n, captures: [], parameters: [], body });
    assert.equal(await new AsyncEastIR<[], bigint>(ir).compile([])(), 11n);
  });

  test("a continue in an awaited call's argument, in a loop, goes on to the loop's next row", async () => {
    const same = East.asyncFunction([IntegerType], IntegerType, (_$, x) => x);
    const sumPresent = East.asyncFunction([ArrayType(OptionType(IntegerType))], IntegerType, ($, xs) => {
      const call = $.const(same);
      const sum = $.let(0n);
      $.for(xs, ($, x, _i, label) => {
        // A continue arm is typed as giving nothing, though it gives Never: the match is an Integer
        $.assign(sum, sum.add(call(x.match({ none: ($) => $.continue(label), some: (_$, v) => v }) as never)));
      });
      return sum;
    });
    assert.equal(await East.compileAsync(sumPresent, [])([some(1n), none, some(2n), none, some(4n)]), 7n);
  });
});

describe("a continue or break naming no loop of its function", () => {
  test("raises an error at the function, naming the label, as it did at the call", () => {
    const body = variant("Block", { type: Never, loc_id: 0n, statements: [variant("Continue", { type: Never, loc_id: 3n, label: { name: "nowhere", loc_id: 3n } })] });
    const ir: FunctionIR = variant("Function", { type: toEastTypeValue(FunctionType([], IntegerType)), loc_id: 4n, captures: [], parameters: [], body });
    assert.throws(() => new EastIR<[], bigint>(ir).compile([])(), { message: "continue failed to find label nowhere at loc_id 4" });
  });
});

describe("a control statement in a finally", () => {
  // As when control flow was thrown, a control statement in a finally takes
  // the place of what the try or the catch gave, or threw.

  test("a return in a finally gives the function's value in place of the try's return", () => {
    const f = East.function([], IntegerType, ($) => {
      $.try(($) => { $.return(1n); }).finally(($) => { $.return(2n); });
      return 3n;
    });
    assert.equal(East.compile(f, [])(), 2n);
  });

  test("a return in a finally gives the function's value in place of an error its catch raised", () => {
    const f = East.function([], IntegerType, ($) => {
      $.try(($) => { $.error("first"); }).catch(($) => { $.error("again"); }).finally(($) => { $.return(5n); });
      return 3n;
    });
    assert.equal(East.compile(f, [])(), 5n);
  });

  test("a continue in a finally goes on to the loop's next row, past what follows the try", () => {
    const f = East.function([ArrayType(IntegerType)], IntegerType, ($, xs) => {
      const sum = $.let(0n);
      const after = $.let(0n);
      $.for(xs, ($, x, _i, label) => {
        $.try(($) => { $.assign(sum, sum.add(x)); }).finally(($) => { $.continue(label); });
        $.assign(after, after.add(1n));
      });
      return sum.multiply(10n).add(after);
    });
    // Every row is summed; none reaches the statement after its try
    assert.equal(East.compile(f, [])([1n, 2n, 3n]), 60n);
  });

  test("in an async function whose try and finally await, a return in the finally gives its value", async () => {
    const same = East.asyncFunction([IntegerType], IntegerType, (_$, x) => x);
    const f = East.asyncFunction([], IntegerType, ($) => {
      const call = $.const(same);
      $.try(($) => { $.return(call(1n)); }).finally(($) => { $.return(call(2n)); });
      return 3n;
    });
    assert.equal(await East.compileAsync(f, [])(), 2n);
  });
});

describe("a function value gives its value, never a signal", () => {
  test("called by TypeScript, after an early return", () => {
    const make = East.function([], FunctionType([IntegerType], IntegerType), (_$) =>
      East.function([IntegerType], IntegerType, ($, x) => {
        $.if(East.less(x, 0n), ($) => { $.return(0n); });
        return x;
      }));
    const clamp = East.compile(make, [])();
    assert.equal(clamp(-5n), 0n);
    assert.equal(clamp(5n), 5n);
  });

  test("an async one called by TypeScript, after an early return from a loop that awaits", async () => {
    const same = East.asyncFunction([IntegerType], IntegerType, (_$, x) => x);
    const make = East.function([], AsyncFunctionType([ArrayType(IntegerType)], IntegerType), (_$) =>
      East.asyncFunction([ArrayType(IntegerType)], IntegerType, ($, xs) => {
        const call = $.const(same);
        $.for(xs, ($, x) => {
          $.if(East.greater(call(x), 2n), ($) => { $.return(x); });
        });
        return -1n;
      }));
    const firstOver2 = East.compile(make, [])();
    assert.equal(await firstOver2([1n, 3n, 5n]), 3n);
    assert.equal(await firstOver2([1n, 2n]), -1n);
  });

  test("decoded from beast2", () => {
    const Fn = FunctionType([ArrayType(IntegerType)], IntegerType);
    // The sum of the rows before the first negative one, the even ones skipped; a zero returns at once
    const f = East.compile(East.function([ArrayType(IntegerType)], IntegerType, ($, xs) => {
      const sum = $.let(0n);
      $.for(xs, ($, x, _i, label) => {
        $.if(East.equal(x, 0n), ($) => { $.return(-100n); });
        $.if(East.less(x, 0n), ($) => { $.break(label); });
        $.if(East.equal(x.remainder(2n), 0n), ($) => { $.continue(label); });
        $.assign(sum, sum.add(x));
      });
      return sum;
    }), []);
    const decoded = decodeBeast2For(Fn)(encodeBeast2For(Fn)(f));
    assert.equal(decoded([1n, 2n, 3n, -1n, 5n]), 4n);
    assert.equal(decoded([1n, 0n, 3n]), -100n);
  });
});

describe("a compile inside another's", () => {
  test("compiles its own control flow, and the one around it goes on with its own", () => {
    // A platform function's factory runs as the function calling it compiles: this one compiles a function whose loop breaks
    const firstOver = East.genericPlatform("control_flow_first_over", ["T"], [ArrayType(IntegerType), IntegerType], IntegerType);
    const implementation = firstOver.implement((_T) => {
      const scan = East.compile(East.function([ArrayType(IntegerType), IntegerType], IntegerType, ($, xs, limit) => {
        const found = $.let(-1n);
        $.for(xs, ($, x, _i, label) => {
          $.if(East.greater(x, limit), ($) => {
            $.assign(found, x);
            $.break(label);
          });
        });
        return found;
      }), []);
      return (xs: unknown, limit: unknown) => scan(xs as bigint[], limit as bigint);
    });
    // The loop compiles after the platform call: its continue is known only by its own compile's walk
    const outer = East.function([ArrayType(IntegerType)], IntegerType, ($, xs) => {
      const first = $.const(firstOver([IntegerType], xs, 2n));
      const total = $.let(0n);
      $.for(xs, ($, x, _i, label) => {
        $.if(East.equal(x, first), ($) => { $.continue(label); });
        $.assign(total, total.add(x));
      });
      return total;
    });
    assert.equal(East.compile(outer, [implementation])([1n, 2n, 3n, 4n]), 7n);
  });
});

describe("an error raised past control flow", () => {
  test("keeps its message and its location", () => {
    const f = East.function([ArrayType(IntegerType)], IntegerType, ($, xs) => {
      const sum = $.let(0n);
      $.for(xs, ($, x, _i, label) => {
        $.if(East.equal(x, 1n), ($) => { $.continue(label); });
        $.if(East.equal(x, 3n), ($) => { $.error("three"); });
        $.assign(sum, sum.add(x));
      });
      return sum;
    });
    try {
      East.compile(f, [])([1n, 2n, 3n]);
      assert.fail("expected the error");
    } catch (e: unknown) {
      assert.ok(e instanceof EastError);
      assert.equal(e.eastMessage, "three");
      assert.ok(e.location.some(l => l.filename.includes("compile.control_flow.spec")), `expected a frame in this spec file, got: ${e.location.map(l => l.filename).join(", ")}`);
    }
  });
});
