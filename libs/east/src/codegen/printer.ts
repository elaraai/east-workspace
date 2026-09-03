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
 *   NewMatrix as the host literal — printed by `literalFor(T)`, a factory
 *   over the type (as `compareFor` is) under which a construction nested
 *   anywhere prints bare, an Option case as `some(v)` / `none` — bare
 *   wherever the surface types the position (a binding, `$.let(new
 *   Map([...]), T)`; a method's value slot, `xs.concat([1n, 2n])`; a call
 *   argument; a declared return) or the literal types itself (a callback
 *   returning `{ a: x }`), and through `East.value(..., T)` only where the
 *   type would otherwise be lost (a callback returning `none`, an empty
 *   collection or a general `variant`) — an expression IfElse / Match /
 *   TryCatch / Block through `.ifElse(...)` / `.match({...})` /
 *   `Expr.tryCatch(...)` / `Expr.block(...)`, the match `unwrap` lowers to
 *   as `.unwrap()` / `.unwrap("case")`, a Builtin through its spelling
 *   row (callbacks as `($, ...) => ...` arrows) or the raw
 *   `East.builtin(name, [T...], [args], out)`, an As through `East.as`, a
 *   WrapRecursive through `East.wrapRecursive`, an unresolved cross-language
 *   import (the `east.importFunction` Platform node) through
 *   `East.importFunction(pkg, name, T)`.
 *
 * Variables keep their IR names when they are JavaScript identifiers — the
 * authoring names both builders carry (#639) and TypeScript's `_N` for a
 * slot the body did not name; python's `__nN` and a name the scope already
 * uses are renamed `v_N`, numbered once per module (above any `v_N` the IR
 * holds) so a printed module rebuilds to itself; `$` is reserved for the
 * block. Every type prints inline where it is used (`$.let(new Map([...]),
 * DictType(IntegerType, StringType))`, as an author writes it); a recursive
 * type is hoisted to a module constant `_tN` (deduplicated structurally).
 * A platform call spells as the library that declares it spells it when the
 * library's module is given (`libraries`: `Compression.Tar.create(entries)`,
 * imported from the library) — found by walking the module's exports for
 * the declaration handle of that name — and otherwise hoists to a
 * module-level declaration named after the platform function
 * (`const tar_create = East.asyncPlatform("tar_create", …)`; a second
 * signature under one name takes a `_2` suffix), one per distinct
 * signature. A closure-free function called where it stands — an `East.function`
 * artifact the compiler inlined at its call, `(East.function(...))(x)` — is
 * hoisted to a module constant `_fN` (one per distinct function) and called
 * by name, as the source called it. Deep expression nesting is broken with
 * `const _eN = <expr>` temporaries, so any IR width or depth prints to
 * parseable source.
 *
 * The source is written as a layout document ({@link render}) and laid out
 * as prettier lays TypeScript out: a literal, an argument list or a type
 * breaks one entry per line when the line it sits on would pass
 * {@link LINE_WIDTH}, a call hugs a trailing callback (`xs.map(($, x) => {`
 * stays on its line, the body breaks inside), and a chain of three or more
 * calls that does not fit prints one call per line.
 *
 * The contract, shared with the python printer (`east/codegen/printer.py`):
 * `build(print(IR)) ≡ IR` after normalization (`east-c ir normalize`) —
 * total or loud (every node kind prints or {@link Unprintable} names it),
 * idiomatic, deterministic.
 */

import { Expr } from "../expr/expr.js";
import { isPlatformDeclaration, type PlatformDeclaration } from "../expr/block.js";
import { toEastTypeValue, type EastTypeValue } from "../type_of_type.js";
import type { EastType } from "../types.js";
import { IMPORT_PLATFORM } from "../functions.js";
import { spellingFor, type Spelling } from "./spellings.js";
import { TYPE_IMPORTS, isOptionValue, objectKey, typeConstructors, typeDoc, typeKey } from "./types.js";
import {
  type Doc, LINE_WIDTH, bracket, callArgs, choice, fn, group, hardline, hug, ifBreak, indent, isHuggable, join, line, render,
  softline, willBreak,
} from "./doc.js";

/** An IR node: a variant whose payload is the node's struct. */
type Node = { type: string, value: any };
/** Prints a node at a typed position: the host literal, or `null` when the node is not that construction. */
type Literal = (node: Node, scope: Scope, pre: Doc[], depth: number) => Doc | null;
/** Prints a node at a typed position: the host literal, else the node as an expression. */
type Printed = (node: Node, scope: Scope, pre: Doc[], depth: number) => Doc;
/** A member chain: the receiver and the `.name(args)` segments applied to it, in order. */
interface Chain { receiver: Doc, segments: Doc[] }

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
/** The node kinds a host literal spells. */
const CONSTRUCTIONS = new Set(["Struct", "Variant", "NewArray", "NewSet", "NewDict", "NewRef", "NewVector", "NewMatrix"]);
/** How a body's last node prints — see {@link Printer.bodyDocs}. */
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
/** A template slot: an argument, a type parameter, the RegExp or the CSV options. */
const SLOT = /\{(R|C|T\d+|\d+)\}/g;
/** A template head that is a method on a slot: `{0}.map`. */
const METHOD_HEAD = /^\{(\d+)\}\.([A-Za-z_]\w*)$/;

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

/** `($, x) =>` — an arrow's head. */
function arrowHead(names: string[]): string {
  return `(${names.join(", ")}) =>`;
}

/**
 * A concise arrow, `($, x) => body`: a group, so that when the arrow is
 * hugged onto a line the body does not fit, it breaks after the `=>` with
 * the body indented on the next line — and, as the expanded last argument
 * of a call, ends with a trailing comma and the call's close on its own
 * line — as prettier lays it out. A body that is a host literal hugs the
 * `=>` instead (`($, x) => ({` / `($, x) => [`) and breaks inside.
 */
function arrow(names: string[], body: Doc): Doc {
  const head = arrowHead(names);
  if (isHuggable(body)) return fn(group([head, " ", body]), group([head, " ", body]));
  return fn(group([head, indent([line, body])]), group([head, indent([line, body]), ifBreak(","), softline]));
}

/**
 * The arrow of a block body: `($, x) => { ...; }` (`($) => {}` when empty).
 * A group, so that its statements lay out in their own right when the
 * arrow is hugged onto a line that fits.
 */
function arrowBlock(names: string[], stmts: Doc[]): Doc {
  if (stmts.length === 0) return fn([arrowHead(names), " {}"]);
  return fn(group([arrowHead(names), " {", indent([hardline, join(hardline, stmts)]), hardline, "}"]));
}

/**
 * A spelling template split into its call shape — the head before the
 * argument list and the argument templates — or `null` when the template
 * is not `head(args)`.
 */
function parseCallTemplate(template: string): { head: string, args: string[] } | null {
  if (!template.endsWith(")")) return null;
  let depth = 0;
  for (let i = template.length - 1; i >= 0; i--) {
    const ch = template[i];
    if (ch === ")") depth += 1;
    else if (ch === "(") {
      depth -= 1;
      if (depth === 0) {
        const head = template.slice(0, i);
        return head === "" ? null : { head, args: splitArgs(template.slice(i + 1, -1)) };
      }
    }
  }
  return null;
}

