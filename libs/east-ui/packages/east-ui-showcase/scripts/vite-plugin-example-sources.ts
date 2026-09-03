/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * Vite plugin that captures `example({ fn, ... })` declarations in
 * `*.examples.ts` files and exposes them via the virtual module
 * `virtual:example-sources`. Three exports:
 *
 * - `exampleSources` — the authored `fn` source (raw + highlighted HTML)
 *   for the live `east-ui` examples, keyed `pathKey → name`. Backs the
 *   source-code toggle on rendered cards.
 * - `exampleDependencies` — the module-scope declarations each example file's
 *   bodies reference (the un-inlined `e3.input` / `e3.function` / `e3.record`
 *   / `e3.mutation` defs, plus any supporting types), keyed `pathKey`. Only
 *   the reference closure over the example bodies is kept. Shown in a separate
 *   disclosure above the source toggle so the card is self-contained.
 * - `codeExamples` — a flat list of non-UI examples (the `CODE_EXAMPLE_ROOTS`
 *   packages) with their `fn` source plus extracted `keywords` /
 *   `description` / `returns`. These packages can't run in the browser, so
 *   they're read statically and shown as code blocks in "Code Reference".
 *   Each one also carries the `python` printed from its IR, joined by id from
 *   the Claude plugin's example index (`example-renderings.ts`, #655) — a
 *   Code Reference example missing from that index fails the build, naming it.
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
import {
    defaultIndexPath, indexIdFor, loadIndexRenderings, missingRenderingsError, type IndexRendering,
} from "./example-renderings";

hljs.registerLanguage("typescript", typescriptLang);

export interface ExampleSourcesOptions {
    /** Absolute path to the live `east-ui` test root — the directory
     *  containing `<category>/<component>.examples.ts` files. */
    testDir: string;
    /** Absolute path to the live `e3-ui` test root. Its example files are
     *  flat (`data.examples.tsx`), so their captured sources are keyed
     *  `e3/<stem>` — matching the catalog's e3 pathKeys. */
    e3TestDir?: string;
    /** Absolute path to the showcase package root. `CODE_EXAMPLE_ROOTS`
     *  `dir` values are resolved against this, exactly like `testDir`. */
    rootDir: string;
    /** The Claude plugin's example index, the source of each Code Reference
     *  example's python rendering. Default: `libs/east-claude-plugin/index.json`. */
    indexPath?: string;
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
    /** What the index can show the example as (`typescript` + `python` for a program). */
    languages: string[];
    /** The python printed from the example's IR by the python printer, from the index. */
    python: string | null;
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

/**
 * Capture the file's module-scope "dependencies" — the top-level declarations
 * the example bodies reference but can't inline (the un-inlined `e3.input` /
 * `e3.function` / `e3.record` / `e3.mutation` defs and any supporting types),
 * since they must be module-scope exports for the runtime to seed.
 *
 * Only declarations reachable from an `example({...})` body are kept — the
 * transitive reference closure over the file's example bodies — so unrelated
 * leftovers are dropped. Returns the kept declarations in source order (with
 * each one's leading comments), or `""` when nothing is referenced. */
function extractDependencies(filePath: string, code: string): string {
    const sf = ts.createSourceFile(
        filePath,
        code,
        ts.ScriptTarget.Latest,
        /*setParentNodes*/ true,
        ts.ScriptKind.TSX,
    );

    /** Identifier texts referenced anywhere in a subtree, skipping the member
     *  name of a property access (`x.foo` → `x`, not `foo`) and a qualified
     *  type's right side, so method/property names can't shadow a declaration
     *  of the same name. */
    const refsOf = (node: ts.Node): Set<string> => {
        const out = new Set<string>();
        const walk = (n: ts.Node) => {
            if (
                ts.isIdentifier(n) &&
                !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) &&
                !(ts.isQualifiedName(n.parent) && n.parent.right === n)
            ) {
                out.add(n.text);
            }
            ts.forEachChild(n, walk);
        };
        walk(node);
        return out;
    };

