/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A rack's run through a session's hub: granted as a run lease
 * (`RackRunEvent`), asked task by task over the hub's control socket, each
 * answer told back as an event of the session's.
 */

import { encodeBeast2For } from '@elaraai/east';
import {
  descriptionRoots, gcObjectReaders, markReachable, uuidv7,
  type ReplicaRun, type ReplicaRunAnswer, type StorageBackend,
} from '@elaraai/e3-core';
import { SyncDescriptionType } from '@elaraai/e3-types';
import type { LeaseHandle, RackSession } from '../client/session.js';
import { encodeClosure } from '../lease/closure.js';
import { RACK_LEASE_VERSION, type RackLeaseEvent, type RackRunVerdict } from '../protocol/task-envelope.js';
import type { RackVerdict } from '../runner/rack-lease.js';

/** How a session's rack run is made. */
export interface SessionRunOptions {
  /** The session's repository's storage */
  readonly storage: StorageBackend;
  /** The session's repository */
  readonly repo: string;
  /** The workspace its run runs */
  readonly workspace: string;
  /** Each granted task's verdict, by name */
  readonly verdicts: ReadonlyMap<string, RackVerdict>;
  /** How long a rack has to claim the run before it is given up, in ms */
  readonly claimTimeoutMs: number;
  /** The longest the run may take, in ms */
  readonly timeoutMs: number;
  /** Ends the wait for a rack to take the run up, and gives the run up */
  readonly signal?: AbortSignal;
}

/** A rack's run through a session, and the rack that took it up. */
export interface SessionReplicaRun extends ReplicaRun {
  /** The rack that took the run up, and its lease, once one has */
  placedOn(): { readonly rackLabel: string; readonly leaseId: string } | undefined;
}

/** An answer's JSON, read as a replica's answer: unknown when it does not read. */
function readAnswer(json: string): ReplicaRunAnswer {
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    if (value.kind === 'handed-back' && typeof value.reason === 'string') return { kind: 'handed-back', reason: value.reason };
    if (value.kind === 'done' && (value.state === 'success' || value.state === 'failed' || value.state === 'error')
      && typeof value.startedAtMs === 'number' && typeof value.durationMs === 'number') {
      return {
        kind: 'done', state: value.state, startedAtMs: value.startedAtMs, durationMs: value.durationMs,
        ...(typeof value.outputHash === 'string' && { outputHash: value.outputHash }),
        ...(typeof value.exitCode === 'number' && { exitCode: value.exitCode }),
        ...(typeof value.error === 'string' && { error: value.error }),
        ...(typeof value.peakBytes === 'number' && { peakBytes: value.peakBytes }),
      };
    }
  } catch {
    // An answer that does not read is none
  }
  return { kind: 'unknown' };
}

/**
 * A rack's run through a session: its grant writes the description and the
 * closure of everything it reaches as objects, queues a run lease for every
 * tier its tasks need, and waits for a rack to claim it. Each ask goes to the
 * hub, which gives it to the lease's rack; the task's log, as the rack sends
 * it, is teed to the ask's `onLog`; and the answer comes back as an event of
 * the session's. Once the lease is lost, every ask still waiting rejects: its
 * asker runs the task here, its rack's run lost. Once it ends otherwise,
 * cancelled or completed, or the run is cancelled here, each answers
 * `unknown`, as a replica's cancelled run does.
 *
 * @param session - The session
 * @param options - The repository, the verdicts, the claim's and the run's
 *   time limits, and what gives the run up
 * @returns The run
 *
 * @example
 * ```ts
 * const run = sessionReplicaRun(session, { storage, repo, workspace: 'dev', verdicts, claimTimeoutMs: 30_000, timeoutMs: 3_600_000 });
 * await run.grant({ description, force: false });
 * const answer = await run.ask({ taskName: 'train', taskHash, inputsHash, onLog: (stream, text) => process.stdout.write(text) });
 * await run.cancel();
 * ```
 */
