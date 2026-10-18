/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "typescript";
import { analyze, programFor } from "./harness.js";
import { LOOP_METHODS, ONCE_METHODS, REPEATING_METHODS } from "../src/rules/no-reinlined-east-binding.js";

// `no-reinlined-east-binding`: an East `Expr` held in a JS `const`/`let` is re-inlined — and
// re-evaluated — at each read. The edge cases here are the proof that a correct program is never
// asked to change: a `$.const`, an alias, a type, a single read, and one read per EXCLUSIVE arm stay
// silent; two reads in one body, or one read inside a body that runs repeatedly, are flagged.

const PRELUDE = `import { East, ArrayType, DictType, IntegerType, NullType, StringType } from "@elaraai/east";\nconst log = East.platform("log", [StringType], NullType);\n`;

function wrap(body: string): string {
  return `${PRELUDE}export const f = East.function([ArrayType(IntegerType), DictType(StringType, IntegerType), StringType], NullType, ($, arr, d, k) => {\n${body}\n  $.return(null);\n});\n`;
}

function rule(source: string) {
  return analyze(source).filter((d) => d.ruleName === "no-reinlined-east-binding");
}

// ── silent: nothing is evaluated more than written ─────────────────────────

test("no-reinlined: silent for a $.const read many times, inside a callback included", () => {
  const src = wrap(
    "  const n = $.const(arr.size().multiply(2n));\n  $(log(East.print(n)));\n  $(log(East.print(n)));\n  $(arr.map(($, x) => x.add(n)));",
  );
  assert.deepEqual(rule(src), []);
});

test("no-reinlined: silent for an alias of a parameter, a type and a plain value read twice", () => {
  const src = wrap(
    "  const a = arr;\n  const T = ArrayType(IntegerType);\n  const k2 = 3n;\n  const acc = $.let([], T);\n  $(acc.pushLast(a.size().add(k2)));\n  $(acc.pushLast(a.size().multiply(k2)));",
  );
  assert.deepEqual(rule(src), []);
});

test("no-reinlined: silent for a single read", () => {
  assert.deepEqual(rule(wrap("  const n = arr.size().multiply(2n);\n  $(log(East.print(n)));")), []);
});

test("no-reinlined: silent for one read in each of two exclusive $.if / .else arms", () => {
  const src = wrap(
    "  const n = arr.size().multiply(2n);\n  $.if(East.greater(n, 3n), ($) => {\n    $(log(East.print(n)));\n  }).else(($) => {\n    $(log(East.print(n.negate())));\n  });",
  );
  assert.deepEqual(rule(src), []);
});

test("no-reinlined: silent for one read in each of two exclusive .ifElse arms (a guarded partial read)", () => {
  // `hit` is `d.get(k)`: binding it above the guard with `$.const` would raise on the miss path,
  // so one read per arm must stay silent.
  const src = wrap(
    "  const hit = d.get(k);\n  const out = $.let(East.equal(d.has(k), true).ifElse(() => hit.add(1n), () => 0n));\n  $(log(East.print(out)));",
  );
  assert.deepEqual(rule(src), []);
});

test("no-reinlined: silent for one read inside a once-only body: a $.match arm, a .match arm, a default producer", () => {
  const src = wrap(
    "  const n = arr.size().multiply(2n);\n  const got = $.let(d.tryGet(k).match({ some: ($, v) => v.add(n), none: ($) => 0n }));\n  const fallback = $.let(d.get(k, ($, _k) => n));\n  $(log(East.print(got.add(fallback))));",
  );
  assert.deepEqual(rule(src), []);
});

// ── flagged: a read that runs more than written ────────────────────────────

test("no-reinlined: flags two reads in one body", () => {
  const found = rule(wrap("  const n = arr.size().multiply(2n);\n  $(log(East.print(n.add(n))));"));
  assert.equal(found.length, 1);
  assert.match(found[0]!.messageText, /read 2 times/);
});

