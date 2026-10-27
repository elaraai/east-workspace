/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* Compiled control flow, timed: run by hand with `make control-bench`, never
 * in CI, and nothing here asserts a time. Each case is an East function that
 * takes a `continue`, a `break` or a `return` often over ROWS rows, beside the
 * same loop taking none. It is compiled once, called once to warm, then RUNS
 * times, and each call's result is held to the one TypeScript works out, so a
 * fast wrong answer fails. The last case has the shape of e3-ui's schedule
 * seam: the drafts a window's events are read with, each held one skipped by a
 * `continue`, then the window's items, each matched on its times. Last, the
 * compile of two large functions — one with no `return`, `continue` or
 * `break`, one with a `continue` in each of its branches — analysed afresh
 * for each run, so each compile is of nodes it has not seen. The table it
 * prints is the median of each, in milliseconds.
 *
 *   node dist/test/control-bench/bench.js [rows] [runs]
 */

import { cpus, platform, release, totalmem } from "node:os";

import {
  ArrayType, DateTimeType, DictType, East, IntegerType, OptionType, SetType, StringType, StructType,
  equalFor, none, printFor, some,
  type EastType, type IntegerExpr, type ValueTypeOf,
} from "../../src/index.js";
import { analyzeIR, compile_internal } from "../../src/internal.js";

const ROWS = Number(process.argv[2] ?? 100_000);
const RUNS = Number(process.argv[3] ?? 15);

/** The median of some times. */
function median(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Times a call: once to warm, then {@link RUNS} times, each result held to `expected`. */
function time(name: string, type: EastType, run: () => unknown, expected: unknown): number {
  const equal = equalFor(type);
  if (!equal(run() as never, expected as never)) throw new Error(`${name}: gave another result than TypeScript`);
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    const result = run();
    times.push(performance.now() - start);
    if (!equal(result as never, expected as never)) throw new Error(`${name}: gave another result than TypeScript`);
  }
  return median(times);
}

/** As {@link time}, for an async call. */
async function timeAsync(name: string, type: EastType, run: () => Promise<unknown>, expected: unknown): Promise<number> {
  const equal = equalFor(type);
  if (!equal(await run() as never, expected as never)) throw new Error(`${name}: gave another result than TypeScript`);
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    const result = await run();
    times.push(performance.now() - start);
    if (!equal(result as never, expected as never)) throw new Error(`${name}: gave another result than TypeScript`);
  }
  return median(times);
}

const Ints = ArrayType(IntegerType);

// ─── The inputs, made by East ───────────────────────────────────────────────

const ints = East.compile(East.function([IntegerType], Ints, (_$, n) => East.Array.range(East.value(0n), n, 1n)), []);
const intSet = East.compile(East.function([IntegerType], SetType(IntegerType), ($, n) => {
  const s = $.let(new Set<bigint>(), SetType(IntegerType));
  $.for(East.Array.range(East.value(0n), n, 1n), ($, x) => { $(s.insert(x)); });
  return s;
}), []);
const intDict = East.compile(East.function([IntegerType], DictType(IntegerType, IntegerType), ($, n) => {
  const d = $.let(new Map(), DictType(IntegerType, IntegerType));
  $.for(East.Array.range(East.value(0n), n, 1n), ($, x) => { $(d.insert(x, x)); });
  return d;
}), []);
// Every other row none.
const options = East.compile(East.function([IntegerType], ArrayType(OptionType(IntegerType)), ($, n) => {
  const a = $.let([], ArrayType(OptionType(IntegerType)));
  $.for(East.Array.range(East.value(0n), n, 1n), ($, x) => {
    $.if(x.remainder(2n).equal(0n), ($) => { $(a.pushLast(East.value(none, OptionType(IntegerType)))); })
      .else(($) => { $(a.pushLast(East.value(some(x), OptionType(IntegerType)))); });
  });
  return a;
}), []);

// Sixteen thresholds, 0 to 60 by 4.
const steps = East.compile(East.function([], Ints, (_$) => East.Array.range(East.value(0n), 64n, 4n)), []);

