/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";

const NAME = "prefer-jsx-over-factory-call";
const CODE = 990012;

// JSX is the primary surface, so the tags live at each package's MAIN entry and
// the raw component factories were moved to its `/internal` entry. A `.tsx` file
// should author with the tag, not the factory's `.Root(...)`. (e3-ui gains its
// `/internal` split when it migrates; the entry is listed ahead of that.)
const FACTORY_TO_TAG_ENTRY: Record<string, string> = {
  "@elaraai/east-ui/internal": "@elaraai/east-ui",
  "@elaraai/e3-ui/internal": "@elaraai/e3-ui",
};

/** The module specifier `ident` was imported from, if it is a named import. */
function importSpecifierOf(ident: ts.Identifier, ctx: RuleContext): string | undefined {
  const t = ctx.ts;
  const symbol = ctx.checker.getSymbolAtLocation(ident);
  for (const decl of symbol?.declarations ?? []) {
    if (!t.isImportSpecifier(decl) && !t.isImportClause(decl)) continue;
    let n: ts.Node = decl;
    while (n.parent !== undefined && !t.isImportDeclaration(n)) n = n.parent;
    if (t.isImportDeclaration(n) && t.isStringLiteral(n.moduleSpecifier)) {
      return n.moduleSpecifier.text;
    }
  }
  return undefined;
}

// Names exported from `tagEntry` as seen from `sourceFile` — memoized per file.
const tagExportCache = new WeakMap<ts.SourceFile, Map<string, ReadonlySet<string>>>();

function tagExports(tagEntry: string, ctx: RuleContext): ReadonlySet<string> {
  const t = ctx.ts;
  const sf = ctx.sourceFile;
  let perFile = tagExportCache.get(sf);
  if (perFile === undefined) {
    perFile = new Map();
    tagExportCache.set(sf, perFile);
  }
  const cached = perFile.get(tagEntry);
  if (cached !== undefined) return cached;

  const names = new Set<string>();
  // Resolve the tag module through one of the file's own imports of it — the JSX
  // file that calls a factory is, in practice, already importing tags from the
  // tag entry. With no such import we cannot confirm the tag exists, so the rule
  // stays silent (strict: only fire on a confirmed tag).
  for (const stmt of sf.statements) {
    if (!t.isImportDeclaration(stmt) || !t.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== tagEntry) continue;
    const moduleSymbol = ctx.checker.getSymbolAtLocation(stmt.moduleSpecifier);
    if (moduleSymbol === undefined) continue;
    for (const exp of ctx.checker.getExportsOfModule(moduleSymbol)) names.add(exp.name);
  }
  perFile.set(tagEntry, names);
  return names;
}

// In a `.tsx` file, calling a east-ui / e3-ui component factory's `Foo.Root(...)`
// when a `<Foo>` JSX tag exists is the un-migrated form — author with the tag.
// Gated tightly: JSX file only; `Ident.Root(...)` on a plain identifier (so
// `Slice.config(...)` / `Slice.Frame.Root(...)` never match); the identifier
// imported from a `/internal` factory entry (never another library); and the tag
// is confirmed present at that package's main entry (so a not-yet-migrated
// component is never flagged).
export const preferJsxOverFactoryCall: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "In a .tsx file, prefer the <Foo> JSX tag over an east-ui / e3-ui factory's Foo.Root(...) when the tag exists.",
  check(node, ctx) {
    const t: TsModule = ctx.ts;
    if (ctx.sourceFile.languageVariant !== t.LanguageVariant.JSX) return;
    if (!t.isCallExpression(node)) return;

    const callee = node.expression;
    if (!t.isPropertyAccessExpression(callee)) return;
    if (callee.name.text !== "Root") return;
    if (!t.isIdentifier(callee.expression)) return;
    const factoryIdent = callee.expression;

    const from = importSpecifierOf(factoryIdent, ctx);
    if (from === undefined) return;
    const tagEntry = FACTORY_TO_TAG_ENTRY[from];
    if (tagEntry === undefined) return;

    if (!tagExports(tagEntry, ctx).has(factoryIdent.text)) return;

    const sf = ctx.sourceFile;
    const start = callee.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: callee.getEnd() - start,
      messageText: `Author this with the \`<${factoryIdent.text}>\` JSX tag (from \`${tagEntry}\`) instead of \`${factoryIdent.text}.Root(...)\` — in a .tsx file the JSX tag is the authoring surface.`,
      category: "suggestion",
    });
  },
};
