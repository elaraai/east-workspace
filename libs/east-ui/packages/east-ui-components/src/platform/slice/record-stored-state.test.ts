/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A record Slice's narrowing its store keeps under another type (#1758). A
 * store outlives a release — a persistent one across sessions — so a Slice's
 * key can hold the narrowing an earlier release wrote: one from when a choice
 * could be a `window`. A narrowing is a Dict of choices, which beast2 reads at
 * exactly its written type, so every read of the Slice threw with it. Such a
 * narrowing is nothing kept: the binding seeds its start over it, the Slice
 * reads that, says so once, and holds what is written next.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import {
    ArrayType, DictType, NullType, OptionType, StringType, StructType, VariantType, decodeBeast2For, encodeBeast2For, equalFor,
    none, some, toEastTypeValue, variant, type ValueTypeOf,
} from "@elaraai/east";
import { RecordSliceChoiceType, RecordSliceConfigType, RecordSliceStateType, type RecordSliceBinding } from "@elaraai/east-ui/internal";
import { RecordSliceImpl, recordSliceSeeded } from "./record.js";
import { getStore, initializeStore } from "../state-runtime.js";
import { UIStore } from "../state-store.js";

type State = ValueTypeOf<RecordSliceStateType>;

const encodeState = encodeBeast2For(RecordSliceStateType);
const decodeState = decodeBeast2For(RecordSliceStateType);
const sameState = equalFor(RecordSliceStateType);
const stateOf = (state: State): State => decodeState(encodeState(state));

/** The binding's type, and the window of joined entries its Slice pages: what the record arm's operations are resolved at. */
const Source = StructType({ id: StringType });
const Window = ArrayType(StructType({ key: StringType, row: OptionType(StructType({ status: StringType })) }));
const TYPES = [toEastTypeValue(Source), toEastTypeValue(Window)];

/** A binding nothing is read through: these tests read the narrowing alone. */
const SOURCE: RecordSliceBinding & { indexes: null; nested: null } = {
    id: "orders", recordId: "orders", defaultIndex: "primary", revision: () => some("A"), refresh: () => null,
    total: () => some(0n), entryKeys: () => [], seek: () => none, page: () => none, indexes: null, nested: null,
};
const CONFIG = decodeBeast2For(RecordSliceConfigType)(encodeBeast2For(RecordSliceConfigType)({
    fields: [], indexes: [], range: none, search: [], presets: [], scope: new Map(),
}));
/** The narrowing the Slice is bound with: by the week, which no other state here is. */
const INITIAL = stateOf({ where: new Map(), preset: none, resolution: some(variant("week", null)) });
const BY_MONTH = stateOf({ where: new Map(), preset: none, resolution: some(variant("month", null)) });

/** The narrowing an earlier release kept: its choices could be a `window` (#1385), which a read by area took over (#1432). */
const OlderState = StructType({
    where: DictType(StringType, VariantType({ ...RecordSliceChoiceType.cases, window: NullType })),
    preset: RecordSliceStateType.fields.preset,
    resolution: RecordSliceStateType.fields.resolution,
});
const encodeOlder = encodeBeast2For(OlderState);
/** One such narrowing's bytes, its own buffer: a store keeps the buffer it is given, and a value is said once. */
const older = () => encodeOlder({ where: new Map([["status", variant("values", ['"late"'])]]), preset: none, resolution: none });

const byName = new Map(RecordSliceImpl.map(p => [p.name, p.fn]));
/** One of the record arm's operations over the binding of `key`, as a handle's method calls it. */
function op(name: string, key: string, ...args: unknown[]): unknown {
    const resolve = byName.get(`slice_record_${name}`) as (...types: unknown[]) => (...args: unknown[]) => unknown;
    return resolve(...TYPES)(key, SOURCE, CONFIG, INITIAL, ...args);
}
const read = (key: string) => op("read", key) as State;

afterEach(() => { vi.restoreAllMocks(); });

describe("a record Slice — a narrowing its store keeps under another type (#1758)", () => {
    test("is nothing kept: the binding seeds its start over it, which the Slice reads as its seed; then it holds what is written", () => {
        initializeStore(new UIStore());
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        getStore().write("orders.older", older());

        expect(sameState(read("orders.older"), INITIAL)).toBe(true);
        // What a builder restoring its own view asks: the Slice holds its author's start, which nothing has written over.
        expect(recordSliceSeeded({ key: "orders.older" })).toBe(true);
        expect(sameState(decodeState(getStore().read("orders.older")!), INITIAL)).toBe(true);

        op("write", "orders.older", BY_MONTH);
        expect(sameState(read("orders.older"), BY_MONTH)).toBe(true);
        expect(recordSliceSeeded({ key: "orders.older" })).toBe(false);
    });

    test("one that turns up under the key once the Slice is bound reads as its start too, said once a value — never once a read", () => {
        initializeStore(new UIStore());
        const said = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        op("write", "orders.later", BY_MONTH);
        getStore().write("orders.later", older());

        expect(sameState(read("orders.later"), INITIAL)).toBe(true);
        expect(sameState(read("orders.later"), INITIAL)).toBe(true);
        expect(said.mock.calls.map((line) => String(line[0]).includes(`"orders.later"`))).toEqual([true]);

        op("write", "orders.later", BY_MONTH);
        expect(sameState(read("orders.later"), BY_MONTH)).toBe(true);
    });

    test("a narrowing kept under the Slice's own type stands: the binding seeds nothing over it, and nothing is said", () => {
        initializeStore(new UIStore());
        const said = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        getStore().write("orders.own", encodeState(BY_MONTH));

        expect(sameState(read("orders.own"), BY_MONTH)).toBe(true);
        expect(recordSliceSeeded({ key: "orders.own" })).toBe(false);
        expect(said.mock.calls).toEqual([]);
    });
});
