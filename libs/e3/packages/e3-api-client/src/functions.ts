/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Named function and one-shot execution client methods.
 *
 * Named functions are package-scoped (`functionList`, `functionCall`, …) or
 * workspace-scoped (`workspaceFunction*` — the package is whatever is
 * deployed in the workspace). One-shot runs caller-supplied IR and is
 * workspace-scoped; the server says who may run what: a caller who may read
 * the workspace runs a platform-free one, and only an elevated grant any other.
 *
 * A call through a package is answered within its request, and nothing of it
 * is kept. A call through a workspace is kept by the server for its lifetime,
 * and outlives the request that starts it: {@link workspaceFunctionCall}
 * starts it and polls it to its end, and the server's workspace keeps it —
 * who made it, its arguments, the versions of the inputs it read, its value
 * and its logs — which {@link workspaceCallList} and {@link workspaceCallGet}
 * read. A split call — a caller's program over a dataset's pieces — runs as a
 * job, launched under one-shot's grant and polled for its result.
 */

import type {
  FunctionSignature,
  FunctionCall,
  FunctionCallAnswer,
  FunctionCallPage,
  FunctionCallRequest,
  FunctionCallState,
  FunctionCallStatus,
  ExecuteResult,
  OneShotRequest,
  SplitCallPlan,
  SplitCallProgress,
  SplitCallRequest,
  SplitCallStatus,
} from './types.js';
import {
  FunctionSignatureType,
  FunctionCallAnswerType,
  FunctionCallPageType,
  FunctionCallRequestType,
  FunctionCallStatusType,
  FunctionCallType,
  ExecuteResultType,
  OneShotRequestType,
  SplitCallRequestType,
  SplitCallStatusType,
} from './types.js';
import { ArrayType, NullType } from '@elaraai/east';
import { PackageJobResponseType } from '@elaraai/e3-types';
import { ApiError, get, post, sleep, verboseQuery, type RequestOptions } from './http.js';
import { JOB_POLL_MAX_MS, JOB_POLL_MIN_MS } from './packages.js';
import { uuidv7 } from './uuid.js';

const enc = encodeURIComponent;

function callsBase(repo: string, ws: string, id?: string): string {
  const base = `/repos/${enc(repo)}/workspaces/${enc(ws)}/calls`;
  return id !== undefined ? `${base}/${enc(id)}` : base;
}

/** A path with a query of the parameters given, in order. */
function withQuery(path: string, params: ReadonlyArray<readonly [string, string | undefined]>): string {
  const query = new URLSearchParams();
  for (const [name, value] of params) {
    if (value !== undefined) query.set(name, value);
  }
  const text = query.toString();
  return text === '' ? path : `${path}?${text}`;
}

/** A wait as a query gives it: whole milliseconds, zero or more. */
function waitParam(ms: number | undefined): string | undefined {
  return ms === undefined ? undefined : String(Math.max(0, Math.trunc(ms)));
}

/**
 * How long each poll of a call {@link workspaceFunctionCall} makes asks the
 * server to wait for it to end, in milliseconds. A server holds a poll at
 * most as long as it allows — the local server 20 s, a host whose held
 * requests cost it less — and answers as soon as the call ends.
 */
export const CALL_POLL_WAIT_MS = 20_000;

/** The least time between two polls of a call, which doubles to
 *  {@link CALL_POLL_MAX_MS}: a poll a server answered at once waits it out. */
const CALL_POLL_MIN_MS = 250;
/** The most time between two polls of a call. */
const CALL_POLL_MAX_MS = 2_000;

function pkgBase(repo: string, pkg: string, version: string, fn?: string): string {
  const base = `/repos/${enc(repo)}/packages/${enc(pkg)}/${enc(version)}/functions`;
  return fn !== undefined ? `${base}/${enc(fn)}` : base;
}

function wsBase(repo: string, ws: string, fn?: string): string {
  const base = `/repos/${enc(repo)}/workspaces/${enc(ws)}/functions`;
  return fn !== undefined ? `${base}/${enc(fn)}` : base;
}

function oneShotBase(repo: string, ws: string): string {
  return `/repos/${enc(repo)}/workspaces/${enc(ws)}/one-shot`;
}

// =============================================================================
// Package-scoped named functions
// =============================================================================

/** List a package's functions with their signatures. */
export async function functionList(
  url: string,
  repo: string,
  pkg: string,
  version: string,
  options: RequestOptions
): Promise<FunctionSignature[]> {
  return get(url, pkgBase(repo, pkg, version), ArrayType(FunctionSignatureType), options);
}

