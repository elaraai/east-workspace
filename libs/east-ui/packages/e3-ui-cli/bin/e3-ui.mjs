#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Static bin shim — committed so `pnpm install` can create the `e3-ui` bin
 * symlink on a fresh checkout BEFORE the package is built. Delegates to the
 * compiled CLI entry.
 *
 * React and Ink's reconciler pick their build from NODE_ENV when they load,
 * and a user's terminal never sets it: without this line every `e3-ui`
 * session would run the development builds (profiling, checks, and a third
 * more CPU per frame). Set only when the environment says nothing.
 */
process.env.NODE_ENV ??= 'production';
import('../dist/cli.js').catch((err) => {
    console.error('e3-ui: failed to start — build the package first (npm run build).', err?.message ?? err);
    process.exit(1);
});
