/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Regression tests for issue #106 — a `Slice.bind` handle (and any callback that
 * captures one) must survive beast2 encode → decode and re-bind to the DECODER's
 * store. Slice handles are captured in serialized UI callbacks (e.g.
 * `onClick={() => slice.setSearch(some(q))}`), so before the fix encoding one
 * threw "Cannot serialize function: no IR attached".
 *
 * The handle's ~27 methods are now IR-bearing `East.function`s over the `slice_*`
 * primitives, capturing only the plain-data store key. The host I/O (store, bound
 * rows / config / `toMatch`) lives in the primitive impls, resolved by key.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    StringType, IntegerType, StructType,
    variant, some, none, toEastTypeValue,
    encodeBeast2For, decodeBeast2For,
} from "@elaraai/east";
import { Slice, SliceBindType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "../../src/platform/registry.js";
import { initializeStore } from "../../src/platform/state-runtime.js";
import { UIStore } from "../../src/platform/state-store.js";
import { SliceImpl } from "../../src/platform/slice/index.js";

const Row = StructType({ id: StringType, n: IntegerType });
const rowTypeVal = toEastTypeValue(Row);

// Minimal JS-side SliceConfig (the decoded runtime shape). Empty `fields` is fine:
// these tests drive state mutators + row counts, which don't read field accessors.
const config = {
    fields: new Map(),
    rangeFieldId: none,
    searchFieldIds: [] as string[],
    breakdownFieldIds: [] as string[],
};
const initialState = {
    range: none, compare: none, filters: [], cohorts: [],
    activeCohorts: new Set<string>(), breakdown: none, search: none,
    visible: none, selectedIndex: none,
};
const rows = [{ id: "a", n: 1n }, { id: "b", n: 2n }];

/** Drive the `Slice.bind` impl as the compiler does → a live handle. Resolved
 *  by NAME: positional indexing broke silently when `slice_partition` was
 *  inserted at index 1 (220a86b) — the tests were driving the partition
 *  resolver with bind's arguments ever since. */
function bindSlice(key: string) {
    const resolver = SliceImpl.find(p => p.name === "slice_bind")!.fn!;
    return resolver(rowTypeVal)(key, config, initialState, rows, none);
}

interface DecodedSlice {
    read: () => { search: { type: string }; filters: unknown[] };
    setSearch: (o: unknown) => null;
    addFilter: (p: unknown) => null;
    isActive: () => boolean;
    totalCount: () => bigint;
}

test("#106 — a Slice.bind handle ENCODES (all ~27 methods carry IR)", () => {
    initializeStore(new UIStore());
    const handle = bindSlice("slice.encode");
    // Today (pre-fix): throws "Cannot serialize function: no IR attached".
    assert.doesNotThrow(() => encodeBeast2For(SliceBindType)(handle as never));
});

test("#106 — a captured slice handle round-trips and its mutators re-bind to the DECODER's store", () => {
    initializeStore(new UIStore());
    const bytes = encodeBeast2For(SliceBindType)(bindSlice("slice.cb") as never);

    // Decode against a FRESH store — mutators must operate THERE.
    initializeStore(new UIStore());
    const decoded = decodeBeast2For(SliceBindType, { platform: getRegisteredPlatformImplementations() })(bytes) as unknown as DecodedSlice;

    assert.equal(decoded.read().search.type, "none", "fresh decoder store: no search yet");
    decoded.setSearch(some("hello"));
    assert.equal(decoded.read().search.type, "some", "setSearch wrote to the decoder store");

    decoded.addFilter(variant("string", { fieldId: "id", op: variant("contains", "a") }));
    assert.equal(decoded.read().filters.length, 1, "addFilter appended on the decoder store");
    assert.equal(decoded.isActive(), true, "isActive reflects the decoder store");
});

test("#106 — a decoded handle's data-derived methods resolve the bound rows by key", () => {
    initializeStore(new UIStore());
    const live = bindSlice("slice.rows"); // seeds the store + registers the rows by key
    const bytes = encodeBeast2For(SliceBindType)(live as never);
    const decoded = decodeBeast2For(SliceBindType, { platform: getRegisteredPlatformImplementations() })(bytes) as unknown as DecodedSlice;
    assert.equal(decoded.totalCount(), 2n, "decoded totalCount resolves the live rows registered under the key");
});

test("#170 — a FULLY-populated SliceState survives the beast2 round-trip field-for-field", () => {
    const full = {
        range: some(variant("datetime", { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-03-31T00:00:00Z") })),
        compare: some(variant("previousPeriod", null)),
        filters: [
            variant("string",  { fieldId: "id", op: variant("eq", "a") }),
            variant("integer", { fieldId: "n",  op: variant("gte", 10n) }),
        ],
        cohorts: [{ id: "eu", name: "EU", filters: [variant("string", { fieldId: "id", op: variant("in", new Set(["a", "b"])) })] }],
        activeCohorts: new Set(["eu"]),
        breakdown: some({ fieldId: "id", limit: some(2n) }),
        search: some("hello"),
        visible: some(new Set(["a", "other"])),
        selectedIndex: some(3n),
    };
    const bytes = encodeBeast2For(Slice.Types.State)(full as never);
    const back = decodeBeast2For(Slice.Types.State)(bytes) as unknown as typeof full;

    assert.equal(back.range.type, "some");
    const range = (back.range as { value: { type: string; value: { from: Date; to: Date } } }).value;
    assert.equal(range.type, "datetime");
    assert.equal(range.value.from.getTime(), new Date("2026-01-01T00:00:00Z").getTime());
    assert.equal(range.value.to.getTime(),   new Date("2026-03-31T00:00:00Z").getTime());
    assert.equal((back.compare as { value: { type: string } }).value.type, "previousPeriod");
    assert.equal(back.filters.length, 2);
    assert.equal((back.filters[0] as { value: { op: { value: string } } }).value.op.value, "a");
    assert.equal((back.filters[1] as { value: { op: { value: bigint } } }).value.op.value, 10n);
    assert.equal(back.cohorts.length, 1);
    const cohortSet = (back.cohorts[0]!.filters[0] as { value: { op: { value: Set<string> } } }).value.op.value;
    assert.equal(cohortSet.has("a") && cohortSet.has("b"), true);       // Set MEMBERS survive
    assert.equal(back.activeCohorts.has("eu"), true);
    const bd = (back.breakdown as { value: { fieldId: string; limit: { value: bigint } } }).value;
    assert.equal(bd.fieldId, "id");
    assert.equal(bd.limit.value, 2n);
    assert.equal((back.search as { value: string }).value, "hello");
    const vis = (back.visible as { value: Set<string> }).value;
    assert.equal(vis.has("a") && vis.has("other") && vis.size === 2, true);
    assert.equal((back.selectedIndex as { value: bigint }).value, 3n);
});

test("#106 — SliceImpl ships the backing primitives (decode path)", () => {
    const names = new Set(getRegisteredPlatformImplementations().map(p => p.name));
    for (const name of ["slice_bind", "slice_read", "slice_write", "slice_set_search", "slice_add_filter", "slice_toggle_filter", "slice_facet_groups", "slice_matches", "slice_total_count"]) {
        assert.ok(names.has(name), `platform '${name}' must be registered for handle decode to re-bind`);
    }
});