/** Get a single function's signature (for encoding arguments). */
export async function functionDescribe(
  url: string,
  repo: string,
  pkg: string,
  version: string,
  fn: string,
  options: RequestOptions
): Promise<FunctionSignature> {
  return get(url, pkgBase(repo, pkg, version, fn), FunctionSignatureType, options);
}

/**
 * Call a function synchronously, returning its terminal ExecuteResult.
 *
 * @remarks
 * With `req.runner` `none` the function runs on the runner its author chose,
 * for any caller. A runner the request names is held to the caller's grant: a
 * runner on the `custom` runtime is refused whoever names it, as an `invalid`
 * result, and one that loads a platform package the function's own runner
 * does not needs the elevated grant the server's auth gives.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param pkg - Package name
 * @param version - Package version
 * @param fn - Function name
 * @param req - The arguments, one beast2 value each, a runner to run on
 *   instead of the function's own, and the limits. A package has no workspace
 *   to read a dataset argument from: one is `invalid` here, and passed through
 *   {@link workspaceFunctionCall}
 * @param options - Request options including auth token
 * @returns The call's terminal result
 * @throws {ApiError} `permission_denied` (`path` `runner`) when the caller may
 *   not run the function on the runner the request names
 * @throws {AuthError} On 401 Unauthorized
 */
export async function functionCall(
  url: string,
  repo: string,
  pkg: string,
  version: string,
  fn: string,
  req: FunctionCallRequest,
  options: RequestOptions
): Promise<ExecuteResult> {
  return post(url, verboseQuery(pkgBase(repo, pkg, version, fn), options), req, FunctionCallRequestType, ExecuteResultType, options);
}




// =============================================================================
// Workspace-scoped named functions (package resolved from the deployment)
// =============================================================================

/**
 * List the deployed package's functions.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace whose deployed package holds the functions
 * @param options - Request options including auth token
 * @returns Each function's name and signature
 * @throws {ApiError} `workspace_not_deployed` for a workspace nothing is
 *   deployed to, and `workspace_not_found`
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceFunctionList(
  url: string,
  repo: string,
  ws: string,
  options: RequestOptions
): Promise<FunctionSignature[]> {
  return get(url, wsBase(repo, ws), ArrayType(FunctionSignatureType), options);
}

/**
 * Describe a function of the deployed package.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace whose deployed package holds the function
 * @param fn - Function name
 * @param options - Request options including auth token
 * @returns The function's signature
 * @throws {ApiError} `workspace_not_deployed` for a workspace nothing is
 *   deployed to, and `workspace_not_found`
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceFunctionDescribe(
  url: string,
  repo: string,
  ws: string,
  fn: string,
  options: RequestOptions
): Promise<FunctionSignature> {
  return get(url, wsBase(repo, ws, fn), FunctionSignatureType, options);
}

/** Options for {@link workspaceFunctionCall}. */
export interface WorkspaceFunctionCallOptions {
  /**
   * Stops the call: the client stops waiting for it at once, and asks the
   * server to stop it, which ends it `cancelled`. The client names the call
   * itself, so aborted while the call's start waits, the call is asked to stop
   * at once, by that id, and again once its start answers.
   */
  signal?: AbortSignal;
  /** Told the call's id once its start has answered and the call runs on
   *  past it: what the call is polled, cancelled and read by elsewhere */
  onStarted?: (id: string) => void;
  /**
   * How long the call's start waits for it to end before it answers with the
   * call's id, in milliseconds: at most the server's window, which it waits
   * when unset. A call that ends within it costs one request; a shorter wait
   * tells `onStarted` of a longer one sooner, at the cost of polling it.
   */
  startWaitMs?: number;
}

