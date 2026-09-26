/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas's moves in flight (#825) — ONE small store per canvas, outside
 * React, that the rows, the elements, the ghost and the live region read:
 *
 * - a pointer drag of an element, from its press ({@link PlanGrab}) — the
 *   element, what it moves (the whole element or one end) and where it was
 *   grabbed — and where it would land now ({@link PlanProposal}). The drag
 *   layer carries the drag; the rows read the grab to say where it lands.
 * - a keyboard carry ({@link PlanCarry}): Space on an element picks it up, and
 *   the canvas moves it by keys until it drops or cancels.
 *
 * A proposal moves on every pointer step, so it never passes through React
 * state: the ghost and the landing band read it here, and only they render.
 *
 * @packageDocumentation
 */

import { createContext, useContext } from "react";
import type { PlanInstantValue } from "../instant.js";
import type { RowKey } from "../plan-state.js";
import type { PlanScale } from "../scale.js";
import type { PlanWords } from "../words.js";
import type { PlanMoveMode, PlanSpan } from "./move-math.js";

/** What an element is, for its look in the ghost. */
export type PlanMovableKind = "run" | "chip" | "tile" | "mark";

/** An element that moves — what the canvas knows of it when it is picked up. */
export interface PlanMovable {
    /** Its row's key. */
    readonly rowKey: RowKey;
    /** Its key — its item's (`edit.key`). */
    readonly key: string;
    /** Its name, for the ghost and the announcements. */
    readonly label: string;
    /** What it is. */
    readonly kind: PlanMovableKind;
    /** Its extent — a point element's instant twice. */
    readonly span: PlanSpan;
    /** Its row's item type, as the IR prints it — the rows it may move to share it. */
    readonly items: string;
    /** Whether it has two ends to resize. */
    readonly resize: boolean;
}

/** A pointer drag of an element, from its press. */
export interface PlanGrab {
    /** The element. */
    readonly movable: PlanMovable;
    /** What the drag moves — the element, or one end. */
    readonly mode: PlanMoveMode;
    /** Where it was pressed, as a window fraction. */
    readonly grabFrac: number;
}

/** Where a gesture would land now — the row, and the extent there. */
export interface PlanProposal {
    readonly rowKey: RowKey;
    readonly span: PlanSpan;
}

/** A keyboard carry — the element, and where it would land now. */
export interface PlanCarry {
    readonly movable: PlanMovable;
    readonly to: PlanProposal;
    /** Whether the canvas's `canDrop` refuses it there. */
    readonly refused: boolean;
}

/** Words for the live region, numbered so the same words said twice are said again. */
export interface PlanSaid {
    readonly text: string;
    readonly seq: number;
}

/** Two instants alike — the same arm and value. */
function sameInstant(a: PlanInstantValue, b: PlanInstantValue): boolean {
    if (a.type !== b.type) return false;
    return a.type === "time" ? a.value.getTime() === (b.value as Date).getTime() : a.value === b.value;
}

/** Two proposals alike. */
function sameProposal(a: PlanProposal | null, b: PlanProposal): boolean {
    return a !== null && a.rowKey === b.rowKey && sameInstant(a.span.start, b.span.start) && sameInstant(a.span.end, b.span.end);
}

/**
 * The canvas's moves in flight — see the module docs.
 */
export class PlanEditStore {
    /** The element a pointer press picked, while its drag may be in flight. */
    grab: PlanGrab | null = null;
    /** Whether Shift is held during a pointer drag — the finer unit. */
    shift = false;
    /** Where the pointer drag would land now. */
    proposal: PlanProposal | null = null;
    /** The keyboard carry, while one lasts. */
    carry: PlanCarry | null = null;
    /** The live region's last words. */
    said: PlanSaid | null = null;
    /** Each element's movable, by its node — how a key finds what Space picks up. */
    private readonly nodes = new WeakMap<Element, PlanMovable>();
    /** The element to focus once the canvas has drawn a keyboard drop. */
    private focusAfter: { rowKey: RowKey; key: string } | null = null;
    private readonly listeners = new Set<() => void>();
    private release: (() => void) | undefined;

    /** Listen to every change. */
    readonly subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    private emit(): void {
        for (const l of [...this.listeners]) l();
    }