const N = BigInt(ROWS);
const rows = ints(N);
const set = intSet(N);
const dict = intDict(N);
const opts = options(N);

// What TypeScript works out.
let sumAll = 0n;
let sumOdd = 0n;
for (let i = 0n; i < N; i++) {
  sumAll += i;
  if (i % 2n === 1n) sumOdd += i;
}

// ─── The cases ──────────────────────────────────────────────────────────────

const cases: { name: string; ms: () => number | Promise<number> }[] = [];

{
  const fn = East.compile(East.function([Ints], IntegerType, ($, xs) => {
    const sum = $.let(0n);
    $.for(xs, ($, x) => { $.assign(sum, sum.add(x)); });
    return sum;
  }), []);
  cases.push({ name: "ForArray, no control flow", ms: () => time("ForArray, no control flow", IntegerType, () => fn(rows), sumAll) });
}

{
  const fn = East.compile(East.function([Ints], IntegerType, ($, xs) => {
    const sum = $.let(0n);
    $.for(xs, ($, x, _i, label) => {
      $.if(x.remainder(2n).equal(0n), ($) => { $.continue(label); });
      $.assign(sum, sum.add(x));
    });
    return sum;
  }), []);
  cases.push({ name: "ForArray, `continue` every other row", ms: () => time("ForArray continue", IntegerType, () => fn(rows), sumOdd) });
}

{
  const fn = East.compile(East.function([IntegerType], IntegerType, ($, n) => {
    const i = $.let(0n);
    const sum = $.let(0n);
    $.while(East.less(i, n), ($, label) => {
      const x = $.const(i);
      $.assign(i, i.add(1n));
      $.if(x.remainder(2n).equal(0n), ($) => { $.continue(label); });
      $.assign(sum, sum.add(x));
    });
    return sum;
  }), []);
  cases.push({ name: "While, `continue` every other row", ms: () => time("While continue", IntegerType, () => fn(N), sumOdd) });
}

{
  const fn = East.compile(East.function([SetType(IntegerType)], IntegerType, ($, xs) => {
    const sum = $.let(0n);
    $.for(xs, ($, x, label) => {
      $.if(x.remainder(2n).equal(0n), ($) => { $.continue(label); });
      $.assign(sum, sum.add(x));
    });
    return sum;
  }), []);
  cases.push({ name: "ForSet, `continue` every other key", ms: () => time("ForSet continue", IntegerType, () => fn(set), sumOdd) });
}

{
  const fn = East.compile(East.function([DictType(IntegerType, IntegerType)], IntegerType, ($, xs) => {
    const sum = $.let(0n);
    $.for(xs, ($, x, _key, label) => {
      $.if(x.remainder(2n).equal(0n), ($) => { $.continue(label); });
      $.assign(sum, sum.add(x));
    });
    return sum;
  }), []);
  cases.push({ name: "ForDict, `continue` every other entry", ms: () => time("ForDict continue", IntegerType, () => fn(dict), sumOdd) });
}

{
  const fn = East.compile(East.function([ArrayType(OptionType(IntegerType))], IntegerType, ($, xs) => {
    const sum = $.let(0n);
    $.for(xs, ($, x, _i, label) => {
      $.match(x, {
        none: ($) => { $.continue(label); },
        some: ($, v) => { $.assign(sum, sum.add(v)); },
      });
    });
    return sum;
  }), []);
  cases.push({ name: "`continue` in a match arm", ms: () => time("continue in a match arm", IntegerType, () => fn(opts), sumOdd) });
}

{
  // The value the match gives is bound: the `continue` is in an expression.
  const fn = East.compile(East.function([ArrayType(OptionType(IntegerType))], IntegerType, ($, xs) => {
    const sum = $.let(0n);
    $.for(xs, ($, x, _i, label) => {
      // A `continue` arm is typed as giving nothing, though it gives Never: the match is an Integer.
      const v = $.const(x.match({ none: ($) => $.continue(label), some: (_$, v) => v }) as unknown as IntegerExpr);
      $.assign(sum, sum.add(v));
    });
    return sum;
  }), []);
  cases.push({ name: "`continue` in a match whose value is bound", ms: () => time("continue in a bound match", IntegerType, () => fn(opts), sumOdd) });
}

