/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The rail engine's state (`use-rail.ts`, #1673): the clusters a rail draws,
 * the editor held open and the chip steps it keeps while held — or an editor
 * of its live row, which holds it the same way with its own editor shut — how
 * many fields are set, and when the rail is made again.
 */

import { afterEach, describe, expect, test } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { RailCluster } from "./forms.js";
import { railClusters, useRail, type RailHeld, type RailHoldUpdate, type RailSource } from "./use-rail.js";

afterEach(cleanup);

/** A model: its filter's chips, and the affordances that narrow. */
const model = (filterChips: number | undefined, active: readonly string[] = []): RailSource => ({
    version: 0,
    ...(filterChips === undefined ? {} : { filterChips }),
    describe: (kind) => ({ active: active.includes(kind) }),
});
const NARROW: RailCluster = { key: "narrow", kinds: ["filter", "search"] };
const RANGE: RailCluster = { key: "range", kinds: ["range"], side: "end" };
/** How many chip steps a cluster's forms take. */
const chipSteps = (state: { forms: ReadonlyArray<{ chips: number }> }) => Math.max(...state.forms.map((form) => form.chips));
const nothing = () => undefined;
/** Records each hold the engine is told: one given whole, or one that follows from none. */
const telling = (told: (RailHeld | null)[]) => (update: RailHoldUpdate) => { told.push(typeof update === "function" ? update(null) : update); };

describe("a rail's clusters", () => {
    test("are none for a rail with no model", () => {
        expect(railClusters(undefined, [NARROW, RANGE], null, nothing)).toEqual([]);
    });

    test("leave out a cluster with no affordance, and keep the rest in the host's order", () => {
        const made = railClusters(model(0), [{ key: "empty", kinds: [] }, RANGE, NARROW], null, nothing);
        expect(made.map((state) => state.cluster.key)).toEqual(["range", "narrow"]);
    });

    test("give the filter's chips to the cluster holding the filter, and to no other", () => {
        const [narrow, range] = railClusters(model(3), [NARROW, RANGE], null, nothing);
        expect([chipSteps(narrow!), chipSteps(range!)]).toEqual([3, 0]);
    });

    test("fold no chip for a model that counts none", () => {
        expect(chipSteps(railClusters(model(undefined), [NARROW], null, nothing)[0]!)).toBe(0);
    });

    test("each end with every affordance folded: what a phone's Filters button holds", () => {
        const [narrow] = railClusters(model(2), [NARROW], null, nothing);
        expect(narrow!.every).toBe(narrow!.forms[narrow!.forms.length - 1]);
        expect([narrow!.every.show, narrow!.every.folds, narrow!.every.live]).toEqual(["bare", [0, 1], []]);
        expect(narrow!.ranks.length).toBe(narrow!.forms.length - 1);
    });

    test("count the fields set in each, apart", () => {
        const [narrow, range] = railClusters(model(1, ["search", "range"]), [NARROW, RANGE], null, nothing);
        expect([narrow!.set, range!.set]).toEqual([1, 1]);
    });
});

describe("the editor held open", () => {
    test("opens holding its cluster at the chips its filter shows now, and closes holding none", () => {
        const told: (RailHeld | null)[] = [];
        const [narrow, range] = railClusters(model(2), [NARROW, RANGE], null, telling(told));
        narrow!.setOpen(true);
        range!.setOpen(true);
        narrow!.setOpen(false);
        expect(told).toEqual([{ key: "narrow", chips: 2, editor: true }, { key: "range", chips: 0, editor: true }, null]);
    });

    test("holds one cluster, and no other; its own editor open where it holds it, and shut where its live row does", () => {
        const made = railClusters(model(2), [NARROW, RANGE], { key: "range", chips: 0, editor: true }, nothing);
        expect(made.map((state) => [state.held, state.open])).toEqual([[false, false], [true, true]]);
        const row = railClusters(model(2), [NARROW, RANGE], { key: "narrow", chips: 2, editor: false }, nothing);
        expect(row.map((state) => [state.held, state.open])).toEqual([[true, false], [false, false]]);
    });

    test("keeps the chip steps it opened with while a clause is added or removed there — and another cluster's follow the model", () => {
        const OTHER: RailCluster = { key: "other", kinds: ["filter"] };
        const held: RailHeld = { key: "narrow", chips: 2, editor: true };
        for (const now of [0, 2, 5]) {
            const [narrow, other] = railClusters(model(now), [NARROW, OTHER], held, nothing);
            expect([chipSteps(narrow!), chipSteps(other!)], `${now} chips now`).toEqual([2, now]);
        }
    });

    test("opened again after a clause was added, holds the chips shown then", () => {
        const told: (RailHeld | null)[] = [];
        const [narrow] = railClusters(model(5), [NARROW], { key: "narrow", chips: 2, editor: true }, telling(told));
        narrow!.setOpen(true);
        expect(told).toEqual([{ key: "narrow", chips: 5, editor: true }]);
    });
});

