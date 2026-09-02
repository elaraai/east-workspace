/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The IR → TypeScript printer (#628): `toSource`.
 *
 * The printer walks an IR value and writes a module whose `East.function(...)`
 * rebuilds the same IR. Its spellings are the builder surface's — the `$`
 * a body receives and the expression methods — and the builtin table's
 * ({@link SPELLINGS}):
 *
 * - a Function / AsyncFunction is `East.function([types], out, ($, params)
 *   => { ... })`; nested functions are expressions of the enclosing body;
 * - a Block is that body's statements; the block's last node is `return
 *   <expr>;` when it is an expression, or the statement it is — except in
 *   a body whose type the builder infers from what the arrow returns (a
 *   callback, an `Expr.block`, an expression arm), where a last statement
 *   is `return $.assign(...)`: the `$.` forms evaluate to the statement
 *   they pushed, which the builder then does not push twice;
 * - Let / Assign / Return / Break / Continue / Error, and a Null-typed
 *   IfElse / Match / While / For / TryCatch, print as `$.const` / `$.let` /
 *   `$.assign` / `$.return` / `$.break` / `$.continue` / `$.error` /
 *   `$.if(...).elseIf(...).else(...)` / `$.match` / `$.while` / `$.for` /
 *   `$.try(...).catch(...).finally(...)`, whose bodies are `($, ...) => {
 *   ... }` arrows (every body takes the block first);
 * - every other node prints as an expression: literals as TypeScript
 *   literals (`1n`, `1.5`, `"s"`, `new Date(...)`, `new Uint8Array([...])`),
 *   Struct / Variant / NewArray / NewSet / NewDict / NewRef / NewVector /
 *   NewMatrix through `East.value(..., T)`, an expression IfElse / Match /
 *   TryCatch / Block through `.ifElse(...)` / `.match({...})` /
 *   `Expr.tryCatch(...)` / `Expr.block(...)`, a Builtin through its spelling
 *   row (callbacks as `($, ...) => ...` arrows) or the raw
 *   `East.builtin(name, [T...], [args], out)`, an As through `East.as`, a
 *   WrapRecursive through `East.wrapRecursive`.
 *
 * Variables keep their IR names when they are JavaScript identifiers (the
 * TypeScript `_N`s are); anything else is renamed `v_N`; `$` is reserved for
 * the block. Types are hoisted to module constants `_tN` (deduplicated
 * structurally), platform declarations to `_pN` (one per distinct
 * signature). Deep expression nesting is broken with `const _eN = <expr>`
 * temporaries, so any IR width or depth prints to parseable source.
 *
 * The contract, shared with the python printer (`east/codegen/printer.py`):
 * `build(print(IR)) ≡ IR` after normalization (`east-c ir normalize`) —
 * total or loud (every node kind prints or {@link Unprintable} names it),
 * idiomatic, deterministic.
 */

import { Expr } from "../expr/expr.js";
import type { EastTypeValue } from "../type_of_type.js";
import { spellingFor, type Spelling } from "./spellings.js";
import { TYPE_IMPORTS, objectKey, typeKey, typeSource } from "./types.js";

/** An IR node: a variant whose payload is the node's struct. */
type Node = { type: string, value: any };

/**
 * Thrown for an IR shape the TypeScript surface cannot spell.
 *
 * The message names the node kind (and builtin) and where it sits — a
 * statement in expression position, a jump to no loop, a `NewVector` of
 * expressions, a `finally` on an expression `TryCatch`, an unknown node
 * kind. Builtins without a spelling row print raw and are never unprintable.
 */
export class Unprintable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Unprintable";
  }
}

const STATEMENT_KINDS = new Set([
  "Let", "Assign", "Return", "Break", "Continue", "While", "ForArray", "ForSet", "ForDict",
]);
/** How a body's last node prints — see {@link Printer.bodyLines}. */
type BodyMode = "function" | "callback" | "null";
const MAX_DEPTH = 24;
/** The block parameter every statement-bearing body declares first. */
const BLOCK = "$";
const RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
  "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if",
  "import", "in", "instanceof", "new", "null", "return", "super", "switch", "this", "throw",
  "true", "try", "typeof", "var", "void", "while", "with", "yield", "let", "static",
  "implements", "interface", "package", "private", "protected", "public", "await", "async",
  "arguments", "eval", "East", "Expr", "variant", "ref", "matrix", "undefined", "NaN", "Infinity",
]);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isIdent(name: string): boolean {
  return IDENT.test(name) && !RESERVED.has(name) && !name.startsWith("__");
}

function isNullValue(node: Node): boolean {
  return node.type === "Value" && node.value.type.type === "Null";
}

function isNullType(t: EastTypeValue): boolean {
  return t.type === "Null" || t.type === "Never";
}

