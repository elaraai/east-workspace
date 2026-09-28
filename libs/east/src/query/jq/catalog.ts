/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builtin catalog: every builtin of jq 1.8 and East's additions, with the
 * checker's typing rule for each one a query may use, and the East builtin or
 * library function the translator defines it by (`devdocs/QUERY.md` §10).
 *
 * @packageDocumentation
 */

import { variant } from "../../containers/variant.js";
import { DateTimeFormatTokenType } from "../../datetime_format/types.js";
import { validateCrossPlatformCompatible } from "../../expr/regex_validation.js";
import { encodeBeast2For } from "../../serialization/beast2/index.js";
import { compareFor } from "../../comparison.js";
import { printFor } from "../../serialization/east.js";
import {
  ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NeverType, NullType, StringType, StructType,
  isImmutableType, isTypeEqual, type EastType,
} from "../../types.js";
import { MESSAGES, edit, type QueryFix } from "./messages.js";
import {
  ERROR, MANY, MAYBE, ONE, ZERO, describeType, either, isOrdered, membersOf, nullablePayload, orNull, then,
  typed, unify, union, unwrap, type Member, type Mult, type Proof, type Result, type Shape, type TypeShape,
} from "./shapes.js";
import type { JqNode, JqRange } from "./spans.js";
import { formatTokens } from "./strftime.js";

/**
 * What a builtin's typing rule works with: the call, its input, and ways to
 * check its arguments and report problems.
 *
 * @internal
 */
export interface CallContext {
  /** The builtin's name as called (`@base64` for a format). */
  readonly name: string;
  /** The call node's path. */
  readonly path: string;
  /** The call's input. */
  readonly input: Result;
  /** The arguments, as written. */
  readonly args: readonly JqNode[];
  /** Each argument's path. */
  readonly argPaths: readonly string[];
  /** The call's range. */
  readonly range: JqRange | undefined;
  /** The builtin being typed. */
  readonly builtin: Builtin;
  /** An argument's range. */
  argRange(i: number): JqRange | undefined;
  /** Checks argument `i` on an input: the call's input when none is given. */
  arg(i: number, input?: Result): Result;
  /** Argument `i`'s value when it is written as a literal. */
  literal(i: number): { type: EastType; value: unknown } | undefined;
  /** A literal node's value. */
  literalOf(node: Extract<JqNode, { type: "literal" }>): { type: EastType; value: unknown };
  /**
   * Rewrites argument `i`, a literal, as `wanted` is written: an Integer as a
   * Float, an ISO-8601 string as a DateTime. Reports a string that is not an
   * ISO-8601 date.
   *
   * @returns the literal's new type, or `undefined` when it is not such a literal
   */
  coerceArg(i: number, wanted: EastType): EastType | undefined;
  /** Reports a problem at the call, or at argument `arg`. */
  fail(code: string, message: string, options?: { arg?: number; suggestions?: string[]; fixes?: QueryFix[] }): Result;
  /** Reports a type error jq raises at run time; in a lenient place, no output instead. */
  mismatch(code: string, message: string, arg?: number, fixes?: QueryFix[]): Result;
  /** The fix that skips null inputs, `values | `, when the call can have a pipe put before it. */
  skipNulls(): QueryFix | undefined;
  /** Reports a lint at the call. */
  warn(code: string, message: string, fixes?: QueryFix[]): void;
  /** Replaces the call in the checked program. */
  rewrite(replacement: JqNode): void;
  /** Replaces argument `i` in the checked program. */
  rewriteArg(i: number, replacement: JqNode): void;
  /** The call's text, or argument `i`'s. */
  source(i?: number): string;
  /** The one type a result's outputs share, or a reported `ambiguous_output`. */
  collect(result: Result, arg?: number): EastType | undefined;
  /** Whether a shape is an e3 root, which is read one field at a time. */
  isRoot(shape: Shape): boolean;
  /** Refuses the call when its input is the whole root. */
  refuseRoot(): boolean;
  /** Adds what a condition proves to a result's shape. */
  narrow(result: Result, proves: readonly Proof[]): Result;
  /** Reports reading, un-narrowed, a payload field the call needs a value of, with the "Narrow first" fix. */
  narrowFirst(type: EastType): Result;
  /** Reports an array builtin run on each element of a stream, with the fix that collects it. */
  onElement(type: EastType): Result;
  /** The program's text. */
  readonly text: string;
  /** Any node's range, by its path. */
  rangeAt(path: string): JqRange | undefined;
  /** What checking a node gave, by its path, in this instance. */
  resultAt(path: string): Result | undefined;
}

/**
 * A catalog entry.
 *
 * @remarks
 * - `status` — `supported`; `excluded` (host access and nondeterminism,
 *   §11); `unavailable` (no East definition, with `reason`); `not_yet`; or
 *   `tooling` (tooling-only, §9).
 * - `arities` — the numbers of arguments it takes.
 * - `east` — the East builtins or library functions that define it, for
 *   `QUERY.md`'s table and the translator.
 * - `typing` — the checker's rule, for a builtin a query may call.
 *
 * @internal
 */
export interface Builtin {
  readonly status: "supported" | "excluded" | "unavailable" | "not_yet" | "tooling";
  readonly arities: readonly number[];
  readonly east: string;
  readonly reason?: string;
  /** What it takes and gives, for `QUERY.md`'s table. */
  readonly rule?: string;
  /** How many outputs it gives for one input, for `QUERY.md`'s table. */
  readonly outputs?: string;
  readonly typing?: (ctx: CallContext) => Result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const one = (type: EastType, mult: Mult = ONE): Result => ({ shape: typed(type), mult });

/** A result's members' types, read through options when `nullable`. */
function typesOf(result: Result): EastType[] {
  return membersOf(result.shape).map(m => m.shape.type);
}

/** Applies a rule to each member of the call's input, and unions the outcomes. */
function perMember(ctx: CallContext, input: Result, each: (member: TypeShape) => Result): Result {
  if (input.shape.kind === "error") return { shape: ERROR, mult: ONE };
  const members: Member[] = [];
  let mult: Mult | undefined;
  for (const member of membersOf(input.shape)) {
    const out = each(member.shape);
    if (out.shape.kind === "error") return { shape: ERROR, mult: ONE };
    members.push(...membersOf(out.shape));
    mult = mult === undefined ? out.mult : either(mult, out.mult);
  }
  return { shape: union(members), mult: mult ?? ZERO };
}

/** Requires the input's members to be of some kind, typing each with `rule`. */
function onInput(ctx: CallContext, expected: string, rule: (t: EastType, member: TypeShape) => Result | undefined): Result {
  return perMember(ctx, ctx.input, member => {
    const t = unwrap(member.type);
    const out = rule(t, member);
    if (out !== undefined) return out;
    return inputMismatch(ctx, expected, member.type);
  });
}

/**
 * The diagnostic for an input of the wrong type: "Narrow first" when it is an
 * option only because a variant is not narrowed; `array_builtin_on_element`
 * when an array builtin runs on each element of a stream; for a string
 * builtin on a DateTime, what to use instead.
 */
function inputMismatch(ctx: CallContext, expected: string, type: EastType): Result {
  if (ctx.input.partial !== undefined && nullablePayload(unwrap(type)) !== undefined) return ctx.narrowFirst(type);
  if (ctx.input.stream !== undefined && expected.startsWith("an array")) return ctx.onElement(type);
  if (unwrap(type).type === "DateTime" && expected === "a string") return ctx.mismatch("type_mismatch", MESSAGES.dateAsString(ctx.name));
  // An input that can be null: the fix skips the nulls.
  const skip = nullablePayload(unwrap(type)) !== undefined ? ctx.skipNulls() : undefined;
  return ctx.mismatch("type_mismatch", MESSAGES.input(ctx.name, expected, describeType(type)), undefined, skip === undefined ? [] : [skip]);
}

/** The element type of an array-like value as jq sees it: arrays, sets, vectors; matrix rows. */
function elementOf(t: EastType): EastType | undefined {
  switch (t.type) {
    case "Array": return t.value as EastType;
    case "Set": return t.key as EastType;
    case "Vector": return t.element as EastType;
    case "Matrix": return ArrayType(t.element as EastType);
    default: return undefined;
  }
}

/** The elements of an array-like input, with their facts, for a builtin that runs a filter on each. */
function elements(member: TypeShape): Result | undefined {
  const t = unwrap(member.type);
  const element = elementOf(t);
  if (element === undefined) return undefined;
  const facts = t.type === "Array" && member.facts?.kind === "elements" ? member.facts.element : undefined;
  return { shape: typed(element, facts), mult: ONE };
}

/** The values `.[]` gives: array-like elements, dict values, struct fields. */
function valuesOf(member: TypeShape): Result | undefined {
  const t = unwrap(member.type);
  const direct = elements(member);
  if (direct !== undefined) return direct;
  if (t.type === "Dict") return { shape: typed(t.value as EastType, member.facts?.kind === "values" ? member.facts.value : undefined), mult: ONE };
  if (t.type === "Struct") {
    const facts = member.facts?.kind === "fields" ? member.facts.fields : undefined;
    return { shape: union(Object.entries(t.fields as Record<string, EastType>).map(([name, f]) => ({ shape: typed(f, facts?.get(name)), case: undefined }))), mult: ONE };
  }
  return undefined;
}

/** A number type's promotion to Float. */
function isNumber(t: EastType): boolean {
  return t.type === "Integer" || t.type === "Float";
}

/** A literal argument that must be a non-negative Integer written in the query. */
function literalInteger(ctx: CallContext, i: number, what: string): bigint | undefined {
  const literal = ctx.literal(i);
  if (literal?.type.type !== "Integer" || (literal.value as bigint) < 0n) {
    ctx.fail("type_mismatch", MESSAGES.literalArgument(ctx.name, what, "a non-negative Integer"), { arg: i });
    return undefined;
  }
  return literal.value as bigint;
}

/** A literal argument that must be a String written in the query. */
function literalString(ctx: CallContext, i: number, what: string): string | undefined {
  const literal = ctx.literal(i);
  if (literal?.type.type !== "String") {
    ctx.fail("type_mismatch", MESSAGES.literalArgument(ctx.name, what, "a string"), { arg: i });
    return undefined;
  }
  return literal.value as string;
}

/** Checks an argument that must give values of one type among `allowed`. */
function argOf(ctx: CallContext, i: number, expected: string, allowed: (t: EastType) => boolean, input?: Result, coerce?: EastType): { result: Result; type: EastType } | undefined {
  const result = ctx.arg(i, input);
  if (result.shape.kind === "error") return undefined;
  const type = ctx.collect(result, i);
  if (type === undefined) return undefined;
  if (!allowed(unwrap(type))) {
    // A literal of another type the argument's type is written as: an ISO-8601 string for a DateTime.
    const coerced = coerce === undefined ? undefined : ctx.coerceArg(i, coerce);
    if (coerced !== undefined) return { result: one(coerced), type: coerced };
    if (coerce !== undefined && ctx.literal(i) !== undefined && unwrap(coerce).type === "DateTime") return undefined;
    ctx.fail("type_mismatch", MESSAGES.argument(ctx.name, ordinal(i), expected, describeType(type)), { arg: i });
    return undefined;
  }
  return { result, type };
}

function ordinal(i: number): string {
  return ["first", "second", "third", "fourth", "fifth"][i] ?? `${i + 1}th`;
}

/** The type `+` gives on values of one type, and whether adding nothing gives its identity (§13.15). */
function addType(t: EastType): EastType | undefined {
  const u = unwrap(t);
  const payload = nullablePayload(u);
  if (payload !== undefined) return addType(payload);
  switch (u.type) {
    case "Integer": case "Float": case "String": case "Array": case "Dict": return u;
    case "Null": return NullType;
    case "Struct": return orNull(u);
    default: return undefined;
  }
}

/** Validates a regular expression written in the query as an East one. */
function checkRegex(ctx: CallContext, i: number, flags: string): string[] | undefined {
  const literal = ctx.literal(i);
  if (literal === undefined) {
    const r = argOf(ctx, i, "a string", t => t.type === "String");
    return r === undefined ? undefined : [];
  }
  if (literal.type.type !== "String") {
    ctx.fail("type_mismatch", MESSAGES.argument(ctx.name, ordinal(i), "a string", describeType(literal.type)), { arg: i });
    return undefined;
  }
  const pattern = literal.value as string;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags.replace(/g/g, ""));
  } catch (e) {
    ctx.fail("type_mismatch", MESSAGES.regex(ctx.source(i), e instanceof Error ? e.message.replace(/^Invalid regular expression: /, "").replace(/\.$/, "") : "invalid"), { arg: i });
    return undefined;
  }
  const validation = validateCrossPlatformCompatible(regex);
  if (!validation.isValid) {
    ctx.fail("type_mismatch", MESSAGES.regex(ctx.source(i), validation.errors[0]!.replace(/\.$/, "")), { arg: i });
    return undefined;
  }
  return [...pattern.matchAll(/\(\?<([a-zA-Z_][a-zA-Z0-9_]*)>/g)].map(m => m[1]!);
}

