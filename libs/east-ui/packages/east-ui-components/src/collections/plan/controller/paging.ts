/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The paged canvas's driver (#577), framework-free (#815) — the loop between
 * where the viewport is and which windows are resident, as plain state.
 *
 * It owns two pieces of state and the reads that feed them:
 *
 * - the {@link WindowLedger}, the scroll geometry in source ELEMENTS, which
 *   remembers every window it has ever measured so eviction moves nothing;
 * - the {@link Residency}, one contiguous run of whole windows, which follows
 *   the viewport a window at a time and rebases on a far jump.
 *
 * ```
 * viewport ──▶ residency.advance ──▶ readWindows ──▶ ledger.observeWindow
 *     ▲                                                      │
 *     └──────────── the renderer's range signal ◀────────────┘
 * ```
 *
 * # One settle, one notification
 *
 * Every input — a source, a viewport report, a jump, a Retry, a window landing
 * (its tracked channel firing) — runs ONE settle: read the demanded windows,
 * teach the ledger what landed, advance the demand, and read again while the
 * demand moved, until it holds still. Only then is the snapshot published, and
 * only when it differs. The React hook this replaces reached the same place
 * through four effects that set each other's state, one render pass per step
 * (#815).
 *
 * # A band report carries pixels
 *
 * A head/tail band is a single body item spanning every unloaded window on that
 * side, so "over the band" alone can only name the window adjacent to the run
 * — which walks the gap one fetch per landing. The report therefore carries how
 * many PIXELS into the band the viewport center sits (#612), measured from the
 * band's own top, which the ledger places exactly (the band was sized FROM the
 * ledger): the window under the scrollbar thumb resolves through
 * {@link elementAtOffset}, and a far drag rebases instead of walking.
 *
 * # Demand is idle-gated
 *
 * Nothing is fetched or evicted while the user is mid-gesture. The extent is
 * therefore constant for the whole of a drag, so the thumb cannot move under
 * the cursor.
 *
 * # A jump owns the viewport (#812)
 *
 * A key search REBASES the run on its target window, but the canvas can only
 * scroll to the target once its row is on screen. Until then every viewport
 * report is taken from where the canvas still is, and honouring one would
 * rebase the run back and undo the jump. So while the target window is pinned,
 * reports move nothing. The pin drops once the window SETTLES (it lands, or its
 * read fails) AND the canvas has committed a snapshot that holds it
 * ({@link PagingDriver.committed}) — by then the canvas has scrolled to the
 * target, and the reports it made while the landing was still rendering, from
 * the old position, have been ignored.
 *
 * # A failure belongs to its window (#811)
 *
 * A window whose read throws becomes a {@link PlanWindowFailure} — one error
 * band at its ledger slot, with a Retry — while every other window keeps
 * landing. A `total()` that throws is the SOURCE's failure and surfaces as
 * `sourceError`; neither ever replaces the canvas.
 *
 * # A revision change keeps the rows (#821)
 *
 * The rows cached for a source belong to its `revision()` — the snapshot its
 * windows are served from. When the revision moves (the dataset was written, a
 * `refresh` was asked for), the resident windows are read again at the new
 * one, and until each lands the rows it had stand in: the canvas never empties
 * between two snapshots of its data. The geometry stays too — the ledger's
 * measured heights and its total, until the new snapshot's total says
 * otherwise — so nothing on screen jumps. A total that moves WITH the revision
 * is the content changing; one that moves under a single revision breaks the
 * source's contract and is reported.
 *
 * @packageDocumentation
 */

import { equivalentFor } from "@elaraai/east";
import { Plan } from "@elaraai/east-ui/internal";
import { createTrackedRead } from "../../../reactive/tracked.js";
import type { PlanBand, PlanRowValue, PlanWindowFailure } from "../model.js";
import {
    createLedger, observeWindow, documentHeight, elementAtOffset, offsetOfWindow, elementsIn, slotHeight,
    type WindowLedger,
} from "../window-ledger.js";
import {
    NO_RESIDENCY, DEFAULT_RESIDENCY, advance, isEmpty, residentWindows, pin, unpinAll,
    type Residency, type ResidencyOptions,
} from "../window-residency.js";
import {
    readWindows, mergeWindows, originOf, pruneCache,
    type WindowCache, type WindowFailures, type WindowRows,
} from "../window-reader.js";
import { maxOf, minOf } from "../reductions.js";
import {
    PLAN_PAGE_SIZE, FAILED_BAND_MIN_PX,
    type PlanPagedSourceValue, type PlanViewport,
} from "../use-plan-paging.js";

/** Whether two paged sources derive the same rows: the same id AND equivalent
 *  functions — `page` wraps the series pipeline, so its captures are what the
 *  rows are derived WITH (#809). */
const pagedSourceEquivalent = equivalentFor(Plan.Types.Root.fields.rows.cases.paged);

/** Settle steps before giving up — the demand moves one window per step, so a
 *  healthy settle takes a handful; only a source whose `total()` keeps moving
 *  under one id could spin, and it is stopped and reported. */
const MAX_SETTLE_STEPS = 256;

/** What the canvas renders from the driver — replaced whole, and only when
 *  something in it changed. */
export interface PlanPagingSnapshot {
    /** Which publish this is — they count up, so the canvas can say which one
     *  it committed. */
    seq: number;
    /** The resident rows, merged by key, in canonical key order. */
    rows: readonly PlanRowValue[];
    /** Which window each row came from. */
    origin: ReadonlyMap<string, number>;
    /** The unloaded run above the resident one, if any. */
    head: PlanBand | undefined;
    /** The unloaded run below the resident one, if any. */
    tail: PlanBand | undefined;
    /** The source's element count, once known. */
    total: number | undefined;
    /** What has actually LANDED: the element span it covers, and how many
     *  elements that is. The span and the count differ while a window inside
     *  the run is still in flight — reporting the demanded interval would claim
     *  elements are loaded that are still on the wire. */
    resident: { from: number; to: number; elements: number } | undefined;
    /** Whether a requested window is still in flight. */
    loading: boolean;
    /** The resident windows whose read failed, ascending (#811). */
    failures: readonly PlanWindowFailure[];
    /** Why the SOURCE could not be read — its `total()` threw. Chrome, never a
     *  canvas replacement (#811). */
    sourceError: string | undefined;
    /** The source's revision — the snapshot of its data these rows are read
     *  from — once it names one (#821). */
    revision: string | undefined;
}

/** No failed windows — one shared list, so an unfailed canvas's memos hold. */
const NO_FAILURES: readonly PlanWindowFailure[] = [];
const NO_ROWS: readonly PlanRowValue[] = [];
const NO_ORIGIN: ReadonlyMap<string, number> = new Map();

/** The snapshot of a driver with no source (an inline canvas). */
export const IDLE_PAGING: PlanPagingSnapshot = {
    seq: 0, rows: NO_ROWS, origin: NO_ORIGIN, head: undefined, tail: undefined,
    total: undefined, resident: undefined, loading: false,
    failures: NO_FAILURES, sourceError: undefined, revision: undefined,
};

/** Options for {@link createPagingDriver}. */
export interface PagingDriverOptions {
    /**
     * The exact pixel height of a window's rows AT REST. Exact rather than
     * measured because the canvas is fixed-height by kind — `rowHeight()` IS
     * the layout, so the ledger is fed from the model with no DOM round-trip.
     */
    heightOf: (rows: readonly PlanRowValue[]) => number;
    /** Residency policy (defaults to {@link DEFAULT_RESIDENCY}). */
    policy?: ResidencyOptions | undefined;
    /** Called once per settle that changed the snapshot. */
    onChange: () => void;
}

/** The driver's handle. */
export interface PagingDriver {
    /** The current snapshot — the same object until something changes. */
    getSnapshot(): PlanPagingSnapshot;
    /** Drive a (new) source; `undefined` idles the driver (an inline canvas). */
    setSource(source: PlanPagedSourceValue | undefined): void;
    /** Where the viewport is. Ignored while a jump is pending — the jump owns
     *  the viewport until its window settles (#812). */
    reportViewport(at: PlanViewport, scrolling: boolean): void;
    /** Jump to a source element (a seek result): pin its window and move the
     *  demand there — the run extends to a near target and rebases on a far
     *  one (the step policy's `rebaseGap`), so the windows in between a far
     *  jump are never fetched. */
    jumpToElement(element: number): void;
    /** Open at a source element — where a remounted canvas left off (#813).
     *  Like a jump, but the run STARTS there however near the resident one
     *  is: nothing between is fetched for a place the user is not going to
     *  scroll through. */
    openAt(element: number): void;
    /** Drop any pending jump pin — a cleared search has no target (#614). */
    clearJump(): void;
    /**
     * The canvas committed `rendered`: it is on screen, and the canvas has
     * scrolled to a jump's target if it could. A jump whose window settled in
     * or before that snapshot hands the viewport back (#812).
     */
    committed(rendered: PlanPagingSnapshot): void;
    /** Ask a failed window again — drops its failure record and re-reads (#811). */
    retry(w: number): void;
    /** Settle again with the current inputs — after `heightOf`'s facts moved. */
    refresh(): void;
    /** Whether a jump is pending (its window pinned). */
    jumping(): boolean;
    /** Stop listening to the source's channels until the next settle — a
     *  `refresh` subscribes afresh. State is kept. */
    disconnect(): void;
}

/** One line naming why a source read failed. */
function readFailure(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** What one read of the demanded windows returned. */
interface ReadOutcome {
    /** The source's own `total()` — never the ledger's stand-in. */
    total: number | undefined;
    resident: { w: number; rows: WindowRows }[];
    loading: boolean;
    failed: { w: number; error: string }[];
    sourceError: string | undefined;
    /** The revision the windows were read at. */
    revision: string | undefined;
}

const NOTHING_READ: ReadOutcome = {
    total: undefined, resident: [], loading: false, failed: [], sourceError: undefined, revision: undefined,
};

/** Whether two window lists name the same windows with the same row maps. */
function sameWindows(a: readonly { w: number; rows: WindowRows }[], b: readonly { w: number; rows: WindowRows }[]): boolean {
    return a.length === b.length && a.every((x, i) => x.w === b[i]!.w && x.rows === b[i]!.rows);
}

function sameBand(a: PlanBand | undefined, b: PlanBand | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return a.at === b.at && a.from === b.from && a.to === b.to && a.px === b.px;
}

function sameFailures(a: readonly PlanWindowFailure[], b: readonly PlanWindowFailure[]): boolean {
    return a.length === b.length && a.every((f, i) => {
        const g = b[i]!;
        return f.w === g.w && f.from === g.from && f.to === g.to && f.px === g.px && f.error === g.error;
    });
}

function sameResident(a: PlanPagingSnapshot["resident"], b: PlanPagingSnapshot["resident"]): boolean {
    if (a === undefined || b === undefined) return a === b;
    return a.from === b.from && a.to === b.to && a.elements === b.elements;
}

/**
 * Create a paging driver.
 *
 * @param options - See {@link PagingDriverOptions}
 * @returns The driver
 */
export function createPagingDriver(options: PagingDriverOptions): PagingDriver {
    const policy = options.policy ?? DEFAULT_RESIDENCY;

    let source: PlanPagedSourceValue | undefined;
    // Read-once cache of DERIVED rows, keyed by the source that derived them.
    // The id alone cannot key it: the derived `page` wraps the series
    // pipeline, and a series whose closures changed derives different rows
    // from the same windows under the same id (#809). So the cache belongs to
    // the source that filled it and is dropped when the next one is not
    // equivalent — the resident windows re-read (the runtime still holds their
    // raw pages), while the ledger keeps its measured heights, so nothing
    // jumps. The failure record (#811) belongs to the same source.
    let filledBy: PlanPagedSourceValue | undefined;
    // The revision `cache` holds (#821), and the previous revision's windows,
    // served for a window until this revision's copy lands.
    let revision: string | undefined;
    let stale: WindowCache | undefined;
    let cache: WindowCache = new Map();
    let failures: WindowFailures = new Map();
    let ledger: WindowLedger = createLedger(0, PLAN_PAGE_SIZE);
    // The revision the ledger's total was learned (or last confirmed) under.
    let ledgerRevision: string | undefined;
    let residency: Residency = NO_RESIDENCY;
    let viewportWindow = 0;
    let isScrolling = false;
    let last: ReadOutcome = NOTHING_READ;
    let snapshot: PlanPagingSnapshot = IDLE_PAGING;
    let merged: { windows: { w: number; rows: WindowRows }[]; rows: readonly PlanRowValue[]; origin: ReadonlyMap<string, number> } =
        { windows: [], rows: NO_ROWS, origin: NO_ORIGIN };
    let settling = false;
    let pending = false;
    let spinWarned = false;
    // The last publish's number, and the jump's progress: its pinned window
    // has settled, in the publish numbered `settledSeq` (the canvas has not
    // necessarily shown it yet).
    let published = 0;
    let pinsSettled = false;
    let settledSeq: number | undefined;

    // A landing fires the channel the in-flight window's read registered.
    const tracked = createTrackedRead(() => settle());

    /** Start caching `next` revision's windows, keeping what the current
     *  cache holds as the stand-in until they land. A cache that holds
     *  nothing (a revision the source was still discovering) leaves the
     *  stand-in the last snapshot that had rows. */
    function rotate(next: string | undefined): void {
        if (cache.size > 0) stale = cache;
        cache = new Map();
        failures = new Map();
        revision = next;
    }

    function readOnce(src: PlanPagedSourceValue): ReadOutcome {
        if (filledBy === undefined || !pagedSourceEquivalent(filledBy, src)) {
            filledBy = src;
            cache = new Map();
            failures = new Map();
            stale = undefined;
            revision = undefined;
        }
        const wanted = residentWindows(residency);
        const out = tracked.run((): ReadOutcome => {
            // The snapshot first: every window below is read at it, and its
            // channel re-fires this read when it moves. A source that cannot
            // say which snapshot it serves has failed as a whole (#811) — its
            // windows then say so each, where their rows would be.
            let current = revision;
            let sourceError: string | undefined;
            try {
                const r = src.revision();
                current = r.type === "some" ? r.value : undefined;
            } catch (err) {
                console.error("[Plan] paged source revision failed:", err);
                sourceError = readFailure(err);
            }
            if (current !== revision) rotate(current);
            let total: number | undefined;
            try {
                const t = src.total();
                if (t.type === "some") total = Number(t.value);
            } catch (err) {
                console.error("[Plan] paged source total failed:", err);
                sourceError ??= readFailure(err);
            }
            const result = readWindows(src, wanted, cache, PLAN_PAGE_SIZE, failures, stale);
            // Every demanded window reads at the new revision now: the old
            // snapshot has nothing left to stand in for.
            if (!result.stale) stale = undefined;
            return {
                total, resident: result.resident, loading: result.loading, failed: result.failed, sourceError,
                revision: current,
            };
        });
        // `readWindows` catches every window's own failure, so a run that still
        // threw is the source's failure too — chrome, like a throwing `total()`.
        return out.ok ? out.value : { ...NOTHING_READ, sourceError: readFailure(out.error), revision };
    }

    /** Apply one read: returns whether the DEMAND moved (another read is due). */
    function apply(out: ReadOutcome): boolean {
        let moved = false;
        // ── The source's size defines the geometry ────────────────────────
        if (out.total !== undefined && out.total !== ledger.total) {
            // Same id and revision ⇒ same rows is the source contract, so a
            // total that MOVES under one revision has violated it. The geometry
            // rebuilds either way — and the read-once cache must go with it, or
            // the canvas silently serves the OLD rows against the new geometry
            // (#614). Loud, because the author's derived source is what needs
            // fixing (sign the id). A total that moved WITH the revision is the
            // content changing (#821): the new snapshot's rows are what the
            // cache holds, and the viewport keeps its window.
            if (ledger.total > 0 && ledgerRevision === out.revision) {
                console.warn(`[Plan] paged source ${source !== undefined ? `"${source.id}" ` : ""}changed total() ${ledger.total} → ${out.total} under one id and revision — same id and revision must serve same rows; dropping cached windows.`);
                cache = new Map();
                stale = undefined;
                failures = new Map();
            }
            ledger = createLedger(out.total, PLAN_PAGE_SIZE);
            ledgerRevision = out.revision;
            residency = NO_RESIDENCY;
            return true;
        }
        // The same total at this revision: the ledger's geometry holds for it.
        if (out.total !== undefined) ledgerRevision = out.revision;
        // ── Landed windows teach the ledger ───────────────────────────────
        for (const { w, rows } of out.resident) {
            ledger = observeWindow(ledger, w, { px: options.heightOf([...rows.values()]), rows: rows.size });
        }
        // ── A pin protects the jump target until it SETTLES ───────────────
        // It lands, or its read fails (#811) — and the canvas commits that
        // (`committed`), when the pin drops. Left in place it would keep one
        // window trim-exempt for the session (#614) and, since a pending jump
        // owns the viewport (#812), a target that failed would freeze the
        // demand where it was.
        if (residency.pins.size > 0 && !pinsSettled) {
            const settled = new Set(out.resident.map((r) => r.w));
            for (const f of out.failed) settled.add(f.w);
            if ([...residency.pins].every((w) => settled.has(w))) pinsSettled = true;
        }
        // ── Demand follows the viewport, at idle only ─────────────────────
        if (ledger.windows === 0) {
            // Bootstrap. `total()` answers `none` until some window has landed
            // (it is taught BY a landing), and the geometry needs the total — so
            // waiting for one before demanding anything deadlocks on first
            // paint. Window 0 is demanded regardless, and the total arrives with
            // it. A source that never reports a total still works: it simply
            // has no bands and no extent beyond what is resident.
            if (isEmpty(residency)) {
                residency = { ...residency, lo: 0, hi: 0 };
                moved = true;
            }
        } else if (!isScrolling) {
            const next = advance(residency, ledger, viewportWindow, policy);
            if (next !== residency) {
                residency = next;
                moved = true;
                // Whatever left the run leaves the cache with it — this is the
                // half of eviction that actually frees memory. A failure record
                // leaves too: a window demanded again later is asked afresh.
                const keep = new Set(residentWindows(next));
                pruneCache(cache, keep);
                pruneCache(failures, keep);
                if (stale !== undefined) pruneCache(stale, keep);
            }
        }
        return moved;
    }

    /** The snapshot for the last read — reusing every part that did not move. */
    function publish(): void {
        const prev = snapshot;
        if (!sameWindows(merged.windows, last.resident)) {
            merged = { windows: last.resident, rows: mergeWindows(last.resident), origin: originOf(last.resident) };
        }
        // Between two revisions the source knows no total until the new one's
        // first window lands; the geometry stands meanwhile, so the bands and
        // the scroll extent do not collapse under the reader (#821).
        const total = last.total ?? (stale !== undefined && ledger.total > 0 ? ledger.total : undefined);
        let head: PlanBand | undefined;
        let tail: PlanBand | undefined;
        if (!isEmpty(residency) && ledger.windows > 0 && total !== undefined) {
            head = residency.lo > 0
                ? { at: "head", from: 0, to: residency.lo * PLAN_PAGE_SIZE - 1, px: offsetOfWindow(ledger, residency.lo) }
                : undefined;
            tail = residency.hi < ledger.windows - 1
                ? {
                    at: "tail",
                    from: (residency.hi + 1) * PLAN_PAGE_SIZE,
                    to: total - 1,
                    px: documentHeight(ledger) - offsetOfWindow(ledger, residency.hi + 1),
                }
                : undefined;
        }
        // Each failed window as its band (#811): at its ledger slot, floored so
        // the reason and the Retry stay legible — a short last window, or a
        // window 0 that failed before any landing taught the ledger a geometry.
        const failed = last.failed.length === 0 ? NO_FAILURES : last.failed.map(({ w, error }) => {
            const known = total !== undefined && w < ledger.windows;
            const from = w * PLAN_PAGE_SIZE;
            const to = (known ? Math.min(total, (w + 1) * PLAN_PAGE_SIZE) : (w + 1) * PLAN_PAGE_SIZE) - 1;
            return { w, from, to, px: Math.max(FAILED_BAND_MIN_PX, known ? slotHeight(ledger, w) : 0), error };
        });
        let resident: PlanPagingSnapshot["resident"];
        const landedWindows = last.resident.map((r) => r.w);
        if (landedWindows.length > 0 && total !== undefined) {
            // The SPAN of what landed — not of what was demanded.
            const lo = minOf(landedWindows);
            const hi = maxOf(landedWindows);
            let elements = 0;
            for (const w of landedWindows) elements += elementsIn({ pageSize: PLAN_PAGE_SIZE, total }, w);
            resident = { from: lo * PLAN_PAGE_SIZE, to: Math.min(total, (hi + 1) * PLAN_PAGE_SIZE), elements };
        }
        const next: PlanPagingSnapshot = {
            seq: prev.seq,
            rows: merged.rows,
            origin: merged.origin,
            head: sameBand(prev.head, head) ? prev.head : head,
            tail: sameBand(prev.tail, tail) ? prev.tail : tail,
            total,
            resident: sameResident(prev.resident, resident) ? prev.resident : resident,
            loading: last.loading,
            failures: sameFailures(prev.failures, failed) ? prev.failures : failed,
            sourceError: last.sourceError,
            revision: last.revision,
        };
        const changed = next.rows !== prev.rows || next.origin !== prev.origin || next.head !== prev.head
            || next.tail !== prev.tail || next.total !== prev.total || next.resident !== prev.resident
            || next.loading !== prev.loading || next.failures !== prev.failures || next.sourceError !== prev.sourceError
            || next.revision !== prev.revision;
        if (!changed) return;
        published += 1;
        snapshot = { ...next, seq: published };
        options.onChange();
    }

    /** The window an element sits in. A target past the end (an anchor saved
     *  against a longer source) is the last window — pinned beyond it, a jump
     *  would never settle. */
    function windowOf(element: number): number {
        const w = Math.floor(Math.max(0, element) / PLAN_PAGE_SIZE);
        return ledger.windows > 0 ? Math.min(w, ledger.windows - 1) : w;
    }

    /** Move the demand to window `w` and pin it until it lands and is shown;
     *  `rebase` starts the run there however near the old one was. */
    function jump(w: number, rebase: boolean): void {
        viewportWindow = w;
        isScrolling = false;
        if (rebase && !isEmpty(residency) && (w < residency.lo || w > residency.hi)) {
            residency = { ...residency, lo: w, hi: w };
        }
        // Pin it so no trim can drop the destination before it lands, and
        // clear any previous pin — one jump at a time.
        residency = pin(unpinAll(residency), w);
        pinsSettled = false;
        settledSeq = undefined;
        settle();
    }

    /** Read, apply, and read again while the demand moves — then publish once. */
    function settle(): void {
        // A landing can fire while a settle is reading (a synchronous source,
        // or a notification during `total()`): note it and loop once more
        // rather than re-entering.
        if (settling) { pending = true; return; }
        const src = source;
        if (src === undefined) return;
        settling = true;
        try {
            let steps = 0;
            do {
                pending = false;
                last = readOnce(src);
                const moved = apply(last);
                if (!moved && !pending) break;
                steps += 1;
            } while (steps < MAX_SETTLE_STEPS);
            if (steps >= MAX_SETTLE_STEPS && !spinWarned) {
                spinWarned = true;
                console.warn(`[Plan] paged source "${src.id}" did not settle — its total() keeps moving under one id`);
            }
        } finally {
            settling = false;
        }
        publish();
        // The snapshot a settled jump target is first on screen in.
        if (pinsSettled && settledSeq === undefined) settledSeq = snapshot.seq;
    }

    return {
        getSnapshot: () => snapshot,
        setSource(next) {
            if (next === source) return;
            source = next;
            if (next === undefined) {
                // Idle: the channels go quiet and the canvas renders inline rows.
                tracked.release();
                last = NOTHING_READ;
                if (snapshot !== IDLE_PAGING) {
                    snapshot = IDLE_PAGING;
                    merged = { windows: [], rows: NO_ROWS, origin: NO_ORIGIN };
                    options.onChange();
                }
                return;
            }
            settle();
        },
        reportViewport(at, scrolling) {
            isScrolling = scrolling;
            // A jump owns the viewport until its window settles (#812). The
            // canvas cannot scroll to a row that has not landed, so every report
            // until then is taken from where the canvas still IS — and demanding
            // that window would rebase the run back and undo the jump.
            if (residency.pins.size > 0) return;
            if (at.kind === "window") {
                viewportWindow = at.w;
            } else if (at.kind === "band") {
                if (at.px !== undefined && ledger.windows > 0) {
                    // The band's top is a ledger offset the band was SIZED from
                    // (a head band starts the document; a tail band starts where
                    // the run ends), so the offset maps through `elementAtOffset`
                    // whatever the resident rows in between rendered at, and a
                    // far drag rebases (#612).
                    const bandTop = at.at === "head" ? 0 : offsetOfWindow(ledger, residency.hi + 1);
                    viewportWindow = Math.floor(elementAtOffset(ledger, bandTop + Math.max(0, at.px)) / PLAN_PAGE_SIZE);
                } else {
                    // Without one, the window just outside the run on that side.
                    viewportWindow = at.at === "head" ? Math.max(0, residency.lo - 1) : residency.hi + 1;
                }
            } else {
                viewportWindow = snapshot.origin.get(at.key) ?? viewportWindow;
            }
            settle();
        },
        jumpToElement(element) {
            jump(windowOf(element), false);
        },
        openAt(element) {
            jump(windowOf(element), true);
        },
        clearJump() {
            if (residency.pins.size === 0) return;
            residency = unpinAll(residency);
            pinsSettled = false;
            settledSeq = undefined;
            settle();
        },
        committed(rendered) {
            // Before the canvas has put the landed target on screen, what it
            // reports is where it WAS — the jump keeps the viewport.
            if (settledSeq === undefined || rendered.seq < settledSeq) return;
            residency = unpinAll(residency);
            pinsSettled = false;
            settledSeq = undefined;
            settle();
        },
        retry(w) {
            failures.delete(w);
            settle();
        },
        refresh() {
            settle();
        },
        jumping: () => residency.pins.size > 0,
        disconnect() {
            tracked.release();
        },
    };
}
