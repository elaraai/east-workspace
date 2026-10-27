/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The dev server resolves the UI packages from their source (`vite.config.ts`'s `dev` aliases), and a package it
 * resolves so must resolve to source every subpath of it that what the page serves imports: one left to the package's
 * `exports` loads a second copy of the package from its `dist/`, and East's reference-based identities split between
 * the two — a record Slice bound in one copy's registry and looked up in the other's, so the Sheet's lens finds no
 * binding and draws no rows (#1443), `Data.bind` matching no implementation, a `Fields` hint failing `fieldSpecs`'
 * check. The production build resolves every specifier through the `exports` alike, so the responsive suite, which
 * runs over it, never sees a split.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { loadConfigFromFile, type Alias } from "vite";

const showcase = fileURLToPath(new URL("../..", import.meta.url));
const packages = resolve(showcase, "..");

/** The packages the dev server may resolve to source, by name: each one's directory beside the showcase. */
const SOURCE_PACKAGES = new Map([
    ["@elaraai/east-ui", "east-ui"],
    ["@elaraai/east-ui-components", "east-ui-components"],
    ["@elaraai/e3-ui", "e3-ui"],
    ["@elaraai/e3-ui-components", "e3-ui-components"],
]);

/** A specifier of one of those packages: bare, or a subpath. */
const SPECIFIER = /^@elaraai\/(?:east-ui-components|e3-ui-components|east-ui|e3-ui)(?:\/.+)?$/;
/** A JSX pragma naming one of them: the dev server compiles its JSX to the package's dev runtime. */
const PRAGMA = /@jsxImportSource\s+(@elaraai\/(?:east-ui|e3-ui))\b/g;

/** A test, a test's helper or a declaration: no page imports them. */
const NOT_SERVED = /(\.test|\.spec|\.test-utils)\.tsx?$|\.d\.ts$/;

/** Every TypeScript file under a directory, recursively. */
function sources(dir: string): string[] {
    return readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter(file => /\.tsx?$/.test(file) && !file.split(/[\\/]/).includes("node_modules"))
        .map(file => join(dir, file));
}

/**
 * What the dev page can load: the showcase's own modules (its root's and `components/` — never its `scripts/`, which
 * the dev server runs in node, its `tests/` or a config), the four packages' source, and the example modules it shows
 * (the e3-ui and east-ui `test/` trees' `*.examples.ts(x)`) — never a test or a test's helper.
 */
function served(): string[] {
    const root = readdirSync(showcase).filter(file => /\.tsx?$/.test(file) && !/\.config\.ts$/.test(file)).map(file => join(showcase, file));
    const own = [...root, ...sources(join(showcase, "components")), ...[...SOURCE_PACKAGES.values()].flatMap(dir => sources(join(packages, dir, "src")))];
    const examples = ["east-ui", "e3-ui"].flatMap(dir => sources(join(packages, dir, "test"))).filter(file => /\.examples\.tsx?$/.test(file));
    return [...own, ...examples].filter(file => !NOT_SERVED.test(file));
}

/**
 * Each specifier of the four packages the served files import — read as TypeScript reads a file's imports, exports
 * and dynamic imports, never from a comment's example — with a file that imports it.
 */
function imported(): Map<string, string> {
    const found = new Map<string, string>();
    const add = (specifier: string, file: string) => { if (SPECIFIER.test(specifier) && !found.has(specifier)) found.set(specifier, file); };
    for (const file of served()) {
        const text = readFileSync(file, "utf8");
        for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) add(fileName, file);
        for (const [, pkg] of text.matchAll(PRAGMA)) add(`${pkg}/jsx-dev-runtime`, file);
    }
    return found;
}

/** The dev server's aliases, as Vite loads the config. */
async function devAliases(): Promise<Alias[]> {
    const loaded = await loadConfigFromFile({ command: "serve", mode: "development" }, join(showcase, "vite.config.ts"), showcase, "silent");
    const alias = loaded?.config.resolve?.alias;
    assert.ok(Array.isArray(alias), "the config's aliases are a list");
    return alias as Alias[];
}

/** Where an alias sends a specifier, or `undefined` when it does not match it — as Vite matches an alias. */
function aliased(alias: Alias, id: string): string | undefined {
    if (typeof alias.find === "string") return id === alias.find || id.startsWith(`${alias.find}/`) ? alias.replacement + id.slice(alias.find.length) : undefined;
    return alias.find.test(id) ? id.replace(alias.find, alias.replacement) : undefined;
}

test("the dev server resolves to source every subpath the page imports of a package it resolves to source, so no package loads twice (#1443)", async () => {
    const aliases = await devAliases();
    const target = (id: string) => aliases.map(alias => aliased(alias, id)).find(to => to !== undefined);
    const found = imported();
    // What the check stands on: the renderers reach the shared parts through `/internal`, the examples the IR bare.
    assert.ok(found.has("@elaraai/east-ui-components/internal"), "e3-ui-components imports east-ui-components' /internal");
    assert.ok(found.has("@elaraai/east-ui"), "the examples import the IR");
    const split: string[] = [];
    for (const [id, file] of found) {
        const pkg = [...SOURCE_PACKAGES.keys()].sort((a, b) => b.length - a.length).find(name => id === name || id.startsWith(`${name}/`))!;
        // A package the dev server leaves to its `exports` loads once, from `dist/`, whatever the subpath.
        if (target(pkg) === undefined) continue;
        const to = target(id);
        const src = join(packages, SOURCE_PACKAGES.get(pkg)!, "src");
        if (to === undefined || !existsSync(to) || relative(src, to).startsWith("..")) {
            split.push(`${id} (imported by ${relative(packages, file)}) → ${to === undefined ? "its dist/, through the package's exports" : to}`);
        }
    }
    assert.deepEqual(split, [], "a subpath that reaches dist/ while its package's bare specifier reaches src/ loads the package twice");
});
