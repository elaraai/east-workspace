#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 *
 * Static bin shim — exists in fresh checkout so pnpm install can create
 * the bin symlink BEFORE the package is built. Dynamic-imports the
 * built CLI entrypoint; argv flows through via process.argv.
 */
await import('../dist/src/cli.js');
