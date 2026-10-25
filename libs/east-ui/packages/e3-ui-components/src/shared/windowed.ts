/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The windowed rows the paged builders draw — the Sheet's and the Plan's
 * (#1398): the one driver logic both run on (`sheet/paging.ts`,
 * `plan/controller/paging.ts`), each keeping only what is its own — the
 * Sheet's React state and its family's stand-in, the Plan's blocks, their
 * skeletons and its committed-snapshot handshake.
 *
 * - **The stand-in** ({@link WindowStore}, {@link readWindows}): each window
 *   read once (#577) and kept for the source that read it; a read that throws
 *   is a failure recorded against its window (#811, #853), asked again only
 *   once its record goes — a Retry ({@link retryWindows}), or the window
 *   leaving the run; and across a new revision the previous one's windows
 *   stand in, each until its own lands (#821, #851).
 * - **The run** ({@link runAround}): the stretch of the resident windows that
 *   are in — landed, or failed — around the one nearest the element the view
 *   is centred on (#876). A window still in flight ends it at either end, so a
 *   window loading beside the rows on screen never takes them off it.
 * - **The bands** ({@link bandsAround}): every element above the run and every
 *   element below it, each sized by the ledger, so eviction moves nothing and
 *   a window landing beside the run takes exactly its band's slot; a band
 *   report's pixels map back to the element under the view
 *   ({@link elementInBand}, #612), and a failed window is a band at its slot
 *   ({@link failedSpan}).
 * - **The demand** ({@link advanceAtRest}, {@link firstWindow}): the run
 *   follows the view a window at a time while it rests, reading ahead the way
 *   it travels (#1398, CL6) — window 0 first, before the source has counted
 *   itself.
 * - **The jump** ({@link pinTarget}): a sought element's window pinned, so no
 *   trim drops it before it lands (#812, #854).
 *
 * Pure but for the store, which a driver owns, and Retry's microtask: no
 * React, and no East value but the options a page answers with.
 *
 * @packageDocumentation
 */

import { none, type option } from "@elaraai/east";
import {
    advance, documentHeight, elementAtOffset, isEmpty, offsetOfWindow, pin, slotHeight, travelOf, unpinAll,
    type Residency, type ResidencyOptions, type Travel, type WindowLedger,
} from "@elaraai/east-ui-components/internal";

// ── The stand-in ──────────────────────────────────────────────────────────

/**
 * How a driver reads one window of its source: the source's `page`, what a
 * landed window is to the driver, and the name its console says a failure
 * under.
 */
export interface WindowReader<T, R> {
    /** The source's page read: `none` while the window is in flight, its tracked channel firing as it lands. */
    readonly page: (offset: bigint, limit: bigint) => option<T>;
    /** A landed window, as the driver keeps it — read once, when it lands. */
    readonly decode: (value: T) => R;
    /** The driver's name in the console (`[Sheet]`, `[Plan]`). */
    readonly label: string;
}

/** What one read of some windows found. */
export interface WindowReads<R> {
    /** Every window asked that is resident — landed, or the previous revision's standing in — in the order asked. */
    resident: { w: number; read: R }[];
    /** Every window asked still in flight, in the order asked — one the previous revision stands in for as well. */
    inFlight: number[];
    /** Every window asked whose read failed, in the order asked. */
    failed: { w: number; error: string }[];
    /** Whether any resident window was served from `stale`: the previous revision, standing in until this one's rows land. */
    stale: boolean;
}

/** One line naming why a read failed. */
function readFailure(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Read windows, serving the ones the cache holds and reading the rest (#577).
 *
 * @remarks
 * A landed window is immutable for the source that read it, so it is read
 * exactly once, into the caller's cache, and served from there. Serving it
 * skips the page read, and so its tracking: only a window still in flight is
 * read, and so tracked — which is right, since only it has more to say. The
 * read does not stop at a window in flight: residency is a run, and a landed
 * window draws whether or not its neighbour has. A window whose read throws is
 * recorded in `failures` and reported (#811), and not read again while its
 * record stands. A window in flight at a new revision is served from `stale`,
 * the rows it had (#821), and still counts as in flight.
 *
 * @param reader - The source's page read and what a landed window is
 * @param windows - The windows to read, ascending
 * @param cache - The caller's read-once cache (mutated: it is a cache)
 * @param pageSize - Elements per window
 * @param failures - The caller's failure record (mutated: a new failure is recorded)
 * @param stale - The previous revision's windows, served for a window still in flight at this one
 * @returns The windows resident, in flight and failed, and whether any was served from `stale`
 */
export function readWindows<T, R>(
    reader: WindowReader<T, R>,
    windows: Iterable<number>,
    cache: Map<number, R>,
    pageSize: number,
    failures: Map<number, string>,
    stale?: ReadonlyMap<number, R>,
): WindowReads<R> {
    const resident: { w: number; read: R }[] = [];
    const inFlight: number[] = [];
    const failed: { w: number; error: string }[] = [];
    let servedStale = false;
    for (const w of windows) {
        const known = cache.get(w);
        if (known !== undefined) {
            resident.push({ w, read: known });
            continue;
        }
        // A failed window is not asked again by the reader — only once its record goes.
        const recorded = failures.get(w);
        if (recorded !== undefined) {
            failed.push({ w, error: recorded });
            continue;
        }
        let win: option<T>;
        try {
            win = reader.page(BigInt(w * pageSize), BigInt(pageSize));
        } catch (err) {
            console.error(`${reader.label} paged source page ${w} failed:`, err);
            const error = readFailure(err);
            failures.set(w, error);
            failed.push({ w, error });
            continue;
        }
        if (win.type !== "some") {
            // In flight: its channel is tracked now, so its landing reads again. Until then the rows it had at the
            // previous revision stand in.
            inFlight.push(w);
            const previous = stale?.get(w);
            if (previous !== undefined) {
                resident.push({ w, read: previous });
                servedStale = true;
            }
            continue;
        }
        const read = reader.decode(win.value);
        cache.set(w, read);
        resident.push({ w, read });
    }
    return { resident, inFlight, failed, stale: servedStale };
}

/**
 * Drop the entries of windows outside the resident set — the memory half of
 * eviction for a cache, and the reset of a failure record: a failed window
 * that leaves the run is asked afresh when it is demanded again.
 *
 * @param cache - A map by window
 * @param keep - The windows to keep
 * @returns How many entries went
 */
export function pruneWindows(cache: Map<number, unknown>, keep: ReadonlySet<number>): number {
    let dropped = 0;
    for (const w of [...cache.keys()]) {
        if (keep.has(w)) continue;
        cache.delete(w);
        dropped += 1;
    }
    return dropped;
}

/**
 * What a driver keeps of its source's windows (#577, #811, #821): the windows
 * landed at its revision, the previous revision's standing in for them until
 * they land, and why each failed window's read threw. A driver holds one for
 * the source that filled it, and starts another when the next source is not
 * equivalent (#809): a source whose closures changed serves other rows under
 * the same id and revision.
 */
export class WindowStore<R> {
    /** The windows landed at {@link revision}. */
    windows = new Map<number, R>();
    /** The previous revision's windows, each served until this revision's copy lands (#821, #851). */
    stale: Map<number, R> | undefined = undefined;
    /** Why each failed window's read threw, at {@link revision} — not asked again while recorded (#811, #853). */
    failures = new Map<number, string>();
    /** The revision the windows are read at; `undefined` before one is known, or for a source that names none. */
    revision: string | undefined = undefined;

    /**
     * Read at a revision: a new one starts the windows again, the ones held standing in until each lands — or, while
     * nothing is held (a revision the source was still finding), the last ones that had rows — and its failures start
     * afresh.
     *
     * @param revision - The revision the source serves now
     */
    at(revision: string | undefined): void {
        if (revision === this.revision) return;
        if (this.windows.size > 0) this.stale = this.windows;
        this.windows = new Map();
        this.failures = new Map();
        this.revision = revision;
    }

    /** Drop everything: the rows of a source, or of a narrowing, that the next one does not serve. */
    drop(): void {
        this.windows = new Map();
        this.failures = new Map();
        this.stale = undefined;
        this.revision = undefined;
    }

    /**
     * Read windows into the store ({@link readWindows}); once no window stood in, every one reads at this revision,
     * and the previous one has nothing left to stand in for.
     *
     * @param reader - The source's page read and what a landed window is
     * @param windows - The windows to read, ascending
     * @param pageSize - Elements per window
     * @returns What the read found
     */
    read<T>(reader: WindowReader<T, R>, windows: Iterable<number>, pageSize: number): WindowReads<R> {
        const out = readWindows(reader, windows, this.windows, pageSize, this.failures, this.stale);
        if (!out.stale) this.stale = undefined;
        return out;
    }

    /**
     * Keep only the windows in `keep`: whatever left the run leaves the store with it, a stand-in too, and its failure
     * record — demanded again later, it is asked afresh.
     *
     * @param keep - The windows to keep
     */
    prune(keep: ReadonlySet<number>): void {
        pruneWindows(this.windows, keep);
        if (this.stale !== undefined) pruneWindows(this.stale, keep);
        pruneWindows(this.failures, keep);
    }

    /**
     * Forget a failed window's record — or, with none named, every one — so the next read asks again (#811, #853).
     *
     * @param w - The window; `undefined` for every one
     */
    forget(w?: number): void {
        if (w === undefined) this.failures.clear();
        else this.failures.delete(w);
    }
}

/**
 * Ask again (#811, #853) at once (#1398): a source that can refresh rearms what
 * failed for a reason a retry can fix first — a read alone waits out the
 * runtime's retry gap after the last failure — and the records go and the
 * windows are read again a microtask on, once it has: a read between the two
 * would only record the failure again. A source that cannot refresh is asked
 * again at once.
 *
 * @param source - The source, whose `refresh` rearms what failed
 * @param ask - Drops the records and reads again
 */
export function retryWindows(source: { readonly refresh?: ((target: option<string>) => unknown) | undefined } | undefined, ask: () => void): void {
    if (source?.refresh === undefined) {
        ask();
        return;
    }
    source.refresh(none);
    queueMicrotask(ask);
}

// ── The run and its bands ─────────────────────────────────────────────────

/** The windows a driver draws (#876): `from` to `to`, inclusive; `to < from` when none of the resident ones is in. */
export interface WindowRun {
    readonly from: number;
    readonly to: number;
}

/**
 * The window a run is anchored on (#876): the resident window that is in —
 * landed, or failed (#811, #853) — nearest the element the view is centred on.
 * Its own window when that is in; else the nearer of the first in after it and
 * the last in before it, so a window loading next to the rows on screen never
 * takes them off it, whichever way the view came and whatever lands beyond it
 * first.
 *
 * @param residency - The resident windows
 * @param isIn - Whether a window is in
 * @param element - The element the view is centred on
 * @param pageSize - Elements per window
 * @returns The window; `undefined` while none of the resident ones is in
 */
export function anchorAround(residency: Residency, isIn: (w: number) => boolean, element: number, pageSize: number): number | undefined {
    if (isEmpty(residency)) return undefined;
    const { lo, hi } = residency;
    const at = Math.min((hi + 1) * pageSize - 1, Math.max(lo * pageSize, element));
    const own = Math.floor(at / pageSize);
    if (isIn(own)) return own;
    let after: number | undefined;
    for (let w = own + 1; w <= hi && after === undefined; w++) if (isIn(w)) after = w;
    let before: number | undefined;
    for (let w = own - 1; w >= lo && before === undefined; w--) if (isIn(w)) before = w;
    if (after === undefined || before === undefined) return after ?? before;
    return after * pageSize - at <= at - ((before + 1) * pageSize - 1) ? after : before;
}

/**
 * The run a driver draws (#876): the stretch of its resident windows that are
 * in around the window it is anchored on ({@link anchorAround}). It crosses a
 * failed window, whose elements are known, so the rows after it keep their
 * positions (#811, #853); a window still in flight ends it at either end.
 *
 * @param residency - The resident windows
 * @param isIn - Whether a window is in
 * @param element - The element the view is centred on
 * @param pageSize - Elements per window
 * @returns The run — empty at the residency's first window while none of it is in: the bands meet where it will land
 */
export function runAround(residency: Residency, isIn: (w: number) => boolean, element: number, pageSize: number): WindowRun {
    const anchor = anchorAround(residency, isIn, element, pageSize);
    if (anchor === undefined) return { from: residency.lo, to: residency.lo - 1 };
    let from = anchor;
    while (from > residency.lo && isIn(from - 1)) from--;
    let to = anchor;
    while (to < residency.hi && isIn(to + 1)) to++;
    return { from, to };
}

/** A stretch of a source's elements and the height it draws at: a band's, or a failed window's. */
export interface WindowSpan {
    /** Its first element (inclusive). */
    readonly from: number;
    /** Its last element (inclusive). */
    readonly to: number;
    /** Its height in px, the ledger's geometry. */
    readonly px: number;
}

/** No band either side. */
const NO_BANDS: { readonly head: WindowSpan | undefined; readonly tail: WindowSpan | undefined } = { head: undefined, tail: undefined };

/**
 * The bands either side of a run (#876): every element above it — not
 * resident, still loading, or past a window still loading — and every element
 * below it, each as tall as the ledger makes its windows. The bands follow the
 * run, never the residency: the windows past a window still loading are
 * theirs until it lands. None while nothing is resident, or before the ledger
 * knows a window.
 *
 * @param ledger - The ledger
 * @param residency - The resident windows
 * @param run - The run ({@link runAround})
 * @param pageSize - Elements per window
 * @param known - The source's element count as the driver knows it: where the tail ends
 * @returns The head and the tail band, each `undefined` where the run reaches that end
 */
export function bandsAround(
    ledger: WindowLedger, residency: Residency, run: WindowRun, pageSize: number, known: number,
): { readonly head: WindowSpan | undefined; readonly tail: WindowSpan | undefined } {
    if (isEmpty(residency) || ledger.windows === 0) return NO_BANDS;
    const head = run.from > 0 ? { from: 0, to: run.from * pageSize - 1, px: offsetOfWindow(ledger, run.from) } : undefined;
    const tail = run.to < ledger.windows - 1
        ? { from: (run.to + 1) * pageSize, to: known - 1, px: documentHeight(ledger) - offsetOfWindow(ledger, run.to + 1) }
        : undefined;
    return { head, tail };
}

/**
 * The element a band report names (#612): `px` into the band — from its own
 * top, which the ledger places exactly, since the band was sized from it (a
 * head band starts the rows; a tail band starts where the run ends, never the
 * residency, whose last windows may still be loading inside it, #876) — so a
 * report over the scrollbar thumb's place resolves to the window under it and a
 * far drag rebases instead of walking. Without pixels, the element just
 * outside the run on that side.
 *
 * @param ledger - The ledger
 * @param run - The run the band stands beside
 * @param at - Which band
 * @param px - Pixels from the band's top to the view's centre, when the frame says them
 * @param pageSize - Elements per window
 * @returns The element
 */
export function elementInBand(ledger: WindowLedger, run: WindowRun, at: "head" | "tail", px: number | undefined, pageSize: number): number {
    if (px !== undefined && ledger.windows > 0) {
        const bandTop = at === "head" ? 0 : offsetOfWindow(ledger, run.to + 1);
        return elementAtOffset(ledger, bandTop + Math.max(0, px));
    }
    return at === "head" ? Math.max(0, run.from * pageSize - 1) : (run.to + 1) * pageSize;
}

/**
 * A failed window's band (#811, #853): its elements and its ledger slot, so the
 * rows that replace it take the same space — floored, so its reason and its
 * Retry stay legible in a short last window, or before any landing taught the
 * ledger a geometry. Its span ends at the source's count once the ledger knows
 * its windows. (A failed window past the ledger's last, which only a sheet
 * whose count shrank under a run beyond it can draw, keeps the span the Sheet's
 * driver always gave it.)
 *
 * @param ledger - The ledger
 * @param w - The window
 * @param total - The source's element count, once known
 * @param pageSize - Elements per window
 * @param minPx - The least height it draws at
 * @returns Its span
 */
export function failedSpan(ledger: WindowLedger, w: number, total: number | undefined, pageSize: number, minPx: number): WindowSpan {
    const known = total !== undefined && ledger.windows > 0;
    const from = w * pageSize;
    return {
        from,
        to: (known ? Math.min(total, from + pageSize) : from + pageSize) - 1,
        px: Math.max(minPx, known && w < ledger.windows ? slotHeight(ledger, w) : 0),
    };
}

// ── The demand and the jump ───────────────────────────────────────────────

/** Which way the view travels through the windows, and the window it was in as the demand last moved (#1398, CL6). */
export interface WindowTravel {
    readonly at: number;
    readonly way: Travel;
}

/**
 * One step of the demand at rest (#1398, CL6): toward the window under the
 * view, reading ahead the way it travels — two windows ahead and one behind
 * with the shipped policy — a window at a time, or rebasing on a far move.
 *
 * @param residency - The resident windows
 * @param ledger - The ledger
 * @param viewportWindow - The window under the view
 * @param policy - The residency policy
 * @param travel - Which way it travelled, and from where
 * @returns The residency it leaves (the same object when nothing moved), and the travel
 */
export function advanceAtRest(
    residency: Residency, ledger: WindowLedger, viewportWindow: number, policy: ResidencyOptions, travel: WindowTravel,
): { residency: Residency; travel: WindowTravel } {
    const way = travelOf(travel.at, viewportWindow, travel.way);
    return { residency: advance(residency, ledger, viewportWindow, policy, way), travel: { at: viewportWindow, way } };
}

/**
 * The first read, before the ledger knows a window: window 0. The source's
 * count is taught by a landing, and the geometry needs the count, so waiting
 * for it before reading anything would deadlock on first paint; a source that
 * never counts itself still draws what it has.
 *
 * @param residency - The resident windows
 * @returns Window 0 resident when nothing is; else the residency as it is
 */
export function firstWindow(residency: Residency): Residency {
    return isEmpty(residency) ? { ...residency, lo: 0, hi: 0 } : residency;
}

/**
 * A jump's target pinned (#812, #854): one jump at a time, so every other pin
 * goes, and its window is kept resident whatever the budget says until the
 * jump settles. `rebase` starts the run at it however near the resident one is
 * — a remounted canvas opening where it left off fetches nothing in between.
 *
 * @param residency - The resident windows
 * @param w - The target's window
 * @param rebase - Whether the run starts at it when it lies outside
 * @returns The residency
 */
export function pinTarget(residency: Residency, w: number, rebase = false): Residency {
    let r = unpinAll(residency);
    if (rebase && !isEmpty(r) && (w < r.lo || w > r.hi)) r = { ...r, lo: w, hi: w };
    return pin(r, w);
}