/**
 * Call a function of the deployed package, and wait for its result: the call
 * is started, kept by the server for its lifetime, and polled to its end.
 *
 * @remarks
 * A runner the request names is held to the caller's grant, as
 * {@link functionCall} says. An argument is a value, or a dataset of the
 * workspace (`variant('dataset', path)`), pinned by its hash at launch as a
 * one-shot's is: the result's `inputs` names each input the function reads and
 * each dataset argument, with the hash it was pinned at, in parameter order,
 * and an unassigned one is `invalid`.
 *
 * A call is held to its own timeout, never to a request's, so it may run for
 * as long as its limits allow: its start waits up to the server's window
 * ({@link workspaceFunctionStart}), and a call still running is polled — each
 * poll held by the server until the call ends or a while passes — 250 ms
 * apart at first, backing off to 2 s. The client names the call, an id of its
 * own ({@link FunctionCallStartOptions.id}), so an abort reaches the call
 * however soon it comes. A server that keeps no calls, one that predates
 * them, has no route to start one, and the call is made through
 * {@link workspaceFunctionCallSync} instead.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace whose deployed package holds the function, and
 *   whose datasets its arguments may name
 * @param fn - Function name
 * @param req - The arguments (values or dataset paths), a runner to run on
 *   instead of the function's own, and the limits
 * @param options - Request options including auth token
 * @param call - The signal that stops the call, and who is told its id once
 *   it runs on past its start
 * @returns The call's terminal result
 * @throws {ApiError} `permission_denied` (`path` `runner`) when the caller may
 *   not run the function on the runner the request names,
 *   `workspace_not_found` / `workspace_not_deployed`, and `internal` for a
 *   call someone cancelled, or the server lost, which has no result
 * @throws {AuthError} On 401 Unauthorized
 * @throws The abort's reason, once `call.signal` aborts
 */
export async function workspaceFunctionCall(
  url: string,
  repo: string,
  ws: string,
  fn: string,
  req: FunctionCallRequest,
  options: RequestOptions,
  call: WorkspaceFunctionCallOptions = {},
): Promise<ExecuteResult> {
  const { signal } = call;
  signal?.throwIfAborted();
  // The call is named before it is sent, so it can be stopped before its start answers
  const id = uuidv7();
  const starting = workspaceFunctionStart(url, repo, ws, fn, req, options, {
    id,
    ...(call.startWaitMs !== undefined && { waitMs: call.startWaitMs }),
  });
  let answer: FunctionCallAnswer;
  try {
    answer = await untilAborted(starting, signal);
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'not_found' || err.code === 'method_not_allowed')) {
      // A server that keeps no calls answers the sync route alone
      return untilAborted(workspaceFunctionCallSync(url, repo, ws, fn, req, options), signal);
    }
    if (signal?.aborted === true) {
      // Asked to stop at once by its name; and again once the start answers,
      // for a call filed after that ask reached the server, or filed under a
      // name of the server's
      void workspaceFunctionCallCancel(url, repo, ws, id, options).catch(() => undefined);
      void starting.then((started) => cancelQuietly(url, repo, ws, started, options), () => undefined);
    }
    throw err;
  }

  let status = answer.status;
  if (status.type === 'running') call.onStarted?.(answer.id);
  for (let gap = CALL_POLL_MIN_MS; status.type === 'running'; gap = Math.min(gap * 2, CALL_POLL_MAX_MS)) {
    const asked = Date.now();
    try {
      // An abort stops the wait at once, whatever the fetch does with its
      // signal: a host's own fetch, as e3 in a page answers through, may
      // answer the held poll in its own time
      status = await untilAborted(workspaceFunctionCallStatus(url, repo, ws, answer.id, options, {
        waitMs: CALL_POLL_WAIT_MS,
        ...(signal !== undefined && { signal }),
      }), signal);
      // A poll the server answered before the gap passed waits the rest of it
      if (status.type === 'running') await pause(gap - (Date.now() - asked), signal);
    } catch (err) {
      if (signal?.aborted === true) void cancelQuietly(url, repo, ws, answer, options);
      throw err;
    }
  }
  return callResult(answer.id, status);
}

/** Options for {@link workspaceFunctionStart}. */
export interface FunctionCallStartOptions {
  /** How long the start waits for the call to end before it answers
   *  `running`, in milliseconds: at most the server's window, which it waits
   *  when unset; 0 answers at once */
  waitMs?: number;
  /**
   * The id to file the call under: a UUIDv7 of now, which names the call
   * before the start answers, so it can be cancelled at once. A server sets
   * aside one far from its clock for an id of its own, which the answer
   * names, and refuses one it keeps a call under already. Unset, the server
   * names the call.
   */
  id?: string;
}

