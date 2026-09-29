/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The checker's view of a stream: how many outputs a filter gives, and the
 * type each output has, with what narrowing has proved about it.
 *
 * @packageDocumentation
 */

import { jsonFlatOptionPayload } from "../../serialization/json.js";
import { toEastTypeValue } from "../../type_of_type.js";
import {
  ArrayType, DictType, FloatType, NeverType, NullType, OptionType, StringType, StructType, VariantType,
  isTypeEqual, type EastType,
} from "../../types.js";

/**
 * How many outputs a filter gives: at least `lo`, at most `hi`, where a `hi`
 * of 2 stands for any number more than one.
 *
 * @internal
 */
export interface Mult {
  /** 1 when the filter always gives at least one output. */
  readonly lo: 0 | 1;
  /** 0 for none, 1 for at most one, 2 for any number. */
  readonly hi: 0 | 1 | 2;
}

/** Exactly one output. @internal */
export const ONE: Mult = { lo: 1, hi: 1 };
/** None or one output. @internal */
export const MAYBE: Mult = { lo: 0, hi: 1 };
/** No output: `empty`, `error`, `break`. @internal */
export const ZERO: Mult = { lo: 0, hi: 0 };
/** Any number of outputs. @internal */
export const MANY: Mult = { lo: 0, hi: 2 };
/** At least one output, possibly more. @internal */
export const SOME: Mult = { lo: 1, hi: 2 };

/**
 * The multiplicity of `a | b`: each output of `a` feeds `b`.
 *
 * @internal
 */
export function then(a: Mult, b: Mult): Mult {
  const lo = a.lo === 1 && b.lo === 1 ? 1 : 0;
  const hi = a.hi === 0 || b.hi === 0 ? 0 : (a.hi === 2 || b.hi === 2 ? 2 : 1);
  return { lo, hi };
}

/**
 * The multiplicity of `a, b`: the outputs of `a`, then those of `b`.
 *
 * @internal
 */
export function also(a: Mult, b: Mult): Mult {
  return { lo: a.lo === 1 || b.lo === 1 ? 1 : 0, hi: Math.min(2, a.hi + b.hi) as 0 | 1 | 2 };
}

/**
 * The multiplicity of a choice between two filters: `if`, `//`, `try`.
 *
 * @internal
 */
export function either(a: Mult, b: Mult): Mult {
  return { lo: a.lo === 1 && b.lo === 1 ? 1 : 0, hi: Math.max(a.hi, b.hi) as 0 | 1 | 2 };
}

/**
 * The multiplicity a checked query records.
 *
 * @internal
 */
export function wireMultiplicity(m: Mult): "one" | "maybe" | "many" {
  if (m.hi === 2) return "many";
  return m.hi === 1 && m.lo === 1 ? "one" : "maybe";
}

/**
 * What narrowing has proved about a value, following its type's structure.
 *
 * @remarks
 * - `cases` — a variant holds one of these cases; `payload` is what is known
 *   about the payload when there is only one.
 * - `fields` — facts about some fields of a struct.
 * - `elements` — facts about every element of an array, set or vector.
 * - `values` — facts about every value of a dict.
 * - `present` — an option holds a value.
 *
 * @internal
 */
export type Facts =
  | { readonly kind: "cases"; readonly cases: ReadonlySet<string>; readonly payload: Facts | undefined }
  | { readonly kind: "fields"; readonly fields: ReadonlyMap<string, Facts> }
  | { readonly kind: "elements"; readonly element: Facts }
  | { readonly kind: "values"; readonly value: Facts }
  | { readonly kind: "present"; readonly payload: Facts | undefined };

/**
 * An output of an East type, with what narrowing has proved about it.
 *
 * @internal
 */
export interface TypeShape {
  readonly kind: "type";
  readonly type: EastType;
  readonly facts: Facts | undefined;
}

