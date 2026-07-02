/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext } from "../types.js";
import { importsEastPackage } from "../east-source.js";

const NAME = "no-handrolled-value-type-mirror";
const CODE = 990028;

/** Is there a VALUE binding named `name` in this file (import or top-level
 * declaration) whose TS type is an East type constructor (`StructType<…>`,
 * `ArrayType<…>`, …)? Syntactic scan + one checker probe. */
function eastTypeValueInFile(name: string, ctx: RuleContext): boolean {
  const t = ctx.ts;
  for (const stmt of ctx.sourceFile.statements) {
    let ident: ts.Identifier | undefined;
    if (t.isImportDeclaration(stmt) && stmt.importClause?.namedBindings !== undefined && t.isNamedImports(stmt.importClause.namedBindings)) {
      for (const spec of stmt.importClause.namedBindings.elements) {
        if (spec.name.text === name && !spec.isTypeOnly) ident = spec.name;
      }
    } else if (t.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (t.isIdentifier(d.name) && d.name.text === name) ident = d.name;
      }
    }
    if (ident !== undefined) {
      const type = ctx.checker.getTypeAtLocation(ident);
      const typeName = type.aliasSymbol?.name ?? type.symbol?.name;
      if (typeName !== undefined && typeName.endsWith("Type")) return true;
    }
  }
  return false;
}

// A hand-authored TS `interface Foo { … }` next to an East type value `FooType`
// is a parallel MIRROR of the decoded value shape — it drifts silently the
// moment the East type gains a field, and no compiler complains (a renderer
// shipped with three missing config fields exactly this way). Decoded shapes
// must be DERIVED: `type Foo = ValueTypeOf<typeof FooType>`.
export const noHandrolledValueTypeMirror: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "A hand-authored interface mirroring an in-scope East type — derive it with ValueTypeOf<typeof XType> instead.",
  check(node, ctx) {
    const t = ctx.ts;
    let name: ts.Identifier | undefined;
    if (t.isInterfaceDeclaration(node)) {
      name = node.name;
    } else if (t.isTypeAliasDeclaration(node) && t.isTypeLiteralNode(node.type)) {
      name = node.name;
    }
    if (name === undefined) return;
    if (!importsEastPackage(ctx.sourceFile, t)) return;

    const base = name.text.endsWith("Value") ? name.text.slice(0, -"Value".length) : name.text;
    const counterpart = `${base}Type`;
    if (counterpart === name.text) return;
    if (!eastTypeValueInFile(counterpart, ctx)) return;

    const sf = ctx.sourceFile;
    const start = name.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: name.getEnd() - start,
      messageText:
        `\`${name.text}\` hand-mirrors the East type \`${counterpart}\` — it drifts silently when the East type gains a field. Derive it: \`type ${name.text} = ValueTypeOf<typeof ${counterpart}>\`.`,
      category: "suggestion",
    });
  },
};
