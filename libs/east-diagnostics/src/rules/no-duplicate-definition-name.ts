/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext } from "../types.js";
import { importDeclarationOf } from "../east-source.js";

const NAME = "no-duplicate-definition-name";
const CODE = 990031;

// Each e3 definition kind occupies its own dataset-path namespace; `task` and
// `customTask` share the `tasks.<name>` space.
const DEFINITION_KINDS = new Map<string, string>([
  ["input", "input"],
  ["task", "task"],
  ["customTask", "task"],
  ["function", "function"],
  ["record", "record"],
  ["mutation", "mutation"],
]);

/** `<e3>.<member>("name", …)` where `<e3>` is the DEFAULT import of `@elaraai/e3`
 * and member is a definition kind — returns the kind + name literal. */
function e3Definition(node: ts.Node, ctx: RuleContext): { kind: string; nameArg: ts.StringLiteralLike } | undefined {
  const t = ctx.ts;
  if (!t.isCallExpression(node)) return undefined;
  const callee = node.expression;
  if (!t.isPropertyAccessExpression(callee) || !t.isIdentifier(callee.expression)) return undefined;
  const kind = DEFINITION_KINDS.get(callee.name.text);
  if (kind === undefined) return undefined;
  const imp = importDeclarationOf(ctx.checker.getSymbolAtLocation(callee.expression), t);
  if (imp === undefined || !t.isStringLiteral(imp.moduleSpecifier) || imp.moduleSpecifier.text !== "@elaraai/e3") return undefined;
  const nameArg = node.arguments[0];
  if (nameArg === undefined || !t.isStringLiteralLike(nameArg)) return undefined;
  return { kind, nameArg };
}

// Two e3 definitions of the same kind sharing a name string occupy the same
// dataset path — the collision surfaces at DEPLOY time, not compile time.
// (Per-file scope: cross-file duplicates need a program-wide pass.)
export const noDuplicateDefinitionName: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Two e3 definitions of the same kind with the same name string collide at deploy time — names must be unique per kind.",
  check(node, ctx) {
    const t = ctx.ts;
    // One pass per file, keyed off the SourceFile visit.
    if (!t.isSourceFile(node)) return;
    const seen = new Map<string, ts.StringLiteralLike>();
    const visit = (n: ts.Node): void => {
      const def = e3Definition(n, ctx);
      if (def !== undefined) {
        const key = `${def.kind}:${def.nameArg.text}`;
        const first = seen.get(key);
        if (first === undefined) {
          seen.set(key, def.nameArg);
        } else {
          const sf = ctx.sourceFile;
          const start = def.nameArg.getStart(sf);
          ctx.report({
            ruleName: NAME,
            code: CODE,
            start,
            length: def.nameArg.getEnd() - start,
            messageText: `Duplicate e3 ${def.kind} name "${def.nameArg.text}" — it collides with the earlier definition at deploy time. Definition names must be unique per kind.`,
            category: "error",
          });
        }
      }
      t.forEachChild(n, visit);
    };
    visit(node);
  },
};
