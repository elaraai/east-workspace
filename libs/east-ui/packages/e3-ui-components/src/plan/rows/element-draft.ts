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

/**
 * Whether an element's event is drafted: the element wears the drafted look.
 *
 * @param key - The element's key
 * @returns Whether a draft changed its event
 */
export function usePlanElementDrafted(key: string): boolean {
    return useContext(PlanDraftedContext).has(key);
}
