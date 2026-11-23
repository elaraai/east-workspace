/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Whether a task or a unit is fetch-bound on a rack: fetching what the rack
 * is not known to hold of its inputs, over the link to it, would take longer
 * than the work took to run when e3 last recorded it. A fetch-bound unit runs
 * here (the policy's `weighFetch`).
 *
 * @remarks
 * What a rack holds and how fast its link is are the hub's to know: every
 * byte a rack reads streams through it, so it measures each link and keeps
 * which objects it served each rack whole (`RackLinkMeter`). A rack whose
 * link it has not measured is taken to carry
 * {@link RACK_LINK_ASSUMED_BYTES_PER_SECOND}, a gigabit: fast enough that a
 * first run keeps on its racks all but work that would be fetch-bound even
 * over a LAN, while its transfers measure the link for the work after it.
 *
 * How long work ran is its execution records': the latest success of the
 * same inputs, else, for a task, its latest success; for a piece of a split
 * task, the median of its task's pieces' latest successes; and for a merge
 * unit, the median of its task's merges'. A merge is not weighed by its
 * pieces, which a wide fan-in or a large range far outruns. Work with no
 * recorded success of its kind — a first run, a task's first merge — follows
 * its policy. A record of work that
 * ran on a rack spans its fetch; work this process saw run on a rack is
 * taken at its rack's `ran` phase instead (#1723: from its runner's start to
 * its end), which counts what it fetched only as its work read it, and stands
 * as a success of its own until the records name it.
 *
 * Placement never changes a task's hash, nor its execution cache: the
 * weighing reads records, and writes none.
 */

import { isMergeUnitInputs, type StorageBackend } from '@elaraai/e3-core';
import type { RackFetchCost } from '../protocol/placement.js';
import type { RackLeasePhases } from '../protocol/task-envelope.js';

/** The rate a link is taken to carry before the hub has measured it, in
 *  bytes a second: a gigabit. */
export const RACK_LINK_ASSUMED_BYTES_PER_SECOND = 125_000_000;

/** How long a task's records, once read, answer for it, in ms: the units of
 *  one stage, placed together, read them once. Records with no success are
 *  not kept. */
const RECORDS_KEPT_MS = 60_000;

/** The most objects' sizes, and tasks' records, kept at once. */
const KEPT_MAX = 100_000;

/** One rack's link, as the hub answers it: its rate in bytes a second, null
 *  while unmeasured, and of each object asked about whether it holds it. */
export interface RackLinkCost {
  readonly bytesPerSecond: number | null;
  readonly held: readonly boolean[];
}

/**
 * The fetch cost of work on the rack that would fetch it soonest, when that
 * is longer than the work ran; else null.
 *
 * @param objects - The work's closure: each object's hash and size
 * @param racks - The racks that could take the work
 * @param links - What the hub knows of each rack's link, by its id: a rack
 *   it knows nothing of holds nothing, at the assumed rate
 * @param ranMs - How long the work last ran, in ms: what the cost names
 * @param hereMs - How long it is taken to run here, in ms, against which its
 *   fetch is weighed: as long as it ran unless given
 * @returns The cost that makes the work fetch-bound, or null when some rack
 *   would fetch it in no longer than it runs here, or no rack could take it
 * @example
 * fetchBound([{ hash, size: 903e6 }], ['rack-1'], new Map([['rack-1', { bytesPerSecond: 10e6, held: [false] }]]), 19_000);
 * // { bytes: 903e6, fetchMs: 90300, ranMs: 19000, measured: true }
 */
export function fetchBound(objects: ReadonlyArray<{ readonly size: number }>, racks: readonly string[],
  links: ReadonlyMap<string, RackLinkCost>, ranMs: number, hereMs = ranMs): RackFetchCost | null {
  let best: RackFetchCost | null = null;
  for (const rackId of racks) {
    const link = links.get(rackId);
    const bytes = objects.reduce((sum, object, i) => link?.held[i] === true ? sum : sum + object.size, 0);
    const rate = link?.bytesPerSecond ?? null;
    const cost = { bytes, fetchMs: bytes * 1000 / (rate ?? RACK_LINK_ASSUMED_BYTES_PER_SECOND), ranMs, measured: rate !== null };
    if (best === null || cost.fetchMs < best.fetchMs) best = cost;
  }
  return best !== null && best.fetchMs > hereMs ? best : null;
}

/**
 * What an execution of a task is, as its run time is weighed: the task's own
 * (`task`, a task's or the one unit of a task that is one piece), a piece of
 * a split task (`piece`), or a merge unit of one (`merge`: a set's or a
 * dict's merge over a key range, or a step of a fold's combine). Each is
 * weighed by work of its own kind.
 */
export type RackRunKind = 'task' | 'piece' | 'merge';

/** The duration of each latest success of a task's executions, with its
 *  inputs, its kind, and when it ended. */
interface RecordedRun { readonly inHash: string; readonly kind: RackRunKind; readonly ms: number; readonly endedAt: number }

/** What a task's runs say of how long its work takes, worked out once from
 *  its records and what this process saw run on a rack. */
