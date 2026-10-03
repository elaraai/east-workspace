/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * jq's JSON as East values, for the conformance harness (#924): a reader that
 * keeps each number's text, so an Integer stays exact to 64 bits; the rules
 * that type an input as an East value; and the reading of an expected output
 * as a value of the type a query gives (`devdocs/QUERY.md` §16).
 */

import {
  ArrayType, BooleanType, FloatType, IntegerType, NeverType, NullType, SortedMap, StringType, StructType,
  compareFor, none, some, type EastType,
} from "../../src/index.js";
import { describeType, nullablePayload, unify, unwrap } from "../../src/query/jq/shapes.js";

/** A JSON value as jq reads it: a number keeps its text, and `nan` and `Infinity` are numbers. */
export type Json =
  | { readonly kind: "null" }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "number"; readonly text: string }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "array"; readonly items: readonly Json[] }
  | { readonly kind: "object"; readonly entries: readonly (readonly [string, Json])[] };

/** The words jq's reader takes besides JSON's, longest first so a sign is read with its word. */
const WORDS: readonly (readonly [string, Json])[] = [
  ["-Infinity", { kind: "number", text: "-Infinity" }], ["Infinity", { kind: "number", text: "Infinity" }],
  ["-NaN", { kind: "number", text: "NaN" }], ["NaN", { kind: "number", text: "NaN" }],
  ["-nan", { kind: "number", text: "NaN" }], ["nan", { kind: "number", text: "NaN" }],
  ["null", { kind: "null" }], ["true", { kind: "boolean", value: true }], ["false", { kind: "boolean", value: false }],
];

/** A JSON number. */
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

/**
 * Reads one JSON value as jq's reader does: a byte order mark before it is
 * skipped, and `nan`, `NaN`, `Infinity` and their negations are numbers.
 *
 * @param text - the text
 * @returns the value
 * @throws {SyntaxError} When the text is not one JSON value.
 */
export function readJson(text: string): Json {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const space = (): void => { while (i < text.length && " \t\n\r".includes(text[i]!)) i++; };
  const fail = (what: string): never => { throw new SyntaxError(`expected ${what} at ${i}: ${text}`); };
  const expect = (c: string): void => { if (text[i] !== c) fail(JSON.stringify(c)); i++; };
  const string = (): string => {
    const start = i;
    i++;
    while (i < text.length && text[i] !== "\"") i += text[i] === "\\" ? 2 : 1;
    if (i >= text.length) fail("the end of a string");
    i++;
    try {
      return JSON.parse(text.slice(start, i)) as string;
    } catch {
      return fail("a JSON string");
    }
  };
  const value = (): Json => {
    space();
    const c = text[i];
    if (c === "{") {
      i++;
      const entries: [string, Json][] = [];
      space();
      if (text[i] === "}") { i++; return { kind: "object", entries }; }
      for (;;) {
        space();
        if (text[i] !== "\"") fail("a key");
        const key = string();
        space();
        expect(":");
        entries.push([key, value()]);
        space();
        if (text[i] === "}") { i++; return { kind: "object", entries }; }
        expect(",");
      }
    }
    if (c === "[") {
      i++;
      const items: Json[] = [];
      space();
      if (text[i] === "]") { i++; return { kind: "array", items }; }
      for (;;) {
        items.push(value());
        space();
        if (text[i] === "]") { i++; return { kind: "array", items }; }
        expect(",");
      }
    }
    if (c === "\"") return { kind: "string", value: string() };
    for (const [word, json] of WORDS) if (text.startsWith(word, i)) { i += word.length; return json; }
    const number = NUMBER.exec(text.slice(i));
    if (number === null) return fail("a value");
    i += number[0].length;
    return { kind: "number", text: number[0] };
  };
  const out = value();
  space();
  if (i !== text.length) fail("the end");
  return out;
}

/** Whether a number's text is an Integer to East: no `.` or exponent, within 64 bits. */
function isInteger(text: string): boolean {
  if (!/^-?\d+$/.test(text)) return false;
  const n = BigInt(text);
  return n >= -(2n ** 63n) && n < 2n ** 63n;
}

/** A number's value as a Float: jq's words for NaN and the infinities too. */
function floatOf(text: string): number {
  if (text === "NaN") return NaN;
  if (text === "Infinity") return Infinity;
  if (text === "-Infinity") return -Infinity;
  return Number(text);
}

/**
 * The East type of an input, by §16's rules: a number without `.` or an
 * exponent that fits in 64 bits is an Integer and any other a Float; an object
 * is a Struct of its keys in order; an array is an array of the one type its
 * elements unify to, as the checker unifies outputs; `[]` is `Array<Never>`.
 *
 * @param json - the input
 * @returns its type, or why it has none
 */
