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
 * objects its output is stored as. It takes its core before it stages its
 * unit, so the pieces of a large delivery that wait for room hold nothing but
 * their place in the budget's queue.
 *
 * A delivery the store holds whole is placed whole where placing it is a link
 * (`ObjectStore.placement`): a local store's. Where placing it is a download,
 * a run of its segments is staged as a blob of its own — the delivery's
 * header, the run's frames as they are stored, and an index of them — read by
 * ranges, so the store serves a piece no byte of the delivery's other
 * segments. A refusal of a staged run names its segments and offsets as the
 * delivery numbers them, as it does for a delivery the runner reads where it
 * lies.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { readBeast2ExtentsRanged, spliceBeast2Tail, variant, type Beast2RangedExtents } from '@elaraai/east';
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

// An intake unit reads its delivery a segment at a time whatever a runner's
// `decode` says: it names no program.
const EAST_C: StockRunner = variant('east_c', { platforms: [], decode: variant('lazy', null) });
const EAST_NODE: StockRunner = variant('east_node', { platforms: [], decode: variant('lazy', null) });

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
 * @param options - Cancellation, the budget and the runner search
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
  // A core first: the unit is staged only once it can run, and the runners it
  // is tried on run one after another under the one grant.
  let grant: Grant | undefined;
  try {
    grant = await options.budget?.acquire({ signal: options.signal });
  } catch (err) {
    if (options.signal?.aborted) throw abortError();
    throw err;
  }
  try {
    const scratchDir = await callScratchDir(repo, uuidv7().replaceAll('-', ''));
    await fs.mkdir(scratchDir, { recursive: true });
    try {
      return await stageAndRun(storage, repo, spec, options, unusable, candidates, scratchDir, grant);
    } finally {
      try {
        await fs.rm(scratchDir, { recursive: true, force: true });
      } catch {
        // Left for the sweep
      }
    }
  } finally {
    grant?.release();
  }
}

/** Stages the unit in `scratchDir` and runs it on the first candidate that
 *  can, under `grant`. */
