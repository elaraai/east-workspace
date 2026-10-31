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
 * - **Which cells.** At the Plan's finest zoom, a position its row says takes
 *   a typed number (`edits.values`), in a bucket holding one of its own values
 *   — written at that value's date, so it replaces it — or none, written at the
 *   bucket's start. A coarser cell is a summary of the values beneath it, and
 *   takes none: its tooltip says to zoom to the finest, and a double click or
 *   Enter on it zooms there, about its period. A parent's position drawing its
 *   children's subtotals takes none, and nor does a bucket folding several
 *   values: its tooltip names the resolution they are at, and the Plan's zoom
 *   showing them apart, where it has one.
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
    /** The date the value is written under: the one value the bucket held, so it replaces it; else the bucket's start. */
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
    /** The resolutions the Plan zooms to, finest first ({@link planZooms}): none, where its axis states none. */
    readonly zooms: readonly TimeResolution[];
}

/** A cell focus goes to once a zoom lands: a row's, at the instant its bucket holds, at a resolution. */
export interface PlanTypingFocus {
    readonly rowKey: RowKey;
    /** The instant, in the axis's numbers. */
    readonly at: number;
    readonly resolution: TimeResolution;
}

/** The canvas's one input: the cell it is open on, if any. */
export class PlanTypingStore {
    #open: PlanTypingOpen | null = null;
    #focusing: PlanTypingFocus | null = null;
    readonly #listeners = new Set<() => void>();

    /**
     * Focus a row's cell as it draws at a resolution: the cell that holds the
     * instant — once a zoom lands, where a double click or Enter on a coarser
     * cell zooms to edit it (#1438), or at once, where a conflict's Go to
     * goes to it. The row hears it, and draws again to take it.
     *
     * @param focus - The row, the instant and the resolution
     */
    focusOnZoom(focus: PlanTypingFocus): void {
        this.#focusing = focus;
        this.#emit();
    }

    /** The focus a row's cells wait to take, if any ({@link takeFocus}). */
    get focusing(): PlanTypingFocus | null {
        return this.#focusing;
    }

    /**
     * The focus a row's cells take as they draw at a resolution, taken once:
     * the instant its cell holds, where the zoom landed on that row.
     *
     * @param rowKey - The row drawing
     * @param resolution - The resolution it draws at
     * @returns The instant, or `undefined` where no focus waits for it
     */
    takeFocus(rowKey: RowKey, resolution: TimeResolution | undefined): number | undefined {
        const focusing = this.#focusing;
        if (focusing === null || focusing.rowKey !== rowKey || focusing.resolution !== resolution) return undefined;
        this.#focusing = null;
        return focusing.at;
    }

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

/**
 * The focus a row's cells wait to take: what draws the row again as a focus
 * is asked of it, so it takes it as it draws ({@link PlanTypingStore.takeFocus}).
 *
 * @param store - The canvas's input, or `undefined` while it takes no typing
 * @param rowKey - The row
 * @returns The focus asked of the row, or `null`
 */
export function usePlanTypingFocus(store: PlanTypingStore | undefined, rowKey: RowKey): PlanTypingFocus | null {
    const subscribe = useCallback((listener: () => void) => store?.subscribe(listener) ?? (() => {}), [store]);
    return useSyncExternalStore(store !== undefined ? subscribe : NO_SUBSCRIPTION, () => (store?.focusing?.rowKey === rowKey ? store.focusing : null));
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

/** The time resolutions, from the finest. */
const RESOLUTIONS: readonly TimeResolution[] = ["hour", "day", "week", "month", "quarter", "year"];

/** A resolution's place among them, the finest first. */
const rankOf = (resolution: TimeResolution): number => RESOLUTIONS.indexOf(resolution);

/**
 * The resolutions a Plan zooms to (#1438): its resolution segment's, and the
 * one its axis opens at — but `auto`, which is none of them.
 *
 * @param segment - The resolution segment's resolutions
 * @param opened - The resolution the axis opens at
 * @returns Them, the finest first
 */
export function planZooms(segment: readonly string[], opened: string | undefined): readonly TimeResolution[] {
    const named = new Set<string>(opened === undefined ? segment : [...segment, opened]);
    return RESOLUTIONS.filter((resolution) => named.has(resolution));
}

/**
 * Whether a table cell takes a typed number at a zoom (#1438): at the Plan's
 * finest zoom alone, where a cell holds at most the values of its own bucket.
 * A coarser cell is a summary of the values beneath it — a number typed there
 * would stand for none of them — so it takes none. On an axis of no
 * resolution, every cell takes one.
 *
 * @param zoom - The resolution the Plan shows
 * @param zooms - The resolutions it zooms to, the finest first
 * @returns Whether its cells take one
 */
export function typesAt(zoom: TimeResolution | undefined, zooms: readonly TimeResolution[]): boolean {
    const finest = zooms[0];
    return zoom === undefined || finest === undefined || rankOf(zoom) <= rankOf(finest);
}

/**
 * The zoom a bucket folding values one each `each` shows them apart at, of
 * the Plan's (#1438): the coarsest no coarser than they are. None where none
 * is, so a bucket never names a zoom the Plan lacks.
 *
 * @param each - The resolution the values are at
 * @param zooms - The resolutions the Plan zooms to, the finest first
 * @returns The zoom, or `undefined` where no zoom of the Plan's shows them apart
 */
export function zoomApart(each: TimeResolution | undefined, zooms: readonly TimeResolution[]): TimeResolution | undefined {
    if (each === undefined) return undefined;
    return [...zooms].reverse().find((zoom) => rankOf(zoom) <= rankOf(each));
}
