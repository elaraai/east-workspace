/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * Vite plugin that captures `example({ fn, ... })` declarations in
 * `*.examples.ts` files and exposes them via the virtual module
 * `virtual:example-sources`. Two exports:
 *
 * - `exampleSources` — the authored `fn` source (raw + highlighted HTML)
 *   for the live `east-ui` examples, keyed `pathKey → name`. Backs the
 *   source-code toggle on rendered cards.
 * - `codeExamples` — a flat list of non-UI examples (the `CODE_EXAMPLE_ROOTS`
 *   packages) with their `fn` source plus extracted `keywords` /
 *   `description` / `returns`. These packages can't run in the browser, so
 *   they're read statically and shown as code blocks in "Code Reference".
 *
 * @remarks
 * - Parses each file with the TypeScript compiler API.
 * - `fn` source is normalised through Prettier, then highlighted with
 *   highlight.js — both at build time.
 * - HMR: the virtual module is invalidated when any matched file under a
 *   watched root changes.
 */

import type { Plugin, ViteDevServer } from "vite";
import * as ts from "typescript";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { format } from "prettier";
import hljs from "highlight.js/lib/core";
import typescriptLang from "highlight.js/lib/languages/typescript";
import { discoverExampleFiles } from "./discover-example-files";
import { CODE_EXAMPLE_ROOTS } from "./example-roots";

hljs.registerLanguage("typescript", typescriptLang);

export interface ExampleSourcesOptions {
    /** Absolute path to the live `east-ui` test root — the directory
     *  containing `<category>/<component>.examples.ts` files. */
    testDir: string;
    /** Absolute path to the showcase package root. `CODE_EXAMPLE_ROOTS`
     *  `dir` values are resolved against this, exactly like `testDir`. */
    rootDir: string;
}

const VIRTUAL_ID = "virtual:example-sources";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

export interface CapturedSource {
    /** Raw prettier-formatted TypeScript source. */
    raw: string;
    /** highlight.js pre-highlighted HTML of the raw source. */
    html: string;
}

/** One statically-read non-UI example: source + the metadata needed to
 *  list and filter it in the Code Reference section, never executed. */
export interface CodeExample {
    /** Source package label, e.g. `east-py-datascience`. */
    package: string;
    /** `package/relative/path` (no extension) — unique per example file. */
    pathKey: string;
    /** Path within the package's test dir (no extension), e.g. `sql/sqlite`. */
    file: string;
    /** Exported `const` name of the example. */
    name: string;
    keywords: string[];
    description: string;
    /** Source text of the example's `returns` value (prettier-formatted). */
    returns: string;
    /** The example's `fn` body, formatted + highlighted. */
    source: CapturedSource;
}

/** Raw (unformatted) capture of one `example({...})` declaration. */
interface RawExample {
    fn: string;
    keywords: string[];
    description: string;
    returns: string;
}

/** Walk a file's AST and pull the raw text of every top-level
 *  `export const X = example({ fn, keywords, description, returns })`. */
