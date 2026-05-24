/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * Vite plugin that captures the authored source of `example({ fn, ... })`
 * declarations in `*.examples.ts` files and exposes them via the virtual
 * module `virtual:example-sources`.
 *
 * @remarks
 * - Globs `include` under `cwd`, parses each with the TypeScript compiler
 *   API, extracts the `fn` property's source text for every top-level
 *   `export const X = example({...})`.
 * - Runs the captured text through Prettier (parser: "typescript") at
 *   build time so the showcase displays normalised formatting.
 * - HMR: the virtual module is invalidated when any matched file changes.
 */

import type { Plugin, ViteDevServer } from "vite";
import * as ts from "typescript";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { format } from "prettier";
import hljs from "highlight.js/lib/core";
import typescriptLang from "highlight.js/lib/languages/typescript";
import { discoverExampleFiles } from "./discover-example-files";

hljs.registerLanguage("typescript", typescriptLang);

export interface ExampleSourcesOptions {
    /** Absolute path to the test root — the directory containing
     *  `<category>/<component>.examples.ts` files. */
    testDir: string;
}

const VIRTUAL_ID = "virtual:example-sources";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

export interface CapturedSource {
    /** Raw prettier-formatted TypeScript source. */
    raw: string;
    /** highlight.js pre-highlighted HTML of the raw source. */
    html: string;
}

async function extractAndFormat(filePath: string, code: string): Promise<Record<string, CapturedSource>> {
    const sf = ts.createSourceFile(
        filePath,
        code,
        ts.ScriptTarget.Latest,
        /*setParentNodes*/ true,
        ts.ScriptKind.TSX,
    );
    const raw: Record<string, string> = {};

    const visit = (node: ts.Node) => {
        if (
            ts.isVariableStatement(node) &&
            node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
            for (const decl of node.declarationList.declarations) {
                if (
                    decl.initializer &&
                    ts.isCallExpression(decl.initializer) &&
                    ts.isIdentifier(decl.initializer.expression) &&
                    decl.initializer.expression.text === "example" &&
                    ts.isIdentifier(decl.name) &&
                    decl.initializer.arguments[0] &&
                    ts.isObjectLiteralExpression(decl.initializer.arguments[0])
                ) {
                    const obj = decl.initializer.arguments[0];
                    const fnProp = obj.properties.find(
                        (p): p is ts.PropertyAssignment =>
                            ts.isPropertyAssignment(p) &&
                            ts.isIdentifier(p.name) &&
                            p.name.text === "fn",
                    );
                    if (fnProp) {
                        raw[decl.name.text] = fnProp.initializer.getText(sf);
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);

    const captured: Record<string, CapturedSource> = {};
    for (const [name, src] of Object.entries(raw)) {
        let formatted = src;
        try {
            const wrapped = `const __fn = ${src};`;
            const out = await format(wrapped, {
                parser: "typescript",
                tabWidth: 4,
                printWidth: 92,
                singleQuote: false,
            });
            formatted = out
                .replace(/^\s*const\s+__fn\s*=\s*/, "")
                .replace(/;\s*$/, "")
                .trimEnd();
        } catch {
            // Prettier failed (bad input?) — fall through with raw src.
        }

        let html = "";
        try {
            html = hljs.highlight(formatted, { language: "typescript" }).value;
        } catch {
            // Highlighter failed — emit escaped text so the renderer still works.
            html = formatted
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
        }
        captured[name] = { raw: formatted, html };
    }
    return captured;
}

async function buildMap(opts: ExampleSourcesOptions): Promise<Record<string, Record<string, CapturedSource>>> {
    const discovered = await discoverExampleFiles({ testDir: opts.testDir });
    const sources: Record<string, Record<string, CapturedSource>> = {};

    for (const { filePath, pathKey } of discovered) {
        const code = await fs.readFile(filePath, "utf8");
        const extracted = await extractAndFormat(filePath, code);
        if (Object.keys(extracted).length === 0) continue;
        sources[pathKey] = extracted;
    }
    return sources;
}

export function exampleSourcesPlugin(opts: ExampleSourcesOptions): Plugin {
    let server: ViteDevServer | undefined;

    return {
        name: "example-sources",

        resolveId(id) {
            if (id === VIRTUAL_ID) return RESOLVED_ID;
            return null;
        },

        async load(id) {
            if (id !== RESOLVED_ID) return;
            const sources = await buildMap(opts);
            return `export const exampleSources = ${JSON.stringify(sources, null, 2)};\n`;
        },

        configureServer(devServer) {
            server = devServer;
            const onChange = (file: string) => {
                if (!server) return;
                /* `file` is absolute, normalised by chokidar. Reload only when a
                 * matched example file changed (vs. unrelated files in the same
                 * watch tree). */
                const abs = path.resolve(file);
                if (abs.startsWith(opts.testDir) && abs.endsWith(".examples.ts")) {
                    const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
                    if (mod) server.reloadModule(mod);
                }
            };
            server.watcher.on("change", onChange);
            server.watcher.on("add", onChange);
            server.watcher.on("unlink", onChange);
        },
    };
}