/**
 * One member of a union: an output of one of several types, and the variant
 * case it was read from when it is a payload.
 *
 * @internal
 */
export interface Member {
  readonly shape: TypeShape;
  readonly case: string | undefined;
}

/**
 * The outputs of a filter as the checker knows them.
 *
 * @remarks
 * - `type` — every output has this East type.
 * - `union` — outputs have different types, one member per type (`..`, `.[]`
 *   over a struct, the payload of an un-narrowed variant). A union must unify
 *   into one type before it is collected or output.
 * - `error` — a diagnostic was reported here; everything built on it is
 *   unchecked, so one mistake reports one problem.
 *
 * @internal
 */
export type Shape = TypeShape | { readonly kind: "union"; readonly members: readonly Member[] } | { readonly kind: "error" };

/** The shape after a reported problem. @internal */
export const ERROR: Shape = { kind: "error" };

/**
 * The shape of outputs of one type.
 *
 * @internal
 */
export function typed(type: EastType, facts?: Facts): TypeShape {
  return { kind: "type", type, facts };
}

/**
 * A union of members, flattened, with members of the same type and case
 * merged; a single member is its own shape.
 *
 * @internal
 */
export function union(members: readonly Member[]): Shape {
  const merged: Member[] = [];
  for (const member of members) {
    if (member.shape.type.type === "Never") continue;
    if (!merged.some(m => m.case === member.case && isTypeEqual(m.shape.type, member.shape.type))) merged.push(member);
  }
  if (merged.length === 0) return typed(NeverType);
  if (merged.length === 1) return merged[0]!.shape;
  return { kind: "union", members: merged };
}

/**
 * The members of a shape: one for a `type` shape.
 *
 * @internal
 */
export function membersOf(shape: Shape): readonly Member[] {
  if (shape.kind === "type") return [{ shape, case: undefined }];
  if (shape.kind === "union") return shape.members;
  return [];
}

/**
 * A type with its recursive wrapper and references read through: what a
 * value of it is made of.
 *
 * @internal
 */
export function unwrap(type: EastType): EastType {
  let t = type;
  for (;;) {
    if (t.type === "Recursive") t = t.node as EastType;
    else if (t.type === "Ref") t = t.value as EastType;
    else return t;
  }
}

/**
 * The payload of an option that jq sees as `null` or the value: East JSON's
 * flat options (`jsonFlatOptionPayload`).
 *
 * @param type - a type
 * @returns the `some` payload's type, or `undefined` when the type is not a
 *   flat option (jq then sees it as `{type, value}`)
 *
 * @internal
 */
export function nullablePayload(type: EastType): EastType | undefined {
  if (type.type !== "Variant") return undefined;
  if (jsonFlatOptionPayload(toEastTypeValue(type)) === null) return undefined;
  return (type.cases as Record<string, EastType>)["some"];
}

/**
 * Whether jq sees values of a type as `null`: Null, or a flat option.
 *
 * @internal
 */
export function canBeNull(type: EastType): boolean {
  return type.type === "Null" || nullablePayload(type) !== undefined;
}

/**
 * The type jq's `T` or `null` becomes: `Option<T>`, or `T` itself when it can
 * already be `null`.
 *
 * @returns the type, or `undefined` when no type holds both: `T` is an option
 *   jq sees as `{type, value}`, and wrapping it again would too
 *
 * @internal
 */
export function orNull(type: EastType): EastType | undefined {
  if (type.type === "Never") return NullType;
  if (canBeNull(type)) return type;
  const option = OptionType(type);
  return nullablePayload(option) === undefined ? undefined : option;
}

