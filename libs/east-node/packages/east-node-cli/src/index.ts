#!/usr/bin/env node
/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East Node CLI - Command-line interface for running East IR programs.
 *
 * @packageDocumentation
 */

import { createRequire } from 'module';
import { main } from './cli.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export const __version__ = pkg.version;
export { main };

main();
