/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The page cache a paged view reads by (`page-reads.ts`), which the dataset
 * preview and the query builder's paged result share (#1113): each page read
 * once while it is wanted; those far from the window let go past the most
 * held, and read again when they are wanted again; a page that lands for a
 * collection no longer shown, or after the pages started afresh, lands
 * nothing; a page that cannot be read says why, once, and is read again
 * when it is wanted again; and a view that asks from an effect asks again
 * once the pages start afresh, and only then.
 */

import { describe, expect, test } from "vitest";
import { useEffect } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePageReads, type PageReader } from "./page-reads.js";

/** A read the test settles: the page it reads, whether it still lands, and how it ends. */
interface Asked {
    readonly page: number;
    readonly live: () => boolean;
    land(value: string | undefined): void;
    fail(error: Error): void;
}

/** A reader whose reads the test settles, each as it was asked. */
function reader(): { asked: Asked[]; read: PageReader<string>["read"] } {
    const asked: Asked[] = [];
    return {
        asked,
        read: (page, live) => new Promise((resolve, reject) => {
            asked.push({ page, live, land: resolve, fail: reject });
        }),
    };
}

/** A view that asks for its first page from an effect, as the dataset preview asks for the page that holds its totals. */
function useFirstPage(identity: string, read: PageReader<string>["read"]) {
    const reads = usePageReads({ identity, read, retain: 8 });
    const { need } = reads;
    useEffect(() => { need(0, 0); }, [need]);
    return reads;
}

describe("usePageReads", () => {
    test("reads each page once while it is wanted, and shows what lands", async () => {
        const { asked, read } = reader();
        const { result } = renderHook(() => usePageReads({ identity: "a", read, retain: 8 }));
        act(() => {
            result.current.need(0, 2);
            result.current.need(1, 3);
        });
        expect(asked.map((a) => a.page)).toEqual([0, 1, 2, 3]);
        await waitFor(() => expect(result.current.loading).toBe(4));
        await act(async () => { asked[1]!.land("one"); });
        await waitFor(() => expect([...result.current.pages]).toEqual([[1, "one"]]));
        expect(result.current.loading).toBe(3);
        act(() => { result.current.need(1, 1); });
        expect(asked, "a page that landed is not read again").toHaveLength(4);
    });

    test("lets go of the pages far from the window past the most held, and reads one again once it is wanted", async () => {
        const { asked, read } = reader();
        const { result } = renderHook(() => usePageReads({ identity: "a", read, retain: 2 }));
        act(() => { result.current.need(0, 3); });
        await act(async () => { for (const a of asked) a.land(`p${a.page}`); });
        await waitFor(() => expect(result.current.pages.size).toBe(4));
        act(() => { result.current.keep(0, 1); });
        await waitFor(() => expect([...result.current.pages.keys()]).toEqual([0, 1]));
        const kept = result.current.pages;
        act(() => { result.current.keep(0, 1); });
        expect(result.current.pages, "under the most held, the same pages stay").toBe(kept);
        act(() => { result.current.need(3, 3); });
        expect(asked.map((a) => a.page)).toEqual([0, 1, 2, 3, 3]);
    });

    test("lands nothing for a collection no longer shown, nor after the pages start afresh", async () => {
        const { asked, read } = reader();
        const { result, rerender } = renderHook(({ identity }) => usePageReads({ identity, read, retain: 8 }), { initialProps: { identity: "a" } });
        act(() => { result.current.need(0, 0); });
        rerender({ identity: "b" });
        expect(asked[0]!.live()).toBe(false);
        await act(async () => { asked[0]!.land("a's"); });
        expect(result.current.pages.size).toBe(0);
        // The new collection's own page is read afresh.
        act(() => { result.current.need(0, 1); });
        expect(asked.map((a) => a.page)).toEqual([0, 0, 1]);
        act(() => { result.current.reset(new Map([[0, "seed"]])); });
        await act(async () => { asked[1]!.land("b's"); asked[2]!.land("b's 1"); });
        expect([...result.current.pages]).toEqual([[0, "seed"]]);
        expect(result.current.loading).toBe(0);
    });

    test("says why a page could not be read, once, and reads it again when it is wanted again", async () => {
        const { asked, read } = reader();
        const { result } = renderHook(() => usePageReads({ identity: "a", read, retain: 8 }));
        act(() => { result.current.need(0, 1); });
        await act(async () => {
            asked[0]!.fail(new Error("first"));
            asked[1]!.fail(new Error("second"));
        });
        await waitFor(() => expect(result.current.failure?.message).toBe("first"));
        expect(result.current.loading).toBe(0);
        act(() => { result.current.need(0, 0); });
        expect(asked.map((a) => a.page)).toEqual([0, 1, 0]);
        // A page that lands nothing is read again too.
        await act(async () => { asked[2]!.land(undefined); });
        act(() => { result.current.need(0, 0); });
        expect(asked.map((a) => a.page)).toEqual([0, 1, 0, 0]);
    });

    test("is asked again from a view's effect once the pages start afresh, and only then", async () => {
        const { asked, read } = reader();
        const { result, rerender } = renderHook(({ identity }) => useFirstPage(identity, read), { initialProps: { identity: "a" } });
        expect(asked.map((a) => a.page)).toEqual([0]);
        // A page that landed nothing, as one refused as stale does, and the same pages rendered again: no ask, so a
        // stale page is not read in a loop.
        await act(async () => { asked[0]!.land(undefined); });
        rerender({ identity: "a" });
        expect(asked).toHaveLength(1);
        // Another collection, as a dataset's new value is: its first page.
        rerender({ identity: "b" });
        expect(asked.map((a) => a.page)).toEqual([0, 0]);
        // The pages started afresh, as a trimmed page starts them: asked again.
        await act(async () => { result.current.reset(); });
        expect(asked.map((a) => a.page)).toEqual([0, 0, 0]);
    });
});
