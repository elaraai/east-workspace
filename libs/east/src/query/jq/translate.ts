/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The jq translator: a checked program as ordinary East IR, typed from the
 * checker's types (`devdocs/QUERY.md` §15).
 *
 * A filter is generated with a continuation that receives each of its
 * outputs: `a | b` generates `b` in `a`'s continuation, `.[]` is a loop, and
 * early exit (`first`, `limit`, `label`) is a labelled break out of every loop
 * between. Every value is built by an East builtin, so a query runs wherever
 * East IR runs, and no runtime has anything of its own for queries.
 *
 * @packageDocumentation
 */

import type { AST, Label, VariableAST } from "../../ast.js";
import type { BuiltinName } from "../../builtins.js";
import { isVariant, variant } from "../../containers/variant.js";
import { valueOrExprToAstTyped } from "../../expr/ast.js";
import { BlockBuilder, fromAst, func } from "../../expr/block.js";
import { AstSymbol, Expr } from "../../expr/expr.js";
import type { FunctionExpr } from "../../expr/function.js";
import FloatLib from "../../expr/libs/float.js";
import { get_current_source_map, UNKNOWN_LOC_ID } from "../../location.js";
import { decodeBeast2 } from "../../serialization/beast2/index.js";
import { fromEastTypeValue } from "../../type_of_type.js";
import {
  ArrayType, BooleanType, DictType, FloatType, FunctionType, IntegerType, NeverType, NullType, OptionType, RefType,
  StringType, StructType, VariantType, isSubtype, isTypeEqual, printType, type EastType,
} from "../../types.js";
import { UPDATE_SELECTORS, walkSteps, type CheckJqResult } from "./check.js";
import { casesOf, membersOf, nullablePayload, unify, unifyShape, unwrap, type Facts, type Result, type Shape } from "./shapes.js";
import { childPath, jqChildren, toQuerySpan, type JqNode, type JqPattern } from "./spans.js";
import { BUILTIN_RULES, FORMATS } from "./translate-builtins.js";

/** Options for {@link translateJq}. */
export interface TranslateJqOptions {
  /**
   * Stop after this many outputs of a `many` query, and one more, so a caller
   * can tell the result was cut short: e3's limit (#929).
   */
  maxOutputs?: number;
  /** Translate the tooling-only builtins, `signature`, `source`, `calls` and `captures`, to host platform calls (#931). */
  tooling?: boolean;
}

/** A checked program as East IR. */
export interface JqTranslation {
  /**
   * The translation's parameters, in order: one per field of an e3 root the
   * program reads (`name` the field's), or the one input (`name` `null`).
   */
  inputs: { name: string | null; type: EastType }[];
  /** The result's type: the element type `T` for `one`, `Option<T>` for `maybe`, `Array<T>` for `many`. */
  resultType: EastType;
  /**
   * The translation over given inputs, as a block expression.
   *
   * @param inputs - one expression per {@link JqTranslation.inputs}, in order
   * @returns the result, of {@link JqTranslation.resultType}
   */
  build(...inputs: Expr[]): Expr;
  /** The translation as an East function of its inputs. */
  fn(): FunctionExpr<any[], any>;
}

/** The input of a program checked as an e3 root: each field it reads, an input of its own. @internal */
export interface RootValue {
  readonly root: true;
  readonly fields: ReadonlyMap<string, Expr>;
}

/** A value the translation passes along: an East expression, or the root. @internal */
export type Value = Expr | RootValue;

/**
 * A type with its parts readable, for code that has decided its kind: an
 * array's `value`, a dict's `key`, a struct's `fields`.
 *
 * @internal
 */
export type TypeParts = EastType & {
  readonly value: EastType;
  readonly key: EastType;
  readonly element: EastType;
  readonly node: EastType;
  readonly fields: Record<string, EastType>;
  readonly cases: Record<string, EastType>;
  readonly inputs: EastType[];
  readonly output: EastType;
};

/** A type, its parts readable. @internal */
export function parts(type: EastType): TypeParts {
  return type as TypeParts;
}

/** A block being written. @internal */
export type Block = BlockBuilder<any>;

/** What receives each output of a filter: the block to write in, and the output. @internal */
export type Emit = ($: Block, value: Expr) => void;

/**
 * A position's new value in an update: the value, and whether it is an
 * option whose `none` deletes the position (`|=` with no output).
 *
 * @internal
 */
export interface Update {
  readonly value: Expr;
  readonly optional: boolean;
}

/**
 * What gives a position's new value in an update, from its old value: the
 * new value, or `undefined` when the update never gives one there.
 *
 * @internal
 */
export type UpdateFn = ($: Block, old: Expr) => Update | undefined;

/** What walks one position of `..` in an update: its value now, and its value before any update, whose positions are walked. */
type WalkFn = ($: Block, current: Expr, old: Expr) => Update | undefined;

/** A `def` or a filter parameter in scope. */
type Binding =
  | { kind: "def"; node: Extract<JqNode, { type: "def" }>; path: string; env: () => Env }
  | { kind: "param"; arg: JqNode; path: string; env: Env };

/** What is in scope where a node is generated. @internal */
export interface Env {
  readonly vars: ReadonlyMap<string, Value>;
  readonly defs: ReadonlyMap<string, Binding>;
  readonly labels: ReadonlyMap<string, Label>;
  /** Which instance of a `def`'s body this is, as the checker names it. */
  readonly instance: string;
  /** Recursive defs being generated, by their instance signature: the reference holding each one's function. */
  readonly recursion: ReadonlyMap<string, Expr>;
}

/** A call of a builtin being translated. @internal */
export interface CallSite {
  /** The builtin as called. */
  readonly name: string;
  readonly path: string;
  readonly args: readonly JqNode[];
  readonly argPaths: readonly string[];
  readonly $: Block;
  readonly x: Value;
  readonly env: Env;
  readonly emit: Emit;
}

/** A builtin's translation. @internal */
export type BuiltinRule = (t: Translator, call: CallSite) => void;

/**
 * Raised when a checked program holds something the translator cannot
 * express. The checker refuses what a query may not do, so this marks a gap
 * in the translation, never a mistake in the query.
 */
export class TranslationError extends Error {
  constructor(message: string) {
    super(`translateJq: ${message}`);
    this.name = "TranslationError";
  }
}

/** Whether a value is the root. @internal */
export function isRoot(value: Value): value is RootValue {
  return !(value instanceof Expr);
}

/** The translator for one checked program. @internal */
export class Translator {
  private readonly literals = new Map<Uint8Array, { type: EastType; value: unknown }>();
  private readonly locs = new Map<string, bigint>();
  private readonly retyped = new Map<string, string | null>();

  constructor(readonly checked: CheckJqResult, readonly options: TranslateJqOptions) {}

  /** The error for a gap in the translation. */
  gap(message: string): TranslationError {
    return new TranslationError(message);
  }

  // ─── Building IR ────────────────────────────────────────────────────────

  /** The location of a node in the jq text, as the IR's source map holds it: file `jq`, its line and column. */
  loc(path: string): bigint {
    const known = this.locs.get(path);
    if (known !== undefined) return known;
    const map = get_current_source_map();
    const range = this.checked.source.spans.get(path);
    let id = UNKNOWN_LOC_ID;
    if (map !== null && range !== undefined) {
      const span = toQuerySpan(this.checked.source.text, range.from, range.to);
      id = map.intern_stack([{ filename: "jq", line: span.line, column: span.column }]);
    }
    this.locs.set(path, id);
    return id;
  }

  mk(ast: AST): Expr {
    return fromAst(ast) as Expr;
  }

  ast(e: Expr): AST {
    return (e as any)[AstSymbol] as AST;
  }

  type(e: Expr): TypeParts {
    return Expr.type(e) as TypeParts;
  }

  block(): Block {
    return BlockBuilder(NeverType);
  }

  /** Whether a block has ended: its last statement breaks, raises or returns. */
  ended($: Block): boolean {
    const s = $.statements;
    return s.length > 0 && s[s.length - 1]!.type.type === "Never";
  }

  /** A call of an East builtin. */
  b(name: BuiltinName, typeParameters: EastType[], args: Expr[], output: EastType, path: string): Expr {
    return this.mk({ ast_type: "Builtin", type: output, loc_id: this.loc(path), builtin: name, type_parameters: typeParameters, arguments: args.map(a => this.ast(a)) });
  }

  /** A constant of a type. */
  value(v: unknown, type: EastType, path = ""): Expr {
    return this.mk(valueOrExprToAstTyped(v, type, undefined, this.loc(path)));
  }

  int(n: number | bigint, path = ""): Expr {
    return this.value(BigInt(n), IntegerType, path);
  }

  float(n: number, path = ""): Expr {
    return this.value(n, FloatType, path);
  }

  str(s: string, path = ""): Expr {
    return this.value(s, StringType, path);
  }

  bool(v: boolean, path = ""): Expr {
    return this.value(v, BooleanType, path);
  }

  null(path = ""): Expr {
    return this.value(null, NullType, path);
  }

  /**
   * A value as a wider type it is a subtype of. A recursive type equals its
   * node to East's type checks, but a value passes between the two through
   * its wrapper, which this adds or takes away.
   */
  as(e: Expr, type: EastType): Expr {
    const from = this.type(e);
    if (type.type === "Recursive" && from.type !== "Recursive" && from.type !== "Never") {
      return this.mk({ ast_type: "WrapRecursive", type, loc_id: UNKNOWN_LOC_ID, value: this.ast(this.as(e, type.node as EastType)) });
    }
    if (from.type === "Recursive" && type.type !== "Recursive") return this.as(this.open(e), type);
    if (isTypeEqual(from, type)) return e;
    if (!isSubtype(from, type)) throw this.gap(`${printType(from)} is not a ${printType(type)}`);
    return this.mk({ ast_type: "As", type, loc_id: UNKNOWN_LOC_ID, value: this.ast(e) });
  }

  some(payload: Expr, optionType: EastType): Expr {
    const p = parts(optionType).cases["some"]!;
    return this.mk({ ast_type: "Variant", type: optionType, loc_id: UNKNOWN_LOC_ID, case: "some", value: this.ast(this.as(payload, p)) });
  }

  none(optionType: EastType): Expr {
    return this.mk({ ast_type: "Variant", type: optionType, loc_id: UNKNOWN_LOC_ID, case: "none", value: { ast_type: "Value", type: NullType, loc_id: UNKNOWN_LOC_ID, value: null } });
  }

  /** A case of a variant type, wrapped when the type is recursive. */
  variantOf(type: EastType, name: string, payload: Expr): Expr {
    const node = type.type === "Recursive" ? type.node as EastType : type;
    const p = parts(node).cases[name]!;
    const built: AST = { ast_type: "Variant", type: node, loc_id: UNKNOWN_LOC_ID, case: name, value: this.ast(this.as(payload, p)) };
    return this.mk(type.type === "Recursive" ? { ast_type: "WrapRecursive", type, loc_id: UNKNOWN_LOC_ID, value: built } : built);
  }

  /** A struct of a type from its fields' values, wrapped when the type is recursive. */
  struct(type: EastType, fields: Readonly<Record<string, Expr>>): Expr {
    const node = type.type === "Recursive" ? type.node as EastType : type;
    const asts: Record<string, AST> = {};
    for (const [name, fieldType] of Object.entries(parts(node).fields)) {
      const v = fields[name];
      if (v === undefined) throw this.gap(`no value for the field ${name}`);
      asts[name] = this.ast(this.as(v, fieldType));
    }
    const built: AST = { ast_type: "Struct", type: node, loc_id: UNKNOWN_LOC_ID, fields: asts };
    return this.mk(type.type === "Recursive" ? { ast_type: "WrapRecursive", type, loc_id: UNKNOWN_LOC_ID, value: built } : built);
  }

  /** A field of a struct value. */
  field(struct: Expr, name: string): Expr {
    const s = this.open(struct);
    const fieldType = (this.type(s).fields as Record<string, EastType>)[name];
    if (fieldType === undefined) throw this.gap(`.${name} is not a field of ${printType(this.type(s))}`);
    return this.mk({ ast_type: "GetField", type: fieldType, loc_id: UNKNOWN_LOC_ID, field: name, struct: this.ast(s) });
  }

  /** A value read through its recursive wrapper and references: what jq sees. */
  open(e: Expr): Expr {
    let v = e;
    for (;;) {
      const t = this.type(v);
      if (t.type === "Recursive") v = this.mk({ ast_type: "UnwrapRecursive", type: t.node as EastType, loc_id: UNKNOWN_LOC_ID, value: this.ast(v) });
      else if (t.type === "Ref") v = this.b("RefGet", [t.value as EastType], [v], t.value as EastType, "");
      else return v;
    }
  }

  /** A call of a function value. */
  callFn(fn: Expr, args: Expr[], path: string): Expr {
    const t = this.type(fn);
    const inputs = t.inputs as EastType[];
    return this.mk({
      ast_type: "Call", type: t.output as EastType, loc_id: this.loc(path), function: this.ast(fn),
      arguments: args.map((a, i) => this.ast(this.as(a, inputs[i]!))),
    });
  }

  /** An East function value, built from a body that gives its result. */
  lambda(inputs: EastType[], output: EastType, names: string[], body: ($: Block, ...params: Expr[]) => Expr | void, path: string): Expr {
    const parameters: VariableAST[] = inputs.map((type, i) => ({ ast_type: "Variable", type, loc_id: UNKNOWN_LOC_ID, mutable: false, name: names[i] }));
    const $ = BlockBuilder(output);
    const result = body($, ...parameters.map(p => fromAst(p) as Expr));
    if (result !== undefined && !this.ended($)) $.statements.push(this.ast(this.as(result, output)));
    const s = $.statements;
    const bodyAst: AST = s.length === 0 ? { ast_type: "Value", type: NullType, loc_id: UNKNOWN_LOC_ID, value: null }
      : s.length === 1 ? s[0]!
      : { ast_type: "Block", type: s[s.length - 1]!.type, loc_id: UNKNOWN_LOC_ID, statements: s };
    return this.mk({ ast_type: "Function", type: FunctionType(inputs, output), loc_id: this.loc(path), parameters, body: bodyAst });
  }

  /** A function of East's float library, called on a number. */
  round(name: "roundFloor" | "roundCeil" | "roundHalf" | "roundTrunc", v: Expr, $: Block, path: string): Expr {
    return this.callFn(libraryFunction(name), [this.widenTo($, v, FloatType, path)], path);
  }

  // ─── Statements ─────────────────────────────────────────────────────────

  /** Declares a variable holding a value: `let` when `mutable`, else `const`. */
  declare($: Block, init: Expr, name: string, mutable = true, type?: EastType): Expr {
    const t = type ?? this.type(init);
    const variable: VariableAST = { ast_type: "Variable", type: t, loc_id: UNKNOWN_LOC_ID, mutable, name };
    $.statements.push({ ast_type: "Let", type: NullType, loc_id: UNKNOWN_LOC_ID, variable, value: this.ast(this.as(init, t)) });
    return fromAst(variable) as Expr;
  }

  /** A value bound to a variable of its own, unless it is one already or a constant: so it is computed once. */
  bind($: Block, e: Expr, name: string): Expr {
    const kind = this.ast(e).ast_type;
    if (kind === "Variable" || kind === "Value") return e;
    return this.declare($, e, name, false);
  }

  assign($: Block, variable: Expr, value: Expr): void {
    if (this.ended($)) return;
    let v = this.ast(variable);
    if (v.ast_type === "UnwrapRecursive") v = v.value;
    if (v.ast_type !== "Variable") throw this.gap("an assignment to something not a variable");
    $.statements.push({ ast_type: "Assign", type: NullType, loc_id: UNKNOWN_LOC_ID, variable: v, value: this.ast(this.as(value, v.type)) });
  }

  /** An expression evaluated for its effect. */
  stmt($: Block, e: Expr): void {
    if (this.ended($)) return;
    $.statements.push(this.ast(e));
  }

  /** A runtime error, located at a node. */
  raise($: Block, message: Expr | string, path: string): void {
    if (this.ended($)) return;
    const m = typeof message === "string" ? this.str(message, path) : message;
    $.statements.push({ ast_type: "Error", type: NeverType, loc_id: this.loc(path), message: this.ast(m) });
  }

  brk($: Block, label: Label): void {
    if (this.ended($)) return;
    $.statements.push({ ast_type: "Break", type: NeverType, loc_id: UNKNOWN_LOC_ID, label });
  }

