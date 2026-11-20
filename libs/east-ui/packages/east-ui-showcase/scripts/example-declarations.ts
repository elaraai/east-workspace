/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * The `example({...})` declarations of an examples file, read from its AST
 * with the TypeScript compiler API: `const X = example({ fn, ... })` at the
 * top level — what the source capture reads a page's examples from, and what
 * the catalog builds an entry of. An examples file exporting none — one that
 * holds the e3 definitions other files' examples read — has no page.
 */

import * as ts from "typescript";

/** A top-level `example({...})` declaration: its name, the object `example` is called with, and whether it is exported. */
export interface ExampleDeclaration {
    /** The `const`'s name. */
    readonly name: string;
    /** The object `example` is called with. */
    readonly object: ts.ObjectLiteralExpression;
    /** Whether the statement exports it. */
    readonly exported: boolean;
}

/**
 * An object literal's property, by its name.
 *
 * @param object - The object literal
 * @param key - The property's name
 * @returns The property's value; `undefined` where the object has no property of that name
 */
export function propertyOf(object: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined {
    return object.properties.find(
        (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === key,
    )?.initializer;
}

/**
 * The `example({...})` a top-level statement declares: `const X = example({ ... })`, exported or not.
 *
 * @param statement - The statement
 * @returns Its first such declaration; `undefined` for a statement that declares none
 */
export function exampleIn(statement: ts.Statement): ExampleDeclaration | undefined {
    if (!ts.isVariableStatement(statement)) return undefined;
    const exported = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
    for (const decl of statement.declarationList.declarations) {
        const call = decl.initializer;
        const object = call !== undefined && ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === "example"
            ? call.arguments[0] : undefined;
        if (object !== undefined && ts.isObjectLiteralExpression(object) && ts.isIdentifier(decl.name)) {
            return { name: decl.name.text, object, exported };
        }
    }
    return undefined;
}

/**
 * A file's examples: every top-level `export const X = example({ fn, ... })`, in the file's order.
 *
 * @param filePath - The file's path, which names it in the AST
 * @param code - The file's text
 * @returns Each exported example's declaration, and the file parsed
 */
export function exampleDeclarations(filePath: string, code: string): { file: ts.SourceFile; examples: ExampleDeclaration[] } {
    const file = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TSX);
    const examples = file.statements.flatMap((statement) => {
        const example = exampleIn(statement);
        return example !== undefined && example.exported && propertyOf(example.object, "fn") !== undefined ? [example] : [];
    });
    return { file, examples };
}
