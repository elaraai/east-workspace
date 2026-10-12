/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* A decode marks which nodes of a function's IR await (`markAsync`, #1207) as
 * the analysis does, without its checks. The two are held to the same mark at
 * every node: over every example the test modules export, built and then
 * decoded from beast2, and over functions that await inside every kind of
 * node. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

import {
  ArrayType, AsyncFunctionType, DictType, East, EastTypeType, FunctionType, IRType, IntegerType, NullType, OptionType, RecursiveType,
  RefType, SetType, StringType, StructType, VariantType, decodeBeast2For, encodeBeast2For, isTypeValueEqual, ref, some,
  toEastTypeValue, variant, type EastTypeValue, type IR,
} from "../src/index.js";
import { analyzeIR } from "../src/analyze.js";
import { markAsync } from "../src/analyze_async.js";

const IR_TYPE = toEastTypeValue(IRType);
const TYPE_TYPE = toEastTypeValue(EastTypeType);
/** The id IRType's own recursion carries: a position of it is a node. */
const NODE_ID = IR_TYPE.type === "Recursive" && IR_TYPE.value.type === "wrapper" ? IR_TYPE.value.value.id : undefined;

/**
 * Every node the analysis and the decode mark differently, walking the two IRs
 * together by their type.
 *
 * @param analysed - the IR as `analyzeIR` returns it
 * @param marked - the same IR, decoded, as `markAsync` left it
 * @returns each differing node's path, kind and two marks
 */
function differences(analysed: IR, marked: IR): string[] {
  const found: string[] = [];
  const nodes = new Map<bigint, EastTypeValue>();
  const walk = (a: any, m: any, type: EastTypeValue, path: string): void => {
    if (isTypeValueEqual(type, TYPE_TYPE)) return;
    switch (type.type) {
      case "Recursive": {
        const payload = type.value;
        const id = payload.type === "ref" ? payload.value : payload.value.id;
        if (payload.type === "wrapper") nodes.set(id, payload.value.inner);
        if (id === NODE_ID && Boolean(a.value.isAsync) !== Boolean(m.value.isAsync)) {
          found.push(`${path} ${a.type}: the analysis marks ${String(a.value.isAsync)}, the decode ${String(m.value.isAsync)}`);
        }
        walk(a, m, nodes.get(id)!, path);
        return;
      }
      case "Struct":
        for (const { name, type: field } of type.value as { name: string; type: EastTypeValue }[]) walk(a[name], m[name], field, `${path}.${name}`);
        return;
      case "Variant": {
        const arm = (type.value as { name: string; type: EastTypeValue }[]).find(({ name }) => name === a.type)!;
        walk(a.value, m.value, arm.type, `${path}/${String(a.type)}`);
        return;
      }
      case "Array":
        (a as unknown[]).forEach((element, i) => walk(element, m[i], type.value, `${path}[${i}]`));
        return;
      default:
        return;
    }
  };
  walk(analysed, marked, IR_TYPE, "ir");
  return found;
}

/** How many nodes a decode marked as awaiting. */
function awaiting(marked: IR): number {
  let count = 0;
  const nodes = new Map<bigint, EastTypeValue>();
  const walk = (m: any, type: EastTypeValue): void => {
    if (isTypeValueEqual(type, TYPE_TYPE)) return;
    switch (type.type) {
      case "Recursive": {
        const payload = type.value;
        const id = payload.type === "ref" ? payload.value : payload.value.id;
        if (payload.type === "wrapper") nodes.set(id, payload.value.inner);
        if (id === NODE_ID && m.value.isAsync === true) count += 1;
        walk(m, nodes.get(id)!);
        return;
      }
      case "Struct":
        for (const { name, type: field } of type.value as { name: string; type: EastTypeValue }[]) walk(m[name], field);
        return;
      case "Variant":
        walk(m.value, (type.value as { name: string; type: EastTypeValue }[]).find(({ name }) => name === m.type)!.type);
        return;
      case "Array":
        for (const element of m as unknown[]) walk(element, type.value);
        return;
      default:
        return;
    }
  };
  walk(marked, IR_TYPE);
  return count;
}

const encodeIR = encodeBeast2For(IRType);
const decodeIR = decodeBeast2For(IRType);

/** The IR as a decode reads it: through beast2, with nothing the analysis added. */
function decoded(ir: IR): IR {
  return decodeIR(encodeIR(ir as never)) as IR;
}

const tick = East.asyncPlatform("analyze_async_tick", [IntegerType], IntegerType);
const note = East.platform("analyze_async_note", [StringType], NullType);
const List = RecursiveType((self) => VariantType({ nil: NullType, cons: StructType({ head: IntegerType, tail: self }) }));
const list = East.asyncPlatform("analyze_async_list", [], List);
/** Optional and never given: its call awaits only what its argument does. */
const absent = East.asyncPlatform("analyze_async_absent", [IntegerType], IntegerType, { optional: true });
const PLATFORM = [
  tick.implement((n: bigint) => Promise.resolve(n + 1n)),
  note.implement(() => null),
  list.implement(() => Promise.resolve(variant("nil", null))),
];
const ASYNC = new Set(["analyze_async_tick", "analyze_async_list"]);

const Pair = StructType({ a: IntegerType, b: IntegerType });
const Choice = VariantType({ one: IntegerType, none: NullType });

