/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Handlers for the calls of named functions through a workspace, and of
 * one-shots started as calls (east-workspace#1554).
 *
 * A call is filed by e3-core's `functionCallStart` — a one-shot's by
 * `oneShotCallStart`, its caller's program run as an anonymous function — run
 * where the transfer backend's dispatch runs calls (`FunctionCallDispatch`),
 * and kept in the repository's call store (`StorageBackend.calls`) for the
 * lifetime its end gives it. So a call outlasts the request that starts it:
 * its start waits a while for it and answers its result, or `running` with its
 * id, which its caller polls until it ends. The sync call is the same call,
 * waited for within its request. Each handler reads the store for whatever the
 * dispatch cannot say, so a poll is answered alike by whichever instance it
 * reaches.
 */

import { none, some, variant } from '@elaraai/east';
import {
  FUNCTION_CALL_GRACE_MS,
  PermissionDeniedError,
  WorkspaceNotFoundError,
  functionCallDrafted,
  functionCallInputs,
  functionCallLost,
  functionCallRead,
  functionCallStart,
  functionCallStatus,
  functionCallSummary,
  oneShotCallStart,
} from '@elaraai/e3-core/portable';
import type {
  ExecuteCeilings, FunctionCallDispatch, FunctionCallLifetimes, FunctionCallStartOptions, OneShotGrant, StorageBackend,
} from '@elaraai/e3-core/portable';
import type { FunctionCallJob } from '@elaraai/e3-types';
import { sendError, sendSuccess } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import {
  ExecuteResultType,
  FUNCTION_CALLS_PAGE_DEFAULT,
  FUNCTION_CALLS_PAGE_MAX,
  FunctionCallAnswerType,
  FunctionCallPageType,
  FunctionCallStatusType,
  FunctionCallType,
  type FunctionCall,
  type FunctionCallRequest,
  type FunctionCallState,
  type FunctionCallStatus,
  type FunctionCallSummary,
  type OneShotRequest,
} from '../types.js';

/** How long a wait holds between its looks at the store, for a call whose end
 *  its dispatch does not hear of: one run elsewhere, or by another instance. */
const LOOK_MS = 500;

/** How long past a sync call's deadline its request waits for the call's run
 *  to record its end, which a run does once it stops itself at its timeout,
 *  before the request answers `timed_out` itself. */
const SYNC_GRACE_MS = 1000;

/**
 * Whether a request's caller may read, or cancel, a kept call: what a host
 * whose callers see only some of a workspace's calls decides, by the call's
 * `caller` say.
 */
export type CallAdmit = (call: FunctionCall) => boolean | Promise<boolean>;

/** Options for {@link startFunctionCall} and {@link callFunctionInWorkspace}. */
export interface FunctionCallFilingOptions {
  /** Who makes the call, as the host's auth names them; `null` without one */
  caller: string | null;
  /** The caller's one-shot grant, which decides whether its call may give the
   *  function a platform package the function does not load: only `any` may */
  grant: OneShotGrant;
  /** The most a call may ask for (default: a server's) */
  ceilings?: ExecuteCeilings;
  /** How long a call is kept once it ends (default: an hour for a success or a
   *  cancel, a week for any other end) */
  lifetimes?: FunctionCallLifetimes;
  /** Pass `-v` to a stock runner */
  verbose?: boolean;
}

/** Options for {@link startFunctionCall}. */
export interface StartFunctionCallOptions extends FunctionCallFilingOptions {
  /** How long the start waits for the call to end before it answers
   *  `running`, in ms: 0 answers at once */
  waitMs: number;
  /** An id the client chose for the call, a UUIDv7 of about now, so it can
   *  stop the call before the start answers (e3-core's `functionCallStart`
   *  sets aside one far from the server's clock) */
  id?: string;
}

/** Options for {@link callFunctionInWorkspace}. */
export interface CallFunctionInWorkspaceOptions extends FunctionCallFilingOptions {
  /** The host's deadline for a sync call, under its request timeout (default
   *  120 000 ms): the call's timeout is clamped under it */
  syncDeadlineMs?: number;
}

/** Options for {@link getFunctionCallStatus}. */
export interface FunctionCallStatusOptions {
  /** How long the poll waits for the call to end before it answers
   *  `running`, in ms: 0 answers at once */
  waitMs: number;
  /** Whether the caller may read the call (default: any caller may) */
  admit?: CallAdmit;
}

/** Options for {@link cancelFunctionCall}. */
export interface CancelFunctionCallOptions {
  /** Who asks, as the host's auth names them; `null` without one */
  by: string | null;
  /** How long the cancel waits for the call to stop before it answers
   *  `running`, in ms */
  waitMs: number;
  /** Whether the caller may cancel the call (default: any caller may) */
  admit?: CallAdmit;
}

/** Which of a workspace's calls {@link listFunctionCalls} answers. */
export interface FunctionCallListQuery {
  /** Only the calls whose ids sort before it, the next page's cursor */
  before?: string;
  /** At most this many (default {@link FUNCTION_CALLS_PAGE_DEFAULT}, and at
   *  most {@link FUNCTION_CALLS_PAGE_MAX}) */
  limit?: number;
  /** Only the calls of the function of this name */
  function?: string;
  /** Only the calls in the state of this tag */
  state?: FunctionCallState['type'];
}

/**
 * Start a call of a named function through a workspace: file it, run it where
 * the backend runs calls, and wait up to `waitMs` for it to end.
 *
 * @remarks
 * The call is checked, its inputs and dataset arguments pinned and its value
 * arguments stored as e3-core's `functionCallStart` does, and it is kept from
 * now until its lifetime ends. A call found wrong is filed ended `invalid`,
 * and answered `completed` with that result. A call is held to its own
 * timeout, never to the request's: one still running when the wait passes is
 * answered `running`, and its caller polls by its id. A call the dispatch
 * cannot hand to the compute that runs calls is recorded `lost`, and answered
 * so.
 *
 * @param storage - Storage backend
 * @param dispatch - Runs the call where the backend runs calls
 * @param repo - The repository's name, which the dispatch takes
 * @param repoPath - The repository's identifier, which the store takes
 * @param workspace - The workspace the call is made through
 * @param fnName - The function's name in the deployed package
 * @param request - The arguments, and any runner and limits the caller names
 * @param options - Who calls, their grant, the ceilings, the lifetimes and how
 *   long to wait
 * @returns The response: the call's id and how it stood when the wait ended;
 *   or the error that stopped its start — the workspace, its package or the
 *   function not found, or `permission_denied` (`path` `runner`)
 */
export async function startFunctionCall(
  storage: StorageBackend,
  dispatch: FunctionCallDispatch,
  repo: string,
  repoPath: string,
  workspace: string,
  fnName: string,
  request: FunctionCallRequest,
  options: StartFunctionCallOptions,
): Promise<Response> {
  try {
    const job = await functionCallStart(storage, repoPath, workspace, fnName, request, {
      ...filingOf(options),
      ...(options.id !== undefined && { id: options.id }),
    });
    const status = await runAndWait(storage, dispatch, repo, repoPath, job, options.waitMs);
    return sendSuccess(FunctionCallAnswerType, { id: job.call.id, status });
  } catch (err) {
    return sendError(FunctionCallAnswerType, errorToVariant(err));
  }
}

/**
 * Start a one-shot as a call through a workspace: file it, run it where the
 * backend runs calls, and wait up to `waitMs` for it to end — what a named
 * function's start does, for its caller's program.
 *
 * @remarks
 * The request is held to its caller's grant, as a one-shot run within a
 * request is, before anything is read; its program is filed as an anonymous
 * function, its dataset arguments pinned and its value arguments stored, as
 * e3-core's `oneShotCallStart` does; and it is kept from now until its
 * lifetime ends, listed among the workspace's calls naming no function. A
 * call found wrong is filed ended `invalid`, and answered `completed` with
 * that result. A call is held to its own timeout, never to the request's: one
 * still running when the wait passes is answered `running`, and its caller
 * polls it by its id, and cancels it, through the calls routes. A call the
 * dispatch cannot hand to the compute that runs calls is recorded `lost`, and
 * answered so.
 *
 * @param storage - Storage backend
 * @param dispatch - Runs the call where the backend runs calls
 * @param repo - The repository's name, which the dispatch takes
 * @param repoPath - The repository's identifier, which the store takes
 * @param workspace - The workspace whose datasets the call reads
 * @param request - The program, its arguments, its runner and its limits
 * @param options - Who calls, their grant, the ceilings, the lifetimes and how
 *   long to wait
 * @returns The response: the call's id and how it stood when the wait ended;
 *   or the error that stopped its start — `permission_denied` (`path`
 *   `one-shot`) for a request the caller's grant does not run, and the
 *   workspace not found or not deployed
 */
export async function startOneShotCall(
  storage: StorageBackend,
  dispatch: FunctionCallDispatch,
  repo: string,
  repoPath: string,
  workspace: string,
  request: OneShotRequest,
  options: StartFunctionCallOptions,
): Promise<Response> {
  try {
    const job = await oneShotCallStart(storage, repoPath, workspace, request, {
      ...filingOf(options),
      grant: options.grant,
      ...(options.id !== undefined && { id: options.id }),
    });
    const status = await runAndWait(storage, dispatch, repo, repoPath, job, options.waitMs);
    return sendSuccess(FunctionCallAnswerType, { id: job.call.id, status });
  } catch (err) {
    return sendError(FunctionCallAnswerType, errorToVariant(err));
  }
}

/**
 * Call a named function through a workspace synchronously: the call is filed
 * and kept as a started one is, and the request waits for it to end.
 *
 * @remarks
 * The call's timeout defaults as a sync call's does, and is clamped under the
 * host's sync deadline, so the caller gets a structured `timed_out` instead of
 * a transport cut. Its run stops it at that timeout and records it so; should
 * the record not land within a second of the deadline, the request answers
 * `timed_out` itself. A call cancelled while the request waits, or lost, has
 * no result: it is answered `internal`, saying which.
 *
 * @param storage - Storage backend
 * @param dispatch - Runs the call where the backend runs calls
 * @param repo - The repository's name, which the dispatch takes
 * @param repoPath - The repository's identifier, which the store takes
 * @param workspace - The workspace the call is made through
 * @param fnName - The function's name in the deployed package
 * @param request - The arguments, and any runner and limits the caller names
 * @param options - Who calls, their grant, the ceilings, the lifetimes and the
 *   host's sync deadline
 * @returns The response: the call's result, or the error that stopped it
 */
export async function callFunctionInWorkspace(
  storage: StorageBackend,
  dispatch: FunctionCallDispatch,
  repo: string,
  repoPath: string,
  workspace: string,
  fnName: string,
  request: FunctionCallRequest,
  options: CallFunctionInWorkspaceOptions,
): Promise<Response> {
  try {
    const job = await functionCallStart(storage, repoPath, workspace, fnName, request, {
      ...filingOf(options),
      sync: options.syncDeadlineMs === undefined ? {} : { deadlineMs: options.syncDeadlineMs },
    });
    const status = await runAndWait(storage, dispatch, repo, repoPath, job, job.deadline.getTime() + SYNC_GRACE_MS - Date.now());
    switch (status.type) {
      case 'completed':
        return sendSuccess(ExecuteResultType, status.value);
      case 'running':
        // Its run stops it at its timeout, which is under the deadline, and
        // records it timed out too
        return sendSuccess(ExecuteResultType, {
          outcome: variant('timed_out', { ms: job.call.limits.timeoutMs }),
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          inputs: functionCallInputs(job),
          drafts: functionCallDrafted(job),
        });
      case 'cancelled': {
        const by = status.value.by.type === 'some' ? ` by ${status.value.by.value}` : '';
        return sendError(ExecuteResultType, variant('internal', { message: `call ${job.call.id} was cancelled${by}, and has no result` }));
      }
      case 'lost':
        return sendError(ExecuteResultType, variant('internal', { message: `call ${job.call.id} was lost: ${status.value.message}` }));
    }
  } catch (err) {
    return sendError(ExecuteResultType, errorToVariant(err));
  }
}

/**
 * A call's status, as its caller polls it, waiting up to `waitMs` for it to
 * end.
 *
 * @remarks
 * `running` until it ends; then its result, its value read back inline up to
 * its `maxResultBytes`, or `cancelled` or `lost`. A call still recorded running
 * past its deadline and a grace — its host stopped before it ended — is
 * recorded `lost`, and answered so.
 *
 * @param storage - Storage backend
 * @param dispatch - Runs the workspace's calls, and hears of their ends
 * @param repo - The repository's name, which the dispatch takes
 * @param repoPath - The repository's identifier, which the store takes
 * @param workspace - The workspace the call was made through
 * @param id - The call's id
 * @param options - How long to wait, and whether the caller may read the call
 * @returns The response: the status; or the error — `permission_denied`
 *   (`path` `call`) for a caller the host does not admit, and `internal` for a
 *   call the workspace does not keep: none was made, or its lifetime has ended
 */
export async function getFunctionCallStatus(
  storage: StorageBackend,
  dispatch: FunctionCallDispatch,
  repo: string,
  repoPath: string,
  workspace: string,
  id: string,
  options: FunctionCallStatusOptions,
): Promise<Response> {
  try {
    const job = await readCall(storage, repoPath, workspace, id, options.admit);
    return sendSuccess(FunctionCallStatusType, await waitFor(storage, dispatch, repo, repoPath, job, Date.now() + options.waitMs));
  } catch (err) {
    return sendError(FunctionCallStatusType, errorToVariant(err));
  }
}

/**
 * Cancel a running call: record the request, tell the dispatch, and wait up to
 * `waitMs` for the call to stop.
 *
 * @remarks
 * The call's run stops its runner and records it `cancelled`, naming who
 * asked: at once where the dispatch runs the call in its own process, and
 * otherwise at the run's next look at its record. A call that has ended is
 * left as it is, and answered with its status: a cancel changes nothing then.
 *
 * @param storage - Storage backend
 * @param dispatch - Runs the workspace's calls, and stops them
 * @param repo - The repository's name, which the dispatch takes
 * @param repoPath - The repository's identifier, which the store takes
 * @param workspace - The workspace the call was made through
 * @param id - The call's id
 * @param options - Who asks, how long to wait, and whether they may
 * @returns The response: the call's status once it stopped, or `running`
 *   while it stops; or the error, as {@link getFunctionCallStatus} answers it
 */
export async function cancelFunctionCall(
  storage: StorageBackend,
  dispatch: FunctionCallDispatch,
  repo: string,
  repoPath: string,
  workspace: string,
  id: string,
  options: CancelFunctionCallOptions,
): Promise<Response> {
  try {
    const job = await readCall(storage, repoPath, workspace, id, options.admit);
    if (job.call.state.type !== 'running') {
      return sendSuccess(FunctionCallStatusType, await functionCallStatus(storage, repoPath, job));
    }
    const asked = await storage.calls.requestCancel(repoPath, workspace, id, {
      by: options.by === null ? none : some(options.by),
      at: new Date(),
    });
    if (asked === null) throw noCall(workspace, id);
    await dispatch.cancel(repo, workspace, id);
    return sendSuccess(FunctionCallStatusType, await waitFor(storage, dispatch, repo, repoPath, asked, Date.now() + options.waitMs));
  } catch (err) {
    return sendError(FunctionCallStatusType, errorToVariant(err));
  }
}

/**
 * A page of a workspace's kept calls, the latest first: each by who made it,
 * when, and how it stands or ended.
 *
 * @remarks
 * A call is kept for its lifetime, so the list holds the last hour's successes
 * and the last week's failures, by default, however many calls are made: a
 * client reads it a page at a time, passing a page's `next` as the next one's
 * `before`. A page may hold fewer calls than its limit, or none, and name a
 * next all the same: a store that reads a bounded number of calls a list, as
 * the cloud's does, stops where its reads stopped. A call still recorded
 * running past its deadline and a grace is recorded `lost` as the page passes
 * it, as a read of it records it.
 *
 * @param storage - Storage backend
 * @param repoPath - The repository's identifier
 * @param workspace - The workspace
 * @param query - The page's cursor and size, and only a function's calls, or
 *   only those in a state
 * @returns The response: the page; or the error — `workspace_not_found` for a
 *   workspace there is not
 */
export async function listFunctionCalls(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  query: FunctionCallListQuery = {},
): Promise<Response> {
  try {
    if (await storage.refs.workspaceRead(repoPath, workspace) === null) throw new WorkspaceNotFoundError(workspace);
    const limit = Math.min(query.limit ?? FUNCTION_CALLS_PAGE_DEFAULT, FUNCTION_CALLS_PAGE_MAX);
    // The store says where the next page starts: a store that reads a bounded
    // number of calls a list may stop short of the limit, and name a next
    const page = await storage.calls.list(repoPath, workspace, {
      limit,
      ...(query.before !== undefined && { before: query.before }),
      ...(query.function !== undefined && { function: query.function }),
      ...(query.state !== undefined && { state: query.state }),
    });
    const now = Date.now();
    const calls: FunctionCallSummary[] = [];
    for (const job of page.calls) {
      const current = job.call.state.type === 'running' && now > job.deadline.getTime() + FUNCTION_CALL_GRACE_MS
        ? await functionCallRead(storage, repoPath, workspace, job.call.id, now)
        : job;
      if (current === null || (query.state !== undefined && current.call.state.type !== query.state)) continue;
      calls.push(functionCallSummary(current));
    }
    return sendSuccess(FunctionCallPageType, { calls, next: page.next === undefined ? none : some(page.next) });
  } catch (err) {
    return sendError(FunctionCallPageType, errorToVariant(err));
  }
}

/**
 * A kept call, whole: what it ran, its arguments, the versions of the inputs
 * it read, its value by hash, its limits, its log tails and when it is
 * forgotten.
 *
 * @param storage - Storage backend
 * @param repoPath - The repository's identifier
 * @param workspace - The workspace the call was made through
 * @param id - The call's id
 * @param admit - Whether the caller may read the call (default: any caller may)
 * @returns The response: the call; or the error, as
 *   {@link getFunctionCallStatus} answers it
 */
export async function getFunctionCall(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  id: string,
  admit?: CallAdmit,
): Promise<Response> {
  try {
    const job = await readCall(storage, repoPath, workspace, id, admit);
    return sendSuccess(FunctionCallType, job.call);
  } catch (err) {
    return sendError(FunctionCallType, errorToVariant(err));
  }
}

/** The options a filing takes, of a handler's. */
function filingOf(options: FunctionCallFilingOptions): FunctionCallStartOptions {
  return {
    caller: options.caller,
    grant: options.grant,
    ...(options.ceilings !== undefined && { ceilings: options.ceilings }),
    ...(options.lifetimes !== undefined && { lifetimes: options.lifetimes }),
    ...(options.verbose !== undefined && { verbose: options.verbose }),
  };
}

/**
 * Runs a filed call where the dispatch runs calls, and waits up to `waitMs` for
 * it to end: the dispatch's word, or the store's. A call filed ended is
 * answered as it ended; one the dispatch cannot hand on is recorded `lost`.
 */
async function runAndWait(
  storage: StorageBackend,
  dispatch: FunctionCallDispatch,
  repo: string,
  repoPath: string,
  job: FunctionCallJob,
  waitMs: number,
): Promise<FunctionCallStatus> {
  if (job.call.state.type !== 'running') return functionCallStatus(storage, repoPath, job);
  const until = Date.now() + Math.max(0, waitMs);
  let heard: FunctionCallStatus | null;
  try {
    heard = await dispatch.execute(repo, job.workspace, job.call.id, { waitMs: Math.max(0, waitMs) });
  } catch (err) {
    const lost = await functionCallLost(storage, repoPath, job, `the call could not be dispatched: ${err instanceof Error ? err.message : String(err)}`);
    return functionCallStatus(storage, repoPath, lost);
  }
  if (heard !== null) return heard;
  return waitFor(storage, dispatch, repo, repoPath, job, until);
}

/**
 * Waits until `until` for a call to end: the dispatch's word when it hears of
 * the end, the store's otherwise, which it looks at every {@link LOOK_MS}.
 *
 * @returns The call's status: `running` when the time passed first
 * @throws {Error} When the store keeps the call no longer
 */
async function waitFor(
  storage: StorageBackend,
  dispatch: FunctionCallDispatch,
  repo: string,
  repoPath: string,
  job: FunctionCallJob,
  until: number,
): Promise<FunctionCallStatus> {
  let current = job;
  for (;;) {
    if (current.call.state.type !== 'running') return functionCallStatus(storage, repoPath, current);
    const left = until - Date.now();
    if (left <= 0) return variant('running', null);
    const heard = await dispatch.wait(repo, current.workspace, current.call.id, { waitMs: Math.min(left, LOOK_MS) });
    if (heard !== null) return heard;
    const read = await functionCallRead(storage, repoPath, current.workspace, current.call.id);
    if (read === null) throw noCall(current.workspace, current.call.id);
    current = read;
  }
}

/** Reads a kept call for a caller the host admits to it. */
async function readCall(storage: StorageBackend, repoPath: string, workspace: string, id: string, admit?: CallAdmit): Promise<FunctionCallJob> {
  const job = await functionCallRead(storage, repoPath, workspace, id);
  if (job === null) throw noCall(workspace, id);
  if (admit !== undefined && !(await admit(job.call))) throw new PermissionDeniedError('call');
  return job;
}

/** What answers a call the workspace does not keep, as an `internal` error. */
function noCall(workspace: string, id: string): Error {
  return new Error(`workspace '${workspace}' keeps no call '${id}': none was made, or its lifetime has ended`);
}