/** A TypeScript literal for an East scalar value (an IR `Value` payload). */
function literal(lit: { type: string, value: any }): string {
  switch (lit.type) {
    case "Null": return "null";
    case "Boolean": return lit.value ? "true" : "false";
    case "Integer": return `${lit.value}n`;
    case "Float": {
      const v = lit.value as number;
      if (Number.isNaN(v)) return "NaN";
      if (v === Infinity) return "Infinity";
      if (v === -Infinity) return "-Infinity";
      if (Object.is(v, -0)) return "-0";
      return String(v);
    }
    case "String": return JSON.stringify(lit.value);
    case "DateTime": return `new Date(${JSON.stringify((lit.value as Date).toISOString())})`;
    case "Blob": return `new Uint8Array([${Array.from(lit.value as Uint8Array).join(", ")}])`;
    default:
      throw new Unprintable(`literal of kind ${lit.type}`);
  }
}

/** Names in one TypeScript function: IR variable name → identifier. */
class Scope {
  readonly names = new Map<string, string>();
  readonly used: Set<string>;

  constructor(readonly parent: Scope | null) {
    this.used = parent ? new Set(parent.used) : new Set([BLOCK]);
  }

  lookup(irName: string): string | undefined {
    return this.names.get(irName) ?? this.parent?.lookup(irName);
  }
}

/** Whether a node prints as a statement (`$.xxx(...)` or a Let): a
 * statement kind, an Error, or a Null-typed branch / match / try. */
function isStatement(node: Node): boolean {
  return STATEMENT_KINDS.has(node.type) || node.type === "Error" || (
    (node.type === "IfElse" || node.type === "Match" || node.type === "TryCatch")
    && isNullType(node.value.type)
  );
}

/** Options for {@link toSource}. */
export interface ToSourceOptions {
  /** The module-level export bound to the rebuilt function (default `"main"`). */
  name?: string;
  /** The module specifier the printed module imports from (default `"@elaraai/east"`). */
  importFrom?: string;
}

class Printer {
  readonly types = new Map<string, [string, string]>();     // type key -> [const name, source]
  readonly platforms = new Map<string, string>();            // signature -> const name
  readonly platformDecls: string[] = [];
  readonly rawBuiltins = new Set<string>();
  helperCounter = 0;
  tempCounter = 0;

  constructor(readonly rootName: string) {}

  // ── module-level pieces ──────────────────────────────────────────────

  /** A type as source: a primitive name inline, anything else hoisted. */
  typeRef(t: EastTypeValue): string {
    const kind = t.type;
    if (kind === "Null" || kind === "Never" || kind === "Boolean" || kind === "Integer"
        || kind === "Float" || kind === "String" || kind === "DateTime" || kind === "Blob") {
      return typeSource(t);
    }
    const key = typeKey(t);
    const hit = this.types.get(key);
    if (hit === undefined) {
      const name = `_t${this.types.size}`;
      this.types.set(key, [name, typeSource(t)]);
      return name;
    }
    return hit[0];
  }

  platformRef(p: any): string {
    const inputs = (p.arguments as Node[]).map(a => typeKey(a.value.type));
    const tps = (p.type_parameters as EastTypeValue[]).map(t => typeKey(t));
    const sig = JSON.stringify([p.name, inputs, typeKey(p.type), !!p.async, !!p.optional, tps]);
    const hit = this.platforms.get(sig);
    if (hit !== undefined) return hit;
    const name = `_p${this.platforms.size}`;
    this.platforms.set(sig, name);
    const args = (p.arguments as Node[]).map(a => this.typeRef(a.value.type)).join(", ");
    const opt = p.optional ? ", { optional: true }" : "";
    if (tps.length > 0) {
      // A generic call: the concrete type arguments are all the node
      // records, so the declaration is spelled with placeholders for
      // them in order and the inputs/output as the call has them.
      const params = tps.map((_t, i) => JSON.stringify(`T${i}`)).join(", ");
      const decl = p.async ? "East.asyncGenericPlatform" : "East.genericPlatform";
      this.platformDecls.push(
        `const ${name} = ${decl}(${JSON.stringify(p.name)}, [${params}], [${args}], ${this.typeRef(p.type)}${opt});`);
    } else {
      const decl = p.async ? "East.asyncPlatform" : "East.platform";
      this.platformDecls.push(
        `const ${name} = ${decl}(${JSON.stringify(p.name)}, [${args}], ${this.typeRef(p.type)}${opt});`);
    }
    return name;
  }

  freshHelper(prefix: string): string {
    this.helperCounter += 1;
    return `_${prefix}${this.helperCounter}`;
  }

  // ── functions ────────────────────────────────────────────────────────

  /** Binds an IR Variable node in `scope` and returns its identifier. */
  bind(scope: Scope, variable: Node): string {
    const irName = variable.value.name as string;
    let name: string | null = isIdent(irName) ? irName : null;
    if (name === null || scope.used.has(name)) {
      let n = 0;
      while (scope.used.has(`v_${n}`)) n += 1;
      name = `v_${n}`;
    }
    scope.names.set(irName, name);
    scope.used.add(name);
    return name;
  }