/** A regex's flags, written in the query: `g` and `i`. */
function checkFlags(ctx: CallContext, i: number | undefined): string | undefined {
  if (i === undefined) return "";
  const flags = literalString(ctx, i, "flags");
  if (flags === undefined) return undefined;
  for (const flag of flags) {
    if (flag !== "g" && flag !== "i") {
      ctx.fail("unsupported", MESSAGES.regexFlag(flag), { arg: i });
      return undefined;
    }
  }
  return flags;
}

const printString = printFor(StringType);
const compareString = compareFor(StringType);
const encodeTokens = encodeBeast2For(ArrayType(DateTimeFormatTokenType));
const encodeStrings = encodeBeast2For(ArrayType(StringType));
const encodeBoolean = encodeBeast2For(BooleanType);

/** Rewrites a strftime/strptime format argument as its tokens. */
function rewriteFormat(ctx: CallContext): boolean {
  const format = literalString(ctx, 0, "format");
  if (format === undefined) return false;
  const tokens = formatTokens(format);
  if ("code" in tokens) {
    ctx.fail("unsupported", MESSAGES.formatCode(tokens.code), { arg: 0 });
    return false;
  }
  ctx.rewriteArg(0, variant("literal", encodeTokens(tokens.tokens)) as JqNode);
  return true;
}

/** A DateTime input, or a number of epoch seconds as jq's date builtins take. */
function dateInput(ctx: CallContext, then: EastType): Result {
  return onInput(ctx, "a DateTime or epoch seconds", t => t.type === "DateTime" || isNumber(t) ? one(then) : undefined);
}

/** The typing of a builtin on numbers, promoting Integer to Float. */
function math(output: "Float" | "Integer" | "same"): (ctx: CallContext) => Result {
  return ctx => onInput(ctx, "a number", t => {
    if (!isNumber(t)) return undefined;
    if (output === "same") return one(t);
    if (output === "Integer") return one(IntegerType);
    return one(FloatType);
  });
}

/** The typing of a builtin of two number arguments. */
function math2(ctx: CallContext): Result {
  const a = argOf(ctx, 0, "a number", isNumber);
  const b = argOf(ctx, 1, "a number", isNumber);
  if (a === undefined || b === undefined) return { shape: ERROR, mult: ONE };
  return one(FloatType, then(a.result.mult, b.result.mult));
}

/** A type selector (`numbers`, `strings`, …): each member is kept, dropped, or kept when present. */
function selector(keep: (t: EastType) => "keep" | "drop" | "maybe"): (ctx: CallContext) => Result {
  return ctx => perMember(ctx, ctx.input, member => {
    const t = unwrap(member.type);
    const payload = nullablePayload(t);
    if (payload !== undefined) {
      const inner = keep(unwrap(payload));
      const nullKept = keep(NullType);
      if (inner === "drop" && nullKept === "drop") return { shape: typed(NeverType), mult: ZERO };
      if (inner === "drop") return { shape: typed(NullType), mult: MAYBE };
      if (nullKept === "drop") return { shape: typed(payload), mult: MAYBE };
      return { shape: member, mult: ONE };
    }
    const k = keep(t);
    if (k === "drop") return { shape: typed(NeverType), mult: ZERO };
    return { shape: member, mult: k === "keep" ? ONE : MAYBE };
  });
}

/** Whether a type is a jq scalar: not an array, set, dict, struct, vector or matrix. */
function isScalar(t: EastType): boolean {
  const u = unwrap(t);
  if (nullablePayload(u) !== undefined) return isScalar(nullablePayload(u)!);
  return !["Array", "Set", "Dict", "Struct", "Vector", "Matrix"].includes(u.type) && !(u.type === "Variant");
}

/**
 * Runs a filter argument on each element of the input: for `map`, on the
 * values `.[]` gives (an object's too); for the `*_by` builtins, on an
 * array's elements.
 */
function eachElement(ctx: CallContext, i: number, expected: string, onEach: (element: Result, per: Result) => Result | undefined, arraysOnly = false): Result {
  return perMember(ctx, ctx.input, member => {
    const element = arraysOnly ? elements(member) : valuesOf(member);
    if (element === undefined) return inputMismatch(ctx, expected, member.type);
    const per = ctx.arg(i, element);
    if (per.shape.kind === "error") return { shape: ERROR, mult: ONE };
    return onEach(element, per) ?? { shape: ERROR, mult: ONE };
  });
}

/** An array of a result's outputs, carrying their facts. */
function arrayOf(ctx: CallContext, per: Result): Result | undefined {
  const t = ctx.collect(per);
  if (t === undefined) return undefined;
  const facts = per.shape.kind === "type" && per.shape.facts !== undefined ? { kind: "elements" as const, element: per.shape.facts } : undefined;
  return { shape: typed(ArrayType(t), facts), mult: ONE };
}

/** A filter that repeats: the one type its input and outputs settle on, by fixpoint. */
function settle(ctx: CallContext, argument: number, start: EastType): EastType | undefined {
  let type = start;
  for (let round = 0; round < 8; round++) {
    const out = ctx.arg(argument, one(type));
    if (out.shape.kind === "error") return undefined;
    const next = ctx.collect(out, argument);
    if (next === undefined) return undefined;
    const merged = unify(type, next);
    if (merged === undefined) {
      ctx.fail("cannot_infer", MESSAGES.accumulator(ctx.name, describeType(type), describeType(next)));
      return undefined;
    }
    if (isTypeEqual(merged, type)) return type;
    type = merged;
  }
  ctx.fail("cannot_infer", MESSAGES.accumulator(ctx.name, describeType(start), describeType(type)));
  return undefined;
}

/** The type of `.[]` taken `depth` times on arrays, for flatten. */
function flattened(t: EastType, depth: number): EastType {
  const u = unwrap(t);
  if (depth === 0 || u.type !== "Array") return t;
  const inner = unwrap(u.value as EastType);
  if (inner.type !== "Array") return t;
  return flattened(ArrayType(inner.value as EastType), depth - 1);
}

/** A struct without some fields. */
function withoutFields(t: EastType, names: readonly string[]): EastType {
  const u = unwrap(t);
  if (u.type !== "Struct") return t;
  const fields: Record<string, EastType> = {};
  for (const [name, f] of Object.entries(u.fields as Record<string, EastType>)) if (!names.includes(name)) fields[name] = f;
  return StructType(fields);
}

/**
 * A step of a path `del` deletes at: a field, an index or key, a slice, every
 * element (`.[]`), or the elements a `select` keeps.
 *
 * @internal
 */
export type DelStep =
  | { readonly kind: "field"; readonly name: string }
  | { readonly kind: "index"; readonly node: JqNode; readonly path: string }
  | { readonly kind: "slice"; readonly path: string }
  | { readonly kind: "iterate" }
  | { readonly kind: "select"; readonly path: string };

/**
 * The paths `del`'s argument names, each as its steps from `.`.
 *
 * @param node - the argument
 * @param path - its node path
 * @returns the paths, or `undefined` when the argument is not made of field
 *   reads, indexes, slices, `.[]`, `select`, `|` and `,`
 *
 * @internal
 */
export function delPaths(node: JqNode, path: string): DelStep[][] | undefined {
  const at = (step: string): string => path === "" ? step : `${path}.${step}`;
  const extend = (target: JqNode, step: string, last: DelStep): DelStep[][] | undefined =>
    delPaths(target, at(step))?.map(steps => [...steps, last]);
  switch (node.type) {
    case "identity":
      return [[]];
    case "comma": {
      const left = delPaths(node.value.left, at("comma.left"));
      const right = delPaths(node.value.right, at("comma.right"));
      return left === undefined || right === undefined ? undefined : [...left, ...right];
    }
    case "pipe": {
      const left = delPaths(node.value.left, at("pipe.left"));
      const right = delPaths(node.value.right, at("pipe.right"));
      return left === undefined || right === undefined ? undefined : left.flatMap(l => right.map(r => [...l, ...r]));
    }
    case "field":
      return extend(node.value.target, "field.target", { kind: "field", name: node.value.name });
    case "index":
      return extend(node.value.target, "index.target", { kind: "index", node: node.value.index, path: at("index.index") });
    case "slice":
      return extend(node.value.target, "slice.target", { kind: "slice", path });
    case "iterate":
      return extend(node.value.target, "iterate.target", { kind: "iterate" });
    case "call":
      if (node.value.name === "select" && node.value.args.length === 1) return [[{ kind: "select", path: at("call.args[0]") }]];
      if (node.value.name === "empty" && node.value.args.length === 0) return [];
      return undefined;
    default:
      return undefined;
  }
}

