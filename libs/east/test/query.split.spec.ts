/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* Splitting a query over a dataset's pieces (#941). Each rule's piece
 * program, merge and final function, encoded and decoded as a runner reads
 * them, and run over the shared fixture cut into pieces and assembled as e3
 * assembles them, give what the one unit gives, empty pieces included (N1);
 * each split's explanation, and each reason a query stays one unit, is pinned
 * (N1's golden plans), with the reads that prune (N2's names); the programs
 * encode to the same bytes each time, which e3's cache keys a unit on; and a
 * piece's runtime error names its place in the jq. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  EastError, EastTypeType, SortedMap, SortedSet,
  checkJq, compareFor, decodeEastIR, encodeEastIR, equalFor, printFor, splitJq, toEastTypeValue, translateJq,
  type EastType, type FunctionExpr, type JqSplit, type JqSplitCall, type JqRange,
} from "../src/index.js";
import { FixtureRoot, queryFixture } from "./query.fixture.js";

const fixture = queryFixture() as unknown as Record<string, unknown>;

/** A function as a runner gets it: its IR encoded, decoded and compiled. */
function asRun(fn: FunctionExpr<any[], any>): (...args: unknown[]) => unknown {
  return decodeEastIR(encodeEastIR(fn.toIR())).compile([]) as (...args: unknown[]) => unknown;
}

/** A collection cut into `k` pieces in order, as ranges of its rows: some empty when `k` is more than its rows. */
function cut(value: unknown, type: EastType, k: number): unknown[] {
  const t = type.type === "Recursive" ? type.node as EastType : type;
  if (t.type === "Array") {
    const rows = value as unknown[];
    return Array.from({ length: k }, (_, i) => rows.slice(Math.floor(i * rows.length / k), Math.floor((i + 1) * rows.length / k)));
  }
  const key = (t as { key: EastType }).key;
  const entries = t.type === "Dict" ? [...(value as SortedMap<unknown, unknown>).entries()] : [...(value as SortedSet<unknown>)].map(k2 => [k2, null] as const);
  return Array.from({ length: k }, (_, i) => {
    const part = entries.slice(Math.floor(i * entries.length / k), Math.floor((i + 1) * entries.length / k));
    return t.type === "Dict" ? new SortedMap(part as [unknown, unknown][], compareFor(key)) : new SortedSet(part.map(([k2]) => k2), compareFor(key));
  });
}

/**
 * A split call run as e3 runs it: each piece's program over its piece and the
 * other inputs whole, the pieces' outputs assembled by the output kind — an
 * array concatenated, a set united in East's order, a dict's equal keys merged
 * in input order, a fold combined from its zero, a piece at a time and then
 * across them — and the final function over the assembled output and the
 * inputs.
 */
function runSplit(split: JqSplitCall, pieces: number): unknown {
  const values = split.inputs.map(input => fixture[input.name]);
  const over = split.inputs.findIndex(input => input.name === split.over);
  const piece = asRun(split.piece());
  const emitted = cut(values[over], split.inputs[over]!.type, pieces).map(part => {
    const out: unknown[][] = [];
    const args = [...values];
    args[over] = part;
    piece(...args, (...emit: unknown[]) => { out.push(emit); return null; });
    return out;
  });
  const output = split.output;
  let assembled: unknown;
  switch (output.kind) {
    case "array":
      assembled = emitted.flatMap(part => part.map(([row]) => row));
      break;
    case "set":
      assembled = new SortedSet(emitted.flatMap(part => part.map(([row]) => row)), compareFor((output.type as any).key));
      break;
    case "dict": {
      const merge = asRun(output.merge());
      const dict = new SortedMap<unknown, unknown>([], compareFor((output.type as any).key));
      for (const part of emitted) for (const [key, value] of part) dict.set(key, dict.has(key) ? merge(key, dict.get(key), value) : value);
      assembled = dict;
      break;
    }
    case "fold": {
      const combine = asRun(output.combine());
      const partials = emitted.map(part => part.reduce((acc: unknown, [value]) => combine(acc, value), output.zero));
      assembled = partials.reduce((acc: unknown, value) => combine(acc, value), output.zero);
      break;
    }
  }
  const then = split.then();
  return then === null ? assembled : asRun(then)(assembled, ...values);
}

