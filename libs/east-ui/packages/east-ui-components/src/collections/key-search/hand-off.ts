/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A key search pick's hand-off of the keyboard (#1398). A pick — a match
 * chosen from the box's popup, or Enter in the box (`KeySearchJump`) — asks
 * the host's view for its match, and the keyboard goes with it: the view's
 * focus lands where its ring does, on the match, so the keys go on from there.
 * A step — Previous or Next match — leaves the keyboard in the box, to step on.
 *
 * The box's combobox gives the focus back to its input in the frame after a
 * pick, as a combobox does once it closes (Zag's final focus), so a view that
 * took the focus at once would lose it again: the hand-off takes it for the
 * view once that frame has run and the match has landed, whichever is later.
 * It takes nothing once the viewer has moved on — the focus taken somewhere
 * other than the box, a key pressed in some control, a pointer pressed or a
 * wheel turned. A focus the box lost meanwhile, to the page's body — its
 * input drawn again, as a narrowing the pick cleared draws the toolbar again —
 * or to the icon the box folded to as the row lost room for it, is the view's
 * to take. A host takes it only for a match its view draws.
 *
 * A host wraps its source in {@link PickHandOff.search} — a pick arms the
 * hand-off, a step or a clear drops it — and lands it as the match shows,
 * with what takes the keyboard there: the grid's focus on the match's cell, a
 * row's focus, a row's name.
 *
 * @packageDocumentation
 */

import { useEffect, useState } from "react";
import type { KeySearchJump } from "./index.js";

/**
 * The key search's box — in a toolbar's row, or in the popover its icon opens: where a pick leaves the focus — and the
 * icon it folds to, which takes the focus the box held as the row folds it (`toolbar-item.tsx`).
 */
const KEY_SEARCH_BOX = '[data-part="dataset-key-search"], [data-key-search="icon"]';

/** What a host's key search source jumps and clears by. */
export interface PickingSource {
    /** Jumps the host to a match's row. */
    jump: (row: number, how: KeySearchJump) => void;
    /** Drops the query and the host's jump. */
    clear: () => void;
}

/** A key search pick's hand-off of the keyboard to its host's view — see the module docs. */
export interface PickHandOff {
    /** A pick: the keyboard goes to its match as the match lands, unless the viewer moves on first. */
    arm(): void;
    /**
     * The match of the pick armed has landed: `take` brings the keyboard to it — at once, or once the box has let it go.
     * Nothing waits without a pick armed, and a pick hands the keyboard over once.
     */
    land(take: () => void): void;
    /** A step, a clear, a jump of another's: no hand-off waits. */
    drop(): void;
    /**
     * A host's source, as the box drives it: a pick arms the hand-off, a step or a clear drops it, and each goes on to
     * the source. A host keeps the one it made while its source holds.
     */
    search<S extends PickingSource>(source: S): S;
}

/** A pick waiting: whether the frame the box gives the focus back in has run, and what takes the keyboard once its match has landed. */
interface Waiting {
    framed: boolean;
    take: (() => void) | undefined;
}

/**
 * Creates a key search pick's hand-off of the keyboard — see the module docs.
 *
 * @returns The hand-off, nothing armed
 */
export function createPickHandOff(): PickHandOff {
    let waiting: Waiting | undefined;
    let stop: (() => void) | undefined;
    const drop = (): void => {
        waiting = undefined;
        const end = stop;
        stop = undefined;
        end?.();
    };
    const hand = (): void => {
        const pick = waiting;
        if (pick === undefined || !pick.framed || pick.take === undefined) return;
        const take = pick.take;
        drop();
        // Moved on since the pick — the focus taken somewhere other than the box: the keyboard stays where it went.
        const at = document.activeElement;
        if (at !== null && at !== document.body && at.closest(KEY_SEARCH_BOX) === null) return;
        take();
    };
    const arm = (): void => {
        drop();
        if (typeof document === "undefined" || typeof requestAnimationFrame === "undefined") return;
        const pick: Waiting = { framed: false, take: undefined };
        waiting = pick;
        // A key pressed in some control since the pick — typed in the box again, pressed in another part — keeps the
        // keyboard where it is; one pressed with the focus lost, on the body, reaches no one and changes nothing. A
        // pointer pressed or a wheel turned anywhere is the viewer's next move: nothing is taken from it.
        const onKey = (event: KeyboardEvent): void => {
            if (event.target instanceof Element && event.target !== document.body) drop();
        };
        document.addEventListener("keydown", onKey, true);
        document.addEventListener("pointerdown", drop, true);
        document.addEventListener("wheel", drop, { capture: true, passive: true });
        // The box's combobox gives the focus back to its input in the frame after a pick: the keyboard is taken once
        // that frame has run.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const frame = requestAnimationFrame(() => {
            timer = setTimeout(() => {
                pick.framed = true;
                hand();
            }, 0);
        });
        stop = () => {
            document.removeEventListener("keydown", onKey, true);
            document.removeEventListener("pointerdown", drop, true);
            document.removeEventListener("wheel", drop, { capture: true });
            cancelAnimationFrame(frame);
            if (timer !== undefined) clearTimeout(timer);
        };
    };
    return {
        arm,
        land: (take) => {
            if (waiting === undefined) return;
            waiting.take = take;
            hand();
        },
        drop,
        search: (source) => ({
            ...source,
            jump: (row: number, how: KeySearchJump) => {
                if (how === "pick") arm();
                else drop();
                source.jump(row, how);
            },
            clear: () => {
                drop();
                source.clear();
            },
        }),
    };
}

/**
 * A key search pick's hand-off of the keyboard, kept while its host is mounted and dropped as it unmounts — see the
 * module docs.
 *
 * @returns The hand-off — the same one while the host is mounted
 */
export function usePickHandOff(): PickHandOff {
    const [handOff] = useState(createPickHandOff);
    useEffect(() => () => handOff.drop(), [handOff]);
    return handOff;
}
