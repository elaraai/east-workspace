/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// What a component's doc-example spec reads — the Plan's (#1177), the Sheet's
// (#862, #1179) and the Flowchart's (#1243). Each `@example` under the
// component's `src/<dir>/` is the verbatim `fn` of an `example()` in its
// `test/<dir>/<dir>*.examples.ts(x)` that a spec runs, behind imports from the
// public packages and the module-scope statements of that file it reaches,
// each written as it is there. An example edited without its docs, or a doc
// example no test runs, fails the component's spec.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as ts from "typescript";

/** The package root — this module runs from `dist/test/`. */
const ROOT = new URL("../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, ROOT), "utf-8");
const list = (dir: string, name: RegExp): string[] =>
    readdirSync(new URL(dir, ROOT)).filter((f) => name.test(f)).sort().map((f) => dir + f);

const PRAGMA = "// .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma";
const PUBLIC_IMPORT = /^import \{ [^}]+ \} from "@elaraai\/(east|east-ui|e3-ui)";$|^import e3 from "@elaraai\/e3";$/;

/** The top-level statements of a TypeScript source, each as written — its
 *  leading comments aside, which a doc writes as its own. */
function statementsOf(name: string, text: string): string[] {
    const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    return sf.statements.map((s) => s.getText(sf));
}

/** One example's `fn` as a doc prints it: the head after `fn: `, the body dedented four spaces, the tail closed with `;`. */
interface Mirror {
    readonly file: string;
    readonly name: string;
    readonly lines: readonly string[];
}

/** One `@example` block: where it sits, its fence and its code, the JSDoc gutter removed. */
interface DocExample {
    readonly at: string;
    readonly fence: string;
    readonly code: readonly string[];
}

/** Every `example()` of an examples file, as the docs mirror it. */
function mirrorsOf(file: string): Mirror[] {
    const src = read(file).split("\n");
    return src.flatMap((line, start) => {
        const name = /^export const (\w+) = example\(\{$/.exec(line)?.[1];
        if (name === undefined) return [];
        const fn = src.findIndex((l, i) => i > start && l.startsWith("    fn: "));
        const end = src.findIndex((l, i) => i > fn && (l === "    })," || l === "    )),"));
        assert.ok(fn > start && end > fn, `${file}: the fn of ${name} is not laid out as the docs mirror it`);
        return [{
            file,
            name,
            lines: [
                src[fn]!.slice("    fn: ".length),
                ...src.slice(fn + 1, end).map((l) => l.slice(4)),
                `${src[end]!.trim().slice(0, -1)};`,
            ],
        }];
    });
}

/** Every `@example` block of a source file. */
function docExamplesOf(file: string): DocExample[] {
    const src = read(file).split("\n");
    const gutterless = (l: string): string => l.replace(/^\s*\* ?/, "");
    return src.flatMap((line, i) => {
        if (!/^\s*\* @example\s*$/.test(line)) return [];
        const close = src.findIndex((l, j) => j > i + 1 && /^\s*\* ```\s*$/.test(l));
        assert.ok(close > i + 1, `${file}:${i + 1}: an @example without a closed code fence`);
        return [{ at: `${file}:${i + 1}`, fence: gutterless(src[i + 1]!), code: src.slice(i + 2, close).map(gutterless) }];
    });
}

/** The example whose `fn` a doc's code ends with, as `const <name> = <fn>`. */
function mirrorOf(doc: DocExample, mirrors: readonly Mirror[]): Mirror | undefined {
    return mirrors.find((m) => {
        const tail = doc.code.slice(doc.code.length - m.lines.length);
        const named = /^const \w+ = /.exec(tail[0] ?? "")?.[0];
        return named !== undefined && tail.length === m.lines.length
            && tail[0]!.slice(named.length) === m.lines[0]
            && tail.every((l, k) => k === 0 || l === m.lines[k]);
    });
}

/** Why a doc example that ends with `m`'s fn is still not its mirror, or `undefined` when it is. */
function flaw(doc: DocExample, m: Mirror, specs: string): string | undefined {
    const tsx = m.file.endsWith(".tsx");
    const fence = tsx ? "```tsx" : "```ts";
    if (doc.fence !== fence) return `fenced ${doc.fence}, not ${fence}`;
    if (tsx && doc.code[0] !== PRAGMA) return "a .tsx example opens with the pragma note";
    const code = tsx ? doc.code.slice(1) : doc.code;
    if (code.some((l) => l.startsWith("import ") && !PUBLIC_IMPORT.test(l))) return "an import from outside @elaraai/east, @elaraai/east-ui, @elaraai/e3-ui and @elaraai/e3";
    let imports = 0;
    while (code[imports]?.startsWith("import ")) imports++;
    // Between the imports and the fn: whole statements of the examples file's
    // module scope — its e3 declarations and their types — each as it is there.
    const moduleScope = new Set(statementsOf(m.file, read(m.file)));
    const between = code.slice(imports, code.length - m.lines.length).join("\n");
    const stray = statementsOf(`${m.file}.doc.tsx`, between).find((s) => !moduleScope.has(s));
    if (stray !== undefined) return `\`${stray.split("\n")[0]}\` is not a module-scope statement of ${m.file}, written as it is there`;
    if (!new RegExp(`\\b${m.name}: \\w+\\.${m.name}\\b`).test(specs)) return "not wired into a spec's Assert.examples";
    return undefined;
}

/** A component's doc examples, read against its tested examples. */
export interface DocExamples {
    /** Whether `src/<dir>/<file>` carries an `@example` that is the verbatim fn of the example `name`. */
    carries(file: string, name: string): boolean;
    /** Each `@example` that is not the verbatim fn of a tested example, where it sits and why. */
    readonly failures: readonly string[];
}

/**
 * Reads a component's doc examples against its tested ones: every `@example`
 * under `src/<dir>/`, every `example()` of `test/<dir>/<dir>*.examples.ts(x)`,
 * and what `test/<dir>/<dir>*.spec.ts` wires into `Assert.examples`.
 *
 * @param dir - The component's directory, under `src/` and `test/` alike
 * @returns What `src/<dir>/` carries, and each doc example that is not a tested one
 */
export function docExamples(dir: string): DocExamples {
    const sources = list(`src/${dir}/`, /\.ts$/);
    const examples = list(`test/${dir}/`, new RegExp(`^${dir}[\\w-]*\\.examples\\.tsx?$`));
    const specs = list(`test/${dir}/`, new RegExp(`^${dir}[\\w-]*\\.spec\\.ts$`)).map(read).join("\n");
    const mirrors = examples.flatMap(mirrorsOf);
    const docs = sources.flatMap(docExamplesOf);
    return {
        carries: (file, name) => docs.some((d) => d.at.startsWith(`src/${dir}/${file}:`) && mirrorOf(d, mirrors)?.name === name),
        failures: docs.flatMap((doc) => {
            const m = mirrorOf(doc, mirrors);
            if (m === undefined) {
                return [`${doc.at}: its code does not end in \`const <name> = <the fn of an example() in test/${dir}/${dir}*.examples.ts(x)>\`, verbatim`];
            }
            const why = flaw(doc, m, specs);
            return why === undefined ? [] : [`${doc.at}: ${m.name} — ${why}`];
        }),
    };
}
