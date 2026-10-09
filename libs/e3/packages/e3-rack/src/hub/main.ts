/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { pathToFileURL } from 'node:url';
import { RackHub } from './hub.js';

/**
 * Runs the shared hub until it is stopped, drained or idle.
 * Background callers redirect stdout/stderr to the private hub log; a
 * foreground invocation prints the same timestamped diagnostics directly.
 * @param argv - --foreground or --background, and optional --idle-exit minutes
 * @returns Once the owned listeners and lock are released
 * @throws {Error} When arguments, state or startup are invalid
 * @example
 * await runHub(['--foreground']);
 */
export async function runHub(argv: string[]): Promise<void> {
  let foreground = true;
  let idleExitMinutes: number | undefined;
  for (let index = 0; index < argv.length; index++) {
    switch (argv[index]) {
      case '--foreground': foreground = true; break;
      case '--background': foreground = false; break;
      case '--idle-exit': {
        idleExitMinutes = Number(argv[++index]);
        if (!Number.isFinite(idleExitMinutes) || idleExitMinutes < 0 || idleExitMinutes > 35000) throw new Error('--idle-exit requires 0–35000 minutes');
        break;
      }
      default: throw new Error(`Unknown rack hub option: ${argv[index]}`);
    }
  }
  if (!foreground) process.title = 'e3-rack-hub';
  const log = (line: string) => { process.stdout.write(`${new Date().toISOString()} ${line}\n`); };
  const hub = new RackHub({ foreground, idleExitMinutes, log });
  const stop = () => { void hub.stop().catch((err: unknown) => { console.error(err); process.exitCode = 1; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { if (await hub.start()) await hub.closed; } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runHub(process.argv.slice(2)).catch((err: unknown) => { console.error(err); process.exitCode = 1; });
}