/** Whether a step's remaining steps delete the element itself: none left, or only a `select`. */
function deletesElement(rest: readonly DelStep[]): boolean {
  return rest.length === 0 || (rest.length === 1 && rest[0]!.kind === "select");
}

/**
 * The type a value has after `del` deletes at a path: a struct loses a field
 * it deletes; an array or dict keeps its type when elements are deleted, and
 * takes the new element type when every element changes alike.
 *
 * @returns the type, or `undefined` when the values left have no one type
 *   (one element of an array loses a field the others keep)
 */
function afterDelete(ctx: CallContext, type: EastType, steps: readonly DelStep[]): EastType | undefined {
  if (steps.length === 0) return NullType;
  const t = unwrap(type);
  if (t.type === "Null") return NullType;
  const payload = nullablePayload(t);
  if (payload !== undefined) {
    const inner = afterDelete(ctx, payload, steps);
    return inner === undefined ? undefined : orNull(inner);
  }
  const [step, ...rest] = steps as [DelStep, ...DelStep[]];
  // A change to some of a container's elements must leave their type as it was.
  const same = (element: EastType): boolean => {
    if (deletesElement(rest)) return true;
    const inner = afterDelete(ctx, element, rest);
    return inner !== undefined && isTypeEqual(inner, element);
  };
  const literalName = step.kind === "index" && step.node.type === "literal" ? ctx.literalOf(step.node) : undefined;
  const name = step.kind === "field" ? step.name : literalName?.type.type === "String" && t.type !== "Dict" ? literalName.value as string : undefined;
  if (name !== undefined) {
    if (t.type === "Struct") {
      const fields = t.fields as Record<string, EastType>;
      if (!(name in fields)) return t;
      if (deletesElement(rest)) {
        if (rest.length === 0) return withoutFields(t, [name]);
        return same(fields[name]!) ? t : undefined;
      }
      const inner = afterDelete(ctx, fields[name]!, rest);
      return inner === undefined ? undefined : StructType({ ...fields, [name]: inner });
    }
    if (t.type === "Dict") return same(t.value as EastType) ? t : undefined;
    return undefined;
  }
  switch (step.kind) {
    case "index": case "slice":
      if (t.type === "Dict") return same(t.value as EastType) ? t : undefined;
      if (t.type === "Array") return same(t.value as EastType) ? t : undefined;
      if (t.type === "String" && step.kind === "slice" && rest.length === 0) return t;
      return undefined;
    case "iterate": {
      if (t.type === "Array" || t.type === "Dict") {
        const element = t.value as EastType;
        if (deletesElement(rest)) return t;
        const inner = afterDelete(ctx, element, rest);
        if (inner === undefined) return undefined;
        return t.type === "Array" ? ArrayType(inner) : DictType(t.key as EastType, inner);
      }
      if (t.type === "Struct") {
        if (deletesElement(rest)) return rest.length === 0 ? StructType({}) : undefined;
        const fields: Record<string, EastType> = {};
        for (const [field, f] of Object.entries(t.fields as Record<string, EastType>)) {
          const inner = afterDelete(ctx, f, rest);
          if (inner === undefined) return undefined;
          fields[field] = inner;
        }
        return StructType(fields);
      }
      return undefined;
    }
    case "select":
      // The value is deleted (it becomes null) where the condition holds, or
      // what follows is; its type stays only when that leaves it as it was.
      if (rest.length === 0) return orNull(t);
      return same(t) ? t : undefined;
    default:
      return undefined;
  }
}

// ─── The catalog ─────────────────────────────────────────────────────────

const entries: [string, Builtin][] = [];

function supported(name: string, arities: readonly number[], east: string, typing: (ctx: CallContext) => Result): void {
  entries.push([name, { status: "supported", arities, east, typing }]);
}
/** Builtins by name, with jq's arities for each. */
type Arities = Readonly<Record<string, readonly number[]>>;

function excluded(builtins: Arities): void {
  for (const [name, arities] of Object.entries(builtins)) entries.push([name, { status: "excluded", arities, east: "—" }]);
}
function unavailable(builtins: Arities, reason: string): void {
  for (const [name, arities] of Object.entries(builtins)) entries.push([name, { status: "unavailable", arities, east: "—", reason }]);
}
/** The same arities for each of some names. */
function each(names: readonly string[], arities: readonly number[]): Arities {
  return Object.fromEntries(names.map(name => [name, arities]));
}

// Selection and streams.
supported("empty", [0], "no output", () => ({ shape: typed(NeverType), mult: ZERO }));
supported("error", [0, 1], "an East error whose message is the value's East text (§13.14)", ctx => {
  if (ctx.args.length === 1) {
    const message = ctx.arg(0);
    if (message.shape.kind === "error") return { shape: ERROR, mult: ONE };
  }
  return { shape: typed(NeverType), mult: ZERO };
});
supported("not", [0], "BooleanNot of jq's truthiness", () => one(BooleanType));
supported("select", [1], "a branch on jq's truthiness", ctx => {
  const condition = ctx.arg(0);
  if (condition.shape.kind === "error") return { shape: ERROR, mult: ONE };
  if (condition.mult.hi === 2) duplicateOutputs(ctx);
  const narrowed = condition.proves !== undefined ? ctx.narrow(ctx.input, condition.proves) : ctx.input;
  return { shape: narrowed.shape, mult: { lo: 0, hi: condition.mult.hi }, access: [], stream: ctx.input.stream };
});
/**
 * The `duplicate_outputs` lint: `select(f)` where `f` gives many values emits
 * its input once for each true one. The fix tests the generator with `any`:
 * `select(.x[] | cond)` and `select(.x[].y == v)` become
 * `select(any(.x[]; cond))` and `select(any(.x[]; .y == v))`.
 */
