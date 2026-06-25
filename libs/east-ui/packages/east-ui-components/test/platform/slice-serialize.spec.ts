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

/** Drive the `Slice.bind` impl as the compiler does → a live handle. */
function bindSlice(key: string) {
    const resolver = SliceImpl[1]!.fn!;
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

test("#106 — SliceImpl ships the backing primitives (decode path)", () => {
    const names = new Set(getRegisteredPlatformImplementations().map(p => p.name));
    for (const name of ["slice_bind", "slice_read", "slice_write", "slice_set_search", "slice_add_filter", "slice_matches", "slice_total_count"]) {
        assert.ok(names.has(name), `platform '${name}' must be registered for handle decode to re-bind`);
    }
});
