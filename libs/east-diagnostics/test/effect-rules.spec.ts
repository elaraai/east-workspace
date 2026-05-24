/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./harness.js";

const PRELUDE = `import { East, ArrayType, IntegerType, NullType, StringType } from "@elaraai/east";\nconst log = East.platform("log", [StringType], NullType);\n`;

function wrap(body: string): string {
  return `${PRELUDE}export const f = East.function([ArrayType(IntegerType)], NullType, ($, arr) => {\n${body}\n  $.return(null);\n});\n`;
}

function rule(source: string, ruleName: string) {
  return analyze(source).filter((d) => d.ruleName === ruleName);
}

// ── no-unexecuted-east-expression ───────────────────────────────────
test("no-unexecuted: flags an effectful call without $()", () => {
  assert.equal(rule(wrap("  log(East.str`hi`);"), "no-unexecuted-east-expression").length, 1);
});

test("no-unexecuted: flags a bare mutation without $()", () => {
  assert.equal(rule(wrap("  arr.pushLast(1n);"), "no-unexecuted-east-expression").length, 1);
});

test("no-unexecuted: flags a bare East.value() statement", () => {
  assert.equal(rule(wrap("  East.value(5n);"), "no-unexecuted-east-expression").length, 1);
});

test("no-unexecuted: silent when executed with $()", () => {
  assert.equal(rule(wrap("  $(log(East.str`hi`));"), "no-unexecuted-east-expression").length, 0);
});

test("no-unexecuted: silent for $.if / $.return block-builder statements", () => {
  assert.equal(rule(wrap("  $.if(East.value(true), ($) => {});"), "no-unexecuted-east-expression").length, 0);
});

test("no-unexecuted: silent for CHAINED block-builder statements ($.if().else(), $.try().catch())", () => {
  assert.equal(
    rule(wrap("  $.if(East.value(true), ($) => {}).else(($) => {});"), "no-unexecuted-east-expression").length,
    0,
  );
});

test("no-unexecuted: silent when the value is bound to a const", () => {
  assert.equal(rule(wrap("  const x = $.let(0n, IntegerType);"), "no-unexecuted-east-expression").length, 0);
});

// ── no-reinlined-east-binding ───────────────────────────────────────
test("no-reinlined: flags a JS-const East expr used twice in a block", () => {
  assert.equal(
    rule(wrap("  const v = East.value(5n);\n  $(log(East.print(v)));\n  $(log(East.print(v)));"), "no-reinlined-east-binding").length,
    1,
  );
});

test("no-reinlined: silent for a single use (harmless alias / single-pass arg)", () => {
  assert.equal(
    rule(wrap("  const v = East.value(5n);\n  $(log(East.print(v)));"), "no-reinlined-east-binding").length,
    0,
  );
});

test("no-reinlined: silent when bound with $.const, even reused", () => {
  assert.equal(
    rule(wrap("  const v = $.const(5n, IntegerType);\n  $(log(East.print(v)));\n  $(log(East.print(v)));"), "no-reinlined-east-binding").length,
    0,
  );
});

test("no-reinlined: silent for a non-Expr binding (a type) reused", () => {
  assert.equal(
    rule(wrap("  const T = ArrayType(IntegerType);\n  const a = $.let([], T);\n  const b = $.let([], T);"), "no-reinlined-east-binding").length,
    0,
  );
});

test("no-reinlined: captured into an inner East.function counts in that body", () => {
  const src = `${PRELUDE}export const g = East.function([], NullType, (_$) => {
  const v = East.value(5n);
  return East.value(East.function([], NullType, ($) => {
    $(log(East.print(v)));
    $(log(East.print(v)));
    $.return(null);
  }));
});
`;
  assert.equal(rule(src, "no-reinlined-east-binding").length, 1);
});