/**
 * Start a call of a function of the deployed package: the server files it,
 * runs it where its calls run, and waits a while for it to end.
 *
 * @remarks
 * The call is kept by the server from now until the lifetime its end gives
 * it: an hour for a success or a cancel, a week for any other end, unless the
 * server says otherwise. Its timeout is the server's ceiling unless the
 * request asks for less, since it answers no request. The answer is the
 * call's id and how it stood when the wait ended: `completed` with its
 * result for a call that ended within it — a call found wrong among them,
 * `invalid` — or `running`, which {@link workspaceFunctionCallStatus} polls.
 * A start is never sent twice, so a call is never filed twice.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace whose deployed package holds the function
 * @param fn - Function name
 * @param req - The arguments, a runner to run on instead of the function's
 *   own, and the limits
 * @param options - Request options including auth token
 * @param start - How long the start waits for the call to end, and the id to
 *   file it under
 * @returns The call's id and status
 * @throws {ApiError} As {@link workspaceFunctionCall} does; `not_found` from a
 *   server that keeps no calls
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceFunctionStart(
  url: string,
  repo: string,
  ws: string,
  fn: string,
  req: FunctionCallRequest,
  options: RequestOptions,
  start: FunctionCallStartOptions = {},
): Promise<FunctionCallAnswer> {
  const path = withQuery(`${wsBase(repo, ws, fn)}/calls`, [
    ['wait', waitParam(start.waitMs)],
    ['id', start.id],
    ['verbose', options.verbose === true ? '1' : undefined],
  ]);
  return post(url, path, req, FunctionCallRequestType, FunctionCallAnswerType, options);
}

/** Options for {@link workspaceFunctionCallStatus}. */
export interface FunctionCallPollOptions {
  /** How long the server waits for the call to end before it answers
   *  `running`, in milliseconds: at most as long as it allows; 0, the
   *  default, answers at once */
  waitMs?: number;
  /** Aborts the poll */
  signal?: AbortSignal;
}

/**
 * A call's status: `running`; its result once it ended, its value inline up
 * to its `maxResultBytes`; `cancelled`, naming who asked; or `lost`, and why.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace the call was made through
 * @param id - The call's id
 * @param options - Request options including auth token
 * @param poll - How long the server waits for the call to end, and the signal
 *   that aborts the poll
 * @returns The status
 * @throws {ApiError} `internal` when the workspace keeps no such call — none
 *   was made, or its lifetime has ended — and `permission_denied` (`path`
 *   `call`) for a caller the server does not let read it
 * @throws {AuthError} On 401 Unauthorized
 * @throws The abort's reason, once `poll.signal` aborts
 */
export async function workspaceFunctionCallStatus(
  url: string,
  repo: string,
  ws: string,
  id: string,
  options: RequestOptions,
  poll: FunctionCallPollOptions = {},
): Promise<FunctionCallStatus> {
  return get(url, withQuery(`${callsBase(repo, ws, id)}/status`, [['wait', waitParam(poll.waitMs)]]), FunctionCallStatusType, options, poll.signal);
}

/**
 * Ask a running call to stop: the server stops its runner, and the call ends
 * `cancelled`, naming who asked. A call that has ended is left as it is.
 *
 * @remarks
 * The request is sent `keepalive`, so it reaches the server though the page
 * that sends it is closing: a page that stops its calls as it goes away is
 * heard.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace the call was made through
 * @param id - The call's id
 * @param options - Request options including auth token
 * @returns The call's status once it stopped, or `running` while it stops
 * @throws {ApiError} As {@link workspaceFunctionCallStatus} does, and
 *   `permission_denied` (`path` `call`) for a caller the server does not let
 *   cancel it
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceFunctionCallCancel(
  url: string,
  repo: string,
  ws: string,
  id: string,
  options: RequestOptions,
): Promise<FunctionCallStatus> {
  return post(url, `${callsBase(repo, ws, id)}/cancel`, null, NullType, FunctionCallStatusType, options, undefined, { keepalive: true });
}

/** Which of a workspace's calls {@link workspaceCallList} answers. */
export interface FunctionCallListQuery {
  /** Only the calls of the function of this name */
  function?: string;
  /** Only the calls in the state of this tag */
  state?: FunctionCallState['type'];
  /** Only the calls before it: the last page's `next` */
  before?: string;
  /** At most this many: the server's page unless set, and never more than
   *  `FUNCTION_CALLS_PAGE_MAX` */
  limit?: number;
}

