/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 history command - show a record's commit history (newest first).
 *
 * Usage:
 *   e3 history <repo> -w <ws> <record> [--limit N] [--delta]
 *
 * Each line is one commit: short hash, mutation name, actor, and its time as
 * East prints a DateTime. A load's commit (`$load:<source>`) says beside it
 * what it loaded: its delivery, the time it says its data is as of, and what
 * it did to the source's entries, read from the commit's arguments, a few
 * commits' at a time; one whose arguments cannot be read is printed without
 * them. With `--delta`, each
 * commit that wrote one is followed by what it changed — per target, counted
 * by op — which is the audit question history is usually asked and which no
 * pair of state hashes answers. Records are workspace-scoped, so --workspace
 * is required.
 */

import { DateTimeType, printFor } from '@elaraai/east';
import { LocalStorage, OBJECT_CONCURRENCY, eachAtMost, loadCommitArgs, recordHistory, summarizeDelta } from '@elaraai/e3-core';
import { objectGet, workspaceRecordHistory, type RecordHistoryResult } from '@elaraai/e3-api-client';
import { loadCommitSource } from '@elaraai/e3-types';
import { parseRepoLocation, formatError, exitError } from '../utils.js';
import { loadWords } from './load.js';

/** One request for a record's history: the commits from `from`, or from the
 *  head when it is undefined, up to `limit`, or as many as the server answers
 *  a request that names none with. */
export type HistoryPage = (limit: number | undefined, from: string | undefined) => Promise<RecordHistoryResult>;

/**
 * A record's commits over the API, newest first.
 *
 * @remarks
 * A host may answer a request that names no limit with one page of the chain
 * (e3-api-server's `historyLimit`), so asked for the whole chain, this walks
 * the pages to its end, each from the last commit's parent. Asked for a
 * limit, it makes the one request. The walk ends where the chain does: at its
 * root, at a page the server answers empty, as it answers a link it cannot
 * read, or before a commit already returned, where a damaged chain loops.
 *
 * @param page - Makes one request
 * @param limit - The most commits to return; the whole chain when undefined
 * @param from - The commit to start at; the head when undefined
 * @returns The commits, newest first, each once
 */
export async function remoteHistory(
  page: HistoryPage,
  limit: number | undefined,
  from: string | undefined,
): Promise<RecordHistoryResult['commits']> {
  const commits: RecordHistoryResult['commits'] = [];
  const seen = new Set<string>();
  let next = from;
  for (;;) {
    const answered = (await page(limit, next)).commits;
    for (const commit of answered) {
      if (seen.has(commit.hash)) return commits;
      seen.add(commit.hash);
      commits.push(commit);
    }
    const last = answered.at(-1);
    if (limit !== undefined || last === undefined || last.parent.type !== 'some') return commits;
    next = last.parent.value;
  }
}

/** A commit, as its line prints it. */
export interface CommitLine {
  hash: string;
  mutation: string;
  actor: string;
  at: Date;
  /** What a load's commit loaded, in words. */
  loaded?: string;
  /** One line per target the commit's delta touched, already rendered. */
  delta?: string[];
}

const printAt = printFor(DateTimeType);

/**
 * A commit's line: its hash cut short, its mutation, its actor, its time as
 * East prints a DateTime, and beside them what a load's commit loaded.
 *
 * @param commit - The commit
 * @returns The line
 */
export function commitLine(commit: CommitLine): string {
  const loaded = commit.loaded === undefined ? '' : `  ${commit.loaded}`;
  return `${commit.hash.slice(0, 12)}  ${commit.mutation.padEnd(18)}  ${commit.actor.padEnd(16)}  ${printAt(commit.at)}${loaded}`;
}

function printCommits(commits: CommitLine[]): void {
  if (commits.length === 0) {
    console.log('(no history)');
    return;
  }
  for (const c of commits) {
    console.log(commitLine(c));
    for (const line of c.delta ?? []) console.log(`                ${line}`);
  }
}

/**
 * What each load's commit among `commits` loaded, in words, by the commit's
 * hash, read from its arguments' object.
 *
 * @remarks
 * A long chain holds a load's commit for every delivery, so their arguments
 * are read a few at a time (`OBJECT_CONCURRENCY`), never all at once. A
 * commit whose arguments cannot be read — the store holds them no more, or a
 * request for them fails — is left out, and printed without its load's
 * words: the history is the commits', and stands without them.
 *
 * @param commits - The commits: each one's hash, its name, and the hash of
 *   its arguments' object when it has arguments
 * @param read - Reads an object by its hash
 * @returns The words of each load's commit whose arguments were read
 */
