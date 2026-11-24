/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rail engine's forms (`forms.ts`, #1673): every rule a rail folds by,
 * proved with no DOM — the fold order, the chips before the affordances, the
 * terminal and icon rungs, the floor, and what each form folds and leaves
 * live.
 */

import { describe, expect, test } from "vitest";
import { FLOOR_RANK } from "../fold.js";
import { foldedAt, railForms, railSet, type RailCluster, type RailForm } from "./forms.js";
import { HOST_RANK, KIND_RANK, MID_RANK, RAIL_RANK, SUMMARY_RANK } from "./ranks.js";

/** A cluster of the kinds given, in mount order. */
const cluster = (...kinds: string[]): RailCluster => ({ key: "rail", kinds });
/** Affordances with no rank of their own. */
const plain = () => ({});
/** A form, as its show, how many it folds and how many chips: `chips:0+2`. */
const said = (form: RailForm) => `${form.show}:${form.folded}+${form.chips}`;

describe("the fold order", () => {
    test("is by each kind's rank, lowest first: search, range, cohort, breakdown, then the filter", () => {
        const { order } = railForms(cluster("filter", "search", "range", "breakdown", "cohort"), plain, 0);
        expect(order).toEqual([1, 2, 4, 3, 0]);
    });

    test("is the mount order between affordances of one rank", () => {
        expect(railForms(cluster("presets", "cohort"), plain, 0).order).toEqual([0, 1]);
        expect(railForms(cluster("cohort", "presets"), plain, 0).order).toEqual([0, 1]);
    });

    test("puts a kind with no rank mid-pack: after the range, before the breakdown, in mount order beside a cohort", () => {
        expect(MID_RANK).toBe(KIND_RANK["cohort"]);
        expect(railForms(cluster("filter", "field:site", "breakdown", "range", "cohort"), plain, 0).order).toEqual([3, 1, 4, 2, 0]);
    });

    test("is by an affordance's own rank before its kind's", () => {
        const describe = (kind: string) => (kind === "filter" ? { rank: 0 } : kind === "search" ? { rank: 9 } : {});
        expect(railForms(cluster("search", "range", "filter"), describe, 0).order).toEqual([2, 1, 0]);
    });

    test("never moves with a choice: the same cluster and ranks give the same forms", () => {
        const kinds = cluster("filter", "search", "range");
        expect(railForms(kinds, plain, 2)).toEqual(railForms(kinds, plain, 2));
    });
});

