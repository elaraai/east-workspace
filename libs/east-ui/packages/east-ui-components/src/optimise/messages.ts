/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Optimise run's words (#1409; `Optimise Spec.md` §10), verbatim: the
 * eye's names, the footer line while the call is out and after Stop, the
 * banner when it lands, the history step, the provenance an entry says on
 * hover, and the legend's item. Every builder's shared parts speak from one
 * table, so a host translates the run where it translates the builder.
 *
 * `{period}` is the builder's own label for its scope — `W11`, `Oct 5 – 9`,
 * `8 work orders`, `Oct 1 – 14`, `Wed 12 May`. Counts arrive formatted for the
 * locale (`count`), with the raw number beside them (`n`) for plural rules.
 *
 * @packageDocumentation
 */

import type { LoadingLineText } from "../layout/builder-frame/loading-line.js";

/** The Optimise run's message table. */
export interface OptimiseMessages {
    /** The eye at rest — `Optimise W11`. */
    optimise: (p: { period: string }) => string;
    /** The eye while a run is out — `Stop optimising`. */
    stop: () => string;
    /** The eye's tooltip where the period cannot be edited — `Read-only`. */
    readOnly: () => string;
    /** The footer line while the call is out — `Optimising W11`, the period strong. */
    running: (p: { period: string }) => LoadingLineText;
    /** Its short form, where the rail is short — `Optimising…`. */
    runningShort: () => string;
    /** The seconds beside it, unheard — `7 s`; `seconds` arrives padded so the line never shifts. */
    seconds: (p: { seconds: string }) => string;
    /** The footer line after Stop — `Stopped · nothing changed`. */
    stopped: () => LoadingLineText;
    /** Its short form — `Stopped`. */
    stoppedShort: () => string;
    /** The banner's title when the run changed something — `Elara optimised W11`. */
    done: (p: { period: string }) => string;
    /** Its line — `11 changes: 4 added, 5 changed, 2 removed. Undo or apply them like any edit.`; `parts` the counts that are not zero, joined. */
    doneDetail: (p: { n: number; count: string; parts: string }) => string;
    /** One part of the count — `4 added`. */
    added: (p: { count: string }) => string;
    /** One part of the count — `5 changed`. */
    changed: (p: { count: string }) => string;
    /** One part of the count — `2 removed`. */
    removed: (p: { count: string }) => string;
    /** The banner's title when the result equals the request — `No changes`. */
    none: () => string;
    /** Its line — `Elara found nothing to improve in W11.` */
    noneDetail: (p: { period: string }) => string;
    /** The banner's title when the call failed — `Couldn't optimise W11`. */
    fail: (p: { period: string }) => string;
    /** Its line — `Nothing changed. Run it again from the eye.` */
    failDetail: () => string;
    /** The history step's label — `Elara run #7`; `run` arrives formatted. */
    step: (p: { run: string }) => string;
    /** An entry the run added, on hover — `Added by Elara · run #7`. */
    entryAdded: (p: { run: string }) => string;
    /** An entry the run changed — `Was Mon 09:00–17:00 · Elara run #7`. */
    entryChanged: (p: { previous: string; run: string }) => string;
    /** A ghost where the run removed an entry — `Removed by Elara · run #7`. */
    ghostRemoved: (p: { run: string }) => string;
    /** A ghost where the run moved an entry from — `Moved by Elara · run #7`. */
    ghostMoved: (p: { run: string }) => string;
    /** The legend's item during the highlight — `Elara change`. */
    legend: () => string;
    /** Why a gesture is refused while the call is out (R2) — `Elara is optimising W11`. */
    locked: (p: { period: string }) => string;
}

/** The English table. */
export const optimiseMessages: OptimiseMessages = {
    optimise: ({ period }) => `Optimise ${period}`,
    stop: () => "Stop optimising",
    readOnly: () => "Read-only",
    running: ({ period }) => ["Optimising ", { strong: period }],
    runningShort: () => "Optimising…",
    seconds: ({ seconds }) => `${seconds} s`,
    stopped: () => "Stopped · nothing changed",
    stoppedShort: () => "Stopped",
    done: ({ period }) => `Elara optimised ${period}`,
    doneDetail: ({ n, count, parts }) => `${count} ${n === 1 ? "change" : "changes"}: ${parts}. Undo or apply them like any edit.`,
    added: ({ count }) => `${count} added`,
    changed: ({ count }) => `${count} changed`,
    removed: ({ count }) => `${count} removed`,
    none: () => "No changes",
    noneDetail: ({ period }) => `Elara found nothing to improve in ${period}.`,
    fail: ({ period }) => `Couldn't optimise ${period}`,
    failDetail: () => "Nothing changed. Run it again from the eye.",
    step: ({ run }) => `Elara run #${run}`,
    entryAdded: ({ run }) => `Added by Elara · run #${run}`,
    entryChanged: ({ previous, run }) => `Was ${previous} · Elara run #${run}`,
    ghostRemoved: ({ run }) => `Removed by Elara · run #${run}`,
    ghostMoved: ({ run }) => `Moved by Elara · run #${run}`,
    legend: () => "Elara change",
    locked: ({ period }) => `Elara is optimising ${period}`,
};