/**
 * A page of the calls a workspace keeps, the latest first: each by who made
 * it, when, and how it stands or ended.
 *
 * @remarks
 * A call is kept for its lifetime, an hour for a success or a cancel and a
 * week for any other end unless the server says otherwise, so the list holds
 * what is recent however many calls are made. A page's `next` is the next
 * page's `before`, `none` on the last. A page may hold fewer calls than its
 * limit, or none, and name a next all the same: a server that reads a bounded
 * number of calls a request, as the cloud's does, stops where its reads
 * stopped, which a list of a function's calls, or a state's, may reach first.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace
 * @param options - Request options including auth token
 * @param query - Only a function's calls, or only those in a state, and the
 *   page's cursor and size
 * @returns The page
 * @throws {ApiError} `workspace_not_found`, and `bad_request` for a query
 *   given wrong
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceCallList(
  url: string,
  repo: string,
  ws: string,
  options: RequestOptions,
  query: FunctionCallListQuery = {},
): Promise<FunctionCallPage> {
  const path = withQuery(callsBase(repo, ws), [
    ['function', query.function],
    ['state', query.state],
    ['before', query.before],
    ['limit', query.limit === undefined ? undefined : String(query.limit)],
  ]);
  return get(url, path, FunctionCallPageType, options);
}

/**
 * A kept call, whole: the package it ran from, its arguments — values by the
 * objects they were stored as, datasets by the hashes they were pinned at —
 * the versions of the inputs it read, its limits, its value by hash once it
 * succeeded, its log tails, and when it is forgotten.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace the call was made through
 * @param id - The call's id
 * @param options - Request options including auth token
 * @returns The call
 * @throws {ApiError} As {@link workspaceFunctionCallStatus} does
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceCallGet(
  url: string,
  repo: string,
  ws: string,
  id: string,
  options: RequestOptions,
): Promise<FunctionCall> {
  return get(url, callsBase(repo, ws, id), FunctionCallType, options);
}

/**
 * Call a function of the deployed package within one request: the sync route,
 * which a server that keeps no calls answers alone.
 *
 * @remarks
 * The call's timeout defaults as a sync call's does, and is clamped under the
 * server's sync deadline, so a call that runs past it is answered `timed_out`.
 * A server that keeps calls keeps this one too. {@link workspaceFunctionCall}
 * is held to no request's deadline, and is what a caller makes unless it
 * wants a single request.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace whose deployed package holds the function
 * @param fn - Function name
 * @param req - The arguments, a runner to run on instead of the function's
 *   own, and the limits
 * @param options - Request options including auth token
 * @returns The call's terminal result
 * @throws {ApiError} As {@link workspaceFunctionCall} does
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceFunctionCallSync(
  url: string,
  repo: string,
  ws: string,
  fn: string,
  req: FunctionCallRequest,
  options: RequestOptions,
): Promise<ExecuteResult> {
  return post(url, verboseQuery(wsBase(repo, ws, fn), options), req, FunctionCallRequestType, ExecuteResultType, options);
}

/** A call's result, once it ended: what a cancelled or lost call, which has
 *  none, is refused as, in the sync route's words. */
function callResult(id: string, status: FunctionCallStatus): ExecuteResult {
  switch (status.type) {
    case 'completed':
      return status.value;
    case 'cancelled': {
      const by = status.value.by.type === 'some' ? ` by ${status.value.by.value}` : '';
      throw new ApiError('internal', { message: `call ${id} was cancelled${by}, and has no result` });
    }
    case 'lost':
      throw new ApiError('internal', { message: `call ${id} was lost: ${status.value.message}` });
    case 'running':
      throw new ApiError('internal', { message: `call ${id} is still running` });
  }
}

/** Asks a call that runs on to stop, ignoring the answer: what an abort does. */
async function cancelQuietly(url: string, repo: string, ws: string, answer: FunctionCallAnswer, options: RequestOptions): Promise<void> {
  if (answer.status.type !== 'running') return;
  await workspaceFunctionCallCancel(url, repo, ws, answer.id, options).catch(() => undefined);
}

