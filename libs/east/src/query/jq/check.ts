/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The jq checker: types a program against the East type of its input, and
 * gives the checked query every surface translates, or the problems that stop
 * it (`devdocs/QUERY.md` §2–§13).
 *
 * @packageDocumentation
 */

import { variant } from "../../containers/variant.js";
import { printFor } from "../../serialization/east.js";
import { decodeBeast2, encodeBeast2For } from "../../serialization/beast2/index.js";
import { jsonParseDateTime } from "../../serialization/json.js";
import { canonicalTypeValue, fromEastTypeValue, toEastTypeValue } from "../../type_of_type.js";
import {
  ArrayType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NeverType, NullType, StringType, StructType,
  isImmutableType, isTypeEqual, printType, type EastType, type ValueTypeOf,
} from "../../types.js";
import type { QueryType } from "../types.js";
import { BUILTINS, type Builtin, type CallContext } from "./catalog.js";
import { MESSAGES, closest, edit, report, type QueryError, type QueryFix } from "./messages.js";
import { parseJq, type ParsedJq } from "./parse.js";
import {
  ERROR, MANY, ONE, SOME, ZERO, also, canBeNull, casesOf, describeType, either, membersOf, nullablePayload,
  JQ_TYPE_NAMES, narrowTypes, orNull, refine, then, typed, unify, unifyShape, union, unwrap, wireMultiplicity,
  type Facts, type Member, type Mult, type Proof, type Result, type Shape, type TypeShape,
} from "./shapes.js";
import { childPath, jqChildren, type JqNode, type JqPattern, type JqRange, type JqSpans } from "./spans.js";

/** Options for {@link checkJq}. */
export interface CheckJqOptions {
  /**
   * The input is an e3 root: a struct of datasets, read one field at a time.
   * Reading the whole root is refused, `keys`, `keys_unsorted` and
   * `has("name")` on it are answered from its type, and `reads` lists the
   * fields read.
   */
  root?: boolean;
  /** Allow the tooling-only builtins `signature`, `source`, `calls` and `captures`. */
  tooling?: boolean;
}

/** How many outputs a filter gives: exactly one, none or one, or any number. */
export type JqMultiplicity = "one" | "maybe" | "many";

/** The type and multiplicity of a node: the outputs it gives for one input. */
export interface CheckedNode {
  /** The type of each output. */
  type: EastType;
  /** How many outputs it gives for one input. */
  multiplicity: JqMultiplicity;
}

/** The outputs after one stage of the top-level pipeline, and where the stage is. */
export interface CheckedStage {
  /** The stage's node's path. */
  path: string;
  /** The stage's first offset in the text. */
  from: number;
  /** The offset after its last. */
  to: number;
  /** The type of each output after the stage. */
  type: EastType;
  /** How many outputs the program has given by the end of the stage. */
  multiplicity: JqMultiplicity;
}

/** What {@link checkJq} makes of a program. */
export interface CheckJqResult {
  /** The checked query: present exactly when no diagnostic is an error. */
  query: ValueTypeOf<typeof QueryType> | null;
  /** The type of each output, when the outputs share one. */
  elementType: EastType | null;
  /** How many outputs the program gives, when it checks. */
  multiplicity: JqMultiplicity | null;
  /** With `root`, the fields of the root the program reads, in the order it first reads them. */
  reads: string[];
  /** The outputs after each stage of the top-level pipeline, descending through the bodies of the `as` that lead it. */
  stages: CheckedStage[];
  /**
   * A node's type and multiplicity, for completions, hover and the
   * translator.
   *
   * @param path - the node's path, as the parser's spans name it
   * @param instance - inside a `def`'s body, which call's instance: the paths
   *   of the calls that reached it, joined by `>`; `""` (the default) outside
   *   every `def`
   * @returns its type and multiplicity, or `null` when the node was not
   *   checked (it is unreachable, or an error stopped its checking)
   */
  typeAt(path: string, instance?: string): CheckedNode | null;
  /** The problems found, lints included, in the order found. */
  diagnostics: QueryError[];
}

/** A `def`, or a filter parameter, in scope. */
type Binding =
  | { kind: "def"; node: Extract<JqNode, { type: "def" }>; path: string; env: () => Env }
  | { kind: "param"; arg: JqNode; path: string; env: Env };

/** What is in scope where a node is checked. */
interface Env {
  /** `$name` → what it holds. */
  readonly vars: ReadonlyMap<string, Result>;
  /** `name/arity` → the def or filter parameter it calls. */
  readonly defs: ReadonlyMap<string, Binding>;
  /** Labels a `break` can name. */
  readonly labels: ReadonlySet<string>;
  /** Which instance of a def's body this is: `""` outside every def. */
  readonly instance: string;
  /** Inside `try` or after `?`: a type error jq would raise at run time gives no output instead. */
  readonly lenient: boolean;
}

const encodeDateTime = encodeBeast2For(DateTimeType);
const encodeFloat = encodeBeast2For(FloatType);
/** A name as a jq string literal: JSON's escapes, which East's text shares for strings. */
const printString = printFor(StringType);

/** The operands of an arithmetic operator, and the text it covers. */
interface Operands {
  readonly left: JqNode;
  readonly leftPath: string;
  readonly right: JqNode;
  readonly rightPath: string;
  readonly range: JqRange | undefined;
}

/** The literal's value, with its type. */
interface LiteralValue {
  type: EastType;
  value: unknown;
}

/** Rewrites a literal: the node the checked program holds instead. */
function literalNode(blob: Uint8Array): JqNode {
  return variant("literal", blob);
}

/** Reads ISO-8601 text as a DateTime, through East's RFC 3339 reader: a full
 *  date-time with its offset, a date-time with none (UTC), or a date (midnight UTC). */
function parseIsoDateTime(text: string): Date | undefined {
  const forms = /^\d{4}-\d{2}-\d{2}$/.test(text) ? [`${text}T00:00:00Z`]
    : /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text) ? [`${text}Z`]
    : [text];
  for (const form of forms) {
    const ms = jsonParseDateTime(form);
    if (typeof ms === "number") return new Date(ms);
  }
  return undefined;
}

/** What a node that never runs gives. */
const DEAD: Result = { shape: typed(NeverType), mult: { lo: 1, hi: 0 } };

/** The binary operators by kind. */
const ARITHMETIC: ReadonlySet<string> = new Set(["+", "-", "*", "/", "%"]);
const COMPARISON: ReadonlySet<string> = new Set(["==", "!=", "<", "<=", ">", ">="]);

/** Numbers: Integer and Float. */
function isNumber(type: EastType): boolean {
  return type.type === "Integer" || type.type === "Float";
}

/** Checks one program. */
class Checker {
  readonly diagnostics: QueryError[] = [];
  readonly records = new Map<string, Result>();
  readonly rewrites = new Map<string, JqNode>();
  /** The nodes checked, by path. */
  readonly nodes = new Map<string, JqNode>();
  readonly reads: string[] = [];
  /** Defs being instantiated, by instance signature: their output so far, for recursion. */
  private readonly active = new Map<string, { result: Result; recursed: boolean; filters: boolean }>();
  /** The root's field names, with `root`. */
  readonly rootNames: string[];

  constructor(readonly text: string, readonly spans: JqSpans, readonly options: CheckJqOptions, readonly input: EastType) {
    const t = unwrap(input);
    this.rootNames = options.root === true && t.type === "Struct" ? Object.keys(t.fields as Record<string, EastType>) : [];
  }

  // ─── Recording and reporting ───────────────────────────────────────────

  range(path: string): JqRange | undefined {
    return this.spans.get(path);
  }

  record(path: string, env: Env, result: Result): Result {
    this.records.set(`${env.instance}|${path}`, result);
    return result;
  }

  /** Reports a problem and gives the error shape. */
  fail(range: JqRange | undefined, code: string, message: string, options: { suggestions?: string[]; fixes?: QueryFix[] } = {}): Result {
    this.diagnostics.push(report(this.text, code, range, message, options));
    return { shape: ERROR, mult: ONE };
  }

  /** A type error jq raises at run time: reported, or in a lenient place no output. */
  mismatch(env: Env, range: JqRange | undefined, code: string, message: string, options: { suggestions?: string[]; fixes?: QueryFix[] } = {}): Result {
    if (env.lenient) return { shape: typed(NeverType), mult: ZERO };
    return this.fail(range, code, message, options);
  }

  warn(range: JqRange | undefined, code: string, message: string, fixes: QueryFix[] = []): void {
    this.diagnostics.push(report(this.text, code, range, message, { fixes, warning: true }));
  }

  /** The text of a node, as written. */
  source(path: string): string {
    const r = this.range(path);
    return r === undefined ? "" : this.text.slice(r.from, r.to);
  }

  /** The range of a field read's `.name` (or `."name"`), without its target. */
  accessorRange(node: Extract<JqNode, { type: "field" }>, path: string): JqRange | undefined {
    const whole = this.range(path);
    const target = this.range(childPath(path, "field.target"));
    if (whole === undefined || target === undefined) return whole;
    const from = node.value.target.type === "identity" ? target.from : target.to;
    return { from, to: node.value.optional ? whole.to - 1 : whole.to };
  }

  // ─── The walk ──────────────────────────────────────────────────────────

  check(node: JqNode, path: string, input: Result, env: Env): Result {
    this.nodes.set(path, node);
    // A node whose input has no values never runs (a branch narrowing rules
    // out, the elements of `[]`): it gives nothing, and `lo: 1, hi: 0` is the
    // identity of `either`, so a dead branch leaves its `if`'s bounds alone.
    if (input.shape.kind === "type" && input.shape.type.type === "Never") return this.record(path, env, DEAD);
    return this.record(path, env, this.checkNode(node, path, input, env));
  }

  private checkNode(node: JqNode, path: string, input: Result, env: Env): Result {
    const at = (step: string): string => childPath(path, step);
    switch (node.type) {
      case "identity":
        return { shape: input.shape, mult: ONE, access: [], stream: input.stream };
      case "descend":
        return this.descend(input, path, env);
      case "literal":
        return { shape: typed(this.literal(node.value).type), mult: ONE };
      case "variable":
        return this.variable(node.value, path, env);
      case "break":
        if (!env.labels.has(node.value)) return this.fail(this.range(path), "unknown_function", MESSAGES.unknownLabel(node.value));
        return { shape: typed(NeverType), mult: ZERO };
      case "field":
        return this.field(node, path, input, env);
      case "index":
        return this.index(node, path, input, env);
      case "slice":
        return this.slice(node, path, input, env);
      case "iterate":
        return this.iterate(node, path, input, env);
      case "pipe": {
        const left = this.check(node.value.left, at("pipe.left"), input, env);
        const right = this.check(node.value.right, at("pipe.right"), left, env);
        return this.compose(left, right);
      }
      case "comma": {
        const left = this.check(node.value.left, at("comma.left"), input, env);
        const right = this.check(node.value.right, at("comma.right"), input, env);
        return { shape: union([...membersOf(left.shape), ...membersOf(right.shape)]), mult: also(left.mult, right.mult) };
      }
      case "alternative":
        return this.alternative(node, path, input, env);
      case "negate": {
        const operand = this.check(node.value, at("negate"), input, env);
        return this.mapMembers(operand, member => {
          const t = unwrap(member.type);
          if (isNumber(t)) return { shape: typed(t), mult: ONE };
          return this.mismatch(env, this.range(path), "type_mismatch", MESSAGES.negate(describeType(member.type)));
        });
      }
      case "binary":
        return this.binary(node, path, input, env);
      case "array": {
        if (node.value.type === "none") return { shape: typed(ArrayType(NeverType)), mult: ONE };
        const body = this.check(node.value.value, at("array.some"), input, env);
        const element = this.collect(body, this.range(path), at("array.some"));
        if (element === undefined) return { shape: ERROR, mult: ONE };
        const facts = body.shape.kind === "type" && body.shape.facts !== undefined ? { kind: "elements" as const, element: body.shape.facts } : undefined;
        return { shape: typed(ArrayType(element), facts), mult: ONE };
      }
      case "object":
        return this.object(node, path, input, env);
      case "string": {
        let mult = ONE;
        node.value.forEach((part, i) => {
          if (part.type === "interpolate") mult = then(mult, this.check(part.value, at(`string[${i}].interpolate`), input, env).mult);
        });
        return { shape: typed(StringType), mult };
      }
      case "format":
        return this.format(node, path, input, env);
      case "if":
        return this.conditional(node, path, input, env);
      case "try":
        return this.tryCatch(node, path, input, env);
      case "reduce": case "foreach":
        return this.fold(node, path, input, env);
      case "bind":
        return this.bind(node, path, input, env);
      case "label": {
        const labels = new Set(env.labels);
        labels.add(node.value.name);
        const body = this.check(node.value.body, at("label.body"), input, { ...env, labels });
        // A break stops the stream wherever it runs, so outputs the body would give after it may not come.
        return { shape: body.shape, mult: breaksTo(node.value.body, node.value.name) ? { lo: 0, hi: body.mult.hi } : body.mult };
      }
      case "def": {
        const defs = new Map(env.defs);
        const params = node.value.params;
        const key = `${node.value.name}/${params.length}`;
        let closure: Env;
        const binding: Binding = { kind: "def", node, path, env: () => closure };
        defs.set(key, binding);
        closure = { ...env, defs };
        return this.check(node.value.rest, at("def.rest"), input, closure);
      }
      case "call":
        return this.call(node, path, input, env);
      case "update":
        return this.update(node, path, input, env);
    }
  }

