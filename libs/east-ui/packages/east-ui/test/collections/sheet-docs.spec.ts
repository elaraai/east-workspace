/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// The Sheet's TypeDoc examples are tested examples (#862). Each `@example`
// under `src/collections/sheet/`, on the `<Sheet>` tag and in the editing
// contract its transactions moved to (`src/contracts/editing.ts`, #879) is the
// verbatim `fn` of an `example()` in `test/collections/sheet*.examples.ts(x)`
// or `test/contracts/editing.examples.ts` that a spec runs, behind imports
// from the public packages and any module-scope declaration of that file. An
// example edited without its docs, or a doc example no test runs, fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

/** The package root — this spec runs from `dist/test/collections/`. */
const ROOT = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, ROOT), "utf-8");
const list = (dir: string, name: RegExp): string[] =>
    readdirSync(new URL(dir, ROOT)).filter((f) => name.test(f)).sort().map((f) => dir + f);

const SOURCES = [...list("src/collections/sheet/", /\.ts$/), "src/runtime/collections/sheet.ts", "src/contracts/editing.ts"];
const EXAMPLES = [...list("test/collections/", /^sheet[\w-]*\.examples\.tsx?$/), "test/contracts/editing.examples.ts"];
const SPECS = [...list("test/collections/", /^sheet[\w-]*\.spec\.ts$/), "test/contracts/editing.spec.ts"].map(read).join("\n");
const PRAGMA = "// .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma";
const PUBLIC_IMPORT = /^import \{ [^}]+ \} from "@elaraai\/east(-ui)?";$/;

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
function flaw(doc: DocExample, m: Mirror): string | undefined {
    const tsx = m.file.endsWith(".tsx");
    const fence = tsx ? "```tsx" : "```ts";
    if (doc.fence !== fence) return `fenced ${doc.fence}, not ${fence}`;
    if (tsx && doc.code[0] !== PRAGMA) return "a .tsx example opens with the pragma note";
    const code = tsx ? doc.code.slice(1) : doc.code;
    if (code.some((l) => l.startsWith("import ") && !PUBLIC_IMPORT.test(l))) return "an import from outside @elaraai/east and @elaraai/east-ui";
    let imports = 0;
    while (code[imports]?.startsWith("import ")) imports++;
    const moduleScope = new Set(read(m.file).split("\n").filter((l) => l !== "" && !/^\s/.test(l)));
    const stray = code.slice(imports, code.length - m.lines.length).find((l) => l !== "" && !moduleScope.has(l));
    if (stray !== undefined) return `\`${stray}\` is not a module-scope line of ${m.file}`;
    if (!new RegExp(`\\b${m.name}: \\w+\\.${m.name}\\b`).test(SPECS)) return "not wired into a spec's Assert.examples";
    return undefined;
}

test("every Sheet @example is the verbatim fn of a tested example, imported from the public packages", () => {
    const mirrors = EXAMPLES.flatMap(mirrorsOf);
    const docs = SOURCES.flatMap(docExamplesOf);
    assert.ok(docs.some((d) => d.at.startsWith("src/runtime/collections/sheet.ts:")), "the <Sheet> tag carries an @example");
    const failures = docs.flatMap((doc) => {
        const m = mirrorOf(doc, mirrors);
        if (m === undefined) return [`${doc.at}: its code does not end in \`const <name> = <the fn of an example() in test/collections/sheet*.examples.ts(x) or test/contracts/editing.examples.ts>\`, verbatim`];
        const why = flaw(doc, m);
        return why === undefined ? [] : [`${doc.at}: ${m.name} — ${why}`];
    });
    assert.deepEqual(failures, []);
});
