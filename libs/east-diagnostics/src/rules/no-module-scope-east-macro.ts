/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";
import { isEastExprType, isBlockBuilderType, isEastDefinitionType } from "../east-type.js";
import { insideBlockScope } from "../block-scope.js";
import { chainRootReceiver } from "../east-ir.js";
import { importDeclarationOf, importsEastPackage, resolvesToEastImport } from "../east-source.js";

const NAME = "no-module-scope-east-macro";
const CODE = 990011;

type FnLike = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;
const VALUE_CONSTRUCTORS = new Set(["variant", "some"]);

function unparen(e: ts.Expression, t: TsModule): ts.Expression {
  let cur = e;
  while (t.isParenthesizedExpression(cur)) cur = cur.expression;
  return cur;
}

function isJsx(node: ts.Node, t: TsModule): boolean {
  return t.isJsxElement(node) || t.isJsxFragment(node) || t.isJsxSelfClosingElement(node) || (t.isParenthesizedExpression(node) && isJsx(node.expression, t));
}

// An untagged template literal with interpolation — `\`${o}|${l}\`` (a composite
// string key); `East.str\`…\`` is a tagged template and is NOT matched.
function isHostTemplate(e: ts.Expression, t: TsModule): boolean {
  return t.isTemplateExpression(unparen(e, t));
}

// `variant(…)` / `some(…)` build East IR only when their payload is IR (an `Expr`,
// or an East builder); over plain host data they build a decoded VALUE — what a
// renderer, a runtime or a test legitimately makes — and `none` alone is a value.
function hasIrArgument(call: ts.CallExpression, ctx: RuleContext): boolean {
  return call.arguments.some((a) => isEastExprType(ctx.checker.getTypeAtLocation(a)) || containsEastBuilder(a, ctx));
}

function isEastValueConstructor(expr: ts.Expression, ctx: RuleContext): boolean {
  const t = ctx.ts;
  if (t.isCallExpression(expr)) {
    const callee = expr.expression;
    if (t.isIdentifier(callee) && VALUE_CONSTRUCTORS.has(callee.text)) return hasIrArgument(expr, ctx);
    return (
      t.isPropertyAccessExpression(callee) && t.isIdentifier(callee.expression) && callee.expression.text === "East" && callee.name.text === "value"
    );
  }
  return false;
}

function isEastBuilderCall(call: ts.CallExpression, ctx: RuleContext): boolean {
  const t = ctx.ts;
  const callee = call.expression;
  if (t.isIdentifier(callee) && VALUE_CONSTRUCTORS.has(callee.text)) return hasIrArgument(call, ctx);
  const root = chainRootReceiver(callee, ctx);
  if (t.isIdentifier(root) && root.text === "East") return true;
  return isBlockBuilderType(ctx.checker.getTypeAtLocation(root));
}

function containsEastBuilder(expr: ts.Expression, ctx: RuleContext): boolean {
  const t = ctx.ts;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (t.isCallExpression(n) && isEastBuilderCall(n, ctx)) {
      found = true;
      return;
    }
    t.forEachChild(n, visit);
  };
  visit(expr);
  return found;
}

function returnBuildsEast(r: ts.Expression, ctx: RuleContext): boolean {
  const t = ctx.ts;
  if (isJsx(r, t)) return false;
  // A DECLARATION factory — a helper returning an e3 definition (`e3.task(…)` →
  // `TaskDef`, `e3.input(…)` → `DatasetDef`, …) or a platform definition
  // (`East.platform(…)`) — composes the program's structure, which is exactly
  // what the host language is FOR. It is not a value macro, even though the
  // definition it returns has East builders (an `East.function` body) inside.
  if (isEastDefinitionType(ctx.checker.getTypeAtLocation(r))) return false;
  if (isEastValueConstructor(r, ctx)) return true;
  if (isEastExprType(ctx.checker.getTypeAtLocation(r))) return true;
  const root = chainRootReceiver(r, ctx);
  const rootType = ctx.checker.getTypeAtLocation(root);
  if (isEastExprType(rootType) || isBlockBuilderType(rootType)) return true;
  return containsEastBuilder(r, ctx);
}

// Is `root` the receiver of a call that builds an East PROGRAM — `East.*` (an
// `East.value`, `East.function`, …), a block's `$`, or an e3 declaration on the
// `@elaraai/e3` import (`e3.input`, `e3.task`, …)? Utilities over decoded values
// (`encodeBeast2For`, `printFor`, `equalFor`, …) build no program.
function buildsEastProgram(root: ts.Node, ctx: RuleContext): boolean {
  const t = ctx.ts;
  if (!t.isIdentifier(root)) return false;
  if (isBlockBuilderType(ctx.checker.getTypeAtLocation(root))) return true;
  if (!resolvesToEastImport(root, ctx.checker, t)) return false;
  if (root.text === "East") return true;
  const imp = importDeclarationOf(ctx.checker.getSymbolAtLocation(root), t);
  return imp !== undefined && t.isStringLiteral(imp.moduleSpecifier) && imp.moduleSpecifier.text === "@elaraai/e3";
}

// Does `call`'s result flow — through array and object literals, templates and
// constructors — into a call that builds an East program?
function flowsIntoEastProgram(call: ts.CallExpression, ctx: RuleContext): boolean {
  const t = ctx.ts;
  let node: ts.Node = call;
  for (;;) {
    const parent: ts.Node | undefined = node.parent;
    if (parent === undefined) return false;
    if (
      t.isArrayLiteralExpression(parent) || t.isObjectLiteralExpression(parent) || t.isPropertyAssignment(parent) ||
      t.isParenthesizedExpression(parent) || t.isSpreadElement(parent) || t.isTemplateSpan(parent) ||
      t.isTemplateExpression(parent) || t.isNewExpression(parent)
    ) {
      node = parent;
      continue;
    }
    if (t.isCallExpression(parent) && parent.expression !== node) {
      return buildsEastProgram(chainRootReceiver(parent.expression, ctx), ctx);
    }
    return false;
  }
}

