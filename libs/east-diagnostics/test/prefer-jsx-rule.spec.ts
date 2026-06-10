/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "typescript";
import { analyzeProgram } from "./harness.js";
import { preferJsxOverFactoryCall } from "../src/index.js";

const RULE = "prefer-jsx-over-factory-call";

// A homemade UI package, structured like east-ui: a JSX runtime whose
// `JSX.Element` is the built-element type, and component factories whose
// `.Root(...)` returns that same type. The rule keys on the RESULT TYPE, not the
// import path — so this synthetic package exercises it exactly as the real one.
const PKG = "@fixture/ui";
// The fixture mirrors east-ui's split: JSX *tags* (callable components) live at
// the main entry, the *factories* (`.Root(...)`) at `/internal`, same names. The
// jsx runtime owns `Built` (= `JSX.Element`); both a factory's `.Root(...)` and a
// `<Box/>` element evaluate to it.
const FILES: Record<string, string> = {
  "/proj/ui-jsx-runtime.d.ts": `
export type Built = { readonly __built: unique symbol };
export namespace JSX {
  export type Element = Built;
  export interface IntrinsicElements {}
  export interface ElementChildrenAttribute { children: object; }
}
export function jsx(type: unknown, props: unknown): Built;
export function jsxs(type: unknown, props: unknown): Built;
export const Fragment: unique symbol;
`,
  // Main entry — JSX tags: callable components you author as <Box>…</Box>.
  "/proj/ui.d.ts": `
import type { Built } from "${PKG}/jsx-runtime";
export const Box: (props: { children?: unknown }) => Built;
export const Card: (props: { children?: unknown }) => Built;
`,
  // Internal entry — the raw factories the tags wrap.
  "/proj/ui-internal.d.ts": `
import type { Built } from "${PKG}/jsx-runtime";
// Component factories: \`.Root(...)\` builds a JSX element (like east-ui's Box).
export const Box: { Root: (children?: unknown, style?: unknown) => Built };
export const Card: { Root: (children?: unknown, style?: unknown) => Built };
// A non-UI factory: \`.Root(...)\` returns a config object, not an element.
export const Cfg: { Root: (x?: unknown) => { id: number } };
// A nested factory (no top-level tag), like Slice.Frame.Root(...).
export const Slice: { Frame: { Root: (x?: unknown) => Built } };
`,
};

const TSCONFIG_OPTS: ts.CompilerOptions = {
  jsx: ts.JsxEmit.ReactJSX,
  jsxImportSource: PKG,
  baseUrl: "/proj",
  paths: {
    [PKG]: ["./ui.d.ts"],
    [`${PKG}/internal`]: ["./ui-internal.d.ts"],
    [`${PKG}/jsx-runtime`]: ["./ui-jsx-runtime.d.ts"],
  },
};

function fire(entryName: string, source: string, opts: ts.CompilerOptions = TSCONFIG_OPTS) {
  const entry = `/proj/${entryName}`;
  return analyzeProgram({ ...FILES, [entry]: source }, entry, opts, [preferJsxOverFactoryCall]).filter(
    (d) => d.ruleName === RULE,
  );
}

// Factories come from the internal entry; tags from the main entry.
const FACTORIES = `import { Box, Cfg, Slice } from "${PKG}/internal";\n`;

test("fires on Box.Root(...) in a .tsx file — the call produces a JSX element", () => {
  assert.equal(fire("a.tsx", `${FACTORIES}export const x = Box.Root([]);\n`).length, 1);
});

test("silent when authoring with the actual <Box> JSX tag", () => {
  // The correct form: import the tag, write <Box>. No `.Root` call to flag.
  const src = `import { Box } from "${PKG}";\nexport const x = <Box>hi</Box>;\n`;
  assert.equal(fire("a.tsx", src).length, 0);
});

test("flags the factory call but not the sibling <Box> tag in the same file", () => {
  // A half-migrated file: the tag authoring is fine, the `.Root(...)` is not.
  const src =
    `import { Box } from "${PKG}";\n` +
    `import { Box as BoxFactory } from "${PKG}/internal";\n` +
    `export const good = <Box>hi</Box>;\n` +
    `export const bad = BoxFactory.Root([]);\n`;
  const diags = fire("a.tsx", src);
  assert.equal(diags.length, 1);
  // The suggested tag is the factory's exported name (`<Box>`), not the local
  // alias (`BoxFactory`).
  assert.match(diags[0]!.messageText, /<Box>/);
  assert.doesNotMatch(diags[0]!.messageText, /<BoxFactory>/);
});

test("silent on Cfg.Root(...) — the result is a config object, not a JSX element", () => {
  assert.equal(fire("a.tsx", `${FACTORIES}export const x = Cfg.Root();\n`).length, 0);
});

test("silent on Slice.Frame.Root(...) — receiver is a property access, not a bare identifier", () => {
  assert.equal(fire("a.tsx", `${FACTORIES}export const x = Slice.Frame.Root(undefined);\n`).length, 0);
});

test("silent in a .ts file — JSX is not the authoring surface there", () => {
  // A .ts file can still call the factory; the rule only fires in JSX sources.
  assert.equal(fire("a.ts", `${FACTORIES}export const x = Box.Root([]);\n`).length, 0);
});

test("silent on a non-.Root method (e.g. Box.Padding(...))", () => {
  const src = `import { Box } from "${PKG}/internal";\nexport const x = (Box as unknown as { Padding(n: number): number }).Padding(2);\n`;
  assert.equal(fire("a.tsx", src).length, 0);
});

test("fires once per factory call across multiple components", () => {
  const src = `import { Box, Card } from "${PKG}/internal";\nexport const a = Box.Root([]);\nexport const b = Card.Root([]);\n`;
  assert.equal(fire("a.tsx", src).length, 2);
});

test("resolves JSX.Element via a global namespace too (classic runtime)", () => {
  // No jsxImportSource: a globally-declared JSX namespace supplies the element
  // type. Proves the rule isn't tied to the automatic runtime.
  const files: Record<string, string> = {
    "/g/globals.d.ts": `
type Built = { readonly __built: unique symbol };
declare namespace JSX {
  type Element = Built;
  interface IntrinsicElements {}
  interface ElementChildrenAttribute { children: object; }
}
declare const React: unknown;
`,
    "/g/ui.d.ts": `export const Box: { Root: (children?: unknown) => JSX.Element };\n`,
  };
  const entry = "/g/a.tsx";
  const src = `import { Box } from "./ui.js";\nexport const x = Box.Root([]);\n`;
  const diags = analyzeProgram(
    { ...files, [entry]: src },
    entry,
    { jsx: ts.JsxEmit.React },
    [preferJsxOverFactoryCall],
  ).filter((d) => d.ruleName === RULE);
  assert.equal(diags.length, 1);
});
