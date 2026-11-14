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

/** A status as an element draws it: its tone's tag, and whether it draws as an open ring. */
export interface DrawnStatus {
    /** Its tone: success, warning, danger, info or neutral. */
    readonly tone: { readonly type: string };
    /** Whether it draws as an open ring, as a tentative status does. */
    readonly ring: boolean;
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
