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
 * - **Check** ({@link checkCallDrafts}), as the call starts, under the
 *   workspace's shared lock, beside the read of the deployed package and of
 *   every input the call pins: each draft is checked against the records its
 *   function lists as ones a call may draft, and as a Save of the record checks
 *   a mutation before anything runs, with its arguments' types beside. Then
 *   everything laying the drafts reads is named: each drafted record's state
 *   and the commit it stands at, by one read, and the object of each mutation.
 *   So the laying reads the workspace no more, and lays the same state however
 *   often it runs. A kept call stores each draft's arguments as it files the
 *   call ({@link storeCallDrafts}).
 * - **Lay and stage** ({@link layAndStage}), as the call runs: the drafts are
 *   laid in the order the call passed them, each by a Save's first half over
 *   the state the draft before it left its record (`recordLayDraft`), and each
 *   drafted record's last state is stored. The call's inputs of a drafted
 *   record are read at that state, and a dataset argument naming one as
 *   saved, at the state the drafts were laid over; what its function is handed
 *   is staged from them ({@link stageCall}).
 *
 * No commit is stored and no record is moved, so the record, its history and
 * what reads it stay as they were for every reader. A kept call holds its
 * drafts and the states they leave as it holds its arguments: whoever the
 * host lets read the call sees them. Each draft's mutation runs as a Save's
 * does, an execution recorded, logged and cached by its inputs.
 *
 * Everything here goes through `StorageBackend` and `TaskRunner`, and a kept
 * call's run (`functionCall.ts`) and a call no store keeps, of a local
 * repository (`functionCallUnkept.ts`), lay and stage through the one
 * {@link layAndStage}, so the two read and end alike.
 *
 * @packageDocumentation
 */

import { SortedMap, equalFor, variant, none, some } from '@elaraai/east';
import {
  TreePathType,
  functionDraftEndLine,
  functionDraftLabel,
  functionDraftsLaidLine,
  treePathToRefPath,
  type ExecuteResult,
  type FunctionCallArg,
  type FunctionCallDraft,
  type FunctionCallDrafted,
  type FunctionDraft,
  type FunctionObject,
  type PackageObject,
  type TreePath,
} from '@elaraai/e3-types';
import {
  decodeMutationArgs, encodeMutationArgs, readRecordState, recordDraftMutation, recordHead, recordLayDraft, recordOfPackage, writeRecordState,
  type RecordStateRefs, type ResolvedRecord,
} from '../records.js';
import type { StorageBackend } from '../storage/interfaces.js';
import type { DetachedArg, TaskRunner } from './interfaces.js';

const samePath = equalFor(TreePathType);

/**
 * A kept call's drafts, as its start files them: each draft with its stored
 * arguments, and each record it drafts with what laying them reads.
 */
export interface CallDrafts {
  /** Each draft, in the order the call passed them: its record and mutation,
   *  and its arguments' tuple. */
  readonly drafts: FunctionCallDraft[];
  /** Each drafted record once, in the order the drafts first name them, with
   *  what its drafts are laid from and the commit it stood at. */
  readonly drafted: FunctionCallDrafted[];
}

/** The drafts of a call that passed none. */
export const NO_CALL_DRAFTS: CallDrafts = { drafts: [], drafted: [] };