/** The top-level comma-separated pieces of an argument-list template. */
function splitArgs(inner: string): string[] {
  if (inner.trim() === "") return [];
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(inner.slice(start).trim());
  return args;
}

/** `text` with every slot replaced by `slot(name)`; a lone slot is the slot's document itself. */
function fill(text: string, slot: (name: string) => Doc): Doc {
  const parts: Doc[] = [];
  let last = 0;
  for (const m of text.matchAll(SLOT)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(slot(m[1]!));
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0]! : parts;
}

/**
 * The variables a Function node refers to but does not bind: none, and the
 * function is closure-free — it can stand at module level. Names are unique
 * along a scope chain (both builders and the normalizer keep them so), so
 * one set of the names bound anywhere inside suffices.
 */
function freeVariables(fn: Node): Set<string> {
  const referenced = new Set<string>();
  const bound = new Set<string>();
  const nameOf = (v: Node): string => v.value.name as string;
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v === null || typeof v !== "object" || v instanceof Date || v instanceof Uint8Array) return;
    const node = v as { type?: unknown, value?: any };
    if (typeof node.type === "string" && node.value !== null && typeof node.value === "object") {
      const p = node.value;
      switch (node.type) {
        case "Variable": referenced.add(p.name as string); break;
        case "Function": case "AsyncFunction": for (const q of p.parameters as Node[]) bound.add(nameOf(q)); break;
        case "Let": bound.add(nameOf(p.variable)); break;
        case "ForArray": case "ForDict": bound.add(nameOf(p.value)); bound.add(nameOf(p.key)); break;
        case "ForSet": bound.add(nameOf(p.key)); break;
        case "Match": for (const c of p.cases as { variable: Node }[]) bound.add(nameOf(c.variable)); break;
        case "TryCatch": bound.add(nameOf(p.message)); bound.add(nameOf(p.stack)); break;
        default: break;
      }
    }
    // a type never holds a variable — and a type value has a `type` field of its own
    for (const [k, x] of Object.entries(v)) if (k !== "type" && k !== "type_parameters") walk(x);
  };
  walk(fn);
  return new Set([...referenced].filter(n => !bound.has(n)));
}

/**
 * The case an `unwrap` lowers to — a Match whose one arm returns its own
 * variable and whose every other arm errors `Variant does not have case
 * <that case>`; both surfaces lower `v.unwrap(name)` to exactly this — or
 * `null` for any other match.
 */
function unwrapCase(p: any): string | null {
  const cases = p.cases as { case: string, variable: Node, body: Node }[];
  const returned = cases.filter(c => c.body.type === "Variable" && c.body.value.name === c.variable.value.name);
  if (returned.length !== 1) return null;
  const name = returned[0]!.case;
  for (const c of cases) {
    if (c === returned[0]) continue;
    if (c.body.type !== "Error") return null;
    const message = c.body.value.message as Node;
    if (message.type !== "Value" || message.value.value.type !== "String") return null;
    if (message.value.value.value !== `Variant does not have case ${name}`) return null;
  }
  return name;
}

/**
 * Whether a construction determines its own East type when it stands bare
 * in a position whose type the builder infers (a callback's return): a
 * scalar or an expression, a struct of such, a non-empty array / set / map
 * of such. An empty collection, a variant (`some(x)` alone builds a
 * one-case variant, not an Option; `none` has no payload type), a ref, a
 * vector or a matrix need the type — those print through `East.value(v,
 * T)` there.
 */
function selfTyping(node: Node): boolean {
  const p = node.value;
  switch (node.type) {
    case "Struct": return (p.fields as { value: Node }[]).every(f => selfTyping(f.value));
    case "NewArray": case "NewSet": {
      const values = p.values as Node[];
      return values.length > 0 && values.every(selfTyping);
    }
    case "NewDict": {
      const entries = p.values as { key: Node, value: Node }[];
      return entries.length > 0 && entries.every(e => selfTyping(e.key) && selfTyping(e.value));
    }
    case "Variant": case "NewRef": case "NewVector": case "NewMatrix": case "Function": case "AsyncFunction": case "Error": return false;
    default: return true;   // a literal or an expression carries its type
  }
}

/** A structural key for a Function node: two inlined copies of one artifact print once. */
function functionKey(fn: Node): string {
  return JSON.stringify(fn, (_k, v) =>
    typeof v === "bigint" ? `${v}n` : v instanceof Date ? v.toISOString() : v instanceof Uint8Array ? Array.from(v) : v);
}

/**
 * A member chain's document: the receiver and its segments on one line
 * when they fit, else — for three or more calls not rooted at the block —
 * one call per line, indented under the receiver; a chain holding a block
 * body always expands.
 */
function chainDoc({ receiver, segments }: Chain): Doc {
  if (segments.length < 3 || receiver === BLOCK) return [receiver, ...segments];
  const oneLine: Doc = [receiver, ...segments];
  const expanded = group([receiver, indent(segments.map(s => [hardline, s]))]);
  return segments.some(willBreak) ? expanded : choice(oneLine, expanded);
}

/** Options for {@link toSource}. */
export interface ToSourceOptions {
  /** The module-level export bound to the rebuilt function (default `"main"`). */
  name?: string;
  /** The module specifier the printed module imports from (default `"@elaraai/east"`). */
  importFrom?: string;
  /** The line width the layout keeps to (default {@link LINE_WIDTH}); `Infinity` prints every construct on one line. */
  width?: number;
  /**
   * The library modules the program uses, by the specifier the printed
   * module should import them from: `{ "@elaraai/east-node-io": await
   * import("@elaraai/east-node-io") }`. A platform call whose declaration
   * handle a module exports prints as that export — `Compression.Tar.create(
   * entries)` with `import { Compression } from "@elaraai/east-node-io"` —
   * rather than as a hoisted declaration; the library's own structure is the
   * spelling, read from its exports.
   */
  libraries?: Record<string, object>;
}

/** A platform call's spelling from a library: the import root and the member path to the handle. */
interface LibrarySpelling {
  specifier: string;
  path: string[];
  declaration: PlatformDeclaration;
}

/** How deep into a module's exported objects a declaration is looked for. */
const LIBRARY_DEPTH = 4;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Every platform declaration the library modules export, by platform name,
 * each with the path the module exports it under. A declaration exported
 * under several names keeps the grouped one (`Compression.Tar.create` over
 * the flat `tar_create` — the documented surface), the shortest of those,
 * the first found among equals.
 */
