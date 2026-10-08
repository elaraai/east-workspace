/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The paged canvas's driver (#577), framework-free (#815) — the loop between
 * where the viewport is and which windows are resident, as plain state.
 *
 * # Blocks page on their own (#823)
 *
 * A canvas is its series list's blocks, one after another. Each data series is
 * a PAGED block — its entries' rows, each entry whole — and a section's header
 * or a list of hand-built rows is a FIXED block, the same in every window and
 * drawn once. One read of a window serves every block (the derived source
 * applies the whole series list to it), so windows are fetched and cached
 * ONCE, for all of them. What each paged block owns is its geometry:
 *
 * - a {@link WindowLedger}, the scroll geometry of its rows in source
 *   ELEMENTS, which remembers every window it has ever measured;
 * - a {@link Residency}, one contiguous run of whole windows, which follows
 *   the viewport a window at a time and rebases on a far jump;
 * - the SKELETON of every window it has seen ({@link WindowSkeleton}) — what
 *   its rows' heights depend on, and nothing else — so the ledger is measured
 *   under the CURRENT collapse, grain and charts, and an evicted window's band
 *   follows them exactly ({@link PagingDriver.remeasure}).
 *
 * The viewport is in one block at a time: a report names a row, a band or a
 * failed window, which name their block, and only that block's demand moves.
 * A jump moves every block — the first one that shows the sought entry is
 * where the canvas scrolls.
 *
 * ```
 * viewport ──▶ block's residency.advance ──▶ readWindows ──▶ each block's ledger
 *     ▲                                                              │
 *     └──────────────────── the renderer's range signal ◀────────────┘
 * ```
 *
 * # A window loading beside the run never moves it (#876)
 *
 * What a block draws is its RUN: the stretch of its resident windows that are
 * in — landed, or failed (#811) — around the one nearest the element the
 * viewport is centred on. A window still in flight ends the stretch, since its
 * rows are not there to hold its slot: it, and every window past it, stay the
 * band's until it lands, and landing it takes exactly the band's slot. So a
 * window loading above or below the rows on screen never takes them off it,
 * even when a window beyond it lands first, and a rebased run whose windows
 * are all on the wire is still the whole of its block — its bands meet where
 * it will land. The bands follow the run, not the residency, and so does
 * where a band report measures from. The Sheet's driver does the same.
 *
 * # One settle, one notification
 *
 * Every input — a source, a viewport report, a jump, a Retry, a window landing
 * (its tracked channel firing) — runs ONE settle: read the demanded windows,
 * teach the ledgers what landed, advance the demand, and read again while the
 * demand moved, until it holds still. Only then is the snapshot published, and
 * only when it differs (#815).
 *
 * # A band report carries pixels
 *
 * A head/tail band is a single body item spanning every unloaded window on that
 * side, so "over the band" alone can only name the window adjacent to the run
 * — which walks the gap one fetch per landing. The report therefore carries how
 * many PIXELS into the band the viewport center sits (#612), measured from the
 * band's own top, which the block's ledger places exactly (the band was sized
 * FROM the ledger): the window under the scrollbar thumb resolves through
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
 * A key search REBASES every block on its target window, but the canvas can
 * only scroll to the target once its row is on screen. Until then every
 * viewport report is taken from where the canvas still is, and honouring one
 * would rebase a run back and undo the jump. So while the target window is
 * pinned, reports move nothing. The pin drops once the window SETTLES (it
 * lands, or its read fails) AND the canvas has committed a snapshot that holds
 * it ({@link PagingDriver.committed}).
 *
 * # A failure belongs to its window (#811)
 *
 * A window whose read throws is one error band at its ledger slot in each
 * block that holds it, with a Retry, while every other window keeps landing.
 * A `total()` that throws is the SOURCE's failure and surfaces as
 * `sourceError`; neither ever replaces the canvas.
 *
 * # A revision change keeps the rows (#821)
 *
 * The rows cached for a PINNED source belong to its `revision()`. When the
 * revision moves, the resident windows are read again at the new one, and
 * until each lands the rows it had stand in: the canvas never empties between
 * two snapshots of its data. The geometry stays too — the ledgers' measured
 * heights and their total, until the new snapshot's total says otherwise. A
 * fixed block's rows are the revision's as well: the first window read at a
 * new revision brings them, and the old ones stand in until it lands (#1192 —
 * a Plan's event rows ride its source's windows as fixed blocks, and move with
 * every revision). A `paged` source names no snapshot: its rows are its id's
 * for as long as the canvas holds it. A source the canvas composes over another
 * names the snapshot of its data apart from its revision (#1199), and the
 * snapshot is published beside the revision: a new revision over the same
 * data reads the windows again and is no new snapshot, which is what a key
 * search's answer indexes.
 *
 * @packageDocumentation
 */

import { equivalentFor } from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";
import {
    createTrackedRead, createLedger, observeWindow, documentHeight, elementAtOffset, offsetOfWindow, elementsIn,
    slotHeight, type WindowLedger, NO_RESIDENCY, DEFAULT_RESIDENCY, advance, isEmpty, residentWindows, pin, unpinAll,
    type Residency, type ResidencyOptions,
} from "@elaraai/east-ui-components/internal";
import { keyAcrossBlocks, type PlanBand, type PlanRowValue, type PlanWindowFailure, type WindowSkeleton } from "../model.js";
import type { RowKey } from "../plan-state.js";
import {
    readWindows, pruneCache,
    type BlockShape, type WindowCache, type WindowFailures, type WindowRead, type WindowRows,
} from "../window-reader.js";
import { appendAll, maxOf, minOf } from "../reductions.js";
import {
    PLAN_PAGE_SIZE, FAILED_BAND_MIN_PX,
    type PlanPagedSourceValue, type PlanViewport,
} from "../use-plan-paging.js";

/** Whether two paged sources derive the same rows: the same id AND equivalent
 *  functions — `page` wraps the series pipeline, so its captures are what the
 *  rows are derived WITH (#809). */
const pagedSourceEquivalent = equivalentFor(Plan.Types.Root.fields.rows.cases.paged);

/** Settle steps before giving up — each block's demand moves one window per
 *  step, so a healthy settle takes a handful per block; only a source whose
 *  `total()` keeps moving under one id could spin, and it is stopped and
 *  reported. */
const MAX_SETTLE_STEPS = 256;

/** Where a resident row came from — its block and its window (#823). */
export interface PlanRowOrigin {
    block: number;
    w: number;
}

/** A landed element span — where it starts and ends, and how many elements it holds. */
export interface PlanResidentSpan {
    /** The first landed element. */
    from: number;
    /** The element after the last landed one (exclusive). */
    to: number;
    /** How many elements have landed — fewer than the span when a window
     *  inside it failed (#811). (A window still in flight is never inside
     *  it: it ends the run, #876.) */
    elements: number;
}

/** One block of a paged canvas — what it holds and what stands for the rest (#823). */
export interface PlanPagedBlock {
    /** Its place in the canvas's layout. */
    index: number;
    /** Whether no entry produces its rows (a section's header, hand-built
     *  rows): drawn once, never paged. */
    fixed: boolean;
    /** The key of the row its top rows nest under — the header of the section
     *  it sits in — if any. Its bands hide with that row's subtree. */
    parent: RowKey | undefined;
    /** Every element above its run (#876) — not resident, still loading, or
     *  past a window still loading — if any. */
    head: PlanBand | undefined;
    /** Every element below its run, likewise, if any. */
    tail: PlanBand | undefined;
    /** Its run's windows whose read failed, ascending (#811). */
    failures: readonly PlanWindowFailure[];
    /** What has LANDED of its run. */
    resident: PlanResidentSpan | undefined;
}

/** What the canvas renders from the driver — replaced whole, and only when
 *  something in it changed. */
export interface PlanPagingSnapshot {
    /** Which publish this is — they count up, so the canvas can say which one
     *  it committed. */
    seq: number;
    /** The resident rows — block after block, each paged block's windows
     *  concatenated in window order (#823). */
    rows: readonly PlanRowValue[];
    /** Which block and window each paged row came from. */
    origin: ReadonlyMap<string, PlanRowOrigin>;
    /** The canvas's blocks, in layout order — empty on an inline canvas. */
    blocks: readonly PlanPagedBlock[];
    /** The source's element count, once known. */
    total: number | undefined;
    /** What has landed of the block the viewport is in — of its run (#876),
     *  never the demanded interval, which would claim elements are loaded
     *  that are still on the wire. The span and the count differ when a
     *  window inside the run failed (#811). */
    resident: PlanResidentSpan | undefined;
    /** Whether every paged block holds every element — the source's rows are
     *  all on the canvas, so no count on it is partial. */
    complete: boolean;
    /** Whether a requested window is still in flight. */
    loading: boolean;
    /** The resident windows whose read failed, ascending — one each, whatever
     *  blocks hold it (#811). */
    failures: readonly PlanWindowFailure[];
    /** Why the SOURCE could not be read — its `total()` threw. Chrome, never a
     *  canvas replacement (#811). */
    sourceError: string | undefined;
    /** The source's revision — the snapshot of its data these rows are read
     *  from — once it names one (#821). */
    revision: string | undefined;
    /** The snapshot of the data itself (#1199): the source's own `snapshot()`,
     *  or its revision when it names none. A revision that moved over the same
     *  data — windows read again, new rows composed into them — leaves it. */
    dataSnapshot: string | undefined;
}

/** No failed windows — one shared list, so an unfailed canvas's memos hold. */
const NO_FAILURES: readonly PlanWindowFailure[] = [];
/** A block that draws no window (#876). */
const NO_RUN: Run = { from: 0, to: -1 };
const NO_ROWS: readonly PlanRowValue[] = [];
const NO_ORIGIN: ReadonlyMap<string, PlanRowOrigin> = new Map();
const NO_BLOCKS: readonly PlanPagedBlock[] = [];

/** The snapshot of a driver with no source (an inline canvas). */
export const IDLE_PAGING: PlanPagingSnapshot = {
    seq: 0, rows: NO_ROWS, origin: NO_ORIGIN, blocks: NO_BLOCKS,
    total: undefined, resident: undefined, complete: true, loading: false,
    failures: NO_FAILURES, sourceError: undefined, revision: undefined, dataSnapshot: undefined,
};

/** Where a row the body does not hold sits (#823): in one of its block's
 *  bands, this many px below the band's top — the ledger offset of the window
 *  it was last seen in. */
export interface PlanRowPlace {
    block: number;
    at: "head" | "tail";
    px: number;
}

/** Options for {@link createPagingDriver}. */
export interface PagingDriverOptions {
    /** One block's rows from one landed window, as the heights need them — its
     *  skeleton, taken once per landing (#823). */
    skeletonOf: (rows: readonly PlanRowValue[]) => WindowSkeleton;
    /** A skeleton's height under the CURRENT UI state — the body's own height
     *  arithmetic, so a band is exactly as tall as the rows it stands for. */
    heightOf: (sk: WindowSkeleton) => number;
    /** A skeleton's height AT REST — declared collapse, no charts expanded, no
     *  focus: what the ledger seeds its slot rate from. */
    restHeightOf: (sk: WindowSkeleton) => number;
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
    /** Jump to a source element (a seek result): pin its window in every
     *  block and move the demand there — a run extends to a near target and
     *  rebases on a far one (the step policy's `rebaseGap`), so the windows in
     *  between a far jump are never fetched. */
    jumpToElement(element: number): void;
    /** Open at a source element — where a remounted canvas left off (#813).
     *  Like a jump, but the run STARTS there however near the resident one
     *  is: nothing between is fetched for a place the user is not going to
     *  scroll through. With a block, only that block opens there. */
    openAt(element: number, block?: number): void;
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
    /** Settle again with the current inputs. */
    refresh(): void;
    /** What the rows draw at changed (a collapse, the grain, a chart toggle,
     *  an expand focus, the density): measure every window each block has
     *  seen again, from its skeleton, and settle (#823). */
    remeasure(): void;
    /** What a skeleton is taken with changed (the axis kind, which decides
     *  which rows are diagnostics): resident windows take theirs again. */
    reskeleton(): void;
    /** Where a visited row the body does not hold sits — in which block's
     *  band, and how far down it (#823: a link into an evicted window, or
     *  into a landed one past a window still in flight, #876). `undefined`
     *  for a row never seen, or one whose window is in its block's run. */
    placeOf(key: RowKey): PlanRowPlace | undefined;
    /** Which block and window a row was last seen in, resident or evicted —
     *  what a request to bring it into view opens (#824). `undefined` for a
     *  row no window has shown. */
    seenAt(key: RowKey): PlanRowOrigin | undefined;
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
    /** The source's own `total()` — never the ledgers' stand-in. */
    total: number | undefined;
    resident: { w: number; read: WindowRead }[];
    /** The demanded windows still on the wire. */
    inFlight: readonly number[];
    failed: { w: number; error: string }[];
    sourceError: string | undefined;
    /** The revision the windows were read at. */
    revision: string | undefined;
    /** The snapshot of the data they were read from (#1199). */
    dataSnapshot: string | undefined;
}

const NOTHING_READ: ReadOutcome = {
    total: undefined, resident: [], inFlight: [], failed: [], sourceError: undefined, revision: undefined, dataSnapshot: undefined,
};

/** The windows a block draws (#876): `from` to `to`, inclusive; `to < from`
 *  when none of its resident windows is in. */
interface Run {
    from: number;
    to: number;
}

/** One paged block's geometry (#823). */
interface Lane {
    ledger: WindowLedger;
    residency: Residency;
    /** The window the viewport was last in, within this block. */
    viewportWindow: number;
    /** The element the viewport was last centred on, within this block — what
     *  its run is anchored nearest (#876). */
    viewportAt: number;
    /** The run the last settle drew (#876) — where its bands start and end. */
    run: Run;
    /** Every window this block has seen: which read its skeleton was taken
     *  from (a re-read at a new revision takes it again), the skeleton, its
     *  height at rest and how many rows it holds. Never the rows themselves —
     *  an evicted window's rows must be free to go. */
    skeletons: Map<number, { read: number; sk: WindowSkeleton; restPx: number; rows: number }>;
}

/** Which read a window's rows came from — a number per rows array, held
 *  weakly, so a skeleton can tell a re-read without keeping the rows alive. */
const readIds = new WeakMap<WindowRows, number>();
let nextReadId = 0;

function readIdOf(rows: WindowRows): number {
    let id = readIds.get(rows);
    if (id === undefined) {
        nextReadId += 1;
        id = nextReadId;
        readIds.set(rows, id);
    }
    return id;
}

/** One part of the assembled rows — a fixed block's rows, or one window of a paged block's. */
interface Piece {
    b: number;
    w: number | undefined;
    rows: WindowRows;
}

function samePieces(a: readonly Piece[], b: readonly Piece[]): boolean {
    return a.length === b.length && a.every((x, i) => x.b === b[i]!.b && x.w === b[i]!.w && x.rows === b[i]!.rows);
}

function sameShape(a: readonly BlockShape[], b: readonly BlockShape[]): boolean {
    return a.length === b.length && a.every((x, i) => x.fixed === b[i]!.fixed && x.parent === b[i]!.parent);
}

function sameLoading(a: PlanBand["loading"], b: PlanBand["loading"]): boolean {
    if (a === undefined || b === undefined) return a === b;
    return a.from === b.from && a.to === b.to;
}

function sameBand(a: PlanBand | undefined, b: PlanBand | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return a.block === b.block && a.at === b.at && a.from === b.from && a.to === b.to && a.px === b.px
        && sameLoading(a.loading, b.loading);
}

function sameFailures(a: readonly PlanWindowFailure[], b: readonly PlanWindowFailure[]): boolean {
    return a.length === b.length && a.every((f, i) => {
        const g = b[i]!;
        return f.block === g.block && f.w === g.w && f.from === g.from && f.to === g.to && f.px === g.px && f.error === g.error;
    });
}

function sameResident(a: PlanResidentSpan | undefined, b: PlanResidentSpan | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    return a.from === b.from && a.to === b.to && a.elements === b.elements;
}

function sameBlock(a: PlanPagedBlock, b: PlanPagedBlock): boolean {
    return a.index === b.index && a.fixed === b.fixed && a.parent === b.parent && a.head === b.head
        && a.tail === b.tail && a.failures === b.failures && a.resident === b.resident;
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
    // raw pages), while the ledgers keep their measured heights, so nothing
    // jumps. The failure record (#811) belongs to the same source.
    let filledBy: PlanPagedSourceValue | undefined;
    // The revision `cache` holds (#821), and the previous revision's windows,
    // served for a window until this revision's copy lands.
    let revision: string | undefined;
    // The snapshot of the data the last read was of (#1199), kept through a read that failed.
    let dataSnapshot: string | undefined;
    let stale: WindowCache | undefined;
    let cache: WindowCache = new Map();
    let failures: WindowFailures = new Map();
    // The source's element count as the ledgers know it, and the revision it
    // was learned (or last confirmed) under.
    let total = 0;
    let totalRevision: string | undefined;
    // The blocks' shape — from the first window to land (#823). Until then the
    // canvas is one paged block, whose demand reads that first window.
    let shape: readonly BlockShape[] | undefined;
    // Each fixed block's rows — every window of a revision serves them alike,
    // so the first that did is theirs — and the revision they were read at.
    let fixedRows = new Map<number, WindowRows>();
    let fixedAt: string | undefined;
    // Each paged block's geometry, by its place in the layout.
    let lanes = new Map<number, Lane>([[0, newLane()]]);
    // Where every row a block has seen sits: its block and window (#823).
    const located = new Map<RowKey, PlanRowOrigin>();
    // The block the viewport was last reported in — what the transport counts.
    let focusBlock = 0;
    let isScrolling = false;
    let last: ReadOutcome = NOTHING_READ;
    let snapshot: PlanPagingSnapshot = IDLE_PAGING;
    let assembled: { pieces: readonly Piece[]; rows: readonly PlanRowValue[]; origin: ReadonlyMap<string, PlanRowOrigin> } =
        { pieces: [], rows: NO_ROWS, origin: NO_ORIGIN };
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

    function newLane(from?: Lane): Lane {
        return {
            ledger: createLedger(total, PLAN_PAGE_SIZE),
            residency: from?.residency ?? NO_RESIDENCY,
            viewportWindow: from?.viewportWindow ?? 0,
            viewportAt: from?.viewportAt ?? 0,
            run: from?.run ?? NO_RUN,
            skeletons: new Map(),
        };
    }

    /** Every window that is IN after the last read — landed (or standing in
     *  from the previous revision, #821), or failed (#811). */
    function windowsIn(): Set<number> {
        const out = new Set<number>();
        for (const r of last.resident) out.add(r.w);
        for (const f of last.failed) out.add(f.w);
        return out;
    }

    /**
     * A block's run (#876): the stretch of its resident windows that are in,
     * around the one nearest the element the viewport is centred on — its own
     * window when that is in, else the nearer of the first in after it and
     * the last in before it. The run crosses a failed window, whose elements
     * are known (#811); a window still in flight ends it at either end.
     */
    function runOf(lane: Lane, isIn: ReadonlySet<number>): Run {
        const { lo, hi } = lane.residency;
        if (isEmpty(lane.residency)) return NO_RUN;
        const at = Math.min((hi + 1) * PLAN_PAGE_SIZE - 1, Math.max(lo * PLAN_PAGE_SIZE, lane.viewportAt));
        const own = Math.floor(at / PLAN_PAGE_SIZE);
        let anchor: number | undefined = isIn.has(own) ? own : undefined;
        if (anchor === undefined) {
            let after: number | undefined;
            for (let w = own + 1; w <= hi && after === undefined; w++) if (isIn.has(w)) after = w;
            let before: number | undefined;
            for (let w = own - 1; w >= lo && before === undefined; w--) if (isIn.has(w)) before = w;
            anchor = after === undefined || before === undefined
                ? after ?? before
                : after * PLAN_PAGE_SIZE - at <= at - ((before + 1) * PLAN_PAGE_SIZE - 1) ? after : before;
        }
        // Nothing of the residency is in: the bands meet where it will land.
        if (anchor === undefined) return { from: lo, to: lo - 1 };
        let from = anchor;
        while (from > lo && isIn.has(from - 1)) from--;
        let to = anchor;
        while (to < hi && isIn.has(to + 1)) to++;
        return { from, to };
    }

    /** Every window some block demands, ascending. */
    function wantedWindows(): number[] {
        const wanted = new Set<number>();
        for (const lane of lanes.values()) for (const w of residentWindows(lane.residency)) wanted.add(w);
        return [...wanted].sort((a, b) => a - b);
    }

    /** Every pinned window. */
    function pinnedWindows(): number[] {
        const out = new Set<number>();
        for (const lane of lanes.values()) for (const w of lane.residency.pins) out.add(w);
        return [...out];
    }

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
            // Its series may lay the blocks out otherwise, and its fixed rows
            // may differ: both come with its first window again.
            fixedRows = new Map();
            fixedAt = undefined;
        }
        const wanted = wantedWindows();
        const out = tracked.run((): ReadOutcome => {
            // The snapshot first: every window below is read at it, and its
            // channel re-fires this read when it moves. A source that cannot
            // say which snapshot it serves has failed as a whole (#811) — its
            // windows then say so each, where their rows would be. A `paged`
            // source names none.
            let current = revision;
            let sourceError: string | undefined;
            try {
                const r = src.revision?.();
                current = r?.type === "some" ? r.value : undefined;
            } catch (err) {
                console.error("[Plan] paged source revision failed:", err);
                sourceError = readFailure(err);
            }
            if (current !== revision) rotate(current);
            // The snapshot of the data, when the source names it apart from its revision (#1199).
            let data = current;
            if (src.snapshot !== undefined && sourceError === undefined) {
                try {
                    const own = src.snapshot();
                    data = own.type === "some" ? own.value : undefined;
                } catch (err) {
                    console.error("[Plan] paged source snapshot failed:", err);
                    sourceError = readFailure(err);
                }
            }
            if (sourceError === undefined) dataSnapshot = data;
            let t: number | undefined;
            try {
                const read = src.total();
                if (read.type === "some") t = Number(read.value);
            } catch (err) {
                console.error("[Plan] paged source total failed:", err);
                sourceError ??= readFailure(err);
            }
            const result = readWindows(src, wanted, cache, PLAN_PAGE_SIZE, failures, stale);
            // Every demanded window reads at the new revision now: the old
            // snapshot has nothing left to stand in for.
            if (!result.stale) stale = undefined;
            return {
                total: t, resident: result.resident, inFlight: result.inFlight, failed: result.failed, sourceError,
                revision: current, dataSnapshot,
            };
        });
        // `readWindows` catches every window's own failure, so a run that still
        // threw is the source's failure too — chrome, like a throwing `total()`.
        return out.ok ? out.value : { ...NOTHING_READ, sourceError: readFailure(out.error), revision, dataSnapshot };
    }

    /** Lay the canvas out by the blocks a window says it has (#823): each
     *  paged block keeps its geometry where it still is one, and a new one
     *  starts where the demand already is. */
    function adopt(next: readonly BlockShape[]): void {
        const template = lanes.values().next().value;
        const nextLanes = new Map<number, Lane>();
        next.forEach((s, b) => {
            if (s.fixed) return;
            nextLanes.set(b, lanes.get(b) ?? newLane(template));
        });
        lanes = nextLanes;
        shape = next;
        fixedRows = new Map();
        fixedAt = undefined;
        if (!lanes.has(focusBlock)) focusBlock = lanes.keys().next().value ?? 0;
    }

    /** Teach one block what one landed window of it draws at now. */
    function observe(b: number, lane: Lane, w: number, rows: WindowRows): void {
        const read = readIdOf(rows);
        let held = lane.skeletons.get(w);
        if (held === undefined || held.read !== read) {
            const sk = options.skeletonOf(rows);
            held = { read, sk, restPx: options.restHeightOf(sk), rows: rows.length };
            lane.skeletons.set(w, held);
            for (const key of sk.keys) located.set(key, { block: b, w });
        }
        lane.ledger = observeWindow(lane.ledger, w, { px: options.heightOf(held.sk), rows: held.rows, restPx: held.restPx });
    }

    /** Apply one read: returns whether the DEMAND moved (another read is due). */
    function apply(out: ReadOutcome): boolean {
        let moved = false;
        // ── The source's size defines the geometry ────────────────────────
        if (out.total !== undefined && out.total !== total) {
            // Same id and revision ⇒ same rows is the source contract, so a
            // total that MOVES under one revision has violated it. The geometry
            // rebuilds either way — and the read-once cache must go with it, or
            // the canvas silently serves the OLD rows against the new geometry
            // (#614). A total that moved WITH the revision is the content
            // changing (#821): the new snapshot's rows are what the cache
            // holds, and the viewport keeps its window.
            if (total > 0 && totalRevision === out.revision) {
                console.warn(`[Plan] paged source ${source !== undefined ? `"${source.id}" ` : ""}changed total() ${total} → ${out.total} under one id and revision — same id and revision must serve same rows; dropping cached windows.`);
                cache = new Map();
                stale = undefined;
                failures = new Map();
            }
            total = out.total;
            totalRevision = out.revision;
            for (const lane of lanes.values()) {
                lane.ledger = createLedger(total, PLAN_PAGE_SIZE);
                lane.residency = NO_RESIDENCY;
                lane.skeletons.clear();
            }
            located.clear();
            return true;
        }
        // The same total at this revision: the geometry holds for it.
        if (out.total !== undefined) totalRevision = out.revision;
        // ── The blocks come with the first window to land (#823) ──────────
        const first = out.resident[0];
        if (first !== undefined && (shape === undefined || !sameShape(shape, first.read.shape))) {
            adopt(first.read.shape);
            moved = true;
        }
        // ── A fixed block's rows are its revision's (#821, #1192) ─────────
        // A window read at this revision (the cache holds only this one's)
        // brings them; until one lands, the previous revision's stand in.
        const fresh = out.resident.find((r) => cache.get(r.w) === r.read);
        if (fresh !== undefined && fixedAt !== out.revision) {
            fixedRows = new Map();
            fixedAt = out.revision;
            fresh.read.shape.forEach((s, b) => {
                if (s.fixed) fixedRows.set(b, fresh.read.blocks[b] ?? NO_ROWS);
            });
        }
        // ── Landed windows teach each paged block's ledger ────────────────
        for (const { w, read } of out.resident) {
            read.shape.forEach((s, b) => {
                if (s.fixed && !fixedRows.has(b)) fixedRows.set(b, read.blocks[b] ?? NO_ROWS);
            });
            for (const [b, lane] of lanes) observe(b, lane, w, read.blocks[b] ?? NO_ROWS);
        }
        // ── A pin protects the jump target until it SETTLES ───────────────
        // It lands, or its read fails (#811) — and the canvas commits that
        // (`committed`), when the pin drops. Left in place it would keep one
        // window trim-exempt for the session (#614) and, since a pending jump
        // owns the viewport (#812), a target that failed would freeze the
        // demand where it was.
        const pins = pinnedWindows();
        if (pins.length > 0 && !pinsSettled) {
            const settled = new Set(out.resident.map((r) => r.w));
            for (const f of out.failed) settled.add(f.w);
            if (pins.every((w) => settled.has(w))) pinsSettled = true;
        }
        // ── Demand follows the viewport, block by block, at idle only ─────
        let demanded = false;
        for (const lane of lanes.values()) {
            if (lane.ledger.windows === 0) {
                // Bootstrap. `total()` answers `none` until some window has
                // landed (it is taught BY a landing), and the geometry needs
                // the total — so waiting for one before demanding anything
                // deadlocks on first paint. Window 0 is demanded regardless,
                // and the total arrives with it. A source that never reports a
                // total still works: it simply has no bands and no extent
                // beyond what is resident.
                if (isEmpty(lane.residency)) {
                    lane.residency = { ...lane.residency, lo: 0, hi: 0 };
                    demanded = true;
                }
            } else if (!isScrolling) {
                const next = advance(lane.residency, lane.ledger, lane.viewportWindow, policy);
                if (next !== lane.residency) {
                    lane.residency = next;
                    demanded = true;
                }
            }
        }
        if (demanded) {
            // Whatever left every block's residency leaves the cache with it —
            // the half of eviction that actually frees memory. A failure
            // record leaves too: a window demanded again later is asked afresh.
            const keep = new Set(wantedWindows());
            pruneCache(cache, keep);
            pruneCache(failures, keep);
            if (stale !== undefined) pruneCache(stale, keep);
        }
        return moved || demanded;
    }

    /** The rows, block after block, and where each paged one came from —
     *  each paged block's run's landed windows (#876) — rebuilt only when what
     *  they are made of moved. */
    function assemble(landed: ReadonlyMap<number, WindowRead>): void {
        const pieces: Piece[] = [];
        const count = shape?.length ?? 1;
        for (let b = 0; b < count; b++) {
            if (shape?.[b]?.fixed === true) {
                const rows = fixedRows.get(b);
                if (rows !== undefined) pieces.push({ b, w: undefined, rows });
                continue;
            }
            const lane = lanes.get(b);
            if (lane === undefined) continue;
            for (let w = lane.run.from; w <= lane.run.to; w++) {
                const read = landed.get(w);
                if (read !== undefined) pieces.push({ b, w, rows: read.blocks[b] ?? NO_ROWS });
            }
        }
        if (samePieces(assembled.pieces, pieces)) return;
        const all: PlanRowValue[] = [];
        for (const p of pieces) appendAll(all, p.rows);
        // Each window was keyed on its own; a later block repeating an
        // earlier one's id is keyed here, as it would be inline.
        const rows = keyAcrossBlocks(all);
        const origin = new Map<string, PlanRowOrigin>();
        let i = 0;
        for (const p of pieces) {
            for (let k = 0; k < p.rows.length; k++, i++) {
                if (p.w !== undefined) origin.set(rows[i]!.key, { block: p.b, w: p.w });
            }
        }
        assembled = { pieces, rows, origin };
    }

    /** Which elements of a block's windows `fromW` to `toW` are loading
     *  (#1082) — those of the windows its residency demands that are still
     *  on the wire — as one span, from the first such window's first
     *  element to the last one's last; `undefined` when none is. */
    function loadingIn(lane: Lane, inFlight: ReadonlySet<number>, fromW: number, toW: number, known: number): PlanBand["loading"] {
        let lo: number | undefined;
        let hi: number | undefined;
        for (let w = Math.max(fromW, lane.residency.lo); w <= Math.min(toW, lane.residency.hi); w++) {
            if (!inFlight.has(w)) continue;
            lo ??= w;
            hi = w;
        }
        if (lo === undefined || hi === undefined) return undefined;
        return { from: lo * PLAN_PAGE_SIZE, to: Math.min(known, (hi + 1) * PLAN_PAGE_SIZE) - 1 };
    }

    /** One paged block as the canvas draws it — its run between its bands
     *  (#876) — reusing the previous object's parts that did not move. */
    function blockOf(
        b: number, lane: Lane, known: number | undefined, landedWindows: ReadonlySet<number>, inFlight: ReadonlySet<number>,
        prev: PlanPagedBlock | undefined,
    ): PlanPagedBlock {
        const { ledger, residency, run } = lane;
        let head: PlanBand | undefined;
        let tail: PlanBand | undefined;
        if (!isEmpty(residency) && ledger.windows > 0 && known !== undefined) {
            // The bands follow the run, not the residency: a window still in
            // flight, and every window past it, are theirs until it lands.
            // Each says which of its windows are loading — only those (#1082).
            head = run.from > 0
                ? {
                    block: b,
                    at: "head",
                    from: 0,
                    to: run.from * PLAN_PAGE_SIZE - 1,
                    px: offsetOfWindow(ledger, run.from),
                    loading: loadingIn(lane, inFlight, 0, run.from - 1, known),
                }
                : undefined;
            tail = run.to < ledger.windows - 1
                ? {
                    block: b,
                    at: "tail",
                    from: (run.to + 1) * PLAN_PAGE_SIZE,
                    to: known - 1,
                    px: documentHeight(ledger) - offsetOfWindow(ledger, run.to + 1),
                    loading: loadingIn(lane, inFlight, run.to + 1, ledger.windows - 1, known),
                }
                : undefined;
        }
        // Each failed window in the run as its band (#811): at its ledger slot,
        // floored so the reason and the Retry stay legible — a short last
        // window, or a window 0 that failed before any landing taught the
        // ledger a geometry.
        const inRun = last.failed.filter((f) => f.w >= run.from && f.w <= run.to);
        const failed: PlanWindowFailure[] = inRun.map(({ w, error }) => {
            const measured = known !== undefined && w < ledger.windows;
            const from = w * PLAN_PAGE_SIZE;
            const to = (measured ? Math.min(known, (w + 1) * PLAN_PAGE_SIZE) : (w + 1) * PLAN_PAGE_SIZE) - 1;
            return { block: b, w, from, to, px: Math.max(FAILED_BAND_MIN_PX, measured ? slotHeight(ledger, w) : 0), error };
        });
        let resident: PlanResidentSpan | undefined;
        const mine: number[] = [];
        for (let w = run.from; w <= run.to; w++) if (landedWindows.has(w)) mine.push(w);
        if (mine.length > 0 && known !== undefined) {
            // The SPAN of what landed — not of what was demanded.
            const lo = minOf(mine);
            const hi = maxOf(mine);
            let elements = 0;
            for (const w of mine) elements += elementsIn({ pageSize: PLAN_PAGE_SIZE, total: known }, w);
            resident = { from: lo * PLAN_PAGE_SIZE, to: Math.min(known, (hi + 1) * PLAN_PAGE_SIZE), elements };
        }
        const next: PlanPagedBlock = {
            index: b,
            fixed: false,
            parent: shape?.[b]?.parent,
            head: prev !== undefined && sameBand(prev.head, head) ? prev.head : head,
            tail: prev !== undefined && sameBand(prev.tail, tail) ? prev.tail : tail,
            failures: failed.length === 0 ? NO_FAILURES
                : prev !== undefined && sameFailures(prev.failures, failed) ? prev.failures : failed,
            resident: prev !== undefined && sameResident(prev.resident, resident) ? prev.resident : resident,
        };
        return prev !== undefined && sameBlock(prev, next) ? prev : next;
    }

    /** The snapshot for the last read — reusing every part that did not move. */
    function publish(): void {
        const prev = snapshot;
        const landed = new Map(last.resident.map((r) => [r.w, r.read]));
        // What each paged block draws, from what is in now (#876).
        const isIn = windowsIn();
        for (const lane of lanes.values()) lane.run = runOf(lane, isIn);
        assemble(landed);
        // Between two revisions the source knows no total until the new one's
        // first window lands; the geometry stands meanwhile, so the bands and
        // the scroll extent do not collapse under the reader (#821).
        const known = last.total ?? (stale !== undefined && total > 0 ? total : undefined);
        const landedWindows = new Set(landed.keys());
        const inFlight = new Set(last.inFlight);
        const count = shape?.length ?? 1;
        const blocks: PlanPagedBlock[] = [];
        for (let b = 0; b < count; b++) {
            const before = prev.blocks[b];
            const lane = lanes.get(b);
            if (shape?.[b]?.fixed === true || lane === undefined) {
                const fixed: PlanPagedBlock = {
                    index: b, fixed: true, parent: shape?.[b]?.parent,
                    head: undefined, tail: undefined, failures: NO_FAILURES, resident: undefined,
                };
                blocks.push(before !== undefined && sameBlock(before, fixed) ? before : fixed);
                continue;
            }
            blocks.push(blockOf(b, lane, known, landedWindows, inFlight, before));
        }
        const sameBlocks = blocks.length === prev.blocks.length && blocks.every((x, i) => x === prev.blocks[i]);
        const paged = blocks.filter((x) => !x.fixed);
        const focus = blocks[focusBlock]?.fixed === false ? blocks[focusBlock] : paged[0];
        const complete = known !== undefined && paged.every((x) =>
            x.head === undefined && x.tail === undefined && x.failures.length === 0
            && x.resident !== undefined && x.resident.elements >= known);
        // Every failed window once, whichever blocks hold it.
        const failures: PlanWindowFailure[] = [];
        const seen = new Set<number>();
        for (const x of paged) {
            for (const f of x.failures) {
                if (seen.has(f.w)) continue;
                seen.add(f.w);
                failures.push(f);
            }
        }
        failures.sort((a, b) => a.w - b.w);
        const next: PlanPagingSnapshot = {
            seq: prev.seq,
            rows: assembled.rows,
            origin: assembled.origin,
            blocks: sameBlocks ? prev.blocks : blocks,
            total: known,
            resident: sameResident(prev.resident, focus?.resident) ? prev.resident : focus?.resident,
            complete,
            loading: last.inFlight.length > 0,
            failures: failures.length === 0 ? NO_FAILURES
                : sameFailures(prev.failures, failures) ? prev.failures : failures,
            sourceError: last.sourceError,
            revision: last.revision,
            dataSnapshot: last.dataSnapshot,
        };
        const changed = next.rows !== prev.rows || next.origin !== prev.origin || next.blocks !== prev.blocks
            || next.total !== prev.total || next.resident !== prev.resident || next.complete !== prev.complete
            || next.loading !== prev.loading || next.failures !== prev.failures || next.sourceError !== prev.sourceError
            || next.revision !== prev.revision || next.dataSnapshot !== prev.dataSnapshot;
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
        const windows = Math.ceil(total / PLAN_PAGE_SIZE);
        return windows > 0 ? Math.min(w, windows - 1) : w;
    }

    /** Move the demand to window `w` and pin it until it lands and is shown;
     *  `rebase` starts the run there however near the old one was. Every
     *  block moves, or only `block`. */
    function jump(w: number, rebase: boolean, only?: number): void {
        isScrolling = false;
        // A block the canvas does not page (yet) — its shape still to land —
        // moves them all.
        const block = only !== undefined && lanes.has(only) ? only : undefined;
        for (const [b, lane] of lanes) {
            // One jump at a time: every other pin goes.
            lane.residency = unpinAll(lane.residency);
            if (block !== undefined && b !== block) continue;
            lane.viewportWindow = w;
            lane.viewportAt = w * PLAN_PAGE_SIZE;
            if (rebase && !isEmpty(lane.residency) && (w < lane.residency.lo || w > lane.residency.hi)) {
                lane.residency = { ...lane.residency, lo: w, hi: w };
            }
            // Pin it so no trim can drop the destination before it lands.
            lane.residency = pin(lane.residency, w);
        }
        if (block !== undefined) focusBlock = block;
        pinsSettled = false;
        settledSeq = undefined;
        settle();
    }

    /** Drop every pin — the jump has landed, or the search was cleared. */
    function unpinEvery(): void {
        for (const lane of lanes.values()) lane.residency = unpinAll(lane.residency);
        pinsSettled = false;
        settledSeq = undefined;
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
                    assembled = { pieces: [], rows: NO_ROWS, origin: NO_ORIGIN };
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
            // that window would rebase a run back and undo the jump.
            if (pinnedWindows().length > 0) return;
            if (at.kind === "row") {
                // A fixed block's row names no window: the demand stays.
                const o = snapshot.origin.get(at.key);
                const lane = o !== undefined ? lanes.get(o.block) : undefined;
                if (o !== undefined && lane !== undefined) {
                    lane.viewportWindow = o.w;
                    lane.viewportAt = o.w * PLAN_PAGE_SIZE;
                    focusBlock = o.block;
                }
            } else {
                const lane = lanes.get(at.block);
                if (lane !== undefined) {
                    focusBlock = at.block;
                    let element: number;
                    if (at.kind === "window") {
                        element = at.w * PLAN_PAGE_SIZE;
                    } else if (at.px !== undefined && lane.ledger.windows > 0) {
                        // The band's top is a ledger offset the band was SIZED
                        // from (a head band starts the block; a tail band starts
                        // where its run ends — not its residency, whose last
                        // windows may still be loading inside it, #876), so the
                        // offset maps through `elementAtOffset` whatever the
                        // resident rows in between rendered at, and a far drag
                        // rebases (#612).
                        const bandTop = at.at === "head" ? 0 : offsetOfWindow(lane.ledger, lane.run.to + 1);
                        element = elementAtOffset(lane.ledger, bandTop + Math.max(0, at.px));
                    } else {
                        // Without one, the element just outside the run on that side.
                        element = at.at === "head"
                            ? Math.max(0, lane.run.from * PLAN_PAGE_SIZE - 1)
                            : (lane.run.to + 1) * PLAN_PAGE_SIZE;
                    }
                    lane.viewportAt = element;
                    lane.viewportWindow = Math.floor(element / PLAN_PAGE_SIZE);
                }
            }
            settle();
        },
        jumpToElement(element) {
            jump(windowOf(element), false);
        },
        openAt(element, block) {
            jump(windowOf(element), true, block);
        },
        clearJump() {
            if (pinnedWindows().length === 0) return;
            unpinEvery();
            settle();
        },
        committed(rendered) {
            // Before the canvas has put the landed target on screen, what it
            // reports is where it WAS — the jump keeps the viewport.
            if (settledSeq === undefined || rendered.seq < settledSeq) return;
            unpinEvery();
            settle();
        },
        retry(w) {
            failures.delete(w);
            settle();
        },
        refresh() {
            settle();
        },
        remeasure() {
            for (const lane of lanes.values()) {
                for (const [w, held] of lane.skeletons) {
                    lane.ledger = observeWindow(lane.ledger, w, {
                        px: options.heightOf(held.sk), rows: held.rows, restPx: held.restPx,
                    });
                }
            }
            settle();
        },
        reskeleton() {
            // A resident window takes its skeleton again on the next settle;
            // an evicted one keeps what it had until it is read again.
            for (const lane of lanes.values()) {
                for (const held of lane.skeletons.values()) held.read = -1;
            }
            settle();
        },
        placeOf(key) {
            const o = located.get(key);
            const lane = o !== undefined ? lanes.get(o.block) : undefined;
            if (o === undefined || lane === undefined || isEmpty(lane.residency)) return undefined;
            // The bands are the run's (#876).
            const { from, to } = lane.run;
            if (o.w < from) return { block: o.block, at: "head", px: offsetOfWindow(lane.ledger, o.w) };
            if (o.w > to) {
                return { block: o.block, at: "tail", px: offsetOfWindow(lane.ledger, o.w) - offsetOfWindow(lane.ledger, to + 1) };
            }
            return undefined;
        },
        seenAt: (key) => located.get(key),
        jumping: () => pinnedWindows().length > 0,
        disconnect() {
            tracked.release();
        },
    };
}