/** A drafted record while a call's drafts are checked. */
interface CheckedRecord {
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
 * name it. Its caller holds the workspace's shared lock (`withSharedWorkspaceLock`)
 * from its read of the deployed package to the last read it pins, so the
 * package, the states and the inputs are one workspace's: a deploy, which
 * takes the lock exclusively, cannot land between them. Nothing is written.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param workspace - The workspace the call is made through
 * @param pkg - The package deployed to it, decoded, as its hash names it: the
 *   records the drafts name are resolved in it, as a Save resolves them
 * @param fn - The function's inputs and the records it lists as ones a call
 *   may draft
 * @param drafts - The call's drafts, in order
 * @returns Each drafted record once, in the order the drafts first name them,
 *   or why the call is refused (`invalid`), naming the draft
 *
 * @example
 * ```ts
 * const drafted = await withSharedWorkspaceLock(storage, repo, 'production', undefined, async () => {
 *   const { pkg, fn } = await workspaceFunctionResolve(storage, repo, 'production', 'jobs_on');
 *   return checkCallDrafts(storage, repo, 'production', pkg, fn, [{ record: 'jobs', mutation: 'move', args: [jobId, pressId] }]);
 * });
 * if ('invalid' in drafted) throw new Error(drafted.invalid); // e.g. "draft jobs.move (1 of 1): ..."
 * ```
 */
export async function checkCallDrafts(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  pkg: PackageObject,
  fn: Pick<FunctionObject, 'inputs' | 'drafts'>,
  drafts: readonly FunctionDraft[],
): Promise<FunctionCallDrafted[] | { invalid: string }> {
  const refuse = (at: number, why: string): { invalid: string } =>
    ({ invalid: `${functionDraftLabel(drafts[at]!, at + 1, drafts.length)}: ${why}` });
  const records = new Map<string, CheckedRecord>();
  for (const [at, draft] of drafts.entries()) {
    let checked = records.get(draft.record);
    if (checked === undefined) {
      if (!fn.drafts.includes(draft.record)) {
        return refuse(at, fn.drafts.length === 0
          ? 'the function lists no record a call may draft'
          : `the function does not list record '${draft.record}' among those a call may draft: ${fn.drafts.map((name) => `'${name}'`).join(', ')}`);
      }
      const record = await recordOfPackage(storage, repo, pkg, draft.record);
      if (record === null) return refuse(at, `record '${draft.record}' not found`);
      // The input whose dataset is the record's, by the key the store holds both by
      const path = fn.inputs.find((input) => treePathToRefPath(input) === record.refPath);
      if (path === undefined) return refuse(at, `the function reads no input of record '${draft.record}'`);
      const head = await recordHead(storage, repo, workspace, draft.record, record);
      if ('invalid' in head) return refuse(at, head.invalid);
      checked = { record, path, base: head.state, commit: head.commit, mutations: new Map() };
      records.set(draft.record, checked);
    }
    const mutation = await recordDraftMutation(storage, repo, checked.record, draft.record, draft.mutation, draft.args);
    if ('invalid' in mutation) return refuse(at, mutation.invalid);
    checked.mutations.set(draft.mutation, mutation.mutation);
  }
  return [...records].map(([record, { path, base, commit, mutations }]) => ({
    record,
    path,
    base,
    commit,
    mutations: new SortedMap<string, string>(mutations),
  }));
}

/**
 * Stores a kept call's drafts' arguments, each as the tuple a commit names a
 * mutation's arguments by, in one batch: what the call keeps, and its run
 * lays its drafts from ({@link keptCallDrafts}).
 *
 * @remarks
 * The objects are named by nothing until the call is filed, so the caller
 * holds the repository's running work (`withRunningWork`) until it is. A call
 * no store keeps lays its drafts from its arguments in hand, and stores none.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param drafts - The call's drafts, in order, checked ({@link checkCallDrafts})
 * @returns Each draft as the call keeps it, its arguments by their tuple's
 *   hash, `none` for a mutation that takes none
 *
 * @example
 * ```ts
 * const kept = await withRunningWork(storage, repo, async () => {
 *   const drafts = await storeCallDrafts(storage, repo, request.drafts);
 *   await storage.calls.create(repo, { ...job, call: { ...job.call, drafts } }); // now the call names them
 *   return drafts;
 * });
 * ```
 */
export async function storeCallDrafts(storage: StorageBackend, repo: string, drafts: readonly FunctionDraft[]): Promise<FunctionCallDraft[]> {
  const tuples = drafts.map((draft) => (draft.args.length > 0 ? encodeMutationArgs(draft.args) : null));
  const stored = await storage.objects.writeMany(repo, tuples.filter((tuple) => tuple !== null));
  let storedAt = 0;
  return drafts.map((draft, at) => ({
    record: draft.record,
    mutation: draft.mutation,
    args: tuples[at] === null ? none : some(stored[storedAt++]!),
  }));
}

/**
 * A kept call's drafts as its run lays them: each draft with its arguments
 * read back from the tuple the call keeps, the tuples read side by side.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param drafts - The call's drafts, as it keeps them ({@link storeCallDrafts})
 * @returns The drafts, in order, their arguments in hand
 * @throws {Error} When a tuple the call names cannot be read
 *
 * @example
 * ```ts
 * const drafts = await keptCallDrafts(storage, repo, job.call.drafts);
 * const staged = await layAndStage(storage, runner, repo, { inputs: job.call.inputs, args: keptCallArgs(job.call.args), drafted: job.drafted, drafts }, options);
 * ```
 */
export async function keptCallDrafts(storage: StorageBackend, repo: string, drafts: readonly FunctionCallDraft[]): Promise<FunctionDraft[]> {
  return Promise.all(drafts.map(async (draft) => ({
    record: draft.record,
    mutation: draft.mutation,
    args: draft.args.type === 'some' ? decodeMutationArgs(await storage.objects.read(repo, draft.args.value)) : [],
  })));
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
 * (2 of 3) timed out` (`functionDraftEndLine`, which a caller reads back with
 * `functionDraftEnded`), and the mutation's own stderr follows it, as a Save
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
 * How a call ends when one of its drafts did not lay, or when its timeout
 * ended before its function ran: its outcome, as the call's state and its
 * result both hold it, and the stderr that says why.
 */
export interface CallDraftsEnd {
  /** `failed` or `timed_out`, as a Save of the draft would have ended, or
   *  `conflict`, naming the record, the mutation and the refusal's words. */
  readonly outcome: Extract<ExecuteResult['outcome'], { type: 'failed' | 'timed_out' | 'conflict' }>;
  /**
   * The draft in its first line, then its mutation's own stderr, for a
   * `failed` or `timed_out` a draft's mutation ended; the line alone, naming
   * the draft that did not start, for a call whose timeout ended between two
   * drafts' runs; `drafts laid (n of n), and the call's timeout ended before
   * its function ran` for one whose timeout ended once every draft was laid
   * (`functionDraftsLaidLine`). Empty for a `conflict`, whose outcome says it
   * all, and for a call that passed no draft and whose timeout ended before
   * its function ran.
   */
  readonly stderr: string;
  /** Whether the mutation's stderr is the tail of a longer log. */
  readonly stderrTruncated: boolean;
}

/**
 * The end a call comes to when its drafts were not all laid
 * ({@link layCallDrafts}): what a kept call's run records, and what a call run
 * in process answers, so the two end a call alike.
 *
 * @param ended - How the laying ended
 * @param timeoutMs - The call's timeout, which a `timed_out` end names
 * @returns The call's outcome, and its stderr
 *
 * @example
 * ```ts
 * const laid = await layCallDrafts(storage, runner, repo, drafted, drafts, options);
 * if (laid.kind === 'failed') return callDraftsEnd(laid, 60_000n); // failed, its stderr naming the draft
 * ```
 */
export function callDraftsEnd(
  ended: Extract<CallDraftsLaid, { kind: 'failed' | 'timed_out' | 'conflict' }>,
  timeoutMs: bigint,
): CallDraftsEnd {
  switch (ended.kind) {
    case 'failed':
      return { outcome: variant('failed', { exitCode: BigInt(ended.exitCode) }), stderr: ended.stderr, stderrTruncated: ended.stderrTruncated };
    case 'timed_out':
      return { outcome: variant('timed_out', { ms: timeoutMs }), stderr: ended.stderr, stderrTruncated: ended.stderrTruncated };
    case 'conflict':
      return {
        outcome: variant('conflict', { record: ended.record, mutation: ended.mutation, message: ended.message }),
        stderr: '',
        stderrTruncated: false,
      };
  }
}

/**
 * The end a call comes to when its timeout ended before its function ran:
 * once its drafts were all laid, its stderr's first line says so
 * (`functionDraftsLaidLine`), so a caller tells the time its drafts took from
 * a function that ran out of it; a call that passed none says nothing.
 *
 * @param drafts - How many drafts the call passed, every one laid
 * @param timeoutMs - The call's timeout, which the end names
 * @returns The call's outcome, `timed_out`, and its stderr
 */
function timedOutBeforeRun(drafts: number, timeoutMs: bigint): CallDraftsEnd {
  return {
    outcome: variant('timed_out', { ms: timeoutMs }),
    stderr: drafts === 0 ? '' : `${functionDraftsLaidLine(drafts)}\n`,
    stderrTruncated: false,
  };
}

/**
 * Lays a call's drafts, and stores the state each drafted record is read at.
 *
 * @remarks
 * Each drafted record starts at the state the call's start named, every one
 * read side by side. The drafts are laid in the order the call passed them,
 * each over the state the draft before it left its record, by the mutation's
 * own program (`recordLayDraft`): so every index of the record holds the
 * drafts, as it would after the Save. The first draft that does not lay ends
 * the laying as a Save of it would have ended, and nothing after it runs. A
 * draft carries no limits of its own: its mutation runs for what is left of
 * the call's timeout. Each drafted record's last state is stored, side by
 * side.
 *
 * It reads only what the call's start named, by hash, and writes objects
 * nothing names until its caller names the states it answers, so the caller
 * holds the repository's running work (`withRunningWork`) until then. It
 * stores no commit and moves no record.
 *
 * @param storage - Storage backend
 * @param runner - Task runner each mutation's program runs on
 * @param repo - Repository identifier
 * @param drafted - Each record the call drafts, as {@link checkCallDrafts}
 *   named it
 * @param drafts - The call's drafts, in order, their arguments in hand
 * @param options - The call's deadline and log limit, with its cancellation,
 *   verbosity and clock
 * @returns Each drafted record's path and drafted state, or how a draft ended
 *   the laying
 * @throws {Error} When an object the call's start named cannot be read
 *
 * @example
 * ```ts
 * const laid = await withRunningWork(storage, repo, () =>
 *   layCallDrafts(storage, runner, repo, job.drafted, await keptCallDrafts(storage, repo, job.call.drafts), {
 *     deadline: job.deadline.getTime(), maxLogBytes: 64 * 1024,
 *   }));
 * if (laid.kind === 'laid') console.log(laid.states); // each drafted record's path, and the state its drafts left
 * ```
 */
export async function layCallDrafts(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  drafted: readonly FunctionCallDrafted[],
  drafts: readonly FunctionDraft[],
  options: LayCallDraftsOptions,
): Promise<CallDraftsLaid> {
  const now = options.now ?? Date.now;
  const states = await Promise.all(drafted.map((record) => readRecordState(storage, repo, record.base)));
  const records = new Map<string, { readonly drafted: FunctionCallDrafted; state: RecordStateRefs }>(
    drafted.map((record, at) => [record.record, { drafted: record, state: states[at]! }]));
  for (const [at, draft] of drafts.entries()) {
    const named = { record: draft.record, mutation: draft.mutation, place: at + 1, of: drafts.length };
    /** The first line of the call's stderr, when this draft ends it. */
    const ends = (how: 'failed' | 'timed_out'): string => `${functionDraftEndLine({ ...named, how })}\n`;
    if (options.signal?.aborted) return { kind: 'aborted' };
    const left = options.deadline - now();
    if (left <= 0) return { kind: 'timed_out', stderr: ends('timed_out'), stderrTruncated: false };
    const record = records.get(draft.record);
    const mutation = record?.drafted.mutations.get(draft.mutation);
    if (record === undefined || mutation === undefined) {
      throw new Error(`${functionDraftLabel(draft, named.place, named.of)} names a record or a mutation the call's start did not name`);
    }
    const laid = await recordLayDraft(storage, runner, repo, record.state, { mutation, args: draft.args }, {
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
        return { kind: 'failed', exitCode: laid.exitCode, stderr: `${ends('failed')}${laid.stderr}`, stderrTruncated: laid.stderrTruncated };
      case 'timed_out':
        return { kind: 'timed_out', stderr: `${ends('timed_out')}${laid.stderr}`, stderrTruncated: laid.stderrTruncated };
      case 'conflict':
        return { kind: 'conflict', record: draft.record, mutation: draft.mutation, message: laid.detail };
      case 'aborted':
        return laid;
    }
  }
  const held = [...records.values()];
  const hashes = await Promise.all(held.map(({ state }) => writeRecordState(storage, repo, state)));
  return { kind: 'laid', states: held.map(({ drafted: record }, at) => ({ path: record.path, hash: hashes[at]! })) };
}

