/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * east-web-std reaches no Node module.
 *
 * It runs in a browser, where no Node module loads, so every module its entry
 * reaches, transitively, imports only its own modules and East, and names no
 * global only Node gives — as e3-core's portable entry is held to (#1020).
 * The walk and the scan are checked against planted Node code, so a check
 * that stopped finding anything fails too.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

/** east-web-std's sources: the spec runs from `dist/test`. */
const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

/** The package's one entry. */
const ENTRY = "index.ts";

/** The packages a portable module may import besides its own modules. */
const ALLOWED_PACKAGES = new Set(["@elaraai/east", "@elaraai/east/internal"]);

/** The globals only Node gives. */
const NODE_GLOBALS = new Set(["Buffer", "process", "global", "require", "module", "__dirname", "__filename", "setImmediate", "clearImmediate"]);

/** Whether a specifier names one of the package's own modules. */
const isRelative = (specifier: string): boolean => specifier.startsWith("./") || specifier.startsWith("../");

/** Every source module, by its path under `src`, forward-slashed. */
function sources(): string[] {
    return (readdirSync(SRC, { recursive: true }) as string[])
        .map((file) => file.split(sep).join("/"))
        .filter((file) => file.endsWith(".ts") && !file.endsWith(".spec.ts") && !file.endsWith(".d.ts"))
        .sort();
}

/** What a source imports and which Node-only globals it names. */
interface Scan {
    imports: string[];
    globals: string[];
}

/** Whether an identifier refers to a variable, rather than naming a property or declaring its own. */
function isReference(id: ts.Identifier): boolean {
    const parent = id.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
    if (ts.isQualifiedName(parent) && parent.right === id) return false;
    if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent)
        || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isGetAccessorDeclaration(parent)
        || ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent)) && parent.name === id) return false;
    if (ts.isBindingElement(parent) && parent.propertyName === id) return false;
    if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent)
        || ts.isClassDeclaration(parent) || ts.isImportSpecifier(parent) || ts.isImportClause(parent)) && parent.name === id) return false;
    return true;
}

/** Parses a source and collects every module it imports and every Node-only global it names. */
function scan(text: string, fileName: string): Scan {
    const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const imports: string[] = [];
    const globals: string[] = [];
    const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
            imports.push(node.moduleSpecifier.text);
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
            imports.push(node.moduleReference.expression.text);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] !== undefined && ts.isStringLiteralLike(node.arguments[0])) {
            imports.push(node.arguments[0].text);
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
            imports.push(node.argument.literal.text);
        } else if (ts.isIdentifier(node) && NODE_GLOBALS.has(node.text) && isReference(node)) {
            globals.push(node.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return { imports, globals };
}

/** The source a relative specifier names, from the source that imports it. */
function resolveRelative(from: string, specifier: string): string {
    return posix.normalize(posix.join(posix.dirname(from), specifier.replace(/\.js$/, ".ts")));
}

/** Every module the entry reaches, each with what it imports and names. */
function reach(entry: string, read: (file: string) => string): Map<string, Scan> {
    const reached = new Map<string, Scan>();
    const pending = [entry];
    while (pending.length > 0) {
        const file = pending.pop()!;
        if (reached.has(file)) continue;
        const found = scan(read(file), file);
        reached.set(file, found);
        for (const specifier of found.imports.filter(isRelative)) {
            pending.push(resolveRelative(file, specifier));
        }
    }
    return reached;
}

/** What a set of modules imports that is neither its own nor East, and the Node globals it names. */
function offences(reached: Map<string, Scan>): string[] {
    const found: string[] = [];
    for (const [file, { imports, globals }] of [...reached].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
        for (const specifier of imports) {
            if (!isRelative(specifier) && !ALLOWED_PACKAGES.has(specifier)) found.push(`${file} imports ${specifier}`);
        }
        for (const name of globals) found.push(`${file} names ${name}`);
    }
    return found;
}

const readSource = (file: string): string => readFileSync(join(SRC, file), "utf8");

describe("east-web-std reaches no Node module", () => {
    it("imports only its own modules and East, and names no Node global, from its entry on", () => {
        assert.deepEqual(offences(reach(ENTRY, readSource)), [], "a browser loads none of these: use a web-standard global, or East");
    });

    it("reaches every module it ships from its entry", () => {
        // A module the entry does not reach would ship unchecked
        assert.deepEqual([...reach(ENTRY, readSource).keys()].sort(), sources());
    });

    it("finds a planted Node import and Node global, however it is written", () => {
        const planted: Record<string, string> = {
            "index.ts": [
                `// A comment naming Buffer and process is not code`,
                `import { a } from "./a.js";`,
                `export * from "./b.js";`,
                `export const text = "process and Buffer in a string are not code";`,
                `export const host = { process: 1 }.process;`,
            ].join("\n"),
            "a.ts": [
                `import { readFileSync } from "node:fs";`,
                `import type { Readable } from "stream";`,
                `export const a = Buffer.from(readFileSync("x"));`,
            ].join("\n"),
            "b.ts": [
                `export const env = process.env.HOME;`,
                `export const load = () => import("node:worker_threads");`,
                `export type Stat = import("fs").Stats;`,
            ].join("\n"),
        };
        const found = offences(reach("index.ts", (file) => planted[file]!));
        assert.deepEqual(found, [
            "a.ts imports node:fs",
            "a.ts imports stream",
            "a.ts names Buffer",
            "b.ts imports node:worker_threads",
            "b.ts imports fs",
            "b.ts names process",
        ]);
    });

    it("takes a module of its own and East as portable", () => {
        const planted: Record<string, string> = {
            "index.ts": `import { East } from "@elaraai/east";\nimport type { PlatformFunction } from "@elaraai/east/internal";\nexport * from "./c.js";`,
            "c.ts": `export const now = () => globalThis.crypto.randomUUID();`,
        };
        assert.deepEqual(offences(reach("index.ts", (file) => planted[file]!)), []);
    });
});
