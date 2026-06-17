/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";
import { isEastExprType, isBlockBuilderType } from "../east-type.js";
import { insideBlockScope } from "../block-scope.js";
import { chainRootReceiver } from "../east-ir.js";
import { importsEastPackage } from "../east-source.js";

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

function isEastValueConstructor(expr: ts.Expression, t: TsModule): boolean {
  if (t.isCallExpression(expr)) {
    const callee = expr.expression;
    if (t.isIdentifier(callee) && VALUE_CONSTRUCTORS.has(callee.text)) return true;
    return (
      t.isPropertyAccessExpression(callee) && t.isIdentifier(callee.expression) && callee.expression.text === "East" && callee.name.text === "value"
    );
  }
  return t.isIdentifier(expr) && expr.text === "none";
}

function isEastBuilderCall(call: ts.CallExpression, ctx: RuleContext): boolean {
  const t = ctx.ts;
  const callee = call.expression;
  if (t.isIdentifier(callee) && VALUE_CONSTRUCTORS.has(callee.text)) return true;
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
  if (isEastValueConstructor(r, t)) return true;
  if (isEastExprType(ctx.checker.getTypeAtLocation(r))) return true;
  const root = chainRootReceiver(r, ctx);
  const rootType = ctx.checker.getTypeAtLocation(root);
  if (isEastExprType(rootType) || isBlockBuilderType(rootType)) return true;
  return containsEastBuilder(r, ctx);
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

// A module-scope (outside any East block) TS helper whose every return builds East
// IR (`variant`/`some`/`none`/`East.value`/an `Expr` chain) OR builds a composite
// string key from a host template literal (`(o, l) => \`${o}|${l}\``) is an
// authoring-time macro and the signature of a string-keyed / hand-built-IR data
// model. It cannot be serialized/recursed and expands inline at each call. Make it
// a real `East.function`, or model the data with typed keys / nested East
// structures. (In-block TS closures are flagged by `no-host-in-east-block`; this
// rule covers the module-scope helpers that the block-scoped rule cannot see.)
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
    if (t.isFunctionDeclaration(node) && node.body !== undefined) {
      fn = node;
      reportNode = node.name ?? node;
    } else if (
      t.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      (t.isArrowFunction(node.initializer) || t.isFunctionExpression(node.initializer))
    ) {
      fn = node.initializer;
      reportNode = node.name;
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

    const everyBuildsEast = rs.every((r) => returnBuildsEast(r, ctx));
    const everyHostKey = rs.every((r) => isHostTemplate(r, t));
    if (!everyBuildsEast && !everyHostKey) return;

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