  /** A block's statements as one body, closed as the builder closes a block: null-terminated. */
  body(inner: Block): AST {
    const s = inner.statements;
    if (s.length === 0) return { ast_type: "Value", type: NullType, loc_id: UNKNOWN_LOC_ID, value: null };
    if (s.length === 1 && isSubtype(s[0]!.type, NullType)) return s[0]!;
    if (!isSubtype(s[s.length - 1]!.type, NullType)) s.push({ ast_type: "Value", type: NullType, loc_id: UNKNOWN_LOC_ID, value: null });
    return { ast_type: "Block", type: s[s.length - 1]!.type, loc_id: UNKNOWN_LOC_ID, statements: s };
  }

  /** A block that gives a value: its statements, then the value. */
  blockValue(build: ($: Block) => Expr, type: EastType): AST {
    const inner = this.block();
    const v = build(inner);
    if (this.ended(inner)) return { ast_type: "Block", type: NeverType, loc_id: UNKNOWN_LOC_ID, statements: inner.statements };
    const valueAst = this.ast(this.as(v, type));
    if (inner.statements.length === 0) return valueAst;
    return { ast_type: "Block", type, loc_id: UNKNOWN_LOC_ID, statements: [...inner.statements, valueAst] };
  }

  /** Loops over an array, set, dict, vector or matrix: each element (a set's key; a dict's value, and its key). */
  forEach($: Block, collection: Expr, each: ($: Block, value: Expr, key: Expr | undefined, label: Label) => void, path: string, name = "item"): void {
    if (this.ended($)) return;
    const c = this.open(collection);
    const t = this.type(c);
    const label: Label = { loc_id: this.loc(path) };
    const inner = this.block();
    const variable = (type: EastType, n: string): VariableAST => ({ ast_type: "Variable", type, loc_id: UNKNOWN_LOC_ID, mutable: false, name: n });
    switch (t.type) {
      case "Array": {
        const value = variable(t.value as EastType, name);
        const key = variable(IntegerType, "index");
        each(inner, fromAst(value) as Expr, fromAst(key) as Expr, label);
        $.statements.push({ ast_type: "ForArray", type: NullType, loc_id: label.loc_id, label, array: this.ast(c), key, value, body: this.body(inner) });
        return;
      }
      case "Set": {
        const key = variable(t.key as EastType, name);
        each(inner, fromAst(key) as Expr, undefined, label);
        $.statements.push({ ast_type: "ForSet", type: NullType, loc_id: label.loc_id, label, set: this.ast(c), key, body: this.body(inner) });
        return;
      }
      case "Dict": {
        const value = variable(t.value as EastType, name);
        const key = variable(t.key as EastType, "key");
        each(inner, fromAst(value) as Expr, fromAst(key) as Expr, label);
        $.statements.push({ ast_type: "ForDict", type: NullType, loc_id: label.loc_id, label, dict: this.ast(c), key, value, body: this.body(inner) });
        return;
      }
      case "Vector":
        this.forEach($, this.b("VectorToArray", [t.element as EastType], [c], ArrayType(t.element as EastType), path), each, path, name);
        return;
      case "Matrix":
        this.forEach($, this.b("MatrixToArray", [t.element as EastType], [c], ArrayType(ArrayType(t.element as EastType)), path), each, path, name);
        return;
      default:
        throw this.gap(`a loop over ${printType(t)}`);
    }
  }

  /** A loop while a condition holds; `true` for one left only by `break`. */
  whileLoop($: Block, condition: Expr | true, body: ($: Block, label: Label) => void, path: string): void {
    if (this.ended($)) return;
    const label: Label = { loc_id: this.loc(path) };
    const inner = this.block();
    body(inner, label);
    const predicate: AST = condition === true ? { ast_type: "Value", type: BooleanType, loc_id: UNKNOWN_LOC_ID, value: true } : this.ast(condition);
    $.statements.push({ ast_type: "While", type: NullType, loc_id: label.loc_id, predicate, label, body: this.body(inner) });
  }

  /** A block that runs once, with a label that leaves it early: how a stream stops. */
  once($: Block, body: ($: Block, label: Label) => void, path: string): void {
    this.whileLoop($, true, (inner, label) => {
      body(inner, label);
      this.brk(inner, label);
    }, path);
  }

  /** `if`, with an optional `else`. */
  ifElse($: Block, condition: Expr, then: ($: Block) => void, otherwise: (($: Block) => void) | undefined, path: string): void {
    if (this.ended($)) return;
    const t = this.block();
    then(t);
    const e = this.block();
    otherwise?.(e);
    const thenAst = this.body(t);
    const elseAst = this.body(e);
    const type = thenAst.type.type === "Never" && elseAst.type.type === "Never" ? NeverType : NullType;
    $.statements.push({ ast_type: "IfElse", type, loc_id: this.loc(path), ifs: [{ predicate: this.ast(condition), body: thenAst }], else_body: elseAst });
  }

  /** Runs `then` where a condition holds and `otherwise` where it does not; a known condition runs one of them only. */
  branch($: Block, condition: Expr | boolean, then: ($: Block) => void, otherwise: ($: Block) => void, path: string): void {
    if (this.ended($)) return;
    const known = typeof condition === "boolean" ? condition : this.constant(condition)?.value as boolean | undefined;
    if (known === true) { then($); return; }
    if (known === false) { otherwise($); return; }
    this.ifElse($, condition as Expr, then, otherwise, path);
  }

  /** A statement that runs a handler for the case a variant holds; a case with no handler does nothing. */
  match($: Block, v: Expr, handlers: Readonly<Record<string, ($: Block, payload: Expr) => void>>, path: string): void {
    if (this.ended($)) return;
    const opened = this.open(v);
    const t = this.type(opened);
    const cases: Record<string, { variable: VariableAST; body: AST }> = {};
    let never = true;
    for (const [name, payload] of Object.entries(t.cases as Record<string, EastType>)) {
      const variable: VariableAST = { ast_type: "Variable", type: payload, loc_id: UNKNOWN_LOC_ID, mutable: false, name: name === "some" ? "value" : "payload" };
      const inner = this.block();
      handlers[name]?.(inner, fromAst(variable) as Expr);
      const body = this.body(inner);
      if (body.type.type !== "Never") never = false;
      cases[name] = { variable, body };
    }
    $.statements.push({ ast_type: "Match", type: never ? NeverType : NullType, loc_id: this.loc(path), variant: this.ast(opened), cases });
  }

  /** A value chosen by the case a variant holds: each case's block gives it. */
  matchValue(v: Expr, cases: Readonly<Record<string, ($: Block, payload: Expr) => Expr>>, type: EastType, path: string): Expr {
    const opened = this.open(v);
    const t = this.type(opened);
    const out: Record<string, { variable: VariableAST; body: AST }> = {};
    for (const [name, payload] of Object.entries(t.cases as Record<string, EastType>)) {
      const variable: VariableAST = { ast_type: "Variable", type: payload, loc_id: UNKNOWN_LOC_ID, mutable: false, name: name === "some" ? "value" : "payload" };
      const build = cases[name];
      if (build === undefined) throw this.gap(`no value for the case ${name}`);
      out[name] = { variable, body: this.blockValue($ => build($, fromAst(variable) as Expr), type) };
    }
    return this.mk({ ast_type: "Match", type, loc_id: this.loc(path), variant: this.ast(opened), cases: out });
  }

  /** A value chosen by a condition. */
  ifValue(condition: Expr, then: ($: Block) => Expr, otherwise: ($: Block) => Expr, type: EastType, path: string): Expr {
    const known = this.constant(condition)?.value;
    if (known === true || known === false) {
      return this.mk(this.blockValue(known ? then : otherwise, type));
    }
    return this.mk({
      ast_type: "IfElse", type, loc_id: this.loc(path),
      ifs: [{ predicate: this.ast(condition), body: this.blockValue(then, type) }],
      else_body: this.blockValue(otherwise, type),
    });
  }

  /** `try`/`catch`: the handler receives the error's message. */
  tryCatch($: Block, body: ($: Block) => void, handler: ($: Block, message: Expr) => void, path: string): void {
    if (this.ended($)) return;
    const t = this.block();
    body(t);
    const message: VariableAST = { ast_type: "Variable", type: StringType, loc_id: UNKNOWN_LOC_ID, mutable: false, name: "message" };
    const stack: VariableAST = {
      ast_type: "Variable", type: ArrayType(StructType({ filename: StringType, line: IntegerType, column: IntegerType })),
      loc_id: UNKNOWN_LOC_ID, mutable: false, name: "stack",
    };
    const c = this.block();
    handler(c, fromAst(message) as Expr);
    const tryAst = this.body(t);
    const catchAst = this.body(c);
    const type = tryAst.type.type === "Never" && catchAst.type.type === "Never" ? NeverType : NullType;
    $.statements.push({ ast_type: "TryCatch", type, loc_id: this.loc(path), try_body: tryAst, catch_body: catchAst, message, stack });
  }

  // ─── Collections ────────────────────────────────────────────────────────

  emptyArray(element: EastType): Expr {
    return this.value([], ArrayType(element));
  }

  /** Appends a value to an array variable. */
  push($: Block, array: Expr, v: Expr, path: string): void {
    if (this.ended($)) return;
    const element = this.type(array).value as EastType;
    this.stmt($, this.b("ArrayPushLast", [element], [array, this.widenTo($, v, element, path)], NullType, path));
  }

  /** Sets a key of a dict variable, inserting it or replacing its value. */
  put($: Block, dict: Expr, key: Expr, v: Expr, path: string): void {
    if (this.ended($)) return;
    const t = this.type(dict);
    const K = t.key as EastType;
    const V = t.value as EastType;
    const k = this.bind($, this.widenTo($, key, K, path), "key");
    const value = this.bind($, this.widenTo($, v, V, path), "value");
    this.ifElse($, this.b("DictHas", [K, V], [dict, k], BooleanType, path),
      $2 => this.stmt($2, this.b("DictUpdate", [K, V], [dict, k, value], NullType, path)),
      $2 => this.stmt($2, this.b("DictInsert", [K, V], [dict, k, value], NullType, path)), path);
  }

  /** An array-like value as an array: an array itself, a set's keys, a vector's elements, a matrix's rows. */
  asArray($: Block, v: Expr, path: string): Expr | undefined {
    const e = this.open(v);
    const t = this.type(e);
    switch (t.type) {
      case "Array": return e;
      case "Set": {
        const out = this.declare($, this.emptyArray(t.key as EastType), "keys");
        this.forEach($, e, ($2, key) => this.push($2, out, key, path), path, "key");
        return out;
      }
      case "Vector": return this.b("VectorToArray", [t.element as EastType], [e], ArrayType(t.element as EastType), path);
      case "Matrix": return this.b("MatrixToArray", [t.element as EastType], [e], ArrayType(ArrayType(t.element as EastType)), path);
      default: return undefined;
    }
  }

  /** The number of elements of an array. */
  size(array: Expr, path: string): Expr {
    return this.b("ArraySize", [this.type(array).value as EastType], [array], IntegerType, path);
  }

  lt(a: Expr, b: Expr, path: string): Expr {
    return this.b("Less", [this.type(a)], [a, b], BooleanType, path);
  }

  eq(a: Expr, b: Expr, path: string): Expr {
    return this.b("Equal", [this.type(a)], [a, b], BooleanType, path);
  }

  add(a: Expr, b: Expr, path: string): Expr {
    return this.b("IntegerAdd", [], [a, b], IntegerType, path);
  }

  not(a: Expr, path: string): Expr {
    return this.b("BooleanNot", [], [a], BooleanType, path);
  }

  // ─── Literals and the checker's types ───────────────────────────────────

  /** A literal node's value and type. */
  literal(node: Extract<JqNode, { type: "literal" }>): { type: EastType; value: unknown } {
    let known = this.literals.get(node.value);
    if (known === undefined) {
      const { type, value } = decodeBeast2(node.value);
      known = { type: fromEastTypeValue(type), value };
      this.literals.set(node.value, known);
    }
    return known;
  }

  /** A node's value when it is a literal, as the query wrote it or the checker rewrote it. */
  literalOf(node: JqNode | undefined): { type: EastType; value: unknown } | undefined {
    return node?.type === "literal" ? this.literal(node) : undefined;
  }

  /** An expression's value when it is a constant. */
  constant(e: Expr): { value: unknown } | undefined {
    const ast = this.ast(e);
    return ast.ast_type === "Value" ? { value: ast.value } : undefined;
  }

  /** What checking a node gave in an instance. */
  result(path: string, env: Env): Result | null {
    return this.checked.resultAt(path, env.instance);
  }

  /** The one type a node's outputs share, as the checker collects them. */
  typeAt(path: string, env: Env): TypeParts {
    const r = this.result(path, env);
    const t = r === null ? undefined : unifyShape(r.shape);
    if (t === undefined) throw this.gap(`no one type for ${this.text(path) || "the program"}`);
    return parts(t);
  }

  /** A node's text. */
  text(path: string): string {
    const range = this.checked.source.spans.get(path);
    return range === undefined ? "" : this.checked.source.text.slice(range.from, range.to);
  }

  /** What narrowing proved about a value of a type in a shape. */
  factsIn(shape: Shape | null | undefined, type: EastType): Facts | undefined {
    if (shape === null || shape === undefined) return undefined;
    return membersOf(shape).find(m => isTypeEqual(m.shape.type, type))?.shape.facts;
  }

  /** The instance a node's records are in for an input: its own, or one checked again for this input's type. */
  envFor(path: string, env: Env, x: Value): Env {
    if (isRoot(x)) return env;
    const input = this.checked.inputAt(path, env.instance);
    if (input === null || fits(this.type(x), input)) return env;
    const key = `${env.instance}|${path}|${printType(this.type(x))}`;
    let instance = this.retyped.get(key);
    if (instance === undefined) {
      instance = this.checked.retype(path, env.instance, this.type(x));
      this.retyped.set(key, instance);
    }
    if (instance === null) throw this.gap(`${this.text(path) || "the program"} on ${printType(this.type(x))}`);
    return { ...env, instance };
  }

  // ─── Converting to the checker's types ──────────────────────────────────

  /**
   * A value as a type the checker widened it to: Integer as Float, `T` or
   * `null` as `Option<T>`, and arrays, dicts, structs and variants element by
   * element.
   *
   * @throws {TranslationError} When the type is not wider.
   */
  widenTo($: Block, e: Expr, to: EastType, path: string): Expr {
    const from = this.type(e);
    if (isTypeEqual(from, to)) return this.as(e, to);
    if (from.type === "Never") return this.as(e, to);
    const toPayload = nullablePayload(to);
    if (toPayload !== undefined) {
      if (from.type === "Null") return this.none(to);
      const fromPayload = nullablePayload(from);
      if (fromPayload !== undefined) {
        // An option of Never is always none; East's casts do not take a Never inside a type.
        if (fromPayload.type === "Never") { this.bind($, e, "none"); return this.none(to); }
        if (isSubtype(from, to) && !holdsNever(from)) return this.as(e, to);
        return this.matchValue(e, {
          none: () => this.none(to),
          some: ($2, p) => this.some(this.widenTo($2, p, toPayload, path), to),
        }, to, path);
      }
      return this.some(this.widenTo($, e, toPayload, path), to);
    }
    if (from.type === "Integer" && to.type === "Float") {
      const c = this.constant(e);
      if (c !== undefined) return this.float(Number(c.value as bigint), path);
      return this.b("IntegerToFloat", [], [e], FloatType, path);
    }
    // A literal the checker rewrote to a Float, where this instance of it has an Integer.
    if (from.type === "Float" && to.type === "Integer") {
      const c = this.constant(e);
      if (c !== undefined && Number.isInteger(c.value as number)) return this.int(c.value as number, path);
    }
    if (isSubtype(from, to) && !holdsNever(from)) return this.as(e, to);
    const f = this.type(this.open(e));
    const t = to.type === "Recursive" ? to.node as EastType : to;
    // A collection of Never is always empty: it is an empty one of the wider type.
    const empty = (value: unknown): Expr => { this.bind($, e, "empty"); return this.as(this.value(value, t), to); };
    if (f.type === "Array" && t.type === "Array" && (f.value as EastType).type === "Never") return empty([]);
    if (f.type === "Dict" && t.type === "Dict" && (f.value as EastType).type === "Never") return empty(new Map());
    if (f.type === "Set" && t.type === "Set" && (f.key as EastType).type === "Never") return empty(new Set());
    if (f.type === "Array" && t.type === "Array") {
      const out = this.declare($, this.emptyArray(t.value as EastType), "array");
      this.forEach($, e, ($2, item) => this.push($2, out, item, path), path);
      return out;
    }
    if (f.type === "Dict" && t.type === "Dict" && isTypeEqual(f.key as EastType, t.key as EastType)) {
      const out = this.declare($, this.value(new Map(), t), "dict");
      this.forEach($, e, ($2, item, key) => {
        this.stmt($2, this.b("DictInsert", [t.key as EastType, t.value as EastType], [out, key!, this.widenTo($2, item, t.value as EastType, path)], NullType, path));
      }, path);
      return out;
    }
    if (f.type === "Struct" && t.type === "Dict" && Object.keys(f.fields as object).length === 0) return this.value(new Map(), t);
    if (f.type === "Struct" && t.type === "Struct") {
      const bound = this.bind($, this.open(e), "struct");
      const fields: Record<string, Expr> = {};
      for (const [name, fieldType] of Object.entries(t.fields as Record<string, EastType>)) {
        fields[name] = this.widenTo($, this.field(bound, name), fieldType, path);
      }
      return this.struct(to, fields);
    }
    if (f.type === "Variant" && t.type === "Variant") {
      const targetCases = t.cases as Record<string, EastType>;
      const cases: Record<string, ($2: Block, payload: Expr) => Expr> = {};
      for (const name of Object.keys(f.cases as object)) {
        if (!(name in targetCases)) throw this.gap(`the case ${name} as ${printType(to)}`);
        cases[name] = ($2, p) => this.variantOf(to, name, this.widenTo($2, p, targetCases[name]!, path));
      }
      return this.matchValue(e, cases, to, path);
    }
    throw this.gap(`${printType(from)} as ${printType(to)}`);
  }

