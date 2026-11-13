/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `east-floor/browser-floor`: what the rule refuses in code a browser runs, and what it leaves alone.
 *
 * Each case is a source text checked in a program of its own, with TypeScript's whole library as East's packages
 * compile with it. Refused: every built-in an edition newer than ES2023 declares, however it is reached — named,
 * read by a literal key, destructured out, handed on in an object — and a regular expression's newer syntax. Left:
 * the built-ins of ES2023 and before whose names the newer ones share, this code's own methods of the same names,
 * a type, the members of a shape, and a built-in read through a property this code types as optional.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import ts from "typescript";

interface Place { start: number; end: number; name: string; edition: string | undefined }
interface Rule { newerBuiltins(sourceFile: ts.SourceFile, program: ts.Program): Place[] }

// The rule is plain JavaScript beside the lint configuration, where every package's `eslint.config.js` imports it:
// from this spec as built (`dist/test/lint/`), three directories up.
const rule = await import(new URL("../../../eslint/browser-floor.js", import.meta.url).href) as Rule;

const FILE = "/floor/case.ts";

/** What the rule says of a source text: each name it refuses with its edition, in the text's order. */
function said(text: string): string[] {
    const options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, lib: ["lib.esnext.d.ts", "lib.dom.d.ts"], strict: true, noEmit: true, types: [] };
    const host = ts.createCompilerHost(options);
    const read = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, ...rest) => name === FILE ? ts.createSourceFile(name, text, languageVersion, true) : read(name, languageVersion, ...rest);
    host.fileExists = ((exists) => (name: string) => name === FILE || exists(name))(host.fileExists.bind(host));
    host.readFile = ((readFile) => (name: string) => name === FILE ? text : readFile(name))(host.readFile.bind(host));
    const program = ts.createProgram({ rootNames: [FILE], options, host });
    const source = program.getSourceFile(FILE)!;
    // A case that does not compile proves nothing of the rule.
    const errors = [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
    assert.deepEqual(errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], text);
    return rule.newerBuiltins(source, program).map((place) => place.edition === undefined ? place.name : `${place.name}: ${place.edition}`);
}

