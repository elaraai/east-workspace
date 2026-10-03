/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Values as jq sees them (`devdocs/QUERY.md` §2), for the type matrix
 * (#987), as jq filters over East JSON. East's own codec writes a case's
 * input and reads jq's outputs (`encodeJSONFor`, `decodeJSONFor`); these
 * filters, generated from the East types, turn East JSON into the value jq
 * sees before the program, and each output back into East JSON after it.
 * Nothing here reads or writes an East value.
 *
 * jq's view of a value: Null, Boolean and String as they are; an Integer as a
 * number; a Float as a number, NaN and ±Infinity as jq's `nan` and
 * `infinite`, and −0.0 as jq's −0; an Array, Set or Vector as an array, and a
 * Matrix as its rows; a Dict with String keys, and a Struct, as an object; a
 * flat Option as `null` or its value, and any other Variant as
 * `{type, value}`; a Recursive value as its node; and a Ref as its value.
 * DateTime, Blob, a function and a Dict keyed by another type have none: jq
 * has no such values, and QUERY.md alone gives their semantics.
 */

import type { EastType } from "../../src/index.js";
import { nullablePayload } from "../../src/query/jq/shapes.js";

/**
 * Whether jq can see values of a type: whether every part of it has a view.
 *
 * @param type - the type
 * @returns `true` when the filters below map it
 */
export function hasJqView(type: EastType): boolean {
  const seen = new Set<EastType>();
  const visit = (t: EastType): boolean => {
    if (seen.has(t)) return true;
    seen.add(t);
    switch (t.type) {
      case "Never": case "Null": case "Boolean": case "Integer": case "Float": case "String": return true;
      case "Array": case "Ref": return visit(t.value as EastType);
      case "Set": return visit(t.key as EastType);
      case "Vector": case "Matrix": return visit(t.element as EastType);
      case "Dict": return (t.key as EastType).type === "String" && visit(t.value as EastType);
      case "Struct": return Object.values(t.fields as Record<string, EastType>).every(visit);
      case "Variant": return Object.values(t.cases as Record<string, EastType>).every(visit);
      case "Recursive": return visit(t.node as EastType);
      default: return false;
    }
  };
  return visit(type);
}

/**
 * What an output filter gives for a value that is not one of its type's: an
 * object East's decoder refuses at every type, holding what jq gave.
 */
const NOT_OF_TYPE = "{\"jq gave\": .}";

/** A string as a jq string literal: JSON's escapes are jq's. */
const literal = (text: string): string => JSON.stringify(text);

/**
 * Writes the filter for a type in one direction: `into` jq's view from East
 * JSON, or `out` of it into East JSON. A recursive type's filter is a `def`
 * made where the type is met, which its body calls; a filter that changes
 * nothing is `.`.
 */
class Filters {
  private count = 0;
  private readonly defining = new Map<EastType, string>();

  constructor(private readonly direction: "into" | "out") {}

  of(t: EastType): string {
    return this.direction === "into" ? this.into(t) : this.out(t);
  }

  /** East JSON of a type → the value jq sees. */
  private into(t: EastType): string {
    switch (t.type) {
      case "Never": case "Null": case "Boolean": case "String":
        return ".";
      case "Integer":
        // East JSON writes an Integer as its decimal text.
        return "tonumber";
      case "Float":
        // East JSON writes NaN, ±Infinity and −0.0 as strings; jq's literal
        // -0.0 is 0, so −0 is read from text.
        return "(if type == \"string\" then (if . == \"NaN\" then nan elif . == \"Infinity\" then infinite elif . == \"-Infinity\" then -infinite else (\"-0\" | tonumber) end) else . end)";
      case "Array": case "Set": case "Vector": {
        const element = this.into(elementOf(t));
        return element === "." ? "." : `map(${element})`;
      }
      case "Matrix": {
        const element = this.into(t.element as EastType);
        return element === "." ? "." : `map(map(${element}))`;
      }
      case "Dict": {
        // East JSON writes a Dict as its {key, value} entries.
        const value = this.into(t.value as EastType);
        return `(reduce .[] as $entry ({}; .[$entry.key] = ($entry.value${value === "." ? "" : ` | ${value}`})))`;
      }
      case "Struct": {
        const fields = Object.entries(t.fields as Record<string, EastType>).map(([name, f]) => [name, this.into(f)] as const);
        if (fields.every(([, f]) => f === ".")) return ".";
        return `{${fields.map(([name, f]) => `${literal(name)}: (.[${literal(name)}]${f === "." ? "" : ` | ${f}`})`).join(", ")}}`;
      }
      case "Variant": {
        const payload = nullablePayload(t);
        if (payload !== undefined) {
          const p = this.into(payload);
          return p === "." ? "." : `(if . == null then null else ${p} end)`;
        }
        const cases = Object.entries(t.cases as Record<string, EastType>).map(([name, c]) => [name, this.into(c)] as const);
        if (cases.every(([, c]) => c === ".")) return ".";
        const arms = cases.map(([name, c], i) => `${i === 0 ? "if" : "elif"} .type == ${literal(name)} then {type: .type, value: (.value${c === "." ? "" : ` | ${c}`})}`);
        return `(${arms.join(" ")} else . end)`;
      }
      case "Recursive":
        return this.recursive(t);
      case "Ref": {
        // East JSON writes a Ref as a one-element array.
        const value = this.into(t.value as EastType);
        return value === "." ? ".[0]" : `(.[0] | ${value})`;
      }
      default:
        throw new Error(`jq has no view of ${t.type}`);
    }
  }

  /** The value jq gives → East JSON of a type, or {@link NOT_OF_TYPE} where it is not one of the type's. */
  private out(t: EastType): string {
    switch (t.type) {
      case "Never":
        return NOT_OF_TYPE;
      case "Null":
        return `(if . == null then . else ${NOT_OF_TYPE} end)`;
      case "Boolean":
        return `(if type == "boolean" then . else ${NOT_OF_TYPE} end)`;
      case "String":
        return `(if type == "string" then . else ${NOT_OF_TYPE} end)`;
      case "Integer":
        // Its decimal text; jq's −0 is East's 0, and a number that is not an
        // integer, or past 64 bits, stays text East's decoder refuses.
        return `(if type == "number" then (if . == 0 then "0" else tostring end) else ${NOT_OF_TYPE} end)`;
      case "Float":
        return `(if type == "number" then (if isnan then "NaN" elif isinfinite then (if . > 0 then "Infinity" else "-Infinity" end) elif . == 0 and (tostring | startswith("-")) then "-0.0" else . end) else ${NOT_OF_TYPE} end)`;
      case "Array": case "Set": case "Vector":
        // A Set's elements are kept in jq's order, duplicates and all: East's
        // decoder sorts and merges them, so the spec compares jq's text with
        // the value's own encoding too.
        return `(if type == "array" then map(${this.out(elementOf(t))}) else ${NOT_OF_TYPE} end)`;
      case "Matrix":
        return `(if type == "array" and all(.[]; type == "array") then map(map(${this.out(t.element as EastType)})) else ${NOT_OF_TYPE} end)`;
      case "Dict":
        // Its entries in key order: jq and East both order strings by code point.
        return `(if type == "object" then (to_entries | sort_by(.key) | map({key: .key, value: (.value | ${this.out(t.value as EastType)})})) else ${NOT_OF_TYPE} end)`;
      case "Struct": {
        const fields = Object.entries(t.fields as Record<string, EastType>);
        const names = `(${JSON.stringify(fields.map(([name]) => name))} | sort)`;
        const built = `{${fields.map(([name, f]) => `${literal(name)}: (.[${literal(name)}] | ${this.out(f)})`).join(", ")}}`;
        return `(if type == "object" and (keys == ${names}) then ${built} else ${NOT_OF_TYPE} end)`;
      }
      case "Variant": {
        const payload = nullablePayload(t);
        if (payload !== undefined) return `(if . == null then null else ${this.out(payload)} end)`;
        const cases = Object.entries(t.cases as Record<string, EastType>);
        const arms = cases.map(([name, c], i) => `${i === 0 ? "if" : "elif"} .type == ${literal(name)} then {type: .type, value: (.value | ${this.out(c)})}`);
        return `(if type == "object" and (keys == ["type", "value"]) then (${arms.join(" ")} else ${NOT_OF_TYPE} end) else ${NOT_OF_TYPE} end)`;
      }
      case "Recursive":
        return this.recursive(t);
      case "Ref":
        return `[${this.out(t.value as EastType)}]`;
      default:
        throw new Error(`jq has no view of ${t.type}`);
    }
  }

  /** A recursive type's filter: a `def` its body calls back into, or `.` when the body changes nothing. */
  private recursive(t: EastType & { readonly type: "Recursive" }): string {
    const known = this.defining.get(t);
    if (known !== undefined) return known;
    const name = `east_${this.direction}_${this.count++}`;
    this.defining.set(t, name);
    const body = this.of(t.node as EastType);
    this.defining.delete(t);
    if (body === ".") return ".";
    return `(def ${name}: ${body}; ${name})`;
  }
}

/** The element type of an Array, Set or Vector. */
function elementOf(t: EastType): EastType {
  if (t.type === "Set") return t.key as EastType;
  if (t.type === "Vector") return t.element as EastType;
  if (t.type === "Array") return t.value as EastType;
  throw new Error(`${t.type} is not a sequence`);
}

/**
 * The jq filter that turns East JSON of a type into the value jq sees.
 *
 * @param type - the input's type, which {@link hasJqView} admits
 * @returns the filter's text: `.` when East JSON is already that value
 */
export function jqFromEast(type: EastType): string {
  return new Filters("into").of(type);
}

/**
 * The jq filter that turns a value jq gives into East JSON of a type: what
 * East's decoder reads for it, or, where jq gave a value of no such type, an
 * object the decoder refuses.
 *
 * @param type - the output's type, which {@link hasJqView} admits
 * @returns the filter's text
 */
export function jqToEast(type: EastType): string {
  return new Filters("out").of(type);
}

/**
 * A program as the matrix runs it through jq: the input turned from East JSON
 * into jq's view, the program, and, when the query's element type is given,
 * each output turned back into East JSON.
 *
 * @param program - the program
 * @param inputType - the input's type
 * @param elementType - the type of each output, or `undefined` for a program
 *   East refuses, where only whether jq raises an error matters
 * @returns the jq text
 */
export function jqWrapped(program: string, inputType: EastType, elementType: EastType | undefined): string {
  const from = jqFromEast(inputType);
  const parts = [...(from === "." ? [] : [from]), `(${program})`, ...(elementType === undefined ? [] : [jqToEast(elementType)])];
  return parts.join(" | ");
}
