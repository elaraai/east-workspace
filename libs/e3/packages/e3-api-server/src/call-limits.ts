/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { parseMemory, type ExecuteCeilings, type FunctionCallLifetimes } from '@elaraai/e3-core';
import { parseDuration } from './auth/index.js';

/**
 * The limits of the calls a server runs: a sync call's deadline, the most a
 * request may ask for, and how a kept call of a workspace's function is
 * waited for and kept.
 */
export interface CallLimits {
  /** How long a one-shot or sync function call may run before it answers, in
   *  milliseconds: a call's timeout is held under it (default 120 000). A
   *  call that names no timeout of its own gets 60 000 within it. */
  syncDeadlineMs?: number;
  /** The most a one-shot call's, a split call's or a function call's request
   *  may ask for, through a package or a workspace: the longest timeout, which
   *  a split call's job and a kept call take when they name none (default 10
   *  minutes); the largest result, which is also a request's default (default
   *  1 MiB); and the most of each log's tail (default 256 KiB). A result is
   *  held in the server's memory while it is answered. */
  ceilings?: ExecuteCeilings;
  /** How long a kept call's start waits for it to end before it answers
   *  `running`, in milliseconds (default 20 000) */
  windowMs?: number;
  /** The longest a poll of a kept call is held, in milliseconds (default
   *  20 000) */
  pollWaitMs?: number;
  /** How long a kept call is kept once it ends (default: an hour for a
   *  success or a cancel, a week for any other end) */
  lifetimes?: FunctionCallLifetimes;
}

/** A server's call limits, as `--call-deadline`, `--job-timeout`,
 *  `--max-result` and `--max-log` give them. */
export interface CallLimitSettings {
  /** A sync call's deadline (`--call-deadline`), as `90s` or `15m`. */
  callDeadline?: string;
  /** The longest a split call's job, or a kept call, may run
   *  (`--job-timeout`), as `30m` or `2h`. */
  jobTimeout?: string;
  /** The largest result (`--max-result`), as `8M`. */
  maxResult?: string;
  /** The most of each log's tail (`--max-log`), as `1M`. */
  maxLog?: string;
}

/** The longest a timer waits, in milliseconds: a call's deadline, its timeout,
 *  a start's window and a poll's wait each become one, and Node's
 *  `setTimeout`, as a browser's, fires at once for a delay past 2^31 - 1 ms,
 *  about 24.8 days. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

/** The milliseconds of a duration a flag gives, or `null` when it is not a
 *  positive one. */
function durationMs(text: string): number | null {
  try {
    const seconds = parseDuration(text.trim());
    return seconds > 0 ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * The call limits the flags give, each left to the server's default when its
 * flag is not given.
 *
 * @param settings - The flags given
 * @returns The limits
 * @throws {RangeError} When a value given is not a positive duration or a
 *   positive size, or a duration is longer than a timer waits, naming the
 *   flag it came from.
 */
export function resolveCallLimits(settings: CallLimitSettings): CallLimits {
  const duration = (flag: string, text: string): number => {
    const ms = durationMs(text);
    if (ms === null) throw new RangeError(`${flag} must be a duration, as 90s, 15m or 2h, got '${text}'`);
    if (ms > LONGEST_TIMER_MS) {
      throw new RangeError(`${flag} must be at most about 24.8 days (${LONGEST_TIMER_MS} ms), the longest a timer waits, got '${text}'`);
    }
    return ms;
  };
  const size = (flag: string, text: string): number => {
    const bytes = parseMemory(text);
    if (bytes === null) {
      throw new RangeError(`${flag} must be a size in bytes, or with a K, M, G or T suffix (binary units, as 8M), got '${text}'`);
    }
    return bytes;
  };
  const ceilings: ExecuteCeilings = {
    ...(settings.jobTimeout !== undefined && { timeoutMs: duration('--job-timeout', settings.jobTimeout) }),
    ...(settings.maxResult !== undefined && { maxResultBytes: size('--max-result', settings.maxResult) }),
    ...(settings.maxLog !== undefined && { maxLogBytes: size('--max-log', settings.maxLog) }),
  };
  return {
    ...(settings.callDeadline !== undefined && { syncDeadlineMs: duration('--call-deadline', settings.callDeadline) }),
    ...(Object.keys(ceilings).length > 0 && { ceilings }),
  };
}

/**
 * Checks a server's call limits: a limit no call could meet would refuse
 * every one, so the server is told as it is made. A kept call's window and a
 * poll's wait may be 0, which answers at once. A deadline, a timeout, a window
 * and a wait each become a timer, which fires at once past the longest it
 * waits, so none may be longer; a lifetime is a time a call is kept until,
 * and may be.
 *
 * @param limits - The limits
 * @returns The limits
 * @throws {RangeError} When a limit is not a positive number of milliseconds,
 *   or of bytes, naming it, or a window or wait is negative, or one that
 *   becomes a timer is longer than a timer waits.
 */
export function checkCallLimits(limits: CallLimits): CallLimits {
  const check = (name: string, value: number | undefined, bytes: boolean): void => {
    if (value === undefined || (bytes ? Number.isSafeInteger(value) : Number.isFinite(value)) && value > 0) return;
    throw new RangeError(`calls.${name} must be a positive ${bytes ? 'whole number of bytes' : 'number of milliseconds'}, got ${value}`);
  };
  const checkWait = (name: string, value: number | undefined): void => {
    if (value === undefined || Number.isFinite(value) && value >= 0) return;
    throw new RangeError(`calls.${name} must be a number of milliseconds, 0 or more, got ${value}`);
  };
  const checkTimer = (name: string, value: number | undefined): void => {
    if (value === undefined || value <= LONGEST_TIMER_MS) return;
    throw new RangeError(`calls.${name} must be at most ${LONGEST_TIMER_MS} ms (about 24.8 days), the longest a timer waits, got ${value}`);
  };
  check('syncDeadlineMs', limits.syncDeadlineMs, false);
  check('ceilings.timeoutMs', limits.ceilings?.timeoutMs, false);
  check('ceilings.maxResultBytes', limits.ceilings?.maxResultBytes, true);
  check('ceilings.maxLogBytes', limits.ceilings?.maxLogBytes, true);
  checkWait('windowMs', limits.windowMs);
  checkWait('pollWaitMs', limits.pollWaitMs);
  check('lifetimes.succeededMs', limits.lifetimes?.succeededMs, false);
  check('lifetimes.failedMs', limits.lifetimes?.failedMs, false);
  checkTimer('syncDeadlineMs', limits.syncDeadlineMs);
  checkTimer('ceilings.timeoutMs', limits.ceilings?.timeoutMs);
  checkTimer('windowMs', limits.windowMs);
  checkTimer('pollWaitMs', limits.pollWaitMs);
  return limits;
}