{
  // Ten rows to an outer iteration; the third of them continues the outer loop.
  const tens = ints(N / 10n);
  const ten = ints(10n);
  // Each outer row adds itself at its inner rows 0 and 1, and never reaches its own last statement.
  let expected = 0n;
  for (let o = 0n; o < N / 10n; o++) expected += 2n * o + 1n;
  const fn = East.compile(East.function([Ints, Ints], IntegerType, ($, outer, inner) => {
    const sum = $.let(0n);
    $.for(outer, ($, o, _oi, outerLabel) => {
      $.for(inner, ($, i) => {
        $.if(i.equal(2n), ($) => { $.continue(outerLabel); });
        $.assign(sum, sum.add(o.add(i)));
      });
      $.assign(sum, sum.add(1_000_000n));
    });
    return sum;
  }), []);
  cases.push({ name: "`continue` an outer loop from an inner one", ms: () => time("continue an outer loop", IntegerType, () => fn(tens, ten), expected) });
}

{
  // Ten rows to an outer iteration; the inner loop breaks at its fourth.
  const tens = ints(N / 10n);
  const ten = ints(10n);
  let expected = 0n;
  for (let o = 0n; o < N / 10n; o++) expected += 0n + 1n + 2n + 1n;
  const fn = East.compile(East.function([Ints, Ints], IntegerType, ($, outer, inner) => {
    const sum = $.let(0n);
    $.for(outer, ($) => {
      $.for(inner, ($, i, _ii, innerLabel) => {
        $.if(i.equal(3n), ($) => { $.break(innerLabel); });
        $.assign(sum, sum.add(i));
      });
      $.assign(sum, sum.add(1n));
    });
    return sum;
  }), []);
  cases.push({ name: "`break` an inner loop at its fourth row", ms: () => time("break an inner loop", IntegerType, () => fn(tens, ten), expected) });
}

{
  // A call a row: the first of sixteen thresholds at least the row's remainder, found by a loop it returns from.
  const thresholds = steps();
  let expected = 0n;
  // A remainder past the last threshold finds none: -1.
  for (let i = 0n; i < N; i++) expected += thresholds.find(t => t >= i % 64n) ?? -1n;
  const firstAtLeast = East.function([Ints, IntegerType], IntegerType, ($, ts, x) => {
    $.for(ts, ($, t) => {
      $.if(East.greaterEqual(t, x), ($) => { $.return(t); });
    });
    return -1n;
  });
  const fn = East.compile(East.function([Ints, Ints], IntegerType, ($, xs, ts) => {
    const find = $.const(firstAtLeast);
    const sum = $.let(0n);
    $.for(xs, ($, x) => { $.assign(sum, sum.add(find(ts, x.remainder(64n)))); });
    return sum;
  }), []);
  cases.push({ name: "`return` from a loop, a call a row", ms: () => time("return from a loop", IntegerType, () => fn(rows, thresholds), expected) });
}

{
  // A call a row, which returns early for half of them.
  let expected = 0n;
  for (let i = 0n; i < N; i++) expected += i > N / 2n ? N / 2n : i;
  const clamp = East.function([IntegerType, IntegerType], IntegerType, ($, x, top) => {
    $.if(East.greater(x, top), ($) => { $.return(top); });
    return x;
  });
  const fn = East.compile(East.function([Ints, IntegerType], IntegerType, ($, xs, top) => {
    const f = $.const(clamp);
    const sum = $.let(0n);
    $.for(xs, ($, x) => { $.assign(sum, sum.add(f(x, top))); });
    return sum;
  }), []);
  cases.push({ name: "early `return` from an if, a call a row", ms: () => time("early return", IntegerType, () => fn(rows, N / 2n), expected) });
}

{
  // A call a row, its body one `return`.
  const inc = East.function([IntegerType], IntegerType, ($, x) => { $.return(x.add(1n)); });
  const fn = East.compile(East.function([Ints], IntegerType, ($, xs) => {
    const f = $.const(inc);
    const sum = $.let(0n);
    $.for(xs, ($, x) => { $.assign(sum, sum.add(f(x))); });
    return sum;
  }), []);
  cases.push({ name: "`return` as a body's last statement, a call a row", ms: () => time("tail return", IntegerType, () => fn(rows), sumAll + N) });
}

