/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A local runner's intake: a delivered collection, or a run of its segments,
 * taken in by an `intake` unit on a stock runner, and stored through the
 * store's door.
 *
 * The unit runs on east-c, which walks and cuts natively, or on east-node when
 * e3 finds no east-c. An east-c that cannot run the unit at all, and records no
 * result for it — a release from before the unit, or a crash — is not tried
 * again by the runner that met it: that intake and every later one run on
 * east-node, and each says why. A failure a runner records is the delivery's
 * refusal, and no other runner is tried.
 *
 * Like a function call, an intake runs in a scratch directory of the
 * repository's, under the runner's budget, and writes nothing durable but the
 * objects its output is stored as.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { variant } from '@elaraai/east';
import type { StorageBackend } from '../storage/interfaces.js';
import { DeliveryRefusedError } from '../errors.js';
import { storeDatasetFile } from '../store-collection.js';
import { uuidv7 } from '../uuid.js';
import type { IntakeOptions, IntakeResult, IntakeSpec } from './interfaces.js';
import { spawnAndCapture, type SpawnAndCaptureResult } from './processExec.js';
import { callScratchDir } from './scratch.js';
import { readUnitResult, runnerCommand, stageIntakeUnit, unitArgv, type IntakeUnit, type StockRunner } from './units.js';
import { unitThreads, type Budget, type Grant, type GuardStop } from './budget.js';
import { unitCgroups } from './cgroups.js';

/** A runner an intake may run on, and the command it is run by. */
export interface IntakeCandidate {
  /** The stock runner. */
  readonly runner: StockRunner;
  /** The command it is run by. */
  readonly command: string;
}

const EAST_C: StockRunner = variant('east_c', { platforms: [] });
const EAST_NODE: StockRunner = variant('east_node', { platforms: [] });

/** The runners a local intake runs on, in the order it tries them. */
export const INTAKE_CANDIDATES: readonly IntakeCandidate[] = [EAST_C, EAST_NODE].map((runner) => ({ runner, command: runnerCommand(runner) }));

/** Options for {@link runIntake}. */
export interface RunIntakeOptions extends IntakeOptions {
  /** The budget the runner spawns under, taking a core from it; absent, the
   *  spawn is not budgeted. */
  budget?: Budget;
  /** Where the search for the runner's command starts, besides this process's
   *  working directory: the repository's parent, by default. */
  runnerSearchDir?: string;
}

/**
 * Takes a delivered collection in, or a run of its segments, through an
 * `intake` unit on the first of `candidates` that can run it, and stores what
 * it wrote through the store's door.
 *
 * @param storage - Storage backend
 * @param repo - The repository: its scratch root holds the unit, and its store
 *   what the unit wrote
 * @param spec - The delivery, its declared type, and the run of its segments
 * @param options - Cancellation, verbosity, the budget and the runner search
 * @param unusable - The candidates, by command, that could not run an intake
 *   before, with why: skipped here, and added to when one cannot
 * @param candidates - The runners to try, in order
 * @returns The stored manifest, the runner that took it in, and why it is not
 *   the first candidate, when it is not
 * @throws {DeliveryRefusedError} When the runner records the delivery's
 *   refusal.
 * @throws {Error} When no candidate is found or can run the unit, the guard
 *   stopped the runner, or the intake was aborted (an `AbortError`).
 */
