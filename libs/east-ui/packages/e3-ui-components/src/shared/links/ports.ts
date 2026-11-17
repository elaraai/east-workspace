/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where links meet an end they share (#1680's review, ruled 17 Nov 2026):
 * where several links leave one element's end, or enter one element's start,
 * their ports stack about the element's centre line, 2px apart, ordered by
 * where each link's other end lies — topmost first — so each is drawn, and
 * counted, apart, never one trunk splitting. A lone link meets its element on
 * its centre line, as ever. Shared by every builder that draws links; the
 * router (`geometry.ts`) draws each link from the port given it. Pure: no
 * React, no DOM.
 *
 * @packageDocumentation
 */

import { linkHeadHalf } from "./look.js";

/** The clear between two ports at one end (px). */
export const PORT_GAP = 2;

/** Which end of an element a link meets: its source's end, which it leaves, or its destination's start, which it enters. */
export type PortSide = "exit" | "entry";

/** One link's end at an element, as the ports are worked out from it. */
export interface LinkPort {
    /**
     * The end it meets, as a key: the element and which of its ends. Links
     * whose ports name one key share that end, and stack there.
     */
    readonly at: string;
    /** The element's centre line, down the page: where a lone link meets it. */
    readonly centre: number;
    /** What the link takes of the end across its flow ({@link portSize}). */
    readonly size: number;
    /** Where the link's other end lies, down the page: what the ports at one end are ordered by. */
    readonly other: number;
}

/**
 * What a link takes of an element's end across its flow: its weight where it
 * leaves an end, and its head's width — max(8, 2 × weight) — where it enters a
 * start.
 *
 * @param weight - The link's weight: its stroke's width
 * @param side - Which end it meets
 * @returns The size, in px
 */
export function portSize(weight: number, side: PortSide): number {
    return side === "exit" ? weight : 2 * linkHeadHalf(weight);
}

/**
 * Each link's port: where it meets its element, down the page.
 *
 * The `n` ports at one end stack about its centre line `c`, in the order of
 * their other ends, topmost first (and in the order given where two lie
 * level): the stack is `T = Σ s + 2(n − 1)` tall, and port `i` sits at
 * `c − T/2 + Σ_{j<i}(s_j + 2) + s_i/2`. Two links of weight 8 out of one end
 * sit at `c − 5` and `c + 5`.
 *
 * @param ports - Each link's end, in any order
 * @returns Each one's port, in the order given
 */
export function linkPorts(ports: readonly LinkPort[]): number[] {
    const out = ports.map((port) => port.centre);
    const shared = new Map<string, number[]>();
    ports.forEach((port, i) => {
        const at = shared.get(port.at);
        if (at === undefined) shared.set(port.at, [i]);
        else at.push(i);
    });
    for (const members of shared.values()) {
        if (members.length < 2) continue;
        const ordered = [...members].sort((a, b) => ports[a]!.other - ports[b]!.other || a - b);
        const tall = ordered.reduce((sum, i) => sum + ports[i]!.size, 0) + PORT_GAP * (ordered.length - 1);
        let y = ports[ordered[0]!]!.centre - tall / 2;
        for (const i of ordered) {
            out[i] = y + ports[i]!.size / 2;
            y += ports[i]!.size + PORT_GAP;
        }
    }
    return out;
}
