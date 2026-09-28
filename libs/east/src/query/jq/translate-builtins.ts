/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Each builtin of the catalog as East IR: the translation rules
 * `translate.ts` calls, one per builtin a query may use, and the formats
 * (`devdocs/QUERY.md` §10, §15).
 *
 * A rule writes a call's outputs through the translator's continuation, with
 * East builtins only. Its arguments are generated as jq evaluates them: a
 * value parameter (`$n`) once per output, the first argument's outputs
 * slowest; a filter parameter on each input it is given.
 *
 * @packageDocumentation
 */

import type { Label } from "../../ast.js";
import { SortedSet } from "../../containers/sortedset.js";
import { variant } from "../../containers/variant.js";
import { compareFor } from "../../comparison.js";
import { DateTimeFormatTokenType } from "../../datetime_format/types.js";
import type { Expr } from "../../expr/expr.js";
import { UNKNOWN_LOC_ID } from "../../location.js";
import {
  ArrayType, BlobType, BooleanType, DateTimeType, DictType, FloatType, FunctionType, IntegerType, NullType, OptionType, RefType,
  SetType, StringType, StructType, isTypeEqual, printType, type EastType,
} from "../../types.js";
import { BUILTINS, delPaths, type DelStep } from "./catalog.js";
import { jqTypeNames, nullablePayload, unify, unwrap } from "./shapes.js";
import { childPath, jqChildren, type JqNode } from "./spans.js";
import { parts, type Block, type BuiltinRule, type CallSite, type Emit, type Env, type Translator, type TypeParts, type Value } from "./translate.js";

/** Builds a rule table entry for each of some names. */
const rules: Record<string, BuiltinRule> = {};
function rule(names: string | readonly string[], r: BuiltinRule): void {
  for (const name of typeof names === "string" ? [names] : names) rules[name] = r;
}

/** The call's input, as an expression. */
function input(t: Translator, c: CallSite): Expr {
  return t.expr(c.x, c.path);
}

/** The instance a call's argument is typed in, for an input. */
function argEnv(t: Translator, c: CallSite, i: number, x: Value): Env {
  return t.envFor(c.argPaths[i]!, c.env, x);
}

/**
 * Generates value arguments, each output as its collected type: the first's
 * outputs slowest, as jq binds `$a` then `$b`.
 */
function values(t: Translator, c: CallSite, indices: readonly number[], $: Block, then: ($: Block, values: Expr[]) => void, x: Value = c.x): void {
  const step = ($2: Block, k: number, acc: Expr[]): void => {
    if (k === indices.length) { then($2, acc); return; }
    const i = indices[k]!;
    t.collected(c.args[i]!, c.argPaths[i]!, $2, x, c.env, ($3, v) => step($3, k + 1, [...acc, v]));
  };
  step($, 0, []);
}

/** Generates a filter argument on an input. */
function arg(t: Translator, c: CallSite, i: number, $: Block, x: Value, emit: Emit): void {
  t.gen(c.args[i]!, c.argPaths[i]!, $, x, c.env, emit);
}

/** The one type an argument's outputs share on an input. */
function argType(t: Translator, c: CallSite, i: number, x: Value): TypeParts {
  return t.typeAt(c.argPaths[i]!, argEnv(t, c, i, x));
}

/** Whether an argument gives exactly one output on an input. */
function argIsOne(t: Translator, c: CallSite, i: number, x: Value): boolean {
  const r = t.result(c.argPaths[i]!, argEnv(t, c, i, x));
  return r !== null && r.mult.lo === 1 && r.mult.hi === 1;
}

/** The call's own output type, as the checker gave it. */
function outputType(t: Translator, c: CallSite): TypeParts {
  return t.typeAt(c.path, c.env);
}

/** Raises jq's error for an input a builtin cannot take: reached only where the checker allowed it, inside `try` or after `?`. */
function cannot(t: Translator, c: CallSite, $: Block, v: Expr, what: string): void {
  t.raise($, `${printKind(t, v)} cannot be used with ${c.name}: it needs ${what}`, c.path);
}

function printKind(t: Translator, v: Expr): string {
  return jqTypeNames(t.type(v))[0] ?? "a value";
}

/** A number as a Float. */
function float(t: Translator, $: Block, v: Expr, path: string): Expr {
  return t.widenTo($, t.open(v), FloatType, path);
}

/** Whether a type is a number. */
function isNumber(type: EastType): boolean {
  return type.type === "Integer" || type.type === "Float";
}

// ─── Selection and streams ───────────────────────────────────────────────

rule("empty", () => {});

rule("error", (t, c) => {
  const raise = ($: Block, v: Expr): void => t.raise($, message(t, $, v, c.path), c.path);
  if (c.args.length === 0) { raise(c.$, input(t, c)); return; }
  arg(t, c, 0, c.$, c.x, raise);
});

/** An error's message: a string as it is, anything else as its East text (§13.14). */
function message(t: Translator, $: Block, v: Expr, path: string): Expr {
  return t.tostring($, v, path);
}

rule("not", (t, c) => c.emit(c.$, t.asExpr(negate(t, t.truthy(input(t, c), c.path), c.path))));

function negate(t: Translator, v: Expr | boolean, path: string): Expr | boolean {
  return typeof v === "boolean" ? !v : t.not(v, path);
}

rule("select", (t, c) => {
  const x = input(t, c);
  arg(t, c, 0, c.$, c.x, ($, condition) => t.branch($, t.truthy(condition, c.path), $2 => c.emit($2, x), () => {}, c.path));
});

rule("first", (t, c) => {
  if (c.args.length === 1) {
    t.once(c.$, ($, label) => arg(t, c, 0, $, c.x, ($2, v) => { c.emit($2, v); t.brk($2, label); }), c.path);
    return;
  }
  t.indexOf(c.$, input(t, c), t.int(0), false, c.path, c.emit);
});

rule("last", (t, c) => {
  if (c.args.length === 1) {
    const type = argType(t, c, 0, c.x);
    const option = OptionType(type);
    const last = t.declare(c.$, t.none(option), "last");
    arg(t, c, 0, c.$, c.x, ($, v) => t.assign($, last, t.some(t.widenTo($, v, type, c.path), option)));
    t.match(c.$, last, { some: c.emit }, c.path);
    return;
  }
  t.indexOf(c.$, input(t, c), t.int(-1), false, c.path, c.emit);
});

rule("nth", (t, c) => {
  if (c.args.length === 1) {
    values(t, c, [0], c.$, ($, [n]) => t.indexOf($, input(t, c), n!, false, c.path, c.emit));
    return;
  }
  values(t, c, [0], c.$, ($, [n]) => {
    t.ifElse($, t.lt(n!, t.int(0), c.path), $2 => t.raise($2, "nth doesn't support negative indices", c.path), $2 => {
      const count = t.declare($2, t.int(0), "count");
      t.once($2, ($3, label) => arg(t, c, 1, $3, c.x, ($4, v) => {
        t.ifElse($4, t.eq(count, n!, c.path), $5 => { c.emit($5, v); t.brk($5, label); }, undefined, c.path);
        t.assign($4, count, t.add(count, t.int(1), c.path));
      }), c.path);
    }, c.path);
  });
});

rule("limit", (t, c) => values(t, c, [0], c.$, ($, [n]) => {
  t.ifElse($, t.lt(n!, t.int(0), c.path), $2 => t.raise($2, "limit doesn't support negative count", c.path), $2 => {
    t.ifElse($2, t.lt(t.int(0), n!, c.path), $3 => {
      const count = t.declare($3, t.int(0), "count");
      t.once($3, ($4, label) => arg(t, c, 1, $4, c.x, ($5, v) => {
        c.emit($5, v);
        t.assign($5, count, t.add(count, t.int(1), c.path));
        t.ifElse($5, t.b("GreaterEqual", [IntegerType], [count, n!], BooleanType, c.path), $6 => t.brk($6, label), undefined, c.path);
      }), c.path);
    }, undefined, c.path);
  }, c.path);
}));

rule("skip", (t, c) => values(t, c, [0], c.$, ($, [n]) => {
  t.ifElse($, t.lt(n!, t.int(0), c.path), $2 => t.raise($2, "skip doesn't support negative count", c.path), $2 => {
    const count = t.declare($2, t.int(0), "count");
    arg(t, c, 1, $2, c.x, ($3, v) => {
      t.ifElse($3, t.lt(count, n!, c.path), $4 => t.assign($4, count, t.add(count, t.int(1), c.path)), $4 => c.emit($4, v), c.path);
    });
  }, c.path);
}));

rule("isempty", (t, c) => {
  const empty = t.declare(c.$, t.bool(true), "empty");
  t.once(c.$, ($, label) => arg(t, c, 0, $, c.x, $2 => { t.assign($2, empty, t.bool(false)); t.brk($2, label); }), c.path);
  c.emit(c.$, empty);
});

rule("range", (t, c) => {
  const type = outputType(t, c);
  const indices = c.args.map((_, i) => i);
  values(t, c, indices, c.$, ($, args) => {
    const as = (v: Expr): Expr => t.widenTo($, v, type, c.path);
    const zero = type.type === "Float" ? t.float(0) : t.int(0);
    const one = type.type === "Float" ? t.float(1) : t.int(1);
    const [from, upto, by] = args.length === 1 ? [zero, as(args[0]!), one] : args.length === 2 ? [as(args[0]!), as(args[1]!), one] : [as(args[0]!), as(args[1]!), as(args[2]!)];
    const i = t.declare($, from!, "i");
    const byValue = t.constant(by!)?.value as number | bigint | undefined;
    const less = (a: Expr, b: Expr): Expr => t.b("Less", [type], [a, b], BooleanType, c.path);
    // Up while below the end for a positive step, down while above it for a negative one; a zero step gives nothing.
    const going = byValue === undefined
      ? t.b("BooleanOr", [], [
        t.b("BooleanAnd", [], [less(zero, by!), less(i, upto!)], BooleanType, c.path),
        t.b("BooleanAnd", [], [less(by!, zero), less(upto!, i)], BooleanType, c.path),
      ], BooleanType, c.path)
      : byValue > 0 ? less(i, upto!) : byValue < 0 ? less(upto!, i) : undefined;
    if (going === undefined) return;
    t.whileLoop($, going, $2 => {
      const value = t.declare($2, i, "value", false);
      t.assign($2, i, t.b(type.type === "Float" ? "FloatAdd" : "IntegerAdd", [], [i, by!], type, c.path));
      c.emit($2, value);
    }, c.path);
  });
});

/** The kinds of value `recurse` finds directly inside a value of a type: what `.[]?` gives, as the checker types it. */
function recurseKinds(type: EastType): EastType[] {
  const u = unwrap(type);
  switch (u.type) {
    case "Array": return [u.value as EastType];
    case "Set": return [u.key as EastType];
    case "Vector": return [u.element as EastType];
    case "Matrix": return [ArrayType(u.element as EastType)];
    case "Dict": return [u.value as EastType];
    case "Struct": return Object.values(u.fields as Record<string, EastType>);
    default: return [];
  }
}

rule("recurse", (t, c) => {
  if (c.args.length === 0) {
    const x = input(t, c);
    const kinds: EastType[] = [];
    let recursive = false;
    const visit = (type: EastType): void => {
      if (kinds.some(k => isTypeEqual(k, type))) return;
      kinds.push(type);
      if (type.type === "Recursive") recursive = true;
      recurseKinds(type).forEach(visit);
    };
    visit(t.type(x));
    const children = ($: Block, v: Expr, emit: Emit): void => {
      const o = t.open(v);
      const ot = t.type(o);
      if (ot.type === "Struct") {
        const s = t.bind($, o, "struct");
        for (const name of Object.keys(ot.fields as object)) emit($, t.field(s, name));
      } else if (recurseKinds(ot).length > 0) {
        t.forEach($, o, ($2, item) => emit($2, item), c.path);
      }
    };
    if (!recursive) {
      const walk = ($: Block, v: Expr): void => { c.emit($, v); children($, v, walk); };
      walk(c.$, x);
      return;
    }
    t.walkStack(c.$, x, kinds, c.path, ($, v, push) => { c.emit($, v); children($, v, push); });
    return;
  }
  // `recurse(f)`, `recurse(f; cond)`: the value, then f of it, and so on, depth first.
  const type = outputType(t, c);
  const start = t.widenTo(c.$, input(t, c), type, c.path);
  t.walkStack(c.$, start, [type], c.path, ($, v, push) => {
    c.emit($, v);
    arg(t, c, 0, $, v, ($2, child) => {
      const next = t.bind($2, t.widenTo($2, child, type, c.path), "child");
      if (c.args.length === 2) arg(t, c, 1, $2, next, ($3, condition) => t.branch($3, t.truthy(condition, c.path), $4 => push($4, next), () => {}, c.path));
      else push($2, next);
    });
  });
});