async function stageAndRun(
  storage: StorageBackend,
  repo: string,
  spec: IntakeSpec,
  options: RunIntakeOptions,
  unusable: Map<string, string>,
  candidates: readonly IntakeCandidate[],
  scratchDir: string,
  grant: Grant | undefined,
): Promise<IntakeResult> {
  // A delivery on a filesystem the runner reads is named where it lies. One
  // the store holds whole is linked in where objects are files here, since the
  // runner only reads it; where placing it is a download, a run of its
  // segments is staged as a blob of its own.
  let input: string;
  let segments = spec.segments ?? null;
  let piece: StagedPiece | null = null;
  if ('file' in spec.source) {
    input = spec.source.file;
  } else {
    input = path.join(scratchDir, 'delivery.beast2');
    if (segments !== null && storage.objects.placement === 'download') {
      piece = await stagePiece(storage, repo, spec.source.object, segments, input);
    }
    if (piece === null) await storage.objects.materialize(repo, spec.source.object, input, { link: true });
    else segments = piece.segments;
  }
  const unit = await stageIntakeUnit(scratchDir, input, spec.type, segments, unitThreads(options.budget));
  const searchDirs = [options.runnerSearchDir ?? path.dirname(repo), process.cwd()];

  let fallback: string | undefined;
  for (const [at, candidate] of candidates.entries()) {
    const skipped = unusable.get(candidate.command);
    if (skipped !== undefined) {
      fallback ??= skipped;
      continue;
    }
    await clearIntakeOutput(unit);
    const { result, stop } = await spawnIntake(unit, candidate, searchDirs, grant, options);
    if (result.stoppedByE3 && options.signal?.aborted) throw abortError();
    if (stop !== null) {
      throw new Error(`${candidate.command}: the guard stopped the runner at ${Math.round(stop.peak / 1024 ** 2)} MiB, with the machine nearly out of memory`);
    }
    // A command that is not there: the next is tried.
    if (result.exitCode === null && result.signal === null && /ENOENT/.test(result.error ?? '')) continue;

    const recorded = await readUnitResult(unit);
    if (recorded?.outcome.type === 'ok' && result.exitCode === 0) {
      // The runner is done with its core: storing what it wrote is e3's work.
      grant?.release();
      const hash = await storeDatasetFile(storage, repo, unit.output, { canonical: true });
      return { hash, runner: candidate.command, ...(fallback !== undefined && { fallback }), peakBytes: Number(recorded.peakBytes) };
    }
    if (recorded?.outcome.type === 'failed') {
      const refusal = recorded.outcome.value.message;
      throw new DeliveryRefusedError(candidate.command, piece === null ? refusal : piece.inDelivery(refusal), result.stderrTail);
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
}

/** How many bytes of a stored delivery a piece's staging reads at once. */
const PIECE_READ_BYTES = 8 * 1024 * 1024;

/** A run of a stored delivery's segments, staged as a blob of its own. */
interface StagedPiece {
  /** The run, as the staged blob numbers its segments: all of them. */
  readonly segments: { readonly from: number; readonly to: number };
  /**
   * A refusal of the staged blob, naming its segments and offsets as the
   * delivery numbers them.
   *
   * @param refusal - The refusal, in the words every runner uses
   * @returns The refusal of the delivery
   */
  inDelivery(refusal: string): string;
}

/**
 * Stages segments `[from, to)` of a delivery the store holds as a blob of their
 * own at `dest`: the delivery's header, the run's frames as they are stored,
 * and a terminator, index and footer for them. That is what an intake of the
 * run reads of the delivery, and all that is read of it, by ranges: its footer
 * and index, its header, and then the run.
 *
 * @param storage - Storage backend
 * @param repo - Repository identifier
 * @param hash - The delivery's object
 * @param segments - The run, by the delivery's index
 * @param dest - Where the blob is written
 * @returns The staged run; or `null` when the delivery has no index that
 *   parses, the run is not a range of its segments, or they alias one another,
 *   so the runner is given the whole delivery and refuses it in its own words
 * @throws {ObjectNotFoundError} When the store holds no such object.
 * @throws {Error} When the store fails a read of the delivery, as it failed —
 *   a throttle stays a throttle, which a caller that runs the intake in rounds
 *   retries, rather than staging the whole delivery for one piece — and when
 *   the object ends inside the segments its index names.
 */
async function stagePiece(
  storage: StorageBackend,
  repo: string,
  hash: string,
  segments: { readonly from: number; readonly to: number },
  dest: string,
): Promise<StagedPiece | null> {
  const { size } = await storage.objects.stat(repo, hash);
  const store: { failure: { err: unknown } | null } = { failure: null };
  let extents: Beast2RangedExtents;
  try {
    // A probe of the footer alone, so the read that follows is the index: a
    // run that does not hold the last segments reads none of their bytes.
    extents = await readBeast2ExtentsRanged(
      {
        size,
        read: async (offset, length) => {
          try {
            return await storage.objects.readRange(repo, hash, offset, length);
          } catch (err) {
            store.failure = { err };
            throw err;
          }
        },
      },
      { tailProbeBytes: 16 },
    );
  } catch {
    // The store's failure is its own; extents that do not parse are the
    // delivery's, which the runner refuses in its own words, given it whole.
    if (store.failure !== null) throw store.failure.err;
    return null;
  }
  const count = extents.offsets.length;
  const { from, to } = segments;
  if (!extents.selfContained || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > count) return null;
  const start = extents.offsets[from]!;
  const end = to < count ? extents.offsets[to]! : extents.segmentsEnd;
  // The run moves back to follow the header directly.
  const shift = start - extents.prefixEnd;
  const table = extents.offsets.slice(from, to).map((offset, i) => ({ offset: offset - shift, count: extents.counts[from + i]! }));
  await pipeline(async function* () {
    yield extents.head;
    for (let at = start; at < end; at += PIECE_READ_BYTES) {
      const length = Math.min(PIECE_READ_BYTES, end - at);
      const bytes = await storage.objects.readRange(repo, hash, at, length);
      if (bytes.length !== length) throw new Error(`object ${hash} ends at ${at + bytes.length}, inside the segments its index names`);
      yield bytes;
    }
    yield spliceBeast2Tail(table, extents.prefixEnd + end - start);
  }, createWriteStream(dest));
  return {
    segments: { from: 0, to: to - from },
    inDelivery: (refusal) => refusal.replace(
      /\bsegment (\d+) of the delivery(?:, at offset (\d+))?/g,
      (_match, n: string, offset: string | undefined) =>
        `segment ${Number(n) + from} of the delivery${offset === undefined ? '' : `, at offset ${Number(offset) + shift}`}`,
    ),
  };
}

/** Removes what a runner wrote for a unit, so another runs it from a clean
 *  directory: a runner writes its output only where nothing is. */
async function clearIntakeOutput(unit: IntakeUnit): Promise<void> {
  for (const written of [unit.output, `${unit.output}.segments`, unit.result]) {
    await fs.rm(written, { recursive: true, force: true });
  }
}

/** Runs an intake unit on one runner, under the intake's grant, in a cgroup of
 *  its own where e3's cgroup is delegated to it; and says whether the guard
 *  stopped it. */
async function spawnIntake(
  unit: IntakeUnit,
  candidate: IntakeCandidate,
  searchDirs: string[],
  grant: Grant | undefined,
  options: RunIntakeOptions,
): Promise<{ result: SpawnAndCaptureResult; stop: GuardStop | null }> {
  const cgroups = options.budget === undefined ? null : await unitCgroups();
  let cgroup: string | null = null;
  try {
    if (cgroups !== null) cgroup = await cgroups.create(`intake-${uuidv7().replaceAll('-', '')}`, null).catch(() => null);
    const argv = unitArgv(candidate.runner, unit, false, candidate.command);
    const result = await spawnAndCapture(cgroup === null ? argv : cgroups!.enter(cgroup, argv), path.dirname(unit.file), {
      signal: options.signal,
      searchDirs,
      stdinLifeline: true,
      onSpawned: (pid, stop) => {
        if (pid !== null) grant?.watch({ pid, stop, ...(cgroup !== null && { cgroup }) });
      },
    });
    grant?.unwatch();
    return { result, stop: grant?.stopped ?? null };
  } finally {
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