  /**
   * The `East.function([types], out, ($, params) => { ... })` source of a
   * Function / AsyncFunction node; `consts` are hoisted Lets printed first
   * as the body's own bindings (a python artifact's captured constants).
   */
  functionExprSource(node: Node, scope: Scope, indent: string, consts: Node[] = []): string {
    const p = node.value;
    const fnType = p.type as EastTypeValue;
    const inner = new Scope(scope);
    const params = (p.parameters as Node[]).map(v => this.bind(inner, v));
    const bodyIndent = indent + "  ";
    const body: string[] = [];
    for (const let_ of consts) {
      if (let_.type !== "Let") throw new Unprintable(`${let_.type} before the root function`);
      body.push(...this.statementLines(let_, inner, bodyIndent));
    }
    body.push(...this.bodyLines(p.body, inner, bodyIndent, "function"));
    const ctor = node.type === "AsyncFunction" ? "East.asyncFunction" : "East.function";
    const f = fnType.value as { inputs: EastTypeValue[], output: EastTypeValue };
    const inputs = f.inputs.map(t => this.typeRef(t)).join(", ");
    const out = this.typeRef(f.output);
    const head = `${ctor}([${inputs}], ${out}, (${[BLOCK, ...params].join(", ")}) => {`;
    return [head, ...body, `${indent}})`].join("\n");
  }

  /**
   * The statements of a body (a Block, or one node), indented.
   *
   * `mode` says how the last node prints. `"function"` is an
   * `East.function` body with a declared output: a last expression is
   * `return`ed, a last statement stands. `"callback"` is a body whose
   * output the builder infers from what the arrow returns — a callback, an
   * `Expr.block`, an expression arm — so the last node is always returned:
   * an expression as itself, a statement as its `$.` form (which evaluates
   * to the statement already pushed, so the builder does not push it
   * twice). `"null"` is a branch, loop, case, try, catch or finally body:
   * the builder pads one whose last statement is not Null-typed with a
   * `Value null`, so that null is not printed — rebuilding restores it; a
   * `Value null` after a Null-typed statement is the body's own `return
   * null;` and prints as one; a body that is only a `Value null` prints
   * empty.
   */
  bodyLines(body: Node, scope: Scope, indent: string, mode: BodyMode): string[] {
    const nodes: Node[] = body.type === "Block" ? [...body.value.statements] : [body];
    if (mode === "null" && nodes.length > 1 && isNullValue(nodes[nodes.length - 1]!)
        && !isNullType(nodes[nodes.length - 2]!.value.type)) {
      nodes.pop();
    }
    if (mode === "null" && nodes.length === 1 && isNullValue(nodes[0]!)) {
      return [];
    }
    const lines: string[] = [];
    nodes.forEach((node, i) => {
      if (i < nodes.length - 1) {
        lines.push(...this.statementLines(node, scope, indent));
      } else if (mode === "null" && isNullValue(node)) {
        lines.push(`${indent}return null;`);
      } else if (mode === "callback" || (mode === "function" && !isStatement(node))) {
        lines.push(...this.returnLines(node, scope, indent));
      } else {
        lines.push(...this.statementLines(node, scope, indent));
      }
    });
    return lines;
  }

  /**
   * `return <expr>;` for an expression, `return $.xxx(...);` for a
   * statement. A `$.try(...).catch(...).finally(...)` chain returns nothing,
   * so a TryCatch with a finally body is bound first and the binding
   * returned; a Let has no value to return.
   */
  returnLines(node: Node, scope: Scope, indent: string): string[] {
    const pre: string[] = [];
    const out = (text: string): string[] => [...pre.map(l => indent + l), indent + text];
    if (node.type === "Let") throw new Unprintable("a Let as the last statement of a body whose value is returned");
    if (node.type === "TryCatch" && isNullType(node.value.type) && !isNullValue(node.value.finally_body)) {
      const name = this.freshHelper("s");
      pre.push(`const ${name} = ${this.tryStatement(node, scope, pre, indent, false)};`);
      pre.push(`${name}.finally(${this.bodyArg(node.value.finally_body, scope, [], indent)});`);
      return out(`return ${name};`);
    }
    const text = this.statementExpr(node, scope, pre, indent) ?? this.expr(node, scope, pre, indent);
    return out(`return ${text};`);
  }

  /**
   * A branch/loop/handler body as the argument of its statement:
   * `($, ...) => { ... }`, the block first; `label` binds the loop label
   * parameter.
   */
  bodyArg(body: Node, scope: Scope, params: Node[], indent: string, label: string | null = null): string {
    const inner = new Scope(scope);
    const names = [BLOCK, ...params.map(v => this.bind(inner, v))];
    if (label !== null) names.push(this.freshLabel(inner, label));
    const lines = this.bodyLines(body, inner, indent + "  ", "null");
    if (lines.length === 0) return `(${names.join(", ")}) => {}`;
    return [`(${names.join(", ")}) => {`, ...lines, `${indent}}`].join("\n");
  }

