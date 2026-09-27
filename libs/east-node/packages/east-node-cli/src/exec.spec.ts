/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `exec`, held to the runner protocol's conformance corpus: every case, run
 * through this runner, writes the corpus's bytes and comes to its outcome, as
 * east-c's and east-py's runners must. The corpus is `east`'s
 * (`test/runner_corpus.spec.ts`): read from `EAST_RUNNER_CORPUS` when that
 * names one, and written afresh for this run otherwise.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ArrayType,
    StringType,
    UnitOutcomeType,
    UnitResultType,
    decodeBeast2,
    decodeBeast2For,
    equalFor,
    type UnitOutcome,
} from '@elaraai/east';

const bin = fileURLToPath(new URL('../bin/east-node.mjs', import.meta.url));

/** What a corpus case's `case.beast2` holds. */
interface RunnerCase {
    name: string;
    lazy: boolean;
    outcome: UnitOutcome;
    outputs: { path: string; bytes: Uint8Array }[];
    absent: string[];
}

describe('exec: the runner protocol corpus', () => {
    let corpus: string;
    let generated: string | undefined;
    let scratch: string;

    before(() => {
        scratch = mkdtempSync(join(tmpdir(), 'east-node-exec-'));
        if (process.env.EAST_RUNNER_CORPUS) {
            corpus = process.env.EAST_RUNNER_CORPUS;
            return;
        }
        generated = mkdtempSync(join(tmpdir(), 'east-runner-corpus-'));
        const spec = join(dirname(fileURLToPath(import.meta.resolve('@elaraai/east'))), '..', 'test', 'runner_corpus.spec.js');
        // Without this run's test context, which would make the child report
        // to it instead of running its own tests.
        const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
        const written = spawnSync(process.execPath, ['--enable-source-maps', '--test', spec], {
            env: { ...env, EXPORT_TEST_IR: generated },
            encoding: 'utf8',
        });
        assert.equal(written.status, 0, `writing the corpus failed:\n${written.stdout.slice(-4_000)}${written.stderr.slice(-4_000)}`);
        corpus = join(generated, 'runner_corpus');
    });

    after(() => {
        rmSync(scratch, { recursive: true, force: true });
        if (generated !== undefined) rmSync(generated, { recursive: true, force: true });
    });

    it('executes every case to its outputs and its outcome', () => {
        const names = decodeBeast2For(ArrayType(StringType))(readFileSync(join(corpus, 'index.beast2')));
        assert.ok(names.length > 0, 'the corpus holds cases');
        const equalOutcome = equalFor(UnitOutcomeType);
        for (const name of names) {
            const expected = decodeBeast2(readFileSync(join(corpus, name, 'case.beast2'))).value as RunnerCase;
            // A copy per case: a unit writes beside itself.
            const dir = join(scratch, name);
            cpSync(join(corpus, name), dir, { recursive: true });
            const run = spawnSync(process.execPath, [bin, 'exec', join(dir, 'unit.beast2')], {
                env: { ...process.env, ...(expected.lazy && { EAST_LAZY_INPUT_BYTES: '1' }) },
                encoding: 'utf8',
            });
            const ok = expected.outcome.type === 'ok';
            assert.equal(run.status, ok ? 0 : 1, `${name}: exit ${run.status}\n${run.stderr.slice(-2_000)}`);
            const result = decodeBeast2For(UnitResultType)(readFileSync(join(dir, 'result.beast2')));
            assert.ok(equalOutcome(result.outcome, expected.outcome),
                `${name}: the outcome ${JSON.stringify(result.outcome, (_k, v: unknown) => typeof v === 'bigint' ? `${v}` : v)}`);
            assert.ok(result.peakBytes > 0n, `${name}: the peak is measured`);
            for (const output of expected.outputs) {
                const path = join(dir, output.path);
                assert.ok(existsSync(path), `${name}: ${output.path} is written`);
                assert.deepEqual(new Uint8Array(readFileSync(path)), new Uint8Array(output.bytes), `${name}: ${output.path}`);
            }
            for (const path of expected.absent) assert.ok(!existsSync(join(dir, path)), `${name}: ${path} is not written`);
        }
    });
});

describe('exec: a unit it cannot read', () => {
    let dir: string;

    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'east-node-exec-unread-'));
    });

    after(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('leaves no result, and exits 2', () => {
        writeFileSync(join(dir, 'garbage.beast2'), 'not a unit');
        const run = spawnSync(process.execPath, [bin, 'exec', join(dir, 'garbage.beast2')], { encoding: 'utf8' });
        assert.equal(run.status, 2);
        assert.match(run.stderr, /^Error: exec /);
    });
});
