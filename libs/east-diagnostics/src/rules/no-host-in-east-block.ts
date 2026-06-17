/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";
import { isEastExprType, isBlockBuilderType } from "../east-type.js";
import { insideBlockScope } from "../block-scope.js";
import { chainRootReceiver, bodyBuildsEastIr } from "../east-ir.js";

const NAME = "no-host-in-east-block";
const CODE = 990020;

// ── East-vs-host classification ─────────────────────────────────────────────

/** Does `id` resolve to a binding imported from an `@elaraai/*` package? (The
 * whole East ecosystem API — `East`, `Expr`, `variant`/`some`, `ArrayType`/
 * `StructType`/`DictType`, `GoogleOr`, `Data`, … — is recognised by SYMBOL, not a
 * brittle name list.) */
function resolvesToEastImport(id: ts.Identifier, ctx: RuleContext): boolean {
  const t = ctx.ts;
  // Use the LOCAL import symbol (its declaration is the ImportSpecifier/clause) —
  // do NOT resolve the alias, which would jump to the declaration inside
  // @elaraai/east and lose the import-specifier we key on.
  const sym = ctx.checker.getSymbolAtLocation(id);
  for (const d of sym?.declarations ?? []) {
    let n: ts.Node = d;
    if (t.isImportSpecifier(n)) n = n.parent.parent.parent;
    else if (t.isNamespaceImport(n)) n = n.parent.parent;
    else if (t.isImportClause(n)) n = n.parent;
    else continue;
    if (t.isImportDeclaration(n) && t.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text.startsWith("@elaraai/")) {
      return true;
    }
  }
  return false;
}

/**
 * Does `id` resolve to a binding LOCAL to an East block whose runtime value is an
 * East `Expr` typed loosely as `any` — an in-block TS macro (`g`/`sdiv`/`roundI`/…,
 * itself reported by clause E) or one of its loosely-typed parameters? East methods
 * chained off such a receiver (`sdiv(a, b).multiply(…)`, or `a.divide(b)` inside the
 * macro body) are East methods, not separate host calls: the macro is already
 * flagged, so re-reporting the East ops on its result/operands is a false positive.
 * (We must NOT exempt all `any` receivers — only these block-local East bindings.)
 */
function resolvesToInBlockEastBinding(id: ts.Identifier, ctx: RuleContext): boolean {
  const t = ctx.ts;
  const sym = ctx.checker.getSymbolAtLocation(id);
  for (const d of sym?.declarations ?? []) {
    // An in-block TS macro: `const f = (…) => …` / `function f(…) {…}`.
    if (t.isFunctionDeclaration(d) && d.body !== undefined && insideBlockScope(d, ctx)) return true;
    if (
      t.isVariableDeclaration(d) &&
      d.initializer !== undefined &&
      (t.isArrowFunction(d.initializer) || t.isFunctionExpression(d.initializer)) &&
      insideBlockScope(d, ctx)
    ) {
      return true;
    }
    // A parameter of an in-block TS macro (its loosely-typed East operands). A
    // `$`-callback's params are already East-typed (clause A2 handles them), so
    // only non-`$` macro params reach here.
    if (t.isParameter(d)) {
      const fn = d.parent;
      if (
        (t.isArrowFunction(fn) || t.isFunctionExpression(fn) || t.isFunctionDeclaration(fn)) &&
        insideBlockScope(fn, ctx)
      ) {
        const first = fn.parameters[0];
        if (first === undefined || !isBlockBuilderType(ctx.checker.getTypeAtLocation(first.name))) return true;
      }
    }
  }
  return false;
}

/** Is a CallExpression an EAST call (allowed), vs a HOST call (the violation)? */
function isEastCall(call: ts.CallExpression, ctx: RuleContext): boolean {
  const t = ctx.ts;
  const f = call.expression;
  // A0 — the callee is itself an East value (a bound `East.function`, a
  // function-typed param, a curried/higher-order East fn).
  if (isEastExprType(ctx.checker.getTypeAtLocation(f))) return true;
  const root = chainRootReceiver(f, ctx);
  // A1 — rooted on the block builder `$` (`$.let`/`$.const`/`$(…)`/`$.if`/…).
  if (isBlockBuilderType(ctx.checker.getTypeAtLocation(root))) return true;
  // A2 — a method on an East `Expr` receiver (`.add`/`.get`/`.map`/`.match`/…).
  // Read the immediate receiver's own type (survives an `: any` return).
  if (t.isPropertyAccessExpression(f) && isEastExprType(ctx.checker.getTypeAtLocation(f.expression))) return true;
  // A5 — rooted on an `@elaraai/*` import (`East.*`, `Expr.*`, `variant`/`some`,
  // `ArrayType`/`StructType`/`DictType`, `GoogleOr.*`, …).
  if (t.isIdentifier(root) && resolvesToEastImport(root, ctx)) return true;
  // A6 — a method chained off an in-block TS macro or its loosely-typed (`any`)
  // operand, whose type-info is lost as `any`. The macro is reported elsewhere
  // (clause E / its bare call); the East methods on its East-`Expr` result are
  // East, not additional host calls.
  if (t.isPropertyAccessExpression(f) && t.isIdentifier(root) && resolvesToInBlockEastBinding(root, ctx)) return true;
  return false;
}

