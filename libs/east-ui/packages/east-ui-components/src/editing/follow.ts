/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Following a session's entries through its history (east-workspace#1709):
 * what the editing session (`session.ts`) reads its steps by, apart from the
 * session's own state.
 *
 * A gesture may move an entry under another id — a row its builder moved under
 * the key its fields build — and says where it came from (`EntryUpdate.from`);
 * the step keeps each such move. From them:
 *
 * - **A point of the history, followed** ({@link pointAt}, {@link followFrom};
 *   ruling 16): where each entry stands now, by the id it had at the point —
 *   on through each step done since, back through each Undo has taken back,
 *   and through each start-over of the history that carried the drafts over.
 * - **The moves the drafts hold** ({@link movesThrough}): each entry that
 *   stands under another id than the one its source holds it under, by the id
 *   it stands under — the entry it was, edited, never one removed and one
 *   added. Read from the steps done, so Undo and Redo move them with the
 *   drafts, and carried into the next run of the history as it starts over.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import type { EntryVersion } from "./session.js";

const stringEqual = equalFor(StringType);

/**
 * A step of a session's history, as following reads it.
 *
 * @typeParam W - The collection's projection of an entry
 */
export interface FollowStep<W> {
    /** Each entry the step changed, as it found it. */
    before: Map<string, EntryVersion<W>>;
    /** Each as it left it. */
    after: Map<string, EntryVersion<W>>;
    /** Each entry the step moved under another id, by the id it had (`EntryUpdate.from`): `undefined` for none. */
    moves?: ReadonlyMap<string, string> | undefined;
}

/**
 * How a run of a session's history ended, as it started over ({@link Trail}): past how many of its steps the entries
 * stood then, with the new ids a carry-over gave new entries, on into the next run — or `"discarded"`, the drafts the
 * steps made gone with them.
 *
 * @typeParam S - A step of the history
 */
export type TrailEnd<S> = { readonly done: number; readonly renamed: ReadonlyMap<string, string>; readonly next: Trail<S> } | "discarded";

/**
 * One run of a session's history, from where it starts over to where it next does (ruling 16 of
 * east-workspace#1709): its steps — the array the session holds them in, kept as they stood once the history starts
 * over — and, once it has, how it ended. What a point of the history is taken on, and followed along
 * ({@link followFrom}).
 *
 * @typeParam S - A step of the history
 */
export interface Trail<S> {
    readonly steps: S[];
    ended?: TrailEnd<S> | undefined;
}

/** Where a point of a session's history stands: its run, and the step done last there — `undefined` before the first. */
interface PointAt<S> {
    readonly trail: Trail<S>;
    readonly step: S | undefined;
}

declare const EDIT_POINT: unique symbol;

/**
 * A point of a session's history (`EditSession.point`): where its entries stood as it was taken, which
 * `EditSession.follow` follows them on from. Opaque.
 */
export interface EditPoint { readonly [EDIT_POINT]: true }

/** Where each point stands in its session's history. */
const pointsAt = new WeakMap<EditPoint, PointAt<unknown>>();

/** No entry stands under another id. */
export const NO_MOVES: ReadonlyMap<string, string> = new Map();

/**
 * A point of a history: where its entries stand, after a step of one of its runs.
 *
 * @typeParam S - A step of the history
 * @param trail - The run of the history the steps are on now
 * @param step - The step done last; `undefined` before the first
 * @returns The point
 */
export function pointAt<S>(trail: Trail<S>, step: S | undefined): EditPoint {
    const point = {} as EditPoint;
    pointsAt.set(point, { trail, step });
    return point;
}

/** Where one leg of the way from a point of a history to where it stands now leaves each entry, by the id it had ({@link followFrom}). */
type FollowLeg = (id: string) => string | undefined;

/** Whether a step made an entry under an id: absent there before the step, there after it — made, or put back after a removal. */
function madeAt<W>(step: FollowStep<W>, id: string): boolean {
    return step.after.get(id)?.draft !== undefined && step.before.get(id)?.draft === undefined;
}

/**
 * Where a step done leaves each entry, by the id it had before the step ({@link followFrom}): under the id the
 * step moved it to; under none where another entry came to stand under its id — moved there, or made there; else under
 * its own.
 *
 * @param step - The step
 * @returns The leg
 */
function onThrough<W>(step: FollowStep<W>): FollowLeg {
    const moves = step.moves;
    const into = moves === undefined ? undefined : new Set(moves.values());
    return (id) => {
        const to = moves?.get(id);
        if (to !== undefined) return to;
        return into?.has(id) === true || madeAt(step, id) ? undefined : id;
    };
}

/**
 * Where each entry stood before a step Undo took back, by the id the step had left it under ({@link followFrom}):
 * under the id the step moved it from; under none where the step made it there — it stood nowhere before — or moved away
 * the entry that stood there; else under its own.
 *
 * @param step - The step
 * @returns The leg
 */
function backThrough<W>(step: FollowStep<W>): FollowLeg {
    const moves = step.moves;
    const back = moves === undefined ? undefined : inverseMoves(moves);
    return (id) => {
        const from = back?.get(id);
        if (from !== undefined) return from;
        return moves?.has(id) === true || madeAt(step, id) ? undefined : id;
    };
}

/**
 * Moves taken back: each entry from the id they left it under to the id they found it under — what Undo does of a
 * step's moves.
 *
 * @param moves - The moves, by the id each entry had
 * @returns Their inverse, by the id each entry was left under
 */
