/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe } from "node:test";
import { East, IntegerType, StringType, NullType, ArrayType, StructType, variant, some, none, type BlockBuilder } from "@elaraai/east";
import { TestImpl, Assert } from "../platforms.spec.js";
import { Slice } from "@elaraai/east-ui/internal";
import { SliceImpl, SliceApplyImpl } from "../../src/platform/slice/index.js";

const platform = [...TestImpl, ...SliceImpl, ...SliceApplyImpl];

/** Run an East function body against the Slice platform. */
function testSlice(name: string, body: ($: BlockBuilder<NullType>) => void) {
    test(name, () => {
        East.function([], NullType, body).toIR().compile(platform)();
    });
}

const EventType = StructType({ scenario: StringType, region: StringType, sessions: IntegerType });

/** Shared config: scenario/region searchable, region breakable. */
const config = () => Slice.config(EventType, {
    fields: { scenario: { label: "Scenario" }, region: { label: "Region" }, sessions: { label: "Sessions" } },
    searchFieldIds:    ["scenario", "region"],
    breakdownFieldIds: ["region"],
});

describe("Slice — bound-data derived closures + mutators", () => {

    // ── filters → resultCount() ──────────────────────────────────────────────

    testSlice("addFilter narrows resultCount() — integer gte", $ => {
        const cfg = $.let(config());
        const data = $.const([
            { scenario: "procurement v3", region: "EU",   sessions: 42n },
            { scenario: "procurement v3", region: "NA",   sessions: 18n },
            { scenario: "procurement v2", region: "EU",   sessions: 31n },
            { scenario: "logistics",      region: "APAC", sessions: 7n  },
            { scenario: "procurement v3", region: "NA",   sessions: 12n },
            { scenario: "logistics",      region: "EU",   sessions: 25n },
        ], ArrayType(EventType));
        const slice = $.let(Slice.bind([EventType], "t.add.int", cfg, Slice.state(), data, none));
        $(Assert.equal(slice.totalCount(), 6n)); // all bound rows, before narrowing
        $(slice.addFilter(East.value(variant("integer", { fieldId: "sessions", op: variant("gte", 20n) }), Slice.Types.Predicate)));
        $(Assert.equal(slice.resultCount(), 3n)); // 42, 31, 25
        $(Assert.equal(slice.totalCount(), 6n)); // totalCount is narrowing-independent
    });

    testSlice("addFilter — string contains", $ => {
        const cfg = $.let(config());
        const data = $.const([
            { scenario: "procurement v3", region: "EU",   sessions: 42n },
            { scenario: "procurement v3", region: "NA",   sessions: 18n },
            { scenario: "procurement v2", region: "EU",   sessions: 31n },
            { scenario: "logistics",      region: "APAC", sessions: 7n  },
            { scenario: "procurement v3", region: "NA",   sessions: 12n },
            { scenario: "logistics",      region: "EU",   sessions: 25n },
        ], ArrayType(EventType));
        const slice = $.let(Slice.bind([EventType], "t.add.contains", cfg, Slice.state(), data, none));
        $(slice.addFilter(East.value(variant("string", { fieldId: "scenario", op: variant("contains", "procurement") }), Slice.Types.Predicate)));
        $(Assert.equal(slice.resultCount(), 4n));
    });

    testSlice("addFilter — string in (Set)", $ => {
        const cfg = $.let(config());
        const data = $.const([
            { scenario: "procurement v3", region: "EU",   sessions: 42n },
            { scenario: "procurement v3", region: "NA",   sessions: 18n },
            { scenario: "procurement v2", region: "EU",   sessions: 31n },
            { scenario: "logistics",      region: "APAC", sessions: 7n  },
            { scenario: "procurement v3", region: "NA",   sessions: 12n },
            { scenario: "logistics",      region: "EU",   sessions: 25n },
        ], ArrayType(EventType));
        const slice = $.let(Slice.bind([EventType], "t.add.in", cfg, Slice.state(), data, none));
        $(slice.addFilter(East.value(variant("string", { fieldId: "region", op: variant("in", new Set(["EU", "NA"])) }), Slice.Types.Predicate)));
        $(Assert.equal(slice.resultCount(), 5n)); // all but APAC
    });

    testSlice("two filters AND together", $ => {
        const cfg = $.let(config());
        const data = $.const([
            { scenario: "procurement v3", region: "EU",   sessions: 42n },
            { scenario: "procurement v3", region: "NA",   sessions: 18n },
            { scenario: "procurement v2", region: "EU",   sessions: 31n },
            { scenario: "logistics",      region: "APAC", sessions: 7n  },
            { scenario: "procurement v3", region: "NA",   sessions: 12n },
            { scenario: "logistics",      region: "EU",   sessions: 25n },
        ], ArrayType(EventType));
        const slice = $.let(Slice.bind([EventType], "t.add.and", cfg, Slice.state(), data, none));
        $(slice.addFilter(East.value(variant("string", { fieldId: "scenario", op: variant("eq", "procurement v3") }), Slice.Types.Predicate)));
        $(slice.addFilter(East.value(variant("integer", { fieldId: "sessions", op: variant("gte", 15n) }), Slice.Types.Predicate)));
        $(Assert.equal(slice.resultCount(), 2n)); // v3 & >=15: 42, 18
    });

    testSlice("removeFilter restores resultCount()", $ => {
        const cfg = $.let(config());
        const data = $.const([
            { scenario: "procurement v3", region: "EU",   sessions: 42n },
            { scenario: "procurement v3", region: "NA",   sessions: 18n },
            { scenario: "procurement v2", region: "EU",   sessions: 31n },
            { scenario: "logistics",      region: "APAC", sessions: 7n  },
            { scenario: "procurement v3", region: "NA",   sessions: 12n },
            { scenario: "logistics",      region: "EU",   sessions: 25n },
        ], ArrayType(EventType));
        const slice = $.let(Slice.bind([EventType], "t.remove", cfg, Slice.state({
            filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 20n) })],
        }), data, none));
        $(slice.removeFilter(0n));
        $(Assert.equal(slice.resultCount(), 6n));
    });

    testSlice("clearFilters drops filters and active cohorts", $ => {
        const cfg = $.let(config());
        const data = $.const([
            { scenario: "procurement v3", region: "EU",   sessions: 42n },
            { scenario: "procurement v3", region: "NA",   sessions: 18n },
            { scenario: "procurement v2", region: "EU",   sessions: 31n },
            { scenario: "logistics",      region: "APAC", sessions: 7n  },
            { scenario: "procurement v3", region: "NA",   sessions: 12n },
            { scenario: "logistics",      region: "EU",   sessions: 25n },
        ], ArrayType(EventType));
        const slice = $.let(Slice.bind([EventType], "t.clear", cfg, Slice.state({
            filters: [variant("integer", { fieldId: "sessions", op: variant("gte", 20n) })],
        }), data, none));
        $(slice.clearFilters());
        $(Assert.equal(slice.read().filters.length(), 0n));
        $(Assert.equal(slice.resultCount(), 6n));
    });

    // ── search → resultCount() ─────────────────────────────────────────────────

    testSlice("setSearch narrows resultCount() across search fields", $ => {
        const cfg = $.let(config());
        const data = $.const([
            { scenario: "procurement v3", region: "EU",   sessions: 42n },
            { scenario: "procurement v3", region: "NA",   sessions: 18n },
            { scenario: "procurement v2", region: "EU",   sessions: 31n },
            { scenario: "logistics",      region: "APAC", sessions: 7n  },
            { scenario: "procurement v3", region: "NA",   sessions: 12n },
            { scenario: "logistics",      region: "EU",   sessions: 25n },
        ], ArrayType(EventType));
        const slice = $.let(Slice.bind([EventType], "t.search", cfg, Slice.state(), data, none));
        $(slice.setSearch(some("logistics")));
        $(Assert.equal(slice.resultCount(), 2n));
    });

    // ── cohorts → resultCount() + cohortCounts() ───────────────────────────────

    testSlice("toggleCohort applies the cohort's predicates", $ => {
        const cfg = $.let(config());
        const data = $.const([
            { scenario: "procurement v3", region: "EU",   sessions: 42n },
            { scenario: "procurement v3", region: "NA",   sessions: 18n },
            { scenario: "procurement v2", region: "EU",   sessions: 31n },
            { scenario: "logistics",      region: "APAC", sessions: 7n  },
            { scenario: "procurement v3", region: "NA",   sessions: 12n },
            { scenario: "logistics",      region: "EU",   sessions: 25n },
        ], ArrayType(EventType));
        const slice = $.let(Slice.bind([EventType], "t.cohort.toggle", cfg, Slice.state({
            cohorts: [{ id: "eu", name: "EU big", filters: [
                variant("string", { fieldId: "region", op: variant("eq", "EU") }),
                variant("integer", { fieldId: "sessions", op: variant("gte", 30n) }),
            ] }],
        }), data, none));
        $(slice.toggleCohort("eu"));
        $(Assert.equal(slice.resultCount(), 2n)); // EU & >=30: 42, 31
    });

    testSlice("cohortCounts() sizes each cohort over the bound rows", $ => {
        const cfg = $.let(config());
        const data = $.const([
            { scenario: "procurement v3", region: "EU",   sessions: 42n },
            { scenario: "procurement v3", region: "NA",   sessions: 18n },
            { scenario: "procurement v2", region: "EU",   sessions: 31n },
            { scenario: "logistics",      region: "APAC", sessions: 7n  },
            { scenario: "procurement v3", region: "NA",   sessions: 12n },
            { scenario: "logistics",      region: "EU",   sessions: 25n },
        ], ArrayType(EventType));
        const slice = $.let(Slice.bind([EventType], "t.cohort.counts", cfg, Slice.state({
            cohorts: [{ id: "eu", name: "EU", filters: [variant("string", { fieldId: "region", op: variant("eq", "EU") })] }],
        }), data, none));
        $(Assert.equal(slice.cohortCounts().get("eu"), 3n)); // EU rows: 42, 31, 25
    });

    testSlice("updateCohort that ADDS a clause preserves the existing ones", $ => {
        const cfg = $.let(config());
        const data = $.const([
            { scenario: "procurement v3", region: "EU",   sessions: 42n },
            { scenario: "procurement v3", region: "NA",   sessions: 18n },
            { scenario: "procurement v2", region: "EU",   sessions: 31n },
            { scenario: "logistics",      region: "APAC", sessions: 7n  },
            { scenario: "procurement v3", region: "NA",   sessions: 12n },
            { scenario: "logistics",      region: "EU",   sessions: 25n },
        ], ArrayType(EventType));
        const slice = $.let(Slice.bind([EventType], "t.cohort.update", cfg, Slice.state({
            cohorts: [{ id: "eu", name: "EU", filters: [variant("string", { fieldId: "region", op: variant("eq", "EU") })] }],
            activeCohorts: new Set(["eu"]),
        }), data, none));
        $(slice.updateCohort("eu", East.value({
            id: "eu", name: "EU",
            filters: [
                variant("string", { fieldId: "region", op: variant("eq", "EU") }),
                variant("integer", { fieldId: "sessions", op: variant("gte", 30n) }),
            ],
        }, Slice.Types.Cohort)));
        const cohorts = $.let(slice.read().cohorts);
        $(Assert.equal(cohorts.length(), 1n));
        $(Assert.equal(cohorts.get(0n).filters.length(), 2n));
        $(Assert.equal(slice.resultCount(), 2n)); // EU & >=30 still active
    });

    testSlice("removeCohort drops it and clears its narrowing", $ => {
        const cfg = $.let(config());
        const data = $.const([
            { scenario: "procurement v3", region: "EU",   sessions: 42n },
            { scenario: "procurement v3", region: "NA",   sessions: 18n },
            { scenario: "procurement v2", region: "EU",   sessions: 31n },
            { scenario: "logistics",      region: "APAC", sessions: 7n  },
            { scenario: "procurement v3", region: "NA",   sessions: 12n },
            { scenario: "logistics",      region: "EU",   sessions: 25n },
        ], ArrayType(EventType));
        const slice = $.let(Slice.bind([EventType], "t.cohort.remove", cfg, Slice.state({
            cohorts: [{ id: "eu", name: "EU", filters: [variant("string", { fieldId: "region", op: variant("eq", "EU") })] }],
            activeCohorts: new Set(["eu"]),
        }), data, none));
        $(slice.removeCohort("eu"));
        $(Assert.equal(slice.read().cohorts.length(), 0n));
        $(Assert.equal(slice.resultCount(), 6n));
    });

    // ── config-derived + breakdown ─────────────────────────────────────────────

    testSlice("fields() lists every field with its kind", $ => {
        const cfg = $.let(config());
        const data = $.const([
            { scenario: "procurement v3", region: "EU",   sessions: 42n },
            { scenario: "procurement v3", region: "NA",   sessions: 18n },
            { scenario: "procurement v2", region: "EU",   sessions: 31n },
            { scenario: "logistics",      region: "APAC", sessions: 7n  },
            { scenario: "procurement v3", region: "NA",   sessions: 12n },
            { scenario: "logistics",      region: "EU",   sessions: 25n },
        ], ArrayType(EventType));
        const slice = $.let(Slice.bind([EventType], "t.fields", cfg, Slice.state(), data, none));
        const fields = $.let(slice.fields());
        $(Assert.equal(fields.length(), 3n));
        $(Assert.equal(fields.get(2n).kind, "integer")); // sessions
    });

    testSlice("dimensions() lists the breakable fields", $ => {
        const cfg = $.let(config());
        const data = $.const([
            { scenario: "procurement v3", region: "EU",   sessions: 42n },
            { scenario: "procurement v3", region: "NA",   sessions: 18n },
            { scenario: "procurement v2", region: "EU",   sessions: 31n },
            { scenario: "logistics",      region: "APAC", sessions: 7n  },
            { scenario: "procurement v3", region: "NA",   sessions: 12n },
            { scenario: "logistics",      region: "EU",   sessions: 25n },
        ], ArrayType(EventType));
        const slice = $.let(Slice.bind([EventType], "t.dims", cfg, Slice.state(), data, none));
        const dims = $.let(slice.dimensions());
        $(Assert.equal(dims.length(), 1n));
        $(Assert.equal(dims.get(0n).fieldId, "region"));
    });

    testSlice("setBreakdown drives groups()", $ => {
        const cfg = $.let(config());
        const data = $.const([
            { scenario: "procurement v3", region: "EU",   sessions: 42n },
            { scenario: "procurement v3", region: "NA",   sessions: 18n },
            { scenario: "procurement v2", region: "EU",   sessions: 31n },
            { scenario: "logistics",      region: "APAC", sessions: 7n  },
            { scenario: "procurement v3", region: "NA",   sessions: 12n },
            { scenario: "logistics",      region: "EU",   sessions: 25n },
        ], ArrayType(EventType));
        const slice = $.let(Slice.bind([EventType], "t.breakdown", cfg, Slice.state({
            breakdown: some({ fieldId: "region", limit: none }),
        }), data, none));
        $(Assert.equal(slice.groups().length(), 3n)); // EU, NA, APAC
    });

    // ── search matches() via toMatch ───────────────────────────────────────────

    testSlice("matches() filters by query and projects via toMatch", $ => {
        const cfg = $.let(config());
        const data = $.const([
            { scenario: "procurement v3", region: "EU",   sessions: 42n },
            { scenario: "procurement v3", region: "NA",   sessions: 18n },
            { scenario: "procurement v2", region: "EU",   sessions: 31n },
            { scenario: "logistics",      region: "APAC", sessions: 7n  },
            { scenario: "procurement v3", region: "NA",   sessions: 12n },
            { scenario: "logistics",      region: "EU",   sessions: 25n },
        ], ArrayType(EventType));
        const toMatch = $.const(East.function([EventType], Slice.Types.SearchMatch, ($, r) =>
            East.value({ id: r.scenario, label: r.region, meta: none }, Slice.Types.SearchMatch)));
        const slice = $.let(Slice.bind([EventType], "t.matches", cfg, Slice.state({
            search: some("logistics"),
        }), data, some(toMatch)));
        $(Assert.equal(slice.matches().length(), 2n)); // 2 logistics rows
    });
});
