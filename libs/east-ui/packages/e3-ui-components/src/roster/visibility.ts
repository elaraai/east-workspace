/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/** Indexed visibility is independent of complete roster calculations and sessions. */
import { useCallback, useRef } from "react";
import { SortedSet, none, some, type option } from "@elaraai/east";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { compareString, type RosterValue } from "./model.js";

const PAGE = 256n;
const EMPTY = some(new SortedSet<string>([], compareString));
/** Keep the previous complete membership while a new narrowing resolves. */
export function useRosterVisibility(value: RosterValue): {
    keys: option<Set<string>>; ready: boolean; loading: boolean; error: string | undefined; retry: () => void;
} {
    const source = value.visibleSource?.type === "some" ? value.visibleSource.value : undefined;
    const read = useCallback((): option<Set<string>> => {
        if (source === undefined) return some(value.visiblePeople.type === "some" ? value.visiblePeople.value : new SortedSet(value.people.map(person => person.key), compareString));
        if (source.type === "inline") return some(new SortedSet(source.value, compareString));
        const handle = source.value;
        const revision = source.type === "pinned" ? source.value.revision() : undefined;
        if (revision?.type === "none") return none;
        const count = handle.total();
        if (count.type === "none") return none;
        const keys = new SortedSet<string>([], compareString);
        for (let offset = 0n; offset < count.value;) {
            const remaining = count.value - offset;
            const page = handle.page(offset, remaining < PAGE ? remaining : PAGE);
            if (page.type === "none") return none;
            if (page.value.length === 0) throw new Error("Staff results changed; retry the narrowing.");
            for (const key of page.value) keys.add(key);
            offset += BigInt(page.value.length);
        }
        if (source.type === "pinned") {
            const after = source.value.revision();
            if (after.type !== "some" || revision?.type !== "some" || after.value !== revision.value) return none;
        }
        return some(keys);
    }, [source, value.visiblePeople, value.people]);
    const { result } = useTrackedEvaluation(read);
    const last = useRef<option<Set<string>>>(none);
    if (result.ok && result.value.type === "some") last.current = result.value;
    const keys = last.current.type === "some" ? last.current : EMPTY;
    const loading = result.ok && result.value.type === "none";
    const error = result.ok ? undefined : result.error instanceof Error ? result.error.message : "Could not load staff results";
    const retry = () => {
        if (value.recordSlice?.type === "some") value.recordSlice.value.slice.retry();
        else if (source?.type === "pinned") source.value.refresh(none);
    };
    return { keys: source === undefined ? value.visiblePeople : keys, ready: last.current.type === "some", loading, error, retry };
}