rule("repeat", (t, c) => {
  const type = outputType(t, c);
  const start = t.widenTo(c.$, input(t, c), type, c.path);
  t.walkStack(c.$, start, [type], c.path, ($, v, push) => {
    c.emit($, v);
    arg(t, c, 0, $, v, ($2, next) => push($2, t.widenTo($2, next, type, c.path)));
  });
});

rule("while", (t, c) => {
  const type = outputType(t, c);
  const start = t.widenTo(c.$, input(t, c), type, c.path);
  t.walkStack(c.$, start, [type], c.path, ($, v, push) => {
    arg(t, c, 0, $, v, ($2, condition) => t.branch($2, t.truthy(condition, c.path), $3 => {
      c.emit($3, v);
      arg(t, c, 1, $3, v, ($4, next) => push($4, t.widenTo($4, next, type, c.path)));
    }, () => {}, c.path));
  });
});

rule("until", (t, c) => {
  const type = outputType(t, c);
  const start = t.widenTo(c.$, input(t, c), type, c.path);
  t.walkStack(c.$, start, [type], c.path, ($, v, push) => {
    arg(t, c, 0, $, v, ($2, condition) => t.branch($2, t.truthy(condition, c.path),
      $3 => c.emit($3, v),
      $3 => arg(t, c, 1, $3, v, ($4, next) => push($4, t.widenTo($4, next, type, c.path))), c.path));
  });
});

rule("combinations", (t, c) => {
  const run = ($: Block, lists: Expr): void => {
    const row = parts(t.type(lists).value);
    const element = row.value;
    const n = t.declare($, t.size(lists, c.path), "count", false);
    const anyEmpty = t.declare($, t.bool(false), "anyEmpty");
    t.forEach($, lists, ($2, list) => t.ifElse($2, t.eq(t.size(list, c.path), t.int(0), c.path), $3 => t.assign($3, anyEmpty, t.bool(true)), undefined, c.path), c.path, "list");
    t.ifElse($, t.not(anyEmpty, c.path), $2 => {
      const index = t.declare($2, t.emptyArray(IntegerType), "positions");
      t.forEach($2, lists, $3 => t.push($3, index, t.int(0), c.path), c.path, "list");
      t.whileLoop($2, true, ($3, label) => {
        const combo = t.declare($3, t.emptyArray(element), "combination");
        t.forEach($3, lists, ($4, list, k) => {
          t.push($4, combo, t.b("ArrayGet", [element], [list, t.b("ArrayGet", [IntegerType], [index, k!], IntegerType, c.path)], element, c.path), c.path);
        }, c.path, "list");
        c.emit($3, combo);
        // The next combination: the last position fastest.
        const k = t.declare($3, t.add(n, t.int(-1), c.path), "k");
        const carry = t.declare($3, t.bool(true), "carry");
        t.whileLoop($3, t.b("BooleanAnd", [], [carry, t.b("GreaterEqual", [IntegerType], [k, t.int(0)], BooleanType, c.path)], BooleanType, c.path), $4 => {
          const next = t.declare($4, t.add(t.b("ArrayGet", [IntegerType], [index, k], IntegerType, c.path), t.int(1), c.path), "next", false);
          t.ifElse($4, t.lt(next, t.size(t.b("ArrayGet", [row], [lists, k], row, c.path), c.path), c.path), $5 => {
            t.stmt($5, t.b("ArrayUpdate", [IntegerType], [index, k, next], NullType, c.path));
            t.assign($5, carry, t.bool(false));
          }, $5 => {
            t.stmt($5, t.b("ArrayUpdate", [IntegerType], [index, k, t.int(0)], NullType, c.path));
            t.assign($5, k, t.add(k, t.int(-1), c.path));
          }, c.path);
        }, c.path);
        t.ifElse($3, carry, $4 => t.brk($4, label), undefined, c.path);
      }, c.path);
    }, undefined, c.path);
  };
  if (c.args.length === 0) { run(c.$, t.bind(c.$, t.open(input(t, c)), "lists")); return; }
  values(t, c, [0], c.$, ($, [n]) => {
    const list = t.bind($, t.open(input(t, c)), "list");
    const lists = t.declare($, t.emptyArray(t.type(list)), "lists");
    const i = t.declare($, t.int(0), "i");
    t.whileLoop($, t.lt(i, n!, c.path), $2 => { t.push($2, lists, list, c.path); t.assign($2, i, t.add(i, t.int(1), c.path)); }, c.path);
    run($, lists);
  });
});

rule("walk", (t, c) => {
  const type = outputType(t, c);
  // Bottom up: a value's parts are walked first, then f runs on it rebuilt.
  const cells = new Map<EastType, Expr>();
  // Where the functions that walk recursive values are declared: before the walk, so every loop sees them.
  const start = c.$.statements.length;
  let declared = 0;
  const walk = ($: Block, v: Expr): Expr => {
    const vt = t.type(v);
    if (vt.type === "Recursive") return walkRecursive($, v);
    const rebuilt = rebuild($, v);
    return apply($, rebuilt);
  };
  const apply = ($: Block, v: Expr): Expr => {
    const out = t.one(c.args[0]!, c.argPaths[0]!, $, v, c.env, argType(t, c, 0, v));
    return t.bind($, out, "walked");
  };
  const rebuild = ($: Block, v: Expr): Expr => {
    const o = t.open(v);
    const ot = t.type(o);
    if (ot.type === "Array") {
      let out: Expr | undefined;
      const decl = t.block();
      t.forEach($, o, ($2, item) => {
        const w = walk($2, item);
        out ??= t.declare(decl, t.emptyArray(t.type(w)), "array");
        t.push($2, out, w, c.path);
      }, c.path);
      $.statements.splice($.statements.length - 1, 0, ...decl.statements);
      return out ?? o;
    }
    if (ot.type === "Dict") {
      let out: Expr | undefined;
      const decl = t.block();
      t.forEach($, o, ($2, item, key) => {
        const w = walk($2, item);
        out ??= t.declare(decl, t.value(new Map(), DictType(ot.key as EastType, t.type(w))), "dict");
        t.stmt($2, t.b("DictInsert", [ot.key as EastType, t.type(w)], [out, key!, w], NullType, c.path));
      }, c.path);
      $.statements.splice($.statements.length - 1, 0, ...decl.statements);
      return out ?? o;
    }
    if (ot.type === "Struct") {
      const s = t.bind($, o, "struct");
      const values: Record<string, Expr> = {};
      const types: Record<string, EastType> = {};
      for (const name of Object.keys(ot.fields as object)) {
        values[name] = walk($, t.field(s, name));
        types[name] = t.type(values[name]!);
      }
      const rebuiltType = v !== o && isTypeEqual(StructType(types), ot) ? t.type(v) : StructType(types);
      return t.struct(rebuiltType, values);
    }
    return v;
  };
  // A recursive value is walked by a function its own parts call, through a reference.
  const walkRecursive = ($: Block, v: Expr): Expr => {
    const rt = t.type(v);
    const fnType = FunctionType([rt], rt);
    let cell = cells.get(rt);
    if (cell === undefined) {
      const header = t.block();
      const placeholder = t.lambda([rt], rt, ["value"], (_$f, value) => value, c.path);
      const made = t.declare(header, t.mk({ ast_type: "NewRef", type: RefType(fnType), loc_id: UNKNOWN_LOC_ID, value: t.ast(placeholder) }), "walk", false);
      cell = made;
      cells.set(rt, made);
      const fn = t.lambda([rt], rt, ["value"], ($f, value) => {
        const rebuilt = rebuild($f, value);
        return t.widenTo($f, apply($f, t.widenTo($f, rebuilt, rt, c.path)), rt, c.path);
      }, c.path);
      t.stmt(header, t.b("RefUpdate", [fnType], [made, fn], NullType, c.path));
      c.$.statements.splice(start + declared, 0, ...header.statements);
      declared += header.statements.length;
    }
    return t.bind($, t.callFn(t.b("RefGet", [fnType], [cell], fnType, c.path), [v], c.path), "walked");
  };
  c.emit(c.$, t.widenTo(c.$, walk(c.$, input(t, c)), type, c.path));
});

rule("IN", (t, c) => {
  const found = t.declare(c.$, t.bool(false), "found");
  const test = ($: Block, a: Expr, b: Expr, label: Label): void => {
    t.ifElse($, t.compare($, "==", a, b, c.path), $2 => { t.assign($2, found, t.bool(true)); t.brk($2, label); }, undefined, c.path);
  };
  t.once(c.$, ($, label) => {
    if (c.args.length === 1) {
      const x = input(t, c);
      arg(t, c, 0, $, c.x, ($2, v) => test($2, v, x, label));
      return;
    }
    // `IN(src; s)` is `any(src == s; .)`: s's outputs slowest.
    arg(t, c, 1, $, c.x, ($2, b) => {
      const bound = t.bind($2, b, "candidate");
      arg(t, c, 0, $2, c.x, ($3, a) => test($3, a, bound, label));
    });
  }, c.path);
  c.emit(c.$, found);
});

rule("INDEX", (t, c) => {
  const type = outputType(t, c);
  const dict = t.declare(c.$, t.value(new Map(), type), "index");
  const add = ($: Block, row: Expr): void => {
    const bound = t.bind($, row, "row");
    arg(t, c, c.args.length - 1, $, bound, ($2, key) => t.put($2, dict, key, bound, c.path));
  };
  if (c.args.length === 2) arg(t, c, 0, c.$, c.x, add);
  else t.iterate(c.$, input(t, c), false, c.path, add);
  c.emit(c.$, dict);
});

rule("del", (t, c) => {
  const paths = delPaths(c.args[0]!, c.argPaths[0]!);
  if (paths === undefined) throw t.gap(`del(${t.text(c.argPaths[0]!)})`);
  c.emit(c.$, deleteAt(t, c, c.$, input(t, c), paths));
});

/**
 * A value without what some paths name, all deleted at once as jq deletes
 * them: each path's keys and bounds are taken on the `del`'s input first.
 */
