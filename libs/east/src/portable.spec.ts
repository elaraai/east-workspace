/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a browser loads to run a unit reaches no Node module (#1023).
 *
 * `executeUnit`, the `UnitIO` it works over and the merge of a unit's parts run
 * in a browser's Web Worker as they run under east-node. So every module they
 * reach — walked from them through each import and export the compiler keeps,
 * and each dynamic `import()` — imports only east's own modules and the
 * packages a browser loads as they are, and uses neither the `Buffer` nor the
 * `process` global. A module reaches Node only through a guarded
 * `globalThis.process?.getBuiltinModule`, which a browser answers with
 * `undefined`, as the frame layer reaches zlib.
 *
 * A type-only import is erased, so it reaches nothing; `import { type X }` is
 * kept under `verbatimModuleSyntax` as a side-effect import, so it does.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** east's sources: the spec runs from `dist/src`. */
const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

/** The modules a browser loads to run a unit. */
const ENTRIES = ["runner_exec.ts", "runner_io.ts", "runner_merge.ts"];

/** The packages a module may import besides east's own modules: east's one
 *  dependency, which a browser loads as it is. */
const PACKAGES = new Set(["sorted-btree"]);

/** The Node globals no module may use. */
const GLOBALS = new Set(["Buffer", "process"]);

/** What a walk found: every module it reached, and each import or use that
 *  reaches Node. */
interface Walk {
  reached: string[];
  problems: string[];
}

/** Whether an identifier named for a global is a use of that global: not a
 *  property or member named so (`globalThis.process`), not a binding of that
 *  name, and not in a type, which is erased. */
function usesGlobal(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent)) && parent.name === node) return false;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent)) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) return false;
  for (let at: ts.Node = parent; !ts.isSourceFile(at); at = at.parent) {
    if (ts.isTypeNode(at)) return false;
  }
  return true;
}

/**
 * Walks every module `entries` reach and says what in them reaches Node.
 *
 * @param entries - the modules to start from, by their paths under the source
 *   root, forward-slashed
 * @param source - a module's source, or `undefined` when there is none
 * @returns the modules reached, and each import of a module that is neither
 *   east's own nor a package in {@link PACKAGES}, and each use of a global in
 *   {@link GLOBALS}, as `<module> imports <specifier>` and
 *   `<module>:<line> uses the <name> global`
 */
function walk(entries: readonly string[], source: (module: string) => string | undefined): Walk {
  const reached: string[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const pending = [...entries];
  while (pending.length > 0) {
    const module = pending.shift()!;
    if (seen.has(module)) continue;
    seen.add(module);
    const text = source(module);
    if (text === undefined) {
      problems.push(`${module} is not there`);
      continue;
    }
    reached.push(module);
    const file = ts.createSourceFile(module, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const imports = (specifier: ts.Expression | undefined): void => {
      if (specifier === undefined) return;
      if (!ts.isStringLiteral(specifier)) {
        problems.push(`${module} imports a module it computes`);
      } else if (specifier.text.startsWith(".")) {
        pending.push(posix.normalize(posix.join(posix.dirname(module), specifier.text)).replace(/\.js$/, ".ts"));
      } else if (!PACKAGES.has(specifier.text)) {
        problems.push(`${module} imports ${specifier.text}`);
      }
    };
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        if (!node.importClause?.isTypeOnly) imports(node.moduleSpecifier);
        return;
      }
      if (ts.isExportDeclaration(node)) {
        if (!node.isTypeOnly) imports(node.moduleSpecifier);
        return;
      }
      if (ts.isImportEqualsDeclaration(node)) {
        if (!node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) imports(node.moduleReference.expression);
        return;
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) imports(node.arguments[0]);
      if (ts.isIdentifier(node) && GLOBALS.has(node.text) && usesGlobal(node)) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        problems.push(`${module}:${line + 1} uses the ${node.text} global`);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return { reached, problems };
}

/** A module of east's sources, by its path under `src/`. */
function eastSource(module: string): string | undefined {
  const file = join(SRC, module);
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

describe("what a browser loads to run a unit", () => {
  it("reaches no Node module and uses no Node global", () => {
    const { reached, problems } = walk(ENTRIES, eastSource);
    assert.deepEqual(problems, [], "these reach Node: reach it through a guarded globalThis.process?.getBuiltinModule, or not at all");
    // The walk reaches the compiler and the collection layer, the frame layer
    // among them, which reaches zlib the guarded way.
    for (const module of ["eastir.ts", "compile/runtime.ts", "serialization/beast2/v5/lazy.ts", "serialization/beast2/v5/frames.ts", "serialization/beast2/v5/frame-pool.ts"]) {
      assert.ok(reached.includes(module), `the walk reaches ${module}`);
    }
  });

  it("names a planted Node import, however it is written, and each use of a Node global", () => {
    const modules = new Map([
      ["entry.ts", [
        'import { helper } from "./helpers/helper.js";',
        'import type { Stats } from "node:fs";',
        'export const run = (stats?: Stats): unknown => helper(stats);',
      ].join("\n")],
      ["helpers/helper.ts", [
        'import { readFileSync } from "node:fs";',
        'export function helper(_x: unknown): unknown {',
        '  return Buffer.from(process.env.X ?? "");',
        '}',
        'export { type Worker } from "node:worker_threads";',
        'export const later = () => import("node:os");',
      ].join("\n")],
    ]);
    const { reached, problems } = walk(["entry.ts"], (module) => modules.get(module));
    assert.deepEqual(reached, ["entry.ts", "helpers/helper.ts"]);
    assert.deepEqual(problems, [
      "helpers/helper.ts imports node:fs",
      "helpers/helper.ts:3 uses the Buffer global",
      "helpers/helper.ts:3 uses the process global",
      "helpers/helper.ts imports node:worker_threads",
      "helpers/helper.ts imports node:os",
    ]);
  });

  it("passes Node reached through a guarded globalThis.process, and Node named only in types", () => {
    const modules = new Map([
      ["entry.ts", [
        'import type { Buffer as NodeBuffer } from "node:buffer";',
        'const zlib = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule?.("node:zlib") ?? null;',
        'export type Gauge = { process?: { cwd?: () => string } };',
        'export const bytes = (b: NodeBuffer | Buffer): number => b.length + (zlib === null ? 0 : 1);',
        'export const named = { process: 1, Buffer: 2 };',
        'export const read = ({ process: p }: { process: number }): number => p;',
      ].join("\n")],
    ]);
    assert.deepEqual(walk(["entry.ts"], (module) => modules.get(module)).problems, []);
  });
});