/**
 * The one type two outputs can share, as jq's typed outputs unify.
 *
 * @param a - one output's type
 * @param b - another's
 * @returns their common type, or `undefined` when they have none
 *
 * @remarks
 * - Equal types unify to themselves, and `Never` (no value) to the other.
 * - A reference is read through, as jq sees its value: `Ref<T>` and `U`
 *   unify as `T` and `U` do.
 * - A recursive type and its node unify to the recursive type; another
 *   recursive type only with `null`, or an option of it.
 * - Integer and Float unify to Float.
 * - `null` and `T` unify to `Option<T>`; `Option<T>` and `U` to
 *   `Option<T ⊔ U>`.
 * - Arrays, sets, dicts and vectors unify element-wise; `Array<Never>` (an
 *   empty `[]`) takes the other's element type.
 * - Structs with the same field names unify field by field, in the first's
 *   field order; `Struct{}` (an empty `{}`) unifies with any dict.
 * - Variants unify case by case, taking every case of both.
 *
 * @internal
 */
export function unify(a: EastType, b: EastType): EastType | undefined {
  if (isTypeEqual(a, b)) return a;
  if (a.type === "Never") return b;
  if (b.type === "Never") return a;
  if (a.type === "Ref") return unify(a.value as EastType, b);
  if (b.type === "Ref") return unify(a, b.value as EastType);
  if (a.type === "Recursive" && isTypeEqual(a.node as EastType, b)) return a;
  if (b.type === "Recursive" && isTypeEqual(b.node as EastType, a)) return b;
  if ((a.type === "Integer" && b.type === "Float") || (a.type === "Float" && b.type === "Integer")) return FloatType;

  // null and T.
  if (a.type === "Null") return orNull(b);
  if (b.type === "Null") return orNull(a);
  const aPayload = nullablePayload(a);
  const bPayload = nullablePayload(b);
  if (aPayload !== undefined || bPayload !== undefined) {
    const inner = unify(aPayload ?? a, bPayload ?? b);
    return inner === undefined ? undefined : orNull(inner);
  }
  if (a.type === "Recursive" || b.type === "Recursive") return undefined;

  switch (a.type) {
    case "Array": {
      if (b.type !== "Array") return undefined;
      const element = unify(a.value as EastType, b.value as EastType);
      return element === undefined ? undefined : ArrayType(element);
    }
    case "Set": {
      if (b.type !== "Set" || !isTypeEqual(a.key as EastType, b.key as EastType)) return undefined;
      return a;
    }
    case "Dict": {
      if (b.type === "Struct" && Object.keys(b.fields).length === 0) return a;
      if (b.type !== "Dict" || !isTypeEqual(a.key as EastType, b.key as EastType)) return undefined;
      const value = unify(a.value as EastType, b.value as EastType);
      return value === undefined ? undefined : DictType(a.key as EastType, value);
    }
    case "Struct": {
      if (b.type === "Dict" && Object.keys(a.fields).length === 0) return b;
      if (b.type !== "Struct") return undefined;
      const aFields = a.fields as Record<string, EastType>;
      const bFields = b.fields as Record<string, EastType>;
      const names = Object.keys(aFields);
      if (names.length !== Object.keys(bFields).length || !names.every(name => name in bFields)) return undefined;
      const fields: Record<string, EastType> = {};
      for (const name of names) {
        const field = unify(aFields[name]!, bFields[name]!);
        if (field === undefined) return undefined;
        fields[name] = field;
      }
      return StructType(fields);
    }
    case "Variant": {
      if (b.type !== "Variant") return undefined;
      const aCases = a.cases as Record<string, EastType>;
      const bCases = b.cases as Record<string, EastType>;
      const cases: Record<string, EastType> = { ...aCases };
      for (const [name, payload] of Object.entries(bCases)) {
        if (name in cases) {
          const merged = unify(cases[name]!, payload);
          if (merged === undefined) return undefined;
          cases[name] = merged;
        } else {
          cases[name] = payload;
        }
      }
      return VariantType(cases);
    }
    case "Vector": case "Matrix":
      return undefined;
    default:
      return undefined;
  }
}

