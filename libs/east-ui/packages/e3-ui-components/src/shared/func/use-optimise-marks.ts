/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the runs left on a builder's rows, kept until Apply and followed
 * through the builder's history (ruling 16 of east-workspace#1709): each run's
 * landing keeps its marks — the earlier runs' among them — with a point of the
 * builder's editing taken as it lands, and the marks are drawn under the key
 * each marked row stands under now, whoever moved it there: a gesture since,
 * its Undo or its Redo, or the Undo and Redo of the run itself. No row that
 * comes to stand under a key a marked row had wears its marks, and a row the
 * run made wears none while the run is undone. A run gone for good — undone,
 * then another gesture recorded in its place — left nothing on any row: the
 * marks as the run before it left them stand. Every builder that takes the
 * app's optimiser keeps its runs' marks so: the Calendar, the Plan, the Roster,
 * the Allocation and the Sheet.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { OptimiseFollow } from "./optimise-diff.js";

/**
 * Where a builder's editing follows its rows from: a point of its history as the rows stand now, and each row's key
 * now from where it stood at one.
 *
 * @typeParam P - A point of the editing's history
 */
export interface OptimiseFollowing<P> {
    /**
     * A point of the editing's history: where its rows stand now.
     *
     * @returns The point
     */
    point(): P;
    /**
     * Each row's key now, from where it stood at a point ({@link OptimiseFollow}).
     *
     * @param point - Where the rows stood
     * @returns Where each stands now; `undefined` where the history no longer holds what was done up to the point: the
     *   step it was taken after dropped, or the drafts discarded
     */
    since(point: P): OptimiseFollow | undefined;
}

/**
 * What a builder holds of its runs' marks ({@link useOptimiseMarks}).
 *
 * @typeParam O - What the runs leave on the builder's rows
 */
export interface OptimiseMarks<O> {
    /** What the runs left, each mark under the key its row stands under now; `undefined` while nothing is marked. */
    readonly marks: O | undefined;
    /**
     * Keeps what the runs left, as a run's landing leaves it — each mark under the key its row stands under as the run's
     * step is recorded — and follows it from there: called as the step is recorded, before anything else is.
     *
     * @param marks - What the runs left
     */
    readonly keep: (marks: O) => void;
    /** Lets every mark go: nothing is pending — Save, Discard. */
    readonly clear: () => void;
}

/** What one run's landing kept: the runs' marks, and where the rows stood as it landed. */
interface Kept<O, P> {
    readonly marks: O;
    readonly point: P | undefined;
}

/**
 * A builder's runs' marks, followed through its history (see the module docs).
 *
 * @typeParam O - What the runs leave on the builder's rows
 * @typeParam P - A point of the editing's history
 * @param following - How the builder's editing follows its rows; `undefined` for a builder that takes no edit
 * @param version - The editing's version: it moves with every step the rows are followed through
 * @param rekey - The marks with each row's under the key it stands under now — a row that stands under no key of its own
 *   leaving its marks — the builder's own: the same function across renders
 * @returns The marks as they stand now, and how a landing keeps them and Save lets them go
 */
export function useOptimiseMarks<O, P>(following: OptimiseFollowing<P> | undefined, version: number, rekey: (marks: O, follow: OptimiseFollow) => O): OptimiseMarks<O> {
    // Each run's landing, oldest first.
    const [kept, setKept] = useState<readonly Kept<O, P>[]>([]);
    const marks = useMemo(() => {
        // The latest landing the history still holds — its step done, or undone and not yet dropped — under the keys its
        // rows stand under now.
        for (let i = kept.length - 1; i >= 0; i--) {
            const { marks: left, point } = kept[i]!;
            if (point === undefined) return left;
            const follow = following?.since(point);
            if (follow !== undefined) return rekey(left, follow);
        }
        return undefined;
        // The editing's version moves with each step the rows are followed through.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kept, version, following, rekey]);
    // The point is taken as a landing keeps its marks: just after its run's step is recorded.
    const latest = useRef(following);
    latest.current = following;
    const keep = useCallback((next: O) => {
        const point = latest.current?.point();
        setKept((was) => [...was, { marks: next, point }]);
    }, []);
    const clear = useCallback(() => { setKept((was) => (was.length === 0 ? was : [])); }, []);
    return { marks, keep, clear };
}