function deleteAt(t: Translator, c: CallSite, $: Block, v: Expr, paths: readonly (readonly DelStep[])[]): Expr {
  if (paths.length === 0) return v;
  if (paths.some(p => p.length === 0)) return t.null(c.path);
  const e = t.open(v);
  const type = t.type(e);
  if (type.type === "Null") return e;
  const payload = nullablePayload(type);
  if (payload !== undefined) {
    // An option: the deletion inside its value, when it has one.
    const inner = t.type(deleteAt(t, c, t.block(), t.placeholder(payload), paths));
    const option = OptionType(inner);
    return t.matchValue(e, { none: () => t.none(option), some: ($2, p) => t.some(deleteAt(t, c, $2, p, paths), option) }, option, c.path);
  }
  // A select as the whole path: the value is deleted, becoming null, where the condition holds.
  const selects = paths.filter(p => p.length === 1 && p[0]!.kind === "select");
  if (selects.length > 0) {
    const kept = t.bind($, deleteAt(t, c, $, e, paths.filter(p => !selects.includes(p))), "kept");
    const deleted = t.declare($, t.bool(false), "deleted");
    for (const p of selects) {
      const step = p[0] as Extract<DelStep, { kind: "select" }>;
      t.gen(nodeAt(c, step.path), step.path, $, e, c.env, ($2, condition) => t.branch($2, t.truthy(condition, c.path), $3 => t.assign($3, deleted, t.bool(true)), () => {}, c.path));
    }
    const option = OptionType(t.type(kept));
    return t.ifValue(deleted, () => t.none(option), () => t.some(kept, option), option, c.path);
  }
  const nameOf = (step: DelStep): string | undefined => {
    if (step.kind === "field") return step.name;
    if (step.kind === "index" && type.type !== "Dict") {
      const literal = t.literalOf(step.node);
      if (literal?.type.type === "String") return literal.value as string;
    }
    return undefined;
  };
  if (type.type === "Struct") {
    const fields = type.fields as Record<string, EastType>;
    const s = t.bind($, e, "struct");
    const removed = new Set<string>();
    const nested = new Map<string, DelStep[][]>();
    for (const p of paths) {
      const [first, ...rest] = p as [DelStep, ...DelStep[]];
      const names = first.kind === "iterate" ? Object.keys(fields) : [nameOf(first)];
      for (const name of names) {
        if (name === undefined) throw t.gap(`del of ${first.kind} on ${printType(type)}`);
        if (!(name in fields)) continue;
        if (rest.length === 0) removed.add(name);
        else nested.set(name, [...(nested.get(name) ?? []), rest]);
      }
    }
    const values: Record<string, Expr> = {};
    const types: Record<string, EastType> = {};
    for (const name of Object.keys(fields)) {
      if (removed.has(name)) continue;
      const rests = nested.get(name);
      values[name] = rests === undefined ? t.field(s, name) : t.bind($, deleteAt(t, c, $, t.field(s, name), rests), name);
      types[name] = t.type(values[name]!);
    }
    return t.struct(StructType(types), values);
  }
  if (type.type === "Array" || type.type === "Dict") {
    const isArray = type.type === "Array";
    const d = t.bind($, e, "container");
    const size = isArray ? t.declare($, t.size(d, c.path), "size", false) : undefined;
    // Each path's bounds, or every index or key it gives: one that gives several names several elements.
    type Target = { readonly from: Expr; readonly to: Expr } | { readonly keys: Expr } | undefined;
    const targets = paths.map((p): Target => {
      const first = p[0]!;
      if (first.kind === "iterate") return undefined;
      if (first.kind === "slice") {
        const node = nodeAt(c, first.path) as Extract<JqNode, { type: "slice" }>;
        const bound = (option: typeof node.value.from, step: string, fallback: Expr): Expr => option.type === "none"
          ? t.boundOf($, undefined, fallback, size!, c.path)
          : t.boundOf($, t.one(option.value, childPath(first.path, step), $, c.x, c.env, argTypeAt(t, c, childPath(first.path, step))), fallback, size!, c.path);
        return { from: bound(node.value.from, "slice.from.some", t.int(0)), to: bound(node.value.to, "slice.to.some", size!) };
      }
      const K = isArray ? IntegerType : type.key as EastType;
      const keys = t.declare($, t.emptyArray(K), "keys");
      const add = ($2: Block, key: Expr): void => {
        const k = t.bind($2, t.widenTo($2, key, K, c.path), "key");
        // A negative index counts from the end.
        t.push($2, keys, isArray ? t.ifValue(t.lt(k, t.int(0), c.path), () => t.add(k, size!, c.path), () => k, IntegerType, c.path) : k, c.path);
      };
      const name = nameOf(first);
      if (name !== undefined) add($, t.str(name, c.path));
      else {
        const step = first as Extract<DelStep, { kind: "index" }>;
        t.collected(step.node, step.path, $, c.x, c.env, add);
      }
      return { keys };
    });
    // Paths through every element to something inside it change each alike, and may change its type: they apply first.
    const throughEach = (p: readonly DelStep[]): boolean => p[0]!.kind === "iterate" && p.length > 1 && !(p.length === 2 && p[1]!.kind === "select");
    const everywhere = paths.filter(throughEach).map(p => p.slice(1));
    let out: Expr | undefined;
    const declared = t.block();
    t.forEach($, d, ($2, item, key) => {
      const current = everywhere.length === 0 ? item : t.bind($2, deleteAt(t, c, $2, item, everywhere), "element");
      const cell = t.declare($2, current, "element");
      const dropped = t.declare($2, t.bool(false), "dropped");
      paths.forEach((p, k) => {
        if (throughEach(p)) return;
        const rest = p.slice(1);
        const handle = ($3: Block): void => {
          if (rest.length === 0) { t.assign($3, dropped, t.bool(true)); return; }
          if (rest.length === 1 && rest[0]!.kind === "select") {
            const step = rest[0] as Extract<DelStep, { kind: "select" }>;
            t.gen(nodeAt(c, step.path), step.path, $3, cell, c.env, ($4, condition) => t.branch($4, t.truthy(condition, c.path), $5 => t.assign($5, dropped, t.bool(true)), () => {}, c.path));
            return;
          }
          t.assign($3, cell, t.widenTo($3, deleteAt(t, c, $3, cell, [rest]), t.type(cell), c.path));
        };
        const target = targets[k];
        if (target === undefined) { handle($2); return; }
        if ("from" in target) {
          const inRange = t.b("BooleanAnd", [], [t.b("LessEqual", [IntegerType], [target.from, key!], BooleanType, c.path), t.lt(key!, target.to, c.path)], BooleanType, c.path);
          t.ifElse($2, inRange, handle, undefined, c.path);
          return;
        }
        t.forEach($2, target.keys, ($3, k, _i, label) => t.ifElse($3, t.eq(k, key!, c.path), $4 => { handle($4); t.brk($4, label); }, undefined, c.path), c.path, "key");
      });
      const element = t.type(cell);
      out ??= t.declare(declared, isArray ? t.emptyArray(element) : t.value(new Map(), DictType(type.key as EastType, element)), isArray ? "array" : "dict");
      const result = out;
      t.ifElse($2, t.not(dropped, c.path), $3 => {
        if (isArray) t.push($3, result, cell, c.path);
        else t.stmt($3, t.b("DictInsert", [type.key as EastType, element], [result, key!, cell], NullType, c.path));
      }, undefined, c.path);
    }, c.path);
    // The result is declared before the loop, once the elements' type after deletion is known.
    $.statements.splice($.statements.length - 1, 0, ...declared.statements);
    return out ?? d;
  }
  if (type.type === "String") {
    t.raise($, "Cannot delete fields from string", c.path);
    return e;
  }
  throw t.gap(`del on ${printType(type)}`);
}

/** The node at a path inside the call's first argument. */
function nodeAt(c: CallSite, path: string): JqNode {
  const walk = (n: JqNode, at: string): JqNode | undefined => {
    if (at === path) return n;
    for (const child of jqChildren(n)) {
      if (child.node === undefined) continue;
      const childAt = childPath(at, child.step);
      if (path === childAt || path.startsWith(`${childAt}.`)) return walk(child.node, childAt);
    }
    return undefined;
  };
  const found = walk(c.args[0]!, c.argPaths[0]!);
  if (found === undefined) throw new Error(`translateJq: no node at ${path}`);
  return found;
}

/** The collected type of a node inside the call's argument. */
function argTypeAt(t: Translator, c: CallSite, path: string): EastType {
  return t.typeAt(path, t.envFor(path, c.env, c.x));
}

rule("to_entries", (t, c) => {
  const type = outputType(t, c);
  const entry = parts(type.value);
  const valueType = entry.fields["value"]!;
  const out = t.declare(c.$, t.emptyArray(entry), "entries");
  const x = t.open(input(t, c));
  const xt = t.type(x);
  if (xt.type === "Struct") {
    const s = t.bind(c.$, x, "struct");
    for (const name of Object.keys(xt.fields as object)) {
      t.push(c.$, out, t.struct(entry, { key: t.str(name, c.path), value: t.widenTo(c.$, t.field(s, name), valueType, c.path) }), c.path);
    }
  } else if (xt.type === "Dict") {
    t.forEach(c.$, x, ($, value, key) => t.push($, out, t.struct(entry, { key: key!, value: t.widenTo($, value, valueType, c.path) }), c.path), c.path);
  } else {
    const array = t.asArray(c.$, x, c.path);
    if (array === undefined) { cannot(t, c, c.$, x, "a dict, a struct or an array"); return; }
    t.forEach(c.$, array, ($, value, index) => t.push($, out, t.struct(entry, { key: index!, value: t.widenTo($, value, valueType, c.path) }), c.path), c.path);
  }
  c.emit(c.$, out);
});

/** The key and value fields a from_entries entry can have, as jq accepts them. */
const KEY_FIELDS = ["key", "k", "name", "Name", "K", "Key"];
const VALUE_FIELDS = ["value", "v", "Value", "V"];

/** Adds `{key, value}` entries to a dict. */
function addEntry(t: Translator, c: CallSite, $: Block, dict: Expr, entry: Expr): void {
  const e = t.open(entry);
  const fields = t.type(e).fields as Record<string, EastType>;
  const key = KEY_FIELDS.find(k => k in fields);
  const value = VALUE_FIELDS.find(v => v in fields);
  if (key === undefined) throw t.gap("a from_entries entry without a key");
  const s = t.bind($, e, "entry");
  t.put($, dict, t.field(s, key), value === undefined ? t.null(c.path) : t.field(s, value), c.path);
}

rule("from_entries", (t, c) => {
  const dict = t.declare(c.$, t.value(new Map(), outputType(t, c)), "dict");
  t.forEach(c.$, input(t, c), ($, entry) => addEntry(t, c, $, dict, entry), c.path, "entry");
  c.emit(c.$, dict);
});

rule("with_entries", (t, c) => {
  const dict = t.declare(c.$, t.value(new Map(), outputType(t, c)), "dict");
  const x = t.open(input(t, c));
  const xt = t.type(x);
  const each = ($: Block, entry: Expr): void => arg(t, c, 0, $, entry, ($2, mapped) => addEntry(t, c, $2, dict, mapped));
  if (xt.type === "Dict") {
    const entryType = StructType({ key: xt.key as EastType, value: xt.value as EastType });
    t.forEach(c.$, x, ($, value, key) => each($, t.bind($, t.struct(entryType, { key: key!, value }), "entry")), c.path);
  } else if (xt.type === "Struct") {
    let valueType: EastType | undefined;
    for (const f of Object.values(xt.fields as Record<string, EastType>)) valueType = valueType === undefined ? f : unifyOrFail(t, valueType, f);
    const entryType = StructType({ key: StringType, value: valueType ?? NullType });
    const s = t.bind(c.$, x, "struct");
    for (const name of Object.keys(xt.fields as object)) {
      each(c.$, t.bind(c.$, t.struct(entryType, { key: t.str(name, c.path), value: t.widenTo(c.$, t.field(s, name), valueType!, c.path) }), "entry"));
    }
  } else {
    cannot(t, c, c.$, x, "a dict or a struct");
    return;
  }
  c.emit(c.$, dict);
});

/** The one type two types unify to. */
function unifyOrFail(t: Translator, a: EastType, b: EastType): EastType {
  const u = unify(a, b);
  if (u === undefined) throw t.gap(`${printType(a)} and ${printType(b)} have no one type`);
  return u;
}

rule("pick", (t, c) => {
  let node = c.args[0]!;
  const names: string[] = [];
  while (node.type === "field") { names.unshift(node.value.name); node = node.value.target; }
  const build = ($: Block, v: Expr, rest: readonly string[]): Expr => {
    // `null`'s fields are null.
    const inner = t.type(v).type === "Null" ? t.null(c.path) : t.field(v, rest[0]!);
    const picked = rest.length === 1 ? inner : build($, t.bind($, inner, rest[0]!), rest.slice(1));
    return t.struct(StructType({ [rest[0]!]: t.type(picked) }), { [rest[0]!]: picked });
  };
  c.emit(c.$, build(c.$, t.bind(c.$, t.open(input(t, c)), "value"), names));
});

