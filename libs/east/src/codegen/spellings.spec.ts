/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The spelling table against the surface it spells (#645).
 *
 * A row's `exprs` names the argument slots the surface types `Expr`-only —
 * where a literal must print through `East.value(v, T)`; every other slot
 * is typed `SubtypeExprOrValue` (or a host value union) and a construction
 * prints there as the host literal. The TypeScript signatures are the
 * source of truth for that distinction, so this spec reads them — the
 * expression classes and the `East.*` helpers under `src/expr/`, parsed by
 * the TypeScript compiler — and checks every slot of every row: a slot in
 * `exprs` is `Expr`-only in the signature, a slot in `inferred` is an
 * unconstrained type parameter (the East type comes from the argument), and
 * every other slot accepts a value under a type the surface supplies. A
 * slot the signatures do not settle is an error, not a skip.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { SPELLINGS } from "./spellings.js";

const EXPR_DIR = fileURLToPath(new URL("../../../src/expr/", import.meta.url));

/** One parameter of one signature: its type text (a constrained type parameter read as its constraint), whether it is a rest parameter. */
interface Param { type: string, rest: boolean }
type Signature = Param[];

/** How a parameter's type admits an argument. */
type Kind = "value" | "expr" | "inferred" | "callback" | "unknown";

/** A bare type-parameter name (the signature's own, unconstrained) — the East type is inferred from the argument. */
const INFERRED = "<inferred>";

function kindOf(type: string): Kind {
  if (type === INFERRED) return "inferred";
  if (/=>/.test(type)) return "callback";
  if (/SubtypeExprOrValue|ExprOrValue|ValueTypeOf|\b(?:bigint|number|string|boolean|Date|Uint8Array|Map|Set|Float64Array|BigInt64Array|Uint8ClampedArray|null|RegExp)\b/.test(type)) return "value";
  if (/Expr(?:Type)?(?:\b|<)/.test(type)) return "expr";
  return "unknown";
}

/** Every signature (overloads and implementation) of `name` in `node`'s function-like members. */
class Surface {
  readonly files = new Map<string, ts.SourceFile>();

  constructor() {
    for (const dir of [EXPR_DIR, join(EXPR_DIR, "libs")]) {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".ts") || f.endsWith(".spec.ts")) continue;
        const path = join(dir, f);
        this.files.set(path, ts.createSourceFile(path, readFileSync(path, "utf-8"), ts.ScriptTarget.Latest, true));
      }
    }
  }

  file(name: string): ts.SourceFile {
    const hit = this.files.get(join(EXPR_DIR, name));
    if (hit === undefined) throw new Error(`no surface file ${name}`);
    return hit;
  }

  /** The parameters of a signature: a type parameter (also under `NoInfer`) reads as its constraint, or as {@link INFERRED} when it has none. */
  static params(sig: ts.SignatureDeclarationBase, sf: ts.SourceFile): Signature {
    const constraints = new Map<string, string>();
    for (const tp of sig.typeParameters ?? []) constraints.set(tp.name.text, tp.constraint?.getText(sf) ?? INFERRED);
    return sig.parameters.map(p => {
      const text = (p.type?.getText(sf) ?? "").replace(/^NoInfer<(.*)>$/, "$1");
      return { type: constraints.get(text) ?? text, rest: p.dotDotDotToken !== undefined };
    });
  }

  /** The signatures of method `name` on class `className` (its own file). */
  method(className: string, name: string): Signature[] {
    const sf = this.file(`${className.slice(0, -4).toLowerCase()}.ts`);
    const out: Signature[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isClassDeclaration(n) && n.name?.text === className) {
        for (const m of n.members) {
          if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === name) out.push(Surface.params(m, sf));
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }

  /** The signatures of the top-level function `name` in `file`. */
  fn(file: string, name: string): Signature[] {
    const sf = this.file(file);
    const out: Signature[] = [];
    for (const s of sf.statements) {
      if (ts.isFunctionDeclaration(s) && s.name?.text === name) out.push(Surface.params(s, sf));
    }
    return out;
  }

  /** The signatures of member `name` of the default-exported object of `libs/<ns>.ts` — a method, or an imported function. */
  lib(ns: string, name: string): Signature[] {
    const file = `libs/${ns.toLowerCase()}.ts`;
    const sf = this.file(file);
    const out: Signature[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isObjectLiteralExpression(n)) {
        for (const m of n.properties) {
          if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === name) out.push(Surface.params(m, sf));
          if (ts.isShorthandPropertyAssignment(m) && m.name.text === name) out.push(...this.fn(`${ns.toLowerCase()}.ts`, name));
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }
}

/** The receiver class of a builtin by its name prefix; `null` for a namespace helper. */
function receiverClass(builtin: string): string {
  if (builtin === "Parse" || builtin.startsWith("Regex")) return "StringExpr";
  for (const prefix of ["Array", "Blob", "Boolean", "DateTime", "Dict", "Float", "Integer", "Matrix", "Ref", "Set", "String", "Vector"]) {
    if (builtin.startsWith(prefix)) return `${prefix}Expr`;
  }
  throw new Error(`no receiver class for ${builtin}`);
}

/** The top-level comma-separated argument templates of `head(args)`. */
function argTemplates(template: string): { head: string, args: string[] } {
  let depth = 0;
  for (let i = template.length - 1; i >= 0; i--) {
    if (template[i] === ")") depth += 1;
    else if (template[i] === "(") {
      depth -= 1;
      if (depth === 0) {
        const inner = template.slice(i + 1, -1).trim();
        return { head: template.slice(0, i), args: inner === "" ? [] : inner.split(",").map(a => a.trim()) };
      }
    }
  }
  throw new Error(`not a call template: ${template}`);
}

test("every slot of the spelling table agrees with the surface's signatures: `exprs` are the Expr-only slots", () => {
  const surface = new Surface();
  const problems: string[] = [];
  for (const [builtin, row] of Object.entries(SPELLINGS)) {
    const { head, args } = argTemplates(row.template);
    const method = /^\{\d+\}\.(\w+)$/.exec(head);
    const namespaced = /^East\.(\w+)\.(\w+)$/.exec(head);
    const root = /^East\.(\w+)$/.exec(head);
    const signatures = method !== null
      ? surface.method(receiverClass(builtin), method[1]!)
      : namespaced !== null
        ? surface.lib(namespaced[1]!, namespaced[2]!)
        : root !== null
          ? surface.fn("block.ts", root[1]!)
          : [];
    if (signatures.length === 0) {
      problems.push(`${builtin}: no signature found for ${head}`);
      continue;
    }
    const callbacks = new Set(row.callbacks ?? []);
    const exprs = new Set(row.exprs ?? []);
    const inferred = new Set(row.inferred ?? []);
    args.forEach((arg, position) => {
      const slot = /^\{(\d+)\}$/.exec(arg);
      if (slot === null) return;   // a type parameter, the RegExp or the CSV options
      const k = Number(slot[1]);
      if (k === 0 || callbacks.has(k)) return;   // the receiver is always an Expr; callbacks print as bodies
      // the parameter at this position in every overload (a rest parameter covers the tail)
      const kinds = new Set<Kind>();
      for (const sig of signatures) {
        const p = sig[position] ?? (sig.length > 0 && sig[sig.length - 1]!.rest ? sig[sig.length - 1] : undefined);
        if (p !== undefined) kinds.add(kindOf(p.type));
      }
      const where = `${builtin}: slot ${k} (${arg} of ${row.template})`;
      // what the surface says: a typed value slot in any overload wins; else inferred; else Expr-only
      const surface = kinds.has("value") ? "value" : kinds.has("inferred") ? "inferred" : kinds.has("expr") && !kinds.has("unknown") ? "expr" : "unknown";
      // what the table says
      const table = exprs.has(k) ? "expr" : inferred.has(k) ? "inferred" : "value";
      if (surface === "unknown") problems.push(`${where} has an unsettled type (${[...kinds].join(", ")})`);
      else if (surface !== table) problems.push(`${where} is ${surface} in the surface but ${table} in the table`);
    });
  }
  assert.deepEqual(problems, [], `\n  ${problems.join("\n  ")}`);
});
