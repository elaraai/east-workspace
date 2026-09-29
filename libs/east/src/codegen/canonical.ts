/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * IR up to what the cross-runtime contract lets two builders differ on — the
 * erasure `east-c ir normalize` makes, made in TypeScript.
 *
 * @internal
 */

import { isVariant } from "../containers/variant.js";

/**
 * The canonical form of an IR value: loc_ids zeroed, variables and labels
 * renamed in the order they are bound and met, recursive type ids renumbered,
 * bigints as strings. Two IR values are the same program when their
 * canonical forms are {@link canonicalEqual}.
 *
 * @param node - an IR value (a node, or any value holding nodes)
 * @returns its canonical form: plain arrays, objects and leaves
 *
 * @remarks
 * Variables are renamed per BINDING, resolved lexically — a parameter, a
 * Let, a loop, match or catch variable each mint a canonical name for the
 * body they scope — not per name: sibling bodies reuse a name (three
 * callbacks each naming their element `x`), and two programs that bind the
 * same variable under different names are the same program. A variable no
 * binding in the value reaches is `free:<name>`.
 *
 * @internal
 */
export function canonicalIR(node: unknown): unknown {
  const labels = new Map<string, string>();
  const recursive = new Map<string, string>();
  let variables = 0;
  type Scope = Map<string, string>;
  const rename = (table: Map<string, string>, name: string, prefix: string): string => {
    let hit = table.get(name);
    if (hit === undefined) {
      hit = `${prefix}${table.size}`;
      table.set(name, hit);
    }
    return hit;
  };
  /** Binds `variable` (a Variable node) in `scope`: its canonical name, minted in binding order. */
  const bind = (variable: any, scope: Scope): unknown => {
    const name = `v${variables}`;
    variables += 1;
    scope.set(variable.value.name, name);
    return variableNode(variable, name);
  };
  const variableNode = (v: any, name: string): unknown =>
    ["Variable", { type: walk(v.value.type, "type"), name, mutable: v.value.mutable, captured: v.value.captured }];
  const lookup = (scopes: Scope[], name: string): string => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const hit = scopes[i]!.get(name);
      if (hit !== undefined) return hit;
    }
    return `free:${name}`;
  };
  // the scope chain is threaded through the walk: a body opens a scope, a Let extends the current one
  let chain: Scope[] = [new Map()];
  const inScope = <T>(f: () => T): T => {
    chain = [...chain, new Map()];
    try {
      return f();
    } finally {
      chain = chain.slice(0, -1);
    }
  };
  const walk = (v: any, context: string | null): unknown => {
    if (v === null || v === undefined) return null;
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Uint8Array) return Array.from(v);
    if (Array.isArray(v)) return v.map(x => walk(x, context));
    if (isVariant(v)) {
      const tag = v.type as string;
      const p = v.value;
      if (context === "type") {
        if (tag === "Recursive") {
          const payload = v.value;
          if (payload.type === "ref") return ["Recursive", ["ref", rename(recursive, String(payload.value), "r")]];
          return ["Recursive", ["wrapper", { id: rename(recursive, String(payload.value.id), "r"), inner: walk(payload.value.inner, "type") }]];
        }
        return [tag, walk(v.value, context)];
      }
      switch (tag) {
        case "Variable":
          return variableNode(v, lookup(chain, p.name));
        case "Function":
        case "AsyncFunction":
          return inScope(() => [tag, {
            type: walk(p.type, "type"),
            parameters: (p.parameters as any[]).map(q => bind(q, chain[chain.length - 1]!)),
            body: walk(p.body, context),
            captures: walk(p.captures, context),
          }]);
        case "Let": {
          const value = walk(p.value, context);
          return [tag, { type: walk(p.type, "type"), value, variable: bind(p.variable, chain[chain.length - 1]!) }];
        }
        case "ForArray":
        case "ForDict":
        case "ForSet": {
          const source = tag === "ForArray" ? "array" : tag === "ForDict" ? "dict" : "set";
          const coll = walk(p[source], context);
          return inScope(() => {
            const scope = chain[chain.length - 1]!;
            const out: Record<string, unknown> = { type: walk(p.type, "type"), [source]: coll, label: { name: rename(labels, p.label.name, "L") } };
            if (tag !== "ForSet") out["value"] = bind(p.value, scope);
            out["key"] = bind(p.key, scope);
            out["body"] = walk(p.body, context);
            return [tag, out];
          });
        }
        case "Match": {
          const subject = walk(p.variant, context);
          const cases = (p.cases as any[]).map(c => inScope(() => ({
            case: c.case, variable: bind(c.variable, chain[chain.length - 1]!), body: walk(c.body, context),
          })));
          return [tag, { type: walk(p.type, "type"), variant: subject, cases }];
        }
        case "TryCatch": {
          const tryBody = inScope(() => walk(p.try_body, context));
          const caught = inScope(() => {
            const scope = chain[chain.length - 1]!;
            const message = bind(p.message, scope);
            const stack = bind(p.stack, scope);
            return { message, stack, catch_body: walk(p.catch_body, context) };
          });
          const finallyBody = inScope(() => walk(p.finally_body, context));
          return [tag, { type: walk(p.type, "type"), try_body: tryBody, ...caught, finally_body: finallyBody }];
        }
        case "Block":
          return inScope(() => [tag, { type: walk(p.type, "type"), statements: walk(p.statements, context) }]);
        case "While":
          return [tag, { type: walk(p.type, "type"), predicate: walk(p.predicate, context), label: { name: rename(labels, p.label.name, "L") }, body: inScope(() => walk(p.body, context)) }];
        case "IfElse":
          return [tag, {
            type: walk(p.type, "type"),
            ifs: (p.ifs as any[]).map(branch => ({ predicate: walk(branch.predicate, context), body: inScope(() => walk(branch.body, context)) })),
            else_body: inScope(() => walk(p.else_body, context)),
          }];
        default:
          return [tag, walk(v.value, context)];
      }
    }
    if (typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v).sort()) {
        if (key === "loc_id") { out[key] = "0"; continue; }
        if (key === "label" && typeof v[key] === "object" && v[key] !== null && "name" in v[key]) {
          out[key] = { name: rename(labels, v[key].name, "L") };
          continue;
        }
        out[key] = walk(v[key], key === "type" || key === "type_parameters" ? "type" : context);
      }
      return out;
    }
    return v;
  };
  return walk(node, null);
}

/**
 * The first place two canonical forms differ, or `null` when they are the
 * same: a leaf compares by `Object.is`, so -0.0 is not 0.0 and NaN is NaN.
 *
 * @param a - a canonical form ({@link canonicalIR})
 * @param b - another
 * @param path - where `a` and `b` sit, for the report
 * @returns the path of the first difference and the two values there, or `null`
 *
 * @internal
 */
export function canonicalDifference(a: any, b: any, path = "ir"): string | null {
  if (Object.is(a, b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length: ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = canonicalDifference(a[i], b[i], `${path}[${i}]`);
      if (d !== null) return d;
    }
    return null;
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const d = canonicalDifference(a[k], b[k], `${path}.${k}`);
      if (d !== null) return d;
    }
    return null;
  }
  return `${path}: ${String(a)} vs ${String(b)}`;
}
