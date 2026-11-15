/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * How a call says which of its drafts ended it (east-workspace#1619).
 *
 * A draft is an unsaved edit a call lays over a record its function reads. A
 * call a draft's mutation ended `failed` or `timed_out`, before its function
 * ran, says which draft in the first line of its stderr: `draft jobs.patch (2
 * of 3) failed`, or `draft jobs.patch (2 of 3) timed out`. The mutation's own
 * stderr follows it, as a Save returns it. A call whose timeout ended once its
 * drafts were all laid, before its function ran, says that in its first line
 * instead: `drafts laid (3 of 3), and the call's timeout ended before its
 * function ran`.
 *
 * Those lines are written and read here, so the job that ends a call and a
 * caller that shows why it ended agree on their form.
 */

import type { ExecuteResult } from './api.js';

/** The draft that ended a call before its function ran. */
export interface FunctionDraftEnd {
  /** The record the draft was of. */
  readonly record: string;
  /** The draft's mutation. */
  readonly mutation: string;
  /** Its place among the call's drafts, from 1. */
  readonly place: number;
  /** How many drafts the call passed. */
  readonly of: number;
  /** How its mutation ended: as a Save of it would have. */
  readonly how: 'failed' | 'timed_out';
}

/** How each end reads in the line. */
const HOW = { failed: 'failed', timed_out: 'timed out' } as const;

/** The line, as it is read back: the record is all before the mutation's dot. */
const LINE = /^draft (.+)\.([^.]+) \((\d+) of (\d+)\) (failed|timed out)$/;

/** The line of a call whose timeout ended once its drafts were all laid, as it is read back. */
const LAID_LINE = /^drafts laid \((\d+) of (\d+)\), and the call's timeout ended before its function ran$/;

/** A call's stderr's first line: all of it, for a stderr of one line. */
function firstLine(stderr: string): string {
  const lineEnd = stderr.indexOf('\n');
  return lineEnd === -1 ? stderr : stderr.slice(0, lineEnd);
}

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
 * @param end - The draft, and how its mutation ended
 * @returns The line, with no line end
 */
export function functionDraftEndLine(end: FunctionDraftEnd): string {
  return `${functionDraftLabel(end, end.place, end.of)} ${HOW[end.how]}`;
}

/**
 * The draft that ended a call before its function ran, read from the first
 * line of the call's stderr.
 *
 * @remarks
 * Only a call that passed drafts and ended `failed` or `timed_out` can have
 * been ended by one, and its first line must say so of that end. A call whose
 * timeout ended between two drafts' runs names the draft that did not start.
 * One whose timeout ended once its drafts were all laid names none
 * ({@link functionDraftsOutlasted} says so of it), and neither does a
 * `conflict`, whose outcome names its draft itself.
 *
 * @param result - A call's result: its outcome, its stderr and the records it
 *   drafted
 * @returns The draft, or `null` when no draft's mutation ended the call
 */
export function functionDraftEnded(result: Pick<ExecuteResult, 'outcome' | 'stderr' | 'drafts'>): FunctionDraftEnd | null {
  const how = result.outcome.type;
  if ((how !== 'failed' && how !== 'timed_out') || result.drafts.length === 0) return null;
  const matched = LINE.exec(firstLine(result.stderr));
  if (matched === null || matched[5] !== HOW[how]) return null;
  return { record: matched[1]!, mutation: matched[2]!, place: Number(matched[3]), of: Number(matched[4]), how };
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
 * function ran, as the first line of its stderr says
 * ({@link functionDraftsLaidLine}): the time went on its drafts, and its
 * function did not run.
 *
 * @param result - A call's result: its outcome, its stderr and the records it
 *   drafted
 * @returns Whether it ended so; `false` for a call that passed no draft, one
 *   that did not time out, and one whose function ran
 */
export function functionDraftsOutlasted(result: Pick<ExecuteResult, 'outcome' | 'stderr' | 'drafts'>): boolean {
  if (result.outcome.type !== 'timed_out' || result.drafts.length === 0) return false;
  const matched = LAID_LINE.exec(firstLine(result.stderr));
  return matched !== null && matched[1] === matched[2];
}
