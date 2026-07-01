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
import { SliceImpl, buildSliceHandle } from "../../src/platform/slice/index.js";
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
