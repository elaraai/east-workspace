/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The terminal UI's entry refuses the budget a local repository's embedded
 * server would run under, when it does not resolve, before anything opens and
 * in e3's words.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { TuiOptions } from '../commands/tui.js';
import { runTui } from './app.js';

describe('runTui', () => {
    const local: TuiOptions = { repo: '.', workspace: undefined, task: undefined, input: undefined, mouse: false, ascii: true, budget: {} };

    test('refuses a budget that does not resolve before anything opens, in e3\'s words', async () => {
        const written: string[] = [];
        const write = process.stderr.write.bind(process.stderr);
        const previous = process.env['E3_MEMORY'];
        process.stderr.write = ((chunk: string | Uint8Array) => {
            written.push(String(chunk));
            return true;
        }) as typeof process.stderr.write;
        try {
            assert.equal(await runTui({ ...local, budget: { jobs: '0' } }), 1);
            process.env['E3_MEMORY'] = 'lots';
            assert.equal(await runTui(local), 1);
        } finally {
            process.stderr.write = write;
            if (previous === undefined) delete process.env['E3_MEMORY'];
            else process.env['E3_MEMORY'] = previous;
        }
        assert.deepEqual(written, [
            "Error: --jobs must be a positive integer, got '0'\n",
            "Error: E3_MEMORY must be a size in bytes, or with a K, M, G or T suffix (binary units, as 8G), got 'lots'\n",
        ]);
    });
});
