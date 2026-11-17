/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 call command - Invoke a function with argument values: a named package
 * function, or a function from its IR file.
 *
 * Usage:
 *   e3 call <repo> <pkg.fn> [args...] [-o out.beast2]      # package-scoped
 *   e3 call <repo> <pkg@1.0.0.fn> [args...]
 *   e3 call <repo> -w <ws> <fn> [args...]                   # workspace-scoped
 *   e3 call <repo> -w <ws> <fn> @.inputs.sales 5           # a dataset argument
 *   e3 call <repo> -w <ws> <fn> [args...] --draft <record>.<mutation> [args...]
 *                                                           # over an unsaved edit
 *   e3 call <repo> --ir score.beast2 [args...]              # a function from its IR file
 *   e3 call <url> -w <ws> --ir score.beast2 @.inputs.sales  # through a server's one-shot calls
 *   e3 call <repo> -w <ws> <fn> [args...] --rack            # on an enrolled rack
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
 * With --ir the function is the IR file's — a function's or an async
 * function's IR bundle, `.beast2`, or `.json` / `.east` as the runners' CLIs
 * read one — and its signature is read from the IR. It runs on --runner's
 * runtime, east-node unless named, with that runtime's standard platform
 * package, or the packages --platform names (`none` for none). Through a
 * server it is one of the workspace's one-shot calls, under the grant the
 * server gives the caller: a reader may make a platform-free call alone. It
 * reads no record, so it is passed no draft.
 *
 * With --rack a call of a local repository runs on an enrolled rack, whatever
 * the repository's rack policy selects: a rule that names it (`fn:<name>`)
 * still sizes it. A call no rack can run runs here, and a line on the
 * terminal's stderr says where it ran and why. Its drafts are laid here, over
 * this repository's records, and its function runs on the rack.
 *
 * Calls are graph-free: the result is printed (or written with -o), and the
 * function's stdout and stderr go to the terminal's stderr, so the value can
 * be piped. A call of a local repository runs in this process and keeps
 * nothing. A call through a server's workspace is the server's: it runs as
 * long as its limits allow, whatever any request's deadline, the server keeps
 * it for its lifetime, and Ctrl-C asks the server to stop it. A call through a
 * server's package runs within one request and keeps nothing.
 */

