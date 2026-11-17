/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 */

/**
 * What a builder shows (#1668, `open.ts`), over a page's key: its host's when
 * given — shown until the host changes it, the host told what the builder's
 * own pane asks for, nothing kept — else its own: what it begins with, then
 * what its pane opened, kept as East text for a reload, shown only while it
 * stands, cleared at a sign-out; and one object while it is the same.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { StringType, StructType, none, printFor, some, type ValueTypeOf, type option } from "@elaraai/east";
import { clearKept } from "@elaraai/east-ui-components";
import { keptName, resetKept } from "@elaraai/east-ui-components/internal";
import { openCodec, useOpen } from "./open.js";

const Key = StructType({ project: StringType, page: StringType });
type KeyValue = ValueTypeOf<typeof Key>;
const KEY = openCodec(Key);
const printKey = printFor(Key);

const OVERVIEW: KeyValue = { project: "ops", page: "overview" };
const WEEKLY: KeyValue = { project: "ops", page: "weekly" };
const DETAIL: KeyValue = { project: "ops", page: "detail" };

/** Where the builder keeps its own. */
const STORAGE = "builder.page";
/** What the browser holds for it: East text, as JSON keeps a string. */
const stored = () => window.localStorage.getItem(keptName(STORAGE));

/** Every page stands, but those a test removes. */
const all = () => true;

/** A builder's open page, over what its host gives it and what stands. */
function mount(given: option<KeyValue>, options: { stands?: (kept: KeyValue) => boolean; told?: KeyValue[] | undefined } = {}) {
    const told = "told" in options ? options.told : [];
    const stands = options.stands ?? all;
    const onOpen = told === undefined ? undefined : (next: KeyValue) => { told.push(next); };
    const hook = renderHook(({ from }: { from: option<KeyValue> }) => useOpen({ codec: KEY, storageKey: STORAGE, given: from, first: OVERVIEW, stands, onOpen }),
        { initialProps: { from: given } });
    return { hook, told, shown: () => hook.result.current[0], open: (next: KeyValue) => act(() => { hook.result.current[1](next); }) };
}

beforeEach(() => { window.localStorage.clear(); resetKept(); });
afterEach(cleanup);

describe("what a builder shows — its host's (#1668)", () => {
    test("given what it shows, it shows it until its host changes it: its own pane's ask tells the host, moves nothing, and keeps nothing", () => {
        const { hook, told, shown, open } = mount(some(WEEKLY));
        expect(KEY.equal(shown(), WEEKLY)).toBe(true);
        open(DETAIL);
        expect(told).toEqual([DETAIL]);
        expect(KEY.equal(shown(), WEEKLY)).toBe(true);
        expect(stored()).toBeNull();
        // The host changes it.
        hook.rerender({ from: some(DETAIL) });
        expect(KEY.equal(shown(), DETAIL)).toBe(true);
    });

    test("it is one object while it is the same: a host's value made again, equal, moves nothing that reads it", () => {
        const { hook, shown } = mount(some(WEEKLY));
        const before = shown();
        hook.rerender({ from: some({ project: "ops", page: "weekly" }) });
        expect(shown()).toBe(before);
    });

    test("what a builder kept of its own is not its host's: a host's value is shown whatever the browser holds", () => {
        window.localStorage.setItem(keptName(STORAGE), JSON.stringify(printKey(DETAIL)));
        const { shown } = mount(some(WEEKLY));
        expect(KEY.equal(shown(), WEEKLY)).toBe(true);
    });
});

describe("what a builder shows — its own (#1668)", () => {
    test("given nothing, it shows what it begins with; its pane's ask opens it, tells a host given to tell, and is kept as East text for a reload", () => {
        const { told, shown, open } = mount(none);
        expect(KEY.equal(shown(), OVERVIEW)).toBe(true);
        expect(stored()).toBeNull();
        open(WEEKLY);
        expect(KEY.equal(shown(), WEEKLY)).toBe(true);
        expect(told).toEqual([WEEKLY]);
        expect(stored()).toBe(JSON.stringify(printKey(WEEKLY)));
        // A reload: the page reads storage afresh.
        cleanup();
        resetKept();
        expect(KEY.equal(mount(none).shown(), WEEKLY)).toBe(true);
    });

    test("with no host to tell, its pane's ask still opens it", () => {
        const { shown, open } = mount(none, { told: undefined });
        open(DETAIL);
        expect(KEY.equal(shown(), DETAIL)).toBe(true);
    });

    test("what it kept is shown only while it stands — else what it begins with — and again once it stands", () => {
        window.localStorage.setItem(keptName(STORAGE), JSON.stringify(printKey(WEEKLY)));
        const gone = mount(none, { stands: (kept) => !KEY.equal(kept, WEEKLY) });
        expect(KEY.equal(gone.shown(), OVERVIEW)).toBe(true);
        // Kept still: the record has not been read, say, and holds it after all.
        expect(stored()).toBe(JSON.stringify(printKey(WEEKLY)));
        cleanup();
        resetKept();
        expect(KEY.equal(mount(none).shown(), WEEKLY)).toBe(true);
    });

    test("text the browser holds that is not a value of its type is not shown", () => {
        window.localStorage.setItem(keptName(STORAGE), JSON.stringify("not a key"));
        expect(KEY.equal(mount(none).shown(), OVERVIEW)).toBe(true);
    });

    test("a sign-out clears it: the next person's builder shows what it begins with", () => {
        const { shown, open } = mount(none);
        open(WEEKLY);
        act(() => { clearKept(); });
        expect(KEY.equal(shown(), OVERVIEW)).toBe(true);
        expect(stored()).toBeNull();
    });
});
