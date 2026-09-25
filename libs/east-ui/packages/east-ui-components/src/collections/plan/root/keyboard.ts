/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The canvas's keyboard map (#819), as a model: the grid's items in order
 * (pinned rows, then the body — rows, gap bands, the bands standing for a
 * paged source's unloaded runs, failed windows), and what a key does from one
 * of them. Pure, so the whole map is testable without a DOM; the canvas root
 * runs the moves it returns (`index.tsx`).
 *
 * # Rows
 *
 * ↑ / ↓ step between items, Home / End go to the first / last, PgUp / PgDn
 * move a viewport's worth. → opens a closed section (or chart) and, on an open
 * section, steps to its first child; ← closes an open one, or steps to its
 * parent. Enter does what a click on the row does — select it, or return from
 * a row focus on a rail or strip — and Space toggles its section or chart.
 *
 * # Bands
 *
 * An unloaded run is ONE grid item (its row count is unknowable — see
 * `window-ledger.ts`), so stepping onto it cannot land on a row that is not
 * there yet. The move asks the source for the window next to the run, lands
 * on the band (or, when the demand already took the band away — its windows
 * now in flight — stays where it was), and leaves an INTENT: once the rows
 * land, focus moves on to the row the key was headed for. Home and End onto a
 * band do the same for the source's first and last rows.
 *
 * # Widgets
 *
 * Tab from a row walks its widgets in reading order — its controls, its
 * elements in time order, the author's render, its review buttons — and past
 * the last, out of the canvas. ← / → step between the elements in time order
 * (Home / End to the first / last), and Esc returns to the row.
 *
 * @packageDocumentation
 */

import type { PlanEvent, RowKey } from "../plan-state.js";
import type { PlanViewport } from "../use-plan-paging.js";
import type { PlanNavAlign } from "../controller/index.js";
import { bodyItemKey, rowItemKey, type PlanBodyItem, type PlanFocusCtx, type PlanRowIndex, type VisibleRow } from "../model.js";
import { appendAll } from "../reductions.js";
import { planRowRole, rowToggle } from "../rows/row-facts.js";
import { PLAN_ELEMENT_SELECTOR } from "./overlays.js";

/** One item of the grid, as the keyboard sees it. */
export interface PlanNavItem {
    /** Its `bodyItemKey`. */
    key: string;
    /** What it is. */
    kind: "row" | "group" | "gap" | "band" | "failed";
    /** A band's block and side, and its pixel height (End reaches its far
     *  edge) — a move onto it asks that block for the window beside its run
     *  (#823). */
    band?: { block: number; at: "head" | "tail"; px: number } | undefined;
    /** The parent row's item key, when the row nests — ← steps there. */
    parent?: string | undefined;
    /** Its section / chart toggle — what Space and ← / → dispatch — and
     *  whether it is open now. */
    toggle?: { event: PlanEvent; open: boolean } | undefined;
    /** Whether it nests rows — → steps into an open one. */
    nests: boolean;
    /** What Enter does — the row's click. */
    activate?: PlanEvent | undefined;
    /** Where focus goes once Enter has done it, when not here — a gap band
     *  goes away as its rows come back, and focus lands on the first. */
    activateLands?: string | undefined;
    /** Its height (px) — how far PgUp / PgDn travel. */
    h: number;
}

/** What the grid's items are built from. */
export interface PlanNavSource {
    /** The pinned rows (the grid's first rows) and their heights. */
    pinned: readonly VisibleRow[];
    pinnedHeights: readonly number[];
    /** The body items and their heights. */
    items: readonly PlanBodyItem[];
    heights: readonly number[];
    /** The row index — who nests. */
    index: PlanRowIndex;
    /** The chart rows the user expanded. */
    chartsExpanded: ReadonlySet<RowKey>;
    /** The row focus, if any — its rails and strips return on Enter. */
    focusCtx: PlanFocusCtx | undefined;
}

/**
 * The grid's items as the keyboard sees them — pinned rows first, then the
 * body in order.
 *
 * @param src - The rows, bands and state they are built from
 * @returns The items
 */
export function planNavItems(src: PlanNavSource): PlanNavItem[] {
    const row = (v: VisibleRow, h: number): PlanNavItem => {
        const parent = v.row.parent.type === "some" ? rowItemKey(v.row.parent.value) : undefined;
        const nests = (src.index.children.get(v.row.key)?.length ?? 0) > 0;
        const role = planRowRole(v, src.focusCtx, false);
        // A rail or a strip is the way back from a row focus — its click
        // returns, and it has no caret.
        if (role === "rail" || role === "ctx") {
            return { key: rowItemKey(v.row.key), kind: "row", parent, nests, activate: { t: "focus.clear" }, h };
        }
        const toggle = rowToggle(v, nests, src.chartsExpanded.has(v.row.key));
        const isGroup = v.row.kind.type === "group";
        return {
            key: rowItemKey(v.row.key), kind: isGroup ? "group" : "row", parent, toggle, nests,
            // A group band's click is its toggle; a row's, its selection.
            activate: isGroup ? toggle?.event : { t: "row.select", key: v.row.key },
            h,
        };
    };
    const out: PlanNavItem[] = src.pinned.map((v, i) => row(v, src.pinnedHeights[i] ?? 0));
    src.items.forEach((item, i) => {
        const h = src.heights[i] ?? 0;
        switch (item.kind) {
            case "row": out.push(row(item.row, h)); break;
            case "gap": out.push({
                key: bodyItemKey(item), kind: "gap", nests: false,
                activate: { t: "focus.clear" }, activateLands: rowItemKey(item.gap.first), h,
            }); break;
            case "band": out.push({
                key: bodyItemKey(item), kind: "band",
                band: { block: item.band.block, at: item.band.at, px: item.band.px }, nests: false, h,
            }); break;
            case "failed": out.push({ key: bodyItemKey(item), kind: "failed", nests: false, h }); break;
        }
    });
    return out;
}

/** A pending move across a band — resolved once the band's rows land. */
export type PlanNavIntent =
    /** Headed one step `dir` from the item `from`. */
    | { t: "step"; from: string; dir: 1 | -1 }
    /** Headed for the source's first / last row. */
    | { t: "first" }
    | { t: "last" };

/** What a key does. */
export type PlanNavMove =
    /** Move focus onto an item — scrolled into view as `align` says, or not at all. */
    | { t: "focus"; key: string; align: PlanNavAlign | undefined }
    /** Move focus onto a band, ask the source for its window, and leave an intent. */
    | { t: "band"; key: string; align: PlanNavAlign | undefined; demand: PlanViewport; intent: PlanNavIntent }
    /** An interaction on the item — focus stays on (or lands on) `focus`,
     *  since the interaction may re-render the item as another element (a
     *  rail becoming a row) or take it away (a gap band). */
    | { t: "event"; event: PlanEvent; focus: string }
    /** A key the map owns that does nothing here (the edge of the grid). */
    | { t: "none" };

/** Rows a page moves when the viewport cannot be measured. */
const FALLBACK_PAGE_ITEMS = 10;

/**
 * What a key does from an item.
 *
 * @param items - The grid's items, in order
 * @param from - The focused item's key
 * @param key - The `KeyboardEvent.key`
 * @param pageHeight - The viewport's height (px) — how far a page moves; 0 when unknown
 * @returns The move, or `undefined` for a key the row map does not own
 */
export function planNavKey(items: readonly PlanNavItem[], from: string, key: string, pageHeight: number): PlanNavMove | undefined {
    const i = items.findIndex((it) => it.key === from);
    if (i < 0) return undefined;
    const cur = items[i]!;
    const focus = (it: PlanNavItem): PlanNavMove => ({ t: "focus", key: it.key, align: "auto" });
    const step = (dir: 1 | -1): PlanNavMove => {
        const next = items[i + dir];
        if (next === undefined) return { t: "none" };
        if (next.band === undefined) return focus(next);
        // The band's edge beside this item is already in view: no scroll —
        // the source is asked for the adjacent window directly.
        return { t: "band", key: next.key, align: undefined, demand: { kind: "band", block: next.band.block, at: next.band.at },
            intent: { t: "step", from: cur.key, dir } };
    };
    const edge = (first: boolean): PlanNavMove => {
        const target = first ? items[0] : items[items.length - 1];
        if (target === undefined || target === cur) return { t: "none" };
        if (target.band === undefined) return focus(target);
        // The far end of the source: scroll to the band's far edge, and ask for
        // the window there.
        return {
            t: "band", key: target.key, align: first ? "start" : "end",
            demand: { kind: "band", block: target.band.block, at: target.band.at, px: first ? 0 : Math.max(0, target.band.px - 1) },
            intent: { t: first ? "first" : "last" },
        };
    };
    const page = (dir: 1 | -1): PlanNavMove => {
        let j = i;
        let travelled = 0;
        for (;;) {
            const k = j + dir;
            const next = items[k];
            if (next === undefined) break;
            // A page never jumps a band: it stops on it, headed past.
            if (next.band !== undefined) {
                return { t: "band", key: next.key, align: "auto", demand: { kind: "band", block: next.band.block, at: next.band.at },
                    intent: { t: "step", from: items[j]!.key, dir } };
            }
            j = k;
            travelled += next.h;
            if (pageHeight > 0 ? travelled >= pageHeight : Math.abs(j - i) >= FALLBACK_PAGE_ITEMS) break;
        }
        return j === i ? { t: "none" } : focus(items[j]!);
    };
    const toggleIt = (): PlanNavMove => (cur.toggle !== undefined
        ? { t: "event", event: cur.toggle.event, focus: cur.key }
        : { t: "none" });
    switch (key) {
        case "ArrowDown": return step(1);
        case "ArrowUp": return step(-1);
        case "Home": return edge(true);
        case "End": return edge(false);
        case "PageDown": return page(1);
        case "PageUp": return page(-1);
        case "ArrowRight": {
            if (cur.toggle !== undefined && !cur.toggle.open) return toggleIt();
            const next = items[i + 1];
            if (cur.nests && cur.toggle?.open === true && next !== undefined && next.parent === cur.key) return focus(next);
            return { t: "none" };
        }
        case "ArrowLeft": {
            if (cur.toggle?.open === true) return toggleIt();
            const parent = cur.parent !== undefined ? items.find((it) => it.key === cur.parent) : undefined;
            return parent !== undefined ? focus(parent) : { t: "none" };
        }
        case "Enter":
            return cur.activate !== undefined
                ? { t: "event", event: cur.activate, focus: cur.activateLands ?? cur.key }
                : { t: "none" };
        case " ":
            return toggleIt();
        default:
            return undefined;
    }
}

/** Where a pending band move stands after the grid changed. */
export type PlanNavResolution =
    | { t: "resolved"; key: string }
    | { t: "pending" }
    | { t: "cancel" };

/**
 * What the grid knows of its source's ends — an inline canvas holds both, and
 * never loads.
 */
export interface PlanNavEdges {
    /** A window is still in flight: rows may yet arrive. */
    loading: boolean;
    /** The source's first element is resident. */
    atStart: boolean;
    /** The source's last element is resident. */
    atEnd: boolean;
}

/**
 * Where a pending band move stands against the grid now. A demanded window
 * can be IN FLIGHT without a band standing for it, so an item missing past
 * the move's start is not the end of the source: the move waits while a
 * window loads, and for Home / End until the source's own first / last
 * element is resident. It resolves on a row — or a failed window, which has
 * its own Retry — and is cancelled once the item it started from is gone, or
 * nothing more can arrive.
 *
 * @param items - The grid's items now
 * @param intent - The pending move
 * @param edges - What the grid knows of its source's ends
 * @returns Its resolution
 */
export function resolveNavIntent(items: readonly PlanNavItem[], intent: PlanNavIntent, edges: PlanNavEdges): PlanNavResolution {
    const land = (target: PlanNavItem | undefined, reached: boolean): PlanNavResolution => {
        if (target !== undefined && target.band === undefined && reached) return { t: "resolved", key: target.key };
        return target !== undefined || edges.loading || !reached ? { t: "pending" } : { t: "cancel" };
    };
    switch (intent.t) {
        case "step": {
            const i = items.findIndex((it) => it.key === intent.from);
            if (i < 0) return { t: "cancel" };
            const target = items[i + intent.dir];
            // Nothing past the start yet: more may be on the way.
            if (target === undefined) return edges.loading ? { t: "pending" } : { t: "cancel" };
            return land(target, true);
        }
        case "first": return land(items[0], edges.atStart);
        case "last": return land(items[items.length - 1], edges.atEnd);
    }
}

// ── The DOM side: which item a node is in, and a row's widgets ─────────────

/** Native widgets a row can hold — its controls, review buttons, Retry, and
 *  whatever the author's render mounts. */
const WIDGET_SELECTOR = "button, a[href], input, select, textarea, [tabindex]";
/** The canvas's own row widgets — out of the tab order (`tabIndex=-1`), reached
 *  through the row's Tab walk instead. */
const OWN_WIDGET_SELECTOR = "[data-plan-control], [data-plan-approve], [data-plan-reject], [data-plan-retry]";

/**
 * The grid item (row, band) a node belongs to in THIS canvas — a canvas nested
 * in an expand render answers for its own.
 *
 * @param node - A DOM node (an event target)
 * @param body - The canvas body
 * @returns The item element, or `null`
 */
export function gridItemOf(node: EventTarget | null, body: HTMLElement): HTMLElement | null {
    if (!(node instanceof Element)) return null;
    const item = node.closest<HTMLElement>("[data-plan-item]");
    if (item === null || !body.contains(item)) return null;
    return item.closest("[data-plan-body]") === body ? item : null;
}

/** An element's window fraction — its time position (`data-plan-frac`). */
function fracOf(el: Element): number {
    const f = Number(el.getAttribute("data-plan-frac"));
    return Number.isFinite(f) ? f : 0;
}

/**
 * A row's elements in time order — the runs, tiles, chips, marks and cells it
 * draws inside the window (overscan marks, clipped out of view, are not
 * reachable).
 *
 * @param row - The row element
 * @param body - The canvas body
 * @returns Its focusable elements, earliest first
 */
export function plotElements(row: HTMLElement, body: HTMLElement): HTMLElement[] {
    const out: HTMLElement[] = [];
    row.querySelectorAll<HTMLElement>(PLAN_ELEMENT_SELECTOR).forEach((el) => {
        // An element takes focus (`tabIndex=-1`); a label naming the same mark does not.
        if (!el.hasAttribute("tabindex") || gridItemOf(el, body) !== row) return;
        const f = fracOf(el);
        if (f < 0 || f >= 1) return;
        out.push(el);
    });
    // Stable: equal instants keep their DOM order (lanes top to bottom).
    return out.map((el, i) => ({ el, i, f: fracOf(el) }))
        .sort((a, b) => (a.f - b.f) || (a.i - b.i))
        .map((x) => x.el);
}

/**
 * A row's widgets in reading order, cell by cell — the gutter's controls, the
 * plot's elements in time order then anything the author's render mounts, the
 * review buttons. The Tab walk through a row.
 *
 * @param row - The row element
 * @param body - The canvas body
 * @returns Its widgets, in walk order
 */
export function rowWidgets(row: HTMLElement, body: HTMLElement): HTMLElement[] {
    const elements = new Set(plotElements(row, body));
    const out: HTMLElement[] = [];
    for (const cell of Array.from(row.children)) {
        const inCell = [...elements].filter((el) => cell.contains(el));
        const others: HTMLElement[] = [];
        cell.querySelectorAll<HTMLElement>(WIDGET_SELECTOR).forEach((el) => {
            if (elements.has(el) || el.matches(PLAN_ELEMENT_SELECTOR) || gridItemOf(el, body) !== row) return;
            if ((el as HTMLButtonElement).disabled === true) return;
            // The canvas's own widgets are out of the tab order on purpose;
            // an author's are reachable only when they are tabbable at all.
            if (!el.matches(OWN_WIDGET_SELECTOR) && el.tabIndex < 0) return;
            others.push(el);
        });
        appendAll(out, inCell);
        appendAll(out, others);
    }
    return out;
}
