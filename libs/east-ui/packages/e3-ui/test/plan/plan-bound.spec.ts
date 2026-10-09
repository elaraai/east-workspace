/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Every Plan example reads its data from e3 (#1178): an input, a record or a
// task's output, declared beside it in its module. That is what lets the
// showcase run it on e3-web, whose package carries every definition an
// example module exports. The fixtures made by a rule rather than written out
// are tasks over a count, and their generators run here.

import { describe, test as hostTest } from "node:test";
import assert from "node:assert/strict";
import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { pathToString } from "@elaraai/e3-types";
import { deriveManifest } from "@elaraai/e3-ui";
import * as ex from "./plan.examples.js";

/** Each `example()` the module exports, by name. */
const EXAMPLES = Object.entries(ex).flatMap(([name, value]) =>
    "keywords" in value && "fn" in value ? [{ name, fn: value.fn }] : []);

/** The path of every dataset the module's e3 definitions provide — an input's
 *  or a record's own, a task's output — as e3 prints it (`.inputs.plan_pick_ops`). */
const PROVIDED = new Set(Object.values(ex).flatMap((value) =>
    !("kind" in value) ? []
        : value.kind === "dataset" ? [pathToString(value.path)]
        : value.kind === "task" ? [pathToString(value.output.path)]
        : []));

describe("Plan examples read e3", () => {
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
});

describeEast("Plan — the fixtures a task makes", (test) => {
    test("the §1 horizon: its count of deliveries over the 27 weeks from W21, a third at risk of running late", $ => {
        const horizon = $.let(ex.generateTargetHorizon(36n));
        $(Assert.equal(horizon.size(), 36n));
        $(Assert.equal(horizon.get(0n), { key: "h1", at: new Date("2026-05-18T00:00:00Z"), hall: "Hall 1", risk: "late", sheets: 20.0 }));
        $(Assert.equal(horizon.get(35n), { key: "h36", at: new Date("2026-11-16T00:00:00Z"), hall: "Hall 2", risk: "on-time", sheets: 45.0 }));
        // The cohorts the §1 toolbar seeds: 12 late, 5 with nothing booked.
        $(Assert.equal(horizon.filter(($, h) => h.risk.equal("late")).size(), 12n));
        $(Assert.equal(horizon.filter(($, h) => h.sheets.equal(0.0)).size(), 5n));
    });

    test("the number axis's horizon: two orders a day from day 1, the halls in turn", $ => {
        const horizon = $.let(ex.generateNumberHorizon(24n));
        $(Assert.equal(horizon.size(), 24n));
        $(Assert.equal(horizon.get(0n), { key: "o1", day: 1n, hall: "Hall 1" }));
        $(Assert.equal(horizon.get(23n), { key: "o24", day: 12n, hall: "Hall 2" }));
    });
}, { platformFns: TestImpl });
