/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What an element says of its status to its recipe (#1541): the builders' one
 * status — an event kind's status case, and a Plan item's `Plan.status` — as
 * the two attributes every recipe that draws one reads. A renderer sets them
 * and nothing else: the tone's colour, its ring and the open ring are the
 * recipe's.
 *
 * @packageDocumentation
 */

import { variant, type ValueTypeOf } from "@elaraai/east";
import type { Plan } from "@elaraai/e3-ui/internal";

/**
 * A status as an element draws it: the builders' one status, decoded — its words, its tone, and whether it draws as an
 * open ring. An event kind's status case is the same type (`Schedule.Types.Status`).
 */
export type DrawnStatus = ValueTypeOf<typeof Plan.Types.Status>;

/** Each tone a status takes, as East holds it. */
const TONES = {
    success: variant("success", null), warning: variant("warning", null), danger: variant("danger", null), info: variant("info", null),
    neutral: variant("neutral", null),
} as const satisfies Record<string, DrawnStatus["tone"]>;

/** A tone a renderer names a status of its own by: success, warning, danger, info or neutral. */
export type StatusTone = keyof typeof TONES;

/**
 * A status a renderer says of its own — a shift's coverage, a slot that is free — as the builders' one status holds it,
 * its tone East's variant.
 *
 * @param label - Its words
 * @param tone - Its tone
 * @param ring - Whether it draws as an open ring, as a tentative status does; not by default
 * @returns The status
 */
export function drawnStatus(label: string, tone: StatusTone, ring = false): DrawnStatus {
    return { label, tone: TONES[tone], ring };
}

/** The attributes a status sets: `data-tone`, its tone, and `data-ring` where it draws as an open ring. */
export interface StatusAttributes {
    "data-tone"?: string;
    "data-ring"?: "";
}

/**
 * The attributes an element with a status wears: its tone as `data-tone`, and
 * `data-ring` where it draws as an open ring; none for an element with no
 * status.
 *
 * @param status - The element's status, `undefined` for none
 * @returns The attributes to spread on the element
 */
export function statusAttributes(status: DrawnStatus | undefined): StatusAttributes {
    if (status === undefined) return {};
    return status.ring ? { "data-tone": status.tone.type, "data-ring": "" } : { "data-tone": status.tone.type };
}
