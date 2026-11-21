/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rail engine's forms (#1673) — how one cluster of narrowing affordances
 * folds as its row narrows, decided apart from anything that draws it. Slice's
 * rail and the Studio's filter rail are two visual layers on it.
 *
 * A cluster's forms run from every chip and affordance live to the row's
 * floor, and each step between two forms has a rank, which the shared
 * `Toolbar` merges with its other items' and picks from by width:
 *
 *   - the filter's chips fold into "+N more", one at a time (rank 0);
 *   - each affordance folds into its summary chip, in fold order — its own
 *     rank, else its kind's ({@link KIND_RANK}), else mid-pack; then the
 *     order it is mounted in;
 *   - with more than one affordance, the summary chips merge into the
 *     terminal "Filters" chip (rank 6), then the icon alone (rank 7): a
 *     cluster of one has nothing to merge, and an icon would say less than
 *     its chip;
 *   - last, the floor: the icon without its caret (`FLOOR_RANK`).
 *
 * No JSX and no React here: each rule is proved by `forms.test.ts` alone.
 *
 * @packageDocumentation
 */

import { KIND_RANK, MID_RANK, RAIL_RANK } from "./ranks.js";

/** One cluster of a rail — one item of the shared toolbar. */
export interface RailCluster {
    /** Its key in the toolbar. */
    key: string;
    /** The affordance kinds it holds, in mount order (`"filter"`, `"search"`, …). */
    kinds: ReadonlyArray<string>;
    /** Where it sits in the row: at its start (the default), or in its end cluster. */
    side?: "start" | "end" | undefined;
}

/** What the engine reads of one affordance: where it folds, and whether it narrows. */
export interface RailAffordance {
    /** Its own place in the fold order; its kind's, else mid-pack, when it gives none. */
    rank?: number | undefined;
    /** Whether it narrows now: a field set. */
    active: boolean;
}

/**
 * How a form shows the affordances it folds: each as its summary chip; merged
 * into the terminal chip; as the icon alone; or, at the row's floor, as the
 * icon without the trigger's caret.
 */
export type RailShow = "chips" | "terminal" | "icon" | "bare";

/** One form of a cluster. */
export interface RailForm {
    /** How many affordances it folds, counted in fold order. */
    readonly folded: number;
    /** How many of the filter's chips it folds into "+N more". */
    readonly chips: number;
    /** How the folded affordances show. */
    readonly show: RailShow;
    /**
     * The affordances it folds — their mount indices, in the order its trigger
     * shows and names them: fold order while each shows as its own summary
     * chip; mount order once they merge, so a choice never moves the trigger's
     * name.
     */
    readonly folds: ReadonlyArray<number>;
    /** The affordances it leaves live — their mount indices, in mount order. */
    readonly live: ReadonlyArray<number>;
}

/** A cluster's forms, and the ranks of the steps between them. */
export interface RailForms {
    /** The forms, widest first: from everything live to the row's floor. */
    readonly forms: ReadonlyArray<RailForm>;
    /** Each step's rank: `ranks[i]` takes form `i` to form `i + 1`. */
    readonly ranks: ReadonlyArray<number>;
    /** The affordances' mount indices, in fold order. */
    readonly order: ReadonlyArray<number>;
}

/**
 * A cluster's forms, from every chip and affordance live to the row's floor.
 *
 * @param cluster - The cluster: its affordances, in mount order
 * @param describe - Each affordance, by its kind: where it folds
 * @param chips - How many chips the cluster's filter shows — each folds on its own, before any affordance
 * @returns The forms, the rank of each step between them, and the fold order
 */
export function railForms(cluster: RailCluster, describe: (kind: string) => Pick<RailAffordance, "rank">, chips: number): RailForms {
    const kinds = cluster.kinds;
    const ranked = kinds
        .map((kind, i) => ({ i, rank: describe(kind).rank ?? KIND_RANK[kind] ?? MID_RANK }))
        .sort((a, b) => a.rank - b.rank || a.i - b.i);
    const order = ranked.map((o) => o.i);
    const every = kinds.map((_kind, i) => i);
    const form = (folded: number, held: number, show: RailShow): RailForm => {
        const gone = new Set(order.slice(0, folded));
        return { folded, chips: held, show, folds: show === "chips" ? order.slice(0, folded) : every, live: every.filter((i) => !gone.has(i)) };
    };
    const forms: RailForm[] = [form(0, 0, "chips")];
    const ranks: number[] = [];
    for (let c = 1; c <= chips; c++) {
        forms.push(form(0, c, "chips"));
        ranks.push(RAIL_RANK.chips);
    }
    ranked.forEach((o, k) => {
        forms.push(form(k + 1, chips, "chips"));
        ranks.push(o.rank);
    });
    if (kinds.length > 1) {
        forms.push(form(kinds.length, chips, "terminal"));
        ranks.push(RAIL_RANK.terminal);
        forms.push(form(kinds.length, chips, "icon"));
        ranks.push(RAIL_RANK.icon);
    }
    // The row's floor: the trigger as its icon alone, without its caret — taken only where the toolbar's whole ladder
    // leaves the row too wide, so the history and Save stay in it (hand retest, 27 Oct 2026).
    forms.push(form(kinds.length, chips, "bare"));
    ranks.push(RAIL_RANK.bare);
    return { forms, ranks, order };
}

/**
 * The affordances a form folds: what its trigger summarises, and names for
 * assistive technology.
 *
 * @param form - The form
 * @returns Their mount indices, in the order the trigger shows and names them
 */
export function foldedAt(form: RailForm): ReadonlyArray<number> {
    return form.folds;
}

/**
 * How many of a cluster's affordances narrow now — what a phone's Filters
 * button counts.
 *
 * @param cluster - The cluster
 * @param describe - Each affordance, by its kind: whether it narrows
 * @returns The count of affordances set
 */
export function railSet(cluster: RailCluster, describe: (kind: string) => Pick<RailAffordance, "active">): number {
    return cluster.kinds.filter((kind) => describe(kind).active).length;
}
