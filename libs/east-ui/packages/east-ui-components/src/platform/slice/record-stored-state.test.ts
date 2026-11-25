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
import { DictType, NullType, StringType, StructType, VariantType, decodeBeast2For, encodeBeast2For, equalFor, none, some, variant } from "@elaraai/east";
import { RecordSliceChoiceType, RecordSliceStateType } from "@elaraai/east-ui/internal";
import { recordSliceSeeded } from "./record.js";
import { recordArm, recordState } from "./record-arm.test-utils.js";
import { getStore, initializeStore } from "../state-runtime.js";
import { UIStore } from "../state-store.js";

const encodeState = encodeBeast2For(RecordSliceStateType);
const decodeState = decodeBeast2For(RecordSliceStateType);
const sameState = equalFor(RecordSliceStateType);

/** The narrowing the Slice is bound with: by the week, which no other state here is. */
const INITIAL = recordState({ where: new Map(), preset: none, resolution: some(variant("week", null)) });
const BY_MONTH = recordState({ where: new Map(), preset: none, resolution: some(variant("month", null)) });
/** The Slice's operations, over a record of orders it offers no field of. */
const { op, read } = recordArm(StructType({ status: StringType }), { fields: [], indexes: [], range: none, search: [], presets: [], scope: new Map() }, INITIAL);

/** The narrowing an earlier release kept: its choices could be a `window` (#1385), which a read by area took over (#1432). */
const OlderState = StructType({
    where: DictType(StringType, VariantType({ ...RecordSliceChoiceType.cases, window: NullType })),
    preset: RecordSliceStateType.fields.preset,
    resolution: RecordSliceStateType.fields.resolution,
});
const encodeOlder = encodeBeast2For(OlderState);
/** One such narrowing's bytes, its own buffer: a store keeps the buffer it is given, and a value is said once. */
const older = () => encodeOlder({ where: new Map([["status", variant("values", ['"late"'])]]), preset: none, resolution: none });

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
