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
 * # A bound `ui` state (#824)
 *
 * A root may bind the canvas's interaction state to the host (`ui`, a
 * `State.bind` handle). The controller reads it before the first render, then
 * again whenever the state store says something was written and on every
 * `setValue`: a state it has not seen is the host's write, and replaces the
 * selection, the rows folded or opened against their declaration, and the
 * expanded charts. The user's own actions are written back, once per action
 * and only when they moved it. Bound, the canvas persists no toggles of its
 * own under its storage key — the host holds them — though its scroll anchor
 * still is.
 *
 * `focus` in the state is a REQUEST — bring this row into view — which the
 * canvas spends at once (it writes `focus: none` back) and then serves: a row
 * on the canvas has its folded ancestors opened and is scrolled to the top
 * and made the tab stop; a paged row seen before has its window opened
 * first; one never seen is sought by its element's key, when the source can
 * seek. A request that cannot be served is dropped.
 *
 * @packageDocumentation
 */

import { StringType, equalFor, none, printFor, some, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../../utils.js";
import type { DragEventValue } from "../../../dnd/drag-layer";
import type { PlanElementRefValue, PlanElementResolver } from "../context.js";
import {
    bodyItemKey, canvasRowsOf, restUi, rowIdOfKey, rowItemKey, rowKeyOf, rowKeyWords, skeletonHeight, windowSkeleton,
    type PlanBodyItem, type PlanFocusCtx, type PlanRootValue, type PlanRowId, type PlanRowValue, type SkeletonUi,
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
import { createPagingDriver, type PlanPagingSnapshot, type PlanRowPlace } from "./paging.js";
import { CANVAS_KEY_TYPE, createSeekDriver, firstAtOrAfter, type PlanSeekSnapshot } from "./seek.js";
import { currentScale, runPlanEffects } from "./effects.js";
import { announcementOf, landedText } from "../a11y.js";
import { PLAN_WORDS, type PlanWords } from "../words.js";

/** A resolved overlay body (a resolver's some-value). */
export type PlanOverlayBody = Extract<ReturnType<PlanElementResolver>, { type: "some" }>["value"];

/** A decoded bound `ui` handle — the root's `ui` some-value (#824). */
export type PlanUiBindValue = ValueTypeOf<typeof Plan.Types.UiBind>;
/** A decoded bound `ui` state. */
export type PlanUiStateValue = ValueTypeOf<typeof Plan.Types.UiState>;

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
    /** The declared-collapsed row keys at mount. */
    collapsed: Iterable<RowKey>;
    /** What the last session persisted under the canvas's `storageKey` (#813). */
    restored?: PlanPersisted | undefined;
    /** Write the persisted state — the canvas passes its storage setter. */
    persist?: ((next: PlanPersisted) => void) | undefined;
    /** Residency policy for a paged source (tests tune it). */
    policy?: ResidencyOptions | undefined;
    /** The root's bound `ui` handle at mount (#824) — read before the first
     *  render, so a bound canvas draws the host's state from its first frame. */
    ui?: PlanUiBindValue | undefined;
    /** Listen for writes to the state a bound `ui` handle reads. The canvas
     *  passes the state store's own subscribe: a handle names no key to
     *  listen to, so every write is looked at, and one that did not move the
     *  canvas's state does nothing. */
    subscribeUi?: ((listener: () => void) => () => void) | undefined;
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
    /** An element click — reported to the root's `onElementClick` (#824). */
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
    /** The review verbs, by row KEY (#569) — the callbacks receive the row's
     *  typed id (#822). */
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
    /** Where a paged row the body does not hold sits — its block's band, and
     *  how far down it (#823: a link into an evicted window). */
    placeOf(key: RowKey): PlanRowPlace | undefined;
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
const uiStateEqual = equalFor(Plan.Types.UiState);
/** A String key's `.east` literal — how an exact key search names it. */
const printString = printFor(StringType);

type PlanReviewValue = ValueTypeOf<typeof Plan.Types.Review>;

/**
 * The declared-collapsed row keys among `rows`.
 *
 * @param rows - Canvas rows
 * @returns The keys of the rows that declare `collapsed: true` — any row with
 *   children may (#822)
 */
export function declaredCollapsedOf(rows: readonly PlanRowValue[]): ReadonlySet<RowKey> {
    const out = new Set<RowKey>();
    for (const row of rows) {
        if (row.collapsed) out.add(row.key);
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
    /** The declared-collapsed row keys among them. */
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
    // The host's interaction state, when the root binds one (#824). Bound, the
    // host holds the toggles: none are restored from storage, or persisted.
    let bound = options.ui;
    // What the canvas last read from, or wrote to, the bound handle — an
    // outside write is a state it has not seen.
    let boundSeen: PlanUiStateValue | undefined;
    // A write-back queued for the end of the turn.
    let writing = false;
    // A `focus` request — bring the row into view — until it is served or
    // given up: `resolve` looks for it, `seeking` waits for the key search,
    // `opening` for its window.
    let focusRequest: { key: RowKey; id: PlanRowId; phase: "resolve" | "seeking" | "opening" } | undefined;
    let store = initialPlanStore(options.grain, options.collapsed,
        bound !== undefined ? { collapse: [], charts: [] } : restored);
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

    /** The UI state a paged window's height reads (#823) — the store's grain
     *  and charts, and each row's collapse as the canvas draws it: a declared
     *  collapse not seeded yet is the collapse its landing will seed, so a
     *  window measures the same before and after its rows seed. */
    const skeletonUi: SkeletonUi = {
        get grain() { return store.ui.grain; },
        collapsed: (key, declared) => (declared && !store.seeded.has(key)
            ? store.overrides.get(key) ?? true
            : store.ui.collapsed.has(key)),
        get chartsExpanded() { return store.ui.chartsExpanded; },
    };
    /** The expand focus's context strips — what a window's rows draw at under
     *  it (a links focus elides runs across windows, and measures unfocused). */
    const expandFocus = (): PlanFocusCtx | undefined =>
        (store.ui.focus?.kind === "expand" ? { kind: "expand", key: store.ui.focus.key } : undefined);

    const paging = createPagingDriver({
        // Each landed window's height facts, once (#823) — the axis kind says
        // which rows draw as diagnostics.
        skeletonOf: (rows) => windowSkeleton(rows, value?.axis.type),
        // What the window's rows draw at NOW — the ledger follows the canvas's
        // collapse, grain, charts and expand focus, so a band that stands for
        // evicted rows is exactly as tall as they would draw.
        heightOf: (sk) => (value === undefined ? 0 : skeletonHeight(sk, skeletonUi, denseOf(value), expandFocus())),
        // At rest (#613): declared collapse, no charts, no focus — what the
        // slot rate is seeded from, so a first window that landed mid-collapse
        // does not describe every unvisited one by it.
        restHeightOf: (sk) => (value === undefined ? 0 : skeletonHeight(sk, restUi(declaredGrainOf(value)), denseOf(value))),
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
            // A row a `focus` request waits for may have landed (#824).
            serveFocus();
        }),
    });
    const seek = createSeekDriver({
        rows: () => paging.getSnapshot().rows,
        clearJump: () => paging.clearJump(),
        onChange: () => batch(() => undefined),
    });

    // A bound state is the host's from the first frame (#824) — read before
    // the first snapshot, so the canvas never draws its own first.
    if (bound !== undefined) {
        const read = readBound(bound);
        if (read !== undefined) {
            boundSeen = read;
            adopt(read);
        }
    }

    let snapshot: PlanSnapshot = {
        store, paging: paging.getSnapshot(), seek: seek.getSnapshot(), overlay, anchor, scroll, nav, announce,
    };

    // What the paged windows' heights were last measured under (#823).
    let measuredUnder: {
        grain: PlanGrain; overrides: PlanStore["overrides"]; charts: ReadonlySet<RowKey>;
        expand: RowKey | undefined; dense: boolean;
    } | undefined;

    /** Measure every window the paged blocks have seen again when what their
     *  rows draw at moved — a collapse toggle, the grain, a chart toggle, an
     *  expand focus, the density — so the bands that stand for evicted rows
     *  follow, exactly as the rows would move inline (#823). A seed moves
     *  nothing here: a window measures an unseeded declared collapse as the
     *  collapse its seed will be. */
    function syncHeights(): void {
        if (value === undefined || value.rows.type !== "paged") return;
        const expand = store.ui.focus?.kind === "expand" ? store.ui.focus.key : undefined;
        const dense = denseOf(value);
        const m = measuredUnder;
        if (m !== undefined && m.grain === store.ui.grain && m.overrides === store.overrides
            && m.charts === store.ui.chartsExpanded && m.expand === expand && m.dense === dense) return;
        measuredUnder = { grain: store.ui.grain, overrides: store.overrides, charts: store.ui.chartsExpanded, expand, dense };
        if (m !== undefined) paging.remeasure();
    }

    /** Rebuild the snapshot from the parts — the same object when none moved. */
    function refresh(): void {
        const p = paging.getSnapshot();
        const s = seek.getSnapshot();
        // The key search's target: the first loaded row whose element sorts
        // at-or-after the sought key (a row's id starts with the key of the
        // element it came from, and the source serves its elements in key
        // order — #822). A target that LANDS takes the viewport back from the
        // skipped-row chip: the latest request wins.
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

    /** A row's name as the live region says it — its gutter label, or its
     *  key's words when the row is not at hand (#822). */
    function labelOf(key: RowKey): string {
        return rows().find((r) => r.key === key)?.gutter.label ?? rowKeyWords(key);
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

    /** The canvas's rows — inline, or the resident paged ones. Read through
     *  the data-stable root, so the inline rows are the canvas's own objects. */
    function rows(): readonly PlanRowValue[] {
        if (data === undefined) return NO_ROWS;
        return data.rows.type === "inline" ? canvasRowsOf(data.rows.value) : paging.getSnapshot().rows;
    }

    /** Write the user's toggles when they differ from what storage holds (#813)
     *  — unless the root binds a `ui` state, which holds them instead (#824). */
    function persistToggles(): void {
        if (bound !== undefined) return;
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

    /** One of the root's review callbacks, fired after the handler (#569),
     *  naming the row by its typed id (#822). */
    function reviewCall(k: "onApprove" | "onReject", key: string): void {
        const review: PlanReviewValue | undefined = value !== undefined ? getSomeorUndefined(value.review) : undefined;
        const fn = review !== undefined ? getSomeorUndefined(review[k]) : undefined;
        const id = fn !== undefined ? rowIdOfKey(key) : undefined;
        if (fn !== undefined && id !== undefined) queueMicrotask(() => fn(id));
    }
    function reviewBatchCall(k: "onApproveAll" | "onRejectAll" | "onRerun"): void {
        const review: PlanReviewValue | undefined = value !== undefined ? getSomeorUndefined(value.review) : undefined;
        const fn = review !== undefined ? getSomeorUndefined(review[k]) : undefined;
        if (fn !== undefined) queueMicrotask(() => fn());
    }

    /** One interaction's transition and its effects — the core of `dispatch`,
     *  for the canvas's own moves too (a focus request opening a section). */
    function step(e: PlanEvent): void {
        const next = planStoreReducer(store, { t: "event", e });
        store = next.store;
        if (value !== undefined && next.effects.length > 0) runPlanEffects(next.effects, value);
    }

    // ── The bound `ui` state (#824) ────────────────────────────────────────

    /** The bound handle's state — `undefined` when reading it throws. */
    function readBound(handle: PlanUiBindValue): PlanUiStateValue | undefined {
        try {
            return handle.read();
        } catch (err) {
            console.error("[Plan] ui state read failed:", err);
            return undefined;
        }
    }

    /** The ids of `keys`, in the order `before` lists them, the rest after —
     *  so a write-back moves no id the host placed. */
    function idsOf(keys: Iterable<RowKey>, before: readonly PlanRowId[]): PlanRowId[] {
        const wanted = new Map<RowKey, PlanRowId>();
        for (const key of keys) {
            // A repeated row names its original's id (`rowIdOfKey`) — once.
            const id = rowIdOfKey(key);
            if (id !== undefined && !wanted.has(rowKeyOf(id))) wanted.set(rowKeyOf(id), id);
        }
        const out: PlanRowId[] = [];
        for (const id of before) {
            const text = rowKeyOf(id);
            if (wanted.has(text)) {
                out.push(id);
                wanted.delete(text);
            }
        }
        for (const id of wanted.values()) out.push(id);
        return out;
    }

    /** The canvas's interaction state as a bound state — a request spent. */
    function boundStateOf(): PlanUiStateValue {
        const folded: RowKey[] = [];
        const opened: RowKey[] = [];
        for (const [key, collapsed] of store.overrides) (collapsed ? folded : opened).push(key);
        const selected = store.ui.selected !== null ? rowIdOfKey(store.ui.selected) : undefined;
        return {
            selected: selected !== undefined ? some(selected) : none,
            collapsed: idsOf(folded, boundSeen?.collapsed ?? []),
            expanded: idsOf(opened, boundSeen?.expanded ?? []),
            charts: idsOf(store.ui.chartsExpanded, boundSeen?.charts ?? []),
            focus: none,
        };
    }

    /** Write the canvas's state back to the host, when it moved — at the end
     *  of the turn, the latest state once. */
    function writeBound(): void {
        if (bound === undefined) return;
        const next = boundStateOf();
        if (boundSeen !== undefined && uiStateEqual(next, boundSeen)) return;
        boundSeen = next;
        if (writing) return;
        writing = true;
        queueMicrotask(() => {
            writing = false;
            const handle = bound;
            const state = boundSeen;
            if (handle === undefined || state === undefined) return;
            try {
                handle.write(state);
            } catch (err) {
                console.error("[Plan] ui state write failed:", err);
            }
        });
    }

    /** Take the host's state: its selection, folds and charts replace the
     *  canvas's, and a `focus` request is spent and queued. */
    function adopt(s: PlanUiStateValue): void {
        const collapse = new Map<RowKey, boolean>();
        for (const id of s.expanded) collapse.set(rowKeyOf(id), false);
        // A row both folded and opened is folded.
        for (const id of s.collapsed) collapse.set(rowKeyOf(id), true);
        store = planStoreReducer(store, {
            t: "external",
            selected: s.selected.type === "some" ? rowKeyOf(s.selected.value) : null,
            collapse,
            charts: new Set(s.charts.map(rowKeyOf)),
        }).store;
        if (s.focus.type === "some") {
            focusRequest = { key: rowKeyOf(s.focus.value), id: s.focus.value, phase: "resolve" };
            // Spent at once: the state says so whatever serving it takes.
            writeBound();
        }
    }

    /** Look at the bound state — a state the canvas has not seen is the
     *  host's write, and is taken. */
    function syncBound(): void {
        // Bound no more: the next binding is read afresh.
        if (bound === undefined) {
            boundSeen = undefined;
            return;
        }
        // The canvas's own write is on its way: what the handle holds is older.
        if (writing) return;
        const read = readBound(bound);
        if (read === undefined || (boundSeen !== undefined && uiStateEqual(read, boundSeen))) return;
        boundSeen = read;
        adopt(read);
        serveFocus();
        syncHeights();
    }

    /** Open a row's folded ancestors — and the group grain, when it folds the
     *  top group the row sits under — as the user would to see it. */
    function reveal(row: PlanRowValue, byKey: ReadonlyMap<RowKey, PlanRowValue>): void {
        let top = row;
        for (let up = row.parent; up.type === "some";) {
            const parent = byKey.get(up.value);
            if (parent === undefined) break;
            if (store.ui.collapsed.has(parent.key)) step({ t: "group.toggle", key: parent.key });
            top = parent;
            up = parent.parent;
        }
        if (top !== row && top.kind.type === "group" && store.ui.grain === "group") {
            // A grain change clears the selection — the user's rule when they
            // switch; the host's request keeps what the host selected.
            const selected = store.ui.selected;
            step({ t: "grain.set", grain: "resource" });
            if (selected !== null && store.ui.selected !== selected) store = { ...store, ui: { ...store.ui, selected } };
        }
    }

    /** Serve a `focus` request as far as it can go now. */
    function serveFocus(): void {
        const req = focusRequest;
        if (req === undefined || value === undefined) return;
        const current = rows();
        const row = current.find((r) => r.key === req.key);
        if (row !== undefined) {
            focusRequest = undefined;
            reveal(row, new Map(current.map((r) => [r.key, r])));
            // To the top of the view, and the tab stop — DOM focus stays where
            // it is: the host asked for the row to be shown, not the keyboard.
            const item = rowItemKey(row.key);
            navSeq += 1;
            nav = { ...nav, active: item };
            scroll = { ...scroll, owner: "nav", nav: { key: item, align: "start", seq: navSeq } };
            persistToggles();
            syncHeights();
            writeBound();
            return;
        }
        // Not on the canvas: a paged row may yet land; an inline one will not.
        if (value.rows.type !== "paged") {
            focusRequest = undefined;
            return;
        }
        switch (req.phase) {
            case "resolve": {
                // Seen before — its window, opened.
                const seen = paging.seenAt(req.key);
                if (seen !== undefined) {
                    focusRequest = { ...req, phase: "opening" };
                    paging.openAt(seen.w * PLAN_PAGE_SIZE, seen.block);
                    return;
                }
                // Never seen — sought by the key of the element it comes from.
                const element = req.id.type === "entry" ? req.id.value.path[0] : undefined;
                if (element === undefined || value.rows.value.seek.type !== "some") {
                    focusRequest = undefined;
                    return;
                }
                const waiting = { ...req, phase: "seeking" as const };
                focusRequest = waiting;
                seek.find({ key: printString(element) }).then(
                    (range) => batch(() => {
                        if (focusRequest !== waiting) return;
                        // The request's search, not the toolbar's: it leaves
                        // no query behind to take the scroll back.
                        seek.clear();
                        if (!range.found) {
                            focusRequest = undefined;
                            return;
                        }
                        focusRequest = { ...req, phase: "opening" };
                        paging.jumpToElement(range.row);
                        serveFocus();
                    }),
                    () => batch(() => { if (focusRequest === waiting) focusRequest = undefined; }),
                );
                return;
            }
            case "seeking":
                return;
            case "opening":
                // Its window settled without the row: nowhere left to look.
                if (!paging.jumping()) focusRequest = undefined;
                return;
        }
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
                bound = getSomeorUndefined(next.ui);
                const src = next.rows.type === "paged" ? next.rows.value : undefined;
                seek.setSeek(src !== undefined && src.seek.type === "some" ? src.seek.value : undefined);
                paging.setSource(src);
                // Which rows draw as diagnostics is the axis kind's to say:
                // the windows take their skeletons again.
                if (prev !== undefined && src !== undefined && prev.axis.type !== next.axis.type) paging.reskeleton();
                if (dataChanged) {
                    const grain = store.declaredGrain;
                    reconcile(next);
                    const reconciled = store;
                    // Bound, the host's word outranks what the reconcile
                    // pruned: a row it names that only now arrives follows it.
                    if (bound !== undefined && boundSeen !== undefined) adopt(boundSeen);
                    // The canvas drew this value's reconciled view, so the
                    // commit moves nothing a reader shows — unless the declared
                    // grain changed, which clears the selection and focus of
                    // rows that are still there (and read the store itself),
                    // or the host's state put back what the reconcile pruned.
                    if (store.declaredGrain === grain && store === reconciled) quietStore = store;
                }
                // The host's write — its Reactive rendered this value (#824).
                syncBound();
                // A row a `focus` request waits for may have arrived.
                serveFocus();
                // A new density, or a grain the declaration changed, redraws
                // the paged windows' rows at other heights.
                syncHeights();
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
                    ? currentScale(value)?.resolution : undefined;
                step(e);
                persistToggles();
                // Bound, what the user did is the host's to hold (#824).
                writeBound();
                // A collapse, the grain, a chart or an expand focus redraws the
                // paged windows' rows at other heights (#823).
                syncHeights();
                // What the interaction changed, for the live region (#819) —
                // said by the action that did it, so a reconcile or a landing
                // that moves the same state says nothing.
                say(announcementOf(e, before, store.ui, labelOf, words));
                if (e.t === "resolution.set" && value !== undefined) {
                    const after = currentScale(value)?.resolution;
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
            // ONE callback over the element ref (#824) — the LATEST root's.
            const fn = value !== undefined ? getSomeorUndefined(value.onElementClick) : undefined;
            if (fn !== undefined) queueMicrotask(() => fn(ref));
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
            batch(() => {
                paging.committed(rendered);
                // A `focus` request's window settled — with its row, or not.
                serveFocus();
            });
        },
        retry(w) {
            batch(() => paging.retry(w));
        },
        placeOf: (key) => paging.placeOf(key),
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
                    // open its block at the window it came from before calling
                    // it gone — a rebase, not a walk.
                    const w = saved.window;
                    const block = saved.block ?? undefined;
                    if (anchor.phase === "pending") {
                        anchor = { ...anchor, phase: "seeking" };
                        paging.openAt(w * PLAN_PAGE_SIZE, block);
                        return;
                    }
                    const snap = paging.getSnapshot();
                    const settled = snap.failures.some((f) => f.w === w)
                        || [...snap.origin.values()].some((o) => o.w === w && (block === undefined || o.block === block));
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
            const origin = item.kind === "row" ? paging.getSnapshot().origin.get(item.row.row.key) : undefined;
            const next: PlanAnchor = {
                key: bodyItemKey(item),
                offset: at.offset,
                index: at.index,
                window: origin?.w ?? null,
                block: origin?.block ?? null,
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
            // A bound state is written from outside while the canvas listens
            // (#824) — and may have been while it did not.
            const stopUi = options.subscribeUi?.(() => batch(() => syncBound()));
            batch(() => syncBound());
            return () => {
                connected = false;
                stopUi?.();
                paging.disconnect();
                seek.disconnect();
            };
        },
    };
}

export type { PlanPagingSnapshot } from "./paging.js";
export type { PlanSeekSnapshot } from "./seek.js";
