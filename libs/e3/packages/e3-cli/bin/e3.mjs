#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 *
 * Static bin shim — exists in fresh checkout so pnpm install can create
 * the bin symlink BEFORE the package is built. Runs the built CLI in node
 * with `--stack-size=8192` because e3's IR walker recurses deep on large
 * datasets; the prior cli.js shebang carried the same flag, but a shebang on
 * this wrapper file is ignored when npm invokes it as `node bin/e3.mjs`.
 *
 * Where the platform can, this process becomes the CLI (`process.execve`):
 * one process, so a signal sent to `e3` — a timeout's, a supervisor's, a
 * script's kill — reaches the command, a shell waits for the command itself,
 * and the exit is the command's own. Elsewhere — Windows, a Node before
 * `process.execve` — the CLI is a child of this process, which outlives it,
 * passes a SIGTERM on to it, and exits as it did. A terminal's Ctrl-C and its
 * hang-up reach the child themselves, and a command stops at once on its
 * second, so neither is passed on.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '..', 'dist/src/cli.js');
const args = ['--stack-size=8192', '--enable-source-maps', target, ...process.argv.slice(2)];

if (typeof process.execve === 'function') {
  try {
    process.execve(process.execPath, [process.execPath, ...args], process.env);
  } catch {
    // Not possible here: the CLI runs as a child, below
  }
}

const child = spawn(process.execPath, args, { stdio: 'inherit' });
process.on('SIGINT', () => {});
process.on('SIGHUP', () => {});
process.on('SIGTERM', () => { child.kill('SIGTERM'); });
child.on('error', (error) => {
  console.error(`e3: failed to run ${target}: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal === null ? 1 : 128 + (constants.signals[signal] ?? 0)));
});
