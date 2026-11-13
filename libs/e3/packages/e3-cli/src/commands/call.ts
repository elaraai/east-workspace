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
 *   e3 call <repo> -w <ws> <fn> [args...] --draft <record>.<mutation> [args...]
 *                                                           # over an unsaved edit
 *
 * Each positional argument is an .east literal (e.g. `5`, `"hello"`,
 * `[1.0, 2.0]`) or a path to a .beast2 / .json / .east file, parsed against
 * the function's declared parameter type. With -w, one written `@<keypath>`
 * is that dataset of the workspace, read where it is stored and pinned at the
 * hash it holds when the call starts, as a server pins it; no East literal
 * starts with `@`. Without -w a dataset argument is refused.
 *
 * A function that declares inputs reads them from the workspace itself, so
 * its caller passes the arguments alone, and calls it with -w.
 *
 * With -w, each `--draft <record>.<mutation> [args...]` lays an unsaved edit
 * over a record the function reads (east-workspace#1619): the mutation runs as
 * `e3 mutate` would run it, its arguments read the same way, and the function
 * reads the record at the state that leaves. Nothing is saved. Drafts are laid
 * in the order written. `--draft` reads every word up to the next option, so it
 * is written after the call's own arguments, or the drafts are ended with `--`;
 * a draft ends where its mutation's arguments do; and a word that starts with
 * a dash is written `--draft=<word>`.
 *
 * Calls are graph-free: the result is printed (or written with -o), and the
 * function's stdout and stderr go to the terminal's stderr, so the value can
 * be piped. A call of a local repository runs in this process and keeps
 * nothing. A call through a server's workspace is the server's: it runs as
 * long as its limits allow, whatever any request's deadline, the server keeps
 * it for its lifetime, and Ctrl-C asks the server to stop it. A call through a
 * server's package runs within one request and keeps nothing.
 */

import { readFile, writeFile } from 'fs/promises';
import {
  decodeBeast2For,
  encodeBeast2For,
  fromEastTypeValue,
  decodeJSONFor,
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
  functionCallUnkept,
  recordDescribe,
  LocalStorage,
  LocalTaskRunner,
  type Budget,
  type DetachedArg,
} from '@elaraai/e3-core';
import {
  type CallArg, type FunctionDraft, type RecordSignature, type RunnerValue, type TreePath,
  decodeFunctionObject, functionDraftEnded, parseKeypath, pathToString,
} from '@elaraai/e3-types';
import {
  ApiError,
  functionDescribe,
  functionCall,
  workspaceFunctionDescribe,
  workspaceFunctionCall,
  workspaceRecordDescribe,
  packageList as packageListRemote,
  type ExecuteResult,
} from '@elaraai/e3-api-client';
import { parseRepoLocation, formatError, exitError } from '../utils.js';
import { parseTaskSpec } from './run.js';
import { commandBudget, refuseRemoteBudget, type BudgetFlags } from './budget.js';
import { arityRefusal, parseMutationSpec } from './mutation-spec.js';

/** How long a remote call's start waits for it to end before the call is
 *  named, and polled: a call any longer can be stopped with Ctrl-C at once. */
const CALL_START_WAIT_MS = 1_000;

// Local calls have no transport ceiling — be generous but still bounded. A
// call's timeout covers the laying of its drafts and its function's run.
const LOCAL_LIMITS = {
  timeoutMs: 10 * 60_000,
  maxResultBytes: 64 * 1024 * 1024,
  maxLogBytes: 64 * 1024,
};

/** Where a call's own arguments are written when it passes drafts. */
const OWN_ARGUMENTS_FIRST = "a call's own arguments are written before the first --draft, which reads every word up to the next option";

/** A function's callable signature, from either a local FunctionObject or a
 *  remote describe. */
interface CallSignature {
  inputs: TreePath[];
  argTypes: EastTypeValue[];
  outputType: EastTypeValue;
}

/**
 * Checks a call's arguments against the function's signature: the arguments
 * alone are counted, never the inputs a call reads, and a function with inputs
 * is called through a workspace.
 *
 * @param fn - The function's name
 * @param signature - Its signature
 * @param rawArgs - The arguments as written
 * @param workspace - The workspace the call runs in, when it names one
 * @param drafted - Whether the call was written with a `--draft`, which reads
 *   every word after it: a miscount then says where a call's own arguments go
 * @throws {Error} When the count differs, or the function reads inputs and
 *   the call names no workspace
 */
export function checkCallArguments(
  fn: string, signature: CallSignature, rawArgs: readonly string[], workspace: string | undefined, drafted = false,
): void {
  if (signature.inputs.length > 0 && workspace === undefined) {
    throw new Error(
      `Function '${fn}' reads ${signature.inputs.map((path) => pathToString(path)).join(', ')} from the workspace it is called through: pass -w <ws>`
    );
  }
  if (rawArgs.length !== signature.argTypes.length) {
    const where = drafted ? ` — ${OWN_ARGUMENTS_FIRST}` : '';
    throw new Error(`Function '${fn}' expects ${signature.argTypes.length} argument(s), got ${rawArgs.length}${where}`);
  }
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
    const value = decodeJSONFor(type)(await readFile(raw));
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
 * Reads the drafts a call was written with (`--draft`): unsaved edits to lay
 * over the records its function reads, each a mutation call as `e3 mutate`
 * takes one.
 *
 * @remarks
 * The command line hands over the words of every `--draft` as one list, so a
 * draft ends where its mutation's arguments do: `<record>.<mutation>`, then as
 * many words as the mutation declares arguments, each read against its type as
 * {@link encodeArg} reads one. The word after them names the next draft. A
 * record is described once, however many drafts name it.
 *
 * @param words - Every word written after a `--draft`, in order
 * @param workspace - The workspace the call runs in, which a refusal names
 * @param describe - Describes a record of that workspace: its mutations, each
 *   with its form and the types of its arguments; `null` when it has no such
 *   record
 * @returns The drafts, in the order written
 * @throws {Error} Where a draft starts, for a word that names no mutation of a
 *   record of the workspace; for a draft with fewer words than its mutation
 *   takes; and for an argument that does not match its type. Each names the
 *   draft by its place and, where the draft before it decided how a word was
 *   read, says so
 */
export async function readDrafts(
  words: readonly string[],
  workspace: string,
  describe: (record: string) => Promise<Pick<RecordSignature, 'mutations'> | null>,
): Promise<FunctionDraft[]> {
  const drafts: FunctionDraft[] = [];
  const described = new Map<string, Pick<RecordSignature, 'mutations'> | null>();
  /** The draft before the one being read, and how many words it took. */
  let before: { spec: string; takes: number } | null = null;
  let at = 0;
  while (at < words.length) {
    const spec = words[at]!;
    const place = drafts.length + 1;
    // This word starts a draft because the one before it took the words it did
    const readAs = before === null
      ? ''
      : ` — draft ${place - 1} (${before.spec}) takes ${before.takes} argument(s), so '${spec}' was read as the draft after it; ${OWN_ARGUMENTS_FIRST}`;
    let named: { record: string; mutation: string };
    try {
      named = parseMutationSpec(spec);
    } catch {
      throw new Error(`Draft ${place}: '${spec}' is not a mutation, written <record>.<mutation>${readAs}`);
    }
    const { record, mutation } = named;
    if (!described.has(record)) described.set(record, await describe(record));
    const signature = described.get(record) ?? null;
    if (signature === null) {
      throw new Error(`Draft ${place} (${spec}): record '${record}' not found in workspace '${workspace}'${readAs}`);
    }
    const mut = signature.mutations.find((m) => m.name === mutation);
    if (mut === undefined) {
      const available = signature.mutations.map((m) => m.name).join(', ') || '(none)';
      throw new Error(`Draft ${place} (${spec}): mutation '${mutation}' not found on record '${record}'. Available: ${available}${readAs}`);
    }
    const raw = words.slice(at + 1, at + 1 + mut.argTypes.length);
    const refusal = arityRefusal(mutation, mut, raw.length);
    if (refusal !== null) throw new Error(`Draft ${place} (${spec}): ${refusal}`);
    const args: Uint8Array[] = [];
    for (const [i, word] of raw.entries()) {
      try {
        args.push(await encodeArg(word, mut.argTypes[i]!, i));
      } catch (err) {
        throw new Error(`Draft ${place} (${spec}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    drafts.push({ record, mutation, args });
    before = { spec, takes: mut.argTypes.length };
    at += 1 + mut.argTypes.length;
  }
  return drafts;
}

/**
 * Writes a log tail of the function's to the terminal's stderr, the value's
 * stdout left to the value alone.
 */
function forwardLog(text: string, truncated: boolean, stream: 'stdout' | 'stderr'): void {
  if (!text.trim()) return;
  // A tail cut short begins part way: say so before it
  if (truncated) console.error(`... (${stream} truncated: its tail)`);
  process.stderr.write(text);
  if (!text.endsWith('\n')) process.stderr.write('\n');
}

/**
 * Render a terminal ExecuteResult: print/write the value on success,
 * report the diagnostic and exit non-zero otherwise. A call one of its drafts
 * ended, before its function ran, is reported as that draft's.
 */
async function renderResult(
  result: ExecuteResult,
  outputType: EastTypeValue,
  outputPath?: string
): Promise<void> {
  // Forward the function's captured logs — its stdout, then its stderr — to
  // the terminal's stderr, so what it logged and its runtime warnings are
  // visible, and the value can still be piped.
  forwardLog(result.stdout, result.stdoutTruncated, 'stdout');
  forwardLog(result.stderr, result.stderrTruncated, 'stderr');

  const outcome = result.outcome;
  // The draft whose mutation ended the call, which its stderr's first line names
  const draft = functionDraftEnded(result);
  const drafted = draft === null ? null : `Draft ${draft.record}.${draft.mutation} (${draft.place} of ${draft.of})`;
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
      console.error(drafted === null
        ? `Function failed with exit code: ${outcome.value.exitCode}`
        : `${drafted} failed with exit code: ${outcome.value.exitCode}; the function did not run`);
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
      console.error(drafted === null
        ? `Function timed out after ${outcome.value.ms}ms`
        : `${drafted} had not been laid when the call timed out after ${outcome.value.ms}ms; the function did not run`);
      process.exit(1);
      break;
    }
    case 'conflict': {
      console.error(
        `Draft ${outcome.value.record}.${outcome.value.mutation} conflicted: ${outcome.value.message} — `
        + 'the edit no longer matches the record; re-read it and call again'
      );
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
  draftWords: readonly string[],
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

  const signature: CallSignature = { inputs: fnObj.inputs, argTypes: fnObj.argTypes, outputType: fnObj.outputType };
  checkCallArguments(spec.fn, signature, rawArgs, workspace, draftWords.length > 0);
  const runner = new LocalTaskRunner(repoPath, budget);

  if (workspace === undefined) {
    // Through the package a call reads no workspace: it takes values only
    // (`callCommand` refuses a dataset and a draft without -w)
    const values: DetachedArg[] = [];
    for (let i = 0; i < rawArgs.length; i++) {
      values.push(await encodeArg(rawArgs[i]!, signature.argTypes[i]!, i));
    }
    const detached = await runner.runDetached({
      bodyIr: await storage.objects.read(repoPath, fnObj.bodyIr),
      args: values,
      runner: fnObj.runner as RunnerValue,
      limits: LOCAL_LIMITS,
      environment: fnObj.environment.type === 'some' ? fnObj.environment.value : undefined,
    }, { storage, verbose });
    // The wire shape a server answers, rendered the same way
    await renderResult(detachedToExecuteResult(detached), signature.outputType, outputPath);
    return;
  }

  const args: CallArg[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    args.push(await callArg(rawArgs[i]!, signature.argTypes[i]!, i));
  }
  const drafts = await readDrafts(draftWords, workspace, (record) => recordDescribe(storage, repoPath, workspace, record));
  // Through a workspace the function's inputs, and an argument that names one
  // of its datasets, are pinned at the hash each holds now, and its drafts are
  // laid over the records it reads, as a server's call pins and lays them:
  // the result names what was read. Nothing of the call is kept, and nothing
  // of a draft is saved
  const result = await functionCallUnkept(storage, runner, repoPath, workspace, pkg, fnObj, { args, drafts }, {
    limits: LOCAL_LIMITS,
    ...(verbose !== undefined && { verbose }),
  });
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
  draftWords: readonly string[],
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

  checkCallArguments(spec.fn, signature, rawArgs, workspace, draftWords.length > 0);
  // The server pins the function's inputs and a dataset argument in the
  // workspace
  const args: CallArg[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    args.push(await callArg(rawArgs[i]!, signature.argTypes[i]!, i));
  }
  // The server lays the drafts; each is read here against its mutation's
  // types, which the server describes (`callCommand` refuses one without -w)
  const drafts = workspace === undefined ? [] : await readDrafts(draftWords, workspace, async (record) => {
    try {
      return await workspaceRecordDescribe(baseUrl, repo, workspace, record, opts);
    } catch (err) {
      // The workspace has no such record
      if (err instanceof ApiError && err.code === 'dataset_not_found') return null;
      throw err;
    }
  });

  const request = { args, runner: none, limits: none, drafts };
  if (!workspace) {
    await renderResult(await functionCall(baseUrl, repo, spec.name!, version!, spec.fn, request, opts), signature.outputType, outputPath);
    return;
  }

  // A call through a workspace is the server's, and outlives any request: it
  // is started and polled to its end, and Ctrl-C asks the server to stop it.
  // A second Ctrl-C stops this process at once.
  const stop = new AbortController();
  const interrupt = (): void => stop.abort(new Error('interrupted'));
  process.once('SIGINT', interrupt);
  let result: ExecuteResult;
  try {
    result = await workspaceFunctionCall(baseUrl, repo, workspace, spec.fn, request, opts, {
      signal: stop.signal,
      // A call longer than a second is named then, so Ctrl-C reaches it at once
      startWaitMs: CALL_START_WAIT_MS,
      onStarted: (id) => console.error(`Call ${id} runs on; Ctrl-C asks the server to stop it`),
    });
  } catch (err) {
    if (!stop.signal.aborted) throw err;
    // The client asks the server to stop the call as it gives it up: this
    // process exits once that request has gone
    console.error('Interrupted: the server is asked to stop the call');
    process.exitCode = 130;
    return;
  } finally {
    process.off('SIGINT', interrupt);
  }
  await renderResult(result, signature.outputType, outputPath);
}

/**
 * `e3 call` entry point.
 */
export async function callCommand(
  repoArg: string,
  fnSpec: string,
  args: string[],
  options: BudgetFlags & { workspace?: string; output?: string; verbose?: boolean; draft?: string[] }
): Promise<void> {
  try {
    const spec = parseFunctionSpec(fnSpec, options.workspace !== undefined);
    // A dataset argument is the workspace's: without one it is refused,
    // before anything is read
    const dataset = args.findIndex((arg) => arg.startsWith('@'));
    if (dataset !== -1 && options.workspace === undefined) {
      throw new Error(`Argument ${dataset + 1} (${args[dataset]}) is a dataset, which a call reads from the workspace it runs in: pass -w <ws>`);
    }
    // A draft is laid over a record of the workspace, and a call through the
    // package reads none: it is refused the same way
    const drafts = options.draft ?? [];
    if (drafts.length > 0 && options.workspace === undefined) {
      throw new Error(`A draft (--draft ${drafts[0]}) is laid over a record of the workspace the call runs in: pass -w <ws>`);
    }
    const location = await parseRepoLocation(repoArg);
    if (location.type === 'local') {
      await callLocal(location.path, spec, options.workspace, args, drafts, commandBudget(options), options.output, options.verbose);
    } else {
      refuseRemoteBudget(options);
      await callRemote(location.baseUrl, location.repo, location.token, spec, options.workspace, args, drafts, options.output, options.verbose);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
