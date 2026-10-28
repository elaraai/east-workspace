/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a builder's footer line says of a run (#1409; `Optimise Spec.md` §8):
 * while the call is out, `Optimising {period} · {n} s` — the Elara dot with
 * the live pulse, the seconds from 1, padded with a figure space so the line
 * never shifts as they tick, unheard — and after Stop, `Stopped · nothing
 * changed`. Both take the shared `LoadingLine`'s slot at the rail's trailing
 * end, and its fit (#1398, CL3): the full text, the short form, or the dot.
 *
 * @packageDocumentation
 */

import type { LoadingLineValue } from "../layout/builder-frame/loading-line.js";
import { optimiseMessages, type OptimiseMessages } from "./messages.js";

/** The figure space: a digit's width, so `7 s` and `12 s` are as wide. */
const FIGURE_SPACE = " ";

/**
 * The seconds a run has been out, as the line shows them: from 1, and padded
 * to two figures with a figure space, so the line never shifts.
 *
 * @param seconds - The seconds since the call left
 * @returns The figure, padded
 */
export function optimiseSeconds(seconds: number): string {
    const n = Math.max(1, Math.floor(seconds));
    return n < 10 ? `${FIGURE_SPACE}${n}` : `${n}`;
}

/**
 * The footer line while a run is out.
 *
 * @param period - The scope's label — `W11`
 * @param seconds - The seconds since the call left
 * @param m - The words: the shared table unless given
 * @returns The line's value, of the `busy` kind
 */
export function optimiseRunningLine(period: string, seconds: number, m: OptimiseMessages = optimiseMessages): LoadingLineValue {
    return { kind: "busy", text: m.running({ period }), short: m.runningShort(), aside: m.seconds({ seconds: optimiseSeconds(seconds) }) };
}

/**
 * The footer line after Stop, for its 2.5 s.
 *
 * @param m - The words: the shared table unless given
 * @returns The line's value, of the `note` kind
 */
export function optimiseStoppedLine(m: OptimiseMessages = optimiseMessages): LoadingLineValue {
    return { kind: "note", text: m.stopped(), short: m.stoppedShort() };
}