/**
 * The records a call drafted, as its result names them: each once, in the
 * order its drafts first name them, with the commit it stood at as the call
 * started.
 *
 * @param drafted - Each record the call drafts ({@link checkCallDrafts})
 * @returns The records it drafted; none for a call that passed no draft
 *
 * @example
 * ```ts
 * const read = callDraftsRead(job.drafted); // [{ record: 'jobs', commit: '9f2c…' }]
 * ```
 */
export function callDraftsRead(drafted: readonly FunctionCallDrafted[]): ExecuteResult['drafts'] {
  return drafted.map(({ record, commit }) => ({ record, commit }));
}

/**
 * A call's inputs with each input of a drafted record at another state: the
 * state its drafts are laid over, as the call starts, and the state they left,
 * once they are laid. Every other input is as it was pinned.
 *
 * @param inputs - The function's inputs, each with the hash it was pinned at
 * @param states - Each drafted record's path, and the hash its inputs are read at
 * @returns The inputs, in the same order
 *
 * @example
 * ```ts
 * // As the call starts: each input of a drafted record at the state its drafts are laid over
 * const inputs = draftedInputs(pinned.inputs, drafted.map(({ path, base }) => ({ path, hash: base })));
 * ```
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

/**
 * A call's argument, as its staging takes it: a value as its runner is handed
 * it, or a dataset of the workspace by its path and the hash it was pinned at.
 */