{
  // A call a row whose loop runs in a try: the `return` leaves both.
  const thresholds = steps();
  let expected = 0n;
  for (let i = 0n; i < N; i++) expected += thresholds.find(t => t >= i % 64n) ?? -1n;
  const firstAtLeast = East.function([Ints, IntegerType], IntegerType, ($, ts, x) => {
    $.try(($) => {
      $.for(ts, ($, t) => {
        $.if(East.greaterEqual(t, x), ($) => { $.return(t); });
      });
    }).catch(($) => { $.return(-2n); });
    return -1n;
  });
  const fn = East.compile(East.function([Ints, Ints], IntegerType, ($, xs, ts) => {
    const find = $.const(firstAtLeast);
    const sum = $.let(0n);
    $.for(xs, ($, x) => { $.assign(sum, sum.add(find(ts, x.remainder(64n)))); });
    return sum;
  }), []);
  cases.push({ name: "`return` out of a try from its loop, a call a row", ms: () => time("return out of a try", IntegerType, () => fn(rows, thresholds), expected) });
}

{
  // An await a row, every other row skipped.
  const tenth = ints(N / 10n);
  let expected = 0n;
  for (let i = 0n; i < N / 10n; i++) if (i % 2n === 1n) expected += i;
  const same = East.asyncFunction([IntegerType], IntegerType, (_$, x) => x);
  const fn = East.compileAsync(East.asyncFunction([Ints], IntegerType, ($, xs) => {
    const f = $.const(same);
    const sum = $.let(0n);
    $.for(xs, ($, x, _i, label) => {
      const y = $.const(f(x));
      $.if(y.remainder(2n).equal(0n), ($) => { $.continue(label); });
      $.assign(sum, sum.add(y));
    });
    return sum;
  }), []);
  cases.push({ name: "async ForArray, an await and every other row `continue`d (a tenth of the rows)", ms: () => timeAsync("async continue", IntegerType, () => fn(tenth), expected) });
}

{
  // The schedule seam's shape: a window's rows, the drafts beside them — most of them of rows outside the window
  // that the record holds, each skipped by a `continue` — then each entry's item matched on its times.
  const Row = StructType({ title: StringType, start: OptionType(DateTimeType), end: OptionType(DateTimeType) });
  const Entry = StructType({ id: StringType, row: Row });
  const Held = DictType(StringType, Row);
  // Each row of the record, and where else it is: 0 in the window, 1 drafted outside it, 2 neither.
  const Source = ArrayType(StructType({ id: StringType, row: Row, place: IntegerType }));
  const Split = StructType({ held: Held, drafts: Held, record: Held });
  const window = ROWS / 20;
  const day = Date.UTC(2026, 9, 2);
  const source: ValueTypeOf<typeof Source> = [];
  let drafted = 0;
  for (let i = 0; i < ROWS; i++) {
    const start = new Date(day + (i % 96) * 900_000);
    const place = i < window ? 0n : i % 4 === 0 ? 1n : 2n;
    if (place === 1n) drafted++;
    source.push({
      id: `e${String(i).padStart(6, "0")}`, place,
      row: { title: `event ${i}`, start: some(start), end: some(new Date(start.getTime() + 3_600_000)) },
    });
  }
  const split = East.compile(East.function([Source], Split, ($, src) => {
    const held = $.let(new Map(), Held);
    const drafts = $.let(new Map(), Held);
    const record = $.let(new Map(), Held);
    $.for(src, ($2, e) => {
      $2(record.insert(e.id, e.row));
      $2.if(e.place.equal(0n), ($3) => { $3(held.insert(e.id, e.row)); })
        .elseIf(e.place.equal(1n), ($3) => { $3(drafts.insert(e.id, e.row)); });
    });
    return { held, drafts, record };
  }), []);
  const { held, drafts, record } = split(source);
  const from = new Date(day);
  const to = new Date(day + 86_400_000);
  // Every held row's item overlaps the window; no draft is read into it.
  const expected = BigInt(window);
  const withDrafts = East.function([Held, Held, Held], ArrayType(Entry), ($, rows, drafted, all) => {
    const out = $.let([], ArrayType(Entry));
    $.for(rows, ($2, row, id) => {
      $2.if(drafted.has(id), ($3) => { $3(out.pushLast({ id, row: drafted.get(id) })); })
        .else(($3) => { $3(out.pushLast({ id, row })); });
    });
    $.for(drafted, ($2, row, id, label) => {
      $2.if(rows.has(id).not(), ($3) => {
        $3.if(all.has(id), ($4) => { $4.continue(label); });
        $3(out.pushLast({ id, row }));
      });
    });
    return out;
  });
  const fn = East.compile(East.function([DateTimeType, DateTimeType, Held, Held, Held], IntegerType, ($, f, t, rows, drafted, all) => {
    const inPlace = $.const(withDrafts);
    const count = $.let(0n);
    $.for(inPlace(rows, drafted, all), ($2, entry) => {
      $2.match(entry.row.start, {
        some: ($3, s) => {
          $3.match(entry.row.end, {
            some: ($4, e) => {
              $4.if(East.less(s, t).and(() => East.greater(e, f).or(() => East.greaterEqual(s, f))), ($5) => {
                $5.assign(count, count.add(1n));
              });
            },
          });
        },
      });
    });
    return count;
  }), []);
  cases.push({
    name: `the schedule seam's shape: ${window.toLocaleString("en")} rows in a window, ${drafted.toLocaleString("en")} drafts outside it skipped`,
    ms: () => time("schedule seam", IntegerType, () => fn(from, to, held, drafts, record), expected),
  });
}

