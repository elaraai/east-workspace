/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 compact command - compact a record's history.
 *
 * Usage:
 *   e3 compact <repo> -w <ws> <record>
 *
 * Writes a `$compact` root commit over the record's current state and swings
 * the ref to it; the prior commit chain becomes unreachable and is reclaimed by
 * GC. The state itself is unchanged. Records are workspace-scoped, so
 * --workspace is required.
 */

import { LocalStorage, recordCompact } from '@elaraai/e3-core';
import { workspaceRecordCompact } from '@elaraai/e3-api-client';
import { parseRepoLocation, formatError, exitError } from '../utils.js';

function actor(): string {
  return `cli:${process.env.USER ?? process.env.USERNAME ?? 'unknown'}`;
}

/** Report a compact outcome (committed / invalid / conflict). */
function renderOutcome(record: string, kind: string, fields: { commitHash?: unknown; message?: unknown; attempts?: unknown }): void {
  if (kind === 'committed') {
    console.log(`Compacted '${record}' → ${String(fields.commitHash)}`);
    return;
  }
  if (kind === 'invalid') exitError(String(fields.message));
  if (kind === 'conflict') exitError(`Compact conflicted after ${String(fields.attempts)} attempts; try again`);
  exitError(`Unexpected compact outcome '${kind}'`);
}

async function compactLocal(repoPath: string, ws: string, record: string): Promise<void> {
  const storage = new LocalStorage();
  const outcome = await recordCompact(storage, repoPath, ws, record, { actor: actor() });
  renderOutcome(record, outcome.kind, outcome as { commitHash?: unknown; message?: unknown; attempts?: unknown });
}

async function compactRemote(baseUrl: string, repo: string, token: string, ws: string, record: string): Promise<void> {
  const result = await workspaceRecordCompact(baseUrl, repo, ws, record, { token });
  renderOutcome(record, result.outcome.type, result.outcome.value as { commitHash?: unknown; message?: unknown; attempts?: unknown });
}

/** `e3 compact` entry point. */
export async function compactCommand(
  repoArg: string,
  record: string,
  options: { workspace?: string },
): Promise<void> {
  try {
    if (!options.workspace) {
      exitError('e3 compact requires --workspace (records hold live workspace state)');
    }
    const location = await parseRepoLocation(repoArg);
    if (location.type === 'local') {
      await compactLocal(location.path, options.workspace, record);
    } else {
      await compactRemote(location.baseUrl, location.repo, location.token, options.workspace, record);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
