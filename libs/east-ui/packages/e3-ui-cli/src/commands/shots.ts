/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `e3-ui shots` — sweep a project for every renderable UI export (bare East
 * functions, `example()` defs, zero-input `ui()` tasks) and render each to
 * `<out>/<relative-path>/<export>.png`. See `sweep.ts` for discovery,
 * IR-level classification, and output layout.
 *
 * @packageDocumentation
 */

import { sweep } from '../sweep.js';
import { parseDpr, parsePositive, parseViewport } from './shot.js';

/** Options accepted by the `shots` command (commander camel-cases flags). */
export interface ShotsCommandOptions {
    out: string;
    html?: boolean;
    json?: boolean;
    frameWidth?: string;
    viewport?: string;
    dpr?: string;
    wait?: string;
    timeout?: string;
}

/** Commander action for `e3-ui shots`. */
export async function shotsCommand(paths: string[], options: ShotsCommandOptions): Promise<void> {
    try {
        const result = await sweep({
            paths,
            outDir: options.out,
            html: options.html ?? false,
            json: options.json ?? false,
            frameWidth: options.frameWidth,
            ...(options.viewport ? { viewport: parseViewport(options.viewport) } : {}),
            ...(options.dpr ? { deviceScaleFactor: parseDpr(options.dpr) } : {}),
            ...(options.wait ? { settleMs: parsePositive(options.wait, '--wait') } : {}),
            ...(options.timeout ? { timeoutMs: parsePositive(options.timeout, '--timeout') } : {}),
        });
        if (result.failed.length > 0) process.exit(1);
    } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}
