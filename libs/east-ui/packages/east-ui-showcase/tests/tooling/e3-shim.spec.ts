/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The page resolves `@elaraai/e3` to a browser-safe slice of it
 * (`e3-ui-components/snapshot/e3-shim.ts`, `vite.config.ts`'s alias): the
 * members an example module calls as it is imported — `e3.record(...)`,
 * `e3.function(...)`, `e3.index(...)`. A named import the slice lacks fails
 * the build, which says so; a member read off the default `e3` object the
 * slice lacks does not — it compiles to a call of `undefined`, and the whole
 * showcase fails to load in the browser (`e3.index`, east-workspace#1622). So
 * every member an example calls on `e3` is held here to be a function of the
 * slice's default export.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const showcase = fileURLToPath(new URL("../..", import.meta.url));
const examples = resolve(showcase, "..", "e3-ui", "test");
/**
 * The slice, by its file: loaded as the test runs, never imported by name — it is e3's own source, which this
 * package's type-check, stricter than e3's, is none of.
 */
const SHIM = pathToFileURL(resolve(showcase, "..", "e3-ui-components", "snapshot", "e3-shim.ts")).href;

/** A member called on the default `e3` object: `e3.record(`. */
const CALL = /\be3\.([A-Za-z_]\w*)\s*\(/g;

/** Each member the e3-ui example modules call on `e3`, with the first module that calls it. */
function called(): Map<string, string> {
    const members = new Map<string, string>();
    const files = readdirSync(examples, { recursive: true, encoding: "utf8" }).filter((file) => /\.examples\.tsx?$/.test(file));
    for (const file of files) {
        const path = join(examples, file);
        for (const [, member] of readFileSync(path, "utf8").matchAll(CALL)) {
            if (!members.has(member!)) members.set(member!, relative(examples, path));
        }
    }
    return members;
}

test("every member an e3-ui example calls on `e3` is a function of the browser's slice of it", async () => {
    const members = called();
    // The examples declare records, inputs, tasks and functions, and take indexes as inputs: the search finds them.
    assert.ok(members.size >= 4, `the example modules call ${members.size} members of e3: the search finds none of what they declare`);
    const slice = ((await import(SHIM)) as { default: Readonly<Record<string, unknown>> }).default;
    const missing = [...members].filter(([member]) => typeof slice[member] !== "function")
        .map(([member, file]) => `e3.${member} (${file})`);
    assert.deepEqual(missing, [], `the browser's slice of @elaraai/e3 lacks ${missing.join(", ")}: add it to e3-ui-components/snapshot/e3-shim.ts`);
});