  /**
   * Gives a value to `emit` as the checker's type for it: widened, or
   * narrowed as narrowing proved. A `null` where the checker proved a value
   * never reaches `emit`, and an option it proved present gives its payload.
   */
  emitAs($: Block, e: Expr, to: EastType, path: string, emit: Emit): void {
    if (this.ended($)) return;
    const from = this.type(e);
    if (isTypeEqual(from, to)) { emit($, this.as(e, to)); return; }
    if (nullablePayload(to) === undefined) {
      if (from.type === "Null") return;
      if (nullablePayload(from) !== undefined) {
        this.match($, e, { some: ($2, p) => this.emitAs($2, p, to, path, emit) }, path);
        return;
      }
    }
    emit($, this.bind($, this.widenTo($, e, to, path), "value"));
  }

  // ─── Truthiness ─────────────────────────────────────────────────────────

  /** Whether a value is true to jq, not `false` or `null`: a constant when its type decides it. */
  truthy(e: Expr, path: string): Expr | boolean {
    const v = this.open(e);
    const t = this.type(v);
    if (t.type === "Boolean") {
      const c = this.constant(v);
      return c === undefined ? v : c.value as boolean;
    }
    if (t.type === "Null" || t.type === "Never") return false;
    if (nullablePayload(t) !== undefined) {
      return this.matchValue(v, {
        none: () => this.bool(false),
        some: (_$2, p) => this.asExpr(this.truthy(p, path)),
      }, BooleanType, path);
    }
    return true;
  }

  asExpr(v: Expr | boolean): Expr {
    return typeof v === "boolean" ? this.bool(v) : v;
  }

  // ─── The walk ───────────────────────────────────────────────────────────

  /**
   * Generates a node: code in `$` that gives each of its outputs to `emit`,
   * as the checker's type for them.
   */
  gen(node: JqNode, path: string, $: Block, x: Value, env: Env, emit: Emit): void {
    if (this.ended($)) return;
    // A literal is its own value, as the checker rewrote it; a builtin that reads an argument as a literal never checked it.
    if (node.type === "literal") { this.genNode(node, path, $, x, env, emit); return; }
    const input = this.checked.inputAt(path, env.instance);
    // A node the checker never reached, or reached with no input, never runs.
    if (input === null || (input.kind === "type" && input.type.type === "Never")) return;
    const e = this.envFor(path, env, x);
    const r = this.result(path, e);
    if (r === null || (r.mult.lo === 1 && r.mult.hi === 0)) return;
    const target = r.shape.kind === "type" && r.shape.type.type !== "Never" ? r.shape.type : undefined;
    const out: Emit = target === undefined ? emit : ($2, v) => this.emitAs($2, v, target, path, emit);
    this.genNode(node, path, $, x, e, out);
  }

  /** Generates a node, each output as the one type its outputs share. */
  collected(node: JqNode, path: string, $: Block, x: Value, env: Env, emit: Emit): void {
    // A literal is as the checker rewrote it (an ISO date as a DateTime), not as its record was checked.
    if (node.type === "literal") { this.genNode(node, path, $, x, env, emit); return; }
    let type: EastType | undefined;
    this.gen(node, path, $, x, env, ($2, v) => {
      type ??= this.typeAt(path, this.envFor(path, env, x));
      emit($2, this.bind($2, this.widenTo($2, v, type, path), "value"));
    });
  }

  /**
   * The one output of a node that gives exactly one, as an expression of a
   * type: the value itself when the node gives it once in `$`, else a
   * variable each place that gives it assigns.
   */
  one(node: JqNode, path: string, $: Block, x: Value, env: Env, type: EastType): Expr {
    const mark = $.statements.length;
    let direct: { value: Expr; at: number } | undefined;
    let cell: VariableAST | undefined;
    const declareCell = (): VariableAST => {
      if (cell !== undefined) return cell;
      cell = { ast_type: "Variable", type, loc_id: UNKNOWN_LOC_ID, mutable: true, name: "one" };
      $.statements.splice(mark, 0, { ast_type: "Let", type: NullType, loc_id: UNKNOWN_LOC_ID, variable: cell, value: this.ast(this.placeholder(type)) });
      if (direct !== undefined) {
        // The first output was taken as it was given; it assigns the variable there instead.
        $.statements.splice(direct.at + 1, 0, { ast_type: "Assign", type: NullType, loc_id: UNKNOWN_LOC_ID, variable: cell, value: this.ast(direct.value) });
        direct = undefined;
      }
      return cell;
    };
    this.gen(node, path, $, x, env, ($2, v) => {
      if (this.ended($2)) return;
      const w = this.widenTo($2, v, type, path);
      if ($2 === $ && cell === undefined && direct === undefined) {
        const bound = this.bind($, w, "one");
        direct = { value: bound, at: $.statements.length };
        return;
      }
      const variable = declareCell();
      $2.statements.push({ ast_type: "Assign", type: NullType, loc_id: UNKNOWN_LOC_ID, variable, value: this.ast(w) });
    });
    if (direct !== undefined) return direct.value;
    if (cell !== undefined) return fromAst(cell) as Expr;
    return this.placeholder(type);
  }

  /** A value of a type to start a variable with, assigned before it is read. */
  placeholder(type: EastType): Expr {
    const zero = this.zeroOf(type, new Set());
    if (zero !== undefined) return zero;
    // A type with no plain value: an expression that raises, never evaluated.
    return this.mk({
      ast_type: "As", type, loc_id: UNKNOWN_LOC_ID,
      value: { ast_type: "Error", type: NeverType, loc_id: UNKNOWN_LOC_ID, message: { ast_type: "Value", type: StringType, loc_id: UNKNOWN_LOC_ID, value: "unreachable: a query value read before it was given" } },
    });
  }

  /** A plain value of a type, when there is one. */
  zeroOf(type: EastType, seen: ReadonlySet<EastType>): Expr | undefined {
    if (seen.has(type)) return undefined;
    const t = type.type === "Recursive" ? type.node as EastType : type;
    switch (t.type) {
      case "Null": return this.null();
      case "Boolean": return this.bool(false);
      case "Integer": return this.int(0);
      case "Float": return this.float(0);
      case "String": return this.str("");
      case "DateTime": return this.value(new Date(0), t);
      case "Blob": return this.value(new Uint8Array(0), t);
      case "Array": return this.value([], t);
      case "Set": return this.value(new Set(), t);
      case "Dict": return this.value(new Map(), t);
      case "Struct": {
        const inner = new Set(seen).add(type);
        const fields: Record<string, Expr> = {};
        for (const [name, f] of Object.entries(t.fields as Record<string, EastType>)) {
          const z = this.zeroOf(f, inner);
          if (z === undefined) return undefined;
          fields[name] = z;
        }
        return this.struct(type, fields);
      }
      case "Variant": {
        const inner = new Set(seen).add(type);
        for (const [name, payload] of Object.entries(t.cases as Record<string, EastType>)) {
          const z = this.zeroOf(payload, inner);
          if (z !== undefined) return this.variantOf(type, name, z);
        }
        return undefined;
      }
      default: return undefined;
    }
  }

  private genNode(node: JqNode, path: string, $: Block, x: Value, env: Env, emit: Emit): void {
    const at = (step: string): string => childPath(path, step);
    switch (node.type) {
      case "identity":
        emit($, this.expr(x, path));
        return;
      case "literal": {
        const { type, value } = this.literal(node);
        emit($, this.value(value, type, path));
        return;
      }
      case "variable": {
        if (node.value === "__loc__") { emit($, this.location(path)); return; }
        const bound = env.vars.get(node.value);
        if (bound === undefined) throw this.gap(`$${node.value} is not bound`);
        emit($, this.expr(bound, path));
        return;
      }
      case "pipe":
        // `. | f` is f on the input itself, the root included.
        if (node.value.left.type === "identity") { this.gen(node.value.right, at("pipe.right"), $, x, env, emit); return; }
        this.gen(node.value.left, at("pipe.left"), $, x, env, ($2, v) => this.gen(node.value.right, at("pipe.right"), $2, v, env, emit));
        return;
      case "comma":
        this.gen(node.value.left, at("comma.left"), $, x, env, emit);
        this.gen(node.value.right, at("comma.right"), $, x, env, emit);
        return;
      case "field": {
        const { name, optional, target } = node.value;
        const targetPath = at("field.target");
        // `.name` reads the input itself: a root's field is the input of that name.
        if (target.type === "identity" && isRoot(x)) { this.readField($, x, name, optional, path, undefined, emit); return; }
        this.gen(target, targetPath, $, x, env, ($2, v) => {
          const facts = isRoot(v) ? undefined : this.factsIn(this.result(targetPath, this.envFor(targetPath, env, x))?.shape, this.type(v));
          this.readField($2, v, name, optional, path, facts, emit);
        });
        return;
      }
      case "index":
        this.genIndex(node, path, $, x, env, emit);
        return;
      case "slice":
        this.genSlice(node, path, $, x, env, emit);
        return;
      case "iterate":
        this.gen(node.value.target, at("iterate.target"), $, x, env, ($2, v) => this.iterate($2, this.expr(v, path), node.value.optional, path, emit));
        return;
      case "descend":
        this.descend($, this.expr(x, path), path, emit);
        return;
      case "array": {
        const element = this.typeAt(path, env).value as EastType;
        if (node.value.type === "none") { emit($, this.emptyArray(element)); return; }
        const out = this.declare($, this.emptyArray(element), "array");
        this.gen(node.value.value, at("array.some"), $, x, env, ($2, v) => this.push($2, out, v, path));
        emit($, out);
        return;
      }
      case "object":
        this.genObject(node, path, $, x, env, emit);
        return;
      case "string":
        this.genString(node.value, path, $, x, env, emit, ($2, v) => this.tostring($2, v, path), path);
        return;
      case "format": {
        const format = FORMATS[node.value.name];
        if (format === undefined) throw this.gap(`no translation for the format @${node.value.name}`);
        const inner = node.value.string;
        if (inner.type === "some" && (inner.value as JqNode).type === "string") {
          // `@base64 "…\(f)…"`: each interpolated value through the format, the text as it is.
          const stringPath = at("format.string.some");
          this.genString((inner.value as Extract<JqNode, { type: "string" }>).value, path, $, x, env, emit, ($2, v) => format(this, $2, v, path), stringPath);
          return;
        }
        emit($, format(this, $, this.expr(x, path), path));
        return;
      }
      case "negate":
        this.gen(node.value, at("negate"), $, x, env, ($2, v) => {
          const o = this.open(v);
          const t = this.type(o);
          if (t.type === "Integer") emit($2, this.b("IntegerNegate", [], [o], IntegerType, path));
          else if (t.type === "Float") emit($2, this.b("FloatNegate", [], [o], FloatType, path));
          else this.raise($2, `${jqKind(t)} cannot be negated`, path);
        });
        return;
      case "binary":
        this.genBinary(node, path, $, x, env, emit);
        return;
      case "alternative":
        this.genAlternative(node, path, $, x, env, emit);
        return;
      case "if":
        this.genIf(node, path, $, x, env, emit, 0);
        return;
      case "try":
        this.genTry(node, path, $, x, env, emit);
        return;
      case "reduce": case "foreach":
        this.genFold(node, path, $, x, env, emit);
        return;
      case "bind":
        this.genBind(node, path, $, x, env, emit);
        return;
      case "label":
        this.once($, ($2, label) => {
          const labels = new Map(env.labels);
          labels.set(node.value.name, label);
          this.gen(node.value.body, at("label.body"), $2, x, { ...env, labels }, emit);
        }, path);
        return;
      case "break": {
        const label = env.labels.get(node.value);
        if (label === undefined) throw this.gap(`break $${node.value} outside its label, or across a function`);
        this.brk($, label);
        return;
      }
      case "def": {
        const defs = new Map(env.defs);
        let closure: Env;
        defs.set(`${node.value.name}/${node.value.params.length}`, { kind: "def", node, path, env: () => closure });
        closure = { ...env, defs };
        this.gen(node.value.rest, at("def.rest"), $, x, closure, emit);
        return;
      }
      case "call":
        this.genCall(node, path, $, x, env, emit);
        return;
      case "update":
        this.genUpdate(node, path, $, x, env, emit);
        return;
    }
  }

  /** `$__loc__`: where a node is, as jq gives it. */
  location(path: string): Expr {
    const range = this.checked.source.spans.get(path);
    const line = range === undefined ? 1n : toQuerySpan(this.checked.source.text, range.from, range.to).line;
    return this.value({ file: "<top-level>", line }, StructType({ file: StringType, line: IntegerType }), path);
  }

  /** A value that must be an expression: the root is only ever read a field at a time. */
  expr(v: Value, path: string): Expr {
    if (isRoot(v)) throw this.gap(`the whole root as a value at ${this.text(path) || "the program"}`);
    return v;
  }

  // ─── Paths ──────────────────────────────────────────────────────────────

  /** `.name` on a value, as jq reads it: `facts` say which cases a variant can hold. */
  readField($: Block, v: Value, name: string, optional: boolean, path: string, facts: Facts | undefined, emit: Emit): void {
    if (isRoot(v)) {
      const input = v.fields.get(name);
      if (input === undefined) throw this.gap(`.${name} is not an input`);
      emit($, input);
      return;
    }
    const e = this.open(v);
    const t = this.type(e);
    if (t.type === "Null") { emit($, this.null(path)); return; }
    if (nullablePayload(t) !== undefined) {
      const inner = facts?.kind === "present" ? facts.payload : undefined;
      this.match($, e, {
        none: $2 => emit($2, this.null(path)),
        some: ($2, p) => this.readField($2, p, name, optional, path, inner, emit),
      }, path);
      return;
    }
    switch (t.type) {
      case "Struct":
        emit($, name in (t.fields as object) ? this.field(e, name) : this.null(path));
        return;
      case "Dict":
        if (unwrap(t.key as EastType).type !== "String") { if (!optional) this.raise($, `Cannot index object with "${name}"`, path); return; }
        this.dictGet($, e, this.str(name, path), path, emit);
        return;
      case "Variant": {
        const cases = casesOf(t, facts);
        if (name === "type") {
          if (cases.length === 1) { emit($, this.str(cases[0]!, path)); return; }
          const handlers: Record<string, ($2: Block) => void> = {};
          for (const c of cases) handlers[c] = $2 => emit($2, this.str(c, path));
          this.match($, e, handlers, path);
          return;
        }
        if (name === "value") {
          const handlers: Record<string, ($2: Block, payload: Expr) => void> = {};
          for (const c of cases) handlers[c] = ($2, payload) => emit($2, payload);
          this.match($, e, handlers, path);
          return;
        }
        if (optional) { emit($, this.null(path)); return; }
        this.raise($, `Cannot index object with "${name}"`, path);
        return;
      }
      default:
        if (!optional) this.raise($, `Cannot index ${jqKind(t)} with "${name}"`, path);
        return;
    }
  }

  /** A dict's value at a key: `null` when it lacks the key. */
  dictGet($: Block, dict: Expr, key: Expr, path: string, emit: Emit): void {
    const d = this.open(dict);
    const t = this.type(d);
    const K = t.key as EastType;
    const V = t.value as EastType;
    const found = this.b("DictTryGet", [K, V], [d, this.widenTo($, key, K, path)], OptionType(V), path);
    // A value that can be null already is the lookup's value, or null.
    if (nullablePayload(OptionType(V)) === undefined) {
      this.match($, found, { none: $2 => emit($2, this.null(path)), some: ($2, value) => emit($2, value) }, path);
      return;
    }
    emit($, found);
  }

