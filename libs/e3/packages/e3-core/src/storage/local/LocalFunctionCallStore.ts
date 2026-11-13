/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { some } from '@elaraai/east';
import { decodeFunctionCallJob, encodeFunctionCallJob, type FunctionCallCancel, type FunctionCallJob } from '@elaraai/e3-types';
import type { FunctionCallEnd, FunctionCallListOptions, FunctionCallListPage, FunctionCallStore, StoredFunctionCall } from '../interfaces.js';
import { checkId, checkName, checkPageLimit, isNotFoundError } from '../../errors.js';
import { withKeyedLock } from '../../keyed-mutex.js';
import { isUuidv7 } from '../../uuid.js';
import { atomicWriteFile, readReplacedFile, unlinkWithRetry } from './localHelpers.js';

/** A call's file's extension. */
const CALL_EXTENSION = '.beast2';

/**
 * Local filesystem implementation of {@link FunctionCallStore}.
 *
 * A call is one file under its workspace's directory, by its id:
 *
 *   workspaces/<ws>/calls/<id>.beast2
 *
 * so a workspace's removal, which removes its directory, removes its calls.
 * A file is replaced whole (`atomicWriteFile`), and read in its turn
 * (`readReplacedFile`), and the writes of one call are taken one at a time in
 * this process: the local server is the one process that keeps a repository's
 * calls. A call past its `expiresAt` is removed as a read or a list passes it,
 * and as gc sweeps (`sweepExpiredCalls`).
 *
 * The `repo` parameter is the path to the e3 repository directory.
 */
export class LocalFunctionCallStore implements FunctionCallStore {
  /**
   * @param now - Reads the time, in epoch milliseconds, which a call's expiry
   *   is measured by (default `Date.now`)
   */
  constructor(private readonly now: () => number = Date.now) {}

  async create(repo: string, job: FunctionCallJob): Promise<void> {
    const file = callFile(repo, job.workspace, job.call.id);
    await withKeyedLock(file, async () => {
      if (await this.readLive(file) !== null) {
        throw new Error(`workspace '${job.workspace}' keeps a call ${job.call.id} already`);
      }
      await atomicWriteFile(file, encodeFunctionCallJob(job));
    });
  }

  async get(repo: string, workspace: string, id: string): Promise<FunctionCallJob | null> {
    return this.readLive(callFile(repo, workspace, id));
  }

  async end(repo: string, workspace: string, id: string, end: FunctionCallEnd): Promise<FunctionCallJob | null> {
    const file = callFile(repo, workspace, id);
    return withKeyedLock(file, async () => {
      const job = await this.readLive(file);
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
      await atomicWriteFile(file, encodeFunctionCallJob(ended));
      return ended;
    });
  }

  async requestCancel(repo: string, workspace: string, id: string, cancel: FunctionCallCancel): Promise<FunctionCallJob | null> {
    const file = callFile(repo, workspace, id);
    return withKeyedLock(file, async () => {
      const job = await this.readLive(file);
      if (job === null || job.call.state.type !== 'running' || job.cancel.type === 'some') return job;
      const asked: FunctionCallJob = { ...job, cancel: some(cancel) };
      await atomicWriteFile(file, encodeFunctionCallJob(asked));
      return asked;
    });
  }

  async list(repo: string, workspace: string, options: FunctionCallListOptions): Promise<FunctionCallListPage> {
    checkPageLimit(options.limit);
    if (options.before !== undefined) checkId('call id', options.before);
    const dir = callsDir(repo, workspace);
    const ids = (await callIds(dir)).filter((id) => options.before === undefined || id < options.before);
    const calls: FunctionCallJob[] = [];
    for (const [at, id] of ids.entries()) {
      let job: FunctionCallJob | null;
      try {
        job = await this.readLive(path.join(dir, `${id}${CALL_EXTENSION}`));
      } catch {
        // A file that does not decode keeps no call a reader can be shown
        continue;
      }
      if (job === null) continue;
      // A function's calls: a one-shot names none
      if (options.function !== undefined && !(job.call.function.type === 'some' && job.call.function.value === options.function)) continue;
      if (options.state !== undefined && job.call.state.type !== options.state) continue;
      calls.push(job);
      // A full page names the next while calls are left before its last
      if (calls.length >= options.limit) return at < ids.length - 1 ? { calls, next: id } : { calls };
    }
    return { calls };
  }

