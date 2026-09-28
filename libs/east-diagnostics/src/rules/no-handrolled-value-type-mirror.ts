/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";
import { importsEastPackage, resolvesToEastImport } from "../east-source.js";
import { isEastValueShape } from "../east-value.js";

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

/** The member signatures of an interface or type literal. */
function membersOf(node: ts.InterfaceDeclaration | ts.TypeLiteralNode): readonly ts.TypeElement[] {
  return node.members;
}

/** Does a type node mention an `@elaraai/*` import anywhere inside it? */
function mentionsEastImport(typeNode: ts.Node, ctx: RuleContext): boolean {
  const t = ctx.ts;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (t.isTypeReferenceNode(n)) {
      const name = t.isIdentifier(n.typeName) ? n.typeName : t.isQualifiedName(n.typeName) ? leftmost(n.typeName, t) : undefined;
      if (name !== undefined && resolvesToEastImport(name, ctx.checker, t)) {
        found = true;
        return;
      }
    }
    t.forEachChild(n, visit);
  };
  visit(typeNode);
  return found;
}

function leftmost(q: ts.QualifiedName, t: TsModule): ts.Identifier {
  let cur: ts.EntityName = q;
  while (t.isQualifiedName(cur)) cur = cur.left;
  return cur;
}

/** Is some member of `shape` typed as a decoded East value — a variant, a struct,
 * a sorted collection — however its type is spelled? */
function holdsEastValue(shape: ts.InterfaceDeclaration | ts.TypeLiteralNode, ctx: RuleContext): boolean {
  const t = ctx.ts;
  return membersOf(shape).some((m) => t.isPropertySignature(m) && m.type !== undefined &&
    isEastValueShape(ctx.checker.getTypeFromTypeNode(m.type), ctx));
}

/** A factory's options interface — members typed `SubtypeExprOrValue<…>` /
 * `ExprType<…>` — describes what an author passes IN, not a decoded value. */
function isFactoryInput(node: ts.InterfaceDeclaration | ts.TypeLiteralNode, ctx: RuleContext): boolean {
  const t = ctx.ts;
  const sf = ctx.sourceFile;
  return membersOf(node).some((m) => {
    const type = t.isPropertySignature(m) ? m.type : undefined;
    return type !== undefined && /\b(?:SubtypeExprOrValue|ExprType)</.test(type.getText(sf));
  });
}

/** A `{ type: …; value: … }` type literal — a variant's shape written by hand. */
function isVariantShapedLiteral(node: ts.TypeNode, t: TsModule): boolean {
  if (!t.isTypeLiteralNode(node)) return false;
  const names = new Set(node.members.flatMap((m) => (m.name !== undefined && t.isIdentifier(m.name) ? [m.name.text] : [])));
  return names.has("type") && names.has("value");
}

function report(ctx: RuleContext, node: ts.Node, messageText: string): void {
  const start = node.getStart(ctx.sourceFile);
  ctx.report({ ruleName: NAME, code: CODE, start, length: node.getEnd() - start, messageText, category: "suggestion" });
}

// A hand-authored TS type next to the East type it describes is a parallel
// MIRROR of the decoded value shape — it drifts silently the moment the East type
// gains a field, and no compiler complains (a renderer shipped with three missing
// config fields exactly this way). Decoded shapes must be DERIVED:
// `type Foo = ValueTypeOf<typeof FooType>`. Three spellings are caught:
//
// - `interface Foo` / `type FooValue = { … }` beside an in-scope `FooType`;
// - a `*Like` interface or type literal built from East types (`StateLike`);
// - an `as { type: …; value: … }` assertion — a variant's shape written by hand.
//
// A factory's options interface (`SubtypeExprOrValue<…>` members) is an input,
// not a decoded mirror, and is left alone.
export const noHandrolledValueTypeMirror: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "A hand-authored type mirroring an East type (Foo beside FooType, a *Like stand-in, an `as { type; value }` assertion) — derive it with ValueTypeOf<typeof XType> instead.",
  check(node, ctx) {
    const t = ctx.ts;
    if (t.isAsExpression(node) || t.isTypeAssertionExpression(node)) {
      if (!isVariantShapedLiteral(node.type, t)) return;
      if (!importsEastPackage(ctx.sourceFile, t)) return;
      report(ctx, node.type, "This `{ type, value }` assertion hand-mirrors an East variant — it hides the value's real type. Narrow the typed value on its tag (`v.type === …`), or type it with `ValueTypeOf<typeof XType>`.");
      return;
    }

    let name: ts.Identifier | undefined;
    let shape: ts.InterfaceDeclaration | ts.TypeLiteralNode | undefined;
    if (t.isInterfaceDeclaration(node)) {
      name = node.name;
      shape = node;
    } else if (t.isTypeAliasDeclaration(node) && t.isTypeLiteralNode(node.type)) {
      name = node.name;
      shape = node.type;
    }
    if (name === undefined || shape === undefined) return;
    if (!importsEastPackage(ctx.sourceFile, t)) return;
    if (isFactoryInput(shape, ctx)) return;

    if (name.text.length > "Like".length && name.text.endsWith("Like") && (mentionsEastImport(shape, ctx) || holdsEastValue(shape, ctx))) {
      report(ctx, name, `\`${name.text}\` is a loose stand-in for an East value's type — it drifts silently when the East type changes. Type the value with \`ValueTypeOf<typeof XType>\` of the East type it holds.`);
      return;
    }

    const base = name.text.endsWith("Value") ? name.text.slice(0, -"Value".length) : name.text;
    const counterpart = `${base}Type`;
    if (counterpart === name.text) return;
    if (!eastTypeValueInFile(counterpart, ctx)) return;

    report(ctx, name, `\`${name.text}\` hand-mirrors the East type \`${counterpart}\` — it drifts silently when the East type gains a field. Derive it: \`type ${name.text} = ValueTypeOf<typeof ${counterpart}>\`.`);
  },
};
