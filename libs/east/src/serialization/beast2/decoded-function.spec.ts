/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A decoded function runs as the function it was built as (#1207). Whether an IR node
 * awaits is the analysis's, which the IR's wire does not carry: a decoded body
 * compiled unanalysed ran every statement synchronously, so a statement after
 * an awaited call read its promise. A decode analyses the IR as a build does,
 * except that a platform function it was not given is left for a call to
 * miss. Through both containers.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { AsyncFunctionType, BooleanType, FunctionType, IntegerType, NullType, StringType, VariantType } from "../../types.js";
import { variant } from "../../containers/variant.js";
import { East } from "../../index.js";
import { decodeBeast2For, encodeBeast2For } from "./index.js";

const Outcome = VariantType({ ok: StringType, refused: NullType });

/** A check the platform makes asynchronously — here, one every name passes. */
const check = East.asyncPlatform("decoded_function_check", [StringType], Outcome);
const platform = [check.implement(async (name: string) => variant("ok", name))];

const Greet = AsyncFunctionType([BooleanType, StringType], StringType);

/** A greeting that, when it is wanted, awaits the check and then matches what it said. */
const greet = East.compile(East.function([], Greet, () => East.asyncFunction([BooleanType, StringType], StringType, ($, wanted, name) => {
  const out = $.let("not asked");
  $.if(wanted, ($) => {
    const checked = $.const(check(name));
    $.match(checked, {
      ok: ($, who) => { $.assign(out, East.str`hello ${who}`); },
      refused: ($) => { $.assign(out, "refused"); },
    });
  });
  return out;
})), platform)();

const Scaled = AsyncFunctionType([IntegerType], IntegerType);
const Scaler = FunctionType([IntegerType], Scaled);

/** A maker of async closures: each awaits a doubling of its input, then adds the maker's `n`. */
const makeScaler = East.compile(East.function([], Scaler, ($) => {
  const double = $.const(East.asyncFunction([IntegerType], IntegerType, (_$, x) => x.multiply(2n)));
  return East.function([IntegerType], Scaled, (_$, n) => East.asyncFunction([IntegerType], IntegerType, ($, x) => {
    const doubled = $.let(double(x));
    return doubled.add(n);
  }));
}), [])();

describe("a decoded function runs as it was built", () => {
  for (const version of [4, 5] as const) {
    test(`v${version}: an async function that awaits a platform call inside an if, then matches what it returned`, async () => {
      assert.equal(await greet(true, "ada"), "hello ada", "as built");
      const decoded = decodeBeast2For(Greet, { platform })(encodeBeast2For(Greet, { version })(greet));
      assert.equal(await decoded(true, "ada"), "hello ada");
      assert.equal(await decoded(false, "ada"), "not asked");
    });

    test(`v${version}: a function returning an async closure that awaits, then goes on`, async () => {
      assert.equal(await makeScaler(5n)(10n), 25n, "as built");
      const decoded = decodeBeast2For(Scaler)(encodeBeast2For(Scaler, { version })(makeScaler));
      assert.equal(await decoded(5n)(10n), 25n);
    });
  }

  test("a function calling a platform function the decode was not given decodes, and a call throws that it is not available", async () => {
    const decoded = decodeBeast2For(Greet)(encodeBeast2For(Greet)(greet));
    assert.equal(await decoded(false, "ada"), "not asked");
    await assert.rejects(decoded(true, "ada"), { message: /^Platform function 'decoded_function_check' is not available/ });
  });

  test("a platform function given at decode with another signature is refused there, naming it", () => {
    const other = East.asyncPlatform("decoded_function_check", [IntegerType], Outcome);
    const decode = decodeBeast2For(Greet, { platform: [other.implement(async () => variant("refused", null))] });
    assert.throws(() => decode(encodeBeast2For(Greet)(greet)), /Platform function 'decoded_function_check' argument 1 requires exact type match/);
  });
});
