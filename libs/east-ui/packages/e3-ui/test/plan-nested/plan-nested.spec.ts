/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The nested series records (#1438, #1439), as their seeds make them: the
 * sizes each is declared at, a row a function of its number alone, a parent
 * measure holding nothing of its own, and enough jobs in a year's view that a
 * Plan shades it from the totals.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DictType, East, StringType, equalFor, type ValueTypeOf } from "@elaraai/east";
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
