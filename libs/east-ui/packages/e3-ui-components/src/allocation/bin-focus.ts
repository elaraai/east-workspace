/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The bin a pick in Search Records gives the keyboard to (#1398). The board
 * selects it and follows it into view, and the element that stands for it in
 * the layout shown — the Timeline's card, the Table's row, a narrow card's
 * bin — takes the focus as it is drawn, so the selection's ring and the focus
 * are on the same bin. The board drops it once taken, once the bin is no
 * longer the one selected, or once the viewer does something else.
 *
 * @packageDocumentation
 */

import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from "react";
import { StringType, equalFor } from "@elaraai/east";

const keyEqual = equalFor(StringType);

/** The bin given the keyboard, as the board's views read it. */
export interface BinFocus {
    /** The bin's key while it waits for its element; `undefined` while no pick waits. */
    readonly id: string | undefined;
    /** Its element took the focus. */
    readonly done: () => void;
}

/** No bin waits for the keyboard. */
const NO_BIN: BinFocus = { id: undefined, done: () => {} };

/** The bin a pick gave the keyboard to, for the board's views. */
export const BinFocusContext = createContext<BinFocus>(NO_BIN);

/**
 * An element that stands for a bin in a view: drawn while its bin is the one a pick gave the keyboard to, it takes the
 * focus.
 *
 * @param id - The bin it stands for; `undefined` for an element of no bin
 * @returns The ref for the element
 */
export function useBinFocusTarget<E extends HTMLElement>(id: string | undefined): RefObject<E | null> {
    const focus = useContext(BinFocusContext);
    const el = useRef<E | null>(null);
    const given = id !== undefined && focus.id !== undefined && keyEqual(focus.id, id);
    useLayoutEffect(() => {
        if (!given || el.current === null) return;
        el.current.focus({ preventScroll: true });
        focus.done();
    }, [given, focus]);
    return el;
}