rule("transpose", (t, c) => {
  const type = outputType(t, c);
  // No rows, so nothing to transpose.
  if ((parts(t.type(t.open(input(t, c)))).value as EastType).type === "Never") { c.emit(c.$, t.value([], type, c.path)); return; }
  const row = parts(type.value);
  const cell = row.value;
  const rows = t.bind(c.$, t.open(input(t, c)), "rows");
  const width = t.declare(c.$, t.int(0), "width");
  t.forEach(c.$, rows, ($, r) => t.ifElse($, t.lt(width, t.size(r, c.path), c.path), $2 => t.assign($2, width, t.size(r, c.path)), undefined, c.path), c.path, "row");
  const out = t.declare(c.$, t.emptyArray(row), "transposed");
  const i = t.declare(c.$, t.int(0), "column");
  t.whileLoop(c.$, t.lt(i, width, c.path), $ => {
    const column = t.declare($, t.emptyArray(cell), "cells");
    t.forEach($, rows, ($2, r) => {
      const inner = t.type(r).value as EastType;
      t.push($2, column, t.widenTo($2, t.b("ArrayTryGet", [inner], [r, i], OptionType(inner), c.path), cell, c.path), c.path);
    }, c.path, "row");
    t.push($, out, column, c.path);
    t.assign($, i, t.add(i, t.int(1), c.path));
  }, c.path);
  c.emit(c.$, out);
});

// ─── Collections ─────────────────────────────────────────────────────────

rule("length", (t, c) => {
  const x = t.open(input(t, c));
  const length = ($: Block, v: Expr, emit: Emit): void => {
    const o = t.open(v);
    const ty = t.type(o);
    switch (ty.type) {
      case "Null": emit($, t.int(0)); return;
      case "String": emit($, t.b("StringLength", [], [o], IntegerType, c.path)); return;
      case "Array": emit($, t.size(o, c.path)); return;
      case "Set": emit($, t.b("SetSize", [ty.key as EastType], [o], IntegerType, c.path)); return;
      case "Dict": emit($, t.b("DictSize", [ty.key as EastType, ty.value as EastType], [o], IntegerType, c.path)); return;
      case "Vector": emit($, t.b("VectorLength", [ty.element as EastType], [o], IntegerType, c.path)); return;
      case "Matrix": emit($, t.b("MatrixRows", [ty.element as EastType], [o], IntegerType, c.path)); return;
      case "Blob": emit($, t.b("BlobSize", [], [o], IntegerType, c.path)); return;
      case "Struct": emit($, t.int(Object.keys(ty.fields as object).length)); return;
      case "Integer": emit($, t.b("IntegerAbs", [], [o], IntegerType, c.path)); return;
      case "Float": emit($, t.b("FloatAbs", [], [o], FloatType, c.path)); return;
      case "Variant":
        if (nullablePayload(ty) !== undefined) {
          t.match($, o, { none: $2 => emit($2, t.int(0)), some: ($2, p) => length($2, p, emit) }, c.path);
          return;
        }
        // jq sees a variant as {type, value}.
        emit($, t.int(2));
        return;
      default:
        cannot(t, c, $, o, "a value with a length");
    }
  };
  length(c.$, x, c.emit);
});

rule("utf8bytelength", (t, c) => {
  c.emit(c.$, t.b("BlobSize", [], [t.b("StringEncodeUtf8", [], [t.open(input(t, c))], BlobType, c.path)], IntegerType, c.path));
});

const compareString = compareFor(StringType);

rule(["keys", "keys_unsorted"], (t, c) => {
  const x = t.open(input(t, c));
  const xt = t.type(x);
  if (xt.type === "Dict") {
    const K = xt.key as EastType;
    const out = t.declare(c.$, t.emptyArray(K), "keys");
    t.forEach(c.$, x, ($, _value, key) => t.push($, out, key!, c.path), c.path);
    c.emit(c.$, out);
    return;
  }
  if (xt.type === "Struct") {
    const names = Object.keys(xt.fields as object);
    c.emit(c.$, t.value(c.name === "keys" ? [...names].sort(compareString) : names, ArrayType(StringType), c.path));
    return;
  }
  if (xt.type === "Variant") { c.emit(c.$, t.value(["type", "value"], ArrayType(StringType), c.path)); return; }
  const array = t.asArray(c.$, x, c.path);
  if (array === undefined) { cannot(t, c, c.$, x, "a dict, a struct or an array"); return; }
  c.emit(c.$, t.b("ArrayRange", [], [t.int(0), t.size(array, c.path), t.int(1)], ArrayType(IntegerType), c.path));
});

/** Whether a container has a key: a dict's key, a struct's field name, an array's index. */
function has(t: Translator, c: CallSite, $: Block, container: Expr, key: Expr): Expr | undefined {
  const o = t.open(container);
  const ot = t.type(o);
  if (ot.type === "Dict") return t.b("DictHas", [ot.key as EastType, ot.value as EastType], [o, t.widenTo($, key, ot.key as EastType, c.path)], BooleanType, c.path);
  if (ot.type === "Struct") {
    const names = Object.keys(ot.fields as object);
    const known = t.constant(key)?.value;
    if (typeof known === "string") return t.bool(names.includes(known), c.path);
    return t.b("SetHas", [StringType], [t.value(new SortedSet(names, compareString), SetType(StringType), c.path), key], BooleanType, c.path);
  }
  const array = t.asArray($, o, c.path);
  if (array === undefined) return undefined;
  const k = t.bind($, key, "index");
  return t.b("BooleanAnd", [], [t.b("LessEqual", [IntegerType], [t.int(0), k], BooleanType, c.path), t.lt(k, t.size(array, c.path), c.path)], BooleanType, c.path);
}

rule("has", (t, c) => values(t, c, [0], c.$, ($, [key]) => {
  const x = input(t, c);
  const result = has(t, c, $, x, key!);
  if (result === undefined) { cannot(t, c, $, x, "a dict, a struct or an array"); return; }
  c.emit($, result);
}));

rule("in", (t, c) => {
  const x = input(t, c);
  arg(t, c, 0, c.$, c.x, ($, container) => {
    const result = has(t, c, $, container, x);
    if (result === undefined) { cannot(t, c, $, container, "a dict, a struct or an array"); return; }
    c.emit($, result);
  });
});

rule("map", (t, c) => {
  const element = outputType(t, c).value as EastType;
  const out = t.declare(c.$, t.emptyArray(element), "mapped");
  t.iterate(c.$, input(t, c), false, c.path, ($, item) => arg(t, c, 0, $, item, ($2, v) => t.push($2, out, v, c.path)));
  c.emit(c.$, out);
});

rule("map_values", (t, c) => {
  const x = t.open(input(t, c));
  const xt = t.type(x);
  const type = outputType(t, c);
  const first = ($: Block, v: Expr, then: ($2: Block, w: Expr) => void): void => {
    t.once($, ($2, label) => arg(t, c, 0, $2, v, ($3, w) => { then($3, w); t.brk($3, label); }), c.path);
  };
  if (xt.type === "Array") {
    const out = t.declare(c.$, t.emptyArray(type.value as EastType), "mapped");
    t.forEach(c.$, x, ($, item) => first($, item, ($2, w) => t.push($2, out, w, c.path)), c.path);
    c.emit(c.$, out);
    return;
  }
  if (xt.type === "Dict") {
    const out = t.declare(c.$, t.value(new Map(), type), "mapped");
    t.forEach(c.$, x, ($, item, key) => first($, item, ($2, w) => t.stmt($2, t.b("DictInsert", [type.key as EastType, type.value as EastType], [out, key!, t.widenTo($2, w, type.value as EastType, c.path)], NullType, c.path))), c.path);
    c.emit(c.$, out);
    return;
  }
  if (xt.type === "Struct") {
    const s = t.bind(c.$, x, "struct");
    const fields: Record<string, Expr> = {};
    for (const [name, f] of Object.entries(type.fields as Record<string, EastType>)) {
      const value = t.field(s, name);
      fields[name] = t.bind(c.$, t.one(c.args[0]!, c.argPaths[0]!, c.$, value, c.env, f), name);
    }
    c.emit(c.$, t.struct(type, fields));
    return;
  }
  cannot(t, c, c.$, x, "an array, a dict or a struct");
});

/** `a + b` for `add`, as the checker types it: numbers, strings, arrays, dicts; struct merges. */
function addInto(t: Translator, c: CallSite, $: Block, acc: Expr, v: Expr, type: EastType): void {
  const o = t.open(v);
  const ot = t.type(o);
  if (ot.type === "Null") return;
  if (nullablePayload(ot) !== undefined) {
    t.match($, o, { some: ($2, p) => addInto(t, c, $2, acc, p, type) }, c.path);
    return;
  }
  switch (type.type) {
    case "Integer": t.assign($, acc, t.b("IntegerAdd", [], [acc, o], IntegerType, c.path)); return;
    case "Float": t.assign($, acc, t.b("FloatAdd", [], [acc, float(t, $, o, c.path)], FloatType, c.path)); return;
    case "String": t.assign($, acc, t.concat(acc, o, c.path)); return;
    case "Array": t.stmt($, t.b("ArrayAppend", [type.value as EastType], [acc, t.widenTo($, o, type, c.path)], NullType, c.path)); return;
    case "Dict": t.forEach($, t.widenTo($, o, type, c.path), ($2, value, key) => t.put($2, acc, key!, value, c.path), c.path); return;
    default: {
      // Structs of one type: the later one's fields win, which is all of them.
      const payload = nullablePayload(type);
      if (payload !== undefined) { t.assign($, acc, t.some(t.widenTo($, o, payload, c.path), type)); return; }
      throw t.gap(`add of ${printType(ot)}`);
    }
  }
}

rule("add", (t, c) => {
  const type = outputType(t, c);
  if (type.type === "Null") {
    // The values' type has no identity to add: jq's null.
    if (c.args.length === 1) arg(t, c, 0, c.$, c.x, () => {});
    c.emit(c.$, t.null(c.path));
    return;
  }
  const start = type.type === "Integer" ? t.int(0) : type.type === "Float" ? t.float(0) : type.type === "String" ? t.str("")
    : type.type === "Array" ? t.emptyArray(type.value as EastType) : type.type === "Dict" ? t.value(new Map(), type) : t.none(type);
  const acc = t.declare(c.$, start, "sum");
  const each = ($: Block, v: Expr): void => addInto(t, c, $, acc, v, type);
  if (c.args.length === 1) arg(t, c, 0, c.$, c.x, each);
  else t.iterate(c.$, input(t, c), false, c.path, each);
  c.emit(c.$, acc);
});

rule(["any", "all"], (t, c) => {
  const any = c.name === "any";
  // any: true at the first true; all: false at the first false.
  const result = t.declare(c.$, t.bool(!any), "result");
  const test = ($: Block, v: Expr, label: Label): void => {
    const truth = t.truthy(v, c.path);
    t.branch($, any ? truth : negate(t, truth, c.path), $2 => { t.assign($2, result, t.bool(any)); t.brk($2, label); }, () => {}, c.path);
  };
  t.once(c.$, ($, label) => {
    if (c.args.length === 2) {
      arg(t, c, 0, $, c.x, ($2, g) => arg(t, c, 1, $2, g, ($3, v) => test($3, v, label)));
    } else if (c.args.length === 1) {
      t.iterate($, input(t, c), false, c.path, ($2, item) => arg(t, c, 0, $2, item, ($3, v) => test($3, v, label)));
    } else {
      t.iterate($, input(t, c), false, c.path, ($2, item) => test($2, item, label));
    }
  }, c.path);
  c.emit(c.$, result);
});

rule("flatten", (t, c) => {
  const type = outputType(t, c);
  const element = type.value as EastType;
  const out = t.declare(c.$, t.emptyArray(element), "flat");
  const into = ($: Block, v: Expr): void => {
    const vt = t.type(t.open(v));
    if (isTypeEqual(vt, element) || vt.type !== "Array") { t.push($, out, v, c.path); return; }
    t.forEach($, v, ($2, item) => into($2, item), c.path);
  };
  t.forEach(c.$, input(t, c), ($, item) => into($, item), c.path);
  c.emit(c.$, out);
});

/** An array's elements as an array. */
function elementsOf(t: Translator, c: CallSite, $: Block): Expr | undefined {
  return t.asArray($, t.open(input(t, c)), c.path);
}

