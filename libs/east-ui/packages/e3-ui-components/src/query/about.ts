/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What a saved query is, where it is shown (#939, #1063) — one reading of a
 * saved query, or of a recent run, against the root a surface's data sources
 * make, which the builder's Library tab and the query library share: the data
 * source its steps start from, its description, why it can't open here, its
 * outline, its problems and what it gives. And when it was saved, in words.
 *
 * @packageDocumentation
 */

import { DateTimeType, checkJq, lessFor } from "@elaraai/east";
import type { Formatters } from "@elaraai/east-ui-components";
import { outlineOf, type OutlineLine } from "./model/cards.js";
import { describeQuery, problemWords, shapeWords, type QueryWords } from "./model/words.js";
import type { QueryRoot } from "./one-shot.js";
import { entriesQuery, rootRefusal, savedEntries, type SavedQuery } from "./session.js";
import { checkSteps } from "./steps/check.js";
import { shapeOf } from "./steps/shape.js";

const earlier = lessFor(DateTimeType);

/** How long ago a time still reads as its weekday — "saved Tue" — before it reads as its date. */
const WEEK_MS = 6 * 24 * 60 * 60 * 1000;

/** What a saved query, or a recent run, is here. */
export interface QueryAbout {
    /**
     * The data source its steps start from; for a program that is not steps,
     * the first its root reads — else the first bound.
     */
    readonly source: string;
    /** Its description: the author's, else the sentence generated from its steps; `undefined` when there is neither. */
    readonly description: string | undefined;
    /** Why it can't open here, in the builder's words; `undefined` when it can. */
    readonly refusal: string | undefined;
    /** Its steps: how many, and one outline line per finished step; `undefined` for a program that is not steps. */
    readonly steps: { readonly count: number; readonly outline: readonly OutlineLine[] } | undefined;
    /** How many problems it has here: the errors its check finds. */
    readonly problems: number;
    /** The first, in plain words; `undefined` when it has none. */
    readonly problem: string | undefined;
    /** What it gives, in words — "Up to 10 shipped orders"; `undefined` while it has problems. */
    readonly gives: string | undefined;
}

/**
 * What a saved query, or a recent run, is against a root: its steps parsed
 * and checked once (`Query Editor Spec.md` §4.10, §5).
 *
 * @param saved - The saved query, or the run
 * @param root - The root the surface's data sources make
 * @param words - The words
 * @returns What it is here
 */
export function queryAbout(saved: SavedQuery, root: QueryRoot, words: QueryWords): QueryAbout {
    const refusal = rootRefusal(saved, root, words);
    const authored = saved.description.type === "some" ? saved.description.value : undefined;
    const { header, query } = entriesQuery(savedEntries(saved, root.type));
    if (header.jq.type === "some") {
        const checked = checkJq(header.jq.value, root.type, { root: true });
        const errors = checked.diagnostics.filter((d) => d.severity.type === "error");
        const shape = checked.elementType === null ? undefined : shapeOf(checked.elementType, checked.multiplicity, { noun: "row" });
        return {
            source: saved.root[0]?.name ?? root.entries[0]?.name ?? "",
            description: authored,
            refusal,
            steps: undefined,
            problems: errors.length,
            problem: errors[0]?.message,
            gives: errors.length > 0 || shape === undefined ? undefined : shapeWords(shape, words),
        };
    }
    const checked = checkSteps(query, root.type);
    const errors = checked.diagnostics.filter((d) => d.severity === "error");
    const generated = authored === undefined ? describeQuery(query, checked, words) : "";
    const first = errors[0];
    return {
        source: query.source,
        description: authored ?? (generated === "" ? undefined : generated),
        refusal,
        steps: { count: query.steps.length, outline: outlineOf(query, checked, words) },
        problems: errors.length,
        problem: first === undefined ? undefined : problemWords(first, query, root.type, checked, words).text,
        gives: errors.length > 0 || checked.final.kind === "unknown" ? undefined : shapeWords(checked.final, words),
    };
}

/**
 * When a query was saved, or a run ran, in a card's words — "14:02" today,
 * "Tue" within the last six days, "Sep 12" this year, else "Sep 12, 2025" —
 * in the viewer's locale and time zone.
 *
 * @param at - When
 * @param now - The moment it is read at
 * @param formatters - The locale's formatters
 * @returns The words
 */
export function whenWords(at: Date, now: Date, formatters: Formatters): string {
    if (formatters.date(at) === formatters.date(now)) return formatters.time(at);
    if (earlier(new Date(now.getTime() - WEEK_MS), at)) return formatters.weekday(at);
    return formatters.year(at) === formatters.year(now) ? formatters.monthDay(at) : formatters.date(at);
}