function duplicateOutputs(ctx: CallContext): void {
  const argPath = ctx.argPaths[0]!;
  const argRange = ctx.argRange(0);
  const many = (path: string): boolean => ctx.resultAt(path)?.mult.hi === 2;
  let generator: JqRange | undefined;
  let rest: string | undefined;
  const arg = ctx.args[0]!;
  if (arg.type === "pipe" && many(`${argPath}.pipe.left`)) {
    generator = ctx.rangeAt(`${argPath}.pipe.left`);
    const right = ctx.rangeAt(`${argPath}.pipe.right`);
    rest = right === undefined ? undefined : ctx.text.slice(right.from, right.to);
  } else {
    // The first `[]` on the condition's leftmost path of reads and operators.
    let node: JqNode = arg;
    let path = argPath;
    for (;;) {
      if (node.type === "iterate" && many(path)) { generator = ctx.rangeAt(path); break; }
      if (node.type === "binary") { node = node.value.left; path = `${path}.binary.left`; continue; }
      if (node.type === "field" || node.type === "index" || node.type === "slice" || node.type === "iterate") {
        path = `${path}.${node.type}.target`;
        node = node.value.target;
        continue;
      }
      break;
    }
    if (generator !== undefined && argRange !== undefined && generator.from === argRange.from) {
      const after = ctx.text.slice(generator.to, argRange.to);
      rest = `${after.startsWith(".") ? "" : "."}${after}`;
    }
  }
  if (generator === undefined || rest === undefined || argRange === undefined) {
    ctx.warn("duplicate_outputs", MESSAGES.duplicateOutputs(ctx.source(0)));
    return;
  }
  const text = ctx.text.slice(generator.from, generator.to);
  ctx.warn("duplicate_outputs", MESSAGES.duplicateOutputs(text), [
    edit(`Use any(${text}; …)`, argRange.from, argRange.to, `any(${text}; ${rest.trim()})`),
  ]);
}
supported("first", [0, 1], "ArrayTryGet(0); for first(f), the first output of f, then stop", ctx => {
  if (ctx.args.length === 1) {
    const f = ctx.arg(0);
    return { shape: f.shape, mult: { lo: f.mult.lo, hi: f.mult.hi === 0 ? 0 : 1 } };
  }
  return onInput(ctx, "an array", t => {
    if (t.type === "Null") return one(NullType);
    const e = elementOf(t);
    const r = e === undefined ? undefined : orNull(e);
    return r === undefined ? undefined : one(r);
  });
});
supported("last", [0, 1], "ArrayTryGet(size − 1); for last(f), the last output of f", ctx => {
  if (ctx.args.length === 1) {
    const f = ctx.arg(0);
    return { shape: f.shape, mult: { lo: f.mult.lo, hi: f.mult.hi === 0 ? 0 : 1 } };
  }
  return onInput(ctx, "an array", t => {
    if (t.type === "Null") return one(NullType);
    const e = elementOf(t);
    const r = e === undefined ? undefined : orNull(e);
    return r === undefined ? undefined : one(r);
  });
});
supported("nth", [1, 2], "ArrayTryGet(n); for nth(n; f), the nth output of f", ctx => {
  const n = argOf(ctx, 0, "an Integer", t => t.type === "Integer");
  if (n === undefined) return { shape: ERROR, mult: ONE };
  if (ctx.args.length === 2) {
    const f = ctx.arg(1);
    return { shape: f.shape, mult: { lo: 0, hi: f.mult.hi === 0 ? 0 : 1 } };
  }
  return onInput(ctx, "an array", t => {
    const e = elementOf(t);
    const r = e === undefined ? undefined : orNull(e);
    return r === undefined ? undefined : one(r, n.result.mult);
  });
});
supported("limit", [2], "the first n outputs of f, then stop", ctx => {
  const n = argOf(ctx, 0, "an Integer", t => t.type === "Integer");
  const f = ctx.arg(1);
  if (n === undefined || f.shape.kind === "error") return { shape: ERROR, mult: ONE };
  return { shape: f.shape, mult: { lo: 0, hi: f.mult.hi } };
});
supported("skip", [2], "the outputs of f after the first n", ctx => {
  const n = argOf(ctx, 0, "an Integer", t => t.type === "Integer");
  const f = ctx.arg(1);
  if (n === undefined || f.shape.kind === "error") return { shape: ERROR, mult: ONE };
  return { shape: f.shape, mult: { lo: 0, hi: f.mult.hi } };
});
supported("isempty", [1], "whether f gives no output, stopping at the first", ctx => {
  const f = ctx.arg(0);
  return f.shape.kind === "error" ? { shape: ERROR, mult: ONE } : one(BooleanType);
});
supported("range", [1, 2, 3], "ArrayRange, or a Float loop, streamed", ctx => {
  const args = ctx.args.map((_, i) => argOf(ctx, i, "a number", isNumber));
  if (args.some(a => a === undefined)) return { shape: ERROR, mult: ONE };
  const float = args.some(a => unwrap(a!.type).type === "Float");
  const literals = ctx.args.map((_, i) => ctx.literal(i));
  if (literals.every(l => l !== undefined && isNumber(l.type))) {
    const nums = literals.map(l => Number(l!.value as number | bigint));
    const [from, upto, by] = nums.length === 1 ? [0, nums[0]!, 1] : nums.length === 2 ? [nums[0]!, nums[1]!, 1] : [nums[0]!, nums[1]!, nums[2]!];
    const count = by > 0 ? Math.max(0, Math.ceil((upto - from) / by)) : by < 0 ? Math.max(0, Math.ceil((from - upto) / -by)) : 0;
    if (count === 0) return ctx.fail("type_mismatch", MESSAGES.emptyRange(ctx.source()));
    if (count > 1000) ctx.warn("long_range", MESSAGES.longRange(ctx.source(), count.toLocaleString("en-US").replace(/,/g, " ")));
  }
  const mult = args.reduce((m, a) => then(m, a!.result.mult), ONE);
  return { shape: typed(float ? FloatType : IntegerType), mult: then(mult, MANY) };
});
supported("recurse", [0, 1, 2], "a depth-first walk with an explicit stack", ctx => {
  if (ctx.args.length === 0) {
    if (ctx.refuseRoot()) return { shape: ERROR, mult: ONE };
    const seen: EastType[] = [];
    const members: Member[] = [];
    const visit = (t: EastType): void => {
      if (seen.some(s => isTypeEqual(s, t))) return;
      seen.push(t);
      members.push({ shape: typed(t), case: undefined });
      const u = unwrap(t);
      const inner = elementOf(u) ?? (u.type === "Dict" ? u.value as EastType : undefined);
      if (inner !== undefined) visit(inner);
      if (u.type === "Struct") for (const f of Object.values(u.fields as Record<string, EastType>)) visit(f);
    };
    for (const t of typesOf(ctx.input)) visit(t);
    return { shape: union(members), mult: MANY };
  }
  const start = ctx.collect(ctx.input);
  if (start === undefined) return { shape: ERROR, mult: ONE };
  const type = settle(ctx, 0, start);
  if (type === undefined) return { shape: ERROR, mult: ONE };
  if (ctx.args.length === 2) {
    const cond = ctx.arg(1, one(type));
    if (cond.shape.kind === "error") return { shape: ERROR, mult: ONE };
  }
  return { shape: typed(type), mult: { lo: 1, hi: 2 } };
});
supported("until", [2], "a loop: update while cond is false", ctx => {
  const start = ctx.collect(ctx.input);
  if (start === undefined) return { shape: ERROR, mult: ONE };
  const type = settle(ctx, 1, start);
  if (type === undefined) return { shape: ERROR, mult: ONE };
  const cond = ctx.arg(0, one(type));
  if (cond.shape.kind === "error") return { shape: ERROR, mult: ONE };
  return one(type);
});
supported("while", [2], "a loop: each value while cond holds", ctx => {
  const start = ctx.collect(ctx.input);
  if (start === undefined) return { shape: ERROR, mult: ONE };
  const type = settle(ctx, 1, start);
  if (type === undefined) return { shape: ERROR, mult: ONE };
  const cond = ctx.arg(0, one(type));
  if (cond.shape.kind === "error") return { shape: ERROR, mult: ONE };
  return { shape: typed(type), mult: MANY };
});
supported("repeat", [1], "a loop: the value, then f of it, and so on", ctx => {
  const start = ctx.collect(ctx.input);
  if (start === undefined) return { shape: ERROR, mult: ONE };
  const type = settle(ctx, 0, start);
  if (type === undefined) return { shape: ERROR, mult: ONE };
  return { shape: typed(type), mult: MANY };
});
supported("combinations", [0, 1], "nested loops over the arrays", ctx => {
  if (ctx.args.length === 1) {
    const n = argOf(ctx, 0, "an Integer", t => t.type === "Integer");
    if (n === undefined) return { shape: ERROR, mult: ONE };
    return onInput(ctx, "an array", t => t.type === "Array" ? { shape: typed(t), mult: MANY } : undefined);
  }
  return onInput(ctx, "an array of arrays", t => {
    if (t.type !== "Array") return undefined;
    const inner = unwrap(t.value as EastType);
    return inner.type === "Array" ? { shape: typed(inner), mult: MANY } : undefined;
  });
});
supported("walk", [1], "a bottom-up rebuild, applying f to each value", ctx => {
  if (ctx.refuseRoot()) return { shape: ERROR, mult: ONE };
  const start = ctx.collect(ctx.input);
  if (start === undefined) return { shape: ERROR, mult: ONE };
  const memo = new Map<EastType, EastType | undefined>();
  const walkType = (t: EastType): EastType | undefined => {
    if (memo.has(t)) return memo.get(t);
    memo.set(t, t);
    const u = unwrap(t);
    let rebuilt: EastType = t;
    if (t.type !== "Recursive") {
      if (u.type === "Array") { const e = walkType(u.value as EastType); if (e === undefined) return undefined; rebuilt = ArrayType(e); }
      else if (u.type === "Dict") { const v = walkType(u.value as EastType); if (v === undefined) return undefined; rebuilt = DictType(u.key as EastType, v); }
      else if (u.type === "Struct") {
        const fields: Record<string, EastType> = {};
        for (const [name, f] of Object.entries(u.fields as Record<string, EastType>)) { const w = walkType(f); if (w === undefined) return undefined; fields[name] = w; }
        rebuilt = StructType(fields);
      }
    }
    const out = ctx.arg(0, one(rebuilt));
    if (out.shape.kind === "error") return undefined;
    if (out.mult.lo !== 1 || out.mult.hi !== 1) {
      ctx.fail("unsupported", MESSAGES.unavailable("walk(f)", "f must give one output for each value"));
      return undefined;
    }
    const result = ctx.collect(out);
    if (result === undefined) return undefined;
    if (t.type === "Recursive" && !isTypeEqual(result, t)) {
      ctx.fail("cannot_infer", MESSAGES.accumulator("walk", describeType(t), describeType(result)));
      return undefined;
    }
    memo.set(t, result);
    return result;
  };
  const type = walkType(start);
  return type === undefined ? { shape: ERROR, mult: ONE } : one(type);
});
supported("IN", [1, 2], "Equal against each output, stopping at the first match", ctx => {
  const parts = ctx.args.map((_, i) => ctx.arg(i));
  if (parts.some(p => p.shape.kind === "error")) return { shape: ERROR, mult: ONE };
  return one(BooleanType);
});
supported("INDEX", [1, 2], "ArrayToDict keyed by the index filter (keys keep their type, §13.2)", ctx => {
  const rows = ctx.args.length === 2 ? ctx.arg(0) : (() => {
    const r = perMember(ctx, ctx.input, member => valuesOf(member) ?? inputMismatch(ctx, "an array", member.type));
    return { ...r, mult: MANY };
  })();
  if (rows.shape.kind === "error") return { shape: ERROR, mult: ONE };
  const row = ctx.collect(rows);
  if (row === undefined) return { shape: ERROR, mult: ONE };
  const key = argOf(ctx, ctx.args.length - 1, "an immutable value", t => isImmutableType(t), one(row));
  if (key === undefined) return { shape: ERROR, mult: ONE };
  return one(DictType(key.type, row));
});
unavailable({ JOIN: [2, 3, 4] }, "its pairs [row, match] hold two types, which one East array cannot");
unavailable({ getpath: [1], setpath: [2], delpaths: [1] },
  "a path array mixes strings and integers, which no one East type holds; write the path as field reads and indexes, .a.b[0]");
unavailable({ path: [1], paths: [0, 1], tostream: [0], fromstream: [1], truncate_stream: [1] },
  "a path array mixes strings and integers, which no one East type holds");
supported("del", [1], "a rebuild without the positions the path names", ctx => {
  const paths = delPaths(ctx.args[0]!, ctx.argPaths[0]!);
  if (paths === undefined) return ctx.fail("unsupported", MESSAGES.unavailable(`del(${ctx.source(0)})`, "del takes field reads, indexes, slices, .[], select and ,"), { arg: 0 });
  // The path reads what it deletes, so it is checked as a read first.
  const read = ctx.arg(0);
  if (read.shape.kind === "error") return { shape: ERROR, mult: ONE };
  return perMember(ctx, ctx.input, member => {
    let type: EastType = member.type;
    for (const steps of paths) {
      const next = afterDelete(ctx, type, steps);
      if (next === undefined) return ctx.fail("ambiguous_output", MESSAGES.mixedDelete(`del(${ctx.source(0)})`), { arg: 0 });
      type = next;
    }
    return one(type);
  });
});
supported("to_entries", [0], "DictToArray / the struct's fields as {key, value}", ctx => {
  if (ctx.refuseRoot()) return { shape: ERROR, mult: ONE };
  return onInput(ctx, "a dict, a struct or an array", t => {
    if (t.type === "Dict") return one(ArrayType(StructType({ key: t.key as EastType, value: t.value as EastType })));
    if (t.type === "Struct") {
      let value: EastType = NeverType;
      for (const f of Object.values(t.fields as Record<string, EastType>)) {
        const next = unify(value, f);
        if (next === undefined) return ctx.fail("ambiguous_output", MESSAGES.noCommonType(describeType(value), describeType(f)));
        value = next;
      }
      return one(ArrayType(StructType({ key: StringType, value })));
    }
    const e = elementOf(t);
    return e === undefined ? undefined : one(ArrayType(StructType({ key: IntegerType, value: e })));
  });
});
/** The key and value fields a from_entries entry can have, as jq accepts them. */
const KEY_FIELDS = ["key", "k", "name", "Name", "K", "Key"];
const VALUE_FIELDS = ["value", "v", "Value", "V"];
function fromEntries(ctx: CallContext, entries: Result): Result {
  return perMember(ctx, entries, member => {
    const t = unwrap(member.type);
    if (t.type !== "Array") return inputMismatch(ctx, "an array of {key, value}", member.type);
    const entry = unwrap(t.value as EastType);
    if (entry.type !== "Struct") return inputMismatch(ctx, "an array of {key, value}", member.type);
    const fields = entry.fields as Record<string, EastType>;
    const key = KEY_FIELDS.find(k => k in fields);
    const value = VALUE_FIELDS.find(v => v in fields);
    if (key === undefined) return inputMismatch(ctx, "an array of {key, value}", member.type);
    const keyType = fields[key]!;
    if (!isImmutableType(keyType)) return ctx.fail("type_mismatch", MESSAGES.mutableKey(`.${key}`, describeType(keyType)));
    return one(DictType(keyType, value === undefined ? NullType : fields[value]!));
  });
}
supported("from_entries", [0], "ArrayToDict by the entries' key and value", ctx => fromEntries(ctx, ctx.input));
supported("with_entries", [1], "to_entries, map(f), from_entries", ctx => {
  if (ctx.refuseRoot()) return { shape: ERROR, mult: ONE };
  const entries = onInput(ctx, "a dict or a struct", t => {
    if (t.type === "Dict") return one(StructType({ key: t.key as EastType, value: t.value as EastType }));
    if (t.type === "Struct") {
      let value: EastType = NeverType;
      for (const f of Object.values(t.fields as Record<string, EastType>)) {
        const next = unify(value, f);
        if (next === undefined) return ctx.fail("ambiguous_output", MESSAGES.noCommonType(describeType(value), describeType(f)));
        value = next;
      }
      return one(StructType({ key: StringType, value }));
    }
    return undefined;
  });
  if (entries.shape.kind === "error") return entries;
  const mapped = ctx.arg(0, { shape: entries.shape, mult: ONE });
  const t = ctx.collect(mapped);
  if (t === undefined) return { shape: ERROR, mult: ONE };
  return fromEntries(ctx, one(ArrayType(t)));
});
supported("pick", [1], "a struct of the picked fields", ctx => {
  let node = ctx.args[0]!;
  const fields: string[] = [];
  while (node.type === "field") { fields.unshift(node.value.name); node = node.value.target; }
  if (node.type !== "identity" || fields.length === 0) return ctx.fail("unsupported", MESSAGES.unavailable("pick of this path", "pick takes field reads: pick(.a.b)"), { arg: 0 });
  return perMember(ctx, ctx.input, member => {
    const build = (t: EastType, rest: readonly string[]): EastType | undefined => {
      const u = unwrap(t);
      if (u.type !== "Struct" || !(rest[0]! in (u.fields as Record<string, EastType>))) return undefined;
      const inner = (u.fields as Record<string, EastType>)[rest[0]!]!;
      const picked = rest.length === 1 ? inner : build(inner, rest.slice(1));
      return picked === undefined ? undefined : StructType({ [rest[0]!]: picked });
    };
    const out = build(member.type, fields);
    return out === undefined ? inputMismatch(ctx, `a struct with .${fields.join(".")}`, member.type) : one(out);
  });
});
supported("transpose", [0], "nested loops, padding short rows with null", ctx => onInput(ctx, "an array of arrays", t => {
  if (t.type !== "Array") return undefined;
  const row = unwrap(t.value as EastType);
  if (row.type !== "Array") return undefined;
  const cell = orNull(row.value as EastType);
  return cell === undefined ? undefined : one(ArrayType(ArrayType(cell)));
}));

