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
  options: { output?: string; force?: boolean; verbose?: boolean }
): Promise<void> {
  try {
    const repoPath = resolveRepo(repoArg);
    const storage = new LocalStorage();

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

    // Read and validate every input file before anything touches the
    // repository — a bad file exits here, holding nothing.
    const inputData: { path: string; data: Uint8Array }[] = [];
    for (const inputPath of inputs) {
      const data = await readFile(inputPath);

      // Verify it's valid beast2 (will throw if not)
      try {
        decodeBeast2(data);
      } catch {
        exitError(`Invalid beast2 file: ${inputPath}`);
      }
      inputData.push({ path: inputPath, data });
    }

    // Hold the repository's task lock shared from before the first input
    // object is written until the output has been read back: gc takes it
    // exclusively, so a sweep never runs while this execution's unrooted
    // objects exist — its inputs, carved slices and unit outputs alike. It is
    // taken BEFORE the run announces itself, so "Running …" means the run
    // holds the lock: a watcher needs no probe of its own (and an exclusive
    // probe would be indistinguishable from a gc).
    const lock = await storage.locks.acquire(repoPath, TASKS_LOCK, variant('dataflow', null), { mode: 'shared' });
    if (lock === null) {
      exitError('run: a garbage collection is running in this repository — retry when it finishes');
    }
    let result: Awaited<ReturnType<typeof taskExecute>>;
    let elapsed: number;
    let outputData: Uint8Array | undefined;
    try {
      console.log(`Running ${name}@${version}/${task}`);

      const inputHashes: string[] = [];
      for (const { path, data } of inputData) {
        const hash = await objectWrite(repoPath, data);
        inputHashes.push(hash);
        console.log(`  Input: ${path} -> ${shortHash(hash)}`);
      }

      const startTime = Date.now();
      result = await taskExecute(storage, repoPath, taskHash, inputHashes, {
        force: options.force,
        verbose: options.verbose,
      });
      elapsed = Date.now() - startTime;

      if (result.state === 'success' && result.outputHash) {
        outputData = await objectRead(repoPath, result.outputHash);
      }
    } finally {
      await lock.release();
    }

    if (result.cached) {
      console.log(`Cached (${elapsed}ms)`);
    } else {
      console.log(`Done (${elapsed}ms)`);
    }

    // Handle result
    if (result.state === 'success' && outputData !== undefined) {
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
