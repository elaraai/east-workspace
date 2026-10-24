/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The examples' package step (#849, #1375): `e3.package` keeps the last
 * definition it meets at a path or name, so the step refuses two, naming the
 * modules; every compiled example module is found and carried; and each area
 * — the modules under one directory — is packaged with what its examples bind
 * from another area and nothing else of it (#1397), an example binding what no
 * module declares refused, naming it.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DictType, East, FloatType, IntegerType, StringType, example, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { pathToString } from "@elaraai/e3-types";
import { Data, Func } from "@elaraai/e3-ui";
import {
    exampleArea, exampleModule, exampleModuleKeys, examplesAreaPackages, examplesPackage, examplesPackageZip, loadExampleModules,
} from "./examples-package.js";

describe("the examples' package step", () => {
    const count = (value: bigint) => e3.input("count", IntegerType, variant("value", value));
    const double = East.function([IntegerType], IntegerType, (_$, n) => n.multiply(2n));

    /** The paths of a package's datasets, as e3 prints them. */
    const datasetsOf = (pkg: ReturnType<typeof examplesPackage>) =>
        pkg.contents.flatMap((item) => (item.kind === "dataset" ? [pathToString(item.path)] : [])).sort();

    test("takes a definition two modules both export once", () => {
        const shared = count(1n);
        const pkg = examplesPackage([
            exampleModule("one/first", { countInput: shared }),
            exampleModule("two/second", { countInput: shared }),
        ]);
        assert.equal(pkg.contents.filter((item) => item.kind === "dataset").length, 1);
    });

    test("refuses two modules declaring different datasets at one path", () => {
        assert.throws(
            () => examplesPackage([
                exampleModule("one/first", { countInput: count(1n) }),
                exampleModule("two/second", { otherCount: count(2n) }),
            ]),
            /one\/first \(countInput\) and two\/second \(otherCount\) both declare the path '\.inputs\.count'/,
        );
    });

    test("refuses a dataset another module's task reads at the same path", () => {
        const doubled = e3.task("doubled", [count(1n)], double);
        assert.throws(
            () => examplesPackage([
                exampleModule("one/first", { doubledTask: doubled }),
                exampleModule("two/second", { countInput: count(2n) }),
            ]),
            /one\/first \(through doubledTask\) and two\/second \(countInput\) both declare the path '\.inputs\.count'/,
        );
    });

    test("refuses two modules declaring different functions of one name", () => {
        const half = East.function([FloatType], FloatType, (_$, x) => x.divide(2.0));
        // Two definitions, one name: each module makes its own.
        const halveNamed = (name: string) => e3.function(name, half);
        assert.throws(
            () => examplesPackage([
                exampleModule("one/first", { halveFn: halveNamed("halve") }),
                exampleModule("two/second", { halfFn: halveNamed("halve") }),
            ]),
            /one\/first \(halveFn\) and two\/second \(halfFn\) both declare the function 'halve'/,
        );
    });

    test("takes a module's e3 definitions and nothing else it exports", () => {
        const input = count(3n);
        const module = exampleModule("one/first", { countInput: input, double, label: "not a definition" });
        assert.deepEqual(module.definitions.map(([name]) => name), ["countInput"]);
    });

    test("takes a module's examples beside its definitions", () => {
        const input = count(3n);
        const readsCount = example({
            keywords: ["test"],
            description: "binds the count",
            fn: East.function([], IntegerType, ($) => {
                const value = $.let(Data.bind(input));
                return value.read();
            }),
            inputs: [],
            returns: 3n,
        });
        const module = exampleModule("one/first", { countInput: input, readsCount, double });
        assert.deepEqual(module.examples.map(([name]) => name), ["readsCount"]);
    });

    test("names a module's area by the directory it is under", () => {
        assert.equal(exampleArea("plan/plan-records"), "plan");
        assert.equal(exampleArea("bind/data/data"), "bind");
    });

    test("packages each area with its modules' definitions and what its examples bind of another area's, and nothing else of it", () => {
        const input = count(1n);
        const unread = e3.input("unread", FloatType, variant("value", 1.0));
        const rows = e3.record("rows", DictType(StringType, IntegerType), new Map());
        const patch = e3.mutation.patch(rows);
        const halve = e3.function("halve", East.function([FloatType], FloatType, (_$, x) => x.divide(2.0)));
        // Reads the count and the rows, and calls halve.
        const readsSource = example({
            keywords: ["test"],
            description: "binds another area's count, rows and function",
            fn: East.function([], IntegerType, ($) => {
                $.let(Data.bind(rows));
                $.let(Func.bind(halve));
                const value = $.let(Data.bind(input));
                return value.read();
            }),
            inputs: [],
            returns: 1n,
        });
        const packages = examplesAreaPackages([
            // The source area declares everything; its patch on the record is declared beside it.
            exampleModule("source/declares", { countInput: input, unreadInput: unread, rowsRecord: rows, rowsPatch: patch, halveFn: halve }),
            // The reading area declares nothing.
            exampleModule("reader/reads", { readsSource }),
        ]);
        assert.deepEqual([...packages.keys()], ["source", "reader"]);
        const source = packages.get("source")!;
        const reader = packages.get("reader")!;
        assert.equal(source.name, "e3-ui-examples-source");
        assert.equal(reader.name, "e3-ui-examples-reader");
        assert.deepEqual(datasetsOf(source), [".inputs.count", ".inputs.unread", ".records.rows"]);
        // What its example binds, the record with the patch declared on it, and nothing it does not.
        assert.deepEqual(datasetsOf(reader), [".inputs.count", ".records.rows"]);
        assert.deepEqual(Object.keys(reader.records.rows!.mutations), Object.keys(source.records.rows!.mutations));
        assert.equal(Object.keys(reader.records.rows!.mutations).length, 1);
        assert.deepEqual(Object.keys(reader.functions), ["halve"]);
    });

    test("an area's package carries the task that writes a dataset its example binds, and what the task reads", () => {
        const input = count(4n);
        const twice = e3.task("twice", [input], double);
        const readsTwice = example({
            keywords: ["test"],
            description: "binds another area's task's output",
            fn: East.function([], IntegerType, ($) => {
                const value = $.let(Data.bind(twice.output));
                return value.read();
            }),
            inputs: [],
            returns: 8n,
        });
        const packages = examplesAreaPackages([
            exampleModule("source/declares", { twiceTask: twice }),
            exampleModule("reader/reads", { readsTwice }),
        ]);
        const reader = packages.get("reader")!;
        assert.deepEqual(reader.contents.flatMap((item) => (item.kind === "task" ? [item.name] : [])), ["twice"]);
        assert.deepEqual(datasetsOf(reader), [".inputs.count", ".tasks.twice.output"]);
    });

    test("refuses an example binding a dataset no module declares, naming the example and the dataset", () => {
        const missing = e3.input("missing", IntegerType, variant("value", 0n));
        const readsMissing = example({
            keywords: ["test"],
            description: "binds what no module declares",
            fn: East.function([], IntegerType, ($) => {
                const value = $.let(Data.bind(missing));
                return value.read();
            }),
            inputs: [],
            returns: 0n,
        });
        assert.throws(
            () => examplesAreaPackages([
                exampleModule("source/declares", { countInput: count(1n) }),
                exampleModule("reader/reads", { readsMissing }),
            ]),
            /reader\/reads \(readsMissing\) binds \.inputs\.missing, which no example module declares/,
        );
    });

    test("refuses an example calling a function no module declares, naming the example and the function", () => {
        const unknown = e3.function("unknown", double);
        const callsUnknown = example({
            keywords: ["test"],
            description: "calls what no module declares",
            fn: East.function([], IntegerType, ($) => {
                $.let(Func.bind(unknown));
                return 0n;
            }),
            inputs: [],
            returns: 0n,
        });
        assert.throws(
            () => examplesAreaPackages([
                exampleModule("source/declares", { countInput: count(1n) }),
                exampleModule("reader/reads", { callsUnknown }),
            ]),
            /reader\/reads \(callsUnknown\) binds the function 'unknown', which no example module declares/,
        );
    });

    test("finds every compiled example module, and packages them all as one zip and each area as its own", async () => {
        const keys = exampleModuleKeys();
        assert.ok(keys.includes("calendar/calendar-records"), `the step found ${keys.length} modules, not the Calendar's records`);
        assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b)));
        const modules = await loadExampleModules();
        assert.deepEqual(modules.map((module) => module.pathKey), keys);
        const zip = await examplesPackageZip(modules);
        // A zip opens with its local file header's signature, PK\3\4.
        assert.deepEqual([...zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
        const packages = examplesAreaPackages(modules);
        assert.deepEqual([...packages.keys()], [...new Set(keys.map(exampleArea))]);
    });
});
