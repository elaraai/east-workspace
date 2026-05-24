/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule } from "../types.js";

const NAME = "no-relative-src-import";
const CODE = 990007;

const DEEP_PACKAGE_SRC = /^@elaraai\/[^/]+\/src(\/|$)/;
const RELATIVE_SRC = /\/src(\/|$)/;

// Tests and examples must import East packages by their published name
// (`@elaraai/east`), not reach into a package's `src/` via a relative path or a
// deep `/src` specifier — those bypass the package's public API surface.
export const noRelativeSrcImport: EastRule = {
  name: NAME,
  code: CODE,
  description: "Import East packages by published name, not via ../src or a deep /src path.",
  check(node, ctx) {
    const t = ctx.ts;
    let specifier: ts.Expression | undefined;
    if (t.isImportDeclaration(node)) specifier = node.moduleSpecifier;
    else if (t.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    else return;

    if (specifier === undefined || !t.isStringLiteral(specifier)) return;
    const text = specifier.text;
    const relativeIntoSrc = text.startsWith(".") && RELATIVE_SRC.test(text);
    const deepPackageSrc = DEEP_PACKAGE_SRC.test(text);
    if (!relativeIntoSrc && !deepPackageSrc) return;

    const sf = ctx.sourceFile;
    const start = specifier.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: specifier.getEnd() - start,
      messageText:
        "Import East packages by their published name (e.g. `@elaraai/east`), not a relative `../src/...` path or a deep `/src` import.",
      category: "warning",
    });
  },
};