/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Typing a number into a table cell (#1436, #1438) — the canvas's one input,
 * open on one cell at a time, kept in a small store outside React that the
 * table rows read: a row draws the input only while it holds it, so opening
 * and moving it renders the rows it leaves and joins, never the canvas.
 *
 * - **Which cells.** A position its row says takes a typed number
 *   (`edits.values`), in a bucket holding one of its own values, or none. A
 *   parent's position drawing its children's subtotals takes none, and nor
 *   does a bucket folding several values: its tooltip names the resolution
 *   they are at.
 * - **The text.** The value as its position's format reads it: a percent's
 *   `0.82` opens as `82`, and `82` or `82%` writes `0.82`; digit groups, the
 *   viewer's decimal separator and a `k` or `m` read as the Sheet's grammar
 *   reads them (#852). A position over Integers takes whole numbers only.
 *
 * @packageDocumentation
 */

import { useCallback, useSyncExternalStore } from "react";
import type { Formatters, TickFormatOpt } from "@elaraai/east-ui-components";
import { parseQuantity } from "../../sheet/parse/quantity.js";
import type { TimeResolution } from "../../shared/time/calendar-math.js";
import type { PlanInstantValue } from "../instant.js";
import type { RowKey } from "../plan-state.js";

/** A cell a typed number goes into: its row, its position among the row's table series, and its bucket as `data-cell` names it. */
export interface PlanTypingCell {
    readonly rowKey: RowKey;
    readonly position: number;
    readonly cell: string;
}

/** The input open on a cell, and the key that opened it, typed in as it opens. */
export interface PlanTypingOpen extends PlanTypingCell {
    readonly seed: string | undefined;
}

/** A number typed into a cell, or the cell cleared — what the canvas's session drafts as one gesture. */
export interface PlanTypedValue {
    readonly rowKey: RowKey;
    readonly position: number;
    /** The bucket's start: the key the value is written under. */
    readonly at: PlanInstantValue;
    /** The bucket as words, as the history's step names it. */
    readonly bucket: string;
    /** The number, or `undefined` to clear the cell. */
    readonly value: number | undefined;
    /** The number as the cell prints it. */
    readonly text: string;
}

/** The canvas's typing, as its table rows reach it (`PlanEditContextValue.typing`). */
export interface PlanTyping {
    /** The one input. */
    readonly store: PlanTypingStore;
    /**
     * Draft a typed number, or a cleared cell, as one step of the session's history.
     *
     * @returns Whether the session took it
     */
    readonly type: (typed: PlanTypedValue) => boolean;
    /** Whether a tap on a cell opens the input in a popover anchored to it: below 480px of main. */
    readonly popover: boolean;
}

/** The canvas's one input: the cell it is open on, if any. */
export class PlanTypingStore {
    #open: PlanTypingOpen | null = null;
    readonly #listeners = new Set<() => void>();

    /** The cell the input is open on. */
    get open(): PlanTypingOpen | null {
        return this.#open;
    }

    /**
     * Hear the input open, move or close.
     *
     * @param listener - Called on each change
     * @returns The unsubscribe
     */
    readonly subscribe = (listener: () => void): (() => void) => {
        this.#listeners.add(listener);
        return () => { this.#listeners.delete(listener); };
    };

    /**
     * Open the input on a cell.
     *
     * @param cell - The cell
     * @param seed - The key that opened it, typed in as it opens
     */
    openAt(cell: PlanTypingCell, seed?: string): void {
        this.#open = { ...cell, seed };
        this.#emit();
    }

    /** Close the input. */
    close(): void {
        if (this.#open === null) return;
        this.#open = null;
        this.#emit();
    }

    #emit(): void {
        for (const listener of this.#listeners) listener();
    }
}

const NO_SUBSCRIPTION = () => () => {};

/**
 * The input, while a row holds it.
 *
 * @param store - The canvas's input, or `undefined` while it takes no typing
 * @param rowKey - The row
 * @returns The open input, or `null` for every row but the one it is open on
 */
export function usePlanTypingOpen(store: PlanTypingStore | undefined, rowKey: RowKey): PlanTypingOpen | null {
    const subscribe = useCallback((listener: () => void) => store?.subscribe(listener) ?? (() => {}), [store]);
    return useSyncExternalStore(store !== undefined ? subscribe : NO_SUBSCRIPTION, () => (store?.open?.rowKey === rowKey ? store.open : null));
}

/** A percent prints its value a hundred times over, so its text reads back divided. */
const isPercent = (format: TickFormatOpt): boolean => format?.type === "percent";

/** A number to fifteen significant digits: a percent's `0.07` is `7`, never `7.000000000000001`. */
const significant = (n: number): number => Number(n.toPrecision(15));

/**
 * The text a cell's input opens on: its value as its format reads it — a
 * percent's `0.82` as `82` — bare, in the viewer's language, never grouped.
 *
 * @param value - The cell's value, or `undefined` for an empty cell
 * @param format - Its position's format
 * @param words - The canvas's formatters
 * @returns The text
 */
export function typedText(value: number | undefined, format: TickFormatOpt, words: Formatters): string {
    if (value === undefined) return "";
    return words.bare(isPercent(format) ? significant(value * 100) : value);
}

/**
 * What a cell's typed text writes: the number its format reads it as — a
 * percent's `82` or `82%` as `0.82` — through the Sheet's grammar in the
 * viewer's language (#852).
 *
 * @param text - The typed text
 * @param format - Its position's format
 * @param words - The canvas's formatters
 * @returns The number, `undefined` for no text (the cell cleared), or `null` for text that is no number
 */
export function readTyped(text: string, format: TickFormatOpt, words: Formatters): number | null | undefined {
    const percent = isPercent(format);
    const n = parseQuantity(percent ? text.replace(/%/g, "") : text, words.separators, false);
    if (n === null || n === undefined) return n;
    return percent ? significant(n / 100) : n;
}

const DAY_MS = 86_400_000;

/**
 * The resolution a position's values are at, from the least gap between two
 * of them — what a bucket folding several of them names, so its tooltip says
 * where they take typing.
 *
 * @param instants - The values' instants, in epoch milliseconds, in their keys' order
 * @returns The resolution, or `undefined` with fewer than two of them
 */
export function resolutionOfValues(instants: readonly number[]): TimeResolution | undefined {
    // A collection's values come in its keys' order, so the least gap is between neighbours.
    let least = Infinity;
    for (let i = 1; i < instants.length; i++) {
        const gap = Math.abs(instants[i]! - instants[i - 1]!);
        if (gap > 0 && gap < least) least = gap;
    }
    if (least === Infinity) return undefined;
    return least < DAY_MS ? "hour" : least < 7 * DAY_MS ? "day" : least < 28 * DAY_MS ? "week"
        : least < 89 * DAY_MS ? "month" : least < 365 * DAY_MS ? "quarter" : "year";
}
