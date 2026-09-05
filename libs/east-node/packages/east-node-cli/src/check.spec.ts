/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for `east-node check` (#686): the BUILD's own errors at their lines.
 *
 * `tsc` checks the TypeScript around an East program; it does not build it. A
 * body whose expression type differs from the declared output type-checks
 * clean and fails only when something imports the module — which is what this
 * reports, and reports for EVERY broken function rather than the first.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkModule, formatFinding, GUARD } from './check.js';

const EAST = import.meta.resolve('@elaraai/east');

const THREE_BROKEN = `
import { East, IntegerType, StringType } from ${JSON.stringify(EAST)};

export const ok = East.function([IntegerType], IntegerType, ($, x) => x.add(1n));
export const wrongOut = East.function([IntegerType], StringType, ($, x) => x.add(1n));
export const alsoWrong = East.function([IntegerType], StringType, ($, x) => x.multiply(2n));
export const third = East.function([IntegerType], StringType, ($, x) => x.subtract(1n));
`;

const CLEAN = `
import { East, IntegerType } from ${JSON.stringify(EAST)};
export const double = East.function([IntegerType], IntegerType, ($, x) => x.multiply(2n));
`;

function moduleWith(source: string, name = 'mod.mjs'): { path: string; dispose: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'east-node-check-'));
    const path = join(dir, name);
    writeFileSync(path, source);
    return { path, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('east-node check', () => {
    it('reports every broken function, not just the first', async () => {
        const mod = moduleWith(THREE_BROKEN);
        try {
            const findings = await checkModule(mod.path);
            assert.equal(findings.length, 3, findings.map((f) => f.message).join('\n'));
            assert.deepEqual([...new Set(findings.map((f) => f.rule))], ['build']);
        } finally {
            mod.dispose();
        }
    });

    it('reports a declared-output mismatch at the author line, which tsc cannot see', async () => {
        const mod = moduleWith(THREE_BROKEN);
        try {
            const findings = await checkModule(mod.path);
            // Lines 5, 6, 7 of the module (line 1 is the leading newline).
            assert.deepEqual(findings.map((f) => f.line), [5, 6, 7]);
            for (const finding of findings) {
                assert.match(finding.message, /expected .String, found .Integer/);
                assert.ok(finding.path.endsWith('mod.mjs'), `author file, got ${finding.path}`);
                assert.ok(finding.column >= 1);
            }
        } finally {
            mod.dispose();
        }
    });

    it('reports nothing for a module that builds', async () => {
        const mod = moduleWith(CLEAN);
        try {
            assert.deepEqual(await checkModule(mod.path), []);
        } finally {
            mod.dispose();
        }
    });

    it('says so when the module will not import at all', async () => {
        const mod = moduleWith(`throw new Error('boom');\n`);
        try {
            const findings = await checkModule(mod.path);
            assert.equal(findings.length, 1);
            assert.equal(findings[0]!.rule, 'import');
            assert.match(findings[0]!.message, /boom/);
            assert.match(findings[0]!.message, new RegExp(GUARD));
        } finally {
            mod.dispose();
        }
    });

    it('sets the guard while checking and restores it afterwards', async () => {
        const before = process.env[GUARD];
        const mod = moduleWith(`
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.EAST_CHECK_PROBE, process.env.${GUARD} ?? 'unset');
`);
        const probe = join(tmpdir(), `east-check-probe-${Date.now()}`);
        process.env['EAST_CHECK_PROBE'] = probe;
        try {
            await checkModule(mod.path);
            const { readFileSync } = await import('node:fs');
            assert.equal(readFileSync(probe, 'utf-8'), '1', 'a module must be able to see the guard');
        } finally {
            delete process.env['EAST_CHECK_PROBE'];
            rmSync(probe, { force: true });
            mod.dispose();
        }
        assert.equal(process.env[GUARD], before, 'the guard must not leak out of the check');
    });

    it('re-checks a module rather than returning the cached import', async () => {
        const mod = moduleWith(CLEAN);
        try {
            assert.deepEqual(await checkModule(mod.path), []);
            writeFileSync(mod.path, THREE_BROKEN);
            const findings = await checkModule(mod.path);
            assert.equal(findings.length, 3, 'a warm process must not serve the stale module');
        } finally {
            mod.dispose();
        }
    });

    it('formats a finding the way east-py check does', async () => {
        const mod = moduleWith(THREE_BROKEN);
        try {
            const [finding] = await checkModule(mod.path);
            assert.match(formatFinding(finding!), /^.+mod\.mjs:5:\d+: error \[build\] /);
        } finally {
            mod.dispose();
        }
    });
});
