/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A module-loader spy for the specs that must prove a code path never
 * loads a module (the non-TTY gate must never load Ink): registered with
 * `--import <this file>`, it appends every resolved module URL to the file
 * named by `E3_UI_LOAD_SPY`. Test-only.
 *
 * @packageDocumentation
 */

import { register } from 'node:module';

register('./load-spy-hooks.js', import.meta.url);
