#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 *
 * Static bin shim — exists in fresh checkout so pnpm install can create
 * the bin symlink BEFORE the package is built. The shim itself does
 * nothing but dynamic-import the built entrypoint; argv flows through
 * via process.argv.
 */
await import('../dist/index.js');
