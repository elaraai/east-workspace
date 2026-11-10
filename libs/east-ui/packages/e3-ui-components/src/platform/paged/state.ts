/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the paging runtime holds, and its bounds: a channel's entry, a dataset's
 * snapshot — the content every bind of it is pinned to, and what that content
 * delivered apart from a channel: searches' bounds, rows read by key, a
 * narrowing's membership answers and its placements — and the bookkeeping that
 * keeps each within its bound. A move of the snapshot drops them all.
 *
 * @packageDocumentation
 */

import { SortedMap } from "@elaraai/east";
import { MAX_LANDED_SEARCHES } from "@elaraai/east-ui/internal";
import type { DatasetFindResult } from "@elaraai/e3-api-client";

import type { PagedRow, PagedPlacement } from "./api.js";

/** One tracked channel per window, per total and per search. */
export interface PageEntry {
    status: "idle" | "running" | "loaded" | "failed";
    /** The fetch the channel waits on; a settling fetch that is no longer it
     *  is discarded. Unique across the runtime, so a channel dropped by a move
     *  and made again never mistakes an old fetch for its own. */
    launchSeq: number;
    /** The decoded window — a value of the dataset's own type. */
    window?: unknown;
    /** A landed window's place: its family (the source, its rows and the
     *  revision), its first element's offset, and how many elements it holds —
     *  a window the server trimmed holds fewer than it asked for. A read it
     *  covers is answered from it (#1217). */
    span?: WindowSpan;
    /** Where a window in flight asked: its family, its first element's offset,
     *  and how many elements it asked for. A read it covers waits on it (#1596). */
    asking?: WindowSpan;
    /** A landed runs read's place (#1351): its family, and where each run's
     *  entries sit in it — a read inside one of its runs is answered from it,
     *  as from a window's span. */
    runSpans?: RunSpans;
    /** Total elements in the source, learned from any landed window. */
    total?: number;
    /** Where a key query landed — the answer on a seek channel. */
    range?: DatasetFindResult;
    /** A batch of key searches' answer (#1351): every search it asks's
     *  bounds, in the order asked — the answer on a `seekAll` channel. */
    ranges?: DatasetFindResult[];
    /** A rows read's answer, every key asked's row in order — the answer on a
     *  rows batch's channel (#1351). */
    rows?: readonly PagedRow[];
    /** A placement's answer so far — the answer on a placement's channel
     *  (#1349), set as each of its windows lands. */
    placement?: PagedPlacement;
    /** Why the last attempt failed — what a read of the channel throws. */
    error?: string;
    /** When the last attempt failed, so a retry can be rate-limited. */
    failedAtMs?: number;
    /** No retry can help while the source holds the same content. */
    permanent?: boolean;
    /** The snapshots whose channels hold it: its dataset's, and for a read by
     *  another record's runs that record's too (#1393) — what a channel let go
     *  leaves. */
    owners?: Set<Snapshot>;
}

/** Where a landed window sits in its source's row space (#1217). */
interface WindowSpan {
    /** The window's family — {@link pagedWindowFamily}: a read of another
     *  family is never answered from it. */
    readonly family: string;
    /** Its first element's offset. */
    readonly offset: number;
    /** How many elements it holds. */
    readonly count: number;
}

/** Where a landed runs read's entries sit in its source's row space (#1351). */
export interface RunSpans {
    /** The read's family — {@link pagedWindowFamily}. */
    readonly family: string;
    /** Each run, ascending: its first row, how many entries it holds, and
     *  where they start in the read's window. */
    readonly runs: readonly { readonly row: number; readonly count: number; readonly at: number }[];
}

/** Searches of one source's rows launched in one synchronous turn (#1360). */
export interface SearchBurst {
    /** Whether a search may still join: until the turn that opened it ends. */
    open: boolean;
    /** Members still in flight. */
    pending: number;
    /** The channels its members answered, landed or failed, to re-fire once
     *  the last is done. */
    readonly answered: string[];
}

