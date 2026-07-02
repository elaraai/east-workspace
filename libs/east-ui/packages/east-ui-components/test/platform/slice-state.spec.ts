/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Stateful repros for the two `Slice.Summary` wiring bugs the adversarial
 * bug-hunt confirmed — exercised through the REAL `slice_*` platform primitives
 * + `UIStore`, not the DOM-test mock (which only modelled `filters +
 * activeCohorts`, so it never caught either mismatch):
 *
 *  - #9  `clearFilters` ("clear all") must zero EVERY narrowing the Summary
 *        counts — range / search / visible whitelist — not just filters/cohorts,
 *        else the count can never reach 0.
 *  - #10 `activeCount` / `isActive` must count only what actually NARROWS rows:
 *        a master-detail `selectedIndex` and a legend `visible` whitelist change
 *        no `resultCount`, so neither is a narrowing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { none, some, variant } from "@elaraai/east";
import { SliceImpl, buildSliceHandle, boundRangeDomain } from "../../src/platform/slice/index.js";
import { initializeStore } from "../../src/platform/state-runtime.js";
import { UIStore } from "../../src/platform/state-store.js";

/** The registered primitives, looked up by their declared `slice_*` name. */
const byName = new Map(SliceImpl.map(p => [p.name, p.fn]));
const call = (name: string, ...args: unknown[]): unknown => {
    const fn = byName.get(name);
    if (fn === undefined) throw new Error(`no registered Slice primitive "${name}"`);
    return (fn as (...a: unknown[]) => unknown)(...args);
};

const cfg = { fields: new Map(), rangeFieldId: none, searchFieldIds: ["id"], breakdownFieldIds: [] };
const initial = {
    range: none, compare: none, filters: [], cohorts: [], activeCohorts: new Set<string>(),
    breakdown: none, search: none, visible: none, selectedIndex: none,
};

test("Summary 'clear all' (clearFilters) zeroes the narrowing count it displays (#9)", () => {
    initializeStore(new UIStore());
    buildSliceHandle("k", cfg, initial, [{ id: "a" }, { id: "b" }], none);

    call("slice_set_search", "k", some("hello"));            // a real narrowing
    assert.equal(call("slice_active_count", "k"), 1n);

    call("slice_clear_filters", "k");                        // the Summary 'clear all' handler
    assert.equal(call("slice_active_count", "k"), 0n);       // was: still 1n
    assert.equal((call("slice_read", "k") as { search: { type: string } }).search.type, "none"); // was: still "some"
});

test("clearFilters clears the range narrowing but LEAVES the legend whitelist (view state) (#9/#10)", () => {
    initializeStore(new UIStore());
    buildSliceHandle("r", cfg, initial, [{ id: "a" }, { id: "b" }], none);

    call("slice_set_visible", "r", some(new Set(["a"])));     // presentation — not a narrowing
    call("slice_add_filter", "r", { type: "string", value: { fieldId: "id", op: { type: "eq", value: "a" } } });
    assert.equal(call("slice_active_count", "r"), 1n);        // only the filter counts (visible doesn't)

    call("slice_clear_filters", "r");
    assert.equal(call("slice_active_count", "r"), 0n);
    const st = call("slice_read", "r") as { visible: { type: string }; filters: unknown[] };
    assert.equal(st.filters.length, 0);                       // narrowing cleared
    assert.equal(st.visible.type, "some");                    // legend whitelist preserved (view state)
});

test("activeCount/isActive ignore non-narrowing state — selection + legend visibility (#10)", () => {
    initializeStore(new UIStore());
    buildSliceHandle("s", cfg, initial, [{ id: "a" }, { id: "b" }], none);

    call("slice_select", "s", some(0n));                     // master-detail selection
    assert.equal(call("slice_result_count", "s"), 2n);       // narrows no rows
    assert.equal(call("slice_active_count", "s"), 0n);       // was: 1n
    assert.equal(call("slice_is_active", "s"), false);       // was: true

    call("slice_select", "s", none);
    call("slice_set_visible", "s", some(new Set(["a"])));     // legend whitelist
    assert.equal(call("slice_result_count", "s"), 2n);       // still narrows no rows
    assert.equal(call("slice_active_count", "s"), 0n);       // was: 1n
    assert.equal(call("slice_is_active", "s"), false);       // was: true
});

