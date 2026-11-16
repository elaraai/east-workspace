/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3 run command - Ad-hoc task execution
 *
 * Usage:
 *   e3 run . acme-forecast.train ./sales.beast2 -o ./model.beast2
 *   e3 run . my-pkg@1.0.0.process ./input1.beast2 ./input2.beast2 -o ./output.beast2
 *   e3 run . my-pkg.task ./data.beast2 -o ./out.beast2 --force
 *   e3 run . acme-forecast.train ./sales.beast2 -o ./model.beast2 --rack
 *
 * Each input file is taken in as a dataset's file is (`e3 dataset set
 * --from-file`): a collection by intake units, a piece of its segments each,
 * never read whole, so a task split over it plans its pieces from it; any other
 * value as a copy of the file, which stays its user's to write again. The
 * output is written to -o as the value itself, a collection from its
 * segments, a segment at a time: the file is replaced, never written into.
 *
 * With --rack the task's body runs on an enrolled rack, whatever the
 * repository's rack policy selects: a rule that names the task still sizes
 * it. A task split over an input delegates its pieces and merges, its planning
 * and assembly staying here. The cache, the execution records and the logs are
 * as a local run writes them. A line says where the task ran, and why, and the
 * run ends with the rack summary a dataflow run ends with, which says where a
 * split task's pieces ran. Ctrl-C leaves the task's leases, whose racks are
 * told to stop it.
 */

import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  packageRead,
  datasetWriteFile,
  taskExecute,
  withRunningWork,
  LocalStorage,
  LocalTaskRunner,
  type Budget,
  type ExecutionResult,
  type TaskResult,
} from '@elaraai/e3-core';
import { openRepo, parsePackageSpec, resolvePackageVersion, formatError, exitError, shortHash } from '../utils.js';
import { createProgress } from '../progress.js';
import { adoptFileReported, intakeReporter } from '../intake.js';
import { commandBudget, type BudgetFlags } from './budget.js';
import { openCommandRack, printRackSummary, refuseRemoteRack, unattachedLine, type RackFlags } from './rack-options.js';
import { untilInterrupted } from '../interrupt.js';

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
 * Takes a run's input files in, in order, saying how far the intake has got.
 *
 * @param storage - Storage backend
 * @param repoPath - The repository
 * @param inputs - The files, as they were given
 * @param budget - The budget the intake units of a collection take from
 * @param signal - Stops the intake
 * @returns Each input's dataset object hash: the manifest, for a collection
 * @throws {Error} When a file cannot be read or holds no beast2 value, naming it
 */
async function takeInInputs(storage: LocalStorage, repoPath: string, inputs: readonly string[], budget: Budget, signal?: AbortSignal): Promise<string[]> {
  if (inputs.length === 0) return [];
  const files = inputs.map((input) => resolve(input));
  const sources = { count: files.length, bytes: 0 };
  for (const file of files) sources.bytes += (await stat(file)).size;
  const runner = new LocalTaskRunner(repoPath, budget);
  const intake = intakeReporter(createProgress());
  const hashes: string[] = [];
  for (const [i, input] of inputs.entries()) {
    try {
      // An input is its user's working file, written again between runs: the
      // store takes a copy of a value, never the file itself by a hard link
      hashes.push((await adoptFileReported(intake, storage, repoPath, files[i]!, input, sources,
        { runner, link: false, ...(signal !== undefined && { signal }) })).hash);
    } catch (err) {
      throw new Error(`Input ${input}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return hashes;
}

/**
 * Run a task ad-hoc with file inputs and output: here, or with --rack on an
 * enrolled rack.
 */
export async function runCommand(
  repoArg: string,
  taskSpec: string,
  inputs: string[],
  options: BudgetFlags & RackFlags & { output?: string; force?: boolean; verbose?: boolean }
): Promise<void> {
  try {
    // A server decides where its own work runs: refused before anything is read
    refuseRemoteRack(repoArg, options);
    const repoPath = await openRepo(repoArg);
    const storage = new LocalStorage();
    // The budget a split task's units take from.
    const budget = commandBudget(options);

    // Parse task specifier: a bare package name runs the greatest version the
    // repository holds
    const { name, version: named, task } = parseTaskSpec(taskSpec);
    const version = await resolvePackageVersion({ type: 'local', path: repoPath }, name, named);

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
    const output = options.output;

    // The inputs are taken in, the task run and its output written as running
    // work: gc takes the repository exclusively, so a sweep never takes an
    // input's segments, or this execution's unrooted objects (carved slices,
    // unit outputs), before its records name them
    const onRack = options.rack === true || options.rackOnly === true;
    const run = (signal?: AbortSignal) => withRunningWork(storage, repoPath, async () => {
      const inputHashes = await takeInInputs(storage, repoPath, inputs, budget, signal);
      for (const [i, hash] of inputHashes.entries()) console.log(`  Input: ${inputs[i]} -> ${shortHash(hash)}`);
      // With --rack, a session opened for this task alone, which leases it
      // whatever the policy selects
      const rack = onRack
        ? await openCommandRack({ repoPath, workspace: `${name}@${version}`, storage, label: `e3 run ${name}@${version}.${task} (pid ${process.pid})`, budget,
          rackOnly: options.rackOnly, ...(signal !== undefined && { signal }), print: (line) => console.log(line) })
        : undefined;
      const startTime = Date.now();
      let result: TaskResult | ExecutionResult;
      try {
        result = rack !== undefined
          ? await rack.runner.execute(storage, taskHash, inputHashes, { force: options.force, verbose: options.verbose, taskName: task, ...(signal !== undefined && { signal }) })
          : await taskExecute(storage, repoPath, taskHash, inputHashes, { force: options.force, verbose: options.verbose, budget });
        if (rack !== undefined) {
          // With no session the task ran here, unless the cache answered it
          const unattached = unattachedLine(rack, task, !result.cached);
          if (unattached !== undefined) console.log(unattached);
          // A split task's pieces have no lines of their own: the line a
          // dataflow run ends with says where they ran
          await printRackSummary(rack);
        }
      } finally {
        await rack?.close();
      }
      const elapsed = Date.now() - startTime;
      // The value itself, a collection's from its segments
      if (result.state === 'success' && result.outputHash) await datasetWriteFile(storage, repoPath, result.outputHash, output);
      return { result, elapsed };
    });
    // Ctrl-C leaves a rack's leases, from before the session opens; a run
    // here ends as it always has
    const ran = onRack ? await untilInterrupted(run, 'the task\'s racks are told to stop it') : await run();
    if (ran === null) return;
    const { result, elapsed } = ran;

    if (result.cached) {
      console.log(`Cached (${elapsed}ms)`);
    } else {
      console.log(`Done (${elapsed}ms)`);
    }

    // Handle result
    if (result.state === 'success' && result.outputHash) {
      console.log(`Output: ${output}`);
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