  /** `a | b`: `b` runs on each output of `a`. */
  compose(left: Result, right: Result): Result {
    const prefix = left.access;
    return {
      shape: right.shape,
      mult: then(left.mult, right.mult),
      access: prefix !== undefined && right.access !== undefined ? [...prefix, ...right.access] : undefined,
      caseOf: prefix !== undefined && right.caseOf !== undefined ? { ...right.caseOf, path: [...prefix, ...right.caseOf.path] } : undefined,
      proves: prefix !== undefined && right.proves !== undefined ? right.proves.map(p => ({ ...p, path: [...prefix, ...p.path] })) : undefined,
      typeOf: prefix !== undefined && right.typeOf !== undefined ? [...prefix, ...right.typeOf] : undefined,
      partial: right.partial,
      stream: right.stream,
    };
  }

  /** Applies a typing to each member of a result's shape, and unions the outcomes. */
  mapMembers(input: Result, each: (member: TypeShape, caseName: string | undefined) => Result): Result {
    if (input.shape.kind === "error") return { shape: ERROR, mult: input.mult };
    const members: Member[] = [];
    let mult: Mult | undefined;
    let error = false;
    for (const member of membersOf(input.shape)) {
      const out = each(member.shape, member.case);
      if (out.shape.kind === "error") error = true;
      else for (const m of membersOf(out.shape)) members.push({ shape: m.shape, case: m.case ?? member.case });
      mult = mult === undefined ? out.mult : either(mult, out.mult);
    }
    if (error) return { shape: ERROR, mult: mult ?? ONE };
    return { shape: union(members), mult: mult ?? ZERO };
  }

  /**
   * The one type a stream's outputs share, or a reported `ambiguous_output`.
   *
   * @param result - the stream
   * @param range - where to report a problem
   * @param at - the path of the node that gives the stream, when it is one:
   *   outputs that are fields read side by side (`.id, .customer_id`) get the
   *   suggestion to put them in an object
   */
  collect(result: Result, range: JqRange | undefined, at?: string): EastType | undefined {
    if (result.shape.kind === "error") return undefined;
    const type = unifyShape(result.shape);
    if (type !== undefined) return type;
    let acc: EastType = NeverType;
    for (const member of membersOf(result.shape)) {
      const next = unify(acc, member.shape.type);
      if (next === undefined) {
        const message = MESSAGES.noCommonType(describeType(acc), describeType(member.shape.type));
        const outputs = at === undefined ? undefined : this.lastStage(at);
        const names = outputs === undefined ? undefined : fieldsSideBySide(outputs.node);
        const where = outputs === undefined ? undefined : this.range(outputs.path);
        if (names === undefined || where === undefined) {
          this.fail(range, "ambiguous_output", message);
        } else {
          const suggestion = `{${names.join(", ")}}`;
          this.fail(where, "ambiguous_output", message, { suggestions: [suggestion], fixes: [edit(`Use ${suggestion}`, where.from, where.to, suggestion)] });
        }
        return undefined;
      }
      acc = next;
    }
    return acc;
  }

  /** The node that gives a node's outputs: the last segment of its pipes, through `as` bodies. */
  lastStage(path: string): { node: JqNode; path: string } | undefined {
    let node = this.nodes.get(path);
    let at = path;
    while (node !== undefined) {
      if (node.type === "pipe") { at = childPath(at, "pipe.right"); node = node.value.right; continue; }
      if (node.type === "bind") { at = childPath(at, "bind.body"); node = node.value.body; continue; }
      return { node, path: at };
    }
    return undefined;
  }

  // ─── Leaves ────────────────────────────────────────────────────────────

  /** A literal's value and type: a jq literal's, or one the checker rewrote a literal to. */
  literal(blob: Uint8Array): LiteralValue {
    const { type, value } = decodeBeast2(blob);
    return { type: fromEastTypeValue(type), value };
  }

  variable(name: string, path: string, env: Env): Result {
    if (name === "__loc__") return { shape: typed(StructType({ file: StringType, line: IntegerType })), mult: ONE };
    if (name === "ENV" || name === "__prog_args") return this.fail(this.range(path), "unsupported", MESSAGES.excluded(`$${name}`));
    const bound = env.vars.get(name);
    if (bound === undefined) return this.fail(this.range(path), "unknown_function", MESSAGES.unknownVariable(name));
    return { shape: bound.shape, mult: ONE, caseOf: undefined };
  }

  /** `..`: the value and every value nested in it, depth first. */
  descend(input: Result, path: string, env: Env): Result {
    if (this.refuseRoot(input, path, env)) return { shape: ERROR, mult: ONE };
    const members: Member[] = [];
    const seen: EastType[] = [];
    const visit = (type: EastType): void => {
      if (seen.some(s => isTypeEqual(s, type))) return;
      seen.push(type);
      members.push({ shape: typed(type), case: undefined });
      const t = unwrap(type);
      const payload = nullablePayload(t);
      if (payload !== undefined) { visit(payload); return; }
      switch (t.type) {
        case "Array": visit(t.value as EastType); break;
        case "Set": visit(t.key as EastType); break;
        case "Vector": visit(t.element as EastType); break;
        case "Dict": visit(t.value as EastType); break;
        case "Struct": for (const f of Object.values(t.fields as Record<string, EastType>)) visit(f); break;
        case "Variant": visit(StringType); for (const c of Object.values(t.cases as Record<string, EastType>)) visit(c); break;
        default: break;
      }
    };
    for (const member of membersOf(input.shape)) visit(member.shape.type);
    return { shape: input.shape.kind === "error" ? ERROR : union(members), mult: SOME };
  }

  // ─── Paths ─────────────────────────────────────────────────────────────

  field(node: Extract<JqNode, { type: "field" }>, path: string, input: Result, env: Env): Result {
    const { name, optional, target } = node.value;
    const base = this.check(target, childPath(path, "field.target"), input, env);
    const range = this.accessorRange(node, path);
    const lenient = optional ? { ...env, lenient: true } : env;
    const read = this.readField(base, name, range, lenient, optional, path);
    const composed = this.compose(base, { ...read, mult: read.mult });
    return {
      ...composed,
      access: base.access !== undefined && read.access !== undefined ? [...base.access, ...read.access] : undefined,
      caseOf: read.caseOf !== undefined && base.access !== undefined ? { ...read.caseOf, path: base.access } : undefined,
      partial: read.partial,
      stream: base.stream,
    };
  }

  /** `.name` on each member of a shape. */
  readField(base: Result, name: string, range: JqRange | undefined, env: Env, optional: boolean, path: string): Result {
    if (base.shape.kind === "error") return { shape: ERROR, mult: ONE };
    const isRoot = base.shape.kind === "type" && this.isRootShape(base.shape);
    const all = membersOf(base.shape);
    // The payloads of an un-narrowed variant: a case whose payload lacks the
    // field gives null, as jq's `.value.f` does, unless no case has it.
    const payloads = all.some(m => m.case !== undefined);
    const withField = all.filter(m => m.case !== undefined && name in this.fieldsOf(m.shape.type));
    if (payloads && withField.length === 0 && !optional && !env.lenient) {
      const names = [...new Set(all.flatMap(m => Object.keys(this.fieldsOf(m.shape.type))))];
      const suggestions = closest(name, names).map(n => `.${n}`);
      const fixes = suggestions.length > 0 && range !== undefined ? [edit(`Use ${suggestions[0]}`, range.from, range.to, suggestions[0]!)] : [];
      return this.fail(range, "unknown_field", MESSAGES.unknownPayloadField(`.${name}`, suggestions[0]), { suggestions, fixes });
    }
    const members: Member[] = [];
    let mult: Mult | undefined;
    let caseOf: Result["caseOf"];
    let missing = false;
    let error = false;
    for (const member of all) {
      const payload = unwrap(nullablePayload(unwrap(member.shape.type)) ?? member.shape.type).type;
      const lacks = member.case !== undefined && (payload === "Struct" || payload === "Null") && !(name in this.fieldsOf(member.shape.type));
      const out = this.fieldOfType(member.shape, name, range, env, optional || lacks, isRoot, path);
      if (out.caseOf !== undefined) caseOf = out.caseOf;
      if (out.shape.kind === "error") { error = true; continue; }
      if (lacks) missing = true;
      for (const m of membersOf(out.shape)) members.push(m);
      mult = mult === undefined ? out.mult : either(mult, out.mult);
    }
    if (error) return { shape: ERROR, mult: ONE };
    const partial = missing && withField.length === 1 ? { caseName: withField[0]!.case!, leaf: name, at: path } : undefined;
    // A field of the payloads is one field to jq: its values share a type when they can.
    const merged = payloads ? unifyShape(union(members)) : undefined;
    const shape = merged !== undefined ? typed(merged) : union(members);
    return { shape, mult: mult ?? ONE, access: [name], caseOf, partial };
  }

  /** The fields jq sees on a type: a struct's, through an option. */
  fieldsOf(type: EastType): Record<string, EastType> {
    const t = unwrap(nullablePayload(unwrap(type)) ?? type);
    return t.type === "Struct" ? t.fields as Record<string, EastType> : {};
  }

  isRootShape(shape: TypeShape): boolean {
    return this.options.root === true && shape.type === this.input;
  }

