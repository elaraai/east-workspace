/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";
import { insideBlockScope } from "../block-scope.js";
import { declaresEastProgram, importsEastPackage } from "../east-source.js";

const NAME = "no-compile-time-data-injection";
const CODE = 990015;

const FS_MODULES = new Set(["node:fs", "fs", "node:fs/promises", "fs/promises"]);

function fire(ctx: RuleContext, target: ts.Node, messageText: string): void {
  const sf = ctx.sourceFile;
  const start = target.getStart(sf);
  ctx.report({ ruleName: NAME, code: CODE, start, length: target.getEnd() - start, messageText, category: "warning" });
}

/** The `ImportDeclaration` a symbol's declaration belongs to, if it is imported. */
function importOfSymbol(sym: ts.Symbol | undefined, t: TsModule): ts.ImportDeclaration | undefined {
  for (const d of sym?.declarations ?? []) {
    let n: ts.Node = d;
    // ImportSpecifier -> NamedImports -> ImportClause -> ImportDeclaration; a
    // NamespaceImport / ImportClause sit one level higher.
    if (t.isImportSpecifier(n)) n = n.parent.parent.parent;
    else if (t.isNamespaceImport(n)) n = n.parent.parent;
    else if (t.isImportClause(n)) n = n.parent;
    else continue;
    if (t.isImportDeclaration(n)) return n;
  }
  return undefined;
}

/** Does `id` resolve to a binding imported from a Node `fs` module? (Type-grounded
 * — follows the symbol to its import, so aliases and namespace imports are caught
 * and an unrelated local `readFileSync` is not.) */
function resolvesToFsImport(id: ts.Identifier, ctx: RuleContext): boolean {
  const t = ctx.ts;
  const imp = importOfSymbol(ctx.checker.getSymbolAtLocation(id), t);
  return (
    imp !== undefined &&
    t.isStringLiteral(imp.moduleSpecifier) &&
    FS_MODULES.has(imp.moduleSpecifier.text)
  );
}

function isProcessEnv(node: ts.Node, t: TsModule): boolean {
  return (
    t.isPropertyAccessExpression(node) &&
    t.isIdentifier(node.expression) &&
    node.expression.text === "process" &&
    node.name.text === "env"
  );
}

// East/e3 source is COMPILED to IR and deployed; importing Node's `fs`, reading
// files, parsing JSON, or probing `process.env` at module-evaluation time bakes
// build/deploy-time data into the program. Data belongs at runtime — via
// `e3.input` / datasets, or an `east-node-io` platform task (`FileSystem.readFile`,
// `SQL.*`). Detection is type-grounded: a call is flagged when it resolves to a
// `node:fs` import (so the runtime `FileSystem.readFile(...)` platform form is not
// matched), and the global `JSON.parse` / `process.env` are matched syntactically.
// Some seed-time bootstrap (no East-side reader) is unavoidable — then it is an
// accepted warning, documented at the call site.
export const noCompileTimeDataInjection: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Flag build-time data ingestion (a node:fs import or call, JSON.parse, process.env) at module scope — load data at runtime via e3.input / datasets / platform tasks.",
  check(node, ctx) {
    const t = ctx.ts;
    // Only DEPLOYABLE East/e3 source is subject to this: a file that imports
    // `@elaraai/*` AND declares a program (an `East.*` factory, an e3
    // definition, a `ui()` surface). Host-side tooling — a CLI, a build
    // script, a renderer — imports East for utilities and legitimately does
    // runtime file I/O; a plain Node script is none of our business either.
    if (!importsEastPackage(ctx.sourceFile, t)) return;
    if (!declaresEastProgram(ctx.sourceFile, ctx.checker, t)) return;

    // The `import … from "node:fs"` itself.
    if (t.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (t.isStringLiteral(spec) && FS_MODULES.has(spec.text)) {
        fire(ctx, node, `Importing \`${spec.text}\` into East/e3 source bakes build-time file I/O into the deployed program. Read data at runtime via \`e3.input\` / a dataset, or an \`east-node-io\` platform task.`);
      }
      return;
    }

    // All remaining forms are abuse only at module scope (not inside an East
    // block, where the runtime platform forms legitimately run).
    if (insideBlockScope(node, ctx)) return;

    // `process.env` probe — fire once on the bare `process.env` access (the outer
    // `process.env.X` / `process.env["X"]` has it as its receiver, so reporting the
    // base fires exactly once per occurrence).
    if (isProcessEnv(node, t)) {
      fire(ctx, node, "Reading `process.env` at module scope couples the deployed program to its build environment. Make it an `e3.input` / dataset parameter.");
      return;
    }

    if (!t.isCallExpression(node)) return;
    const callee = node.expression;

    // A call to a binding imported from `node:fs` — `readFileSync(...)`,
    // `fs.readFileSync(...)`, `existsSync(...)`, an aliased import, etc.
    const base = t.isIdentifier(callee)
      ? callee
      : t.isPropertyAccessExpression(callee) && t.isIdentifier(callee.expression)
        ? callee.expression
        : undefined;
    if (base !== undefined && resolvesToFsImport(base, ctx)) {
      fire(ctx, node, "This `node:fs` call reads/probes the filesystem at build/deploy time and bakes the result into the program. Ingest at runtime via `e3.input` / a dataset / an `east-node-io` task.");
      return;
    }

    // `JSON.parse(...)` — an unambiguous global.
    if (
      t.isPropertyAccessExpression(callee) &&
      t.isIdentifier(callee.expression) &&
      callee.expression.text === "JSON" &&
      callee.name.text === "parse"
    ) {
      fire(ctx, node, "`JSON.parse(...)` at module scope bakes parsed data into the program. Load it at runtime via `e3.input` / a dataset.");
    }
  },
};
