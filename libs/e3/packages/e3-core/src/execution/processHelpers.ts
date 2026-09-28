/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Process identification helpers for crash detection.
 *
 * These functions are used by LocalTaskRunner and LocalLockService
 * to detect stale processes and locks after crashes or reboots.
 */

import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ExecutionOwner } from '@elaraai/e3-types';

const execFileAsync = promisify(execFile);

/**
 * Get the current system boot ID.
 * Used for detecting stale locks/processes after system reboot.
 */
export async function getBootId(): Promise<string> {
  // Linux
  try {
    return (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf-8')).trim();
  } catch {}
  // macOS: sysctl kern.boottime → "{ sec = 1234567890, usec = 0 } ..."
  try {
    const { stdout } = await execFileAsync('sysctl', ['-n', 'kern.boottime']);
    const m = stdout.match(/\bsec\s*=\s*(\d+)/);
    if (m) return `macos-${m[1]}`;
  } catch {}
  return 'unknown-boot-id';
}

/**
 * Get process start time as an opaque integer for PID-reuse detection.
 * Returns 0 if the process doesn't exist or the platform isn't supported.
 */
export async function getPidStartTime(pid: number): Promise<number> {
  // Linux: /proc/<pid>/stat field 22 (starttime in jiffies since boot)
  try {
    const data = await fs.readFile(`/proc/${pid}/stat`, 'utf-8');
    const closeParen = data.lastIndexOf(')');
    const fields = data.slice(closeParen + 2).split(' ');
    return parseInt(fields[19], 10);
  } catch {}
  // macOS: ps -p <pid> -o lstart= → "Wed Nov  6 12:34:56 2024" or empty if dead
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'lstart=']);
    const trimmed = stdout.trim();
    if (!trimmed) return 0;
    const t = new Date(trimmed).getTime();
    return isNaN(t) ? 0 : Math.floor(t / 1000);
  } catch {}
  return 0;
}

/**
 * This process as an execution's owner: the one that writes the execution's
 * outcome, which a probe finds exited when the execution cannot finish.
 *
 * @returns This process's pid, start time and boot id
 */
export async function processOwner(): Promise<ExecutionOwner> {
  return {
    pid: BigInt(process.pid),
    pidStartTime: BigInt(await getPidStartTime(process.pid)),
    bootId: await getBootId(),
  };
}

/** Whether a process with `pid` exists — signal 0 sends nothing.
 *
 *  EPERM is an existence answer, not a denial of one: the process is there,
 *  it just is not ours to signal (another user's orchestrator, or a reused
 *  pid). Reading it as "gone" would delete a live process's files. A pid
 *  below 1 is no process — and POSIX would read 0 and -1 as this process
 *  group and every process. */
function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Whether the process a directory's name records — its pid, and its start
 * time as {@link getPidStartTime} gave it — has exited.
 *
 * Both start times must be known for the comparison to mean anything: the
 * writer records 0 where its own platform could not answer, and comparing that
 * against a start time this process CAN resolve says "exited" about a live
 * owner. With either unknown, the pid's existence decides.
 *
 * @param pid - The recorded pid
 * @param recordedStartTime - The recorded start time, 0 when it was unknown
 * @returns Whether that process has exited
 */
export async function processExited(pid: number, recordedStartTime: number): Promise<boolean> {
  const startTime = await getPidStartTime(pid);
  return startTime !== 0 && recordedStartTime !== 0 ? startTime !== recordedStartTime : !processExists(pid);
}

/**
 * Check if a process is still alive based on stored identification.
 * Falls back to process.kill(pid, 0) when /proc is unavailable (macOS, Windows).
 *
 * A pid below 1 is never a process — see the guard's comment.
 */
export async function isProcessAlive(
  pid: number,
  pidStartTime: number,
  bootId: string
): Promise<boolean> {
  // No process has a pid below 1, and the fallback below must never be
  // reached with one: POSIX reads `kill(-1, 0)` as "every process I may
  // signal" and `kill(0, 0)` as this process group, both of which answer
  // "alive" — so a record written for a spawn that produced no pid (`-1`)
  // would be reported running forever and never repaired.
  if (!Number.isInteger(pid) || pid < 1) return false;

  const currentBootId = await getBootId();

  // Only use boot ID comparison when both sides have real values
  if (currentBootId !== 'unknown-boot-id' && bootId !== 'unknown-boot-id') {
    if (currentBootId !== bootId) return false;
  }

  const currentStartTime = await getPidStartTime(pid);
  if (currentStartTime !== 0) {
    // Start time available — use it for precise PID-reuse detection
    return currentStartTime === pidStartTime;
  }

  // Fallback: signal 0 checks existence without sending a signal (cross-platform)
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