/** Whether two East values of a type are equal, Floats to within rounding: a sum's grouping changes its last bits. */
function close(type: EastType, a: unknown, b: unknown): boolean {
  const t = type.type === "Recursive" ? type.node as EastType : type;
  switch (t.type) {
    case "Float": {
      const x = a as number;
      const y = b as number;
      return equalFor(t)(x, y) || Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
    }
    case "Array": {
      const xs = a as unknown[];
      const ys = b as unknown[];
      return xs.length === ys.length && xs.every((x, i) => close(t.value as EastType, x, ys[i]));
    }
    case "Struct":
      return Object.entries(t.fields as Record<string, EastType>).every(([name, field]) => close(field, (a as any)[name], (b as any)[name]));
    case "Variant": {
      const x = a as { type: string; value: unknown };
      const y = b as { type: string; value: unknown };
      return x.type === y.type && close((t.cases as Record<string, EastType>)[x.type]!, x.value, y.value);
    }
    case "Dict": {
      const x = [...(a as SortedMap<unknown, unknown>).entries()];
      const y = [...(b as SortedMap<unknown, unknown>).entries()];
      const sameKey = equalFor(t.key as EastType);
      return x.length === y.length && x.every(([k, v], i) => sameKey(k, y[i]![0]) && close(t.value as EastType, v, y[i]![1]));
    }
    default:
      return equalFor(type)(a as never, b as never);
  }
}

/** A query checked against the fixture's root. */
function checked(program: string) {
  const result = checkJq(program, FixtureRoot, { root: true });
  assert.ok(result.query !== null, `${program}: ${result.diagnostics.map(d => d.message).join(" ")}`);
  return result;
}

/** A query's split, its multiplicity's limit as the builder sends it. */
function split(program: string, maxOutputs = 1000): JqSplit {
  const c = checked(program);
  return splitJq(c, c.multiplicity === "many" ? { maxOutputs } : {});
}

// ─── Equivalence ──────────────────────────────────────────────────────────

/** Queries the pieces must agree with the one unit on: every combine, every leaf, every row step. */
const SPLITS: readonly string[] = [
  // The rows concatenated, and what runs once over them.
  ".orders | map(select(.status.type == \"shipped\")) | sort_by(-.total) | .[:5] | map(.id)",
  ".orders | map(.lines) | flatten | map(.sku)",
  "[.orders[] | select(.total > 1000) | .id]",
  ".orders | [.[] | .lines[] | .sku]",
  ".orders | [.[] | . as $o | .lines[] | {order: $o.id, sku}]",
  ".customers as $c | .orders | map({id, region: $c[.customer_id].region})",
  ".orders | map(select(.total > 500)) | {counts: [length], result: .[:1000]}",
  ".orders | map(select(.total > 100)) | .[] | .id",
  // Totals.
  ".orders | map(.total) | add",
  ".orders | map(.lines | length) | add",
  ".orders | map(.customer_id) | add",
  ".orders | map(.lines) | add | length",
  ".orders | map(.discount) | add",
  ".orders | map(select(.total > 500)) | length",
  ".orders | min_by(.total) | .id",
  ".orders | max_by(.customer_id) | .id",
  ".orders | min_by(.lines[].qty) | .id",
  ".orders | map(.total) | min",
  ".orders | map(.total) | max",
  ".orders | map(.total) | first",
  ".orders | map(.total) | last",
  ".orders | map(.total) | .[0]",
  ".orders | map(.total) | .[-1]",
  ".orders | any(.total > 3000)",
  ".orders | all(.total > 10)",
  ".orders | map(.total > 1000) | any",
  ".orders | map(.customer_id) | unique | length",
  ".orders | {n: length, total: (map(.total) | add), mean: (map(.total) | add / length)}",
  ".orders | if length > 0 then (map(.total) | max) else 0 end",
  ".orders | map(select(.total > 100)) | {big: (map(.total) | max // 0), first: (.[0].id // 0)}",
  ".byId | map(.total) | add",
  ".cells | add",
  // Groups.
  ".orders | group_by(.customer_id) | map({customer: .[0].customer_id, revenue: map(.total) | add, n: length})",
  ".customers as $c | .orders | map(. + {region: $c[.customer_id].region}) | group_by(.region) | map({region: .[0].region, revenue: map(.total) | add, mean: (map(.total) | add / length), lo: (map(.total) | min), hi: (map(.total) | max), skus: (map(.lines[].sku) | unique | length)})",
  ".orders | group_by(.status.type) | map({status: .[0].status.type, ids: map(.id)})",
  ".orders | group_by(.customer_id) | map(sort_by(.total) | .[0].id)",
  ".orders | group_by(.customer_id) | map(length) | add",
  ".orders | group_by(.customer_id) | map(max_by(.total) | .id)",
  // Distinct rows, and the first of each key.
  ".orders | map(.customer_id) | unique",
  "[.orders[] | .lines[] | .sku] | unique",
  ".orders | unique_by(.customer_id) | map(.id)",
  // A reduce into a dict.
  "reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total)",
  ".orders | reduce .[] as $o ({}; .[$o.customer_id] = $o.id)",
  "reduce .orders[] as $o ({}; .[$o.customer_id] += 1)",
];

