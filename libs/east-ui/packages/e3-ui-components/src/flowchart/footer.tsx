/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's footer (#1502, #1503, `Flowchart Records Spec.md` R5, R12)
 * — today's counts, in its frame's footer: the transitions the flowchart
 * holds, and on the right their split, planned · observed · unresolved; where
 * the flowchart edits, the changes waiting on Save (`3 pending`); when its
 * records were last saved, the newest of their last saves; each Save's notice,
 * the rows it took out of a kind's narrowing (the shared
 * `RecordSliceSaveNotice`); and, after a card's ⏎ that is refused, why — a
 * polite live line, so a screen reader hears it too. What the narrowing draws
 * as context counts nowhere: the transitions counted are those drawn as
 * themselves, an in-place one among them though it folds into its state's
 * `↻ n`, and an unresolved one once, under unresolved.
 *
 * At its trailing end, in a slot of its own, the shared loading line (R5):
 * what is read now, in a kind's noun — `Loading states…`, or `Updating
 * states…` while a new narrowing is read and what the canvas drew stands in —
 * or why a read failed, with Retry; shown on the frame's one reveal clock (its
 * `LoadingReveal`), and fitted to the room the rail leaves it
 * (`useFooterFit`): its full text, its short form or its dot alone. The
 * refusal's line takes the rail's slack (`data-footer-slack`), cut short
 * before the split.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import { Box, type SystemStyleObject } from "@chakra-ui/react";
import { DateTimeType, StringType, compareFor, equalFor, type ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation, type Formatters } from "@elaraai/east-ui-components";
import { LoadingLine, RecordSliceSaveNotice, useFooterFit, useRevealed, type LoadingLineValue } from "@elaraai/east-ui-components/internal";
import { authorOf } from "../shared/records/author.js";
import { kindOf } from "./editing.js";
import type { FlowchartWords } from "./messages.js";
import type { FlowchartValue, ModelCounts } from "./model.js";
import { FLOWCHART_SORTS, type FlowchartSort } from "./read.js";

type Styles = Record<string, SystemStyleObject>;

const stringEqual = equalFor(StringType);
const compareInstant = compareFor(DateTimeType);

/** A kind read through its source that writes: what its Save's notice counts the rows it took out of the narrowing in. */
export interface FlowchartNotice {
    /** The kind. */
    readonly sort: FlowchartSort;
    /** Its source of the slice. */
    readonly slice: ValueTypeOf<RecordSliceBindType>;
    /** One of its rows, as a sentence names it — `state`. */
    readonly singular: string;
    /** Several. */
    readonly plural: string;
}

/** Props of {@link FlowchartFooter}. */
export interface FlowchartFooterProps {
    /** The `flowchart` recipe's styles. */
    readonly styles: Styles;
    /** What the flowchart holds, counted: its transitions, and their split. */
    readonly counts: ModelCounts;
    /** The changes waiting on Save; `undefined` where the flowchart edits nothing. */
    readonly pending: number | undefined;
    /** When the records were last saved, as the footer says it — the newest of their last saves; `undefined` with none. */
    readonly saved: string | undefined;
    /** Why a card's ⏎ was refused — `Drop onto a transition`; `undefined`, nothing to say. */
    readonly message?: string | undefined;
    /** The flowchart's words: its numbers print in the app's locale. */
    readonly words: FlowchartWords;
    /** Each kind read through its source that writes: its Save's notice. */
    readonly notices: readonly FlowchartNotice[];
    /** What the loading line says: a read in flight, or one that failed, with Retry; `undefined` while nothing is read. */
    readonly line: LoadingLineValue | undefined;
}

/**
 * Renders the footer — see the module docs.
 *
 * @param props - The counts, the changes waiting, the last save, a refused ⏎'s reason, the Saves' notices and the
 *   loading line
 * @returns The footer
 */
export function FlowchartFooter({ styles, counts, pending, saved, message, words, notices, line }: FlowchartFooterProps) {
    const m = words.m;
    const rail = useRef<HTMLDivElement>(null);
    const fit = useFooterFit(rail);
    const shown = useRevealed() === true;
    return (
        <Box ref={rail} css={styles.footer} data-flowchart-footer="">
            <Box as="span" css={styles.footerStrong}>{words.number(counts.transitions)}</Box>
            <Box as="span">{m.footerLinks({ n: counts.transitions })}</Box>
            {message !== undefined && <Box as="span">·</Box>}
            {/* Always there, so a screen reader hears each line it takes. */}
            <Box as="span" css={styles.footerMessage} data-flowchart-message="" data-footer-slack="" aria-live="polite">{message ?? ""}</Box>
            {notices.map((notice) => <RecordSliceSaveNotice key={notice.sort} slice={notice.slice} singular={notice.singular} plural={notice.plural} />)}
            <Box css={styles.footerSplit} data-flowchart-split="">
                {m.footerSplit({
                    planned: words.number(counts.planned), observed: words.number(counts.observed),
                    unresolved: counts.unresolved > 0 ? words.number(counts.unresolved) : undefined,
                })}
                {pending !== undefined && <Box as="span" data-flowchart-pending="">{` · ${m.footerPending({ n: pending, count: words.number(pending) })}`}</Box>}
                {saved !== undefined && <Box as="span" data-flowchart-saved="">{` · ${m.footerSaved({ when: saved })}`}</Box>}
            </Box>
            <LoadingLine value={line} shown={shown} form={fit.form} />
        </Box>
    );
}

/** A record's last save (R15): when, as the footer and the inspector say it, and who made it. */
export interface FlowchartLastSave {
    /** The record's kind. */
    readonly sort: FlowchartSort;
    /** The kind's name, as the payload gives it. */
    readonly name: string;
    /** When: its time when it was today, its date and time otherwise. */
    readonly when: string;
    /** When, as an instant: what tells the newest of them. */
    readonly at: Date;
    /** Who made it, where it names a person. */
    readonly by: string | undefined;
}

/** The last saves of the records, each record's, and the newest of them. */
export interface FlowchartLastSaves {
    /** Each record's last save, in the Flowchart's order of its kinds: one with no commit, or whose read fails, says nothing. */
    readonly records: readonly FlowchartLastSave[];
    /** The newest of them; `undefined` with none. */
    readonly newest: FlowchartLastSave | undefined;
}

/** No record saved. */
const NONE_SAVED: FlowchartLastSaves = { records: [], newest: undefined };

/**
 * When each of the Flowchart's records was last saved, and who saved it
 * (R15): its newest commit, read from its kind's `history` where its commits
 * are read — and again as the record commits — each its time when it was
 * today, its date and time otherwise, and the person it names. A kind bound
 * with `Data.bind` or `Data.bindPaged` alone has no history.
 *
 * @param value - The payload
 * @param words - The formatters the time prints with, in the app's locale
 * @returns Each record's last save, and the newest of them
 */
export function useLastSaves(value: FlowchartValue, words: Formatters): FlowchartLastSaves {
    const read = useCallback(() => FLOWCHART_SORTS.flatMap((sort) => {
        const kind = kindOf(value, sort);
        if (kind === undefined || kind.history.type !== "some") return [];
        try {
            const commits = kind.history.value();
            const newest = commits.type === "some" ? commits.value[0] : undefined;
            return newest === undefined ? [] : [{ sort, name: kind.name, at: newest.at, actor: newest.actor }];
        } catch {
            return [];
        }
    }), [value]);
    const { result } = useTrackedEvaluation(read);
    const commits = result.ok ? result.value : undefined;
    return useMemo(() => {
        if (commits === undefined || commits.length === 0) return NONE_SAVED;
        const today = words.date(new Date());
        const records = commits.map((commit): FlowchartLastSave => ({
            sort: commit.sort, name: commit.name, at: commit.at, by: authorOf(commit.actor),
            when: stringEqual(words.date(commit.at), today) ? words.time(commit.at) : words.dateTime(commit.at),
        }));
        const newest = records.reduce((a, b) => (compareInstant(b.at, a.at) > 0 ? b : a));
        return { records, newest };
    }, [commits, words]);
}