  private genIndex(node: Extract<JqNode, { type: "index" }>, path: string, $: Block, x: Value, env: Env, emit: Emit): void {
    const { index, optional, target } = node.value;
    const targetPath = childPath(path, "index.target");
    const keyPath = childPath(path, "index.index");
    const literal = this.literalOf(index);
    if (literal?.type.type === "String") {
      if (target.type === "identity" && isRoot(x)) { this.readField($, x, literal.value as string, optional, path, undefined, emit); return; }
      // A literal string reads a field, unless the value is a dict.
      this.gen(target, targetPath, $, x, env, ($2, v) => {
        if (!isRoot(v) && this.type(this.open(v)).type === "Dict") { this.dictGet($2, v, this.str(literal.value as string, path), path, emit); return; }
        const facts = isRoot(v) ? undefined : this.factsIn(this.result(targetPath, this.envFor(targetPath, env, x))?.shape, this.type(v));
        this.readField($2, v, literal.value as string, optional, path, facts, emit);
      });
      return;
    }
    // jq takes each key, then each value it indexes: `(a, b)[0, 1]` is a[0], b[0], a[1], b[1].
    this.collected(index, keyPath, $, x, env, ($2, k) => {
      this.gen(target, targetPath, $2, x, env, ($3, v) => this.indexOf($3, this.expr(v, path), k, optional, path, emit));
    });
  }

  /** `.[k]` on a value. */
  indexOf($: Block, v: Expr, k: Expr, optional: boolean, path: string, emit: Emit): void {
    const e = this.open(v);
    const t = this.type(e);
    if (t.type === "Null") { emit($, this.null(path)); return; }
    if (nullablePayload(t) !== undefined) {
      this.match($, e, {
        none: $2 => emit($2, this.null(path)),
        some: ($2, p) => this.indexOf($2, p, k, optional, path, emit),
      }, path);
      return;
    }
    if (t.type === "Dict") { this.dictGet($, e, k, path, emit); return; }
    const array = this.asArray($, e, path);
    if (array === undefined || this.type(k).type !== "Integer") {
      if (!optional) this.raise($, `Cannot index ${jqKind(t)} with ${jqKind(this.type(k))}`, path);
      return;
    }
    const element = this.type(array).value as EastType;
    const bound = this.bind($, array, "array");
    const i = this.declare($, k, "index");
    this.ifElse($, this.lt(i, this.int(0), path), $2 => this.assign($2, i, this.add(i, this.size(bound, path), path)), undefined, path);
    const found = this.b("ArrayTryGet", [element], [bound, i], OptionType(element), path);
    if (nullablePayload(OptionType(element)) === undefined) {
      this.match($, found, { none: $2 => emit($2, this.null(path)), some: ($2, value) => emit($2, value) }, path);
      return;
    }
    emit($, found);
  }

  private genSlice(node: Extract<JqNode, { type: "slice" }>, path: string, $: Block, x: Value, env: Env, emit: Emit): void {
    const { from, optional, target, to } = node.value;
    const bound = ($2: Block, option: typeof from, step: string, then: ($3: Block, b: Expr | undefined) => void): void => {
      if (option.type === "none") { then($2, undefined); return; }
      this.collected(option.value as JqNode, childPath(path, step), $2, x, env, then);
    };
    bound($, from, "slice.from.some", ($2, a) => bound($2, to, "slice.to.some", ($3, b) => {
      this.gen(target, childPath(path, "slice.target"), $3, x, env, ($4, v) => this.sliceOf($4, this.expr(v, path), a, b, optional, path, emit));
    }));
  }

  /** `.[a:b]` on a value: half-open, negative bounds counted from the end, clamped. */
  sliceOf($: Block, v: Expr, a: Expr | undefined, b: Expr | undefined, optional: boolean, path: string, emit: Emit): void {
    const e = this.open(v);
    const t = this.type(e);
    if (t.type === "Null") { emit($, this.null(path)); return; }
    if (nullablePayload(t) !== undefined) {
      this.match($, e, { none: $2 => emit($2, this.null(path)), some: ($2, p) => this.sliceOf($2, p, a, b, optional, path, emit) }, path);
      return;
    }
    if (t.type === "Vector" || t.type === "String" || t.type === "Array" || t.type === "Set") {
      const s = t.type === "Set" ? this.asArray($, e, path)! : this.bind($, e, "sliced");
      const st = this.type(s);
      const length = this.declare($, st.type === "String" ? this.b("StringLength", [], [s], IntegerType, path)
        : st.type === "Vector" ? this.b("VectorLength", [st.element as EastType], [s], IntegerType, path)
        : this.size(s, path), "length", false);
      const start = this.boundOf($, a, this.int(0), length, path);
      const end = this.boundOf($, b, length, length, path);
      this.ifElse($, this.lt(end, start, path), $2 => this.assign($2, end, start), undefined, path);
      if (st.type === "String") emit($, this.b("StringSubstring", [], [s, start, end], StringType, path));
      else if (st.type === "Vector") emit($, this.b("VectorSlice", [st.element as EastType], [s, start, end], st, path));
      else emit($, this.b("ArraySlice", [st.value as EastType], [s, start, end], st, path));
      return;
    }
    if (!optional) this.raise($, `Cannot index ${jqKind(t)} with object`, path);
  }

  /** A slice bound as an index: absent or null for its default, negative from the end, clamped to the length. */
  boundOf($: Block, b: Expr | undefined, fallback: Expr, length: Expr, path: string): Expr {
    const i = this.declare($, fallback, "bound", true, IntegerType);
    if (b !== undefined) {
      const t = this.type(b);
      if (t.type === "Integer") this.assign($, i, b);
      else if (nullablePayload(t) !== undefined) this.match($, b, { some: ($2, p) => this.assign($2, i, this.widenTo($2, p, IntegerType, path)) }, path);
      else if (t.type !== "Null") throw this.gap(`a slice bound of ${printType(t)}`);
    }
    this.ifElse($, this.lt(i, this.int(0), path), $2 => this.assign($2, i, this.add(i, length, path)), undefined, path);
    this.ifElse($, this.lt(i, this.int(0), path), $2 => this.assign($2, i, this.int(0)), undefined, path);
    this.ifElse($, this.lt(length, i, path), $2 => this.assign($2, i, length), undefined, path);
    return i;
  }

  /** `.[]` on a value: an array's elements, a set's, a dict's values in key order, a struct's field values in order. */
  iterate($: Block, v: Expr, optional: boolean, path: string, emit: Emit): void {
    const e = this.open(v);
    const t = this.type(e);
    if (nullablePayload(t) !== undefined) {
      this.match($, e, {
        none: $2 => { if (!optional) this.raise($2, "Cannot iterate over null", path); },
        some: ($2, p) => this.iterate($2, p, optional, path, emit),
      }, path);
      return;
    }
    switch (t.type) {
      case "Array": case "Set": case "Dict": case "Vector": case "Matrix":
        this.forEach($, e, ($2, value) => emit($2, value), path);
        return;
      case "Struct": {
        const s = this.bind($, e, "struct");
        for (const name of Object.keys(t.fields as object)) emit($, this.field(s, name));
        return;
      }
      default:
        if (!optional) this.raise($, `Cannot iterate over ${jqKind(t)}`, path);
        return;
    }
  }

  /** The kinds of value `..` finds directly inside a value of a type, as the checker walks them. */
  childKinds(type: EastType): EastType[] {
    const t = unwrap(type);
    const payload = nullablePayload(t);
    if (payload !== undefined) return this.childKinds(payload);
    switch (t.type) {
      case "Array": return [t.value as EastType];
      case "Set": return [t.key as EastType];
      case "Vector": return [t.element as EastType];
      case "Dict": return [t.value as EastType];
      case "Struct": return Object.values(t.fields as Record<string, EastType>);
      case "Variant": return [StringType, ...Object.values(t.cases as Record<string, EastType>)];
      default: return [];
    }
  }

  /** Gives each value `..` finds directly inside a value to `emit`, in order. */
  children($: Block, v: Expr, path: string, emit: Emit): void {
    const e = this.open(v);
    const t = this.type(e);
    if (nullablePayload(t) !== undefined) {
      this.match($, e, { some: ($2, p) => this.children($2, p, path, emit) }, path);
      return;
    }
    switch (t.type) {
      case "Array": case "Set": case "Dict": case "Vector":
        this.forEach($, e, ($2, value) => emit($2, value), path);
        return;
      case "Struct": {
        const s = this.bind($, e, "struct");
        for (const name of Object.keys(t.fields as object)) emit($, this.field(s, name));
        return;
      }
      case "Variant": {
        // A variant is jq's {type, value}: the case's name, then its payload.
        const handlers: Record<string, ($2: Block, payload: Expr) => void> = {};
        for (const c of Object.keys(t.cases as object)) handlers[c] = ($2, payload) => { emit($2, this.str(c, path)); emit($2, payload); };
        this.match($, e, handlers, path);
        return;
      }
      default:
        return;
    }
  }

  /**
   * `..`: a value and every value inside it, in pre-order. A recursive type
   * is walked with a stack of the kinds of value it holds, so the IR needs no
   * recursion.
   */
  descend($: Block, v: Expr, path: string, emit: Emit): void {
    const kinds: EastType[] = [];
    let recursive = false;
    const visit = (t: EastType): void => {
      if (kinds.some(k => isTypeEqual(k, t))) return;
      kinds.push(t);
      if (t.type === "Recursive") recursive = true;
      this.childKinds(t).forEach(visit);
    };
    visit(this.type(v));
    if (!recursive) {
      const walk = ($2: Block, value: Expr): void => {
        emit($2, value);
        this.children($2, value, path, walk);
      };
      walk($, v);
      return;
    }
    this.walkStack($, v, kinds, path, ($2, value, push) => {
      emit($2, value);
      this.children($2, value, path, push);
    });
  }

  /**
   * A depth-first walk with an explicit stack of values of several kinds:
   * `visit` gets each value in pre-order, and a `push` for the values to walk
   * after it, first to last.
   */
  walkStack($: Block, start: Expr, kinds: readonly EastType[], path: string, visit: ($: Block, value: Expr, push: Emit) => void): void {
    const cases: Record<string, EastType> = {};
    kinds.forEach((k, i) => { cases[`k${String(i).padStart(3, "0")}`] = k; });
    const Item = VariantType(cases);
    const caseOf = (t: EastType): string => {
      const i = kinds.findIndex(k => isTypeEqual(k, t));
      if (i < 0) throw this.gap(`${printType(t)} in a walk of ${kinds.map(k => printType(k)).join(", ")}`);
      return `k${String(i).padStart(3, "0")}`;
    };
    const stack = this.declare($, this.emptyArray(Item), "stack");
    this.push($, stack, this.variantOf(Item, caseOf(this.type(start)), start), path);
    this.whileLoop($, this.lt(this.int(0), this.size(stack, path), path), $2 => {
      const item = this.declare($2, this.b("ArrayPopLast", [Item], [stack], Item, path), "item", false);
      const handlers: Record<string, ($3: Block, value: Expr) => void> = {};
      for (const name of Object.keys(cases)) {
        handlers[name] = ($3, value) => {
          // The values found are pushed last first, so the first is walked next.
          const found = this.declare($3, this.emptyArray(Item), "found");
          visit($3, value, ($4, child) => this.push($4, found, this.variantOf(Item, caseOf(this.type(child)), child), path));
          this.forEach($3, this.b("ArrayReverse", [Item], [found], ArrayType(Item), path), ($4, child) => this.push($4, stack, child, path), path);
        };
      }
      this.match($2, item, handlers, path);
    }, path);
  }

  // ─── Construction ───────────────────────────────────────────────────────

  private genObject(node: Extract<JqNode, { type: "object" }>, path: string, $: Block, x: Value, env: Env, emit: Emit): void {
    const type = this.typeAt(path, env);
    const t = unwrap(type);
    const entries = node.value;
    if (t.type === "Struct") {
      const inputFacts = isRoot(x) ? undefined : this.factsIn(this.checked.inputAt(path, env.instance), this.type(x));
      // Each combination of the values' outputs, the first entry's slowest.
      const step = ($2: Block, i: number, values: Record<string, Expr>): void => {
        if (i === entries.length) {
          const fields: Record<string, Expr> = {};
          for (const [name, fieldType] of Object.entries(t.fields as Record<string, EastType>)) fields[name] = this.widenTo($2, values[name]!, fieldType, path);
          emit($2, this.struct(type, fields));
          return;
        }
        const entry = entries[i]!;
        const name = entry.key.value as string;
        const next = ($3: Block, v: Expr): void => step($3, i + 1, { ...values, [name]: this.bind($3, v, "field") });
        if (entry.value.type === "some") {
          this.gen(entry.value.value as JqNode, childPath(path, `object[${i}].value.some`), $2, x, env, next);
        } else if (entry.key.type === "variable") {
          if (name === "__loc__") { next($2, this.location(path)); return; }
          const bound = env.vars.get(name);
          if (bound === undefined) throw this.gap(`$${name} is not bound`);
          next($2, this.expr(bound, path));
        } else {
          this.readField($2, x, name, false, path, inputFacts, next);
        }
      };
      step($, 0, {});
      return;
    }
    if (t.type === "Dict") {
      const step = ($2: Block, i: number, pairs: readonly [Expr, Expr][]): void => {
        if (i === entries.length) {
          const dict = this.declare($2, this.value(new Map(), t), "object");
          for (const [k, v] of pairs) this.put($2, dict, k, v, path);
          emit($2, dict);
          return;
        }
        const entry = entries[i]!;
        if (entry.key.type !== "computed" || entry.value.type !== "some") throw this.gap("a dict entry without a computed key and a value");
        this.gen(entry.key.value as JqNode, childPath(path, `object[${i}].key.computed`), $2, x, env, ($3, k) => {
          const key = this.bind($3, k, "key");
          this.gen(entry.value.value as JqNode, childPath(path, `object[${i}].value.some`), $3, x, env, ($4, v) => step($4, i + 1, [...pairs, [key, this.bind($4, v, "value")]]));
        });
      };
      step($, 0, []);
      return;
    }
    throw this.gap(`an object of ${printType(type)}`);
  }

  /**
   * A string with interpolations: each combination of the interpolated
   * values, each written by `text` (`tostring`, or a format).
   */
  genString(parts: readonly { type: string; value: any }[], path: string, $: Block, x: Value, env: Env, emit: Emit, text: ($: Block, v: Expr) => Expr, partsPath: string): void {
    const step = ($2: Block, i: number, acc: Expr): void => {
      if (i === parts.length) { emit($2, acc); return; }
      const part = parts[i]!;
      if (part.type === "text") {
        step($2, i + 1, this.concat(acc, this.str(part.value as string, path), path));
        return;
      }
      this.gen(part.value as JqNode, childPath(partsPath, `string[${i}].interpolate`), $2, x, env, ($3, v) => {
        step($3, i + 1, this.bind($3, this.concat(acc, text($3, v), path), "text"));
      });
    };
    step($, 0, this.str("", path));
  }

  /** Two strings joined. */
  concat(a: Expr, b: Expr, path: string): Expr {
    if (this.constant(a)?.value === "") return b;
    if (this.constant(b)?.value === "") return a;
    return this.b("StringConcat", [], [a, b], StringType, path);
  }

  /** jq's `tostring`: a string as it is, `null` as `null`, anything else as its East text (§13.9). */
  tostring($: Block, v: Expr, path: string): Expr {
    const e = this.open(v);
    const t = this.type(e);
    if (t.type === "String") return e;
    if (t.type === "Null") return this.str("null", path);
    if (nullablePayload(t) !== undefined) {
      return this.matchValue(e, { none: () => this.str("null", path), some: ($2, p) => this.tostring($2, p, path) }, StringType, path);
    }
    return this.b("Print", [t], [e], StringType, path);
  }

  // ─── Operators ──────────────────────────────────────────────────────────