// Collections.
supported("length", [0], "StringLength, ArraySize, SetSize, DictSize, BlobSize, the field count, abs", ctx => onInput(ctx, "a value with a length", t => {
  const payload = nullablePayload(t);
  const u = payload === undefined ? t : unwrap(payload);
  switch (u.type) {
    case "Null": case "String": case "Array": case "Set": case "Dict": case "Vector": case "Matrix": case "Struct": case "Blob": case "Integer":
      return one(IntegerType);
    case "Float": return one(FloatType);
    case "Variant": return one(IntegerType);
    default: return undefined;
  }
}));
supported("utf8bytelength", [0], "BlobSize of StringEncodeUtf8", ctx => onInput(ctx, "a string", t => t.type === "String" ? one(IntegerType) : undefined));
supported("keys", [0], "DictKeys, the struct's field names sorted, the indices", ctx => keys(ctx, true));
supported("keys_unsorted", [0], "DictKeys, the struct's field names in declared order (§13.12), the indices", ctx => keys(ctx, false));
function keys(ctx: CallContext, sorted: boolean): Result {
  return onInput(ctx, "a dict, a struct or an array", (t, member) => {
    if (t.type === "Dict") return one(ArrayType(t.key as EastType));
    if (t.type === "Struct") {
      const names = Object.keys(t.fields as Record<string, EastType>);
      if (ctx.isRoot(member)) {
        const ordered = sorted ? [...names].sort(compareString) : names;
        ctx.rewrite(variant("literal", encodeStrings(ordered)) as JqNode);
      }
      return one(ArrayType(StringType));
    }
    if (t.type === "Variant" && nullablePayload(t) === undefined) return one(ArrayType(StringType));
    return elementOf(t) === undefined ? undefined : one(ArrayType(IntegerType));
  });
}
supported("has", [1], "DictHas, the struct's field names, ArraySize", ctx => {
  const key = ctx.arg(0);
  if (key.shape.kind === "error") return { shape: ERROR, mult: ONE };
  const keyType = ctx.collect(key, 0);
  if (keyType === undefined) return { shape: ERROR, mult: ONE };
  return onInput(ctx, "a dict, a struct or an array", (t, member) => {
    if (t.type === "Dict") {
      return isTypeEqual(unwrap(keyType), unwrap(t.key as EastType)) ? one(BooleanType, key.mult)
        : ctx.fail("type_mismatch", MESSAGES.keyType("has", describeType(t.key as EastType), ctx.source(0), describeType(keyType)), { arg: 0 });
    }
    if (t.type === "Struct") {
      if (unwrap(keyType).type !== "String") return ctx.fail("type_mismatch", MESSAGES.keyType("has", "String", ctx.source(0), describeType(keyType)), { arg: 0 });
      const literal = ctx.literal(0);
      if (ctx.isRoot(member) && literal !== undefined) {
        ctx.rewrite(variant("literal", encodeBoolean((literal.value as string) in (t.fields as Record<string, EastType>))) as JqNode);
      }
      return one(BooleanType, key.mult);
    }
    if (elementOf(t) !== undefined) {
      return unwrap(keyType).type === "Integer" ? one(BooleanType, key.mult)
        : ctx.fail("type_mismatch", MESSAGES.keyType("has", "Integer", ctx.source(0), describeType(keyType)), { arg: 0 });
    }
    return undefined;
  });
});
supported("in", [1], "has, on the argument", ctx => {
  const container = ctx.arg(0);
  if (container.shape.kind === "error") return { shape: ERROR, mult: ONE };
  return one(BooleanType, container.mult);
});
supported("map", [1], "ArrayMap / SetToArray / DictToArray of f (f's outputs collected)", ctx => {
  if (ctx.refuseRoot()) return { shape: ERROR, mult: ONE };
  return eachElement(ctx, 0, "an array", (_element, per) => arrayOf(ctx, per));
});
supported("map_values", [1], "ArrayMap / DictMap / the struct rebuilt field by field, with f's first output", ctx => {
  if (ctx.refuseRoot()) return { shape: ERROR, mult: ONE };
  return perMember(ctx, ctx.input, member => {
    const t = unwrap(member.type);
    if (t.type === "Array" || t.type === "Dict") {
      const per = ctx.arg(0, valuesOf(member)!);
      const v = ctx.collect(per);
      if (v === undefined) return { shape: ERROR, mult: ONE };
      return one(t.type === "Array" ? ArrayType(v) : DictType(t.key as EastType, v));
    }
    if (t.type === "Struct") {
      const fields: Record<string, EastType> = {};
      for (const [name, f] of Object.entries(t.fields as Record<string, EastType>)) {
        const per = ctx.arg(0, one(f));
        if (per.shape.kind === "error") return { shape: ERROR, mult: ONE };
        if (per.mult.lo !== 1) return ctx.fail("unsupported", MESSAGES.unavailable("map_values(f) on a struct", "f must give an output for every field, which a struct cannot lose"));
        const v = ctx.collect(per);
        if (v === undefined) return { shape: ERROR, mult: ONE };
        fields[name] = v;
      }
      return one(StructType(fields));
    }
    return inputMismatch(ctx, "an array, a dict or a struct", member.type);
  });
});
supported("add", [0, 1], "ArrayFold of the matching add builtin (adding nothing gives its identity, §13.15)", ctx => {
  if (ctx.refuseRoot()) return { shape: ERROR, mult: ONE };
  const values = ctx.args.length === 1 ? ctx.arg(0) : perMember(ctx, ctx.input, member => valuesOf(member) ?? inputMismatch(ctx, "an array", member.type));
  if (values.shape.kind === "error") return { shape: ERROR, mult: ONE };
  const t = ctx.collect(values);
  if (t === undefined) return { shape: ERROR, mult: ONE };
  if (t.type === "Never") return one(NullType);
  const added = addType(t);
  if (added === undefined) return ctx.mismatch("type_mismatch", MESSAGES.input("add", "numbers, strings, arrays, structs or dicts", describeType(t)));
  return one(added);
});
for (const [name, arities] of [["any", [0, 1, 2]], ["all", [0, 1, 2]]] as const) {
  supported(name, arities, `a loop on jq's truthiness, stopping at the first ${name === "any" ? "true" : "false"}`, ctx => {
    if (ctx.args.length === 2) {
      const gen = ctx.arg(0);
      if (gen.shape.kind === "error") return { shape: ERROR, mult: ONE };
      const cond = ctx.arg(1, { shape: gen.shape, mult: ONE });
      return cond.shape.kind === "error" ? cond : one(BooleanType);
    }
    return eachElementOrSelf(ctx);
  });
}
function eachElementOrSelf(ctx: CallContext): Result {
  return perMember(ctx, ctx.input, member => {
    const element = valuesOf(member);
    if (element === undefined) return inputMismatch(ctx, "an array", member.type);
    if (ctx.args.length === 1) {
      const cond = ctx.arg(0, element);
      if (cond.shape.kind === "error") return cond;
    }
    return one(BooleanType);
  });
}
supported("flatten", [0, 1], "ArrayFlattenToArray, depth times", ctx => {
  let depth = 1_000;
  if (ctx.args.length === 1) {
    const d = literalInteger(ctx, 0, "depth");
    if (d === undefined) return { shape: ERROR, mult: ONE };
    depth = Number(d);
  }
  return onInput(ctx, "an array", t => t.type === "Array" ? one(flattened(t, depth)) : undefined);
});
supported("sort", [0], "ArraySort by the value (East's total order, §11)", ctx => onInput(ctx, "an array of ordered values", t => {
  const e = elementOf(t);
  if (e === undefined || t.type === "Matrix") return undefined;
  return isOrdered(e) ? one(ArrayType(e)) : undefined;
}));
for (const [name, output] of [["sort_by", "array"], ["group_by", "groups"], ["unique_by", "array"], ["min_by", "element"], ["max_by", "element"]] as const) {
  supported(name, [1], output === "groups" ? "ArrayGroupFold by the key, in key order" : `${name === "sort_by" ? "ArraySort" : name === "unique_by" ? "ArrayToDict by the key" : "ArrayFold"} by the key f gives`, ctx => eachElement(ctx, 0, "an array", (element, per) => {
    const key = ctx.collect(per, 0);
    if (key === undefined) return undefined;
    if (!isOrdered(key)) return ctx.fail("type_mismatch", MESSAGES.argument(ctx.name, "first", "an ordered key", describeType(key)), { arg: 0 });
    const e = element.shape.kind === "type" ? element.shape.type : NeverType;
    const facts = element.shape.kind === "type" && element.shape.facts !== undefined ? { kind: "elements" as const, element: element.shape.facts } : undefined;
    if (output === "groups") return { shape: typed(ArrayType(ArrayType(e)), facts !== undefined ? { kind: "elements", element: facts } : undefined), mult: ONE };
    if (output === "element") return one(orNull(e) ?? e);
    return { shape: typed(ArrayType(e), facts), mult: ONE };
  }, true));
}
supported("unique", [0], "ArrayToSet, as an array", ctx => onInput(ctx, "an array of ordered values", t => {
  const e = elementOf(t);
  return e !== undefined && isOrdered(e) ? one(ArrayType(e)) : undefined;
}));
for (const name of ["min", "max"] as const) {
  supported(name, [0], `ArrayFold keeping the ${name === "min" ? "least" : "greatest"} (null for an empty array)`, ctx => onInput(ctx, "an array of ordered values", t => {
    const e = elementOf(t);
    if (e === undefined || !isOrdered(e)) return undefined;
    const r = orNull(e);
    return r === undefined ? undefined : one(r);
  }));
}
supported("reverse", [0], "ArrayReverse; a string's code points reversed", ctx => onInput(ctx, "an array or a string", t => {
  if (t.type === "String") return one(StringType);
  if (t.type === "Null") return one(ArrayType(NeverType));
  const e = elementOf(t);
  return e === undefined ? undefined : one(ArrayType(e));
}));
supported("contains", [1], "StringContains; for arrays, a loop of StringContains / Equal", containment);
supported("inside", [1], "contains, the other way round", containment);
/** `contains` and `inside`: two strings, or two arrays of scalars of one type; either way round, the types match alike. */
function containment(ctx: CallContext): Result {
  const other = argOf(ctx, 0, "a string or an array of scalars", t => t.type === "String" || (t.type === "Array" && isScalar(t.value as EastType)));
  if (other === undefined) return { shape: ERROR, mult: ONE };
  return onInput(ctx, "a string or an array of scalars", t => {
    const o = unwrap(other.type);
    if (t.type === "String" && o.type === "String") return one(BooleanType, other.result.mult);
    if (t.type === "Array" && o.type === "Array" && isScalar(t.value as EastType) && unify(t.value as EastType, o.value as EastType) !== undefined) return one(BooleanType, other.result.mult);
    return undefined;
  });
}
for (const [name, output] of [["index", "first"], ["rindex", "last"], ["indices", "all"]] as const) {
  supported(name, [1], `StringIndexOf${output === "first" ? "" : " in a loop"} (strings)`, ctx => {
    const s = argOf(ctx, 0, "a string", t => t.type === "String");
    if (s === undefined) return { shape: ERROR, mult: ONE };
    return onInput(ctx, "a string", t => t.type === "String" ? one(output === "all" ? ArrayType(IntegerType) : orNull(IntegerType)!, s.result.mult) : undefined);
  });
}
supported("bsearch", [1], "ArrayFindSortedFirst, with jq's −1 − insertion point when absent", ctx => {
  const x = ctx.arg(0);
  if (x.shape.kind === "error") return { shape: ERROR, mult: ONE };
  return onInput(ctx, "a sorted array", t => {
    const e = elementOf(t);
    const xt = ctx.collect(x, 0);
    if (e === undefined || xt === undefined) return undefined;
    return unify(e, xt) === undefined ? ctx.fail("type_mismatch", MESSAGES.argument("bsearch", "first", describeType(e), describeType(xt)), { arg: 0 }) : one(IntegerType, x.mult);
  });
});
supported("join", [1], "ArrayStringJoin of the elements as text (null as \"\")", ctx => {
  const sep = argOf(ctx, 0, "a string", t => t.type === "String");
  if (sep === undefined) return { shape: ERROR, mult: ONE };
  return onInput(ctx, "an array of strings, numbers, booleans or nulls", t => {
    const e = elementOf(t);
    if (e === undefined) return undefined;
    const u = unwrap(nullablePayload(unwrap(e)) ?? e);
    return ["String", "Integer", "Float", "Boolean", "Null"].includes(u.type) ? one(StringType, sep.result.mult) : undefined;
  });
});

