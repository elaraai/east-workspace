#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 *
 * Static bin shim — exists in fresh checkout so pnpm install can create
 * the bin symlink BEFORE the package is built. Spawns the built CLI in
 * a child node process with `--stack-size=8192` because e3's IR walker
 * recurses deep on large datasets; the prior cli.js shebang carried the
 * same flag, but a shebang on this wrapper file is ignored when npm
 * invokes it as `node bin/e3.mjs`.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '..', 'dist/src/cli.js');
const r = spawnSync(
  process.execPath,
  ['--stack-size=8192', '--enable-source-maps', target, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
process.exit(r.status ?? 1);