  private genBinary(node: Extract<JqNode, { type: "binary" }>, path: string, $: Block, x: Value, env: Env, emit: Emit): void {
    const { left, op, right } = node.value;
    const leftPath = childPath(path, "binary.left");
    const rightPath = childPath(path, "binary.right");
    if (op === "and" || op === "or") {
      // The right side runs only when the left does not decide.
      this.gen(left, leftPath, $, x, env, ($2, a) => {
        const decided = ($3: Block): void => emit($3, this.bool(op === "or", path));
        const undecided = ($3: Block): void => this.gen(right, rightPath, $3, x, env, ($4, b) => emit($4, this.asExpr(this.truthy(b, path))));
        const truth = this.truthy(a, path);
        if (op === "and") this.branch($2, truth, undecided, decided, path);
        else this.branch($2, truth, decided, undecided, path);
      });
      return;
    }
    // A literal the checker made a Float, for an instance of this node whose
    // other operand is a Float, stays one in every instance; where this
    // instance's result is an Integer, it is its whole number.
    const integral = this.result(path, env);
    const whole = integral !== null && unifyShape(integral.shape)?.type === "Integer";
    // jq takes the right side's outputs first, and the left side's for each.
    this.collected(right, rightPath, $, x, env, ($2, b) => {
      this.collected(left, leftPath, $2, x, env, ($3, a) => {
        if (COMPARISONS.has(op)) emit($3, this.compare($3, op, a, b, path));
        else this.give($3, this.arith($3, op, whole ? this.integer(a, path) : a, whole ? this.integer(b, path) : b, path), emit);
      });
    });
  }

  /** A Float constant with a whole value, as an Integer; anything else as it is. */
  private integer(e: Expr, path: string): Expr {
    if (this.type(e).type !== "Float") return e;
    const c = this.constant(e);
    return c !== undefined && Number.isInteger(c.value as number) ? this.int(c.value as number, path) : e;
  }

  /** A comparison: East's order within a kind, jq's order across kinds (null, booleans, numbers, strings, arrays, objects). */
  compare($: Block, op: string, a: Expr, b: Expr, path: string): Expr {
    const va = this.open(a);
    const vb = this.open(b);
    const ta = this.type(va);
    const tb = this.type(vb);
    const oa = nullablePayload(ta) !== undefined;
    const ob = nullablePayload(tb) !== undefined;
    if (oa || ob) {
      // An option compares as null, or as its payload.
      const side = (v: Expr, open: boolean, then: ($2: Block, w: Expr) => Expr): Expr => open
        ? this.matchValue(v, { none: $2 => then($2, this.null(path)), some: ($2, p) => then($2, p) }, BooleanType, path)
        : then($, v);
      return side(va, oa, ($2, a2) => side(vb, ob, ($3, b2) => this.compare($3, op, a2, b2, path)));
    }
    const ra = jqRank(ta);
    const rb = jqRank(tb);
    if (ra !== rb || ta.type === "Null") return this.bool(ORDERINGS[op]!(ra < rb ? -1 : ra > rb ? 1 : 0), path);
    let l = va;
    let r = vb;
    if (!isTypeEqual(ta, tb)) {
      const common = unify(ta, tb);
      if (common === undefined) throw this.gap(`${printType(ta)} ${op} ${printType(tb)}`);
      l = this.widenTo($, va, common, path);
      r = this.widenTo($, vb, common, path);
    }
    const cl = this.constant(l);
    const cr = this.constant(r);
    if (cl !== undefined && cr !== undefined && typeof cl.value !== "object") {
      const order = cl.value === cr.value ? 0 : (cl.value as any) < (cr.value as any) ? -1 : 1;
      return this.bool(ORDERINGS[op]!(order), path);
    }
    return this.b(COMPARISON_BUILTINS[op]!, [this.type(l)], [l, r], BooleanType, path);
  }

  /**
   * An arithmetic operator on two values, as jq defines it for their kinds:
   * its value, or an error expression (of type Never) for kinds it does not
   * combine, which only a lenient place (`try`, `?`) lets through.
   */
  arith($: Block, op: string, a: Expr, b: Expr, path: string): Expr {
    const va = this.open(a);
    const vb = this.open(b);
    const ta = this.type(va);
    const tb = this.type(vb);
    if (op === "+") {
      // `null` is the identity of `+`.
      if (ta.type === "Null") return vb;
      if (tb.type === "Null") return va;
      if (nullablePayload(ta) !== undefined) {
        return this.matchAuto(va, { none: () => vb, some: ($2, p) => this.arith($2, op, p, vb, path) }, path);
      }
      if (nullablePayload(tb) !== undefined) {
        return this.matchAuto(vb, { none: () => va, some: ($2, p) => this.arith($2, op, va, p, path) }, path);
      }
    }
    const number = (t: EastType): boolean => t.type === "Integer" || t.type === "Float";
    if (number(ta) && number(tb)) {
      if (op === "/") {
        const divisor = this.bind($, this.widenTo($, vb, FloatType, path), "divisor");
        this.ifElse($, this.b("Equal", [FloatType], [divisor, this.float(0)], BooleanType, path), $2 => this.raise($2, "Division by zero", path), undefined, path);
        return this.b("FloatDivide", [], [this.widenTo($, va, FloatType, path), divisor], FloatType, path);
      }
      if (op === "%") {
        // jq truncates both sides to integers.
        const whole = (v: Expr, t: EastType): Expr => t.type === "Integer" ? v : this.round("roundTrunc", v, $, path);
        return this.b("IntegerRemainder", [], [whole(va, ta), whole(vb, tb)], IntegerType, path);
      }
      const name = ARITHMETIC_BUILTINS[op]!;
      if (ta.type === "Integer" && tb.type === "Integer") return this.b(`Integer${name}` as BuiltinName, [], [va, vb], IntegerType, path);
      return this.b(`Float${name}` as BuiltinName, [], [this.widenTo($, va, FloatType, path), this.widenTo($, vb, FloatType, path)], FloatType, path);
    }
    if (op === "+" && ta.type === "String" && tb.type === "String") return this.concat(va, vb, path);
    if (op === "+" && ta.type === "Array" && tb.type === "Array") {
      const element = unify(ta.value as EastType, tb.value as EastType);
      if (element === undefined) throw this.gap(`${printType(ta)} + ${printType(tb)}`);
      return this.b("ArrayConcat", [element], [this.widenTo($, va, ArrayType(element), path), this.widenTo($, vb, ArrayType(element), path)], ArrayType(element), path);
    }
    if (op === "-" && ta.type === "Array" && tb.type === "Array") {
      const others = this.bind($, vb, "others");
      const out = this.declare($, this.emptyArray(ta.value as EastType), "difference");
      this.forEach($, va, ($2, item) => {
        const found = this.declare($2, this.bool(false), "found");
        this.forEach($2, others, ($3, other, _key, label) => {
          this.ifElse($3, this.compare($3, "==", item, other, path), $4 => { this.assign($4, found, this.bool(true)); this.brk($4, label); }, undefined, path);
        }, path, "other");
        this.ifElse($2, this.not(found, path), $3 => this.push($3, out, item, path), undefined, path);
      }, path);
      return out;
    }
    if ((op === "+" || op === "*") && ta.type === "Struct" && tb.type === "Struct") return this.mergeStructs($, va, vb, op === "*");
    if (op === "+" && ta.type === "Dict" && tb.type === "Dict") {
      const merged = unify(ta, tb);
      if (merged === undefined) throw this.gap(`${printType(ta)} + ${printType(tb)}`);
      const out = this.declare($, this.b("DictCopy", [parts(merged).key, parts(merged).value], [this.widenTo($, va, merged, path)], merged, path), "merged");
      this.forEach($, this.widenTo($, vb, merged, path), ($2, value, key) => this.put($2, out, key!, value, path), path);
      return out;
    }
    if (op === "+" && (ta.type === "Dict" || tb.type === "Dict") && (ta.type === "Struct" || tb.type === "Struct")) return ta.type === "Dict" ? va : vb;
    if (op === "*" && ta.type === "String" && tb.type === "Integer") {
      // A negative count gives null; zero, the empty string.
      const option = OptionType(StringType);
      return this.ifValue(this.lt(vb, this.int(0), path),
        () => this.none(option),
        () => this.some(this.b("StringRepeat", [], [va, vb], StringType, path), option), option, path);
    }
    if (op === "/" && ta.type === "String" && tb.type === "String") return this.b("StringSplit", [], [va, vb], ArrayType(StringType), path);
    return this.failure(`${jqKind(ta)} and ${jqKind(tb)} cannot be combined with ${op}`, path);
  }

  /** An expression that raises an error: of type Never, so it stands for a value of any type. */
  failure(message: string, path: string): Expr {
    return this.mk({ ast_type: "Error", type: NeverType, loc_id: this.loc(path), message: this.ast(this.str(message, path)) });
  }

  /** Gives a value to `emit`, unless it is an error expression, which runs as a statement instead. */
  give($: Block, v: Expr, emit: Emit): void {
    if (this.ended($)) return;
    if (this.type(v).type === "Never") { this.stmt($, v); return; }
    emit($, v);
  }

  /** A value chosen by the case a variant holds, of the one type the cases' values share. */
  matchAuto(v: Expr, cases: Readonly<Record<string, ($: Block, payload: Expr) => Expr>>, path: string): Expr {
    const opened = this.open(v);
    const built: { name: string; variable: VariableAST; block: Block; value: Expr }[] = [];
    let type: EastType = NeverType;
    for (const [name, payload] of Object.entries(this.type(opened).cases)) {
      const variable: VariableAST = { ast_type: "Variable", type: payload, loc_id: UNKNOWN_LOC_ID, mutable: false, name: name === "some" ? "value" : "payload" };
      const block = this.block();
      const build = cases[name];
      if (build === undefined) throw this.gap(`no value for the case ${name}`);
      const value = build(block, fromAst(variable) as Expr);
      built.push({ name, variable, block, value });
      if (this.ended(block)) continue;
      const next = unify(type, this.type(value));
      if (next === undefined) throw this.gap(`${printType(type)} and ${printType(this.type(value))} as one value`);
      type = next;
    }
    const out: Record<string, { variable: VariableAST; body: AST }> = {};
    for (const { name, variable, block, value } of built) {
      if (this.ended(block)) { out[name] = { variable, body: { ast_type: "Block", type: NeverType, loc_id: UNKNOWN_LOC_ID, statements: block.statements } }; continue; }
      const w = this.widenTo(block, value, type, path);
      out[name] = { variable, body: block.statements.length === 0 ? this.ast(w) : { ast_type: "Block", type, loc_id: UNKNOWN_LOC_ID, statements: [...block.statements, this.ast(w)] } };
    }
    return this.mk({ ast_type: "Match", type, loc_id: this.loc(path), variant: this.ast(opened), cases: out });
  }

  /** `a + b` on structs: `b`'s fields win, and new ones follow; `a * b` merges struct fields too. */
  mergeStructs($: Block, a: Expr, b: Expr, deep: boolean): Expr {
    const left = this.bind($, this.open(a), "left");
    const right = this.bind($, this.open(b), "right");
    const af = this.type(left).fields as Record<string, EastType>;
    const bf = this.type(right).fields as Record<string, EastType>;
    const values: Record<string, Expr> = {};
    const types: Record<string, EastType> = {};
    for (const name of Object.keys(af)) { values[name] = this.field(left, name); types[name] = af[name]!; }
    for (const [name, t] of Object.entries(bf)) {
      values[name] = deep && name in af && unwrap(af[name]!).type === "Struct" && unwrap(t).type === "Struct"
        ? this.mergeStructs($, this.field(left, name), this.field(right, name), true)
        : this.field(right, name);
      types[name] = this.type(values[name]!);
    }
    return this.struct(StructType(types), values);
  }

  private genAlternative(node: Extract<JqNode, { type: "alternative" }>, path: string, $: Block, x: Value, env: Env, emit: Emit): void {
    // `a // b`: a's outputs that are neither false nor null, its errors
    // suppressed; or else b's. They are kept, then given on after the try, so
    // an error downstream is not suppressed.
    const leftPath = childPath(path, "alternative.left");
    const kept = this.declare($, this.emptyArray(this.typeAt(path, env)), "kept");
    this.tryCatch($, $2 => {
      this.gen(node.value.left, leftPath, $2, x, env, ($3, v) => this.present($3, v, path, ($4, w) => this.push($4, kept, w, path)));
    }, () => {}, path);
    this.ifElse($, this.lt(this.int(0), this.size(kept, path), path),
      $2 => this.forEach($2, kept, ($3, v) => emit($3, v), path),
      $2 => this.gen(node.value.right, childPath(path, "alternative.right"), $2, x, env, emit), path);
  }

  /** Gives a value to `emit` when it is neither false nor null, out of its option. */
  present($: Block, v: Expr, path: string, emit: Emit): void {
    const e = this.open(v);
    const t = this.type(e);
    if (t.type === "Null") return;
    if (nullablePayload(t) !== undefined) {
      this.match($, e, { some: ($2, p) => this.present($2, p, path, emit) }, path);
      return;
    }
    if (t.type === "Boolean") {
      const c = this.constant(e);
      if (c?.value === false) return;
      if (c?.value === true) { emit($, e); return; }
      this.ifElse($, e, $2 => emit($2, e), undefined, path);
      return;
    }
    emit($, e);
  }

  // ─── Control ────────────────────────────────────────────────────────────

  private genIf(node: Extract<JqNode, { type: "if" }>, path: string, $: Block, x: Value, env: Env, emit: Emit, index: number): void {
    const { branches, otherwise } = node.value;
    if (index === branches.length) {
      if (otherwise.type === "some") this.gen(otherwise.value, childPath(path, "if.otherwise.some"), $, x, env, emit);
      else emit($, this.expr(x, path));
      return;
    }
    const branch = branches[index]!;
    const conditionPath = childPath(path, `if.branches[${index}].condition`);
    this.narrowed($, x, conditionPath, env, ($2, value) => {
      this.gen(branch.condition, conditionPath, $2, value, env, ($3, c) => {
        this.branch($3, this.truthy(c, path),
          $4 => this.gen(branch.then, childPath(path, `if.branches[${index}].then`), $4, value, env, emit),
          $4 => this.genIf(node, path, $4, value, env, emit, index + 1), path);
      });
    });
  }

  /**
   * Runs a condition's continuation with its input opened when the condition
   * tests its type: `type == "number"` on an option then knows which it holds,
   * and the branch it rules out is never generated.
   */
  narrowed($: Block, x: Value, conditionPath: string, env: Env, then: ($: Block, value: Value) => void): void {
    const proves = this.result(conditionPath, this.envFor(conditionPath, env, x))?.proves;
    const typeTest = proves?.some(p => p.kind === "type" && p.path.length === 0) === true;
    if (!typeTest || isRoot(x) || nullablePayload(this.type(this.open(x))) === undefined) { then($, x); return; }
    this.match($, this.open(x), {
      none: $2 => then($2, this.null(conditionPath)),
      some: ($2, p) => then($2, p),
    }, conditionPath);
  }

  private genTry(node: Extract<JqNode, { type: "try" }>, path: string, $: Block, x: Value, env: Env, emit: Emit): void {
    // The body's outputs are kept, then given on after the try, so an error
    // their consumer raises is not the body's to catch; outputs before an
    // error stand, as in jq.
    const bodyPath = childPath(path, "try.body");
    const body = this.result(bodyPath, this.envFor(bodyPath, env, x));
    const type = body === null ? undefined : unifyShape(body.shape);
    const kept = type === undefined || type.type === "Never" ? undefined : this.declare($, this.emptyArray(type), "kept");
    const handler = node.value.catch.type === "some" ? node.value.catch.value : undefined;
    const caught = handler === undefined ? undefined : this.declare($, this.none(OptionType(StringType)), "caught");
    this.tryCatch($, $2 => {
      this.gen(node.value.body, bodyPath, $2, x, env, ($3, v) => {
        if (kept === undefined) throw this.gap("a try whose outputs have no one type");
        this.push($3, kept, v, path);
      });
    }, ($2, message) => {
      if (caught !== undefined) this.assign($2, caught, this.some(message, OptionType(StringType)));
    }, path);
    if (kept !== undefined) this.forEach($, kept, ($2, v) => emit($2, v), path);
    if (handler !== undefined && caught !== undefined) {
      this.match($, caught, { some: ($2, message) => this.gen(handler, childPath(path, "try.catch.some"), $2, message, env, emit) }, path);
    }
  }

