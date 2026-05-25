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
 * Check if a process is still alive based on stored identification.
 * Falls back to process.kill(pid, 0) when /proc is unavailable (macOS, Windows).
 */
export async function isProcessAlive(
  pid: number,
  pidStartTime: number,
  bootId: string
): Promise<boolean> {
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
