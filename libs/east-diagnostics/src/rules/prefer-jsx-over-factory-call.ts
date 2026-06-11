/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";

const NAME = "prefer-jsx-over-factory-call";
const CODE = 990012;

// The signal that a `Foo.Root(...)` factory call has a `<Foo>` JSX tag form is
// not the import path — it's the RESULT TYPE. Every UI component factory's
// `.Root(...)` returns the same type a JSX element evaluates to (`JSX.Element`
// for this file's JSX runtime). So a `.Root(...)` whose result is that element
// type is, by construction, authorable as a tag — independent of which package
// it came from. This keys on the type, so it generalises to any JSX-producing
// factory and needs no per-package list.

// Resolving `JSX.Element` walks the filesystem, so memoize it per file (the
// SourceFile is rebuilt on every program, so the key is naturally invalidated).
// `null` records "no JSX element type here" so we don't re-resolve on each call.
const jsxElementCache = new WeakMap<ts.SourceFile, ts.Type | null>();

/** The `JSX.Element` type for `sourceFile`'s active JSX runtime, or undefined. */
function jsxElementType(ctx: RuleContext): ts.Type | undefined {
  const cached = jsxElementCache.get(ctx.sourceFile);
  if (cached !== undefined) return cached ?? undefined;
  const computed = computeJsxElementType(ctx);
  jsxElementCache.set(ctx.sourceFile, computed ?? null);
  return computed;
}

function computeJsxElementType(ctx: RuleContext): ts.Type | undefined {
  const t = ctx.ts;
  const elementOf = (ns: ts.Symbol): ts.Type | undefined => {
    const el = ctx.checker.getExportsOfModule(ns).find((s) => s.name === "Element");
    return el ? ctx.checker.getDeclaredTypeOfSymbol(el) : undefined;
  };

  // Classic / global runtime: a visible `JSX` namespace (global or imported).
  const resolveName = (ctx.checker as unknown as {
    resolveName?: (
      name: string,
      location: ts.Node | undefined,
      meaning: ts.SymbolFlags,
      excludeGlobals: boolean,
    ) => ts.Symbol | undefined;
  }).resolveName;
  const globalNs = resolveName?.("JSX", ctx.sourceFile, t.SymbolFlags.Namespace, false);
  if (globalNs !== undefined) {
    const fromGlobal = elementOf(globalNs);
    if (fromGlobal !== undefined) return fromGlobal;
  }

  // Automatic runtime (`jsx: react-jsx` + `jsxImportSource`): the `JSX` namespace
  // lives in `<source>/jsx-runtime`, not globally. Resolve that module and read
  // its `JSX.Element`. Needs the program for compiler options + resolution.
  const program = ctx.program;
  if (program === undefined) return undefined;
  const options = program.getCompilerOptions();
  const base = jsxImportSourceFor(options, ctx.sourceFile, t);
  if (base === undefined) return undefined;

  // Resolve exactly as TypeScript does. The host checks the program's loaded
  // source files first (so in-memory programs resolve), then falls through to
  // `ts.sys` for everything else on disk (package.json `exports`, node_modules).
  const resolutionHost: ts.ModuleResolutionHost = {
    fileExists: (f) => program.getSourceFile(f) !== undefined || t.sys.fileExists(f),
    readFile: (f) => program.getSourceFile(f)?.text ?? t.sys.readFile(f),
    directoryExists: (d) => t.sys.directoryExists(d),
    getCurrentDirectory: () => t.sys.getCurrentDirectory(),
    getDirectories: (d) => t.sys.getDirectories(d),
  };
  if (t.sys.realpath !== undefined) resolutionHost.realpath = (p) => t.sys.realpath!(p);
  const resolved = t.resolveModuleName(
    `${base}/jsx-runtime`,
    ctx.sourceFile.fileName,
    options,
    resolutionHost,
  ).resolvedModule?.resolvedFileName;
  if (resolved === undefined) return undefined;

  const runtimeSf = program.getSourceFile(resolved);
  const moduleSym = runtimeSf ? ctx.checker.getSymbolAtLocation(runtimeSf) : undefined;
  if (moduleSym === undefined) return undefined;
  const jsxNs = ctx.checker.getExportsOfModule(moduleSym).find((s) => s.name === "JSX");
  return jsxNs ? elementOf(jsxNs) : undefined;
}