/** What every bind of one dataset shares: the content its reads are pinned to. */
export interface Snapshot {
    /** The dataset's revision channel, as snapshots are keyed — the channel
     *  every read of the dataset tracks. */
    readonly key: string;
    /** The content hash reads are pinned to: `undefined` until found, `null`
     *  while the dataset has no value. */
    revision: string | null | undefined;
    /** Moves so far. A lookup that began before a move answers for content no
     *  newer than the move's, so its answer is dropped. */
    moves: number;
    /** The latest lookup of the revision; only it settles. */
    findSeq: number;
    /** Whether a lookup is in flight. */
    finding: boolean;
    /** Why the last lookup failed, while the revision is unknown. */
    findError?: string;
    /** When the last lookup failed, so a retry can be rate-limited. */
    findFailedAtMs?: number;
    /** The channels of the current revision, dropped when it moves. */
    readonly channels: Set<string>;
    /** The bounds of searches the revision holds apart from a channel, by the
     *  search's channel key, the least recently used first: what batches
     *  answered (#1351), and a search's own answer once no reader holds its
     *  channel — at most {@link MAX_LANDED_SEARCHES}, as the record Slice keeps
     *  its own. Dropped when it moves. */
    readonly searches: Map<string, DatasetFindResult>;
    /** The rows reads by key have held at this revision, by the family of the
     *  rows they read (#1351): a search by one of their keys, and a one-row
     *  page at one's position, answer from them. Dropped when it moves. */
    readonly held: Map<string, HeldRows>;
    /** Which entry keys a narrowing's runs hold, as membership reads have
     *  answered them at this revision, by the runs (#1349), the least recently
     *  used narrowing first. Dropped when it moves, with what each batch kept
     *  for its reader. */
    readonly within: Map<string, HeldWithin>;
    /** Each membership batch keeping keys for its reader, over every
     *  narrowing, the oldest first, beside the answers it keeps them in. */
    readonly pinning: Map<string, HeldWithin>;
    /** The placements the revision holds, by their channel, the least recently
     *  read first (#1349): at most {@link MAX_HELD_PLACEMENTS} narrowings', but
     *  never one a reader holds. Dropped when it moves. */
    readonly placements: Map<string, true>;
    /** Stops following the dataset; `undefined` while it is not followed —
     *  nothing reads it, or no adapter is installed. */
    unwatch: (() => void) | undefined;
}

/** The rows reads by key have held at one revision, of one family (#1351). */
export interface HeldRows {
    /** Every key answered: its row or absence, and its position. */
    readonly byKey: SortedMap<unknown, PagedRow>;
    /** The rows the dataset holds, by their position. */
    readonly byPosition: Map<number, PagedRow>;
}

/** The most rows a family holds from reads by key; past it, what it held goes
 *  and the newest read's rows are held alone. */
export const MAX_HELD_ROWS = 20_000;

/**
 * Keep a search's bounds among those a revision holds apart from a channel
 * (#1351), the most recently used; past {@link MAX_LANDED_SEARCHES}, the least
 * recently used go.
 *
 * @param snapshot - The revision's snapshot
 * @param key - The search's channel key
 * @param range - Its bounds
 */
export function landSearch(snapshot: Snapshot, key: string, range: DatasetFindResult): void {
    snapshot.searches.delete(key);
    snapshot.searches.set(key, range);
    if (snapshot.searches.size > MAX_LANDED_SEARCHES) snapshot.searches.delete(snapshot.searches.keys().next().value!);
}

/**
 * A search's bounds the revision holds apart from a channel, now its most
 * recently used.
 *
 * @param snapshot - The revision's snapshot
 * @param key - The search's channel key
 * @returns Its bounds, or `undefined` when the revision holds none of it
 */
export function heldSearch(snapshot: Snapshot, key: string): DatasetFindResult | undefined {
    const range = snapshot.searches.get(key);
    if (range === undefined) return undefined;
    snapshot.searches.delete(key);
    snapshot.searches.set(key, range);
    return range;
}

/** What a channel holds that a read answers from, besides a failure: nothing at all, and a read of it asks again. */
export function holdsNothing(entry: PageEntry): boolean {
    return entry.status !== "failed" && entry.window === undefined && entry.rows === undefined && entry.range === undefined
        && entry.ranges === undefined && entry.placement === undefined && entry.total === undefined;
}

/** How many windows of a placement are asked at once (#1349). */
export const PLACE_CONCURRENCY = 4;

/** The most entry keys one membership read asks of (#1349): a reader asks of
 *  more in parts. */
export const MAX_WITHIN_KEYS = 20_000;

/** The most membership answers a revision holds, over every narrowing's runs;
 *  past it, the least recently used narrowing's least recently read answers
 *  go first — but never one a batch keeps for its reader ({@link HeldWithin}),
 *  so the answers a read waits on are held when it reads again, whatever other
 *  readers' answers land meanwhile, under whatever narrowing. */
const MAX_HELD_WITHIN = 2 * MAX_WITHIN_KEYS;

/** The most membership batches that keep keys for their readers at once, over
 *  every narrowing of a revision; past it, the oldest batch's keys are trimmed
 *  as any are. What batches keep is bounded by it, so the answers held never
 *  pass {@link MAX_HELD_WITHIN} by more than the keys of this many batches. */
const MAX_PINNING_BATCHES = 16;

/** The most narrowings whose placements a revision holds (#1349), as many as
 *  the membership batches it keeps for their readers
 *  ({@link MAX_PINNING_BATCHES}): a viewer trying narrowing after narrowing
 *  leaves each one's placement behind, and past this the least recently read
 *  of those no reader holds go. */
export const MAX_HELD_PLACEMENTS = MAX_PINNING_BATCHES;

/**
 * Which entry keys one narrowing's runs hold, as membership reads answered
 * them at one revision (#1349), and what each batch keeps for its reader.
 *
 * A batch keeps every key its reader asks of — those already held when it
 * launches, and those its answer brings — until a read that holds every key
 * it asks of reads them. So however many readers' answers land between a
 * batch's landing and its reader's next read, trimming to
 * {@link MAX_HELD_WITHIN} never takes an answer the reader is waiting to
 * read, and each reader reads its answers after one batch: no reader's
 * landing undoes another's.
 */
