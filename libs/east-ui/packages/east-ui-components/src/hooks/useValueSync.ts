/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useEffect, useRef } from "react";

/**
 * Re-syncs a renderer's local interactive state from its East value when the
 * value's DATA changed — never when only its closures did (#809).
 *
 * @remarks
 * Renderers memoize with `equivalentFor`, so a component re-renders whenever
 * its value is not equivalent to the last one — including a value whose only
 * difference is a callback that captured new data. That re-render is wanted:
 * the handlers must call the new closures. What is NOT wanted is the local
 * state reset the interactive-state pattern performs on a new value: an
 * uncontrolled tab, input or accordion would snap back to its declared
 * default because a callback changed. So the reset is gated on `dataEqual`
 * (the type's `equalFor`, which treats every pair of functions as equal) —
 * exactly the changes the reset fired on before closures could reach it.
 *
 * `sync` is read fresh on every render; the value's data is the only trigger.
 * For a memo or effect keyed on the value's identity, key it on
 * {@link useDataStable} instead.
 *
 * @typeParam V - The East value type
 * @param value - The renderer's current East value
 * @param dataEqual - The value type's `equalFor` comparer
 * @param sync - Re-derives the local state from `value`
 *
 * @example
 * ```tsx
 * const stringInputEqual = equivalentFor(Input.Types.String);   // the memo
 * const stringInputDataEqual = equalFor(Input.Types.String);    // the reset gate
 *
 * const [props, setProps] = useState(toChakraStringInput(value));
 * useValueSync(value, stringInputDataEqual, () => setProps(toChakraStringInput(value)));
 * ```
 */
export function useValueSync<V>(value: V, dataEqual: (a: V, b: V) => boolean, sync: () => void): void {
    const synced = useRef(value);
    const syncRef = useRef(sync);
    syncRef.current = sync;
    useEffect(() => {
        const previous = synced.current;
        synced.current = value;
        if (previous === value || dataEqual(previous, value)) return;
        syncRef.current();
    }, [value, dataEqual]);
}
