/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 call command - Invoke a named package function with argument values.
 *
 * Usage:
 *   e3 call <repo> <pkg.fn> [args...] [-o out.beast2]      # package-scoped
 *   e3 call <repo> <pkg@1.0.0.fn> [args...]
 *   e3 call <repo> -w <ws> <fn> [args...]                   # workspace-scoped
 *
 * Each positional argument is an .east literal (e.g. `5`, `"hello"`,
 * `[1.0, 2.0]`) or a path to a .beast2 / .json / .east file, parsed against
 * the function's declared parameter type.
 *
 * Calls are graph-free and persist nothing: the result is returned inline
 * and printed (or written with -o); the repository is unchanged.
 */

import { readFile, writeFile } from 'fs/promises';
import {
  decodeBeast2For,
  encodeBeast2For,
  fromEastTypeValue,
  fromJSONFor,
  parseFor,
  printFor,
  variant,
  none,
  type EastTypeValue,
  type EastType,
} from '@elaraai/east';
import {
  packageRead,
  packageGetLatestVersion,
  workspaceGetPackage,
  LocalStorage,
  LocalTaskRunner,
} from '@elaraai/e3-core';
import { type RunnerValue, decodeFunctionObject } from '@elaraai/e3-types';
import {
  functionDescribe,
  functionCall,
  workspaceFunctionDescribe,
  workspaceFunctionCall,
  packageList as packageListRemote,
  type ExecuteResult,
} from '@elaraai/e3-api-client';
import { parseRepoLocation, formatError, exitError } from '../utils.js';
import { parseTaskSpec } from './run.js';

// Local calls have no transport ceiling — be generous but still bounded.
const LOCAL_LIMITS = {
  timeoutMs: 10 * 60_000,
  maxResultBytes: 64 * 1024 * 1024,
  maxLogBytes: 64 * 1024,
};

/** A function's callable signature, from either a local FunctionObject or a
 *  remote describe. */
interface CallSignature {
  inputTypes: EastTypeValue[];
  outputType: EastTypeValue;
}

/**
 * Parse a function spec. With --workspace a bare `fn` is allowed (the
 * package comes from the deployment); otherwise `pkg.fn` / `pkg@ver.fn`.
 */
export function parseFunctionSpec(
  spec: string,
  workspaceScoped: boolean
): { name?: string; version?: string; fn: string } {
  if (workspaceScoped && !spec.includes('.')) {
    if (!spec) throw new Error('Function name cannot be empty');
    return { fn: spec };
  }
  const { name, version, task } = parseTaskSpec(spec);
  return { name, version, fn: task };
}

/**
 * Encode one positional argument against its declared parameter type.
 * Accepts an inline .east literal or a .beast2/.json/.east file path.
 */
export async function encodeArg(raw: string, typeValue: EastTypeValue, index: number): Promise<Uint8Array> {
  const type: EastType = fromEastTypeValue(typeValue);

  if (raw.endsWith('.beast2')) {
    const data = await readFile(raw);
    try {
      decodeBeast2For(type)(data); // validate against the parameter type
    } catch (err) {
      throw new Error(`Argument ${index + 1} (${raw}) does not match the parameter type: ${err instanceof Error ? err.message : String(err)}`);
    }
    return data;
  }

  if (raw.endsWith('.json')) {
    const content = await readFile(raw, 'utf-8');
    const value = fromJSONFor(type)(JSON.parse(content));
    return encodeBeast2For(type)(value);
  }

  let literal = raw;
  if (raw.endsWith('.east')) {
    literal = await readFile(raw, 'utf-8');
  }
  const result = parseFor(type)(literal);
  if (!result.success) {
    throw new Error(`Argument ${index + 1}: failed to parse '${raw}': ${result.error}`);
  }
  return encodeBeast2For(type)(result.value);
}

/**
 * Render a terminal ExecuteResult: print/write the value on success,
 * report the diagnostic and exit non-zero otherwise.
 */
async function renderResult(
  result: ExecuteResult,
  outputType: EastTypeValue,
  outputPath?: string
): Promise<void> {
  // Forward the function's captured stderr so runtime warnings are visible.
  if (result.stderr.trim()) {
    process.stderr.write(result.stderr);
    if (!result.stderr.endsWith('\n')) process.stderr.write('\n');
    if (result.stderrTruncated) console.error('... (stderr truncated)');
  }

  const outcome = result.outcome;
  switch (outcome.type) {
    case 'success': {
      const bytes = outcome.value.value as Uint8Array;
      if (outputPath) {
        await writeFile(outputPath, bytes);
        console.log(`Output: ${outputPath}`);
      } else {
        const type = fromEastTypeValue(outputType);
        const value = decodeBeast2For(type)(bytes);
        console.log(printFor(type)(value));
      }
      return;
    }
    case 'invalid': {
      for (const diag of outcome.value.diagnostics) {
        console.error(`Error: ${diag.message}`);
      }
      process.exit(1);
      break;
    }
    case 'failed': {
      console.error(`Function failed with exit code: ${outcome.value.exitCode}`);
      process.exit(1);
      break;
    }
    case 'too_large': {
      console.error(
        `Result too large for an inline function result (${outcome.value.bytes} bytes > ${outcome.value.limit} limit). ` +
        `This result is a dataset — deploy a task and read it with 'e3 dataset get'.`
      );
      process.exit(1);
      break;
    }
    case 'timed_out': {
      console.error(`Function timed out after ${outcome.value.ms}ms`);
      process.exit(1);
      break;
    }
  }
}