    /**
     * A pointer pressed an element — arm its drag. Shift is followed from here
     * until the press ends.
     *
     * @param grab - The element, what it moves and where it was pressed
     * @param doc - The document the press is in
     */
    arm(grab: PlanGrab, doc: Document): void {
        this.release?.();
        this.grab = grab;
        this.proposal = null;
        this.shift = false;
        const follow = (e: KeyboardEvent | PointerEvent) => { this.shift = e.shiftKey; };
        const end = () => { this.release?.(); };
        doc.addEventListener("keydown", follow, true);
        doc.addEventListener("keyup", follow, true);
        doc.addEventListener("pointermove", follow, true);
        this.release = () => {
            doc.removeEventListener("keydown", follow, true);
            doc.removeEventListener("keyup", follow, true);
            doc.removeEventListener("pointermove", follow, true);
            doc.removeEventListener("pointerup", end, true);
            doc.removeEventListener("pointercancel", end, true);
            this.release = undefined;
        };
        doc.addEventListener("pointerup", end, true);
        doc.addEventListener("pointercancel", end, true);
    }

    /** The drag ended — its grab and proposal go. */
    disarm(): void {
        this.release?.();
        if (this.grab === null && this.proposal === null) return;
        this.grab = null;
        this.proposal = null;
        this.emit();
    }

    /**
     * Where the pointer drag would land now — told only when it moved.
     *
     * @param p - The row and the extent
     */
    propose(p: PlanProposal): void {
        if (sameProposal(this.proposal, p)) return;
        this.proposal = p;
        this.emit();
    }

    /**
     * Start, move or end the keyboard carry.
     *
     * @param carry - The carry, or `null` when it ends
     */
    setCarry(carry: PlanCarry | null): void {
        this.carry = carry;
        this.emit();
    }

    /**
     * The carry, when it lands on this row — the row draws its landing band.
     *
     * @param rowKey - The row
     * @returns The carry, or `null`
     */
    carryOn(rowKey: RowKey): PlanCarry | null {
        return this.carry !== null && this.carry.to.rowKey === rowKey ? this.carry : null;
    }

    /**
     * Whether the keyboard carries this element now.
     *
     * @param rowKey - Its row
     * @param key - Its key
     * @returns Whether it is carried
     */
    carries(rowKey: RowKey, key: string): boolean {
        return this.carry !== null && this.carry.movable.rowKey === rowKey && this.carry.movable.key === key;
    }

    /**
     * Put words in the live region.
     *
     * @param text - The words
     */
    say(text: string): void {
        this.said = { text, seq: (this.said?.seq ?? 0) + 1 };
        this.emit();
    }

    /**
     * Record an element's node, so a key pressed on it finds what it moves.
     *
     * @param node - The element's node
     * @param movable - What it moves
     */
    register(node: Element, movable: PlanMovable): void {
        this.nodes.set(node, movable);
    }

    /**
     * What a node moves — `undefined` for a node that moves nothing.
     *
     * @param node - The focused node
     * @returns Its movable
     */
    movableOf(node: Element): PlanMovable | undefined {
        return this.nodes.get(node);
    }

    /**
     * Ask for an element to be focused once the canvas has drawn — where a
     * keyboard drop leaves it.
     *
     * @param rowKey - Its row
     * @param key - Its key
     */
    focusAfterDraw(rowKey: RowKey, key: string): void {
        this.focusAfter = { rowKey, key };
    }

    /**
     * The element to focus now the canvas has drawn, once.
     *
     * @returns The element, or `null`
     */
    takeFocus(): { rowKey: RowKey; key: string } | null {
        const f = this.focusAfter;
        this.focusAfter = null;
        return f;
    }
}

/** What the canvas's rows and elements need to move one (#825). */
export interface PlanEditContextValue {
    /** The moves in flight. */
    store: PlanEditStore;
    /** The canvas's drag surface — `undefined` while nothing can move (no session, no id, the narrow layout). */
    surface: string | undefined;
    /** The id of the words that tell a keyboard reader how to move an element. */
    helpId: string;
    /** The Plan recipe's styles — the ghost's look. */
    styles: Record<string, Record<string, unknown>>;
    /** The canvas's words. */
    words: PlanWords;
    /** The shared scale. */
    scale: PlanScale;
}

/** The canvas's moves (#825) — `null` outside a canvas that takes them. */
export const PlanEditContext = createContext<PlanEditContextValue | null>(null);

/**
 * The canvas's moves.
 *
 * @returns What its rows and elements move with, or `null`
 */
export function usePlanEdit(): PlanEditContextValue | null {
    return useContext(PlanEditContext);
}
