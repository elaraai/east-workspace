#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE.md for details.
 */

/**
 * Launcher for the native east-c binary.
 *
 * Resolves the per-platform package (`@elaraai/east-c-cli-<os>-<cpu>`, pulled
 * in as an optionalDependency gated on os/cpu) and execs the binary it ships,
 * forwarding argv, stdio and the exit code.
 *
 * The launcher — not the per-platform packages — owns the `east-c` bin, because
 * npm does not reliably create `node_modules/.bin/east-c` for a bin that comes
 * from an optionalDependency. A direct dependency's bin is always linked, so
 * `.bin/east-c` exists after a plain `npm install`. (Same reason esbuild, turbo
 * and Biome ship a launcher rather than relying on the platform package's bin.)
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);

// process.platform-process.arch -> published per-platform package suffix.
const TARGETS = new Set(['linux-x64', 'linux-arm64', 'darwin-arm64', 'darwin-x64', 'win32-x64']);

const key = `${process.platform}-${process.arch}`;
if (!TARGETS.has(key)) {
    console.error(
        `east-c: no prebuilt binary for ${key}. Supported platforms: ${[...TARGETS].join(', ')}.`,
    );
    process.exit(1);
}

const pkg = `@elaraai/east-c-cli-${key}`;
const exeName = process.platform === 'win32' ? 'east-c.exe' : 'east-c';

let binPath;
try {
    // Resolve the package's manifest (always resolvable) and take the binary
    // sibling — the extensionless binary itself is not a resolvable specifier.
    binPath = join(dirname(require.resolve(`${pkg}/package.json`)), exeName);
} catch {
    console.error(
        `east-c: the platform package ${pkg} is not installed.\n` +
        `It should install automatically as an optionalDependency of @elaraai/east-c-cli.\n` +
        `Reinstall it with:  npm install ${pkg}   (or: npm rebuild ${pkg})`,
    );
    process.exit(1);
}

const result = spawnSync(binPath, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
    console.error(`east-c: failed to run ${binPath}: ${result.error.message}`);
    process.exit(1);
}
// Re-raise a terminating signal so callers see the real cause; otherwise
// propagate the child's exit code.
if (result.signal) {
    process.kill(process.pid, result.signal);
}
process.exit(result.status ?? 1);
