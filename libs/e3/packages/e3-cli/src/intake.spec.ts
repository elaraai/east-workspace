/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { variant } from '@elaraai/east';
import type { DeploySourceProgress } from '@elaraai/e3-core';
import type { DeployProgress, IntakeFile, RecordDeployState } from '@elaraai/e3-types';
import { createProgress, type ProgressStream, type StepHandle } from './progress.js';
import { commitText, deployJobText, hashDelivery, intakeReporter } from './intake.js';

function fakeStream(tty: boolean): ProgressStream & { chunks: string[] } {
  const chunks: string[] = [];
  return { chunks, isTTY: tty, write: (c: string) => { chunks.push(c); return true; } };
}

const MB = 1024 * 1024;
const sources = { count: 3, bytes: 30 * MB };
const event = (path: string, rest: Partial<DeploySourceProgress>): DeploySourceProgress =>
  ({ path, file: `/deliveries/${path.split('/').pop()}.beast2`, sources, phase: 'hash', bytes: 0, total: 10 * MB, foreign: false, ...rest });

test('a line per file as it finishes, and a summary once the last is in', () => {
  const stream = fakeStream(false);
  let clock = 0;
  const intake = intakeReporter(createProgress({ stream }), () => clock);
  intake.report(event('inputs/a', { phase: 'hash', bytes: 5 * MB }));
  intake.report(event('inputs/b', { phase: 'hash', bytes: 5 * MB }));
  clock = 1000;
  intake.report(event('inputs/a', { phase: 'take-in', bytes: 10 * MB }));
  clock = 2000;
  intake.report(event('inputs/a', { phase: 'done', bytes: 10 * MB, taken: 'carried' }));
  intake.report(event('inputs/b', { phase: 'done', bytes: 10 * MB, taken: 'known' }));
  intake.report(event('inputs/c', { phase: 'take-in', bytes: 10 * MB, foreign: true }));
  clock = 4000;
  intake.report(event('inputs/c', { phase: 'done', bytes: 10 * MB, foreign: true, taken: 'written' }));
  assert.deepStrictEqual(stream.chunks.join('').split('\n').filter(Boolean), [
    'taking in 3 files (30.0 MB) …',
    '✔ a 10.0 MB in 2.0 s (5.0 MB/s), carried',
    '✔ b 10.0 MB in 2.0 s (5.0 MB/s), unchanged, already in the store',
    "✔ c 10.0 MB in 2.0 s (5.0 MB/s), written again: not the Writer's bytes",
    '✔ took in 3 files, 30.0 MB in 4.0 s (7.5 MB/s): 1 unchanged, 1 carried, 1 written again',
  ]);
});

test('on a terminal, the live line names the files in flight, and the pace across them', () => {
  const stream = fakeStream(true);
  let clock = 0;
  const intake = intakeReporter(createProgress({ stream }), () => clock);
  intake.report(event('inputs/a', { phase: 'hash', bytes: 2 * MB }));
  clock = 1000;
  intake.report(event('inputs/a', { phase: 'take-in', bytes: 5 * MB }));
  const out = stream.chunks.join('');
  assert.ok(out.includes('taking in 0/3 files, 5.0 MB/30.0 MB, 5.0 MB/s, 5.0 s left: a 5.0 MB/10.0 MB'), out);
});

test('a failed intake ends its live line without a summary', () => {
  const stream = fakeStream(false);
  const intake = intakeReporter(createProgress({ stream }), () => 0);
  intake.report(event('inputs/a', { phase: 'hash', bytes: MB }));
  intake.fail();
  assert.strictEqual(stream.chunks.join('').includes('took in'), false);
});

test('an upload hashes its delivery first, saying how far the read has got, at most every tenth of a second', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e3-intake-'));
  try {
    const file = join(dir, 'table.beast2');
    const bytes = new Uint8Array(3 * MB).fill(7);
    writeFileSync(file, bytes);
    const lines = (): { step: StepHandle; updates: string[] } => {
      const updates: string[] = [];
      return { updates, step: { update: (text) => { updates.push(text); }, done: () => {}, fail: () => {} } };
    };

    // The clock moves a tenth of a second between reads: every read is said.
    const paced = lines();
    let clock = 0;
    const hash = await hashDelivery(file, bytes.length, 'table', paced.step, () => (clock += 100));
    assert.strictEqual(hash, createHash('sha256').update(bytes).digest('hex'));
    assert.deepStrictEqual(paced.updates, ['hashing table: 1.0 MB/3.0 MB', 'hashing table: 2.0 MB/3.0 MB', 'hashing table: 3.0 MB/3.0 MB']);

    // It stands still: the first read is said, and the rest wait for the clock.
    const still = lines();
    await hashDelivery(file, bytes.length, 'table', still.step, () => 100);
    assert.deepStrictEqual(still.updates, ['hashing table: 1.0 MB/3.0 MB']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a server's commit says what it is doing with the file", () => {
  const at = (step: IntakeFile['step']): string => commitText({ path: 'inputs/a', step, bytes: BigInt(4 * MB), total: BigInt(10 * MB) });
  assert.strictEqual(at(variant('hashing', null)), 'the server is hashing it: 4.0 MB/10.0 MB');
  assert.strictEqual(at(variant('taking_in', { foreign: false })), 'the server is taking it in: 4.0 MB/10.0 MB');
  assert.strictEqual(at(variant('taking_in', { foreign: true })), 'the server is writing it again: 4.0 MB/10.0 MB');
});

test("a server's deploy job says its files, then the record it migrates or indexes, then finishing", () => {
  const file = (step: IntakeFile['step']): IntakeFile => ({ path: 'inputs/a', step, bytes: 0n, total: 1n });
  const job = (files: IntakeFile[], step: RecordDeployState['step']): DeployProgress => ({
    package: { name: 'p', version: '1.0.0' },
    startedAt: new Date(0),
    files,
    records: [{ plan: { record: 'records/orders', action: variant('migrate', { steps: ['a', 'b'] }) }, indexes: ['by_customer'], step }],
  });
  const done = file(variant('done', variant('carried', null)));
  assert.strictEqual(deployJobText(job([done, file(variant('waiting', null))], variant('waiting', null))), 'taking in 1/2 files');
  assert.strictEqual(deployJobText(job([done], variant('migrating', { name: 'b', step: 2n, steps: 2n }))), 'migrating orders: b (2/2)');
  assert.strictEqual(deployJobText(job([], variant('indexing', { index: 'by_customer', build: 1n, builds: 1n }))), 'building orders.by_customer (1/1)');
  assert.strictEqual(deployJobText(job([done], variant('done', null))), 'finishing');
});
