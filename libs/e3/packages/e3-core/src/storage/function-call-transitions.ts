/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The transitions every function call store (`FunctionCallStore`) makes of a kept call (east-workspace#1554, #1619): each a pure
 * function of the call as the store read it, which the store applies and writes in one atomic step of its own — a
 * lock over a file, a records transaction, a conditional write. A transition that does not apply leaves the call as
 * it is: the first end stands, a cancel is asked once, and only a running call's inputs are pinned. Beside them, when
 * a call is past its lifetime, and whether a list's options take it — the rules every backend's reads and lists keep.
 *
 * The store's behaviour, these among it, is `functionCallStoreTests`, which every backend runs.
 *
 * @packageDocumentation
 */

import { some } from '@elaraai/east';
import type { FunctionCallCancel, FunctionCallJob } from '@elaraai/e3-types';
import type { FunctionCallEnd, FunctionCallListOptions } from './interfaces.js';

/**
 * The call as its end leaves it: its end's state, times and logs.
 *
 * @param job - The call, as the store holds it
 * @param end - How it ended
 * @returns The ended call; `undefined` for one that has ended already, whose first end stands
 */
export function callEnded(job: FunctionCallJob, end: FunctionCallEnd): FunctionCallJob | undefined {
  if (job.call.state.type !== 'running') return undefined;
  return {
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
}

/**
 * The call asked to cancel, its request a field of its record, which its run looks for.
 *
 * @param job - The call, as the store holds it
 * @param cancel - Who asked, and when
 * @returns The call asked; `undefined` for one that has ended, or was asked already, whose first request stands
 */
export function callCancelAsked(job: FunctionCallJob, cancel: FunctionCallCancel): FunctionCallJob | undefined {
  if (job.call.state.type !== 'running' || job.cancel.type === 'some') return undefined;
  return { ...job, cancel: some(cancel) };
}

/**
 * The call naming the inputs its run reads, once its drafts are laid (#1619): the drafted states are named by nothing
 * else, so gc keeps what a kept call's inputs name from then on.
 *
 * @param job - The call, as the store holds it
 * @param inputs - The inputs it reads
 * @returns The call, its inputs pinned; `undefined` for one that has ended
 */
export function callInputsPinned(job: FunctionCallJob, inputs: FunctionCallJob['call']['inputs']): FunctionCallJob | undefined {
  if (job.call.state.type !== 'running') return undefined;
  return { ...job, call: { ...job.call, inputs } };
}

/**
 * One of a call's transitions, applied to the call as a store read it in its atomic step: the call the transition
 * leaves, written through the store's own write and answered; or, where the transition does not apply, the call as it
 * is — `null` for none. A store whose write is synchronous writes before this yields, so its step stays one.
 *
 * @param job - The call as the store read it, or `null` for none
 * @param next - The transition ({@link callEnded}, {@link callCancelAsked}, {@link callInputsPinned})
 * @param write - Writes the call the transition leaves, in the store's step
 * @returns The call as it stands after the step
 */
export async function applyCallTransition(
  job: FunctionCallJob | null,
  next: (job: FunctionCallJob) => FunctionCallJob | undefined,
  write: (moved: FunctionCallJob) => void | Promise<void>,
): Promise<FunctionCallJob | null> {
  const moved = job === null ? undefined : next(job);
  if (moved === undefined) return job;
  await write(moved);
  return moved;
}

/**
 * Whether a call is past the lifetime its end gives it: every read leaves it out, and a store whose items do not
 * expire on their own removes it as a read passes it.
 *
 * @param job - The call
 * @param now - The time, in epoch milliseconds
 * @returns Whether it has expired
 */
export function callExpired(job: FunctionCallJob, now: number): boolean {
  return job.call.expiresAt.getTime() <= now;
}

/**
 * Whether a list takes a call: of the function it names, when it names one — a one-shot names none — and in the state
 * it names, when it names one.
 *
 * @param job - The call
 * @param options - The list's options
 * @returns Whether the list takes it
 */
export function callListed(job: FunctionCallJob, options: Pick<FunctionCallListOptions, 'function' | 'state'>): boolean {
  if (options.function !== undefined && !(job.call.function.type === 'some' && job.call.function.value === options.function)) return false;
  return options.state === undefined || job.call.state.type === options.state;
}
