/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How a call says which of its drafts ended it (east-workspace#1619).
 *
 * A draft is an unsaved edit a call lays over a record its function reads. A
 * call a draft's mutation ended `failed` or `timed_out`, before its function
 * ran, names the draft in its result's `draftEnd` (`FunctionDraftEndType`),
 * and says which in the first line of its stderr, for people to read: `draft
 * jobs.patch (2 of 3) failed`, or `draft jobs.patch (2 of 3) timed out`. The
 * mutation's own stderr follows it, as a Save returns it. A call whose timeout
 * ended once its drafts were all laid, before its function ran, names that in
 * its `draftEnd`, and says so in its first line instead: `drafts laid (3 of 3),
 * and the call's timeout ended before its function ran`.
 *
 * A caller reads what ended a call from its `draftEnd` alone, never from the
 * line (#1680's review): a function that ran may write the same line itself.
 * The lines are written here, so every job that ends a call says them alike.
 */

import type { ExecuteResult, FunctionDraftFailure } from './api.js';

/** How each end reads in the line. */
const HOW = { failed: 'failed', timed_out: 'timed out' } as const;

/**
 * How a call names one of its drafts: `draft jobs.patch (2 of 3)`. A refusal
 * of the draft begins with it, and so does the line a call it ended says so in
 * ({@link functionDraftEndLine}).
 *
 * @param draft - The draft's record and mutation
 * @param place - Its place among the call's drafts, from 1
 * @param of - How many drafts the call passed
 * @returns The draft's name
 */
export function functionDraftLabel(draft: { readonly record: string; readonly mutation: string }, place: number, of: number): string {
  return `draft ${draft.record}.${draft.mutation} (${place} of ${of})`;
}

/**
 * The first line of the stderr of a call a draft ended: `draft jobs.patch (2
 * of 3) failed`, or `… timed out`.
 *
 * @param end - The draft, and how its mutation ended, as the call's `draftEnd`
 *   names it
 * @returns The line, with no line end
 */
export function functionDraftEndLine(end: FunctionDraftFailure): string {
  return `${functionDraftLabel(end, Number(end.place), Number(end.of))} ${HOW[end.how.type]}`;
}

/**
 * The draft that ended a call before its function ran, as its result's
 * `draftEnd` names it.
 *
 * @remarks
 * A call whose timeout ended between two drafts' runs names the draft that
 * did not start. One whose timeout ended once its drafts were all laid names
 * none ({@link functionDraftsOutlasted} says so of it), and neither does a
 * `conflict`, whose outcome names its draft itself. Neither does a call whose
 * function ran, whatever the first line of its stderr says.
 *
 * @param result - A call's result: what ended it
 * @returns The draft, or `null` when no draft's mutation ended the call
 */
export function functionDraftEnded(result: Pick<ExecuteResult, 'draftEnd'>): FunctionDraftFailure | null {
  return result.draftEnd.type === 'some' && result.draftEnd.value.type === 'draft' ? result.draftEnd.value.value : null;
}

/**
 * The first line of the stderr of a call whose timeout ended once its drafts
 * were all laid, before its function ran: `drafts laid (3 of 3), and the
 * call's timeout ended before its function ran`.
 *
 * @param of - How many drafts the call passed, every one of them laid
 * @returns The line, with no line end
 */
export function functionDraftsLaidLine(of: number): string {
  return `drafts laid (${of} of ${of}), and the call's timeout ended before its function ran`;
}

/**
 * Whether a call's timeout ended once its drafts were all laid, before its
 * function ran, as its result's `draftEnd` says: the time went on its drafts,
 * and its function did not run.
 *
 * @param result - A call's result: what ended it
 * @returns Whether it ended so; `false` for a call that passed no draft, one
 *   that did not time out, and one whose function ran
 */
export function functionDraftsOutlasted(result: Pick<ExecuteResult, 'draftEnd'>): boolean {
  return result.draftEnd.type === 'some' && result.draftEnd.value.type === 'laid';
}
