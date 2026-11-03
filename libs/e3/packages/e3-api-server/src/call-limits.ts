/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { parseMemory, type ExecuteCeilings } from '@elaraai/e3-core';
import { parseDuration } from './auth/index.js';

/**
 * The limits of the calls a server runs: a sync call's deadline, and the most
 * a request may ask for.
 */
export interface CallLimits {
  /** How long a one-shot or function call may run before it answers, in
   *  milliseconds: a call's timeout is held under it (default 120 000). A
   *  call that names no timeout of its own gets 60 000 within it. */
  syncDeadlineMs?: number;
  /** The most a one-shot or split call's request may ask for: the longest
   *  timeout, which a split call's job takes when it names none (default 10
   *  minutes); the largest result, which is also a request's default
   *  (default 1 MiB); and the most of each log's tail (default 256 KiB). A
   *  result is held in the server's memory while it is answered. */
  ceilings?: ExecuteCeilings;
}

/** A server's call limits, as `--call-deadline`, `--job-timeout`,
 *  `--max-result` and `--max-log` give them. */
export interface CallLimitSettings {
  /** A sync call's deadline (`--call-deadline`), as `90s` or `15m`. */
  callDeadline?: string;
  /** The longest a split call's job may run (`--job-timeout`), as `30m` or
   *  `2h`. */
  jobTimeout?: string;
  /** The largest result (`--max-result`), as `8M`. */
  maxResult?: string;
  /** The most of each log's tail (`--max-log`), as `1M`. */
  maxLog?: string;
}

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
 *   positive size, naming the flag it came from.
 */
export function resolveCallLimits(settings: CallLimitSettings): CallLimits {
  const duration = (flag: string, text: string): number => {
    const ms = durationMs(text);
    if (ms === null) throw new RangeError(`${flag} must be a duration, as 90s, 15m or 2h, got '${text}'`);
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
 * every one, so the server is told as it is made.
 *
 * @param limits - The limits
 * @returns The limits
 * @throws {RangeError} When a limit is not a positive number of milliseconds,
 *   or of bytes, naming it.
 */
export function checkCallLimits(limits: CallLimits): CallLimits {
  const check = (name: string, value: number | undefined, bytes: boolean): void => {
    if (value === undefined || (bytes ? Number.isSafeInteger(value) : Number.isFinite(value)) && value > 0) return;
    throw new RangeError(`calls.${name} must be a positive ${bytes ? 'whole number of bytes' : 'number of milliseconds'}, got ${value}`);
  };
  check('syncDeadlineMs', limits.syncDeadlineMs, false);
  check('ceilings.timeoutMs', limits.ceilings?.timeoutMs, false);
  check('ceilings.maxResultBytes', limits.ceilings?.maxResultBytes, true);
  check('ceilings.maxLogBytes', limits.ceilings?.maxLogBytes, true);
  return limits;
}
