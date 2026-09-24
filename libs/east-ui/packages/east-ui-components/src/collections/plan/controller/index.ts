/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The canvas controller (#815) — ONE framework-free store for everything a
 * Plan canvas remembers between renders: the UI state machine, the paged
 * source's residency, the key search, the open element overlay, the scroll
 * anchor and the scroll target.
 *
 * # Actions run their own effects
 *
 * Every action is a synchronous method: it makes the state transition, then
 * runs the effects that transition returned (slice writes, the author's
 * callbacks, page requests) before it returns. There is no effect batch held
 * in state for a later drain, so two effectful actions in one handler both
 * run — the drain this replaces saw only the last batch.
 *
 * # One notification per action
 *
 * An action — or a window landing, which arrives as a channel firing — changes
 * any number of parts and notifies ONCE, at its end, and only when the
 * snapshot changed. Subscribers select the part they read (`usePlanSelector`),
 * so a row re-renders only when its own slice of the state moves.
 *
 * # Reconcile
 *
 * A host data commit reconciles the UI state against the new rows (#610). The
 * canvas's first render with a new value already draws the reconciled VIEW
 * ({@link reconciledUi}, the same pure transition) — no flash of a vanished
 * row's focus — and `setValue`, the layout-effect sync, commits it so the
 * pruning is real (a row that comes back does not bring its old selection).
 * That commit notifies nobody: it moves nothing a reader shows — the view was
 * drawn from it, and what it prunes belongs to rows that are gone — so the
 * value renders once. The one exception is a changed DECLARED grain, which
 * clears the selection and focus of rows that are still there.
 *
 * @packageDocumentation
 */

import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../../utils.js";
import type { DragEventValue } from "../../../dnd/drag-layer";
import type { PlanElementRefValue, PlanElementResolver } from "../context.js";
import {
    bodyItemKey, windowRestHeight,
    type PlanBodyItem, type PlanRootValue, type PlanRowValue,
} from "../model.js";
import {
    initialPlanStore, planStoreReducer,
    type PlanEvent, type PlanGrain, type PlanStore, type PlanUiState, type RowKey,
} from "../plan-state.js";
import type { ResidencyOptions } from "../window-residency.js";
import { PLAN_PAGE_SIZE, type PlanViewport } from "../use-plan-paging.js";
import type { PlanSearch } from "../use-seek.js";
import {
    NOT_PERSISTED, sameAnchor, sameKey, sameList, sameToggle,
    type PlanAnchor, type PlanPersisted,
} from "../persisted.js";
import { createPagingDriver, type PlanPagingSnapshot } from "./paging.js";
import { CANVAS_KEY_TYPE, createSeekDriver, firstAtOrAfter, type PlanSeekSnapshot } from "./seek.js";
import { currentScale, runPlanEffects } from "./effects.js";
import { announcementOf, landedText } from "../a11y.js";
import { PLAN_WORDS, type PlanWords } from "../words.js";

/** A resolved overlay body (a resolver's some-value). */
export type PlanOverlayBody = Extract<ReturnType<PlanElementResolver>, { type: "some" }>["value"];

/** One open element overlay — the element it belongs to, and its body. */
export interface PlanOverlay {
    ref: PlanElementRefValue;
    body: PlanOverlayBody;
}

/** An open tooltip — a labelled mark's own text (a port, a cell marker). */
export interface PlanTooltip {
    /** Which mark it belongs to — its row and the mark's own attribute. */
    key: string;
    text: string;
}

/** The canvas's open surfaces — at most one of each kind (#816: one overlay
 *  layer serves every element). */
export interface PlanOverlays {
    popover: PlanOverlay | null;
    hover: PlanOverlay | null;
    tooltip: PlanTooltip | null;
}

/** Where the persisted scroll anchor is in its restore (#813). */
export interface PlanAnchorState {
    /** The anchor the last session left, if any. */
    saved: PlanAnchor | null;
    /** `pending` until the body can place it, `seeking` while a paged canvas
     *  loads its window, `settled` once restored (or found gone). */
    phase: "pending" | "seeking" | "settled";
    /** Where the frame scrolls to restore it — set once, when it settles. */
    restore: { index: number; offset: number } | undefined;
}

/** How a keyboard move brings its item into view (#819) — the least scroll
 *  that shows it, or one of its edges at the viewport's. */
export type PlanNavAlign = "auto" | "start" | "end";

/** Who owns the scroll position the frame is asked for (#811). */
export interface PlanScrollTarget {
    /** A key search's target, the first skipped row the chip seeks, or the
     *  item keyboard navigation moved to (#819). */
    owner: "search" | "skipped" | "nav";
    /** Bumped per chip click, so the chip scrolls there again after the user moved. */
    skippedSeq: number;
    /** The key search's target row — the first LOADED row at-or-after the
     *  sought key — once it has landed. */
    targetKey: string | undefined;
    /** The keyboard's target item (`bodyItemKey`), how to bring it into view,
     *  and a nonce per move — so moving back onto a row the user has since
     *  scrolled away from scrolls to it again. */
    nav: { key: string; align: PlanNavAlign; seq: number } | undefined;
}

/**
 * Where keyboard focus rests in the canvas (#819) — the roving tab stop, and a
 * move of DOM focus the keyboard asked for.
 */
export interface PlanNav {
    /** The body item (`bodyItemKey`) holding the canvas's ONE tab stop — the
     *  last one focused. `null` until something in the grid takes focus: the
     *  grid itself is the tab stop until then, and whenever the active item
     *  is not mounted. */
    active: string | null;
    /** A requested move of DOM focus: the item focuses itself once it is
     *  mounted (it may first have to scroll into view), then reports
     *  {@link PlanController.focusDone} — so a later remount never takes
     *  focus back. */
    request: { key: string; seq: number } | null;
}

/** The live region's latest message (#819). `seq` counts up, so the same
 *  words said twice are two messages. */
export interface PlanAnnouncement {
    text: string;
    seq: number;
}

/** Everything the canvas renders from — replaced whole, parts kept by identity. */
export interface PlanSnapshot {
    store: PlanStore;
    paging: PlanPagingSnapshot;
    seek: PlanSeekSnapshot;
    overlay: PlanOverlays;
    anchor: PlanAnchorState;
    scroll: PlanScrollTarget;
    nav: PlanNav;
    announce: PlanAnnouncement | null;
}

/** Options for {@link createPlanController}. */
export interface PlanControllerOptions {
    /** The declared grain at mount. */
    grain: PlanGrain;
    /** The declared-collapsed group keys at mount. */
    collapsed: Iterable<RowKey>;
    /** What the last session persisted under the canvas's `storageKey` (#813). */
    restored?: PlanPersisted | undefined;
    /** Write the persisted state — the canvas passes its storage setter. */
    persist?: ((next: PlanPersisted) => void) | undefined;
    /** Residency policy for a paged source (tests tune it). */
    policy?: ResidencyOptions | undefined;
}

/** The canvas controller's handle. */
export interface PlanController {
    getSnapshot(): PlanSnapshot;
    subscribe(listener: () => void): () => void;
    /** Props sync — the latest root, and its data-stable twin (a new `data`
     *  identity is a data change: the UI state reconciles). */
    setValue(value: PlanRootValue, data: PlanRootValue): void;
    /** The canvas's words (#820) — the message table and locale its live
     *  region speaks in. The canvas root hands them over whenever either
     *  changes; English in `en-US` until then. */
    setWords(words: PlanWords): void;
    /** An interaction — the transition, then its effects. */
    dispatch(e: PlanEvent): void;
    /** An element click — routed to the root's callback for its kind. */
    elementClick(ref: PlanElementRefValue): void;
    /** An element's popover / hover card wants to open or close. Opening runs
     *  the root's resolver first, and only a `some` body opens; an element whose
     *  surface is already open is not resolved again. A popover takes the
     *  surface from a hover card. */
    overlayIntent(kind: "popover" | "hover", ref: PlanElementRefValue, open: boolean): void;
    /** A labelled mark's tooltip opens, or closes (`null`). */
    tooltipIntent(tip: PlanTooltip | null): void;
    /** A completed drop on the canvas — reported to `onDrag`. */
    drop(event: DragEventValue): void;
    /** The review verbs, by row KEY (#569). */
    approveRow(key: string): void;
    rejectRow(key: string): void;
    approveAll(): void;
    rejectAll(): void;
    rerun(): void;
    /** Where the viewport is — the paged source's demand (#577). */
    reportViewport(at: PlanViewport, scrolling: boolean): void;
    /** The canvas committed a render of `paging` (the paging driver's
     *  `committed`). Call it after every commit: a jump hands the viewport back
     *  only once the canvas has shown — and scrolled to — its target (#812). */
    committed(paging: PlanPagingSnapshot): void;
    /** Ask a failed window again (#811). */
    retry(w: number): void;
    /** The key search, for the toolbar (its `find` / `jump` / `clear` are this
     *  controller's). Mount it only where the source declares `seek`; its
     *  `resetKey` is the seek snapshot's `epoch` (#821). */
    readonly search: Omit<PlanSearch, "resetKey">;
    /** The diagnostics chip asked for the first skipped row (#811). */
    seekSkipped(): void;
    /**
     * Keyboard navigation (#819): make `key` (a `bodyItemKey`) the canvas's
     * tab stop and move DOM focus onto it — scrolled into view first when an
     * `align` is given (a move onto an item already beside the focused one
     * needs none).
     */
    focusItem(key: string, align?: PlanNavAlign): void;
    /** DOM focus landed in an item (a click, a Tab) — it holds the tab stop. */
    itemFocused(key: string): void;
    /** The item a focus request named has taken focus. */
    focusDone(seq: number): void;
    /** Place the persisted anchor against the body the canvas rendered (#813).
     *  A no-op once it has settled. */
    placeAnchor(items: readonly PlanBodyItem[], bounded: boolean): void;
    /** The frame's scroll settled here — persisted once the anchor has settled. */
    anchorChanged(at: { index: number; offset: number }, items: readonly PlanBodyItem[]): void;
    /**
     * Listen to the source's channels while the canvas is mounted — call it
     * from an effect and return what it returns. The controller listens from
     * its first read, so the first `connect` only hands back the
     * disconnect; a `connect` after a disconnect (StrictMode rehearsing an
     * unmount, a canvas remounting the same controller) re-reads the source
     * and any pending search, which subscribes their channels afresh. State
     * outlives a disconnect.
     *
     * @returns Stop listening
     */
    connect(): () => void;
}

const NO_OVERLAYS: PlanOverlays = { popover: null, hover: null, tooltip: null };
const NO_NAV: PlanNav = { active: null, request: null };
const NO_ROWS: readonly PlanRowValue[] = [];
const refEqual = equalFor(Plan.Types.ElementRef);

type PlanReviewValue = ValueTypeOf<typeof Plan.Types.Review>;

/**
 * The declared-collapsed group keys among `rows`.
 *
 * @param rows - Canvas rows
 * @returns The keys of the groups that declare `collapsed: true`
 */
export function declaredCollapsedOf(rows: readonly PlanRowValue[]): ReadonlySet<RowKey> {
    const out = new Set<RowKey>();
    for (const row of rows) {
        if (row.kind.type === "group" && row.kind.value.collapsed.type === "some" && row.kind.value.collapsed.value) {
            out.add(row.key);
        }
    }
    return out;
}

/** The declared grain of a root. */
export function declaredGrainOf(value: PlanRootValue): PlanGrain {
    return getSomeorUndefined(value.grain)?.type ?? "resource";
}

/** Whether a root declares the compact density. */
export function denseOf(value: PlanRootValue): boolean {
    return getSomeorUndefined(getSomeorUndefined(value.style)?.density)?.type === "compact";
}

/** What a reconcile is judged against — the rows the canvas renders now. */
export interface PlanReconcileModel {
    /** Every row key the canvas holds. */
    alive: ReadonlySet<RowKey>;
    /** Whether `alive` is every row the canvas has (inline), or only the resident ones (paged). */
    complete: boolean;
    /** The declared-collapsed group keys among them. */
    declaredCollapsed: ReadonlySet<RowKey>;
    /** The declared grain. */
    declaredGrain: PlanGrain;
}

/**
 * The UI state as a reconcile against `model` would leave it — what the canvas
 * renders its first frame of a new value with, before `setValue` commits the
 * same transition.
 *
 * @param store - The current store
 * @param model - The rows the canvas renders now
 * @returns The reconciled UI state
 */
export function reconciledUi(store: PlanStore, model: PlanReconcileModel): PlanUiState {
    return planStoreReducer(store, { t: "reconcile", ...model }).store.ui;
}

/**
 * Create a canvas controller.
 *
 * @param options - See {@link PlanControllerOptions}
 * @returns The controller
 */
export function createPlanController(options: PlanControllerOptions): PlanController {
    const restored = options.restored ?? NOT_PERSISTED;
    let value: PlanRootValue | undefined;
    let data: PlanRootValue | undefined;
    let store = initialPlanStore(options.grain, options.collapsed, restored);
    let overlay = NO_OVERLAYS;
    // Nothing saved is nothing to restore: settled from the start, so a canvas
    // with no anchor never re-renders to say so.
    let anchor: PlanAnchorState = {
        saved: restored.anchor,
        phase: restored.anchor === null ? "settled" : "pending",
        restore: undefined,
    };
    let scroll: PlanScrollTarget = { owner: "search", skippedSeq: 0, targetKey: undefined, nav: undefined };
    let nav = NO_NAV;
    let navSeq = 0;
    let announce: PlanAnnouncement | null = null;
    let words: PlanWords = PLAN_WORDS;
    // The paged source's revision the canvas last showed (#821).
    let pagingRevision: string | undefined;
    // What storage holds — compared before every write, so nothing is written
    // that is already there.
    let persisted = restored;

    const listeners = new Set<() => void>();
    let depth = 0;
    let dirty = false;
    let connected = true;
    // A store the canvas has already drawn — committed without a notification.
    let quietStore: PlanStore | undefined;

    const paging = createPagingDriver({
        // The at-rest height of a window's rows (#613): declared collapse, no
        // focus, pinned rows excluded — never transient UI state.
        heightOf: (rows) => (value === undefined ? 0
            : windowRestHeight(rows, declaredGrainOf(value), denseOf(value), value.axis.type)),
        policy: options.policy,
        onChange: () => batch(() => {
            const landed = paging.getSnapshot();
            // Rows that arrive WITHOUT a data change carry their own declared
            // collapse: seed each declared key ONCE, the first time its row
            // appears — in the same notification as the rows themselves.
            store = planStoreReducer(store, { t: "seed", declaredCollapsed: declaredCollapsedOf(landed.rows) }).store;
            // What landed, for the live region (#819) — in the same
            // notification too, so a landing is still one commit.
            say(landedText(snapshot.paging.resident, landed.resident, landed.total, words));
            // The source moved off the snapshot a search was answered in: its
            // match positions index rows that may have moved (#821). The
            // first revision a source names is not a move — a search asked
            // before it waited for it.
            if (landed.revision !== pagingRevision) {
                if (pagingRevision !== undefined) seek.reset();
                pagingRevision = landed.revision;
            }
        }),
    });
    const seek = createSeekDriver({
        rows: () => paging.getSnapshot().rows,
        clearJump: () => paging.clearJump(),
        onChange: () => batch(() => undefined),
    });

    let snapshot: PlanSnapshot = {
        store, paging: paging.getSnapshot(), seek: seek.getSnapshot(), overlay, anchor, scroll, nav, announce,
    };

    /** Rebuild the snapshot from the parts — the same object when none moved. */
    function refresh(): void {
        const p = paging.getSnapshot();
        const s = seek.getSnapshot();
        // The key search's target: the first loaded row at-or-after the sought
        // key (a leaf row's key IS its data key, and both the source and the
        // canvas are in canonical key order — #568). A target that LANDS takes
        // the viewport back from the skipped-row chip: the latest request wins.
        const targetKey = s.sought !== null ? p.rows[firstAtOrAfter(p.rows, s.sought.key)]?.key : undefined;
        if (targetKey !== scroll.targetKey) {
            scroll = { ...scroll, targetKey, owner: targetKey !== undefined ? "search" : scroll.owner };
        }
        const quiet = store === quietStore;
        quietStore = undefined;
        const othersSame = snapshot.paging === p && snapshot.seek === s && snapshot.overlay === overlay
            && snapshot.anchor === anchor && snapshot.scroll === scroll && snapshot.nav === nav
            && snapshot.announce === announce;
        if (snapshot.store === store && othersSame) return;
        // Only the store moved, and to what every reader already shows: no one
        // needs telling (see `setValue`).
        const drawn = quiet && othersSame;
        snapshot = { store, paging: p, seek: s, overlay, anchor, scroll, nav, announce };
        if (!drawn) dirty = true;
    }

    /** A row's name as the live region says it — its gutter label. */
    function labelOf(key: RowKey): string {
        return rows().find((r) => r.key === key)?.gutter.label ?? key;
    }

    /** Put words in the live region (#819) — nothing when there are none. */
    function say(text: string | undefined): void {
        if (text !== undefined) announce = { text, seq: (announce?.seq ?? 0) + 1 };
    }

    /** Run `fn` as one action: whatever it changes notifies once, at the end. */
    function batch<T>(fn: () => T): T {
        depth += 1;
        try {
            return fn();
        } finally {
            depth -= 1;
            if (depth === 0) {
                refresh();
                if (dirty) {
                    dirty = false;
                    for (const listener of [...listeners]) listener();
                }
            }
        }
    }

    /** The canvas's rows — inline, or the resident paged ones. */
    function rows(): readonly PlanRowValue[] {
        if (value === undefined) return NO_ROWS;
        return value.rows.type === "inline" ? [...value.rows.value.values()] : paging.getSnapshot().rows;
    }

    /** Write the user's toggles when they differ from what storage holds (#813). */
    function persistToggles(): void {
        const collapse = [...store.overrides];
        const charts = [...store.ui.chartsExpanded];
        if (sameList(persisted.collapse, collapse, sameToggle) && sameList(persisted.charts, charts, sameKey)) return;
        persisted = { ...persisted, collapse, charts };
        options.persist?.(persisted);
    }

    /** Reconcile the UI state against the rows the value holds (#610). */
    function reconcile(v: PlanRootValue): void {
        const inline = v.rows.type === "inline";
        const current = rows();
        store = planStoreReducer(store, {
            t: "reconcile",
            alive: new Set(current.map((r) => r.key)),
            // A paged source's resident rows are not all its rows: a key
            // missing from them may simply not have landed (#813).
            complete: inline,
            declaredCollapsed: declaredCollapsedOf(current),
            declaredGrain: declaredGrainOf(v),
        }).store;
        persistToggles();
    }

    /** One of the root's review callbacks, fired after the handler (#569). */
    function reviewCall(k: "onApprove" | "onReject", key: string): void {
        const review: PlanReviewValue | undefined = value !== undefined ? getSomeorUndefined(value.review) : undefined;
        const fn = review !== undefined ? getSomeorUndefined(review[k]) : undefined;
        if (fn !== undefined) queueMicrotask(() => fn({ key }));
    }
    function reviewBatchCall(k: "onApproveAll" | "onRejectAll" | "onRerun"): void {
        const review: PlanReviewValue | undefined = value !== undefined ? getSomeorUndefined(value.review) : undefined;
        const fn = review !== undefined ? getSomeorUndefined(review[k]) : undefined;
        if (fn !== undefined) queueMicrotask(() => fn());
    }

    const search: Omit<PlanSearch, "resetKey"> = {
        keyType: CANVAS_KEY_TYPE,
        find: (q) => {
            // A new search takes the viewport back from the skipped-row chip.
            batch(() => { if (scroll.owner !== "search") scroll = { ...scroll, owner: "search" }; });
            return seek.find(q);
        },
        listRange: (row, limit) => seek.listRange(row, limit),
        // Hand the driver the matched ELEMENT: residency rebases there and the
        // windows in between are never fetched (#577).
        jump: (row) => batch(() => paging.jumpToElement(row)),
        clear: () => batch(() => seek.clear()),
    };

    return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        setValue(next, nextData) {
            batch(() => {
                const prev = value;
                const dataChanged = nextData !== data;
                value = next;
                data = nextData;
                const src = next.rows.type === "paged" ? next.rows.value : undefined;
                seek.setSeek(src !== undefined && src.seek.type === "some" ? src.seek.value : undefined);
                paging.setSource(src);
                // The ledger measures windows at rest by the declared grain,
                // density and axis kind — a change there re-measures them.
                if (prev !== undefined && src !== undefined && (declaredGrainOf(prev) !== declaredGrainOf(next)
                    || denseOf(prev) !== denseOf(next) || prev.axis.type !== next.axis.type)) {
                    paging.refresh();
                }
                if (dataChanged) {
                    const grain = store.declaredGrain;
                    reconcile(next);
                    // The canvas drew this value's reconciled view, so the
                    // commit moves nothing a reader shows — unless the declared
                    // grain changed, which clears the selection and focus of
                    // rows that are still there (and read the store itself).
                    if (store.declaredGrain === grain) quietStore = store;
                }
            });
        },
        setWords(next) {
            // Nothing on screen reads them from here — only what is said next.
            words = next;
        },
        dispatch(e) {
            batch(() => {
                const before = store.ui;
                // A resolution lives in the slice: what it was, to say what it became.
                const resolutionBefore = e.t === "resolution.set" && value !== undefined
                    ? currentScale(value, rows())?.resolution : undefined;
                const step = planStoreReducer(store, { t: "event", e });
                store = step.store;
                if (value !== undefined && step.effects.length > 0) runPlanEffects(step.effects, value, rows());
                persistToggles();
                // What the interaction changed, for the live region (#819) —
                // said by the action that did it, so a reconcile or a landing
                // that moves the same state says nothing.
                say(announcementOf(e, before, store.ui, labelOf, words));
                if (e.t === "resolution.set" && value !== undefined) {
                    const after = currentScale(value, rows())?.resolution;
                    if (after !== undefined && after !== resolutionBefore) say(words.m.announceResolution({ resolution: after }));
                }
            });
        },
        focusItem(key, align) {
            batch(() => {
                navSeq += 1;
                nav = { active: key, request: { key, seq: navSeq } };
                if (align !== undefined) scroll = { ...scroll, owner: "nav", nav: { key, align, seq: navSeq } };
            });
        },
        itemFocused(key) {
            if (nav.active === key) return;
            batch(() => { nav = { ...nav, active: key }; });
        },
        focusDone(seq) {
            if (nav.request === null || nav.request.seq !== seq) return;
            batch(() => { nav = { ...nav, request: null }; });
        },
        elementClick(ref) {
            if (value === undefined) return;
            // One funnel, routed by the clicked ref's own tag — the click
            // payloads ARE the element-ref arms, so nothing is re-encoded.
            switch (ref.type) {
                case "run": { const fn = getSomeorUndefined(value.onRunClick); if (fn) queueMicrotask(() => fn(ref.value)); break; }
                case "event": { const fn = getSomeorUndefined(value.onEventClick); if (fn) queueMicrotask(() => fn(ref.value)); break; }
                case "mark": { const fn = getSomeorUndefined(value.onMarkClick); if (fn) queueMicrotask(() => fn(ref.value)); break; }
                case "chip": { const fn = getSomeorUndefined(value.onChipClick); if (fn) queueMicrotask(() => fn(ref.value)); break; }
                case "cell": { const fn = getSomeorUndefined(value.onCellClick); if (fn) queueMicrotask(() => fn(ref.value)); break; }
            }
        },
        overlayIntent(kind, ref, open) {
            batch(() => {
                const current = overlay[kind];
                if (!open) {
                    // Close unmounts the body — never a stale hidden surface.
                    if (current !== null && refEqual(current.ref, ref)) overlay = { ...overlay, [kind]: null };
                    return;
                }
                // Already open for this element: resolved once per open, never
                // again while it stays open.
                if (current !== null && refEqual(current.ref, ref)) return;
                const resolver = value !== undefined
                    ? getSomeorUndefined(kind === "popover" ? value.popover : value.hover)
                    : undefined;
                if (resolver === undefined) return;
                // The resolver runs FIRST and only a `some` body opens — an
                // empty surface never flashes. One that throws opens nothing.
                let body: PlanOverlayBody | undefined;
                try {
                    const res = resolver(ref);
                    body = res.type === "some" ? res.value : undefined;
                } catch (err) {
                    console.error(`[Plan] ${kind} resolver failed:`, err);
                }
                if (body === undefined) return;
                overlay = kind === "popover"
                    // A click takes the surface: the hover card over the same
                    // spot would sit on top of what was asked for.
                    ? { ...overlay, popover: { ref, body }, hover: null }
                    : { ...overlay, hover: { ref, body } };
            });
        },
        tooltipIntent(tip) {
            batch(() => {
                if (tip === null) {
                    if (overlay.tooltip !== null) overlay = { ...overlay, tooltip: null };
                    return;
                }
                if (overlay.tooltip?.key === tip.key && overlay.tooltip.text === tip.text) return;
                overlay = { ...overlay, tooltip: tip };
            });
        },
        drop(event) {
            // No optimistic row is synthesized: a Plan's rows are derived from
            // `data` through the series pipeline, so the honest flow is the one
            // the grammar documents — the host commits, the data changes, the
            // rows re-derive.
            const fn = value !== undefined ? getSomeorUndefined(value.onDrag) : undefined;
            if (fn !== undefined) queueMicrotask(() => fn(event));
        },
        approveRow: (key) => reviewCall("onApprove", key),
        rejectRow: (key) => reviewCall("onReject", key),
        approveAll: () => reviewBatchCall("onApproveAll"),
        rejectAll: () => reviewBatchCall("onRejectAll"),
        rerun: () => reviewBatchCall("onRerun"),
        reportViewport(at, scrolling) {
            batch(() => paging.reportViewport(at, scrolling));
        },
        committed(rendered) {
            batch(() => paging.committed(rendered));
        },
        retry(w) {
            batch(() => paging.retry(w));
        },
        search,
        seekSkipped() {
            batch(() => { scroll = { ...scroll, owner: "skipped", skippedSeq: scroll.skippedSeq + 1 }; });
        },
        placeAnchor(items, bounded) {
            if (anchor.phase === "settled") return;
            batch(() => {
                const saved = anchor.saved;
                // Only a bounded frame scrolls itself: an unbounded canvas's
                // place is its page's, and the narrow list keeps none.
                if (saved === null || !bounded) {
                    anchor = { ...anchor, phase: "settled" };
                    return;
                }
                if (items.length === 0) return;
                const at = items.findIndex((it) => bodyItemKey(it) === saved.key);
                if (at < 0 && value?.rows.type === "paged" && saved.window !== null) {
                    // A paged canvas may simply not have loaded the row yet:
                    // open at the window it came from before calling it gone —
                    // a rebase, not a walk.
                    const w = saved.window;
                    if (anchor.phase === "pending") {
                        anchor = { ...anchor, phase: "seeking" };
                        paging.openAt(w * PLAN_PAGE_SIZE);
                        return;
                    }
                    const snap = paging.getSnapshot();
                    const settled = snap.failures.some((f) => f.w === w) || [...snap.origin.values()].includes(w);
                    if (!settled) return;
                }
                anchor = {
                    ...anchor,
                    phase: "settled",
                    restore: at >= 0
                        ? { index: at, offset: saved.offset }
                        : { index: Math.min(saved.index, items.length - 1), offset: 0 },
                };
            });
        },
        anchorChanged(at, items) {
            // Nothing is persisted until the saved anchor is restored: the
            // restore's own scroll must not overwrite what it is restoring.
            if (anchor.phase !== "settled") return;
            const item = items[at.index];
            if (item === undefined) return;
            const next: PlanAnchor = {
                key: bodyItemKey(item),
                offset: at.offset,
                index: at.index,
                window: item.kind === "row" ? paging.getSnapshot().origin.get(item.row.row.key) ?? null : null,
            };
            if (sameAnchor(persisted.anchor, next)) return;
            persisted = { ...persisted, anchor: next };
            options.persist?.(persisted);
        },
        connect() {
            if (!connected) {
                connected = true;
                batch(() => {
                    paging.refresh();
                    seek.refresh();
                });
            }
            return () => {
                connected = false;
                paging.disconnect();
                seek.disconnect();
            };
        },
    };
}

export type { PlanPagingSnapshot } from "./paging.js";
export type { PlanSeekSnapshot } from "./seek.js";
