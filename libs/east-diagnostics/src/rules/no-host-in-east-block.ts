/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";
import { isEastExprType, isBlockBuilderType, isEastPlatformDefinitionType } from "../east-type.js";
import { insideBlockScope } from "../block-scope.js";
import { chainRootReceiver, bodyBuildsEastIr } from "../east-ir.js";
import { resolvesToEastImport } from "../east-source.js";

const NAME = "no-host-in-east-block";
const CODE = 990020;

// ── East-vs-host classification ─────────────────────────────────────────────

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
  if (t.isIdentifier(root) && resolvesToEastImport(root, ctx.checker, t)) return true;
  // A6 — a method chained off an in-block TS macro or its loosely-typed (`any`)
  // operand, whose type-info is lost as `any`. The macro is reported elsewhere
  // (clause E / its bare call); the East methods on its East-`Expr` result are
  // East, not additional host calls.
  if (t.isPropertyAccessExpression(f) && t.isIdentifier(root) && resolvesToInBlockEastBinding(root, ctx)) return true;
  // A7 — the callee is an East platform-function DEFINITION (`East.platform(…)` /
  // `East.asyncPlatform(…)` / the generic pair), project-local stubs included.
  // Calling one emits a single `Platform` IR node — a real East call, exactly
  // like calling a bound `East.function` (A0), not an authoring-time macro.
  if (isEastPlatformDefinitionType(ctx.checker.getTypeAtLocation(f))) return true;
  // A8 — UI composition: the callee is a JSX-returning helper (the call-site
  // mirror of clause E's declaration exemption), or an argument is a callback
  // returning JSX (`days.map((d) => <Chip …/>)` over TS-side config).
  if (isJsxCompositionCall(call, ctx)) return true;
  // A9 — a LIBRARY-declared East-producing member call: the method/property is
  // declared in a `.d.ts` (a compiled package — e.g. east-ui's Navigation
  // `routes.Page.overview()` constructors on a project-local `Navigation.config`
  // object) AND the call's result is an East `Expr`. A TS macro authored in
  // project SOURCE (.ts/.tsx) never matches — its declaration is not a
  // declaration file — so the rule still flags it.
  if (t.isPropertyAccessExpression(f) && isLibDeclaredEastCall(call, f, ctx)) return true;
  // A10 — literal STRING assembly (`["…", "…"].join("\n")`): every leaf of the
  // call is a literal and the result is a string — authoring a multi-line/joined
  // string CONSTANT at declaration time, which the host is for. Non-string folds
  // (`[1n, 2n].indexOf(2n)`) stay flagged: computing over collections is East's
  // job even when the operands happen to be literals.
  if (isConstantFoldCall(call, ctx)) return true;
  return false;
}

/** A call whose whole subtree is literals — no identifier reference, no template
 * substitution, no East `Expr` — producing a plain STRING constant. (The member
 * name of a property-access callee, `.join`, is not a reference.) */
function isConstantFoldCall(call: ts.CallExpression, ctx: RuleContext): boolean {
  const t = ctx.ts;
  if ((ctx.checker.getTypeAtLocation(call).flags & t.TypeFlags.StringLike) === 0) return false;
  let constant = true;
  const visit = (n: ts.Node): void => {
    if (!constant) return;
    if (t.isIdentifier(n)) {
      const p = n.parent;
      if (p !== undefined && t.isPropertyAccessExpression(p) && p.name === n) return;
      constant = false;
      return;
    }
    if (t.isTemplateExpression(n)) {
      constant = false;
      return;
    }
    t.forEachChild(n, visit);
  };
  visit(call);
  return constant;
}

/** Is the accessed member LIBRARY API, with the call result an East `Expr`?
 * (See clause A9.) Library API is established two ways: the member (or the
 * receiver's named type — the property symbol of a mapped type is synthesized)
 * is declared in a PACKAGE declaration file, or the receiver object's VALUE was
 * built by an `@elaraai/*` factory call (`const routes = Navigation.config({…})`
 * — the boundary test the .d.ts check can't make when the library's own source
 * is in-program, e.g. the monorepo's self-dogfooding examples). TypeScript's
 * own default libs never count — a JS `Map<string, Expr>` read with `.get(k)`
 * is host-keyed East data (the abuse), not a library East API. */
