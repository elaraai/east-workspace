/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * What a builder shows (#1668, `open.ts`), over a page's key: its host's when
 * given — shown until the host changes it, the host told what the builder's
 * own pane asks for, in a turn of its own, nothing kept — else its own: what
 * it begins with, then what its pane opened, kept as its beast2 for a reload
 * and read once; what it kept from before shown only if it stands, what it
 * opened or has shown held open whatever becomes of it; cleared at a
 * sign-out; and one object while it is the same.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { StringType, StructType, encodeBeast2For, none, some, type ValueTypeOf, type option } from "@elaraai/east";
import { clearKept } from "@elaraai/east-ui-components";
import { keptBytes, keptName, resetKept } from "@elaraai/east-ui-components/internal";
import { openCodec, useOpen, type OpenCodec } from "./open.js";

const Key = StructType({ project: StringType, page: StringType });
type KeyValue = ValueTypeOf<typeof Key>;
const KEY = openCodec(Key);
const encodeKey = encodeBeast2For(Key);

const OVERVIEW: KeyValue = { project: "ops", page: "overview" };
const WEEKLY: KeyValue = { project: "ops", page: "weekly" };
const DETAIL: KeyValue = { project: "ops", page: "detail" };

/** Where the builder keeps its own. */
const STORAGE = "builder.page";
/** What the browser holds for it. */
const stored = () => window.localStorage.getItem(keptName(STORAGE));
/** A key as the browser keeps it: its beast2, as text. */
const keptAs = (key: KeyValue) => keptBytes.encode(encodeKey(key));

/** Every page stands, but those a test removes. */
const all = () => true;

/** A builder's open page, over what its host gives it and what stands. */
function mount(given: option<KeyValue>, options: { stands?: (kept: KeyValue) => boolean; told?: KeyValue[] | undefined; codec?: OpenCodec<KeyValue> } = {}) {
    const told = "told" in options ? options.told : [];
    const stands = options.stands ?? all;
    const codec = options.codec ?? KEY;
    const onOpen = told === undefined ? undefined : (next: KeyValue) => { told.push(next); };
    // `stands` is made each render, as a builder's is each time its record moves.
    const hook = renderHook(({ from }: { from: option<KeyValue> }) => useOpen({
        codec, storageKey: STORAGE, given: from, first: OVERVIEW, stands: (kept) => stands(kept), onOpen,
    }), { initialProps: { from: given } });
    return {
        hook,
        told,
        shown: () => hook.result.current[0],
        /** The builder's own pane asks for a page, and the turn the host is told in passes. */
        open: (next: KeyValue) => act(async () => { hook.result.current[1](next); }),
        /** The builder draws again: its record moved. */
        redraw: () => { hook.rerender({ from: given }); },
    };
}

beforeEach(() => { window.localStorage.clear(); resetKept(); });
afterEach(cleanup);

describe("what a builder shows — its host's (#1668)", () => {
    test("given what it shows, it shows it until its host changes it: its own pane's ask tells the host, moves nothing, and keeps nothing", async () => {
        const { hook, told, shown, open } = mount(some(WEEKLY));
        expect(KEY.equal(shown(), WEEKLY)).toBe(true);
        await open(DETAIL);
        expect(told).toEqual([DETAIL]);
        expect(KEY.equal(shown(), WEEKLY)).toBe(true);
        expect(stored()).toBeNull();
        // The host changes it.
        hook.rerender({ from: some(DETAIL) });
        expect(KEY.equal(shown(), DETAIL)).toBe(true);
    });

    test("the host is told in a turn of its own, after the event that asked: its East never runs inside the pane's click", async () => {
        const { hook, told } = mount(some(WEEKLY));
        act(() => { hook.result.current[1](DETAIL); });
        expect(told).toEqual([]);
        await act(async () => { /* the turn passes */ });
        expect(told).toEqual([DETAIL]);
    });

    test("it is one object while it is the same: a host's value made again, equal, moves nothing that reads it", () => {
        const { hook, shown } = mount(some(WEEKLY));
        const before = shown();
        hook.rerender({ from: some({ project: "ops", page: "weekly" }) });
        expect(shown()).toBe(before);
    });

    test("what a builder kept of its own is not its host's: a host's value is shown whatever the browser holds", () => {
        window.localStorage.setItem(keptName(STORAGE), keptAs(DETAIL));
        const { shown } = mount(some(WEEKLY));
        expect(KEY.equal(shown(), WEEKLY)).toBe(true);
    });
});

describe("what a builder shows — its own (#1668)", () => {
    test("given nothing, it shows what it begins with; its pane's ask opens it, tells a host given to tell, and is kept as its beast2 for a reload", async () => {
        const { told, shown, open } = mount(none);
        expect(KEY.equal(shown(), OVERVIEW)).toBe(true);
        expect(stored()).toBeNull();
        await open(WEEKLY);
        expect(KEY.equal(shown(), WEEKLY)).toBe(true);
        expect(told).toEqual([WEEKLY]);
        expect(stored()).toBe(keptAs(WEEKLY));
        // A reload: the page reads storage afresh.
        cleanup();
        resetKept();
        expect(KEY.equal(mount(none).shown(), WEEKLY)).toBe(true);
    });

    test("with no host to tell, its pane's ask still opens it", async () => {
        const { shown, open } = mount(none, { told: undefined });
        await open(DETAIL);
        expect(KEY.equal(shown(), DETAIL)).toBe(true);
    });

    test("what its own pane opens is shown at once, standing or not yet: a query saved under a new name, before its record reads it back", async () => {
        const standing = new Set(["overview"]);
        const { shown, open, redraw } = mount(none, { stands: (kept) => standing.has(kept.page) });
        await open(WEEKLY);
        expect(KEY.equal(shown(), WEEKLY)).toBe(true);
        // The record reads it back, and later loses it: it is held open either way.
        standing.add("weekly");
        redraw();
        standing.delete("weekly");
        redraw();
        expect(KEY.equal(shown(), WEEKLY)).toBe(true);
    });

    test("what it kept from before is shown only if it stands — else what it begins with — and again once it stands", () => {
        window.localStorage.setItem(keptName(STORAGE), keptAs(WEEKLY));
        const gone = mount(none, { stands: (kept) => !KEY.equal(kept, WEEKLY) });
        expect(KEY.equal(gone.shown(), OVERVIEW)).toBe(true);
        // Kept still: the record has not been read, say, and holds it after all.
        expect(stored()).toBe(keptAs(WEEKLY));
        cleanup();
        resetKept();
        expect(KEY.equal(mount(none).shown(), WEEKLY)).toBe(true);
    });

    test("what it kept and found standing it holds open: removed elsewhere while open, it is still what the builder shows — until a reload, which begins again", () => {
        window.localStorage.setItem(keptName(STORAGE), keptAs(WEEKLY));
        const standing = new Set(["overview", "weekly"]);
        const { shown, redraw } = mount(none, { stands: (kept) => standing.has(kept.page) });
        expect(KEY.equal(shown(), WEEKLY)).toBe(true);
        standing.delete("weekly");
        redraw();
        expect(KEY.equal(shown(), WEEKLY)).toBe(true);
        cleanup();
        resetKept();
        expect(KEY.equal(mount(none, { stands: (kept) => standing.has(kept.page) }).shown(), OVERVIEW)).toBe(true);
    });

    test("what it kept is read once, however often what stands is asked again", () => {
        window.localStorage.setItem(keptName(STORAGE), keptAs(WEEKLY));
        let reads = 0;
        const counting: OpenCodec<KeyValue> = { ...KEY, decode: (bytes) => { reads += 1; return KEY.decode(bytes); } };
        const { shown, redraw } = mount(none, { codec: counting });
        for (let i = 0; i < 5; i++) redraw();
        expect(KEY.equal(shown(), WEEKLY)).toBe(true);
        expect(reads).toBe(1);
    });

    test("what the browser holds that is not a value of its type is not shown", () => {
        // Text that is no beast2 at all, and the beast2 of another type.
        for (const text of ["not a key", keptBytes.encode(encodeBeast2For(StringType)("weekly"))]) {
            window.localStorage.setItem(keptName(STORAGE), text);
            resetKept();
            expect(KEY.equal(mount(none).shown(), OVERVIEW)).toBe(true);
            cleanup();
        }
    });

    test("a sign-out clears it: the next person's builder shows what it begins with", async () => {
        const { shown, open } = mount(none);
        await open(WEEKLY);
        act(() => { clearKept(); });
        expect(KEY.equal(shown(), OVERVIEW)).toBe(true);
        expect(stored()).toBeNull();
    });
});