/** A function that awaits inside every kind of node, beside one that does not. */
const everyNode = East.asyncFunction(
  [IntegerType, ArrayType(IntegerType), SetType(IntegerType), DictType(StringType, IntegerType), Choice],
  IntegerType,
  ($, n, xs, s, d, choice) => {
    const total = $.let(tick(n));
    const plain = $.let(n.add(1n));
    $.assign(total, total.add(tick(plain)));
    $(note("noted"));
    const pair = $.let(East.value({ a: tick(1n), b: plain }, Pair));
    $.assign(total, total.add(pair.a));
    const items = $.let(East.value([tick(2n), plain], ArrayType(IntegerType)));
    const kept = $.let(East.value(new Set([tick(3n)]), SetType(IntegerType)));
    const byName = $.let(East.value(new Map([["k", tick(4n)]]), DictType(StringType, IntegerType)));
    const cell = $.let(East.value(ref(tick(5n)), RefType(IntegerType)));
    const chosen = $.let(East.value(variant("one", tick(6n)), Choice));
    const maybe = $.let(East.value(variant("none", null), OptionType(IntegerType)));
    $.assign(maybe, some(tick(7n)));
    const cons = $.let(East.value(variant("cons", { head: tick(8n), tail: East.value(variant("nil", null), List) }), List));
    $.match(list().unwrap(), { cons: ($, c) => { $.assign(total, total.add(c.head)); } });
    $.match(cons.unwrap(), { cons: ($, c) => { $.assign(total, total.add(c.head)); } });
    $.if(East.greater(total, 0n), ($) => { $.assign(total, tick(total)); }).else(($) => { $.assign(total, 0n); });
    $.if(East.greater(plain, 0n), ($) => { $.assign(plain, plain.add(1n)); });
    $.match(choice, { one: ($, x) => { $.assign(total, total.add(tick(x))); }, none: ($) => { $(note("none")); } });
    $.match(chosen, { one: ($, x) => { $.assign(plain, plain.add(x)); } });
    const i = $.let(0n);
    $.while(East.less(i, tick(2n)), ($) => { $.assign(i, i.add(1n)); });
    $.while(East.less(i, 0n), ($) => { $.assign(i, i.add(1n)); });
    $.for(xs, ($, x) => { $.assign(total, total.add(tick(x))); });
    $.for(items, ($, x) => { $.assign(plain, plain.add(x)); });
    $.for(s, ($, x) => { $.assign(total, total.add(tick(x))); });
    $.for(kept, ($, x) => { $.assign(plain, plain.add(x)); });
    $.for(d, ($, v) => { $.assign(total, total.add(tick(v))); });
    $.for(byName, ($, v) => { $.assign(plain, plain.add(v)); });
    $.try(($) => { $.assign(total, tick(total)); }).catch(($, message) => { $(note(message)); }).finally(($) => { $(note("done")); });
    $.try(($) => { $.assign(plain, plain.add(1n)); }).catch(($, message) => { $(note(message)); });
    const later = $.let(East.asyncFunction([IntegerType], IntegerType, ($, x) => {
      const y = $.let(tick(x));
      return y.add(1n);
    }));
    $.assign(total, total.add(later(1n)));
    const now = $.let(East.function([IntegerType], IntegerType, (_$, x) => x.add(1n)));
    $.assign(total, now(tick(total)));
    $.assign(plain, now(plain));
    $.assign(total, total.add(absent(plain)));
    $.assign(total, total.add(cell.get()));
    $.if(East.less(total, 0n), ($) => { $.error(East.str`negative after ${tick(total)}`); });
    $.if(East.equal(total, 7n), ($) => { $.return(tick(total)); });
    return total;
  },
);

const Later = AsyncFunctionType([IntegerType], IntegerType);
const Closures = StructType({ later: Later, nested: FunctionType([], Later) });

/** A function that awaits nothing, but makes closures that do. */
const maker = East.function([IntegerType], Closures, ($, n) => {
  const later = $.let(East.asyncFunction([IntegerType], IntegerType, ($, x) => {
    const doubled = $.let(tick(x.multiply(2n)));
    $.if(East.greater(doubled, n), ($) => { $.return(doubled); });
    return n;
  }));
  const nested = $.let(East.function([], Later, (_$) => East.asyncFunction([IntegerType], IntegerType, (_$, x) => tick(x.add(n)))));
  return East.value({ later, nested }, Closures);
});

describe("a decode marks which nodes await as the analysis does (#1207)", () => {
  // Each with the nodes it awaits in, at least: what the comparison covers.
  for (const [name, fn, awaits] of [["every kind of node", everyNode, 70], ["a function making closures that await", maker, 4]] as const) {
    test(`${name}: built and decoded, every node marked as the analysis marks it`, () => {
      const ir = fn.toIR().ir as IR;
      const marked = decoded(ir);
      markAsync(marked, ASYNC);
      assert.deepEqual(differences(analyzeIR(ir, PLATFORM, {}), marked), []);
      assert.ok(awaiting(marked) >= awaits, `${name} awaits in ${awaiting(marked)} nodes, not the ${awaits} this holds to the analysis`);
    });
  }

  test("every example the test modules export, built and decoded, is marked as the analysis marks it", async () => {
    const dir = new URL(".", import.meta.url);
    let functions = 0;
    let awaited = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".examples.js")).sort()) {
      const module = await import(new URL(file, dir).href) as Record<string, unknown>;
      for (const [name, def] of Object.entries(module)) {
        if (typeof def !== "object" || def === null || !("fn" in def) || !("keywords" in def)) continue;
        const ir = (def.fn as { toIR(): { ir: unknown } }).toIR().ir as IR;
        const marked = decoded(ir);
        markAsync(marked, new Set());
        assert.deepEqual(differences(analyzeIR(ir, [], {}), marked), [], `${file} ${name}`);
        functions += 1;
        awaited += awaiting(marked);
      }
    }
    assert.ok(functions > 500, `only ${functions} examples were found`);
    assert.ok(awaited > 0, "no example awaits, so none was held to the analysis's marks");
  });
});