  private genFold(node: Extract<JqNode, { type: "reduce" | "foreach" }>, path: string, $: Block, x: Value, env: Env, emit: Emit): void {
    const kind = node.type;
    const accType = this.checked.typeAt(`${path}#acc`, env.instance)?.type;
    if (accType === undefined) throw this.gap(`no accumulator type for ${kind}`);
    const updatePath = childPath(path, `${kind}.update`);
    // For each value `init` gives, a fold over the source's values.
    this.gen(node.value.init, childPath(path, `${kind}.init`), $, x, env, ($2, init) => {
      const acc = this.declare($2, this.widenTo($2, init, accType, path), "acc");
      this.collected(node.value.source, childPath(path, `${kind}.source`), $2, x, env, ($3, item) => {
        this.destructure($3, node.value.pattern, childPath(path, `${kind}.pattern`), item, env, updatePath, ($4, vars) => {
          const inner: Env = { ...env, vars };
          // The update runs on the state as it was; each output becomes the state, the last staying.
          const state = this.declare($4, acc, "state", false);
          this.gen(node.value.update, updatePath, $4, state, inner, ($5, next) => {
            const value = this.bind($5, this.widenTo($5, next, accType, path), "next");
            this.assign($5, acc, value);
            if (kind === "foreach") {
              const extract = (node as Extract<JqNode, { type: "foreach" }>).value.extract;
              if (extract.type === "none") emit($5, value);
              else this.gen(extract.value, childPath(path, "foreach.extract.some"), $5, value, inner, emit);
            }
          });
        });
      });
      if (kind === "reduce") emit($2, acc);
    });
  }

  private genBind(node: Extract<JqNode, { type: "bind" }>, path: string, $: Block, x: Value, env: Env, emit: Emit): void {
    const { body, patterns, source } = node.value;
    const bodyPath = childPath(path, "bind.body");
    this.gen(source, childPath(path, "bind.source"), $, x, env, ($2, s) => {
      if (patterns.length === 1) {
        this.destructure($2, patterns[0]!, childPath(path, "bind.patterns[0]"), s, env, bodyPath, ($3, vars) => {
          this.gen(body, bodyPath, $3, x, { ...env, vars }, emit);
        });
        return;
      }
      // `?//`: the first pattern that binds and whose body raises no error;
      // the body's outputs are kept, then given on.
      const type = this.typeAt(bodyPath, env);
      const kept = this.declare($2, this.emptyArray(type), "kept");
      const attempt = ($3: Block, i: number): void => {
        const run = ($4: Block): void => {
          this.destructure($4, patterns[i]!, childPath(path, `bind.patterns[${i}]`), s, env, bodyPath, ($5, vars) => {
            this.gen(body, bodyPath, $5, x, { ...env, vars }, ($6, v) => this.push($6, kept, v, path));
          });
        };
        if (i === patterns.length - 1) { run($3); return; }
        this.tryCatch($3, run, $4 => {
          this.stmt($4, this.b("ArrayClear", [type], [kept], NullType, path));
          attempt($4, i + 1);
        }, path);
      };
      attempt($2, 0);
      this.forEach($2, kept, ($3, v) => emit($3, v), path);
    });
  }

  /**
   * Binds a pattern's variables to the parts of a value, each as the type the
   * checker gave the variable where the body runs.
   */
  destructure($: Block, pattern: JqPattern, path: string, value: Value, env: Env, bodyPath: string, then: ($: Block, vars: ReadonlyMap<string, Value>) => void): void {
    const scope = this.checked.scopeAt(bodyPath, env.instance);
    const bind = ($2: Block, name: string, v: Value): Value => {
      if (isRoot(v)) return v;
      const checked = scope?.vars.get(name);
      const type = checked === undefined ? undefined : unifyShape(checked.shape);
      return this.bind($2, type === undefined ? v : this.widenTo($2, v, type, path), name);
    };
    const visit = ($2: Block, p: JqPattern, v: Value, vars: Map<string, Value>, done: ($3: Block, vars: Map<string, Value>) => void): void => {
      switch (p.type) {
        case "variable": {
          const next = new Map(vars);
          next.set(p.value, bind($2, p.value, v));
          done($2, next);
          return;
        }
        case "array": {
          const items = p.value as JqPattern[];
          const e = this.expr(v, path);
          const opened = this.type(this.open(e));
          if (opened.type !== "Null" && opened.type !== "Array" && opened.type !== "Vector") {
            this.raise($2, `Cannot index ${jqKind(opened)} with number`, path);
            return;
          }
          const step = ($3: Block, i: number, acc: Map<string, Value>): void => {
            if (i === items.length) { done($3, acc); return; }
            this.indexOf($3, e, this.int(i), false, path, ($4, element) => visit($4, items[i]!, element, acc, ($5, next) => step($5, i + 1, next)));
          };
          step($2, 0, vars);
          return;
        }
        case "object": {
          const entries = p.value as { key: string; value: { type: "none" | "some"; value: any } }[];
          const step = ($3: Block, i: number, acc: Map<string, Value>): void => {
            if (i === entries.length) { done($3, acc); return; }
            const entry = entries[i]!;
            this.readField($3, v, entry.key, false, path, undefined, ($4, part) => {
              if (entry.value.type === "none") {
                const next = new Map(acc);
                next.set(entry.key, bind($4, entry.key, part));
                step($4, i + 1, next);
              } else {
                visit($4, entry.value.value as JqPattern, part, acc, ($5, next) => step($5, i + 1, next));
              }
            });
          };
          step($2, 0, vars);
          return;
        }
      }
    };
    visit($, pattern, value, new Map(env.vars), then);
  }

  // ─── Calls ──────────────────────────────────────────────────────────────

  private genCall(node: Extract<JqNode, { type: "call" }>, path: string, $: Block, x: Value, env: Env, emit: Emit): void {
    const { args, name } = node.value;
    const binding = env.defs.get(`${name}/${args.length}`);
    const argPaths = args.map((_, i) => childPath(path, `call.args[${i}]`));
    if (binding === undefined) {
      this.genBuiltin(name, args, argPaths, path, $, x, env, emit);
      return;
    }
    const instance = `${env.instance}>${path}`;
    if (binding.kind === "param") {
      this.gen(binding.arg, binding.path, $, x, { ...binding.env, instance }, emit);
      return;
    }
    const def = binding.node.value;
    const closure = binding.env();
    const bodyPath = childPath(binding.path, "def.body");
    // Each combination of the value parameters' outputs, the first slowest.
    const bindParams = ($2: Block, i: number, vars: Map<string, Value>, defs: Map<string, Binding>, types: string[]): void => {
      if (i === def.params.length) {
        const signature = [binding.path, isRoot(x) ? "root" : printType(this.type(x)), ...types].join("|");
        const values = def.params.filter(p => p.startsWith("$")).map(p => this.expr(vars.get(p.slice(1))!, path));
        const recursion = env.recursion.get(signature);
        if (recursion !== undefined) {
          this.callRecursive($2, recursion, x, values, path, emit);
          return;
        }
        const bodyEnv: Env = { vars, defs, labels: closure.labels, instance, recursion: env.recursion };
        if (callsItself(def.body, `${def.name}/${def.params.length}`)) this.genRecursive($2, def, bodyPath, signature, x, values, bodyEnv, path, env, emit);
        else this.gen(def.body, bodyPath, $2, x, bodyEnv, emit);
        return;
      }
      const param = def.params[i]!;
      const argPath = childPath(path, `call.args[${i}]`);
      if (!param.startsWith("$")) {
        const nextDefs = new Map(defs);
        nextDefs.set(`${param}/0`, { kind: "param", arg: args[i]!, path: argPath, env });
        bindParams($2, i + 1, vars, nextDefs, types);
        return;
      }
      this.collected(args[i]!, argPath, $2, x, env, ($3, v) => {
        const name2 = param.slice(1);
        const bound = this.bind($3, v, name2);
        const nextVars = new Map(vars);
        nextVars.set(name2, bound);
        const nextDefs = new Map(defs);
        nextDefs.set(`${name2}/0`, { kind: "param", arg: variant("variable", name2) as JqNode, path: argPath, env: { ...closure, vars: nextVars } });
        bindParams($3, i + 1, nextVars, nextDefs, [...types, printType(this.type(bound))]);
      });
    };
    bindParams($, 0, new Map(closure.vars), new Map(closure.defs), []);
  }

  /**
   * A recursive def with value parameters: an East function held in a
   * reference, which its own body calls through the reference. It returns
   * its whole stream as an array, so early exit does not reach into it.
   */
  private genRecursive($: Block, def: Extract<JqNode, { type: "def" }>["value"], bodyPath: string, signature: string, x: Value, values: Expr[], bodyEnv: Env, callPath: string, callerEnv: Env, emit: Emit): void {
    const output = this.typeAt(callPath, callerEnv);
    const input = this.type(this.expr(x, callPath));
    const params = def.params.filter(p => p.startsWith("$")).map(p => p.slice(1));
    const inputs = [input, ...values.map(v => this.type(v))];
    const fnType = FunctionType(inputs, ArrayType(output));
    const placeholder = this.lambda(inputs, ArrayType(output), [], () => this.emptyArray(output), callPath);
    const cell = this.declare($, this.mk({ ast_type: "NewRef", type: RefType(fnType), loc_id: UNKNOWN_LOC_ID, value: this.ast(placeholder) }), def.name, false);
    const recursion = new Map(bodyEnv.recursion);
    recursion.set(signature, cell);
    const fn = this.lambda(inputs, ArrayType(output), ["input", ...params], ($f, self, ...args) => {
      const vars = new Map(bodyEnv.vars);
      params.forEach((p, i) => vars.set(p, args[i]!));
      const out = this.declare($f, this.emptyArray(output), "outputs");
      // A function body cannot break to a label outside it.
      this.gen(def.body, bodyPath, $f, self, { ...bodyEnv, vars, labels: new Map(), recursion }, ($g, v) => this.push($g, out, v, callPath));
      return out;
    }, callPath);
    this.stmt($, this.b("RefUpdate", [fnType], [cell, fn], NullType, callPath));
    this.callRecursive($, cell, x, values, callPath, emit);
  }

  /** A call of a recursive def through its reference: its stream, in order. */
  private callRecursive($: Block, cell: Expr, x: Value, values: Expr[], path: string, emit: Emit): void {
    const fnType = this.type(cell).value as EastType;
    const fn = this.b("RefGet", [fnType], [cell], fnType, path);
    const results = this.bind($, this.callFn(fn, [this.expr(x, path), ...values], path), "outputs");
    this.forEach($, results, ($2, v) => emit($2, v), path);
  }

  /** A builtin, by its rule. */
  genBuiltin(name: string, args: readonly JqNode[], argPaths: readonly string[], path: string, $: Block, x: Value, env: Env, emit: Emit): void {
    const rule = BUILTIN_RULES[name];
    if (rule === undefined) throw this.gap(`no translation for the builtin ${name}/${args.length}`);
    rule(this, { name, path, args, argPaths, $, x, env, emit });
  }

  // ─── Assignment ─────────────────────────────────────────────────────────

  private genUpdate(node: Extract<JqNode, { type: "update" }>, path: string, $: Block, x: Value, env: Env, emit: Emit): void {
    const { op, path: target, value } = node.value;
    const targetPath = childPath(path, "update.path");
    const valuePath = childPath(path, "update.value");
    const input = this.expr(x, path);
    if (op === "|=") {
      // Each position's new value is the update's first output on the old one; none deletes it.
      emit($, this.whole(this.modify($, input, target, targetPath, env, ($2, old) => this.firstOf(value, valuePath, $2, old, env)), path));
      return;
    }
    // `=` and the arithmetic updates take their value on `.`, once for each of its outputs.
    this.collected(value, valuePath, $, x, env, ($2, v) => {
      const bound = this.bind($2, v, "update");
      emit($2, this.whole(this.modify($2, input, target, targetPath, env, ($3, old) => {
        if (op === "=") return { value: bound, optional: false };
        const operator = op.slice(0, -1);
        if (operator === "//") {
          // The old value where it is neither false nor null, else the update.
          const kept = nullablePayload(this.type(this.open(old))) ?? this.type(this.open(old));
          const type = kept.type === "Null" ? this.type(bound) : unify(kept, this.type(bound)) ?? this.type(bound);
          const cell = this.declare($3, this.widenTo($3, bound, type, path), "value");
          this.present($3, old, path, ($4, w) => this.assign($4, cell, this.widenTo($4, w, type, path)));
          return { value: cell, optional: false };
        }
        return { value: this.arith($3, operator, old, bound, path), optional: false };
      }), path));
    });
  }

  /** What an update gives: the value, `null` where it deleted `.` itself (an optional value's `none`), as jq gives it. */
  private whole(update: Update | undefined, path: string): Expr {
    return update === undefined ? this.null(path) : update.value;
  }

  /** The type of an update's new value: an optional one's payload. */
  updateType(update: Update): EastType {
    const t = this.type(update.value);
    return update.optional ? parts(t).cases["some"]! : t;
  }

  /** The first output of a filter: exactly it when there is always one, else an option whose `none` is no output. */
  firstOf(node: JqNode, path: string, $: Block, x: Expr, env: Env): Update | undefined {
    const e = this.envFor(path, env, x);
    const r = this.result(path, e);
    const type = r === null ? undefined : unifyShape(r.shape);
    if (r === null || type === undefined || type.type === "Never") return undefined;
    if (r.mult.lo === 1 && r.mult.hi === 1) return { value: this.one(node, path, $, x, env, type), optional: false };
    const option = OptionType(type);
    const found = this.declare($, this.none(option), "first");
    this.once($, ($2, label) => this.gen(node, path, $2, x, env, ($3, v) => {
      this.assign($3, found, this.some(this.widenTo($3, v, type, path), option));
      this.brk($3, label);
    }), path);
    return { value: found, optional: true };
  }

  /**
   * A value with the positions a path names updated: `f` gives each
   * position's new value from its old one, or none, which deletes it.
   *
   * @returns the value updated; an option of it, none where `.` itself was
   *   deleted; or `undefined` where it always is
   */
  modify($: Block, v: Expr, target: JqNode, path: string, env: Env, f: UpdateFn): Update | undefined {
    const at = (step: string): string => childPath(path, step);
    const present = (value: Expr): Update => ({ value, optional: false });
    switch (target.type) {
      case "identity":
        return f($, v);
      case "pipe":
        return this.modify($, v, target.value.left, at("pipe.left"), env, ($2, inner) =>
          this.modify($2, inner, target.value.right, at("pipe.right"), env, f));
      case "field": {
        const { name, optional } = target.value;
        return this.modify($, v, target.value.target, at("field.target"), env, ($2, inner) => present(this.setField($2, inner, name, optional, path, env, f)));
      }
      case "index": {
        const { index, optional } = target.value;
        const literal = this.literalOf(index);
        const keyPath = at("index.index");
        // The key is taken on the index's own input, as jq takes it.
        const key = literal?.type.type === "String" ? undefined : this.one(index, keyPath, $, v, env, this.typeAt(keyPath, this.envFor(keyPath, env, v)));
        return this.modify($, v, target.value.target, at("index.target"), env, ($2, inner) => {
          if (key !== undefined) return present(this.setIndex($2, inner, key, optional, path, f));
          const name = literal!.value as string;
          return present(this.type(this.open(inner)).type === "Dict"
            ? this.setIndex($2, inner, this.str(name, path), optional, path, f)
            : this.setField($2, inner, name, optional, path, env, f));
        });
      }
      case "slice": {
        const { from, optional, to } = target.value;
        // The bounds are taken on the slice's own input, as jq takes them.
        const bound = (option: typeof from, step: string): Expr | undefined => option.type === "none" ? undefined
          : this.one(option.value as JqNode, at(step), $, v, env, this.typeAt(at(step), this.envFor(at(step), env, v)));
        const a = bound(from, "slice.from.some");
        const b = bound(to, "slice.to.some");
        return this.modify($, v, target.value.target, at("slice.target"), env, ($2, inner) => present(this.setSlice($2, inner, a, b, optional, path, f)));
      }
      case "iterate":
        return this.modify($, v, target.value.target, at("iterate.target"), env, ($2, inner) => present(this.setEach($2, inner, target.value.optional, path, f)));
      case "descend":
        return this.walkUpdate($, v, undefined, path, f);
      case "call": {
        const { args, name } = target.value;
        if (name === "select" && args.length === 1) {
          const conditionPath = at("call.args[0]");
          return this.selected($, v, path, f, ($2, value, then) => this.narrowed($2, value, conditionPath, env, ($3, opened) => {
            this.gen(args[0]!, conditionPath, $3, opened, env, ($4, c) =>
              this.branch($4, this.truthy(c, path), $5 => then($5, this.expr(opened, path)), () => {}, path));
          }));
        }
        if (UPDATE_SELECTORS.has(name) && args.length === 0) {
          return this.selected($, v, path, f, ($2, value, then) => this.genBuiltin(name, [], [], path, $2, value, env, then));
        }
        if (name === "empty" && args.length === 0) return present(v);
        if (name === "recurse" && args.length <= 1) return this.walkUpdate($, v, args[0], path, f);
        throw this.gap(`assigning to ${name}(…)`);
      }
      default:
        throw this.gap(`assigning to ${this.text(path)}`);
    }
  }

