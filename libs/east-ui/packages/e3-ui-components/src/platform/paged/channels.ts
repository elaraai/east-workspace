/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The paging runtime's first layer: the channels of a dataset's snapshot. It
 * follows each dataset's content hash — every bind of one shares a snapshot,
 * and a move drops what the old one delivered — and runs every channel's fetch:
 * launched, aborted once no read waits on it (#1398, CL6), applied only while
 * the channel still waits on it, failed with a reason a read throws and a retry
 * gap, and landed once a frame (CL9). Landed windows are kept least recently
 * read first, at most {@link MAX_RETAINED_WINDOWS}, never one a reader holds
 * (#1409, R24). The layers after it read through these channels: single windows
 * and searches (`reads.ts`), batched reads (`batches.ts`), and the handles and
 * platform functions (`../paged-runtime.ts`).
 *
 * @packageDocumentation
 */

import { none, some, type option } from "@elaraai/east";
import { DatasetHashMismatchError, RunsHashMismatchError } from "@elaraai/e3-api-client";
import type { TreePath } from "@elaraai/e3-types";

import { datasetPathToString } from "../dataset-store.js";
import { TrackedChannelStore } from "../tracked-channel.js";
import { PagedReadError } from "../paged-read-error.js";
import type { PagedApi } from "./api.js";
import { pagedRevisionKey } from "./keys.js";
import { RETRY_AFTER_MS, NO_VALUE_ERRORS, errorCode, failureOf } from "./errors.js";
import { type PageEntry, type SearchBurst, type Snapshot, landSearch, holdsNothing, MAX_HELD_PLACEMENTS } from "./state.js";

/**
 * How long the windows landed wait for a frame to apply them before a timer
 * does (#1398, CL9): a page that draws no frames — hidden, say — still hears
 * them, a few frames late.
 */
const LANDING_WAIT_MS = 100;

/**
 * What asks for the frame that applies the windows a runtime landed, in place
 * of the page's next frame (#1398, CL9).
 *
 * @param apply - Applies the windows landed, as the frame comes
 * @returns What cancels the frame
 */
export type PagedLandingFrame = (apply: () => void) => () => void;

/**
 * Decoded windows retained across ALL paged sources (#567 D6).
 *
 * A decoded window is the heavy object here — a window of wide rows runs to
 * megabytes — and nothing else evicts one while its revision stands: scrolling
 * a GB-scale dataset end to end would pin every window it passed. Retention is
 * bounded least-recently-READ: past the cap the least recently read window no
 * reader holds goes whole, and a read of it fetches it again (the raw bytes
 * may still be in an HTTP cache, so a return is usually cheap).
 *
 * The windows its readers hold count toward the cap, but none is evicted
 * under its reader: past the cap the runtime keeps what its readers hold
 * alone, each reader bounding what it holds by its own demand (#1409, R24) —
 * a reader of more windows than the cap, rows read a key at a time among
 * them, each a one-row window, settles, each read once.
 *
 * `<PagedDatasetPreview>` caps its own materialized rows the same way
 * (`MAX_RETAINED_PAGES`); this is the cap for the *bound* path, where the
 * renderer holds no cache of its own and the runtime is the only holder.
 */
export const MAX_RETAINED_WINDOWS = 24;

/**
 * The channels of every dataset's snapshot, and their fetches: the paging runtime's first layer.
 */
export class PagedChannels extends TrackedChannelStore<PageEntry> {
    protected api: PagedApi | null = null;
    protected workspace: string | null = null;

    /** Loaded window keys in least-recently-READ order (a Map preserves
     *  insertion order; a read re-inserts). Bounds the decoded-window cache. */
    protected readonly loadedWindows = new Map<string, true>();

    /** Each dataset's snapshot, by workspace and path. */
    protected readonly snapshots = new Map<string, Snapshot>();

    /** This turn's open search bursts, by the family of the rows they search. */
    protected readonly bursts = new Map<string, SearchBurst>();

    /** Fetches launched so far — the source of every channel's `launchSeq`. */
    protected launches = 0;

    /** Each fetch in flight, by its channel: its launch, what aborts it, and what an abort lets go besides (#1398, CL6). */
    protected readonly fetching = new Map<string, { readonly seq: number; readonly controller: AbortController; readonly onAbort: (() => void) | undefined }>();

    /** The channels of the windows landed since the frame began, and their totals', whose readers are still to hear (#1398, CL9). */
    protected readonly landed = new Set<string>();
    /** What cancels the frame — or the timer standing in for one — that applies them, while one waits ({@link scheduleLanding}). */
    protected landing: (() => void) | undefined;
    /** What asks for the frame that applies them in place of the page's, once one is set ({@link setLandingFrame}). */
    protected landingFrame: PagedLandingFrame | undefined;

    /** Monotonic clock seam so tests can drive the retry gate. */
    protected now(): number {
        return Date.now();
    }

    protected createEntry(): PageEntry {
        return { status: "idle", launchSeq: 0 };
    }

    /** Stop following every dataset, and drop what every snapshot delivered — aborting what is still in flight. */
    protected reset(): void {
        for (const key of [...this.fetching.keys()]) this.abortFetch(key);
        for (const snapshot of this.snapshots.values()) snapshot.unwatch?.();
        this.snapshots.clear();
        this.clearChannels();
        this.loadedWindows.clear();
        this.bursts.clear();
        this.cancelLanding();
        this.landed.clear();
    }

    /**
     * A window has landed: its readers hear with every other window landing before the next frame (#1398, CL9), so a
     * burst of windows — a fling coming to rest, the windows either side read ahead — is applied to each reader once a
     * frame, never once a window.
     *
     * @param keys - The window's channel, and its total's when it moved
     */
    protected notifyLanded(keys: readonly string[]): void {
        for (const key of keys) this.landed.add(key);
        if (this.landing !== undefined) return;
        const cancel = this.scheduleLanding(() => this.flushLanded());
        if (cancel === undefined) this.flushLanded();
        else this.landing = cancel;
    }

    /**
     * Apply the windows landed in frames of this, in place of the page's next frame (#1398, CL9): a DOM test's, whose
     * page draws no frame its test waits on. `undefined` gives the page's frames back.
     *
     * @param frame - What asks for the frame, or `undefined`
     */
    setLandingFrame(frame: PagedLandingFrame | undefined): void {
        this.landingFrame = frame;
    }

    /**
     * What applies the windows landed (#1398, CL9): the next animation frame — or, where the page draws none, hidden
     * say, a timer standing in for it, a few frames late — or the frame set in its place ({@link setLandingFrame}). A
     * runtime with no frames to draw at all applies them at once. A spec drives frames of its own.
     *
     * @param apply - Applies the windows landed
     * @returns What cancels it; `undefined` to apply them at once
     */
    protected scheduleLanding(apply: () => void): (() => void) | undefined {
        if (this.landingFrame !== undefined) return this.landingFrame(apply);
        if (typeof requestAnimationFrame !== "function") return undefined;
        const frame = requestAnimationFrame(apply);
        const timer = setTimeout(apply, LANDING_WAIT_MS);
        return () => {
            if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
            clearTimeout(timer);
        };
    }

    /** No frame or timer waits to apply the windows landed. */
    protected cancelLanding(): void {
        const cancel = this.landing;
        if (cancel === undefined) return;
        this.landing = undefined;
        cancel();
    }

    /**
     * Apply the windows landed since the frame began to their readers now (#1398, CL9): every channel's version moves,
     * then each reader hears once, however many of the windows it reads — what the frame does as it comes.
     */
    protected flushLanded(): void {
        this.cancelLanding();
        if (this.landed.size === 0) return;
        const keys = [...this.landed];
        this.landed.clear();
        this.notifyAll(keys);
    }

    protected resolveWorkspace(): string {
        if (!this.workspace) {
            throw new Error(
                "Data.bindPaged: no paging service — a paged source is served BY THE SERVER " +
                "(datasetGetPage), so it resolves only inside a live workspace. Render this " +
                "component against a deployed workspace, or bind the whole value with Data.bind.",
            );
        }
        return this.workspace;
    }

    // ----- snapshots -------------------------------------------------------

    /** A dataset's snapshot, followed from a read while something reads the
     *  dataset ({@link unsubscribed}) — the read that makes it, or the first
     *  after its readers all let it go. */
    protected snapshotOf(workspace: string, path: TreePath): Snapshot {
        const key = pagedRevisionKey(workspace, path);
        let snapshot = this.snapshots.get(key);
        if (snapshot === undefined) {
            snapshot = {
                key,
                revision: undefined,
                moves: 0,
                findSeq: 0,
                finding: false,
                channels: new Set(),
                searches: new Map(),
                held: new Map(),
                within: new Map(),
                pinning: new Map(),
                placements: new Map(),
                unwatch: undefined,
            };
            this.snapshots.set(key, snapshot);
        }
        if (snapshot.unwatch === undefined && this.api !== null) {
            const followed = snapshot;
            snapshot.unwatch = this.api.watchRevision(workspace, path, (hash) => this.moveTo(workspace, path, followed, hash));
        }
        return snapshot;
    }

    /**
     * A dataset its readers have all let go stops being followed, so nothing
     * polls for it: every read tracks its revision channel, and a reader lets
     * the channel go as it unmounts. What its snapshot delivered stays, and a
     * read follows it again — moved at the first report if the dataset moved
     * meanwhile.
     */
    protected override unsubscribed(key: string): void {
        // A read no reader waits on any longer is aborted while still in flight (#1398, CL6): a window that left the
        // demand ring, a period read a newer navigation superseded. A reader re-subscribing lets every channel go
        // before it subscribes again, so the fetch goes only if nothing reads it once that is done.
        if (this.fetching.has(key)) {
            queueMicrotask(() => { if (!this.isSubscribed(key)) this.abortFetch(key); });
        }
        // What the channel holds that no reader waits on goes too, once the reader re-subscribing has done so (#1351).
        queueMicrotask(() => this.letGo(key));
        const snapshot = this.snapshots.get(key);
        if (snapshot?.unwatch === undefined) return;
        // A reader re-subscribing lets every channel go before it subscribes
        // again: the dataset goes only if nothing reads it once that is done.
        queueMicrotask(() => {
            if (!this.isLive(snapshot) || this.isSubscribed(key)) return;
            snapshot.unwatch?.();
            snapshot.unwatch = undefined;
        });
    }

    /** Whether a snapshot is still the runtime's, rather than one a clear or a
     *  re-initialization dropped. */
    protected isLive(snapshot: Snapshot): boolean {
        return this.snapshots.get(snapshot.key) === snapshot;
    }

    /** Whether a live snapshot is still pinned to `revision`. */
    protected pinnedTo(snapshot: Snapshot, revision: string): boolean {
        return this.isLive(snapshot) && snapshot.revision === revision;
    }

    /**
     * The revision a read of `path` is pinned to — a hash, `null` while the
     * dataset has no value, or `undefined` while it is being found — tracked so
     * the read re-fires when the source moves.
     *
     * @throws {PagedReadError} The failed lookup's reason, until a read after the retry gap
     *   looks again
     */
    protected revisionFor(workspace: string, path: TreePath): string | null | undefined {
        this.track(pagedRevisionKey(workspace, path));
        const snapshot = this.snapshotOf(workspace, path);
        if (snapshot.revision !== undefined || snapshot.finding) return snapshot.revision;
        if (snapshot.findError !== undefined && this.now() - (snapshot.findFailedAtMs ?? 0) < RETRY_AFTER_MS) {
            throw new PagedReadError(snapshot.findError);
        }
        this.find(workspace, path, snapshot);
        return undefined;
    }

    /**
     * Ask the server which content the dataset holds, and move there — unless
     * a move lands first, which came from something no older than the answer.
     */
    protected find(workspace: string, path: TreePath, snapshot: Snapshot): void {
        const seq = ++snapshot.findSeq;
        const moves = snapshot.moves;
        snapshot.finding = true;
        const api = this.api;
        void (async () => {
            let revision: string | null;
            try {
                if (api === null) throw new Error("no PagedApi installed");
                revision = await api.getRevision(workspace, path);
            } catch (err) {
                if (!this.isLive(snapshot) || snapshot.findSeq !== seq) return;
                snapshot.finding = false;
                if (snapshot.revision !== undefined) return;
                snapshot.findError = failureOf(path, err);
                snapshot.findFailedAtMs = this.now();
                console.error(`Data.bindPaged: could not find which content ${datasetPathToString(path)} holds:`, err);
                this.notify(pagedRevisionKey(workspace, path));
                return;
            }
            if (!this.isLive(snapshot) || snapshot.findSeq !== seq) return;
            snapshot.finding = false;
            if (snapshot.moves !== moves) return;
            this.moveTo(workspace, path, snapshot, revision);
        })();
    }

    /**
     * Move a dataset's source to `revision`: drop what the old snapshot
     * delivered and re-fire every read of the dataset, so the windows and
     * searches still in use are fetched again, pinned to the new one. A move to
     * the revision the source already has changes nothing.
     */
    protected moveTo(workspace: string, path: TreePath, snapshot: Snapshot, revision: string | null): void {
        if (!this.isLive(snapshot) || snapshot.revision === revision) return;
        snapshot.revision = revision;
        snapshot.moves += 1;
        delete snapshot.findError;
        delete snapshot.findFailedAtMs;
        for (const key of snapshot.channels) {
            // A read of the old revision still in flight lands nowhere (its pin no longer holds): it is no longer the channel's.
            this.fetching.delete(key);
            // A read by another record's runs is that record's channel too: it goes from both.
            for (const owner of this.entries.get(key)?.owners ?? []) if (owner !== snapshot) owner.channels.delete(key);
            this.entries.delete(key);
            this.loadedWindows.delete(key);
            this.forgetVersion(key);
        }
        snapshot.channels.clear();
        snapshot.searches.clear();
        snapshot.held.clear();
        snapshot.within.clear();
        snapshot.pinning.clear();
        snapshot.placements.clear();
        this.notify(pagedRevisionKey(workspace, path));
    }

    /**
     * Handle what a pinned fetch threw when it is not the read's failure: a
     * refusal naming other content moves the source there, and "no value"
     * moves it to no snapshot. Returns whether the error was one of those, or
     * arrived after the source had already moved on.
     */
    protected followed(workspace: string, path: TreePath, snapshot: Snapshot, revision: string, err: unknown): boolean {
        if (!this.pinnedTo(snapshot, revision)) return true;
        if (err instanceof DatasetHashMismatchError) {
            if (err.currentHash !== null && err.currentHash !== revision) {
                this.moveTo(workspace, path, snapshot, err.currentHash);
                return true;
            }
            // A refusal that names no other content: look it up, and let this
            // read fail until the lookup moves the source.
            this.find(workspace, path, snapshot);
            return false;
        }
        const code = errorCode(err);
        if (code !== undefined && NO_VALUE_ERRORS.has(code)) {
            this.moveTo(workspace, path, snapshot, null);
            return true;
        }
        return false;
    }

    /**
     * Handle a read by a record's runs refused because the record moved
     * (#1393), as {@link followed} handles a moved dataset: a refusal naming
     * other content moves the record there; one naming none looks it up, and
     * the read fails until the lookup moves it. Returns whether the refusal
     * moved it, or arrived after it had already moved on.
     */
    protected followedRuns(workspace: string, path: TreePath, snapshot: Snapshot, revision: string, err: RunsHashMismatchError): boolean {
        if (!this.pinnedTo(snapshot, revision)) return true;
        if (err.currentHash !== null && err.currentHash !== revision) {
            this.moveTo(workspace, path, snapshot, err.currentHash);
            return true;
        }
        this.find(workspace, path, snapshot);
        return false;
    }

    // ----- channels ----------------------------------------------------------

    /** A channel of the snapshot's current revision, dropped when it moves. */
    protected channel(snapshot: Snapshot, key: string): PageEntry {
        snapshot.channels.add(key);
        const entry = this.entry(key);
        (entry.owners ??= new Set()).add(snapshot);
        return entry;
    }

    /**
     * Let a channel go (#1351): its entry, its place among its snapshots'
     * channels and the window cache, and — once nothing subscribes to it — its
     * version. A read of it makes it again, idle, and asks for it afresh.
     * Never a channel in flight: its callers let go only what no fetch waits on.
     *
     * @param key - The channel
     */
    protected dropChannel(key: string): void {
        for (const owner of this.entries.get(key)?.owners ?? []) {
            owner.channels.delete(key);
            owner.placements.delete(key);
        }
        this.entries.delete(key);
        this.loadedWindows.delete(key);
        this.forgetVersion(key);
    }

    /**
     * What a channel no reader holds any longer leaves (#1351), once the
     * reader re-subscribing has done so: nothing of a channel let go but its
     * version, which goes; a search's answer, which the revision holds apart
     * from its channel ({@link Snapshot.searches}), as it holds what batches
     * answered; and a channel holding nothing — aborted, evicted, or a batch
     * whose answer is held elsewhere — which goes. A landed window stays,
     * bounded by the windows retained: held by no reader any longer, it is the
     * cap's to let go again, and past the cap the least recently read windows
     * no reader holds go ({@link trimWindows}), so readers that held more than
     * the cap leave no more than it behind (#1409, R24). A placement stays,
     * bounded by the placements a revision holds ({@link MAX_HELD_PLACEMENTS});
     * and so do a failure and a total.
     *
     * @param key - The channel
     */
    protected letGo(key: string): void {
        if (this.isSubscribed(key) || this.fetching.has(key)) return;
        const entry = this.entries.get(key);
        if (entry === undefined) {
            this.forgetVersion(key);
            return;
        }
        if (entry.status === "loaded" && entry.range !== undefined) {
            for (const owner of entry.owners ?? []) landSearch(owner, key, entry.range);
            this.dropChannel(key);
            return;
        }
        if (holdsNothing(entry)) {
            this.dropChannel(key);
            return;
        }
        if (this.loadedWindows.has(key)) this.trimWindows();
    }

    /** Whether a channel is due a fetch: never fetched, evicted, or failed
     *  for a reason a retry can fix, longer ago than the retry gap. */
    protected due(entry: PageEntry): boolean {
        if (entry.status === "idle") return true;
        if (entry.status !== "failed" || entry.permanent === true) return false;
        return this.now() - (entry.failedAtMs ?? 0) >= RETRY_AFTER_MS;
    }

    /**
     * Mark a channel's fetch as started, returning the fetch's sequence number.
     *
     * Deliberately does NOT notify — the read that triggers it runs inside a
     * render pass, and notifying there would re-enter the renderer. Only the
     * settle notifies.
     */
    protected launch(entry: PageEntry): number {
        entry.status = "running";
        entry.launchSeq = ++this.launches;
        return entry.launchSeq;
    }

    /**
     * Mark a channel's fetch as started, as {@link launch} does, and hand it
     * the signal that aborts its requests (#1398, CL6): aborted once no read
     * waits on the channel any longer ({@link unsubscribed}). A fetch it
     * replaces is aborted. A fetch of a revision the source moves past is
     * not: the move lets go of it and of its channel, and its answer lands
     * nowhere, its pin no longer holding ({@link moveTo}).
     *
     * @param key - The channel
     * @param entry - Its entry
     * @param onAbort - What an abort lets go besides the request: what the fetch kept for its reader as it launched
     * @returns The fetch's sequence number, and its signal
     */
    protected launchFetch(key: string, entry: PageEntry, onAbort?: () => void): { seq: number; signal: AbortSignal } {
        const seq = this.launch(entry);
        this.fetching.get(key)?.controller.abort();
        const controller = new AbortController();
        this.fetching.set(key, { seq, controller, onAbort });
        return { seq, signal: controller.signal };
    }

    /** A channel's fetch is over: what aborts it is let go. */
    protected forgetFetch(key: string, seq: number): void {
        if (this.fetching.get(key)?.seq === seq) this.fetching.delete(key);
    }

    /**
     * Abort a channel's fetch still in flight, which no read waits on any
     * longer (#1398, CL6): its requests are cancelled — a request still to be
     * sent, a retry among them, never is — and the channel goes back to
     * `idle`, so a read that asks for it again fetches it afresh. Nothing is
     * notified: no reader is waiting on it.
     *
     * @param key - The channel
     */
    protected abortFetch(key: string): void {
        const fetch = this.fetching.get(key);
        if (fetch === undefined) return;
        this.fetching.delete(key);
        fetch.controller.abort();
        const entry = this.entries.get(key);
        if (entry !== undefined && entry.launchSeq === fetch.seq && entry.status === "running") {
            entry.status = "idle";
            entry.launchSeq = ++this.launches;
        }
        fetch.onAbort?.();
    }

    /** Apply a fetch's outcome if the channel still waits on it, letting
     *  the fetch go once the channel has settled. Returns whether it applied. */
    protected apply(key: string, seq: number, mutate: (entry: PageEntry) => void): boolean {
        const entry = this.entries.get(key);
        if (entry === undefined || entry.launchSeq !== seq) return false;
        mutate(entry);
        if (entry.status !== "running") this.forgetFetch(key, seq);
        return true;
    }

    /** Apply a fetch's outcome if the channel still waits on it, re-firing the
     *  channel's reads. Returns whether it applied. */
    protected settle(key: string, seq: number, mutate: (entry: PageEntry) => void): boolean {
        if (!this.apply(key, seq, mutate)) return false;
        this.notify(key);
        return true;
    }

    /** A failed fetch's outcome: the reason a read will throw. */
    protected failure(reason: string, permanent: boolean): (entry: PageEntry) => void {
        return (e) => {
            e.status = "failed";
            e.error = reason;
            e.failedAtMs = this.now();
            e.permanent = permanent;
        };
    }

    /** Settle a fetch as failed, with the reason a read will throw. */
    protected fail(key: string, seq: number, reason: string, permanent: boolean): void {
        this.settle(key, seq, this.failure(reason, permanent));
    }

    /**
     * Join this turn's burst of searches of one source's rows (#1360), opening
     * it with the turn's first. It closes as the turn ends.
     *
     * @param family - The rows searched — {@link pagedWindowFamily}
     * @returns The burst
     */
    protected joinBurst(family: string): SearchBurst {
        let burst = this.bursts.get(family);
        if (burst === undefined) {
            const opened: SearchBurst = { open: true, pending: 0, answered: [] };
            this.bursts.set(family, opened);
            queueMicrotask(() => {
                opened.open = false;
                if (this.bursts.get(family) === opened) this.bursts.delete(family);
                this.flushBurst(opened);
            });
            burst = opened;
        }
        burst.pending += 1;
        return burst;
    }

    /**
     * A member of a burst is done: answered, or dropped — by a move, or by a
     * newer launch on its channel.
     *
     * @param burst - Its burst
     * @param answered - Its channel, when its answer was applied
     */
    protected leaveBurst(burst: SearchBurst, answered: string | undefined): void {
        if (answered !== undefined) burst.answered.push(answered);
        burst.pending -= 1;
        this.flushBurst(burst);
    }

    /** Re-fire every channel a closed burst answered, once its last member is done. */
    protected flushBurst(burst: SearchBurst): void {
        if (burst.open || burst.pending > 0 || burst.answered.length === 0) return;
        this.notifyAll(burst.answered.splice(0));
    }

    /**
     * Ask again what failed: an explicit refresh — a Retry — puts every channel
     * of the snapshot that failed for a reason a retry can fix back to `idle`
     * and re-fires its readers, so their next read fetches it at once, not
     * after the retry gap a read alone waits. A permanent failure stays until
     * the source moves; nothing else is dropped.
     *
     * @param snapshot - The source's snapshot
     */
    protected rearmFailed(snapshot: Snapshot): void {
        for (const key of snapshot.channels) {
            const entry = this.entries.get(key);
            if (entry === undefined || entry.status !== "failed" || entry.permanent === true) continue;
            entry.status = "idle";
            delete entry.error;
            delete entry.failedAtMs;
            this.notify(key);
        }
    }

    /**
     * A Retry of a dataset, following its current state: what failed asked
     * again now ({@link rearmFailed}), and the content it holds looked up
     * again — what `refresh` with no target and {@link askAgain} both ask.
     *
     * @param workspace - The workspace the Retry was asked in: another one since installed asks nothing
     * @param path - The dataset's path
     */
    protected retryNow(workspace: string, path: TreePath): void {
        if (this.workspace !== workspace) return;
        const snapshot = this.snapshotOf(workspace, path);
        this.rearmFailed(snapshot);
        this.find(workspace, path, snapshot);
    }

    /** What a read of a channel answers: its value once loaded, `none` while
     *  in flight, or its failure, thrown as a {@link PagedReadError}. */
    protected answer<T>(entry: PageEntry, value: T | undefined): option<T> {
        if (entry.status === "loaded" && value !== undefined) return some(value);
        if (entry.status === "failed") throw new PagedReadError(entry.error ?? "Data.bindPaged: the read failed");
        return none;
    }

    /** Note a window as most-recently-read, and let the coldest windows no
     *  reader holds go once more have landed than the cap ({@link trimWindows}). */
    protected touchWindow(key: string): void {
        this.loadedWindows.delete(key);
        this.loadedWindows.set(key, true);
        this.trimWindows();
    }

    /**
     * Past {@link MAX_RETAINED_WINDOWS} landed windows, let the least recently
     * read that no reader holds go, whole (#1351), coldest first, until the
     * cap holds or none is left to go.
     *
     * A window a reader holds is never evicted under it: one a reader
     * subscribes to — what its last run read — and one the evaluation in hand
     * has read, which it subscribes to as it ends. A read pass longer than the
     * cap would otherwise evict its own head, find it gone on its next pass and
     * blank the surface (#581). And evicted while a reader held it, a window
     * went `idle` without its reader being told, so the reader's next run, set
     * off by any other landing, read it again: a reader of more windows than
     * the cap — rows read a key at a time, each a key search and a one-row
     * window, or windows several readers hold between them — never settled,
     * each landing evicting one it held (#1409, R24). Past the cap the runtime
     * keeps what its readers hold alone, each reader bounding that by its own
     * demand: exceeding a memory target beats a surface that never settles.
     *
     * A window still in flight is never evicted either: its settle would land
     * on an entry the next read has already relaunched.
     */
    protected trimWindows(): void {
        if (this.loadedWindows.size <= MAX_RETAINED_WINDOWS) return;
        for (const candidate of [...this.loadedWindows.keys()]) {
            if (this.loadedWindows.size <= MAX_RETAINED_WINDOWS) break;
            if (this.isTracked(candidate) || this.isSubscribed(candidate)) continue;
            const entry = this.entries.get(candidate);
            if (entry === undefined || entry.status !== "loaded") continue;
            this.dropChannel(candidate);
        }
    }

    /**
     * Note a placement as its revision's most recently read, and let the least
     * recently read go past {@link MAX_HELD_PLACEMENTS} (#1349): a viewer trying
     * narrowing after narrowing leaves each one's placement behind, which
     * nothing else lets go while the revision stands. One a reader holds, one
     * the read in hand has read, and one still in flight stay — the revision
     * over its bound, rather than a reader's placement asked again.
     *
     * @param snapshot - The placement's revision
     * @param key - The placement's channel
     */
    protected touchPlacement(snapshot: Snapshot, key: string): void {
        snapshot.placements.delete(key);
        snapshot.placements.set(key, true);
        if (snapshot.placements.size <= MAX_HELD_PLACEMENTS) return;
        for (const candidate of [...snapshot.placements.keys()]) {
            if (snapshot.placements.size <= MAX_HELD_PLACEMENTS) break;
            if (candidate === key || this.isSubscribed(candidate) || this.isTracked(candidate) || this.fetching.has(candidate)) continue;
            snapshot.placements.delete(candidate);
            this.dropChannel(candidate);
        }
    }
}