  freshLabel(scope: Scope, irLabel: string): string {
    let name = "label";
    let n = 0;
    while (scope.used.has(name)) {
      n += 1;
      name = `label_${n}`;
    }
    scope.names.set(`label:${irLabel}`, name);
    scope.used.add(name);
    return name;
  }

  labelRef(scope: Scope, irLabel: string): string {
    const hit = scope.lookup(`label:${irLabel}`);
    if (hit === undefined) throw new Unprintable(`jump to a label (${JSON.stringify(irLabel)}) no enclosing loop binds`);
    return hit;
  }

  // ── statements ───────────────────────────────────────────────────────

  /** A node in statement position: a Let binding, a `$.` form, or `$(expr)`. */
  statementLines(node: Node, scope: Scope, indent: string): string[] {
    const p = node.value;
    const pre: string[] = [];
    const out = (text: string): string[] => [...pre.map(l => indent + l), indent + text];
    if (node.type === "Let") {
      const varT = p.variable.value.type as EastTypeValue;
      let valueNode: Node = p.value;
      // A widening at the binding is the binding's declared type: `$.const(v, T)`.
      let typed = typeKey(varT) === typeKey(valueNode.value.type) ? "" : `, ${this.typeRef(varT)}`;
      if (valueNode.type === "As" && typeKey(valueNode.value.type) === typeKey(varT)) {
        valueNode = valueNode.value.value;
        typed = `, ${this.typeRef(varT)}`;
      }
      const value = this.expr(valueNode, scope, pre, indent);
      const name = this.bind(scope, p.variable);
      const ctor = p.variable.value.mutable ? `${BLOCK}.let` : `${BLOCK}.const`;
      return out(`const ${name} = ${ctor}(${value}${typed});`);
    }
    const text = this.statementExpr(node, scope, pre, indent);
    if (text !== null) return out(`${text};`);
    return out(`${BLOCK}(${this.expr(node, scope, pre, indent)});`);
  }

  /**
   * The `$.` form of a statement node (`$.assign(a, b)`, `$.if(...)...`),
   * or `null` for a node with none (an expression, a Let).
   */
  statementExpr(node: Node, scope: Scope, pre: string[], indent: string): string | null {
    const kind = node.type;
    const p = node.value;
    if (kind === "Assign") {
      const value = this.expr(p.value, scope, pre, indent);
      return `${BLOCK}.assign(${this.varRef(p.variable, scope)}, ${value})`;
    }
    if (kind === "Return") {
      return `${BLOCK}.return(${this.expr(p.value, scope, pre, indent)})`;
    }
    if (kind === "Break" || kind === "Continue") {
      const fn = kind === "Break" ? `${BLOCK}.break` : `${BLOCK}.continue`;
      return `${fn}(${this.labelRef(scope, p.label.name)})`;
    }
    if (kind === "Error") {
      return `${BLOCK}.error(${this.expr(p.message, scope, pre, indent)})`;
    }
    if (kind === "While") {
      const pred = this.expr(p.predicate, scope, pre, indent);
      const body = this.bodyArg(p.body, scope, [], indent, p.label.name);
      return `${BLOCK}.while(${pred}, ${body})`;
    }
    if (kind === "ForArray" || kind === "ForSet" || kind === "ForDict") {
      const src = kind === "ForArray" ? "array" : kind === "ForSet" ? "set" : "dict";
      const coll = this.expr(p[src], scope, pre, indent);
      const params = kind === "ForSet" ? [p.key] : [p.value, p.key];
      const body = this.bodyArg(p.body, scope, params, indent, p.label.name);
      return `${BLOCK}.for(${coll}, ${body})`;
    }
    if (kind === "IfElse" && isNullType(p.type)) return this.ifStatement(node, scope, pre, indent);
    if (kind === "Match" && isNullType(p.type)) return this.matchStatement(node, scope, pre, indent);
    if (kind === "TryCatch" && isNullType(p.type)) return this.tryStatement(node, scope, pre, indent);
    return null;
  }

  ifStatement(node: Node, scope: Scope, pre: string[], indent: string): string {
    const p = node.value;
    const parts: string[] = [];
    (p.ifs as { predicate: Node, body: Node }[]).forEach((branch, i) => {
      const pred = this.expr(branch.predicate, scope, pre, indent);
      const body = this.bodyArg(branch.body, scope, [], indent);
      parts.push(`${i === 0 ? `${BLOCK}.if` : ".elseIf"}(${pred}, ${body})`);
    });
    if (!isNullValue(p.else_body)) {
      parts.push(`.else(${this.bodyArg(p.else_body, scope, [], indent)})`);
    }
    return parts.join("");
  }

  matchStatement(node: Node, scope: Scope, pre: string[], indent: string): string {
    const p = node.value;
    const subject = this.expr(p.variant, scope, pre, indent);
    const arms: string[] = [];
    for (const c of p.cases as { case: string, variable: Node, body: Node }[]) {
      if (isNullValue(c.body)) continue;
      arms.push(`${objectKey(c.case)}: ${this.bodyArg(c.body, scope, [c.variable], indent + "  ")}`);
    }
    if (arms.length === 0) return `${BLOCK}.match(${subject}, {})`;
    return `${BLOCK}.match(${subject}, {\n${arms.map(a => `${indent}  ${a},`).join("\n")}\n${indent}})`;
  }

