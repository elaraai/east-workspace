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
 *
 * And what holds of every example module, in this one file because loading them
 * all takes a process about a minute and a half:
 *
 * - The examples' records make no large state as their modules load: a page of
 *   the showcase imports every example module, and a record whose state a
 *   generator builds at import builds all of its rows there, on every page. A
 *   record whose state is large declares its initial value as a function that
 *   makes it, which e3 calls as the package is exported.
 * - The examples' programs stay small. An example is a program a page builds,
 *   compiles and runs, and a library that writes a function out again at each
 *   use, rather than holding it once, grows every program using it: a Sheet's
 *   bridge written into each of its rules made the workshop 73,000 IR nodes, a
 *   Plan's editing session read a field at a time made the nested Plan 75,000,
 *   and a Schedule kind's reads written into each of its parts made the print
 *   works' Plan 37,700. The largest example is that Plan, now 26,000.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DictType, East, FloatType, IntegerType, StringType, encodeBeast2For, example, variant, walkIR } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { pathToString } from "@elaraai/e3-types";
import { Data, Func } from "@elaraai/e3-ui";
import {
    exampleArea, exampleModule, exampleModuleKeys, examplesAreaPackages, examplesPackage, examplesPackageZip, loadExampleModules,
} from "./examples-package.js";

/** The most a record's initial state may take as its module loads, in beast2 bytes. */
const AT_IMPORT_BYTES = 256 * 1024;

/** The most IR nodes an example's program may hold. */
const MOST_NODES = 30_000;

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
        const rows = e3.record("rows", DictType(StringType, IntegerType), {
            initial: new Map(),
            mutations: (mutation) => ({
                patch: mutation.patch(),
            }),
        });
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
            // The source area declares everything, the record with its patch.
            exampleModule("source/declares", { countInput: input, unreadInput: unread, rowsRecord: rows, halveFn: halve }),
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

    test("packages the nested series example's works in the Plan's area, and none of the records the Plan's tests read besides (#1439)", async () => {
        const packages = examplesAreaPackages(await loadExampleModules());
        assert.equal(packages.get("plan-nested"), undefined, "the nested series example is the Plan's, on its page");
        const plan = packages.get("plan");
        assert.ok(plan !== undefined);
        assert.equal(plan.name, "e3-ui-examples-plan");
        assert.deepEqual(Object.keys(plan.records.plan_works!.indexes).sort(),
            ["plan_works_by_name", "plan_works_by_site_status", "plan_works_in_time", "plan_works_in_time_span"]);
        assert.deepEqual(Object.keys(plan.records).filter((name) => ["assemblies", "halls", "ledgers", "machines", "machines_few"].includes(name)), [],
            "the fixtures are no example's");
    });
});