function isEast(expr: ts.Expression, ctx: RuleContext): boolean {
  return isEastExprType(ctx.checker.getTypeAtLocation(expr));
}

/** Is `node` inside JSX (UI composition is out of scope — `prefer-jsx-…` owns it)? */
function insideJsx(node: ts.Node, t: TsModule): boolean {
  let cur: ts.Node | undefined = node.parent;
  while (cur !== undefined) {
    if (t.isJsxElement(cur) || t.isJsxSelfClosingElement(cur) || t.isJsxFragment(cur) || t.isJsxExpression(cur) || t.isJsxAttribute(cur)) {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

function isJsx(node: ts.Node, t: TsModule): boolean {
  return t.isJsxElement(node) || t.isJsxFragment(node) || t.isJsxSelfClosingElement(node) || (t.isParenthesizedExpression(node) && isJsx(node.expression, t));
}

/** The expressions a function/arrow returns, not descending into nested functions. */
function returnExpressions(fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration, t: TsModule): ts.Expression[] {
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

const REPORT = (ctx: RuleContext, target: ts.Node, messageText: string, fix?: { description: string; newText: string }): void => {
  const sf = ctx.sourceFile;
  const start = target.getStart(sf);
  const length = target.getEnd() - start;
  ctx.report({
    ruleName: NAME,
    code: CODE,
    start,
    length,
    messageText,
    category: "warning",
    ...(fix !== undefined ? { fix: { description: fix.description, changes: [{ start, length, newText: fix.newText }] } } : {}),
  });
};

// Inside an East block the code must be East all the way down — only East
// expressions and East statements (`$.let`/`$.const`/`$(…)`/`$.if`/`$.for`/`$.assign`,
// East `Expr` method chains, `East.*`/`Expr.*`/`variant`/`some`/`none`, `East.str`,
// and `return <East expr>`). ANY host-language construct is an authoring-time macro
// over East: a call to a host function (a local TS helper, a JS builtin, a JS Array
// method), a host operator on East operands, a host `for`/`while`/`if` that emits
// IR, or host string interpolation. Express it in East instead.
export const noHostInEastBlock: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Flag host-language constructs (host calls, operators on East operands, JS control-flow, host string interpolation) inside an East block — express them in East.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!insideBlockScope(node, ctx)) return;
    if (insideJsx(node, t)) return;

    // Clause E — a TS closure/function DECLARED inside an East block (a `const`
    // arrow, a function-expression, or a `function` declaration). It is an
    // authoring-time macro: it can't be serialized/recursed and expands inline at
    // each call. `$`-callbacks (`($, x) => …`) and JSX/UI helpers are excluded.
    {
      let fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | undefined;
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
      if (fn !== undefined && reportNode !== undefined) {
        const first = fn.parameters[0];
        if (first !== undefined && isBlockBuilderType(ctx.checker.getTypeAtLocation(first.name))) return; // East `$`-callback
        if (returnExpressions(fn, t).some((r) => isJsx(r, t))) return; // UI-composition helper
        REPORT(
          ctx,
          reportNode,
          "TS closure/function declared inside an East block — an authoring-time macro (it can't be serialized or recursed and expands inline at each call). Make it a real `East.function` (`$.const(East.function(...))`) or inline it.",
        );
        return;
      }
    }

    // Clause C — host control-flow statements that emit East IR.
    if (t.isForStatement(node) || t.isWhileStatement(node) || t.isForOfStatement(node)) {
      if (t.isForOfStatement(node) && isEast(node.expression, ctx)) return; // for-of over an East Expr is fine
      if (!bodyBuildsEastIr(node.statement, ctx)) return;
      REPORT(ctx, node.getChildAt(0, ctx.sourceFile), "Host loop building East IR — bind the data with `$.const([...], ArrayType(...))` and use an East collection op (`data.map(($, x) => …)`) or `$.for(data, ($, x) => …)`.");
      return;
    }
    if (t.isIfStatement(node)) {
      const emits = bodyBuildsEastIr(node.thenStatement, ctx) || (node.elseStatement !== undefined && bodyBuildsEastIr(node.elseStatement, ctx));
      if (!emits) return;
      REPORT(ctx, node.getChildAt(0, ctx.sourceFile), "Host `if` building East IR — use East's `$.if(cond, …)` so the branch is chosen at East runtime.");
      return;
    }

    // Clause B — host operators on East operands.
    if (t.isConditionalExpression(node)) {
      if (isEast(node.condition, ctx) && isEast(node.whenTrue, ctx) && isEast(node.whenFalse, ctx)) {
        const sf = ctx.sourceFile;
        REPORT(ctx, node, "Host `?:` selecting between East values — use `cond.ifElse(() => a, () => b)`.", {
          description: "Rewrite as cond.ifElse(...)",
          newText: `(${node.condition.getText(sf)}).ifElse(() => ${node.whenTrue.getText(sf)}, () => ${node.whenFalse.getText(sf)})`,
        });
      }
      return;
    }
    if (t.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      const k = t.SyntaxKind;
      const logical = op === k.AmpersandAmpersandToken || op === k.BarBarToken;
      const arith =
        op === k.PlusToken || op === k.MinusToken || op === k.AsteriskToken || op === k.SlashToken ||
        op === k.PercentToken || op === k.EqualsEqualsEqualsToken || op === k.ExclamationEqualsEqualsToken ||
        op === k.EqualsEqualsToken || op === k.LessThanToken || op === k.LessThanEqualsToken ||
        op === k.GreaterThanToken || op === k.GreaterThanEqualsToken;
      if (logical && isEast(node.left, ctx) && isEast(node.right, ctx)) {
        REPORT(ctx, node, "Host `&&`/`||` on East booleans — use East's `.and(() => …)` / `.or(() => …)`.");
      } else if (arith && (isEast(node.left, ctx) || isEast(node.right, ctx))) {
        REPORT(ctx, node, "Host operator on an East value — use the East method (`.add`/`.subtract`/`.multiply`/`.divide`) or `East.equal`/`East.less`/`East.greater`.");
      }
      return;
    }
    if (t.isPrefixUnaryExpression(node) && (node.operator === t.SyntaxKind.MinusToken || node.operator === t.SyntaxKind.ExclamationToken)) {
      if (isEast(node.operand, ctx)) {
        REPORT(ctx, node, "Host unary operator on an East value — use `.negate()` / `East.not`.");
      }
      return;
    }

    // Clause F — host index access `x[i]` on a JS value (an East collection is
    // read with `.get(...)`, never `[i]`, so a non-`Expr` receiver here is a host
    // array/object being indexed — `adopt[ti]`, `BUSINESS_UNITS[oi]`).
    if (t.isElementAccessExpression(node)) {
      if (isEast(node.expression, ctx)) return; // (an Expr has no index signature anyway)
      REPORT(ctx, node, "Host index access on a JS value inside an East block — model the data as an East collection and read it with `.get(...)` / East ops, not `[i]`.");
      return;
    }

    // Clause D — host string interpolation (not an `East.str`/`str` tagged template).
    if (t.isTemplateExpression(node) && !(node.parent !== undefined && t.isTaggedTemplateExpression(node.parent))) {
      REPORT(ctx, node, "Host string interpolation inside an East block — build the string in East with `East.str`…`` (or `str`…``).");
      return;
    }

    // Clause A — host call.
    if (t.isCallExpression(node)) {
      if (isEastCall(node, ctx)) return;
      // Specialised message for the host-key-into-East-collection sub-case.
      const callee = node.expression;
      const KEY_ACCESSORS = new Set(["get", "tryGet", "has", "insert", "insertOrUpdate", "update", "remove"]);
      REPORT(
        ctx,
        node,
        t.isPropertyAccessExpression(callee) && KEY_ACCESSORS.has(callee.name.text)
          ? "Host call inside an East block — make it a real `East.function` (`$.const(East.function(...))`) or inline it as East."
          : "Host call inside an East block — this is an authoring-time macro over East. Make it a real `East.function` (`$.const(East.function(...))`), inline it as East, or use the East stdlib.",
      );
    }
  },
};