/** Sorts an array by East's total order of a key the function gives each element. */
function sortBy(t: Translator, c: CallSite, array: Expr, keyType: EastType, key: (item: Expr) => Expr): Expr {
  const element = t.type(array).value as EastType;
  const fn = t.lambda([element], keyType, ["item"], (_$f, item) => key(item), c.path);
  return t.b("ArraySort", [element, keyType], [array, fn], t.type(array), c.path);
}

rule("sort", (t, c) => {
  const array = elementsOf(t, c, c.$);
  if (array === undefined) { cannot(t, c, c.$, input(t, c), "an array"); return; }
  const element = t.type(array).value as EastType;
  c.emit(c.$, sortBy(t, c, array, element, item => item));
});

/**
 * Each element with the key a filter gives it, as jq keys `sort_by(f)`: the
 * filter's one output, or the array of its outputs.
 */
function keyed(t: Translator, c: CallSite, $: Block): { pairs: Expr; keyType: EastType; element: EastType } | undefined {
  const array = elementsOf(t, c, $);
  if (array === undefined) { cannot(t, c, $, input(t, c), "an array"); return undefined; }
  const element = t.type(array).value as EastType;
  const sample = t.placeholder(element);
  const one = argIsOne(t, c, 0, sample);
  const outputKey = argType(t, c, 0, sample);
  const keyType = one ? outputKey : ArrayType(outputKey);
  const Pair = StructType({ key: keyType, value: element });
  const pairs = t.declare($, t.emptyArray(Pair), "keyed");
  t.forEach($, array, ($2, item) => {
    if (one) {
      const key = t.one(c.args[0]!, c.argPaths[0]!, $2, item, c.env, keyType);
      t.push($2, pairs, t.struct(Pair, { key, value: item }), c.path);
      return;
    }
    const keys = t.declare($2, t.emptyArray(outputKey), "keys");
    arg(t, c, 0, $2, item, ($3, k) => t.push($3, keys, k, c.path));
    t.push($2, pairs, t.struct(Pair, { key: keys, value: item }), c.path);
  }, c.path);
  return { pairs, keyType, element };
}

/** Pairs sorted by their keys (stable). */
function sortPairs(t: Translator, c: CallSite, pairs: Expr, keyType: EastType): Expr {
  return sortBy(t, c, pairs, keyType, pair => t.field(pair, "key"));
}

rule("sort_by", (t, c) => {
  const k = keyed(t, c, c.$);
  if (k === undefined) return;
  const sorted = t.bind(c.$, sortPairs(t, c, k.pairs, k.keyType), "sorted");
  const out = t.declare(c.$, t.emptyArray(k.element), "sorted");
  t.forEach(c.$, sorted, ($, pair) => t.push($, out, t.field(pair, "value"), c.path), c.path, "pair");
  c.emit(c.$, out);
});

/** Runs of equal keys in sorted pairs, as arrays of their values, in key order. */
function groups(t: Translator, c: CallSite, $: Block, k: { pairs: Expr; keyType: EastType; element: EastType }, each: ($: Block, group: Expr) => void): void {
  const sorted = t.bind($, sortPairs(t, c, k.pairs, k.keyType), "sorted");
  const group = t.declare($, t.emptyArray(k.element), "group");
  const last = t.declare($, t.none(OptionType(k.keyType)), "key");
  t.forEach($, sorted, ($2, pair) => {
    const key = t.bind($2, t.field(pair, "key"), "key");
    const same = t.matchValue(last, { none: () => t.bool(false), some: (_$3, previous) => t.eq(previous, key, c.path) }, BooleanType, c.path);
    t.ifElse($2, t.not(same, c.path), $3 => {
      t.ifElse($3, t.lt(t.int(0), t.size(group, c.path), c.path), $4 => {
        each($4, t.bind($4, t.b("ArrayCopy", [k.element], [group], ArrayType(k.element), c.path), "group"));
        t.stmt($4, t.b("ArrayClear", [k.element], [group], NullType, c.path));
      }, undefined, c.path);
      t.assign($3, last, t.some(key, OptionType(k.keyType)));
    }, undefined, c.path);
    t.push($2, group, t.field(pair, "value"), c.path);
  }, c.path, "pair");
  t.ifElse($, t.lt(t.int(0), t.size(group, c.path), c.path), $2 => each($2, group), undefined, c.path);
}

rule("group_by", (t, c) => {
  const k = keyed(t, c, c.$);
  if (k === undefined) return;
  const out = t.declare(c.$, t.emptyArray(ArrayType(k.element)), "groups");
  groups(t, c, c.$, k, ($, group) => t.push($, out, group, c.path));
  c.emit(c.$, out);
});

rule("unique_by", (t, c) => {
  const k = keyed(t, c, c.$);
  if (k === undefined) return;
  const out = t.declare(c.$, t.emptyArray(k.element), "unique");
  groups(t, c, c.$, k, ($, group) => t.push($, out, t.b("ArrayGet", [k.element], [group, t.int(0)], k.element, c.path), c.path));
  c.emit(c.$, out);
});

rule(["min_by", "max_by"], (t, c) => {
  const k = keyed(t, c, c.$);
  if (k === undefined) return;
  const min = c.name === "min_by";
  const Pair = t.type(k.pairs).value as EastType;
  const best = t.declare(c.$, t.none(OptionType(Pair)), "best");
  t.forEach(c.$, k.pairs, ($, pair) => {
    // The first least for min_by, the last greatest for max_by, as jq keeps them.
    const better = t.matchValue(best, {
      none: () => t.bool(true),
      some: (_$2, b) => min ? t.lt(t.field(pair, "key"), t.field(b, "key"), c.path) : t.b("GreaterEqual", [k.keyType], [t.field(pair, "key"), t.field(b, "key")], BooleanType, c.path),
    }, BooleanType, c.path);
    t.ifElse($, better, $2 => t.assign($2, best, t.some(pair, OptionType(Pair))), undefined, c.path);
  }, c.path, "pair");
  const option = OptionType(k.element);
  c.emit(c.$, t.matchValue(best, { none: () => t.none(option), some: (_$, b) => t.some(t.field(b, "value"), option) }, option, c.path));
});

rule("unique", (t, c) => {
  const array = elementsOf(t, c, c.$);
  if (array === undefined) { cannot(t, c, c.$, input(t, c), "an array"); return; }
  const element = t.type(array).value as EastType;
  const sorted = t.bind(c.$, sortBy(t, c, array, element, item => item), "sorted");
  const out = t.declare(c.$, t.emptyArray(element), "unique");
  t.forEach(c.$, sorted, ($, item) => {
    const size = t.bind($, t.size(out, c.path), "size");
    const repeat = t.ifValue(t.lt(t.int(0), size, c.path),
      () => t.eq(t.b("ArrayGet", [element], [out, t.add(size, t.int(-1), c.path)], element, c.path), item, c.path),
      () => t.bool(false), BooleanType, c.path);
    t.ifElse($, t.not(repeat, c.path), $2 => t.push($2, out, item, c.path), undefined, c.path);
  }, c.path);
  c.emit(c.$, out);
});

rule(["min", "max"], (t, c) => {
  const array = elementsOf(t, c, c.$);
  if (array === undefined) { cannot(t, c, c.$, input(t, c), "an array"); return; }
  const element = t.type(array).value as EastType;
  const option = OptionType(element);
  const best = t.declare(c.$, t.none(option), "best");
  t.forEach(c.$, array, ($, item) => {
    const better = t.matchValue(best, {
      none: () => t.bool(true),
      some: (_$2, b) => c.name === "min" ? t.lt(item, b, c.path) : t.b("GreaterEqual", [element], [item, b], BooleanType, c.path),
    }, BooleanType, c.path);
    t.ifElse($, better, $2 => t.assign($2, best, t.some(item, option)), undefined, c.path);
  }, c.path);
  c.emit(c.$, t.widenTo(c.$, best, outputType(t, c), c.path));
});

rule("reverse", (t, c) => {
  const x = t.open(input(t, c));
  const xt = t.type(x);
  if (xt.type === "Null") { c.emit(c.$, t.emptyArray(outputType(t, c).value as EastType)); return; }
  if (xt.type === "String") {
    const codePoints = t.b("StringSplit", [], [x, t.str("")], ArrayType(StringType), c.path);
    c.emit(c.$, t.b("ArrayStringJoin", [], [t.b("ArrayReverse", [StringType], [codePoints], ArrayType(StringType), c.path), t.str("")], StringType, c.path));
    return;
  }
  const array = t.asArray(c.$, x, c.path);
  if (array === undefined) { cannot(t, c, c.$, x, "an array or a string"); return; }
  c.emit(c.$, t.b("ArrayReverse", [t.type(array).value as EastType], [array], t.type(array), c.path));
});

/**
 * Whether `a` holds `b`, as jq's `contains` decides it: a string its
 * substrings; an array an array whose every element some element of it
 * holds; a struct or a dict one whose every field or key it has, holding its
 * value; any other value an equal one.
 */
function contains(t: Translator, c: CallSite, $: Block, a: Expr, b: Expr): Expr {
  const va = t.open(a);
  const vb = t.open(b);
  const ta = t.type(va);
  const tb = t.type(vb);
  if (ta.type === "String" && tb.type === "String") return t.b("StringContains", [], [va, vb], BooleanType, c.path);
  if (ta.type === "Array" && tb.type === "Array") {
    // `[]` is held by every array, and an empty array holds only `[]`.
    if ((tb.value as EastType).type === "Never") return t.bool(true, c.path);
    if ((ta.value as EastType).type === "Never") return t.eq(t.size(vb, c.path), t.int(0), c.path);
    const outer = t.bind($, va, "outer");
    const all = t.declare($, t.bool(true), "contains");
    t.forEach($, vb, ($2, wanted, _k, each) => {
      const found = t.declare($2, t.bool(false), "found");
      t.forEach($2, outer, ($3, item, _k2, inner) => {
        t.ifElse($3, contains(t, c, $3, item, wanted), $4 => { t.assign($4, found, t.bool(true)); t.brk($4, inner); }, undefined, c.path);
      }, c.path);
      t.ifElse($2, t.not(found, c.path), $3 => { t.assign($3, all, t.bool(false)); t.brk($3, each); }, undefined, c.path);
    }, c.path, "wanted");
    return all;
  }
  if (ta.type === "Struct" && tb.type === "Struct") {
    const fields = ta.fields as Record<string, EastType>;
    const outer = t.bind($, va, "outer");
    const inner = t.bind($, vb, "inner");
    let all: Expr | undefined;
    for (const name of Object.keys(tb.fields as object)) {
      // A field the outer struct lacks is not held.
      if (!(name in fields)) return t.bool(false, c.path);
      const held = t.bind($, contains(t, c, $, t.field(outer, name), t.field(inner, name)), "held");
      all = all === undefined ? held : t.b("BooleanAnd", [], [all, held], BooleanType, c.path);
    }
    return all ?? t.bool(true, c.path);
  }
  // `{}` is held by every dict.
  if (ta.type === "Dict" && tb.type === "Struct") return t.bool(true, c.path);
  if (ta.type === "Dict" && tb.type === "Dict") {
    const K = ta.key as EastType;
    const V = ta.value as EastType;
    const outer = t.bind($, va, "outer");
    const all = t.declare($, t.bool(true), "contains");
    t.forEach($, vb, ($2, value, key, label) => {
      t.match($2, t.b("DictTryGet", [K, V], [outer, key!], OptionType(V), c.path), {
        none: $3 => { t.assign($3, all, t.bool(false)); t.brk($3, label); },
        some: ($3, held) => t.ifElse($3, t.not(contains(t, c, $3, held, value), c.path), $4 => { t.assign($4, all, t.bool(false)); t.brk($4, label); }, undefined, c.path),
      }, c.path);
    }, c.path);
    return all;
  }
  // Values of two kinds (a lenient place lets them by) raise, as jq does.
  const [ka, kb] = [jqTypeNames(ta)[0], jqTypeNames(tb)[0]];
  if (ka !== kb || ["array", "object"].includes(ka ?? "")) return t.failure(`${ka ?? "a value"} and ${kb ?? "a value"} cannot have their containment checked`, c.path);
  return t.compare($, "==", va, vb, c.path);
}

