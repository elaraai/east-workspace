/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";
import { isBlockBuilderType, isEastExprType } from "../east-type.js";
import { matchBlockBuilderCall } from "../block-builder.js";
import { enclosingBlockScope, isEastFunctionCall } from "../block-scope.js";

const NAME = "no-reinlined-east-binding";
const CODE = 990010;

// An East `Expr` is a value tree, not a slot. Bound to a JS `const`/`let` and read more than once
// inside one East body, it is *re-inlined* at each read — the tree is duplicated, so it is
// re-evaluated per read and (for mutable values) gets a fresh identity each time. Read once inside a
// body that RUNS REPEATEDLY — a per-element callback, a `$.for`/`$.while` body, a nested
// `East.function` — it is re-evaluated every time that body runs. `$.let`/`$.const` introduce a
// single block binding evaluated once and referenced by name, which is the only way to get
// single-evaluation + shared identity. So such JS bindings of an `Expr` are an error, not a style
// nit. (The python builder is held to the same reading since #1312 removed its trace-time pass.)
//
// Scoped to the hazard, so a correct program is never asked to change:
// - a single read is a harmless alias / single-pass argument, and inline composition
//   (`Stack.VStack([A(), B(), …])`) never binds, so neither trips;
// - reads are counted per enclosing function: two reads in the body that bound the value, or two
//   inside one arm, are two evaluations; one read in each of two EXCLUSIVE arms — `.ifElse(() => a,
//   () => b)`, `$.if(…).else(…)`, the arms of `$.match` / `.match` — is at most one, and is not
//   flagged (binding a guarded partial read above its guard would raise on the very path the guard
//   excludes);
// - a read inside a body the rule cannot classify counts as once-only and stays silent.

/** Methods of the East expression classes (and the `East.Array` / `East.Set` / `East.Dict`
 * generators) whose callback body runs per element, per key or per iteration. The spec pins the
 * partition: every callback-taking method of the Expr classes is here or in `ONCE_METHODS`. */
export const REPEATING_METHODS: ReadonlySet<string> = new Set([
  "map", "filter", "filterMap", "firstMap", "flatMap", "flattenToArray", "flattenToSet", "flattenToDict",
  "forEach", "reduce", "scan", "mapReduce", "groupReduce", "groupBy", "groupSize", "groupSum", "groupMean",
  "groupEvery", "groupSome", "groupMaximum", "groupMinimum", "groupToArrays", "groupToSets", "groupToDicts",
  "groupFindAll", "groupFindFirst", "groupFindMaximum", "groupFindMinimum", "toDict", "toSet", "toArray",
  "toTree", "sort", "sortInPlace", "isSorted", "findFirst", "findAll", "findMaximum", "findMinimum",
  "findSortedFirst", "findSortedLast", "findSortedRange", "mergeAll", "unionInPlace", "mapRows", "some",
  "every", "sum", "mean", "maximum", "minimum", "getKeys", "generate",
]);

/** Callback-taking methods whose body runs ONCE per call: a default producer, a single-key upsert
 * or merge, a conditional, a handler. */
export const ONCE_METHODS: ReadonlySet<string> = new Set([
  "get", "getOrInsert", "insertOrUpdate", "merge", "match", "matchTag", "unwrap", "ifElse", "and", "or", "update", "if", "try",
]);

/** The `BlockBuilder` loop statements: their body runs per iteration. The other statement bodies
 * (`if` / `else` / `elseIf` / `match` / `try` / `catch` / `finally`) run at most once. */
export const LOOP_METHODS: ReadonlySet<string> = new Set(["for", "while"]);

function isFunctionLike(node: ts.Node, t: TsModule): boolean {
  return t.isArrowFunction(node) || t.isFunctionExpression(node) || t.isFunctionDeclaration(node) || t.isMethodDeclaration(node);
}

/** The innermost function (arrow, function expression or declaration, method) enclosing `node`. */
function enclosingFunction(node: ts.Node, t: TsModule): ts.Node | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined && !isFunctionLike(current, t)) current = current.parent;
  return current;
}

/** How often `fn` — a function handed to a call — runs per run of the code around the call:
 * `"callback"` (per element), `"loop body"` (per iteration), `"nested function"` (per call of the
 * function it builds), or undefined for a body that runs at most once, or one the rule cannot
 * classify. */
