#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Static bin shim — committed so `pnpm install` can create the `e3-ui` bin
 * symlink on a fresh checkout BEFORE the package is built. Delegates to the
 * compiled CLI entry.
 */
import('../dist/cli.js').catch((err) => {
    console.error('e3-ui: failed to start — build the package first (npm run build).', err?.message ?? err);
    process.exit(1);
});
