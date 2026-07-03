/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { EastRule } from "../types.js";
import { isEastExprType } from "../east-type.js";
import { resolvesToEastImport } from "../east-source.js";

const NAME = "no-dynamic-bind-path";
const CODE = 990026;

// The dataset/key a handle binds to must be a JS-side constant captured at
// IR-build time: `ui()` derives its manifest (reads/writes, permissions,
// reactive subscriptions) by inspecting `Data.bind` calls in the IR, and a
// path computed from an East value cannot be resolved there — the binding is
// missing from the manifest, so the surface silently doesn't react (or fails
// at runtime). Bind every candidate as a constant and select the VALUE in East.
const KEY_ARG_INDEX: Record<string, number> = {
  Data: 0,
  State: 1,
  Navigation: 1,
};

export const noDynamicBindPath: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Data.bind / State.bind / Navigation.bind keys must be IR-build constants — an East-computed key can't be captured in the ui() manifest.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node)) return;
    const callee = node.expression;
    if (!t.isPropertyAccessExpression(callee) || callee.name.text !== "bind") return;
    if (!t.isIdentifier(callee.expression)) return;
    const ns = callee.expression.text;
    const argIndex = KEY_ARG_INDEX[ns];
    if (argIndex === undefined) return;
    // Only the east-ui / e3-ui namespaces — resolved by symbol, not name alone.
    if (!resolvesToEastImport(callee.expression, ctx.checker, t)) return;

    const keyArg = node.arguments[argIndex];
    if (keyArg === undefined) return;
    if (!isEastExprType(ctx.checker.getTypeAtLocation(keyArg))) return;

    const sf = ctx.sourceFile;
    const start = keyArg.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: keyArg.getEnd() - start,
      messageText:
        `The \`${ns}.bind\` key is an East expression — bind keys must be JS-side constants captured at IR-build time, or the binding is missing from the ui() manifest (no subscription/permission). Bind each candidate as a constant and select the VALUE in East (\`cond.ifElse(() => a.read(), () => b.read())\`).`,
      category: "error",
    });
  },
};
