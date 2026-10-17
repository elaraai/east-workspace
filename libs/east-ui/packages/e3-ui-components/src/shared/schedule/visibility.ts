/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which rows a builder shows, by key, apart from the rows it calculates over
 * (the Roster's people, the Allocation's resources): a Set of keys, or a
 * record Slice's narrowed rows read through their paged source. It keeps the
 * previous complete membership while a new narrowing resolves, and never
 * touches an editing session.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import { SortedSet, StringType, compareFor, none, some, type ArrayType, type option, type ValueTypeOf } from "@elaraai/east";
import type { RowSourceType } from "@elaraai/east-ui";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { PagedScan } from "@elaraai/east-ui-components/internal";

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
    const scan = useMemo(() => source?.type === "pinned" ? new PagedScan<string, Set<string>>(
        () => new SortedSet<string>([], compareString),
        (keys, page) => { for (const key of page) keys.add(key); },
    ) : undefined, [source]);
    const read = useCallback((): option<Set<string>> => {
        if (source === undefined) return some(value.visible.type === "some" ? value.visible.value : new SortedSet(value.rows.map(row => row.key), compareString));
        if (source.type === "inline") return some(new SortedSet(source.value, compareString));
        if (source.type === "pinned" && scan !== undefined) return scan.read(source.value.revision, source.value.total, source.value.page);
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
    }, [source, scan, value.visible, value.rows, words.changed]);
    const { result } = useTrackedEvaluation(read);
    const last = useRef<option<Set<string>>>(none);
    if (result.ok && result.value.type === "some") last.current = result.value;
    const keys = last.current.type === "some" ? last.current : EMPTY;
    const loading = result.ok && result.value.type === "none";
    const error = result.ok ? undefined : result.error instanceof Error ? result.error.message : words.failed;
    const retry = () => {
        if (value.recordSlice?.type === "some") value.recordSlice.value.slice.retry();
        else if (source?.type === "pinned") source.value.refresh(none);
    };
    return { keys: source === undefined ? value.visible : keys, ready: last.current.type === "some", loading, error, retry };
}