  fieldOfType(member: TypeShape, name: string, range: JqRange | undefined, env: Env, optional: boolean, isRoot: boolean, path: string): Result {
    const type = member.type;
    const t = unwrap(type);
    if (t.type === "Null") return { shape: typed(NullType), mult: ONE };
    const payload = nullablePayload(t);
    if (payload !== undefined) {
      const inner = this.fieldOfType(typed(payload, member.facts?.kind === "present" ? member.facts.payload : undefined), name, range, env, optional, false, path);
      if (inner.shape.kind === "error" || member.facts?.kind === "present") return inner;
      // `.type` of an optional variant still tests its case: a true test proves the value is there.
      const wrapped = this.mapMembers(inner, m => {
        const t2 = orNull(m.type);
        if (t2 === undefined) return this.mismatch(env, range, "ambiguous_output", MESSAGES.noCommonType(describeType(m.type), "Null"));
        return { shape: typed(t2, m.facts), mult: ONE };
      });
      return { ...wrapped, caseOf: inner.caseOf };
    }
    switch (t.type) {
      case "Struct": {
        const fields = t.fields as Record<string, EastType>;
        if (name in fields) {
          if (isRoot && !this.reads.includes(name)) this.reads.push(name);
          const facts = member.facts?.kind === "fields" ? member.facts.fields.get(name) : undefined;
          return { shape: typed(fields[name]!, facts), mult: ONE };
        }
        if (optional || env.lenient) return { shape: typed(NullType), mult: ONE };
        const suggestions = closest(name, Object.keys(fields)).map(s => `.${s}`);
        const fixes = suggestions.length > 0 && range !== undefined ? [edit(`Use ${suggestions[0]}`, range.from, range.to, suggestions[0]!)] : [];
        const message = isRoot ? MESSAGES.unknownDataset(`.${name}`, suggestions[0]) : MESSAGES.unknownField(`.${name}`, describeType(type), suggestions[0]);
        return this.fail(range, "unknown_field", message, { suggestions, fixes });
      }
      case "Dict": {
        if (unwrap(t.key as EastType).type !== "String") {
          return this.mismatch(env, range, "type_mismatch", MESSAGES.keyType(`.${name}`, describeType(t.key as EastType), printString(name), "String"));
        }
        const value = orNull(t.value as EastType);
        if (value === undefined) return this.mismatch(env, range, "ambiguous_output", MESSAGES.noCommonType(describeType(t.value as EastType), "Null"));
        return { shape: typed(value), mult: ONE };
      }
      case "Variant": {
        const cases = casesOf(t, member.facts);
        if (name === "type") return { shape: typed(StringType), mult: ONE, caseOf: { path: [], variant: t, cases } };
        if (name === "value") {
          const payloadFacts = member.facts?.kind === "cases" ? member.facts.payload : undefined;
          const all = t.cases as Record<string, EastType>;
          return {
            shape: union(cases.map(c => ({ shape: typed(all[c]!, cases.length === 1 ? payloadFacts : undefined), case: c }))),
            mult: cases.length === 0 ? ZERO : ONE,
          };
        }
        if (optional || env.lenient) return { shape: typed(NullType), mult: ONE };
        return this.fail(range, "unknown_field", MESSAGES.unknownVariantField(`.${name}`, this.source(childPath(path, "field.target")) || "."), {
          suggestions: [".type", ".value"],
        });
      }
      default:
        if (optional) return { shape: typed(NeverType), mult: ZERO };
        return this.mismatch(env, range, "type_mismatch", MESSAGES.notAField(`.${name}`, describeType(type)));
    }
  }

  index(node: Extract<JqNode, { type: "index" }>, path: string, input: Result, env: Env): Result {
    const { index, optional, target } = node.value;
    const base = this.check(target, childPath(path, "index.target"), input, env);
    const keyPath = childPath(path, "index.index");
    const key = this.check(index, keyPath, input, env);
    const range = this.range(path);
    const lenient = optional ? { ...env, lenient: true } : env;
    // A literal string on a struct reads a field.
    if (index.type === "literal") {
      const literal = this.literal(index.value);
      if (literal.type.type === "String" && membersOf(base.shape).every(m => unwrap(m.shape.type).type !== "Dict")) {
        const read = this.readField(base, literal.value as string, range, lenient, optional, path);
        return { ...this.compose(base, read), access: base.access !== undefined ? [...base.access, literal.value as string] : undefined, stream: base.stream };
      }
    }
    if (key.shape.kind === "error") return { shape: ERROR, mult: ONE };
    const keyType = this.collect(key, this.range(keyPath));
    if (keyType === undefined) return { shape: ERROR, mult: ONE };
    const form = `${this.source(childPath(path, "index.target")) || "."}[…]`;
    const out = this.mapMembers(base, member => {
      const t = unwrap(member.type);
      if (t.type === "Null") return { shape: typed(NullType), mult: ONE };
      const payload = nullablePayload(t);
      const container = payload !== undefined ? unwrap(payload) : t;
      const element = (() => {
        switch (container.type) {
          case "Array": case "Set": return { key: IntegerType, value: (container.type === "Array" ? container.value : container.key) as EastType, facts: member.facts?.kind === "elements" ? member.facts.element : undefined };
          case "Vector": return { key: IntegerType, value: container.element as EastType, facts: undefined };
          case "Matrix": return { key: IntegerType, value: ArrayType(container.element as EastType), facts: undefined };
          case "Dict": return { key: container.key as EastType, value: container.value as EastType, facts: member.facts?.kind === "values" ? member.facts.value : undefined };
          default: return undefined;
        }
      })();
      if (element === undefined) {
        if (container.type === "Struct") return this.mismatch(lenient, this.range(keyPath), "type_mismatch", MESSAGES.structKey(form));
        if (optional) return { shape: typed(NeverType), mult: ZERO };
        return this.mismatch(lenient, range, "not_indexable", MESSAGES.notIndexable(this.source(childPath(path, "index.target")) || ".", describeType(member.type)));
      }
      if (!this.keyFits(keyType, element.key, index, keyPath)) {
        return this.mismatch(lenient, this.range(keyPath), "type_mismatch", MESSAGES.keyType(form, describeType(element.key), this.source(keyPath), describeType(keyType)));
      }
      const value = orNull(element.value);
      if (value === undefined) return this.mismatch(lenient, range, "ambiguous_output", MESSAGES.noCommonType(describeType(element.value), "Null"));
      return { shape: typed(value, element.facts), mult: ONE };
    });
    return { shape: out.shape, mult: then(key.mult, then(base.mult, out.mult)) };
  }

  /** Whether a key of `given` type indexes by `wanted`, rewriting a literal that takes its operand's type. */
  keyFits(given: EastType, wanted: EastType, node: JqNode, path: string): boolean {
    const w = unwrap(wanted);
    if (isTypeEqual(given, w)) return true;
    if (node.type === "literal") return this.coerceLiteral(node, path, w) !== undefined;
    return false;
  }

  /**
   * A literal used where `wanted` is: an Integer where a Float is, an ISO
   * string where a DateTime is. Records the rewrite.
   *
   * @returns the literal's new type, or `undefined` when it does not fit
   */
  coerceLiteral(node: Extract<JqNode, { type: "literal" }>, path: string, wanted: EastType): EastType | undefined {
    const literal = this.literal(node.value);
    if (isTypeEqual(literal.type, wanted)) return wanted;
    if (wanted.type === "Float" && literal.type.type === "Integer") {
      this.rewrites.set(path, literalNode(encodeFloat(Number(literal.value as bigint))));
      return FloatType;
    }
    if (wanted.type === "DateTime" && literal.type.type === "String") {
      const date = parseIsoDateTime(literal.value as string);
      if (date === undefined) {
        this.fail(this.range(path), "type_mismatch", MESSAGES.isoDate(this.source(path)));
        return undefined;
      }
      this.rewrites.set(path, literalNode(encodeDateTime(date)));
      return DateTimeType;
    }
    return undefined;
  }

  slice(node: Extract<JqNode, { type: "slice" }>, path: string, input: Result, env: Env): Result {
    const { from, optional, target, to } = node.value;
    const base = this.check(target, childPath(path, "slice.target"), input, env);
    let mult = base.mult;
    for (const [bound, step] of [[from, "slice.from.some"], [to, "slice.to.some"]] as const) {
      if (bound.type !== "some") continue;
      const boundPath = childPath(path, step);
      const r = this.check(bound.value, boundPath, input, env);
      mult = then(mult, r.mult);
      const t = this.collect(r, this.range(boundPath));
      if (t !== undefined && !this.keyFits(t, IntegerType, bound.value, boundPath) && !canBeNull(t)) {
        this.mismatch(env, this.range(boundPath), "type_mismatch", MESSAGES.sliceBound(describeType(t)));
      }
    }
    const lenient = optional ? { ...env, lenient: true } : env;
    const out = this.mapMembers(base, member => {
      const t = unwrap(member.type);
      switch (t.type) {
        case "Null": return { shape: typed(NullType), mult: ONE };
        case "Array": case "String": case "Vector": return { shape: typed(t, member.facts), mult: ONE };
        case "Set": return { shape: typed(ArrayType(t.key as EastType)), mult: ONE };
        default:
          if (optional) return { shape: typed(NeverType), mult: ZERO };
          return this.mismatch(lenient, this.range(path), "not_indexable", MESSAGES.notIndexable(this.source(childPath(path, "slice.target")) || ".", describeType(member.type)));
      }
    });
    return { shape: out.shape, mult: then(mult, out.mult) };
  }

  iterate(node: Extract<JqNode, { type: "iterate" }>, path: string, input: Result, env: Env): Result {
    const { optional, target } = node.value;
    const base = this.check(target, childPath(path, "iterate.target"), input, env);
    if (this.refuseRoot(base, path, env)) return { shape: ERROR, mult: ONE };
    const form = `${this.source(childPath(path, "iterate.target")) === "." ? "." : this.source(childPath(path, "iterate.target"))}[]`;
    const out = this.mapMembers(base, member => this.elementsOf(member, optional, optional ? { ...env, lenient: true } : env, form, this.range(path)));
    return { shape: out.shape, mult: then(base.mult, out.mult), stream: path };
  }

  /** The elements `.[]` gives on one member. */
  elementsOf(member: TypeShape, optional: boolean, env: Env, form: string, range: JqRange | undefined): Result {
    const t = unwrap(member.type);
    const payload = nullablePayload(t);
    if (payload !== undefined) {
      if (!optional && member.facts?.kind !== "present") {
        const fixes = range === undefined ? [] : [edit(`Use ${form}?`, range.to, range.to, "?")];
        return this.mismatch(env, range, "not_iterable", MESSAGES.notIterableNull(form, describeType(member.type)), { fixes });
      }
      const inner = this.elementsOf(typed(payload, member.facts?.kind === "present" ? member.facts.payload : undefined), optional, env, form, range);
      return { shape: inner.shape, mult: { lo: 0, hi: inner.mult.hi } };
    }
    switch (t.type) {
      case "Array": return { shape: typed(t.value as EastType, member.facts?.kind === "elements" ? member.facts.element : undefined), mult: MANY };
      case "Set": return { shape: typed(t.key as EastType), mult: MANY };
      case "Vector": return { shape: typed(t.element as EastType), mult: MANY };
      case "Matrix": return { shape: typed(ArrayType(t.element as EastType)), mult: MANY };
      case "Dict": return { shape: typed(t.value as EastType, member.facts?.kind === "values" ? member.facts.value : undefined), mult: MANY };
      case "Struct": {
        const fields = t.fields as Record<string, EastType>;
        const facts = member.facts?.kind === "fields" ? member.facts.fields : undefined;
        return {
          shape: union(Object.entries(fields).map(([name, f]) => ({ shape: typed(f, facts?.get(name)), case: undefined }))),
          mult: Object.keys(fields).length === 0 ? ZERO : SOME,
        };
      }
      default:
        if (optional) return { shape: typed(NeverType), mult: ZERO };
        return this.mismatch(env, range, "not_iterable", MESSAGES.notIterable(form, describeType(member.type)));
    }
  }

  /** With `root`, a filter that would read every dataset of the root is refused. */
  refuseRoot(input: Result, path: string, _env: Env): boolean {
    if (this.options.root !== true || input.shape.kind !== "type" || !this.isRootShape(input.shape)) return false;
    this.fail(this.range(path), "unsupported", MESSAGES.wholeRoot(this.rootNames));
    return true;
  }

