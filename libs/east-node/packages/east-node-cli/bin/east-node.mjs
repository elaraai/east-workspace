#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 *
 * Static bin shim — exists in fresh checkout so pnpm install can create
 * the bin symlink BEFORE the package is built.
 *
 * Spawns the CLI with `--preserve-symlinks` AND from the linked entry
 * path (process.argv[1]) so dynamic imports of platform packages
 * (`-p @elaraai/east-node-std` etc.) resolve from the USER's project
 * node_modules — where the user declared which platforms they want —
 * rather than from east-node-cli's monorepo source location.
 *
 * Why argv[1] and not import.meta.url:
 *   The pnpm bin shim invokes us with the LINKED wrapper path
 *   (`<user>/node_modules/@elaraai/east-node-cli/bin/east-node.mjs`).
 *   Node preserves that path as-passed in `process.argv[1]`, but
 *   `import.meta.url` is realpath'd by default. To keep resolution
 *   anchored at the user's project we must compute the dist target
 *   from argv[1] and run the child with `--preserve-symlinks` so it
 *   doesn't realpath either.
 *
 * Why spawn instead of in-process import:
 *   `--preserve-symlinks` is a process-startup flag; Node won't honour
 *   it for the already-running wrapper process. A child node with the
 *   flag set + the linked dist path as its entry gives the resolution
 *   the platforms-from-user-project semantics we want.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const target = resolve(dirname(process.argv[1]), '..', 'dist/index.js');
const r = spawnSync(
  process.execPath,
  ['--preserve-symlinks', target, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
process.exit(r.status ?? 1);
