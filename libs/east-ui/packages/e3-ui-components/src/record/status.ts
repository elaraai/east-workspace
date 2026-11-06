/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the Record's status line says (`Record - DX Proposal.md` FR5,
 * AD1–AD7), in the Record's word for its rows:
 *
 * - **the last gesture's words** — the Sheet's notice, worded again where the
 *   Record has words of its own: a row added, rows deleted, an Add the app
 *   gave nothing to draft from, the issues gone to; every other notice in the
 *   Sheet's words;
 * - **else what a step of the history did** — Undo, Redo, Discard and
 *   Apply, each told as it is taken ({@link stepOf}, {@link createRecordStatus}),
 *   until a gesture or a notice comes after it;
 * - **else how many rows are ticked**, of the rows shown.
 *
 * What an Apply sends and a Discard drops is tallied before the step is taken
 * ({@link tallyDrafts}): after it the session holds none of it.
 *
 * Of the three, the line says whichever spoke last and still has words
 * ({@link useRecordStatusLine}): a notice the Sheet has cleared has none, nor a
 * step a gesture has come after, nor the ticks once none is ticked.
 *
 * @packageDocumentation
 */

import { useState, useSyncExternalStore } from "react";
import { StringType, equalFor } from "@elaraai/east";
import type { EditIssue, HistoryAction } from "@elaraai/east-ui-components";
import { DRAFT_ISSUE_TEXT } from "@elaraai/east-ui-components/internal";
import type { SheetNotice } from "../sheet/sheet-types.js";
import type { SheetTransactions } from "../sheet/transactions.js";
import { noticeText, type SheetWords } from "../sheet/words.js";
import { recordMessages as m, type RecordTally } from "./messages.js";
import type { RecordTicks } from "./ticks.js";

const stringEqual = equalFor(StringType);

/** The Record's word for its rows, one and many: `person`, `people`. */
export interface RecordNoun {
    readonly singular: string;
    readonly plural: string;
}

/** What a step of the history did, as the status line says it (AD4–AD7). */
export type RecordStep =
    | { readonly id: "undid" | "redid" }
    | { readonly id: "restored"; readonly n: number }
    | { readonly id: "discarded"; readonly n: number }
    | { readonly id: "applied"; readonly tally: RecordTally };

/** A step the status line was told of, and when: each told later than the one before. */
export interface RecordSaid {
    readonly step: RecordStep;
    readonly seq: number;
}

/** The steps the status line is told of, read through `useSyncExternalStore`. */
export interface RecordStatus {
    /** Hears every step told; returns the call that stops it. */
    subscribe: (listener: () => void) => () => void;
    /** The step told last, if any. */
    said: () => RecordSaid | undefined;
    /** Tells a step. */
    say: (step: RecordStep) => void;
}

/**
 * Makes a Record's status line's store, no step told.
 *
 * @returns The store
 */
export function createRecordStatus(): RecordStatus {
    let said: RecordSaid | undefined;
    const listeners = new Set<() => void>();
    return {
        subscribe: (listener) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        said: () => said,
        say: (step) => {
            said = { step, seq: (said?.seq ?? 0) + 1 };
            for (const listener of listeners) listener();
        },
    };
}

/**
 * What the drafts send as an Apply (AD4): the fields they change on rows the
 * record holds and on how many, the rows they add, and those they delete — a
 * new row a draft dropped again none of them.
 *
 * @param session - The editing session
 * @param fields - How many fields a draft changes against the one its entry began from
 * @returns The tally
 */
export function tallyDrafts(session: SheetTransactions, fields: (before: unknown, current: unknown) => number): RecordTally {
    let changes = 0;
    let changed = 0;
    let added = 0;
    let deleted = 0;
    for (const [id, entry] of session.entries) {
        const was = session.originals.get(id)?.draft;
        const now = entry.draft;
        if (was === undefined) {
            if (now !== undefined) added += 1;
            continue;
        }
        if (now === undefined) {
            deleted += 1;
            continue;
        }
        const n = fields(was, now);
        if (n === 0) continue;
        changes += n;
        changed += 1;
    }
    return { changes, changed, added, deleted };
}

/**
 * What a step of the history will have done, read before it is taken: Undo
 * of a deletion restores its rows; any other Undo, and any Redo, one change;
 * Discard drops every draft; Apply sends them.
 *
 * @param action - The step
 * @param session - The editing session, as it stands before the step
 * @param fields - How many fields a draft changes against the one its entry began from
 * @returns The step's words' facts; `undefined` for a step the session will not take, and a refresh
 */
export function stepOf(action: HistoryAction, session: SheetTransactions, fields: (before: unknown, current: unknown) => number): RecordStep | undefined {
    switch (action) {
        case "undo": {
            const step = session.nextUndo;
            if (!session.canUndo || step === undefined) return undefined;
            return step.origin === "remove" ? { id: "restored", n: step.entries } : { id: "undid" };
        }
        case "redo":
            return session.canRedo ? { id: "redid" } : undefined;
        case "discard": {
            if (!session.canDiscard || session.pending === 0) return undefined;
            const tally = tallyDrafts(session, fields);
            // A change of a row's place alone is a change too.
            return { id: "discarded", n: Math.max(tally.changes + tally.added + tally.deleted, session.pending) };
        }
        case "apply":
            return session.canApply ? { id: "applied", tally: tallyDrafts(session, fields) } : undefined;
        default:
            return undefined;
    }
}

