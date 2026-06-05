/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, analyzeTsx } from "./harness.js";
const RULE = "prefer-jsx-over-factory-call";

// Ambient shims stand in for the east-ui package split: JSX tags at the main
// entry, raw component factories at `/internal`. `Button` has a tag; `NoTag`
// does not.
const SHIM = `declare module "@elaraai/east-ui" {
  export const Button: (props: unknown) => unknown;
}
declare module "@elaraai/east-ui/internal" {
  export const Button: { Root(label: string, style?: unknown): unknown };
  export const NoTag: { Root(label: string, style?: unknown): unknown };
}
`;
// Importing a tag from the main entry is what lets the rule confirm the tag set.
const IMPORTS = `import { Button as _ButtonTag } from "@elaraai/east-ui";
import { Button, NoTag } from "@elaraai/east-ui/internal";
void _ButtonTag;
`;

function rule(source: string, tsx = true) {
  return (tsx ? analyzeTsx(source) : analyze(source)).filter((d) => d.ruleName === RULE);
}

test("fires on Button.Root(...) in a .tsx file when the <Button> tag exists", () => {
  assert.equal(rule(`${SHIM}${IMPORTS}export const x = Button.Root("Save");\n`).length, 1);
});

test("silent on NoTag.Root(...) — no matching JSX tag (strict)", () => {
  assert.equal(rule(`${SHIM}${IMPORTS}export const x = NoTag.Root("x");\n`).length, 0);
});

test("silent in a .ts file (JSX is not available there)", () => {
  assert.equal(rule(`${SHIM}${IMPORTS}export const x = Button.Root("Save");\n`, false).length, 0);
});

test("silent when the file imports no tags from the main entry (cannot confirm)", () => {
  const src = `declare module "@elaraai/east-ui" { export const Button: (p: unknown) => unknown; }
declare module "@elaraai/east-ui/internal" { export const Button: { Root(l: string): unknown }; }
import { Button } from "@elaraai/east-ui/internal";
export const x = Button.Root("Save");\n`;
  assert.equal(rule(src).length, 0);
});

test("silent on a non-.Root method (e.g. Slice.config(...))", () => {
  const src = `declare module "@elaraai/east-ui" { export const Slice: { config(x: unknown): unknown }; }
declare module "@elaraai/east-ui/internal" { export const Slice: { config(x: unknown): unknown }; }
import { Slice as _S } from "@elaraai/east-ui";
import { Slice } from "@elaraai/east-ui/internal";
void _S;
export const x = Slice.config({});\n`;
  assert.equal(rule(src).length, 0);
});

test("silent on a chained receiver (Foo.Bar.Root(...))", () => {
  const src = `declare module "@elaraai/east-ui" { export const Slice: { Frame: unknown }; }
declare module "@elaraai/east-ui/internal" { export const Slice: { Frame: { Root(x: unknown): unknown } }; }
import { Slice as _S } from "@elaraai/east-ui";
import { Slice } from "@elaraai/east-ui/internal";
void _S;
export const x = Slice.Frame.Root({});\n`;
  assert.equal(rule(src).length, 0);
});

test("silent on a .Root call from a non-east-ui module", () => {
  const src = `declare module "@elaraai/east-ui" { export const Button: (p: unknown) => unknown; }
declare module "other-lib" { export const Button: { Root(l: string): unknown }; }
import { Button as _ButtonTag } from "@elaraai/east-ui";
import { Button } from "other-lib";
void _ButtonTag;
export const x = Button.Root("Save");\n`;
  assert.equal(rule(src).length, 0);
});