test("slice_toggle_filter is an idempotent add/remove toggle over structural equality (#165)", () => {
    initializeStore(new UIStore());
    const searchCfg = {
        fields: new Map([["id", { type: "string", value: { accessor: (r: { id: string }) => r.id } }]]),
        rangeFieldId: none, searchFieldIds: ["id"], breakdownFieldIds: [],
    };
    buildSliceHandle("tf", searchCfg, initial, [{ id: "a" }, { id: "b" }], none);

    // First toggle appends and actually narrows the bound rows.
    call("slice_toggle_filter", "tf", variant("string", { fieldId: "id", op: variant("eq", "a") }));
    assert.equal((call("slice_read", "tf") as { filters: unknown[] }).filters.length, 1);
    assert.equal(call("slice_result_count", "tf"), 1n);

    // A SECOND, structurally-equal (not identical) predicate removes it.
    call("slice_toggle_filter", "tf", variant("string", { fieldId: "id", op: variant("eq", "a") }));
    assert.equal((call("slice_read", "tf") as { filters: unknown[] }).filters.length, 0);
    assert.equal(call("slice_result_count", "tf"), 2n);

    // Toggling a DIFFERENT clause never removes a non-equal one.
    call("slice_toggle_filter", "tf", variant("string", { fieldId: "id", op: variant("eq", "a") }));
    call("slice_toggle_filter", "tf", variant("string", { fieldId: "id", op: variant("eq", "b") }));
    assert.equal((call("slice_read", "tf") as { filters: unknown[] }).filters.length, 2);
});

test("an integer range narrows integer-field rows; the brush domain reports the TRUE kind (#167)", () => {
    initializeStore(new UIStore());
    const intCfg = {
        fields: new Map([["qty", { type: "integer", value: { accessor: (r: { qty: bigint }) => r.qty } }]]),
        rangeFieldId: some("qty"), searchFieldIds: [], breakdownFieldIds: [],
    };
    buildSliceHandle("ir", intCfg, initial, [{ qty: 5n }, { qty: 20n }, { qty: 50n }], none);

    // Was "float" — which made the Rail brush write an inert float arm.
    assert.deepEqual(boundRangeDomain("ir"), { kind: "integer", min: 5, max: 50 });

    // A correctly-armed integer range actually filters the bound rows.
    call("slice_set_range", "ir", some(variant("integer", { from: 10n, to: 30n })));
    assert.equal(call("slice_result_count", "ir"), 1n);      // only qty=20

    // The old bug shape stays inert by design (mismatched arm never crashes) —
    // this pins WHY the domain kind matters.
    call("slice_set_range", "ir", some(variant("float", { from: 10, to: 30 })));
    assert.equal(call("slice_result_count", "ir"), 3n);      // filters nothing
});

// ── #170 — cohort mutators over the real store ──────────────────────────────

test("slice_define_cohort registers; a second define with the same id THROWS (#170)", () => {
    initializeStore(new UIStore());
    buildSliceHandle("c.def", cfg, initial, [{ id: "a" }], none);
    const euCohort = () => ({ id: "eu", name: "EU", filters: [variant("string", { fieldId: "id", op: variant("eq", "a") })] });

    call("slice_define_cohort", "c.def", euCohort());
    const s = call("slice_read", "c.def") as { cohorts: Array<{ id: string; name: string; filters: unknown[] }> };
    assert.equal(s.cohorts.length, 1);
    assert.equal(s.cohorts[0]!.id, "eu");
    assert.equal(s.cohorts[0]!.filters.length, 1);

    assert.throws(() => call("slice_define_cohort", "c.def", euCohort()), /already exists/);
});