export type StagedCallArg =
  | { readonly value: DetachedArg }
  | { readonly dataset: { readonly path: TreePath; readonly hash: string } };

/**
 * A kept call's arguments, as its staging takes them: a value by the object
 * the call stored it as, which the runner stages as it stages a dataset, and a
 * dataset by its path and the hash it was pinned at.
 *
 * @param args - The call's arguments, as it keeps them
 * @returns The arguments, in order
 *
 * @example
 * ```ts
 * const { read } = stageCall(job.call.inputs, keptCallArgs(job.call.args), job.drafted);
 * ```
 */
export function keptCallArgs(args: readonly FunctionCallArg[]): StagedCallArg[] {
  return args.map((arg) => (arg.type === 'value' ? { value: { dataset: arg.value } } : { dataset: arg.value }));
}

/**
 * What a call's function is handed, and what the call read.
 *
 * @remarks
 * The function is handed its inputs, then its arguments, in order. Its inputs
 * of a drafted record are read where the caller passes them: at the state the
 * drafts are laid over as the call starts, and at the state they left once
 * they are laid. A dataset argument that names a record the call drafts is
 * read as saved, at exactly the state the drafts were laid over, the one the
 * result's commit names (east-workspace#1619, rule 6): so a function handed
 * one sees the record before and after the edit side by side, and the result
 * names both hashes. Every other dataset argument is read at the hash it was
 * pinned at.
 *
 * @param inputs - The function's inputs, each with the hash it is read at
 * @param args - The call's arguments, in order
 * @param drafted - The records the call drafts: the paths the workspace holds
 *   them at, and the states their drafts are laid over
 * @returns What the function is handed, and what the call read: its inputs,
 *   then each dataset argument, with the hash each is read at
 *
 * @example
 * ```ts
 * const { args, read } = stageCall(inputs, [{ dataset: { path: jobsPath, hash: savedJobs } }], drafted);
 * // read[inputs.length].hash is the state the drafts were laid over: the record before the edit
 * ```
 */