  /** Every call file of the repository, by its workspace's directory and its
   *  name: read as it is, and replaced whole in its turn among the call's
   *  writes. */
  async readStored(repo: string): Promise<StoredFunctionCall[]> {
    const stored: StoredFunctionCall[] = [];
    for (const workspace of await entries(path.join(repo, 'workspaces'))) {
      const dir = path.join(repo, 'workspaces', workspace, 'calls');
      for (const id of await callIds(dir)) {
        const file = path.join(dir, `${id}${CALL_EXTENSION}`);
        stored.push({
          workspace,
          id,
          read: async () => {
            try {
              return await readReplacedFile(file);
            } catch (err) {
              if (isNotFoundError(err)) return null;
              throw err;
            }
          },
          replace: (bytes) => withKeyedLock(file, () => atomicWriteFile(file, bytes)),
        });
      }
    }
    return stored;
  }

  /**
   * Remove every expired call of a repository: what gc's sweep does, beside
   * the reads that remove one as they pass it.
   *
   * @param repo - Path to the e3 repository directory
   * @param dryRun - Count them, and remove none
   * @returns How many expired calls there were
   */
  async sweepExpired(repo: string, dryRun: boolean): Promise<number> {
    let expired = 0;
    for (const workspace of await entries(path.join(repo, 'workspaces'))) {
      const dir = path.join(repo, 'workspaces', workspace, 'calls');
      for (const id of await callIds(dir)) {
        const file = path.join(dir, `${id}${CALL_EXTENSION}`);
        let job: FunctionCallJob | null;
        try {
          job = await this.readFile(file);
        } catch {
          continue;
        }
        if (job === null || !this.expired(job)) continue;
        expired++;
        if (!dryRun) await removeFile(file);
      }
    }
    return expired;
  }

  /** A call's file decoded, or null when there is none. */
  private async readFile(file: string): Promise<FunctionCallJob | null> {
    let bytes: Buffer;
    try {
      bytes = await readReplacedFile(file);
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
    return decodeFunctionCallJob(bytes);
  }

  /** A call's file decoded, or null when there is none, or it has expired, which removes it. */
  private async readLive(file: string): Promise<FunctionCallJob | null> {
    const job = await this.readFile(file);
    if (job === null) return null;
    if (this.expired(job)) {
      await removeFile(file);
      return null;
    }
    return job;
  }

  private expired(job: FunctionCallJob): boolean {
    return job.call.expiresAt.getTime() <= this.now();
  }
}

/** The directory a workspace's calls are kept in. */
function callsDir(repo: string, workspace: string): string {
  checkName('workspace', workspace);
  return path.join(repo, 'workspaces', workspace, 'calls');
}

/** The file a call is kept in. */
function callFile(repo: string, workspace: string, id: string): string {
  const dir = callsDir(repo, workspace);
  checkId('call id', id);
  return path.join(dir, `${id}${CALL_EXTENSION}`);
}

/** The ids of the calls a directory keeps, the latest first: a UUIDv7 orders as its time does. */
async function callIds(dir: string): Promise<string[]> {
  return (await entries(dir))
    .filter((name) => name.endsWith(CALL_EXTENSION))
    .map((name) => name.slice(0, -CALL_EXTENSION.length))
    .filter(isUuidv7)
    .sort()
    .reverse();
}

/** A directory's entries, or none when it is not there. */
async function entries(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw err;
  }
}

/** Removes a file, if it is there. */
async function removeFile(file: string): Promise<void> {
  try {
    await unlinkWithRetry(file);
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }
}