// ─── Compiling ──────────────────────────────────────────────────────────────

/** A function of `branches` if/else statements in a loop, a `continue` in each when `continues`. */
function large(branches: number, continues: boolean) {
  return East.function([Ints], IntegerType, ($, xs) => {
    const sum = $.let(0n);
    $.for(xs, ($2, x, _i, label) => {
      for (let k = 0; k < branches; k++) {
        $2.if(x.equal(BigInt(k)), ($3) => {
          $3.assign(sum, sum.add(BigInt(k)));
          if (continues) $3.continue(label);
        }).else(($3) => { $3.assign(sum, sum.add(1n)); });
      }
    });
    return sum;
  });
}

for (const continues of [false, true]) {
  const ir = large(2_000, continues).toIR().ir;
  const name = `compile a function of 2,000 if/else statements in a loop, ${continues ? "a `continue` in each" : "no control flow"}`;
  cases.push({
    name, ms: () => {
      const times: number[] = [];
      for (let i = 0; i <= RUNS; i++) {
        // Analysed afresh: each compile is of nodes it has not seen.
        const analysed = analyzeIR(ir, []);
        const start = performance.now();
        compile_internal(analysed, {}, {}, new Set(), []);
        if (i > 0) times.push(performance.now() - start);
      }
      return median(times);
    },
  });
}

// ─── The table ──────────────────────────────────────────────────────────────

const cell = (ms: number): string => ms < 1 ? ms.toFixed(3) : ms < 10 ? ms.toFixed(2) : ms.toFixed(1);
const lines: string[] = [];
for (const c of cases) {
  const ms = await c.ms();
  lines.push(`| ${c.name} | ${cell(ms)} |`);
  console.error(`[+] ${c.name}`);
}

const cpu = cpus();
console.log([
  `${ROWS.toLocaleString("en")} rows; the median of ${RUNS} calls after one to warm, in milliseconds.`,
  "",
  "| Case | ms |",
  "|---|--:|",
  ...lines,
  "",
  `${cpu[0]?.model ?? "unknown CPU"} (${cpu.length} threads), ${Math.round(totalmem() / 2 ** 30)} GiB, ${platform()} ${release()}; ` +
    `node ${process.version}; ${printFor(DateTimeType)(new Date()).slice(0, 10)}.`,
].join("\n"));
