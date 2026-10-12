/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { RuleContext, TsModule } from "./types.js";
import { isEastExprType } from "./east-type.js";
import { insideBlockScope } from "./block-scope.js";
import { resolvesToEastImport } from "./east-source.js";

// DECODED East values — the host-side world of `ValueTypeOf<…>`: what a renderer,
// a runtime or a test holds once East has decoded a value. Their TypeScript types
// are mostly JavaScript's own (`bigint`, `number`, `string`, `Date`, `Set`, `Map`,
// arrays), so a value is recognised by where its type COMES FROM, never by a name
// list:
//
// - a struct is an object type declared by East's `ValueTypeOf` mapped type;
// - a variant or option is an object type carrying East's `[variant_symbol]`;
// - a `SortedSet` / `SortedMap` is East's own class;
// - and anything read out of one of those — a struct's field, a variant's
//   `value`, an element of a collection read from one — is an East value too.

/** Is `decl` declared by the `@elaraai/east` package — its built declarations, or
 * its source when a workspace links to it? */
function declaredByEast(decl: ts.Node): boolean {
  const file = decl.getSourceFile().fileName.replace(/\\/g, "/");
  return /(?:@elaraai\/east|\/libs\/east)\/(?:dist\/)?src\//.test(file);
}

/** Is `decl` declared by an East-ecosystem package the file depends on — a built
 * declaration file of `@elaraai/*` (east, east-ui, e3, …)? A package's own sources
 * are not declaration files, so its local helpers never count. */
function declaredByEastPackage(decl: ts.Node): boolean {
  const sf = decl.getSourceFile();
  return sf.isDeclarationFile && /(?:\/@elaraai\/|\/libs\/)/.test(sf.fileName.replace(/\\/g, "/"));
}

/** The non-nullish constituents of `type`. */
function constituents(type: ts.Type, t: TsModule): ts.Type[] {
  const members = type.isUnion() ? type.types : [type];
  return members.filter((m) => (m.flags & (t.TypeFlags.Null | t.TypeFlags.Undefined | t.TypeFlags.Void)) === 0);
}

/** A decoded East struct: an object type East's `ValueTypeOf` mapped type declares. */
function isStructConstituent(type: ts.Type, t: TsModule): boolean {
  return (type.symbol?.declarations ?? []).some((d) => t.isMappedTypeNode(d) && declaredByEast(d));
}

/** A decoded East variant (an option is one): an object type carrying East's `[variant_symbol]`. */
function isVariantConstituent(type: ts.Type, checker: ts.TypeChecker): boolean {
  if ((type.flags & 1 /* Any */) !== 0) return false;
  for (const prop of checker.getPropertiesOfType(type)) {
    if (!String(prop.escapedName).startsWith("__@variant_symbol")) continue;
    if ((prop.declarations ?? []).some(declaredByEast)) return true;
  }
  return false;
}

/** East's own sorted collections. */
function isSortedConstituent(type: ts.Type): boolean {
  const name = type.symbol?.name;
  return (name === "SortedSet" || name === "SortedMap") && (type.symbol?.declarations ?? []).some(declaredByEast);
}

/** Is `type` (or one of its non-nullish members) a decoded East struct, variant
 * or sorted collection? A type with an East `Expr` among its members — a factory's
 * `SubtypeExprOrValue<…>` input — is authoring, not a decoded value. */
export function isEastValueShape(type: ts.Type, ctx: RuleContext): boolean {
  if (isEastExprType(type)) return false;
  return constituents(type, ctx.ts).some(
    (m) => isStructConstituent(m, ctx.ts) || isVariantConstituent(m, ctx.checker) || isSortedConstituent(m),
  );
}

/** Is `type` a decoded East struct or variant — a value whose properties are its
 * fields, or its tag and payload? */
function isRecordShape(type: ts.Type, ctx: RuleContext): boolean {
  return constituents(type, ctx.ts).some((m) => isStructConstituent(m, ctx.ts) || isVariantConstituent(m, ctx.checker));
}

/** Does JavaScript print a value of `type` differently from East? A String, an
 * Integer (`bigint`) and a Boolean print the same either way; a Float (`5` for
 * East's `5.0`), a DateTime, a Blob and every object do not. */
export function jsPrintDiffers(type: ts.Type, t: TsModule): boolean {
  const same = t.TypeFlags.StringLike | t.TypeFlags.BigIntLike | t.TypeFlags.BooleanLike;
  return constituents(type, t).some((m) => (m.flags & same) === 0);
}

/** Is `id` JavaScript's own global (`String`, `BigInt`, `Set`, `JSON`, …) — declared
 * by the default library, not shadowed by a local or an import? */
