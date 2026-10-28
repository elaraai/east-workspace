/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The nested series records (#1438, #1439), as their seeds make them: the
 * sizes each is declared at, a row a function of its number alone, a parent
 * measure holding nothing of its own, and enough jobs in a year's view that a
 * Plan shades it from the totals. And the Plans over them (#1439): each builds,
 * reads its rows a page, a search or a cell at a time — never whole, but the
 * twelve machines it reads whole on purpose — and writes through the record's
 * patch door where it edits. What they draw and read, on e3, is
 * e3-ui-components' (`plan/frame/plan-nested.dom.test.tsx`, `plan-typing`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DictType, East, StringType, decodeBeast2For, encodeBeast2For, equalFor, match, type EastIR, type ValueTypeOf } from "@elaraai/east";
import { UIComponentType } from "@elaraai/east-ui";
import { deriveManifest } from "@elaraai/e3-ui/internal";
import * as ex from "./plan-nested.examples.js";

type Part = ValueTypeOf<typeof ex.Part>;
type Measure = ValueTypeOf<typeof ex.Measure>;

/** Every node of a tree of parts, and of measures, the roots first. */
function partsOf(parts: ReadonlyMap<string, Part>): Part[] {
    return [...parts.values()].flatMap((part) => [part, ...partsOf(part.parts)]);
}
function measuresOf(measures: ReadonlyMap<string, Measure>): Measure[] {
    return [...measures.values()].flatMap((measure) => [measure, ...measuresOf(measure.children)]);
}

describe("the nested series records", () => {
    test("the works over ten years, sparse and spread evenly: 104 jobs, 40 alarms, load every four weeks, two crews' quarterly hours and three parts each", () => {
        const works = East.compile(ex.generateWorksAll, [])(2n, 522n);
        assert.deepEqual([...works.keys()], ["W-10001", "W-10002"]);
        for (const one of works.values()) {
            assert.deepEqual([one.jobs.size, one.alarms.size, one.load.size, one.crews.size], [104, 40, 130, 2]);
            for (const crew of one.crews.values()) assert.equal(crew.hours.size, 40);
            // A top part over two, each a job every seventeen weeks from its own first week.
            const [top] = [...one.parts.values()];
            assert.equal(top!.parts.size, 2);
            for (const part of [top!, ...top!.parts.values()]) assert.ok(part.jobs.size >= 30 && part.jobs.size <= 31, `${part.name}: ${part.jobs.size} jobs`);
        }
        // A works is a function of its number alone: the record's two hundred are the first two hundred of any more.
        const more = East.compile(ex.generateWorksAll, [])(3n, 522n);
        assert.ok(equalFor(ex.WorksByKey)(works, new Map([...more].slice(0, 2))));
        assert.equal(ex.planWorks.default?.size, 200);
    });

    test("the works' task, at its inputs' defaults, makes the works the record starts with: a page runs every task of its area as the area starts", () => {
        const start = (input: typeof ex.planWorksRows | typeof ex.planWorksWeeks) => match(input.source!, { value: (value) => value, file: () => assert.fail(`${input.name} starts from a file`) });
        const works = ex.planWorks.default!;
        assert.equal(start(ex.planWorksRows), BigInt(works.size), "the task makes no more works than the record holds");
        assert.ok(equalFor(ex.WorksByKey)(East.compile(ex.generateWorksAll, [])(start(ex.planWorksRows), start(ex.planWorksWeeks)), works));
    });

    test("a thousand machines, each with 80 jobs, 10 stops, 10 alarms and 52 weeks of load and output: 204,000 items", () => {
        const machines = East.compile(ex.generateMachines, [])(1_000n);
        assert.equal(machines.size, 1_000);
        let items = 0;
        for (const machine of machines.values()) {
            assert.deepEqual([machine.jobs.size, machine.stops.size, machine.alarms.size, machine.load.size, machine.output.size], [80, 10, 10, 52, 52]);
            items += machine.jobs.size + machine.stops.size + machine.alarms.size + machine.load.size + machine.output.size;
        }
        assert.equal(items, 204_000);
        // A year in view over the 150 machines a Plan reads passes the 10,000 jobs it draws.
        assert.ok([...machines.values()].slice(0, 150).reduce((sum, machine) => sum + machine.jobs.size, 0) > 10_000);
    });

    test("the twelve machines are the thousand's first twelve: a row is a function of its number alone", () => {
        const many = East.compile(ex.generateMachines, [])(1_000n);
        const few = East.compile(ex.generateMachines, [])(12n);
        const first = new Map([...many].slice(0, 12));
        assert.ok(equalFor(DictType(StringType, ex.Machine))(few as never, first as never));
    });

    test("forty halls of six members, each one's load every day of half a year", () => {
        const halls = East.compile(ex.generateHalls, [])(40n);
        assert.equal(halls.size, 40);
        assert.equal([...halls.values()].reduce((sum, hall) => sum + [...hall.members.values()].reduce((n, m) => n + m.load.size, 0), 0), 43_680);
    });

    test("fifty assemblies of 39 parts three deep, each part with four jobs: 7,800 jobs", () => {
        const assemblies = East.compile(ex.generateAssemblies, [])(50n);
        assert.equal(assemblies.size, 50);
        const parts = [...assemblies.values()].flatMap((assembly) => partsOf(assembly.parts));
        assert.equal(parts.length, 50 * 39);
        assert.equal(parts.reduce((sum, part) => sum + part.jobs.size, 0), 7_800);
    });

    test("twenty ledgers of 18 leaf measures, each read and stocked weekly; a measure above them holds none of its own", () => {
        const ledgers = East.compile(ex.generateLedgers, [])(20n);
        assert.equal(ledgers.size, 20);
        const measures = [...ledgers.values()].flatMap((ledger) => measuresOf(ledger.measures));
        const leaves = measures.filter((measure) => measure.children.size === 0);
        assert.equal(leaves.length, 20 * 18);
        assert.equal(leaves.reduce((sum, leaf) => sum + leaf.readings.size + leaf.stock.size, 0), 37_440);
        for (const parent of measures.filter((measure) => measure.children.size > 0)) {
            assert.deepEqual([parent.readings.size, parent.stock.size], [0, 0], "a parent's subtotals are e3's, of its children");
        }
    });
});

describe("the Plans over them (#1439)", () => {
    const paged = [
        { example: ex.planNestedAll, record: ex.planWorks, edits: true },
        { example: ex.planNestedMachines, record: ex.machines, edits: true },
        { example: ex.planNestedMachinesPhone, record: ex.machines, edits: true },
        { example: ex.planNestedHalls, record: ex.halls, edits: false },
        { example: ex.planNestedAssemblies, record: ex.assemblies, edits: true },
        { example: ex.planNestedLedgers, record: ex.ledgers, edits: true },
    ];
    for (const { example, record, edits } of paged) {
        test(example.description, () => {
            const manifest = deriveManifest(example.fn);
            // Its rows are read a page, a search or a cell at a time, never whole; an editing Plan writes through the patch door.
            assert.deepEqual(manifest.pages, [record.path]);
            assert.equal(manifest.paths.length, 0, "the Plan never reads the record whole");
            assert.deepEqual(manifest.records, edits ? [record.name] : []);
            const component = (example.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
            assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component)).type, component.type);
        });
    }

    test(ex.planNestedInline.description, () => {
        const manifest = deriveManifest(ex.planNestedInline.fn);
        // The twelve machines read whole, and nothing a page or a cell at a time.
        assert.deepEqual(manifest.paths, [ex.machinesFew.path]);
        assert.deepEqual([manifest.pages, manifest.records], [[], []]);
        const component = (ex.planNestedInline.fn.toIR() as EastIR<[], typeof UIComponentType>).compile([])();
        assert.equal(decodeBeast2For(UIComponentType)(encodeBeast2For(UIComponentType)(component)).type, component.type);
    });
});
