/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The examples' package step (#849, #1375): `e3.package` keeps the last
 * definition it meets at a path or name, so the step refuses two, naming the
 * modules; and every compiled example module is found and carried.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { East, FloatType, IntegerType, variant } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { exampleModule, exampleModuleKeys, examplesPackage, examplesPackageZip, loadExampleModules } from "./examples-package.js";

describe("the examples' package step", () => {
    const count = (value: bigint) => e3.input("count", IntegerType, variant("value", value));
    const double = East.function([IntegerType], IntegerType, (_$, n) => n.multiply(2n));

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

    test("finds every compiled example module, and packages them all as one zip", async () => {
        const keys = exampleModuleKeys();
        assert.ok(keys.includes("calendar/calendar-records"), `the step found ${keys.length} modules, not the Calendar's records`);
        assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b)));
        const modules = await loadExampleModules();
        assert.deepEqual(modules.map((module) => module.pathKey), keys);
        const zip = await examplesPackageZip(modules);
        // A zip opens with its local file header's signature, PK\3\4.
        assert.deepEqual([...zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    });
});
