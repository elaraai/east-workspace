/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * One-shot execution: a caller's IR run once over a workspace's datasets and
 * values, its result returned inline and nothing persisted, under the grant
 * the host's auth gives the caller.
 *
 * A one-shot's IR is the caller's, and so is its runner, which may load
 * platform functions: files, the network, processes. So what a caller may run
 * is a grant (`OneShotGrant`) only the host knows: `any` runs every request;
 * `platform_free` runs one that is platform-free — a stock runtime given no
 * platform package, and a body that calls no platform function — which can
 * only compute over its arguments, the workspace's datasets and values its
 * caller sent; `none` runs nothing. The whole call goes through
 * `StorageBackend` and `TaskRunner`, so every backend shares it: the route of
 * a server, and `e3 query` over a local repository.
 *
 * @packageDocumentation
 */

import { IMPORT_PLATFORM, decodeAsyncEastIR, decodeEastIR, literalValueOf, none, some, variant, walkIR, type IR, type ValueIR } from '@elaraai/east';
import type { ExecuteLimits, ExecuteResult, OneShotRequest, RunnerValue, TreePath } from '@elaraai/e3-types';
import { PermissionDeniedError } from '../errors.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { workspaceGetDatasetHash } from '../trees.js';
import { workspaceGetPackage } from '../workspaces.js';
import type { TaskRunner } from './interfaces.js';
import type { DetachedArg, DetachedResult } from './runDetached.js';

/**
 * What a caller may run through one-shot: the grant the host's auth gives it.
 *
 * - `any`: every request, as an elevated role runs one-shot;
 * - `platform_free`: a platform-free request ({@link oneShotPlatformUse});
 * - `none`: nothing.
 */
export type OneShotGrant = 'any' | 'platform_free' | 'none';

/** A call's timeout when the request names none. */
const DEFAULT_TIMEOUT_MS = 60_000;
/** The most a request's timeout may be, unless the caller raises it. */
const MAX_TIMEOUT_MS = 10 * 60_000;
/** A sync call's deadline, under a host's request timeout, unless the host
 *  names its own: a caller then gets a `timed_out` answer rather than a cut
 *  connection. */
const SYNC_DEADLINE_MS = 120_000;
/** The largest result returned inline, and a request's default: 1 MiB leaves
 *  room under a function host's response limit and still holds thousands of
 *  rows. A request may lower it; only a caller's ceiling raises it. */
const MAX_RESULT_BYTES = 1024 * 1024;
/** The most of each log stream's tail a request may ask for. */
const MAX_LOG_BYTES = 256 * 1024;
/** Each log stream's tail when the request names none. */
const DEFAULT_LOG_BYTES = 64 * 1024;

/** A call's limits once the request's are resolved: what `runDetached` takes. */
export interface ResolvedLimits {
  /** Wall-clock limit, in milliseconds. */
  timeoutMs: number;
  /** The largest result returned inline, in bytes. */
  maxResultBytes: number;
  /** The tail of each log stream kept, in bytes. */
  maxLogBytes: number;
}

/**
 * The most a request may ask for. Each defaults to a server's: a 10-minute
 * timeout, a 1 MiB result and 256 KiB of logs. A caller with no transport
 * between it and the call passes its own: `e3 query` over a local repository,
 * or a chat engine in the API host.
 */
export interface ExecuteCeilings {
  /** The longest timeout a request may ask for, in milliseconds. */
  timeoutMs?: number;
  /** The largest result, in bytes; also a request's default. */
  maxResultBytes?: number;
  /** The most of each log stream's tail, in bytes. */
  maxLogBytes?: number;
}

/** Options for {@link oneShotExecute}. */
export interface OneShotOptions {
  /** What the caller may run: the grant the host's auth gave it. */
  grant: OneShotGrant;
  /** The host's deadline for a sync call: a call's timeout is clamped under
   *  it (default 120 000 ms). */
  syncDeadlineMs?: number;
  /** The most a request may ask for (default: a server's). */
  ceilings?: ExecuteCeilings;
  /** Aborting it stops the call: a caller who hangs up. */
  signal?: AbortSignal;
  /** Pass `-v` to a stock runner's `exec`. */
  verbose?: boolean;
}