interface RunSummary {
  /** By kind and inputs, how long each ran */
  readonly byInputs: ReadonlyMap<string, number>;
  /** The task's latest success of its own */
  readonly task: number | null;
  /** The median of its pieces' */
  readonly piece: number | null;
  /** The median of its merges' */
  readonly merge: number | null;
}

/** The median of some durations, or null of none. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const middle = values.length >> 1;
  return values.length % 2 === 1 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
}

/** A task's runs, summarised: each seen on a rack in place of its record, and
 *  one the records do not name yet as a success of its own. */
function summarize(recorded: readonly RecordedRun[], seen: Iterable<[string, RecordedRun]>): RunSummary {
  const runs = new Map<string, RecordedRun>();
  for (const run of recorded) runs.set(`${run.kind}\0${run.inHash}`, run);
  for (const [key, run] of seen) runs.set(key, run);
  let latest: RecordedRun | undefined;
  const pieces: number[] = [];
  const merges: number[] = [];
  const byInputs = new Map<string, number>();
  for (const [key, run] of runs) {
    byInputs.set(key, run.ms);
    if (run.kind === 'task') { if (latest === undefined || run.endedAt > latest.endedAt) latest = run; }
    else (run.kind === 'piece' ? pieces : merges).push(run.ms);
  }
  return { byInputs, task: latest?.ms ?? null, piece: median(pieces), merge: median(merges) };
}

/**
 * How long work ran on its rack, as its rack says it: from its runner's start
 * to its end (`ran`, #1723), without the grant, the boot, nor the fetch before
 * its runner started. What its work fetched as it read it is in it.
 *
 * @param phases - What the rack said of the lease's time ({@link readRackPhases})
 * @returns The time in ms, or undefined when the rack did not mark both
 * @example
 * rackRanMs({ marks: { 'runner-started': 3_200, 'runner-ended': 22_200 } }); // 19_000
 */
export function rackRanMs(phases: RackLeasePhases | undefined): number | undefined {
  const started = phases?.marks['runner-started'];
  const ended = phases?.marks['runner-ended'];
  return started === undefined || ended === undefined ? undefined : Math.max(0, ended - started);
}

/**
 * The run times e3 recorded of a run's tasks, read once a minute for a task
 * however many of its units are placed, and the sizes of the objects their
 * closures name, which never change.
 *
 * @remarks
 * What a task's runs say — its latest success, and the medians of its pieces
 * and of its merges — is worked out once each time its records are read or
 * work of it is seen to run, and answers every unit of a stage placed
 * meanwhile: a stage of thousands of units weighs each in constant time.
 *
 * @example
 * const times = new RecordedRunTimes();
 * const ranMs = await times.ranMs(storage, repo, taskHash, inHash, 'task');
 */
export class RecordedRunTimes {
  private readonly records = new Map<string, { at: number; runs: Promise<RecordedRun[]> }>();
  private readonly known = new Map<string, number>();
  /** By task, the work this process saw run on a rack, at its rack's `ran`
   *  phase, by its kind and its inputs; and how many times it was added to */
  private readonly ranOnRack = new Map<string, { version: number; runs: Map<string, RecordedRun> }>();
  /** By task, its runs summarised, and the records read and the work seen
   *  that the summary is of */
  private readonly summaries = new Map<string, { runs: Promise<RecordedRun[]>; version: number; summary: RunSummary }>();

  /**
   * Notes how long work ran on its rack, as its rack said it
   * ({@link rackRanMs}): what the work is weighed by from now on, in place of
   * its record's span, which counts its fetch.
   * @param repo - The repository
   * @param taskHash - The task the work is of
   * @param inHash - The work's inputs hash
   * @param kind - What the work is: the task's own, a piece, or a merge
   * @param ms - How long its runner ran, in ms
   */
  ran(repo: string, taskHash: string, inHash: string, kind: RackRunKind, ms: number): void {
    const key = `${repo}\0${taskHash}`;
    let seen = this.ranOnRack.get(key);
    if (seen === undefined) {
      if (this.ranOnRack.size >= KEPT_MAX) { this.ranOnRack.clear(); this.summaries.clear(); }
      seen = { version: 0, runs: new Map() };
      this.ranOnRack.set(key, seen);
    }
    if (seen.runs.size >= KEPT_MAX) seen.runs.clear();
    seen.runs.set(`${kind}\0${inHash}`, { inHash, kind, ms, endedAt: Date.now() });
    seen.version++;
  }

  /**
   * How long work last ran, as e3 recorded it.
   * @param storage - The repository's storage
   * @param repo - The repository
   * @param taskHash - The task the work is of
   * @param inHash - The work's inputs hash
   * @param kind - What the work is: the task's own execution, or a piece or
   *   a merge of a split task, each recorded as a unit
   * @returns The time in ms, or null when nothing of its kind succeeded before
   */
  async ranMs(storage: StorageBackend, repo: string, taskHash: string, inHash: string, kind: RackRunKind): Promise<number | null> {
    const summary = await this.summary(storage, repo, taskHash);
    return summary.byInputs.get(`${kind}\0${inHash}`) ?? summary[kind];
  }

