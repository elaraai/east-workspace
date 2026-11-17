/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 load command - load a delivery into an external source of a composite
 * record.
 *
 * Usage:
 *   e3 load <repo> <record>.<source> <delivery> -w <ws> [--as-of <time>]
 *
 * The delivery is `#<hash>`, a value the repository holds, or a .beast2 file of
 * the source's delivery type: its header checked against that type, and stored
 * as the object it is, never read whole or modified — by link into a local
 * repository, and to a server by the upload that writes no ref. The load then
 * takes it in, runs its pieces and commits once, as `$load:<source>`: in this
 * process for a local repository, and as a job the command follows on a
 * server. It answers what it did: the delivery loaded, with its counts; the
 * source's last delivery again, which runs nothing; or a delivery older than
 * the source's, superseded, which runs nothing and exits 0.
 *
 * A source the dataflow loads from its feed is refused before anything is
 * stored or sent, naming the run that loads it. Ctrl-C cancels the load: one
 * stopped before its commit wrote has loaded nothing, and the command exits
 * 130; once its commit has written, the load has landed, and the command says
 * what it did. A second Ctrl-C stops following a load a server runs.
 */

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  DateTimeType, East, IntegerType, StringType, equalFor, lessFor, none, parseFor, printFor, some,
} from '@elaraai/east';
import { readDatasetFileHeader } from '@elaraai/e3';
import {
  RecordLoadProgressType, pathToString, type IntakeFile, type RecordLoadProgress, type RecordLoadResult,
} from '@elaraai/e3-types';
import { LocalStorage, LocalTaskRunner, RecordLoadStoppedError, recordDescribe, recordLoad, withRunningWork, type Budget } from '@elaraai/e3-core';
import { objectUpload, workspaceRecordDescribe, workspaceRecordLoad, type RecordSignature, type RequestOptions } from '@elaraai/e3-api-client';
import { actor, exitError, formatError, parseRepoLocation } from '../utils.js';
import { getValidToken } from '../credentials.js';
import { fileTransferSource } from '../file-transfer-source.js';
import { createProgress } from '../progress.js';
import { hashDelivery } from '../intake.js';
import { commandBudget, refuseRemoteBudget, type BudgetFlags } from './budget.js';
import { parseRecordSpec } from './mutation-spec.js';

const parseTime = parseFor(DateTimeType);
const printTime = printFor(DateTimeType);
const printInteger = printFor(IntegerType);
const below = lessFor(IntegerType);
const sameName = equalFor(StringType);
const sameStep = equalFor(RecordLoadProgressType);

/** How much of a commit's hash a line prints, as `e3 history` prints it. */
const COMMIT_WIDTH = 12;

/** A count as East prints one, its thousands marked: `1,204`. */
let printCount: ((n: bigint) => string) | undefined;
function counted(n: bigint): string {
  printCount ??= East.compile(East.function([IntegerType], StringType, (_$, count) => East.Integer.printCommaSeperated(count)), []);
  return printCount(n);
}

/** A delivery as the command line names it: a value the repository holds, by its hash, or a file. */
export type Delivery =
  | { readonly kind: 'stored'; readonly hash: string }
  | { readonly kind: 'file'; readonly file: string };

/**
 * The delivery an argument names: `#<hash>` for a value the repository holds,
 * and any other argument a file.
 *
 * @param arg - The argument as written
 * @returns The delivery, a file's path resolved
 * @throws {Error} When a `#` names no SHA-256
 */
export function parseDelivery(arg: string): Delivery {
  if (!arg.startsWith('#')) return { kind: 'file', file: resolve(arg) };
  const hash = arg.slice(1);
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`a delivery the repository holds is named #<hash>, its SHA-256 in 64 lowercase hex digits: got '${arg}'`);
  }
  return { kind: 'stored', hash };
}

/**
 * The time `--as-of` names, read as East reads a DateTime: `2026-11-02T03:00:00`,
 * in UTC.
 *
 * @param text - The option's value
 * @returns The time
 * @throws {Error} When East reads no time in it, naming the form it takes
 */
export function parseAsOf(text: string): Date {
  const parsed = parseTime(text);
  if (!parsed.success) throw new Error(`--as-of takes a time as East writes one, such as 2026-11-02T03:00:00 (UTC): ${parsed.error}`);
  return parsed.value;
}

