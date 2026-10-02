/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * east-node-std's compliance suite, over east-web-std.
 *
 * `make -C libs/east-node test-export-std` writes east-node-std's East test
 * suites as IR, one JSON file per suite, to `EAST_NODE_STD_IR` (this
 * checkout's `tmp/east-node-std`): the corpus east-c-std and east-py-std run. This runs the suites of the modules
 * east-web-std provides, each over its own `createWebPlatform()`, with every
 * East test a `node:test` test. It runs in Node, whose web-standard globals
 * are the ones east-web-std uses; the same suites' Chromium leg comes with
 * e3-web's browser pass.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ArrayType, AsyncEastIR, IntegerType, IRType, SourceMap, StringType, StructType, decodeJSONFor } from "@elaraai/east";
import { createWebPlatform, type TestHost } from "./index.js";

/** Where the export is: `EAST_NODE_STD_IR`, which the root `paths.mk` sets to
 *  this checkout's `tmp/east-node-std` when this runs through make. */
const IR_DIR = process.env.EAST_NODE_STD_IR;

/** The modules east-web-std provides: each one's suite runs here. */
const PROVIDED = ["Console", "Crypto", "Fetch", "Path", "Random", "Time"];

/** The modules a browser has no meaning for, which east-web-std leaves out. */
const NOT_PROVIDED = ["Env", "FileSystem", "Json"];

/** The file east-node-std's `describeEast` writes a module's suite to. */
const suiteFile = (module: string): string => `${module}_platform_functions.json`;

// The wrapper east-node-std's `describeEast` exports a suite in: the suite's
// IR, and the stacks its location ids name
const LocationType = StructType({ column: IntegerType, filename: StringType, line: IntegerType });
const SourceMapType = StructType({ stacks: ArrayType(ArrayType(LocationType)) });
const ExportWrapperType = StructType({ ir: IRType, source_map: SourceMapType });
const decodeSuite = decodeJSONFor(ExportWrapperType);

/** Runs East's suites and tests as `node:test`'s, as east-node-std's TestImpl does. */
const nodeTestHost: TestHost = {
    describe: (name, body) => describe(name, body),
    test: (name, body) => test(name, body),
};

/** A suite's program in the export at `dir`, with the source map its
 *  location ids resolve against. */
function loadSuite(dir: string, file: string): AsyncEastIR<[], null> {
    const { ir, source_map } = decodeSuite(readFileSync(join(dir, file)));
    if (ir.type !== "AsyncFunction") {
        throw new Error(`${file} holds a ${ir.type}, not the async function a suite is`);
    }
    const program = new AsyncEastIR<[], null>(ir);
    // Interning the stacks in their order gives each the id it was exported
    // under: the export is a source map's entries, which are distinct and
    // start with the empty stack at id 0
    const map = new SourceMap();
    for (const stack of source_map.stacks.slice(1)) {
        map.intern_stack(stack);
    }
    if (map.size !== BigInt(source_map.stacks.length)) {
        throw new Error(`${file}: its source map did not rebuild id for id`);
    }
    program.source_map = map;
    return program;
}

if (IR_DIR === undefined) {
    test("east-node-std's compliance suite is exported", () => {
        assert.fail("EAST_NODE_STD_IR is unset: run it through make (`make -C libs/east-web test-compliance`)");
    });
} else if (!existsSync(IR_DIR)) {
    test("east-node-std's compliance suite is exported", () => {
        assert.fail(`nothing at ${IR_DIR}: export it with \`make -C libs/east-node test-export-std\``);
    });
} else {
    test("every suite in the export is one east-web-std runs or leaves out", () => {
        const exported = readdirSync(IR_DIR).filter(file => file.endsWith(".json")).sort();
        assert.deepEqual(exported, [...PROVIDED, ...NOT_PROVIDED].map(suiteFile).sort());
    });

    for (const module of PROVIDED) {
        const file = suiteFile(module);
        if (!existsSync(join(IR_DIR, file))) {
            test(`${module}'s suite is exported`, () => {
                assert.fail(`${file} is not in ${IR_DIR}`);
            });
            continue;
        }
        await loadSuite(IR_DIR, file).compile(createWebPlatform({ test: nodeTestHost }))();
    }
}