function librarySpellings(libraries: Record<string, object>): Map<string, LibrarySpelling> {
  const found = new Map<string, LibrarySpelling>();
  const better = (a: LibrarySpelling, b: LibrarySpelling): boolean => {
    const groupedA = a.path[a.path.length - 1] !== a.declaration.name;
    const groupedB = b.path[b.path.length - 1] !== b.declaration.name;
    if (groupedA !== groupedB) return groupedA;
    return a.path.length < b.path.length;
  };
  for (const [specifier, mod] of Object.entries(libraries)) {
    const seen = new Set<object>();
    const stack: Array<[object, string[]]> = [[mod, []]];
    while (stack.length > 0) {
      const [obj, path] = stack.pop()!;
      if (seen.has(obj)) continue;
      seen.add(obj);
      for (const key of Object.keys(obj).sort()) {
        if (!isIdent(key)) continue;
        const value = (obj as Record<string, unknown>)[key];
        const at = [...path, key];
        if (isPlatformDeclaration(value)) {
          const candidate: LibrarySpelling = { specifier, path: at, declaration: value };
          const prior = found.get(value.name);
          if (prior === undefined || better(candidate, prior)) found.set(value.name, candidate);
        } else if (at.length < LIBRARY_DEPTH && isPlainObject(value)) {
          stack.push([value, at]);
        }
      }
    }
  }
  return found;
}

const NEVER_A_DECLARATION_NAME = new Set(["some", "none", ...TYPE_IMPORTS]);

class Printer {
  readonly types = new Map<string, [string, Doc]>();        // type key -> [const name, source]
  /** Type value -> its host-literal printer. Keyed by the type object, not its source: a recursive wrapper's inner type has refs that only print inside the wrapper. */
  readonly literals = new WeakMap<object, Literal>();
  /** The names the printed module imports from `@elaraai/east` — exactly the ones it uses. */
  readonly used = new Set<string>(["East"]);
  readonly platforms = new Map<string, string>();            // signature -> const name
  readonly platformDecls: Doc[] = [];
  /** The declaration names taken, and the module-level names a body variable must not shadow (declarations, library import roots). */
  readonly platformNames = new Set<string>();
  readonly reserved = new Set<string>();
  /** Library specifier -> the import roots the module uses from it. */
  readonly libraryImports = new Map<string, Set<string>>();
  /** Closure-free functions called where they stand: structural key -> `_fN`, and their declarations. */
  readonly hoisted = new Map<string, string>();
  readonly hoistedDecls: Doc[] = [];
  readonly rawBuiltins = new Set<string>();
  /** Method-call documents -> the chain they end. */
  readonly chains = new WeakMap<object, Chain>();
  helperCounter = 0;
  tempCounter = 0;
  varCounter = 0;

  constructor(readonly rootName: string, readonly width: number, readonly spellings: Map<string, LibrarySpelling>) {}

  // ── module-level pieces ──────────────────────────────────────────────

  /** A type as source, inline; a recursive type hoisted to a `_tN` constant. */
  typeRef(t: EastTypeValue): Doc {
    typeConstructors(t, this.used);
    const key = typeKey(t);
    if (!key.includes("RecursiveType(")) return typeDoc(t);
    const hit = this.types.get(key);
    if (hit === undefined) {
      const name = `_t${this.types.size}`;
      this.types.set(key, [name, typeDoc(t)]);
      return name;
    }
    return hit[0];
  }

  /**
   * The library's spelling of a platform call, or `null` when no given
   * library exports a declaration of that name with the call's signature
   * (asyncness, arity and types, or type parameter count when generic).
   */
  platformSpelling(p: any): LibrarySpelling | null {
    const hit = this.spellings.get(p.name as string);
    if (hit === undefined) return null;
    const decl = hit.declaration;
    if (decl.async !== !!p.async) return null;
    const tps = p.type_parameters as EastTypeValue[];
    if (decl.typeParameters !== undefined) return decl.typeParameters.length === tps.length ? hit : null;
    if (tps.length > 0) return null;
    const args = p.arguments as Node[];
    if (decl.inputs.length !== args.length) return null;
    const same = (t: EastType | string, key: string): boolean => typeof t !== "string" && typeKey(toEastTypeValue(t)) === key;
    if (!decl.inputs.every((t, i) => same(t, typeKey(args[i]!.value.type)))) return null;
    return same(decl.output, typeKey(p.type)) ? hit : null;
  }

  /** A library spelling in use: its import root is recorded, and the member path returned. */
  useSpelling(spelling: LibrarySpelling): string {
    let roots = this.libraryImports.get(spelling.specifier);
    if (roots === undefined) {
      roots = new Set();
      this.libraryImports.set(spelling.specifier, roots);
    }
    roots.add(spelling.path[0]!);
    return spelling.path.join(".");
  }

  /** The signature a hoisted declaration is deduplicated by. */
  platformSignature(p: any): string {
    const inputs = (p.arguments as Node[]).map(a => typeKey(a.value.type));
    const tps = (p.type_parameters as EastTypeValue[]).map(t => typeKey(t));
    return JSON.stringify([p.name, inputs, typeKey(p.type), !!p.async, !!p.optional, tps]);
  }

  /**
   * The module-level name of a hoisted declaration: the platform function's
   * own name as an identifier (`tar_create`; `my.log` is `my_log`), a `_2`,
   * `_3`… suffix when another signature already took it, `_pN` when the name
   * cannot be an identifier.
   */
  platformName(irName: string): string {
    let base = irName.replace(/[^A-Za-z0-9_$]/g, "_");
    if (!/^[A-Za-z_$]/.test(base)) base = `_${base}`;
    if (!isIdent(base) || NEVER_A_DECLARATION_NAME.has(base)) base = `_p${this.platformNames.size}`;
    let name = base;
    for (let n = 2; this.platformNames.has(name); n++) name = `${base}_${n}`;
    this.platformNames.add(name);
    return name;
  }