function isLibDeclaredEastCall(call: ts.CallExpression, f: ts.PropertyAccessExpression, ctx: RuleContext): boolean {
  if (!isEastExprType(ctx.checker.getTypeAtLocation(call))) return false;
  const inPackageDts = (sym: ts.Symbol | undefined): boolean =>
    (sym?.declarations ?? []).some((d) => {
      const sf = d.getSourceFile();
      if (!sf.isDeclarationFile) return false;
      if (ctx.program !== undefined) return !ctx.program.isSourceFileDefaultLibrary(sf);
      return !/\/lib\.[^/]*\.d\.ts$/.test(sf.fileName);
    });
  if (inPackageDts(ctx.checker.getSymbolAtLocation(f))) return true;
  const receiverType = ctx.checker.getTypeAtLocation(f.expression);
  if (inPackageDts(receiverType.aliasSymbol ?? receiverType.symbol)) return true;
  return rootBuiltByEastFactory(chainRootReceiver(f, ctx), ctx);
}

/** Does `root` resolve (through import aliases) to a `const` whose initializer
 * is a call chain rooted in an `@elaraai/*` import — an object BUILT BY an East
 * library factory, whose members are therefore library API? */
function rootBuiltByEastFactory(root: ts.Node, ctx: RuleContext): boolean {
  const t = ctx.ts;
  if (!t.isIdentifier(root)) return false;
  let sym = ctx.checker.getSymbolAtLocation(root);
  if (sym !== undefined && (sym.flags & t.SymbolFlags.Alias) !== 0) {
    sym = ctx.checker.getAliasedSymbol(sym);
  }
  const decl = sym?.valueDeclaration;
  if (decl === undefined || !t.isVariableDeclaration(decl) || decl.initializer === undefined) return false;
  let init: ts.Expression = decl.initializer;
  while (t.isParenthesizedExpression(init)) init = init.expression;
  if (!t.isCallExpression(init)) return false;
  const initRoot = chainRootReceiver(init.expression, ctx);
  return t.isIdentifier(initRoot) && resolvesToEastImport(initRoot, ctx.checker, t);
}

/** A call that composes JSX: it is passed JSX directly (`rows.push(<Chip/>)`),
 * an argument is a function literal returning JSX (`days.map((d) => <Chip/>)`),
 * or its callee resolves to a function/arrow whose returns include JSX. The
 * declaration side of these helpers is exempted by clause E — the call side
 * must be too, or binding composed JSX to a `const` before use would flag. */
function isJsxCompositionCall(call: ts.CallExpression, ctx: RuleContext): boolean {
  const t = ctx.ts;
  if (call.arguments.some((a) => isJsx(a, t) || ((t.isArrowFunction(a) || t.isFunctionExpression(a)) && returnExpressions(a, t).some((r) => isJsx(r, t))))) {
    return true;
  }
  const f = call.expression;
  if (!t.isIdentifier(f)) return false;
  const sym = ctx.checker.getSymbolAtLocation(f);
  for (const d of sym?.declarations ?? []) {
    let fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | undefined;
    if (t.isFunctionDeclaration(d) && d.body !== undefined) fn = d;
    else if (
      t.isVariableDeclaration(d) &&
      d.initializer !== undefined &&
      (t.isArrowFunction(d.initializer) || t.isFunctionExpression(d.initializer))
    ) {
      fn = d.initializer;
    }
    if (fn !== undefined && returnExpressions(fn, t).some((r) => isJsx(r, t))) return true;
  }
  return false;
}

function isEast(expr: ts.Expression, ctx: RuleContext): boolean {
  return isEastExprType(ctx.checker.getTypeAtLocation(expr));
}

/** Is `node` inside JSX *within its own function scope* — a JSX construct met
 * walking up BEFORE any function boundary? Direct JSX composition (element
 * children, attribute value expressions) is markup, out of scope for
 * host-vs-East checks. But EVERY callback nested inside JSX is code again —
 * a `<Reactive>{$ => …}` block, a `data.map(($, x) => …)` projection, and
 * equally a host callback computing data in an attribute
 * (`items={Array.from(…, (_, i) => …)}`): inside an East function the data
 * must be East all the way down, so the JSX ancestor beyond a callback
 * boundary exempts nothing. Authoring-time constants belong at module scope
 * (or as East generation — `East.Array.range(…).map(($, i) => …)`). */
function insideJsx(node: ts.Node, ctx: RuleContext): boolean {
  const t = ctx.ts;
  let cur: ts.Node | undefined = node.parent;
  while (cur !== undefined) {
    if (t.isJsxElement(cur) || t.isJsxSelfClosingElement(cur) || t.isJsxFragment(cur) || t.isJsxExpression(cur) || t.isJsxAttribute(cur)) {
      return true;
    }
    if (t.isArrowFunction(cur) || t.isFunctionExpression(cur) || t.isFunctionDeclaration(cur) || t.isMethodDeclaration(cur)) {
      return false;
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
    if (insideJsx(node, ctx)) return;

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
