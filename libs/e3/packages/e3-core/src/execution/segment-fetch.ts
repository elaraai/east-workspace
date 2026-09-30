/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A unit's segments placed as its runner reads them: the host's half of the
 * runner protocol's segments on demand (a unit's `fetch`, `UnitType` in
 * `@elaraai/east`).
 *
 * Where placing an object is a download (`ObjectStore.placement`), a stock
 * runner's manifest inputs are staged without their segments, and its unit
 * says so. The runner asks for a segment as it first reads it, by creating
 * `<segment file>.want`; the fetcher places the segment — under a name of its
 * own, renamed into place whole — or writes `<segment file>.error`, saying
 * why it cannot. A unit then
 * downloads the segments it reads rather than every segment of every input:
 * each piece of a split task, the lookup every piece reads among them.
 *
 * A runner asks for one segment at a time, and waits for each, so a unit that
 * reads a collection whole would wait on a request per segment. The fetcher
 * reads ahead of one that asks for a manifest's segments in order: once two
 * asks follow each other, it places the segments after the one asked for too,
 * a window that doubles while the asks stay in order, so a scan of N segments
 * waits on a few dozen requests rather than N. A read that lands in one
 * segment reads nothing ahead.
 *
 * @packageDocumentation
 */

import { existsSync, watch, type FSWatcher } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { OBJECT_CONCURRENCY } from '../concurrency.js';
import { ObjectNotFoundError } from '../errors.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { uuidv7 } from '../uuid.js';

/** How often the fetcher looks through its directories for an ask a watch
 *  missed. */
const FETCH_POLL_MS = 100;

/** How many times a segment the runner asked for is tried before the fetcher
 *  writes why it cannot be placed: a store under load answers a burst with
 *  failures that pass. */
const FETCH_ATTEMPTS = 3;

/** How long the fetcher waits before it tries a segment again, doubling with
 *  each try. */
const FETCH_RETRY_MS = 100;

/** The most segments the fetcher places ahead of the one a runner asked for. */
const MAX_READ_AHEAD = 4 * OBJECT_CONCURRENCY;

/** A manifest's segments, in its order, and how far ahead of its runner the
 *  fetcher reads them. */
interface ManifestSegments {
  /** The segment files, in the order the manifest names them. */
  readonly files: string[];
  /** The last segment asked for or placed ahead, by its place in `files`; -1
   *  before any. */
  end: number;
  /** How many segments the next ask in order places ahead of it. */
  window: number;
}

/**
 * Places a unit's staged segments as its runner asks for them.
 *
 * @remarks
 * Staging hands it each segment it leaves unplaced ({@link add}). Once
 * started, it watches the directories they would be in, and looks through
 * them now and then for an ask a watch missed; it places each segment asked
 * for once, and refuses one it was not handed. It reads ahead of a runner
 * reading a manifest in order, at most {@link OBJECT_CONCURRENCY} segments in
 * flight ahead of it. Stopped, it waits for the placements in flight, and
 * takes no ask after.
 *
 * A segment the runner asked for is tried again after a failure that may pass
 * — a store's throttle — {@link FETCH_ATTEMPTS} times in all, and then the
 * fetcher writes why it cannot be placed; a missing object is written at
 * once. A segment placed ahead of the runner is tried once, and a failure
 * writes nothing: the segment is left for the runner's own ask, which tries
 * it again.
 */
export class SegmentFetcher {
  /** Each segment the runner may ask for, by its file: the object it is, the
   *  manifest's segments it is among, and its place among them. */
  private readonly segments = new Map<string, { hash: string; manifest: ManifestSegments; index: number }>();
  /** Each manifest's segments, by the directory they are staged in. */
  private readonly manifests = new Map<string, ManifestSegments>();
  /** The files asked for or placed ahead, placed or refused. */
  private readonly asked = new Set<string>();
  /** The segments to place ahead of the runner, once a placement is free. */
  private readonly ahead: string[] = [];
  /** How many segments placed ahead are in flight. */
  private aheadInFlight = 0;
  /** The placements in flight. */
  private readonly placing = new Set<Promise<void>>();
  private readonly watchers: FSWatcher[] = [];
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private placed = 0;

  /**
   * @param storage - Storage backend
   * @param repo - Repository identifier
   * @param link - Whether a segment placed may share the object's storage, as
   *   staging places it
   */
  constructor(
    private readonly storage: StorageBackend,
    private readonly repo: string,
    private readonly link: boolean,
  ) {}

  /**
   * Leaves a segment for the runner to ask for: it is placed at `file` when it
   * is asked for, or ahead of a runner reading its manifest in order.
   *
   * @remarks
   * A manifest's segments are staged in one directory, and are left in the
   * order it names them, which is the order a scan reads them in.
   *
   * @param hash - The segment's object
   * @param file - Where staging would have placed it
   */
  add(hash: string, file: string): void {
    if (this.segments.has(file)) return;
    const dir = path.dirname(file);
    let manifest = this.manifests.get(dir);
    if (manifest === undefined) {
      manifest = { files: [], end: -1, window: 0 };
      this.manifests.set(dir, manifest);
    }
    this.segments.set(file, { hash, manifest, index: manifest.files.length });
    manifest.files.push(file);
  }

  /** How many segments were left for the runner to ask for. */
  get size(): number {
    return this.segments.size;
  }