rule("contains", (t, c) => values(t, c, [0], c.$, ($, [b]) => t.give($, contains(t, c, $, input(t, c), b!), c.emit)));
rule("inside", (t, c) => values(t, c, [0], c.$, ($, [b]) => t.give($, contains(t, c, $, b!, input(t, c)), c.emit)));

/** Every index where a string occurs in another, overlapping ones included, in code points. */
function indices(t: Translator, c: CallSite, $: Block, s: Expr, sub: Expr): Expr {
  const out = t.declare($, t.emptyArray(IntegerType), "indices");
  const length = t.declare($, t.b("StringLength", [], [s], IntegerType, c.path), "length", false);
  t.ifElse($, t.lt(t.int(0), t.b("StringLength", [], [sub], IntegerType, c.path), c.path), $2 => {
    const from = t.declare($2, t.int(0), "from");
    t.whileLoop($2, true, ($3, label) => {
      const rest = t.b("StringSubstring", [], [s, from, length], StringType, c.path);
      const at = t.declare($3, t.b("StringIndexOf", [], [rest, sub], IntegerType, c.path), "at", false);
      t.ifElse($3, t.lt(at, t.int(0), c.path), $4 => t.brk($4, label), undefined, c.path);
      t.push($3, out, t.add(from, at, c.path), c.path);
      t.assign($3, from, t.add(t.add(from, at, c.path), t.int(1), c.path));
    }, c.path);
  }, undefined, c.path);
  return out;
}

/**
 * Every position at which an array holds an element equal to a value, or,
 * for an array, a run of elements equal to its elements; an empty run is
 * found nowhere, as in jq.
 */
function indicesIn(t: Translator, c: CallSite, $: Block, array: Expr, x: Expr): Expr {
  const out = t.declare($, t.emptyArray(IntegerType), "indices");
  const a = t.bind($, array, "array");
  const E = t.type(a).value as EastType;
  const xo = t.open(x);
  if (t.type(xo).type !== "Array") {
    t.forEach($, a, ($2, item, index) => t.ifElse($2, t.compare($2, "==", item, xo, c.path), $3 => t.push($3, out, index!, c.path), undefined, c.path), c.path);
    return out;
  }
  const run = t.bind($, xo, "run");
  const n = t.declare($, t.size(run, c.path), "length", false);
  const last = t.declare($, t.b("IntegerSubtract", [], [t.size(a, c.path), n], IntegerType, c.path), "last", false);
  t.ifElse($, t.lt(t.int(0), n, c.path), $2 => {
    const i = t.declare($2, t.int(0), "start");
    t.whileLoop($2, t.b("LessEqual", [IntegerType], [i, last], BooleanType, c.path), $3 => {
      const same = t.declare($3, t.bool(true), "same");
      t.forEach($3, run, ($4, wanted, k, label) => {
        const item = t.b("ArrayGet", [E], [a, t.add(i, k!, c.path)], E, c.path);
        t.ifElse($4, t.not(t.compare($4, "==", item, wanted, c.path), c.path), $5 => { t.assign($5, same, t.bool(false)); t.brk($5, label); }, undefined, c.path);
      }, c.path, "wanted");
      t.ifElse($3, same, $4 => t.push($4, out, i, c.path), undefined, c.path);
      t.assign($3, i, t.add(i, t.int(1), c.path));
    }, c.path);
  }, undefined, c.path);
  return out;
}

rule(["index", "rindex", "indices"], (t, c) => values(t, c, [0], c.$, ($, [sub]) => {
  const x = t.open(input(t, c));
  const all = t.type(x).type === "String" ? indices(t, c, $, x, sub!) : indicesIn(t, c, $, x, sub!);
  if (c.name === "indices") { c.emit($, all); return; }
  const option = OptionType(IntegerType);
  const size = t.bind($, t.size(all, c.path), "count");
  c.emit($, t.ifValue(t.eq(size, t.int(0), c.path), () => t.none(option),
    () => t.some(t.b("ArrayGet", [IntegerType], [all, c.name === "index" ? t.int(0) : t.add(size, t.int(-1), c.path)], IntegerType, c.path), option), option, c.path));
}));

rule("bsearch", (t, c) => values(t, c, [0], c.$, ($, [target]) => {
  const array = elementsOf(t, c, $);
  if (array === undefined) { cannot(t, c, $, input(t, c), "a sorted array"); return; }
  const element = t.type(array).value as EastType;
  const common = unifyOrFail(t, element, t.type(target!));
  const a = t.bind($, isTypeEqual(common, element) ? array : t.widenTo($, array, ArrayType(common), c.path), "sorted");
  const x = t.bind($, t.widenTo($, target!, common, c.path), "target");
  const identity = t.lambda([common], common, ["item"], (_$f, item) => item, c.path);
  // The first position whose element is not less than the target: where it is, or would be inserted.
  const at = t.declare($, t.b("ArrayFindSortedFirst", [common, common], [a, x, identity], IntegerType, c.path), "at", false);
  const found = t.declare($, t.bool(false), "found");
  t.ifElse($, t.lt(at, t.size(a, c.path), c.path), $2 => t.assign($2, found, t.eq(t.b("ArrayGet", [common], [a, at], common, c.path), x, c.path)), undefined, c.path);
  // jq's −1 − the insertion point when the value is not there.
  c.emit($, t.ifValue(found, () => at, () => t.b("IntegerSubtract", [], [t.int(-1), at], IntegerType, c.path), IntegerType, c.path));
}));

/**
 * A scalar as text for join and the text formats: a string as it is, an
 * Integer in decimal, a Float as JSON writes it (no `.0` on a whole one), a
 * boolean as `true` or `false`, and null as `nullText`.
 */
function cellText(t: Translator, $: Block, v: Expr, path: string, nullText: string): Expr {
  const o = t.open(v);
  const ot = t.type(o);
  if (ot.type === "String") return o;
  if (ot.type === "Null") return t.str(nullText, path);
  if (nullablePayload(ot) !== undefined) {
    return t.matchValue(o, { none: () => t.str(nullText, path), some: ($2, p) => cellText(t, $2, p, path, nullText) }, StringType, path);
  }
  if (ot.type === "Float") return t.b("StringPrintJSON", [ot], [o], StringType, path);
  return t.b("Print", [ot], [o], StringType, path);
}

rule("join", (t, c) => values(t, c, [0], c.$, ($, [sep]) => {
  const parts = t.declare($, t.emptyArray(StringType), "parts");
  t.forEach($, input(t, c), ($2, item) => t.push($2, parts, cellText(t, $2, item, c.path, ""), c.path), c.path);
  c.emit($, t.b("ArrayStringJoin", [], [parts, sep!], StringType, c.path));
}));

// ─── Types and conversion ────────────────────────────────────────────────

rule("type", (t, c) => {
  const x = t.open(input(t, c));
  const payload = nullablePayload(t.type(x));
  if (payload !== undefined) {
    const name = jqTypeNames(payload)[0] ?? "null";
    c.emit(c.$, t.matchValue(x, { none: () => t.str("null", c.path), some: () => t.str(name, c.path) }, StringType, c.path));
    return;
  }
  c.emit(c.$, t.str(jqTypeNames(t.type(x))[0] ?? "null", c.path));
});

/** A type selector (`numbers`, `values`, …): the input when its kind is kept; `maybe` tests the value itself. */
function selector(keep: (type: EastType) => "keep" | "drop" | "maybe", test?: (t: Translator, $: Block, v: Expr, path: string) => Expr): BuiltinRule {
  return (t, c) => {
    const x = t.open(input(t, c));
    const xt = t.type(x);
    const emitKept = ($: Block, v: Expr, verdict: "keep" | "drop" | "maybe"): void => {
      if (verdict === "keep") { c.emit($, v); return; }
      if (verdict === "maybe" && test !== undefined) t.ifElse($, test(t, $, v, c.path), $2 => c.emit($2, v), undefined, c.path);
    };
    const payload = nullablePayload(xt);
    if (payload !== undefined) {
      const inner = keep(unwrap(payload));
      const nullKept = keep(NullType);
      if (inner === "drop" && nullKept === "drop") return;
      if (inner !== "drop" && nullKept !== "drop") { c.emit(c.$, x); return; }
      t.match(c.$, x, {
        none: $ => { if (nullKept !== "drop") c.emit($, t.null(c.path)); },
        some: ($, p) => emitKept($, p, inner),
      }, c.path);
      return;
    }
    emitKept(c.$, x, keep(xt));
  };
}

function isScalar(type: EastType): boolean {
  const u = unwrap(type);
  const payload = nullablePayload(u);
  if (payload !== undefined) return isScalar(payload);
  return !["Array", "Set", "Dict", "Struct", "Vector", "Matrix", "Variant"].includes(u.type);
}

const arrayLike = (type: EastType): boolean => ["Array", "Set", "Vector", "Matrix"].includes(type.type);

rule("arrays", selector(ty => arrayLike(ty) ? "keep" : "drop"));
rule("objects", selector(ty => ty.type === "Struct" || ty.type === "Dict" || ty.type === "Variant" ? "keep" : "drop"));
rule("iterables", selector(ty => arrayLike(ty) || ty.type === "Struct" || ty.type === "Dict" ? "keep" : "drop"));
rule("booleans", selector(ty => ty.type === "Boolean" ? "keep" : "drop"));
rule("numbers", selector(ty => isNumber(ty) ? "keep" : "drop"));
rule("strings", selector(ty => ty.type === "String" ? "keep" : "drop"));
rule("nulls", selector(ty => ty.type === "Null" ? "keep" : "drop"));
rule("values", selector(ty => ty.type === "Null" ? "drop" : "keep"));
rule("scalars", selector(ty => isScalar(ty) ? "keep" : "drop"));
rule("normals", selector(ty => isNumber(ty) ? "maybe" : "drop", (t, $, v, path) => isNormal(t, $, v, path)));
rule("finites", selector(ty => ty.type === "Integer" ? "keep" : ty.type === "Float" ? "maybe" : "drop", (t, $, v, path) => t.not(isInfiniteOrNan(t, $, v, path), path)));

/** Whether a number is NaN. */
function isNan(t: Translator, $: Block, v: Expr, path: string): Expr {
  return t.isNan(float(t, $, v, path), path);
}

function isInfinite(t: Translator, $: Block, v: Expr, path: string): Expr {
  const f = t.bind($, float(t, $, v, path), "number");
  return t.b("BooleanOr", [], [t.eq(f, t.float(Infinity), path), t.eq(f, t.float(-Infinity), path)], BooleanType, path);
}

function isInfiniteOrNan(t: Translator, $: Block, v: Expr, path: string): Expr {
  return t.b("BooleanOr", [], [isInfinite(t, $, v, path), isNan(t, $, v, path)], BooleanType, path);
}

function isNormal(t: Translator, $: Block, v: Expr, path: string): Expr {
  const f = t.bind($, float(t, $, v, path), "number");
  const magnitude = t.b("FloatAbs", [], [f], FloatType, path);
  return t.b("BooleanAnd", [], [t.not(isInfiniteOrNan(t, $, f, path), path), t.b("GreaterEqual", [FloatType], [magnitude, t.float(2 ** -1022)], BooleanType, path)], BooleanType, path);
}

rule("tostring", (t, c) => c.emit(c.$, t.tostring(c.$, input(t, c), c.path)));

/** East's JSON text of a value (§13.9). */
function tojson(t: Translator, v: Expr, path: string): Expr {
  const o = t.open(v);
  return t.b("StringPrintJSON", [t.type(o)], [o], StringType, path);
}

rule("tojson", (t, c) => c.emit(c.$, tojson(t, input(t, c), c.path)));

rule("tonumber", (t, c) => {
  const x = t.open(input(t, c));
  if (isNumber(t.type(x))) { c.emit(c.$, x); return; }
  c.emit(c.$, t.b("Parse", [FloatType], [x], FloatType, c.path));
});

