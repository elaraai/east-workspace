/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The examples' records make no large state as their modules load: a page of
 * the showcase imports every example module, and a record whose state a
 * generator builds at import builds all of its rows there, on every page. A
 * record whose state is large declares its initial value as a function that
 * makes it, which e3 calls as the package is exported.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { encodeBeast2For } from "@elaraai/east";
import { loadExampleModules } from "./examples-package.js";

/** The most a record's initial state may take as its module loads, in beast2 bytes. */
const AT_IMPORT_BYTES = 256 * 1024;

describe("the examples' records", () => {
    test("make no state larger than 256 KiB as their modules load: a larger one is declared `initial: () => …`", async () => {
        const made: string[] = [];
        for (const module of await loadExampleModules()) {
            for (const [name, definition] of module.definitions) {
                if (definition.kind !== "dataset" || (definition as { recordKind?: string }).recordKind !== "record") continue;
                // None, or made by its function as the package is exported: nothing made at import.
                const initial = Object.getOwnPropertyDescriptor(definition, "default");
                if (initial === undefined || initial.get !== undefined) continue;
                const bytes = encodeBeast2For(definition.type)(initial.value as never).length;
                if (bytes > AT_IMPORT_BYTES) made.push(`${module.pathKey} ${name}: ${bytes} bytes`);
            }
        }
        assert.deepEqual(made, []);
    });
});
