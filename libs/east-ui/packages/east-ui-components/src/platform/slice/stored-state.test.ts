/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A slice's state its store keeps under another type (#1758). A store
 * outlives a release — a persistent one across sessions — so a slice's key can
 * hold the state an earlier release wrote: one from before a state held its
 * `resolution`. beast2 refuses to read it as today's, and every read of the
 * slice threw with it. Such a state is nothing kept: the slice reads the state
 * it is bound with, says so once, and holds what is written next.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { IntegerType, StructType, encodeBeast2For, decodeBeast2For, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { DEFAULT_SLICE_STATE, SliceImpl, buildSliceHandle } from "./index.js";
import { getStore, initializeStore } from "../state-runtime.js";
import { UIStore } from "../state-store.js";
import { sliceConfig, stringField } from "../../testing/slice.js";

type State = ValueTypeOf<typeof Slice.Types.State>;

const byName = new Map(SliceImpl.map(p => [p.name, p.fn]));
const call = (name: string, ...args: unknown[]): unknown => (byName.get(name) as (...a: unknown[]) => unknown)(...args);

const encodeState = encodeBeast2For(Slice.Types.State);
const decodeState = decodeBeast2For(Slice.Types.State);
const sameState = equalFor(Slice.Types.State);
const sameCount = equalFor(IntegerType);
/** A slice's state as its store hands it back. */
const read = (key: string) => call("slice_read", key) as State;

const ROWS = [{ name: "Alpha" }, { name: "Beta" }, { name: "Cedar" }];
const CONFIG = sliceConfig({ name: stringField((row: { name: string }) => row.name) }, { searchFieldIds: ["name"] });
/** The state the slice is bound with: a search, which the default state has none of. */
const INITIAL = decodeState(encodeState({ ...DEFAULT_SLICE_STATE, search: some("Beta") }));
const NAMED_ALPHA = variant("string", { fieldId: "name", op: variant("eq", "Alpha") });

/** The state an earlier release kept: today's, before it held its `resolution`. */
const OlderState = StructType(Object.entries(Slice.Types.State.fields).filter(([name]) => name !== "resolution"));
const encodeOlder = encodeBeast2For(OlderState as never) as (state: unknown) => Uint8Array;
/** One such state's bytes, its own buffer: a store keeps the buffer it is given, and a value is said once. */
const older = () => encodeOlder({
    range: none, compare: none, filters: [NAMED_ALPHA], cohorts: [], activeCohorts: new Set<string>(),
    breakdown: none, search: some("stale"), visible: none, selectedIndex: none,
});

afterEach(() => { vi.restoreAllMocks(); });

describe("Slice.bind — a state its store keeps under another type (#1758)", () => {
    test("is nothing kept: the slice reads the state it is bound with, counts by it, and then holds what is written", () => {
        initializeStore(new UIStore());
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        getStore().write("kept.older", older());
        buildSliceHandle("kept.older", CONFIG, INITIAL, ROWS, none);
        // The same slice over a store that keeps nothing: what the older state is to read as.
        buildSliceHandle("kept.nothing", CONFIG, INITIAL, ROWS, none);

        expect(sameState(read("kept.older"), INITIAL)).toBe(true);
        expect(sameCount(call("slice_result_count", "kept.older") as bigint, call("slice_result_count", "kept.nothing") as bigint)).toBe(true);
        expect(sameCount(call("slice_active_count", "kept.older") as bigint, 1n)).toBe(true);

        call("slice_add_filter", "kept.older", NAMED_ALPHA);
        expect(sameState(read("kept.older"), { ...INITIAL, filters: [NAMED_ALPHA] })).toBe(true);
        // What the store keeps now is today's state, which a reader of the bytes reads.
        expect(sameState(decodeState(getStore().read("kept.older")!), { ...INITIAL, filters: [NAMED_ALPHA] })).toBe(true);
    });

    test("a handle whose slice no bind made in its page reads the default state, as it does over a key that keeps nothing", () => {
        initializeStore(new UIStore());
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        getStore().write("kept.unbound", older());
        expect(sameState(read("kept.unbound"), DEFAULT_SLICE_STATE)).toBe(true);
    });

    test("is said once a value, naming its key — never once a read", () => {
        initializeStore(new UIStore());
        const said = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        getStore().write("kept.said", older());
        buildSliceHandle("kept.said", CONFIG, INITIAL, ROWS, none);
        read("kept.said");
        call("slice_result_count", "kept.said");
        read("kept.said");
        expect(said.mock.calls.map((line) => String(line[0]).includes(`"kept.said"`))).toEqual([true]);
    });

    test("a state kept under the slice's own type is read as it is, and nothing is said", () => {
        initializeStore(new UIStore());
        const said = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const kept = decodeState(encodeState({ ...DEFAULT_SLICE_STATE, filters: [NAMED_ALPHA] }));
        getStore().write("kept.own", encodeState(kept));
        buildSliceHandle("kept.own", CONFIG, INITIAL, ROWS, none);
        expect(sameState(read("kept.own"), kept)).toBe(true);
        expect(said.mock.calls).toEqual([]);
    });
});