describe("a split query gives what the one unit gives (N1)", () => {
  for (const program of SPLITS) {
    test(program, () => {
      const c = checked(program);
      const options = c.multiplicity === "many" ? { maxOutputs: 1000 } : {};
      const s = splitJq(c, options);
      assert.equal(s.kind, "split", s.kind === "whole" ? `${s.reason.code} ${s.reason.name}` : "");
      if (s.kind !== "split") return;
      const translation = translateJq(c, options);
      assert.deepEqual(s.inputs.map(i => i.name), translation.inputs.map(i => i.name), "the inputs, in the translation's order");
      assert.ok(equalFor(EastTypeType)(toEastTypeValue(s.resultType), toEastTypeValue(translation.resultType)), "the result type, the translation's");
      const expected = asRun(translation.fn())(...translation.inputs.map(i => fixture[i.name!]));
      // One piece, a few, more pieces than rows: some empty.
      for (const pieces of [1, 2, 3, 7, 64]) {
        const got = runSplit(s, pieces);
        assert.ok(close(translation.resultType, got, expected), `${pieces} pieces: ${printFor(translation.resultType)(got as never)} is not ${printFor(translation.resultType)(expected as never)}`);
      }
    });
  }

  test("a many query's final function keeps the limit and one more, as the translation does", () => {
    const program = ".orders | map(select(.total > 100)) | .[] | .id";
    const s = split(program, 5);
    assert.ok(s.kind === "split");
    const ids = runSplit(s, 3) as bigint[];
    assert.equal(ids.length, 6);
    const translation = translateJq(checked(program), { maxOutputs: 5 });
    assert.ok(close(translation.resultType, ids, asRun(translation.fn())(fixture.orders)));
  });

  test("rows that are the query's result need no final function", () => {
    const s = split(".orders | map(.id)");
    assert.ok(s.kind === "split" && s.output.kind === "array");
    assert.equal(s.then(), null);
  });
});

// ─── The programs ─────────────────────────────────────────────────────────

