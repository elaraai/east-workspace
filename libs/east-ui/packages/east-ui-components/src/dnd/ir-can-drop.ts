/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * IR `canDrop` bridge — connects a target root's East-level drop veto
 * (`canDrop: Option<Fn([DragEventType], Bool)>`, `contracts/drag.ts`) to the
 * drag layer's veto ({@link DropVeto}).
 *
 * The layer asks with the candidate event itself — the one a drop at that
 * point would deliver, an `add`'s duplicate flag included (#608) — and asks
 * again, of the event it delivers, before it delivers it. So the bridge only
 * evaluates: once per distinct event for the predicate's lifetime (verdict
 * cache), failing open with a console error when the predicate throws — a
 * broken validator must not brick the surface.
 */

import { useMemo } from "react";
import { printFor } from "@elaraai/east";
import { DragEventType } from "@elaraai/east-ui/internal";
import type { DragEventValue, DropVeto } from "./drag-layer";

/** The decoded IR predicate shape (`canDrop.unwrap("some")`). */
export type CanDropFn = (candidate: DragEventValue) => boolean;

/**
 * A drop check with its answers kept, for as long as it is held: each distinct
 * candidate is asked once, and a check that throws lets the drop land — its
 * answer the one given for that — and says so on the console, once a candidate.
 *
 * @remarks
 * A check is a pure East function, so its answer to a candidate moves only
 * when the function does: a caller makes a new kept check for a new function.
 * Every builder's `canDrop` is asked through this, whatever it is asked of and
 * whatever it answers: a drag event to a Boolean ({@link useIRCanDrop}), a
 * Plan's candidate to its refusal's words.
 *
 * @typeParam C - What the check is asked: a candidate
 * @typeParam A - What it answers
 * @param check - The check, decoded
 * @param keyOf - A candidate's key: East's printing of it, so two candidates share an answer exactly when they are equal
 * @param open - The answer that lets a drop land, given when the check throws
 * @param label - Whose check it is, as the console names it: `[Plan] canDrop`
 * @returns The check, its answers kept
 */
export function keptDropCheck<C, A>(check: (candidate: C) => A, keyOf: (candidate: C) => string, open: A, label: string): (candidate: C) => A {
    const answers = new Map<string, A>();
    return (candidate) => {
        const key = keyOf(candidate);
        if (answers.has(key)) return answers.get(key) as A;
        let answer = open;
        try {
            answer = check(candidate);
        } catch (err) {
            // A broken check must not brick the surface: it lets the drop land.
            console.error(`${label} failed (allowing):`, err);
        }
        answers.set(key, answer);
        return answer;
    };
}

/**
 * A candidate's cache key — East's own printing of the event, so two
 * candidates share a verdict exactly when they are the same event, whatever
 * the grammar's types grow.
 */
const verdictKey = printFor(DragEventType);

/**
 * Evaluate the IR predicate against one event, fail-open.
 *
 * @param fn - The decoded predicate, or `undefined` for none
 * @param event - The event
 * @returns Whether the predicate allows it (`true` when there is none, or it throws)
 */
export function canDropAllows(fn: CanDropFn | undefined, event: DragEventValue | undefined): boolean {
    if (fn === undefined || event === undefined) return true;
    try {
        return fn(event) === true;
    } catch (err) {
        console.error("[DnD] canDrop validator failed (allowing):", err);
        return true;
    }
}

/**
 * Build a target's veto from its decoded IR `canDrop` — `undefined` when the
 * target has no predicate (every structurally-connected cell accepts).
 *
 * @remarks
 * Verdicts are cached per candidate event for the predicate's identity — IR
 * predicates are pure East functions, so a verdict only changes when the value
 * (and with it the decoded function) changes.
 *
 * @param canDropFn - The decoded predicate
 * @returns The veto every cell of the target shares
 */
export function useIRCanDrop(canDropFn: CanDropFn | undefined): DropVeto | undefined {
    return useMemo(() => (canDropFn === undefined ? undefined
        : keptDropCheck((candidate: DragEventValue) => canDropFn(candidate) === true, verdictKey, true, "[DnD] canDrop validator")), [canDropFn]);
}