describe("a cluster's forms", () => {
    test("begin with every chip and affordance live", () => {
        const { forms } = railForms(cluster("filter", "search"), plain, 3);
        expect(forms[0]).toEqual({ folded: 0, chips: 0, show: "chips", folds: [], live: [0, 1] });
    });

    test("fold the filter's chips one at a time before any affordance, each at the chips' rank", () => {
        const { forms, ranks } = railForms(cluster("filter", "search"), plain, 3);
        expect(forms.slice(0, 4).map(said)).toEqual(["chips:0+0", "chips:0+1", "chips:0+2", "chips:0+3"]);
        expect(ranks.slice(0, 3)).toEqual([RAIL_RANK.chips, RAIL_RANK.chips, RAIL_RANK.chips]);
    });

    test("then fold each affordance into its summary chip, in fold order, at its rank — every chip folded by then", () => {
        const { forms, ranks } = railForms(cluster("filter", "search", "range"), plain, 2);
        expect(forms.map(said)).toEqual([
            "chips:0+0", "chips:0+1", "chips:0+2",
            "chips:1+2", "chips:2+2", "chips:3+2",
            "terminal:3+2", "icon:3+2", "bare:3+2",
        ]);
        expect(ranks).toEqual([0, 0, KIND_RANK["search"], KIND_RANK["range"], KIND_RANK["filter"], RAIL_RANK.terminal, RAIL_RANK.icon, RAIL_RANK.bare]);
    });

    test("have one rank for every step between two forms", () => {
        for (const kinds of [[], ["search"], ["filter", "search"], ["filter", "search", "range", "breakdown", "cohort"]]) {
            for (const chips of [0, 1, 4]) {
                const { forms, ranks } = railForms(cluster(...kinds), plain, chips);
                expect(ranks.length, `${kinds.join()} with ${chips}`).toBe(forms.length - 1);
            }
        }
    });

    test("take no terminal and no icon rung for one affordance: its summary chip, then the floor", () => {
        const { forms, ranks } = railForms(cluster("search"), plain, 0);
        expect(forms.map(said)).toEqual(["chips:0+0", "chips:1+0", "bare:1+0"]);
        expect(ranks).toEqual([KIND_RANK["search"], RAIL_RANK.bare]);
    });

    test("merge more than one into the terminal chip, then the icon, after every affordance has folded", () => {
        const { forms, ranks } = railForms(cluster("search", "range"), plain, 0);
        expect(forms.map(said)).toEqual(["chips:0+0", "chips:1+0", "chips:2+0", "terminal:2+0", "icon:2+0", "bare:2+0"]);
        expect(ranks.slice(-3)).toEqual([6, 7, FLOOR_RANK]);
    });

    test("end at the row's floor, whatever they hold: the icon without its caret, below the toolbar's ladder", () => {
        for (const kinds of [[], ["filter"], ["filter", "search"], ["search", "range", "breakdown", "cohort", "filter"]]) {
            for (const chips of [0, 2]) {
                const { forms, ranks } = railForms(cluster(...kinds), plain, chips);
                const last = forms[forms.length - 1]!;
                expect([last.show, last.folded, last.live, ranks[ranks.length - 1]], `${kinds.join()} with ${chips}`).toEqual(["bare", kinds.length, [], FLOOR_RANK]);
            }
        }
    });

    test("of a cluster with no affordance are its rest and its floor, folding nothing", () => {
        const { forms, ranks, order } = railForms(cluster(), plain, 0);
        expect(forms).toEqual([
            { folded: 0, chips: 0, show: "chips", folds: [], live: [] },
            { folded: 0, chips: 0, show: "bare", folds: [], live: [] },
        ]);
        expect([ranks, order]).toEqual([[FLOOR_RANK], []]);
    });

    test("fold no chip where the filter shows none", () => {
        expect(railForms(cluster("filter", "search"), plain, 0).forms.map(said)).toEqual([
            "chips:0+0", "chips:1+0", "chips:2+0", "terminal:2+0", "icon:2+0", "bare:2+0",
        ]);
    });
});

describe("what a form folds, and leaves live", () => {
    const { forms } = railForms(cluster("filter", "search", "range"), plain, 0);

    test("its summary chips are the affordances folded so far, in fold order", () => {
        expect(forms.filter((form) => form.show === "chips").map(foldedAt)).toEqual([[], [1], [1, 2], [1, 2, 0]]);
    });

    test("what it leaves live stays in mount order", () => {
        expect(forms.filter((form) => form.show === "chips").map((form) => form.live)).toEqual([[0, 1, 2], [0, 2], [0], []]);
    });

    test("merged, it names every affordance in mount order — a choice never moves its name", () => {
        for (const show of ["terminal", "icon", "bare"] as const) {
            const form = forms.find((f) => f.show === show)!;
            expect([foldedAt(form), form.live], show).toEqual([[0, 1, 2], []]);
        }
    });
});

describe("how many of a cluster's fields are set", () => {
    test("counts the affordances that narrow, and no other", () => {
        const active = new Set(["search", "field:site"]);
        const describe = (kind: string) => ({ active: active.has(kind) });
        expect(railSet(cluster("filter", "search", "field:site", "range"), describe)).toBe(2);
        expect(railSet(cluster("filter", "range"), describe)).toBe(0);
        expect(railSet(cluster(), describe)).toBe(0);
    });
});

describe("the rail's ranks among a host's", () => {
    test("every step of the ladder folds before a record rail's summary, and that before a host's own items", () => {
        const ladder = [...Object.values(KIND_RANK), MID_RANK, RAIL_RANK.chips, RAIL_RANK.terminal, RAIL_RANK.icon];
        expect(Math.max(...ladder)).toBeLessThan(SUMMARY_RANK);
        expect(SUMMARY_RANK).toBeLessThan(HOST_RANK);
    });

    test("the floor lies below the toolbar's whole ladder", () => {
        expect(RAIL_RANK.bare).toBe(FLOOR_RANK);
        expect(HOST_RANK).toBeLessThan(FLOOR_RANK);
    });
});