  /** `$.try(...).catch(...).finally(...)`; `withFinally: false` leaves the finally off. */
  tryStatement(node: Node, scope: Scope, pre: string[], indent: string, withFinally: boolean = true): string {
    const p = node.value;
    let text = `${BLOCK}.try(${this.bodyArg(p.try_body, scope, [], indent)})`;
    if (!isNullValue(p.catch_body)) {
      text += `.catch(${this.bodyArg(p.catch_body, scope, [p.message, p.stack], indent)})`;
    }
    if (withFinally && !isNullValue(p.finally_body)) {
      text += `.finally(${this.bodyArg(p.finally_body, scope, [], indent)})`;
    }
    return text;
  }

  // ── expressions ──────────────────────────────────────────────────────

  varRef(node: Node, scope: Scope): string {
    const hit = scope.lookup(node.value.name);
    if (hit === undefined) throw new Unprintable(`variable ${JSON.stringify(node.value.name)} is not bound`);
    return hit;
  }

  /**
   * The source of an expression node; helper declarations and temporaries
   * go to `pre` (statements to emit before the user, unindented).
   */
  expr(node: Node, scope: Scope, pre: string[], indent: string, depth: number = 0): string {
    if (depth > MAX_DEPTH) {
      const text = this.expr(node, scope, pre, indent, 0);
      this.tempCounter += 1;
      const name = `_e${this.tempCounter}`;
      pre.push(`const ${name} = ${text};`);
      return name;
    }
    const d = depth + 1;
    const kind = node.type;
    const p = node.value;
    switch (kind) {
      case "Value":
        return literal(p.value);
      case "Variable":
        return this.varRef(node, scope);
      case "Builtin":
        return this.builtinExpr(node, scope, pre, indent, d);
      case "Platform": {
        const args = (p.arguments as Node[]).map(a => this.expr(a, scope, pre, indent, d)).join(", ");
        const ref = this.platformRef(p);
        if ((p.type_parameters as EastTypeValue[]).length > 0) {
          const tps = (p.type_parameters as EastTypeValue[]).map(t => this.typeRef(t)).join(", ");
          return `${ref}([${tps}]${args ? ", " : ""}${args})`;
        }
        return `${ref}(${args})`;
      }
      case "Function":
      case "AsyncFunction":
        return this.functionExprSource(node, scope, indent);
      case "Call":
      case "CallAsync": {
        let fn = this.expr(p.function, scope, pre, indent, d);
        const args = (p.arguments as Node[]).map(a => this.expr(a, scope, pre, indent, d)).join(", ");
        const fk = (p.function as Node).type;
        if (fk !== "Variable" && fk !== "GetField" && fk !== "Call" && fk !== "CallAsync") fn = `(${fn})`;
        return `${fn}(${args})`;
      }
      case "GetField": {
        const base = this.expr(p.struct, scope, pre, indent, d);
        const name = p.field as string;
        return IDENT.test(name) && !name.startsWith("_") ? `${base}.${name}` : `${base}[${JSON.stringify(name)}]`;
      }
      case "Struct": {
        const fields = (p.fields as { name: string, value: Node }[])
          .map(f => `${objectKey(f.name)}: ${this.expr(f.value, scope, pre, indent, d)}`);
        return `East.value({ ${fields.join(", ")} }, ${this.typeRef(p.type)})`;
      }
      case "Variant": {
        const value = this.expr(p.value, scope, pre, indent, d);
        return `East.value(variant(${JSON.stringify(p.case)}, ${value}), ${this.typeRef(p.type)})`;
      }
      case "NewArray": {
        const values = (p.values as Node[]).map(v => this.expr(v, scope, pre, indent, d)).join(", ");
        return `East.value([${values}], ${this.typeRef(p.type)})`;
      }
      case "NewSet": {
        const values = (p.values as Node[]).map(v => this.expr(v, scope, pre, indent, d)).join(", ");
        return `East.value(new Set([${values}]), ${this.typeRef(p.type)})`;
      }
      case "NewDict": {
        const entries = (p.values as { key: Node, value: Node }[])
          .map(e => `[${this.expr(e.key, scope, pre, indent, d)}, ${this.expr(e.value, scope, pre, indent, d)}]`);
        return `East.value(new Map([${entries.join(", ")}]), ${this.typeRef(p.type)})`;
      }
      case "NewRef":
        return `East.value(ref(${this.expr(p.value, scope, pre, indent, d)}), ${this.typeRef(p.type)})`;
      case "NewVector": {
        const elem = (p.type as EastTypeValue).value as EastTypeValue;
        return `East.value(${this.typedArray(p.values, elem, "NewVector")}, ${this.typeRef(p.type)})`;
      }
      case "NewMatrix": {
        const elem = (p.type as EastTypeValue).value as EastTypeValue;
        const data = this.typedArray(p.values, elem, "NewMatrix");
        return `East.value(matrix(${data}, ${p.rows}, ${p.cols}), ${this.typeRef(p.type)})`;
      }
      case "As":
        return `East.as(${this.expr(p.value, scope, pre, indent, d)}, ${this.typeRef(p.type)})`;
      case "WrapRecursive":
        return `East.wrapRecursive(${this.expr(p.value, scope, pre, indent, d)}, ${this.typeRef(p.type)})`;
      case "UnwrapRecursive":
        return `${this.expr(p.value, scope, pre, indent, d)}.unwrap()`;
      case "Error":
        return `Expr.error(${this.expr(p.message, scope, pre, indent, d)})`;
      case "IfElse":
        return this.ifExpr(p.ifs as { predicate: Node, body: Node }[], p.else_body, scope, pre, indent, d);
      case "Match": {
        const subject = this.expr(p.variant, scope, pre, indent, d);
        const arms = (p.cases as { case: string, variable: Node, body: Node }[])
          .map(c => `${objectKey(c.case)}: ${this.callbackExpr(c.body, [c.variable], scope, pre, indent + "  ")}`);
        return `${subject}.match({\n${arms.map(a => `${indent}  ${a},`).join("\n")}\n${indent}})`;
      }
      case "TryCatch": {
        if (!isNullValue(p.finally_body)) {
          throw new Unprintable("a TryCatch with a finally body in expression position — TypeScript's Expr.tryCatch has no finally");
        }
        const body = this.armExpr(p.try_body, scope, pre, indent, d);
        const handler = this.callbackExpr(p.catch_body, [p.message, p.stack], scope, pre, indent);
        return `Expr.tryCatch(${body}, ${handler})`;
      }
      case "Block":
        return this.blockExpr(node, scope, indent);
      default:
        if (STATEMENT_KINDS.has(kind)) throw new Unprintable(`${kind} node in expression position`);
        throw new Unprintable(`unknown node kind ${kind}`);
    }
  }