  /**
   * Fixes the module-level names before any body prints, so a variable a
   * body binds never shadows them: every hoisted declaration's name (by
   * signature, in IR order) and the import root of every library spelling.
   */
  prepare(ir: Node): void {
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { for (const x of v) walk(x); return; }
      if (v === null || typeof v !== "object" || v instanceof Date || v instanceof Uint8Array) return;
      const node = v as { type?: unknown, value?: any };
      if (node.type === "Platform" && node.value !== null && typeof node.value === "object") {
        const p = node.value;
        const args = p.arguments as Node[];
        const isImport = p.name === IMPORT_PLATFORM && args.length === 2 && args.every(a => a.type === "Value");
        if (!isImport) {
          const spelled = this.platformSpelling(p);
          if (spelled !== null) {
            this.reserved.add(spelled.path[0]!);
          } else {
            const sig = this.platformSignature(p);
            if (!this.platforms.has(sig)) {
              const name = this.platformName(p.name as string);
              this.platforms.set(sig, name);
              this.reserved.add(name);
            }
          }
        }
      }
      for (const [k, x] of Object.entries(v)) if (k !== "type" && k !== "type_parameters") walk(x);
    };
    walk(ir);
  }

  platformRef(p: any): string {
    const sig = this.platformSignature(p);
    const name = this.platforms.get(sig) ?? this.platformName(p.name as string);
    this.platforms.set(sig, name);
    if (this.platformDecls.some(d => Array.isArray(d) && d[1] === name)) return name;
    const tps = p.type_parameters as EastTypeValue[];
    const args = bracket("[", (p.arguments as Node[]).map(a => this.typeRef(a.value.type)), "]");
    const opt: Doc[] = p.optional ? ["{ optional: true }"] : [];
    if (tps.length > 0) {
      // A generic call: the concrete type arguments are all the node
      // records, so the declaration is spelled with placeholders for
      // them in order and the inputs/output as the call has them.
      const params = bracket("[", tps.map((_t, i) => JSON.stringify(`T${i}`)), "]");
      const decl = p.async ? "East.asyncGenericPlatform" : "East.genericPlatform";
      this.platformDecls.push([
        "const ", name, " = ", decl, callArgs([JSON.stringify(p.name), params, args, this.typeRef(p.type), ...opt]), ";",
      ]);
    } else {
      const decl = p.async ? "East.asyncPlatform" : "East.platform";
      this.platformDecls.push([
        "const ", name, " = ", decl, callArgs([JSON.stringify(p.name), args, this.typeRef(p.type), ...opt]), ";",
      ]);
    }
    return name;
  }

  freshHelper(prefix: string): string {
    this.helperCounter += 1;
    return `_${prefix}${this.helperCounter}`;
  }

  /**
   * A closure-free Function node as a module constant `_fN`: its
   * declaration is emitted after any it hoists itself (a constant is built
   * where it is declared), once per distinct function.
   */
  hoistFunction(node: Node): string {
    const key = functionKey(node);
    const hit = this.hoisted.get(key);
    if (hit !== undefined) return hit;
    const name = this.freshHelper("f");
    this.hoisted.set(key, name);
    const doc = this.functionExpr(node, new Scope(null));
    this.hoistedDecls.push(["const ", name, " = ", doc, ";"]);
    return name;
  }

  /**
   * `receiver.name(args)`: a segment of the member chain `receiver` ends
   * (when it is one) or starts, laid out by {@link chainDoc}.
   */
  methodCall(receiver: Doc, name: string, args: Doc[]): Doc {
    const segment: Doc = [".", name, callArgs(args)];
    const prior = typeof receiver === "string" ? undefined : this.chains.get(receiver);
    const chain: Chain = prior
      ? { receiver: prior.receiver, segments: [...prior.segments, segment] }
      : { receiver, segments: [segment] };
    const doc = chainDoc(chain);
    this.chains.set(doc as object, chain);
    return doc;
  }

  // ── functions ────────────────────────────────────────────────────────

  /** Binds an IR Variable node in `scope` and returns its identifier. */
  bind(scope: Scope, variable: Node): string {
    const irName = variable.value.name as string;
    let name: string | null = isIdent(irName) ? irName : null;
    if (name === null || scope.used.has(name) || this.reserved.has(name)) {
      // The other builder's own spelling, or a name this scope already
      // uses: `v_N` from one module-wide counter, so the rebuilt module
      // names the slot the same way and prints to itself.
      name = `v_${this.varCounter}`;
      this.varCounter += 1;
    }
    scope.names.set(irName, name);
    scope.used.add(name);
    return name;
  }

  /**
   * The `East.function([types], out, ($, params) => { ... })` document of a
   * Function / AsyncFunction node; `consts` are hoisted Lets printed first
   * as the body's own bindings (a python artifact's captured constants).
   */
  functionExpr(node: Node, scope: Scope, consts: Node[] = []): Doc {
    const p = node.value;
    const fnType = p.type as EastTypeValue;
    const inner = new Scope(scope);
    const params = (p.parameters as Node[]).map(v => this.bind(inner, v));
    const ctor = node.type === "AsyncFunction" ? "East.asyncFunction" : "East.function";
    const f = fnType.value as { inputs: EastTypeValue[], output: EastTypeValue };
    const inputs = bracket("[", f.inputs.map(t => this.typeRef(t)), "]");
    const out = this.typeRef(f.output);
    const names = [BLOCK, ...params];
    // A body that is one expression is a concise arrow, as a callback is
    // and as the source writes it: `($, x) => x.multiply(2n)`; the declared
    // output types what it returns, so a construction prints bare.
    if (consts.length === 0 && (p.body as Node).type !== "Block" && !isStatement(p.body)) {
      const sub: Doc[] = [];
      const text = this.conciseBody(p.body, inner, sub, true);
      if (sub.length === 0) return [ctor, callArgs([inputs, out, arrow(names, text)])];
    }
    const stmts: Doc[] = [];
    for (const let_ of consts) {
      if (let_.type !== "Let") throw new Unprintable(`${let_.type} before the root function`);
      stmts.push(...this.statementDocs(let_, inner));
    }
    stmts.push(...this.bodyDocs(p.body, inner, "function"));
    return [ctor, callArgs([inputs, out, arrowBlock(names, stmts)])];
  }

  /**
   * The statements of a body (a Block, or one node), one document each.
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
  bodyDocs(body: Node, scope: Scope, mode: BodyMode): Doc[] {
    const nodes: Node[] = body.type === "Block" ? [...body.value.statements] : [body];
    if (mode === "null" && nodes.length > 1 && isNullValue(nodes[nodes.length - 1]!)
        && !isNullType(nodes[nodes.length - 2]!.value.type)) {
      nodes.pop();
    }
    if (mode === "null" && nodes.length === 1 && isNullValue(nodes[0]!)) {
      return [];
    }
    const docs: Doc[] = [];
    nodes.forEach((node, i) => {
      if (i < nodes.length - 1) {
        docs.push(...this.statementDocs(node, scope));
      } else if (mode === "null" && isNullValue(node)) {
        docs.push("return null;");
      } else if (mode === "callback" || (mode === "function" && !isStatement(node))) {
        docs.push(...this.returnDocs(node, scope, mode === "function"));
      } else {
        docs.push(...this.statementDocs(node, scope));
      }
    });
    return docs;
  }

  /**
   * `return <expr>;` for an expression, `return $.xxx(...);` for a
   * statement. A `$.try(...).catch(...).finally(...)` chain returns nothing,
   * so a TryCatch with a finally body is bound first and the binding
   * returned; a Let has no value to return. `typed` says the body's output
   * is declared (an `East.function`), so a returned construction prints
   * bare; a callback's is inferred from what it returns.
   */
  returnDocs(node: Node, scope: Scope, typed: boolean): Doc[] {
    const pre: Doc[] = [];
    if (node.type === "Let") throw new Unprintable("a Let as the last statement of a body whose value is returned");
    if (node.type === "TryCatch" && isNullType(node.value.type) && !isNullValue(node.value.finally_body)) {
      const name = this.freshHelper("s");
      const tried = this.tryStatement(node, scope, pre, false);
      pre.push(["const ", name, " = ", tried, ";"]);
      pre.push([name, ".finally", callArgs([this.bodyArg(node.value.finally_body, scope, [])]), ";"]);
      return [...pre, `return ${name};`];
    }
    const text = this.statementExpr(node, scope, pre) ?? this.valueDoc(node, scope, pre, 0, typed);
    return [...pre, ["return ", text, ";"]];
  }

  /**
   * A branch/loop/handler body as the argument of its statement:
   * `($, ...) => { ... }`, the block first; `label` binds the loop label
   * parameter.
   */
  bodyArg(body: Node, scope: Scope, params: Node[], label: string | null = null): Doc {
    const inner = new Scope(scope);
    const names = [BLOCK, ...params.map(v => this.bind(inner, v))];
    if (label !== null) names.push(this.freshLabel(inner, label));
    return arrowBlock(names, this.bodyDocs(body, inner, "null"));
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

  /** A node in statement position: a Let binding, a `$.` form, or `$(expr)` — its helpers first. */
  statementDocs(node: Node, scope: Scope): Doc[] {
    const p = node.value;
    const pre: Doc[] = [];
    if (node.type === "Let") {
      const varT = p.variable.value.type as EastTypeValue;
      let valueNode: Node = p.value;
      // A widening at the binding is the binding's declared type: `$.const(v, T)`.
      let typed: Doc | null = typeKey(varT) === typeKey(valueNode.value.type) ? null : this.typeRef(varT);
      if (valueNode.type === "As" && typeKey(valueNode.value.type) === typeKey(varT)) {
        valueNode = valueNode.value.value;
        typed = this.typeRef(varT);
      }
      // A bound construction is the host literal with the type on the binding
      // (`$.let(new Map([...]), T)`): an `East.value(..., T)` wrapper there is
      // the redundancy the surface's own diagnostics flag. A scalar literal
      // needs no type (`$.let(0n)`), so it stays on the expression path.
      const literal = typed === null && valueNode.type !== "Value" ? this.literalFor(varT)(valueNode, scope, pre, 0) : null;
      if (literal !== null) typed = this.typeRef(varT);
      const value = literal ?? this.expr(valueNode, scope, pre);
      const name = this.bind(scope, p.variable);
      const ctor = p.variable.value.mutable ? `${BLOCK}.let` : `${BLOCK}.const`;
      return [...pre, ["const ", name, " = ", ctor, callArgs(typed === null ? [value] : [value, typed]), ";"]];
    }
    const text = this.statementExpr(node, scope, pre);
    if (text !== null) return [...pre, [text, ";"]];
    return [...pre, [BLOCK, callArgs([this.expr(node, scope, pre)]), ";"]];
  }

  /**
   * The `$.` form of a statement node (`$.assign(a, b)`, `$.if(...)...`),
   * or `null` for a node with none (an expression, a Let).
   */
  statementExpr(node: Node, scope: Scope, pre: Doc[]): Doc | null {
    const kind = node.type;
    const p = node.value;
    if (kind === "Assign") {
      // the variable types the value, as the block's declared output types a `$.return`
      const value = this.valueDoc(p.value, scope, pre, 0, true);
      return this.methodCall(BLOCK, "assign", [this.varRef(p.variable, scope), value]);
    }
    if (kind === "Return") {
      return this.methodCall(BLOCK, "return", [this.valueDoc(p.value, scope, pre, 0, true)]);
    }
    if (kind === "Break" || kind === "Continue") {
      return this.methodCall(BLOCK, kind === "Break" ? "break" : "continue", [this.labelRef(scope, p.label.name)]);
    }
    if (kind === "Error") {
      return this.methodCall(BLOCK, "error", [this.expr(p.message, scope, pre)]);
    }
    if (kind === "While") {
      const pred = this.expr(p.predicate, scope, pre);
      const body = this.bodyArg(p.body, scope, [], p.label.name);
      return this.methodCall(BLOCK, "while", [pred, body]);
    }
    if (kind === "ForArray" || kind === "ForSet" || kind === "ForDict") {
      const src = kind === "ForArray" ? "array" : kind === "ForSet" ? "set" : "dict";
      const coll = this.expr(p[src], scope, pre);
      const params = kind === "ForSet" ? [p.key] : [p.value, p.key];
      const body = this.bodyArg(p.body, scope, params, p.label.name);
      return this.methodCall(BLOCK, "for", [coll, body]);
    }
    if (kind === "IfElse" && isNullType(p.type)) return this.ifStatement(node, scope, pre);
    if (kind === "Match" && isNullType(p.type)) return this.matchStatement(node, scope, pre);
    if (kind === "TryCatch" && isNullType(p.type)) return this.tryStatement(node, scope, pre);
    return null;
  }

  ifStatement(node: Node, scope: Scope, pre: Doc[]): Doc {
    const p = node.value;
    let doc: Doc = BLOCK;
    (p.ifs as { predicate: Node, body: Node }[]).forEach((branch, i) => {
      const pred = this.expr(branch.predicate, scope, pre);
      const body = this.bodyArg(branch.body, scope, []);
      doc = this.methodCall(doc, i === 0 ? "if" : "elseIf", [pred, body]);
    });
    if (!isNullValue(p.else_body)) {
      doc = this.methodCall(doc, "else", [this.bodyArg(p.else_body, scope, [])]);
    }
    return doc;
  }

  matchStatement(node: Node, scope: Scope, pre: Doc[]): Doc {
    const p = node.value;
    const subject = this.expr(p.variant, scope, pre);
    const arms: Doc[] = [];
    for (const c of p.cases as { case: string, variable: Node, body: Node }[]) {
      if (isNullValue(c.body)) continue;
      arms.push([objectKey(c.case), ": ", this.bodyArg(c.body, scope, [c.variable])]);
    }
    return this.methodCall(BLOCK, "match", [subject, hug(bracket("{", arms, "}", " "))]);
  }

  /** `$.try(...).catch(...).finally(...)`; `withFinally: false` leaves the finally off. */
  tryStatement(node: Node, scope: Scope, pre: Doc[], withFinally: boolean = true): Doc {
    void pre;
    const p = node.value;
    let doc = this.methodCall(BLOCK, "try", [this.bodyArg(p.try_body, scope, [])]);
    if (!isNullValue(p.catch_body)) {
      doc = this.methodCall(doc, "catch", [this.bodyArg(p.catch_body, scope, [p.message, p.stack])]);
    }
    if (withFinally && !isNullValue(p.finally_body)) {
      doc = this.methodCall(doc, "finally", [this.bodyArg(p.finally_body, scope, [])]);
    }
    return doc;
  }

  // ── expressions ──────────────────────────────────────────────────────

  varRef(node: Node, scope: Scope): string {
    const hit = scope.lookup(node.value.name);
    if (hit === undefined) throw new Unprintable(`variable ${JSON.stringify(node.value.name)} is not bound`);
    return hit;
  }

  /**
   * The document of an expression node; helper declarations and
   * temporaries go to `pre` (statements to emit before the user).
   */
  expr(node: Node, scope: Scope, pre: Doc[], depth: number = 0): Doc {
    if (depth > MAX_DEPTH) {
      const text = this.expr(node, scope, pre, 0);
      this.tempCounter += 1;
      const name = `_e${this.tempCounter}`;
      pre.push(["const ", name, " = ", text, ";"]);
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
        return this.builtinExpr(node, scope, pre, d);
      case "Platform": {
        const argNodes = p.arguments as Node[];
        if (p.name === IMPORT_PLATFORM && argNodes.length === 2 && argNodes.every(a => a.type === "Value")) {
          // an unresolved cross-language import: its own spelling, not a platform declaration
          const [pkg, name] = argNodes.map(a => literal(a.value.value));
          return ["East.importFunction", callArgs([pkg!, name!, this.typeRef(p.type)])];
        }
        const args = argNodes.map(a => this.valueDoc(a, scope, pre, d, true));
        const spelled = this.platformSpelling(p);
        const ref = spelled !== null ? this.useSpelling(spelled) : this.platformRef(p);
        if ((p.type_parameters as EastTypeValue[]).length > 0) {
          const tps = bracket("[", (p.type_parameters as EastTypeValue[]).map(t => this.typeRef(t)), "]");
          return [ref, callArgs([tps, ...args])];
        }
        return [ref, callArgs(args)];
      }
      case "Function":
      case "AsyncFunction":
        return this.functionExpr(node, scope);
      case "Call":
      case "CallAsync": {
        const head = p.function as Node;
        // the callee's declared inputs type its arguments
        const args = (p.arguments as Node[]).map(a => this.valueDoc(a, scope, pre, d, true));
        if ((head.type === "Function" || head.type === "AsyncFunction") && freeVariables(head).size === 0) {
          // an artifact inlined at its call: hoisted, and called by name as the source called it
          return [this.hoistFunction(head), callArgs(args)];
        }
        let callee = this.expr(head, scope, pre, d);
        // a callee that already prints as a call, a member or a name needs no parentheses
        const fk = (p.function as Node).type;
        if (!["Variable", "GetField", "Call", "CallAsync", "Builtin", "Platform"].includes(fk)) callee = ["(", callee, ")"];
        return [callee, callArgs(args)];
      }
      case "GetField": {
        const base = this.expr(p.struct, scope, pre, d);
        const name = p.field as string;
        return IDENT.test(name) && !name.startsWith("_") ? [base, ".", name] : [base, "[", JSON.stringify(name), "]"];
      }
      case "Struct":
      case "Variant":
      case "NewArray":
      case "NewSet":
      case "NewDict":
      case "NewRef":
      case "NewVector":
      case "NewMatrix":
        return ["East.value", callArgs([this.literalFor(p.type as EastTypeValue)(node, scope, pre, depth)!, this.typeRef(p.type)])];
      case "As":
        return ["East.as", callArgs([this.expr(p.value, scope, pre, d), this.typeRef(p.type)])];
      case "WrapRecursive": {
        // the wrapper's inner type governs the wrapped value: a construction prints bare
        const payload = (p.type as EastTypeValue).value as { type: string, value: any };
        const inner: EastTypeValue | null = payload.type === "wrapper" ? payload.value.inner : null;
        const text = inner === null ? null : this.literalFor(inner)(p.value, scope, pre, d);
        return ["East.wrapRecursive", callArgs([text ?? this.expr(p.value, scope, pre, d), this.typeRef(p.type)])];
      }
      case "UnwrapRecursive":
        return this.methodCall(this.expr(p.value, scope, pre, d), "unwrap", []);
      case "Error":
        this.used.add("Expr");
        return ["Expr.error", callArgs([this.expr(p.message, scope, pre, d)])];
      case "IfElse":
        return this.ifExpr(p.ifs as { predicate: Node, body: Node }[], p.else_body, scope, pre, d);
      case "Match": {
        const subject = this.expr(p.variant, scope, pre, d);
        // `v.unwrap()` lowers to a match; printed back as the call, so the
        // rebuilt module type-checks (the error arms are Never-typed)
        const unwrapped = unwrapCase(p);
        if (unwrapped !== null) return this.methodCall(subject, "unwrap", unwrapped === "some" ? [] : [JSON.stringify(unwrapped)]);
        const arms = (p.cases as { case: string, variable: Node, body: Node }[])
          .map((c): Doc => [objectKey(c.case), ": ", this.callbackExpr(c.body, [c.variable], scope, pre)]);
        return this.methodCall(subject, "match", [hug(bracket("{", arms, "}", " "))]);
      }
      case "TryCatch": {
        if (!isNullValue(p.finally_body)) {
          throw new Unprintable("a TryCatch with a finally body in expression position — TypeScript's Expr.tryCatch has no finally");
        }
        const body = this.armExpr(p.try_body, scope, pre, d);
        const handler = this.callbackExpr(p.catch_body, [p.message, p.stack], scope, pre);
        this.used.add("Expr");
        return ["Expr.tryCatch", callArgs([body, handler])];
      }
      case "Block":
        return this.blockExpr(node, scope);
      default:
        if (STATEMENT_KINDS.has(kind)) throw new Unprintable(`${kind} node in expression position`);
        throw new Unprintable(`unknown node kind ${kind}`);
    }
  }

  /**
   * A node in a value position — a builtin's value slot, a call argument,
   * a returned value: a construction prints as the host literal, bare when
   * the position is typed by the surface (`typed`: a `SubtypeExprOrValue`
   * slot, a declared output, an assigned variable) or when the literal
   * types itself ({@link selfTyping} — a callback's return, whose type the
   * builder infers), and through `East.value(v, T)` otherwise; any other
   * node prints as the expression it is.
   */
  valueDoc(node: Node, scope: Scope, pre: Doc[], depth: number, typed: boolean): Doc {
    if (!this.printsBare(node, typed)) return this.expr(node, scope, pre, depth);
    return this.literalFor(node.value.type as EastTypeValue)(node, scope, pre, depth) ?? this.expr(node, scope, pre, depth);
  }

  /** Whether {@link valueDoc} prints `node` as a bare host literal. */
  printsBare(node: Node, typed: boolean): boolean {
    return CONSTRUCTIONS.has(node.type) && (typed || selfTyping(node));
  }

  /**
   * The body of a concise arrow, `($, x) => body`: {@link valueDoc}, with a
   * bare struct literal in parentheses — `($, x) => ({ a: x })` — since an
   * object at the head of an arrow body parses as a block.
   */
  conciseBody(node: Node, scope: Scope, pre: Doc[], typed: boolean): Doc {
    const text = this.valueDoc(node, scope, pre, 0, typed);
    return node.type === "Struct" && this.printsBare(node, typed) ? hug(["(", text, ")"]) : text;
  }

  /**
   * The host-literal printer for values of type `t` — a factory over the
   * TYPE, as `compareFor(t)` and `equalFor(t)` are: the factory for a Dict
   * holds the factories for its key and value types, and so on down, so the
   * one type on a binding governs every position of the literal and a
   * construction nested anywhere prints bare (`new Map([["a", new Set([1n])]])`).
   * Applied to a node it returns the literal, or `null` when the node is not
   * the construction its position's type expects (a variable, a call, a
   * widening, a function) — the caller prints that as an expression.
   * `East.value(<literal>, T)` in expression position; `$.let(<literal>, T)`
   * for a binding.
   */
  literalFor(t: EastTypeValue): Literal {
    const hit = this.literals.get(t);
    if (hit !== undefined) return hit;
    const made = this.makeLiteral(t);
    this.literals.set(t, made);
    return made;
  }

  makeLiteral(t: EastTypeValue): Literal {
    const child = (u: EastTypeValue): Printed => {
      const inner = this.literalFor(u);
      return (node, scope, pre, depth) => inner(node, scope, pre, depth) ?? this.expr(node, scope, pre, depth);
    };
    const asExpr: Printed = (node, scope, pre, depth) => this.expr(node, scope, pre, depth);
    switch (t.type) {
      case "Null": case "Boolean": case "Integer": case "Float": case "String": case "DateTime": case "Blob":
        return node => node.type === "Value" ? literal(node.value.value) : null;
      case "Array": {
        const elem = child(t.value as EastTypeValue);
        return (node, scope, pre, depth) => node.type === "NewArray"
          ? hug(bracket("[", (node.value.values as Node[]).map(v => elem(v, scope, pre, depth + 1)), "]"))
          : null;
      }
      case "Set": {
        const elem = child(t.value as EastTypeValue);
        // an empty set stays `new Set([])`: the compiler types it `Set<never>`, which every East slot admits (`new Set()` is a `Set<unknown>`, which none does)
        return (node, scope, pre, depth) => node.type === "NewSet"
          ? hug(["new Set(", bracket("[", (node.value.values as Node[]).map(v => elem(v, scope, pre, depth + 1)), "]"), ")"])
          : null;
      }
      case "Dict": {
        const kv = t.value as { key: EastTypeValue, value: EastTypeValue };
        const key = child(kv.key);
        const value = child(kv.value);
        return (node, scope, pre, depth) => {
          if (node.type !== "NewDict") return null;
          const entries = node.value.values as { key: Node, value: Node }[];
          // an empty map is `new Map()`: the compiler types `new Map([])` `Map<unknown, unknown>`, which no East slot admits
          if (entries.length === 0) return "new Map()";
          return hug(["new Map(", bracket("[", entries
            .map(e => bracket("[", [key(e.key, scope, pre, depth + 1), value(e.value, scope, pre, depth + 1)], "]")), "]"), ")"]);
        };
      }
      case "Struct": {
        const fields = new Map((t.value as { name: string, type: EastTypeValue }[]).map(f => [f.name, child(f.type)] as const));
        return (node, scope, pre, depth) => node.type === "Struct"
          ? hug(bracket("{", (node.value.fields as { name: string, value: Node }[])
            .map((f): Doc => [objectKey(f.name), ": ", (fields.get(f.name) ?? asExpr)(f.value, scope, pre, depth + 1)]), "}", " "))
          : null;
      }
      case "Variant": {
        const cases = new Map((t.value as { name: string, type: EastTypeValue }[]).map(c => [c.name, child(c.type)] as const));
        const option = isOptionValue(t);
        return (node, scope, pre, depth) => {
          if (node.type !== "Variant") return null;
          const c = node.value.case as string;
          if (option && c === "none") {
            this.used.add("none");
            return "none";
          }
          const payload = (cases.get(c) ?? asExpr)(node.value.value, scope, pre, depth + 1);
          this.used.add(option ? "some" : "variant");
          return option ? ["some", callArgs([payload])] : ["variant", callArgs([JSON.stringify(c), payload])];
        };
      }
      case "Ref": {
        const inner = child(t.value as EastTypeValue);
        return (node, scope, pre, depth) => {
          if (node.type !== "NewRef") return null;
          this.used.add("ref");
          return ["ref", callArgs([inner(node.value.value, scope, pre, depth + 1)])];
        };
      }
      case "Vector":
        return node => node.type === "NewVector" ? this.typedArray(node.value.values, t.value as EastTypeValue, "NewVector") : null;
      case "Matrix":
        return node => {
          if (node.type !== "NewMatrix") return null;
          this.used.add("matrix");
          return ["matrix", callArgs([this.typedArray(node.value.values, t.value as EastTypeValue, "NewMatrix"), String(node.value.rows), String(node.value.cols)])];
        };
      default:
        // Never, Function, AsyncFunction, Recursive: no host literal at this position
        return () => null;
    }
  }

  /** A literal-only NewVector / NewMatrix payload as its typed array. */
  typedArray(values: Node[], elem: EastTypeValue, what: string): Doc {
    const lits = values.map(v => {
      if (v.type !== "Value") throw new Unprintable(`a ${what} of expressions — TypeScript builds vectors from typed arrays of literals`);
      return v.value.value as { type: string, value: any };
    });
    if (elem.type === "Float") return ["new Float64Array(", bracket("[", lits.map(l => literal(l)), "]"), ")"];
    if (elem.type === "Integer") return ["new BigInt64Array(", bracket("[", lits.map(l => literal(l)), "]"), ")"];
    if (elem.type === "Boolean") return ["new Uint8ClampedArray(", bracket("[", lits.map(l => (l.value ? "1" : "0")), "]"), ")"];
    throw new Unprintable(`a ${what} of ${elem.type} elements`);
  }

  /** An expression that must be an Expr, not a bare literal (a method receiver). */
  tracedExpr(node: Node, scope: Scope, pre: Doc[], depth: number): Doc {
    if (node.type === "Value") {
      const lit = node.value.value as { type: string, value: any };
      if (lit.type === "Null") return "East.value(null)";
      return ["East.value", callArgs([literal(lit)])];
    }
    return this.expr(node, scope, pre, depth);
  }

  /** An `ifElse` chain: TypeScript spells one predicate per node, so a
   * multi-branch IfElse nests in the else arm. */
  ifExpr(ifs: { predicate: Node, body: Node }[], elseBody: Node, scope: Scope, pre: Doc[], depth: number): Doc {
    const [first, ...rest] = ifs;
    const pred = this.tracedExpr(first!.predicate, scope, pre, depth);
    const then = this.armCallback(first!.body, scope, pre);
    const otherwise = rest.length === 0
      ? this.armCallback(elseBody, scope, pre)
      : arrow([BLOCK], this.ifExpr(rest, elseBody, scope, pre, depth));
    return this.methodCall(pred, "ifElse", [then, otherwise]);
  }

  /** An if-arm body as the `($) => ...` callback `ifElse` takes. */
  armCallback(body: Node, scope: Scope, pre: Doc[]): Doc {
    return this.callbackExpr(body, [], scope, pre);
  }

  /** An expression arm that must be an Expr: a Block as `Expr.block(...)`,
   * a literal through `East.value`. */
  armExpr(body: Node, scope: Scope, pre: Doc[], depth: number): Doc {
    if (body.type === "Block") return this.blockExpr(body, scope);
    return this.tracedExpr(body, scope, pre, depth);
  }

  /** A Block in expression position: `Expr.block(($) => { ... })`. */
  blockExpr(body: Node, scope: Scope): Doc {
    const inner = new Scope(scope);
    const stmts = this.bodyDocs(body, inner, "callback");
    this.used.add("Expr");
    return ["Expr.block", callArgs([arrowBlock([BLOCK], stmts)])];
  }

  /**
   * A callback body, the block first: `($, params) => expr` when the body
   * is one expression (or one statement, as its `$.` form), else `($,
   * params) => { ...; return expr; }`. The parameters keep the builtin's
   * own order. The builder infers the callback's type from what it
   * returns, so a construction prints bare only when it types itself.
   */
  callbackExpr(body: Node, params: Node[], scope: Scope, pre: Doc[]): Doc {
    const inner = new Scope(scope);
    const names = [BLOCK, ...params.map(v => this.bind(inner, v))];
    void pre;
    const tryWithFinally = body.type === "TryCatch" && !isNullValue(body.value.finally_body);
    if (body.type !== "Block" && body.type !== "Let" && !tryWithFinally) {
      const sub: Doc[] = [];
      const text = this.statementExpr(body, inner, sub);
      if (text !== null) return sub.length === 0 ? arrow(names, text) : arrowBlock(names, [...sub, ["return ", text, ";"]]);
      const value = this.conciseBody(body, inner, sub, false);
      if (sub.length === 0) return arrow(names, value);
      return arrowBlock(names, [...sub, ["return ", this.valueDoc(body, inner, sub, 0, false), ";"]]);
    }
    return arrowBlock(names, this.bodyDocs(body, inner, "callback"));
  }

  // ── builtins ─────────────────────────────────────────────────────────

  builtinExpr(node: Node, scope: Scope, pre: Doc[], depth: number): Doc {
    const p = node.value;
    const name = p.builtin as string;
    const row = spellingFor(name);
    if (row !== undefined) {
      const rendered = this.renderRow(row, p, scope, pre, depth);
      if (rendered !== null) return rendered;
    }
    return this.rawBuiltin(node, scope, pre, depth);
  }

  renderRow(row: Spelling, p: any, scope: Scope, pre: Doc[], depth: number): Doc | null {
    const args = p.arguments as Node[];
    const tps = p.type_parameters as EastTypeValue[];
    if (row.floatOnly && !(tps.length > 0 && tps[0]!.type === "Float")) return null;
    const callbacks = new Set(row.callbacks ?? []);
    const exprs = new Set(row.exprs ?? []);
    const inferred = new Set(row.inferred ?? []);
    const texts: Doc[] = [];
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
        texts.push(this.callbackExpr(fp.body, [...fp.parameters], scope, pre));
        return;
      }
      // The first operand is always an Expr (a literal receiver has no
      // methods, and the namespace helpers read their first argument's
      // type), as is every slot the row marks `exprs`; a slot the row marks
      // `inferred` takes its East type from the argument, so a construction
      // prints bare only when it types itself; every other slot is typed by
      // the surface (`SubtypeExprOrValue`, checked against the signatures by
      // spellings.spec.ts), so a construction prints bare.
      texts.push(i === 0 || exprs.has(i)
        ? this.tracedExpr(arg, scope, pre, depth)
        : this.valueDoc(arg, scope, pre, depth, !inferred.has(i)));
    });
    let template = row.template;
    if (csv === "") template = template.replace(", {C}", "").replace("{C}", "");
    const slot = (name: string): Doc => {
      if (name === "R") return regex ?? "";
      if (name === "C") return csv ?? "";
      if (name.startsWith("T")) {
        const t = tps[Number(name.slice(1))];
        if (t === undefined) throw new Unprintable(`${p.builtin}: type parameter ${name.slice(1)} missing`);
        return this.typeRef(t);
      }
      const a = texts[Number(name)];
      if (a === undefined) throw new Unprintable(`${p.builtin}: argument ${name} missing`);
      return a;
    };
    return this.templateDoc(template, slot);
  }

  /**
   * A spelling template as a document: a method on a slot (`{0}.map({1})`)
   * is a member-chain segment on that argument, any other call lays its
   * arguments out as one, and a template that is not a call is filled in
   * as it stands.
   */
  templateDoc(template: string, slot: (name: string) => Doc): Doc {
    const call = parseCallTemplate(template);
    if (call === null) return fill(template, slot);
    const args = call.args.map(a => fill(a, slot));
    const method = METHOD_HEAD.exec(call.head);
    if (method !== null) return this.methodCall(slot(method[1]!), method[2]!, args);
    return [fill(call.head, slot), callArgs(args)];
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

  rawBuiltin(node: Node, scope: Scope, pre: Doc[], depth: number): Doc {
    const p = node.value;
    this.rawBuiltins.add(p.builtin);
    const args = (p.arguments as Node[]).map((a, i) =>
      i === 0 ? this.tracedExpr(a, scope, pre, depth) : this.expr(a, scope, pre, depth));
    const tps = (p.type_parameters as EastTypeValue[]).map(t => this.typeRef(t));
    return ["East.builtin", callArgs([JSON.stringify(p.builtin), bracket("[", tps, "]"), bracket("[", args, "]"), this.typeRef(p.type)])];
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
    this.varCounter = nextVIndex(ir);
    this.prepare(ir);
    // A python artifact's hoisted constants become the body's own consts.
    const fnDoc = this.functionExpr(root, new Scope(null), consts);
    // exactly the names the module uses, in one fixed order
    const names = ["East", "Expr", "variant", "some", "none", "ref", "matrix", ...TYPE_IMPORTS].filter(n => this.used.has(n));
    const parts: Doc[] = [
      "// Generated by east-node transpile — East IR printed as the East.function",
      "// builder surface. Rebuilding this module yields the same IR (normalized).",
      `import { ${names.join(", ")} } from ${JSON.stringify(importFrom)};`,
    ];
    for (const specifier of [...this.libraryImports.keys()].sort()) {
      const roots = [...this.libraryImports.get(specifier)!].sort();
      parts.push(`import { ${roots.join(", ")} } from ${JSON.stringify(specifier)};`);
    }
    parts.push("");
    for (const [name, src] of this.types.values()) parts.push(["const ", name, " = ", src, ";"]);
    if (this.types.size > 0) parts.push("");
    parts.push(...this.platformDecls);
    if (this.platformDecls.length > 0) parts.push("");
    for (const decl of this.hoistedDecls) parts.push(decl, "");
    parts.push(["export const ", this.rootName, " = ", fnDoc, ";"]);
    parts.push("");
    return render(join(hardline, parts), this.width);
  }
}