  /**
   * "Narrow first": a payload field only one case has, read where its value
   * is needed. The fix inserts `select(.F.type == "case") | ` before the read,
   * so only rows of that case reach it.
   */
  narrowFirst(env: Env, range: JqRange | undefined, type: EastType, partial: NonNullable<Result["partial"]>): Result {
    // The read is `<base>.F.value.leaf`, where <base> is `.` or the node the field reads start from.
    const leaf = this.nodes.get(partial.at);
    const step = (node: JqNode | undefined, path: string): { node: JqNode; path: string } | undefined =>
      node?.type === "field" || node?.type === "index" ? { node: node.value.target, path: childPath(path, `${node.type}.target`) } : undefined;
    const value = step(leaf, partial.at);
    const variant = value === undefined ? undefined : step(value.node, value.path);
    if (variant === undefined) return this.mismatch(env, range, "type_mismatch", MESSAGES.input(this.source(partial.at), "a value", describeType(type)));
    let base = variant;
    while (base.node.type === "field" || base.node.type === "index") base = step(base.node, base.path)!;
    const chain = this.range(partial.at)!;
    const start = base.node.type === "identity" ? chain.from : this.range(base.path)!.to;
    const variantText = this.text.slice(start, this.range(variant.path)!.to);
    const leafText = this.text.slice(start, chain.to);
    const select = `select(${variantText}.type == ${printString(partial.caseName)})`;
    const message = MESSAGES.narrowFirst(leafText, describeType(type), partial.caseName, variantText, partial.leaf);
    const label = "Narrow first";
    let fix: QueryFix;
    if (base.node.type === "identity") {
      fix = isPipePosition(partial.at)
        ? edit(label, chain.from, chain.from, `${select} | `)
        : { edits: [{ insert: `(${select} | `, length: 0n, offset: BigInt(chain.from) }, { insert: ")", length: 0n, offset: BigInt(chain.to) }], label };
    } else {
      const inner = ` | ${select} | ${leafText}`;
      fix = isPipePosition(partial.at)
        ? edit(label, start, chain.to, inner)
        : { edits: [{ insert: "(", length: 0n, offset: BigInt(chain.from) }, { insert: `${inner})`, length: BigInt(chain.to - start), offset: BigInt(start) }], label };
    }
    return this.mismatch(env, range, "type_mismatch", message, { fixes: [fix] });
  }

  /**
   * An array builtin run on each element of a stream. The fix collects the
   * stream, from the segment of the call's pipe chain that makes it to the
   * segment before the call: `a | [b[] | c] | sort_by(…)`.
   */
  arrayOnElement(env: Env, callPath: string, name: string, stream: string, type: EastType): Result {
    const streamText = this.source(stream);
    // The segments before the call in its pipe chain, first to last.
    const segments: string[] = [];
    let base = callPath;
    while (base === "pipe.right" || base.endsWith(".pipe.right")) {
      base = base === "pipe.right" ? "" : base.slice(0, -".pipe.right".length);
      segments.unshift(childPath(base, "pipe.left"));
    }
    const first = segments.find(segment => stream === segment || stream.startsWith(`${segment}.`));
    const from = first === undefined ? undefined : this.range(first);
    const to = segments.length === 0 ? undefined : this.range(segments[segments.length - 1]!);
    if (from === undefined || to === undefined) {
      return this.mismatch(env, this.range(callPath), "array_builtin_on_element", MESSAGES.arrayOnElement(name, streamText, describeType(type), `[${streamText}]`));
    }
    const collected = `[${this.text.slice(from.from, to.to)}]`;
    const fix: QueryFix = {
      edits: [{ insert: "[", length: 0n, offset: BigInt(from.from) }, { insert: "]", length: 0n, offset: BigInt(to.to) }],
      label: `Collect ${streamText} first`,
    };
    return this.mismatch(env, this.range(callPath), "array_builtin_on_element", MESSAGES.arrayOnElement(name, streamText, describeType(type), collected), { fixes: [fix] });
  }

  // ─── Operators ─────────────────────────────────────────────────────────

  alternative(node: Extract<JqNode, { type: "alternative" }>, path: string, input: Result, env: Env): Result {
    const left = this.check(node.value.left, childPath(path, "alternative.left"), input, env);
    const right = this.check(node.value.right, childPath(path, "alternative.right"), input, env);
    if (left.shape.kind === "error" || right.shape.kind === "error") return { shape: ERROR, mult: ONE };
    const kept: Member[] = [];
    let alwaysTruthy = true;
    for (const member of membersOf(left.shape)) {
      const t = unwrap(member.shape.type);
      if (t.type === "Null") { alwaysTruthy = false; continue; }
      const payload = nullablePayload(t);
      if (payload !== undefined) { alwaysTruthy = false; kept.push({ shape: typed(payload), case: member.case }); continue; }
      if (t.type === "Boolean") alwaysTruthy = false;
      kept.push(member);
    }
    const shape = union([...kept, ...membersOf(right.shape)]);
    const lo = right.mult.lo === 1 || (alwaysTruthy && left.mult.lo === 1) ? 1 : 0;
    return { shape, mult: { lo, hi: Math.max(left.mult.hi, right.mult.hi) as 0 | 1 | 2 } };
  }

  binary(node: Extract<JqNode, { type: "binary" }>, path: string, input: Result, env: Env): Result {
    const { op } = node.value;
    const leftPath = childPath(path, "binary.left");
    const rightPath = childPath(path, "binary.right");
    if (op === "and" || op === "or") {
      const left = this.check(node.value.left, leftPath, input, env);
      // The right side of `and` runs only when the left is true, so it sees the left's facts.
      const rightInput = op === "and" && left.proves !== undefined ? this.narrow(input, left.proves) : input;
      const right = this.check(node.value.right, rightPath, rightInput, env);
      if (left.shape.kind === "error" || right.shape.kind === "error") return { shape: ERROR, mult: ONE };
      const proves = op === "and" ? [...(left.proves ?? []), ...(right.proves ?? [])] : undefined;
      return { shape: typed(BooleanType), mult: then(left.mult, right.mult), proves: proves?.length ? proves : undefined };
    }
    const left = this.check(node.value.left, leftPath, input, env);
    const right = this.check(node.value.right, rightPath, input, env);
    if (left.shape.kind === "error" || right.shape.kind === "error") return { shape: ERROR, mult: then(left.mult, right.mult) };
    const mult = then(left.mult, right.mult);
    if (COMPARISON.has(op)) return { ...this.comparison(op, node, path, left, right, env), mult };
    if (ARITHMETIC.has(op)) {
      const out = this.arithmetic(op, left, right, { left: node.value.left, leftPath, right: node.value.right, rightPath, range: this.range(path) }, env);
      return { shape: out.shape, mult: then(mult, out.mult), partial: out.partial };
    }
    throw new Error(`checkJq: ${printString(op)} is not a jq binary operator`);
  }

  comparison(op: string, node: Extract<JqNode, { type: "binary" }>, path: string, left: Result, right: Result, env: Env): Result {
    const leftPath = childPath(path, "binary.left");
    const rightPath = childPath(path, "binary.right");
    // `type == "number"`: a type test, which narrows.
    for (const [typeSide, otherNode, otherPath] of [[left, node.value.right, rightPath], [right, node.value.left, leftPath]] as const) {
      if (typeSide.typeOf === undefined || otherNode.type !== "literal" || (op !== "==" && op !== "!=")) continue;
      const literal = this.literal(otherNode.value);
      if (literal.type.type !== "String") continue;
      const name = literal.value as string;
      if (!JQ_TYPE_NAMES.includes(name)) {
        const suggestions = closest(name, JQ_TYPE_NAMES).map(c => printString(c));
        const range = this.range(otherPath);
        const fixes = suggestions.length > 0 && range !== undefined ? [edit(`Use ${suggestions[0]}`, range.from, range.to, suggestions[0]!)] : [];
        return this.fail(range, "unknown_case", MESSAGES.unknownType(printString(name), JQ_TYPE_NAMES, suggestions[0]), { suggestions, fixes });
      }
      const types = op === "==" ? [name] : JQ_TYPE_NAMES.filter(n => n !== name);
      return { shape: typed(BooleanType), mult: ONE, proves: [{ kind: "type", path: typeSide.typeOf, types }] };
    }
    // `.F.type == "case"`: a case test, which narrows.
    for (const [caseSide, casePath, otherNode, otherPath] of [[left, leftPath, node.value.right, rightPath], [right, rightPath, node.value.left, leftPath]] as const) {
      if (caseSide.caseOf === undefined || otherNode.type !== "literal") continue;
      const literal = this.literal(otherNode.value);
      if (literal.type.type !== "String") continue;
      const name = literal.value as string;
      const variantType = unwrap(caseSide.caseOf.variant);
      const allCases = variantType.type === "Variant" ? Object.keys(variantType.cases as Record<string, EastType>) : [];
      if (!allCases.includes(name)) {
        const suggestions = closest(name, allCases).map(c => printString(c));
        const range = this.range(otherPath);
        const fixes = suggestions.length > 0 && range !== undefined ? [edit(`Use ${suggestions[0]}`, range.from, range.to, suggestions[0]!)] : [];
        const variantPath = this.source(casePath).replace(/\s*\.\s*type$/, "");
        return this.fail(range, "unknown_case", MESSAGES.unknownCase(variantPath, printString(name), allCases, suggestions[0]), { suggestions, fixes });
      }
      if (op === "==" || op === "!=") {
        const cases = op === "==" ? [name] : caseSide.caseOf.cases.filter(c => c !== name);
        return { shape: typed(BooleanType), mult: ONE, proves: [{ kind: "case", path: caseSide.caseOf.path, cases }] };
      }
    }
    const lt = this.collect(left, this.range(leftPath));
    const rt = this.collect(right, this.range(rightPath));
    if (lt === undefined || rt === undefined) return { shape: ERROR, mult: ONE };
    if (lt.type === "Never" || rt.type === "Never") return { shape: typed(BooleanType), mult: ONE };
    // A whole variant compared with a string.
    for (const [side, sidePath, other] of [[lt, leftPath, rt], [rt, rightPath, lt]] as const) {
      const s = unwrap(nullablePayload(unwrap(side)) ?? side);
      if (s.type === "Variant" && nullablePayload(s) === undefined && unwrap(other).type === "String") {
        const text = this.source(sidePath);
        const range = this.range(sidePath);
        const fixes = range !== undefined ? [edit("Use .type", range.to, range.to, ".type")] : [];
        return this.fail(range, "type_mismatch", MESSAGES.wholeVariant(text, describeType(side)), { fixes });
      }
    }
    const reported = this.diagnostics.length;
    const fits = this.comparable(lt, rt, node, path);
    // A literal that failed to parse as the other side's type has said so.
    if (this.diagnostics.length > reported) return { shape: ERROR, mult: ONE };
    if (fits) {
      // An Integer never equals a Float with a fraction.
      if ((op === "==" || op === "!=") && unwrap(nullablePayload(unwrap(lt)) ?? lt).type === "Integer" && node.value.right.type === "literal") {
        const literal = this.literal(node.value.right.value);
        if (literal.type.type === "Float" && !Number.isInteger(literal.value as number)) {
          return this.fail(this.range(path), "type_mismatch", MESSAGES.neverEqual(op));
        }
      }
      return { shape: typed(BooleanType), mult: ONE };
    }
    return this.mismatch(env, this.range(path), "type_mismatch", MESSAGES.compares(op, describeType(lt), describeType(rt)));
  }

  /** Whether two types compare: equal, numbers, a value and its option, or a literal rewritten to the other's type. */
  comparable(a: EastType, b: EastType, node: Extract<JqNode, { type: "binary" }>, path: string): boolean {
    const ua = unwrap(a);
    const ub = unwrap(b);
    if (isTypeEqual(ua, ub)) return true;
    if (isNumber(ua) && isNumber(ub)) {
      // A literal takes its operand's type.
      if (ua.type === "Float" && node.value.right.type === "literal") this.coerceLiteral(node.value.right, childPath(path, "binary.right"), FloatType);
      if (ub.type === "Float" && node.value.left.type === "literal") this.coerceLiteral(node.value.left, childPath(path, "binary.left"), FloatType);
      return true;
    }
    if (ua.type === "Null" && canBeNull(ub)) return true;
    if (ub.type === "Null" && canBeNull(ua)) return true;
    const pa = nullablePayload(ua);
    const pb = nullablePayload(ub);
    if (pa !== undefined || pb !== undefined) return this.comparable(pa ?? ua, pb ?? ub, node, path);
    if (ua.type === "DateTime" && node.value.right.type === "literal") return this.coerceLiteral(node.value.right, childPath(path, "binary.right"), DateTimeType) !== undefined;
    if (ub.type === "DateTime" && node.value.left.type === "literal") return this.coerceLiteral(node.value.left, childPath(path, "binary.left"), DateTimeType) !== undefined;
    return unify(ua, ub) !== undefined && ua.type === ub.type;
  }