  /** A literal-only NewVector / NewMatrix payload as its typed array. */
  typedArray(values: Node[], elem: EastTypeValue, what: string): string {
    const lits = values.map(v => {
      if (v.type !== "Value") throw new Unprintable(`a ${what} of expressions — TypeScript builds vectors from typed arrays of literals`);
      return v.value.value as { type: string, value: any };
    });
    if (elem.type === "Float") return `new Float64Array([${lits.map(l => literal(l)).join(", ")}])`;
    if (elem.type === "Integer") return `new BigInt64Array([${lits.map(l => literal(l)).join(", ")}])`;
    if (elem.type === "Boolean") return `new Uint8ClampedArray([${lits.map(l => (l.value ? "1" : "0")).join(", ")}])`;
    throw new Unprintable(`a ${what} of ${elem.type} elements`);
  }

  /** An expression that must be an Expr, not a bare literal (a method receiver). */
  tracedExpr(node: Node, scope: Scope, pre: string[], indent: string, depth: number): string {
    if (node.type === "Value") {
      const lit = node.value.value as { type: string, value: any };
      if (lit.type === "Null") return "East.value(null)";
      return `East.value(${literal(lit)})`;
    }
    return this.expr(node, scope, pre, indent, depth);
  }

  /** An `ifElse` chain: TypeScript spells one predicate per node, so a
   * multi-branch IfElse nests in the else arm. */
  ifExpr(ifs: { predicate: Node, body: Node }[], elseBody: Node, scope: Scope, pre: string[], indent: string, depth: number): string {
    const [first, ...rest] = ifs;
    const pred = this.tracedExpr(first!.predicate, scope, pre, indent, depth);
    const then = this.armCallback(first!.body, scope, pre, indent);
    const otherwise = rest.length === 0
      ? this.armCallback(elseBody, scope, pre, indent)
      : `(${BLOCK}) => ${this.ifExpr(rest, elseBody, scope, pre, indent, depth)}`;
    return `${pred}.ifElse(${then}, ${otherwise})`;
  }

  /** An if-arm body as the `($) => ...` callback `ifElse` takes. */
  armCallback(body: Node, scope: Scope, pre: string[], indent: string): string {
    return this.callbackExpr(body, [], scope, pre, indent);
  }

  /** An expression arm that must be an Expr: a Block as `Expr.block(...)`,
   * a literal through `East.value`. */
  armExpr(body: Node, scope: Scope, pre: string[], indent: string, depth: number): string {
    if (body.type === "Block") return this.blockExpr(body, scope, indent);
    return this.tracedExpr(body, scope, pre, indent, depth);
  }

  /** A Block in expression position: `Expr.block(($) => { ... })`. */
  blockExpr(body: Node, scope: Scope, indent: string): string {
    const inner = new Scope(scope);
    const lines = this.bodyLines(body, inner, indent + "  ", "callback");
    return [`Expr.block((${BLOCK}) => {`, ...lines, `${indent}})`].join("\n");
  }

