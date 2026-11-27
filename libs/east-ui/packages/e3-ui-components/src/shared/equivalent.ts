/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A part of a payload kept while each new payload's is equivalent
 * (east-workspace#1772): a renderer is given a new payload whenever any of it
 * moves, and each part of it decoded anew. A part kept by {@link useEquivalent}
 * is the same object while it is equivalent — its data equal, its functions
 * the same programs over equivalent captures — so what is made from it is
 * made once: a library's press, which moves the open entry alone, makes none
 * of its cards, its rail or its reads again.
 *
 * @packageDocumentation
 */

import { useDataStable } from "@elaraai/east-ui-components";

/**
 * A value kept while each new one is equivalent to it: the last one that was
 * not. A function is kept as well as any value — never stale, as an equivalent
 * function is the same program over equivalent captures.
 *
 * @typeParam V - The value's type
 * @param value - The value, as the payload gives it now
 * @param equivalent - The value's type's `equivalentFor`
 * @returns `value` when it is not equivalent to the last one returned, else that one
 */
export function useEquivalent<V>(value: V, equivalent: (a: V, b: V) => boolean): V {
    // Kept in a box: `useDataStable` holds what it keeps as React state, and React calls a function it is given as state.
    return useDataStable({ value }, (a, b) => equivalent(a.value, b.value)).value;
}
