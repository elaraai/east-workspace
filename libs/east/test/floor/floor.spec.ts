/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The engine `make test-floor` runs East's suite on (`es2023.ts`): that it accounts for every built-in TypeScript's
 * library declares as newer than ES2023, and that on it they are gone.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, test } from "node:test";
import ts from "typescript";
import { FLOOR, goesWhole, LEFT, NEWER_GLOBALS, NEWER_MEMBERS } from "./es2023.js";

/** A file of TypeScript's library that declares an edition newer than ES2023: the lint rule's own pattern. */
const NEWER_LIB = /^lib\.(es20(?:2[4-9]|[3-9]\d)|esnext)\.[a-z0-9.]+\.d\.ts$/;

/** What the engine took away as this process started: there only under `make test-floor`. */
const TAKEN = (globalThis as { EAST_FLOOR?: readonly string[] }).EAST_FLOOR;

interface Declared { file: string; interfaces: Map<string, string[]>; values: string[] }

/** What a library file declares: each interface with its members' names, and each value. */
function declared(file: string, text: string): Declared {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const out: Declared = { file, interfaces: new Map(), values: [] };
    const walk = (node: ts.Node, scope: string): void => {
        if (ts.isInterfaceDeclaration(node)) {
            const names = node.members.flatMap((m) => m.name !== undefined && (ts.isIdentifier(m.name) || ts.isStringLiteralLike(m.name)) ? [m.name.text] : []);
            const name = scope + node.name.text;
            out.interfaces.set(name, [...(out.interfaces.get(name) ?? []), ...names]);
        } else if (ts.isVariableStatement(node)) {
            for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) out.values.push(scope + d.name.text);
        } else if (ts.isModuleDeclaration(node) && node.body !== undefined && ts.isModuleBlock(node.body)) {
            // `declare global` adds to the global scope; a namespace (`Intl`, `Temporal`) qualifies what it holds.
            const inner = node.name.text === "global" ? scope : `${scope}${node.name.text}.`;
            for (const statement of node.body.statements) walk(statement, inner);
        }
    };
    for (const statement of source.statements) walk(statement, "");
    return out;
}

/** Every newer file of the TypeScript library East is built with. */
function library(): Declared[] {
    const lib = path.dirname(createRequire(import.meta.url).resolve("typescript"));
    // The package East builds with keeps its library files beside its own compiler, or beside the one it wraps.
    const dirs = [lib, ...[ts.getDefaultLibFilePath({})].map((file) => path.dirname(file))];
    for (const dir of dirs) {
        const files = readdirSync(dir).filter((file) => NEWER_LIB.test(file));
        if (files.length > 0) return files.map((file) => declared(file, readFileSync(path.join(dir, file), "utf8")));
    }
    throw new Error(`no library file newer than ES2023 beside ${dirs.join(" or ")}`);
}

describe("the engine East's suite is run on without the newer built-ins", () => {
    const files = library();

    test("accounts for every interface TypeScript's library declares as newer than ES2023", () => {
        const members = new Map<string, Set<string>>();
        for (const { declares, names } of NEWER_MEMBERS) members.set(declares, new Set([...(members.get(declares) ?? []), ...names]));
        const missing: string[] = [];
        for (const { file, interfaces } of files) {
            for (const [name, names] of interfaces) {
                if (goesWhole(name) || name in LEFT) continue;
                const taken = members.get(name);
                if (taken === undefined) { missing.push(`${name} (${file})`); continue; }
                for (const member of names) if (!taken.has(member)) missing.push(`${name}.${member} (${file})`);
            }
        }
        assert.deepEqual(missing, [], "each is taken away in es2023.ts' NEWER_MEMBERS, or named in LEFT with why it is left");
    });

    test("accounts for every value TypeScript's library declares as newer than ES2023", () => {
        const missing = files.flatMap(({ file, values }) => values.filter((name) => !NEWER_GLOBALS.includes(name) && !goesWhole(name)).map((name) => `${name} (${file})`));
        assert.deepEqual(missing, [], "each is among es2023.ts' NEWER_GLOBALS");
    });

    test("names nothing TypeScript's library does not declare as newer", () => {
        const stale: string[] = [];
        for (const { declares, names } of NEWER_MEMBERS) {
            const all = new Set(files.flatMap(({ interfaces }) => interfaces.get(declares) ?? []));
            for (const name of names) if (!all.has(name)) stale.push(`${declares}.${name}`);
        }
        const values = new Set(files.flatMap((file) => file.values));
        const interfaces = new Set(files.flatMap((file) => [...file.interfaces.keys()]));
        for (const name of NEWER_GLOBALS) if (!values.has(name) && ![...interfaces].some((i) => i.startsWith(`${name}.`))) stale.push(name);
        for (const name of Object.keys(LEFT)) if (!interfaces.has(name)) stale.push(`LEFT.${name}`);
        assert.deepEqual(stale, [], "a built-in the library has moved to an edition this floor includes, or dropped, is listed no more");
    });

    test("this engine has them, or the floor has taken them away", () => {
        // What this engine still has of the floor's list: a copy of each owner is asked, so nothing here is taken away.
        const iterators = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as object;
        const at = (path: string): unknown => path === "%IteratorPrototype%" ? iterators
            : path.split(".").reduce<unknown>((owner, part) => owner === undefined || owner === null ? undefined : (owner as Record<string, unknown>)[part], globalThis);
        const here = (owner: unknown, name: string): boolean => owner !== undefined && owner !== null && Object.prototype.hasOwnProperty.call(owner, name);
        const present = [
            ...FLOOR.members.flatMap(({ declares, owner, names }) => names.filter((name) => here(at(owner), name)).map((name) => `${declares}.${name}`)),
            ...FLOOR.globals.filter((path) => path.includes(".") ? here(at(path.slice(0, path.lastIndexOf("."))), path.slice(path.lastIndexOf(".") + 1)) : here(globalThis, path)),
        ];
        if (TAKEN === undefined) {
            // An ordinary run: Node has the ones East's code once named, so taking them away is a test of something.
            for (const name of ["Iterator", "Set.union", "IteratorObject.map", "ObjectConstructor.groupBy"]) assert.ok(present.includes(name), `${name} is in this engine`);
            return;
        }
        assert.deepEqual(present, [], "on the floor's engine none is left");
        for (const name of ["Iterator", "Set.union", "IteratorObject.map", "ObjectConstructor.groupBy"]) assert.ok(TAKEN.includes(name), `${name} was taken away`);
        assert.equal((globalThis as { Iterator?: unknown }).Iterator, undefined);
        assert.equal((new Map().keys() as { map?: unknown }).map, undefined);
        assert.equal((new Set() as { union?: unknown }).union, undefined);
    });
});