  /**
   * A callback body, the block first: `($, params) => expr` when the body
   * is one expression (or one statement, as its `$.` form), else `($,
   * params) => { ...; return expr; }`. The parameters keep the builtin's
   * own order.
   */
  callbackExpr(body: Node, params: Node[], scope: Scope, pre: string[], indent: string): string {
    const inner = new Scope(scope);
    const names = [BLOCK, ...params.map(v => this.bind(inner, v))];
    void pre;
    const tryWithFinally = body.type === "TryCatch" && !isNullValue(body.value.finally_body);
    if (body.type !== "Block" && body.type !== "Let" && !tryWithFinally) {
      const sub: string[] = [];
      const text = this.statementExpr(body, inner, sub, indent + "  ") ?? this.expr(body, inner, sub, indent + "  ");
      if (sub.length === 0) return `(${names.join(", ")}) => ${text}`;
      return [`(${names.join(", ")}) => {`, ...sub.map(l => `${indent}  ${l}`), `${indent}  return ${text};`, `${indent}}`].join("\n");
    }
    const lines = this.bodyLines(body, inner, indent + "  ", "callback");
    return [`(${names.join(", ")}) => {`, ...lines, `${indent}}`].join("\n");
  }

  // ── builtins ─────────────────────────────────────────────────────────

  builtinExpr(node: Node, scope: Scope, pre: string[], indent: string, depth: number): string {
    const p = node.value;
    const name = p.builtin as string;
    const row = spellingFor(name);
    if (row !== undefined) {
      const rendered = this.renderRow(row, p, scope, pre, indent, depth);
      if (rendered !== null) return rendered;
    }
    return this.rawBuiltin(node, scope, pre, indent, depth);
  }

  renderRow(row: Spelling, p: any, scope: Scope, pre: string[], indent: string, depth: number): string | null {
    const args = p.arguments as Node[];
    const tps = p.type_parameters as EastTypeValue[];
    if (row.floatOnly && !(tps.length > 0 && tps[0]!.type === "Float")) return null;
    const callbacks = new Set(row.callbacks ?? []);
    const exprs = new Set(row.exprs ?? []);
    const texts: string[] = [];
    let regex: string | null = null;
    let csv: string | null = null;
    if (row.adapter === "regex") {
      // the pattern and flags are String literals: a RegExp literal
      const [pat, flags] = [args[1], args[2]];
      if (!pat || !flags || pat.type !== "Value" || flags.type !== "Value") return null;
      regex = `new RegExp(${literal(pat.value.value)}, ${literal(flags.value.value)})`;
    }
    if (row.adapter === "csv") {
      const config = args[args.length - 1]!;
      const opts = this.csvOptions(config);
      if (opts === null) return null;
      csv = opts;
    }
    args.forEach((arg, i) => {
      if (row.adapter === "regex" && (i === 1 || i === 2)) { texts.push(""); return; }
      if (row.adapter === "csv" && i === args.length - 1) { texts.push(""); return; }
      if (callbacks.has(i) && arg.type === "Function") {
        const fp = arg.value;
        texts.push(this.callbackExpr(fp.body, [...fp.parameters], scope, pre, indent));
        return;
      }
      // The first operand is always an Expr (a literal receiver has no
      // methods), as is every slot the row marks `exprs`.
      texts.push(i === 0 || exprs.has(i)
        ? this.tracedExpr(arg, scope, pre, indent, depth)
        : this.expr(arg, scope, pre, indent, depth));
    });
    // One pass over the template, so substituted text (a `\\d{4}` pattern,
    // a "{0}" string literal) is never itself read as a slot.
    let template = row.template;
    if (csv === "") template = template.replace(", {C}", "").replace("{C}", "");
    return template.replace(/\{(R|C|T\d+|\d+)\}/g, (_m, slot: string) => {
      if (slot === "R") return regex ?? "";
      if (slot === "C") return csv ?? "";
      if (slot.startsWith("T")) {
        const t = tps[Number(slot.slice(1))];
        if (t === undefined) throw new Unprintable(`${p.builtin}: type parameter ${slot.slice(1)} missing`);
        return this.typeRef(t);
      }
      const a = texts[Number(slot)];
      if (a === undefined) throw new Unprintable(`${p.builtin}: argument ${slot} missing`);
      return a;
    });
  }

  /**
   * A CSV config struct as the options object the surface takes, or `null`
   * when the config is not a literal: every `some` field becomes a key, a
   * `none` field is omitted, and an all-`none` config is the omitted argument.
   */
  csvOptions(config: Node): string | null {
    if (config.type !== "Struct") return null;
    const entries: string[] = [];
    for (const f of config.value.fields as { name: string, value: Node }[]) {
      const opt = f.value;
      if (opt.type !== "Variant") return null;
      if (opt.value.case === "none") continue;
      if (opt.value.case !== "some") return null;
      const js = this.jsLiteral(opt.value.value);
      if (js === null) return null;
      entries.push(`${objectKey(f.name)}: ${js}`);
    }
    return entries.length === 0 ? "" : `{ ${entries.join(", ")} }`;
  }