/** The printer's own spelling for a variable it cannot name as the IR does. */
const V_NAME = /^v_(\d+)$/;

/** One above the highest `v_N` variable name in `ir` — a minted `v_N` never collides with one the program authored. */
function nextVIndex(ir: Node): number {
  let highest = -1;
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v !== null && typeof v === "object" && !(v instanceof Date) && !(v instanceof Uint8Array)) {
      const node = v as { type?: unknown, value?: any };
      if (node.type === "Variable" && node.value !== null && typeof node.value === "object" && typeof node.value.name === "string") {
        const m = V_NAME.exec(node.value.name);
        if (m) highest = Math.max(highest, Number(m[1]));
      }
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(ir);
  return highest + 1;
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
 * @param options - The export name (default `main`), the module the
 *   printed source imports from (default `@elaraai/east`), the line width,
 *   and the library modules whose exported declarations spell the platform
 *   calls (`libraries`)
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
 * // export const main = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
 * ```
 */
export function toSource(fnOrIr: unknown, options: ToSourceOptions = {}): string {
  const printer = new Printer(options.name ?? "main", options.width ?? LINE_WIDTH, librarySpellings(options.libraries ?? {}));
  return printer.module(irOf(fnOrIr), options.importFrom ?? "@elaraai/east");
}
