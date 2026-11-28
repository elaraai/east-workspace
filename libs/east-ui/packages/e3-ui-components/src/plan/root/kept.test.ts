/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the Plan's modules load east-ui-components' entry,
 * which needs one as it loads (#1177).
 *
 * The canvas's own paged rows, each window kept while what it is made from
 * holds (#1712, #1713): a window is asked of the source under the layer once
 * while the source, its revision, its narrowing and the series shown hold, and
 * again as any of them moves; a window in flight is kept by nothing, and of
 * more windows than the layer keeps the one asked longest ago is asked again.
 * Every other part of the source is its own. Over the nested series' wrapper,
 * the event kinds' wrapper over it and the cells' reader reading it, new events
 * and the reader's reads make no window's rows again, and a series switched is
 * a new revision to the paging driver whatever the events (#1795). Without
 * readers that read the windows again, the roots are the ones given.
 */

import { describe, test, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { SortedMap, StringType, compareFor, none, some, variant } from "@elaraai/east";
import { useSliceReactivity, useTrackedEvaluation } from "@elaraai/east-ui-components";
import { getStore, windowedSourceOf } from "@elaraai/east-ui-components/internal";
import type { PlanRootValue, PlanWireBlock } from "../model.js";
import type { PlanPagedSourceValue } from "../use-plan-paging.js";
import { usePlanEventRoot, type PlanEventLead, type PlanEventPlacedValue, type PlanEventRows } from "./events.js";
import { KEPT_WINDOWS, usePlanKeptRoot } from "./kept.js";
import { usePlanNestedRoot, type PlanNestedLead } from "./nested.js";

const compareString = compareFor(StringType);

/** A window's rows: none are read here, only whether a source was asked to make them. */
const BLOCKS = [] as unknown as PlanWireBlock[];

/** A root whose own rows are `rows`, its series picked under the State key given, or not picked. */
const rootOf = (rows: unknown, pick?: string) =>
    ({ rows, links: [], pick: pick === undefined ? none : some({ key: pick }) }) as unknown as PlanRootValue;

/** The source a root's rows are read through. */
const sourceOf = (root: PlanRootValue) => windowedSourceOf(root.rows) as PlanPagedSourceValue;

/** A source whose windows say where they were asked; `landed` says whether one has landed. */
const counting = (pages: number[], landed: () => boolean = () => true) =>
    (offset: bigint) => { pages.push(Number(offset)); return landed() ? some({ rows: BLOCKS, entries: [] }) : none; };

/** A pinned source at a revision, its windows counted. */
const pinnedSource = (pages: number[], revision = "D1", landed?: () => boolean) => ({
    id: "data-window", page: counting(pages, landed), total: () => some(2_000n), seek: none,
    revision: () => some(revision), refresh: () => null,
});

/** A live source the rail narrows, at the record's revision and narrowing given, its windows counted. */
const liveSource = (record: { revision: string; narrowing: string }, pages: number[]) => ({
    id: "rows-narrowed", page: counting(pages), total: () => some(2_000n), seek: none,
    revision: () => some(record.revision), refresh: () => null, query: () => record.narrowing,
});

describe("the canvas's own rows, each window kept while what it is made from holds (#1712)", () => {
    test("a window is asked of the source once while the source, its revision and its narrowing hold — the same window each time — and again as either text moves", () => {
        const record = { revision: "R1", narrowing: "hall: Hall 2" };
        const pages: number[] = [];
        const root = rootOf(variant("live", liveSource(record, pages)));
        const { result } = renderHook(() => usePlanKeptRoot(root, root, true));
        const source = () => sourceOf(result.current.data);
        expect(result.current.data.rows.type).toBe("live");
        const first = source().page(0n, 200n);
        const again = source().page(0n, 200n);
        expect(pages).toEqual([0]);
        // The same window: what a reader keeps by its rows' identity holds.
        expect(again.type === "some" ? again.value : undefined).toBe(first.type === "some" ? first.value : undefined);
        // Another window is asked for itself.
        source().page(200n, 200n);
        expect(pages).toEqual([0, 200]);
        // The record moves: asked again; and kept again while nothing moves.
        record.revision = "R2";
        source().page(0n, 200n);
        source().page(0n, 200n);
        expect(pages).toEqual([0, 200, 0]);
        // A choice on the rail: asked again.
        record.narrowing = "hall: Hall 3";
        source().page(0n, 200n);
        expect(pages).toEqual([0, 200, 0, 0]);
    });

    test("a series the viewer switches on or off asks the source again, whose revision does not move: the root's page function makes a window with the series shown", () => {
        const PICK = "plan.kept.test.series";
        const pages: number[] = [];
        const root = rootOf(variant("pinned", pinnedSource(pages)), PICK);
        const { result } = renderHook(() => usePlanKeptRoot(root, root, true));
        const source = () => sourceOf(result.current.data);
        source().page(0n, 200n);
        source().page(0n, 200n);
        expect(pages).toEqual([0]);
        // The Series tab switches a series off: its pick's state is written.
        act(() => { getStore().write(PICK, new Uint8Array([1])); });
        source().page(0n, 200n);
        source().page(0n, 200n);
        expect(pages).toEqual([0, 0]);
    });

    test("a reader handed a kept window is read again as the viewer switches a series, as one handed the source's own window is — the cells' reader among them", () => {
        const PICK = "plan.kept.test.tracked";
        const pages: number[] = [];
        const root = rootOf(variant("pinned", pinnedSource(pages)), PICK);
        const { result } = renderHook(() => usePlanKeptRoot(root, root, true));
        const source = sourceOf(result.current.data);
        source.page(0n, 200n);
        // A reader whose read is tracked, handed the window kept: the source makes nothing for it.
        let reads = 0;
        const read = () => { reads += 1; return source.page(0n, 200n); };
        renderHook(() => useTrackedEvaluation(read));
        expect([reads, pages]).toEqual([1, [0]]);
        // A series switched: the reader is read again, and the source asked for the window with the series shown.
        act(() => { getStore().write(PICK, new Uint8Array([1])); });
        expect([reads, pages]).toEqual([2, [0, 0]]);
    });

    test("another source the same rows are read from — the root evaluated again — keeps the wrapper the driver holds, and is asked for itself", () => {
        const pages: number[] = [];
        const src = pinnedSource(pages);
        const { result, rerender } = renderHook(({ root }) => usePlanKeptRoot(root, root, true), { initialProps: { root: rootOf(variant("pinned", src)) } });
        const wrapper = sourceOf(result.current.data);
        wrapper.page(0n, 200n);
        rerender({ root: rootOf(variant("pinned", { ...src })) });
        expect(sourceOf(result.current.data)).toBe(wrapper);
        wrapper.page(0n, 200n);
        expect(pages).toEqual([0, 0]);
    });

    test("a window in flight is kept by nothing, and of more windows than the layer keeps the one asked longest ago is asked again", () => {
        const pages: number[] = [];
        let landed = false;
        const root = rootOf(variant("pinned", pinnedSource(pages, "D1", () => landed)));
        const { result } = renderHook(() => usePlanKeptRoot(root, root, true));
        const source = () => sourceOf(result.current.data);
        expect(source().page(0n, 200n)).toEqual(none);
        landed = true;
        expect(source().page(0n, 200n).type).toBe("some");
        expect(pages).toEqual([0, 0]);
        // As many windows more as it keeps: the first, asked longest ago, is let go and asked again.
        expect(KEPT_WINDOWS).toBe(8);
        for (let w = 1; w <= KEPT_WINDOWS; w++) source().page(BigInt(w * 200), 200n);
        source().page(0n, 200n);
        expect(pages.filter((offset) => offset === 0)).toHaveLength(3);
        // The windows asked since are kept.
        const asked = pages.length;
        source().page(BigInt(KEPT_WINDOWS * 200), 200n);
        expect(pages).toHaveLength(asked);
    });

    test("the windows its reader says it holds are kept however many they are, and of those it has let go no more than the layer keeps beside them (#1712)", () => {
        const pages: number[] = [];
        const root = rootOf(variant("pinned", pinnedSource(pages)));
        const { result } = renderHook(() => usePlanKeptRoot(root, root, true));
        const source = () => sourceOf(result.current.data);
        const windows = (from: number, count: number) => Array.from({ length: count }, (_x, i) => BigInt((from + i) * 200));
        // The paging driver's pass at a revision: what it holds, said first, then each window of it, in order.
        const pass = (held: readonly bigint[]) => { source().retain!(held); for (const offset of held) source().page(offset, 200n); };
        const run = windows(0, 15);
        expect(run.length).toBeGreaterThan(KEPT_WINDOWS);
        pass(run);
        // New events: every window it holds is read again, and none reaches the source.
        pass(run);
        pass(run);
        expect(pages).toHaveLength(run.length);
        // The view goes far on: the fifteen it held are let go, and as many again are held in their place.
        pass(windows(15, 15));
        expect(pages).toHaveLength(2 * run.length);
        // Of those let go, the ones asked longest ago are the source's to make again; the last few are kept still.
        source().page(0n, 200n);
        expect(pages.filter((offset) => offset === 0)).toHaveLength(2);
        const asked = pages.length;
        source().page(BigInt(14 * 200), 200n);
        expect(pages).toHaveLength(asked);
    });

    test("every other part of the source is its own, as it has it: a paged source names no revision, a live one its revision and its narrowing, as they move", () => {
        const plain = { id: "rows-paged", page: counting([]), total: () => some(2n), seek: none };
        const paged = rootOf(variant("paged", plain));
        const { result: ofPaged } = renderHook(() => usePlanKeptRoot(paged, paged, true));
        expect(ofPaged.current.data.rows.type).toBe("paged");
        expect([sourceOf(ofPaged.current.data).revision, sourceOf(ofPaged.current.data).query, sourceOf(ofPaged.current.data).refresh]).toEqual([undefined, undefined, undefined]);
        const record = { revision: "R1", narrowing: "hall: Hall 2" };
        const live = rootOf(variant("live", liveSource(record, [])));
        const { result: ofLive } = renderHook(() => usePlanKeptRoot(live, live, true));
        const source = sourceOf(ofLive.current.data);
        expect([source.id, source.revision?.(), source.query?.(), source.total()]).toEqual(["rows-narrowed", some("R1"), "hall: Hall 2", some(2_000n)]);
        record.revision = "R2";
        record.narrowing = "hall: Hall 3";
        expect([source.revision?.(), source.query?.()]).toEqual([some("R2"), "hall: Hall 3"]);
    });

    test("without readers that read the windows again — a Plan of no event kinds — the roots are the ones given", () => {
        const root = rootOf(variant("pinned", pinnedSource([])));
        const { result } = renderHook(() => usePlanKeptRoot(root, root, false));
        expect([result.current.value, result.current.data]).toEqual([root, root]);
        expect(result.current.data).toBe(root);
    });
});

describe("over the nested series' wrapper, read by the event kinds' wrapper and the cells' reader (#1713)", () => {
    /** No event placed. */
    const NOTHING_PLACED = { on: new SortedMap([], compareString), lost: new SortedMap([], compareString) } as unknown as PlanEventPlacedValue;
    /** The events at a version, placed for days. */
    const leadAt = (version: number): PlanEventLead =>
        ({ placed: NOTHING_PLACED, shading: new SortedMap([], compareString), cells: undefined, version, error: undefined, period: "day", cellsPeriod: "day" });
    /** What the nested reader read, at a version. */
    const readAt = (version: number) => ({
        cells: new Uint8Array(), shading: new SortedMap([], compareString), parents: new Map(), notices: [], version, reading: false,
    }) as unknown as PlanNestedLead;
    /** The session's drafted rows, at a version. */
    const draftedAt = (version: number) => ({ drafts: new Map<string, Uint8Array>(), version });

    test("new events, and the reader's reads, make no window's rows again; what the nested wrapper draws with moving makes them once more, for both", () => {
        const made: number[] = [];
        const record = { revision: "R1" };
        const src = {
            id: "rows-window", page: () => some({ rows: BLOCKS, entries: [] }), total: () => some(2n), seek: none,
            revision: () => some(record.revision), refresh: () => null,
        };
        // The nested wrapper makes each window's rows through the seam: what counts here is how often it is asked to.
        const seam = { rows: (offset: bigint) => { made.push(Number(offset)); return some(BLOCKS); } };
        const root = { rows: variant("pinned", src), links: [], nested: some(seam), pick: none } as unknown as PlanRootValue;
        const events: PlanEventRows = { seam: { placed: () => none, place: (blocks) => blocks }, landings: [], paged: true };
        const { result, rerender } = renderHook(({ cells, drafts, lead }) => {
            const nested = usePlanNestedRoot(root, root, cells, drafts);
            const kept = usePlanKeptRoot(nested.value, nested.data, true);
            return { kept, shown: usePlanEventRoot(kept.value, kept.data, lead, events) };
        }, { initialProps: { cells: readAt(1), drafts: draftedAt(0), lead: leadAt(1) } });
        // The paging driver's read, through the event kinds' wrapper; and the cells' reader's, of the kept rows.
        const driver = () => sourceOf(result.current.shown.data).page(0n, 200n);
        const reader = () => sourceOf(result.current.kept.value).page(0n, 200n);
        driver();
        reader();
        reader();
        expect(made).toEqual([0]);
        // New events, twice: no row made again, for either.
        rerender({ cells: readAt(1), drafts: draftedAt(0), lead: leadAt(2) });
        driver();
        reader();
        rerender({ cells: readAt(1), drafts: draftedAt(0), lead: leadAt(3) });
        driver();
        reader();
        expect(made).toEqual([0]);
        // What the nested reader read moves, then the drafts, then the record: once more each, whichever reads first.
        rerender({ cells: readAt(2), drafts: draftedAt(0), lead: leadAt(3) });
        driver();
        reader();
        expect(made).toEqual([0, 0]);
        rerender({ cells: readAt(2), drafts: draftedAt(1), lead: leadAt(3) });
        reader();
        driver();
        expect(made).toEqual([0, 0, 0]);
        record.revision = "R2";
        driver();
        reader();
        expect(made).toEqual([0, 0, 0, 0]);
    });

    test("a series the viewer switches is a new revision to the paging driver, the events as they were — the cells' reader reading no window, its view of no row — and each window is asked of the source again, with the series shown (#1795)", () => {
        const PICK = "plan.kept.test.revision";
        const pages: number[] = [];
        const root = rootOf(variant("pinned", pinnedSource(pages)), PICK);
        const events: PlanEventRows = { seam: { placed: () => none, place: (blocks) => blocks }, landings: [], paged: true };
        const lead = leadAt(1);
        const { result } = renderHook(() => {
            const kept = usePlanKeptRoot(root, root, true);
            // The pick's version, as the canvas reads it and hands it on.
            return usePlanEventRoot(kept.value, kept.data, lead, events, undefined, useSliceReactivity(PICK));
        });
        // The paging driver's read, through the event kinds' wrapper: its revision, then a window at it.
        const revision = () => {
            const r = sourceOf(result.current.data).revision!();
            return r.type === "some" ? r.value : undefined;
        };
        const before = revision();
        sourceOf(result.current.data).page(0n, 200n);
        sourceOf(result.current.data).page(0n, 200n);
        expect(pages).toEqual([0]);
        // The Series tab switches a series: no event moves, and the driver is told all the same.
        act(() => { getStore().write(PICK, new Uint8Array([1])); });
        const after = revision();
        expect(before).toBeDefined();
        expect(after).toBeDefined();
        expect(after).not.toBe(before);
        sourceOf(result.current.data).page(0n, 200n);
        expect(pages).toEqual([0, 0]);
    });

    test("what the driver holds is said on through the event kinds' wrapper: more windows than the layer keeps beside them are made once each, new events or not (#1712)", () => {
        const made: number[] = [];
        const src = {
            id: "rows-held", page: () => some({ rows: BLOCKS, entries: [] }), total: () => some(4_000n), seek: none,
            revision: () => some("R1"), refresh: () => null,
        };
        const seam = { rows: (offset: bigint) => { made.push(Number(offset)); return some(BLOCKS); } };
        const root = { rows: variant("pinned", src), links: [], nested: some(seam), pick: none } as unknown as PlanRootValue;
        const events: PlanEventRows = { seam: { placed: () => none, place: (blocks) => blocks }, landings: [], paged: true };
        const { result, rerender } = renderHook(({ cells, drafts, lead }) => {
            const nested = usePlanNestedRoot(root, root, cells, drafts);
            const kept = usePlanKeptRoot(nested.value, nested.data, true);
            return usePlanEventRoot(kept.value, kept.data, lead, events);
        }, { initialProps: { cells: readAt(1), drafts: draftedAt(0), lead: leadAt(1) } });
        const held = Array.from({ length: KEPT_WINDOWS + 4 }, (_x, w) => BigInt(w * 200));
        // The paging driver's pass, through the event kinds' wrapper: what it holds, then each window of it.
        const pass = () => {
            const driver = sourceOf(result.current.data);
            driver.retain!(held);
            for (const offset of held) driver.page(offset, 200n);
        };
        pass();
        rerender({ cells: readAt(1), drafts: draftedAt(0), lead: leadAt(2) });
        pass();
        rerender({ cells: readAt(1), drafts: draftedAt(0), lead: leadAt(3) });
        pass();
        expect(made).toHaveLength(held.length);
    });
});