/**
 * The status line's words for a step of the history.
 *
 * @param step - What the step did
 * @param words - The Sheet's words: the counts in the viewer's language
 * @param noun - The Record's word for its rows
 * @returns The words
 */
export function stepText(step: RecordStep, words: SheetWords, noun: RecordNoun): string {
    switch (step.id) {
        case "undid": return m.undid();
        case "redid": return m.redid();
        case "restored": return m.restored({ n: step.n, count: words.number(step.n), noun: noun.singular, nouns: noun.plural });
        case "discarded": return m.discarded({ n: step.n, count: words.number(step.n) });
        case "applied": return m.applied({ tally: step.tally, count: (n) => words.number(n), noun: noun.singular, nouns: noun.plural });
    }
}

/**
 * The status line's words for the Sheet's notice: the Record's own where it
 * has them, every other notice in the Sheet's words.
 *
 * @param notice - The notice the last gesture left
 * @param words - The Sheet's words
 * @param noun - The Record's word for its rows
 * @param issues - Every issue holding Apply: what an issue gone to counts
 * @returns The words
 */
export function recordNoticeText(notice: SheetNotice, words: SheetWords, noun: RecordNoun, issues: readonly EditIssue[]): string {
    switch (notice.id) {
        case "newRow": return m.added({ noun: noun.singular });
        case "deleted":
            return notice.what !== "rows" ? noticeText(notice, words)
                : m.deleted({ n: notice.n, count: words.number(notice.n), noun: noun.singular, nouns: noun.plural });
        case "cantAdd": return notice.what === "row" ? m.cantAdd({ noun: noun.singular, label: notice.label }) : noticeText(notice, words);
        case "issue": {
            // The issues holding Apply: a new row's empty fields alone, or the app's refusals among them (AD3).
            if (issues.length === 0) return noticeText(notice, words);
            const refused = issues.some((issue) => !stringEqual(issue.message, DRAFT_ISSUE_TEXT.required));
            return m.issues({ n: issues.length, count: words.number(issues.length), refused });
        }
        default: return noticeText(notice, words);
    }
}

/** When each of the status line's voices last spoke — a count of every time any did — and what it said then. */
interface StatusOrder {
    /** How many times a voice has spoken. */
    n: number;
    /** The notice last seen, and when it came: `-1` for none. */
    notice: { of: SheetNotice | null; at: number };
    /** The step last told, when, and how many gestures had been recorded then: one more takes its words away. */
    step: { seq: number; at: number; gestures: number };
    /** The ticks as last seen, and when they last moved. */
    ticks: { version: number; at: number };
}

/** What {@link useRecordStatusLine} reads. */
export interface RecordStatusInput {
    /** The steps of the history the Record has told. */
    status: RecordStatus;
    /** The Sheet's notice: the last gesture's words, `null` once a step of the history moved past them. */
    notice: SheetNotice | null;
    /** How many gestures the Sheet has recorded. */
    gestures: number;
    /** The rows ticked. */
    ticks: RecordTicks;
    /** How many of the rows shown are ticked. */
    ticked: number;
    /** How many rows are shown. */
    of: number;
    /** Every issue holding Apply: what the words of an issue gone to count. */
    issues: readonly EditIssue[];
    /** The Sheet's words. */
    words: SheetWords;
    /** The Record's word for its rows. */
    noun: RecordNoun;
}

/**
 * The status line's words (FR5): the notice, the step or the ticks — whichever
 * spoke last and still has words — see the module docs.
 *
 * @param input - The voices, and what their words are made of
 * @returns The words; empty while no voice has any
 */
export function useRecordStatusLine(input: RecordStatusInput): string {
    const { status, notice, gestures, ticks, ticked, of, issues, words, noun } = input;
    const said = useSyncExternalStore(status.subscribe, status.said);
    const version = useSyncExternalStore(ticks.subscribe, ticks.version);
    const [order, setOrder] = useState<StatusOrder>(() => ({
        n: 0, notice: { of: notice, at: -1 }, step: { seq: said?.seq ?? 0, at: -1, gestures }, ticks: { version, at: -1 },
    }));
    // Each voice that has spoken since the last render, counted as it is read — state the render adjusts, never a ref it writes.
    let next = order;
    if (!Object.is(next.notice.of, notice)) next = { ...next, n: next.n + 1, notice: { of: notice, at: notice === null ? -1 : next.n + 1 } };
    if (said !== undefined && said.seq !== next.step.seq) next = { ...next, n: next.n + 1, step: { seq: said.seq, at: next.n + 1, gestures } };
    if (version !== next.ticks.version) next = { ...next, n: next.n + 1, ticks: { version, at: next.n + 1 } };
    if (next !== order) setOrder(next);
    const voices: readonly { at: number; text: string | undefined }[] = [
        { at: next.notice.at, text: notice === null ? undefined : recordNoticeText(notice, words, noun, issues) },
        { at: next.step.at, text: said === undefined || gestures !== next.step.gestures ? undefined : stepText(said.step, words, noun) },
        { at: next.ticks.at, text: ticked === 0 ? undefined : m.selected({ count: words.number(ticked), of: words.number(of) }) },
    ];
    let spoken: { at: number; text: string } | undefined;
    for (const voice of voices) if (voice.text !== undefined && (spoken === undefined || voice.at > spoken.at)) spoken = { at: voice.at, text: voice.text };
    return spoken?.text ?? "";
}
