/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Every Sheet example reads its rows from e3 (#1180): a record, an input or a
// task's output, declared beside it in its module. That is what lets the
// showcase run it on e3-web, whose package carries every definition an
// example module exports. A sheet that writes binds its record with the patch
// door its Apply commits through; the rows made by a rule rather than written
// out are tasks over a count, and their generators run here.

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { none, some, variant } from "@elaraai/east";
import { pathToString } from "@elaraai/e3-types";
import { deriveManifest } from "@elaraai/e3-ui";
import * as ex from "./sheet.examples.js";

/** Each `example()` the module exports, by name. */
const EXAMPLES = Object.entries(ex).flatMap(([name, value]) =>
    "keywords" in value && "fn" in value ? [{ name, fn: value.fn }] : []);

/** The path of every dataset the module's e3 definitions provide — an input's
 *  or a record's own, a task's output — as e3 prints it (`.records.sheet_jobs`). */
const PROVIDED = new Set(Object.values(ex).flatMap((value) =>
    !("kind" in value) ? []
        : value.kind === "dataset" ? [pathToString(value.path)]
        : value.kind === "task" ? [pathToString(value.output.path)]
        : []));

/** The records each sheet binds: the one its Apply commits to — the workshop's
 *  also the machines its register reads — and none for the one that only reads. */
const WRITES: Record<string, string[]> = {
    sheetBasic: ["sheet_jobs"],
    sheetVariants: ["sheet_variants_plans"],
    sheetStress: [],
    sheetLibrary: ["sheet_jobs"],
    sheetWorkshop: ["sheet_workshop_orders", "sheet_workshop_machines"],
    sheetWeeks: ["sheet_week_plans"],
    sheetBatches: ["sheet_batch_days"],
    sheetLoose: ["sheet_loose_work"],
    sheetPaged: ["sheet_jobs"],
};

describe("Sheet examples read e3", () => {
    hostTest("every example reads a dataset, a record or a paged source of e3", () => {
        assert.notEqual(EXAMPLES.length, 0, "the module exports no example()");
        const unbound = EXAMPLES.filter(({ fn }) => {
            const { paths, pages } = deriveManifest(fn as never);
            return paths.length + pages.length === 0;
        }).map(({ name }) => name);
        assert.deepEqual(unbound, []);
    });

    hostTest("every dataset an example reads is declared in its module, so the showcase's package carries it", () => {
        const undeclared = EXAMPLES.flatMap(({ name, fn }) => {
            const { paths, pages } = deriveManifest(fn as never);
            return [...paths, ...pages].map(pathToString).filter((path) => !PROVIDED.has(path)).map((path) => `${name} reads ${path}`);
        });
        assert.deepEqual(undeclared, []);
    });

    hostTest("a sheet that writes binds the record its Apply commits to, and one that only reads binds none", () => {
        assert.deepEqual(EXAMPLES.map(({ name }) => name).sort(), Object.keys(WRITES).sort(), "every example has its row here");
        const bound = Object.fromEntries(EXAMPLES.map(({ name, fn }) => [name, deriveManifest(fn as never).records]));
        assert.deepEqual(bound, WRITES);
    });
});

describeEast("Sheet — the rows a task makes", (test) => {
    test("the stress sheet's jobs: their count, four a day from 5 January, the activities in turn, every fifth a count of routers, every seventh urgent, every eleventh quantity blank", $ => {
        const jobs = $.let(ex.generateStressJobs(2000n));
        $(Assert.equal(jobs.size(), 2000n));
        $(Assert.equal(jobs.get(0n), {
            id: "S0", start: some(new Date("2026-01-05T00:00:00Z")), activity: "Routing", notes: "urgent — inspect before delivery",
            stations: { from: [], to: [variant("counted", { n: 2n, key: "CNC router" })] }, status: "PLANNED", qty: none,
        }));
        $(Assert.equal(jobs.get(1n), {
            id: "S1", start: some(new Date("2026-01-05T00:00:00Z")), activity: "Spraying", notes: "batch 101",
            stations: { from: [], to: [variant("identified", { key: "R2141" })] }, status: "RELEASED", qty: some(57.0),
        }));
        $(Assert.equal(jobs.get(1999n), {
            id: "S1999", start: some(new Date("2027-05-19T00:00:00Z")), activity: "Maintenance", notes: "batch 2099",
            stations: { from: [], to: [variant("identified", { key: "A7301" })] }, status: "RELEASED", qty: some(14043.0),
        }));
        $(Assert.equal(jobs.filter(($, j) => j.notes.startsWith("urgent")).size(), 286n));
        $(Assert.equal(jobs.filter(($, j) => j.activity.equal("Routing")).size(), 400n));
        $(Assert.equal(jobs.filter(($, j) => j.qty.hasTag("none")).size(), 182n));
    });
}, { platformFns: TestImpl });
