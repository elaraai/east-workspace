/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A codec build builds the IR's codec once. A function value carries its IR,
 * so every function type a build reaches encodes or decodes one — and each
 * used to build the whole IRType codec of its own: UIComponentType's 727
 * function fields made its encoder ~170 MB and ~170 ms to build. The IR's
 * recursive types register in the build's recursion context as its codec is
 * built, so the registrations a build makes say how often it built the IR's.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FunctionType, IntegerType, StructType, type EastType } from "../../types.js";
import { toEastTypeValue, type EastTypeValue } from "../../type_of_type.js";
import { East } from "../../index.js";
import { buildV5Decoder, buildV5Encoder } from "./v5/codec.js";
import { buildDecoder, buildEncoder } from "./v4/container.js";
import { decodeBeast2For, encodeBeast2For } from "./index.js";

/** A recursion context that counts the registrations made in it. */
class CountingContext extends Map<bigint, any> {
  registrations = 0;
  override set(key: bigint, value: any): this {
    this.registrations++;
    return super.set(key, value);
  }
}

const Fn = FunctionType([IntegerType], IntegerType);

/** A struct of `n` function fields. */
function functionFields(n: number): EastType {
  return StructType(Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, Fn])));
}

/** The registrations one build of `type` makes. */
function registrations(build: (type: EastTypeValue, typeCtx: CountingContext) => unknown, type: EastType): number {
  const typeCtx = new CountingContext();
  build(toEastTypeValue(type), typeCtx);
  return typeCtx.registrations;
}

const BUILDS = {
  "v5 encoder": buildV5Encoder,
  "v5 decoder": buildV5Decoder,
  "v4 encoder": buildEncoder,
  "v4 decoder": buildDecoder,
} as const;

describe("a codec build builds the IR's codec once", () => {
  for (const [name, build] of Object.entries(BUILDS)) {
    test(`a ${name} registers the IR's recursive types once, however many function fields it reaches`, () => {
      const one = registrations(build, functionFields(1));
      assert.ok(one > 0, "building a function type's codec registers the IR's recursive types");
      assert.equal(registrations(build, functionFields(40)), one);
    });
  }

  test("every function field keeps its own function and captures through both containers", () => {
    const Pair = StructType({ inc: Fn, dbl: Fn });
    const make = East.compile(East.function([], Pair, ($) => {
      const base = $.let(100n);
      const inc = $.const(East.function([IntegerType], IntegerType, (_$, x) => x.add(base)));
      const dbl = $.const(East.function([IntegerType], IntegerType, (_$, x) => x.multiply(2n).add(base)));
      return $.const({ inc, dbl }, Pair);
    }), []);
    for (const version of [4, 5] as const) {
      const decoded = decodeBeast2For(Pair)(encodeBeast2For(Pair, { version })(make())) as {
        inc: (x: bigint) => bigint;
        dbl: (x: bigint) => bigint;
      };
      assert.equal(decoded.inc(1n), 101n, `v${version}: inc`);
      assert.equal(decoded.dbl(1n), 102n, `v${version}: dbl`);
    }
  });
});