test("slice_toggle_cohort flips activeCohorts ON then OFF — and activeCount follows (#170)", () => {
    initializeStore(new UIStore());
    buildSliceHandle("c.tog", cfg, initial, [{ id: "a" }], none);
    call("slice_define_cohort", "c.tog", { id: "eu", name: "EU", filters: [variant("string", { fieldId: "id", op: variant("eq", "a") })] });

    call("slice_toggle_cohort", "c.tog", "eu");
    assert.equal((call("slice_read", "c.tog") as { activeCohorts: Set<string> }).activeCohorts.has("eu"), true);
    assert.equal(call("slice_active_count", "c.tog"), 1n);

    call("slice_toggle_cohort", "c.tog", "eu");   // the requester's core enable/disable case
    assert.equal((call("slice_read", "c.tog") as { activeCohorts: Set<string> }).activeCohorts.has("eu"), false);
    assert.equal(call("slice_active_count", "c.tog"), 0n);
    assert.equal((call("slice_read", "c.tog") as { cohorts: unknown[] }).cohorts.length, 1);   // OFF ≠ deleted
});

test("slice_update_cohort replaces in place; slice_remove_cohort drops it AND its active flag (#170)", () => {
    initializeStore(new UIStore());
    buildSliceHandle("c.upd", cfg, initial, [{ id: "a" }], none);
    call("slice_define_cohort", "c.upd", { id: "eu", name: "EU", filters: [variant("string", { fieldId: "id", op: variant("eq", "a") })] });
    call("slice_toggle_cohort", "c.upd", "eu");

    call("slice_update_cohort", "c.upd", "eu", { id: "eu", name: "EU zone", filters: [
        variant("string", { fieldId: "id", op: variant("eq", "a") }),
        variant("string", { fieldId: "id", op: variant("neq", "b") }),
    ] });
    let s = call("slice_read", "c.upd") as { cohorts: Array<{ id: string; name: string; filters: unknown[] }>; activeCohorts: Set<string> };
    assert.equal(s.cohorts.length, 1);
    assert.equal(s.cohorts[0]!.name, "EU zone");
    assert.equal(s.cohorts[0]!.filters.length, 2);
    assert.equal(s.activeCohorts.has("eu"), true);   // update keeps the active state

    call("slice_remove_cohort", "c.upd", "eu");
    s = call("slice_read", "c.upd") as typeof s;
    assert.equal(s.cohorts.length, 0);
    assert.equal(s.activeCohorts.has("eu"), false);  // orphan cleaned up
});

test("slice_remove_filter removes by INDEX — the survivor is the other clause (#170)", () => {
    initializeStore(new UIStore());
    buildSliceHandle("f.rm", cfg, initial, [{ id: "a" }], none);
    call("slice_add_filter", "f.rm", variant("string", { fieldId: "id", op: variant("eq", "first") }));
    call("slice_add_filter", "f.rm", variant("string", { fieldId: "id", op: variant("eq", "second") }));

    call("slice_remove_filter", "f.rm", 0n);
    const s = call("slice_read", "f.rm") as { filters: Array<{ value: { op: { value: string } } }> };
    assert.equal(s.filters.length, 1);
    assert.equal(s.filters[0]!.value.op.value, "second");   // element identity, not just length
});

// ── #170 — remaining setters + data-derived primitives over the real store ──

test("slice_set_range narrows; slice_set_breakdown feeds slice_groups; slice_set_compare round-trips (#170)", () => {
    initializeStore(new UIStore());
    const cfgN = {
        fields: new Map([["n", { type: "integer", value: { accessor: (r: { n: bigint }) => r.n } }]]),
        rangeFieldId: some("n"), searchFieldIds: [], breakdownFieldIds: ["region"],
    };
    buildSliceHandle("d.set", cfgN, initial, [
        { n: 5n, region: "EU" }, { n: 20n, region: "EU" }, { n: 50n, region: "NA" },
    ], none);

    call("slice_set_range", "d.set", some(variant("integer", { from: 10n, to: 60n })));
    assert.equal(call("slice_result_count", "d.set"), 2n);              // 20, 50
    assert.equal(call("slice_active_count", "d.set"), 1n);              // range IS a narrowing

    call("slice_set_breakdown", "d.set", some({ fieldId: "region", limit: none }));
    const groups = call("slice_groups", "d.set") as Array<{ key: string; count: bigint }>;
    assert.deepEqual(groups.map(g => [g.key, g.count]), [["EU", 1n], ["NA", 1n]]);  // grouped UNDER the range

    call("slice_set_compare", "d.set", some(variant("previousPeriod", null)));
    assert.equal((call("slice_read", "d.set") as { compare: { type: string; value: { type: string } } }).compare.value.type, "previousPeriod");
});

