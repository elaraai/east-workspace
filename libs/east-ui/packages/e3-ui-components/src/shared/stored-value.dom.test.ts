/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @vitest-environment jsdom
 *
 * A viewer's value in the UI store (`useStoredValue`): nothing until one is
 * written, an East value under its key once it is, one write followed by
 * every reader of the key and by none of another's, and nothing again once it
 * is forgotten (`forgetStoredValue`).
 */

import { beforeEach, describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { BooleanType, OptionType, StringType, StructType, decodeBeast2For, equalFor, none, some } from "@elaraai/east";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import { forgetStoredValue, storedCodec, useStoredValue } from "./stored-value.js";

const HeldType = StructType({ on: BooleanType, link: OptionType(StringType) });
const held = storedCodec(HeldType);
const sameHeld = equalFor(HeldType);
const sameOption = equalFor(OptionType(HeldType));
/** What a reader holds, as an Option: `undefined` is none written. */
const read = (value: ReturnType<typeof held.decode> | undefined) => (value === undefined ? none : some(value));

describe("useStoredValue", () => {
    beforeEach(() => { StateRuntime.initializeStore(new UIStore()); });

    test("holds nothing until a value is written, then the East value, as the store keeps it under the key", () => {
        const reader = renderHook(() => useStoredValue(held, "plan.works.connect"));
        expect(sameOption(read(reader.result.current[0]), none)).toBe(true);
        act(() => { reader.result.current[1]({ on: true, link: some("feed") }); });
        expect(sameOption(read(reader.result.current[0]), some({ on: true, link: some("feed") }))).toBe(true);
        const stored = decodeBeast2For(HeldType)(StateRuntime.getStore().read("plan.works.connect")!);
        expect(sameHeld(stored, { on: true, link: some("feed") })).toBe(true);
    });

    test("one write is followed by every reader of its key, and by no reader of another", () => {
        const first = renderHook(() => useStoredValue(held, "plan.works.connect"));
        const second = renderHook(() => useStoredValue(held, "plan.works.connect"));
        const other = renderHook(() => useStoredValue(held, "plan.press.connect"));
        act(() => { first.result.current[1]({ on: true, link: none }); });
        expect(sameOption(read(second.result.current[0]), some({ on: true, link: none }))).toBe(true);
        expect(sameOption(read(other.result.current[0]), none)).toBe(true);
    });

    test("a reader mounted after the write holds what was written: a remount keeps it", () => {
        const first = renderHook(() => useStoredValue(held, "plan.works.connect"));
        act(() => { first.result.current[1]({ on: false, link: some("feed") }); });
        first.unmount();
        const again = renderHook(() => useStoredValue(held, "plan.works.connect"));
        expect(sameOption(read(again.result.current[0]), some({ on: false, link: some("feed") }))).toBe(true);
    });

    test("a value forgotten is nothing again to every reader of its key, and another key's stands", () => {
        const reader = renderHook(() => useStoredValue(held, "plan.works.connect"));
        const other = renderHook(() => useStoredValue(held, "plan.press.connect"));
        act(() => { reader.result.current[1]({ on: true, link: none }); other.result.current[1]({ on: false, link: none }); });
        act(() => { forgetStoredValue("plan.works.connect"); });
        expect(sameOption(read(reader.result.current[0]), none)).toBe(true);
        expect(StateRuntime.getStore().read("plan.works.connect")).toBeUndefined();
        expect(sameOption(read(other.result.current[0]), some({ on: false, link: none }))).toBe(true);
    });
});
