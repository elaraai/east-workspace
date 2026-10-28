/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DictType, East, StringType, decodeBeast2For, encodeBeast2For, equalFor, match, type EastIR } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { deriveManifest } from "@elaraai/e3-ui/internal";
import { indexedWorkOrders } from "../sheet/sheet-records.examples.js";
import * as ex from "./plan-records.examples.js";

for (const example of [ex.planRecordIndexes, ex.planRecordIndexesMobile]) {
    test(example.description, () => {
        const manifest = deriveManifest(example.fn);
        // The work orders and their operations are each read a page, a search or a cell at a time, never whole.
        assert.deepEqual(manifest.pages, [indexedWorkOrders.path, ex.planOperations.path]);
        assert.equal(manifest.paths.length, 0, "the Plan never reads either record whole");
        // The operations are the record the Plan writes, through their patch door; the work orders it only reads.
        assert.deepEqual(manifest.records, [ex.planOperations.name]);
        const component = (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
        assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component)).type, component.type);
    });
}

test(ex.planDenseIndexes.description, () => {
    const manifest = deriveManifest(ex.planDenseIndexes.fn);
    // The works are read a page, a search or a cell at a time, never whole, and written through their patch door.
    assert.deepEqual(manifest.pages, [ex.planDenseWorks.path]);
    assert.equal(manifest.paths.length, 0, "the Plan never reads the works whole");
    assert.deepEqual(manifest.records, [ex.planDenseWorks.name]);
    const component = (ex.planDenseIndexes.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
    assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component)).type, component.type);
});

test("the dense works over two years: a job a week, an alarm every four weeks, weekly load, two crews' weekly hours and a tree of three parts, each a job every eight weeks", () => {
    const works = East.compile(ex.generateDenseWorksAll, [])(2n, 104n);
    assert.deepEqual([...works.keys()], ["W-10001", "W-10002"]);
    for (const one of works.values()) {
        assert.deepEqual([one.jobs.size, one.alarms.size, one.load.size, one.crews.size], [104, 26, 104, 2]);
        for (const crew of one.crews.values()) assert.equal(crew.hours.size, 104);
        const [top] = [...one.parts.values()];
        assert.equal(top!.jobs.size, 13);
        assert.deepEqual([...top!.parts.values()].map((part) => part.jobs.size), [13, 13]);
    }
    // A works is a function of its number alone: the hundred the record holds are the ten thousand's first hundred.
    const few = East.compile(ex.generateDenseWorksAll, [])(3n, 104n);
    assert.ok(equalFor(DictType(StringType, ex.PlanDenseWorks))(new Map([...works]) as never, new Map([...few].slice(0, 2)) as never));
    assert.equal(ex.planDenseWorks.default === undefined ? 0 : (ex.planDenseWorks.default as ReadonlyMap<string, unknown>).size, 100);
});

test("the dense works' task, at its inputs' defaults, makes the works the record starts with: a page runs every task of its area as the area starts", () => {
    const start = (input: typeof ex.planDenseRows | typeof ex.planDenseWeeks) => match(input.source!, { value: (value) => value, file: () => assert.fail(`${input.name} starts from a file`) });
    const works = ex.planDenseWorks.default!;
    assert.equal(start(ex.planDenseRows), BigInt(works.size), "the task makes no more works than the record holds");
    assert.ok(equalFor(DictType(StringType, ex.PlanDenseWorks))(East.compile(ex.generateDenseWorksAll, [])(start(ex.planDenseRows), start(ex.planDenseWeeks)), works));
});