export function sessionReplicaRun(session: RackSession, options: SessionRunOptions): SessionReplicaRun {
  const { storage, repo, workspace, verdicts } = options;
  let handle: LeaseHandle | undefined;
  let placed: { rackLabel: string; leaseId: string } | undefined;
  let ended: { why: string; lost: boolean } | undefined;
  let offAnswer: (() => void) | undefined;
  const waiting = new Map<bigint, { resolve: (answer: ReplicaRunAnswer) => void; reject: (error: Error) => void }>();
  // An answer told before its ask's number was known
  const early = new Map<bigint, ReplicaRunAnswer>();
  const end = (why: string, lost: boolean): void => {
    ended ??= { why, lost };
    for (const each of waiting.values()) {
      if (lost) each.reject(new Error(why));
      else each.resolve({ kind: 'unknown' });
    }
    waiting.clear();
  };

  return {
    placedOn: () => placed,

    async grant(grant) {
      if (handle !== undefined) throw new Error('A rack\'s run takes one grant');
      const description = await storage.objects.write(repo, encodeBeast2For(SyncDescriptionType)(grant.description));
      // What the run may read: the description, and everything it reaches
      const roots = descriptionRoots(grant.description);
      const { readObject, readHead } = gcObjectReaders(storage, repo);
      const reached = await markReachable(readObject, new Set(roots), { readHead });
      for (const root of roots) reached.add(root);
      const hashes = [description, ...[...reached].filter((hash) => hash !== description)];
      const closure = await storage.objects.write(repo, encodeClosure(hashes));
      const tiers = [...new Set([...verdicts.values()].map((verdict) => verdict.tier))];
      const said: Record<string, RackRunVerdict> = {};
      for (const [name, verdict] of verdicts) {
        said[name] = { tier: verdict.tier, size: verdict.size, timeoutMinutes: verdict.timeoutMinutes, memoryLimit: verdict.memoryLimit, gpu: verdict.gpu };
      }
      const event: RackLeaseEvent = {
        version: RACK_LEASE_VERSION, taskName: 'run', workspace, closure: { object: closure, count: hashes.length },
        runnerEvent: { mode: 'run', launchId: uuidv7(), repo: session.repoAlias, timeoutMs: options.timeoutMs, description,
          force: grant.force === true ? true : Array.isArray(grant.force) ? [...grant.force] : false, tiers, verdicts: said },
      };
      const leased = await session.createLease({ eventJson: JSON.stringify(event), tier: tiers[0] ?? 'node', computeSize: 'large', envManifests: [] });
      handle = leased;
      offAnswer = session.onAnswer(leased.leaseId, (seq, json) => {
        const answer = readAnswer(json);
        const asker = waiting.get(seq);
        if (asker === undefined) { early.set(seq, answer); return; }
        waiting.delete(seq);
        asker.resolve(answer);
      });
      // A rack takes it up within the claim timeout, or it is given up, as
      // it is when the caller stops first
      let timer: NodeJS.Timeout | undefined;
      let stopped: (() => void) | undefined;
      const first = await Promise.race([
        leased.next(),
        new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), options.claimTimeoutMs); timer.unref(); }),
        new Promise<'stopped'>((resolve) => {
          stopped = () => resolve('stopped');
          if (options.signal?.aborted) stopped();
          else options.signal?.addEventListener('abort', stopped, { once: true });
        }),
      ]).finally(() => {
        clearTimeout(timer);
        if (stopped !== undefined) options.signal?.removeEventListener('abort', stopped);
      });
      if (first === 'timeout' || first === 'stopped' || first.kind !== 'claimed') {
        offAnswer();
        await leased.cancel().catch(() => undefined);
        throw new Error(first === 'timeout' ? `no rack took the run up within ${Math.round(options.claimTimeoutMs / 1000)} s`
          : first === 'stopped' ? 'the run was stopped before a rack took it up'
            : `the run's lease ended before a rack took it up (${first.kind})`);
      }
      placed = { rackLabel: first.rackLabel, leaseId: leased.leaseId };
      // Its end, however it comes, ends every ask still waiting; a claim
      // after the first is another rack taking it up
      void (async () => {
        for (;;) {
          const update = await leased.next();
          if (update.kind === 'claimed') {
            placed = { rackLabel: update.rackLabel, leaseId: leased.leaseId };
            continue;
          }
          end(`its rack's run ${update.kind === 'lost' ? `was lost: ${update.reason}` : update.kind}`, update.kind === 'lost');
          return;
        }
      })();
    },

    async ask(ask) {
      if (handle === undefined || ask.signal?.aborted) return { kind: 'unknown' };
      const { leaseId } = handle;
      if (ended !== undefined) {
        if (ended.lost) throw new Error(ended.why);
        return { kind: 'unknown' };
      }
      // An abort heard from the start, while the ask is posted too: it
      // answers unknown at once
      let seq: bigint | undefined;
      let aborted!: () => void;
      const stopped = new Promise<ReplicaRunAnswer>((resolve) => {
        aborted = () => {
          if (seq !== undefined) waiting.delete(seq);
          resolve({ kind: 'unknown' });
        };
      });
      ask.signal?.addEventListener('abort', aborted, { once: true });
      // The id the task's log is teed under: the asker's attempt writes it
      const tee = uuidv7();
      const untee = ask.onLog === undefined ? undefined : session.onLog(tee, ask.onLog);
      try {
        const answered = (async (): Promise<ReplicaRunAnswer> => {
          seq = await session.askRun(leaseId, { taskName: ask.taskName, taskHash: ask.taskHash, inputsHash: ask.inputsHash, executionId: tee });
          const told = early.get(seq);
          if (told !== undefined) {
            early.delete(seq);
            return told;
          }
          const asked = seq;
          return new Promise<ReplicaRunAnswer>((resolve, reject) => {
            if (ended !== undefined) {
              if (ended.lost) reject(new Error(ended.why));
              else resolve({ kind: 'unknown' });
              return;
            }
            waiting.set(asked, { resolve, reject });
          });
        })();
        return await Promise.race([answered, stopped]);
      } finally {
        ask.signal?.removeEventListener('abort', aborted);
        untee?.();
      }
    },

    async cancel() {
      end('cancelled', false);
      offAnswer?.();
      await handle?.cancel().catch(() => undefined);
    },
  };
}
