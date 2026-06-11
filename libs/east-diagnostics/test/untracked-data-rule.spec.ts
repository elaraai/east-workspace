/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./harness.js";

const PRELUDE = `import { East, type SubtypeExprOrValue, IntegerType, StringType, ArrayType, StructType, variant } from "@elaraai/east";
declare function Root(data: SubtypeExprOrValue<ArrayType<StructType<{ id: StringType }>>>): void;
declare function Cfg(days: string[]): void;
`;
const RULE = "no-untracked-east-data";

function rule(source: string) {
  return analyze(source).filter((d) => d.ruleName === RULE);
}

test("flags a bare-const array literal consumed in an East-typed position", () => {
  const src = `${PRELUDE}export const f = East.function([], IntegerType, ($) => {
  const people = [{ id: "a" }, { id: "b" }];
  Root(people);
  return $.let(1n);
});\n`;
  assert.equal(rule(src).length, 1);
});

test("silent when the data is bound with $.const", () => {
  const src = `${PRELUDE}export const f = East.function([], IntegerType, ($) => {
  const people = $.const([{ id: "a" }], ArrayType(StructType({ id: StringType })));
  Root(people);
  return $.let(1n);
});\n`;
  assert.equal(rule(src).length, 0);
});

test("silent on TS-side config arrays (non-Expr contextual type)", () => {
  const src = `${PRELUDE}export const f = East.function([], IntegerType, ($) => {
  const days = ["Mon", "Tue"];
  Cfg(days);
  return $.let(1n);
});\n`;
  assert.equal(rule(src).length, 0);
});

test("silent outside an East block", () => {
  const src = `${PRELUDE}const people = [{ id: "a" }];
Root(people);\nexport const _u = people;\n`;
  assert.equal(rule(src).length, 0);
});
