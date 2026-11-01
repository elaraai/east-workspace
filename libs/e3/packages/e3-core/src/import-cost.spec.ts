/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * What importing e3-core costs a process (#1466). Every e3 command and server
 * imports it before doing anything, so the import builds no East function and
 * loads no TypeScript, which East loads for its first build: the SDK's
 * functions, and e3-core's own, are built when a program needs them.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Run in a process of its own: imports e3-core with `East.function` counted. */
const IMPORT_PROBE = `
import { createRequire } from 'node:module';
const { East } = await import('@elaraai/east');
let built = 0;
const build = East.function;
East.function = function (...args) { built += 1; return build.apply(this, args); };
await import(process.argv[1]);
const typescript = Object.keys(createRequire(import.meta.url).cache).some((path) => /[\\\\/]typescript[\\\\/]/.test(path));
console.log(JSON.stringify({ built, typescript }));
`;

describe('importing e3-core', () => {
  it('builds no East function and loads no TypeScript', () => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', IMPORT_PROBE, new URL('index.js', import.meta.url).href], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), { built: 0, typescript: false });
  });
});