/** What a promise settles to, or the abort's reason once `signal` aborts
 *  first; the promise runs on regardless. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then((value) => {
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    }, (err: unknown) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}

/** Waits `ms`, or rejects with the abort's reason once `signal` aborts. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return untilAborted(new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms))), signal);
}




// =============================================================================
// One-shot (anonymous caller-supplied IR; the server's grant)
// =============================================================================

/**
 * Run an anonymous IR synchronously against a workspace.
 *
 * @remarks
 * A caller who may read the workspace may run a platform-free request: its
 * runner a stock runtime given no platform package (`platforms: []`), and its
 * body calling no platform function. Any other needs the elevated grant the
 * server's auth gives — on the local server, the `admin` or `owner` role — and
 * is refused otherwise. The result's `inputs` names each dataset argument's
 * path and the hash it was pinned at, in argument order, so an answer can be
 * reproduced and a stale one noticed.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace whose datasets the call reads
 * @param req - The body IR, its arguments (values or dataset paths), its
 *   runner and its limits
 * @param options - Request options including auth token
 * @returns The call's terminal result
 * @throws {ApiError} `permission_denied` (`path` `one-shot`) when the caller may
 *   not run the request, and `workspace_not_found` / `workspace_not_deployed`
 * @throws {AuthError} On 401 Unauthorized
 */
export async function oneShotExecute(
  url: string,
  repo: string,
  ws: string,
  req: OneShotRequest,
  options: RequestOptions
): Promise<ExecuteResult> {
  return post(url, verboseQuery(oneShotBase(repo, ws), options), req, OneShotRequestType, ExecuteResultType, options);
}

// =============================================================================
// Split calls (a caller's program over a dataset's pieces, as a job)
// =============================================================================

/**
 * Launch a split call: a program run over a dataset's pieces as a job, which
 * {@link splitCallStatus} polls.
 *
 * @remarks
 * Launched under one-shot's grant: a caller who may read the workspace
 * launches a platform-free call — a stock runtime given no platform package,
 * and none of its programs calling a platform function — and only an elevated
 * grant any other. A request found wrong is answered by the poll, as an
 * `invalid` result.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace whose datasets the call reads
 * @param req - The program, its arguments and their partitions, the output
 *   kind, the final function, the runner and the limits
 * @param options - Request options including auth token
 * @returns The job's id
 * @throws {ApiError} `permission_denied` (`path` `one-shot`) when the caller may
 *   not launch the call, and `workspace_not_found` / `workspace_not_deployed`
 * @throws {AuthError} On 401 Unauthorized
 */
export async function splitCallLaunch(
  url: string,
  repo: string,
  ws: string,
  req: SplitCallRequest,
  options: RequestOptions
): Promise<{ id: string }> {
  return post(url, `${oneShotBase(repo, ws)}/split`, req, SplitCallRequestType, PackageJobResponseType, options);
}

/**
 * A split call's status: how far its job has got, its result, why the server
 * could not run it, or that it was cancelled.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace the call was launched in
 * @param id - The job's id
 * @param options - Request options including auth token
 * @returns The status; once `completed`, the call's result and the assembled
 *   output's hash; an explain's, once `planned`, its pieces
 * @throws {ApiError} When the workspace launched no such job, and
 *   `permission_denied` for a caller with no one-shot grant, or a reader
 *   polling a call only an elevated grant could launch
 * @throws {AuthError} On 401 Unauthorized
 */
export async function splitCallStatus(
  url: string,
  repo: string,
  ws: string,
  id: string,
  options: RequestOptions
): Promise<SplitCallStatus> {
  return get(url, `${oneShotBase(repo, ws)}/split/${enc(id)}`, SplitCallStatusType, options);
}

/**
 * Cancel a split call: a job still running ends `cancelled`, and the server
 * stops its units; one that has ended is left as it is. The units that
 * finished stay cached, so a relaunch is served them.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace the call was launched in
 * @param id - The job's id
 * @param options - Request options including auth token
 * @returns The job's status after the cancel, as a poll answers it:
 *   `cancelled`, or the status it had already ended with
 * @throws {ApiError} As {@link splitCallStatus} does: whoever may poll a job
 *   may cancel it
 * @throws {AuthError} On 401 Unauthorized
 */
export async function splitCallCancel(
  url: string,
  repo: string,
  ws: string,
  id: string,
  options: RequestOptions
): Promise<SplitCallStatus> {
  return post(url, `${oneShotBase(repo, ws)}/split/${enc(id)}/cancel`, null, NullType, SplitCallStatusType, options);
}

/**
 * What a split call's pieces would be: launched as an explain, a job the
 * server plans them in, as the call's run would, running no unit, and polled
 * until it has.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace whose datasets the call reads
 * @param req - The call
 * @param options - Request options including auth token
 * @param callOptions - The signal that gives the explain up, and cancels its
 *   job
 * @returns The piece count, the argument they are cut over, and what it weighs
 * @throws {ApiError} `permission_denied` as for {@link splitCallLaunch}
 * @throws {AuthError} On 401 Unauthorized
 * @throws {Error} When the call is found wrong, naming what is wrong, or the
 *   server could not plan it
 * @throws The signal's reason once it aborts
 */
