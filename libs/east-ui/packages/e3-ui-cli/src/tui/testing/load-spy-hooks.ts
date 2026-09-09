/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The customization hooks behind `load-spy.ts`: every resolution is
 * appended to `$E3_UI_LOAD_SPY`.
 *
 * @packageDocumentation
 */

import { appendFileSync } from 'node:fs';

/** The `resolve` hook: records the resolved URL, then defers to the default resolver. */
export async function resolve(
    specifier: string,
    context: { parentURL?: string | undefined },
    nextResolve: (specifier: string, context: { parentURL?: string | undefined }) => Promise<{ url: string }>,
): Promise<{ url: string }> {
    const result = await nextResolve(specifier, context);
    const file = process.env['E3_UI_LOAD_SPY'];
    if (file !== undefined && file !== '') appendFileSync(file, `${result.url}\n`);
    return result;
}