export function stageCall(
  inputs: ExecuteResult['inputs'],
  args: readonly StagedCallArg[],
  drafted: ReadonlyArray<{ readonly path: TreePath; readonly base: string }>,
): { args: DetachedArg[]; read: ExecuteResult['inputs'] } {
  const staged: DetachedArg[] = inputs.map(({ hash }) => ({ dataset: hash }));
  const read: ExecuteResult['inputs'] = [...inputs];
  for (const arg of args) {
    if ('value' in arg) {
      staged.push(arg.value);
      continue;
    }
    const { path } = arg.dataset;
    // A drafted record, as saved: at the state its drafts were laid over, which the argument's own pin may have
    // read after a Save that landed since
    const hash = drafted.find((record) => samePath(record.path, path))?.base ?? arg.dataset.hash;
    staged.push({ dataset: hash });
    read.push({ path, hash });
  }
  return { args: staged, read };
}

/** A call's run, as {@link layAndStage} lays its drafts and stages it. */
export interface DraftedCall {
  /** The function's inputs, each at the hash it was pinned at: an input of a
   *  drafted record at the state its drafts are laid over. */
  readonly inputs: ExecuteResult['inputs'];
  /** Its arguments, in order. */
  readonly args: readonly StagedCallArg[];
  /** Each record it drafts ({@link checkCallDrafts}); none for a call that
   *  passed no draft. */
  readonly drafted: readonly FunctionCallDrafted[];
  /** Its drafts, in order, their arguments in hand. */
  readonly drafts: readonly FunctionDraft[];
}