describe("east-floor/browser-floor", () => {
    test("refuses the Iterator built-in and the iterator helpers", () => {
        assert.deepEqual(said(`export const it = Iterator.from([1, 2, 3]);`), ["Iterator: ES2025", "from: ES2025"]);
        assert.deepEqual(said(`export const keys = new Map<string, number>().keys().map((k) => k.length);`), ["map: ES2025"]);
        assert.deepEqual(said(`export const kept = new Set<number>().values().filter((n) => n > 1).toArray();`), ["filter: ES2025", "toArray: ES2025"]);
        assert.deepEqual(said(`function* numbers() { yield 1; }\nexport const first = numbers().take(1);`), ["take: ES2025"]);
        assert.deepEqual(said(`export const entries = [1, 2].entries().some(([i]) => i > 0);`), ["some: ES2025"]);
        assert.deepEqual(said(`export class Mine extends Iterator<number> { next() { return { done: true as const, value: undefined }; } }`), ["Iterator: ES2025"]);
        assert.deepEqual(said(`export const is = (x: unknown) => x instanceof Iterator;`), ["Iterator: ES2025"]);
    });

    test("refuses the Set methods on a built-in Set, a ReadonlySet and a union holding one", () => {
        assert.deepEqual(said(`export const both = new Set([1]).union(new Set([2]));`), ["union: ES2025"]);
        assert.deepEqual(said(`export const sub = (a: ReadonlySet<string>, b: Set<string>) => a.isSubsetOf(b);`), ["isSubsetOf: ES2025"]);
        assert.deepEqual(
            said(`class Own { difference(_other: Own): Own { return this; } }\nexport const d = (a: Set<number> | Own, b: Set<number> & Own) => a.difference(b);`),
            ["difference: ES2025"],
        );
    });

    test("refuses each edition's statics and methods, by the edition that declares them", () => {
        assert.deepEqual(said(`export const groups = Object.groupBy([1, 2], (n) => n % 2 === 0 ? "even" : "odd");`), ["groupBy: ES2024"]);
        assert.deepEqual(said(`export const groups = Map.groupBy([1, 2], (n) => n % 2);`), ["groupBy: ES2024"]);
        assert.deepEqual(said(`export const { promise, resolve } = Promise.withResolvers<number>();`), ["withResolvers: ES2024"]);
        assert.deepEqual(said(`export const moved = new ArrayBuffer(8).transfer();`), ["transfer: ES2024"]);
        assert.deepEqual(said(`export const ok = "a".isWellFormed();`), ["isWellFormed: ES2024"]);
        assert.deepEqual(said(`export const tried = Promise.try(() => 1);`), ["try: ES2025"]);
        assert.deepEqual(said(`export const escaped = RegExp.escape("a.b");`), ["escape: ES2025"]);
        assert.deepEqual(said(`export const half = new Float16Array(2);`), ["Float16Array: ES2025"]);
        assert.deepEqual(said(`export const round = Math.f16round(1.5);`), ["f16round: ES2025"]);
        assert.deepEqual(said(`export const all = Array.fromAsync([Promise.resolve(1)]);`), ["fromAsync: a proposal newer than ES2025"]);
        assert.deepEqual(said(`export const got = new Map<string, number>().getOrInsert("a", 1);`), ["getOrInsert: a proposal newer than ES2025"]);
        assert.deepEqual(said(`export const text = new Uint8Array(2).toBase64();`), ["toBase64: a proposal newer than ES2025"]);
        assert.deepEqual(said(`export const is = Error.isError(1);`), ["isError: a proposal newer than ES2025"]);
        assert.deepEqual(said(`export const now = Temporal.Now.instant();`), ["Temporal: a proposal newer than ES2025", "Now: a proposal newer than ES2025", "instant: a proposal newer than ES2025"]);
        assert.deepEqual(said(`export const key = Symbol.dispose;`), ["dispose: a proposal newer than ES2025"]);
    });

    test("refuses a newer built-in however it is reached", () => {
        assert.deepEqual(said(`export const from = globalThis.Iterator.from([1]);`), ["Iterator: ES2025", "from: ES2025"]);
        assert.deepEqual(said(`export const groups = Object["groupBy"]([1], (n) => n);`), ["groupBy: ES2024"]);
        assert.deepEqual(said(`const { groupBy } = Object;\nexport const groups = groupBy([1], (n) => n);`), ["groupBy: ES2024"]);
        assert.deepEqual(said(`const { withResolvers: make } = Promise;\nexport const made = make.call(Promise);`), ["withResolvers: ES2024"]);
        assert.deepEqual(said(`export const handed = { Iterator };`), ["Iterator: ES2025"]);
        assert.deepEqual(said(`export const typed = typeof Iterator === "function";`), ["Iterator: ES2025"]);
        assert.deepEqual(said(`export const union = new Set([1])?.union(new Set([2]));`), ["union: ES2025"]);
        assert.deepEqual(said(`export const ctor = Float16Array;`), ["Float16Array: ES2025"]);
    });

    test("refuses a regular expression's newer syntax", () => {
        assert.deepEqual(said("export const sets = /[\\p{L}--[a-z]]/v;"), ["the `v` flag (ES2024)"]);
        assert.deepEqual(said(`export const sets = new RegExp("[a-z]", "gv");`), ["the \`v\` flag (ES2024)"]);
        assert.deepEqual(said("export const twice = /(?<year>\\d{4})-\\d\\d|\\d\\d-(?<year>\\d{4})/;"), ["the group name `year` used twice (ES2025)"]);
        assert.deepEqual(said("export const modified = /(?i:abc)def/;"), ["a modifier group (ES2025)"]);
    });

    test("leaves the built-ins of ES2023 and before, whatever names they share with newer ones", () => {
        assert.deepEqual(said(`
            export const doubled = [1, 2].map((n) => n * 2).filter((n) => n > 2).some((n) => n === 4);
            export const typed = new Float32Array(4).map((n) => n).toSorted();
            export const last = [1, 2].findLast((n) => n > 0) ?? [3].at(-1);
            export const own = Object.hasOwn({ a: 1 }, "a") && "a".replaceAll("a", "b").at(0) === "b";
            export const each = new Map([["a", 1]]); each.forEach((v, k) => void [v, k]);
            export const keys = [...new Map([["a", 1]]).keys()], values = Array.from(new Set([1]).values());
            for (const [k, v] of new Map([["a", 1]]).entries()) void [k, v];
            export const size = new Set([1]).has(1) ? new Set([1]).size : 0;
            export const date = new Intl.DateTimeFormat("en").format(new Date(0));
            export const parts = new Intl.DateTimeFormat("en").formatToParts(0), range = new Intl.DateTimeFormat("en").formatRange(0, 1);
            export const settled = Promise.allSettled([Promise.resolve(1)]), any = Promise.any([Promise.resolve(1)]);
            export const clone = structuredClone({ a: 1 }), weak = new WeakRef({});
            export const buffer = new ArrayBuffer(8).slice(0, 4);
        `), []);
        assert.deepEqual(said("export const behind = /(?<=a)b/, named = /(?<year>\\d{4})-(?<month>\\d\\d)/u, group = /(?:a|b)[(?i:]/d;"), []);
    });

    test("leaves this code's own methods of the same names", () => {
        assert.deepEqual(said(`
            class Sorted<K> {
                union(other: Sorted<K>): Sorted<K> { return other; }
                keys(): { map<U>(f: (k: K) => U): U[] } { return { map: () => [] }; }
                static groupBy<T>(items: T[]): Sorted<T> { void items; return new Sorted(); }
                static from<T>(items: T[]): Sorted<T> { void items; return new Sorted(); }
            }
            export const joined = new Sorted<number>().union(new Sorted<number>());
            export const mapped = new Sorted<number>().keys().map((k) => k + 1);
            export const grouped = Sorted.groupBy([1]), made = Sorted.from([1]);
            export const record = { transfer: 1, escape: () => 2, try: 3 }; void [record.transfer, record.escape(), record.try];
            export function take(n: number): number { return n; }
            export const taken = take(1);
        `), []);
    });

    test("leaves a type, and the members of a shape", () => {
        assert.deepEqual(said(`
            export type Helper = Iterator<number> | IteratorObject<string> | ReadonlySetLike<number> | PromiseWithResolvers<void>;
            export interface Holds { keys: MapIterator<string>; set: ReadonlySet<number>; when: Temporal.Instant | undefined }
            export const subset = (mine: number[], other: ReadonlySetLike<number>) => other.size >= mine.length && mine.every((k) => other.has(k)) && [...{ [Symbol.iterator]: () => other.keys() }].length >= 0;
            export function deferred<T>(): PromiseWithResolvers<T> {
                let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason?: unknown) => void;
                const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
                return { promise, resolve, reject };
            }
            export const waiting = deferred<number>().promise;
            export const cast = (x: unknown) => x as Iterator<number>;
        `), []);
    });

    test("leaves a built-in read through a property this code types as optional", () => {
        assert.deepEqual(said(`
            interface IteratorBuiltin { from<T>(source: Iterable<T>): Iterable<T> }
            export function builtinIterator<T>(source: Iterable<T>): Iterable<T> {
                const builtin = (globalThis as { Iterator?: IteratorBuiltin }).Iterator;
                return builtin === undefined ? source : builtin.from(source);
            }
            const groupBy = (Object as { groupBy?: <T>(items: T[], key: (item: T) => string) => Record<string, T[]> }).groupBy;
            export const grouped = groupBy === undefined ? {} : groupBy([1], (n) => String(n));
        `), []);
    });

    test("says where: each place is the name as written", () => {
        const text = `export const a = new Set([1]).union(new Set([2]));\nexport const b = Object.groupBy([1], (n) => n);`;
        const options: ts.CompilerOptions = { target: ts.ScriptTarget.ESNext, lib: ["lib.esnext.d.ts"], strict: true, noEmit: true, types: [] };
        const host = ts.createCompilerHost(options);
        const read = host.getSourceFile.bind(host);
        host.getSourceFile = (name, languageVersion, ...rest) => name === FILE ? ts.createSourceFile(name, text, languageVersion, true) : read(name, languageVersion, ...rest);
        const program = ts.createProgram({ rootNames: [FILE], options, host });
        const places = rule.newerBuiltins(program.getSourceFile(FILE)!, program);
        assert.deepEqual(places.map((place) => text.slice(place.start, place.end)), ["union", "groupBy"]);
    });
});