export function typeOf(json: Json): { type: EastType } | { untypeable: string } {
  switch (json.kind) {
    case "null": return { type: NullType };
    case "boolean": return { type: BooleanType };
    case "string": return { type: StringType };
    case "number": return { type: isInteger(json.text) ? IntegerType : FloatType };
    case "array": {
      let element: EastType = NeverType;
      for (const item of json.items) {
        const t = typeOf(item);
        if ("untypeable" in t) return t;
        const next = unify(element, t.type);
        if (next === undefined) return { untypeable: `an array holds ${describeType(element)} and ${describeType(t.type)}` };
        element = next;
      }
      return { type: ArrayType(element) };
    }
    case "object": {
      const fields: Record<string, EastType> = {};
      for (const [key, item] of json.entries) {
        const t = typeOf(item);
        if ("untypeable" in t) return t;
        fields[key] = t.type;
      }
      return { type: StructType(fields) };
    }
  }
}

/**
 * An input as a value of the type {@link typeOf} gives it, or of a type its
 * elements were unified to.
 *
 * @param json - the input
 * @param type - its type
 * @returns the value
 * @throws {TypeError} When the input is not of the type.
 */
export function valueOf(json: Json, type: EastType): unknown {
  const out = read(json, type, false);
  if (out === NOT) throw new TypeError(`${JSON.stringify(json)} is not a ${describeType(type)}`);
  return out;
}

/**
 * An expected output as a value of the type the query gives, as jq prints
 * one: a Float may be written without `.0`, NaN is `null`, and ±Infinity is
 * ±1.7976931348623157e+308.
 *
 * @param json - the expected output
 * @param type - the query's element type
 * @returns the value, or `undefined` when no value of the type is written so
 */
export function expectedAs(json: Json, type: EastType): { value: unknown } | undefined {
  const out = read(json, type, true);
  return out === NOT ? undefined : { value: out };
}

/** What {@link read} gives for JSON that is not of the type. */
const NOT: unique symbol = Symbol("not of the type");

/** The largest Float, which jq prints for Infinity. */
const DBL_MAX = 1.7976931348623157e308;

/** JSON as a value of a type, or {@link NOT}; `printed` reads it as jq prints outputs. */
function read(json: Json, type: EastType, printed: boolean): unknown {
  const t = unwrap(type);
  const payload = nullablePayload(t);
  if (payload !== undefined) {
    if (json.kind === "null") return none;
    const inner = read(json, payload, printed);
    return inner === NOT ? NOT : some(inner);
  }
  switch (t.type) {
    case "Null":
      return json.kind === "null" ? null : NOT;
    case "Boolean":
      return json.kind === "boolean" ? json.value : NOT;
    case "String":
      return json.kind === "string" ? json.value : NOT;
    case "Integer": {
      if (json.kind !== "number") return NOT;
      if (isInteger(json.text)) return BigInt(json.text);
      // jq compares numbers by value, and may print a whole number as `2.0` or `1e2`.
      const f = floatOf(json.text);
      return printed && Number.isSafeInteger(f) ? BigInt(f) : NOT;
    }
    case "Float": {
      if (printed && json.kind === "null") return NaN;
      if (json.kind !== "number") return NOT;
      const f = floatOf(json.text);
      return printed && Math.abs(f) === DBL_MAX ? Math.sign(f) * Infinity : f;
    }
    case "Array": {
      if (json.kind !== "array") return NOT;
      const items: unknown[] = [];
      for (const item of json.items) {
        const v = read(item, t.value as EastType, printed);
        if (v === NOT) return NOT;
        items.push(v);
      }
      return items;
    }
    case "Dict": {
      if (json.kind !== "object" || unwrap(t.key as EastType).type !== "String") return NOT;
      const entries: [string, unknown][] = [];
      for (const [key, item] of json.entries) {
        const v = read(item, t.value as EastType, printed);
        if (v === NOT) return NOT;
        entries.push([key, v]);
      }
      return new SortedMap(entries, compareFor(StringType));
    }
    case "Struct": {
      if (json.kind !== "object") return NOT;
      const fields = t.fields as Record<string, EastType>;
      const names = new Set(json.entries.map(([key]) => key));
      if (names.size !== Object.keys(fields).length || !Object.keys(fields).every(name => names.has(name))) return NOT;
      const out: Record<string, unknown> = {};
      // A key written twice holds its last value, as jq reads it.
      for (const [key, item] of json.entries) {
        const v = read(item, fields[key]!, printed);
        if (v === NOT) return NOT;
        out[key] = v;
      }
      return out;
    }
    default:
      return NOT;
  }
}