describe("a live row's editor holding its cluster (#1673)", () => {
    /** The hold a cluster's `hold` makes of the one the engine had. */
    const holdOf = (was: RailHeld | null, holding: boolean, key = "narrow", chips = 2): RailHeld | null => {
        let made: RailHeld | null = was;
        const [narrow, other] = railClusters(model(chips), [NARROW, { key: "other", kinds: ["filter"] }], was, (update) => {
            made = typeof update === "function" ? update(made) : update;
        });
        (key === "narrow" ? narrow! : other!).hold(holding);
        return made;
    };

    test("holds a cluster nothing holds at the chips its filter shows now, its own editor shut — and lets go of its own hold", () => {
        expect(holdOf(null, true)).toEqual({ key: "narrow", chips: 2, editor: false });
        expect(holdOf({ key: "narrow", chips: 2, editor: false }, false)).toBeNull();
    });

    test("neither takes nor lets go of a hold it did not make: its cluster's own editor's, or another cluster's", () => {
        const editor: RailHeld = { key: "narrow", chips: 2, editor: true };
        expect(holdOf(editor, true, "narrow", 5)).toBe(editor);
        expect(holdOf(editor, false)).toBe(editor);
        const other: RailHeld = { key: "other", chips: 1, editor: false };
        expect(holdOf(other, true)).toBe(other);
        expect(holdOf(other, false)).toBe(other);
    });

    test("in useRail: held while the row's editor is open, keeping its chip steps as the model's chips move, its own editor shut the while", () => {
        const { result, rerender } = renderHook(({ m }: { m: RailSource }) => useRail(m, [NARROW]), { initialProps: { m: model(2) } });
        act(() => result.current[0]!.hold(true));
        expect([result.current[0]!.held, result.current[0]!.open, chipSteps(result.current[0]!)]).toEqual([true, false, 2]);
        rerender({ m: model(3) });
        expect([result.current[0]!.held, chipSteps(result.current[0]!)]).toEqual([true, 2]);
        act(() => result.current[0]!.hold(false));
        expect([result.current[0]!.held, chipSteps(result.current[0]!)]).toEqual([false, 3]);
    });
});

describe("useRail", () => {
    test("is the same rail while the model, the clusters' affordances and the held editor hold — a host's new array of the same clusters makes nothing again", () => {
        const source = model(1);
        const { result, rerender } = renderHook(({ m, clusters }: { m: RailSource; clusters: RailCluster[] }) => useRail(m, clusters), {
            initialProps: { m: source, clusters: [NARROW, RANGE] },
        });
        const first = result.current;
        rerender({ m: source, clusters: [{ ...NARROW }, { ...RANGE }] });
        expect(result.current).toBe(first);
    });

    test("is made again when the model moves, when a cluster's affordances do, and when a cluster changes side", () => {
        const source = model(1);
        const { result, rerender } = renderHook(({ m, clusters }: { m: RailSource; clusters: RailCluster[] }) => useRail(m, clusters), {
            initialProps: { m: source, clusters: [NARROW, RANGE] },
        });
        let last = result.current;
        const moved = (label: string) => {
            expect(result.current, label).not.toBe(last);
            last = result.current;
        };
        rerender({ m: model(1), clusters: [NARROW, RANGE] });
        moved("a new model");
        const kept = last;
        rerender({ m: source, clusters: [NARROW, RANGE] });
        moved("the first model again");
        expect(kept).not.toBe(last);
        rerender({ m: source, clusters: [{ ...NARROW, kinds: ["filter"] }, RANGE] });
        moved("an affordance gone");
        rerender({ m: source, clusters: [{ ...NARROW, kinds: ["filter"] }, { ...RANGE, side: "start" }] });
        moved("a cluster on the other side");
    });

    test("holds a cluster as its editor opens, keeping its chip steps as the model's chips move, and lets it go as it closes", () => {
        const { result, rerender } = renderHook(({ m }: { m: RailSource }) => useRail(m, [NARROW]), { initialProps: { m: model(2) } });
        expect(result.current[0]!.held).toBe(false);
        act(() => result.current[0]!.setOpen(true));
        expect([result.current[0]!.held, chipSteps(result.current[0]!)]).toEqual([true, 2]);
        rerender({ m: model(4) });
        expect([result.current[0]!.held, chipSteps(result.current[0]!)]).toEqual([true, 2]);
        act(() => result.current[0]!.setOpen(false));
        expect([result.current[0]!.held, chipSteps(result.current[0]!)]).toEqual([false, 4]);
    });

    test("draws no cluster for a rail with no model", () => {
        const { result } = renderHook(() => useRail(undefined, [NARROW]));
        expect(result.current).toEqual([]);
    });
});