export async function runIntake(
  storage: StorageBackend,
  repo: string,
  spec: IntakeSpec,
  options: RunIntakeOptions,
  unusable: Map<string, string>,
  candidates: readonly IntakeCandidate[] = INTAKE_CANDIDATES,
): Promise<IntakeResult> {
  const scratchDir = await callScratchDir(repo, uuidv7().replaceAll('-', ''));
  await fs.mkdir(scratchDir, { recursive: true });
  try {
    // A delivery the store holds whole is linked in: the runner only reads it.
    let input: string;
    if ('file' in spec.source) {
      input = spec.source.file;
    } else {
      input = path.join(scratchDir, 'delivery.beast2');
      await storage.objects.materialize(repo, spec.source.object, input, { link: true });
    }
    const unit = await stageIntakeUnit(scratchDir, input, spec.type, spec.segments ?? null, unitThreads(options.budget));
    const searchDirs = [options.runnerSearchDir ?? path.dirname(repo), process.cwd()];

    let fallback: string | undefined;
    for (const [at, candidate] of candidates.entries()) {
      const skipped = unusable.get(candidate.command);
      if (skipped !== undefined) {
        fallback ??= skipped;
        continue;
      }
      await clearIntakeOutput(unit);
      const { result, stop } = await spawnIntake(unit, candidate, searchDirs, options);
      if (result.stoppedByE3 && options.signal?.aborted) throw abortError();
      if (stop !== null) {
        throw new Error(`${candidate.command}: the guard stopped the runner at ${Math.round(stop.peak / 1024 ** 2)} MiB, with the machine nearly out of memory`);
      }
      // A command that is not there: the next is tried.
      if (result.exitCode === null && result.signal === null && /ENOENT/.test(result.error ?? '')) continue;

      const recorded = await readUnitResult(unit);
      if (recorded?.outcome.type === 'ok' && result.exitCode === 0) {
        const hash = await storeDatasetFile(storage, repo, unit.output, { canonical: true });
        return { hash, runner: candidate.command, ...(fallback !== undefined && { fallback }), peakBytes: Number(recorded.peakBytes) };
      }
      if (recorded?.outcome.type === 'failed') {
        throw new DeliveryRefusedError(candidate.command, recorded.outcome.value.message, result.stderrTail);
      }
      // No result that reads: the runner could not run the unit at all.
      const ended = result.exitCode !== null ? `exited ${result.exitCode}` : result.signal !== null ? `was ended by ${result.signal}` : 'did not start';
      const said = tellingLine(result.stderrTail) ?? result.error ?? undefined;
      const reason = `${candidate.command} ${ended} without recording a result for the intake unit${said === undefined ? '' : ` (${said})`}`;
      if (at === candidates.length - 1) {
        throw new Error(result.stderrTail.trim() === '' ? reason : `${reason}\nstderr:\n${result.stderrTail.trim()}`);
      }
      unusable.set(candidate.command, reason);
      fallback ??= reason;
    }
    throw new Error(`e3 found no runner to take the delivery in${fallback === undefined ? '' : `, since ${fallback}`}: ` +
      'add @elaraai/east-node-cli (or east-c) to the project');
  } finally {
    try {
      await fs.rm(scratchDir, { recursive: true, force: true });
    } catch {
      // Left for the sweep
    }
  }
}

/** Removes what a runner wrote for a unit, so another runs it from a clean
 *  directory: a runner writes its output only where nothing is. */
async function clearIntakeOutput(unit: IntakeUnit): Promise<void> {
  for (const written of [unit.output, `${unit.output}.segments`, unit.result]) {
    await fs.rm(written, { recursive: true, force: true });
  }
}

/** Runs an intake unit on one runner, once it holds a core of the budget, in
 *  a cgroup of its own where e3's cgroup is delegated to it; and says whether
 *  the guard stopped it. */
async function spawnIntake(
  unit: IntakeUnit,
  candidate: IntakeCandidate,
  searchDirs: string[],
  options: RunIntakeOptions,
): Promise<{ result: SpawnAndCaptureResult; stop: GuardStop | null }> {
  let grant: Grant | undefined;
  try {
    grant = await options.budget?.acquire({ signal: options.signal });
  } catch (err) {
    if (options.signal?.aborted) throw abortError();
    throw err;
  }
  const cgroups = options.budget === undefined ? null : await unitCgroups();
  let cgroup: string | null = null;
  try {
    if (cgroups !== null) cgroup = await cgroups.create(`intake-${uuidv7().replaceAll('-', '')}`, null).catch(() => null);
    const argv = unitArgv(candidate.runner, unit, options.verbose, candidate.command);
    const result = await spawnAndCapture(cgroup === null ? argv : cgroups!.enter(cgroup, argv), path.dirname(unit.file), {
      signal: options.signal,
      searchDirs,
      stdinLifeline: true,
      onSpawned: (pid, stop) => {
        if (pid !== null) grant?.watch({ pid, stop, ...(cgroup !== null && { cgroup }) });
      },
    });
    return { result, stop: grant?.stopped ?? null };
  } finally {
    grant?.release();
    if (cgroup !== null) await cgroups!.remove(cgroup);
  }
}

/**
 * The line of a stream's tail that says what went wrong: the first that starts
 * with an error's name — a CLI's `Error: Unknown command: exec` above its usage,
 * a Node crash's `TypeError: …` above its stack — else the last that says
 * anything, or `undefined`.
 */
function tellingLine(tail: string): string | undefined {
  const lines = tail.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  return lines.find((line) => /^\w*error\b/i.test(line)) ?? lines.at(-1);
}

function abortError(): Error {
  const error = new Error('intake: aborted');
  error.name = 'AbortError';
  return error;
}