// A helper that builds decoded VALUES or composite string KEYS from host data is
// a macro only where its output becomes part of an East program — a call inside
// an East block, or one whose result flows into `East.*` / an e3 declaration. The
// same helper in a renderer, a runtime or a test builds host data (a fixture, a
// cache or channel key) and is not.
function feedsEastProgram(name: ts.Identifier, ctx: RuleContext): boolean {
  const t = ctx.ts;
  const symbol = ctx.checker.getSymbolAtLocation(name);
  if (symbol === undefined) return false;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (t.isCallExpression(n) && t.isIdentifier(n.expression) && ctx.checker.getSymbolAtLocation(n.expression) === symbol) {
      if (insideBlockScope(n, ctx) || flowsIntoEastProgram(n, ctx)) {
        found = true;
        return;
      }
    }
    t.forEachChild(n, visit);
  };
  visit(ctx.sourceFile);
  return found;
}

// A `variant(…)` / `some(…)` call or `none` — a decoded East value.
function isValueConstruction(e: ts.Expression, t: TsModule): boolean {
  const r = unparen(e, t);
  if (t.isIdentifier(r)) return r.text === "none";
  return t.isCallExpression(r) && t.isIdentifier(r.expression) && VALUE_CONSTRUCTORS.has(r.expression.text);
}

function returnExpressions(fn: FnLike, t: TsModule): ts.Expression[] {
  if (fn.body === undefined) return [];
  if (!t.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const visit = (n: ts.Node): void => {
    if (t.isFunctionDeclaration(n) || t.isFunctionExpression(n) || t.isArrowFunction(n)) return;
    if (t.isReturnStatement(n) && n.expression !== undefined) out.push(n.expression);
    t.forEachChild(n, visit);
  };
  t.forEachChild(fn.body, visit);
  return out;
}

// A module-scope (outside any East block) TS helper is an authoring-time macro —
// the signature of a string-keyed / hand-built-IR data model — when every return
// builds East IR (`East.value`, an `Expr` chain, a `variant`/`some` over IR); or
// when every return builds a decoded East value (`variant`/`some`/`none` over host
// data) or a composite string key from a host template (`(o, l) => \`${o}|${l}\``)
// AND a call of it feeds an East program (inside a block, or into `East.*` / an e3
// declaration). It cannot be serialized/recursed and expands inline at each call.
// Make it a real `East.function`, or model the data with typed keys / nested East
// structures. A helper building values or keys for HOST code — a renderer's
// fixture, a cache or channel key — is host data, not a macro. (In-block TS
// closures are flagged by `no-host-in-east-block`; this rule covers the
// module-scope helpers that the block-scoped rule cannot see.)
export const noModuleScopeEastMacro: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Flag a module-scope TS helper that builds East values/IR or a composite string key — make it a real East.function or model typed/nested East data.",
  check(node, ctx) {
    const t = ctx.ts;
    // Only in East/e3 source — a plain string-key helper in ordinary TypeScript is
    // not our concern (the East-IR arm already implies an `@elaraai/*` import; this
    // gates the composite-key heuristic against non-East code).
    if (!importsEastPackage(ctx.sourceFile, t)) return;

    let fn: FnLike | undefined;
    let reportNode: ts.Node | undefined;
    let nameNode: ts.Identifier | undefined;
    if (t.isFunctionDeclaration(node) && node.body !== undefined) {
      fn = node;
      reportNode = node.name ?? node;
      nameNode = node.name;
    } else if (
      t.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      (t.isArrowFunction(node.initializer) || t.isFunctionExpression(node.initializer))
    ) {
      fn = node.initializer;
      reportNode = node.name;
      if (t.isIdentifier(node.name)) nameNode = node.name;
    }
    if (fn === undefined || reportNode === undefined) return;

    // In-block closures are `no-host-in-east-block`'s job; this rule is for the
    // module-scope macros it can't see.
    if (insideBlockScope(fn, ctx)) return;

    // East block callbacks (`($, x) => …`) are not TS helpers.
    const first = fn.parameters[0];
    if (first !== undefined && isBlockBuilderType(ctx.checker.getTypeAtLocation(first.name))) return;

    const rs = returnExpressions(fn, t);
    if (rs.some((r) => isJsx(r, t))) return; // UI-composition helper
    if (rs.length === 0) return;

    // IR built in a module-scope helper is a macro wherever it is used; decoded
    // values and composite keys are one where they feed an East program.
    const everyBuildsIr = rs.every((r) => returnBuildsEast(r, ctx));
    const everyBuildsValue = !everyBuildsIr && rs.every((r) => returnBuildsEast(r, ctx) || isValueConstruction(r, t));
    const everyHostKey = !everyBuildsIr && !everyBuildsValue && rs.every((r) => isHostTemplate(r, t));
    if (!everyBuildsIr && !((everyBuildsValue || everyHostKey) && nameNode !== undefined && feedsEastProgram(nameNode, ctx))) return;

    const sf = ctx.sourceFile;
    const start = reportNode.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: reportNode.getEnd() - start,
      messageText: everyHostKey
        ? "This helper builds a composite string key from a host template literal — the signature of a string-keyed data model. Model the data with typed keys / nested East structures instead."
        : "This module-scope TS helper builds East values/IR — an authoring-time macro that expands inline and can't be serialized. Make it a real `East.function`, or inline it.",
      category: "warning",
    });
  },
};