/**
 * Call a function in a local repository (no server round trip).
 */
async function callLocal(
  repoPath: string,
  spec: { name?: string; version?: string; fn: string },
  workspace: string | undefined,
  rawArgs: string[],
  outputPath?: string,
  verbose?: boolean
): Promise<void> {
  const storage = new LocalStorage();

  let pkgName: string;
  let version: string;
  if (workspace) {
    const deployed = await workspaceGetPackage(storage, repoPath, workspace);
    pkgName = deployed.name;
    version = deployed.version;
  } else {
    pkgName = spec.name!;
    version = spec.version!;
    if (version === 'latest') {
      const resolved = await packageGetLatestVersion(storage, repoPath, pkgName);
      if (!resolved) {
        exitError(`Package '${pkgName}' not found`);
      }
      version = resolved;
    }
  }

  const pkg = await packageRead(storage, repoPath, pkgName, version);
  const fnHash = pkg.functions.get(spec.fn);
  if (!fnHash) {
    const available = Array.from(pkg.functions.keys()).join(', ');
    exitError(`Function '${spec.fn}' not found in ${pkgName}@${version}. Available: ${available || '(none)'}`);
  }
  const fnObj = decodeFunctionObject(Buffer.from(await storage.objects.read(repoPath, fnHash)));

  const signature: CallSignature = { inputTypes: fnObj.inputTypes, outputType: fnObj.outputType };
  if (rawArgs.length !== signature.inputTypes.length) {
    exitError(`Function '${spec.fn}' expects ${signature.inputTypes.length} argument(s), got ${rawArgs.length}`);
  }
  const args: Uint8Array[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    args.push(await encodeArg(rawArgs[i]!, signature.inputTypes[i]!, i));
  }

  const runner = new LocalTaskRunner(repoPath);
  const bodyIr = await storage.objects.read(repoPath, fnObj.bodyIr);
  const detached = await runner.runDetached({
    bodyIr,
    args,
    runner: fnObj.runner as RunnerValue,
    limits: LOCAL_LIMITS,
    environment: fnObj.environment.type === 'some' ? fnObj.environment.value : undefined,
  }, { storage, verbose });

  // Reuse the wire shape for rendering
  const streams = {
    stdout: detached.stdout,
    stderr: detached.stderr,
    stdoutTruncated: detached.stdoutTruncated,
    stderrTruncated: detached.stderrTruncated,
  };
  let result: ExecuteResult;
  switch (detached.kind) {
    case 'success':
      result = { outcome: variant('success', { value: detached.value }), ...streams };
      break;
    case 'failed':
      result = { outcome: variant('failed', { exitCode: BigInt(detached.exitCode) }), ...streams };
      break;
    case 'too_large':
      result = { outcome: variant('too_large', { bytes: BigInt(detached.bytes), limit: BigInt(detached.limit) }), ...streams };
      break;
    case 'timed_out':
      result = { outcome: variant('timed_out', { ms: BigInt(detached.ms) }), ...streams };
      break;
  }
  await renderResult(result, signature.outputType, outputPath);
}

/**
 * Call a function on a remote repository via the API client.
 */
async function callRemote(
  baseUrl: string,
  repo: string,
  token: string,
  spec: { name?: string; version?: string; fn: string },
  workspace: string | undefined,
  rawArgs: string[],
  outputPath?: string
): Promise<void> {
  const opts = { token };

  let version = spec.version;
  if (!workspace && version === 'latest') {
    const versions = (await packageListRemote(baseUrl, repo, opts))
      .filter((p) => p.name === spec.name)
      .map((p) => p.version)
      .sort();
    if (versions.length === 0) {
      exitError(`Package '${spec.name}' not found`);
    }
    version = versions[versions.length - 1]!;
  }

  const signature = workspace
    ? await workspaceFunctionDescribe(baseUrl, repo, workspace, spec.fn, opts)
    : await functionDescribe(baseUrl, repo, spec.name!, version!, spec.fn, opts);

  if (rawArgs.length !== signature.inputTypes.length) {
    exitError(`Function '${spec.fn}' expects ${signature.inputTypes.length} argument(s), got ${rawArgs.length}`);
  }
  const args: Uint8Array[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    args.push(await encodeArg(rawArgs[i]!, signature.inputTypes[i]!, i));
  }

  const request = { args, runner: none, limits: none };
  const result = workspace
    ? await workspaceFunctionCall(baseUrl, repo, workspace, spec.fn, request, opts)
    : await functionCall(baseUrl, repo, spec.name!, version!, spec.fn, request, opts);

  await renderResult(result, signature.outputType, outputPath);
}

/**
 * `e3 call` entry point.
 */
export async function callCommand(
  repoArg: string,
  fnSpec: string,
  args: string[],
  options: { workspace?: string; output?: string; verbose?: boolean }
): Promise<void> {
  try {
    const spec = parseFunctionSpec(fnSpec, options.workspace !== undefined);
    const location = await parseRepoLocation(repoArg);
    if (location.type === 'local') {
      await callLocal(location.path, spec, options.workspace, args, options.output, options.verbose);
    } else {
      await callRemote(location.baseUrl, location.repo, location.token, spec, options.workspace, args, options.output);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
