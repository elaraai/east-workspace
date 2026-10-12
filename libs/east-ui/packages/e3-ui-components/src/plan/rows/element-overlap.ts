/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The warn ring of an event in an overlap pair (#1198, `Plan Builder Spec.md`
 * §8, PB51): the frame reads the pairs from its event kinds and hands the
 * canvas the keys of the events in one, and each element of an event — a
 * bar, a tile, a chip, a mark — asks whether its event is among them. The
 * recipe draws the ring (`data-overlap`).
 *
 * @packageDocumentation
 */

import { createContext, useContext } from "react";

/** No event in a pair: a Plan without event kinds, or none of whose events overlap. */
const NONE: ReadonlySet<string> = new Set();

/** The events in an overlap pair, by their elements' keys — none outside a Plan of event kinds. */
export const PlanOverlapsContext = createContext<ReadonlySet<string>>(NONE);

/**
 * Whether an element's event is in an overlap pair: the element wears the warn ring.
 *
 * @param key - The element's key
 * @returns Whether its event overlaps another
 */
export function usePlanElementOverlap(key: string): boolean {
    return useContext(PlanOverlapsContext).has(key);
}