    /** The names a top-level statement declares. */
    const namesOf = (stmt: ts.Statement): string[] => {
        if (ts.isVariableStatement(stmt)) {
            return stmt.declarationList.declarations
                .map((d) => (ts.isIdentifier(d.name) ? d.name.text : undefined))
                .filter((n): n is string => n !== undefined);
        }
        if (
            (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) ||
                ts.isEnumDeclaration(stmt) || ts.isFunctionDeclaration(stmt) ||
                ts.isClassDeclaration(stmt)) &&
            stmt.name
        ) {
            return [stmt.name.text];
        }
        return [];
    };

    /** If a statement is `export const X = example({ fn, ... })`, return the
     *  `fn` initializer — the East body whose references are the roots. */
    const exampleFnOf = (stmt: ts.Statement): ts.Expression | undefined => {
        if (!ts.isVariableStatement(stmt)) return undefined;
        for (const d of stmt.declarationList.declarations) {
            if (
                d.initializer &&
                ts.isCallExpression(d.initializer) &&
                ts.isIdentifier(d.initializer.expression) &&
                d.initializer.expression.text === "example" &&
                d.initializer.arguments[0] &&
                ts.isObjectLiteralExpression(d.initializer.arguments[0])
            ) {
                return d.initializer.arguments[0].properties.find(
                    (p): p is ts.PropertyAssignment =>
                        ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "fn",
                )?.initializer;
            }
        }
        return undefined;
    };

    interface Decl { names: string[]; refs: Set<string>; text: string }
    const decls: Decl[] = [];
    const roots = new Set<string>();
    for (const stmt of sf.statements) {
        if (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) continue;
        const exFn = exampleFnOf(stmt);
        if (exFn) {
            for (const r of refsOf(exFn)) roots.add(r);
            continue;
        }
        // Keep each statement's own leading comments (the explanatory blurb
        // above a def is often the point), but never the file-top license /
        // jsx pragma — those sit above the imports, not these statements.
        const leading = ts.getLeadingCommentRanges(code, stmt.getFullStart()) ?? [];
        const comments = leading.map((r) => code.slice(r.pos, r.end)).join("\n");
        const body = stmt.getText(sf);
        decls.push({ names: namesOf(stmt), refs: refsOf(stmt), text: comments ? `${comments}\n${body}` : body });
    }

    // Walk the reference closure from the roots (identifiers used in the example
    // bodies), following each kept declaration's own references transitively.
    const byName = new Map<string, number>();
    decls.forEach((d, i) => d.names.forEach((n) => byName.set(n, i)));

    const needed = new Set<number>();
    const queue = [...roots].map((r) => byName.get(r)).filter((i): i is number => i !== undefined);
    while (queue.length) {
        const idx = queue.pop()!;
        if (needed.has(idx)) continue;
        needed.add(idx);
        for (const ref of decls[idx].refs) {
            const next = byName.get(ref);
            if (next !== undefined && !needed.has(next)) queue.push(next);
        }
    }

    return decls.filter((_, i) => needed.has(i)).map((d) => d.text).join("\n\n");
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

/** Like {@link capture} but for whole statements (the module-scope setup),
 *  which Prettier formats directly — no expression-wrapping needed. */
async function captureStatements(src: string): Promise<CapturedSource> {
    let raw = src;
    try {
        raw = (await format(src, {
            parser: "typescript",
            tabWidth: 4,
            printWidth: 92,
            singleQuote: false,
        })).trimEnd();
    } catch {
        // Prettier failed — fall back to the raw source.
    }
    return { raw, html: highlight(raw) };
}

/** Live source map: `pathKey → name → fn source`. `keyPrefix` namespaces
 *  flat roots (the e3-ui tree → `e3/<stem>`) against east-ui's
 *  `<category>/<component>` keys. */
async function buildSources(
    testDir: string,
    includeTopLevel = false,
    keyPrefix = "",
): Promise<{
    sources: Record<string, Record<string, CapturedSource>>;
    dependencies: Record<string, CapturedSource>;
}> {
    const discovered = await discoverExampleFiles({ testDir, includeTopLevel });
    const sources: Record<string, Record<string, CapturedSource>> = {};
    const dependencies: Record<string, CapturedSource> = {};
    for (const { filePath, pathKey } of discovered) {
        const code = await fs.readFile(filePath, "utf8");
        const raw = extractRaw(filePath, code);
        const names = Object.keys(raw);
        if (names.length === 0) continue;
        const captured: Record<string, CapturedSource> = {};
        for (const name of names) captured[name] = await capture(raw[name].fn);
        sources[keyPrefix + pathKey] = captured;
        const deps = extractDependencies(filePath, code);
        if (deps.trim()) dependencies[keyPrefix + pathKey] = await captureStatements(deps);
    }
    return { sources, dependencies };
}