  /** What a task's runs say, worked out again only once its records are read
   *  again or more of its work was seen to run. A record of work seen on a
   *  rack is taken at its rack's `ran`. */
  private async summary(storage: StorageBackend, repo: string, taskHash: string): Promise<RunSummary> {
    const key = `${repo}\0${taskHash}`;
    const runs = this.runs(storage, repo, taskHash);
    const recorded = await runs;
    const seen = this.ranOnRack.get(key);
    const version = seen?.version ?? 0;
    const kept = this.summaries.get(key);
    if (kept !== undefined && kept.runs === runs && kept.version === version) return kept.summary;
    const summary = summarize(recorded, seen?.runs ?? []);
    if (this.summaries.size >= KEPT_MAX) this.summaries.clear();
    this.summaries.set(key, { runs, version, summary });
    return summary;
  }

  private runs(storage: StorageBackend, repo: string, taskHash: string): Promise<RecordedRun[]> {
    const key = `${repo}\0${taskHash}`;
    const kept = this.records.get(key);
    if (kept !== undefined && Date.now() - kept.at < RECORDS_KEPT_MS) return kept.runs;
    if (this.records.size >= KEPT_MAX) this.records.clear();
    const runs = storage.refs.executionListLatest(repo, taskHash).then((latest) => latest.flatMap(({ inputsHash, status }) =>
      status.type === 'success'
        ? [{ inHash: inputsHash, kind: runKind(status.value.unit, status.value.inputHashes),
          ms: Math.max(0, status.value.completedAt.getTime() - status.value.startedAt.getTime()), endedAt: status.value.completedAt.getTime() }]
        : []), () => []);
    // A task that has not succeeded yet is asked again: its units, as they
    // end, are what the next of them is weighed by
    this.records.set(key, { at: Date.now(), runs });
    void runs.then((read) => { if (read.length === 0 && this.records.get(key)?.runs === runs) this.records.delete(key); });
    return runs;
  }

  /**
   * The sizes of objects of the repository, read once each.
   * @param storage - The repository's storage
   * @param repo - The repository
   * @param hashes - The objects
   * @returns Each one's size in bytes, in the order given
   * @throws {Error} When an object is not in the store
   */
  async sizes(storage: StorageBackend, repo: string, hashes: readonly string[]): Promise<number[]> {
    return Promise.all(hashes.map(async (hash) => {
      const key = `${repo}\0${hash}`;
      const size = this.known.get(key);
      if (size !== undefined) return size;
      const stat = await storage.objects.stat(repo, hash);
      if (this.known.size >= KEPT_MAX) this.known.clear();
      this.known.set(key, stat.size);
      return stat.size;
    }));
  }
}

/** What an execution record's work is: the task's own, or a unit's — a merge
 *  by the tag its recorded inputs begin with, else a piece. */
function runKind(unit: boolean, inputHashes: readonly string[]): RackRunKind {
  return !unit ? 'task' : isMergeUnitInputs(inputHashes) ? 'merge' : 'piece';
}

/** What {@link weighFetch} weighs work by. */
export interface WeighFetchOptions {
  /** Asks the hub what each rack's link is, and which of the work's objects
   *  each holds: the session's `fetchCosts` */
  readonly links: (hashes: readonly string[]) => Promise<ReadonlyMap<string, RackLinkCost> | null>;
  /** The racks that could take the work */
  readonly racks: readonly string[];
  /** The repository's storage, which holds the work's objects */
  readonly storage: StorageBackend;
  /** The repository */
  readonly repo: string;
  /** The work's closure: every object a rack would read for it */
  readonly hashes: readonly string[];
  /** How long the work last ran, in ms */
  readonly ranMs: number;
  /** How long it is taken to run here, in ms: as long as it ran unless given */
  readonly hereMs?: number;
  /** The run's records and sizes, read once */
  readonly times: RecordedRunTimes;
}

/**
 * Weighs work's fetch on a rack against how long it last ran.
 *
 * @param options - Where its links are asked, the racks that could take it,
 *   its closure and how long it ran
 * @returns The cost that makes it fetch-bound, or null when it is not, or
 *   when what it would cost cannot be told: the hub does not answer, or an
 *   object's size cannot be read; the work then follows its policy
 * @example
 * const cost = await weighFetch({ links: (hashes) => session.fetchCosts(hashes), racks, storage, repo, hashes, ranMs, times });
 * if (cost !== null) return runLocal('fetch-bound', undefined, undefined, cost);
 */
export async function weighFetch(options: WeighFetchOptions): Promise<RackFetchCost | null> {
  if (options.racks.length === 0 || options.hashes.length === 0) return null;
  try {
    const links = await options.links(options.hashes);
    if (links === null) return null;
    const sizes = await options.times.sizes(options.storage, options.repo, options.hashes);
    return fetchBound(sizes.map((size) => ({ size })), options.racks, links, options.ranMs, options.hereMs);
  } catch {
    return null;
  }
}
