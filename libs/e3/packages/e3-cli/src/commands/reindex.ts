/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 reindex command — rebuild a record's secondary indexes from its primary.
 *
 * Usage:
 *   e3 reindex <repo> -w <ws> <record> [--index <name>]
 *
 * An index is derived state, so this never loses anything and is always
 * available: it is the exit when an index function turns out to be wrong (fix
 * the function, redeploy, and the deploy plan rebuilds it), and it is what
 * proves a maintained index is the one a rebuild writes — the two must agree
 * byte for byte. The record's primary is untouched; only the index manifests
 * move, under a `$reindex` commit so the audit chain records that they did.
 *
 * Records are workspace-scoped, so --workspace is required.
 */

import { LocalStorage, LocalTaskRunner, recordReindex } from '@elaraai/e3-core';
import { parseRepoLocation, formatError, exitError } from '../utils.js';

function actor(): string {
  return `cli:${process.env.USER ?? process.env.USERNAME ?? 'unknown'}`;
}

/** `e3 reindex` entry point. */
export async function reindexCommand(
  repoArg: string,
  record: string,
  options: { workspace?: string; index?: string; verbose?: boolean },
): Promise<void> {
  try {
    if (!options.workspace) {
      exitError('e3 reindex requires --workspace (records hold live workspace state)');
    }
    const location = await parseRepoLocation(repoArg);
    if (location.type !== 'local') {
      exitError(
        'e3 reindex runs where the record is: point it at the repository path on the server, '
        + 'or redeploy the package, which rebuilds every index whose declaration changed.',
      );
      return;
    }

    const storage = new LocalStorage();
    const outcome = await recordReindex(
      storage, new LocalTaskRunner(location.path), location.path, options.workspace, record,
      {
        actor: actor(),
        ...(options.index !== undefined && { index: options.index }),
        ...(options.verbose !== undefined && { verbose: options.verbose }),
      },
    );

    const what = options.index === undefined ? "every index of" : `index '${options.index}' of`;
    switch (outcome.kind) {
      case 'committed':
        console.log(`Rebuilt ${what} '${record}' → ${outcome.commitHash}`);
        return;
      case 'invalid':
        exitError(outcome.message);
        return;
      case 'conflict':
        exitError(`Reindex conflicted after ${outcome.attempts} attempts; try again`);
        return;
      case 'failed':
        exitError(`An index build failed (exit ${outcome.exitCode})\n${outcome.stderr}`);
        return;
      case 'timed_out':
        exitError(`An index build exceeded ${outcome.ms} ms\n${outcome.stderr}`);
        return;
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
