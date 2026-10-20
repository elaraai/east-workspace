/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 seed command - commit a record's first state from a beast2 file.
 *
 * Usage:
 *   e3 seed <repo> <record> <file.beast2> -w <ws>
 *
 * A record declared with no initial value (`e3.record(name, type)`) is
 * unassigned until its first state is committed: the deploy writes no commit
 * for it, and its dependents wait as they wait on an unset input. This takes
 * the file in as `e3 dataset set --from-file` takes a delivery in — hashed,
 * its header checked against the record's type, a collection by intake units
 * on the runners, never read whole or modified — and commits what it stored
 * as the record's `$init`, naming the file. A record that holds a state
 * already is refused, before the file is read: a later state is a mutation's.
 * The file is taken in and its state committed under one hold of the
 * repository's running work, so no sweep takes what the intake stored before
 * the commit names it. Local repositories only: a server's host commits a
 * record's first state through its own intake. Records are workspace-scoped,
 * so --workspace is required.
 */

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { StringType, encodeBeast2For } from '@elaraai/east';
import {
  LocalStorage,
  LocalTaskRunner,
  objectAdoptFile,
  recordSystemCommit,
  resolveRecord,
  withRunningWork,
  type MutationOutcome,
  type ObjectAdoptResult,
} from '@elaraai/e3-core';
import { actor, parseRepoLocation, formatError, exitError } from '../utils.js';
import { formatSize } from '../format.js';
import { createProgress } from '../progress.js';
import { intakeReporter } from '../intake.js';
import { commandBudget, type BudgetFlags } from './budget.js';

const encodeString = encodeBeast2For(StringType);

/** Report the commit's outcome: the commit, or why nothing was written. */
function renderOutcome(record: string, file: string, outcome: MutationOutcome): void {
  if (outcome.kind === 'committed') {
    console.log(`Seeded '${record}' from ${file} → ${outcome.commitHash}`);
    return;
  }
  if (outcome.kind === 'invalid') exitError(outcome.message);
  if (outcome.kind === 'conflict') exitError(`Seeding '${record}' conflicted after ${outcome.attempts} attempts: another write got there first; read its history`);
  // An index build failed, or timed out: the program's stderr says why, and
  // reaches the operator before the exit.
  const stderr = outcome.stderr;
  if (stderr.trim()) {
    process.stderr.write(stderr);
    if (!stderr.endsWith('\n')) process.stderr.write('\n');
  }
  if (outcome.kind === 'failed') exitError(`Building the indexes of '${record}' failed (exit code ${outcome.exitCode})`);
  exitError(`Building the indexes of '${record}' timed out after ${outcome.ms}ms`);
}

/** `e3 seed` entry point. */
export async function seedCommand(
  repoArg: string,
  record: string,
  file: string,
  options: BudgetFlags & { workspace?: string },
): Promise<void> {
  try {
    if (!options.workspace) {
      exitError('e3 seed requires --workspace (records hold live workspace state)');
    }
    const ws = options.workspace;
    const location = await parseRepoLocation(repoArg);
    if (location.type === 'remote') {
      exitError("e3 seed takes a local repository: a server's host commits a record's first state through its own intake");
    }
    const storage = new LocalStorage();
    const resolved = await resolveRecord(storage, location.path, ws, record);
    if (!resolved) exitError(`Record '${record}' not found in workspace '${ws}'`);
    // A record that holds a state already is refused before the file is
    // read, not after it has been taken in: the commit would refuse it then
    const held = await storage.datasets.read(location.path, ws, resolved.refPath);
    if (held !== null && held.type === 'value') {
      const head = held.value.versions.get(resolved.selfKeypath);
      exitError(`Record '${record}' has a state already${head !== undefined ? `, its head ${head}` : ''}: a later state is a mutation's`);
    }
    const runner = new LocalTaskRunner(location.path, commandBudget(options));
    const path = resolve(file);

    // The file is taken in as a delivery is, saying how far it has got: a
    // collection by intake units on the runners, any other value as the
    // object the file is. Its segments are stored before anything names them,
    // and the commit is what names them, so the repository's running work is
    // held across both: a sweep between the two could take the segments
    // before the commit roots them.
    const intake = intakeReporter(createProgress());
    const sources = { count: 1, bytes: (await stat(path)).size };
    const { adopted, outcome } = await withRunningWork(storage, location.path, async () => {
      let adopted: ObjectAdoptResult;
      try {
        adopted = await objectAdoptFile(storage, location.path, path, {
          declared: { subject: `record '${record}'`, type: resolved.type },
          runner,
          onProgress: (progress) => intake.report({ path: resolved.refPath, file: path, sources, ...progress }),
        });
      } catch (err) {
        intake.fail();
        throw err;
      }
      intake.report({
        path: resolved.refPath, file: path, sources, phase: 'done', bytes: adopted.size, total: adopted.size, taken: adopted.taken,
        ...(adopted.runners !== undefined && { runners: adopted.runners }),
        ...(adopted.fallback !== undefined && { fallback: adopted.fallback }),
      });

      // The record's first state: at the package's type, so the whole
      // declared chain counts as applied, as a deploy's mint counts it.
      const outcome = await recordSystemCommit(storage, runner, location.path, ws, record, {
        name: '$init',
        target: { state: adopted.hash, applied: resolved.migrations.map((step) => step.name) },
        actor: actor(),
        args: [encodeString(path)],
      });
      return { adopted, outcome };
    });
    renderOutcome(record, file, outcome);
    if (outcome.kind === 'committed') {
      console.log(`State:  ${outcome.stateHash}`);
      console.log(`Size:   ${formatSize(adopted.size)}`);
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