export function inverseMoves(moves: ReadonlyMap<string, string>): Map<string, string> {
    return new Map([...moves].map(([from, to]) => [to, from] as const));
}

/**
 * Two runs of moves as one — a step's and those of a gesture that joins it (`EditSession.record`): each entry
 * from the id the first found it under to the id the second left it under. An entry moved back where it began is no
 * move.
 *
 * @param first - The earlier moves, by the id each entry had
 * @param then - The later moves, by the id each entry had then
 * @returns The moves together; `undefined` for none
 */
export function composeMoves(first: ReadonlyMap<string, string> | undefined, then: ReadonlyMap<string, string>): ReadonlyMap<string, string> | undefined {
    const out = new Map<string, string>();
    const later = new Map(then);
    for (const [from, to] of first ?? []) {
        const on = later.get(to);
        if (on !== undefined) later.delete(to);
        const end = on ?? to;
        if (!stringEqual(from, end)) out.set(from, end);
    }
    for (const [from, to] of later) out.set(from, to);
    return out.size === 0 ? undefined : out;
}

/**
 * Where a history's entries stand now, from where they stood at a point of it ({@link pointAt}; ruling 16 of
 * east-workspace#1709): each by the id it had there — on through every step done since, a gesture's or a Redo's, that
 * moved it under another id; back through every step done before the point that Undo has taken back since; and through
 * every start-over of the history that gave it another id. An entry stands under no id of its own once another has come
 * to stand under the one it had — moved there, made there, or put back there after the entry was removed — nor,
 * followed back past the step that made it, before it was made.
 *
 * @typeParam W - The collection's projection of an entry
 * @typeParam S - A step of the history
 * @param point - A point of the history
 * @param now - The run of the history its steps are on now
 * @param cursor - How many of that run's steps are done
 * @returns Each entry's id now, by the id it had at the point — `undefined` for one that stands under no id of its
 *   own; `undefined` itself where what was done up to the point can be followed no more: the step it was taken after
 *   dropped — taken back by Undo, then another gesture recorded in its place, or the history started over while it
 *   was — the drafts discarded since, or the point another history's
 */
export function followFrom<W, S extends FollowStep<W>>(point: EditPoint, now: Trail<S>, cursor: number): ((id: string) => string | undefined) | undefined {
    const at = pointsAt.get(point) as PointAt<S> | undefined;
    if (at === undefined) return undefined;
    // The way from the point to where the steps stand now, leg by leg.
    const legs: FollowLeg[] = [];
    let trail = at.trail;
    let from = at.step === undefined ? 0 : trail.steps.indexOf(at.step) + 1;
    if (from === 0 && at.step !== undefined) return undefined;
    for (;;) {
        if (trail === now) {
            // On through the steps done since the point, or back through those before it Undo took back since.
            for (let i = from; i < cursor; i++) legs.push(onThrough(trail.steps[i]!));
            for (let i = from - 1; i >= cursor; i--) legs.push(backThrough(trail.steps[i]!));
            break;
        }
        // A run of the history that ended: on through the steps done as it did, into the next — none past the
        // point's own step undone then, which the history dropped as it started over.
        const ended = trail.ended;
        if (ended === undefined || ended === "discarded" || from > ended.done) return undefined;
        for (let i = from; i < ended.done; i++) legs.push(onThrough(trail.steps[i]!));
        const renamed = ended.renamed;
        if (renamed.size > 0) legs.push((id) => renamed.get(id) ?? id);
        trail = ended.next;
        from = 0;
    }
    return (id) => {
        let stands: string | undefined = id;
        for (const leg of legs) {
            stands = leg(stands);
            if (stands === undefined) return undefined;
        }
        return stands;
    };
}

/**
 * The moves a session's drafts hold once some steps are done: each entry that stands under another id than the one it
 * began under, by the id it stands under now, to the id it began under — where its source holds it, if it does. An
 * entry moved on again is still the one it began as; one moved back where it began is no move; and one another entry
 * came to stand over — moved there, or made there — is followed no further. An entry its source holds under the id a
 * step finds it under begins there, whatever an earlier step did: a Save has landed its earlier move.
 *
 * Which of them hold — the entry there still, none under the id it began under — is the session's to say, of its
 * drafts as they stand (`EditSession.moved`).
 *
 * @typeParam W - The collection's projection of an entry
 * @param carried - The moves the drafts held as this run of the history started, by the id each entry stood under then
 * @param steps - The run's steps
 * @param done - How many of them are done
 * @param stored - Whether the source holds an entry under an id, as the session began from it
 * @returns Each moved entry's id as it began, by the id it stands under now
 */
export function movesThrough<W>(carried: ReadonlyMap<string, string>, steps: readonly FollowStep<W>[], done: number,
    stored: (id: string) => boolean): Map<string, string> {
    let moved = new Map(carried);
    for (let i = 0; i < done; i++) {
        const step = steps[i]!;
        if (step.moves === undefined && moved.size === 0) continue;
        const on = onThrough(step);
        const next = new Map<string, string>();
        for (const [id, began] of moved) {
            const stands = on(id);
            if (stands !== undefined && !stringEqual(stands, began)) next.set(stands, began);
        }
        for (const [from, to] of step.moves ?? []) {
            // Moved for the first time, or from where its source holds it now.
            if (!moved.has(from) || stored(from)) next.set(to, from);
        }
        moved = next;
    }
    return moved;
}
