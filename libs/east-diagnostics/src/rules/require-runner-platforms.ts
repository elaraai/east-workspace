/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";
import { isEastPlatformDefinitionType } from "../east-type.js";
import { importDeclarationOf } from "../east-source.js";

const NAME = "require-runner-platforms";
const CODE = 990022;

/** Is `node` a call `<e3>.task(...)` where `<e3>` is the DEFAULT import of `@elaraai/e3`? */
function isE3TaskCall(node: ts.CallExpression, ctx: RuleContext): boolean {
  const t = ctx.ts;
  const callee = node.expression;
  if (!t.isPropertyAccessExpression(callee) || callee.name.text !== "task") return false;
  if (!t.isIdentifier(callee.expression)) return false;
  const imp = importDeclarationOf(ctx.checker.getSymbolAtLocation(callee.expression), t);
  return imp !== undefined && t.isStringLiteral(imp.moduleSpecifier) && imp.moduleSpecifier.text === "@elaraai/e3";
}

/** The names of PROJECT-declared platform functions called anywhere in `fnArg` —
 * callees typed as platform definitions whose declaration is project source (a
 * `.ts`/`.tsx` file, not a package `.d.ts`). `@elaraai`-shipped platform fns are
 * provided by the runtimes and never need a custom platforms entry. */
function projectPlatformCalls(fnArg: ts.Node, ctx: RuleContext): string[] {
  const t = ctx.ts;
  const names: string[] = [];
  const visit = (n: ts.Node): void => {
    if (t.isCallExpression(n) && isEastPlatformDefinitionType(ctx.checker.getTypeAtLocation(n.expression))) {
      const callee = n.expression;
      const id = t.isIdentifier(callee) ? callee : t.isPropertyAccessExpression(callee) ? callee.name : undefined;
      const sym = id !== undefined ? ctx.checker.getSymbolAtLocation(id) : undefined;
      // Follow the import alias to the defining const — the declaration file is
      // what distinguishes a project stub from a packaged platform fn.
      const resolved = sym !== undefined && (sym.flags & t.SymbolFlags.Alias) !== 0 ? ctx.checker.getAliasedSymbol(sym) : sym;
      const declaredInProject = (resolved?.declarations ?? []).some((d) => !d.getSourceFile().isDeclarationFile);
      if (declaredInProject && id !== undefined) names.push(id.text);
    }
    t.forEachChild(n, visit);
  };
  visit(fnArg);
  return names;
}

/** Does the (visible) options literal declare a `runner.platforms` entry with a
 * `custom` module? Returns undefined when the options are not statically
 * inspectable (identifier / spread) — then we stay silent. */
function hasCustomPlatformsEntry(options: ts.Expression | undefined, t: TsModule): boolean | undefined {
  if (options === undefined) return false; // no options at all — definitely no platforms
  if (!t.isObjectLiteralExpression(options)) return undefined;
  const runnerProp = options.properties.find((p) => t.isPropertyAssignment(p) && t.isIdentifier(p.name) && p.name.text === "runner");
  if (runnerProp === undefined || !t.isPropertyAssignment(runnerProp)) return false;
  if (!t.isObjectLiteralExpression(runnerProp.initializer)) return undefined;
  const platformsProp = runnerProp.initializer.properties.find(
    (p) => t.isPropertyAssignment(p) && t.isIdentifier(p.name) && p.name.text === "platforms",
  );
  if (platformsProp === undefined || !t.isPropertyAssignment(platformsProp)) return false;
  if (!t.isArrayLiteralExpression(platformsProp.initializer)) return undefined;
  return platformsProp.initializer.elements.some(
    (el) =>
      t.isObjectLiteralExpression(el) &&
      el.properties.some((p) => t.isPropertyAssignment(p) && t.isIdentifier(p.name) && p.name.text === "custom"),
  );
}

// An `e3.task` whose East function calls a PROJECT-declared platform function
// (an `East.platform("proj.x", …)` stub mirrored by the project's own platform
// module) needs `runner.platforms` to load that module — without a `{ custom:
// "…" }` entry the task deploys fine and fails at dataflow runtime with
// "Platform function 'proj.x' is not available".
export const requireRunnerPlatforms: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "An e3.task calling project-declared platform functions must declare a runner.platforms custom module — otherwise it fails only at dataflow runtime.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node) || !isE3TaskCall(node, ctx)) return;
    const fnArg = node.arguments[2];
    if (fnArg === undefined) return;
    const calls = projectPlatformCalls(fnArg, ctx);
    if (calls.length === 0) return;
    const ok = hasCustomPlatformsEntry(node.arguments[3], t);
    if (ok === true || ok === undefined) return; // present, or not statically visible

    const nameArg = node.arguments[0];
    const taskName = nameArg !== undefined && t.isStringLiteralLike(nameArg) ? nameArg.text : "…";
    const unique = [...new Set(calls)].join(", ");
    const sf = ctx.sourceFile;
    const target = node.arguments[3] ?? node.expression;
    const start = target.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: target.getEnd() - start,
      messageText:
        `Task "${taskName}" calls project platform function(s) ${unique} but its runner declares no custom platform module — it will fail at dataflow runtime with "Platform function … is not available". Add the module to the runner, e.g. \`{ runner: { runtime: "east-py", platforms: [{ custom: "platform_module" }] } }\`.`,
      category: "warning",
    });
  },
};
