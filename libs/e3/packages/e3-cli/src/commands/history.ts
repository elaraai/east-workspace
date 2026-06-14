/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 history command - show a record's commit history (newest first).
 *
 * Usage:
 *   e3 history <repo> -w <ws> <record> [--limit N]
 *
 * Each line is one commit: short hash, mutation name, actor, and timestamp.
 * Records are workspace-scoped, so --workspace is required.
 */

import { LocalStorage, recordHistory } from '@elaraai/e3-core';
import { workspaceRecordHistory } from '@elaraai/e3-api-client';
import { parseRepoLocation, formatError, exitError } from '../utils.js';

interface CommitLine {
  hash: string;
  mutation: string;
  actor: string;
  at: Date;
}

function printCommits(commits: CommitLine[]): void {
  if (commits.length === 0) {
    console.log('(no history)');
    return;
  }
  for (const c of commits) {
    console.log(`${c.hash.slice(0, 12)}  ${c.mutation.padEnd(18)}  ${c.actor.padEnd(16)}  ${c.at.toISOString()}`);
  }
}

async function historyLocal(repoPath: string, ws: string, record: string, limit: number | undefined): Promise<void> {
  const storage = new LocalStorage();
  const entries = await recordHistory(storage, repoPath, ws, record, { limit });
  printCommits(entries.map((e) => ({ hash: e.hash, mutation: e.commit.mutation, actor: e.commit.actor, at: e.commit.at })));
}

async function historyRemote(baseUrl: string, repo: string, token: string, ws: string, record: string, limit: number | undefined): Promise<void> {
  const result = await workspaceRecordHistory(baseUrl, repo, ws, record, limit, { token });
  printCommits(result.commits.map((c) => ({ hash: c.hash, mutation: c.mutation, actor: c.actor, at: c.at })));
}

/** `e3 history` entry point. */
export async function historyCommand(
  repoArg: string,
  record: string,
  options: { workspace?: string; limit?: string },
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
      await historyLocal(location.path, options.workspace, record, limit);
    } else {
      await historyRemote(location.baseUrl, location.repo, location.token, options.workspace, record, limit);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