/**
 * The types `..` and `recurse` give on values of some types: each type, then
 * the types of the values inside it, depth first, each once. Inside a value
 * are an option's value, the elements of an array, set or vector, a matrix's
 * rows, a dict's values, a struct's fields, and a variant's case name and
 * payloads (jq's `{type, value}`).
 *
 * @param types - the input's types
 * @returns the types, in the order the walk first meets them
 *
 * @internal
 */
export function descendTypes(types: readonly EastType[]): EastType[] {
  const seen: EastType[] = [];
  const visit = (type: EastType): void => {
    if (seen.some(s => isTypeEqual(s, type))) return;
    seen.push(type);
    const t = unwrap(type);
    const payload = nullablePayload(t);
    if (payload !== undefined) { visit(payload); return; }
    switch (t.type) {
      case "Array": visit(t.value as EastType); break;
      case "Set": visit(t.key as EastType); break;
      case "Vector": visit(t.element as EastType); break;
      case "Matrix": visit(ArrayType(t.element as EastType)); break;
      case "Dict": visit(t.value as EastType); break;
      case "Struct": for (const f of Object.values(t.fields as Record<string, EastType>)) visit(f); break;
      case "Variant": visit(StringType); for (const c of Object.values(t.cases as Record<string, EastType>)) visit(c); break;
      default: break;
    }
  };
  types.forEach(visit);
  return seen;
}

/**
 * The one type a shape's outputs share.
 *
 * @param shape - a shape
 * @returns the type, `Never` for no outputs, or `undefined` when the members
 *   have no common type (or the shape is an error)
 *
 * @internal
 */
export function unifyShape(shape: Shape): EastType | undefined {
  if (shape.kind === "error") return undefined;
  if (shape.kind === "type") return shape.type;
  let type: EastType = NeverType;
  for (const member of shape.members) {
    const next = unify(type, member.shape.type);
    if (next === undefined) return undefined;
    type = next;
  }
  return type;
}

/**
 * Prints a type for a diagnostic, as jq's users read one: `Integer`,
 * `Option<Float>`, `Array<String>`, `Dict<String, Float>`,
 * `Struct{id: Integer, total: Float}`, `Variant{cancelled, pending, shipped}`.
 *
 * @param type - the type
 * @param depth - how many levels of structs to spell out
 * @returns its text
 *
 * @remarks
 * A struct deeper than `depth` prints as `Struct{…}`, and one with more than
 * six fields lists six and `…`. A recursive type prints its node, and a
 * reference back into it as `…`.
 *
 * @internal
 */
export function describeType(type: EastType, depth = 2): string {
  const seen: EastType[] = [];
  const print = (t: EastType, level: number): string => {
    switch (t.type) {
      case "Never": case "Null": case "Boolean": case "Integer": case "Float": case "String": case "DateTime": case "Blob":
        return t.type;
      case "Array": return `Array<${print(t.value as EastType, level)}>`;
      case "Set": return `Set<${print(t.key as EastType, level)}>`;
      case "Ref": return `Ref<${print(t.value as EastType, level)}>`;
      case "Vector": return `Vector<${print(t.element as EastType, level)}>`;
      case "Matrix": return `Matrix<${print(t.element as EastType, level)}>`;
      case "Dict": return `Dict<${print(t.key as EastType, level)}, ${print(t.value as EastType, level)}>`;
      case "Variant": {
        const payload = nullablePayload(t);
        if (payload !== undefined) return `Option<${print(payload, level)}>`;
        const cases = t.cases as Record<string, EastType>;
        if (Object.keys(cases).length === 2 && "none" in cases && "some" in cases) return `Option<${print(cases["some"]!, level)}>`;
        return `Variant{${Object.keys(cases).join(", ")}}`;
      }
      case "Struct": {
        const fields = Object.entries(t.fields as Record<string, EastType>);
        if (level >= depth) return fields.length === 0 ? "Struct{}" : "Struct{…}";
        const shown = fields.slice(0, 6).map(([name, field]) => `${name}: ${print(field, level + 1)}`);
        return `Struct{${shown.join(", ")}${fields.length > 6 ? ", …" : ""}}`;
      }
      case "Recursive": {
        if (seen.includes(t)) return "…";
        seen.push(t);
        const text = print(t.node as EastType, level);
        seen.pop();
        return text;
      }
      case "Function": case "AsyncFunction":
        return `${t.type}([${(t.inputs as EastType[]).map(input => print(input, level)).join(", ")}], ${print(t.output as EastType, level)})`;
    }
  };
  return print(type, 0);
}

