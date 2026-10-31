/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The look of an event its drafts changed (#1196, `Plan Builder Spec.md` §8):
 * the canvas hands its elements the keys of every event a kind's drafts hold
 * otherwise than its record does, and each element of an event — a bar, a
 * chip, a mark — asks whether its event is among them. The recipe draws the
 * brand tint in a brand border (`data-draft`, `planElementDrafted`), in both
 * themes.
 *
 * @packageDocumentation
 */

import { createContext, useContext } from "react";

/** No event drafted: a Plan without event kinds, or none of whose events a draft changed. */
const NONE: ReadonlySet<string> = new Set();

/** The events a draft changed, by their elements' keys — none outside a Plan of event kinds. */
export const PlanDraftedContext = createContext<ReadonlySet<string>>(NONE);

/** The events holding a conflict not yet chosen, by their elements' keys — the warn halo's; none outside a Plan of event kinds. */
export const PlanConflictedContext = createContext<ReadonlySet<string>>(NONE);

/** No table cell holding a conflict. */
const NO_CELLS: ReadonlyMap<string, readonly Date[]> = new Map();
/** None of a row's cells holding a conflict. */
const NO_INSTANTS: readonly Date[] = [];

/**
 * The table cells holding a conflict not yet chosen (#1438), by their rows' keys: the instants each row's conflicts are
 * at — a crew's week — whose cells wear the warn halo; none outside a Plan whose rows a session drafts.
 */
export const PlanConflictCellsContext = createContext<ReadonlyMap<string, readonly Date[]>>(NO_CELLS);

/**
 * The instants a row's cells hold a conflict at, not yet chosen.
 *
 * @param rowKey - The row's key
 * @returns Its conflicts' instants; none for a row with none
 */
export function usePlanRowConflicts(rowKey: string): readonly Date[] {
    return useContext(PlanConflictCellsContext).get(rowKey) ?? NO_INSTANTS;
}

/**
 * Whether an element's event holds a conflict not yet chosen: the element
 * wears the warn halo (the conflicts design's canvas marks).
 *
 * @param key - The element's key
 * @returns Whether its event holds one
 */
export function usePlanElementConflicted(key: string): boolean {
    return useContext(PlanConflictedContext).has(key);
}

/**
 * Whether an element's event is drafted: the element wears the drafted look.
 *
 * @param key - The element's key
 * @returns Whether a draft changed its event
 */
export function usePlanElementDrafted(key: string): boolean {
    return useContext(PlanDraftedContext).has(key);
}