  arithmetic(op: string, left: Result, right: Result, operands: Operands, env: Env): Result {
    const { leftPath, rightPath } = operands;
    const lt = this.collect(left, this.range(leftPath));
    const rt = this.collect(right, this.range(rightPath));
    if (lt === undefined || rt === undefined) return { shape: ERROR, mult: ONE };
    // An operand with no value (a recursion not yet known, `empty`) gives none.
    if (lt.type === "Never" || rt.type === "Never") return { shape: typed(NeverType), mult: ONE };
    const fail = (): Result => this.mismatch(env, operands.range, "type_mismatch", MESSAGES.arithmetic(op, describeType(lt), describeType(rt)));
    let a = unwrap(lt);
    let b = unwrap(rt);
    // `null` is the identity for `+`.
    if (op === "+") {
      if (a.type === "Null") return { shape: typed(b), mult: ONE };
      if (b.type === "Null") return { shape: typed(a), mult: ONE };
      const pa = nullablePayload(a);
      const pb = nullablePayload(b);
      if (pa !== undefined && pb !== undefined) {
        const inner = this.arithmetic(op, { shape: typed(pa), mult: ONE }, { shape: typed(pb), mult: ONE }, operands, env);
        const t = inner.shape.kind === "type" ? orNull(inner.shape.type) : undefined;
        return t === undefined ? inner : { shape: typed(t), mult: ONE };
      }
      if (pa !== undefined) a = unwrap(pa);
      if (pb !== undefined) b = unwrap(pb);
    } else if (nullablePayload(a) !== undefined || nullablePayload(b) !== undefined) {
      return fail();
    }
    if (isNumber(a) && isNumber(b)) {
      if (op === "/") return { shape: typed(FloatType), mult: ONE };
      if (op === "%") return { shape: typed(IntegerType), mult: ONE };
      if (a.type === "Float" || b.type === "Float") {
        if (a.type === "Integer" && operands.left.type === "literal") this.coerceLiteral(operands.left, leftPath, FloatType);
        if (b.type === "Integer" && operands.right.type === "literal") this.coerceLiteral(operands.right, rightPath, FloatType);
        return { shape: typed(FloatType), mult: ONE };
      }
      return { shape: typed(IntegerType), mult: ONE };
    }
    switch (op) {
      case "+":
        if (a.type === "String" && b.type === "String") return { shape: typed(StringType), mult: ONE };
        if (a.type === "Array" && b.type === "Array") {
          const element = unify(a.value as EastType, b.value as EastType);
          return element === undefined ? fail() : { shape: typed(ArrayType(element)), mult: ONE };
        }
        if (a.type === "Struct" && b.type === "Struct") return { shape: this.mergeStructs(left, right, false), mult: ONE };
        if (a.type === "Dict" && b.type === "Dict") {
          const merged = unify(a, b);
          return merged === undefined ? fail() : { shape: typed(merged), mult: ONE };
        }
        if ((a.type === "Struct" && Object.keys(a.fields).length === 0 && b.type === "Dict") || (b.type === "Struct" && Object.keys(b.fields).length === 0 && a.type === "Dict")) {
          return { shape: typed(a.type === "Dict" ? a : b), mult: ONE };
        }
        return fail();
      case "-":
        if (a.type === "Array" && b.type === "Array" && unify(a.value as EastType, b.value as EastType) !== undefined) return { shape: typed(a), mult: ONE };
        return fail();
      case "*":
        if (a.type === "Struct" && b.type === "Struct") return { shape: this.mergeStructs(left, right, true), mult: ONE };
        if (a.type === "String" && b.type === "Integer") {
          const t = orNull(StringType);
          return { shape: typed(t!), mult: ONE };
        }
        return fail();
      case "/":
        if (a.type === "String" && b.type === "String") return { shape: typed(ArrayType(StringType)), mult: ONE };
        return fail();
      default:
        return fail();
    }
  }

  /** `a + b` or `a * b` on structs: the fields of `a`, then the new fields of `b`; `b`'s value wins, and `*` merges struct fields deeply. */
  mergeStructs(left: Result, right: Result, deep: boolean): Shape {
    const merge = (a: EastType, b: EastType, aFacts: Facts | undefined, bFacts: Facts | undefined): { type: EastType; facts: Facts | undefined } => {
      const ua = unwrap(a);
      const ub = unwrap(b);
      const af = ua.type === "Struct" ? ua.fields as Record<string, EastType> : {};
      const bf = ub.type === "Struct" ? ub.fields as Record<string, EastType> : {};
      const fields: Record<string, EastType> = {};
      const facts = new Map<string, Facts>();
      const aKnown = aFacts?.kind === "fields" ? aFacts.fields : undefined;
      const bKnown = bFacts?.kind === "fields" ? bFacts.fields : undefined;
      for (const [name, t] of Object.entries(af)) {
        fields[name] = t;
        const f = aKnown?.get(name);
        if (f !== undefined) facts.set(name, f);
      }
      for (const [name, t] of Object.entries(bf)) {
        if (deep && name in af && unwrap(af[name]!).type === "Struct" && unwrap(t).type === "Struct") {
          const inner = merge(af[name]!, t, aKnown?.get(name), bKnown?.get(name));
          fields[name] = inner.type;
          if (inner.facts !== undefined) facts.set(name, inner.facts); else facts.delete(name);
        } else {
          fields[name] = t;
          const f = bKnown?.get(name);
          if (f !== undefined) facts.set(name, f); else facts.delete(name);
        }
      }
      return { type: StructType(fields), facts: facts.size > 0 ? { kind: "fields", fields: facts } : undefined };
    };
    const l = left.shape as TypeShape;
    const r = right.shape as TypeShape;
    const merged = merge(l.type, r.type, l.facts, r.facts);
    return typed(merged.type, merged.facts);
  }

  // ─── Construction ──────────────────────────────────────────────────────

  object(node: Extract<JqNode, { type: "object" }>, path: string, input: Result, env: Env): Result {
    let mult = ONE;
    const literal: { name: string; result: Result }[] = [];
    const computed: { key: Result; value: Result; keyPath: string }[] = [];
    let error = false;
    node.value.forEach((entry, i) => {
      const valuePath = childPath(path, `object[${i}].value.some`);
      const key = entry.key;
      let name: string | undefined;
      let value: Result | undefined;
      if (key.type === "name") name = key.value;
      else if (key.type === "variable") {
        name = key.value;
        if (entry.value.type === "none") value = this.variable(key.value, path, env);
      } else {
        const keyPath = childPath(path, `object[${i}].key.computed`);
        const k = this.check(key.value, keyPath, input, env);
        const v = entry.value.type === "some"
          ? this.check(entry.value.value, valuePath, input, env)
          : this.readField(input, "", this.range(keyPath), env, false, keyPath);
        mult = then(mult, then(k.mult, v.mult));
        if (k.shape.kind === "error" || v.shape.kind === "error") error = true;
        computed.push({ key: k, value: v, keyPath });
        return;
      }
      if (value === undefined) {
        value = entry.value.type === "some"
          ? this.check(entry.value.value, valuePath, input, env)
          : this.readField(input, name, this.range(path), env, false, path);
      }
      if (value.shape.kind === "error") error = true;
      mult = then(mult, value.mult);
      const earlier = literal.findIndex(l => l.name === name);
      if (earlier !== -1) {
        this.warn(this.range(path), "duplicate_key", MESSAGES.duplicateKey(printString(name)));
        literal[earlier] = { name, result: value };
      } else {
        literal.push({ name, result: value });
      }
    });
    if (error) return { shape: ERROR, mult };
    if (literal.length > 0 && computed.length > 0) return this.fail(this.range(path), "type_mismatch", MESSAGES.mixedKeys());
    if (computed.length > 0) {
      let keyType: EastType = NeverType;
      let valueType: EastType = NeverType;
      for (const c of computed) {
        const k = this.collect(c.key, this.range(c.keyPath));
        const v = this.collect(c.value, this.range(path));
        if (k === undefined || v === undefined) return { shape: ERROR, mult };
        const nk = unify(keyType, k);
        const nv = unify(valueType, v);
        if (nk === undefined) return this.fail(this.range(c.keyPath), "ambiguous_output", MESSAGES.noCommonType(describeType(keyType), describeType(k)));
        if (nv === undefined) return this.fail(this.range(path), "ambiguous_output", MESSAGES.noCommonType(describeType(valueType), describeType(v)));
        keyType = nk;
        valueType = nv;
      }
      if (!isImmutableType(keyType)) return this.fail(this.range(computed[0]!.keyPath), "type_mismatch", MESSAGES.mutableKey(this.source(computed[0]!.keyPath), describeType(keyType)));
      return { shape: typed(DictType(keyType, valueType)), mult };
    }
    const fields: Record<string, EastType> = {};
    const facts = new Map<string, Facts>();
    for (const l of literal) {
      const t = this.collect(l.result, this.range(path));
      if (t === undefined) return { shape: ERROR, mult };
      fields[l.name] = t;
      if (l.result.shape.kind === "type" && l.result.shape.facts !== undefined) facts.set(l.name, l.result.shape.facts);
    }
    return { shape: typed(StructType(fields), facts.size > 0 ? { kind: "fields", fields: facts } : undefined), mult };
  }

  format(node: Extract<JqNode, { type: "format" }>, path: string, input: Result, env: Env): Result {
    const { name, string } = node.value;
    const builtin = BUILTINS.get(`@${name}`);
    if (builtin === undefined) return this.fail(this.range(path), "unknown_function", MESSAGES.unknownFunction(`@${name}`, 0, closest(`@${name}`, [...BUILTINS.keys()].filter(k => k.startsWith("@")))[0]));
    const status = this.availability(builtin, `@${name}`, path);
    if (status !== undefined) return status;
    if (string.type === "some") {
      let mult = ONE;
      const inner = string.value as JqNode;
      if (inner.type === "string") {
        inner.value.forEach((part, i) => {
          if (part.type === "interpolate") {
            const partPath = childPath(childPath(path, "format.string.some"), `string[${i}].interpolate`);
            const r = this.check(part.value, partPath, input, env);
            mult = then(mult, r.mult);
            // Each interpolated value is formatted, so it must be one the format takes.
            if (r.shape.kind !== "error") builtin.typing!(this.context(builtin, `@${name}`, partPath, r, env, [], []));
          }
        });
      }
      this.record(childPath(path, "format.string.some"), env, { shape: typed(StringType), mult });
      return { shape: typed(StringType), mult };
    }
    return builtin.typing!(this.context(builtin, `@${name}`, path, input, env, [], []));
  }

  // ─── Control ───────────────────────────────────────────────────────────

  /** Adds facts to a result's shape. */
  narrow(input: Result, proves: readonly Proof[]): Result {
    let shape = input.shape;
    for (const proof of proves) {
      if (proof.kind === "case") shape = refine(shape, proof.path, proof.cases);
      else if (proof.path.length === 0) shape = narrowTypes(shape, proof.types);
    }
    return { ...input, shape };
  }

  conditional(node: Extract<JqNode, { type: "if" }>, path: string, input: Result, env: Env): Result {
    const { branches, otherwise } = node.value;
    const members: Member[] = [];
    let mult: Mult | undefined;
    let error = false;
    let rest = input;
    let condMult = ONE;
    branches.forEach((branch, i) => {
      const condition = this.check(branch.condition, childPath(path, `if.branches[${i}].condition`), rest, env);
      condMult = then(condMult, condition.mult);
      const thenInput = condition.proves !== undefined ? this.narrow(rest, condition.proves) : rest;
      const result = this.check(branch.then, childPath(path, `if.branches[${i}].then`), thenInput, env);
      if (condition.shape.kind === "error" || result.shape.kind === "error") error = true;
      members.push(...membersOf(result.shape));
      mult = mult === undefined ? result.mult : either(mult, result.mult);
      // The next branch runs when this condition is false.
      if (condition.proves !== undefined && condition.proves.length === 1) {
        const proof = condition.proves[0]!;
        if (proof.kind === "case") {
          const variantShape = this.shapeAt(rest.shape, proof.path);
          if (variantShape !== undefined) {
            const others = casesOf(variantShape.type, variantShape.facts).filter(c => !proof.cases.includes(c));
            rest = this.narrow(rest, [{ kind: "case", path: proof.path, cases: others }]);
          }
        } else {
          rest = this.narrow(rest, [{ kind: "type", path: proof.path, types: JQ_TYPE_NAMES.filter(name => !proof.types.includes(name)) }]);
        }
      }
    });
    const other = otherwise.type === "some"
      ? this.check(otherwise.value, childPath(path, "if.otherwise.some"), rest, env)
      : { shape: rest.shape, mult: ONE };
    if (other.shape.kind === "error" || error) return { shape: ERROR, mult: ONE };
    members.push(...membersOf(other.shape));
    return { shape: union(members), mult: then(condMult, either(mult ?? ONE, other.mult)) };
  }