/**
 * What a condition proves when it is true: that a variant at a field path
 * from `.` holds one of some cases (`.status.type == "shipped"`), or that
 * the value at the path has one of some jq types (`type == "number"`).
 *
 * @internal
 */
export type Proof =
  | { readonly kind: "case"; readonly path: readonly string[]; readonly cases: readonly string[] }
  | { readonly kind: "type"; readonly path: readonly string[]; readonly types: readonly string[] };

/**
 * The names jq's `type` gives, and East's additions for its own types.
 *
 * @internal
 */
export const JQ_TYPE_NAMES: readonly string[] = ["null", "boolean", "number", "string", "array", "object", "datetime", "blob", "function"];

/**
 * The names `type` can give for values of a type: an option's `null` and its
 * payload's.
 *
 * @internal
 */
export function jqTypeNames(type: EastType): string[] {
  const t = unwrap(type);
  const payload = nullablePayload(t);
  if (payload !== undefined) return ["null", ...jqTypeNames(payload)];
  switch (t.type) {
    case "Never": return [];
    case "Null": return ["null"];
    case "Boolean": return ["boolean"];
    case "Integer": case "Float": return ["number"];
    case "String": return ["string"];
    case "Array": case "Set": case "Vector": case "Matrix": return ["array"];
    case "Dict": case "Struct": case "Variant": return ["object"];
    case "DateTime": return ["datetime"];
    case "Blob": return ["blob"];
    case "Function": case "AsyncFunction": return ["function"];
    default: return [];
  }
}

/**
 * Narrows a shape to the outputs whose jq type is one of some names: what
 * `select(type == "object")` keeps.
 *
 * @internal
 */
export function narrowTypes(shape: Shape, types: readonly string[]): Shape {
  if (shape.kind === "error") return shape;
  const members: Member[] = [];
  for (const member of membersOf(shape)) {
    const t = unwrap(member.shape.type);
    const payload = nullablePayload(t);
    if (payload !== undefined) {
      const keepsNull = types.includes("null");
      const keepsValue = jqTypeNames(payload).some(name => types.includes(name));
      if (keepsNull && keepsValue) members.push(member);
      else if (keepsValue) members.push({ shape: typed(payload), case: member.case });
      else if (keepsNull) members.push({ shape: typed(NullType), case: member.case });
      continue;
    }
    if (jqTypeNames(t).some(name => types.includes(name))) members.push(member);
  }
  return union(members);
}

/**
 * What the checker knows about a filter's outputs.
 *
 * @remarks
 * - `shape` and `mult` — the outputs' types and how many there are.
 * - `access` — the field names from the filter's input to its output, when
 *   the filter only reads fields (`.a.b`, `.a | .b`).
 * - `caseOf` — the output is `.P.type` of a variant at path `P`, with the cases
 *   it can hold.
 * - `proves` — what the output being true proves about the input.
 * - `partial` — the output is an option only because some cases of a variant
 *   lack the field read, so narrowing would make it exact: the case that has
 *   it, the field, and the path of the node that read it.
 * - `stream` — the output is an element of the stream the `[]` at this path
 *   makes.
 * - `typeOf` — the output is the jq type name of the value at this field
 *   path from the input.
 *
 * @internal
 */
