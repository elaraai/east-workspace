/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { EastRule } from "../types.js";
import { insideBlockScope, insideReactive } from "../block-scope.js";

const NAME = "prefer-const-ui-callbacks";
const CODE = 990025;

// An event-handler `East.function` authored INLINE in a JSX prop inside a
// `<Reactive>` scope is a fresh function value on every reactive re-render —
// and East's `equalFor` treats all functions as equal, so a memoized renderer
// cannot see the swap (stale handler / forced remount). Bind it once with
// `$.const` and pass the handle: one identity, evaluated once, serialized
// once. (A static, non-Reactive tree builds the handler once at IR build — the
// hazard doesn't exist there, so it is not flagged.)
export const preferConstUiCallbacks: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Inside <Reactive>, bind JSX event handlers with $.const and pass the handle — an inline East.function prop is rebuilt each re-render and memoized renderers can't see the swap.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node)) return;
    const callee = node.expression;
    if (!t.isPropertyAccessExpression(callee)) return;
    if (!t.isIdentifier(callee.expression) || callee.expression.text !== "East") return;
    if (callee.name.text !== "function" && callee.name.text !== "asyncFunction") return;

    // Directly the value of a JSX attribute: `onX={East.function(…)}`.
    const parent = node.parent;
    if (parent === undefined || !t.isJsxExpression(parent) || parent.expression !== node) return;
    const attr = parent.parent;
    if (attr === undefined || !t.isJsxAttribute(attr)) return;
    if (!insideBlockScope(node, ctx)) return;
    // The identity hazard is a RE-RENDER hazard — only Reactive scopes re-render.
    if (!insideReactive(node, t)) return;

    const sf = ctx.sourceFile;
    const start = callee.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: callee.getEnd() - start,
      messageText:
        `Inline \`East.${callee.name.text}\` in the \`${attr.name.getText(sf)}\` prop is rebuilt on every render, and \`equalFor\` treats all functions as equal so memoized renderers can't see the swap. Bind it once — \`const handler = $.const(East.${callee.name.text}(…))\` — and pass the handle.`,
      category: "suggestion",
    });
  },
};
