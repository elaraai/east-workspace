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
 * Each line is one commit: short hash, mutation name, actor, and timestamp.
 * With `--delta`, each commit that wrote one is followed by what it changed —
 * per target, counted by op — which is the audit question history is usually
 * asked and which no pair of state hashes answers. Records are
 * workspace-scoped, so --workspace is required.
 */

import { LocalStorage, recordHistory, summarizeDelta } from '@elaraai/e3-core';
import { workspaceRecordHistory, type RecordHistoryResult } from '@elaraai/e3-api-client';
import { parseRepoLocation, formatError, exitError } from '../utils.js';

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

interface CommitLine {
  hash: string;
  mutation: string;
  actor: string;
  at: Date;
  /** One line per target the commit's delta touched, already rendered. */
  delta?: string[];
}

function printCommits(commits: CommitLine[]): void {
  if (commits.length === 0) {
    console.log('(no history)');
    return;
  }
  for (const c of commits) {
    console.log(`${c.hash.slice(0, 12)}  ${c.mutation.padEnd(18)}  ${c.actor.padEnd(16)}  ${c.at.toISOString()}`);
    for (const line of c.delta ?? []) console.log(`                ${line}`);
  }
}

async function historyLocal(
  repoPath: string, ws: string, record: string,
  limit: number | undefined, from: string | undefined, delta: boolean,
): Promise<void> {
  const storage = new LocalStorage();
  const entries = await recordHistory(storage, repoPath, ws, record, { limit, from });
  const lines: CommitLine[] = [];
  for (const e of entries) {
    const line: CommitLine = { hash: e.hash, mutation: e.commit.mutation, actor: e.commit.actor, at: e.commit.at };
    if (delta && e.commit.delta.type === 'some') {
      line.delta = (await summarizeDelta(storage, repoPath, e.commit.delta.value)).map((arm) =>
        `${arm.target.padEnd(18)}  +${arm.insert}  ~${arm.update}  -${arm.delete}`);
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
  printCommits(commits.map((c) => ({
    hash: c.hash,
    mutation: c.mutation,
    actor: c.actor,
    at: c.at,
    // Counting a delta's ops means reading its segments, which is a local
    // store's job; over the API the commit names it and no more.
    ...(delta && c.delta.type === 'some' && { delta: [`delta ${c.delta.value.slice(0, 12)}`] }),
  })));
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