export async function splitCallExplain(
  url: string,
  repo: string,
  ws: string,
  req: SplitCallRequest,
  options: RequestOptions,
  callOptions: SplitCallOptions = {},
): Promise<SplitCallPlan> {
  const { id } = await post(url, `${oneShotBase(repo, ws)}/split?explain=1`, req, SplitCallRequestType, PackageJobResponseType, options);
  const status = await splitCallEnd(url, repo, ws, id, options, callOptions);
  if (status.type === 'planned') return status.value;
  if (status.type === 'completed') {
    const outcome = status.value.result.outcome;
    const why = outcome.type === 'invalid' ? outcome.value.diagnostics.map((diagnostic) => diagnostic.message).join('; ') : outcome.type;
    throw new Error(`Split call explain refused: ${why}`);
  }
  if (status.type === 'cancelled') throw new Error('Split call explain cancelled');
  throw new Error(`Split call explain failed: ${status.type === 'failed' ? status.value.message : status.type}`);
}

/** Options for {@link splitCall}. */
export interface SplitCallOptions {
  /** Called with the job's progress each time a poll finds it running. */
  onProgress?: (progress: SplitCallProgress) => void;
  /** Gives the call up: polling stops, and the job is cancelled
   *  ({@link splitCallCancel}), so the server stops its units. Its next
   *  launch is served the units that finished from the server's execution
   *  cache. */
  signal?: AbortSignal;
}

/** A split call's answer: its result, and the assembled output's hash once
 *  the pieces ran — what the caller reads by the object route when the result
 *  is `too_large`, or passes on as the next call's `object` argument. */
export interface SplitCallAnswer {
  result: ExecuteResult;
  output: string | null;
}

/**
 * Run a split call: launch it and poll it to its end, 100 ms apart at first,
 * backing off to a second.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace whose datasets the call reads
 * @param req - The call
 * @param options - Request options including auth token
 * @param callOptions - Its progress, and the signal that gives it up and
 *   cancels its job
 * @returns The call's result, and the assembled output's hash
 * @throws {ApiError} As {@link splitCallLaunch} does
 * @throws {AuthError} On 401 Unauthorized
 * @throws {Error} When the server could not run the call, or it was cancelled
 * @throws The signal's reason once it aborts
 */
export async function splitCall(
  url: string,
  repo: string,
  ws: string,
  req: SplitCallRequest,
  options: RequestOptions,
  callOptions: SplitCallOptions = {},
): Promise<SplitCallAnswer> {
  const { id } = await splitCallLaunch(url, repo, ws, req, options);
  const status = await splitCallEnd(url, repo, ws, id, options, callOptions);
  if (status.type === 'completed') {
    return { result: status.value.result, output: status.value.output.type === 'some' ? status.value.output.value : null };
  }
  if (status.type === 'cancelled') throw new Error('Split call cancelled');
  throw new Error(`Split call failed: ${status.type === 'failed' ? status.value.message : status.type}`);
}

/**
 * Polls a split call's job until it is no longer `processing`, 100 ms apart
 * at first, backing off to a second, telling `onProgress` how far it has got.
 * Once `signal` aborts, it cancels the job and rejects with the signal's
 * reason.
 *
 * @returns The status it ended with
 */
async function splitCallEnd(
  url: string,
  repo: string,
  ws: string,
  id: string,
  options: RequestOptions,
  callOptions: SplitCallOptions,
): Promise<SplitCallStatus> {
  const { signal } = callOptions;
  try {
    for (let wait = JOB_POLL_MIN_MS; ; wait = Math.min(wait * 2, JOB_POLL_MAX_MS)) {
      signal?.throwIfAborted();
      const status = await splitCallStatus(url, repo, ws, id, options);
      if (status.type !== 'processing') return status;
      if (status.value.type === 'some') callOptions.onProgress?.(status.value.value);
      await sleep(wait, signal);
    }
  } catch (err) {
    // Given up: the job is cancelled, so its units stop. A cancel that fails
    // leaves the job to its timeout, and the abort is still what is thrown.
    if (signal?.aborted === true) await splitCallCancel(url, repo, ws, id, options).catch(() => undefined);
    throw err;
  }
}
