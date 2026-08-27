/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The window ledger (#577) — the scroll geometry of a paged canvas, in SOURCE
 * ELEMENTS.
 *
 * # Why elements, and not rows
 *
 * A virtualizer needs to know how tall the document is. A paged canvas cannot
 * say how many ROWS it has: the series pipeline maps each window of source
 * elements into canvas rows client-side, emitting several per element or none
 * (`match:` filters), so the row count of an unvisited window is unknowable
 * without fetching it — the one thing paging exists to avoid.
 *
 * What IS exactly known is `total()`, the source's element count. So the extent
 * is denominated in elements: every window occupies a slot, and a slot is worth
 * `SLOT_PX` per element until the window has actually been visited, after which
 * it is worth the pixels its rows measured.
 *
 * # The two properties that make scrolling feel right
 *
 * **A window's contribution changes at most once.** `SLOT_PX` is seeded from
 * the first window to land and then FROZEN for the life of the source, so the
 * extent is revised only when a window is visited for the first time — never
 * re-estimated globally, never mid-gesture (demand is idle-gated by the caller).
 *
 * **Eviction is free.** A visited window keeps its measured height forever, so
 * dropping its rows back to a spacer leaves the extent, and every offset below
 * it, exactly unchanged. Nothing moves, no scroll compensation runs, and
 * re-entering that region later restores the same geometry. This is the
 * height-map idiom (CodeMirror, CSS `contain-intrinsic-size`) and it is what
 * makes it safe to evict aggressively.
 *
 * Pure arithmetic: no React, no East, no fetching.
 *
 * @packageDocumentation
 */

/** Fallback slot height per element, before any window has landed. */
const DEFAULT_SLOT_PX = 32;

/** Bounds on the seeded slot height. The upper bound also keeps the document
 *  under the browser's maximum element height on very large sources. */
const MIN_SLOT_PX = 1;
const MAX_SLOT_PX = 64;

/**
  * The tallest UNVISITED extent to describe. Blink clamps element heights around
  * 3.3e7; staying well below keeps the offset mapping linear and exact.
  *
  * This bounds `slotPx × total` — the estimate. Visited windows contribute their
  * TRUE measured height on top, so the document can exceed this by the height of
  * the windows actually visited, which residency bounds. The guarantee is on the
  * part that scales with the source, not on the part that scales with what you
  * have looked at.
  */
const MAX_DOC_PX = 8e6;

/**
 * A window's measured contribution — its pixel height and how many canvas rows
 * it produced. `rows` is what a row budget is spent against; `px` is geometry.
 */
export interface WindowMeasure {
    px: number;
    rows: number;
}

/** The immutable ledger state. */
export interface WindowLedger {
    /** Elements per window. */
    readonly pageSize: number;
    /** The source's element count. */
    readonly total: number;
    /** Number of windows (`ceil(total / pageSize)`). */
    readonly windows: number;
    /** Pixels per element for a window never visited — seeded once, then frozen. */
    readonly slotPx: number;
    /** Measured windows by index; absent ⇒ never visited. */
    readonly measured: ReadonlyMap<number, WindowMeasure>;
    /** Running offset of each window, `windows + 1` entries (the last is the
     *  document height). Derived; kept here so lookups are O(log W). */
    readonly prefix: ReadonlyArray<number>;
}

/** Elements in window `w` — the last one is short unless the total divides. */
export function elementsIn(ledger: Pick<WindowLedger, "pageSize" | "total">, w: number): number {
    const start = w * ledger.pageSize;
    return Math.max(0, Math.min(ledger.pageSize, ledger.total - start));
}

/** The pixel height window `w` contributes: measured if it has ever been
 *  visited, otherwise its element count at the frozen slot rate. */
export function slotHeight(ledger: WindowLedger, w: number): number {
    const seen = ledger.measured.get(w);
    if (seen !== undefined) return seen.px;
    return ledger.slotPx * elementsIn(ledger, w);
}

/** Recompute the running offsets. O(W): 250 entries at 50k elements. */
function prefixOf(ledger: Omit<WindowLedger, "prefix">): number[] {
    const prefix = new Array<number>(ledger.windows + 1);
    let at = 0;
    for (let w = 0; w < ledger.windows; w++) {
        prefix[w] = at;
        const seen = ledger.measured.get(w);
        at += seen !== undefined ? seen.px : ledger.slotPx * elementsIn(ledger, w);
    }
    prefix[ledger.windows] = at;
    return prefix;
}

/**
 * Build a ledger for a source of `total` elements.
 *
 * @param total - The source's element count (from `total()`)
 * @param pageSize - Elements per window
 * @returns A ledger with nothing measured yet
 */
export function createLedger(total: number, pageSize: number): WindowLedger {
    const windows = pageSize > 0 ? Math.ceil(Math.max(0, total) / pageSize) : 0;
    const base: Omit<WindowLedger, "prefix"> = {
        pageSize,
        total: Math.max(0, total),
        windows,
        slotPx: DEFAULT_SLOT_PX,
        measured: new Map(),
    };
    return { ...base, prefix: prefixOf(base) };
}

/**
 * Record a window's measured geometry.
 *
 * The FIRST measurement also seeds `slotPx` — every unvisited window is then
 * described in terms of the one window we have actually seen, which is a far
 * better guess than a constant and, being frozen, never moves again.
 *
 * @param ledger - The current ledger
 * @param w - Window index
 * @param measure - Its measured pixel height and canvas-row count
 * @returns A new ledger (the same one when nothing changed)
 */
export function observeWindow(ledger: WindowLedger, w: number, measure: WindowMeasure): WindowLedger {
    if (w < 0 || w >= ledger.windows) return ledger;
    const prev = ledger.measured.get(w);
    if (prev !== undefined && prev.px === measure.px && prev.rows === measure.rows) return ledger;

    const measured = new Map(ledger.measured);
    measured.set(w, measure);

    // Seed the slot rate from the first window we ever measure, then freeze it.
    // A later re-measure of the same window updates ITS height, never the rate:
    // re-deriving the rate would move every unvisited window at once, which is
    // the global re-estimate this design exists to avoid.
    let slotPx = ledger.slotPx;
    if (ledger.measured.size === 0) {
        const elements = elementsIn(ledger, w);
        const perElement = elements > 0 ? measure.px / elements : DEFAULT_SLOT_PX;
        const ceiling = ledger.total > 0 ? Math.min(MAX_SLOT_PX, MAX_DOC_PX / ledger.total) : MAX_SLOT_PX;
        slotPx = Math.max(MIN_SLOT_PX, Math.min(ceiling, perElement));
    }

    const base: Omit<WindowLedger, "prefix"> = { ...ledger, measured, slotPx };
    return { ...base, prefix: prefixOf(base) };
}

/** Whether window `w` has ever been measured. */
export function isObserved(ledger: WindowLedger, w: number): boolean {
    return ledger.measured.has(w);
}

/** The document height. */
export function documentHeight(ledger: WindowLedger): number {
    return ledger.prefix[ledger.windows] ?? 0;
}

/** The pixel offset at which window `w` begins. */
export function offsetOfWindow(ledger: WindowLedger, w: number): number {
    if (w <= 0) return 0;
    if (w >= ledger.windows) return documentHeight(ledger);
    return ledger.prefix[w] ?? 0;
}

/** The window containing a pixel offset (binary search over the prefix). */
export function windowAtOffset(ledger: WindowLedger, px: number): number {
    if (ledger.windows === 0) return 0;
    if (px <= 0) return 0;
    if (px >= documentHeight(ledger)) return ledger.windows - 1;
    let lo = 0;
    let hi = ledger.windows - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((ledger.prefix[mid] ?? 0) <= px) lo = mid; else hi = mid - 1;
    }
    return lo;
}

