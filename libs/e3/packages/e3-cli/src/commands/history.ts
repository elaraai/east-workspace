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
import { workspaceRecordHistory } from '@elaraai/e3-api-client';
import { parseRepoLocation, formatError, exitError } from '../utils.js';

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
  const result = await workspaceRecordHistory(baseUrl, repo, ws, record, limit, { token }, from);
  printCommits(result.commits.map((c) => ({
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