function hostKind(fn: ts.Node, ctx: RuleContext): string | undefined {
  const t = ctx.ts;
  const call = fn.parent;
  if (call === undefined || !t.isCallExpression(call) || !call.arguments.some((arg) => arg === fn)) return undefined;
  const callee = call.expression; // read before the guard below narrows `call` away
  if (isEastFunctionCall(call, t)) return "nested function";
  if (!t.isPropertyAccessExpression(callee)) return undefined;
  const method = callee.name.text;
  const receiver = callee.expression;
  if (LOOP_METHODS.has(method)) {
    return isBlockBuilderType(ctx.checker.getTypeAtLocation(receiver)) ? "loop body" : undefined;
  }
  if (!REPEATING_METHODS.has(method)) return undefined;
  if (isEastExprType(ctx.checker.getTypeAtLocation(receiver))) return "callback";
  // the namespace generators: `East.Array.generate(n, T, ($, i) => …)` and kin
  if (t.isPropertyAccessExpression(receiver) && t.isIdentifier(receiver.expression) && receiver.expression.text === "East") {
    return "callback";
  }
  return undefined;
}

/** The outermost repeatedly-running function between the declaration's own function (exclusive)
 * and `use` — the one that multiplies the read the most — or undefined. */
function repeatingHostBetween(use: ts.Node, declFunction: ts.Node | undefined, ctx: RuleContext): string | undefined {
  let found: string | undefined;
  let current: ts.Node | undefined = use.parent;
  while (current !== undefined && current !== declFunction) {
    if (isFunctionLike(current, ctx.ts)) {
      const kind = hostKind(current, ctx);
      if (kind !== undefined) found = kind;
    }
    current = current.parent;
  }
  return found;
}

export const noReinlinedEastBinding: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "An East Expr bound to a JS const/let and read twice inside one East body, or read inside a per-element callback, a loop body or a nested East.function, is re-inlined — and re-evaluated — at each read; bind it once with $.let/$.const.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isVariableDeclaration(node)) return;
    if (!t.isIdentifier(node.name)) return;
    if (node.initializer === undefined) return;

    let init: ts.Expression = node.initializer;
    while (t.isParenthesizedExpression(init)) init = init.expression;

    // `$.let(...)` / `$.const(...)` is the correct form — never flag it.
    if (matchBlockBuilderCall(init, ctx) !== undefined) return;
    // Aliasing an existing binding (`const a = b`) re-inlines nothing; the root
    // binding, if unbound, is flagged at its own declaration.
    if (t.isIdentifier(init)) return;
    // Only Expr-typed bindings re-inline. Types (`StructType(...)`), plain JS
    // objects, callbacks held for a single handoff, etc. are fine.
    if (!isEastExprType(ctx.checker.getTypeAtLocation(init))) return;

    const declSymbol = ctx.checker.getSymbolAtLocation(node.name);
    if (declSymbol === undefined) return;

    const name = node.name.text;
    const declFunction = enclosingFunction(node, t);
    // reads per enclosing function (an exclusive arm is a function of its own)
    const perFunction = new Map<ts.Node, number>();
    let repeating: string | undefined;
    const visit = (n: ts.Node): void => {
      if (t.isIdentifier(n) && n !== node.name && n.text === name && ctx.checker.getSymbolAtLocation(n) === declSymbol) {
        // a read outside every East block scope re-inlines into nothing
        if (enclosingBlockScope(n, ctx) !== undefined) {
          const multiplied = repeatingHostBetween(n, declFunction, ctx);
          if (multiplied !== undefined) {
            repeating ??= multiplied;
          } else {
            const bucket = enclosingFunction(n, t) ?? ctx.sourceFile;
            perFunction.set(bucket, (perFunction.get(bucket) ?? 0) + 1);
          }
        }
      }
      t.forEachChild(n, visit);
    };
    visit(ctx.sourceFile);

    let worst = 0;
    for (const count of perFunction.values()) if (count > worst) worst = count;
    if (worst < 2 && repeating === undefined) return;

    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    const messageText =
      worst >= 2
        ? `This East expression is bound to a JS \`const\`/\`let\` and read ${worst} times inside one East body, so it is re-inlined — and re-evaluated, with a fresh identity for mutable values — at each read. Bind it once with \`$.const\`/\`$.let\`.`
        : `This East expression is bound to a JS \`const\`/\`let\` outside a ${repeating} and read inside it, so it is re-inlined there — and re-evaluated every time the ${repeating} runs. Bind it once with \`$.const\`/\`$.let\` before the call.`;
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText,
      category: "error",
    });
  },
};
