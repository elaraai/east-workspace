/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A decoded function runs as the function it was built as (#1207). Whether an
 * IR node awaits is the analysis's, which the IR's wire does not carry: a
 * decoded body compiled without it ran every statement synchronously, so a
 * statement after an awaited call read its promise. A decode marks the nodes
 * that await (`markAsync`) before it compiles them, and a platform function it
 * was not given is left for a call to miss. Through both containers.
 *
 * And a whole-value decode compiles each body once (#1353): functions of one
 * content under one platform list run one compiled body, each over its own
 * captures, wherever they sit in the stream — the key is the IR's content
 * and the stream's source map, never the IR's bytes, which back-references
 * make depend on where it sits.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, AsyncFunctionType, BooleanType, FunctionType, IntegerType, NullType, StringType, StructType, VariantType } from "../../types.js";
import { variant } from "../../containers/variant.js";
import { East } from "../../index.js";
import { EastError } from "../../error.js";
import { EAST_IR_SYMBOL } from "../../function_symbols.js";
import { IRType } from "../../ir.js";
import { equalFor } from "../../comparison.js";
import { EastTypeValueType, toEastTypeValue } from "../../type_of_type.js";
import type { PlatformFunction } from "../../platform.js";
import { decodeBeast2For, encodeBeast2For } from "./index.js";
import { COMPILED_BODY_LIMIT, compiledBodiesFor } from "./shared.js";

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
});

const Named = FunctionType([], StringType);
const Key = StructType({ key: StringType });
/** A maker of closures over a key, as a record Slice's methods are made over a descriptor: one body, many closures. */
const greeter = East.compile(East.function([Key], Named, (_$, d) => East.function([], StringType, () => East.str`hello ${d.key}`)), []);
/** The same maker built again: an IR of the very same content, another object. */
const greeterAgain = East.compile(East.function([Key], Named, (_$, d) => East.function([], StringType, () => East.str`hello ${d.key}`)), []);
/** A maker of another body. */
const shouter = East.compile(East.function([Key], Named, (_$, d) => East.function([], StringType, () => East.str`HEY ${d.key}`)), []);

/** Rows each defining a container of their own, so a body's later places back-reference its first at other distances. */
const Row = StructType({ fn: Named, tags: ArrayType(StringType) });
const Rows = ArrayType(Row);
const makers = [greeter, greeterAgain, shouter];
const rows = Array.from({ length: 12 }, (_, i) => ({ fn: makers[i % 3]!({ key: `k${i}` }), tags: [`k${i}`] }));
const said = (i: number) => `${i % 3 === 2 ? "HEY" : "hello"} k${i}`;

/** Whether `object` is reachable from `root`, by identity. */
function reaches(root: unknown, object: unknown, seen = new Set<unknown>()): boolean {
  if (root === object) return true;
  if (root === null || typeof root !== "object" || seen.has(root)) return false;
  seen.add(root);
  return Object.values(root).some((child) => reaches(child, object, seen));
}

/** The error a call raises. */
function raised(fn: (x: bigint) => bigint): EastError {
  try { fn(1n); } catch (e) { if (e instanceof EastError) return e; throw e; }
  throw new Error("expected the call to raise");
}

