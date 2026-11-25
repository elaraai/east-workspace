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

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { BooleanType, OptionType, StringType, StructType, decodeBeast2For, encodeBeast2For, equalFor, none, some } from "@elaraai/east";
import { StateRuntime, UIStore } from "@elaraai/east-ui-components";
import { changeStoredValue, forgetStoredValue, storedCodec, useStoredValue } from "./stored-value.js";

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

/**
 * A store outlives a release — a persistent one across sessions — so a key can
 * hold what an earlier release kept there, of another type: the tools held
 * before they held a link kind. beast2 refuses to read it as today's, and the
 * builder reading it threw as it drew.
 */
describe("a value the store keeps under another type (#1758)", () => {
    /** What an earlier release kept under the key: the tools, before they held a link kind. */
    const encodeEarlier = encodeBeast2For(StructType({ on: BooleanType }));

    beforeEach(() => { StateRuntime.initializeStore(new UIStore()); });
    afterEach(() => { vi.restoreAllMocks(); });

    test("is nothing kept to a reader, said once naming its key, and the reader holds what is written next", () => {
        const said = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        StateRuntime.getStore().write("plan.works.connect", encodeEarlier({ on: true }));
        const reader = renderHook(() => useStoredValue(held, "plan.works.connect"));
        const second = renderHook(() => useStoredValue(held, "plan.works.connect"));
        expect(sameOption(read(reader.result.current[0]), none)).toBe(true);
        expect(sameOption(read(second.result.current[0]), none)).toBe(true);
        expect(said.mock.calls.map((line) => String(line[0]).includes(`"plan.works.connect"`))).toEqual([true]);
        act(() => { reader.result.current[1]({ on: false, link: some("feed") }); });
        expect(sameOption(read(second.result.current[0]), some({ on: false, link: some("feed") }))).toBe(true);
    });

    test("is nothing held to a change of the key, which writes from nothing", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        StateRuntime.getStore().write("plan.press.connect", encodeEarlier({ on: true }));
        changeStoredValue(held, "plan.press.connect", (was) => ({ on: was === undefined, link: none }));
        const stored = decodeBeast2For(HeldType)(StateRuntime.getStore().read("plan.press.connect")!);
        expect(sameHeld(stored, { on: true, link: none })).toBe(true);
    });
});