interface HeldWithin {
    /** Each entry key's answer, the least recently read first: a read moves the keys it reads to the end. */
    readonly answers: Map<string, boolean>;
    /** The batches that keep each key, until a read reads it. */
    readonly pins: Map<string, Set<string>>;
    /** Each batch keeping keys, the oldest first: the keys its reader asks of, and how many of them it keeps still. */
    readonly batches: Map<string, KeepingBatch>;
}

/** A batch that keeps keys for its reader: the keys its reader asks of, and how many of them it keeps still. */
interface KeepingBatch {
    /** Every key its reader asks of. */
    readonly keys: readonly string[];
    /** How many of them it keeps until a read reads them: once a read has read the last, it keeps nothing. */
    kept: number;
}

/**
 * The membership answers one narrowing's runs hold, made empty on first use:
 * from now the revision's most recently used narrowing, whose answers a trim
 * takes last.
 */
export function heldWithinOf(snapshot: Snapshot, family: string): HeldWithin {
    let held = snapshot.within.get(family);
    if (held === undefined) held = { answers: new Map(), pins: new Map(), batches: new Map() };
    else snapshot.within.delete(family);
    snapshot.within.set(family, held);
    return held;
}

/**
 * Keep keys for a batch until its reader reads them. Past
 * {@link MAX_PINNING_BATCHES} over every narrowing of the revision, the oldest
 * batch keeps its keys no longer.
 *
 * @param snapshot - The revision's snapshot
 * @param held - The answers one narrowing's runs hold
 * @param batch - The batch's channel key
 * @param keys - Every key its reader asks of
 * @param kept - The keys it keeps now: those held as it launches, or those its answer brings
 */
export function keepWithin(snapshot: Snapshot, held: HeldWithin, batch: string, keys: readonly string[], kept: Iterable<string>): void {
    let keeping = held.batches.get(batch);
    for (const key of kept) {
        let by = held.pins.get(key);
        if (by === undefined) {
            by = new Set();
            held.pins.set(key, by);
        }
        if (by.has(batch)) continue;
        by.add(batch);
        if (keeping === undefined) {
            keeping = { keys, kept: 0 };
            held.batches.set(batch, keeping);
            snapshot.pinning.set(batch, held);
        }
        keeping.kept += 1;
    }
    while (snapshot.pinning.size > MAX_PINNING_BATCHES) {
        const [oldest, of] = snapshot.pinning.entries().next().value!;
        releaseWithin(snapshot, of, oldest);
    }
}

/** A batch keeps its keys no longer: they are trimmed as any are, unless another batch keeps them. */
export function releaseWithin(snapshot: Snapshot, held: HeldWithin, batch: string): void {
    snapshot.pinning.delete(batch);
    const keeping = held.batches.get(batch);
    if (keeping === undefined) return;
    held.batches.delete(batch);
    for (const key of keeping.keys) {
        const by = held.pins.get(key);
        if (by === undefined || !by.delete(batch)) continue;
        if (by.size === 0) held.pins.delete(key);
    }
}

/**
 * A read that holds every key it asks of has read them: each moves to the
 * end, the most recently read, and no batch keeps it any longer — however
 * many kept it, since the read answers every reader asking of it alike. A
 * batch whose last kept key a read has read keeps nothing, and is done.
 */
export function readWithin(snapshot: Snapshot, held: HeldWithin, keys: readonly string[]): void {
    for (const key of keys) {
        const answer = held.answers.get(key);
        if (answer === undefined) continue;
        held.answers.delete(key);
        held.answers.set(key, answer);
        const by = held.pins.get(key);
        if (by === undefined) continue;
        held.pins.delete(key);
        for (const batch of by) {
            const keeping = held.batches.get(batch);
            if (keeping !== undefined && --keeping.kept === 0) {
                held.batches.delete(batch);
                snapshot.pinning.delete(batch);
            }
        }
    }
    trimWithin(snapshot);
}

/**
 * Past {@link MAX_HELD_WITHIN} answers over every narrowing of the revision,
 * the least recently used narrowing's least recently read answers go first —
 * but none a batch keeps — and a narrowing left holding none, and with no
 * batch keeping any, goes with them.
 */
export function trimWithin(snapshot: Snapshot): void {
    let total = 0;
    for (const held of snapshot.within.values()) total += held.answers.size;
    if (total <= MAX_HELD_WITHIN) return;
    for (const [family, held] of snapshot.within) {
        for (const key of held.answers.keys()) {
            if (total <= MAX_HELD_WITHIN) break;
            if (held.pins.has(key)) continue;
            held.answers.delete(key);
            total -= 1;
        }
        if (held.answers.size === 0 && held.batches.size === 0) snapshot.within.delete(family);
        if (total <= MAX_HELD_WITHIN) return;
    }
}
