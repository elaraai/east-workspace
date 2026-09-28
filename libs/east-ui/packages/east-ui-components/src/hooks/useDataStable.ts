/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useState } from "react";

/**
 * Returns an East value whose identity changes only when its DATA does —
 * never when only its closures did (#809).
 *
 * @remarks
 * Renderers memoize with `equivalentFor`, so a new value arrives whenever a
 * callback captured new data, even though every data field is unchanged. A
 * memo or effect keyed on that value's identity would then recompute or
 * re-fire on a closure change. Key it on this hook's result instead: the
 * returned value is the last one whose data differed (by `dataEqual`, the
 * type's `equalFor`), so identity-keyed dependents track data changes only.
 *
 * Read only data through the result — its closures may be stale by design.
 * For resetting local state from the value, use {@link useValueSync}.
 *
 * @typeParam V - The East value type
 * @param value - The renderer's current East value
 * @param dataEqual - The value type's `equalFor` comparer
 * @returns `value` when its data changed since the last one returned, else that last one
 *
 * @example
 * ```tsx
 * const rosterDataEqual = equalFor(Roster.Types.Roster);
 *
 * const data = useDataStable(value, rosterDataEqual);
 * // Recomputed on a data change only — a closure change keeps the review state.
 * const approvals = useMemo(() => data.people.map(p => p.approval), [data]);
 * ```
 */
export function useDataStable<V>(value: V, dataEqual: (a: V, b: V) => boolean): V {
    const [stable, setStable] = useState(value);
    if (stable !== value && !dataEqual(stable, value)) {
        // React's adjust-state-while-rendering pattern: re-render at once with
        // the new value as the stable one, before anything commits.
        setStable(value);
        return value;
    }
    return stable;
}
