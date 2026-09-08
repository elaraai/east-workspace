/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The terminal UI entry — `runTui(options)`.
 *
 * Placeholder until the shell lands (#721): reports that the interactive
 * browser is not available in this build and exits 1, so the root action's
 * gate, lazy import and exit-code contract are exercised end to end.
 *
 * @packageDocumentation
 */

import type { TuiOptions } from '../commands/tui.js';

/**
 * Runs the terminal UI and resolves with the process exit code.
 *
 * @param options - The resolved root-action options
 * @returns The exit code
 */
export async function runTui(options: TuiOptions): Promise<number> {
    process.stderr.write(`e3-ui: the terminal UI is not available in this build (repo ${options.repo}).\n`);
    return 1;
}