/**
 * Why `e3 load` refuses a source the dataflow loads from its feed: it names
 * the feed, and the run that loads the source.
 *
 * @param repo - The repository, as the command was given it
 * @param ws - The workspace
 * @param record - The record
 * @param source - The source
 * @param feed - The dataset the source is fed by, as a path
 * @returns The refusal's words
 */
export function fedRefusal(repo: string, ws: string, record: string, source: string, feed: string): string {
  return `${record}.${source} is fed by ${feed}, and the dataflow loads it: e3 dataflow run ${repo} ${ws} --filter ${record}.${source}`;
}

/**
 * What `e3 load` prints of what a load did (§4.3).
 *
 * @param name - The load, `<record>.<source>`
 * @param result - What it did
 * @param asOf - The time the delivery says its data is as of, when it says one
 * @returns The line
 */
export function resultLine(name: string, result: RecordLoadResult, asOf: Date | undefined): string {
  const at = (commit: string): string => commit.slice(0, COMMIT_WIDTH);
  switch (result.outcome.type) {
    case 'loaded': {
      const commit = result.commit.type === 'some' ? ` at ${at(result.commit.value)}` : '';
      const when = asOf === undefined ? '' : `, as of ${printTime(asOf)}`;
      return `Loaded ${name}${commit}${when}: ${counted(result.set)} set, ${counted(result.deleted)} deleted, ${counted(result.unchanged)} unchanged`;
    }
    case 'again':
      return `${name} already holds this delivery${result.commit.type === 'some' ? `, loaded at ${at(result.commit.value)}` : ''}`;
    case 'superseded': {
      const mine = asOf === undefined ? '' : `, later than this one's ${printTime(asOf)}`;
      return `${name} holds a delivery as of ${printTime(result.outcome.value)}${mine}: nothing loaded (superseded)`;
    }
  }
}

/** Where a load's lines go. */
export interface LoadPrinter {
  /** Prints a settled line. */
  line(text: string): void;
  /** Shows a line as it counts up: drawn in place on a terminal, and nowhere
   *  else, since the line it settles to is printed when it settles. */
  live(text: string): void;
}

/**
 * The printer of a command's output: each settled line, and on a terminal the
 * line that counts up in place before it settles.
 *
 * @param stream - Where the lines go (default the standard output)
 * @returns The printer
 */
export function terminalPrinter(stream: { write(chunk: string): unknown; isTTY?: boolean | undefined } = process.stdout): LoadPrinter {
  const tty = stream.isTTY === true;
  let drawn = false;
  return {
    line(text) {
      stream.write(`${drawn ? '\r\x1b[K' : ''}${text}\n`);
      drawn = false;
    },
    live(text) {
      if (!tty) return;
      stream.write(`\r\x1b[K${text}`);
      drawn = true;
    },
  };
}

/** What a load prints as it goes. */
export interface LoadLines {
  /** Hears a step the load reports. */
  progress(step: RecordLoadProgress): void;
  /** Settles the line in flight: the load has ended. */
  end(): void;
}

/** The line a load's pieces settle to: how many are done, and how many of those the cache answered. */
function piecesLine(pieces: { done: bigint; total: bigint; cached: bigint }): string {
  const cached = below(0n, pieces.cached) ? ` (${printInteger(pieces.cached)} from the cache)` : '';
  return `Pieces ${printInteger(pieces.done)}/${printInteger(pieces.total)}${cached}`;
}

/** The intake's line as it counts up: the pieces of the delivery taken in, when it has several. */
function intakeLive(intake: IntakeFile): string {
  const step = intake.step;
  return step.type === 'taking_in' && below(1n, step.value.pieces)
    ? `Taking the delivery in… ${printInteger(step.value.done)}/${printInteger(step.value.pieces)} pieces`
    : 'Taking the delivery in…';
}

/**
 * The lines a load prints as it reports its steps (§7.13): that it waits for
 * an earlier load of its source; `Taking the delivery in… done`; its pieces,
 * counting up in place on a terminal and printed once they settle, stop or
 * restart, with how many the cache answered; why it loads again; and what
 * stopped it.
 *
 * @remarks
 * A step heard again as it was — a server's job is polled, and answers how
 * far it has got each time — prints nothing more.
 *
 * @param name - The load, `<record>.<source>`
 * @param printer - Where the lines go
 * @returns The lines' listener
 */
