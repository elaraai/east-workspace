/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Shared row-virtualization frame for the grow-to-content data collections
 * (Matrix / Board / Roster / Calendar / Plan). Table / Library keep
 * their own bespoke virtualizers; every other collection routes its body rows
 * through this one helper so they all bound, scroll and virtualize identically
 * (#320).
 *
 * Three modes, chosen by whether a definite `height` / `maxHeight` (or
 * `fillParent`) is set, and by how many rows there are:
 *
 * - **Unbounded** (none set) — the historical grow-to-content behaviour:
 *   the header and every row render in normal flow, no scroll container, no
 *   virtualization, so content-sized examples and snapshots are unchanged. A
 *   collection that asks for the range (`onRangeChange` — a paged source's
 *   demand) still gets it: the frame WATCHES its nearest scrolling ancestor
 *   and reports which of its rows are on screen, while mounting every one.
 * - **Unbounded at scale** (none set, and at least `virtualizeUnboundedAt`
 *   rows — #812) — still grow-to-content with no scroll container of its own:
 *   the frame is as tall as all of its rows. But only the rows its nearest
 *   SCROLLING ANCESTOR shows are mounted — the window's, when no ancestor
 *   scrolls — so a ten-thousand-row canvas dropped into a page mounts a
 *   screenful, not ten thousand rows.
 * - **Bounded** — the frame becomes the virtualizer's scroll element at the
 *   parsed height / maxHeight (reserved-gutter scrollbar via
 *   {@link virtualScrollbarCss}); the header pins (`position: sticky`, opaque
 *   `bg.surface` so rows never paint through it) and only the visible rows
 *   (+ overscan) are mounted, positioned by `translateY`.
 *
 * The bounded virtualizer's window is measured from the scroll element's
 * origin, but the rows start BELOW the in-flow sticky header — `scrollMargin`
 * (the items container's `offsetTop`) corrects the window so the visible range
 * is not offset by the header height, and `scrollPaddingStart` (the same
 * height) says the pinned header covers the top of the viewport, so a row
 * brought into view at its start — or `auto` going up — lands under the
 * header, not behind it (#819). The header is WATCHED, not measured
 * once: a focus bar mounting, a toolbar wrapping or a web font landing moves
 * the rows, and the margin follows (#812). An unbounded frame that watches its
 * ancestor needs no margin at all: it reads the ancestor's scroll position FROM
 * ITS OWN ROWS — how far the viewport's top sits below the rows' top, sampled
 * live on every scroll — so nothing above the rows (page content, the frame's
 * own header) can skew the window.
 *
 * Rows are keyed by INDEX unless the collection passes `getItemKey`. A
 * collection whose rows move — a collapse above them, a focus, a paged window
 * landing — should pass it, so that a row keeps its component instance (its
 * memo, its local state), its DOM element and its measured height wherever it
 * moves. Measured rows carry `data-slot="virtualRow"` so a host recipe can
 * style the wrappers (a transform transition), and are sized to whole device
 * pixels ({@link devicePixels}) so every row sits on the pixel grid.
 *
 * TanStack memoizes its measurements on the row count and a few layout options
 * — never on the heights it was given (see `sizeVersion`). A fixed-height
 * collection that knows its heights passes them as `sizes`, and the frame
 * re-measures whenever one changes at a constant count; a render that changes
 * no height (a selection, a hover) re-measures nothing.
 *
 * A keyed frame whose rows are positioned — bounded, or unbounded at scale —
 * and that says which rows may anchor (`anchorable`) ANCHORS its scroll
 * (#878): the row at the top of its view stays where it is on screen when rows
 * above it change height or count (a paged window landing above them at a
 * height its estimate missed, a row above growing). After every commit the
 * frame takes its anchor — the first anchorable item that starts inside the
 * view, else one covering the view — and a render that finds the anchor
 * moved, with nothing scrolled since, moves the virtualizer's offset by the
 * same amount (the rows drawn are the ones that will show) and the scroll
 * position follows before paint. A scroll not yet reported — a programmatic
 * one — wins. Rows in flow (the unbounded frame below scale) are the
 * browser's to anchor.
 *
 * Only a bounded frame pins its header. An unbounded frame's header sits in
 * flow above its rows and scrolls with the page: a collection that scrolls
 * sideways inside its own box (`overflow-x` in `rootCss`) is a scroll
 * container, and CSS pins a sticky header against the nearest one, never
 * against the page (#856). What moves the rows in each mode — the element
 * they scroll sideways in, and what scrolls them vertically — is reported
 * through `onViewport`.
 */

import {
    Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState,
    type HTMLAttributes, type MutableRefObject, type ReactNode, type RefObject,
} from "react";
import { Box } from "@chakra-ui/react";
import { debounce, useVirtualizer, useWindowVirtualizer, type VirtualItem, type Virtualizer } from "@tanstack/react-virtual";
import { parseCssSize } from "../style/parse-size.js";
import { virtualScrollbarCss } from "../style/scrollbar.js";

/**
 * How many rows an unbounded frame holds before it virtualizes against its
 * scrolling ancestor (`virtualizeUnboundedAt` — #812, #856): one threshold for
 * every collection that asks for it. Below it every row renders, so
 * content-sized examples and captures keep their full render.
 */
export const VIRTUALIZE_UNBOUNDED_AT = 400;

/** What moves a frame's rows on screen (#856) — see `onViewport`. */
export interface RowsViewport {
    /**
     * The element the rows scroll sideways in, as wide as the view: the
     * scroll element when the frame is bounded, else the frame's root.
     */
    frame: HTMLElement;
    /**
     * What scrolls the rows vertically: the scroll element when the frame is
     * bounded (then the same element as `frame`), else the ancestor — or the
     * window — the frame watches; `null` when it watches none.
     */
    scroller: HTMLElement | Window | null;
}

interface VirtualRowsBaseProps {
    /** Raw `height` size string (parsed here; `"fill"` handled). */
    height: string | undefined;
    /** Raw `maxHeight` size string (parsed here). */
    maxHeight: string | undefined;
    /**
     * Bound the frame as a flex item (`flex: 1 1 auto; min-height: 0`) instead
     * of by its own `height` / `maxHeight`. Used when a host wraps the frame in
     * a sized flex column together with chrome that must stay outside the
     * scroll region (e.g. the review commit bar) — the WRAPPER takes the
     * component's `height` / `maxHeight` and the frame fills the remainder.
     */
    fillParent?: boolean | undefined;
    /** Sticky-top header row; spans the full (min-)width and pins on scroll. */
    header?: ReactNode | undefined;
    /** Trailing content after the rows (e.g. a legend); scrolls with the body. */
    footer?: ReactNode | undefined;
    /**
     * Content drawn OVER the rows, in their own coordinates: the frame places
     * it at the rows' top-left, in a box as wide as they are and as tall as all
     * of them (the virtual extent), after them in paint order. It scrolls with
     * the rows natively and renders in the same pass as they do, so geometry
     * computed from the rows' own heights stays registered to them (the Plan's
     * link ribbons, #818). The content positions itself (`position: absolute`)
     * within that box. Omitted, the frame's DOM is unchanged; a collection whose
     * overlay comes and goes passes `null` while it has none, so the rows' box
     * — and every row mounted in it — stays put as the overlay appears.
     */
    overlay?: ReactNode | undefined;
    /**
     * Attributes for the element that holds the rows — the ONE element that
     * contains every row in every mode (and the `overlay`), so a collection
     * can make it the rows' container for assistive tech (the Plan's
     * `role="treegrid"`, #819). Omitted, the frame's DOM is unchanged.
     */
    rowsProps?: HTMLAttributes<HTMLDivElement> | undefined;
    /** Receives the element that holds the rows (see `rowsProps`). */
    rowsRef?: MutableRefObject<HTMLElement | null> | undefined;
    /** Total number of body rows. */
    count: number;
    /**
     * A stable identity for row `index` — the row's React key, its wrapper's
     * key and the virtualizer's item key (its size cache). Omit to key rows by
     * index (the historical behaviour). Pass it when rows MOVE — inserted,
     * removed or folded above them, a focus, a window landing — so that a row
     * keeps its component instance, its memo and any local state wherever it
     * lands (#812), and its DOM element — a CSS transition can slide it to its
     * new offset — and its measured height (#843). Keyed by index, the
     * instance and the wrapper at an old index are handed whichever row now
     * sits there, with another row's height. Keys must be unique within the
     * frame.
     */
    getItemKey?: ((index: number) => string | number) | undefined;
    /**
     * Which rows may ANCHOR the scroll (#878) — omitted, the frame does not
     * anchor. In a keyed frame whose rows are positioned (bounded, or at
     * scale), the first row that may, starting inside the view, keeps its
     * place on screen when rows above it change height or count. A placeholder
     * whose edge moves as content lands beside it — a paged source's unloaded
     * band — must not anchor: rows landing below it move its top, and keeping
     * it in place would scroll them out of view.
     */
    anchorable?: ((index: number) => boolean) | undefined;
    /**
     * Whether to measure mounted rows (default true). Pass `false` when rows
     * are FIXED-HEIGHT (the given sizes are exact): rows then sit at exact
     * multiples of the fixed height. Fixed-height collections must opt out —
     * under browser zoom, measurement reports device-snapped fractional
     * heights even for a fixed-height box, and the accumulated drift between
     * measured offsets and rendered boxes paints as stray hairline rules and
     * vertically clipped row text (#533).
     */
    measureRows?: boolean | undefined;
    /** Renders body row `index` — a full-width, self-contained row element. */
    renderRow: (index: number) => ReactNode;
    /** Rows above/below the viewport to keep mounted (default 4). */
    overscan?: number | undefined;
    /**
     * Min-width for the header + row band, so a grid wider than the viewport
     * scrolls horizontally as one unit (the header scrolls with it, pinned
     * only vertically). Omit for width-flexible collections.
     */
    minWidth?: string | undefined;
    /** z-index for the pinned header (default 3 — above the translated rows). */
    headerZIndex?: number | undefined;
    /** Forwarded to a bounded frame's scroll element (e.g. scroll-position
     *  persistence). */
    onScroll?: (() => void) | undefined;
    /**
     * Controlled scroll target: the body row index to bring into view, applied
     * whenever the value CHANGES (the ValueTree's `scrollToRow` idiom). A
     * bounded frame scrolls itself; an unbounded frame that watches its
     * ancestor (at scale, or reporting its range) scrolls the ancestor; an
     * unbounded frame with nothing to watch does not scroll, and ignores it.
     */
    scrollToIndex?: number | undefined;
    /**
     * Bump to apply `scrollToIndex` AGAIN at an unchanged index — a control
     * the user can press twice ("show me the first skipped row", then scroll
     * away, then press it again) is a second request, not a no-op.
     */
    scrollNonce?: number | undefined;
    /**
     * How `scrollToIndex` brings its row into view (default `"center"` — a
     * jump to a sought row). `"auto"` scrolls the least distance that makes the
     * row visible and leaves an already-visible row where it is — what a
     * keyboard-walked selection ring wants.
     */
    scrollAlign?: "auto" | "start" | "center" | "end" | undefined;
    /**
     * Reports the mounted row range whenever it moves — the signal a paged
     * collection needs to shape its demand around the viewport (#577).
     *
     * The range INCLUDES the overscan rows, which is what a prefetching reader
     * wants: they are the rows about to be revealed. `isScrolling` is the
     * virtualizer's own flag; a reader should gate fetching and eviction on it
     * being false, so neither happens mid-gesture.
     *
     * `center` names the item under the viewport's vertical CENTER and how
     * many pixels into it that center sits — resolved from the LIVE scroll
     * offset at report time, never from render-captured geometry. The range
     * alone cannot say where the scrollbar is inside one huge item (a paged
     * collection's unloaded band): the mounted range does not move while the
     * thumb drags within it, so the scroll-end report — the one an idle-gated
     * reader acts on — must read the offset fresh (#612). `undefined` when no
     * mounted item contains the center (an empty body, or a viewport whose
     * center is above the rows).
     *
     * Fires in every mode. Bounded, the range is the frame's own; unbounded,
     * the frame watches its nearest scrolling ancestor for it — at scale
     * mounting only that range, below scale mounting every row and reporting
     * which of them are on screen (#812).
     */
    onRangeChange?: ((
        range: { startIndex: number; endIndex: number },
        isScrolling: boolean,
        center?: { index: number; withinPx: number },
    ) => void) | undefined;
    /**
     * Bump to force a re-measure. TanStack memoizes its measurements on
     * `[count, paddingStart, scrollMargin, getItemKey, enabled, lanes]` plus the
     * item-size cache — **`estimateSize` is not among them** (verified against
     * `virtual-core@3.13.23`, `dist/esm/index.js:408-440`). So a collection whose
     * row HEIGHTS change while the row COUNT does not — a skeleton band becoming
     * rows, a chart row expanding — leaves stale offsets behind. Changing this
     * value calls `virtualizer.measure()`, which assigns a fresh cache and busts
     * the memo. A collection that passes exact `sizes` needs none of this: the
     * frame compares them itself.
     */
    sizeVersion?: number | undefined;
    /**
     * Receives the bounded-mode scroll element (null when unmounted or
     * unbounded) — for scroll-position restore, which `onScroll` alone
     * cannot do.
     */
    scrollElRef?: React.MutableRefObject<HTMLDivElement | null> | undefined;
    /**
     * Receives the frame's {@link RowsViewport} whenever it changes, and
     * `null` once the frame unmounts (#856) — what a collection's width- and
     * scroll-driven chrome follows, live, in every mode. A frame that
     * switches modes (a bound set or cleared, a count crossing
     * `virtualizeUnboundedAt`) changes one or both, and reports the change.
     */
    onViewport?: ((viewport: RowsViewport | null) => void) | undefined;
    /**
     * Where a bounded frame's scroll comes to rest (#813): the first row
     * showing under the header, and how many px of it are scrolled past —
     * reported once a scroll settles, so a collection can persist its place
     * as a ROW (a pixel offset does not survive the rows above it changing —
     * the Table's #143 rule). The frame's first rest, which no scroll chose,
     * is not reported.
     */
    onAnchorChange?: ((anchor: { index: number; offset: number }) => void) | undefined;
    /**
     * Bring an anchor back: row `index` at the top of a bounded frame (just
     * under its header), `offset` px into it. Applied whenever the value
     * changes — a collection sets it once, when it has found the anchor's row.
     */
    restoreAnchor?: { index: number; offset: number } | undefined;
    /** Extra props / styles for the outer element (root recipe styles, width). */
    rootCss?: Record<string, unknown> | undefined;
    /**
     * Virtualize an UNBOUNDED frame once it holds at least this many rows
     * (#812): the frame still grows to its content, but only the rows its
     * nearest scrolling ancestor — the window, when none scrolls — shows are
     * mounted. Omit to mount every row of an unbounded frame, however many.
     * A collection passes {@link VIRTUALIZE_UNBOUNDED_AT}.
     */
    virtualizeUnboundedAt?: number | undefined;
}

/** The frame's props: the rows' heights come EITHER as an estimate per row OR
 *  as the exact list. */
export type VirtualRowsProps = VirtualRowsBaseProps & (
    | {
        /** Estimated pixel height of row `index` (measured precisely once
         *  mounted, unless `measureRows` is false). */
        estimateSize: (index: number) => number;
        sizes?: undefined;
    }
    | {
        estimateSize?: undefined;
        /**
         * The EXACT pixel height of every row, for a fixed-height collection
         * that knows them (`measureRows: false`). The frame re-measures
         * whenever an entry changes at a constant count — a chart expanding,
         * a focus compressing its neighbours, a band becoming rows — so no
         * height change can leave stale offsets, and a render that changes no
         * height (a selection) re-measures nothing. The list is the height
         * SIGNATURE: every fact a height depends on reaches it (#812).
         */
        sizes: readonly number[];
    }
);

/** A frame's virtualizer — over its own scroll element or an ancestor, or
 *  over the window. */
type Rows = Virtualizer<HTMLElement, Element> | Virtualizer<Window, Element>;

/** The scroll behaviour TanStack hands a `scrollToFn`. */
type ScrollBehaviorOption = "auto" | "smooth" | "instant";

function isWindow(target: HTMLElement | Window): target is Window {
    return (target as Window).window === target;
}

/**
 * The element whose scrolling moves `el`: the nearest ancestor that scrolls
 * vertically, or the window when none does (the document's own scrollers —
 * `<body>`, `<html>` — ARE the window).
 */
function scrollingAncestor(el: HTMLElement): HTMLElement | Window {
    const doc = el.ownerDocument;
    const view = doc.defaultView ?? window;
    for (let p = el.parentElement; p !== null && p !== doc.body && p !== doc.documentElement; p = p.parentElement) {
        const overflowY = view.getComputedStyle(p).overflowY;
        if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return p;
    }
    return view;
}

/** The viewport's top edge in client coordinates — the window's is 0, an
 *  element's is its padding box's top. */
function viewportTop(target: HTMLElement | Window): number {
    return isWindow(target) ? 0 : target.getBoundingClientRect().top + target.clientTop;
}

/**
 * How far the viewport's top sits below the rows' top: the virtualizer's scroll
 * offset, in the rows' own coordinates. Negative while the rows are still
 * below the fold (a header, or page content, above them on screen).
 */
function offsetWithin(target: HTMLElement | Window, items: HTMLElement): number {
    return viewportTop(target) - items.getBoundingClientRect().top;
}

/** The watched offset right now, or 0 before there is anything to read. */
function offsetNow(target: HTMLElement | Window | undefined, items: RefObject<HTMLElement | null>): number {
    const el = items.current;
    return target !== undefined && el !== null ? offsetWithin(target, el) : 0;
}

/**
 * The unbounded frame's offset observer: the ancestor's scroll events, read as
 * the viewport's position INSIDE the rows (see {@link offsetWithin}). Settles to
 * `isScrolling: false` after the virtualizer's reset delay, as TanStack's own
 * observers do. While subscribed it also publishes a re-sample — for the
 * rows moving with nothing scrolling (the frame's header growing).
 */
function observeOffsetWithin<T extends HTMLElement | Window>(
    items: RefObject<HTMLElement | null>,
    resample: React.MutableRefObject<(() => void) | null>,
) {
    return (instance: Virtualizer<T, Element>, cb: (offset: number, isScrolling: boolean) => void): (() => void) | undefined => {
        const target: HTMLElement | Window | null = instance.scrollElement;
        const win = instance.targetWindow;
        if (target === null || win === null) return undefined;
        let offset = 0;
        const settle = debounce(win, () => cb(offset, false), instance.options.isScrollingResetDelay);
        const read = (): boolean => {
            const el = items.current;
            if (el === null) return false;
            offset = offsetWithin(target, el);
            return true;
        };
        const onScroll = () => {
            if (!read()) return;
            settle();
            cb(offset, true);
        };
        const again = () => { if (read()) cb(offset, false); };
        resample.current = again;
        target.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            target.removeEventListener("scroll", onScroll);
            if (resample.current === again) resample.current = null;
        };
    };
}

/**
 * The unbounded frame's `scrollToFn`: an offset into the ROWS becomes the
 * ancestor's own scroll position. Asking for where it already is — the virtualizer
 * re-syncing as it subscribes — scrolls nothing, so mounting a canvas never
 * moves the page it sits in.
 */
function scrollWithin<T extends HTMLElement | Window>(items: RefObject<HTMLElement | null>) {
    return (
        offset: number,
        options: { adjustments?: number; behavior?: ScrollBehaviorOption },
        instance: Virtualizer<T, Element>,
    ): void => {
        const target: HTMLElement | Window | null = instance.scrollElement;
        const el = items.current;
        if (target === null || el === null) return;
        const now = isWindow(target) ? target.scrollY : target.scrollTop;
        const top = now - offsetWithin(target, el) + offset + (options.adjustments ?? 0);
        if (Math.abs(top - now) < 1) return;
        target.scrollTo({ top, ...(options.behavior !== undefined ? { behavior: options.behavior } : {}) });
    };
}

/**
 * Rounds a measured CSS-pixel height to whole DEVICE pixels.
 *
 * Measured rows sit at the sum of the heights above them, so one row a
 * fraction of a device pixel tall — fractional line boxes, or a 1.25× / 1.5×
 * screen scale that makes a whole CSS pixel a fraction of a device one —
 * leaves every row below it between device pixels, where a 1px rule smears
 * across two pixel rows or drops out (the #533 family). The browser paints
 * a box to whole device pixels anyway, so the rounded slot is the height the
 * row is drawn at.
 *
 * @param px - A measured height in CSS pixels
 * @returns The height rounded to whole device pixels, in CSS pixels
 */
export function devicePixels(px: number): number {
    const dpr = typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    return Math.round(px * dpr) / dpr;
}

/** A mounted row's height, on the device-pixel grid ({@link devicePixels}). */
const measureRect = (el: Element): number => devicePixels(el.getBoundingClientRect().height);

/** An item's identity to the virtualizer — its key. */
type ItemKey = VirtualItem["key"];

/** A frame's scroll anchor (#878): the item it keeps in place, where the item
 *  started, the scroll offset then, and the item's index — where to look for
 *  it first. */
interface ScrollAnchor {
    key: ItemKey;
    start: number;
    offset: number;
    index: number;
}

/**
 * The item a frame keeps in place (#878): the first anchorable item that starts
 * inside the view, else an anchorable one covering the view's top.
 *
 * @param virtualizer - The frame's virtualizer
 * @param offset - Its scroll offset
 * @param top - The view's top, in the items' coordinates
 * @param height - The view's height
 * @param anchorable - Which items may anchor
 * @returns The anchor, or null when no item in view may anchor
 */
function anchorOf(virtualizer: Rows, offset: number, top: number, height: number, anchorable: (index: number) => boolean): ScrollAnchor | null {
    const at = virtualizer.getVirtualItemForOffset(top);
    if (at === undefined) return null;
    const count = virtualizer.options.count;
    for (let i = at.start < top ? at.index + 1 : at.index; i < count; i++) {
        const item = virtualizer.measurementsCache[i];
        if (item === undefined || item.start >= top + height) break;
        if (anchorable(i)) return { key: item.key, start: item.start, offset, index: i };
    }
    return at.start < top && anchorable(at.index) ? { key: at.key, start: at.start, offset, index: at.index } : null;
}

/**
 * Where the item with `key` starts now, looking out from `hint` — rows
 * inserted or removed above an anchor shift its index by as many.
 *
 * @param virtualizer - The frame's virtualizer, its measurements current
 * @param count - The rows
 * @param keyOf - A row's key
 * @param key - The anchor's key
 * @param hint - The anchor's index when it was taken
 * @returns Its start, or undefined when it has left the frame
 */
function startOfKey(virtualizer: Rows, count: number, keyOf: (index: number) => ItemKey, key: ItemKey, hint: number): number | undefined {
    for (let d = 0; hint + d < count || hint - d >= 0; d++) {
        const below = hint + d;
        if (below < count && keyOf(below) === key) return virtualizer.measurementsCache[below]?.start;
        const above = hint - d;
        if (d > 0 && above >= 0 && above < count && keyOf(above) === key) return virtualizer.measurementsCache[above]?.start;
    }
    return undefined;
}

/**
 * @param props - see {@link VirtualRowsProps}
 * @returns the bounded virtual-scroll frame, the unbounded frame at scale
 *   (virtualized against its scrolling ancestor), or the unbounded
 *   grow-to-content flow that mounts every row (watching the ancestor when
 *   the range is asked for)
 */
export function VirtualRows(props: VirtualRowsProps): ReactNode {
    const {
        header, footer, overlay, count, estimateSize, sizes, getItemKey, anchorable, renderRow, measureRows = true,
        overscan = 4, minWidth, headerZIndex = 3, onScroll, rootCss, fillParent, scrollElRef,
        scrollToIndex, scrollNonce, scrollAlign = "center", onRangeChange, sizeVersion,
        virtualizeUnboundedAt, onAnchorChange, restoreAnchor, rowsProps, rowsRef, onViewport,
    } = props;
    const h = parseCssSize(props.height);
    const mh = parseCssSize(props.maxHeight);
    const bounded = h !== undefined || mh !== undefined || fillParent === true;
    const atScale = !bounded && virtualizeUnboundedAt !== undefined && count >= virtualizeUnboundedAt;
    // An unbounded frame watches its scrolling ancestor when it virtualizes
    // against it — and, below scale, when it mounts every row but the
    // collection still needs to know which of them are on screen (a paged
    // source's demand follows them). The same rows either way; only what is
    // mounted differs.
    const watching = !bounded && (atScale || onRangeChange !== undefined);

    const scrollRef = useRef<HTMLDivElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    // The items container. Bounded, it sits BELOW the in-flow sticky header
    // and its offsetTop is the virtualizer's scrollMargin, so the visible-range
    // window is not shifted by the header height (0 on the first pass — the
    // virtualizer re-renders once the state settles). Unbounded, it is what
    // the watched ancestor's scroll position is read against.
    const itemsRef = useRef<HTMLDivElement | null>(null);
    // The element that holds the rows, handed to the collection too.
    const setRows = useCallback((el: HTMLDivElement | null) => {
        itemsRef.current = el;
        if (rowsRef !== undefined) rowsRef.current = el;
    }, [rowsRef]);
    const [itemsOffset, setItemsOffset] = useState(0);
    // Re-measure when the row set changes (the header may rewrap); the header
    // observer below catches every other move. Only a MOVED offset is set: a
    // layout-effect setState schedules a second, nested commit even when the
    // value is unchanged, and a row set changing under an unmoved header is
    // the common case (#815).
    useLayoutEffect(() => {
        const next = bounded ? itemsRef.current?.offsetTop ?? 0 : 0;
        if (next !== itemsOffset) setItemsOffset(next);
    }, [count, bounded, itemsOffset]);

    // Unbounded and watching: the element (or window) whose scrolling moves
    // the rows — resolved after the frame mounts, since only then does it have
    // ancestors. Until it is known the virtualizer is disabled, so its first
    // reading of the scroll position is taken where the ancestor actually IS.
    const [ancestor, setAncestor] = useState<HTMLElement | Window | undefined>(undefined);
    useLayoutEffect(() => {
        const root = rootRef.current;
        const next = watching && root !== null ? scrollingAncestor(root) : undefined;
        // Only a CHANGED ancestor is set — the offset rule above.
        if (next !== ancestor) setAncestor(next);
    }, [watching, ancestor]);
    const onWindow = ancestor !== undefined && isWindow(ancestor);
    const ancestorEl = ancestor !== undefined && !isWindow(ancestor) ? ancestor : undefined;

    // What moves the rows (#856), reported when it changes: bounded, the
    // scroll element both ways; unbounded, the root sideways and the watched
    // ancestor (if any) vertically. The refs are set by the time layout
    // effects run, and a newly resolved ancestor re-renders the frame, so a
    // mode switch reaches this effect whichever of the two it changes. A frame
    // that is about to watch reports once its ancestor is known.
    const viewportSeen = useRef<RowsViewport | null>(null);
    const onViewportRef = useRef(onViewport);
    useLayoutEffect(() => { onViewportRef.current = onViewport; });
    useLayoutEffect(() => {
        const report = onViewportRef.current;
        if (report === undefined || (watching && ancestor === undefined)) return;
        const frame = bounded ? scrollRef.current : rootRef.current;
        const scroller = bounded ? frame : watching ? ancestor ?? null : null;
        const seen = viewportSeen.current;
        if (frame === null) {
            if (seen === null) return;
            viewportSeen.current = null;
            report(null);
            return;
        }
        if (seen !== null && seen.frame === frame && seen.scroller === scroller) return;
        const next = { frame, scroller };
        viewportSeen.current = next;
        report(next);
    });
    useLayoutEffect(() => () => {
        if (viewportSeen.current === null) return;
        viewportSeen.current = null;
        onViewportRef.current?.(null);
    }, []);
    // Set by the unbounded offset observer while it is subscribed.
    const resample = useRef<(() => void) | null>(null);
    // The scroll anchor taken at the last commit, and an anchored offset this
    // render moved to that the commit has yet to write (#878).
    const anchorRef = useRef<ScrollAnchor | null>(null);
    const anchorTarget = useRef<number | null>(null);

    const estimate = sizes !== undefined
        ? (i: number) => sizes[i] ?? 0
        : estimateSize ?? (() => 0);
    const keyed = getItemKey !== undefined ? { getItemKey } : {};
    const elementRows = useVirtualizer<HTMLElement, Element>({
        count,
        getScrollElement: () => (bounded ? scrollRef.current : ancestorEl ?? null),
        estimateSize: estimate,
        ...keyed,
        overscan,
        scrollMargin: bounded ? itemsOffset : 0,
        // The pinned header covers this much of a bounded viewport's top.
        scrollPaddingStart: bounded ? itemsOffset : 0,
        enabled: bounded || ancestorEl !== undefined,
        measureElement: measureRect,
        ...(bounded ? {} : {
            observeElementOffset: observeOffsetWithin<HTMLElement>(itemsRef, resample),
            scrollToFn: scrollWithin<HTMLElement>(itemsRef),
            initialOffset: () => offsetNow(ancestor, itemsRef),
        }),
    });
    const windowRows = useWindowVirtualizer<Element>({
        count,
        estimateSize: estimate,
        ...keyed,
        overscan,
        enabled: onWindow,
        measureElement: measureRect,
        observeElementOffset: observeOffsetWithin<Window>(itemsRef, resample),
        scrollToFn: scrollWithin<Window>(itemsRef),
        initialOffset: () => offsetNow(ancestor, itemsRef),
    });
    const virtualizer: Rows = onWindow ? windowRows : elementRows;
    const virtualized = bounded || ancestor !== undefined;

    // Scroll anchoring (#878): when the anchor taken at the last commit has
    // moved — rows above it changed height or count — and the frame has not
    // scrolled since, move the virtualizer's offset by as much, here, so the
    // rows this render draws are the ones that will show; the commit writes the
    // scroll position before paint. A scroll the virtualizer has not seen yet (a
    // programmatic one, its event still to come) wins: the live offset must
    // still be the virtualizer's.
    const anchoring = virtualized && getItemKey !== undefined && anchorable !== undefined && (bounded || atScale);
    if (anchoring && anchorTarget.current === null) {
        const anchor = anchorRef.current;
        const offset = virtualizer.scrollOffset;
        if (anchor !== null && offset !== null && offset === anchor.offset) {
            virtualizer.getTotalSize();  // this render's measurements
            const start = startOfKey(virtualizer, count, getItemKey, anchor.key, anchor.index);
            if (start !== undefined && start !== anchor.start) {
                const live = bounded ? scrollRef.current?.scrollTop : offsetNow(ancestor, itemsRef);
                if (live !== undefined && Math.abs(live - offset) < 1) {
                    const target = Math.max(0, offset + start - anchor.start);
                    virtualizer.scrollOffset = target;
                    anchorTarget.current = target;
                }
            }
        }
    }
    // Write the offset the render anchored to, before paint — through the
    // frame's own scroll function, so a frame at scale moves its ancestor —
    // then take the anchor for the next render. Declared before the effects
    // that re-measure (`sizes`, `sizeVersion`): the anchor is taken where this
    // render drew the rows, so the re-measured render that follows finds it
    // moved.
    useLayoutEffect(() => {
        if (!anchoring) {
            anchorRef.current = null;
            anchorTarget.current = null;
            return;
        }
        const target = anchorTarget.current;
        if (target !== null) {
            anchorTarget.current = null;
            if (onWindow) windowRows.options.scrollToFn(target, {}, windowRows);
            else elementRows.options.scrollToFn(target, {}, elementRows);
        }
        const offset = virtualizer.scrollOffset ?? 0;
        anchorRef.current = anchorable === undefined ? null
            : anchorOf(virtualizer, offset, offset + (bounded ? itemsOffset : 0), virtualizer.scrollRect?.height ?? 0, anchorable);
    });

    // Bring a requested row into view. Keyed on the index (and the explicit
    // re-request nonce) alone, so a row set that grows underneath a standing
    // target (paged windows landing) does not re-scroll on every frame — and
    // on the virtualizer going live, so a target that arrived before an
    // unbounded frame found its ancestor is still honoured.
    useEffect(() => {
        if (scrollToIndex === undefined || !virtualized) return;
        virtualizer.scrollToIndex(scrollToIndex, { align: scrollAlign });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the target index, the nonce and going live are the trigger
    }, [scrollToIndex, scrollNonce, virtualized]);

    // Where a bounded frame's scroll rests, reported when a scroll SETTLES
    // (#813) — the row showing just under the header (the item starts carry
    // the header's height as the scroll margin) and the px scrolled past it.
    // `settling` tells a settle from the frame's first rest.
    const settling = useRef(false);
    useEffect(() => {
        if (!bounded || onAnchorChange === undefined) return;
        if (virtualizer.isScrolling) {
            settling.current = true;
            return;
        }
        if (!settling.current) return;
        settling.current = false;
        const top = (virtualizer.scrollOffset ?? 0) + itemsOffset;
        const item = virtualizer.getVirtualItemForOffset(top);
        if (item !== undefined) onAnchorChange({ index: item.index, offset: Math.max(0, top - item.start) });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- a scroll settling is the trigger
    }, [virtualizer.isScrolling]);

    // Bring an anchor back: its row's start, less the header the rows sit
    // under, plus how far into the row the scroll had rested.
    useEffect(() => {
        if (restoreAnchor === undefined || !bounded) return;
        const item = virtualizer.measurementsCache[restoreAnchor.index];
        if (item === undefined) return;
        virtualizer.scrollToOffset(item.start - itemsOffset + restoreAnchor.offset, { align: "start" });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the anchor is the trigger
    }, [restoreAnchor]);

    // Heights changed without the count changing — bust TanStack's measurement
    // memo, which does not watch `estimateSize` (see `sizeVersion`).
    useEffect(() => {
        if (sizeVersion === undefined || !virtualized) return;
        virtualizer.measure();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the version is the trigger
    }, [sizeVersion]);

    // The same, driven by the exact sizes themselves: any entry that moved at
    // a constant count re-measures — before paint, so no frame shows stale
    // offsets — and a new list with the same entries re-measures nothing. (A
    // count change re-derives every offset by itself.)
    const seenSizes = useRef(sizes);
    useLayoutEffect(() => {
        const before = seenSizes.current;
        seenSizes.current = sizes;
        if (!virtualized || sizes === undefined || before === undefined || before === sizes) return;
        if (before.length !== sizes.length) return;
        for (let i = 0; i < sizes.length; i++) {
            if (before[i] !== sizes[i]) {
                virtualizer.measure();
                return;
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the sizes are the trigger
    }, [sizes]);

    // The header is watched: whatever changes its height moves the rows below
    // it — bounded, the scroll margin follows; unbounded, the offset re-samples.
    const [headerEl, setHeaderEl] = useState<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        if (headerEl === null || typeof ResizeObserver === "undefined") return undefined;
        const ro = new ResizeObserver(() => {
            if (bounded) setItemsOffset(itemsRef.current?.offsetTop ?? 0);
            else resample.current?.();
        });
        ro.observe(headerEl);
        return () => ro.disconnect();
    }, [headerEl, bounded]);

    // Every row, in flow — an unbounded frame below scale mounts them all.
    const everyRow = () => Array.from({ length: count }, (_unused, i) => (
        <Fragment key={getItemKey !== undefined ? getItemKey(i) : i}>{renderRow(i)}</Fragment>
    ));

    // Unbounded below scale with nothing to watch: preserve the exact
    // grow-to-content flow (no scroll, no virtualization) so content-sized
    // output is unchanged.
    if (!bounded && !watching) {
        return (
            <Box ref={rootRef} css={rootCss}>
                {header}
                {overlay === undefined && rowsProps === undefined && rowsRef === undefined ? everyRow() : (
                    // The overlay's box: the rows, and nothing else.
                    <Box ref={setRows} position={overlay !== undefined ? "relative" : undefined} {...rowsProps}>
                        {everyRow()}{overlay}
                    </Box>
                )}
                {footer}
            </Box>
        );
    }

    const items = virtualized ? virtualizer.getVirtualItems() : [];
    // Rows are translated inside the items container: bounded, item starts
    // include the scroll margin; at scale they are measured from the rows' top.
    const margin = bounded ? itemsOffset : 0;
    const total = virtualized ? virtualizer.getTotalSize() : 0;
    const virtualWindow = () => (
        <Box ref={setRows} position="relative" height={`${total}px`} minWidth={minWidth}
            // The extent, as data: the height compiles to a class, which jsdom
            // does not resolve — this is what a DOM test holds geometry to.
            data-virtual-extent={total} {...rowsProps}>
            {measureRows ? (
                items.map((item) => (
                    <Box
                        key={item.key}
                        data-index={item.index}
                        data-slot="virtualRow"
                        ref={virtualizer.measureElement}
                        position="absolute"
                        top="0"
                        left="0"
                        width="100%"
                        style={{ transform: `translateY(${item.start - margin}px)` }}
                    >
                        {renderRow(item.index)}
                    </Box>
                ))
            ) : items.length > 0 && (
                // Fixed-row window: ONE translated normal-flow column.
                // Adjacent rows share edges inside a single layer, so row
                // backgrounds (hover, match highlight) cannot rasterize
                // hairline seams between rows — per-row transformed
                // layers can, whenever fractional zoom / devicePixelRatio
                // puts some rows' offsets on fractional device pixels
                // (#533).
                <Box
                    position="absolute"
                    top="0"
                    left="0"
                    width="100%"
                    style={{ transform: `translateY(${items[0]!.start - margin}px)` }}
                >
                    {items.map((item) => (
                        <Box key={item.key} data-index={item.index}>
                            {renderRow(item.index)}
                        </Box>
                    ))}
                </Box>
            )}
            {overlay}
        </Box>
    );
    const reporter = onRangeChange !== undefined && virtualized && (
        <RangeReporter
            virtualizer={virtualizer}
            startIndex={items[0]?.index ?? 0}
            endIndex={items[items.length - 1]?.index ?? 0}
            isScrolling={virtualizer.isScrolling}
            onRangeChange={onRangeChange}
        />
    );

    // Unbounded and watching — still the grow-to-content flow, header in flow.
    // At scale the rows are the ancestor's virtual window; below it every row
    // renders and the virtualizer only watches which of them are on screen.
    if (!bounded) {
        return (
            <Box ref={rootRef} css={rootCss} data-virtual-rows={atScale ? "ancestor" : "watched"}>
                {header !== undefined && <Box ref={setHeaderEl}>{header}</Box>}
                {atScale ? virtualWindow() : (
                    <Box ref={setRows} position={overlay !== undefined ? "relative" : undefined}
                        data-virtual-extent={total} {...rowsProps}>
                        {everyRow()}
                        {overlay}
                    </Box>
                )}
                {footer}
                {reporter}
            </Box>
        );
    }

    return (
        <Box
            ref={(el: HTMLDivElement | null) => {
                scrollRef.current = el;
                if (scrollElRef !== undefined) scrollElRef.current = el;
            }}
            // `display:block` overrides any flex-column root recipe — a flex
            // item's default shrink would collapse the total-size spacer and
            // break the scroll. `overflowY:auto` (after rootCss) becomes the
            // virtualizer's scroll axis; horizontal overflow is inherited from
            // rootCss when the collection sets it.
            css={{
                ...rootCss,
                display: "block",
                overflowY: "auto",
                minHeight: "0",
                ...(fillParent === true ? { flex: "1 1 auto" } : {}),
                ...virtualScrollbarCss,
            }}
            height={fillParent === true ? undefined : h}
            maxHeight={fillParent === true ? undefined : mh}
            onScroll={onScroll}
            data-virtual-rows="bounded"
        >
            {header !== undefined && (
                // Opaque wash: scrolled rows must never paint through the
                // pinned header (not every collection's header cells carry
                // their own background — Calendar's don't).
                <Box ref={setHeaderEl} position="sticky" top="0" zIndex={headerZIndex} minWidth={minWidth} background="bg.surface">
                    {header}
                </Box>
            )}
            {virtualWindow()}
            {footer}
            {reporter}
        </Box>
    );
}

/** Reports the mounted range in an effect, so the callback fires AFTER commit
 *  and a reader that responds by setting state cannot re-enter the render. */
function RangeReporter({ virtualizer, startIndex, endIndex, isScrolling, onRangeChange }: {
    virtualizer: Rows;
    startIndex: number;
    endIndex: number;
    isScrolling: boolean;
    onRangeChange: (
        range: { startIndex: number; endIndex: number },
        isScrolling: boolean,
        center?: { index: number; withinPx: number },
    ) => void;
}): null {
    useEffect(() => {
        // The center is resolved AT REPORT TIME from the live scroll offset,
        // never from render-captured values: a scrollbar drag deep inside one
        // huge item (a paged collection's unloaded band) never changes the
        // mounted range, so the values captured when the range last moved are
        // stale by the scroll-end report — the one an idle-gated reader acts
        // on (#612). The center is on screen by definition, so its item is
        // always among the mounted ones.
        const centerPx = (virtualizer.scrollOffset ?? 0) + (virtualizer.scrollRect?.height ?? 0) / 2;
        const item = virtualizer.getVirtualItems().find((it: VirtualItem) => centerPx >= it.start && centerPx < it.end);
        onRangeChange(
            { startIndex, endIndex },
            isScrolling,
            item !== undefined ? { index: item.index, withinPx: centerPx - item.start } : undefined,
        );
    }, [startIndex, endIndex, isScrolling, onRangeChange, virtualizer]);
    return null;
}
