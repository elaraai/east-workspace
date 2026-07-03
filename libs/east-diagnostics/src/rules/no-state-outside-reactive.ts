/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext } from "../types.js";
import { enclosingBlockScope, insideReactive } from "../block-scope.js";
import { resolvesToEastImport } from "../east-source.js";

const NAME = "no-state-outside-reactive";
const CODE = 990024;

/** Is the outermost East block scope of `node` the fn argument of a `ui(…)`
 * call (the SURFACE ROOT)? A cross-file composition helper (an `East.function`
 * whose subtree the caller mounts inside its own `<Reactive>`) cannot be judged
 * lexically — only at the provable root is a missing Reactive definitely wrong. */
function atUiSurfaceRoot(node: ts.Node, ctx: RuleContext): boolean {
  const t = ctx.ts;
  const outermost = enclosingBlockScope(node, ctx);
  // Only the `ui(…, East.function(…))` form is judgeable — the outermost scope
  // is then the `East.function(...)` CALL sitting in `ui`'s argument list.
  if (outermost === undefined || !t.isCallExpression(outermost)) return false;
  const parent = outermost.parent;
  if (parent === undefined || !t.isCallExpression(parent)) return false;
  if (!parent.arguments.some((a) => a === outermost)) return false;
  const callee = parent.expression;
  return t.isIdentifier(callee) && callee.text === "ui" && resolvesToEastImport(callee, ctx.checker, t);
}

// east-ui `State.*` platform calls (State.bind and friends) must run inside a
// `<Reactive>` inner builder: outside one, the platform call makes the whole UI
// function async at analysis time and the deploy analyzer REJECTS it — or the
// surface silently never re-renders. Type-checks fine either way, so catch it
// at authoring time. Scoped to the provable SURFACE ROOT (the fn passed to
// `ui(…)`): a composition helper in another function may be mounted inside the
// caller's <Reactive>, which a lexical check cannot see.
export const noStateOutsideReactive: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "east-ui State.* must live inside a <Reactive> builder — outside one the UI function becomes async and is rejected at deploy time.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node)) return;
    const callee = node.expression;
    if (!t.isPropertyAccessExpression(callee)) return;
    if (!t.isIdentifier(callee.expression) || callee.expression.text !== "State") return;
    // Only the east-ui State namespace — resolved by symbol, not name alone.
    if (!resolvesToEastImport(callee.expression, ctx.checker, t)) return;
    if (!atUiSurfaceRoot(node, ctx)) return;
    if (insideReactive(node, t)) return;

    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText:
        `\`State.${callee.name.text}\` outside a \`<Reactive>\` builder makes this UI function async at analysis time — the deploy analyzer rejects it (or the surface never re-renders). Move all \`State.*\` into the \`<Reactive>{$ => …}\` inner builder.`,
      category: "warning",
    });
  },
};