/**
 * Resolves a request's limits: each within its ceiling, and the timeout under
 * the host's sync deadline.
 *
 * @param limits - The request's limits, when it names any
 * @param options - The host's sync deadline and the ceilings it allows
 * @returns The limits the call runs under
 */
export function resolveExecuteLimits(
  limits: { type: 'some'; value: ExecuteLimits } | { type: 'none'; value: null },
  options: { syncDeadlineMs?: number; ceilings?: ExecuteCeilings } = {},
): ResolvedLimits {
  const requested = limits.type === 'some' ? limits.value : undefined;
  const ceilings = {
    timeoutMs: options.ceilings?.timeoutMs ?? MAX_TIMEOUT_MS,
    maxResultBytes: options.ceilings?.maxResultBytes ?? MAX_RESULT_BYTES,
    maxLogBytes: options.ceilings?.maxLogBytes ?? MAX_LOG_BYTES,
  };
  const asked = (value: { type: 'some'; value: bigint } | { type: 'none'; value: null } | undefined, fallback: number): number =>
    value !== undefined && value.type === 'some' ? Number(value.value) : fallback;

  let timeoutMs = asked(requested?.timeoutMs, DEFAULT_TIMEOUT_MS);
  timeoutMs = Math.min(Math.max(1, timeoutMs), ceilings.timeoutMs, options.syncDeadlineMs ?? SYNC_DEADLINE_MS);
  const maxResultBytes = Math.min(Math.max(1, asked(requested?.maxResultBytes, ceilings.maxResultBytes)), ceilings.maxResultBytes);
  const maxLogBytes = Math.min(Math.max(0, asked(requested?.maxLogBytes, DEFAULT_LOG_BYTES)), ceilings.maxLogBytes);
  return { timeoutMs, maxResultBytes, maxLogBytes };
}

/**
 * Resolves a job's limits: a job answers no request, so it has no sync
 * deadline, and its timeout defaults to the ceiling and is at most it. The
 * result and log limits resolve as a call's do.
 *
 * @param limits - The request's limits, when it names any
 * @param ceilings - The most a request may ask for (default: a server's)
 * @returns The limits the job runs under
 */
export function resolveJobLimits(
  limits: { type: 'some'; value: ExecuteLimits } | { type: 'none'; value: null },
  ceilings?: ExecuteCeilings,
): ResolvedLimits {
  const ceiling = ceilings?.timeoutMs ?? MAX_TIMEOUT_MS;
  const requested = limits.type === 'some' ? limits.value : undefined;
  return resolveExecuteLimits(some({
    timeoutMs: requested !== undefined && requested.timeoutMs.type === 'some' ? requested.timeoutMs : some(BigInt(ceiling)),
    maxResultBytes: requested?.maxResultBytes ?? none,
    maxLogBytes: requested?.maxLogBytes ?? none,
  }), { syncDeadlineMs: ceiling, ...(ceilings !== undefined && { ceilings }) });
}

/**
 * The wire result of a detached run: its outcome and log tails, and what it
 * read.
 *
 * @param result - The run's result
 * @param inputs - Each dataset argument's path and the hash it was pinned at,
 *   in argument order; none for a named function call
 * @returns The call's result
 */
export function detachedToExecuteResult(result: DetachedResult, inputs: ExecuteResult['inputs'] = []): ExecuteResult {
  const streams = {
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
    inputs,
  };
  switch (result.kind) {
    case 'success':
      return { outcome: variant('success', { value: result.value }), ...streams };
    case 'failed':
      return { outcome: variant('failed', { exitCode: BigInt(result.exitCode) }), ...streams };
    case 'too_large':
      return { outcome: variant('too_large', { bytes: BigInt(result.bytes), limit: BigInt(result.limit) }), ...streams };
    case 'timed_out':
      return { outcome: variant('timed_out', { ms: BigInt(result.ms) }), ...streams };
  }
}

