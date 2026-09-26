/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 run command - Ad-hoc task execution
 *
 * Usage:
 *   e3 run . acme-forecast/train ./sales.beast2 -o ./model.beast2
 *   e3 run . my-pkg@1.0.0/process ./input1.beast2 ./input2.beast2 -o ./output.beast2
 *   e3 run . my-pkg/task ./data.beast2 -o ./out.beast2 --force
 */

import { readFile, writeFile } from 'fs/promises';
import {
  packageRead,
  objectWrite,
  objectRead,
  taskExecute,
  LocalStorage,
  TASKS_LOCK,
} from '@elaraai/e3-core';
import { decodeBeast2, variant } from '@elaraai/east';
import { resolveRepo, parsePackageSpec, formatError, exitError, shortHash } from '../utils.js';
import { commandBudget, type BudgetFlags } from './budget.js';

/**
 * Parse task specifier: `pkg.task` or `pkg@version.task`.
 *
 * The task name is the segment after the last `.`. Everything before is the
 * package ref (with optional `@version`). Scoped names containing a `.` in
 * the package or task portion are not supported.
 */
export function parseTaskSpec(spec: string): { name: string; version: string; task: string } {
  const dotIndex = spec.lastIndexOf('.');
  if (dotIndex === -1) {
    throw new Error(
      `Invalid task specifier: '${spec}'. Expected format: pkg.task or pkg@version.task`,
    );
  }

  const pkgPart = spec.slice(0, dotIndex);
  const task = spec.slice(dotIndex + 1);

  if (!pkgPart) {
    throw new Error(`Invalid task specifier: '${spec}'. Package name cannot be empty.`);
  }
  if (!task) {
    throw new Error(`Invalid task specifier: '${spec}'. Task name cannot be empty.`);
  }

  const { name, version } = parsePackageSpec(pkgPart);
  return { name, version, task };
}

/**
 * Run a task ad-hoc with file inputs and output.
 */
export async function runCommand(
  repoArg: string,
  taskSpec: string,
  inputs: string[],
  options: BudgetFlags & { output?: string; force?: boolean; verbose?: boolean }
): Promise<void> {
  try {
    const repoPath = resolveRepo(repoArg);
    const storage = new LocalStorage();
    // The budget a split task's units take from.
    const budget = commandBudget(options);

    // Parse task specifier
    const { name, version, task } = parseTaskSpec(taskSpec);

    // Validate output is provided
    if (!options.output) {
      exitError('Output file is required. Use -o <path> to specify output.');
    }

    // Get package and find task hash
    const pkg = await packageRead(storage, repoPath, name, version);
    const taskHash = pkg.tasks.get(task);

    if (!taskHash) {
      const available = Array.from(pkg.tasks.keys()).join(', ');
      exitError(
        `Task '${task}' not found in ${name}@${version}. Available: ${available || '(none)'}`
      );
    }

    console.log(`Running ${name}@${version}/${task}`);

    // Read input files and store as objects
    const inputHashes: string[] = [];
    for (const inputPath of inputs) {
      const data = await readFile(inputPath);

      // Verify it's valid beast2 (will throw if not)
      try {
        decodeBeast2(data);
      } catch {
        exitError(`Invalid beast2 file: ${inputPath}`);
      }

      const hash = await objectWrite(repoPath, data);
      inputHashes.push(hash);
      console.log(`  Input: ${inputPath} -> ${shortHash(hash)}`);
    }

    // Execute the task, holding the repository's task lock shared for the
    // duration: gc takes it exclusively, so a sweep never runs while this
    // execution's unrooted objects (carved slices, unit outputs) exist.
    const lock = await storage.locks.acquire(repoPath, TASKS_LOCK, variant('dataflow', null), { mode: 'shared' });
    if (lock === null) {
      exitError('run: a garbage collection is running in this repository — retry when it finishes');
    }
    const startTime = Date.now();
    let result: Awaited<ReturnType<typeof taskExecute>>;
    try {
      result = await taskExecute(storage, repoPath, taskHash, inputHashes, {
        force: options.force,
        verbose: options.verbose,
        budget,
      });
    } finally {
      await lock.release();
    }

    const elapsed = Date.now() - startTime;

    if (result.cached) {
      console.log(`Cached (${elapsed}ms)`);
    } else {
      console.log(`Done (${elapsed}ms)`);
    }

    // Handle result
    if (result.state === 'success' && result.outputHash) {
      // Read output object and write to file
      const outputData = await objectRead(repoPath, result.outputHash);
      await writeFile(options.output, outputData);
      console.log(`Output: ${options.output}`);
    } else if (result.state === 'failed') {
      console.error(`Task failed with exit code: ${result.exitCode}`);
      process.exit(1);
    } else if (result.state === 'error') {
      exitError(result.error ?? 'Unknown error');
    }
  } catch (err) {
    exitError(formatError(err));
  }
}
