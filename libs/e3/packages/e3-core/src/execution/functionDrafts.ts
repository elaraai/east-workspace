/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A call's drafts: unsaved edits its caller passes, laid over the records its
 * function reads, so the function reads them as a Save would have left them,
 * and nothing is saved (east-workspace#1619).
 *
 * A draft is a mutation call that is not committed. A call that passes drafts
 * goes through two steps:
 * - **Pin** ({@link pinCallDrafts}), as the call starts. Each draft is checked:
 *   against the records its function lists as ones a call may draft, and as a
 *   Save of the record checks a mutation before anything runs, with its
 *   arguments' types beside. Then everything laying the drafts reads is named:
 *   each drafted record's state and the commit it stands at, by one read; the
 *   object of each mutation; and each draft's arguments, stored. So the laying
 *   reads the workspace no more, and lays the same state however often it runs.
 * - **Lay** ({@link layCallDrafts}), as the call runs. The drafts are laid in
 *   the order the call passed them, each by a Save's first half over the state
 *   the draft before it left its record (`recordLayDraft`), and each drafted
 *   record's last state is stored. The call's inputs of a drafted record are
 *   read at that state ({@link draftedInputs}). No commit is stored and no
 *   record is moved, so nothing another reader of the workspace sees changes.
 *
 * Both go through `StorageBackend` and `TaskRunner`, so every backend shares
 * them, and a caller in process over a local repository lays its drafts as a
 * kept call's run does.
 *
 * @packageDocumentation
 */

import { SortedMap, equalFor, none, some } from '@elaraai/east';
import {
  TreePathType,
  type ExecuteResult,
  type FunctionCallDraft,
  type FunctionCallDrafted,
  type FunctionDraft,
  type FunctionObject,
  type PackageObject,
  type TreePath,
} from '@elaraai/e3-types';
import {
  encodeMutationArgs, readRecordState, recordDraftMutation, recordHead, recordLayDraft, recordOfPackage, writeRecordState,
  type RecordStateRefs, type ResolvedRecord,
} from '../records.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { TaskRunner } from './interfaces.js';

const samePath = equalFor(TreePathType);

/**
 * A call's drafts as it keeps them, once its start has checked them and named
 * what laying them reads.
 */
export interface CallDrafts {
  /** Each draft, in the order the call passed them: its record and mutation,
   *  its arguments' tuple, and the commit its record stood at. */
  readonly drafts: FunctionCallDraft[];
  /** Each drafted record once, in the order the drafts first name them, with
   *  what its drafts are laid from. */
  readonly drafted: FunctionCallDrafted[];
}

/** The drafts of a call that passed none. */
export const NO_CALL_DRAFTS: CallDrafts = { drafts: [], drafted: [] };

/**
 * How a call names one of its drafts: `draft jobs.patch (2 of 3)`.
 *
 * @param draft - The draft's record and mutation
 * @param at - Its place among the call's drafts, from 0
 * @param total - How many drafts the call passed
 * @returns The draft's name, as a refusal and the first line of a failed
 *   call's stderr begin
 */
function draftLabel(draft: { readonly record: string; readonly mutation: string }, at: number, total: number): string {
  return `draft ${draft.record}.${draft.mutation} (${at + 1} of ${total})`;
}

/** A drafted record while a call's drafts are checked. */
interface PinnedRecord {
  readonly record: ResolvedRecord;
  /** Where the workspace holds the record, as the function's input names it. */
  readonly path: TreePath;
  /** The state the record held, and the commit it stood at. */
  readonly base: string;
  readonly commit: string;
  /** The object of each mutation the call's drafts of it name. */
  readonly mutations: Map<string, string>;
}

/**
 * Checks a call's drafts, and names everything laying them reads.
 *
 * @remarks
 * Each draft is checked in the order the call passed them, and the first one
 * found wrong refuses the call, named as `draft <record>.<mutation> (<n> of
 * <total>)`:
 * - the function must list the draft's record among those a call may draft
 *   (`drafts` on `e3.function`): listing one is its author's word that the
 *   function is fit to run over edits nobody saved;
 * - the record must be one of the package's, which one of the function's
 *   inputs reads, and must hold a state, with the commit it stands at;
 * - the mutation must be one the record declares, given the arguments it
 *   takes, in number and in type (`recordDraftMutation`).
 *
 * A drafted record's state and commit are read once, whatever number of drafts
 * name it. Once every draft is checked, each one's arguments are stored as the
 * tuple a commit names a mutation's by, in one batch: objects nothing names
 * until the call is filed, so the caller holds the repository's running work
 * (`withRunningWork`) from here until it is.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param workspace - The workspace the call is made through
 * @param pkg - The package the call's function was resolved in, decoded: the
 *   records the drafts name are resolved in it too
 * @param fn - The function's inputs and the records it lists as ones a call
 *   may draft
 * @param drafts - The call's drafts, in order
 * @returns The drafts as the call keeps them, or why the call is refused
 *   (`invalid`), naming the draft
 */
export async function pinCallDrafts(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  pkg: PackageObject,
  fn: Pick<FunctionObject, 'inputs' | 'drafts'>,
  drafts: readonly FunctionDraft[],
): Promise<CallDrafts | { invalid: string }> {
  if (drafts.length === 0) return NO_CALL_DRAFTS;
  const refuse = (at: number, why: string): { invalid: string } => ({ invalid: `${draftLabel(drafts[at]!, at, drafts.length)}: ${why}` });
  const records = new Map<string, PinnedRecord>();
  for (const [at, draft] of drafts.entries()) {
    let pinned = records.get(draft.record);
    if (pinned === undefined) {
      if (!fn.drafts.includes(draft.record)) {
        return refuse(at, fn.drafts.length === 0
          ? 'the function lists no record a call may draft'
          : `the function does not list record '${draft.record}' among those a call may draft: ${fn.drafts.map((name) => `'${name}'`).join(', ')}`);
      }
      const record = await recordOfPackage(storage, repo, pkg, draft.record);
      if (record === null) return refuse(at, `record '${draft.record}' not found`);
      const path = fn.inputs.find((input) => input.map((segment) => segment.value).join('/') === record.refPath);
      if (path === undefined) return refuse(at, `the function reads no input of record '${draft.record}'`);
      const head = await recordHead(storage, repo, workspace, draft.record, record);
      if ('invalid' in head) return refuse(at, head.invalid);
      pinned = { record, path, base: head.state, commit: head.commit, mutations: new Map() };
      records.set(draft.record, pinned);
    }
    const checked = await recordDraftMutation(storage, repo, pinned.record, draft.record, draft.mutation, draft.args);
    if ('invalid' in checked) return refuse(at, checked.invalid);
    pinned.mutations.set(draft.mutation, checked.mutation);
  }

  // Every draft is one its record takes: each one's arguments are stored
  const tuples = drafts.map((draft) => (draft.args.length > 0 ? encodeMutationArgs(draft.args) : null));
  const stored = await storage.objects.writeMany(repo, tuples.filter((tuple) => tuple !== null));
  let storedAt = 0;
  return {
    drafts: drafts.map((draft, at) => ({
      record: draft.record,
      mutation: draft.mutation,
      args: tuples[at] === null ? none : some(stored[storedAt++]!),
      commit: records.get(draft.record)!.commit,
    })),
    drafted: [...records].map(([record, { path, base, mutations }]) => ({
      record,
      path,
      base,
      mutations: new SortedMap<string, string>(mutations),
    })),
  };
}

/** How {@link layCallDrafts} runs each draft's mutation. */
export interface LayCallDraftsOptions {
  /** When the call's timeout ends, in epoch milliseconds: a draft's mutation
   *  runs for what is left of it, and none starts once it has passed. */
  readonly deadline: number;
  /** How much of a failed mutation's stderr is kept, in bytes: the call's log
   *  limit. */
  readonly maxLogBytes: number;
  /** Aborting it stops the laying. */
  readonly signal?: AbortSignal;
  /** Pass `-v` to a stock runner. */
  readonly verbose?: boolean;
  /** The time, in epoch milliseconds (default `Date.now`). */
  readonly now?: () => number;
}

/**
 * How laying a call's drafts came out ({@link layCallDrafts}).
 *
 * A call a draft ended `failed` or `timed_out` says which draft in the first
 * line of its `stderr`, `draft jobs.patch (2 of 3) failed` or `draft jobs.patch
 * (2 of 3) timed out`, and the mutation's own stderr follows it, as a Save
 * returns it; `stderrTruncated` says whether that is the tail of a longer log.
 */
export type CallDraftsLaid =
  /** Every draft was laid: each drafted record's path, and the hash of the
   *  state its drafts left. */
  | { readonly kind: 'laid'; readonly states: ReadonlyArray<{ readonly path: TreePath; readonly hash: string }> }
  /** A draft's mutation failed, as a Save of it would have. */
  | { readonly kind: 'failed'; readonly exitCode: number; readonly stderr: string; readonly stderrTruncated: boolean }
  /** A draft's mutation was still running, or was yet to run, when the call's
   *  timeout ended. */
  | { readonly kind: 'timed_out'; readonly stderr: string; readonly stderrTruncated: boolean }
  /** A draft no longer fits its record, which changed under the edit: the
   *  record, the mutation and the refusal's words. */
  | { readonly kind: 'conflict'; readonly record: string; readonly mutation: string; readonly message: string }
  /** The caller's signal stopped the laying. */
  | { readonly kind: 'aborted' };

/**
 * Lays a call's drafts, and stores the state each drafted record is read at.
 *
 * @remarks
 * Each drafted record starts at the state the call's start named. The drafts
 * are laid in the order the call passed them, each over the state the draft
 * before it left its record, by the mutation's own program (`recordLayDraft`):
 * so every index of the record holds the drafts, as it would after the Save.
 * The first draft that does not lay ends the laying as a Save of it would have
 * ended, and nothing after it runs. A draft carries no limits of its own: its
 * mutation runs for what is left of the call's timeout.
 *
 * It reads only what the call's start named, by hash, and writes objects
 * nothing names until its caller names the states it answers, so the caller
 * holds the repository's running work (`withRunningWork`) until then. It
 * stores no commit and moves no record.
 *
 * @param storage - Storage backend
 * @param runner - Task runner each mutation's program runs on
 * @param repo - Repository identifier
 * @param pinned - The call's drafts, as {@link pinCallDrafts} named them
 * @param options - The call's deadline and log limit, with its cancellation,
 *   verbosity and clock
 * @returns Each drafted record's path and drafted state, or how a draft ended
 *   the laying
 * @throws {Error} When an object the call's start named cannot be read
 */
export async function layCallDrafts(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  pinned: CallDrafts,
  options: LayCallDraftsOptions,
): Promise<CallDraftsLaid> {
  const now = options.now ?? Date.now;
  const records = new Map<string, { readonly drafted: FunctionCallDrafted; state: RecordStateRefs }>();
  for (const drafted of pinned.drafted) {
    records.set(drafted.record, { drafted, state: await readRecordState(storage, repo, drafted.base) });
  }
  for (const [at, draft] of pinned.drafts.entries()) {
    const label = draftLabel(draft, at, pinned.drafts.length);
    if (options.signal?.aborted) return { kind: 'aborted' };
    const left = options.deadline - now();
    if (left <= 0) return { kind: 'timed_out', stderr: `${label} timed out\n`, stderrTruncated: false };
    const record = records.get(draft.record);
    const mutation = record?.drafted.mutations.get(draft.mutation);
    if (record === undefined || mutation === undefined) {
      throw new Error(`${label} names a record or a mutation the call's start did not name`);
    }
    const laid = await recordLayDraft(storage, runner, repo, record.state,
      { mutation, args: draft.args.type === 'some' ? draft.args.value : null },
      {
        timeoutMs: left,
        maxLogBytes: options.maxLogBytes,
        ...(options.signal !== undefined && { signal: options.signal }),
        ...(options.verbose !== undefined && { verbose: options.verbose }),
      });
    switch (laid.kind) {
      case 'laid':
        record.state = laid.state;
        break;
      case 'failed':
        return { kind: 'failed', exitCode: laid.exitCode, stderr: `${label} failed\n${laid.stderr}`, stderrTruncated: laid.stderrTruncated };
      case 'timed_out':
        return { kind: 'timed_out', stderr: `${label} timed out\n${laid.stderr}`, stderrTruncated: laid.stderrTruncated };
      case 'conflict':
        return { kind: 'conflict', record: draft.record, mutation: draft.mutation, message: laid.detail };
      case 'aborted':
        return laid;
    }
  }
  const states: Array<{ path: TreePath; hash: string }> = [];
  for (const { drafted, state } of records.values()) {
    states.push({ path: drafted.path, hash: await writeRecordState(storage, repo, state) });
  }
  return { kind: 'laid', states };
}

/**
 * A call's inputs with each input of a drafted record at another state: the
 * state its drafts are laid over, as the call starts, and the state they left,
 * once they are laid. Every other input is as it was pinned.
 *
 * @param inputs - The function's inputs, each with the hash it was pinned at
 * @param states - Each drafted record's path, and the hash its inputs are read at
 * @returns The inputs, in the same order
 */
export function draftedInputs(
  inputs: ExecuteResult['inputs'],
  states: ReadonlyArray<{ readonly path: TreePath; readonly hash: string }>,
): ExecuteResult['inputs'] {
  return inputs.map((input) => {
    const state = states.find(({ path }) => samePath(path, input.path));
    return state === undefined ? input : { path: input.path, hash: state.hash };
  });
}