/**
 * The source element at a pixel offset — what a scrollbar position MEANS, and
 * what a band's caption reports.
 *
 * Interpolates linearly inside the window, which is exact for an unvisited one
 * (its slot is `slotPx` per element by construction) and proportional for a
 * visited one.
 */
export function elementAtOffset(ledger: WindowLedger, px: number): number {
    if (ledger.total === 0) return 0;
    const w = windowAtOffset(ledger, px);
    const start = offsetOfWindow(ledger, w);
    const height = slotHeight(ledger, w);
    const within = height > 0 ? Math.min(1, Math.max(0, (px - start) / height)) : 0;
    const element = w * ledger.pageSize + within * elementsIn(ledger, w);
    return Math.min(ledger.total - 1, Math.max(0, Math.floor(element)));
}

/** The pixel offset of a source element — the inverse, for a seek jump. */
export function offsetOfElement(ledger: WindowLedger, element: number): number {
    if (ledger.total === 0 || ledger.pageSize <= 0) return 0;
    const clamped = Math.min(ledger.total - 1, Math.max(0, element));
    const w = Math.floor(clamped / ledger.pageSize);
    const within = clamped - w * ledger.pageSize;
    const elements = elementsIn(ledger, w);
    const frac = elements > 0 ? within / elements : 0;
    return offsetOfWindow(ledger, w) + frac * slotHeight(ledger, w);
}

/** Canvas rows a set of windows has been measured to produce — what a row
 *  budget is spent against (an unmeasured window counts as nothing, because
 *  nothing of it is resident). */
export function rowsIn(ledger: WindowLedger, windows: Iterable<number>): number {
    let n = 0;
    for (const w of windows) n += ledger.measured.get(w)?.rows ?? 0;
    return n;
}
