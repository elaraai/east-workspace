/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The East oracle of the type matrix (#987): what `devdocs/QUERY.md` says a
 * program gives, computed on host values with East's own host utilities
 * (`printFor`, `encodeJSONFor`, `compareFor`, `equalFor`, `SortedMap`) and
 * the date parts. It judges the cases jq cannot see (DateTime, Blob, Dicts
 * keyed by other types, functions), and the cases {@link DEVIATIONS} lists,
 * where East differs from jq as a deviation of §13 says.
 */

import {
  FloatType, NullType, SortedMap, StringType, compareFor, encodeJSONFor, equalFor, isTypeEqual, none, printFor, some,
  type EastType, type matrix, type ref, type variant,
} from "../../src/index.js";
import { nullablePayload, unify, unwrap } from "../../src/query/jq/shapes.js";
import type { Program } from "./programs.js";
import type { Pair } from "./run.js";
import type { Shape, ShapeValue } from "./shapes.js";

/** What a program gives: a value of its result type, or an error. */
export type Expected = { readonly value: unknown } | "error";

/** A program's oracle, given the shape, the value and the result type the checker gave the query. */
export type Oracle = (shape: Shape, value: unknown, resultType: EastType) => Expected;

/**
 * A deviation of §13 the matrix meets. Where it applies and jq's result
 * differs from East's, East gives the oracle's value; where jq agrees, the
 * case passes. The spec holds each deviation to differ in some case.
 */
export interface Deviation {
  readonly deviation: number;
  readonly why: string;
  readonly applies: (pair: Pair, value: ShapeValue) => boolean;
}

/**
 * A program East refuses for a type, as a section of QUERY.md says: where jq
 * runs it (a deviation of §13), or where jq cannot see the type.
 */
export interface Refusal {
  /** The section, `13.3` or `10`. */
  readonly section: string;
  readonly why: string;
  readonly applies: (pair: Pair) => boolean;
}

// ── Values as jq sees them ────────────────────────────────────────────────

/** A value read through its recursive wrapper, references and flat options: what jq sees at its place. */
export function seen(type: EastType, value: unknown): { type: EastType; value: unknown } {
  let t = type;
  let v = value;
  for (;;) {
    if (t.type === "Recursive") { t = t.node as EastType; continue; }
    if (t.type === "Ref") { v = (v as ref).value; t = t.value as EastType; continue; }
    const payload = nullablePayload(t);
    if (payload !== undefined) {
      if ((v as variant).type === "none") return { type: NullType, value: null };
      v = (v as variant).value;
      t = payload;
      continue;
    }
    return { type: t, value: v };
  }
}

/** jq's name for a value's type. */
export function typeName(type: EastType, value: unknown): string {
  const s = seen(type, value);
  switch (s.type.type) {
    case "Null": return "null";
    case "Boolean": return "boolean";
    case "Integer": case "Float": return "number";
    case "String": return "string";
    case "Array": case "Set": case "Vector": case "Matrix": return "array";
    case "DateTime": return "datetime";
    case "Blob": return "blob";
    case "Function": case "AsyncFunction": return "function";
    default: return "object";
  }
}

/** Whether jq takes a value as true: anything but `false` and `null`. */
export function truthy(type: EastType, value: unknown): boolean {
  const s = seen(type, value);
  return !(s.type.type === "Null" || (s.type.type === "Boolean" && s.value === false));
}

/** `tostring`: a string as it is, `null` as `null`, anything else as its East text (§13.9). */
export function tostringOf(type: EastType, value: unknown): string {
  const s = seen(type, value);
  if (s.type.type === "String") return s.value as string;
  if (s.type.type === "Null") return "null";
  return printFor(s.type)(s.value as never);
}

/** `tojson`: East's JSON (§13.9). */
export function tojsonOf(type: EastType, value: unknown): string {
  const s = seen(type, value);
  return new TextDecoder().decode(encodeJSONFor(s.type)(s.value as never));
}

/** A sequence's elements, and their type. */
export function elementsOf(type: EastType, value: unknown): { type: EastType; items: unknown[] } | undefined {
  const s = seen(type, value);
  const t = s.type;
  if (t.type === "Array") return { type: t.value as EastType, items: [...(s.value as unknown[])] };
  if (t.type === "Set") return { type: t.key as EastType, items: [...(s.value as Set<unknown>)] };
  if (t.type === "Vector") {
    const e = t.element as EastType;
    return { type: e, items: Array.from(s.value as ArrayLike<unknown>).map(x => (e.type === "Boolean" ? x !== 0 : x)) };
  }
  if (t.type === "Matrix") {
    const m = s.value as matrix;
    const e = t.element as EastType;
    const cells = Array.from(m.data as ArrayLike<unknown>).map(x => (e.type === "Boolean" ? x !== 0 : x));
    const rows: unknown[] = [];
    for (let r = 0; r < m.rows; r++) rows.push(cells.slice(r * m.cols, (r + 1) * m.cols));
    return { type: e, items: rows };
  }
  return undefined;
}

/** `..`'s walk: a value, then the values jq finds inside it, in pre-order. */
export function descend(type: EastType, value: unknown): { type: EastType; value: unknown }[] {
  const out: { type: EastType; value: unknown }[] = [];
  const visit = (t0: EastType, v0: unknown): void => {
    const s = seen(t0, v0);
    out.push(s);
    const t = s.type;
    const v = s.value;
    if (t.type === "Array") for (const x of v as unknown[]) visit(t.value as EastType, x);
    else if (t.type === "Set") for (const x of v as Set<unknown>) visit(t.key as EastType, x);
    else if (t.type === "Vector" || t.type === "Matrix") {
      const e = elementsOf(t, v)!;
      for (const x of e.items) visit(t.type === "Matrix" ? { type: "Array", value: t.element } as EastType : e.type, x);
    } else if (t.type === "Dict") for (const x of (v as Map<unknown, unknown>).values()) visit(t.value as EastType, x);
    else if (t.type === "Struct") for (const [name, f] of Object.entries(t.fields as Record<string, EastType>)) visit(f, (v as Record<string, unknown>)[name]);
    else if (t.type === "Variant") {
      const x = v as variant;
      visit(StringType, x.type);
      visit((t.cases as Record<string, EastType>)[x.type]!, x.value);
    }
  };
  visit(type, value);
  return out;
}

/** A value, or none, as a query that can miss gives it: an option of it, or itself where its type can be null already. */
function maybe(resultType: EastType, found: boolean, value: unknown): unknown {
  const payload = nullablePayload(resultType);
  if (payload === undefined) return found ? value : none;
  if (!found) return none;
  // The value's own type already holds null: the lookup gives it as it is.
  return isTypeEqual(payload, resultType) ? value : some(value);
}

/**
 * A value as a wider type the checker gave its place: `some` of it where the
 * wider type is an option of its own, an Integer as a Float, and arrays and
 * dicts element by element.
 */
function widened(from: EastType, to: EastType, value: unknown): unknown {
  if (isTypeEqual(from, to)) return value;
  const payload = nullablePayload(to);
  if (payload !== undefined && nullablePayload(from) === undefined && from.type !== "Null") return some(widened(from, payload, value));
  const f = unwrap(from);
  const t = unwrap(to);
  if (f.type === "Integer" && t.type === "Float") return Number(value as bigint);
  if (f.type === "Array" && t.type === "Array") return (value as unknown[]).map(x => widened(f.value as EastType, t.value as EastType, x));
  if (f.type === "Dict" && t.type === "Dict") {
    const out = new SortedMap<unknown, unknown>([], compareFor(t.key as EastType) as (a: unknown, b: unknown) => number);
    for (const [k, x] of value as Map<unknown, unknown>) out.set(k, widened(f.value as EastType, t.value as EastType, x));
    return out;
  }
  return value;
}

const ok = (value: unknown): Expected => ({ value });

/** Integers past ±2⁵³, with East's 64-bit wrapping arithmetic (§13.3). */
const wrap = (n: bigint): bigint => BigInt.asIntN(64, n);
const compareFloat = compareFor(FloatType);
const equalFloat = equalFor(FloatType);

/** `length` as §10 gives it: a string's code points, a collection's size, a number's absolute value, null's 0. */
function lengthOf(type: EastType, value: unknown): Expected {
  const s = seen(type, value);
  const t = s.type;
  switch (t.type) {
    case "Null": return ok(0n);
    case "Integer": { const n = s.value as bigint; return ok(wrap(n < 0n ? -n : n)); }
    case "Float": return ok(Math.abs(s.value as number));
    case "String": return ok(BigInt([...(s.value as string)].length));
    case "Blob": return ok(BigInt((s.value as Uint8Array).length));
    case "Struct": return ok(BigInt(Object.keys(t.fields as Record<string, EastType>).length));
    case "Dict": return ok(BigInt((s.value as Map<unknown, unknown>).size));
    // A variant is jq's {type, value}.
    case "Variant": return ok(2n);
    default: {
      const e = elementsOf(t, s.value);
      return e === undefined ? "error" : ok(BigInt(e.items.length));
    }
  }
}

// ── The oracles, by family and program ────────────────────────────────────

const every: Record<string, Oracle> = {
  "identity": (s, v) => ok(v),
  "type": (s, v) => ok(typeName(s.type, v)),
  "tostring": (s, v) => ok(tostringOf(s.type, v)),
  "at-text": (s, v) => ok(tostringOf(s.type, v)),
  "tojson": (s, v) => ok(tojsonOf(s.type, v)),
  "at-json": (s, v) => ok(tojsonOf(s.type, v)),
  "wrap-array": (s, v) => ok([v]),
  "wrap-object": (s, v) => ok({ v }),
  "equal-self": () => ok(true),
  "not-equal-self": () => ok(false),
  "truthy": (s, v) => ok(truthy(s.type, v) ? "t" : "f"),
  "not": (s, v) => ok(!truthy(s.type, v)),
  "interpolate": (s, v) => ok(`<${tostringOf(s.type, v)}>`),
  "descend-types": (s, v) => ok(descend(s.type, v).map(x => typeName(x.type, x.value))),
  "walk-identity": (s, v) => ok(v),
  // `error(v)` raises v's tostring text (§13.14), which `catch .` gives.
  "error-catch": (s, v) => ok(some(tostringOf(s.type, v))),
  "sort-pair": (s, v) => ok([v, v]),
  "unique-pair": (s, v) => ok([v]),
  "length": (s, v) => lengthOf(s.type, v),
};

/** The parts of a DateTime, as East's DateTime builtins give them. */
const datetime: Record<string, Oracle> = {
  "year": (s, v) => ok(BigInt((v as Date).getUTCFullYear())),
  "month": (s, v) => ok(BigInt((v as Date).getUTCMonth() + 1)),
  "day": (s, v) => ok(BigInt((v as Date).getUTCDate())),
  "hour": (s, v) => ok(BigInt((v as Date).getUTCHours())),
  "minute": (s, v) => ok(BigInt((v as Date).getUTCMinutes())),
  "second": (s, v) => ok(BigInt((v as Date).getUTCSeconds())),
  "millisecond": (s, v) => ok(BigInt((v as Date).getUTCMilliseconds())),
  "weekday": (s, v) => ok(BigInt(((v as Date).getUTCDay() + 6) % 7 + 1)),
  "epoch_ms": (s, v) => ok(BigInt((v as Date).getTime())),
  "todate": (s, v) => ok(tojsonOf(s.type, v).slice(1, -1)),
  "strftime": (s, v) => ok((v as Date).toISOString().slice(0, 19)),
  "after-2000": (s, v) => ok((v as Date).getTime() >= Date.UTC(2000, 0, 1)),
  "before-epoch": (s, v) => ok((v as Date).getTime() < 0),
  "add-millisecond": (s, v) => ok(new Date((v as Date).getTime() + 1)),
  "add-second": (s, v) => ok(new Date((v as Date).getTime() + 1000)),
  "add-minute": (s, v) => ok(new Date((v as Date).getTime() + 60_000)),
  "add-hour": (s, v) => ok(new Date((v as Date).getTime() + 3_600_000)),
  "add-day": (s, v) => ok(new Date((v as Date).getTime() + 86_400_000)),
  "add-week": (s, v) => ok(new Date((v as Date).getTime() + 604_800_000)),
  "diff-days": (s, v) => ok(BigInt(Math.trunc((v as Date).getTime() / 86_400_000))),
  "diff-milliseconds": (s, v) => ok(BigInt((v as Date).getTime())),
};

/** A Blob's bytes, as the Blob builtins read them. */
const blob: Record<string, Oracle> = {
  "length": (s, v) => ok(BigInt((v as Uint8Array).length)),
  "at-base64": (s, v) => ok(Buffer.from(v as Uint8Array).toString("base64")),
};

/** A number, read through its reference: an Integer (a bigint) or a Float. */
function numberOf(s: Shape, v: unknown): { float: true; value: number } | { float: false; value: bigint } {
  const x = seen(s.type, v);
  return x.type.type === "Float" ? { float: true, value: x.value as number } : { float: false, value: x.value as bigint };
}

/**
 * A Float rounded to an Integer as `East.Float.roundFloor`, `roundCeil` and
 * `roundHalf` round it (half away from zero): an error for NaN, ±Infinity or
 * a value past 64 bits (§13.31).
 */
function rounded(x: number, how: (y: number) => number): Expected {
  if (Number.isNaN(x) || !Number.isFinite(x)) return "error";
  const r = how(x);
  if (r >= 2 ** 63 || r < -(2 ** 63)) return "error";
  return ok(BigInt(r));
}

/** jq's `%` on a Float (§6): NaN for NaN, else the remainder of both truncated to 64 bits, as a Float. */
function floatRemainder(x: number, y: bigint): number {
  if (Number.isNaN(x)) return NaN;
  const whole = x < -(2 ** 63) ? -(2n ** 63n) : x >= 2 ** 63 ? 2n ** 63n - 1n : BigInt(Math.trunc(x));
  return Number(whole % y);
}

/** Numbers: Integers with East's 64-bit wrapping arithmetic (§13.3), Floats in East's order (§13.10). */
const number: Record<string, Oracle> = {
  "add-one": (s, v) => { const n = numberOf(s, v); return ok(n.float ? n.value + 1 : wrap(n.value + 1n)); },
  "subtract-one": (s, v) => { const n = numberOf(s, v); return ok(n.float ? n.value - 1 : wrap(n.value - 1n)); },
  "double": (s, v) => { const n = numberOf(s, v); return ok(n.float ? n.value * 2 : wrap(n.value * 2n)); },
  "negate": (s, v) => { const n = numberOf(s, v); return ok(n.float ? -n.value : wrap(-n.value)); },
  "modulo": (s, v) => { const n = numberOf(s, v); return ok(n.float ? floatRemainder(n.value, 3n) : n.value % 3n); },
  "add-half": (s, v) => ok(Number(numberOf(s, v).value) + 0.5),
  "halve": (s, v) => ok(Number(numberOf(s, v).value) / 2),
  "times-float": (s, v) => ok(Number(numberOf(s, v).value) * 1.5),
  "fabs": (s, v) => ok(Math.abs(Number(numberOf(s, v).value))),
  "sqrt": (s, v) => ok(Math.sqrt(Number(numberOf(s, v).value))),
  "log": (s, v) => ok(Math.log(Number(numberOf(s, v).value))),
  "square": (s, v) => ok(Number(numberOf(s, v).value) ** 2),
  "isnan": (s, v) => { const n = numberOf(s, v); return ok(n.float && Number.isNaN(n.value)); },
  "isinfinite": (s, v) => { const n = numberOf(s, v); return ok(n.float && !Number.isNaN(n.value) && !Number.isFinite(n.value)); },
  "isnormal": (s, v) => {
    const x = Number(numberOf(s, v).value);
    return ok(Number.isFinite(x) && Math.abs(x) >= 2 ** -1022);
  },
  "floor": (s, v) => { const n = numberOf(s, v); return n.float ? rounded(n.value, Math.floor) : ok(n.value); },
  "ceil": (s, v) => { const n = numberOf(s, v); return n.float ? rounded(n.value, Math.ceil) : ok(n.value); },
  "round": (s, v) => { const n = numberOf(s, v); return n.float ? rounded(n.value, y => Math.sign(y) * Math.round(Math.abs(y))) : ok(n.value); },
  "less-zero": (s, v) => { const n = numberOf(s, v); return ok(n.float ? compareFloat(n.value, 0) < 0 : n.value < 0n); },
  "greater-zero": (s, v) => { const n = numberOf(s, v); return ok(n.float ? compareFloat(n.value, 0) > 0 : n.value > 0n); },
  "less-half": (s, v) => { const n = numberOf(s, v); return ok(compareFloat(Number(n.value), 0.5) < 0); },
  "equal-zero": (s, v) => { const n = numberOf(s, v); return ok(n.float ? equalFloat(n.value, 0) : n.value === 0n); },
  "length": (s, v) => lengthOf(s.type, v),
  "min-with-zero": (s, v, r) => {
    const n = numberOf(s, v);
    const least = n.float ? (compareFloat(n.value, 0) < 0 ? n.value : 0) : (n.value < 0n ? n.value : 0n);
    return ok(maybe(r, true, least));
  },
};

/** Strings: East's string builtins (§13.18). */
const string: Record<string, Oracle> = {
  "ascii_upcase": (s, v) => ok((v as string).toUpperCase()),
  "ascii_downcase": (s, v) => ok((v as string).toLowerCase()),
};

/** Sequences of any element type: their elements in order, and East's total order. */
function items(s: Shape, v: unknown): { type: EastType; items: unknown[] } {
  return elementsOf(s.type, v)!;
}
function sorted(e: { type: EastType; items: unknown[] }): unknown[] {
  return [...e.items].sort(compareFor(e.type));
}
function distinct(e: { type: EastType; items: unknown[] }): unknown[] {
  const eq = equalFor(e.type);
  return sorted(e).filter((x, i, xs) => i === 0 || !eq(xs[i - 1] as never, x as never));
}
/** The positions of a sequence's elements equal to the shape's element probe. */
function positionsOf(s: Shape, v: unknown): bigint[] {
  const e = items(s, v);
  const eq = equalFor(e.type);
  return e.items.flatMap((x, i) => (eq(x as never, s.probes.elementValue as never) ? [BigInt(i)] : []));
}
/** `add` of a sequence's elements, East's way: a type with an identity starts from it (§13.15). */
function sum(e: { type: EastType; items: unknown[] }): unknown {
  const t = unwrap(e.type);
  if (t.type === "Integer") return e.items.reduce((a: bigint, x) => wrap(a + (x as bigint)), 0n);
  if (t.type === "Float") return e.items.reduce((a: number, x) => a + (x as number), 0);
  if (t.type === "String") return e.items.join("");
  if (t.type === "Array") return e.items.flatMap(x => x as unknown[]);
  throw new Error(`the oracle adds no ${t.type}`);
}
const sequence: Record<string, Oracle> = {
  "iterate": (s, v) => ok(items(s, v).items),
  "index-first": (s, v, r) => { const e = items(s, v).items; return ok(maybe(r, e.length > 0, e[0])); },
  "index-last": (s, v, r) => { const e = items(s, v).items; return ok(maybe(r, e.length > 0, e[e.length - 1])); },
  "index-past-end": (s, v, r) => ok(maybe(r, false, undefined)),
  "slice-from": (s, v) => ok(items(s, v).items.slice(1)),
  "slice-to": (s, v) => ok(items(s, v).items.slice(0, -1)),
  "first": (s, v, r) => { const e = items(s, v).items; return ok(maybe(r, e.length > 0, e[0])); },
  "last": (s, v, r) => { const e = items(s, v).items; return ok(maybe(r, e.length > 0, e[e.length - 1])); },
  "nth": (s, v, r) => { const e = items(s, v).items; return ok(maybe(r, e.length > 1, e[1])); },
  "length": (s, v) => ok(BigInt(items(s, v).items.length)),
  "map-identity": (s, v) => ok(items(s, v).items),
  "map-tostring": (s, v) => { const e = items(s, v); return ok(e.items.map(x => tostringOf(e.type, x))); },
  "select-truthy": (s, v) => { const e = items(s, v); return ok(e.items.filter(x => truthy(e.type, x))); },
  "sort": (s, v) => ok(sorted(items(s, v))),
  "sort_by": (s, v) => ok(sorted(items(s, v))),
  "group_by": (s, v) => {
    const e = items(s, v);
    const eq = equalFor(e.type);
    const groups: unknown[][] = [];
    for (const x of sorted(e)) {
      const last = groups[groups.length - 1];
      if (last !== undefined && eq(last[0] as never, x as never)) last.push(x);
      else groups.push([x]);
    }
    return ok(groups);
  },
  "unique": (s, v) => ok(distinct(items(s, v))),
  "unique_by": (s, v) => ok(distinct(items(s, v))),
  "min": (s, v, r) => { const x = sorted(items(s, v)); return ok(maybe(r, x.length > 0, x[0])); },
  "max": (s, v, r) => { const x = sorted(items(s, v)); return ok(maybe(r, x.length > 0, x[x.length - 1])); },
  "min_by": (s, v, r) => { const x = sorted(items(s, v)); return ok(maybe(r, x.length > 0, x[0])); },
  "max_by": (s, v, r) => { const x = sorted(items(s, v)); return ok(maybe(r, x.length > 0, x[x.length - 1])); },
  "reverse": (s, v) => ok([...items(s, v).items].reverse()),
  "any": (s, v) => { const e = items(s, v); return ok(e.items.some(x => truthy(e.type, x))); },
  "all": (s, v) => { const e = items(s, v); return ok(e.items.every(x => truthy(e.type, x))); },
  "add": (s, v) => ok(sum(items(s, v))),
  "limit": (s, v) => ok(items(s, v).items.slice(0, 2)),
  "first-of": (s, v, r) => { const e = items(s, v).items; return ok(maybe(r, e.length > 0, e[0])); },
  "isempty": (s, v) => ok(items(s, v).items.length === 0),
  "count-reduce": (s, v) => ok(BigInt(items(s, v).items.length)),
  "count-foreach": (s, v) => ok(items(s, v).items.map((_, i) => BigInt(i + 1))),
  "to_entries": (s, v) => ok(items(s, v).items.map((x, i) => ({ key: BigInt(i), value: x }))),
  "keys": (s, v) => ok(items(s, v).items.map((_, i) => BigInt(i))),
  "has-zero": (s, v) => ok(items(s, v).items.length > 0),
  "until-short": (s, v) => { const e = items(s, v).items; return ok(e.length < 2 ? e : e.slice(e.length - 1)); },
  "index-of": (s, v, r) => { const at = positionsOf(s, v); return ok(maybe(r, at.length > 0, at[0])); },
  "index-run": (s, v, r) => { const at = positionsOf(s, v); return ok(maybe(r, at.length > 0, at[0])); },
  "rindex-of": (s, v, r) => { const at = positionsOf(s, v); return ok(maybe(r, at.length > 0, at[at.length - 1])); },
  "indices-of": (s, v) => ok(positionsOf(s, v)),
  "indices-run": (s, v) => ok(positionsOf(s, v)),
  "contains-element": (s, v) => ok(positionsOf(s, v).length > 0),
  "inside-probe": (s, v) => ok(positionsOf(s, v).length > 0),
  // The first of equal elements (§13.32), or −1 − where it would go.
  "bsearch": (s, v) => {
    const e = items(s, v);
    const cmp = compareFor(e.type);
    const xs = sorted(e);
    const at = xs.findIndex(x => cmp(x as never, s.probes.elementValue as never) >= 0);
    const i = at < 0 ? xs.length : at;
    return ok(i < xs.length && cmp(xs[i] as never, s.probes.elementValue as never) === 0 ? BigInt(i) : BigInt(-1 - i));
  },
};

/** Arrays of arrays. */
const nested: Record<string, Oracle> = {
  "map-add": (s, v) => { const e = items(s, v); return ok(e.items.map(row => sum({ type: (unwrap(e.type) as { value: EastType }).value, items: row as unknown[] }))); },
};

/** Array updates: the array as the update leaves it, of the type the checker gave it. */
const update: Record<string, Oracle> = {
  "update-each": (s, v, r) => ok(widened(s.type, r, v)),
  "delete-first": (s, v) => ok((v as unknown[]).slice(1)),
  "delete-all": () => ok([]),
  "update-slice": (s, v, r) => ok(widened(s.type, r, v)),
  "set-first": (s, v, r) => ok(widened(s.type, r, v)),
};

/** Dicts of any key type: their entries in key order. */
function entries(s: Shape, v: unknown): [unknown, unknown][] {
  return [...(seen(s.type, v).value as Map<unknown, unknown>)];
}
function without(s: Shape, v: unknown, key: unknown): Map<unknown, unknown> {
  const t = seen(s.type, v).type as EastType & { key: EastType };
  const eq = equalFor(t.key);
  const out = new SortedMap<unknown, unknown>([], compareFor(t.key) as (a: unknown, b: unknown) => number);
  for (const [k, x] of entries(s, v)) if (!eq(k as never, key as never)) out.set(k, x);
  return out;
}
function lookup(s: Shape, v: unknown, key: unknown): { found: boolean; value: unknown } {
  const t = seen(s.type, v).type;
  const eq = equalFor((t as { key: EastType }).key);
  const hit = entries(s, v).find(([k]) => eq(k as never, key as never));
  return { found: hit !== undefined, value: hit?.[1] };
}
const dict: Record<string, Oracle> = {
  "values": (s, v) => ok(entries(s, v).map(([, x]) => x)),
  "lookup": (s, v, r) => { const l = lookup(s, v, s.probes.keyValue); return ok(maybe(r, l.found, l.value)); },
  "lookup-missing": (s, v, r) => ok(maybe(r, false, undefined)),
  "keys": (s, v) => ok(entries(s, v).map(([k]) => k)),
  "keys_unsorted": (s, v) => ok(entries(s, v).map(([k]) => k)),
  "has": (s, v) => ok(lookup(s, v, s.probes.keyValue).found),
  "has-missing": (s, v) => ok(lookup(s, v, s.probes.missingValue).found),
  "in": (s, v) => ok(lookup(s, v, s.probes.keyValue).found),
  "length": (s, v) => ok(BigInt(entries(s, v).length)),
  "to_entries": (s, v) => ok(entries(s, v).map(([key, value]) => ({ key, value }))),
  "from_entries": (s, v) => ok(v),
  "with_entries": (s, v) => ok(v),
  "map_values": (s, v) => ok(v),
  "merge": (s, v) => ok(v),
  "deep-merge": (s, v) => ok(v),
  "delete-key": (s, v) => ok(without(s, v, s.probes.keyValue)),
  // The key's value set to itself: a missing key would be null, so the values' type holds null.
  "update-key": (s, v, r) => ok(widened(s.type, r, v)),
  "set-key": (s, v, r) => ok(widened(s.type, r, v)),
  "alternative-key": (s, v, r) => ok(widened(s.type, r, v)),
  "group-values": (s, v) => {
    const t = seen(s.type, v).type;
    return ok(BigInt(distinct({ type: (t as { value: EastType }).value, items: entries(s, v).map(([, x]) => x) }).length));
  },
};

/** Structs: their fields in declared order. */
function fieldsOf(s: Shape, v: unknown): [string, EastType, unknown][] {
  const t = seen(s.type, v).type;
  const r = seen(s.type, v).value as Record<string, unknown>;
  return Object.entries((t as { fields: Record<string, EastType> }).fields).map(([name, f]) => [name, f, r[name]]);
}
const struct: Record<string, Oracle> = {
  "field": (s, v) => ok((seen(s.type, v).value as Record<string, unknown>)[s.probes.field!]),
  "field-optional": (s, v) => ok((seen(s.type, v).value as Record<string, unknown>)[s.probes.field!]),
  "missing-optional": () => ok(null),
  "keys": (s, v) => ok(fieldsOf(s, v).map(([name]) => name).sort(compareFor(StringType))),
  "keys_unsorted": (s, v) => ok(fieldsOf(s, v).map(([name]) => name)),
  "has": () => ok(true),
  "has-missing": () => ok(false),
  "length": (s, v) => ok(BigInt(fieldsOf(s, v).length)),
  "add-field": (s, v) => ok({ ...(seen(s.type, v).value as object), extra: 1n }),
  "deep-merge": (s, v) => ok({ ...(seen(s.type, v).value as object), extra: 1n }),
  "delete-field": (s, v) => ok(Object.fromEntries(fieldsOf(s, v).filter(([name]) => name !== s.probes.field).map(([name, , x]) => [name, x]))),
  "update-field": (s, v) => ok(v),
  "new-field": (s, v) => ok({ ...(seen(s.type, v).value as object), extra: 1n }),
  "pick": (s, v) => ok({ [s.probes.field!]: (seen(s.type, v).value as Record<string, unknown>)[s.probes.field!] }),
  "construct": (s, v) => ok({ [s.probes.field!]: (seen(s.type, v).value as Record<string, unknown>)[s.probes.field!] }),
  "destructure": (s, v) => ok((seen(s.type, v).value as Record<string, unknown>)[s.probes.field!]),
  "field-types": (s, v) => ok(Object.fromEntries(fieldsOf(s, v).map(([name, f, x]) => [name, typeName(f, x)]))),
};

/** Functions: called on the shape's argument. */
const fn: Record<string, Oracle> = {
  "call": (s, v) => ok((v as (x: unknown) => unknown)(s.probes.argumentValue)),
};

/** Composites of East-only parts. */
const composite: Record<string, Oracle> = {
  "field-kinds": (s, v) => ok(fieldsOf(s, v).map(([, f, x]) => typeName(f, x))),
  "cell-lengths": (s, v) => ok(entries(s, v).map(([, x]) => BigInt((x as unknown[]).length))),
  "cell-keys": (s, v) => ok(entries(s, v).map(([k]) => (k as { region: string }).region)),
};

const FAMILIES: Record<string, Record<string, Oracle>> = { every, datetime, blob, number, string, sequence, nested, update, dict, struct, function: fn, composite };

/**
 * The section of `devdocs/QUERY.md` each family's oracles follow: a case jq
 * cannot judge is East's as that section says.
 */
export const ORACLE_SECTIONS: Readonly<Record<string, string>> = {
  every: "2", datetime: "7", blob: "2", number: "6", string: "10", sequence: "4", nested: "10", update: "15.5",
  dict: "4", struct: "5", function: "9", composite: "2",
};

/**
 * The East oracle of a program, where QUERY.md gives one for the matrix.
 *
 * @param program - the program
 * @returns its oracle, or `undefined`
 */
export function oracleFor(program: Program): Oracle | undefined {
  return FAMILIES[program.family]?.[program.name];
}

// ── Where East differs from jq, and refuses ───────────────────────────────

/** Whether values of a type hold a Float somewhere, whose order and equality are East's (§13.10). */
function holdsFloat(type: EastType): boolean {
  const seenTypes = new Set<EastType>();
  const visit = (t: EastType): boolean => {
    if (seenTypes.has(t)) return false;
    seenTypes.add(t);
    switch (t.type) {
      case "Float": return true;
      case "Array": case "Ref": return visit(t.value as EastType);
      case "Set": return visit(t.key as EastType);
      case "Vector": case "Matrix": return visit(t.element as EastType);
      case "Dict": return visit(t.key as EastType) || visit(t.value as EastType);
      case "Struct": return Object.values(t.fields as Record<string, EastType>).some(visit);
      case "Variant": return Object.values(t.cases as Record<string, EastType>).some(visit);
      case "Recursive": return visit(t.node as EastType);
      default: return false;
    }
  };
  return visit(type);
}

/** The programs whose result follows East's order or equality of their values. */
const ORDERED: Readonly<Record<string, readonly string[]>> = {
  every: ["equal-self", "not-equal-self", "sort-pair", "unique-pair"],
  number: ["negate", "less-zero", "greater-zero", "less-half", "equal-zero", "min-with-zero"],
  sequence: ["sort", "sort_by", "group_by", "unique", "unique_by", "min", "max", "min_by", "max_by", "bsearch"],
};
const is = (p: Pair, family: string, ...names: string[]): boolean => p.program.family === family && names.includes(p.program.name);

/** The cases whose East result differs from jq's as a deviation of §13 says; the first that applies is the one. */
export const DEVIATIONS: readonly Deviation[] = [
  { deviation: 9, why: "tostring and string interpolation write East text, and tojson East's JSON", applies: p => is(p, "every", "tostring", "at-text", "interpolate", "tojson", "at-json") || is(p, "sequence", "map-tostring") },
  { deviation: 14, why: "error(v)'s message is v's East text", applies: p => is(p, "every", "error-catch") },
  { deviation: 3, why: "Integers are exact to 64 bits, and wrap past them", applies: p => (p.program.family === "number" || is(p, "every", "length")) && unwrap(p.shape.type).type === "Integer" },
  { deviation: 31, why: "floor, ceil and round give an Integer, and raise for NaN, ±Infinity and a Float past 64 bits", applies: p => is(p, "number", "floor", "ceil", "round") },
  { deviation: 10, why: "NaN is the greatest number and equals itself, and −0.0 sorts below 0.0", applies: p => holdsFloat(p.shape.type) && (ORDERED[p.program.family]?.includes(p.program.name) ?? false) },
  { deviation: 32, why: "bsearch finds the first of equal elements", applies: p => is(p, "sequence", "bsearch") },
  { deviation: 15, why: "add of no values gives their type's identity", applies: p => is(p, "sequence", "add") || is(p, "nested", "map-add") },
  { deviation: 18, why: "ascii_upcase and ascii_downcase change every letter's case", applies: p => is(p, "string", "ascii_upcase", "ascii_downcase") },
];

/** Whether a variant's payloads have no one type: `.value` is ambiguous (§13.5). */
function payloadsDiffer(type: EastType): boolean {
  const t = unwrap(type);
  if (t.type !== "Variant") return false;
  let common: EastType | undefined = { type: "Never" } as EastType;
  for (const c of Object.values(t.cases as Record<string, EastType>)) common = common === undefined ? undefined : unify(common, c);
  return common === undefined;
}

/** The pairs East refuses though jq runs them, or jq cannot judge them, each as QUERY.md says. */
export const REFUSALS: readonly Refusal[] = [
  { section: "13.5", why: "a variant whose payloads have no common type has no one output type for .value", applies: p => is(p, "variant", "payload") && payloadsDiffer(p.shape.type) },
  { section: "13.27", why: "an array argument is a run of elements, whose type is not the elements'", applies: p => is(p, "sequence", "index-of", "indices-of") && p.shape.probes.element?.startsWith("[") === true },
  { section: "10", why: "length takes no DateTime and no function", applies: p => is(p, "every", "length") && ["DateTime", "Function"].includes(unwrap(p.shape.type).type) },
  {
    section: "7",
    why: "an ISO-8601 string is a DateTime where it is compared with one, used as a key or passed as an argument; as a filter's input it is a String",
    applies: p => (is(p, "sequence", "inside-probe") || is(p, "dict", "in")) && holdsDateTimeKeys(p.shape.type),
  },
];

/** Whether a sequence's elements or a dict's keys are DateTimes. */
function holdsDateTimeKeys(type: EastType): boolean {
  const t = unwrap(type);
  const key = t.type === "Array" ? t.value : t.type === "Set" ? t.key : t.type === "Dict" ? t.key : undefined;
  return (key as EastType | undefined)?.type === "DateTime";
}