  /** How many segments the runner asked for were placed. */
  get fetched(): number {
    return this.placed;
  }

  /** Starts placing what the runner asks for. */
  start(): void {
    const dirs = [...new Set([...this.segments.keys()].map((file) => path.dirname(file)))];
    for (const dir of dirs) {
      try {
        this.watchers.push(watch(dir, (_event, name) => {
          if (typeof name === 'string' && name.endsWith('.want')) this.ask(path.join(dir, name));
        }));
      } catch {
        // The poll looks through it.
      }
    }
    this.timer = setInterval(() => {
      for (const dir of dirs) void this.scan(dir);
    }, FETCH_POLL_MS);
  }

  /** Stops placing, once the placements in flight have landed; a segment
   *  still waiting to be placed ahead is not. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.ahead.length = 0;
    for (const watcher of this.watchers) watcher.close();
    this.watchers.length = 0;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    while (this.placing.size > 0) await Promise.all([...this.placing]);
  }

  /** Looks through a directory for asks. */
  private async scan(dir: string): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.endsWith('.want')) this.ask(path.join(dir, name));
    }
  }

  /**
   * Places the file `want` asks for, once, and reads ahead when the ask
   * follows the last segment of its manifest asked for or placed ahead.
   *
   * @remarks
   * The runner asks only for a segment that is not there, so a runner reading
   * in order next asks for the segment after the window placed ahead: that
   * doubles the window. An ask anywhere else — a keyed read, or the first —
   * reads nothing ahead, and starts the window again.
   */
  private ask(want: string): void {
    if (this.stopped) return;
    const file = want.slice(0, -'.want'.length);
    if (this.asked.has(file)) {
      // Waiting to be placed ahead, and asked for first: it goes now.
      const queued = this.ahead.indexOf(file);
      if (queued >= 0) {
        this.ahead.splice(queued, 1);
        this.launch(file, false);
      }
      return;
    }
    this.asked.add(file);
    this.launch(file, false);
    const segment = this.segments.get(file);
    if (segment === undefined) return;
    const { manifest, index } = segment;
    if (manifest.end >= 0 && index === manifest.end + 1) {
      manifest.window = Math.min(Math.max(1, manifest.window * 2), MAX_READ_AHEAD);
      for (const next of manifest.files.slice(index + 1, index + 1 + manifest.window)) {
        if (this.asked.has(next)) continue;
        this.asked.add(next);
        this.ahead.push(next);
      }
      this.pump();
    } else {
      manifest.window = 0;
    }
    manifest.end = Math.max(manifest.end, index + manifest.window);
  }

  /** Starts placing the segments waiting to be placed ahead, while fewer than
   *  {@link OBJECT_CONCURRENCY} are in flight. */
  private pump(): void {
    while (!this.stopped && this.aheadInFlight < OBJECT_CONCURRENCY && this.ahead.length > 0) {
      this.aheadInFlight++;
      this.launch(this.ahead.shift()!, true);
    }
  }

  /** Starts placing a segment, keeping it among the placements in flight. */
  private launch(file: string, ahead: boolean): void {
    const placing = this.place(file, ahead).finally(() => {
      this.placing.delete(placing);
      if (ahead) {
        this.aheadInFlight--;
        this.pump();
      }
    });
    this.placing.add(placing);
  }

  /**
   * Places a segment, whole. One asked for is tried again after a failure that
   * may pass, and then the fetcher writes why it cannot be placed; one placed
   * ahead is tried once, and a failure is left to the runner's own ask.
   */
  private async place(file: string, ahead: boolean): Promise<void> {
    const segment = this.segments.get(file);
    if (segment === undefined) {
      await writeRefusal(file, `${path.basename(file)} is no segment of the unit's inputs`);
      return;
    }
    for (let attempt = 1; ; attempt++) {
      const partial = `${file}.${uuidv7()}.partial`;
      try {
        await this.storage.objects.materialize(this.repo, segment.hash, partial, { link: this.link });
        await fs.rename(partial, file);
        this.placed++;
        return;
      } catch (err) {
        await fs.rm(partial, { force: true }).catch(() => { /* swept with the scratch directory */ });
        if (this.stopped) return;
        if (ahead) {
          // Not asked for: the runner's own ask tries it again — now, when it
          // asked while this was in flight, as an ask the window has passed.
          this.asked.delete(file);
          if (existsSync(`${file}.want`)) {
            this.asked.add(file);
            this.launch(file, false);
          }
          return;
        }
        if (attempt >= FETCH_ATTEMPTS || err instanceof ObjectNotFoundError) {
          await writeRefusal(file, err instanceof Error ? err.message : String(err));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, FETCH_RETRY_MS * 2 ** (attempt - 1)));
      }
    }
  }
}

/** Writes why a segment cannot be placed, which the runner that asked for it
 *  fails with: under a name of its own, renamed into place whole, so a runner
 *  that finds it reads all of it. */
async function writeRefusal(file: string, why: string): Promise<void> {
  const partial = `${file}.error.${uuidv7()}.partial`;
  try {
    await fs.writeFile(partial, why);
    await fs.rename(partial, `${file}.error`);
  } catch {
    // The runner has gone, with its scratch directory
    await fs.rm(partial, { force: true }).catch(() => { /* gone with it */ });
  }
}
