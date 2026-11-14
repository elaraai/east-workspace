/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lens's reads over a record (#1349): where e3 places the narrowing's
 * rows, and the rows of the segments that hold them near the view, each read
 * by position with one ask of which of them the narrowing holds. What it has
 * read it lays out ({@link layoutLens}): the narrowing's rows, one after
 * another in the order of the rows the page holds — the record's own, or on a
 * scoped page the scope's alone (#1621), through the index on exactly its
 * fields, in their keys' order under each of its values.
 *
 * - **Placement.** `recordSliceBasePlace` reads where the narrowing's rows sit
 *   among the page's rows, segment by segment, from the index alone, its
 *   windows landing a few at a time: the lens draws as they land. On a scoped
 *   page a segment is the rows one record segment holds of one of the scope's
 *   values.
 * - **Segments near the view.** Each segment of matches the view meets, and
 *   the nearest beyond it either side, is read — its rows through the sheet's
 *   rows source, by position, and which of them the narrowing holds through
 *   `recordSliceBaseWithinAt`, over the same page — a turn at a time, at most the
 *   lens's budget of pages in flight, so the record Slice's and the paging
 *   runtime's bounded caches hold every page it waits on; what has landed is
 *   kept while the view wants it, so a view meeting more segments than one
 *   turn reads is read whole, turn by turn. A segment with no match is never
 *   read.
 * - **What it has read** is kept by the record's revision and the narrowing:
 *   a choice keeps the rows, its matches asked again; a new revision reads
 *   both again. Until a new narrowing or revision is laid out — its placement
 *   begun and the segments near the view read — the last layout stands in, so
 *   the sheet never empties between them. Switched off, the lens keeps its
 *   last layout for its host to stand in while the pages are read again.
 * - **A source read another way** — its id the same, its page no longer
 *   equivalent to the one that read the rows (#809) — has every row read
 *   again, and the last layout stands in until they are (#1599), retained
 *   ({@link RecordLens.reread}): its rows are the last reading's. At rest they
 *   are read in the same turn; while a read of the record is on its way they
 *   are not, and the sheet emptied to its bands whenever its author's block
 *   was evaluated again meanwhile.
 * - **A key search's jump** reads where its row is, beside the view, until
 *   that row is drawn — its host then scrolls to it — or is known to be a row
 *   the narrowing does not hold, when its host clears the filters that hide
 *   it and jumps again under the narrowing they leave (the hidden pick,
 *   `hidden.ts`): the view's own rows stay drawn throughout, and a jump made
 *   as a new narrowing is read lands once that narrowing draws the row.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { StringType, equalFor, equivalentFor, none, printFor, type ValueTypeOf } from "@elaraai/east";
import { Sheet } from "@elaraai/e3-ui/internal";
import { RecordSliceWhereType, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { entryLookup, recordSliceBasePlace, recordSliceBaseWithinAt, type EntryLookup } from "@elaraai/east-ui-components/internal";
import { sourceChange } from "../shared/windowed.js";
import {
    layoutLens, lensDemand, lensPieces, lensReadInTurns, lensRegions,
    type LensFacts, type LensGeometry, type LensLayout, type LensPiece, type LensPlacement, type LensRow, type LensSegmentState, type LensWords,
} from "./lens-layout.js";
import type { SheetPagedSourceValue, SheetRowValue } from "./values.js";

type Where = ValueTypeOf<typeof RecordSliceWhereType>;

/** The most pages the lens has in flight at once: well within the record Slice's 32 cached pages and the paging runtime's held answers. */
export const LENS_BUDGET = 16;

/** The segments past the view on either side the lens reads. */
const LENS_BEYOND = 2;

const printWhere = printFor(RecordSliceWhereType);
const stringEqual = equalFor(StringType);
/** Whether two sources serve the same rows: the same id and equivalent functions, as the paged driver asks (#809). */
const sourceEquivalent = equivalentFor(Sheet.Types.Root.fields.rows.cases.paged);

/** One line naming why a read failed. */
function readFailure(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** What the lens has read of one piece, at one revision. */
interface LandedPiece {
    rows?: readonly SheetRowValue[] | undefined;
    /** The stored entries the piece's page carried beside its rows (#1599), by id. */
    entries?: EntryLookup | undefined;
    hits?: readonly boolean[] | undefined;
    error?: string | undefined;
}

/** What the lens has read, and at which revision and narrowing. */
interface LensCache {
    /** The source the rows were read from. */
    source: SheetPagedSourceValue | undefined;
    /** The revision the rows and the answers are at. */
    revision: string | undefined;
    /** The narrowing the answers are for, printed. */
    query: string | undefined;
    /** Each piece's rows, by its key: a narrowing's choice keeps them. */
    rows: Map<string, readonly SheetRowValue[]>;
    /** The stored entries each piece's page carried beside those rows (#1599), by the piece's key: kept and let go with its rows. */
    entries: Map<string, EntryLookup>;
    /** Each piece's answers, by its key: for the narrowing and the revision. */
    hits: Map<string, readonly boolean[]>;
    /** Why each piece's read failed: not asked again until a Retry. */
    failures: Map<string, string>;
    /**
     * Whether its rows are read again for a source that reads them another way (#1599): until the rows near the view
     * have landed so, the layout the last reading drew stands in.
     */
    reread: boolean;
}

function emptyCache(source: SheetPagedSourceValue | undefined, reread = false): LensCache {
    return { source, revision: undefined, query: undefined, rows: new Map(), entries: new Map(), hits: new Map(), failures: new Map(), reread };
}

/** What the lens's evaluation read. */
interface LensRead {
    revision: string | undefined;
    query: string;
    placement: LensPlacement | undefined;
    /** Why the placement could not be read. */
    placementError: string | undefined;
    pieces: readonly LensPiece[];
    landed: ReadonlyMap<string, LandedPiece>;
    /** Whether the placement has begun and every read near the view has landed: a layout to swap in. */
    ready: boolean;
    /** Whether a read the lens asked for is still in flight. */
    loading: boolean;
    /** The segments of matches it is reading, by their first rows, in the order it reads them — a jump's, then the view's. */
    reading: readonly number[];
    /** Whether the rows are read again for a source that reads them another way, and those near the view have still to land. */
    reread: boolean;
}

/** A layout, the revision and narrowing it laid out, and the entries its rows were read with. */
interface Shown {
    layout: LensLayout;
    revision: string | undefined;
    query: string;
    /** The stored entry the page that read the row at a position carried for an id (#1599): this layout's own reading's. */
    entryOf: (id: string, at: number) => Uint8Array | undefined;
}

/** No entry: a lens that draws nothing. */
const NO_ENTRY = (): undefined => undefined;

/** The view, as the record's rows its first and last items stand for, under the narrowing it was reported under. */
interface LensView {
    from: number;
    to: number;
    query: string;
}

/** The lens's view of the record, as the sheet draws it. */
export interface RecordLens {
    /** The layout drawn: the narrowing's, the last one while a new narrowing or revision is read, or — switched off — the last one, kept for its host. */
    layout: LensLayout | undefined;
    /** The rows that layout draws, in the order of the rows the page holds, and each one's position among them. */
    rows: readonly SheetRowValue[];
    positions: readonly number[];
    /** The rows the page holds — the record's, or on a scoped page the scope's (#1621) — once placed. */
    total: number | undefined;
    /** How many rows the narrowing holds, once placed. */
    matches: number | undefined;
    /** The record's revision the lens reads at, once known: what the answers of which choices hide a row are kept by. */
    revision: string | undefined;
    /**
     * Whether the layout drawn was read before that revision: the last one's, standing in while this one's is read —
     * what a Save's rows are drawn over as it left them, never as they were before it.
     */
    readBefore: boolean;
    /** Whether the narrowing's layout is drawn: its placement begun and the segments near the view read. */
    ready: boolean;
    /** Whether a read is still in flight. */
    loading: boolean;
    /**
     * The segments of matches it is reading, each by its first row — a piece of it wanted and not landed yet, on its way
     * or waiting a turn — in the order it reads them: a jump's, then those the view meets, then those beyond it. What its
     * host names and marks busy of the stretches it draws as bands (#1398): never one it is not reading.
     */
    reading: readonly number[];
    /** The last layout stands in while a new narrowing is read. */
    replacing: boolean;
    /**
     * The last layout stands in while its rows are read again for a source that reads them another way (#1599):
     * retained, since its rows are the last reading's, until the rows near the view have landed.
     */
    reread: boolean;
    /** Why the placement could not be read, while rows show beside it. */
    sourceError: string | undefined;
    /** Why the placement could not be read, when nothing has been drawn. */
    error: string | undefined;
    /** Bumps when what is drawn changes height at a constant count. */
    sizeVersion: number;
    /** A key search's jump: its row, and whether it is drawn — or known to be a row the narrowing does not hold. */
    jump: { window: number; settled: boolean } | undefined;
    /** The view moved: the rows its first and last items stand for, read at rest. */
    reportViewport: (from: number, to: number, isScrolling: boolean) => void;
    /** Read where a row is, beside the view, until it is drawn — its host scrolls to it — or known hidden. */
    jumpToElement: (position: number) => void;
    /** Drop the jump: where it drew its row, the view stays read there until the frame reports where it rests. */
    clearJump: () => void;
    /** Ask again: a failed segment, by its first row, or with none everything that failed. */
    retry: (w?: number) => void;
    /**
     * The stored entry the page that read the row drawn at a position carried for an id (#1599) — the reading the layout
     * drawn was made from, the last one's while it stands in: what a gesture on a row the lens shows begins from, and
     * what its marks are read over. `undefined` where the source's pages carry none.
     */
    entryOf: (id: string, at: number) => Uint8Array | undefined;
}

/** What {@link useRecordLens} lays out over. */
export interface RecordLensInput {
    /**
     * The rows the page holds of the record, every one in their order — the record's own, or on a scoped page the
     * scope's (#1621) — `undefined` while the lens is off.
     */
    source: SheetPagedSourceValue | undefined;
    /** The `rows` source's part of the slice: what places the narrowing among those rows and asks which of them it holds. */
    part: ValueTypeOf<RecordSliceBindType> | undefined;
    /** The narrowing. */
    where: Where | undefined;
    geometry: LensGeometry;
    words: LensWords;
}

/** The view before any is reported: the record's first row. */
const NO_VIEW: LensView = { from: 0, to: 0, query: "" };

/** No segment read. */
const NOT_READING: readonly number[] = [];

/**
 * Reads and lays out the lens over a record (#1349).
 *
 * @param input - The record's rows, the narrowing, and how the lens draws
 * @returns What the sheet draws, and the callbacks it feeds back
 */
export function useRecordLens(input: RecordLensInput): RecordLens {
    const { source, part, where, geometry, words } = input;
    const active = source !== undefined && part !== undefined && where !== undefined;
    const query = where === undefined ? "" : printWhere(where);
    // The view, by the narrowing it was reported under: a new narrowing starts at the top.
    const [viewport, setViewport] = useState<LensView>(NO_VIEW);
    const viewFrom = viewport.query === query ? viewport.from : 0;
    const viewTo = viewport.query === query ? viewport.to : 0;
    const [retries, setRetries] = useState(0);
    const [jumpTarget, setJumpTarget] = useState<number | undefined>(undefined);
    const jumpRef = useRef(jumpTarget);
    jumpRef.current = jumpTarget;
    const queryRef = useRef(query);
    queryRef.current = query;
    // Whether the pending jump's row is drawn: the host scrolls to it then.
    const jumpDrawnRef = useRef(false);
    const cacheRef = useRef<LensCache>(emptyCache(undefined));

    const read = useCallback((): LensRead | undefined => {
        void retries;
        if (source === undefined || part === undefined || where === undefined) return undefined;
        const held = cacheRef.current;
        // A source that is not the one that read the rows reads them all again (#809) — and where it is the same source
        // reading them another way, the layout the last reading drew stands in until they land (#1599).
        const change = sourceChange(held.source, source, sourceEquivalent);
        if (change !== "same") cacheRef.current = emptyCache(source, change === "reread");
        const cache = cacheRef.current;
        const r = source.revision?.();
        const revision = r?.type === "some" ? r.value : undefined;
        if (revision !== cache.revision) {
            cache.revision = revision;
            cache.rows = new Map();
            cache.entries = new Map();
            cache.hits = new Map();
            cache.failures = new Map();
        }
        if (query !== cache.query) {
            cache.query = query;
            cache.hits = new Map();
            cache.failures = new Map();
        }
        let placement: LensPlacement | undefined;
        let placementError: string | undefined;
        try {
            const placed = recordSliceBasePlace(part, where);
            if (placed.type === "some") {
                placement = {
                    records: Number(placed.value.records),
                    segments: placed.value.segments.map((s) => ({ offset: Number(s.offset), count: Number(s.count), matches: Number(s.rows) })),
                    matches: Number(placed.value.total), placed: Number(placed.value.placed), complete: placed.value.complete,
                };
            }
        } catch (err) {
            console.error("[Sheet] the lens could not place the narrowing's rows:", err);
            placementError = readFailure(err);
        }
        let pending = false;
        const landed = new Map<string, LandedPiece>();
        // The segments a piece of which is wanted and not landed yet — on its way, or waiting a turn — in the order wanted.
        const reading: number[] = [];
        let pieces: LensPiece[] = [];
        if (placement !== undefined) {
            pieces = lensPieces(lensRegions(placement));
            // A pending jump's segments first, then the view's: the view keeps what it draws while the jump reads.
            const seen = new Set<number>();
            const wanted = [
                ...(jumpTarget === undefined ? [] : lensDemand(pieces, jumpTarget, jumpTarget, LENS_BEYOND)),
                ...lensDemand(pieces, viewFrom, viewTo, LENS_BEYOND),
            ].filter((group) => {
                const segment = group[0]!.segment;
                if (seen.has(segment)) return false;
                seen.add(segment);
                return true;
            });
            // A piece has landed whole once its rows, and which of them the narrowing holds, are kept; a failed one is
            // not asked again until a Retry.
            const whole = (p: LensPiece): boolean => cache.failures.has(p.key) || (cache.rows.has(p.key) && cache.hits.has(p.key));
            lensReadInTurns(wanted, whole, (p) => {
                try {
                    if (!cache.rows.has(p.key)) {
                        const page = source.page(BigInt(p.from), BigInt(p.count));
                        if (page.type === "some") {
                            // One read: the page's rows, and the entries they were made from.
                            cache.rows.set(p.key, page.value.rows);
                            cache.entries.set(p.key, entryLookup(page.value.entries));
                        }
                    }
                    if (!cache.hits.has(p.key)) {
                        const asked = recordSliceBaseWithinAt(part, where, BigInt(p.from), BigInt(p.count));
                        if (asked.type === "some") cache.hits.set(p.key, asked.value);
                    }
                } catch (err) {
                    console.error(`[Sheet] the lens could not read rows ${p.from + 1}–${p.from + p.count}:`, err);
                    cache.failures.set(p.key, readFailure(err));
                }
                return whole(p);
            }, LENS_BUDGET);
            // Every piece wanted, as far as it has landed: one still to land — in flight, or waiting for a later
            // turn — keeps the layout from being the narrowing's yet.
            for (const group of wanted) {
                for (const p of group) {
                    const failed = cache.failures.get(p.key);
                    if (failed !== undefined) { landed.set(p.key, { error: failed }); continue; }
                    const piece: LandedPiece = { rows: cache.rows.get(p.key), entries: cache.entries.get(p.key), hits: cache.hits.get(p.key) };
                    if (piece.rows === undefined || piece.hits === undefined) {
                        pending = true;
                        if (!reading.includes(p.segment)) reading.push(p.segment);
                    }
                    landed.set(p.key, piece);
                }
            }
            // What left the view leaves the cache: the record Slice and the paging runtime keep their own, bounded.
            for (const key of [...cache.rows.keys()]) if (!landed.has(key)) { cache.rows.delete(key); cache.entries.delete(key); }
            for (const key of [...cache.hits.keys()]) if (!landed.has(key)) cache.hits.delete(key);
            for (const key of [...cache.failures.keys()]) if (!landed.has(key)) cache.failures.delete(key);
        }
        const ready = placement !== undefined && !pending;
        const loading = placementError === undefined && (placement === undefined || !placement.complete || pending);
        // Read again for a source that reads them another way: once the rows near the view have landed, they are its own.
        if (cache.reread && (ready || placementError !== undefined)) cache.reread = false;
        return { revision, query, placement, placementError, pieces, landed, ready, loading, reading, reread: cache.reread };
    }, [source, part, where, query, viewFrom, viewTo, jumpTarget, retries]);

    const { result } = useTrackedEvaluation(read);
    const value = result.ok ? result.value : undefined;
    const readError = result.ok ? undefined : readFailure(result.error);
    const valueRef = useRef(value);
    valueRef.current = value;

    // The rows read, by position, with whether the narrowing holds each; and each segment's state.
    const known = useMemo(() => {
        const rows = new Map<number, LensRow>();
        const segments = new Map<number, LensSegmentState>();
        // The entries each row's page carried, by the row's position: its own read's.
        const entries = new Map<number, EntryLookup>();
        if (value === undefined) return { rows, segments, entries };
        // A segment is read when every one of its pages has landed whole; one failure fails it.
        const whole = new Map<number, boolean>();
        for (const p of value.pieces) {
            const piece = value.landed.get(p.key);
            if (piece?.error !== undefined) segments.set(p.segment, { kind: "failed", error: piece.error });
            const done = piece !== undefined && piece.rows !== undefined && piece.hits !== undefined;
            whole.set(p.segment, (whole.get(p.segment) ?? true) && done);
            const pieceRows = piece?.rows;
            if (pieceRows === undefined) continue;
            const carried = piece?.entries;
            pieceRows.forEach((row, i) => {
                rows.set(p.from + i, { row, hit: piece?.hits?.[i] });
                if (carried !== undefined) entries.set(p.from + i, carried);
            });
        }
        for (const [segment, done] of whole) if (!segments.has(segment)) segments.set(segment, done ? { kind: "read" } : { kind: "unread" });
        return { rows, segments, entries };
    }, [value]);

    const fresh = useMemo((): LensLayout | undefined => {
        if (value?.placement === undefined) return undefined;
        const facts: LensFacts = {
            placement: value.placement,
            segmentState: (offset) => known.segments.get(offset) ?? { kind: "unread" },
            rowAt: (position) => known.rows.get(position),
        };
        return layoutLens(facts, geometry, words);
    }, [value, known, geometry, words]);

    // The entry each row of that layout was read with: its own page's, by the row's place in the record.
    const readEntry = useMemo(() => {
        const entries = known.entries;
        return (id: string, at: number): Uint8Array | undefined => entries.get(at)?.(id);
    }, [known]);

    // The layout shown: the narrowing's once it is ready, the last one standing in until then. A lens switched on
    // anew stands nothing of its own in: the rows its host showed last do. Switched off, it keeps its last layout.
    const displayed = useRef<Shown | undefined>(undefined);
    const wasActive = useRef(false);
    if (active && !wasActive.current) displayed.current = undefined;
    wasActive.current = active;
    let shown: Shown | undefined = displayed.current;
    let replacing = false;
    let reread = false;
    if (active && value !== undefined && fresh !== undefined) {
        const previous = displayed.current;
        const moved = previous !== undefined && (previous.revision !== value.revision || previous.query !== value.query || value.reread);
        if (moved && !value.ready) {
            replacing = previous.query !== value.query;
            reread = value.reread;
        } else {
            shown = { layout: fresh, revision: value.revision, query: value.query, entryOf: readEntry };
            displayed.current = shown;
        }
    } else if (active && shown !== undefined) {
        replacing = shown.query !== query;
    }
    const layout = shown?.layout;

    const drawn = useMemo(() => {
        const rows: SheetRowValue[] = [];
        const positions: number[] = [];
        for (const item of layout?.items ?? []) {
            if (item.kind !== "row") continue;
            rows.push(item.row);
            positions.push(item.position);
        }
        return { rows, positions };
    }, [layout]);

    // Heights change at a constant count as segments land: the frame measures again.
    const sizeVersion = useMemo(() => {
        let h = 0;
        for (const item of layout?.items ?? []) {
            const px = item.kind === "pending" ? item.band.px : item.kind === "failed" ? item.failure.px : -1;
            h = (h * 31 + Math.round(px)) | 0;
        }
        return h;
    }, [layout]);

    const reportViewport = useCallback((from: number, to: number, isScrolling: boolean) => {
        if (isScrolling) return;
        const q = queryRef.current;
        setViewport((current) => (current.from === from && current.to === to && current.query === q ? current : { from, to, query: q }));
    }, []);
    const jumpToElement = useCallback((position: number) => setJumpTarget(position), []);
    const clearJump = useCallback(() => {
        // A jump whose row is drawn hands the view to the frame, which scrolls there: until it reports where it rests,
        // the view is read where the row is, so the row stays drawn (#854). One that drew nothing — a row the
        // narrowing does not hold, or a read let go — leaves the view where it is.
        const target = jumpRef.current;
        if (target !== undefined && jumpDrawnRef.current) setViewport({ from: target, to: target, query: queryRef.current });
        setJumpTarget(undefined);
    }, []);

    const retry = useCallback((w?: number) => {
        const ask = () => {
            const cache = cacheRef.current;
            // What is asked again is read again whole: a segment, by its first row — a read that failed, or rows that
            // disagreed with its placement.
            for (const p of valueRef.current?.pieces ?? []) {
                if (w !== undefined && p.segment !== w) continue;
                cache.failures.delete(p.key);
                cache.rows.delete(p.key);
                cache.entries.delete(p.key);
                cache.hits.delete(p.key);
            }
            if (w === undefined) cache.failures.clear();
            setRetries((n) => n + 1);
        };
        // The source rearms what failed first (#1398), a microtask on: the records go and the lens reads again after
        // it, so a read between the two never records the failure again from what the runtime held.
        if (source?.refresh === undefined) { ask(); return; }
        source.refresh(none);
        queueMicrotask(ask);
    }, [source]);

    // A jump settles once its row is drawn — or the band of the read that failed where it is — or once the lens knows
    // the row is none the narrowing holds: it lies where no segment of matches does, every row placed, or in a segment
    // read whose rows say so.
    const items = layout?.items ?? [];
    const drawnAt = (p: number) => items.some((item) => (item.kind === "row" && item.position === p)
        || (item.kind === "failed" && item.failure.from <= p && p <= item.failure.to));
    const hiddenAt = (p: number): boolean => {
        const placement = value?.placement;
        if (placement === undefined) return false;
        const segment = placement.segments.find((s) => s.offset <= p && p < s.offset + s.count);
        if (segment === undefined) return placement.complete;
        return known.segments.get(segment.offset)?.kind === "read" && known.rows.get(p)?.hit === false;
    };
    const jumpDrawn = jumpTarget !== undefined && drawnAt(jumpTarget);
    jumpDrawnRef.current = jumpDrawn;
    const settled = jumpTarget !== undefined && (jumpDrawn || hiddenAt(jumpTarget));
    const failure = value?.placementError ?? readError;
    // The segments it reads, one array while they hold: a landing elsewhere draws no band again for them.
    const readingNow = active ? value?.reading ?? NOT_READING : NOT_READING;
    const readingHeld = useRef(NOT_READING);
    if (readingNow.length !== readingHeld.current.length || readingNow.some((at, i) => at !== readingHeld.current[i])) readingHeld.current = readingNow;
    const reading = readingHeld.current;
    // The layout drawn is the last revision's while this one's is read — or while the read fails, its revision unknown.
    const laidOut = shown?.revision;
    const readNow = value?.revision;
    const readBefore = active && shown !== undefined && (value === undefined
        || (laidOut === undefined || readNow === undefined ? laidOut !== readNow : !stringEqual(laidOut, readNow)));
    return {
        layout,
        rows: drawn.rows,
        positions: drawn.positions,
        total: value?.placement?.records,
        matches: value?.placement?.matches,
        revision: active ? value?.revision : undefined,
        readBefore,
        ready: active && value !== undefined && value.ready && shown !== undefined && shown.query === query && shown.revision === value.revision,
        loading: active && (value === undefined || value.loading),
        reading,
        replacing,
        reread,
        sourceError: layout === undefined ? undefined : failure,
        error: active && layout === undefined ? failure : undefined,
        sizeVersion,
        jump: jumpTarget === undefined ? undefined : { window: jumpTarget, settled },
        reportViewport,
        jumpToElement,
        clearJump,
        retry,
        entryOf: shown?.entryOf ?? NO_ENTRY,
    };
}