// Types and conversion.
supported("type", [0], "the jq type name of the value's East type, as a literal or by the option's case (§2)", () => ({ shape: typed(StringType), mult: ONE, typeOf: [] }));
supported("arrays", [0], "a type test", selector(t => elementOf(t) !== undefined ? "keep" : "drop"));
supported("objects", [0], "a type test", selector(t => t.type === "Struct" || t.type === "Dict" || t.type === "Variant" ? "keep" : "drop"));
supported("iterables", [0], "a type test", selector(t => elementOf(t) !== undefined || t.type === "Struct" || t.type === "Dict" ? "keep" : "drop"));
supported("booleans", [0], "a type test", selector(t => t.type === "Boolean" ? "keep" : "drop"));
supported("numbers", [0], "a type test", selector(t => isNumber(t) ? "keep" : "drop"));
supported("strings", [0], "a type test", selector(t => t.type === "String" ? "keep" : "drop"));
supported("nulls", [0], "a type test", selector(t => t.type === "Null" ? "keep" : "drop"));
supported("values", [0], "a type test", selector(t => t.type === "Null" ? "drop" : "keep"));
supported("scalars", [0], "a type test", selector(t => isScalar(t) ? "keep" : "drop"));
supported("normals", [0], "a type test and FloatAbs ≥ 2⁻¹⁰²²", selector(t => isNumber(t) ? "maybe" : "drop"));
supported("finites", [0], "a type test and a comparison with ±Infinity", selector(t => t.type === "Integer" ? "keep" : t.type === "Float" ? "maybe" : "drop"));
supported("tostring", [0], "the string, or Print (East text, §13.9)", ctx => {
  if (ctx.refuseRoot()) return { shape: ERROR, mult: ONE };
  return onInput(ctx, "a data value", t => t.type === "Function" || t.type === "AsyncFunction" ? undefined : one(StringType));
});
supported("tojson", [0], "StringPrintJSON (East's JSON codec, §13.9)", ctx => {
  if (ctx.refuseRoot()) return { shape: ERROR, mult: ONE };
  return onInput(ctx, "a data value", t => t.type === "Function" || t.type === "AsyncFunction" ? undefined : one(StringType));
});
supported("tonumber", [0], "Parse as a Float; numbers as they are", ctx => onInput(ctx, "a string or a number", t => {
  if (isNumber(t)) return one(t);
  return t.type === "String" ? one(FloatType) : undefined;
}));
supported("toboolean", [0], "Parse as a Boolean; booleans as they are", ctx => onInput(ctx, "a string or a boolean", t => t.type === "String" || t.type === "Boolean" ? one(BooleanType) : undefined));
supported("builtins", [0], "the catalog's names, as a literal", () => one(ArrayType(StringType)));
supported("infinite", [0], "the Float Infinity", () => one(FloatType));
supported("nan", [0], "the Float NaN", () => one(FloatType));
for (const name of ["isfinite", "isinfinite", "isnan", "isnormal"]) {
  supported(name, [0], "FloatAbs and comparisons", ctx => onInput(ctx, "a number", t => isNumber(t) ? one(BooleanType) : undefined));
}
supported("abs", [0], "IntegerAbs / FloatAbs", math("same"));
unavailable({ fromjson: [0] }, "its result has no static type; parse into a known type in the program that runs the query");
unavailable(each(["implode", "explode"], [0]), "East has no builtin between a string and its code points");
unavailable(each(["have_decnum", "have_literal_numbers"], [0]), "it describes jq's build, not the data");
unavailable({ splits: [1, 2] }, "East regular expressions have no regex split");
unavailable(each(["match", "capture", "scan"], [1, 2]), "East regular expressions have no capture groups (§13.8)");
unavailable(each(["@base64d", "@base32d"], [0]), "no East builtin makes a Blob from bytes");

// Strings.
for (const name of ["startswith", "endswith"]) {
  supported(name, [1], name === "startswith" ? "StringStartsWith" : "StringEndsWith", ctx => {
    const s = argOf(ctx, 0, "a string", t => t.type === "String");
    if (s === undefined) return { shape: ERROR, mult: ONE };
    return onInput(ctx, "a string", t => t.type === "String" ? one(BooleanType, s.result.mult) : undefined);
  });
}
for (const name of ["ltrimstr", "rtrimstr", "trimstr"]) {
  supported(name, [1], "StringStartsWith / StringEndsWith and StringSubstring; other values as they are", ctx => {
    const s = argOf(ctx, 0, "a string", t => t.type === "String");
    if (s === undefined) return { shape: ERROR, mult: ONE };
    return { shape: ctx.input.shape, mult: s.result.mult };
  });
}
for (const [name, east] of [["trim", "StringTrim"], ["ltrim", "StringTrimStart"], ["rtrim", "StringTrimEnd"], ["ascii_downcase", "StringLowerCase"], ["ascii_upcase", "StringUpperCase"]] as const) {
  supported(name, [0], east, ctx => onInput(ctx, "a string", t => t.type === "String" ? one(StringType) : undefined));
}
supported("split", [1, 2], "StringSplit (a literal separator)", ctx => {
  if (ctx.args.length === 2) return ctx.fail("unsupported", MESSAGES.unavailable("split(re; flags)", "East regular expressions have no regex split"));
  const sep = argOf(ctx, 0, "a string", t => t.type === "String");
  if (sep === undefined) return { shape: ERROR, mult: ONE };
  return onInput(ctx, "a string", t => t.type === "String" ? one(ArrayType(StringType), sep.result.mult) : undefined);
});
supported("test", [1, 2], "RegexContains", ctx => {
  const flags = checkFlags(ctx, ctx.args.length === 2 ? 1 : undefined);
  if (flags === undefined || checkRegex(ctx, 0, flags) === undefined) return { shape: ERROR, mult: ONE };
  return onInput(ctx, "a string", t => t.type === "String" ? one(BooleanType) : undefined);
});
for (const name of ["sub", "gsub"]) {
  supported(name, [2, 3], name === "gsub" ? "RegexReplace, captures as $<name>" : "RegexReplace of ^([\\s\\S]*?)(?:re), captures as $<name>", ctx => {
    const flags = checkFlags(ctx, ctx.args.length === 3 ? 2 : undefined);
    if (flags === undefined) return { shape: ERROR, mult: ONE };
    const groups = checkRegex(ctx, 0, flags);
    if (groups === undefined) return { shape: ERROR, mult: ONE };
    const replacement = ctx.args[1]!;
    const capture = (n: JqNode): boolean => (n.type === "field" && n.value.target.type === "identity" && groups.includes(n.value.name)) || n.type === "variable";
    const ok = (replacement.type === "literal" && ctx.literal(1)?.type.type === "String") || capture(replacement)
      || (replacement.type === "string" && replacement.value.every(part => part.type === "text" || capture(part.value)));
    if (!ok) return ctx.fail("type_mismatch", MESSAGES.replacement(name), { arg: 1 });
    // The replacement reads the named groups: check it on them, as strings.
    const r = ctx.arg(1, one(StructType(Object.fromEntries(groups.map(g => [g, StringType])))));
    if (r.shape.kind === "error") return r;
    return onInput(ctx, "a string", t => t.type === "String" ? one(StringType) : undefined);
  });
}
supported("format", [1], "the format of that name", ctx => {
  const name = literalString(ctx, 0, "format name");
  if (name === undefined) return { shape: ERROR, mult: ONE };
  const format = BUILTINS.get(`@${name}`);
  if (format === undefined || format.status !== "supported") return ctx.fail("unsupported", MESSAGES.unavailable(`format("${name}")`, "it is not a format a query can use"), { arg: 0 });
  return format.typing!(ctx);
});