/** The JSX import source in effect for `sourceFile` (per-file pragma overrides). */
function jsxImportSourceFor(
  options: ts.CompilerOptions,
  sourceFile: ts.SourceFile,
  t: TsModule,
): string | undefined {
  const pragmas = (sourceFile as unknown as { pragmas?: Map<string, unknown> }).pragmas;
  const pragma = pragmas?.get("jsximportsource") as
    | { arguments?: { factory?: string } }
    | Array<{ arguments?: { factory?: string } }>
    | undefined;
  const fromPragma = Array.isArray(pragma)
    ? pragma[pragma.length - 1]?.arguments?.factory
    : pragma?.arguments?.factory;
  if (fromPragma !== undefined) return fromPragma;
  // Only the automatic runtime carries an implicit import source.
  if (options.jsx !== t.JsxEmit.ReactJSX && options.jsx !== t.JsxEmit.ReactJSXDev) return undefined;
  return options.jsxImportSource ?? "react";
}

/** True when `a` and `b` are the same type (mutually assignable). */
function sameType(a: ts.Type, b: ts.Type, checker: ts.TypeChecker): boolean {
  const c = checker as unknown as { isTypeAssignableTo?: (s: ts.Type, t: ts.Type) => boolean };
  if (c.isTypeAssignableTo === undefined) return a === b; // older TS: identity only
  return c.isTypeAssignableTo(a, b) && c.isTypeAssignableTo(b, a);
}

// In a `.tsx` file, `Foo.Root(...)` on a plain identifier whose result is the
// file's JSX element type is the un-migrated form — author it as `<Foo>`. Gated:
// JSX file only; `Ident.Root(...)` on a bare identifier (so `Slice.Frame.Root(...)`
// / `Slice.config(...)` never match); and the call's result type is JSX.Element
// (so a `.Root` returning anything else — a config object, a number — is silent).
export const preferJsxOverFactoryCall: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "In a .tsx file, prefer the <Foo> JSX tag over a factory's Foo.Root(...) when the call produces a JSX element.",
  check(node, ctx) {
    const t: TsModule = ctx.ts;
    if (ctx.sourceFile.languageVariant !== t.LanguageVariant.JSX) return;
    if (!t.isCallExpression(node)) return;

    const callee = node.expression;
    if (!t.isPropertyAccessExpression(callee)) return;
    if (callee.name.text !== "Root") return;
    if (!t.isIdentifier(callee.expression)) return;
    const factoryIdent = callee.expression;

    const element = jsxElementType(ctx);
    if (element === undefined) return;
    const result = ctx.checker.getTypeAtLocation(node);
    if (!sameType(result, element, ctx.checker)) return;

    // The tag is named after the factory's *exported* name, not the local
    // binding — so an aliased import (`import { Box as BoxFactory }`) still
    // suggests `<Box>`, not `<BoxFactory>`.
    let tagName = factoryIdent.text;
    const sym = ctx.checker.getSymbolAtLocation(factoryIdent);
    if (sym !== undefined && (sym.flags & t.SymbolFlags.Alias) !== 0) {
      const target = ctx.checker.getAliasedSymbol(sym);
      if (target.name.length > 0) tagName = target.name;
    }

    const sf = ctx.sourceFile;
    const start = callee.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: callee.getEnd() - start,
      messageText: `Author this with the \`<${tagName}>\` JSX tag instead of \`${factoryIdent.text}.Root(...)\` — in a .tsx file the JSX tag is the authoring surface (the call already produces a JSX element).`,
      category: "suggestion",
    });
  },
};
