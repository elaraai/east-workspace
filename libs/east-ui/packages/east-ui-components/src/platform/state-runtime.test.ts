/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * `State.bind`'s read over what its store keeps under another type (#1758).
 * A store outlives a release — a persistent one across sessions, a page left
 * open across a deploy — so a key can hold a value written under the type an
 * earlier release gave it: a saved query before it held its sources and tags.
 * Such a value is nothing kept: the state reads its default, says so once,
 * and holds what is written next. The read threw before, and the page's
 * function with it.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { East, IntegerType, NullType, OptionType, StringType, decodeBeast2For, encodeBeast2For, equalFor, none, printType, some } from "@elaraai/east";
import { State } from "@elaraai/east-ui/internal";
import { decodeStored, getStore, initializeStore } from "./state-runtime.js";
import { getRegisteredPlatformImplementations } from "./registry.js";
import { UIStore } from "./state-store.js";

const KEY = "state-runtime.test.count";
const integerEqual = equalFor(IntegerType);
const sameText = equalFor(OptionType(StringType));
/** What a read of the store's bytes gave, as an Option: `undefined` is nothing kept. */
const kept = (value: string | undefined) => (value === undefined ? none : some(value));

/** A page's read of the state: bound at an Integer, starting at 7. */
const read = East.compile(East.function([], IntegerType, ($) => {
    const count = $.let(State.bind([IntegerType], KEY, 7n));
    return count.read();
}), getRegisteredPlatformImplementations());

/** A page's write of it. */
const write = East.compile(East.function([IntegerType], NullType, ($, next) => {
    const count = $.let(State.bind([IntegerType], KEY, 7n));
    $(count.write(next));
}), getRegisteredPlatformImplementations());

afterEach(() => { vi.restoreAllMocks(); });

describe("State.bind — a value its store keeps under another type (#1758)", () => {
    test("is nothing kept: the state reads its default, and then what is written", () => {
        initializeStore(new UIStore());
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        // An earlier release kept the count as text.
        getStore().write(KEY, encodeBeast2For(StringType)("seven"));
        expect(integerEqual(read(), 7n)).toBe(true);
        write(9n);
        expect(integerEqual(read(), 9n)).toBe(true);
    });

    test("is said once a value, naming its key — never once a read", () => {
        initializeStore(new UIStore());
        const said = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        getStore().write(KEY, encodeBeast2For(StringType)("seven"));
        read();
        read();
        expect(said.mock.calls.map((call) => String(call[0]).includes(`"${KEY}"`))).toEqual([true]);
    });

    test("a value kept under the state's own type is read as it is, and nothing is said", () => {
        initializeStore(new UIStore());
        const said = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        getStore().write(KEY, encodeBeast2For(IntegerType)(3n));
        expect(integerEqual(read(), 3n)).toBe(true);
        expect(said.mock.calls).toEqual([]);
    });
});

describe("decodeStored — what a store keeps under a key, read as a type (#1758)", () => {
    const asInteger = decodeBeast2For(IntegerType);
    const asText = decodeBeast2For(StringType);

    test("a value is nothing kept to the type it does not read as alone: a reader of the type it was written under still reads it", () => {
        const said = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const bytes = encodeBeast2For(StringType)("seven");
        // Two readers share the key by mistake, one at an Integer: it is told nothing is kept, and said so once.
        expect(decodeStored(KEY, bytes, printType(IntegerType), asInteger)).toBeUndefined();
        expect(decodeStored(KEY, bytes, printType(IntegerType), asInteger)).toBeUndefined();
        expect(said.mock.calls.length).toBe(1);
        // The reader at text reads what it wrote.
        expect(sameText(kept(decodeStored(KEY, bytes, printType(StringType), asText)), some("seven"))).toBe(true);
        expect(said.mock.calls.length).toBe(1);
    });
});