  /**
   * An update where a filter keeps the value (`select(f)`, `numbers`):
   * `each` calls `then` with the value, narrowed, each time the filter keeps
   * it, and `f` gives the new value there; where it is not kept, it stays.
   */
  private selected($: Block, v: Expr, path: string, f: UpdateFn, each: ($: Block, value: Expr, then: Emit) => void): Update | undefined {
    const old = this.bind($, v, "selected");
    const T = this.type(old);
    const mark = $.statements.length;
    let cell: { variable: Expr; type: EastType; value: EastType; optional: boolean } | undefined;
    each($, old, ($2, kept) => {
      const next = f($2, kept);
      if (cell === undefined) {
        // The updated value's type, known from the update's, declared before the filter runs.
        const given = next === undefined ? NeverType : this.updateType(next);
        const value = sameType(T, given) ? T : unify(T, given) ?? T;
        const optional = next === undefined || next.optional;
        const type = optional ? OptionType(value) : value;
        const init = this.block();
        const start = this.widenTo(init, old, value, path);
        const variable: VariableAST = { ast_type: "Variable", type, loc_id: UNKNOWN_LOC_ID, mutable: true, name: "selected" };
        $.statements.splice(mark, 0, ...init.statements, { ast_type: "Let", type: NullType, loc_id: UNKNOWN_LOC_ID, variable, value: this.ast(optional ? this.some(start, type) : start) });
        cell = { variable: fromAst(variable) as Expr, type, value, optional };
      }
      const c = cell;
      const set = ($3: Block, w: Expr): void => {
        const widened = this.widenTo($3, w, c.value, path);
        this.assign($3, c.variable, c.optional ? this.some(widened, c.type) : widened);
      };
      if (next === undefined) {
        if (c.optional) this.assign($2, c.variable, this.none(c.type));
        else this.raise($2, UNDELETABLE, path);
        return;
      }
      if (!next.optional || !c.optional) { set($2, this.required($2, next, path)); return; }
      this.match($2, next.value, { some: set, none: $3 => this.assign($3, c.variable, this.none(c.type)) }, path);
    });
    return cell === undefined ? { value: old, optional: false } : { value: cell.variable, optional: cell.optional };
  }

  /** An update's value where the position cannot be deleted (a struct field, a variant's payload): an error where it has none. */
  required($: Block, update: Update, path: string): Expr {
    if (!update.optional) return update.value;
    const payload = this.updateType(update);
    return this.matchValue(update.value, {
      none: $2 => { this.raise($2, UNDELETABLE, path); return this.placeholder(payload); },
      some: (_$2, p) => p,
    }, payload, path);
  }

  /**
   * A position that cannot be deleted: its new value, or where the update
   * never gives one, an error raised there (and a value of its type for the
   * code after, which never runs).
   */
  private kept($: Block, update: Update | undefined, type: EastType, path: string): Expr {
    if (update !== undefined) return this.required($, update, path);
    this.raise($, UNDELETABLE, path);
    return this.placeholder(type);
  }

  /**
   * A struct of some fields' values: of the original's type, recursive
   * wrapper and all, when its fields' types are the original's.
   */
  private rebuilt(original: Expr, types: Record<string, EastType>, values: Record<string, Expr>): Expr {
    const type = StructType(types);
    const t = this.type(original);
    return this.struct(t.type === "Recursive" && isTypeEqual(t.node as EastType, type) ? t : type, values);
  }

  /**
   * A struct with one field replaced or added, or deleted by an update that
   * gives none; a dict's string key set; a variant's payload; `null` made a
   * struct. With `?`, a value of another kind is unchanged.
   */
  setField($: Block, v: Expr, name: string, optional: boolean, path: string, env: Env, f: UpdateFn): Expr {
    const e = this.open(v);
    const t = this.type(e);
    if (t.type === "Variant" && nullablePayload(t) === undefined && name === "value") return this.setPayload(e, path, env, f);
    if (t.type === "Null") {
      const next = f($, this.null(path));
      if (next === undefined) return e;
      const value = this.required($, next, path);
      return this.struct(StructType({ [name]: this.type(value) }), { [name]: value });
    }
    if (t.type === "Struct") {
      const fields = t.fields as Record<string, EastType>;
      const s = this.bind($, e, "struct");
      const next = f($, name in fields ? this.field(s, name) : this.null(path));
      const values: Record<string, Expr> = {};
      const types: Record<string, EastType> = {};
      const put = (field: string, value: Expr): void => { values[field] = value; types[field] = this.type(value); };
      for (const field of Object.keys(fields)) {
        if (field !== name) put(field, this.field(s, field));
        else if (next !== undefined) put(field, this.required($, next, path));
      }
      if (!(name in fields) && next !== undefined) put(name, this.required($, next, path));
      return this.rebuilt(v, types, values);
    }
    if (t.type === "Dict") return this.setIndex($, e, this.str(name, path), optional, path, f);
    if (optional) return v;
    throw this.gap(`.${name} = … on ${printType(t)}`);
  }

  /**
   * A variant with its payload updated, in each case the checker found it can
   * hold there; in the others it is as it was. A payload cannot be deleted.
   */
  private setPayload(v: Expr, path: string, env: Env, f: UpdateFn): Expr {
    const t = this.type(v);
    const payloads = t.cases as Record<string, EastType>;
    const updated = this.checked.updatedCases(path, env.instance, t) ?? Object.keys(payloads);
    const built = Object.entries(payloads).map(([name, type]) => {
      const variable: VariableAST = { ast_type: "Variable", type, loc_id: UNKNOWN_LOC_ID, mutable: false, name: "payload" };
      const block = this.block();
      const payload = fromAst(variable) as Expr;
      const value = updated.includes(name) ? this.kept(block, f(block, payload), type, path) : payload;
      return { name, type, variable, block, value };
    });
    // The variant's new type, from its payloads' new types.
    const cases: Record<string, EastType> = {};
    for (const b of built) cases[b.name] = this.ended(b.block) ? b.type : this.type(b.value);
    const V = VariantType(cases);
    const out: Record<string, { variable: VariableAST; body: AST }> = {};
    for (const b of built) {
      if (this.ended(b.block)) {
        out[b.name] = { variable: b.variable, body: { ast_type: "Block", type: NeverType, loc_id: UNKNOWN_LOC_ID, statements: b.block.statements } };
        continue;
      }
      const wrapped = this.ast(this.variantOf(V, b.name, b.value));
      out[b.name] = { variable: b.variable, body: b.block.statements.length === 0 ? wrapped : { ast_type: "Block", type: V, loc_id: UNKNOWN_LOC_ID, statements: [...b.block.statements, wrapped] } };
    }
    return this.mk({ ast_type: "Match", type: V, loc_id: this.loc(path), variant: this.ast(v), cases: out });
  }

  /** An array without the element at an index. */
  private without($: Block, array: Expr, i: Expr, path: string): Expr {
    const kept = this.declare($, this.emptyArray(this.type(array).value as EastType), "array");
    this.forEach($, array, ($2, item, index) => this.ifElse($2, this.not(this.eq(index!, i, path), path), $3 => this.push($3, kept, item, path), undefined, path), path);
    return kept;
  }

  /**
   * An array or dict with one element replaced, or deleted where the update
   * gives none; an empty struct or `null` made a dict. With `?`, a value of
   * another kind is unchanged.
   */
  setIndex($: Block, v: Expr, key: Expr, optional: boolean, path: string, f: UpdateFn): Expr {
    const e = this.open(v);
    const t = this.type(e);
    if (t.type === "Array") {
      const element = t.value as EastType;
      const source = this.bind($, e, "array");
      const i = this.declare($, this.widenTo($, key, IntegerType, path), "index");
      this.ifElse($, this.lt(i, this.int(0), path), $2 => this.assign($2, i, this.add(i, this.size(source, path), path)), undefined, path);
      const next = f($, this.b("ArrayGet", [element], [source, i], element, path));
      if (next === undefined) return this.without($, source, i, path);
      const E = unify(element, this.updateType(next)) ?? element;
      const out = this.declare($, isTypeEqual(E, element) ? this.b("ArrayCopy", [element], [source], t, path) : this.widenTo($, source, ArrayType(E), path), "array");
      const set = ($2: Block, w: Expr): void => this.stmt($2, this.b("ArrayUpdate", [E], [out, i, this.widenTo($2, w, E, path)], NullType, path));
      if (!next.optional) { set($, next.value); return out; }
      const result = this.declare($, out, "array");
      this.match($, next.value, { some: set, none: $2 => this.assign($2, result, this.without($2, out, i, path)) }, path);
      return result;
    }
    if (t.type === "Dict" || t.type === "Null" || (t.type === "Struct" && Object.keys(t.fields as object).length === 0)) {
      const K = t.type === "Dict" ? t.key as EastType : this.type(key);
      const V0 = t.type === "Dict" ? t.value as EastType : NeverType;
      const k = this.bind($, this.widenTo($, key, K, path), "key");
      const old = t.type === "Dict"
        ? (nullablePayload(OptionType(V0)) === undefined
          ? this.matchValue(this.b("DictTryGet", [K, V0], [e, k], OptionType(V0), path), { none: () => this.null(path), some: (_$2, p) => p }, V0, path)
          : this.b("DictTryGet", [K, V0], [e, k], OptionType(V0), path))
        : this.null(path);
      const next = f($, old);
      if (next === undefined) {
        if (t.type !== "Dict") return this.value(new Map(), DictType(K, NeverType));
        const out = this.declare($, this.b("DictCopy", [K, V0], [e], t, path), "dict");
        this.stmt($, this.b("DictTryDelete", [K, V0], [out, k], BooleanType, path));
        return out;
      }
      const nextType = this.updateType(next);
      const V = V0.type === "Never" ? nextType : unify(V0, nextType) ?? V0;
      const D = DictType(K, V);
      const out = this.declare($, t.type === "Dict" ? this.b("DictCopy", [K, V], [this.widenTo($, e, D, path)], D, path) : this.value(new Map(), D), "dict");
      if (next.optional) {
        this.match($, next.value, {
          some: ($2, w) => this.put($2, out, k, w, path),
          none: $2 => this.stmt($2, this.b("DictTryDelete", [K, V], [out, k], BooleanType, path)),
        }, path);
      } else {
        this.put($, out, k, next.value, path);
      }
      return out;
    }
    if (optional) return v;
    throw this.gap(`.[k] = … on ${printType(t)}`);
  }

  /**
   * An array with a slice replaced by the array the update gives, or deleted
   * where it gives none; `null`'s slice is null, so the update's array is
   * the value. With `?`, a value of another kind is unchanged.
   */
  setSlice($: Block, v: Expr, a: Expr | undefined, b: Expr | undefined, optional: boolean, path: string, f: UpdateFn): Expr {
    const e = this.open(v);
    const t = this.type(e);
    if (t.type === "Null") {
      const next = f($, this.null(path));
      return next === undefined ? e : next.value;
    }
    if (t.type === "Array") {
      const element = t.value as EastType;
      const source = this.bind($, e, "array");
      const length = this.declare($, this.size(source, path), "length", false);
      const start = this.boundOf($, a, this.int(0), length, path);
      const end = this.boundOf($, b, length, length, path);
      this.ifElse($, this.lt(end, start, path), $2 => this.assign($2, end, start), undefined, path);
      const before = this.bind($, this.b("ArraySlice", [element], [source, this.int(0), start], t, path), "before");
      const after = this.bind($, this.b("ArraySlice", [element], [source, end, length], t, path), "after");
      const next = f($, this.b("ArraySlice", [element], [source, start, end], t, path));
      const removed = (): Expr => this.b("ArrayConcat", [element], [before, after], t, path);
      if (next === undefined) return removed();
      const E = unify(element, parts(this.updateType(next)).value) ?? element;
      const A = ArrayType(E);
      const spliced = ($2: Block, middle: Expr): Expr => this.b("ArrayConcat", [E], [
        this.b("ArrayConcat", [E], [this.widenTo($2, before, A, path), this.widenTo($2, middle, A, path)], A, path),
        this.widenTo($2, after, A, path),
      ], A, path);
      if (!next.optional) return this.bind($, spliced($, next.value), "array");
      return this.bind($, this.matchValue(next.value, { some: ($2, middle) => spliced($2, middle), none: $2 => this.widenTo($2, removed(), A, path) }, A, path), "array");
    }
    if (optional) return v;
    throw this.gap(`.[a:b] = … on ${printType(t)}`);
  }

  /**
   * Every element, dict value or struct field replaced; an element or value
   * with no new value is deleted, and a field whose update never gives one.
   * With `?`, a value of another kind is unchanged.
   */
  setEach($: Block, v: Expr, optional: boolean, path: string, f: UpdateFn): Expr {
    const e = this.open(v);
    const t = this.type(e);
    if (t.type === "Array" || t.type === "Dict") {
      let element: EastType | undefined;
      const each = ($2: Block, item: Expr, insert: ($3: Block, w: Expr) => void): void => {
        const next = f($2, item);
        if (next === undefined) return;
        if (next.optional) this.match($2, next.value, { some: insert }, path);
        else insert($2, next.value);
      };
      if (t.type === "Array") {
        let out: Expr | undefined;
        const outDecl = this.block();
        this.forEach($, e, ($2, item) => each($2, item, ($3, w) => {
          element ??= this.type(w);
          out ??= this.declare(outDecl, this.emptyArray(element), "array");
          this.push($3, out, w, path);
        }), path);
        // The array is declared before the loop, once the element type is known from the update.
        $.statements.splice($.statements.length - 1, 0, ...outDecl.statements);
        // An update that never gives a value deletes every element.
        return out ?? this.value([], ArrayType(NeverType));
      }
      let out: Expr | undefined;
      const outDecl = this.block();
      this.forEach($, e, ($2, item, key) => each($2, item, ($3, w) => {
        element ??= this.type(w);
        const D = DictType(t.key as EastType, element);
        out ??= this.declare(outDecl, this.value(new Map(), D), "dict");
        this.stmt($3, this.b("DictInsert", [t.key as EastType, element], [out, key!, this.widenTo($3, w, element, path)], NullType, path));
      }), path);
      $.statements.splice($.statements.length - 1, 0, ...outDecl.statements);
      return out ?? this.value(new Map(), DictType(t.key as EastType, NeverType));
    }
    if (t.type === "Struct") {
      const s = this.bind($, e, "struct");
      const values: Record<string, Expr> = {};
      const types: Record<string, EastType> = {};
      for (const name of Object.keys(t.fields as object)) {
        const next = f($, this.field(s, name));
        if (next === undefined) continue;
        values[name] = this.required($, next, path);
        types[name] = this.type(values[name]!);
      }
      return this.rebuilt(v, types, values);
    }
    if (optional) return v;
    throw this.gap(`.[] |= … on ${printType(t)}`);
  }

  /**
   * `..`, `recurse` or `recurse(.a[])` in an update's path: in pre-order,
   * each position the walk visits is updated by `f`, then the positions
   * inside it that it had before its update, in turn. A value of a recursive
   * type is walked by a function its own positions call, through a
   * reference, each declared before the walk.
   */
  private walkUpdate($: Block, v: Expr, child: JqNode | undefined, path: string, f: UpdateFn): Update | undefined {
    const steps = child === undefined ? undefined : walkSteps(child);
    if (child !== undefined && steps === undefined) throw this.gap(`assigning through ${this.text(path)}`);
    const mark = $.statements.length;
    const declarations = this.block();
    const definitions = this.block();
    const cells: { type: EastType; cell: Expr; fnType: EastType }[] = [];
    // A position: updated, then the positions inside it.
    const visit = ($2: Block, current: Expr, old: Expr): Update | undefined => {
      const K = this.type(current);
      const next = f($2, current);
      if (next === undefined) return undefined;
      const inside = ($3: Block, w: Expr): Expr => steps === undefined
        ? this.walkInside($3, this.widenTo($3, w, K, path), old, path, node)
        : this.walkAlong($3, this.widenTo($3, w, K, path), old, steps.fields, path, node);
      if (!next.optional) return { value: this.bind($2, inside($2, next.value), "walked"), optional: false };
      const option = OptionType(K);
      const value = this.matchValue(next.value, { none: () => this.none(option), some: ($3, w) => this.some(inside($3, w), option) }, option, path);
      return { value: this.bind($2, value, "walked"), optional: true };
    };
    // A recursive position, walked by its kind's function.
    const call = ($2: Block, current: Expr, old: Expr): Update => {
      const R = this.type(current);
      const option = OptionType(R);
      let entry = cells.find(c => isTypeEqual(c.type, R));
      if (entry === undefined) {
        const fnType = FunctionType([R, R], option);
        const placeholder = this.lambda([R, R], option, [], () => this.none(option), path);
        const cell = this.declare(declarations, this.mk({ ast_type: "NewRef", type: RefType(fnType), loc_id: UNKNOWN_LOC_ID, value: this.ast(placeholder) }), "walk", false);
        entry = { type: R, cell, fnType };
        cells.push(entry);
        const fn = this.lambda([R, R], option, ["value", "old"], ($f, value, previous) => {
          const u = visit($f, value, previous);
          if (u === undefined) return this.none(option);
          return u.optional ? u.value : this.some(u.value, option);
        }, path);
        this.stmt(definitions, this.b("RefUpdate", [fnType], [cell, fn], NullType, path));
      }
      const fn = this.b("RefGet", [entry.fnType], [entry.cell], entry.fnType, path);
      return { value: this.bind($2, this.callFn(fn, [current, old], path), "walked"), optional: true };
    };
    const node: WalkFn = ($2, current, old) => this.type(current).type === "Recursive" ? call($2, current, old) : visit($2, current, old);
    const result = node($, v, v);
    // The functions, declared before the walk that calls them, and each given its body once every one is declared.
    $.statements.splice(mark, 0, ...declarations.statements, ...definitions.statements);
    return result;
  }