  /** The shape at a field path, for narrowing's else branch. */
  shapeAt(shape: Shape, path: readonly string[]): TypeShape | undefined {
    if (shape.kind !== "type") return undefined;
    let current: TypeShape = shape;
    for (const name of path) {
      const t = unwrap(current.type);
      if (t.type !== "Struct") return undefined;
      const fields = t.fields as Record<string, EastType>;
      if (!(name in fields)) return undefined;
      current = typed(fields[name]!, current.facts?.kind === "fields" ? current.facts.fields.get(name) : undefined);
    }
    return current;
  }

  tryCatch(node: Extract<JqNode, { type: "try" }>, path: string, input: Result, env: Env): Result {
    const body = this.check(node.value.body, childPath(path, "try.body"), input, { ...env, lenient: true });
    if (node.value.catch.type === "none") return { shape: body.shape, mult: { lo: 0, hi: body.mult.hi } };
    // Error values are strings: `error(v)` raises `v`'s East text (§13.14).
    const handler = this.check(node.value.catch.value, childPath(path, "try.catch.some"), { shape: typed(StringType), mult: ONE }, env);
    if (body.shape.kind === "error" || handler.shape.kind === "error") return { shape: ERROR, mult: ONE };
    return { shape: union([...membersOf(body.shape), ...membersOf(handler.shape)]), mult: { lo: 0, hi: Math.max(body.mult.hi, handler.mult.hi) as 0 | 1 | 2 } };
  }

  fold(node: Extract<JqNode, { type: "reduce" | "foreach" }>, path: string, input: Result, env: Env): Result {
    const kind = node.type;
    const source = this.check(node.value.source, childPath(path, `${kind}.source`), input, env);
    const init = this.check(node.value.init, childPath(path, `${kind}.init`), input, env);
    if (source.shape.kind === "error" || init.shape.kind === "error") return { shape: ERROR, mult: ONE };
    const element = this.collect(source, this.range(childPath(path, `${kind}.source`)));
    let acc = this.collect(init, this.range(childPath(path, `${kind}.init`)));
    if (element === undefined || acc === undefined) return { shape: ERROR, mult: ONE };
    const bound = this.destructure(node.value.pattern, childPath(path, `${kind}.pattern`), { shape: typed(element), mult: ONE }, env);
    if (bound === undefined) return { shape: ERROR, mult: ONE };
    const inner: Env = { ...env, vars: new Map([...env.vars, ...bound]) };
    let update: Result | undefined;
    const first = acc;
    for (let round = 0; round < 8; round++) {
      const errors = this.diagnostics.length;
      update = this.check(node.value.update, childPath(path, `${kind}.update`), { shape: typed(acc), mult: ONE }, inner);
      if (update.shape.kind === "error") return { shape: ERROR, mult: ONE };
      const next = this.collect(update, this.range(childPath(path, `${kind}.update`)));
      if (next === undefined) return { shape: ERROR, mult: ONE };
      const merged = unify(acc, next);
      if (merged === undefined) {
        return this.fail(this.range(path), "cannot_infer", MESSAGES.accumulator(kind, describeType(first), describeType(next)));
      }
      if (isTypeEqual(merged, acc)) break;
      // A round that changed the accumulator's type is checked again; drop its problems.
      this.diagnostics.length = errors;
      acc = merged;
      if (round === 7) return this.fail(this.range(path), "cannot_infer", MESSAGES.accumulator(kind, describeType(first), describeType(merged)));
    }
    if (kind === "reduce") return { shape: typed(acc), mult: ONE };
    const extract = (node as Extract<JqNode, { type: "foreach" }>).value.extract;
    if (extract.type === "none") return { shape: typed(acc), mult: MANY };
    const out = this.check(extract.value, childPath(path, "foreach.extract.some"), { shape: typed(acc), mult: ONE }, inner);
    return { shape: out.shape, mult: MANY };
  }

  bind(node: Extract<JqNode, { type: "bind" }>, path: string, input: Result, env: Env): Result {
    const source = this.check(node.value.source, childPath(path, "bind.source"), input, env);
    if (source.shape.kind === "error") return { shape: ERROR, mult: ONE };
    const alternatives = node.value.patterns;
    const bindings: Map<string, Result>[] = [];
    alternatives.forEach((pattern, i) => {
      const errors = this.diagnostics.length;
      const bound = this.destructure(pattern, childPath(path, `bind.patterns[${i}]`), source, env);
      // With ?//, a pattern that cannot match is skipped at run time.
      if (bound === undefined && alternatives.length > 1 && i < alternatives.length - 1) this.diagnostics.length = errors;
      if (bound !== undefined) bindings.push(bound);
    });
    if (bindings.length === 0) return { shape: ERROR, mult: ONE };
    const names = new Set(bindings.flatMap(b => [...b.keys()]));
    const vars = new Map(env.vars);
    for (const name of names) {
      let type: EastType = NeverType;
      let facts: Facts | undefined;
      for (const b of bindings) {
        const r = b.get(name);
        const t = r === undefined ? NullType : (r.shape.kind === "type" ? r.shape.type : unifyShape(r.shape) ?? NeverType);
        type = unify(type, t) ?? type;
        if (bindings.length === 1 && r?.shape.kind === "type") facts = r.shape.facts;
      }
      vars.set(name, { shape: typed(type, facts), mult: ONE });
    }
    const body = this.check(node.value.body, childPath(path, "bind.body"), input, { ...env, vars });
    return { shape: body.shape, mult: then(source.mult, body.mult), stream: body.stream };
  }

  /** The variables a pattern binds from a source, or `undefined` after a reported problem. */
  destructure(pattern: JqPattern, path: string, source: Result, env: Env): Map<string, Result> | undefined {
    const out = new Map<string, Result>();
    const visit = (p: JqPattern, at: string, value: Result): boolean => {
      if (value.shape.kind === "error") return false;
      switch (p.type) {
        case "variable": out.set(p.value, value); return true;
        case "array": {
          return p.value.every((item: JqPattern, i: number) => {
            const element = this.mapMembers(value, member => {
              const t = unwrap(member.type);
              const container = t.type === "Array" ? t.value as EastType : t.type === "Vector" ? t.element as EastType : undefined;
              if (container === undefined) {
                if (t.type === "Null") return { shape: typed(NullType), mult: ONE };
                return this.fail(this.range(at), "type_mismatch", MESSAGES.input("an array pattern", "an array", describeType(member.type)));
              }
              const e = orNull(container);
              return e === undefined ? this.fail(this.range(at), "ambiguous_output", MESSAGES.noCommonType(describeType(container), "Null")) : { shape: typed(e), mult: ONE };
            });
            return visit(item, childPath(at, `array[${i}]`), element);
          });
        }
        case "object": {
          return p.value.every((entry: { key: string; value: { type: "none" | "some"; value: any } }, i: number) => {
            const read = this.readField(value, entry.key, this.range(at), env, false, at);
            if (read.shape.kind === "error") return false;
            if (entry.value.type === "none") { out.set(entry.key, read); return true; }
            return visit(entry.value.value as JqPattern, childPath(at, `object[${i}].value.some`), read);
          });
        }
      }
    };
    return visit(pattern, path, { shape: source.shape, mult: ONE }) ? out : undefined;
  }

  // ─── Calls ─────────────────────────────────────────────────────────────

  call(node: Extract<JqNode, { type: "call" }>, path: string, input: Result, env: Env): Result {
    const { args, name } = node.value;
    const binding = env.defs.get(`${name}/${args.length}`);
    if (binding !== undefined) {
      if (binding.kind === "param") {
        const instance = `${env.instance}>${path}`;
        return this.check(binding.arg, binding.path, input, { ...binding.env, instance, lenient: env.lenient });
      }
      return this.callDef(binding, node, path, input, env);
    }
    const builtin = BUILTINS.get(name);
    // A builtin a query may not use says so, whatever it is given.
    if (builtin !== undefined && builtin.status !== "supported" && builtin.status !== "tooling") return this.availability(builtin, name, path)!;
    if (builtin === undefined || !builtin.arities.includes(args.length)) {
      const defined = [...env.defs.keys()].filter(k => k.startsWith(`${name}/`)).map(k => Number(k.slice(name.length + 1)));
      const arities = builtin?.arities ?? defined;
      if (arities.length > 0) return this.fail(this.range(path), "arity", MESSAGES.arity(name, [...arities].sort(), args.length));
      const candidates = [...new Set([...[...env.defs.keys()].map(k => k.split("/")[0]!), ...[...BUILTINS.keys()].filter(k => !k.startsWith("@"))])];
      const suggestions = closest(name, candidates);
      return this.fail(this.range(path), "unknown_function", MESSAGES.unknownFunction(name, args.length, suggestions[0]), { suggestions });
    }
    const unavailable = this.availability(builtin, name, path);
    if (unavailable !== undefined) return unavailable;
    const argPaths = args.map((_, i) => childPath(path, `call.args[${i}]`));
    return builtin.typing!(this.context(builtin, name, path, input, env, args, argPaths));
  }

  /** A builtin a query may not call: its diagnostic. */
  availability(builtin: Builtin, name: string, path: string): Result | undefined {
    switch (builtin.status) {
      case "supported": return undefined;
      case "excluded": return this.fail(this.range(path), "unsupported", MESSAGES.excluded(name));
      case "unavailable": return this.fail(this.range(path), "unsupported", MESSAGES.unavailable(name, builtin.reason ?? ""));
      case "not_yet": return this.fail(this.range(path), "unsupported", MESSAGES.notYet(name));
      case "tooling": return this.options.tooling === true ? undefined : this.fail(this.range(path), "unsupported", MESSAGES.tooling(name));
    }
  }

  callDef(binding: Extract<Binding, { kind: "def" }>, node: Extract<JqNode, { type: "call" }>, path: string, input: Result, env: Env): Result {
    const def = binding.node.value;
    const closure = binding.env();
    const vars = new Map(closure.vars);
    const defs = new Map(closure.defs);
    let mult = ONE;
    const signature: string[] = [binding.path, input.shape.kind === "type" ? printType(input.shape.type) : "?"];
    let filters = false;
    def.params.forEach((param, i) => {
      const argPath = childPath(path, `call.args[${i}]`);
      if (param.startsWith("$")) {
        const value = this.check(node.value.args[i]!, argPath, input, env);
        mult = then(mult, value.mult);
        const t = this.collect(value, this.range(argPath));
        const shape = t === undefined ? ERROR : typed(t);
        vars.set(param.slice(1), { shape, mult: ONE });
        defs.set(`${param.slice(1)}/0`, { kind: "param", arg: variant("variable", param.slice(1)) as JqNode, path: argPath, env: { ...closure, vars } });
        signature.push(t === undefined ? "?" : printType(t));
      } else {
        filters = true;
        defs.set(`${param}/0`, { kind: "param", arg: node.value.args[i]!, path: argPath, env });
      }
    });
    const key = signature.join("|");
    const active = this.active.get(key);
    if (active !== undefined) {
      // A recursive call: its output so far.
      if (active.filters) return this.fail(this.range(path), "unsupported", MESSAGES.recursiveFilter(def.name));
      active.recursed = true;
      return active.result;
    }
    const instance = `${env.instance}>${path}`;
    const bodyEnv: Env = { vars, defs, labels: closure.labels, instance, lenient: env.lenient };
    // The recursion's outputs so far: none known yet, as `lo: 1, hi: 0` (the
    // identity of `either`), so the fixpoint can find a lower bound of one.
    const state = { result: { shape: typed(NeverType), mult: { lo: 1, hi: 0 } } as Result, recursed: false, filters };
    this.active.set(key, state);
    try {
      for (let round = 0; round < 8; round++) {
        const errors = this.diagnostics.length;
        state.recursed = false;
        const result = this.check(def.body, childPath(binding.path, "def.body"), input, bodyEnv);
        if (result.shape.kind === "error" || !state.recursed) return { ...result, mult: then(mult, result.mult) };
        const before = unifyShape(state.result.shape);
        const after = unifyShape(result.shape);
        const merged = before === undefined || after === undefined ? undefined : unify(before, after);
        if (merged === undefined) return this.fail(this.range(path), "cannot_infer", MESSAGES.recursion(def.name));
        const next: Mult = { lo: state.result.mult.lo === 1 && result.mult.lo === 1 ? 1 : 0, hi: Math.max(state.result.mult.hi, result.mult.hi) as 0 | 1 | 2 };
        if (isTypeEqual(merged, before!) && next.lo === state.result.mult.lo && next.hi === state.result.mult.hi) {
          return { shape: result.shape, mult: then(mult, result.mult) };
        }
        // A round that changed what the recursion gives is checked again; drop its problems.
        this.diagnostics.length = errors;
        state.result = { shape: typed(merged), mult: next };
      }
      return this.fail(this.range(path), "cannot_infer", MESSAGES.recursion(def.name));
    } finally {
      this.active.delete(key);
    }
  }

