/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The examples' programs stay small. An example is a program a page builds,
 * compiles and runs, and a library that writes a function out again at each
 * use, rather than holding it once, grows every program using it: a Sheet's
 * bridge written into each of its rules made the workshop 73,000 IR nodes, a
 * Plan's editing session read a field at a time made the nested Plan 75,000,
 * and a Schedule kind's reads written into each of its parts made the print
 * works' Plan 37,700. A value written out a node at a time grows them too: the
 * DecisionQueue's session writing its cases' type out twice made its examples
 * 45,100. The largest example is the queue over every kind of target, now
 * 26,800; that Plan is 25,500.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { walkIR } from "@elaraai/east";
import { loadExampleModules } from "./examples-package.js";

/** The most IR nodes an example's program may hold. */
const MOST_NODES = 30_000;

describe("the examples' programs", () => {
    test("hold under 30,000 IR nodes each: a library holds each function once, never writing it out again at each use", async () => {
        const large: string[] = [];
        for (const module of await loadExampleModules()) {
            for (const [name, example] of module.examples) {
                let nodes = 0;
                walkIR(example.fn.toIR().ir, () => { nodes += 1; });
                if (nodes >= MOST_NODES) large.push(`${module.pathKey} ${name}: ${nodes} IR nodes`);
            }
        }
        assert.deepEqual(large, []);
    });
});