export function loadLines(name: string, printer: LoadPrinter): LoadLines {
  // The line in flight, printed when the load goes on to another step
  let open: { readonly kind: 'intake' | 'pieces'; readonly text: string } | null = null;
  let last: RecordLoadProgress | null = null;
  const settle = (): void => {
    if (open !== null) printer.line(open.text);
    open = null;
  };
  const opening = (kind: 'intake' | 'pieces'): void => {
    if (open !== null && open.kind !== kind) settle();
  };
  return {
    progress(step) {
      if (last !== null && sameStep(last, step)) return;
      last = step;
      switch (step.type) {
        case 'queued':
          settle();
          printer.line(`Waiting for an earlier load of ${name} to finish…`);
          return;
        case 'intake':
          opening('intake');
          open = { kind: 'intake', text: 'Taking the delivery in… done' };
          printer.live(intakeLive(step.value));
          return;
        case 'pieces':
          opening('pieces');
          open = { kind: 'pieces', text: piecesLine(step.value) };
          printer.live(open.text);
          return;
        case 'restarted':
          settle();
          printer.line(`Loading again: ${step.value}`);
          return;
        case 'stopped':
          settle();
          printer.line(`Stopped: ${step.value}`);
          return;
        case 'commit':
          // The answer's line follows it
          settle();
          return;
      }
    },
    end: settle,
  };
}

/** A load, as the command was asked for it. */
interface LoadAsked {
  readonly ws: string;
  readonly record: string;
  readonly source: string;
  readonly delivery: Delivery;
  readonly asOf: Date | undefined;
  readonly signal: AbortSignal;
  readonly onProgress: (step: RecordLoadProgress) => void;
  /** Hears that the load is launched: a signal after this cancels the load,
   *  where one before ends the command. */
  readonly launched: () => void;
}

/**
 * Refuses, before a delivery is stored or sent, what the record's description
 * rules out: a source the dataflow loads from its feed, and a file of a type
 * other than the source's delivery's. A record or source no delivery is loaded
 * into is the load's to refuse, in its words.
 *
 * @param repoArg - The repository, as the command was given it
 * @param asked - The load
 * @param signature - The record's description, or `null` when the workspace
 *   holds no such record
 */
function checkSource(repoArg: string, asked: LoadAsked, signature: RecordSignature | null): void {
  const info = signature?.sources.find((each) => sameName(each.name, asked.source));
  if (info === undefined) return;
  if (info.feed.type === 'some') throw new Error(fedRefusal(repoArg, asked.ws, asked.record, asked.source, pathToString(info.feed.value)));
  if (asked.delivery.kind === 'file' && info.delivery.type === 'some') {
    readDatasetFileHeader(asked.delivery.file, `source '${asked.source}' of record '${asked.record}'`, info.delivery.value);
  }
}

/**
 * A load into a local repository, in this process. A file is stored as the
 * object it is, by link, and loaded, under one hold of the repository's
 * running work: a sweep between the two could take the object before the load
 * re-references it.
 */
async function loadLocal(repoPath: string, repoArg: string, asked: LoadAsked, budget: Budget): Promise<RecordLoadResult> {
  const storage = new LocalStorage();
  checkSource(repoArg, asked, await recordDescribe(storage, repoPath, asked.ws, asked.record));
  const runner = new LocalTaskRunner(repoPath, budget);
  const run = (delivery: string): Promise<RecordLoadResult> => {
    asked.launched();
    return recordLoad(storage, runner, repoPath, asked.ws, asked.record, asked.source, delivery, {
      actor: actor(),
      ...(asked.asOf !== undefined && { asOf: asked.asOf }),
      onProgress: asked.onProgress,
      signal: asked.signal,
    });
  };
  const delivery = asked.delivery;
  if (delivery.kind === 'stored') return run(delivery.hash);
  return withRunningWork(storage, repoPath, async () => run((await storage.objects.adoptFile(repoPath, delivery.file)).hash));
}

/**
 * A server's `fetch` that sends each request with the token as it stands then:
 * a load followed for hours outlives the token it began with, which
 * `getValidToken` refreshes as it nears its expiry. A request that carries no
 * credentials — a part's upload, whose URL may be presigned — goes as it is.
 */