/**
 * An `invalid` result, whose call never ran: a signature, an argument or a
 * body that is wrong.
 *
 * @param message - What is wrong
 * @returns The call's result
 */
export function invalidExecuteResult(message: string): ExecuteResult {
  return {
    outcome: variant('invalid', {
      diagnostics: [{ message, filename: none, line: none, column: none }],
    }),
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    inputs: [],
  };
}

/** The name a stock runtime's tag stands for. */
function runtimeName(runner: RunnerValue): string {
  return runner.type.replace('_', '-');
}

/**
 * A body's IR, decoded: a function's or an async function's.
 *
 * @throws {Error} When the bytes do not decode as a function.
 */
function decodeBody(bodyIr: Uint8Array): IR {
  try {
    return decodeEastIR(bodyIr).ir as IR;
  } catch (err) {
    try {
      return decodeAsyncEastIR(bodyIr).ir as IR;
    } catch {
      throw err;
    }
  }
}

/**
 * Why a runner is not platform-free, or `null` when it is: a stock runtime
 * (`east_c`, `east_node` or `east_py`) given no platform package.
 *
 * @param runner - The runner
 * @returns Why it is not: it is the custom runtime, or the first package it
 *   loads; `null` when it is platform-free
 * @internal
 */
export function runnerPlatformUse(runner: RunnerValue): string | null {
  if (runner.type === 'custom') return 'its runner is the custom runtime, which runs a command of its own';
  if (runner.value.platforms.length > 0) {
    return `its runner, ${runtimeName(runner)}, loads the platform package ${runner.value.platforms[0]}`;
  }
  return null;
}

/**
 * The first platform function a program calls, or `null` when it calls none.
 *
 * @remarks
 * A program calls one when its IR holds a `Platform` node at any depth, nested
 * functions included. An unresolved `East.importFunction` is a `Platform` node
 * ({@link IMPORT_PLATFORM}), so it counts too.
 *
 * @param ir - The program's IR bundle
 * @param what - What the program is, as a refusal names it: `body`, say
 * @returns The use, as a refusal names it; `null` when there is none
 * @throws {Error} When the IR does not decode as a function.
 * @internal
 */
export function programPlatformUse(ir: Uint8Array, what: string): string | null {
  let use: string | null = null;
  walkIR(decodeBody(ir), (node) => {
    if (use !== null || node.type !== 'Platform') return;
    if (node.value.name !== IMPORT_PLATFORM) {
      use = `its ${what} calls the platform function ${node.value.name}`;
      return;
    }
    const [pkg, name] = (node.value.arguments as IR[]).map((arg) => (arg.type === 'Value' ? String(literalValueOf(arg as ValueIR)) : '?'));
    use = `its ${what} holds an unresolved East.importFunction of ${pkg}.${name}`;
  });
  return use;
}

/**
 * Why a one-shot request is not platform-free, or `null` when it is.
 *
 * @remarks
 * A request is platform-free when its runner is a stock runtime (`east_c`,
 * `east_node` or `east_py`) given no platform package, and its body holds no
 * `Platform` node at any depth, nested functions included. An unresolved
 * `East.importFunction` is a `Platform` node ({@link IMPORT_PLATFORM}), so it
 * counts too. A runtime given a unit with no platform packages loads none, so
 * a platform-free call can only compute over its arguments.
 *
 * @param request - The request
 * @returns Why it is not platform-free: its runner, or the first platform
 *   function its body calls; `null` when it is platform-free
 * @throws {Error} When the body IR does not decode as a function.
 */
export function oneShotPlatformUse(request: OneShotRequest): string | null {
  return runnerPlatformUse(request.runner) ?? programPlatformUse(request.bodyIr, 'body');
}