  /** A literal-only IR subtree as a JavaScript value, or `null`. */
  jsLiteral(node: Node): string | null {
    if (node.type === "Value") return literal(node.value.value);
    if (node.type === "NewArray") {
      const items = (node.value.values as Node[]).map(v => this.jsLiteral(v));
      return items.some(i => i === null) ? null : `[${items.join(", ")}]`;
    }
    if (node.type === "NewDict") {
      const items = (node.value.values as { key: Node, value: Node }[]).map(e => {
        const k = this.jsLiteral(e.key);
        const v = this.jsLiteral(e.value);
        return k === null || v === null ? null : `[${k}, ${v}]`;
      });
      return items.some(i => i === null) ? null : `new Map([${items.join(", ")}])`;
    }
    return null;
  }

  rawBuiltin(node: Node, scope: Scope, pre: string[], indent: string, depth: number): string {
    const p = node.value;
    this.rawBuiltins.add(p.builtin);
    const args = (p.arguments as Node[]).map((a, i) =>
      i === 0 ? this.tracedExpr(a, scope, pre, indent, depth) : this.expr(a, scope, pre, indent, depth)).join(", ");
    const tps = (p.type_parameters as EastTypeValue[]).map(t => this.typeRef(t)).join(", ");
    return `East.builtin(${JSON.stringify(p.builtin)}, [${tps}], [${args}], ${this.typeRef(p.type)})`;
  }

  // ── the module ───────────────────────────────────────────────────────

  module(ir: Node, importFrom: string): string {
    let root = ir;
    let consts: Node[] = [];
    if (root.type === "Block") {
      const stmts = [...root.value.statements] as Node[];
      consts = stmts.slice(0, -1);
      root = stmts[stmts.length - 1]!;
    }
    if (root.type !== "Function" && root.type !== "AsyncFunction") {
      throw new Unprintable(`the root must be a Function or AsyncFunction, got ${root.type}`);
    }
    // A python artifact's hoisted constants become the body's own consts.
    const fn = this.functionExprSource(root, new Scope(null), "", consts);
    const lines = [
      "// Generated by east-node transpile — East IR printed as the East.function",
      "// builder surface. Rebuilding this module yields the same IR (normalized).",
      `import { East, Expr, variant, ref, matrix, ${TYPE_IMPORTS.join(", ")} } from ${JSON.stringify(importFrom)};`,
      "",
    ];
    for (const [name, src] of this.types.values()) lines.push(`const ${name} = ${src};`);
    if (this.types.size > 0) lines.push("");
    lines.push(...this.platformDecls);
    if (this.platformDecls.length > 0) lines.push("");
    lines.push(`export const ${this.rootName} = ${fn};`);
    lines.push("");
    return lines.join("\n");
  }
}

/** The IR value behind a function expression, an `EastIR`, or an IR value. */
function irOf(fnOrIr: unknown): Node {
  if (fnOrIr instanceof Expr) {
    const toIR = (fnOrIr as any).toIR;
    if (typeof toIR !== "function") throw new TypeError("toSource takes a function expression, not a plain expression");
    return toIR.call(fnOrIr).ir as Node;
  }
  const v = fnOrIr as any;
  if (v !== null && typeof v === "object" && v.ir !== undefined && typeof v.ir.type === "string") {
    return v.ir as Node; // an EastIR / AsyncEastIR
  }
  if (v !== null && typeof v === "object" && typeof v.type === "string" && "value" in v) {
    return v as Node;
  }
  throw new TypeError("toSource takes an East.function result, an EastIR, or an IR value");
}

/**
 * Prints East IR as a TypeScript module that rebuilds it.
 *
 * @param fnOrIr - A built `East.function` / `East.asyncFunction` expression,
 *   its `toIR()` result, or a homoiconic IR value (a Function / AsyncFunction
 *   node, or the `Block[Let…, Function]` a python build with hoisted
 *   constants emits — its constants become the body's first `$.const`s)
 * @param options - The export name (default `main`) and the module the
 *   printed source imports from (default `@elaraai/east`)
 * @returns The module source: importing it binds `name` to an
 *   `East.function(...)` whose IR normalizes equal to the input's
 * @throws {Unprintable} For a shape the TypeScript surface cannot spell — a
 *   statement in expression position, a jump to no loop, a `NewVector` of
 *   expressions, a `finally` on an expression `TryCatch`. Builtins without a
 *   spelling print through `East.builtin(...)` and are never unprintable.
 *
 * @example
 * ```ts
 * const double = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
 * console.log(East.toSource(double));
 * // import { East, Expr, ... } from "@elaraai/east";
 * //
 * // export const main = East.function([IntegerType], IntegerType, ($, _0) => {
 * //   return _0.multiply(2n);
 * // });
 * ```
 */
export function toSource(fnOrIr: unknown, options: ToSourceOptions = {}): string {
  const printer = new Printer(options.name ?? "main");
  return printer.module(irOf(fnOrIr), options.importFrom ?? "@elaraai/east");
}