rule("toboolean", (t, c) => {
  const x = t.open(input(t, c));
  if (t.type(x).type === "Boolean") { c.emit(c.$, x); return; }
  c.emit(c.$, t.b("Parse", [BooleanType], [x], BooleanType, c.path));
});

rule("builtins", (t, c) => {
  const names: string[] = [];
  for (const [name, b] of BUILTINS) {
    if (name.startsWith("@") || !(b.status === "supported" || (b.status === "tooling" && t.options.tooling === true))) continue;
    for (const arity of b.arities) names.push(`${name}/${arity}`);
  }
  c.emit(c.$, t.value(names.sort(compareString), ArrayType(StringType), c.path));
});

rule("infinite", (t, c) => c.emit(c.$, t.float(Infinity, c.path)));
rule("nan", (t, c) => c.emit(c.$, t.float(NaN, c.path)));
rule("isinfinite", (t, c) => c.emit(c.$, isInfinite(t, c.$, input(t, c), c.path)));
rule("isnan", (t, c) => c.emit(c.$, isNan(t, c.$, input(t, c), c.path)));
rule("isnormal", (t, c) => c.emit(c.$, isNormal(t, c.$, input(t, c), c.path)));
// jq's own definition: a number that is not infinite, so NaN is finite.
rule("isfinite", (t, c) => c.emit(c.$, t.not(isInfinite(t, c.$, input(t, c), c.path), c.path)));

// jq's `if . < 0 then -. else . end`: a value above every number is given back; null and a boolean raise.
rule("abs", (t, c) => {
  const x = t.open(input(t, c));
  const xt = t.type(x);
  if (xt.type === "Integer") c.emit(c.$, t.b("IntegerAbs", [], [x], IntegerType, c.path));
  else if (xt.type === "Float") c.emit(c.$, t.b("FloatAbs", [], [x], FloatType, c.path));
  else if (xt.type === "Null" || xt.type === "Boolean") t.negate(c.$, x, c.path, c.emit);
  else c.emit(c.$, x);
});

// ─── Strings ─────────────────────────────────────────────────────────────

/** A rule on a string input with value arguments. */
function onString(indices: readonly number[], body: (t: Translator, c: CallSite, $: Block, s: Expr, args: Expr[]) => void): BuiltinRule {
  return (t, c) => values(t, c, indices, c.$, ($, args) => {
    const s = t.open(input(t, c));
    if (t.type(s).type !== "String") { cannot(t, c, $, s, "a string"); return; }
    body(t, c, $, s, args);
  });
}

rule("startswith", onString([0], (t, c, $, s, [p]) => c.emit($, t.b("StringStartsWith", [], [s, p!], BooleanType, c.path))));
rule("endswith", onString([0], (t, c, $, s, [p]) => c.emit($, t.b("StringEndsWith", [], [s, p!], BooleanType, c.path))));

/** A string without a prefix, when it has it. */
function trimStart(t: Translator, $: Block, s: Expr, prefix: Expr, path: string): Expr {
  return t.ifValue(t.b("StringStartsWith", [], [s, prefix], BooleanType, path),
    () => t.b("StringSubstring", [], [s, t.b("StringLength", [], [prefix], IntegerType, path), t.b("StringLength", [], [s], IntegerType, path)], StringType, path),
    () => s, StringType, path);
}

function trimEnd(t: Translator, $: Block, s: Expr, suffix: Expr, path: string): Expr {
  return t.ifValue(t.b("StringEndsWith", [], [s, suffix], BooleanType, path),
    () => t.b("StringSubstring", [], [s, t.int(0), t.b("IntegerSubtract", [], [t.b("StringLength", [], [s], IntegerType, path), t.b("StringLength", [], [suffix], IntegerType, path)], IntegerType, path)], StringType, path),
    () => s, StringType, path);
}

rule(["ltrimstr", "rtrimstr", "trimstr"], onString([0], (t, c, $, x, [affix]) => {
  const s = t.bind($, x, "string");
  if (c.name === "ltrimstr") { c.emit($, trimStart(t, $, s, affix!, c.path)); return; }
  if (c.name === "rtrimstr") { c.emit($, trimEnd(t, $, s, affix!, c.path)); return; }
  c.emit($, trimEnd(t, $, t.bind($, trimStart(t, $, s, affix!, c.path), "trimmed"), affix!, c.path));
}));

for (const [name, builtin] of [["trim", "StringTrim"], ["ltrim", "StringTrimStart"], ["rtrim", "StringTrimEnd"], ["ascii_downcase", "StringLowerCase"], ["ascii_upcase", "StringUpperCase"]] as const) {
  rule(name, onString([], (t, c, $, s) => c.emit($, t.b(builtin, [], [s], StringType, c.path))));
}

rule("split", onString([0], (t, c, $, s, [sep]) => c.emit($, t.b("StringSplit", [], [s, sep!], ArrayType(StringType), c.path))));

/** A regex's flags, as written in the query: East's `i` when jq's is there. */
function regexFlags(t: Translator, c: CallSite, i: number | undefined): { flags: string; global: boolean } {
  if (i === undefined) return { flags: "", global: false };
  const literal = t.literalOf(c.args[i]);
  const text = literal?.value as string | undefined ?? "";
  return { flags: text.includes("i") ? "i" : "", global: text.includes("g") };
}

rule("test", (t, c) => {
  const { flags } = regexFlags(t, c, c.args.length === 2 ? 1 : undefined);
  values(t, c, [0], c.$, ($, [pattern]) => {
    const s = t.open(input(t, c));
    if (t.type(s).type !== "String") { cannot(t, c, $, s, "a string"); return; }
    c.emit($, t.b("RegexContains", [], [s, pattern!, t.str(flags)], BooleanType, c.path));
  });
});

rule(["sub", "gsub"], (t, c) => {
  const { flags, global } = regexFlags(t, c, c.args.length === 3 ? 2 : undefined);
  const all = c.name === "gsub" || global;
  values(t, c, [0], c.$, ($, [pattern]) => {
    const s = t.open(input(t, c));
    if (t.type(s).type !== "String") { cannot(t, c, $, s, "a string"); return; }
    // East's replace is global; `sub` anchors a lazy prefix so only the first match is replaced.
    const re = all ? pattern! : t.concat(t.concat(t.str("^([\\s\\S]*?)(?:"), pattern!, c.path), t.str(")"), c.path);
    const replacement = t.bind($, replacementOf(t, c, $), "replacement");
    const full = all ? replacement : t.concat(t.str("$1"), replacement, c.path);
    c.emit($, t.b("RegexReplace", [], [s, re, t.str(flags), full], StringType, c.path));
  });
});

/** A sub/gsub replacement as East's replacement text: its text with `$` doubled, each `\(.name)` as `$<name>`. */
function replacementOf(t: Translator, c: CallSite, $: Block): Expr {
  const node = c.args[1]!;
  const escape = (text: string): string => text.replaceAll("$", "$$");
  const part = (n: JqNode): Expr => {
    if (n.type === "field") return t.str(`$<${n.value.name}>`);
    if (n.type === "variable") {
      const bound = c.env.vars.get(n.value);
      if (bound === undefined) throw t.gap(`$${n.value} is not bound`);
      return t.b("StringReplace", [], [t.tostring($, t.expr(bound, c.path), c.path), t.str("$"), t.str("$$")], StringType, c.path);
    }
    throw t.gap(`a replacement of ${n.type}`);
  };
  if (node.type === "literal") return t.str(escape(t.literal(node).value as string));
  if (node.type === "string") {
    let acc = t.str("");
    for (const p of node.value) acc = t.concat(acc, p.type === "text" ? t.str(escape(p.value as string)) : part(p.value as JqNode), c.path);
    return acc;
  }
  return part(node);
}

rule("format", (t, c) => {
  const name = (t.literalOf(c.args[0])?.value as string | undefined) ?? "";
  const format = FORMATS[name];
  if (format === undefined) throw t.gap(`format("${name}")`);
  c.emit(c.$, format(t, c.$, input(t, c), c.path));
});

// ─── Formats ─────────────────────────────────────────────────────────────

/** A format: a value as text. @internal */
export type Format = (t: Translator, $: Block, v: Expr, path: string) => Expr;

/** Replaces each of some characters in a string. */
function replaceAll(t: Translator, s: Expr, pairs: readonly (readonly [string, string])[], path: string): Expr {
  let out = s;
  for (const [from, to] of pairs) out = t.b("StringReplace", [], [out, t.str(from), t.str(to)], StringType, path);
  return out;
}

/** Each cell of an array of scalars as text, joined. */
function cells(t: Translator, $: Block, v: Expr, path: string, cell: ($: Block, item: Expr) => Expr, separator: string): Expr {
  const parts = t.declare($, t.emptyArray(StringType), "cells");
  t.forEach($, v, ($2, item) => t.push($2, parts, cell($2, item), path), path);
  return t.b("ArrayStringJoin", [], [parts, t.str(separator)], StringType, path);
}

/** Whether a scalar is a string, through its option. */
function isStringCell(t: Translator, v: Expr): boolean {
  const ot = t.type(t.open(v));
  return (nullablePayload(ot) ?? ot).type === "String";
}

/** A string cell's text: `f` of the string, or `nullText` for an absent one. */
function stringCell(t: Translator, v: Expr, f: (s: Expr) => Expr, path: string, nullText: string): Expr {
  const o = t.open(v);
  if (nullablePayload(t.type(o)) === undefined) return f(o);
  return t.matchValue(o, { none: () => t.str(nullText, path), some: (_$2, s) => f(s) }, StringType, path);
}

/** RFC 4648's alphabets. */
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base-2ᵏ text of a string's UTF-8 bytes, RFC 4648 with padding: `bits` bits a character, in groups of `group` bytes. */
function baseEncode(t: Translator, $: Block, v: Expr, path: string, alphabet: string, bits: number, group: number): Expr {
  const bytes = t.declare($, t.b("StringEncodeUtf8", [], [t.tostring($, v, path)], BlobType, path), "bytes", false);
  const size = t.declare($, t.b("BlobSize", [], [bytes], IntegerType, path), "size", false);
  const letters = t.declare($, t.value([...alphabet], ArrayType(StringType), path), "alphabet", false);
  const out = t.declare($, t.emptyArray(StringType), "letters");
  const chars = (group * 8) / bits;
  const i = t.declare($, t.int(0), "i");
  t.whileLoop($, t.lt(i, size, path), $2 => {
    // The group's bytes as one integer, then its characters, the unused ones padding.
    const n = t.declare($2, t.int(0), "group");
    const used = t.declare($2, t.int(0), "used");
    for (let k = 0; k < group; k++) {
      const at = t.add(i, t.int(k), path);
      t.assign($2, n, t.b("IntegerMultiply", [], [n, t.int(256)], IntegerType, path));
      t.ifElse($2, t.lt(at, size, path), $3 => {
        t.assign($3, n, t.add(n, t.b("BlobGetUint8", [], [bytes, t.add(i, t.int(k), path)], IntegerType, path), path));
        t.assign($3, used, t.add(used, t.int(1), path));
      }, undefined, path);
    }
    // A group of `used` bytes gives ceil(used × 8 / bits) characters.
    const shown = t.declare($2, t.b("IntegerDivide", [], [t.add(t.b("IntegerMultiply", [], [used, t.int(8)], IntegerType, path), t.int(bits - 1), path), t.int(bits)], IntegerType, path), "shown", false);
    for (let k = 0; k < chars; k++) {
      const shift = BigInt(bits * (chars - 1 - k));
      const index = t.b("IntegerRemainder", [], [t.b("IntegerDivide", [], [n, t.int(2n ** shift)], IntegerType, path), t.int(2 ** bits)], IntegerType, path);
      t.ifElse($2, t.lt(t.int(k), shown, path),
        $3 => t.push($3, out, t.b("ArrayGet", [StringType], [letters, index], StringType, path), path),
        $3 => t.push($3, out, t.str("="), path), path);
    }
    t.assign($2, i, t.add(i, t.int(group), path));
  }, path);
  return t.b("ArrayStringJoin", [], [out, t.str("")], StringType, path);
}