import { readFile } from 'fs/promises';
import { basename, extname } from 'path';
import {
  IntegerType,
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
import { STANDARD_PLATFORM_BY_RUNNER } from '@elaraai/e3';
import {
  packageObjectRead,
  packageRead,
  workspaceGetPackage,
  detachedToExecuteResult,
  functionCallUnkept,
  pinCallArguments,
  readProgram,
  recordDescribe,
  withRunningWork,
  writeOutputFile,
  LocalStorage,
  LocalTaskRunner,
  type Budget,
  type DetachedArg,
  type DetachedSpec,
  type TaskRunner,
} from '@elaraai/e3-core';
import {
  type CallArg, type FunctionDraft, type FunctionInput, type FunctionObject, type PackageObject, type RecordSignature, type RunnerValue,
  decodeFunctionObject, functionDraftEnded, functionDraftsOutlasted, inputLabel, parseKeypath,
} from '@elaraai/e3-types';
import {
  ApiError,
  functionDescribe,
  functionCall,
  oneShotCall,
  workspaceFunctionDescribe,
  workspaceFunctionCall,
  workspaceRecordDescribe,
  type ExecuteResult,
  type WorkspaceFunctionCallOptions,
} from '@elaraai/e3-api-client';
import { parseRepoLocation, resolvePackageVersion, formatError, exitError } from '../utils.js';
import { parseTaskSpec } from './run.js';
import { commandBudget, refuseRemoteBudget, type BudgetFlags } from './budget.js';
import { openCommandRack, rackAsked, refuseRemoteRack, unattachedLine, type RackFlags } from './rack-options.js';
import { arityRefusal, parseMutationSpec } from './mutation-spec.js';
import { untilInterrupted } from '../interrupt.js';

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

/** An Integer a message names, as East prints it: a draft's place among a call's. */
const printInteger = printFor(IntegerType);

/** Where a call's own arguments are written when it passes drafts. */
const OWN_ARGUMENTS_FIRST = "a call's own arguments are written before the first --draft, which reads every word up to the next option";

/** A function's callable signature, from either a local FunctionObject, a
 *  remote describe or an IR file. */
interface CallSignature {
  inputs: FunctionInput[];
  argTypes: EastTypeValue[];
  outputType: EastTypeValue;
}

/** The program a call runs: a named function's, or an IR file's. */
interface CallProgram {
  /** The function's name, as its rule and its placement name it
   *  (`fn:<name>`): a named function's own, or its IR file's without its
   *  extension */
  name: string;
  /** Whether it is a package's function, which a call through a workspace
   *  resolves by its name in the package the workspace runs */
  named: boolean;
  /** Its IR bundle */
  bodyIr: Uint8Array;
  /** The runner it runs on */
  runner: RunnerValue;
  /** The environment it declares, when it declares one */
  environment?: string;
  /** What it takes and answers */
  signature: CallSignature;
}

/** The options of `e3 call`. */
export interface CallOptions extends BudgetFlags, RackFlags {
  /** The workspace the call runs in, whose datasets an argument may name */
  workspace?: string;
  /** Where the value is written, in place of printing it */
  output?: string;
  /** Pass `-v` to the runner */
  verbose?: boolean;
  /** The words of every `--draft`: unsaved edits laid over the records a
   *  named function reads */
  draft?: string[];
  /** An IR file whose function is called, in place of a named one */
  ir?: string;
  /** The runtime an IR file's function runs on: east-node unless named */
  runner?: string;
  /** The platform packages it loads, in place of its runtime's standard one:
   *  `none` for none */
  platform?: string[];
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
      `Function '${fn}' reads ${signature.inputs.map((input) => inputLabel(input)).join(', ')} from the workspace it is called through: pass -w <ws>`
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

/** The runtimes `--runner` names, by their wire tag. */
const RUNTIMES = { 'east-node': 'east_node', 'east-c': 'east_c', 'east-py': 'east_py' } as const;

/**
 * The runner an IR file's function runs on: a stock runtime, east-node unless
 * named, given the runtime's standard platform package, as `e3.function`'s
 * default runner is, or the packages named in its place — none for `none`,
 * which makes a platform-free call.
 *
 * @param runtime - `east-node`, `east-c` or `east-py`
 * @param platforms - The packages it loads, in place of its standard one; `none` alone for none
 * @returns The runner
 * @throws {Error} For another runtime, and for `none` named beside a package
 */
export function irRunner(runtime = 'east-node', platforms?: readonly string[]): RunnerValue {
  if (!Object.hasOwn(RUNTIMES, runtime)) throw new Error(`--runner names east-node, east-c or east-py, not '${runtime}'`);
  const tag = RUNTIMES[runtime as keyof typeof RUNTIMES];
  if (platforms?.includes('none') === true && platforms.length > 1) throw new Error('--platform none loads no package, and is named alone');
  const named = platforms === undefined ? [STANDARD_PLATFORM_BY_RUNNER[tag]] : platforms.includes('none') ? [] : [...platforms];
  const decode = variant('lazy', null);
  switch (tag) {
    case 'east_node': return variant('east_node', { platforms: named, decode });
    case 'east_c': return variant('east_c', { platforms: named, decode });
    case 'east_py': return variant('east_py', { platforms: named, decode });
  }
}

/**
 * Reads the function an IR file holds: its program as the bundle a runner is
 * handed, its signature from the IR, and the runner it runs on.
 *
 * @param path - The IR file: `.beast2`, `.json` or `.east`
 * @param runtime - The runtime it runs on ({@link irRunner})
 * @param platforms - The packages it loads ({@link irRunner})
 * @returns The program, named by its file without its extension
 * @throws {Error} When the file cannot be read, holds no function's IR, or the
 *   runner is not one
 */
export async function irProgram(path: string, runtime?: string, platforms?: readonly string[]): Promise<CallProgram> {
  const runner = irRunner(runtime, platforms);
  const bytes = new Uint8Array(await readFile(path));
  let program: ReturnType<typeof readProgram>;
  try {
    program = readProgram(path, bytes);
  } catch (err) {
    throw new Error(`${path} holds no function's IR: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { name: basename(path, extname(path)), named: false, bodyIr: program.bodyIr, runner,
    signature: { inputs: [], argTypes: program.argTypes, outputType: program.outputType } };
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
  // The draft whose mutation ended the call, as its result names it: never read
  // from its stderr, whose first line says so for people, and which a function's
  // own stderr may begin the same way (#1680's review)
  const draft = functionDraftEnded(result);
  const drafted = draft === null ? null : `Draft ${draft.record}.${draft.mutation} (${printInteger(draft.place)} of ${printInteger(draft.of)})`;
  // Every draft laid, and the call's timeout ended before its function ran, as
  // its result names it
  const outlasted = functionDraftsOutlasted(result);
  switch (outcome.type) {
    case 'success': {
      const bytes = outcome.value.value as Uint8Array;
      if (outputPath) {
        // Replaced, never written into: the file may be a store's object
        await writeOutputFile(outputPath, bytes);
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
      console.error(drafted !== null
        ? `${drafted} had not been laid when the call timed out after ${outcome.value.ms}ms; the function did not run`
        : outlasted
          ? `The call's drafts were laid, and its timeout of ${outcome.value.ms}ms ended before the function ran: the function did not run`
          : `Function timed out after ${outcome.value.ms}ms`);
      process.exit(1);
      break;
    }
    case 'conflict': {
      console.error(
        `Draft ${outcome.value.record}.${outcome.value.mutation} (${printInteger(outcome.value.place)} of ${printInteger(outcome.value.of)}) `
        + `conflicted: ${outcome.value.message} — `
        + 'the edit no longer matches the record; re-read it and call again'
      );
      process.exit(1);
      break;
    }
  }
}

/**
 * A named function of a local repository: of the package a workspace runs,
 * or of a package by its name and version.
 */
async function namedProgram(
  storage: LocalStorage,
  repoPath: string,
  spec: { name?: string; version?: string; fn: string },
  workspace: string | undefined,
): Promise<CallProgram & { pkg: string }> {
  // Through a workspace, the package it names by its hash, which a call
  // through it runs: never the package a name and a version name now, which
  // an import under the same version replaces before any deploy of it
  let pkgName: string;
  let version: string;
  let pkg: PackageObject;
  if (workspace) {
    const deployed = await workspaceGetPackage(storage, repoPath, workspace);
    pkgName = deployed.name;
    version = deployed.version;
    pkg = await packageObjectRead(storage, repoPath, deployed.hash);
  } else {
    pkgName = spec.name!;
    version = await resolvePackageVersion({ type: 'local', path: repoPath }, pkgName, spec.version!);
    pkg = await packageRead(storage, repoPath, pkgName, version);
  }

  const fnHash = pkg.functions.get(spec.fn);
  if (!fnHash) {
    const available = Array.from(pkg.functions.keys()).join(', ');
    exitError(`Function '${spec.fn}' not found in ${pkgName}@${version}. Available: ${available || '(none)'}`);
  }
  const fnObj: FunctionObject = decodeFunctionObject(Buffer.from(await storage.objects.read(repoPath, fnHash)));
  return {
    name: spec.fn,
    named: true,
    pkg: `${pkgName}@${version}`,
    bodyIr: await storage.objects.read(repoPath, fnObj.bodyIr),
    runner: fnObj.runner as RunnerValue,
    ...(fnObj.environment.type === 'some' && { environment: fnObj.environment.value }),
    signature: { inputs: fnObj.inputs, argTypes: fnObj.argTypes, outputType: fnObj.outputType },
  };
}

/**
 * Runs a call on an enrolled rack, through a session opened for it alone: a
 * rack is leased the call whatever the repository's policy selects, and where
 * no rack can run it, it runs here. Where it ran, and why, goes to the
 * terminal's stderr. Its program, and an argument too large to travel inline,
 * are objects of the repository until the call ends, so no sweep takes them
 * meanwhile. Ctrl-C leaves its lease, whose rack is told to stop it.
 *
 * @param label - What the rack's activity view names the call by: the
 *   workspace, the package, or nothing for an IR file's call
 * @param run - Runs the call's function on the rack's runner, which the
 *   signal stops
 * @param finished - Whether what `run` answered is a value in hand, which a
 *   Ctrl-C that came with it did not stop
 * @returns The call's outcome, or null once Ctrl-C has stopped it
 */
async function callOnRack<T>(
  storage: LocalStorage,
  repoPath: string,
  program: CallProgram,
  label: string,
  budget: Budget,
  options: CallOptions,
  run: (runner: TaskRunner, signal: AbortSignal) => Promise<T>,
  finished: (result: T) => boolean,
): Promise<T | null> {
  // Ctrl-C ends the wait for a rack and leaves the call's lease, from before
  // its session opens
  return untilInterrupted(async (signal) => {
    const rack = await openCommandRack({ repoPath, workspace: label, storage, label: `e3 call ${program.name} (pid ${process.pid})`, budget,
      rackOnly: options.rackOnly, signal, print: (line) => console.error(line) });
    try {
      // A call always runs: with no session, here
      const unattached = unattachedLine(rack, `fn:${program.name}`, true);
      if (unattached !== undefined) console.error(unattached);
      return await withRunningWork(storage, repoPath, () => run(rack.runner, signal));
    } finally {
      await rack.close();
    }
    // A value that came as Ctrl-C did is the call's: nothing was stopped
  }, 'the call\'s rack is told to stop it', finished);
}

/**
 * Call a function in a local repository (no server round trip): here, or
 * with --rack on an enrolled rack.
 */
async function callLocal(
  storage: LocalStorage,
  repoPath: string,
  program: CallProgram,
  label: string,
  workspace: string | undefined,
  rawArgs: string[],
  draftWords: readonly string[],
  budget: Budget,
  options: CallOptions,
): Promise<void> {
  const { signature } = program;
  checkCallArguments(program.name, signature, rawArgs, workspace, draftWords.length > 0);
  const onRack = rackAsked(options);
  const local = new LocalTaskRunner(repoPath, budget);

  if (workspace !== undefined && program.named) {
    const args = await serverArgs(signature, rawArgs);
    const drafts = await readDrafts(draftWords, workspace, (record) => recordDescribe(storage, repoPath, workspace, record));
    // Through a workspace the function is resolved again, its inputs and an
    // argument that names one of its datasets pinned at the hash each holds
    // now, under the workspace's shared lock, and its drafts are laid over the
    // records it reads, as a server's call resolves, pins and lays them: the
    // result names what was read. Nothing of the call is kept, and nothing of a
    // draft is saved. With --rack its drafts are laid here and its function
    // runs on the rack
    const call = (functionRunner?: TaskRunner, signal?: AbortSignal): Promise<ExecuteResult> =>
      functionCallUnkept(storage, local, repoPath, workspace, program.name, { args, drafts }, {
        limits: LOCAL_LIMITS,
        ...(options.verbose !== undefined && { verbose: options.verbose }),
        ...(functionRunner !== undefined && { functionRunner }),
        ...(signal !== undefined && { signal }),
      });
    const result = onRack
      ? await callOnRack(storage, repoPath, program, label, budget, options, call, (answer) => answer.outcome.type === 'success')
      : await call();
    if (result !== null) await renderResult(result, signature.outputType, options.output);
    return;
  }

  // An IR file's function, or a package's through no workspace: through a
  // workspace an argument that names one of its datasets is pinned at the
  // hash it holds now, as a server pins it, and named in the result; a call
  // with none takes values only (`callCommand` refuses a dataset and a draft
  // without -w, and a draft for an IR file's function)
  let pinned: { args: DetachedArg[]; inputs: ExecuteResult['inputs'] } | ExecuteResult;
  if (workspace === undefined) {
    const values: DetachedArg[] = [];
    for (let i = 0; i < rawArgs.length; i++) {
      values.push(await encodeArg(rawArgs[i]!, signature.argTypes[i]!, i));
    }
    pinned = { args: values, inputs: [] };
  } else {
    pinned = await pinCallArguments(storage, repoPath, workspace, await serverArgs(signature, rawArgs), { inputs: signature.inputs });
  }
  if (!('args' in pinned)) {
    // An unassigned dataset, and nothing ran
    await renderResult(pinned, signature.outputType, options.output);
    return;
  }

  const spec: DetachedSpec = { bodyIr: program.bodyIr, args: pinned.args, runner: program.runner, limits: LOCAL_LIMITS,
    ...(program.environment !== undefined && { environment: program.environment }) };
  const detached = onRack
    ? await callOnRack(storage, repoPath, program, label, budget, options, (runner, signal) => runner.runDetached(spec, { storage, functionName: program.name, signal,
      ...(options.verbose !== undefined && { verbose: options.verbose }) }), (answer) => answer.kind === 'success')
    : await local.runDetached(spec, { storage, verbose: options.verbose });
  if (detached === null) return;

  // The wire shape a server answers, rendered the same way
  await renderResult(detachedToExecuteResult(detached, pinned.inputs), signature.outputType, options.output);
}

/**
 * Waits for a call a server keeps, which `start` starts: a call longer than a
 * second is named then, so Ctrl-C reaches it at once, and Ctrl-C asks the
 * server to stop it. A second Ctrl-C stops this process at once.
 *
 * @param start - Starts the call, given how it is stopped and told of
 * @returns The call's result, or null once Ctrl-C has stopped it
 */
function keptCall(start: (call: WorkspaceFunctionCallOptions) => Promise<ExecuteResult>): Promise<ExecuteResult | null> {
  // The client asks the server to stop the call as it gives it up: this
  // process exits once that request has gone
  return untilInterrupted((signal) => start({
    signal,
    startWaitMs: CALL_START_WAIT_MS,
    onStarted: (id) => console.error(`Call ${id} runs on; Ctrl-C asks the server to stop it`),
  }), 'the server is asked to stop the call');
}

/** Reads a call's arguments as a server takes them: values, and with a
 *  workspace its datasets, which the server pins. */
async function serverArgs(signature: CallSignature, rawArgs: readonly string[]): Promise<CallArg[]> {
  const args: CallArg[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    args.push(await callArg(rawArgs[i]!, signature.argTypes[i]!, i));
  }
  return args;
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

  // A bare package name calls the greatest version the server holds
  const version = workspace ? undefined : await resolvePackageVersion({ type: 'remote', baseUrl, repo, token }, spec.name!, spec.version!);

  const signature = workspace
    ? await workspaceFunctionDescribe(baseUrl, repo, workspace, spec.fn, opts)
    : await functionDescribe(baseUrl, repo, spec.name!, version!, spec.fn, opts);

  checkCallArguments(spec.fn, signature, rawArgs, workspace, draftWords.length > 0);
  // The server pins the function's inputs and a dataset argument in the
  // workspace
  const args = await serverArgs(signature, rawArgs);
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
  // is started and polled to its end
  const result = await keptCall((call) => workspaceFunctionCall(baseUrl, repo, workspace, spec.fn, request, opts, call));
  if (result !== null) await renderResult(result, signature.outputType, outputPath);
}

/**
 * Call a function from its IR file through a server: one of a workspace's
 * one-shot calls, under the grant the server gives the caller, started and
 * polled as a workspace's function call is.
 */
async function callIrRemote(
  baseUrl: string,
  repo: string,
  token: string,
  program: CallProgram,
  workspace: string | undefined,
  rawArgs: string[],
  outputPath?: string,
  verbose?: boolean
): Promise<void> {
  if (workspace === undefined) throw new Error('A call of an IR file through a server is one of a workspace\'s calls: pass -w <ws>');
  checkCallArguments(program.name, program.signature, rawArgs, workspace);
  const request = { bodyIr: program.bodyIr, args: await serverArgs(program.signature, rawArgs), runner: program.runner, limits: none };
  const result = await keptCall((call) => oneShotCall(baseUrl, repo, workspace, request, { token, verbose }, call));
  if (result !== null) await renderResult(result, program.signature.outputType, outputPath);
}

/**
 * `e3 call` entry point.
 *
 * @param repoArg - The repository: a local path or a server's URL
 * @param fnSpec - The function, as `pkg.fn` (or `fn` with -w); with --ir, the
 *   first argument, or none
 * @param args - The arguments
 * @param options - The call's options
 */
export async function callCommand(
  repoArg: string,
  fnSpec: string | undefined,
  args: string[],
  options: CallOptions
): Promise<void> {
  try {
    // A server decides where its own work runs: refused before any credential is read
    refuseRemoteRack(repoArg, options);
    if (options.ir === undefined && (options.runner !== undefined || options.platform !== undefined)) {
      throw new Error('--runner and --platform say what a function from its IR file runs on: a named function runs on its own runner');
    }
    if (options.ir === undefined && fnSpec === undefined) {
      throw new Error('Name the function to call, as pkg.fn (or fn with -w), or call one from its IR file with --ir <file>');
    }
    // With --ir every positional is an argument
    const positional = options.ir === undefined || fnSpec === undefined ? args : [fnSpec, ...args];
    const spec = options.ir === undefined ? parseFunctionSpec(fnSpec!, options.workspace !== undefined) : undefined;
    // A dataset argument is the workspace's: without one it is refused,
    // before anything is read
    const dataset = positional.findIndex((arg) => arg.startsWith('@'));
    if (dataset !== -1 && options.workspace === undefined) {
      throw new Error(`Argument ${dataset + 1} (${positional[dataset]}) is a dataset, which a call reads from the workspace it runs in: pass -w <ws>`);
    }
    // A draft is laid over a record of the workspace, and a call through the
    // package reads none: it is refused the same way
    const drafts = options.draft ?? [];
    if (drafts.length > 0 && options.workspace === undefined) {
      throw new Error(`A draft (--draft ${drafts[0]}) is laid over a record of the workspace the call runs in: pass -w <ws>`);
    }
    // A function from its IR file reads no record
    if (drafts.length > 0 && options.ir !== undefined) {
      throw new Error(`A draft (--draft ${drafts[0]}) is laid over a record a named function reads: a function from its IR file reads none`);
    }
    const location = await parseRepoLocation(repoArg);
    if (location.type === 'local') {
      const storage = new LocalStorage();
      if (spec === undefined) {
        const program = await irProgram(options.ir!, options.runner, options.platform);
        await callLocal(storage, location.path, program, options.workspace ?? '', options.workspace, positional, drafts, commandBudget(options), options);
      } else {
        const program = await namedProgram(storage, location.path, spec, options.workspace);
        await callLocal(storage, location.path, program, options.workspace ?? program.pkg, options.workspace, positional, drafts, commandBudget(options), options);
      }
    } else {
      refuseRemoteBudget(options);
      if (spec === undefined) {
        await callIrRemote(location.baseUrl, location.repo, location.token, await irProgram(options.ir!, options.runner, options.platform),
          options.workspace, positional, options.output, options.verbose);
      } else {
        await callRemote(location.baseUrl, location.repo, location.token, spec, options.workspace, positional, drafts, options.output, options.verbose);
      }
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
