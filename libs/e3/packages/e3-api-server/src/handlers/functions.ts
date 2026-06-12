/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Handlers for named package functions and one-shot execution.
 *
 * Both reduce to the graph-free `runDetached` primitive: marshal inputs →
 * run a body IR on a runner → return the result inline. Nothing durable is
 * written — no output object, no execution record, no logs, no dataset ref.
 *
 * Named functions are author-published IR (same trust as a deployed task).
 * One-shot evaluates CALLER-supplied IR — remote code execution with the
 * server's authority — and must be gated by the route layer (see
 * routes/functions.ts).
 */

import { ArrayType, decodeBeast2For, variant, none } from '@elaraai/east';
import {
  packageRead,
  workspaceGetPackage,
  workspaceGetDatasetHash,
  TaskNotFoundError,
} from '@elaraai/e3-core';
import type { StorageBackend, TaskRunner, DetachedResult } from '@elaraai/e3-core';
import { FunctionObjectType, type FunctionObject, type RunnerValue, type TreePath } from '@elaraai/e3-types';
import { sendSuccess, sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import {
  FunctionSignatureType,
  ExecuteResultType,
  type ExecuteResult,
  type ExecuteLimits,
  type FunctionCallRequest,
  type OneShotRequest,
} from '../types.js';

// =============================================================================
// Limits (server-owned, clamped)
// =============================================================================

/** Default per-call timeout when the request doesn't specify one. */
const DEFAULT_TIMEOUT_MS = 60_000;
/** Hard ceiling on any call's timeout (async included). */
const MAX_TIMEOUT_MS = 10 * 60_000;
/** Sync calls additionally respect a server-owned wall-clock deadline so the
 *  caller gets a structured `timed_out` instead of a transport cut. (The
 *  cloud sets this below API Gateway's 29 s; locally we can be generous.) */
const SERVER_SYNC_DEADLINE_MS = 120_000;
/** Default + ceiling for the inline result size (see design §9: 1 MB leaves
 *  3-4x headroom under the base64-inflated Lambda ceiling and still allows
 *  multi-thousand-row tables inline). Requests may lower it, never raise it. */
const MAX_RESULT_BYTES = 1024 * 1024;
/** Default + ceiling for each captured log stream's tail. */
const MAX_LOG_BYTES = 256 * 1024;
const DEFAULT_LOG_BYTES = 64 * 1024;

interface ResolvedLimits {
  timeoutMs: number;
  maxResultBytes: number;
  maxLogBytes: number;
}

function resolveLimits(
  limits: { type: 'some'; value: ExecuteLimits } | { type: 'none'; value: null },
  sync: boolean
): ResolvedLimits {
  const req = limits.type === 'some' ? limits.value : undefined;

  let timeoutMs = req && req.timeoutMs.type === 'some'
    ? Number(req.timeoutMs.value)
    : DEFAULT_TIMEOUT_MS;
  timeoutMs = Math.min(Math.max(1, timeoutMs), MAX_TIMEOUT_MS);
  if (sync) timeoutMs = Math.min(timeoutMs, SERVER_SYNC_DEADLINE_MS);

  let maxResultBytes = req && req.maxResultBytes.type === 'some'
    ? Number(req.maxResultBytes.value)
    : MAX_RESULT_BYTES;
  maxResultBytes = Math.min(Math.max(1, maxResultBytes), MAX_RESULT_BYTES);

  let maxLogBytes = req && req.maxLogBytes.type === 'some'
    ? Number(req.maxLogBytes.value)
    : DEFAULT_LOG_BYTES;
  maxLogBytes = Math.min(Math.max(0, maxLogBytes), MAX_LOG_BYTES);

  return { timeoutMs, maxResultBytes, maxLogBytes };
}

// =============================================================================
// Shared helpers
// =============================================================================

const decodeFunctionObject = decodeBeast2For(FunctionObjectType);

/**
 * Resolve a named function in a package to its FunctionObject.
 *
 * @throws {TaskNotFoundError} If the function doesn't exist (functions are
 *   named callables; the wire format has no separate function_not_found tag —
 *   adding one would reorder ErrorType's sorted variant tags, a breaking
 *   wire change).
 */
async function resolveFunction(
  storage: StorageBackend,
  repoPath: string,
  pkgName: string,
  version: string,
  fnName: string
): Promise<FunctionObject> {
  const pkg = await packageRead(storage, repoPath, pkgName, version);
  const fnHash = pkg.functions.get(fnName);
  if (!fnHash) {
    throw new TaskNotFoundError(`function '${fnName}' in ${pkgName}@${version}`);
  }
  const fnData = await storage.objects.read(repoPath, fnHash);
  return decodeFunctionObject(Buffer.from(fnData));
}

/** Map a DetachedResult to the wire ExecuteResult. */
function detachedToExecuteResult(result: DetachedResult): ExecuteResult {
  const streams = {
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
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

/** Build an `invalid` ExecuteResult (signature/IR error; nothing ran). */
function invalidResult(message: string): ExecuteResult {
  return {
    outcome: variant('invalid', {
      diagnostics: [{ message, filename: none, line: none, column: none }],
    }),
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

/**
 * Execute a resolved named function: arity check → read bodyIr → runDetached.
 * Never throws for execution outcomes — only for storage/infra errors.
 */
async function executeFunction(
  storage: StorageBackend,
  repoPath: string,
  runner: TaskRunner,
  fnObj: FunctionObject,
  req: FunctionCallRequest,
  sync: boolean,
  signal?: AbortSignal
): Promise<ExecuteResult> {
  // Signature validation: arity is checked here, before anything runs.
  // Per-element type errors surface as a runtime decode failure (`failed`)
  // from the runner.
  if (req.args.length !== fnObj.inputTypes.length) {
    return invalidResult(
      `Expected ${fnObj.inputTypes.length} argument(s), got ${req.args.length}`
    );
  }

  const bodyIr = await storage.objects.read(repoPath, fnObj.bodyIr);
  const runnerValue: RunnerValue = req.runner.type === 'some' ? req.runner.value : fnObj.runner;
  const limits = resolveLimits(req.limits, sync);

  const result = await runner.runDetached(
    {
      bodyIr,
      args: req.args.map((a) => a as Uint8Array),
      runner: runnerValue,
      limits,
    },
    { signal }
  );
  return detachedToExecuteResult(result);
}

/**
 * Resolve one-shot args: inline values pass through; dataset paths are
 * resolved + pinned by content hash at launch (objects are immutable, so no
 * lock is needed — snapshot consistency).
 *
 * @returns The arg bytes, or an `invalid` ExecuteResult if a dataset arg is
 *   unassigned.
 */
async function resolveOneShotArgs(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  args: OneShotRequest['args']
): Promise<{ ok: true; bytes: Uint8Array[] } | { ok: false; invalid: ExecuteResult }> {
  const bytes: Uint8Array[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.type === 'value') {
      bytes.push(arg.value as Uint8Array);
    } else {
      const path = arg.value as TreePath;
      const { refType, hash } = await workspaceGetDatasetHash(storage, repoPath, workspace, path);
      if (refType !== 'value' || hash === null) {
        return {
          ok: false,
          invalid: invalidResult(`Dataset argument ${i} is not assigned (ref type: ${refType})`),
        };
      }
      bytes.push(await storage.objects.read(repoPath, hash));
    }
  }
  return { ok: true, bytes };
}

/** Execute a one-shot request (bodyIr from the request). */
async function executeOneShot(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  runner: TaskRunner,
  req: OneShotRequest,
  sync: boolean,
  signal?: AbortSignal
): Promise<ExecuteResult> {
  const resolved = await resolveOneShotArgs(storage, repoPath, workspace, req.args);
  if (!resolved.ok) {
    return resolved.invalid;
  }
  const limits = resolveLimits(req.limits, sync);
  const result = await runner.runDetached(
    {
      bodyIr: req.bodyIr as Uint8Array,
      args: resolved.bytes,
      runner: req.runner,
      limits,
    },
    { signal }
  );
  return detachedToExecuteResult(result);
}

// =============================================================================
// Named function handlers
// =============================================================================

/**
 * List a package's functions with their signatures.
 */
export async function listPackageFunctions(
  storage: StorageBackend,
  repoPath: string,
  pkgName: string,
  version: string
): Promise<Response> {
  try {
    const pkg = await packageRead(storage, repoPath, pkgName, version);
    const signatures = [];
    for (const [name, fnHash] of pkg.functions) {
      const fnData = await storage.objects.read(repoPath, fnHash);
      const fnObj = decodeFunctionObject(Buffer.from(fnData));
      signatures.push({
        name,
        inputTypes: fnObj.inputTypes,
        outputType: fnObj.outputType,
        runner: fnObj.runner,
      });
    }
    return sendSuccess(ArrayType(FunctionSignatureType), signatures);
  } catch (err) {
    return sendError(ArrayType(FunctionSignatureType), errorToVariant(err));
  }
}

/**
 * Describe a single function (signature) so dynamic callers can encode args.
 */
export async function describePackageFunction(
  storage: StorageBackend,
  repoPath: string,
  pkgName: string,
  version: string,
  fnName: string
): Promise<Response> {
  try {
    const fnObj = await resolveFunction(storage, repoPath, pkgName, version, fnName);
    return sendSuccess(FunctionSignatureType, {
      name: fnName,
      inputTypes: fnObj.inputTypes,
      outputType: fnObj.outputType,
      runner: fnObj.runner,
    });
  } catch (err) {
    return sendError(FunctionSignatureType, errorToVariant(err));
  }
}

/**
 * Call a named function synchronously: resolve → validate arity → run →
 * 200 ExecuteResult. The sync path enforces a server-owned deadline so the
 * caller gets a structured `timed_out` instead of a transport cut.
 */
export async function callFunctionSync(
  storage: StorageBackend,
  repoPath: string,
  runner: TaskRunner,
  pkgName: string,
  version: string,
  fnName: string,
  req: FunctionCallRequest
): Promise<Response> {
  try {
    const fnObj = await resolveFunction(storage, repoPath, pkgName, version, fnName);
    const result = await executeFunction(storage, repoPath, runner, fnObj, req, true);
    return sendSuccess(ExecuteResultType, result);
  } catch (err) {
    return sendError(ExecuteResultType, errorToVariant(err));
  }
}




// =============================================================================
// One-shot handlers (workspace-scoped; anonymous caller-supplied IR)
// =============================================================================

/**
 * Run a one-shot synchronously. SECURITY: caller-supplied IR — the route
 * layer gates this behind an elevated role.
 */
export async function callOneShotSync(
  storage: StorageBackend,
  repoPath: string,
  runner: TaskRunner,
  workspace: string,
  req: OneShotRequest
): Promise<Response> {
  try {
    // Validate the workspace exists / is deployed before running anything.
    await workspaceGetPackage(storage, repoPath, workspace);
    const result = await executeOneShot(storage, repoPath, workspace, runner, req, true);
    return sendSuccess(ExecuteResultType, result);
  } catch (err) {
    return sendError(ExecuteResultType, errorToVariant(err));
  }
}

