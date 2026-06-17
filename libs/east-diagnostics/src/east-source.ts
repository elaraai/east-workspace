/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { TsModule } from "./types.js";

// File-level "is this East/e3 source?" detection. Several rules describe abuses
// that only make sense inside an East/e3 program (baking build-time data, building
// East IR in a module-scope macro); gating them on a real `@elaraai/*` import keeps
// them from firing on ordinary TypeScript, so the rule set is opt-in by install AND
// self-gating by East-ness — no package-identity allow/deny list needed.

const importsCache = new WeakMap<ts.SourceFile, boolean>();

/** Does this source file statically import or re-export from any `@elaraai/*`
 * package? — the signal that it is East/e3 source rather than plain TypeScript.
 * Cached per source file. */
export function importsEastPackage(sf: ts.SourceFile, t: TsModule): boolean {
  const cached = importsCache.get(sf);
  if (cached !== undefined) return cached;
  let found = false;
  for (const stmt of sf.statements) {
    if (!t.isImportDeclaration(stmt) && !t.isExportDeclaration(stmt)) continue;
    const spec = stmt.moduleSpecifier;
    if (spec !== undefined && t.isStringLiteral(spec) && spec.text.startsWith("@elaraai/")) {
      found = true;
      break;
    }
  }
  importsCache.set(sf, found);
  return found;
}

const pkgDirCache = new Map<string, string | undefined>();

/** The nearest ancestor directory of `p` containing a `package.json`, or undefined. */
function packageDirOf(p: string): string | undefined {
  const start = dirname(resolve(p));
  if (pkgDirCache.has(start)) return pkgDirCache.get(start);
  let dir = start;
  let result: string | undefined;
  for (;;) {
    if (existsSync(join(dir, "package.json"))) {
      result = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  pkgDirCache.set(start, result);
  return result;
}

/** Does a relative `../src`-style import specifier resolve WITHIN the importing
 * file's own package? A package's own spec/example importing `../src/index.js` is
 * the one legitimate relative-`src` import — it cannot import its own published
 * name — whereas reaching into ANOTHER package's `src` should use that package's
 * published name. Conservative (treats as own-package, i.e. allowed) if the
 * filesystem can't be consulted. */
export function resolvesWithinOwnPackage(sourceFileName: string, specifierText: string): boolean {
  try {
    const own = packageDirOf(sourceFileName);
    if (own === undefined) return false;
    const targetAbs = resolve(dirname(sourceFileName), specifierText);
    return packageDirOf(targetAbs) === own;
  } catch {
    return true;
  }
}