// Formats.
supported("@text", [0], "tostring", ctx => onInput(ctx, "a data value", () => one(StringType)));
supported("@json", [0], "StringPrintJSON", ctx => onInput(ctx, "a data value", () => one(StringType)));
supported("@html", [0], "tostring, then StringReplace of < > & ' \"", ctx => onInput(ctx, "a data value", () => one(StringType)));
supported("@uri", [0], "tostring, then each code point kept or percent-encoded from StringEncodeUtf8", ctx => onInput(ctx, "a data value", () => one(StringType)));
supported("@base64", [0], "tostring, StringEncodeUtf8, then RFC 4648 over BlobGetUint8", ctx => onInput(ctx, "a data value", () => one(StringType)));
supported("@base32", [0], "tostring, StringEncodeUtf8, then RFC 4648 over BlobGetUint8", ctx => onInput(ctx, "a data value", () => one(StringType)));
for (const name of ["@csv", "@tsv"]) {
  supported(name, [0], "ArrayStringJoin of the quoted cells", ctx => onInput(ctx, "an array of scalars", t => {
    const e = elementOf(t);
    return e !== undefined && isScalar(e) ? one(StringType) : undefined;
  }));
}
supported("@sh", [0], "StringReplace of ' and ArrayStringJoin", ctx => onInput(ctx, "a string or an array of scalars", t => {
  if (isScalar(t)) return one(StringType);
  const e = elementOf(t);
  return e !== undefined && isScalar(e) ? one(StringType) : undefined;
}));

// Math.
for (const [name, east] of [["floor", "East.Float.roundFloor"], ["ceil", "East.Float.roundCeil"], ["round", "East.Float.roundHalf"], ["trunc", "East.Float.roundTrunc"]] as const) {
  supported(name, [0], east, math("Integer"));
}
for (const [name, east] of [
  ["sqrt", "FloatSqrt"], ["log", "FloatLog"], ["log2", "FloatLog / FloatLog(2)"], ["log10", "FloatLog / FloatLog(10)"],
  ["exp", "FloatExp"], ["exp2", "FloatPow(2, x)"], ["exp10", "FloatPow(10, x)"], ["sin", "FloatSin"], ["cos", "FloatCos"],
  ["tan", "FloatTan"], ["fabs", "FloatAbs"],
] as const) {
  supported(name, [0], east, math("Float"));
}
supported("pow", [2], "FloatPow", math2);
supported("fmin", [2], "a comparison, as C's fmin", math2);
supported("fmax", [2], "a comparison, as C's fmax", math2);
supported("fmod", [2], "FloatRemainder", math2);
unavailable({
  ...each([
    "acos", "acosh", "asin", "asinh", "atan", "atanh", "cbrt", "cosh", "erf", "erfc", "expm1", "frexp", "gamma", "j0", "j1",
    "lgamma", "lgamma_r", "log1p", "logb", "modf", "nearbyint", "rint", "significand", "sinh", "tanh", "tgamma", "y0", "y1",
  ], [0]),
  ...each(["atan2", "copysign", "drem", "fdim", "hypot", "jn", "ldexp", "nextafter", "nexttoward", "remainder", "scalb", "scalbln", "yn"], [2]),
  fma: [3],
}, "East has no builtin for it");

// DateTime.
for (const name of ["todate", "todateiso8601"]) {
  supported(name, [0], "DateTimePrintFormat as RFC 3339 (East JSON's form); epoch seconds via DateTimeFromEpochMilliseconds", ctx => dateInput(ctx, StringType));
}
for (const name of ["fromdate", "fromdateiso8601"]) {
  supported(name, [0], "StringParseJSON as a DateTime: RFC 3339 with milliseconds and offsets (§13.4)", ctx => onInput(ctx, "a string", t => t.type === "String" ? one(DateTimeType) : undefined));
}
supported("strftime", [1], "DateTimePrintFormat with the format's tokens, made when the query is checked", ctx => {
  if (!rewriteFormat(ctx)) return { shape: ERROR, mult: ONE };
  return dateInput(ctx, StringType);
});
supported("strptime", [1], "DateTimeParseFormat with the format's tokens (gives a DateTime, §13.4)", ctx => {
  if (!rewriteFormat(ctx)) return { shape: ERROR, mult: ONE };
  return onInput(ctx, "a string", t => t.type === "String" ? one(DateTimeType) : undefined);
});
for (const [name, east] of [
  ["year", "DateTimeGetYear"], ["month", "DateTimeGetMonth"], ["day", "DateTimeGetDayOfMonth"], ["hour", "DateTimeGetHour"],
  ["minute", "DateTimeGetMinute"], ["second", "DateTimeGetSecond"], ["millisecond", "DateTimeGetMillisecond"],
  ["weekday", "DateTimeGetDayOfWeek"], ["epoch_ms", "DateTimeToEpochMilliseconds"],
] as const) {
  supported(name, [0], east, ctx => onInput(ctx, "a DateTime", t => t.type === "DateTime" ? one(IntegerType) : undefined));
}
const UNITS = ["millisecond", "second", "minute", "hour", "day", "week"];
function unit(ctx: CallContext, i: number): boolean {
  const u = literalString(ctx, i, "unit");
  if (u === undefined) return false;
  if (!UNITS.includes(u)) {
    ctx.fail("type_mismatch", MESSAGES.argument(ctx.name, ordinal(i), `one of ${UNITS.join(", ")}`, printString(u)), { arg: i });
    return false;
  }
  return true;
}
supported("datetime_add", [2], "DateTimeAddMilliseconds of n units", ctx => {
  const n = argOf(ctx, 0, "an Integer", t => t.type === "Integer");
  if (n === undefined || !unit(ctx, 1)) return { shape: ERROR, mult: ONE };
  return onInput(ctx, "a DateTime", t => t.type === "DateTime" ? one(DateTimeType, n.result.mult) : undefined);
});
supported("datetime_diff", [2], "DateTimeDurationMilliseconds in units, truncated", ctx => {
  const other = argOf(ctx, 0, "a DateTime", t => t.type === "DateTime", undefined, DateTimeType);
  if (other === undefined || !unit(ctx, 1)) return { shape: ERROR, mult: ONE };
  return onInput(ctx, "a DateTime", t => t.type === "DateTime" ? one(IntegerType, other.result.mult) : undefined);
});
entries.push(["gmtime", { status: "not_yet", arities: [0], east: "—" }]);
entries.push(["mktime", { status: "not_yet", arities: [0], east: "—" }]);
excluded({ now: [0], localtime: [0], strflocaltime: [1] });

// Host access and modules (§11).
excluded({
  ...each(["env", "input", "inputs", "input_filename", "input_line_number", "stderr", "halt", "get_search_list", "get_prog_origin",
    "get_jq_origin", "modulemeta"], [0]),
  debug: [0, 1],
  halt_error: [0, 1],
});

// Function values (§9).
supported("call", [1, 2, 3, 4, 5, 6, 7, 8], "a call of the function value", ctx => {
  const f = ctx.arg(0);
  if (f.shape.kind === "error") return { shape: ERROR, mult: ONE };
  const ft = ctx.collect(f, 0);
  if (ft === undefined) return { shape: ERROR, mult: ONE };
  const fn = unwrap(ft);
  if (fn.type === "AsyncFunction") return ctx.fail("unsupported", MESSAGES.asyncCall(), { arg: 0 });
  if (fn.type !== "Function") return ctx.fail("type_mismatch", MESSAGES.input("call", "a function value", describeType(ft)), { arg: 0 });
  const inputs = fn.inputs as EastType[];
  if (inputs.length !== ctx.args.length - 1) return ctx.fail("arity", MESSAGES.arity("the function value", [inputs.length], ctx.args.length - 1));
  let mult = f.mult;
  for (let i = 1; i < ctx.args.length; i++) {
    const want = inputs[i - 1]!;
    const a = ctx.arg(i);
    if (a.shape.kind === "error") return { shape: ERROR, mult: ONE };
    const got = ctx.collect(a, i);
    if (got === undefined) return { shape: ERROR, mult: ONE };
    const fits = isTypeEqual(unwrap(got), unwrap(want)) || (unwrap(want).type === "Float" && unwrap(got).type === "Integer") || callStructFits(got, want);
    if (!fits) return ctx.fail("type_mismatch", MESSAGES.argument("call", ordinal(i), describeType(want), describeType(got)), { arg: i });
    mult = then(mult, a.mult);
  }
  return one(fn.output as EastType, mult);
});
/** A struct argument fits a struct input field by field, with Integer → Float. */
function callStructFits(got: EastType, want: EastType): boolean {
  const g = unwrap(got);
  const w = unwrap(want);
  if (g.type !== "Struct" || w.type !== "Struct") return false;
  const gf = g.fields as Record<string, EastType>;
  const wf = w.fields as Record<string, EastType>;
  const names = Object.keys(wf);
  if (names.length !== Object.keys(gf).length || !names.every(n => n in gf)) return false;
  return names.every(n => isTypeEqual(unwrap(gf[n]!), unwrap(wf[n]!)) || (unwrap(wf[n]!).type === "Float" && unwrap(gf[n]!).type === "Integer") || callStructFits(gf[n]!, wf[n]!));
}
for (const [name, output] of [["signature", StringType], ["source", StringType], ["calls", ArrayType(StringType)], ["captures", ArrayType(StringType)]] as const) {
  entries.push([name, {
    status: "tooling", arities: [0], east: `the host platform function jq_${name} (#931)`,
    typing: ctx => onInput(ctx, "a function value", t => t.type === "Function" || t.type === "AsyncFunction" ? one(output) : undefined),
  }]);
}

/**
 * What each builtin a query may call takes and gives, and how many outputs it
 * gives for one input: `QUERY.md` §10's columns.
 */