export function isGlobalBuiltin(id: ts.Identifier, ctx: RuleContext): boolean {
  const declarations = ctx.checker.getSymbolAtLocation(id)?.declarations ?? [];
  return declarations.length > 0 && declarations.every((d) => {
    const file = d.getSourceFile();
    return ctx.program?.isSourceFileDefaultLibrary(file) ?? /\/typescript\/lib\/lib\.[^/]*\.d\.ts$/.test(file.fileName.replace(/\\/g, "/"));
  });
}

/** Strip the wrappers that leave a value as it is: parentheses, `!`, `as`,
 * `satisfies` and `<T>` assertions. */
export function skipValueWrappers(e: ts.Expression, t: TsModule): ts.Expression {
  let cur = e;
  for (;;) {
    if (t.isParenthesizedExpression(cur) || t.isNonNullExpression(cur) || t.isAsExpression(cur) || t.isTypeAssertionExpression(cur) || t.isSatisfiesExpression(cur)) {
      cur = cur.expression;
    } else {
      return cur;
    }
  }
}

/** Methods that read an element out of a collection. */
const ELEMENT_READS = new Set(["get", "at"]);

/**
 * Is `e` a decoded East value — typed as an East struct, variant or sorted
 * collection, or read out of one (a field, a payload, an element), or a `const`
 * bound to such a read?
 *
 * @param e - The expression
 * @param ctx - The rule context
 * @returns Whether the expression evaluates to a decoded East value
 */
export function isEastValueExpression(e: ts.Expression, ctx: RuleContext): boolean {
  return eastValueExpression(e, ctx, 0);
}

function eastValueExpression(e: ts.Expression, ctx: RuleContext, depth: number): boolean {
  const t = ctx.ts;
  const expr = skipValueWrappers(e, t);
  const type = ctx.checker.getTypeAtLocation(expr);
  // An `Expr`, or a factory input that may be one, is authoring.
  if (isEastExprType(type)) return false;
  if (isEastValueShape(type, ctx)) return true;
  // A field of a struct, or a variant's tag and payload.
  if (t.isPropertyAccessExpression(expr)) {
    return isRecordShape(ctx.checker.getTypeAtLocation(expr.expression), ctx);
  }
  // An element of a collection read from an East value.
  if (t.isElementAccessExpression(expr)) {
    return eastValueExpression(expr.expression, ctx, depth);
  }
  if (t.isCallExpression(expr) && t.isPropertyAccessExpression(expr.expression) && ELEMENT_READS.has(expr.expression.name.text)) {
    return eastValueExpression(expr.expression.expression, ctx, depth);
  }
  // A `const` bound to one of the above.
  if (t.isIdentifier(expr) && depth < 3) {
    const decl = ctx.checker.getSymbolAtLocation(expr)?.valueDeclaration;
    if (
      decl !== undefined && t.isVariableDeclaration(decl) && decl.initializer !== undefined &&
      t.isVariableDeclarationList(decl.parent) && (decl.parent.flags & t.NodeFlags.Const) !== 0
    ) {
      return eastValueExpression(decl.initializer, ctx, depth + 1);
    }
  }
  return false;
}

/** Where a value flows: into an East PROGRAM (authored — East converts it through
 * the type it is declared with), into a decoded East VALUE, or into host code. */
type Flow = "program" | "value" | "host";

/** Is `call` East's `variant(…)` / `some(…)` — a value constructor its payload
 * flows through? */
function isValueConstructorCall(call: ts.CallExpression, ctx: RuleContext): boolean {
  const t = ctx.ts;
  const callee = call.expression;
  return t.isIdentifier(callee) && (callee.text === "variant" || callee.text === "some") &&
    resolvesToEastImport(callee, ctx.checker, t);
}

/** Does the type written at `node` name an East value type — `ValueTypeOf<…>`,
 * an alias of one, a type East declares, or a type parameter, which may be any
 * value — anywhere in it? `any` and `unknown` may hold one too. */
function mentionsEastValueType(node: ts.Node, ctx: RuleContext, seen: Set<ts.Symbol>): boolean {
  const t = ctx.ts;
  if (node.kind === t.SyntaxKind.AnyKeyword || node.kind === t.SyntaxKind.UnknownKeyword) return true;
  if (t.isTypeReferenceNode(node)) {
    const named = ctx.checker.getSymbolAtLocation(node.typeName);
    const symbol = named !== undefined && (named.flags & t.SymbolFlags.Alias) !== 0 ? ctx.checker.getAliasedSymbol(named) : named;
    const declarations = symbol?.declarations ?? [];
    if (declarations.some((d) => declaredByEast(d) || t.isTypeParameterDeclaration(d))) return true;
    // An alias is what it names — each followed once, so a recursive one ends.
    if (symbol !== undefined && !seen.has(symbol)) {
      seen.add(symbol);
      if (declarations.some((d) => t.isTypeAliasDeclaration(d) && mentionsEastValueType(d.type, ctx, seen))) return true;
    }
  }
  return t.forEachChild(node, (child) => (mentionsEastValueType(child, ctx, seen) ? true : undefined)) === true;
}

