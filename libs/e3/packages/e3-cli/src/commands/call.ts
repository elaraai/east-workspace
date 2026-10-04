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
 *   e3 call <repo> -w <ws> <fn> @.inputs.sales 5           # a dataset argument
 *
 * Each positional argument is an .east literal (e.g. `5`, `"hello"`,
 * `[1.0, 2.0]`) or a path to a .beast2 / .json / .east file, parsed against
 * the function's declared parameter type. With -w, one written `@<keypath>`
 * is that dataset of the workspace, read where it is stored and pinned at the
 * hash it holds when the call starts, as a server pins it; no East literal
 * starts with `@`. Without -w a dataset argument is refused.
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
  none,
  variant,
  type EastTypeValue,
  type EastType,
} from '@elaraai/east';
import {
  packageRead,
  packageGetLatestVersion,
  workspaceGetPackage,
  detachedToExecuteResult,
  pinCallArguments,
  LocalStorage,
  LocalTaskRunner,
  type Budget,
  type DetachedArg,
} from '@elaraai/e3-core';
import { type CallArg, type RunnerValue, decodeFunctionObject, parseKeypath } from '@elaraai/e3-types';
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
import { commandBudget, refuseRemoteBudget, type BudgetFlags } from './budget.js';

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
 * Read one positional argument of a call: a dataset of the workspace the call
 * runs in, written `@<keypath>` (as `@.inputs.sales`), or a value, as
 * {@link encodeArg} reads one.
 *
 * @remarks
 * No East literal starts with `@`, so the two never collide. A call with no
 * workspace has no dataset to read, and `callCommand` refuses one before any
 * argument is read.
 *
 * @param raw - The argument as written
 * @param typeValue - The parameter's type, which a value is read as
 * @param index - The argument's position from 0; an error names it from 1
 * @returns The argument
 * @throws {Error} For an `@` that names no dataset's keypath, and a value that
 *   does not match the parameter type
 */
export async function callArg(raw: string, typeValue: EastTypeValue, index: number): Promise<CallArg> {
  if (!raw.startsWith('@')) return variant('value', await encodeArg(raw, typeValue, index));
  let path;
  try {
    path = parseKeypath(raw.slice(1));
  } catch (err) {
    throw new Error(`Argument ${index + 1} (${raw}) is not a dataset's keypath, as @.inputs.sales is: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (path.length === 0) {
    throw new Error(`Argument ${index + 1} (${raw}) names the workspace's root, which is a tree: a dataset argument names a dataset, as @.inputs.sales does`);
  }
  return variant('dataset', path);
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
  budget: Budget,
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
  // Through a workspace an argument may be one of its datasets, pinned at the
  // hash it holds now, as a server pins it, and named in the result; a call
  // with none takes values only (`callCommand` refuses a dataset without -w)
  let pinned: { args: DetachedArg[]; inputs: ExecuteResult['inputs'] } | ExecuteResult;
  if (workspace === undefined) {
    const values: DetachedArg[] = [];
    for (let i = 0; i < rawArgs.length; i++) {
      values.push(await encodeArg(rawArgs[i]!, signature.inputTypes[i]!, i));
    }
    pinned = { args: values, inputs: [] };
  } else {
    const args: CallArg[] = [];
    for (let i = 0; i < rawArgs.length; i++) {
      args.push(await callArg(rawArgs[i]!, signature.inputTypes[i]!, i));
    }
    pinned = await pinCallArguments(storage, repoPath, workspace, args);
  }
  if (!('args' in pinned)) {
    // An unassigned dataset, and nothing ran
    await renderResult(pinned, signature.outputType, outputPath);
    return;
  }

  const runner = new LocalTaskRunner(repoPath, budget);
  const bodyIr = await storage.objects.read(repoPath, fnObj.bodyIr);
  const detached = await runner.runDetached({
    bodyIr,
    args: pinned.args,
    runner: fnObj.runner as RunnerValue,
    limits: LOCAL_LIMITS,
    environment: fnObj.environment.type === 'some' ? fnObj.environment.value : undefined,
  }, { storage, verbose });

  // The wire shape a server answers, rendered the same way
  await renderResult(detachedToExecuteResult(detached, pinned.inputs), signature.outputType, outputPath);
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
  outputPath?: string,
  verbose?: boolean
): Promise<void> {
  const opts = { token, verbose };

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
  // The server pins a dataset argument in the workspace
  const args: CallArg[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    args.push(await callArg(rawArgs[i]!, signature.inputTypes[i]!, i));
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
  options: BudgetFlags & { workspace?: string; output?: string; verbose?: boolean }
): Promise<void> {
  try {
    const spec = parseFunctionSpec(fnSpec, options.workspace !== undefined);
    // A dataset argument is the workspace's: without one it is refused,
    // before anything is read
    const dataset = args.findIndex((arg) => arg.startsWith('@'));
    if (dataset !== -1 && options.workspace === undefined) {
      throw new Error(`Argument ${dataset + 1} (${args[dataset]}) is a dataset, which a call reads from the workspace it runs in: pass -w <ws>`);
    }
    const location = await parseRepoLocation(repoArg);
    if (location.type === 'local') {
      await callLocal(location.path, spec, options.workspace, args, commandBudget(options), options.output, options.verbose);
    } else {
      refuseRemoteBudget(options);
      await callRemote(location.baseUrl, location.repo, location.token, spec, options.workspace, args, options.output, options.verbose);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