/** The text each byte is percent-encoded as, or kept as: jq's unreserved characters. */
function uriTable(): string[] {
  const table: string[] = [];
  for (let b = 0; b < 256; b++) {
    const c = String.fromCharCode(b);
    table.push(/[A-Za-z0-9\-_.~]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`);
  }
  return table;
}

/** Each format, by name. @internal */
export const FORMATS: Readonly<Record<string, Format>> = {
  text: (t, $, v, path) => t.tostring($, v, path),
  json: (t, _$, v, path) => tojson(t, v, path),
  html: (t, $, v, path) => replaceAll(t, t.tostring($, v, path), [["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ["'", "&apos;"], ["\"", "&quot;"]], path),
  uri: (t, $, v, path) => {
    const bytes = t.declare($, t.b("StringEncodeUtf8", [], [t.tostring($, v, path)], BlobType, path), "bytes", false);
    const table = t.declare($, t.value(uriTable(), ArrayType(StringType), path), "encoded", false);
    const out = t.declare($, t.emptyArray(StringType), "parts");
    const i = t.declare($, t.int(0), "i");
    t.whileLoop($, t.lt(i, t.b("BlobSize", [], [bytes], IntegerType, path), path), $2 => {
      t.push($2, out, t.b("ArrayGet", [StringType], [table, t.b("BlobGetUint8", [], [bytes, i], IntegerType, path)], StringType, path), path);
      t.assign($2, i, t.add(i, t.int(1), path));
    }, path);
    return t.b("ArrayStringJoin", [], [out, t.str("")], StringType, path);
  },
  base64: (t, $, v, path) => baseEncode(t, $, v, path, BASE64, 6, 3),
  base32: (t, $, v, path) => baseEncode(t, $, v, path, BASE32, 5, 5),
  csv: (t, $, v, path) => cells(t, $, v, path, ($2, item) => isStringCell(t, item)
    ? stringCell(t, item, s => t.concat(t.concat(t.str("\""), replaceAll(t, s, [["\"", "\"\""]], path), path), t.str("\""), path), path, "")
    : cellText(t, $2, item, path, ""), ","),
  tsv: (t, $, v, path) => cells(t, $, v, path, ($2, item) => isStringCell(t, item)
    ? stringCell(t, item, s => replaceAll(t, s, [["\\", "\\\\"], ["\t", "\\t"], ["\n", "\\n"], ["\r", "\\r"]], path), path, "")
    : cellText(t, $2, item, path, ""), "\t"),
  sh: (t, $, v, path) => {
    const quote = (s: Expr): Expr => t.concat(t.concat(t.str("'"), replaceAll(t, s, [["'", "'\\''"]], path), path), t.str("'"), path);
    const cell = ($2: Block, item: Expr): Expr => isStringCell(t, item) ? stringCell(t, item, quote, path, "null") : cellText(t, $2, item, path, "null");
    const o = t.open(v);
    if (!arrayLike(t.type(o))) return cell($, o);
    return cells(t, $, o, path, cell, " ");
  },
};

// Formats called by name, `@base64`, and through `format("base64")`.
for (const name of Object.keys(FORMATS)) rule(`@${name}`, (t, c) => c.emit(c.$, FORMATS[name]!(t, c.$, input(t, c), c.path)));

// ─── Math ────────────────────────────────────────────────────────────────

for (const [name, fn] of [["floor", "roundFloor"], ["ceil", "roundCeil"], ["round", "roundHalf"], ["trunc", "roundTrunc"]] as const) {
  rule(name, (t, c) => {
    const x = t.open(input(t, c));
    c.emit(c.$, t.type(x).type === "Integer" ? x : t.round(fn, x, c.$, c.path));
  });
}

for (const [name, builtin] of [["sqrt", "FloatSqrt"], ["log", "FloatLog"], ["exp", "FloatExp"], ["sin", "FloatSin"], ["cos", "FloatCos"], ["tan", "FloatTan"], ["fabs", "FloatAbs"]] as const) {
  rule(name, (t, c) => c.emit(c.$, t.b(builtin, [], [float(t, c.$, input(t, c), c.path)], FloatType, c.path)));
}

rule(["log2", "log10"], (t, c) => {
  const base = c.name === "log2" ? 2 : 10;
  const x = float(t, c.$, input(t, c), c.path);
  c.emit(c.$, t.b("FloatDivide", [], [t.b("FloatLog", [], [x], FloatType, c.path), t.b("FloatLog", [], [t.float(base)], FloatType, c.path)], FloatType, c.path));
});

rule(["exp2", "exp10"], (t, c) => {
  c.emit(c.$, t.b("FloatPow", [], [t.float(c.name === "exp2" ? 2 : 10), float(t, c.$, input(t, c), c.path)], FloatType, c.path));
});

rule(["pow", "fmin", "fmax", "fmod"], (t, c) => values(t, c, [0, 1], c.$, ($, [a, b]) => {
  const x = t.bind($, float(t, $, a!, c.path), "a");
  const y = t.bind($, float(t, $, b!, c.path), "b");
  switch (c.name) {
    case "pow": c.emit($, t.b("FloatPow", [], [x, y], FloatType, c.path)); return;
    case "fmod": c.emit($, t.b("FloatRemainder", [], [x, y], FloatType, c.path)); return;
    // As C's: a NaN gives the other number. East orders NaN above every number,
    // so the lesser of the two is never a NaN unless both are.
    case "fmin": c.emit($, t.ifValue(t.lt(y, x, c.path), () => y, () => x, FloatType, c.path)); return;
    default: {
      const other = t.b("BooleanOr", [], [isNan(t, $, y, c.path), t.lt(y, x, c.path)], BooleanType, c.path);
      c.emit($, t.ifValue(isNan(t, $, x, c.path), () => y, () => t.ifValue(other, () => x, () => y, FloatType, c.path), FloatType, c.path));
    }
  }
}));

// ─── DateTime ────────────────────────────────────────────────────────────

/** RFC 3339 as East's JSON writes a DateTime: `2026-09-07T00:00:00.000+00:00`. */
function rfc3339Tokens(): unknown[] {
  return [
    variant("year4", null), variant("literal", "-"), variant("month2", null), variant("literal", "-"), variant("day2", null),
    variant("literal", "T"), variant("hour24_2", null), variant("literal", ":"), variant("minute2", null), variant("literal", ":"),
    variant("second2", null), variant("literal", "."), variant("millisecond3", null), variant("literal", "+00:00"),
  ];
}

/** A DateTime, or epoch seconds as jq's date builtins take them. */
function dateOf(t: Translator, $: Block, v: Expr, path: string): Expr {
  const o = t.open(v);
  const ot = t.type(o);
  if (ot.type === "DateTime") return o;
  const ms = ot.type === "Integer"
    ? t.b("IntegerMultiply", [], [o, t.int(1000)], IntegerType, path)
    : t.round("roundFloor", t.b("FloatMultiply", [], [o, t.float(1000)], FloatType, path), $, path);
  return t.b("DateTimeFromEpochMilliseconds", [], [ms], DateTimeType, path);
}

rule(["todate", "todateiso8601"], (t, c) => {
  const tokens = t.value(rfc3339Tokens(), ArrayType(DateTimeFormatTokenType), c.path);
  c.emit(c.$, t.b("DateTimePrintFormat", [], [dateOf(t, c.$, input(t, c), c.path), tokens], StringType, c.path));
});

rule(["fromdate", "fromdateiso8601"], (t, c) => {
  const quoted = t.concat(t.concat(t.str("\""), t.open(input(t, c)), c.path), t.str("\""), c.path);
  c.emit(c.$, t.b("StringParseJSON", [DateTimeType], [quoted], DateTimeType, c.path));
});

/** The format tokens the checker wrote for a strftime/strptime format. */
function tokensOf(t: Translator, c: CallSite): Expr {
  const literal = t.literalOf(c.args[0]);
  if (literal === undefined || literal.type.type !== "Array") throw t.gap(`${c.name} without its format's tokens`);
  return t.value(literal.value, ArrayType(DateTimeFormatTokenType), c.argPaths[0]!);
}

rule("strftime", (t, c) => c.emit(c.$, t.b("DateTimePrintFormat", [], [dateOf(t, c.$, input(t, c), c.path), tokensOf(t, c)], StringType, c.path)));
rule("strptime", (t, c) => c.emit(c.$, t.b("DateTimeParseFormat", [], [t.open(input(t, c)), tokensOf(t, c)], DateTimeType, c.path)));

for (const [name, builtin] of [
  ["year", "DateTimeGetYear"], ["month", "DateTimeGetMonth"], ["day", "DateTimeGetDayOfMonth"], ["hour", "DateTimeGetHour"],
  ["minute", "DateTimeGetMinute"], ["second", "DateTimeGetSecond"], ["millisecond", "DateTimeGetMillisecond"],
  ["weekday", "DateTimeGetDayOfWeek"], ["epoch_ms", "DateTimeToEpochMilliseconds"],
] as const) {
  rule(name, (t, c) => c.emit(c.$, t.b(builtin, [], [t.open(input(t, c))], IntegerType, c.path)));
}

/** A unit's length in milliseconds. */
const UNIT_MS: Readonly<Record<string, bigint>> = {
  millisecond: 1n, second: 1000n, minute: 60_000n, hour: 3_600_000n, day: 86_400_000n, week: 604_800_000n,
};

function unitMs(t: Translator, c: CallSite, i: number): Expr {
  const unit = t.literalOf(c.args[i])?.value as string | undefined;
  const ms = unit === undefined ? undefined : UNIT_MS[unit];
  if (ms === undefined) throw t.gap(`the unit ${unit ?? "?"}`);
  return t.int(ms, c.argPaths[i]!);
}

rule("datetime_add", (t, c) => values(t, c, [0], c.$, ($, [n]) => {
  const ms = t.b("IntegerMultiply", [], [n!, unitMs(t, c, 1)], IntegerType, c.path);
  c.emit($, t.b("DateTimeAddMilliseconds", [], [t.open(input(t, c)), ms], DateTimeType, c.path));
}));

rule("datetime_diff", (t, c) => values(t, c, [0], c.$, ($, [other]) => {
  const ms = t.b("DateTimeDurationMilliseconds", [], [t.open(input(t, c)), t.open(other!)], IntegerType, c.path);
  c.emit($, t.b("IntegerDivide", [], [ms, unitMs(t, c, 1)], IntegerType, c.path));
}));

// ─── Function values ─────────────────────────────────────────────────────

rule("call", (t, c) => values(t, c, c.args.map((_, i) => i), c.$, ($, [fn, ...args]) => {
  const f = t.open(fn!);
  const inputs = t.type(f).inputs as EastType[];
  c.emit($, t.callFn(f, args.map((a, i) => callArgument(t, $, a, inputs[i]!, c.path)), c.path));
}));

/** An argument as a function's input: an Integer as a Float, a struct field by field. */
function callArgument(t: Translator, $: Block, v: Expr, want: EastType, path: string): Expr {
  const o = t.open(v);
  const ot = t.type(o);
  const w = unwrap(want);
  if (isTypeEqual(ot, w)) return t.widenTo($, o, want, path);
  if (ot.type === "Struct" && w.type === "Struct") {
    const s = t.bind($, o, "argument");
    const fields: Record<string, Expr> = {};
    for (const [name, f] of Object.entries(w.fields as Record<string, EastType>)) fields[name] = callArgument(t, $, t.field(s, name), f, path);
    return t.struct(want, fields);
  }
  return t.widenTo($, o, want, path);
}

for (const [name, output] of [["signature", "String"], ["source", "String"], ["calls", "Array"], ["captures", "Array"]] as const) {
  rule(name, (t, c) => {
    const f = t.open(input(t, c));
    const type = output === "String" ? StringType : ArrayType(StringType);
    // A host platform function the tooling provides (#931).
    c.emit(c.$, t.mk({
      ast_type: "Platform", type, loc_id: t.loc(c.path), name: `jq_${name}`, type_parameters: [t.type(f)],
      arguments: [t.ast(f)], async: false, optional: false,
    }));
  });
}

/** Every builtin's rule, by name as called; formats as `@name`. @internal */
export const BUILTIN_RULES: Readonly<Record<string, BuiltinRule>> = rules;