  /**
   * A value with the positions `..` finds inside it walked: an option's
   * value's positions, a variant's payload (its case's name is not a
   * position), and the elements, dict values and struct fields of
   * {@link Translator.walkElements}; only those `old`, the value before its
   * own update, had.
   */
  private walkInside($: Block, w: Expr, old: Expr, path: string, node: WalkFn): Expr {
    const e = this.open(w);
    const t = this.type(e);
    if (nullablePayload(t) !== undefined) {
      return this.matchValue(e, {
        none: () => e,
        some: ($2, p) => this.matchValue(this.open(old), {
          none: () => this.some(p, t),
          some: ($3, q) => this.some(this.walkInside($3, p, q, path, node), t),
        }, t, path),
      }, t, path);
    }
    if (t.type === "Variant") {
      const whole = this.type(w);
      const cases: Record<string, ($2: Block, payload: Expr) => Expr> = {};
      for (const name of Object.keys(t.cases as object)) {
        cases[name] = ($2, p) => {
          // The payload is walked where the value had this case before.
          const before: Record<string, ($3: Block, payload: Expr) => Expr> = {};
          for (const other of Object.keys(t.cases as object)) {
            before[other] = other === name ? ($3, q) => this.kept($3, node($3, p, q), this.type(p), path) : () => p;
          }
          return this.variantOf(whole, name, this.matchValue(this.open(old), before, this.type(p), path));
        };
      }
      return this.matchValue(e, cases, whole, path);
    }
    return this.walkElements($, w, old, path, node);
  }

  /**
   * `recurse(.a.b[])`'s positions inside a value, walked: along the fields,
   * then each element there that `old` had.
   */
  private walkAlong($: Block, w: Expr, old: Expr, fields: readonly string[], path: string, node: WalkFn): Expr {
    if (fields.length === 0) return this.walkElements($, w, old, path, node);
    const e = this.open(w);
    const t = this.type(e);
    if (t.type !== "Struct") throw this.gap(`recurse(.${fields.join(".")}[]) on ${printType(t)}`);
    const s = this.bind($, e, "struct");
    const o = this.bind($, this.open(old), "old");
    const values: Record<string, Expr> = {};
    const types: Record<string, EastType> = {};
    for (const name of Object.keys(t.fields as object)) {
      values[name] = name === fields[0] ? this.bind($, this.walkAlong($, this.field(s, name), this.field(o, name), fields.slice(1), path, node), name) : this.field(s, name);
      types[name] = this.type(values[name]!);
    }
    return this.rebuilt(w, types, values);
  }

  /**
   * The positions `.[]` names inside a value, each walked by `node`: an
   * array's elements, a set's, a dict's values, a struct's fields, and those
   * of an option's value; only those `old` had. An element or dict value the
   * walk gives no value is deleted.
   */
  private walkElements($: Block, w: Expr, old: Expr, path: string, node: WalkFn): Expr {
    const e = this.open(w);
    const o = this.open(old);
    const t = this.type(e);
    // An element the walk updated, or none to drop it.
    const each = ($2: Block, update: Update | undefined, insert: ($3: Block, value: Expr) => void): void => {
      if (update === undefined) return;
      if (update.optional) this.match($2, update.value, { some: insert }, path);
      else insert($2, update.value);
    };
    if (nullablePayload(t) !== undefined) {
      return this.matchValue(e, {
        none: () => e,
        some: ($2, p) => this.matchValue(o, {
          none: () => this.some(p, t),
          some: ($3, q) => this.some(this.walkElements($3, p, q, path, node), t),
        }, t, path),
      }, t, path);
    }
    switch (t.type) {
      case "Array": {
        const E = t.value as EastType;
        const out = this.declare($, this.emptyArray(E), "array");
        const count = this.declare($, this.size(o, path), "count", false);
        this.forEach($, e, ($2, item, index) => this.ifElse($2, this.lt(index!, count, path),
          $3 => each($3, node($3, item, this.b("ArrayGet", [E], [o, index!], E, path)), ($4, value) => this.push($4, out, value, path)),
          $3 => this.push($3, out, item, path), path), path);
        return out;
      }
      case "Set": {
        const K = t.key as EastType;
        const out = this.declare($, this.value(new Set(), t), "set");
        this.forEach($, e, ($2, item) => this.ifElse($2, this.b("SetHas", [K], [o, item], BooleanType, path),
          $3 => each($3, node($3, item, item), ($4, value) => this.stmt($4, this.b("SetTryInsert", [K], [out, value], BooleanType, path))),
          $3 => this.stmt($3, this.b("SetTryInsert", [K], [out, item], BooleanType, path)), path), path, "key");
        return out;
      }
      case "Dict": {
        const K = t.key as EastType;
        const V = t.value as EastType;
        const out = this.declare($, this.value(new Map(), t), "dict");
        const insert = ($2: Block, key: Expr, value: Expr): void => this.stmt($2, this.b("DictInsert", [K, V], [out, key, this.widenTo($2, value, V, path)], NullType, path));
        this.forEach($, e, ($2, item, key) => this.match($2, this.b("DictTryGet", [K, V], [o, key!], OptionType(V), path), {
          none: $3 => insert($3, key!, item),
          some: ($3, previous) => each($3, node($3, item, previous), ($4, value) => insert($4, key!, value)),
        }, path), path);
        return out;
      }
      case "Struct": {
        const s = this.bind($, e, "struct");
        const before = this.bind($, o, "old");
        const values: Record<string, Expr> = {};
        const types: Record<string, EastType> = {};
        for (const [name, fieldType] of Object.entries(t.fields as Record<string, EastType>)) {
          values[name] = this.bind($, this.kept($, node($, this.field(s, name), this.field(before, name)), fieldType, path), name);
          types[name] = this.type(values[name]!);
        }
        return this.rebuilt(w, types, values);
      }
      default:
        return w;
    }
  }
}

/** East's float library functions, as the translation embeds them. */
const libraryFunctions = new Map<string, Expr>();

/**
 * A float library function, its locations dropped: they are ids in the
 * library's own source map, made when it loaded, and would name nothing in a
 * translation's, nor encode to the same bytes in every process.
 */
function libraryFunction(name: "roundFloor" | "roundCeil" | "roundHalf" | "roundTrunc"): Expr {
  let fn = libraryFunctions.get(name);
  if (fn === undefined) {
    fn = fromAst(withoutLocations((FloatLib[name] as any)[AstSymbol] as AST)) as Expr;
    libraryFunctions.set(name, fn);
  }
  return fn;
}

/** A copy of an AST with every location unknown; a node shared in the original is shared in the copy. */
function withoutLocations(ast: AST): AST {
  const copies = new Map<object, unknown>();
  const copy = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      const known = copies.get(node);
      if (known !== undefined) return known;
      const out: unknown[] = [];
      copies.set(node, out);
      for (const item of node) out.push(copy(item));
      return out;
    }
    if (node === null || typeof node !== "object" || isVariant(node)) return node;
    const known = copies.get(node);
    if (known !== undefined) return known;
    const out: Record<string, unknown> = {};
    copies.set(node, out);
    const value = (node as { ast_type?: unknown }).ast_type === "Value";
    for (const [key, item] of Object.entries(node)) {
      // Types, and a Value node's value, are data, not tree.
      if (key === "type" || key === "type_parameters" || (value && key === "value")) out[key] = item;
      else if (key === "loc_id" && typeof item === "bigint") out[key] = UNKNOWN_LOC_ID;
      else out[key] = copy(item);
    }
    return out;
  };
  return copy(ast) as AST;
}

/**
 * Whether a type holds Never below its top: an empty collection's element
 * type, an option that is always none. East's casts do not take such a type.
 */
function holdsNever(type: EastType): boolean {
  const seen = new Set<EastType>();
  const visit = (t: EastType, top: boolean): boolean => {
    if (t.type === "Never") return !top;
    if (seen.has(t)) return false;
    seen.add(t);
    switch (t.type) {
      case "Array": case "Ref": return visit(t.value as EastType, false);
      case "Set": return visit(t.key as EastType, false);
      case "Dict": return visit(t.key as EastType, false) || visit(t.value as EastType, false);
      case "Vector": case "Matrix": return visit(t.element as EastType, false);
      case "Struct": return Object.values(t.fields as Record<string, EastType>).some(f => visit(f, false));
      case "Variant": return Object.values(t.cases as Record<string, EastType>).some(c => visit(c, false));
      case "Recursive": return visit(t.node as EastType, false);
      default: return false;
    }
  };
  return visit(type, true);
}

/** The error an update raises where it gives no value for a position that cannot be deleted. */
const UNDELETABLE = "an update gave no value for a struct field, which cannot be deleted";

/** Whether values of type `b` are values of type `a`: equal types, or `a` recursive with `b` its node. */
function sameType(a: EastType, b: EastType): boolean {
  return isTypeEqual(a, b) || (a.type === "Recursive" && isTypeEqual(a.node as EastType, b));
}

/** Whether a value of a type is one a node's records were made for. */
function fits(type: EastType, input: Shape): boolean {
  if (input.kind === "type") return isTypeEqual(type, input.type);
  if (input.kind === "union") return input.members.some(m => isTypeEqual(type, m.shape.type));
  return false;
}

/** How jq names a value's kind in its error messages. @internal */
export function jqKind(type: EastType): string {
  const t = unwrap(type);
  if (nullablePayload(t) !== undefined) return "null";
  switch (t.type) {
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

/** A kind's place in jq's order across kinds. */
function jqRank(t: EastType): number {
  switch (t.type) {
    case "Null": return 0;
    case "Boolean": return 1;
    case "Integer": case "Float": return 2;
    case "String": return 3;
    case "Array": case "Set": case "Vector": case "Matrix": return 4;
    case "DateTime": return 6;
    case "Blob": return 7;
    default: return 5;
  }
}

/** The comparison operators. */
const COMPARISONS: ReadonlySet<string> = new Set(["==", "!=", "<", "<=", ">", ">="]);

const COMPARISON_BUILTINS: Readonly<Record<string, BuiltinName>> = {
  "==": "Equal", "!=": "NotEqual", "<": "Less", "<=": "LessEqual", ">": "Greater", ">=": "GreaterEqual",
};

/** Each comparison's truth for an order of its operands: -1, 0 or 1. */
const ORDERINGS: Readonly<Record<string, (order: number) => boolean>> = {
  "==": o => o === 0, "!=": o => o !== 0, "<": o => o < 0, "<=": o => o <= 0, ">": o => o > 0, ">=": o => o >= 0,
};

const ARITHMETIC_BUILTINS: Readonly<Record<string, string>> = { "+": "Add", "-": "Subtract", "*": "Multiply" };

/** Whether a node calls a def by `name/arity`, outside any def of the same name inside it. */
function callsItself(node: JqNode, key: string): boolean {
  if (node.type === "call" && `${node.value.name}/${node.value.args.length}` === key) return true;
  if (node.type === "def" && `${node.value.name}/${node.value.params.length}` === key) return callsItself(node.value.rest, key);
  return jqChildren(node).some(child => child.node !== undefined && callsItself(child.node, key));
}

/**
 * Translates a checked jq program to East IR.
 *
 * @param checked - what {@link checkJq} made of the program; it must have no
 *   error
 * @param options - `maxOutputs` for a limit, `tooling` for the tooling-only
 *   builtins
 * @returns the translation: its inputs, its result type, and builders for the
 *   IR
 * @throws {TranslationError} When the program does not check, or holds
 *   something the translator cannot express.
 *
 * @remarks
 * Streams become loops that give each output to what consumes it, and the
 * program's result is its sink: the value for `one`, an `Option` for `maybe`,
 * an `Array` for `many`. Checked as an e3 root, each root field the program
 * reads is an input of its own, so a lazy dataset is read only where the
 * query reads it (`devdocs/QUERY.md` §15).
 *
 * @example
 * ```ts
 * const Order = StructType({ id: IntegerType, total: FloatType });
 * const checked = checkJq(".orders | map(.total) | add", StructType({ orders: ArrayType(Order) }), { root: true });
 * const translation = translateJq(checked);
 * translation.inputs;       // [{ name: "orders", type: ArrayType(Order) }]
 * translation.resultType;   // FloatType
 * const total = East.compile(translation.fn(), []);
 * total([{ id: 1n, total: 2.5 }, { id: 2n, total: 4.0 }]);   // 6.5
 * ```
 */
export function translateJq(checked: CheckJqResult, options: TranslateJqOptions = {}): JqTranslation {
  if (checked.query === null || checked.elementType === null || checked.multiplicity === null) {
    const errors = checked.diagnostics.filter(d => d.severity.type === "error").map(d => d.message);
    throw new TranslationError(`the program does not check: ${errors.join(" ")}`);
  }
  const query = checked.query.value;
  const element = checked.elementType;
  const multiplicity = checked.multiplicity;
  const inputType = fromEastTypeValue(query.input_type);
  const root = checked.source.root;
  const inputs: { name: string | null; type: EastType }[] = root
    ? checked.reads.map(name => ({ name, type: parts(unwrap(inputType)).fields[name]! }))
    : [{ name: null, type: inputType }];
  const resultType = multiplicity === "one" ? element : multiplicity === "maybe" ? OptionType(element) : ArrayType(element);
  const program = query.program;
  const into = ($: Block, values: readonly Expr[]): Expr => {
    const t = new Translator(checked, options);
    const x: Value = root ? { root: true, fields: new Map(inputs.map((input, i) => [input.name!, values[i]!])) } : values[0]!;
    const env: Env = { vars: new Map(), defs: new Map(), labels: new Map(), instance: "", recursion: new Map() };
    if (multiplicity === "one") return t.one(program, "", $, x, env, element);
    if (multiplicity === "maybe") {
      const out = t.declare($, t.none(resultType), "result");
      t.once($, ($2, label) => t.gen(program, "", $2, x, env, ($3, v) => {
        t.assign($3, out, t.some(t.widenTo($3, v, element, ""), resultType));
        t.brk($3, label);
      }), "");
      return out;
    }
    const out = t.declare($, t.emptyArray(element), "results");
    const limit = options.maxOutputs;
    if (limit === undefined) {
      t.gen(program, "", $, x, env, ($2, v) => t.push($2, out, v, ""));
      return out;
    }
    // One output past the limit is kept, so the caller can tell the result was cut short.
    t.once($, ($2, label) => t.gen(program, "", $2, x, env, ($3, v) => {
      t.push($3, out, v, "");
      t.ifElse($3, t.b("GreaterEqual", [IntegerType], [t.size(out, ""), t.int(limit + 1)], BooleanType, ""), $4 => t.brk($4, label), undefined, "");
    }), "");
    return out;
  };
  return {
    inputs,
    resultType,
    build: (...values: Expr[]): Expr => {
      const $ = BlockBuilder(NeverType);
      const result = into($, values);
      const statements = isTypeEqual($.type(), NeverType) ? $.statements : [...$.statements, (result as any)[AstSymbol] as AST];
      return fromAst({ ast_type: "Block", type: isTypeEqual($.type(), NeverType) ? NeverType : resultType, loc_id: UNKNOWN_LOC_ID, statements }) as Expr;
    },
    fn: () => func(inputs.map(i => i.type), resultType, ($: Block, ...values: Expr[]) => into($, values)) as unknown as FunctionExpr<any[], any>,
  };
}