describe("a decode compiles each body once (#1353)", () => {
  test("functions of one content compile it once, wherever they sit in the stream, and a decode again compiles none", () => {
    const platform: PlatformFunction[] = [];
    const bodies = compiledBodiesFor(platform);
    const blob = encodeBeast2For(Rows)(rows);
    const decoded = decodeBeast2For(Rows, { platform })(blob);
    assert.equal(bodies.compiled, 2, "the two greeters' content is one body, the shouter's another");
    decoded.forEach((row, i) => assert.equal(row.fn(), said(i), "each runs over its own captures"));
    decodeBeast2For(Rows, { platform })(blob);
    const frozen = decodeBeast2For(Rows, { platform, frozen: true })(blob);
    assert.equal(bodies.compiled, 2, "decoding again, frozen or not, compiles nothing");
    frozen.forEach((row, i) => assert.equal(row.fn(), said(i)));
  });

  test("a decode then an encode gives back the bytes it was read from", () => {
    const blob = encodeBeast2For(Rows)(rows);
    const decoded = decodeBeast2For(Rows, { platform: [] })(blob);
    // Each function keeps the IR it was decoded with, so the two greeters re-encode as the two they were written as.
    assert.deepEqual(Array.from(encodeBeast2For(Rows)(decoded)), Array.from(blob));
  });

  test("an error names the location its own stream gives it: one content under two maps compiles twice", () => {
    const Div = FunctionType([IntegerType], IntegerType);
    const first = East.compile(East.function([IntegerType], IntegerType, (_$, x) => x.divide(0n)), []);
    const second = East.compile(East.function([IntegerType], IntegerType, (_$, x) => x.divide(0n)), []);
    // One content authored on two lines: only the source maps tell them apart.
    const irOf = (fn: unknown) => (fn as Record<symbol, unknown>)[EAST_IR_SYMBOL] as never;
    assert.ok(equalFor(IRType)(irOf(first), irOf(second)), "one content");
    assert.notDeepEqual(raised(first).location, raised(second).location, "two lines");
    const platform: PlatformFunction[] = [];
    const decode = decodeBeast2For(Div, { platform });
    const one = decode(encodeBeast2For(Div)(first));
    const two = decode(encodeBeast2For(Div)(second));
    assert.equal(compiledBodiesFor(platform).compiled, 2, "the maps differ, so the bodies do");
    assert.deepEqual(raised(one).location, raised(first).location);
    assert.deepEqual(raised(two).location, raised(second).location);
  });

  test("two platform lists never share a body, and a list that changes compiles again", () => {
    const answer = East.platform("decoded_function_answer", [], IntegerType);
    const Ask = FunctionType([], IntegerType);
    const ask = East.compile(East.function([], IntegerType, () => answer()), [answer.implement(() => 0n)]);
    const blob = encodeBeast2For(Ask)(ask);
    const one = [answer.implement(() => 1n)];
    const two = [answer.implement(() => 2n)];
    assert.equal(decodeBeast2For(Ask, { platform: one })(blob)(), 1n);
    assert.equal(decodeBeast2For(Ask, { platform: two })(blob)(), 2n);
    one[0] = answer.implement(() => 3n);
    assert.equal(decodeBeast2For(Ask, { platform: one })(blob)(), 3n, "the list holds another function now");
    const given: PlatformFunction[] = [];
    assert.throws(() => decodeBeast2For(Ask, { platform: given })(blob)(), { message: /^Platform function 'decoded_function_answer' is not available/ });
    given.push(answer.implement(() => 4n));
    assert.equal(decodeBeast2For(Ask, { platform: given })(blob)(), 4n, "a list given the function it lacked");
  });

  test(`at most ${COMPILED_BODY_LIMIT} bodies are kept, the least recently used going first`, () => {
    const Const = FunctionType([], IntegerType);
    const Consts = ArrayType(Const);
    // One build, so every function carries one source map, and the bodies' keys differ by their content alone.
    const consts = East.compile(East.function([], Consts, () =>
      Array.from({ length: COMPILED_BODY_LIMIT + 1 }, (_, i) => East.function([], IntegerType, () => BigInt(i)))), [])();
    const platform: PlatformFunction[] = [];
    const bodies = compiledBodiesFor(platform);
    const decode = (fns: (() => bigint)[]) => decodeBeast2For(Consts, { platform })(encodeBeast2For(Consts)(fns));
    decode(consts.slice(0, COMPILED_BODY_LIMIT));
    assert.equal(bodies.size, COMPILED_BODY_LIMIT);
    assert.equal(bodies.compiled, COMPILED_BODY_LIMIT);
    assert.equal(decode([consts[0]!])[0]!(), 0n);
    assert.equal(bodies.compiled, COMPILED_BODY_LIMIT, "the first is kept, and used again it is the most recent");
    decode([consts[COMPILED_BODY_LIMIT]!]);
    assert.equal(bodies.size, COMPILED_BODY_LIMIT, "one more, and the least recently used goes");
    assert.equal(bodies.compiled, COMPILED_BODY_LIMIT + 1);
    decode([consts[0]!]);
    assert.equal(bodies.compiled, COMPILED_BODY_LIMIT + 1, "the first, used since, stays");
    assert.equal(decode([consts[1]!])[0]!(), 1n);
    assert.equal(bodies.compiled, COMPILED_BODY_LIMIT + 2, "the second, the least recently used, went");
  });

  test("a function whose IR back-references a container no function's IR defined compiles on its own", () => {
    const Point = StructType({ x: IntegerType, y: IntegerType });
    const Holder = StructType({ schema: EastTypeValueType, fn: FunctionType([Point], IntegerType) });
    const getX = East.compile(East.function([Point], IntegerType, (_$, p) => p.x), []);
    const platform: PlatformFunction[] = [];
    const decode = decodeBeast2For(Holder, { platform });
    // The schema is written first, and the IR's types are its very objects, so the IR back-references the schema's.
    const blob = encodeBeast2For(Holder)({ schema: toEastTypeValue(Point), fn: getX });
    const held = decode(blob);
    assert.ok(reaches((held.fn as unknown as Record<symbol, unknown>)[EAST_IR_SYMBOL], held.schema.value), "the IR holds the schema's own fields");
    assert.equal(held.fn({ x: 7n, y: 1n }), 7n);
    assert.equal(decode(blob).fn({ x: 8n, y: 1n }), 8n);
    assert.equal(compiledBodiesFor(platform).compiled, 0, "neither decode keeps it");
  });
});
