/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { some } from '@elaraai/east';
import { decodeFunctionCallJob, encodeFunctionCallJob, type FunctionCallCancel, type FunctionCallJob } from '@elaraai/e3-types';
import type { FunctionCallEnd, FunctionCallListOptions, FunctionCallListPage, FunctionCallStore, StoredFunctionCall } from '../interfaces.js';
import { checkId, checkName, checkPageLimit } from '../../errors.js';
import type { InMemoryRepositoryRecords } from './InMemoryRepoStore.js';

/**
 * In-memory implementation of {@link FunctionCallStore} for testing.
 *
 * A call is held by its repository, its workspace and its id, as the bytes a
 * store keeps, so a call an earlier release filed is held as that release
 * wrote it, and read as a local repository's call file is: a read of it is
 * refused, and a list passes it. A call past its `expiresAt` is dropped as a
 * read or a list passes it, as a local repository's call file is removed. A
 * workspace's removal drops its calls
 * ({@link InMemoryFunctionCallStore.removeWorkspace}), and a repository's drops
 * every one of them.
 */
/* eslint-disable @typescript-eslint/require-await */
export class InMemoryFunctionCallStore implements FunctionCallStore, InMemoryRepositoryRecords {
  private calls = new Map<string, Uint8Array>();

  /**
   * @param now - Reads the time, in epoch milliseconds, which a call's expiry
   *   is measured by (default `Date.now`)
   */
  constructor(private readonly now: () => number = Date.now) {}

  async create(repo: string, job: FunctionCallJob): Promise<void> {
    const key = this.key(repo, job.workspace, job.call.id);
    if (this.live(key) !== null) throw new Error(`workspace '${job.workspace}' keeps a call ${job.call.id} already`);
    this.calls.set(key, encodeFunctionCallJob(job));
  }

  async get(repo: string, workspace: string, id: string): Promise<FunctionCallJob | null> {
    return this.live(this.key(repo, workspace, id));
  }

  async end(repo: string, workspace: string, id: string, end: FunctionCallEnd): Promise<FunctionCallJob | null> {
    const key = this.key(repo, workspace, id);
    const job = this.live(key);
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
    this.calls.set(key, encodeFunctionCallJob(ended));
    return ended;
  }

  async requestCancel(repo: string, workspace: string, id: string, cancel: FunctionCallCancel): Promise<FunctionCallJob | null> {
    const key = this.key(repo, workspace, id);
    const job = this.live(key);
    if (job === null || job.call.state.type !== 'running' || job.cancel.type === 'some') return job;
    const asked: FunctionCallJob = { ...job, cancel: some(cancel) };
    this.calls.set(key, encodeFunctionCallJob(asked));
    return asked;
  }

  async pinInputs(repo: string, workspace: string, id: string, inputs: FunctionCallJob['call']['inputs']): Promise<FunctionCallJob | null> {
    const key = this.key(repo, workspace, id);
    const job = this.live(key);
    if (job === null || job.call.state.type !== 'running') return job;
    const pinned: FunctionCallJob = { ...job, call: { ...job.call, inputs } };
    this.calls.set(key, encodeFunctionCallJob(pinned));
    return pinned;
  }

  async list(repo: string, workspace: string, options: FunctionCallListOptions): Promise<FunctionCallListPage> {
    checkPageLimit(options.limit);
    if (options.before !== undefined) checkId('call id', options.before);
    const prefix = this.prefix(repo, workspace);
    const ids = [...this.calls.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .filter((id) => options.before === undefined || id < options.before)
      .sort()
      .reverse();
    const calls: FunctionCallJob[] = [];
    for (const [at, id] of ids.entries()) {
      let job: FunctionCallJob | null;
      try {
        job = this.live(`${prefix}${id}`);
      } catch {
        // Bytes that do not decode keep no call a reader can be shown
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

  async readStored(repo: string): Promise<StoredFunctionCall[]> {
    const stored: StoredFunctionCall[] = [];
    for (const key of this.calls.keys()) {
      const [of, workspace, id] = key.split('\0');
      if (of !== repo || workspace === undefined || id === undefined) continue;
      stored.push({
        workspace,
        id,
        read: async () => this.calls.get(key) ?? null,
        replace: async (bytes) => {
          this.calls.set(key, bytes);
        },
      });
    }
    return stored;
  }

  /**
   * Drops a workspace's calls: what its removal does.
   *
   * @param repo - Repository identifier
   * @param workspace - The workspace
   */
  removeWorkspace(repo: string, workspace: string): void {
    const prefix = this.prefix(repo, workspace);
    for (const key of [...this.calls.keys()]) {
      if (key.startsWith(prefix)) this.calls.delete(key);
    }
  }

  drop(repo: string): number {
    let dropped = 0;
    for (const key of [...this.calls.keys()]) {
      if (!key.startsWith(`${repo}\0`)) continue;
      this.calls.delete(key);
      dropped++;
    }
    return dropped;
  }

  clear(): void {
    this.calls.clear();
  }

  /** The prefix of a workspace's calls' keys, its name refused when it cannot be one path segment. */
  private prefix(repo: string, workspace: string): string {
    checkName('workspace', workspace);
    return `${repo}\0${workspace}\0`;
  }

  /** A call's key, its workspace's name and its id checked. */
  private key(repo: string, workspace: string, id: string): string {
    const prefix = this.prefix(repo, workspace);
    checkId('call id', id);
    return `${prefix}${id}`;
  }

  /**
   * The call a key holds, or null when there is none or it has expired, which
   * drops it.
   *
   * @throws {Error} When its bytes are not a kept call of this release's form
   */
  private live(key: string): FunctionCallJob | null {
    const bytes = this.calls.get(key);
    if (bytes === undefined) return null;
    const job = decodeFunctionCallJob(bytes);
    if (job.call.expiresAt.getTime() <= this.now()) {
      this.calls.delete(key);
      return null;
    }
    return job;
  }
}
