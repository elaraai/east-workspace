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
 * All call results are inline, bounded values (ExecuteResult) — nothing is
 * persisted server-side by a call. A split call — a caller's program over a
 * dataset's pieces — runs as a job, launched under one-shot's grant and
 * polled for its result.
 */

import type {
  FunctionSignature,
  FunctionCallRequest,
  ExecuteResult,
  OneShotRequest,
  SplitCallPlan,
  SplitCallProgress,
  SplitCallRequest,
  SplitCallStatus,
} from './types.js';
import {
  FunctionSignatureType,
  FunctionCallRequestType,
  ExecuteResultType,
  OneShotRequestType,
  SplitCallRequestType,
  SplitCallStatusType,
} from './types.js';
import { ArrayType } from '@elaraai/east';
import { PackageJobResponseType } from '@elaraai/e3-types';
import { get, post, verboseQuery, type RequestOptions } from './http.js';
import { JOB_POLL_MAX_MS, JOB_POLL_MIN_MS } from './packages.js';

const enc = encodeURIComponent;

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
 *   instead of the function's own, and the limits
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

/** List the deployed package's functions. */
export async function workspaceFunctionList(
  url: string,
  repo: string,
  ws: string,
  options: RequestOptions
): Promise<FunctionSignature[]> {
  return get(url, wsBase(repo, ws), ArrayType(FunctionSignatureType), options);
}

/** Describe a function of the deployed package. */
export async function workspaceFunctionDescribe(
  url: string,
  repo: string,
  ws: string,
  fn: string,
  options: RequestOptions
): Promise<FunctionSignature> {
  return get(url, wsBase(repo, ws, fn), FunctionSignatureType, options);
}

/**
 * Call a function of the deployed package synchronously.
 *
 * @remarks
 * A runner the request names is held to the caller's grant, as
 * {@link functionCall} says.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace whose deployed package holds the function
 * @param fn - Function name
 * @param req - The arguments, a runner to run on instead of the function's
 *   own, and the limits
 * @param options - Request options including auth token
 * @returns The call's terminal result
 * @throws {ApiError} `permission_denied` (`path` `runner`) when the caller may
 *   not run the function on the runner the request names
 * @throws {AuthError} On 401 Unauthorized
 */
export async function workspaceFunctionCall(
  url: string,
  repo: string,
  ws: string,
  fn: string,
  req: FunctionCallRequest,
  options: RequestOptions
): Promise<ExecuteResult> {
  return post(url, verboseQuery(wsBase(repo, ws, fn), options), req, FunctionCallRequestType, ExecuteResultType, options);
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
 * A split call's status: how far its job has got, its result, or why the
 * server could not run it.
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
 * What a split call's pieces would be: launched as an explain, a job the
 * server plans them in, as the call's run would, running no unit, and polled
 * until it has.
 *
 * @param url - Base URL of the e3 API server
 * @param repo - Repository name
 * @param ws - The workspace whose datasets the call reads
 * @param req - The call
 * @param options - Request options including auth token
 * @param callOptions - The signal that stops polling
 * @returns The piece count, the argument they are cut over, and what it weighs
 * @throws {ApiError} `permission_denied` as for {@link splitCallLaunch}
 * @throws {AuthError} On 401 Unauthorized
 * @throws {Error} When the call is found wrong, naming what is wrong, or the
 *   server could not plan it
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
  throw new Error(`Split call explain failed: ${status.type === 'failed' ? status.value.message : status.type}`);
}

/** Options for {@link splitCall}. */
export interface SplitCallOptions {
  /** Called with the job's progress each time a poll finds it running. */
  onProgress?: (progress: SplitCallProgress) => void;
  /** Stops polling. The job runs on; its next launch is served the units
   *  that finished from the server's execution cache. */
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
 * @param callOptions - Its progress, and the signal that stops polling
 * @returns The call's result, and the assembled output's hash
 * @throws {ApiError} As {@link splitCallLaunch} does
 * @throws {AuthError} On 401 Unauthorized
 * @throws {Error} When the server could not run the call
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
  throw new Error(`Split call failed: ${status.type === 'failed' ? status.value.message : status.type}`);
}

/**
 * Polls a split call's job until it is no longer `processing`, 100 ms apart
 * at first, backing off to a second, telling `onProgress` how far it has got.
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
  for (let wait = JOB_POLL_MIN_MS; ; wait = Math.min(wait * 2, JOB_POLL_MAX_MS)) {
    callOptions.signal?.throwIfAborted();
    const status = await splitCallStatus(url, repo, ws, id, options);
    if (status.type !== 'processing') return status;
    if (status.value.type === 'some') callOptions.onProgress?.(status.value.value);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}
