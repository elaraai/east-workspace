/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What an action cell asks of its sheet (#1475): one object every row shares,
 * held still for the sheet's life, so no row renders again for it (#858). A
 * row's offer reads every resident row — its gate sees them all — so an edit
 * anywhere may move it: the host's store says so, and only the action cells,
 * which listen, draw again; every other cell keeps its memo.
 *
 * @packageDocumentation
 */

import type { ActionCase, ActionOffer } from "./model.js";
import type { ActionHeld } from "./ActionCell.js";

/** What an action cell asks of its sheet. */
export interface SheetActionHost {
    /** Hear that what the cells show may have moved: the rows, the drafts, an overlay. */
    subscribe: (listener: () => void) => () => void;
    /** Moves whenever the cells should look again. */
    version: () => number;
    /** A row's offer at an action column, its gate asked over the row's context. */
    offer: (r: number, key: string) => ActionOffer | undefined;
    /** Whether the cell draws its controls (T9, X4). */
    controls: (r: number, key: string) => boolean;
    /** Whether a phone's cell offers a start (`Mobile Sheet Spec.md` SH7): nothing taken yet, and the row may act now. */
    startable: (r: number, key: string) => boolean;
    /** The control of the cell whose overlay is open. */
    held: (r: number, key: string) => ActionHeld | undefined;
    /** Whether the cell's value is a draft (ST3). */
    dirty: (r: number, key: string) => boolean;
    /** Whether an auto save of the cell is in flight (N2). */
    live: (r: number, key: string) => boolean;
    /** The next half pressed: a button taken at once, a choice's Menu or a form's Popover opened (P2–P4). */
    next: (r: number, key: string, c: ActionCase, anchor: HTMLElement) => void;
    /** The ▾ part pressed: the Menu of the rest of the offer (P5). */
    more: (r: number, key: string, anchor: HTMLElement) => void;
    /** The pointer rests on a control, or leaves it (P8). */
    preview: (r: number, key: string, c: ActionCase | undefined) => void;
}

/** The store a host's cells listen to. */
export interface ActionStore {
    subscribe: (listener: () => void) => () => void;
    version: () => number;
    /** Tell the cells to look again. */
    bump: () => void;
}

/**
 * A store the action cells listen to.
 *
 * @returns The store
 */
export function createActionStore(): ActionStore {
    const listeners = new Set<() => void>();
    let seq = 0;
    return {
        subscribe: (listener) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        version: () => seq,
        bump: () => {
            seq += 1;
            for (const listener of [...listeners]) listener();
        },
    };
}
