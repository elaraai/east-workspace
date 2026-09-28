/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { createProgress, formatBytes, type ProgressStream } from './progress.js';

function fakeStream(tty: boolean): ProgressStream & { chunks: string[] } {
  const chunks: string[] = [];
  return { chunks, isTTY: tty, write: (c: string) => { chunks.push(c); return true; } };
}

test('non-TTY: phases and steps print plain sequential lines, no ANSI', () => {
  const stream = fakeStream(false);
  const progress = createProgress({ stream });
  progress.phase('compiled src/index.ts (demo@1.0.0)');
  const step = progress.step('uploading package (3.4 MB)');
  step.update('uploading package 1.0/3.4 MB'); // suppressed on non-TTY
  step.done('imported demo@1.0.0 (40 objects)');
  const out = stream.chunks.join('');
  assert.strictEqual(out.includes('['), false, 'no ANSI codes on non-TTY');
  assert.strictEqual(out.includes('\r'), false, 'no carriage returns on non-TTY');
  assert.deepStrictEqual(out.split('\n').filter(Boolean), [
    '✔ compiled src/index.ts (demo@1.0.0)',
    'uploading package (3.4 MB) …',
    '✔ imported demo@1.0.0 (40 objects)',
  ]);
  assert.strictEqual(out.includes('1.0/3.4'), false, 'updates suppressed on non-TTY');
});

test('TTY: step renders in place and completes to a ✔ line', () => {
  const stream = fakeStream(true);
  const progress = createProgress({ stream });
  const step = progress.step('pushing objects');
  step.update('pushing objects 23/40');
  step.done('imported demo@1.0.0 (40 objects)');
  const out = stream.chunks.join('');
  assert.ok(out.includes('\r'), 'in-place updates use carriage returns');
  assert.ok(out.includes('pushing objects 23/40'), 'update text rendered');
  assert.ok(out.endsWith('✔ imported demo@1.0.0 (40 objects)\n'), 'completion line last');
});

test('TTY: a phase completing mid-step resumes the step line, and the step goes on', () => {
  const stream = fakeStream(true);
  const progress = createProgress({ stream });
  const step = progress.step('capturing package');
  progress.phase('captured pricing (uv build --sdist, 1.2 MB)');
  step.update('capturing package: 2 of 3 members');
  step.done('captured package demo@1.0.0');
  const out = stream.chunks.join('');
  const phaseAt = out.indexOf('✔ captured pricing');
  const resumeAt = out.indexOf('capturing package', phaseAt);
  assert.ok(phaseAt >= 0 && resumeAt > phaseAt, 'step line resumes after the phase line');
  assert.ok(out.indexOf('capturing package: 2 of 3 members', phaseAt) > phaseAt, 'the step updates after the phase');
  assert.ok(out.endsWith('✔ captured package demo@1.0.0\n'), 'the step completes after the phase');
});

test('non-TTY: a phase mid-step prints its line, and the step still completes', () => {
  const stream = fakeStream(false);
  const progress = createProgress({ stream });
  const step = progress.step('taking in 2 files');
  progress.phase('wide_a 70.7 MB in 3.1 s (22.8 MB/s), carried');
  step.done('took in 2 files');
  assert.deepStrictEqual(stream.chunks.join('').split('\n').filter(Boolean), [
    'taking in 2 files …',
    '✔ wide_a 70.7 MB in 3.1 s (22.8 MB/s), carried',
    '✔ took in 2 files',
  ]);
});

test('quiet suppresses everything', () => {
  const stream = fakeStream(true);
  const progress = createProgress({ quiet: true, stream });
  progress.phase('compiled');
  const step = progress.step('uploading');
  step.update('uploading 1/2');
  step.done('done');
  assert.strictEqual(stream.chunks.length, 0);
  assert.strictEqual(progress.quiet, true);
});

test('fail clears the step without a summary line', () => {
  const stream = fakeStream(false);
  const progress = createProgress({ stream });
  const step = progress.step('deploying');
  step.fail();
  const out = stream.chunks.join('');
  assert.ok(out.includes('deploying …'), 'start line printed');
  assert.strictEqual(out.includes('✔'), false, 'no completion line after fail');
});

test('formatBytes picks sensible units', () => {
  assert.strictEqual(formatBytes(512), '512 B');
  assert.strictEqual(formatBytes(84 * 1024), '84 kB');
  assert.strictEqual(formatBytes(1.2 * 1024 * 1024), '1.2 MB');
  assert.strictEqual(formatBytes(7.5 * 1024 * 1024 * 1024), '7.5 GB');
});