export interface Result {
  readonly shape: Shape;
  readonly mult: Mult;
  readonly access?: readonly string[] | undefined;
  readonly caseOf?: { readonly path: readonly string[]; readonly variant: EastType; readonly cases: readonly string[] } | undefined;
  readonly proves?: readonly Proof[] | undefined;
  readonly partial?: { readonly caseName: string; readonly leaf: string; readonly at: string } | undefined;
  readonly stream?: string | undefined;
  readonly typeOf?: readonly string[] | undefined;
}

/**
 * Narrows a shape: the variant at `path` holds only `cases`.
 *
 * @param shape - the shape of `.`
 * @param path - the field names from `.` to the variant
 * @param cases - the cases it holds
 * @returns the shape with the fact added, or the shape unchanged when the
 *   path does not lead to a variant
 *
 * @internal
 */
export function refine(shape: Shape, path: readonly string[], cases: readonly string[]): Shape {
  if (shape.kind === "error") return shape;
  if (shape.kind === "union") {
    return union(shape.members.map(member => ({ shape: refine(member.shape, path, cases) as TypeShape, case: member.case })));
  }
  const facts = refineFacts(shape.type, shape.facts, path, cases);
  return facts === undefined ? shape : typed(shape.type, facts);
}

function refineFacts(type: EastType, facts: Facts | undefined, path: readonly string[], cases: readonly string[]): Facts | undefined {
  const t = unwrap(type);
  const payload = nullablePayload(t);
  if (payload !== undefined) {
    const inner = refineFacts(payload, facts?.kind === "present" ? facts.payload : undefined, path, cases);
    return inner === undefined ? undefined : { kind: "present", payload: inner };
  }
  if (path.length === 0) {
    if (t.type !== "Variant") return undefined;
    const known = facts?.kind === "cases" ? facts.cases : undefined;
    const kept = cases.filter(c => c in (t.cases as Record<string, EastType>) && (known === undefined || known.has(c)));
    const single = kept.length === 1 && facts?.kind === "cases" && facts.cases.size === 1 ? facts.payload : undefined;
    return { kind: "cases", cases: new Set(kept), payload: single };
  }
  if (t.type !== "Struct") return undefined;
  const [name, ...rest] = path;
  const fields = t.fields as Record<string, EastType>;
  if (!(name! in fields)) return undefined;
  const known = facts?.kind === "fields" ? facts.fields : new Map<string, Facts>();
  const inner = refineFacts(fields[name!]!, known.get(name!), rest, cases);
  if (inner === undefined) return undefined;
  const next = new Map(known);
  next.set(name!, inner);
  return { kind: "fields", fields: next };
}

/**
 * The cases a variant can hold, given what is known about it.
 *
 * @internal
 */
export function casesOf(type: EastType, facts: Facts | undefined): string[] {
  const t = unwrap(type);
  if (t.type !== "Variant") return [];
  const all = Object.keys(t.cases as Record<string, EastType>);
  return facts?.kind === "cases" ? all.filter(c => facts.cases.has(c)) : all;
}

/**
 * Whether values of a type can be sorted and compared by East's total order:
 * every data type (no functions).
 *
 * @internal
 */
export function isOrdered(type: EastType): boolean {
  const seen = new Set<EastType>();
  const check = (t: EastType): boolean => {
    if (seen.has(t)) return true;
    seen.add(t);
    switch (t.type) {
      case "Function": case "AsyncFunction": return false;
      case "Array": case "Ref": return check(t.value as EastType);
      case "Set": return check(t.key as EastType);
      case "Dict": return check(t.key as EastType) && check(t.value as EastType);
      case "Struct": return Object.values(t.fields as Record<string, EastType>).every(check);
      case "Variant": return Object.values(t.cases as Record<string, EastType>).every(check);
      case "Recursive": return check(t.node as EastType);
      default: return true;
    }
  };
  return check(type);
}