/** Is the parameter `signature`'s argument `index` binds written in East's value
 * types (see {@link mentionsEastValueType})? One with no declared type may hold
 * any value. */
function writtenInEastValues(signature: ts.Signature, index: number, ctx: RuleContext): boolean {
  const params = signature.getParameters();
  const declaration = params[Math.min(index, params.length - 1)]?.valueDeclaration;
  if (declaration === undefined || !ctx.ts.isParameter(declaration) || declaration.type === undefined) return true;
  return mentionsEastValueType(declaration.type, ctx, new Set());
}

/** The type of the parameter `call`'s argument `index` binds — a rest
 * parameter's element type. */
function parameterTypeAt(signature: ts.Signature, index: number, call: ts.Node, ctx: RuleContext): ts.Type | undefined {
  const t = ctx.ts;
  const params = signature.getParameters();
  if (params.length === 0) return undefined;
  const param = params[Math.min(index, params.length - 1)]!;
  const type = ctx.checker.getTypeOfSymbolAtLocation(param, call);
  const declaration = param.valueDeclaration;
  if (declaration !== undefined && t.isParameter(declaration) && declaration.dotDotDotToken !== undefined) {
    return ctx.checker.getTypeArguments(type as ts.TypeReference)[0];
  }
  return type;
}

/** Follow the value `e` produces to where it lands. */
function flowOf(e: ts.Expression, ctx: RuleContext): Flow {
  const t = ctx.ts;
  if (insideBlockScope(e, ctx)) return "program";
  let node: ts.Node = e;
  // Whether the value has become part of a decoded East struct or variant.
  let east = false;
  for (;;) {
    const parent: ts.Node | undefined = node.parent;
    if (parent === undefined) return east ? "value" : "host";
    if (
      t.isParenthesizedExpression(parent) || t.isAsExpression(parent) || t.isSatisfiesExpression(parent) ||
      t.isNonNullExpression(parent) || t.isTypeAssertionExpression(parent) ||
      t.isArrayLiteralExpression(parent) || t.isSpreadElement(parent)
    ) {
      node = parent;
      continue;
    }
    if ((t.isPropertyAssignment(parent) && parent.initializer === node) || t.isShorthandPropertyAssignment(parent)) {
      const literal = parent.parent;
      const contextual = ctx.checker.getContextualType(literal);
      if (contextual !== undefined && isRecordShape(contextual, ctx)) east = true;
      node = literal;
      continue;
    }
    const args: readonly ts.Expression[] = (t.isCallExpression(parent) || t.isNewExpression(parent)) ? parent.arguments ?? [] : [];
    if ((t.isCallExpression(parent) || t.isNewExpression(parent)) && args.includes(node as ts.Expression)) {
      if (t.isCallExpression(parent) && isValueConstructorCall(parent, ctx)) {
        east = true;
        node = parent;
        continue;
      }
      const signature = ctx.checker.getResolvedSignature(parent);
      const declaration = signature?.getDeclaration();
      if (signature !== undefined && declaration !== undefined && declaredByEastPackage(declaration)) {
        // A parameter that takes an `Expr` takes authoring input; one that takes a
        // decoded value — an East function value's, an encoder's — takes a value.
        const index = args.indexOf(node as ts.Expression);
        const param = parameterTypeAt(signature, index, parent, ctx);
        if (param !== undefined && isEastExprType(param)) return "program";
        // East's own functions take decoded values. Another East package's takes
        // one where the parameter is written in East's value types; one written
        // in host types alone — a DOM test helper's `ReadonlyMap<Element, Rect>`,
        // a pixel count — takes the host's (#1177).
        if (declaredByEast(declaration) || writtenInEastValues(signature, index, ctx)) return "value";
      }
      return east ? "value" : "host";
    }
    return east ? "value" : "host";
  }
}

/**
 * Does `e` land in a decoded East value — an argument to an East function value
 * or a utility over decoded values (an encoder, a comparer), a field of a decoded
 * struct, a variant's payload — rather than in an East program (authored input
 * East converts through its type) or in host code?
 *
 * @param e - The expression
 * @param ctx - The rule context
 * @returns Whether the value `e` produces becomes (part of) a decoded East value
 */
export function landsInEastSlot(e: ts.Expression, ctx: RuleContext): boolean {
  return flowOf(e, ctx) === "value";
}