test("no-reinlined: flags two reads inside one arm", () => {
  const src = wrap(
    "  const n = arr.size().multiply(2n);\n  $.if(East.greater(arr.size(), 3n), ($) => {\n    $(log(East.print(n.add(n))));\n  });",
  );
  assert.equal(rule(src).length, 1);
});

test("no-reinlined: flags one read inside a per-element callback", () => {
  const found = rule(wrap("  const table = arr.sort(($, x) => x);\n  $(arr.map(($, x) => x.add(table.size())));"));
  assert.equal(found.length, 1);
  assert.match(found[0]!.messageText, /callback/);
});

test("no-reinlined: flags one read inside a $.for loop body", () => {
  const found = rule(
    wrap("  const limit = arr.size().multiply(2n);\n  const acc = $.let(0n);\n  $.for(arr, ($, v) => {\n    $.assign(acc, acc.add(v).add(limit));\n  });"),
  );
  assert.equal(found.length, 1);
  assert.match(found[0]!.messageText, /loop body/);
});

test("no-reinlined: flags one read inside a nested East.function", () => {
  const found = rule(
    wrap("  const offset = arr.size().multiply(2n);\n  const g = $.const(East.function([IntegerType], IntegerType, ($, y) => y.add(offset)));\n  $(log(East.print(g(1n))));"),
  );
  assert.equal(found.length, 1);
  assert.match(found[0]!.messageText, /nested function/);
});

test("no-reinlined: a read inside a once-only arm nested in a per-element callback is per element", () => {
  const src = wrap(
    "  const n = arr.size().multiply(2n);\n  $(arr.map(($, x) => East.greater(x, 0n).ifElse(() => x.add(n), () => x)));",
  );
  assert.equal(rule(src).length, 1);
});

// ── the classification is total over the Expr classes' callback-taking methods ──

function acceptsFunction(type: ts.Type): boolean {
  const seen = new Set<ts.Type>();
  const stack: ts.Type[] = [type];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    if (current.getCallSignatures().length > 0) return true;
    if (current.isUnionOrIntersection()) stack.push(...current.types);
  }
  return false;
}

test("no-reinlined: every callback-taking method of the Expr classes and the BlockBuilder is classified", () => {
  const classes = ["ArrayExpr", "SetExpr", "DictExpr", "VectorExpr", "MatrixExpr", "RefExpr", "BooleanExpr", "VariantExpr", "BlockBuilder"];
  const src = `import { ${classes.join(", ")} } from "@elaraai/east";\nexport const probe = [${classes.join(", ")}];\n`;
  const { sourceFile, checker } = programFor(src);
  const unclassified: string[] = [];
  const seen: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && classes.includes(node.text) && ts.isArrayLiteralExpression(node.parent)) {
      const symbol = checker.getSymbolAtLocation(node);
      assert.ok(symbol, `${node.text} resolves`);
      const instance = checker.getDeclaredTypeOfSymbol(checker.getAliasedSymbol?.(symbol) ?? symbol);
      for (const prop of instance.getProperties()) {
        const propType = checker.getTypeOfSymbolAtLocation(prop, node);
        const takesCallback = propType
          .getCallSignatures()
          .some((sig) => sig.getParameters().some((p) => acceptsFunction(checker.getTypeOfSymbolAtLocation(p, node))));
        if (!takesCallback) continue;
        seen.push(`${node.text}.${prop.name}`);
        if (!REPEATING_METHODS.has(prop.name) && !ONCE_METHODS.has(prop.name) && !LOOP_METHODS.has(prop.name)) {
          unclassified.push(`${node.text}.${prop.name}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(seen.length > 20, `the probe saw the callback-taking methods: ${seen.join(", ")}`);
  assert.deepEqual(unclassified, [], "a callback-taking method with no classification — add it to REPEATING_METHODS or ONCE_METHODS");
  for (const name of REPEATING_METHODS) assert.ok(!ONCE_METHODS.has(name), `${name} is in both sets`);
});
