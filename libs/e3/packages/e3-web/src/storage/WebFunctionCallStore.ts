/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The calls a `WebStorage` keeps (east-workspace#1554): each call of a named
 * function through a workspace, and each one-shot started as a call, a record
 * of the records adapter, from its start to the end of the lifetime its end
 * gives it.
 *
 * @packageDocumentation
 */

import { some } from '@elaraai/east';
import { decodeFunctionCallJob, encodeFunctionCallJob, type FunctionCallCancel, type FunctionCallJob } from '@elaraai/e3-types';
import {
  checkId,
  checkName,
  checkPageLimit,
  type FunctionCallEnd,
  type FunctionCallListOptions,
  type FunctionCallListPage,
  type FunctionCallStore,
} from '@elaraai/e3-core/portable';
import type { RecordKey, RecordsAdapter, RecordsTransaction } from './adapters.js';
import { recordKeys } from './record-keys.js';

/** How many of a workspace's calls a list reads at a time, as it passes over
 *  those it leaves out. */
const LIST_PAGE = 100;

/** How many of a repository's calls a sweep reads at a time. */
const SWEEP_PAGE = 500;

/** A record's call, or `null` when it does not decode: an earlier release's. */
function decoded(data: Uint8Array): FunctionCallJob | null {
  try {
    return decodeFunctionCallJob(data);
  } catch {
    return null;
  }
}

/**
 * The calls of a `WebStorage`'s repositories, each a record at
 * `['repo', <repo>, 'call', <workspace>, <id>]`.
 *
 * @remarks
 * A call's id is a UUIDv7, so its workspace's keys scan in the order its calls
 * started, and a list reads them from the latest. Each write of a call is a
 * transaction that reads it, so its end and a request to cancel it land one
 * after the other, whichever tab makes them: the first end stands. A call past
 * its `expiresAt` is gone for every read, which deletes it as it passes, and
 * gc's sweep deletes every one ({@link sweepExpired}). A workspace's removal
 * takes its calls in its own transaction, and a repository's removal every
 * call it keeps.
 */
export class WebFunctionCallStore implements FunctionCallStore {
  /**
   * @param records - The records the calls are kept in
   * @param now - Reads the time, in epoch milliseconds, which a call's expiry
   *   is measured by (default `Date.now`)
   */
  constructor(private readonly records: RecordsAdapter, private readonly now: () => number = Date.now) {}

  async create(repo: string, job: FunctionCallJob): Promise<void> {
    const key = this.key(repo, job.workspace, job.call.id);
    await this.records.transact(async (tx) => {
      if (await this.live(tx, key) !== null) throw new Error(`workspace '${job.workspace}' keeps a call ${job.call.id} already`);
      tx.put(key, encodeFunctionCallJob(job));
    });
  }

  async get(repo: string, workspace: string, id: string): Promise<FunctionCallJob | null> {
    const key = this.key(repo, workspace, id);
    const data = await this.records.get(key);
    if (data === null) return null;
    const job = decodeFunctionCallJob(data);
    if (!this.expired(job)) return job;
    await this.forget([key]);
    return null;
  }

  async end(repo: string, workspace: string, id: string, end: FunctionCallEnd): Promise<FunctionCallJob | null> {
    const key = this.key(repo, workspace, id);
    return this.records.transact(async (tx) => {
      const job = await this.live(tx, key);
      if (job === null || job.call.state.type !== 'running') return job;
      const ended: FunctionCallJob = {
        ...job,
        call: {
          ...job.call,
          state: end.state,
          endedAt: some(end.endedAt),
          expiresAt: end.expiresAt,
          stdout: end.stdout,
          stderr: end.stderr,
          stdoutTruncated: end.stdoutTruncated,
          stderrTruncated: end.stderrTruncated,
        },
      };
      tx.put(key, encodeFunctionCallJob(ended));
      return ended;
    });
  }

  async requestCancel(repo: string, workspace: string, id: string, cancel: FunctionCallCancel): Promise<FunctionCallJob | null> {
    const key = this.key(repo, workspace, id);
    return this.records.transact(async (tx) => {
      const job = await this.live(tx, key);
      if (job === null || job.call.state.type !== 'running' || job.cancel.type === 'some') return job;
      const asked: FunctionCallJob = { ...job, cancel: some(cancel) };
      tx.put(key, encodeFunctionCallJob(asked));
      return asked;
    });
  }

  /** Reads the workspace's calls from the latest, a page of records at a
   *  time, until it has the page it was asked for or none are left. */
  async list(repo: string, workspace: string, options: FunctionCallListOptions): Promise<FunctionCallListPage> {
    checkPageLimit(options.limit);
    if (options.before !== undefined) checkId('call id', options.before);
    const prefix = this.prefix(repo, workspace);
    const calls: FunctionCallJob[] = [];
    const expired: RecordKey[] = [];
    let next: string | undefined;
    let before: RecordKey | undefined = options.before === undefined ? undefined : [...prefix, options.before];
    scanning: for (;;) {
      const entries = await this.records.scan(prefix, { reverse: true, limit: LIST_PAGE, ...(before !== undefined && { before }) });
      for (const [at, { key, value }] of entries.entries()) {
        // A record that does not decode keeps no call a reader can be shown
        const job = decoded(value);
        if (job === null) continue;
        if (this.expired(job)) {
          expired.push(key);
          continue;
        }
        // A function's calls: a one-shot names none
        if (options.function !== undefined && !(job.call.function.type === 'some' && job.call.function.value === options.function)) continue;
        if (options.state !== undefined && job.call.state.type !== options.state) continue;
        calls.push(job);
        if (calls.length >= options.limit) {
          // A full page names the next while records are left before its last
          if (at < entries.length - 1 || entries.length === LIST_PAGE) next = job.call.id;
          break scanning;
        }
      }
      if (entries.length < LIST_PAGE) break;
      before = entries[entries.length - 1]!.key;
    }
    if (expired.length > 0) await this.forget(expired);
    return next === undefined ? { calls } : { calls, next };
  }

  /**
   * Deletes every expired call of a repository: what gc's sweep does, beside
   * the reads that delete one as they pass it.
   *
   * @param repo - Repository identifier
   * @param dryRun - Count them, and delete none
   * @returns How many expired calls there were
   */
  async sweepExpired(repo: string, dryRun: boolean): Promise<number> {
    const prefix = recordKeys.kind(repo, 'call');
    let count = 0;
    let after: RecordKey | undefined;
    for (;;) {
      const entries = await this.records.scan(prefix, { limit: SWEEP_PAGE, ...(after !== undefined && { after }) });
      const expired = entries.filter(({ value }) => {
        const job = decoded(value);
        return job !== null && this.expired(job);
      }).map(({ key }) => key);
      count += expired.length;
      if (!dryRun && expired.length > 0) await this.forget(expired);
      if (entries.length < SWEEP_PAGE) return count;
      after = entries[entries.length - 1]!.key;
    }
  }

  /** The prefix of a workspace's calls' keys, its name checked. */
  private prefix(repo: string, workspace: string): RecordKey {
    checkName('workspace', workspace);
    return [...recordKeys.kind(repo, 'call'), workspace];
  }

  /** A call's key, its workspace's name and its id checked. */
  private key(repo: string, workspace: string, id: string): RecordKey {
    checkName('workspace', workspace);
    checkId('call id', id);
    return recordKeys.call(repo, workspace, id);
  }

  /** The call a key holds in a transaction, or `null` when there is none, or
   *  it has expired, which the transaction deletes. */
  private async live(tx: RecordsTransaction, key: RecordKey): Promise<FunctionCallJob | null> {
    const data = await tx.get(key);
    if (data === null) return null;
    const job = decodeFunctionCallJob(data);
    if (!this.expired(job)) return job;
    tx.delete(key);
    return null;
  }

  /** Deletes the calls at the keys that are still expired: one written again
   *  meanwhile is left. */
  private async forget(keys: readonly RecordKey[]): Promise<void> {
    await this.records.transact(async (tx) => {
      for (const key of keys) {
        const data = await tx.get(key);
        const job = data === null ? null : decoded(data);
        if (job !== null && this.expired(job)) tx.delete(key);
      }
    });
  }

  private expired(job: FunctionCallJob): boolean {
    return job.call.expiresAt.getTime() <= this.now();
  }
}
