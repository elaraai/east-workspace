/**
 * examples-file.ts
 *
 * Reads one examples file (`*.examples.ts` / `*.examples.tsx`) for the search
 * index: every `export const NAME = example({ … })` with its suite, keywords,
 * description and `fn` source, and the file's imports.
 *
 * The TypeScript parser reads the file — as TSX when it is one. A text scan
 * cannot bound an example in a `.tsx` file, where JSX text is not code: an
 * apostrophe in it ("a task's seam") read as an unclosed string literal, and
 * the example was dropped from the index with only a warning (#846). Every
 * field comes off the syntax tree, so a description keeps its apostrophes too.
 */

import * as fs from "node:fs";
import * as ts from "typescript";

/** One `example()` export of a file. */
export interface ParsedExample {
    exportName: string;
    suiteName: string;
    description: string;
    keywords: string[];
    source: string;
    imports: string[];
}

// ---------------------------------------------------------------------------
// Extract imports (stop at first export or section divider)
// ---------------------------------------------------------------------------

function extractImports(lines: string[]): string[] {
    const imports: string[] = [];
    for (const line of lines) {
        if (/^\s*export\s+const\s/.test(line) || /^\/\/ -{3,}/.test(line)) {
            break;
        }
        if (/^\s*import\s/.test(line)) {
            imports.push(line.trimEnd());
        }
    }
    return imports;
}

// ---------------------------------------------------------------------------
// The example declarations
// ---------------------------------------------------------------------------

/** The initializer of an object literal's `key: …` property, if it has one. */
function propertyOf(obj: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
    return obj.properties.find((p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === key)?.initializer;
}

/** Each `NAME = example({ … })` a top-level `export const` statement declares, with its object literal. */
function examplesOf(statement: ts.Statement): Array<{ name: string; obj: ts.ObjectLiteralExpression }> {
    if (!ts.isVariableStatement(statement)) return [];
    if (!statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return [];
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return [];
    const out: Array<{ name: string; obj: ts.ObjectLiteralExpression }> = [];
    for (const decl of statement.declarationList.declarations) {
        const call = decl.initializer;
        if (call === undefined || !ts.isCallExpression(call)) continue;
        if (!ts.isIdentifier(call.expression) || call.expression.text !== "example") continue;
        const obj = call.arguments[0];
        if (!ts.isIdentifier(decl.name) || obj === undefined || !ts.isObjectLiteralExpression(obj)) continue;
        out.push({ name: decl.name.text, obj });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Parse a single examples file (*.examples.ts / *.examples.tsx)
// ---------------------------------------------------------------------------

/**
 * Read an examples file's `example()` exports, in file order.
 *
 * Each carries the suite of the section divider above it
 * (`// ---\n// Name\n// ---`), its keywords and description, and its source:
 * the `fn` initializer as written, after a comment line with the description
 * and one with the `inputs` / `returns` source when the example declares them.
 *
 * @param filePath - The examples file
 * @returns The file's examples; an export without an `fn` is skipped with a warning
 */
export function parseExamplesFile(filePath: string): ParsedExample[] {
    // Normalise CRLF/CR to LF so the extracted source (and the index built from
    // it) is byte-identical regardless of the checkout's line-ending settings.
    const content = fs.readFileSync(filePath, "utf-8").replace(/\r\n?/g, "\n");
    const lines = content.split("\n");
    const imports = extractImports(lines);
    const results: ParsedExample[] = [];

    // Extract section names from comment dividers
    const sectionRe = /^\/\/ -{3,}\s*\n\/\/ (.+)\n\/\/ -{3,}/gm;
    interface Section { name: string; index: number; }
    const sections: Section[] = [];
    let sectionMatch: RegExpExecArray | null;
    while ((sectionMatch = sectionRe.exec(content)) !== null) {
        sections.push({ name: sectionMatch[1]!.trim(), index: sectionMatch.index });
    }

    const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true,
        filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

    for (const statement of sf.statements) {
        const exportIndex = statement.getStart(sf);
        for (const { name: exportName, obj } of examplesOf(statement)) {
            // Determine which section this export belongs to
            let currentSuite = "";
            for (const section of sections) {
                if (section.index < exportIndex) {
                    currentSuite = section.name;
                } else {
                    break;
                }
            }

            const keywordsExpr = propertyOf(obj, "keywords");
            const keywords = keywordsExpr !== undefined && ts.isArrayLiteralExpression(keywordsExpr)
                ? keywordsExpr.elements.filter(ts.isStringLiteralLike).map((e) => e.text)
                : [];

            const descriptionExpr = propertyOf(obj, "description");
            const description = descriptionExpr !== undefined && ts.isStringLiteralLike(descriptionExpr) ? descriptionExpr.text : "";

            const fnExpr = propertyOf(obj, "fn");
            if (fnExpr === undefined) {
                console.warn(`  Warning: Could not extract fn for example "${exportName}" in ${filePath}`);
                continue;
            }
            const fnValue = fnExpr.getText(sf);

            const inputsRaw = propertyOf(obj, "inputs")?.getText(sf) ?? null;
            const returnsRaw = propertyOf(obj, "returns")?.getText(sf) ?? null;

            // Compose annotated source: prepend description + inputs/returns as comments
            const commentLines: string[] = [];
            if (description) {
                commentLines.push(`// ${description}`);
            }
            if (inputsRaw != null || returnsRaw != null) {
                const parts: string[] = [];
                if (inputsRaw != null) parts.push(`inputs: ${inputsRaw}`);
                if (returnsRaw != null) parts.push(`returns: ${returnsRaw}`);
                commentLines.push(`// ${parts.join("  ")}`);
            }

            const source = [...commentLines, fnValue].join("\n");

            results.push({
                exportName,
                suiteName: currentSuite,
                description,
                keywords,
                source,
                imports,
            });
        }
    }

    return results;
}