describe("the programs", () => {
  test("encode to the same bytes each time, which e3's cache keys a unit on", () => {
    for (const program of SPLITS) {
      const a = split(program);
      const b = split(program);
      assert.ok(a.kind === "split" && b.kind === "split");
      assert.deepEqual(encodeEastIR(a.piece().toIR()), encodeEastIR(b.piece().toIR()), `${program}: the piece program`);
      const [ta, tb] = [a.then(), b.then()];
      assert.deepEqual(ta === null ? null : encodeEastIR(ta.toIR()), tb === null ? null : encodeEastIR(tb.toIR()), `${program}: the final function`);
      if (a.output.kind === "dict" && b.output.kind === "dict") assert.deepEqual(encodeEastIR(a.output.merge().toIR()), encodeEastIR(b.output.merge().toIR()), `${program}: the merge`);
      if (a.output.kind === "fold" && b.output.kind === "fold") assert.deepEqual(encodeEastIR(a.output.combine().toIR()), encodeEastIR(b.output.combine().toIR()), `${program}: the combine`);
    }
  });

  test("a piece's runtime error names its place in the jq, as the one unit's does", () => {
    const program = ".orders | map(.lines | length) | map(10 / (. - .)) | add";
    const s = split(program);
    assert.ok(s.kind === "split");
    const thrown = (run: () => unknown): EastError => {
      try { run(); } catch (e) { if (e instanceof EastError) return e; throw e; }
      throw new Error("the query raises no error");
    };
    const inPiece = thrown(() => runSplit(s, 2));
    const translation = translateJq(checked(program));
    const inUnit = thrown(() => asRun(translation.fn())(fixture.orders));
    assert.equal(inPiece.eastMessage, "Division by zero");
    assert.deepEqual(inPiece.location[0], inUnit.location[0]);
    assert.deepEqual(inPiece.location[0], { filename: "jq", line: 1n, column: 38n });
  });
});

// ─── Explanations (N1's golden plans) ─────────────────────────────────────

/** A split's explanation, or the reason a query stays one unit, as one line of text. */
function explained(program: string): string {
  const s = split(program);
  const text = (range: JqRange | null): string => range === null ? "-" : `«${program.slice(range.from, range.to)}»`;
  const pruning = s.pruning.length === 0 ? "" : ` · pruning ${s.pruning.map(p => `${p.kind} ${p.name} ${text(p.range)}`).join(", ")}`;
  if (s.kind === "whole") return `whole: ${s.reason.code}${s.reason.name === null ? "" : ` ${s.reason.name}`} ${text(s.reason.range)}${pruning}`;
  const c = s.stages.combine;
  const totals = (list: readonly { range: JqRange; rule: string }[]): string => list.map(t => `${t.rule} ${text(t.range)}`).join(", ");
  const combine = c.kind === "concat" ? "concat"
    : c.kind === "totals" ? `totals [${totals(c.totals)}]`
    : c.kind === "group" ? `group by ${text(c.key)} ${c.totals === null ? "rows collected" : `[${totals(c.totals)}]`}`
    : c.kind === "distinct" ? "distinct"
    : c.kind === "distinct_by" ? `first of each ${text(c.key)}`
    : `reduce by ${text(c.key)}, ${c.update}`;
  const broadcast = s.broadcast.length === 0 ? "" : ` · whole in every piece: ${s.broadcast.join(", ")}`;
  return `split ${s.over} into ${s.output.kind}: piece ${text(s.stages.piece)} · ${combine} · then ${text(s.stages.then)}${broadcast}${pruning}`;
}