  /** The context a builtin types a call in. */
  context(builtin: Builtin, name: string, path: string, input: Result, env: Env, args: readonly JqNode[], argPaths: readonly string[]): CallContext {
    return {
      name,
      path,
      input,
      args,
      argPaths,
      range: this.range(path),
      argRange: (i: number) => this.range(argPaths[i]!),
      arg: (i: number, argInput?: Result) => this.check(args[i]!, argPaths[i]!, argInput ?? { ...input, access: undefined, stream: undefined }, env),
      literal: (i: number) => {
        const arg = args[i];
        return arg?.type === "literal" ? this.literal(arg.value) : undefined;
      },
      literalOf: (node: Extract<JqNode, { type: "literal" }>) => this.literal(node.value),
      coerceArg: (i: number, wanted: EastType) => {
        const arg = args[i];
        return arg?.type === "literal" ? this.coerceLiteral(arg, argPaths[i]!, unwrap(wanted)) : undefined;
      },
      fail: (code: string, message: string, options?: { arg?: number; suggestions?: string[]; fixes?: QueryFix[] }) =>
        this.fail(options?.arg !== undefined ? this.range(argPaths[options.arg]!) : this.range(path), code, message, options),
      mismatch: (code: string, message: string, arg?: number, fixes?: QueryFix[]) =>
        this.mismatch(env, arg !== undefined ? this.range(argPaths[arg]!) : this.range(path), code, message, { fixes: fixes ?? [] }),
      skipNulls: () => {
        const range = this.range(path);
        return range !== undefined && isPipePosition(path) ? edit("Skip nulls", range.from, range.from, "values | ") : undefined;
      },
      warn: (code: string, message: string, fixes?: QueryFix[]) => this.warn(this.range(path), code, message, fixes),
      rewrite: (replacement: JqNode) => { this.rewrites.set(path, replacement); },
      rewriteArg: (i: number, replacement: JqNode) => { this.rewrites.set(argPaths[i]!, replacement); },
      source: (i?: number) => i === undefined ? this.source(path) : this.source(argPaths[i]!),
      collect: (result: Result, arg?: number) => this.collect(result, arg !== undefined ? this.range(argPaths[arg]!) : this.range(path)),
      isRoot: (shape: Shape) => shape.kind === "type" && this.isRootShape(shape),
      refuseRoot: () => this.refuseRoot(input, path, env),
      narrow: (result: Result, proves: readonly Proof[]) => this.narrow(result, proves),
      narrowFirst: (type: EastType) => this.narrowFirst(env, this.range(path), type, input.partial!),
      onElement: (type: EastType) => this.arrayOnElement(env, path, name, input.stream!, type),
      text: this.text,
      rangeAt: (at: string) => this.range(at),
      resultAt: (at: string) => this.records.get(`${env.instance}|${at}`),
      builtin,
    };
  }

  // ─── Assignment ────────────────────────────────────────────────────────

  update(node: Extract<JqNode, { type: "update" }>, path: string, input: Result, env: Env): Result {
    const { op } = node.value;
    const pathPath = childPath(path, "update.path");
    const valuePath = childPath(path, "update.value");
    if (input.shape.kind === "error") return { shape: ERROR, mult: ONE };
    // The value of `=` and of the arithmetic updates is evaluated on `.`.
    let value: Result | undefined;
    if (op !== "|=") {
      value = this.check(node.value.value, valuePath, input, env);
      if (value.shape.kind === "error") return { shape: ERROR, mult: ONE };
    }
    const at = (current: Result): Result => {
      if (op === "|=") return this.check(node.value.value, valuePath, current, env);
      if (op === "=") return value!;
      const operator = op.slice(0, -1);
      if (operator === "//") {
        if (current.shape.kind === "type" && !canBeNull(unwrap(current.shape.type)) && unwrap(current.shape.type).type !== "Boolean") {
          this.warn(this.range(pathPath), "never_missing", MESSAGES.neverMissing(this.source(pathPath), describeType(current.shape.type)));
        }
        const kept = this.mapMembers(current, m => {
          const t = unwrap(m.type);
          const payload = nullablePayload(t);
          if (t.type === "Null") return { shape: typed(NeverType), mult: ZERO };
          return { shape: typed(payload ?? m.type), mult: ONE };
        });
        return { shape: union([...membersOf(kept.shape), ...membersOf(value!.shape)]), mult: ONE };
      }
      return this.arithmetic(operator, current, value!, { left: node.value.path, leftPath: pathPath, right: node.value.value, rightPath: valuePath, range: this.range(path) }, env);
    };
    const shape = this.assign(input.shape, node.value.path, pathPath, at, env);
    if (shape === undefined) return { shape: ERROR, mult: ONE };
    return { shape, mult: value === undefined ? ONE : value.mult };
  }

  /**
   * The shape of `.` after assigning at the positions a path expression
   * names, each position's new value given by `at`.
   *
   * @returns the new shape, or `undefined` after a reported problem
   */
  assign(shape: Shape, pathNode: JqNode, path: string, at: (current: Result) => Result, env: Env): Shape | undefined {
    if (shape.kind === "error") return undefined;
    const members: Member[] = [];
    for (const member of membersOf(shape)) {
      const next = this.assignMember(member.shape, pathNode, path, at, env);
      if (next === undefined) return undefined;
      members.push({ shape: next, case: member.case });
    }
    return union(members);
  }

  assignMember(shape: TypeShape, pathNode: JqNode, path: string, at: (current: Result) => Result, env: Env): TypeShape | undefined {
    const settle = (result: Result, range: JqRange | undefined): EastType | undefined => this.collect(result, range);
    switch (pathNode.type) {
      case "identity": {
        const t = settle(at({ shape, mult: ONE }), this.range(path));
        return t === undefined ? undefined : typed(t);
      }
      case "pipe": {
        const left = pathNode.value.left;
        const right = pathNode.value.right;
        return this.assignMember(shape, left, childPath(path, "pipe.left"), current => {
          const next = this.assign(current.shape, right, childPath(path, "pipe.right"), at, env);
          return next === undefined ? { shape: ERROR, mult: ONE } : { shape: next, mult: ONE };
        }, env);
      }
      case "field": case "index": case "iterate": {
        const target = pathNode.value.target;
        const targetPath = childPath(path, `${pathNode.type}.target`);
        return this.assignMember(shape, target, targetPath, current => {
          const inner = this.assignStep(current, pathNode, path, at, env);
          return inner === undefined ? { shape: ERROR, mult: ONE } : { shape: inner, mult: ONE };
        }, env);
      }
      case "call": {
        if (pathNode.value.name === "select" && pathNode.value.args.length === 1) {
          const condition = this.check(pathNode.value.args[0]!, childPath(path, "call.args[0]"), { shape, mult: ONE }, env);
          const narrowed = condition.proves !== undefined ? this.narrow({ shape, mult: ONE }, condition.proves) : { shape, mult: ONE };
          const replaced = at(narrowed);
          const t = settle(replaced, this.range(path));
          if (t === undefined) return undefined;
          const merged = unify(shape.type, t);
          if (merged === undefined) {
            this.fail(this.range(path), "ambiguous_output", MESSAGES.noCommonType(describeType(shape.type), describeType(t)));
            return undefined;
          }
          return typed(merged);
        }
        this.fail(this.range(path), "unsupported", MESSAGES.unavailable(`assigning to ${pathNode.value.name}(…)`, "an update's path is made of field reads, indexes, .[], select and |"));
        return undefined;
      }
      default:
        this.fail(this.range(path), "unsupported", MESSAGES.unavailable(`assigning to ${this.source(path)}`, "an update's path is made of field reads, indexes, .[], select and |"));
        return undefined;
    }
  }

  /** One step of an update's path on a value: `.name`, `.[k]` or `.[]`. */
  assignStep(current: Result, step: Extract<JqNode, { type: "field" | "index" | "iterate" }>, path: string, at: (current: Result) => Result, env: Env): Shape | undefined {
    return this.assign(current.shape, variant("identity", null) as JqNode, path, whole => {
      const member = whole.shape as TypeShape;
      const t = unwrap(member.type);
      const replace = (old: EastType, facts: Facts | undefined): EastType | undefined => this.collect(at({ shape: typed(old, facts), mult: ONE }), this.range(path));
      if (step.type === "field" || (step.type === "index" && step.value.index.type === "literal" && this.literal(step.value.index.value).type.type === "String" && t.type !== "Dict")) {
        const name = step.type === "field" ? step.value.name : this.literal((step.value.index as Extract<JqNode, { type: "literal" }>).value).value as string;
        if (t.type === "Struct") {
          const fields = { ...(t.fields as Record<string, EastType>) };
          const facts = member.facts?.kind === "fields" ? member.facts.fields.get(name) : undefined;
          const next = replace(name in fields ? fields[name]! : NullType, facts);
          if (next === undefined) return { shape: ERROR, mult: ONE };
          fields[name] = next;
          return { shape: typed(StructType(fields)), mult: ONE };
        }
        if (t.type === "Null") {
          const next = replace(NullType, undefined);
          return next === undefined ? { shape: ERROR, mult: ONE } : { shape: typed(StructType({ [name]: next })), mult: ONE };
        }
        if (t.type === "Dict" && unwrap(t.key as EastType).type === "String") {
          const old = orNull(t.value as EastType) ?? (t.value as EastType);
          const next = replace(old, undefined);
          const merged = next === undefined ? undefined : unify(t.value as EastType, next);
          if (merged === undefined) return { shape: ERROR, mult: ONE };
          return { shape: typed(DictType(t.key as EastType, merged)), mult: ONE };
        }
        return this.mismatch(env, this.range(path), "type_mismatch", MESSAGES.notAField(`.${name}`, describeType(member.type)));
      }
      if (step.type === "index") {
        const keyPath = childPath(path, "index.index");
        const key = this.check(step.value.index, keyPath, { shape: typed(t), mult: ONE }, env);
        const keyType = this.collect(key, this.range(keyPath));
        if (keyType === undefined) return { shape: ERROR, mult: ONE };
        if (t.type === "Array") {
          const next = replace(orNull(t.value as EastType) ?? (t.value as EastType), undefined);
          const merged = next === undefined ? undefined : unify(t.value as EastType, next);
          return merged === undefined ? { shape: ERROR, mult: ONE } : { shape: typed(ArrayType(merged)), mult: ONE };
        }
        if (t.type === "Dict" || (t.type === "Struct" && Object.keys(t.fields).length === 0) || t.type === "Null") {
          const dictKey = t.type === "Dict" ? t.key as EastType : keyType;
          const dictValue = t.type === "Dict" ? t.value as EastType : NeverType;
          if (!this.keyFits(keyType, dictKey, step.value.index, keyPath)) {
            return this.mismatch(env, this.range(keyPath), "type_mismatch", MESSAGES.keyType(".[…]", describeType(dictKey), this.source(keyPath), describeType(keyType)));
          }
          const next = replace(dictValue.type === "Never" ? NullType : (orNull(dictValue) ?? dictValue), undefined);
          const merged = next === undefined ? undefined : unify(dictValue, next);
          if (merged === undefined || !isImmutableType(dictKey)) return { shape: ERROR, mult: ONE };
          return { shape: typed(DictType(dictKey, merged)), mult: ONE };
        }
        return this.mismatch(env, this.range(path), "not_indexable", MESSAGES.notIndexable(this.source(childPath(path, "index.target")) || ".", describeType(member.type)));
      }
      // `.[]`: every element.
      switch (t.type) {
        case "Array": {
          const next = replace(t.value as EastType, member.facts?.kind === "elements" ? member.facts.element : undefined);
          return next === undefined ? { shape: ERROR, mult: ONE } : { shape: typed(ArrayType(next)), mult: ONE };
        }
        case "Dict": {
          const next = replace(t.value as EastType, undefined);
          return next === undefined ? { shape: ERROR, mult: ONE } : { shape: typed(DictType(t.key as EastType, next)), mult: ONE };
        }
        case "Struct": {
          const fields: Record<string, EastType> = {};
          for (const [name, f] of Object.entries(t.fields as Record<string, EastType>)) {
            const next = replace(f, undefined);
            if (next === undefined) return { shape: ERROR, mult: ONE };
            fields[name] = next;
          }
          return { shape: typed(StructType(fields)), mult: ONE };
        }
        default:
          return this.mismatch(env, this.range(path), "not_iterable", MESSAGES.notIterable(".[]", describeType(member.type)));
      }
    }, env);
  }