export async function loadsWords(
  commits: ReadonlyArray<{ readonly hash: string; readonly mutation: string; readonly args: string | undefined }>,
  read: (hash: string) => Promise<Uint8Array>,
): Promise<Map<string, string>> {
  const words = new Map<string, string>();
  const loads = commits.filter((commit) => loadCommitSource(commit.mutation) !== null && commit.args !== undefined);
  await eachAtMost(loads, OBJECT_CONCURRENCY, async (commit) => {
    let loaded: ReturnType<typeof loadCommitArgs>;
    try {
      loaded = loadCommitArgs(await read(commit.args!));
    } catch {
      return;
    }
    if (loaded !== null) words.set(commit.hash, loadWords(loaded));
  });
  return words;
}

async function historyLocal(
  repoPath: string, ws: string, record: string,
  limit: number | undefined, from: string | undefined, delta: boolean,
): Promise<void> {
  const storage = new LocalStorage();
  const entries = await recordHistory(storage, repoPath, ws, record, { limit, from });
  const words = await loadsWords(
    entries.map((e) => ({ hash: e.hash, mutation: e.commit.mutation, args: e.commit.args.type === 'some' ? e.commit.args.value : undefined })),
    (hash) => storage.objects.read(repoPath, hash));
  const lines: CommitLine[] = [];
  for (const e of entries) {
    const line: CommitLine = { hash: e.hash, mutation: e.commit.mutation, actor: e.commit.actor, at: e.commit.at };
    const loaded = words.get(e.hash);
    if (loaded !== undefined) line.loaded = loaded;
    if (delta && e.commit.delta.type === 'some') {
      // A summary's arm adds to its totals (#1039): counted as changes, `±`.
      line.delta = (await summarizeDelta(storage, repoPath, e.commit.delta.value)).map((arm) =>
        arm.add > 0 ? `${arm.target.padEnd(18)}  ±${arm.add}` : `${arm.target.padEnd(18)}  +${arm.insert}  ~${arm.update}  -${arm.delete}`);
    }
    lines.push(line);
  }
  printCommits(lines);
}

async function historyRemote(
  baseUrl: string, repo: string, token: string, ws: string, record: string,
  limit: number | undefined, from: string | undefined, delta: boolean,
): Promise<void> {
  const commits = await remoteHistory(
    (pageLimit, pageFrom) => workspaceRecordHistory(baseUrl, repo, ws, record, pageLimit, { token }, pageFrom), limit, from);
  // A load's arguments are read whole by their hash: their preview is cut short
  const words = await loadsWords(
    commits.map((c) => ({ hash: c.hash, mutation: c.mutation, args: c.args.type === 'some' ? c.args.value.hash : undefined })),
    (hash) => objectGet(baseUrl, repo, hash, { token }));
  printCommits(commits.map((c): CommitLine => {
    const loaded = words.get(c.hash);
    return {
      hash: c.hash,
      mutation: c.mutation,
      actor: c.actor,
      at: c.at,
      ...(loaded !== undefined && { loaded }),
      // Counting a delta's ops means reading its segments, which is a local
      // store's job; over the API the commit names it and no more.
      ...(delta && c.delta.type === 'some' && { delta: [`delta ${c.delta.value.slice(0, 12)}`] }),
    };
  }));
}

/** `e3 history` entry point. */
export async function historyCommand(
  repoArg: string,
  record: string,
  options: { workspace?: string; limit?: string; from?: string; delta?: boolean },
): Promise<void> {
  try {
    if (!options.workspace) {
      exitError('e3 history requires --workspace (records hold live workspace state)');
    }
    let limit: number | undefined;
    if (options.limit !== undefined) {
      const parsed = Number(options.limit);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        exitError(`Invalid --limit '${options.limit}'`);
      }
      limit = parsed;
    }
    const location = await parseRepoLocation(repoArg);
    if (location.type === 'local') {
      await historyLocal(location.path, options.workspace, record, limit, options.from, options.delta === true);
    } else {
      await historyRemote(location.baseUrl, location.repo, location.token, options.workspace, record, limit, options.from, options.delta === true);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