/** Each rule and each reason, and the explanation it gives. */
const GOLDEN: readonly (readonly [program: string, explanation: string])[] = [
  // Each rule.
  [".orders | map(select(.total > 500)) | sort_by(-.total) | .[:5]",
    "split orders into array: piece «.orders | map(select(.total > 500))» · concat · then «sort_by(-.total) | .[:5]»"],
  [".orders | map(.id)", "split orders into array: piece «.orders | map(.id)» · concat · then -"],
  ["[.orders[] | select(.total > 1000) | .id]", "split orders into array: piece «[.orders[] | select(.total > 1000) | .id]» · concat · then -"],
  [".orders | map(.total) | add", "split orders into fold: piece «.orders | map(.total)» · totals [add «add»] · then -"],
  [".orders | map(select(.total > 500)) | length", "split orders into fold: piece «.orders | map(select(.total > 500))» · totals [count «length»] · then -"],
  [".orders | {n: length, mean: (map(.total) | add / length)}",
    "split orders into fold: piece «.orders» · totals [count «length», add «map(.total) | add», count «map(.total) | add / length»] · then -"],
  [".orders | min_by(.total) | .id", "split orders into fold: piece «.orders» · totals [min «min_by(.total)»] · then «.id»"],
  [".orders | map(.total) | max", "split orders into fold: piece «.orders | map(.total)» · totals [max «max»] · then -"],
  [".orders | map(.total) | first", "split orders into fold: piece «.orders | map(.total)» · totals [first «first»] · then -"],
  [".orders | map(.total) | .[-1]", "split orders into fold: piece «.orders | map(.total)» · totals [last «.[-1]»] · then -"],
  [".orders | any(.total > 3000)", "split orders into fold: piece «.orders» · totals [any «any(.total > 3000)»] · then -"],
  [".orders | all(.total > 10)", "split orders into fold: piece «.orders» · totals [all «all(.total > 10)»] · then -"],
  [".orders | map(.customer_id) | unique | length", "split orders into set: piece «.orders | map(.customer_id)» · distinct · then «length»"],
  [".orders | {customers: (map(.customer_id) | unique | length)}", "split orders into fold: piece «.orders» · totals [union «map(.customer_id) | unique»] · then -"],
  [".orders | group_by(.customer_id) | map({customer: .[0].customer_id, revenue: map(.total) | add})",
    "split orders into dict: piece «.orders» · group by «.customer_id» [first «.[0]», add «map(.total) | add»] · then -"],
  [".orders | group_by(.customer_id) | map(sort_by(.total) | .[0].id)",
    "split orders into dict: piece «.orders» · group by «.customer_id» rows collected · then -"],
  [".orders | unique_by(.customer_id) | map(.id)", "split orders into dict: piece «.orders» · first of each «.customer_id» · then «map(.id)»"],
  ["reduce .orders[] as $o ({}; .[$o.customer_id] += $o.total)",
    "split orders into dict: piece «reduce .orders[]» · reduce by «$o.customer_id», add · then -"],
  [".orders | reduce .[] as $o ({}; .[$o.customer_id] = $o.id)", "split orders into dict: piece «.orders» · reduce by «$o.customer_id», replace · then -"],
  [".customers as $c | .orders | map($c[.customer_id].region) | unique",
    "split orders into set: piece «.orders | map($c[.customer_id].region)» · distinct · then - · whole in every piece: customers"],
  [".orders | map(.lines) | flatten | map(.qty) | add", "split orders into fold: piece «.orders | map(.lines) | flatten | map(.qty)» · totals [add «add»] · then -"],
  // Each reason a query stays one unit.
  [".orders | length", "whole: no_stream orders - · pruning count orders «.orders | length»"],
  [".byId[1010] | .total", "whole: no_stream - · pruning seek byId «.byId[1010]»"],
  [".byId | has(1010)", "whole: no_stream byId - · pruning seek byId «.byId | has(1010)»"],
  [".forecast", "whole: no_stream forecast -"],
  ["{revenue: (.orders | map(.total) | add)}", "whole: nested «.orders | map(.total) | add»"],
  [".orders[] | .id", "whole: stops_early orders - · pruning stop orders «.orders[]»"],
  ["first(.orders[] | select(.total > 1000)) | .id", "whole: stops_early first «first(.orders[] | select(.total > 1000))»"],
  ["[limit(3; .orders[])]", "whole: nested «.orders[]»"],
  [".orders | .[0:3]", "whole: position slice «.[0:3]»"],
  [".orders | first", "whole: position first «first»"],
  [".orders | sort_by(.total) | .[0].id", "whole: every_row sort_by «sort_by(.total)»"],
  [".orders | foreach .[] as $o (0; . + 1)", "whole: state foreach «foreach .[] as $o (0; . + 1)»"],
  [".model as $m | .orders | map(call($m; {price: .total, region: \"NSW\"}))", "whole: calls «call($m; {price: .total, region: \"NSW\"})»"],
  [".orders as $all | .orders | map(.total / ($all | length))", "whole: reads_again orders «.orders as $all | .orders | map(.total / ($all | length))»"],
  [".orders | group_by(.lines) | map(length)", "whole: key «.lines»"],
  ["def big: .total > 1000; .orders | map(select(big))", "whole: shape «def big: .total > 1000; .orders | map(select(big))»"],
];

describe("explanations: golden plans for each rule and each reason (N1)", () => {
  for (const [program, expected] of GOLDEN) {
    test(program, () => assert.equal(explained(program), expected));
  }
});