/** How {@link layAndStage} lays a call's drafts, and what it does once they are laid. */
export interface LayAndStageOptions extends LayCallDraftsOptions {
  /** The call's timeout, which a `timed_out` end names. */
  readonly timeoutMs: bigint;
  /**
   * Called with the function's inputs once the drafts are laid, each of a
   * drafted record at the state they left, before anything is staged: a kept
   * call's run names them in its store here (`FunctionCallStore.pinInputs`),
   * which roots the drafted states. Answers whether the call goes on; `false`
   * for one that ended meanwhile, or is kept no longer. None for a call no
   * store keeps.
   */
  readonly pin?: (inputs: ExecuteResult['inputs']) => Promise<boolean>;
}

/**
 * What {@link layAndStage} came to.
 *
 * - `staged`: what the call's function is handed, what the call read, and the
 *   milliseconds left of its timeout, which the function runs for
 * - `ended`: the call ended before its function ran — a draft that did not
 *   lay, or its timeout — and what it read, each input of a drafted record at
 *   the state its drafts were laid over when one did not lay
 * - `aborted`: the caller's signal stopped the laying
 * - `unpinned`: `pin` answered that the call does not go on
 */
export type CallStaged =
  | { readonly kind: 'staged'; readonly args: DetachedArg[]; readonly read: ExecuteResult['inputs']; readonly left: number }
  | { readonly kind: 'ended'; readonly end: CallDraftsEnd; readonly read: ExecuteResult['inputs'] }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'unpinned' };

/**
 * Lays a call's drafts and stages its function's run: the one step a kept
 * call's run (`functionCallRun`) and a call no store keeps
 * (`functionCallUnkept`) both take, so the two read and end alike.
 *
 * @remarks
 * In order:
 * 1. **Lay.** A call that passed drafts lays them ({@link layCallDrafts}). One
 *    that does not lay ends the call as a Save of it would have ended
 *    ({@link callDraftsEnd}), and its function does not run.
 * 2. **Pin.** The function's inputs of each drafted record are read at the
 *    state its drafts left ({@link draftedInputs}), and handed to `pin`.
 * 3. **Stage.** A call whose timeout has ended meanwhile ends `timed_out`, its
 *    function not run, its first line saying its drafts were laid. Otherwise
 *    the function is staged ({@link stageCall}): its inputs, then its
 *    arguments, a dataset argument naming a drafted record read as saved, at
 *    the state the drafts were laid over.
 *
 * A call that passed drafts writes the states they leave before anything names
 * them, so its caller holds the repository's running work (`withRunningWork`)
 * around this step, until `pin`, or the function's run, names them.
 *
 * @param storage - Storage backend
 * @param runner - Task runner each draft's mutation runs on
 * @param repo - Repository identifier
 * @param call - The function's inputs as the call pinned them, its arguments,
 *   the records it drafts and its drafts
 * @param options - The call's deadline, timeout and log limit, its
 *   cancellation, verbosity and clock, and what is done once the drafts are
 *   laid
 * @returns What the call's function is handed, or how the call ended before
 *   it ran
 * @throws {Error} When an object the call's start named cannot be read
 *
 * @example
 * ```ts
 * const staged = await withRunningWork(storage, repo, () => layAndStage(storage, runner, repo,
 *   { inputs, args, drafted, drafts: request.drafts },
 *   { deadline, timeoutMs: 60_000n, maxLogBytes: 64 * 1024 }));
 * if (staged.kind === 'staged') await runner.runDetached({ bodyIr, args: staged.args, runner: fn.runner, limits: { ...limits, timeoutMs: staged.left } }, { storage });
 * ```
 */
export async function layAndStage(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  call: DraftedCall,
  options: LayAndStageOptions,
): Promise<CallStaged> {
  const now = options.now ?? Date.now;
  let inputs = call.inputs;
  if (call.drafts.length > 0) {
    const laid = await layCallDrafts(storage, runner, repo, call.drafted, call.drafts, options);
    if (laid.kind === 'aborted') return laid;
    if (laid.kind !== 'laid') return { kind: 'ended', end: callDraftsEnd(laid, options.timeoutMs), read: stageCall(inputs, call.args, call.drafted).read };
    inputs = draftedInputs(inputs, laid.states);
    if (options.pin !== undefined && !(await options.pin(inputs))) return { kind: 'unpinned' };
  }
  const staged = stageCall(inputs, call.args, call.drafted);
  const left = options.deadline - now();
  // Its timeout ended before its function ran: as its drafts were laid, or
  // before it was staged
  if (left <= 0) return { kind: 'ended', end: timedOutBeforeRun(call.drafts.length, options.timeoutMs), read: staged.read };
  return { kind: 'staged', args: staged.args, read: staged.read, left };
}
