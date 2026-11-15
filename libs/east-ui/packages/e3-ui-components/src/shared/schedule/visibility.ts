/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which rows a builder shows, by key, apart from the rows it calculates over
 * (the Roster's people, the Allocation's resources): a Set of keys, or a
 * record Slice's narrowed rows read through their paged source. It keeps the
 * previous complete membership while a new narrowing resolves, and never
 * touches an editing session. A builder bound to `Slice.bindRecords` reads
 * each source through {@link useSourceVisibility}, so each source narrows
 * every place its rows appear — the board, its Choosers and its Library's
 * tabs alike (#1339).
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import { SortedSet, StringType, compareFor, none, some, type ArrayType, type option, type ValueTypeOf } from "@elaraai/east";
import type { RowSourceType } from "@elaraai/east-ui";
import { recordSliceChosen, recordSliceScoped, type RecordSliceBindType } from "@elaraai/east-ui/internal";
import { useSliceReactivity, useTrackedEvaluation } from "@elaraai/east-ui-components";
import { PagedScan, snapshotOf } from "@elaraai/east-ui-components/internal";

const compareString = compareFor(StringType);
const PAGE = 256n;
const EMPTY = some(new SortedSet<string>([], compareString));

/** What a builder's payload says about which rows show. */
export interface KeyVisibilityInput {
    /** The narrowed rows' keys, paged through a record Slice; `none` with no record Slice. */
    visibleSource: option<ValueTypeOf<RowSourceType<ArrayType<StringType>>>> | undefined;
    /** The keys to show when no record Slice narrows: a Set, or `none` for every row. */
    visible: option<Set<string>>;
    /** Every row, in its order: what shows when nothing narrows. */
    rows: readonly { key: string }[];
    /** The record Slice chrome, whose Retry a failed narrowing offers. */
    recordSlice: option<{ slice: { retry: () => void } }> | undefined;
}

/** The words a failed narrowing says. */
export interface KeyVisibilityWords {
    /** The results moved while they were read (`Staff results changed; retry the narrowing.`). */
    changed: string;
    /** The results could not be read (`Could not load staff results`). */
    failed: string;
}

/** Which rows show, and the narrowing's state. */
export interface KeyVisibility {
    /** The keys to show: `none` for every row. */
    keys: option<Set<string>>;
    /**
     * Whether a choice of the viewer's narrows what shows (#1621): what a count of it says `N of M` for, and what Clear
     * filters clears. A page's scope is none: the rows it holds are the source's whole, though `keys` holds them.
     */
    chosen: boolean;
    /**
     * How many rows the source's page holds, where its scope narrows it (#1621): what a count of what shows is out of —
     * `none` while it is read; `undefined` on a page with no scope, which holds every row.
     */
    held: option<number> | undefined;
    /** Whether a complete membership has resolved yet. */
    ready: boolean;
    /** Whether a new narrowing is resolving (the previous membership still shows). */
    loading: boolean;
    /** Why the narrowing could not be read. */
    error: string | undefined;
    /** Read the narrowing again. */
    retry: () => void;
}

/**
 * Which rows show (see the module docs).
 *
 * @param value - What the payload says about which rows show
 * @param words - What a failed narrowing says
 * @returns The keys to show, and the narrowing's state
 */
export function useKeyVisibility(value: KeyVisibilityInput, words: KeyVisibilityWords): KeyVisibility {
    const source = value.visibleSource?.type === "some" ? value.visibleSource.value : undefined;
    // A pinned source's keys belong to its revision, a live one's — a rail's narrowed source — to its narrowing too.
    const snapshotted = source?.type === "pinned" || source?.type === "live" ? source.value : undefined;
    const scan = useMemo(() => snapshotted !== undefined ? new PagedScan<string, Set<string>>(
        () => new SortedSet<string>([], compareString),
        (keys, page) => { for (const key of page) keys.add(key); },
    ) : undefined, [snapshotted]);
    const read = useCallback((): option<Set<string>> => {
        if (source === undefined) return some(value.visible.type === "some" ? value.visible.value : new SortedSet(value.rows.map(row => row.key), compareString));
        if (source.type === "inline") return some(new SortedSet(source.value, compareString));
        // The scan starts again when the snapshot moves — a write, or a choice (#1354) — whatever the count.
        if (snapshotted !== undefined && scan !== undefined) return scan.read(() => snapshotOf(snapshotted) ?? none, snapshotted.total, snapshotted.page);
        const handle = source.value;
        const count = handle.total();
        if (count.type === "none") return none;
        const keys = new SortedSet<string>([], compareString);
        for (let offset = 0n; offset < count.value;) {
            const remaining = count.value - offset;
            const page = handle.page(offset, remaining < PAGE ? remaining : PAGE);
            if (page.type === "none") return none;
            if (page.value.length === 0) throw new Error(words.changed);
            for (const key of page.value) keys.add(key);
            offset += BigInt(page.value.length);
        }
        return some(keys);
    }, [source, snapshotted, scan, value.visible, value.rows, words.changed]);
    const { result } = useTrackedEvaluation(read);
    // The last complete membership as it showed: what stands in while a new narrowing resolves (#1398, CL8) — every row
    // while nothing narrowed (the payload's own keys, or `none`), never the keys read of no row, so a first choice keeps
    // every row showing until its own rows land.
    const last = useRef<{ readonly keys: option<Set<string>> } | undefined>(undefined);
    if (result.ok && result.value.type === "some") last.current = { keys: source === undefined ? value.visible : result.value };
    const keys = last.current?.keys ?? EMPTY;
    const loading = result.ok && result.value.type === "none";
    const error = result.ok ? undefined : result.error instanceof Error ? result.error.message : words.failed;
    const retry = () => {
        if (value.recordSlice?.type === "some") value.recordSlice.value.slice.retry();
        else if (snapshotted !== undefined) snapshotted.refresh(none);
    };
    const shown = source === undefined ? value.visible : keys;
    // The host's narrowing is its own choice: no page scope narrows it.
    return { keys: shown, chosen: shown.type === "some", held: undefined, ready: last.current !== undefined, loading, error, retry };
}

/**
 * What a count of a source's shown rows is out of (#1621): the rows its page holds, where its scope narrows it — none
 * while that count is read — else every row of the source. Never the record's whole beyond the page.
 *
 * @param shown - The source's visibility: how many rows its page holds (`held`; left out with no scope)
 * @param every - How many rows the source has
 * @returns The count's whole; `undefined` while the page's count is read
 */
export function shownWhole(shown: { readonly held?: option<number> | undefined }, every: number): number | undefined {
    const { held } = shown;
    return held === undefined ? every : held.type === "some" ? held.value : undefined;
}

/** A Slice over several records' chrome, as a builder's payload carries it: each source's part. */
export interface SourcesChrome {
    slice: { parts: readonly { source: string; slice: ValueTypeOf<RecordSliceBindType> }[] };
}

/**
 * One source's part of a Slice over several records (#1339).
 *
 * @param chrome - The payload's chrome; `undefined` with no slice
 * @param source - The source's name (`resources`)
 * @returns Its record Slice's controls, if the slice has the source
 */
export function sourcePart(chrome: SourcesChrome | undefined, source: string): ValueTypeOf<RecordSliceBindType> | undefined {
    return chrome?.slice.parts.find(part => part.source === source)?.slice;
}

/**
 * Which of a source's rows show (#1339): the keys its part of a Slice over
 * several records narrows to while a choice or its page's scope (#1621)
 * narrows it, every row — and no read — while nothing does. Every place a
 * builder shows the source's rows reads these keys, so one choice narrows them
 * all, and a scoped source shows the scope's rows alone. Beside them it says
 * whether a choice of the viewer's narrows them — a page's scope is none — and,
 * on a scoped page, how many rows the page holds: what a count of what shows is
 * out of, never the record's whole.
 *
 * @param chrome - The payload's chrome; `undefined` with no slice
 * @param source - The source's name (`resources`)
 * @param keys - The source's narrowed keys, paged through its part, as the payload carries them
 * @param rows - Every row of the source, in order
 * @param words - What a failed narrowing says
 * @returns The keys to show, and the narrowing's state
 */
export function useSourceVisibility(chrome: SourcesChrome | undefined, source: string, keys: option<ValueTypeOf<RowSourceType<ArrayType<StringType>>>>,
    rows: readonly { key: string }[], words: KeyVisibilityWords): KeyVisibility {
    const part = sourcePart(chrome, source);
    useSliceReactivity(part?.key);
    const narrowing = part !== undefined && part.read().where.size > 0;
    const visibility = useKeyVisibility({ visibleSource: narrowing ? keys : none, visible: none, rows, recordSlice: part === undefined ? none : some({ slice: part }) }, words);
    // How many rows the page holds, a tracked read of the source's own total, read only on a scoped page.
    const scoped = part !== undefined && recordSliceScoped(part);
    const readHeld = useCallback((): option<number> => {
        if (part === undefined || !scoped) return none;
        const total = part.total();
        return total.type === "some" ? some(Number(total.value)) : none;
    }, [part, scoped]);
    const { result } = useTrackedEvaluation(readHeld);
    const held = !scoped ? undefined : result.ok ? result.value : none;
    return { ...visibility, chosen: part !== undefined && recordSliceChosen(part), held };
}