  // ─── The checked query ─────────────────────────────────────────────────

  /** The program with every recorded rewrite applied. */
  rewrite(node: JqNode, path: string): JqNode {
    const replacement = this.rewrites.get(path);
    if (replacement !== undefined) return replacement;
    const children = jqChildren(node);
    if (children.length === 0) return node;
    const map = (child: JqNode, step: string): JqNode => this.rewrite(child, childPath(path, step));
    const opt = (o: { type: "none" | "some"; value: any }, step: string) => o.type === "some" ? variant("some", map(o.value, `${step}.some`)) : o;
    switch (node.type) {
      case "alternative": case "comma": case "pipe":
        return variant(node.type, { left: map(node.value.left, `${node.type}.left`), right: map(node.value.right, `${node.type}.right`) }) as JqNode;
      case "binary":
        return variant("binary", { left: map(node.value.left, "binary.left"), op: node.value.op, right: map(node.value.right, "binary.right") }) as JqNode;
      case "array":
        return variant("array", opt(node.value, "array")) as JqNode;
      case "bind":
        return variant("bind", { body: map(node.value.body, "bind.body"), patterns: node.value.patterns, source: map(node.value.source, "bind.source") }) as JqNode;
      case "call":
        return variant("call", { args: node.value.args.map((a, i) => map(a, `call.args[${i}]`)), name: node.value.name }) as JqNode;
      case "def":
        return variant("def", { body: map(node.value.body, "def.body"), name: node.value.name, params: node.value.params, rest: map(node.value.rest, "def.rest") }) as JqNode;
      case "field":
        return variant("field", { name: node.value.name, optional: node.value.optional, target: map(node.value.target, "field.target") }) as JqNode;
      case "foreach":
        return variant("foreach", { extract: opt(node.value.extract, "foreach.extract"), init: map(node.value.init, "foreach.init"), pattern: node.value.pattern, source: map(node.value.source, "foreach.source"), update: map(node.value.update, "foreach.update") }) as JqNode;
      case "format":
        return variant("format", { name: node.value.name, string: opt(node.value.string, "format.string") }) as JqNode;
      case "if":
        return variant("if", {
          branches: node.value.branches.map((b, i) => ({ condition: map(b.condition, `if.branches[${i}].condition`), then: map(b.then, `if.branches[${i}].then`) })),
          otherwise: opt(node.value.otherwise, "if.otherwise"),
        }) as JqNode;
      case "index":
        return variant("index", { index: map(node.value.index, "index.index"), optional: node.value.optional, target: map(node.value.target, "index.target") }) as JqNode;
      case "iterate":
        return variant("iterate", { optional: node.value.optional, target: map(node.value.target, "iterate.target") }) as JqNode;
      case "label":
        return variant("label", { body: map(node.value.body, "label.body"), name: node.value.name }) as JqNode;
      case "negate":
        return variant("negate", map(node.value, "negate")) as JqNode;
      case "object":
        return variant("object", node.value.map((entry, i) => ({
          key: entry.key.type === "computed" ? variant("computed", map(entry.key.value, `object[${i}].key.computed`)) : entry.key,
          value: opt(entry.value, `object[${i}].value`),
        }))) as JqNode;
      case "reduce":
        return variant("reduce", { init: map(node.value.init, "reduce.init"), pattern: node.value.pattern, source: map(node.value.source, "reduce.source"), update: map(node.value.update, "reduce.update") }) as JqNode;
      case "slice":
        return variant("slice", { from: opt(node.value.from, "slice.from"), optional: node.value.optional, target: map(node.value.target, "slice.target"), to: opt(node.value.to, "slice.to") }) as JqNode;
      case "string":
        return variant("string", node.value.map((part, i) => part.type === "interpolate" ? variant("interpolate", map(part.value, `string[${i}].interpolate`)) : part)) as JqNode;
      case "try":
        return variant("try", { body: map(node.value.body, "try.body"), catch: opt(node.value.catch, "try.catch") }) as JqNode;
      case "update":
        return variant("update", { op: node.value.op, path: map(node.value.path, "update.path"), value: map(node.value.value, "update.value") }) as JqNode;
      default:
        return node;
    }
  }
}

/** The field names of outputs that are field reads side by side, `.a, .b`: what `{a, b}` would hold. */
function fieldsSideBySide(node: JqNode): string[] | undefined {
  if (node.type === "comma") {
    const left = fieldsSideBySide(node.value.left);
    const right = fieldsSideBySide(node.value.right);
    return left === undefined || right === undefined ? undefined : [...left, ...right];
  }
  if (node.type === "field" && node.value.target.type === "identity" && !node.value.optional && /^[A-Za-z_][A-Za-z0-9_]*$/.test(node.value.name)) {
    return [node.value.name];
  }
  return undefined;
}

/** The steps that lead to a node where a pipe can start without parentheses. */
const PIPE_POSITION = /(^|\.)(pipe\.(left|right)|call\.args\[\d+\]|array\.some|bind\.body|label\.body|def\.(body|rest)|if\.branches\[\d+\]\.(condition|then)|if\.otherwise\.some|object\[\d+\]\.value\.some|reduce\.update|foreach\.update|foreach\.extract\.some|try\.catch\.some)$/;

/** Whether a node at a path can have `f | ` put before it without parentheses. */
function isPipePosition(path: string): boolean {
  return path === "" || PIPE_POSITION.test(path);
}

/** Whether a `break $name` for a label is in a node, outside any label of the same name inside it. */
function breaksTo(node: JqNode, name: string): boolean {
  if (node.type === "break") return node.value === name;
  if (node.type === "label" && node.value.name === name) return false;
  return jqChildren(node).some(child => child.node !== undefined && breaksTo(child.node, name));
}

/** The top-level pipeline's stages: its segments, through the bodies of the `as` that lead it. */
function spine(node: JqNode, path: string): { node: JqNode; path: string }[] {
  if (node.type === "pipe") return [{ node: node.value.left, path: childPath(path, "pipe.left") }, ...spine(node.value.right, childPath(path, "pipe.right"))];
  if (node.type === "bind") return spine(node.value.body, childPath(path, "bind.body"));
  return [{ node, path }];
}

/**
 * Checks a jq program against the East type of its input.
 *
 * @param program - the program's text, or what {@link parseJq} made of it
 * @param input - the type the program runs on
 * @param options - `root` for an e3 root, `tooling` for the tooling-only builtins
 * @returns the checked query when there is no error, the element type and
 *   multiplicity, the root fields read, the stages, every node's type, and
 *   the diagnostics
 *
 * @remarks
 * The checker types every node over East types as `devdocs/QUERY.md` says: it
 * narrows variants through `select` and `if`, infers `reduce` and `foreach`
 * accumulators and recursive `def`s by fixpoint, and rewrites what no runtime
 * should parse (an ISO string compared with a DateTime becomes a DateTime
 * literal; a `strftime` format becomes its tokens). A problem is a diagnostic
 * with its span, one sentence, suggestions and fixes; lints are warnings. The
 * checked query holds the rewritten program, the input type, the element type
 * and the multiplicity, and is present exactly when no diagnostic is an error.
 *
 * @example
 * ```ts
 * const Order = StructType({ id: IntegerType, total: FloatType });
 * const checked = checkJq(".orders | map(.total) | add", StructType({ orders: ArrayType(Order) }));
 * checked.elementType;    // FloatType
 * checked.multiplicity;   // "one"
 *
 * checkJq(".orders[0].totl", StructType({ orders: ArrayType(Order) })).diagnostics[0]!.message;
 * // "unknown_field: .totl is not a field of Struct{id: Integer, total: Float}. Did you mean .total?"
 * ```
 */
export function checkJq(program: string | ParsedJq, input: EastType, options: CheckJqOptions = {}): CheckJqResult {
  const parsed = typeof program === "string" ? parseJq(program) : program;
  const empty = (diagnostics: QueryError[]): CheckJqResult => ({
    query: null, elementType: null, multiplicity: null, reads: [], stages: [], typeAt: () => null, diagnostics,
  });
  if (parsed.program.type === "none") return empty(parsed.diagnostics);
  const root = parsed.program.value;
  const checker = new Checker(parsed.text, parsed.spans, options, input);
  const env: Env = { vars: new Map(), defs: new Map(), labels: new Set(), instance: "", lenient: false };
  const start: Result = { shape: typed(input), mult: ONE };
  const result = checker.check(root, "", start, env);
  if (options.root === true && result.shape.kind === "type" && checker.isRootShape(result.shape)) {
    checker.refuseRoot(result, "", env);
  }
  const elementType = result.shape.kind === "error" ? undefined : checker.collect(result, parsed.spans.get(""), "");
  const multiplicity = wireMultiplicity(result.mult);

  // The stages of the top-level pipeline.
  const stages: CheckedStage[] = [];
  let cumulative = ONE;
  for (const stage of spine(root, "")) {
    const record = checker.records.get(`|${stage.path}`);
    const range = parsed.spans.get(stage.path);
    if (record === undefined || range === undefined) break;
    cumulative = then(cumulative, record.mult);
    const type = unifyShape(record.shape);
    if (type === undefined) break;
    stages.push({ path: stage.path, from: range.from, to: range.to, type, multiplicity: wireMultiplicity(cumulative) });
  }

  const errors = checker.diagnostics.some(d => d.severity.type === "error");
  const typeAt = (path: string, instance = ""): CheckedNode | null => {
    const record = checker.records.get(`${instance}|${path}`);
    if (record === undefined) return null;
    const type = unifyShape(record.shape);
    return type === undefined ? null : { type, multiplicity: wireMultiplicity(record.mult) };
  };
  const query = errors || elementType === undefined ? null : variant("v1", {
    element_type: canonicalTypeValue(toEastTypeValue(elementType)),
    input_type: canonicalTypeValue(toEastTypeValue(input)),
    multiplicity: variant(multiplicity, null),
    program: checker.rewrite(root, ""),
  });
  return {
    query,
    elementType: errors || elementType === undefined ? null : elementType,
    multiplicity: errors ? null : multiplicity,
    reads: checker.reads,
    stages,
    typeAt,
    diagnostics: checker.diagnostics,
  };
}