function extractRaw(filePath: string, code: string): Record<string, RawExample> {
    const sf = ts.createSourceFile(
        filePath,
        code,
        ts.ScriptTarget.Latest,
        /*setParentNodes*/ true,
        ts.ScriptKind.TSX,
    );
    const out: Record<string, RawExample> = {};

    const prop = (obj: ts.ObjectLiteralExpression, key: string): ts.Expression | undefined =>
        obj.properties.find(
            (p): p is ts.PropertyAssignment =>
                ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === key,
        )?.initializer;

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
                    const fn = prop(obj, "fn");
                    if (!fn) continue;

                    const keywordsExpr = prop(obj, "keywords");
                    const keywords =
                        keywordsExpr && ts.isArrayLiteralExpression(keywordsExpr)
                            ? keywordsExpr.elements
                                  .filter(ts.isStringLiteralLike)
                                  .map((e) => e.text)
                            : [];

                    const descExpr = prop(obj, "description");
                    const description =
                        descExpr && ts.isStringLiteralLike(descExpr) ? descExpr.text : "";

                    const returnsExpr = prop(obj, "returns");
                    const returns = returnsExpr ? returnsExpr.getText(sf) : "";

                    out[decl.name.text] = { fn: fn.getText(sf), keywords, description, returns };
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

/** Prettier-format an expression snippet by wrapping it in an assignment
 *  (the only way Prettier will format a bare expression), then unwrap. */
async function formatExpr(src: string): Promise<string> {
    try {
        const out = await format(`const __x = ${src};`, {
            parser: "typescript",
            tabWidth: 4,
            printWidth: 92,
            singleQuote: false,
        });
        return out
            .replace(/^\s*const\s+__x\s*=\s*/, "")
            .replace(/;\s*$/, "")
            .trimEnd();
    } catch {
        // Prettier failed (bad input?) — fall back to the raw source.
        return src;
    }
}

function highlight(src: string): string {
    try {
        return hljs.highlight(src, { language: "typescript" }).value;
    } catch {
        return src.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
}

async function capture(src: string): Promise<CapturedSource> {
    const raw = await formatExpr(src);
    return { raw, html: highlight(raw) };
}

/** Live `east-ui` source map: `pathKey → name → fn source`. */
async function buildSources(testDir: string): Promise<Record<string, Record<string, CapturedSource>>> {
    const discovered = await discoverExampleFiles({ testDir });
    const sources: Record<string, Record<string, CapturedSource>> = {};
    for (const { filePath, pathKey } of discovered) {
        const code = await fs.readFile(filePath, "utf8");
        const raw = extractRaw(filePath, code);
        const names = Object.keys(raw);
        if (names.length === 0) continue;
        const captured: Record<string, CapturedSource> = {};
        for (const name of names) captured[name] = await capture(raw[name].fn);
        sources[pathKey] = captured;
    }
    return sources;
}

/** Flat list of non-UI examples across every `CODE_EXAMPLE_ROOTS` package.
 *  Only `.examples.ts` files are taken here: by convention a `.tsx` example
 *  returns renderable UI and goes on the live `import.meta.glob` path, while
 *  a plain `.ts` example is shown as a code block. */
async function buildCodeExamples(rootDir: string): Promise<CodeExample[]> {
    const out: CodeExample[] = [];
    for (const root of CODE_EXAMPLE_ROOTS) {
        const testDir = path.resolve(rootDir, root.dir);
        const discovered = await discoverExampleFiles({ testDir, includeTopLevel: true });
        for (const { filePath, pathKey } of discovered) {
            if (!filePath.endsWith(".examples.ts")) continue;
            const code = await fs.readFile(filePath, "utf8");
            const raw = extractRaw(filePath, code);
            for (const [name, ex] of Object.entries(raw)) {
                out.push({
                    package: root.package,
                    pathKey: `${root.package}/${pathKey}`,
                    file: pathKey,
                    name,
                    keywords: ex.keywords,
                    description: ex.description,
                    returns: ex.returns ? await formatExpr(ex.returns) : "",
                    source: await capture(ex.fn),
                });
            }
        }
    }
    out.sort((a, b) => a.pathKey.localeCompare(b.pathKey) || a.name.localeCompare(b.name));
    return out;
}

export function exampleSourcesPlugin(opts: ExampleSourcesOptions): Plugin {
    let server: ViteDevServer | undefined;

    /* Absolute roots whose `.examples.*` changes should invalidate the
     * virtual module — the live `east-ui` tree plus every code-reference root. */
    const watchedDirs = [
        opts.testDir,
        ...CODE_EXAMPLE_ROOTS.map((r) => path.resolve(opts.rootDir, r.dir)),
    ];

    return {
        name: "example-sources",

        resolveId(id) {
            if (id === VIRTUAL_ID) return RESOLVED_ID;
            return null;
        },

        async load(id) {
            if (id !== RESOLVED_ID) return;
            const [exampleSources, codeExamples] = await Promise.all([
                buildSources(opts.testDir),
                buildCodeExamples(opts.rootDir),
            ]);
            return (
                `export const exampleSources = ${JSON.stringify(exampleSources, null, 2)};\n` +
                `export const codeExamples = ${JSON.stringify(codeExamples, null, 2)};\n`
            );
        },

        configureServer(devServer) {
            server = devServer;
            /* Code-reference roots live outside this package and are never
             * imported into the module graph, so chokidar won't watch them
             * on its own — add them explicitly for HMR. */
            server.watcher.add(watchedDirs);
            const onChange = (file: string) => {
                if (!server) return;
                /* `file` is absolute, normalised by chokidar. Reload only when a
                 * matched example file changed (vs. unrelated files in the same
                 * watch tree). */
                const abs = path.resolve(file);
                const isExample = abs.endsWith(".examples.ts") || abs.endsWith(".examples.tsx");
                if (isExample && watchedDirs.some((d) => abs.startsWith(d))) {
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