function freshTokenFetch(baseUrl: string): typeof globalThis.fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.has('Authorization')) headers.set('Authorization', `Bearer ${await getValidToken(baseUrl)}`);
    return globalThis.fetch(input, { ...init, headers });
  };
}

/** Uploads a delivery's file as an object, its line saying how far the hash has got; answers its hash. */
async function uploadDelivery(baseUrl: string, repo: string, ws: string, file: string, opts: RequestOptions): Promise<string> {
  const { size } = await stat(file);
  const step = createProgress().step(`uploading the delivery from ${file}`);
  try {
    const hash = await hashDelivery(file, size, file, step);
    step.update(`uploading the delivery from ${file}`);
    await objectUpload(baseUrl, repo, ws, fileTransferSource(file, size, hash), opts);
    step.done(`uploaded the delivery from ${file}`);
    return hash;
  } catch (err) {
    step.fail();
    throw err;
  }
}

/** A load into a repository a server holds: a file uploaded as an object, then the load's job followed. */
async function loadRemote(baseUrl: string, repo: string, token: string, repoArg: string, asked: LoadAsked): Promise<RecordLoadResult> {
  const opts: RequestOptions = { token, fetch: freshTokenFetch(baseUrl) };
  checkSource(repoArg, asked, await workspaceRecordDescribe(baseUrl, repo, asked.ws, asked.record, opts));
  const delivery = asked.delivery.kind === 'stored' ? asked.delivery.hash : await uploadDelivery(baseUrl, repo, asked.ws, asked.delivery.file, opts);
  asked.launched();
  return workspaceRecordLoad(baseUrl, repo, asked.ws, asked.record, asked.source, {
    delivery, actor: some(actor()), asOf: asked.asOf === undefined ? none : some(asked.asOf),
  }, opts, { onProgress: asked.onProgress, signal: asked.signal });
}

/** `e3 load` entry point. */
export async function loadCommand(
  repoArg: string,
  spec: string,
  deliveryArg: string,
  options: BudgetFlags & { workspace?: string; asOf?: string },
): Promise<void> {
  // A signal before the load is launched ends the command: nothing was asked
  // of a server, or loaded. Once it is, the first asks it to cancel, and the
  // command follows it to the end it comes to; a second stops following.
  const controller = new AbortController();
  let launched = false;
  const onSignal = (): void => {
    if (!launched) {
      console.log('');
      console.log('Cancelled: nothing loaded.');
      process.exit(130);
    }
    if (controller.signal.aborted) {
      console.log('Stopped following the load.');
      process.exit(130);
    }
    console.log('');
    console.log('Cancelling the load…');
    controller.abort();
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  for (const signal of signals) process.on(signal, onSignal);

  let lines: LoadLines | undefined;
  try {
    if (!options.workspace) exitError('e3 load requires --workspace (records hold live workspace state)');
    const { record, name: source } = parseRecordSpec(spec, 'source');
    const name = `${record}.${source}`;
    const asked: LoadAsked = {
      ws: options.workspace,
      record,
      source,
      delivery: parseDelivery(deliveryArg),
      asOf: options.asOf === undefined ? undefined : parseAsOf(options.asOf),
      signal: controller.signal,
      onProgress: (step) => lines?.progress(step),
      launched: () => { launched = true; },
    };
    lines = loadLines(name, terminalPrinter());
    const location = await parseRepoLocation(repoArg);
    let result: RecordLoadResult;
    if (location.type === 'local') {
      result = await loadLocal(location.path, repoArg, asked, commandBudget(options));
    } else {
      refuseRemoteBudget(options);
      result = await loadRemote(location.baseUrl, location.repo, location.token, repoArg, asked);
    }
    lines.end();
    console.log(resultLine(name, result, asked.asOf));
  } catch (err) {
    lines?.end();
    // Stopped before its commit wrote: in this process, or by its job
    if (controller.signal.aborted && (err instanceof RecordLoadStoppedError || err === controller.signal.reason)) {
      console.log('Cancelled: nothing loaded.');
      process.exit(130);
    }
    exitError(formatError(err));
  } finally {
    for (const signal of signals) process.off(signal, onSignal);
  }
}