test("clearFilters preserves breakdown + selectedIndex (presentation, not narrowings) (#170)", () => {
    initializeStore(new UIStore());
    buildSliceHandle("d.keep", cfg, initial, [{ id: "a" }], none);
    call("slice_set_breakdown", "d.keep", some({ fieldId: "id", limit: none }));
    call("slice_select", "d.keep", some(2n));
    call("slice_add_filter", "d.keep", variant("string", { fieldId: "id", op: variant("eq", "a") }));

    call("slice_clear_filters", "d.keep");
    const s = call("slice_read", "d.keep") as { filters: unknown[]; breakdown: { type: string }; selectedIndex: { type: string; value: bigint } };
    assert.equal(s.filters.length, 0);
    assert.equal(s.breakdown.type, "some");        // grouping survives "clear all"
    assert.equal(s.selectedIndex.value, 2n);       // selection survives "clear all"
});

test("slice_matches: toMatch projection wins; autoDerive falls back to the searchable string field (#170)", () => {
    initializeStore(new UIStore());
    const cfgS = {
        fields: new Map([["id", { type: "string", value: { accessor: (r: { id: string }) => r.id } }]]),
        rangeFieldId: none, searchFieldIds: ["id"], breakdownFieldIds: [],
    };
    const rows = [{ id: "alpha" }, { id: "beta" }];

    buildSliceHandle("m.proj", cfgS, initial, rows, some((r: { id: string }) => ({ id: r.id, label: r.id.toUpperCase(), meta: none })));
    const projected = call("slice_matches", "m.proj") as Array<{ label: string }>;
    assert.deepEqual(projected.map(m => m.label), ["ALPHA", "BETA"]);   // via toMatch

    buildSliceHandle("m.auto", cfgS, initial, rows, none);
    call("slice_set_search", "m.auto", some("alp"));
    const derived = call("slice_matches", "m.auto") as Array<{ id: string; label: string }>;
    assert.deepEqual(derived.map(m => m.label), ["alpha"]);             // auto-derived, narrowed by the query
});

test("slice_fields merges auto-derived hints for hint-less string fields; slice_cohort_counts counts per cohort (#170)", () => {
    initializeStore(new UIStore());
    const cfgS = {
        fields: new Map([["id", { type: "string", value: { label: "Id", accessor: (r: { id: string }) => r.id } }]]),
        rangeFieldId: none, searchFieldIds: ["id"], breakdownFieldIds: [],
    };
    buildSliceHandle("d.fields", cfgS, initial, [{ id: "a" }, { id: "b" }, { id: "a" }], none);

    const fields = call("slice_fields_meta", "d.fields") as Array<{ fieldId: string; kind: string; hints: string[] }>;
    assert.equal(fields.length, 1);
    assert.deepEqual(fields[0]!.hints, ["a", "b"]);                     // distinct values, insertion order

    call("slice_define_cohort", "d.fields", { id: "just-a", name: "Just A", filters: [variant("string", { fieldId: "id", op: variant("eq", "a") })] });
    const counts = call("slice_cohort_counts", "d.fields") as Map<string, bigint>;
    assert.equal(counts.get("just-a"), 2n);                             // counted in isolation over bound rows
});

test("a real narrowing (search) DOES count, and clears cleanly (sanity)", () => {
    initializeStore(new UIStore());
    // A search that actually narrows rows needs a real string-field accessor.
    const searchCfg = {
        fields: new Map([["id", { type: "string", value: { accessor: (r: { id: string }) => r.id } }]]),
        rangeFieldId: none, searchFieldIds: ["id"], breakdownFieldIds: [],
    };
    buildSliceHandle("t", searchCfg, initial, [{ id: "alpha" }, { id: "beta" }], none);

    call("slice_set_search", "t", some("alph"));
    assert.equal(call("slice_is_active", "t"), true);
    assert.equal(call("slice_active_count", "t"), 1n);
    assert.equal(call("slice_result_count", "t"), 1n);       // only "alpha" matches

    call("slice_clear_filters", "t");
    assert.equal(call("slice_is_active", "t"), false);
    assert.equal(call("slice_result_count", "t"), 2n);
});
