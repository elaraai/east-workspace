/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The period a host's columns fall back to where the one its range gave
 * shows nothing of what is in view (#1799): one rule for every reader of a
 * schedule's events that names the tiles a summary shades by — the event
 * kinds' (`cells.ts`, its notice's `shades`) and a Plan's nested rows'
 * (`plan/root/nested.ts`).
 *
 * A host picks its columns' period from its range and its plot's width
 * (`../time/period.ts`), which say nothing of how much the range holds. Past
 * what a view may draw, a reader shades a row from a summary instead — and a
 * summary shades a period only where its tile divides the period's columns
 * ({@link dividingTiles}): a month's totals say nothing of one week. So a
 * wide plot gives a long range weeks that only months can show. The reader
 * then names, for each thing it could show nothing of, the tiles a summary
 * shades it by, and the host takes the period this rule gives in place of
 * asking its viewer to.
 *
 * The rule only ever gives a coarser period, so a host that follows it comes
 * to rest: at a period that shows what a summary can, or with nothing coarser
 * to take — where what is left is the host's to say.
 *
 * @packageDocumentation
 */

import type { RecordTile } from "@elaraai/east-ui/internal";
import { finestFirst } from "../time/period.js";
import type { TimeResolution } from "../time/scale.js";
import { coarserThan } from "../time/zoom.js";
import { dividingTiles } from "./cells.js";

/**
 * The period a host's columns fall back to (see the module docs): of the
 * periods it offers coarser than its own, the finest that shows every thing
 * some one of them shows — a period shows a thing where a tile its summary
 * shades it by divides the period's columns. Where no one period shows them
 * all — one kept by the week alone beside one kept by the month alone — the
 * finest that shows any. A thing no summary shades is shown by none, and
 * asks for no period.
 *
 * @param period - The period the host's columns take now
 * @param offered - The periods the host offers, in any order
 * @param shades - For each thing its reader shows nothing of at `period`: the tiles a summary shades it by
 * @returns The period to take; `undefined` where no coarser period offered shows any of them
 */
export function scheduleFallbackPeriod(
    period: TimeResolution, offered: readonly TimeResolution[], shades: readonly (readonly RecordTile[])[],
): TimeResolution | undefined {
    const coarser = finestFirst(offered).filter((one) => coarserThan(one, period));
    // Each thing a coarser period shows, by the periods that show it.
    const shown = shades.map((tiles) => coarser.filter((one) => dividingTiles(one).some((tile) => tiles.includes(tile))))
        .filter((periods) => periods.length > 0);
    if (shown.length === 0) return undefined;
    return coarser.find((one) => shown.every((periods) => periods.includes(one))) ?? coarser.find((one) => shown.some((periods) => periods.includes(one)));
}