/**
 * The arguments a runner is handed: a value as its bytes, and a dataset by the
 * hash it is pinned at, with each dataset's path and hash.
 *
 * @returns The arguments and what they read, or the `invalid` result an
 *   unassigned dataset answers
 */
async function pinArguments(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  args: OneShotRequest['args'],
): Promise<{ args: DetachedArg[]; inputs: ExecuteResult['inputs'] } | ExecuteResult> {
  const pinned: DetachedArg[] = [];
  const inputs: ExecuteResult['inputs'] = [];
  for (const [i, arg] of args.entries()) {
    if (arg.type === 'value') {
      pinned.push(arg.value);
      continue;
    }
    const path: TreePath = arg.value;
    // Objects are immutable, so a dataset pinned by its hash is a snapshot:
    // no lock is needed, and the runner stages it as a task input is.
    const { refType, hash } = await workspaceGetDatasetHash(storage, repo, workspace, path);
    if (refType !== 'value' || hash === null) {
      return invalidExecuteResult(`Dataset argument ${i} is not assigned (ref type: ${refType})`);
    }
    pinned.push({ dataset: hash });
    inputs.push({ path, hash });
  }
  return { args: pinned, inputs };
}

/**
 * Runs a one-shot request under the caller's grant.
 *
 * @remarks
 * In order:
 * 1. **Grant.** `none` is refused; `platform_free` runs only a platform-free
 *    request ({@link oneShotPlatformUse}), and a body that does not decode is
 *    `invalid`. Both checks come before any storage read or runner call. An
 *    `any` caller's body goes to the runner undecoded.
 * 2. **Workspace.** The workspace must exist and be deployed.
 * 3. **Pin.** Each dataset argument is pinned at its hash; an unassigned one
 *    is `invalid`, and nothing runs.
 * 4. **Run.** `runner.runDetached`, under the request's limits resolved within
 *    the ceilings and under the sync deadline ({@link resolveExecuteLimits}).
 * 5. **Map.** The result names each dataset argument's path and hash.
 *
 * @param storage - Storage backend
 * @param runner - The repository's task runner
 * @param repo - Repository identifier
 * @param workspace - The workspace whose datasets the call reads
 * @param request - The body, its arguments, its runner and its limits
 * @param options - The caller's grant, the host's deadline and ceilings, and
 *   the call's signal
 * @returns The call's result
 * @throws {PermissionDeniedError} For `none`, and for `platform_free` with a
 *   request that is not platform-free (`path` `one-shot`).
 * @throws {WorkspaceNotFoundError} When there is no such workspace
 * @throws {WorkspaceNotDeployedError} When nothing is deployed to it
 */
export async function oneShotExecute(
  storage: StorageBackend,
  runner: TaskRunner,
  repo: string,
  workspace: string,
  request: OneShotRequest,
  options: OneShotOptions,
): Promise<ExecuteResult> {
  if (options.grant === 'none') throw new PermissionDeniedError('one-shot');
  if (options.grant === 'platform_free') {
    let use: string | null;
    try {
      use = oneShotPlatformUse(request);
    } catch (err) {
      return invalidExecuteResult(`the body does not decode as a function: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (use !== null) throw new PermissionDeniedError('one-shot');
  }

  await workspaceGetPackage(storage, repo, workspace);
  const pinned = await pinArguments(storage, repo, workspace, request.args);
  if (!('args' in pinned)) return pinned;

  const result = await runner.runDetached(
    {
      bodyIr: request.bodyIr,
      args: pinned.args,
      runner: request.runner,
      limits: resolveExecuteLimits(request.limits, options),
    },
    {
      storage,
      ...(options.signal !== undefined && { signal: options.signal }),
      ...(options.verbose !== undefined && { verbose: options.verbose }),
    },
  );
  return detachedToExecuteResult(result, pinned.inputs);
}