const RULES: Readonly<Record<string, readonly [rule: string, outputs: string]>> = {
  empty: ["any → nothing", "none"],
  error: ["any; `error(v)` of any type (§13.14) → a runtime error", "none"],
  not: ["any → Boolean, by jq's truthiness", "one"],
  select: ["`select(f)` → its input, narrowed by what `f` proves", "maybe; many when `f` is"],
  first: ["Array<T> → Option<T>; `first(f)` → f's first output", "one; maybe"],
  last: ["Array<T> → Option<T>; `last(f)` → f's last output", "one; maybe"],
  nth: ["`nth(n)`: Array<T> → Option<T>; `nth(n; f)` → f's nth output", "one; maybe"],
  limit: ["`limit(n; f)` → f's first n outputs", "as `f`'s"],
  skip: ["`skip(n; f)` → f's outputs after the first n", "as `f`'s"],
  isempty: ["`isempty(f)` → Boolean", "one"],
  range: ["Integer bounds → Integer; a Float bound → Float", "many"],
  recurse: ["every value nested in the input; `recurse(f[; c])` → the input, then f again, of the one type a fixpoint settles on", "many"],
  until: ["`until(c; u)` → u applied until c holds, of one type by fixpoint", "one"],
  while: ["`while(c; u)` → each value while c holds, of one type by fixpoint", "many"],
  repeat: ["`repeat(f)` → the input, f of it, and so on", "many"],
  combinations: ["Array<Array<T>> → Array<T>; `combinations(n)`: Array<T> → Array<T>", "many"],
  walk: ["any → rebuilt bottom-up with `f`, which gives one output of a type each value's place can hold", "one"],
  IN: ["`IN(s)`, `IN(src; s)` → Boolean", "one"],
  INDEX: ["`INDEX(f)`: Array<T> → Dict<K, T> for f's key K; `INDEX(src; f)`", "one"],
  del: ["`del(p)` → the input without what `p` names; a struct loses the field", "one"],
  to_entries: ["Dict<K, V> → Array<Struct{key: K, value: V}>; a struct's fields, keyed by name; an array's elements, by index", "one"],
  from_entries: ["Array of `{key, value}` (or `k`, `name`, `v`, …) → Dict<K, V>", "one"],
  with_entries: ["`to_entries | map(f) | from_entries`", "one"],
  pick: ["`pick(.a.b)` → Struct{a: Struct{b: T}}", "one"],
  transpose: ["Array<Array<T>> → Array<Array<Option<T>>>", "one"],
  length: ["String, Array, Set, Dict, Blob → Integer; a struct's field count; a number's absolute value; null → 0", "one"],
  utf8bytelength: ["String → Integer", "one"],
  keys: ["Dict<K, V> → Array<K>; a struct's field names, sorted; an array's indices", "one"],
  keys_unsorted: ["as `keys`, with a struct's fields in declared order (§13.12)", "one"],
  has: ["`has(k)` → Boolean: a Dict's key of its key type, a struct's field name, an array's index", "one"],
  in: ["`in(o)` → `o | has(.)`", "one"],
  map: ["`map(f)`: Array<T>, Set<T>, or a Dict's or struct's values → Array of f's outputs", "one"],
  map_values: ["`map_values(f)`: Array, Dict or struct → the same with f's first output in each place", "one"],
  add: ["Array<T> → T for numbers, strings, arrays and dicts (their identity when empty, §13.15), Option<T> for structs; `add(f)` over f's outputs", "one"],
  any: ["`any`, `any(f)`, `any(g; c)` → Boolean", "one"],
  all: ["`all`, `all(f)`, `all(g; c)` → Boolean", "one"],
  flatten: ["Array<Array<…T>> → Array<T>; `flatten(d)` d levels deep", "one"],
  sort: ["Array<T> → Array<T>", "one"],
  sort_by: ["`sort_by(f)`: Array<T>, f giving an ordered key → Array<T>", "one"],
  group_by: ["`group_by(f)`: Array<T> → Array<Array<T>>, in key order", "one"],
  unique_by: ["`unique_by(f)`: Array<T> → Array<T>", "one"],
  min_by: ["`min_by(f)`: Array<T> → Option<T>", "one"],
  max_by: ["`max_by(f)`: Array<T> → Option<T>", "one"],
  unique: ["Array<T> → Array<T>, sorted", "one"],
  min: ["Array<T> → Option<T>", "one"],
  max: ["Array<T> → Option<T>", "one"],
  reverse: ["Array<T> → Array<T>; String → String; null → []", "one"],
  contains: ["two strings, or two arrays of scalars → Boolean", "one"],
  inside: ["two strings, or two arrays of scalars → Boolean", "one"],
  index: ["String, String → Option<Integer>", "one"],
  rindex: ["String, String → Option<Integer>", "one"],
  indices: ["String, String → Array<Integer>", "one"],
  bsearch: ["Array<T>, T → Integer", "one"],
  join: ["Array of strings, numbers, booleans or nulls; String → String", "one"],
  type: ["any → String: `null`, `boolean`, `number`, `string`, `array`, `object`, `datetime`, `blob` or `function`; `type == \"…\"` narrows", "one"],
  arrays: ["the input when it is an array; narrows", "maybe"],
  objects: ["the input when it is a struct, dict or variant; narrows", "maybe"],
  iterables: ["the input when it is an array, struct or dict; narrows", "maybe"],
  booleans: ["the input when it is a Boolean; narrows", "maybe"],
  numbers: ["the input when it is a number; narrows", "maybe"],
  strings: ["the input when it is a String; narrows", "maybe"],
  nulls: ["the input when it is null; narrows", "maybe"],
  values: ["the input when it is not null: Option<T> → T", "maybe"],
  scalars: ["the input when it is not an array, struct or dict; narrows", "maybe"],
  normals: ["a number, when normal", "maybe"],
  finites: ["a number, when finite", "maybe"],
  tostring: ["any → String: a string as it is, anything else as East text (§13.9)", "one"],
  tojson: ["any → String, East's JSON (§13.9)", "one"],
  tonumber: ["String → Float (§13.19); a number as it is", "one"],
  toboolean: ["String or Boolean → Boolean", "one"],
  builtins: ["→ Array<String>", "one"],
  infinite: ["→ Float", "one"],
  nan: ["→ Float", "one"],
  isfinite: ["a number → Boolean", "one"],
  isinfinite: ["a number → Boolean", "one"],
  isnan: ["a number → Boolean", "one"],
  isnormal: ["a number → Boolean", "one"],
  abs: ["Integer → Integer; Float → Float", "one"],
  startswith: ["String, String → Boolean", "one"],
  endswith: ["String, String → Boolean", "one"],
  ltrimstr: ["String, String → String; other values as they are", "one"],
  rtrimstr: ["String, String → String; other values as they are", "one"],
  trimstr: ["String, String → String; other values as they are", "one"],
  trim: ["String → String", "one"],
  ltrim: ["String → String", "one"],
  rtrim: ["String → String", "one"],
  ascii_downcase: ["String → String (§13.18)", "one"],
  ascii_upcase: ["String → String (§13.18)", "one"],
  split: ["`split(s)`: String → Array<String>", "one"],
  test: ["String, a literal regex, flags `g` `i` → Boolean", "one"],
  sub: ["String, a literal regex, a replacement of text and named groups `\\(.name)` → String", "one"],
  gsub: ["String, a literal regex, a replacement of text and named groups `\\(.name)` → String", "one"],
  format: ["`format(\"name\")` → as `@name`", "one"],
  "@text": ["any → String, as `tostring`", "one"],
  "@json": ["any → String, as `tojson`", "one"],
  "@html": ["any → String, HTML-escaped", "one"],
  "@uri": ["any → String, percent-encoded", "one"],
  "@base64": ["any → String", "one"],
  "@base32": ["any → String", "one"],
  "@csv": ["Array of scalars → String", "one"],
  "@tsv": ["Array of scalars → String", "one"],
  "@sh": ["a scalar or an array of scalars → String", "one"],
  floor: ["a number → Integer", "one"],
  ceil: ["a number → Integer", "one"],
  round: ["a number → Integer", "one"],
  trunc: ["a number → Integer", "one"],
  sqrt: ["a number → Float", "one"],
  log: ["a number → Float", "one"],
  log2: ["a number → Float", "one"],
  log10: ["a number → Float", "one"],
  exp: ["a number → Float", "one"],
  exp2: ["a number → Float", "one"],
  exp10: ["a number → Float", "one"],
  sin: ["a number → Float", "one"],
  cos: ["a number → Float", "one"],
  tan: ["a number → Float", "one"],
  fabs: ["a number → Float", "one"],
  pow: ["two numbers → Float", "one"],
  fmin: ["two numbers → Float", "one"],
  fmax: ["two numbers → Float", "one"],
  fmod: ["two numbers → Float", "one"],
  todate: ["DateTime or epoch seconds → String, RFC 3339", "one"],
  todateiso8601: ["DateTime or epoch seconds → String, RFC 3339", "one"],
  fromdate: ["String → DateTime (§13.4)", "one"],
  fromdateiso8601: ["String → DateTime (§13.4)", "one"],
  strftime: ["DateTime or epoch seconds, a literal format → String", "one"],
  strptime: ["String, a literal format → DateTime (§13.4)", "one"],
  year: ["DateTime → Integer", "one"],
  month: ["DateTime → Integer", "one"],
  day: ["DateTime → Integer", "one"],
  hour: ["DateTime → Integer", "one"],
  minute: ["DateTime → Integer", "one"],
  second: ["DateTime → Integer", "one"],
  millisecond: ["DateTime → Integer", "one"],
  weekday: ["DateTime → Integer", "one"],
  epoch_ms: ["DateTime → Integer", "one"],
  datetime_add: ["`datetime_add(n; unit)`: DateTime, Integer, a literal unit → DateTime", "one"],
  datetime_diff: ["`datetime_diff(other; unit)`: DateTime, DateTime, a literal unit → Integer", "one"],
  call: ["`call(f; a…)`: Function([I…], O), arguments of I (Integer → Float) → O", "one"],
  signature: ["a function value → String (tooling)", "one"],
  source: ["a function value → String (tooling)", "one"],
  calls: ["a function value → Array<String> (tooling)", "one"],
  captures: ["a function value → Array<String> (tooling)", "one"],
};

/**
 * The catalog: every builtin of jq 1.8 and East's additions, by name, and
 * each format by `@name`.
 *
 * @internal
 */
export const BUILTINS: ReadonlyMap<string, Builtin> = new Map(entries.map(([name, builtin]) => {
  const rule = RULES[name];
  return [name, rule === undefined ? builtin : { ...builtin, rule: rule[0], outputs: rule[1] }];
}));

/**
 * Whether a name is a builtin a jq query can call: one of jq 1.8's, or one of
 * East's additions, whether or not a query may use it.
 *
 * @param name - the name, as written in the query
 * @returns `true` for a builtin's name
 *
 * @example
 * ```ts
 * isJqBuiltin("select");   // true
 * isJqBuiltin("revenue");  // false: a `def` could name it
 * ```
 */
export function isJqBuiltin(name: string): boolean {
  return !name.startsWith("@") && BUILTINS.has(name);
}