/** Flat list of non-UI examples across every `CODE_EXAMPLE_ROOTS` package.
 *  Only `.examples.ts` files are taken here: by convention a `.tsx` example
 *  returns renderable UI and goes on the live `import.meta.glob` path, while
 *  a plain `.ts` example is shown as a code block. */
async function buildCodeExamples(
    rootDir: string,
    renderings: Map<string, IndexRendering>,
    indexPath: string,
): Promise<CodeExample[]> {
    const out: CodeExample[] = [];
    const missing: string[] = [];
    for (const root of CODE_EXAMPLE_ROOTS) {
        const testDir = path.resolve(rootDir, root.dir);
        const discovered = await discoverExampleFiles({ testDir, includeTopLevel: true });
        for (const { filePath, pathKey } of discovered) {
            if (!filePath.endsWith(".examples.ts")) continue;
            const code = await fs.readFile(filePath, "utf8");
            const raw = extractRaw(filePath, code);
            for (const [name, ex] of Object.entries(raw)) {
                const id = indexIdFor(root.package, pathKey, name);
                const rendering = renderings.get(id);
                if (rendering === undefined) missing.push(id);
                out.push({
                    package: root.package,
                    pathKey: `${root.package}/${pathKey}`,
                    file: pathKey,
                    name,
                    keywords: ex.keywords,
                    description: ex.description,
                    returns: ex.returns ? await formatExpr(ex.returns) : "",
                    source: await capture(ex.fn),
                    languages: rendering?.languages ?? ["typescript"],
                    python: rendering?.python ?? null,
                });
            }
        }
    }
    if (missing.length > 0) throw missingRenderingsError(missing, indexPath);
    out.sort((a, b) => a.pathKey.localeCompare(b.pathKey) || a.name.localeCompare(b.name));
    return out;
}

export function exampleSourcesPlugin(opts: ExampleSourcesOptions): Plugin {
    let server: ViteDevServer | undefined;
    const indexPath = opts.indexPath ?? defaultIndexPath(opts.rootDir);

    /* Absolute roots whose `.examples.*` changes should invalidate the
     * virtual module — the live `east-ui` + `e3-ui` trees plus every
     * code-reference root. */
    const watchedDirs = [
        opts.testDir,
        ...(opts.e3TestDir ? [opts.e3TestDir] : []),
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
            const empty = { sources: {}, dependencies: {} };
            const [east, e3, codeExamples] = await Promise.all([
                buildSources(opts.testDir),
                opts.e3TestDir ? buildSources(opts.e3TestDir, true, "e3/") : Promise.resolve(empty),
                loadIndexRenderings(indexPath).then((renderings) => buildCodeExamples(opts.rootDir, renderings, indexPath)),
            ]);
            const exampleSources = { ...east.sources, ...e3.sources };
            const exampleDependencies = { ...east.dependencies, ...e3.dependencies };
            return (
                `export const exampleSources = ${JSON.stringify(exampleSources, null, 2)};\n` +
                `export const exampleDependencies = ${JSON.stringify(exampleDependencies, null, 2)};\n` +
                `export const codeExamples = ${JSON.stringify(codeExamples, null, 2)};\n`
            );
        },

        configureServer(devServer) {
            server = devServer;
            /* Code-reference roots live outside this package and are never
             * imported into the module graph, so chokidar won't watch them
             * on its own — add them explicitly for HMR. */
            server.watcher.add([...watchedDirs, indexPath]);
            const onChange = (file: string) => {
                if (!server) return;
                /* `file` is absolute, normalised by chokidar. Reload only when a
                 * matched example file changed (vs. unrelated files in the same
                 * watch tree), or the plugin index was regenerated. */
                const abs = path.resolve(file);
                const isExample = abs.endsWith(".examples.ts") || abs.endsWith(".examples.tsx");
                if (abs === indexPath || (isExample && watchedDirs.some((d) => abs.startsWith(d)))) {
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
