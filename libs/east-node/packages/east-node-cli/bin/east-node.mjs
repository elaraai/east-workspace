#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0-or-later. See LICENSE for details.
 *
 * Static bin shim — exists in fresh checkout so pnpm install can create
 * the bin symlink BEFORE the package is built. Dynamic-imports the
 * built entrypoint; argv flows through via process.argv.
 *
 * Platform-package resolution (the user-project-anchored part) is the
 * loader's responsibility — see src/loader.ts → loadPlatform.
 */
await import('../dist/index.js');
