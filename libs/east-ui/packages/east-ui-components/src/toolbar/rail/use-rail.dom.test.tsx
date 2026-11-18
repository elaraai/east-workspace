/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The rail engine's state (`use-rail.ts`, #1673): the clusters a rail draws,
 * the editor held open and the chip steps it keeps while held, how many
 * fields are set, and when the rail is made again.
 */

import { afterEach, describe, expect, test } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { RailCluster } from "./forms.js";
import { railClusters, useRail, type RailHeld, type RailSource } from "./use-rail.js";

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
        const [narrow, range] = railClusters(model(2), [NARROW, RANGE], null, (held) => told.push(held));
        narrow!.setOpen(true);
        range!.setOpen(true);
        narrow!.setOpen(false);
        expect(told).toEqual([{ key: "narrow", chips: 2 }, { key: "range", chips: 0 }, null]);
    });

    test("holds one cluster, and no other", () => {
        const made = railClusters(model(2), [NARROW, RANGE], { key: "range", chips: 0 }, nothing);
        expect(made.map((state) => state.held)).toEqual([false, true]);
    });

    test("keeps the chip steps it opened with while a clause is added or removed there — and another cluster's follow the model", () => {
        const OTHER: RailCluster = { key: "other", kinds: ["filter"] };
        const held: RailHeld = { key: "narrow", chips: 2 };
        for (const now of [0, 2, 5]) {
            const [narrow, other] = railClusters(model(now), [NARROW, OTHER], held, nothing);
            expect([chipSteps(narrow!), chipSteps(other!)], `${now} chips now`).toEqual([2, now]);
        }
    });

    test("opened again after a clause was added, holds the chips shown then", () => {
        const told: (RailHeld | null)[] = [];
        const [narrow] = railClusters(model(5), [NARROW], { key: "narrow", chips: 2 }, (held) => told.push(held));
        narrow!.setOpen(true);
        expect(told).toEqual([{ key: "narrow", chips: 5 }]);
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
