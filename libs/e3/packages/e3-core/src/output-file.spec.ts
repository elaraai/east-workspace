/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, linkSync, lstatSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTempDir, removeTempDir } from './test-helpers.js';
import { writeOutputFile } from './output-file.js';

const posix = process.platform === 'win32' ? 'POSIX file modes, links and devices' : false;

describe('writeOutputFile', () => {
  let dir: string;
  beforeEach(() => { dir = createTempDir(); });
  afterEach(() => removeTempDir(dir));

  it('writes a file that is not there, whole or as its bytes come, and leaves nothing beside it', async () => {
    const file = join(dir, 'out.beast2');
    await writeOutputFile(file, new Uint8Array([1, 2, 3]));
    assert.deepEqual([...readFileSync(file)], [1, 2, 3]);
    await writeOutputFile(join(dir, 'text.json'), '{"a":1}');
    assert.equal(readFileSync(join(dir, 'text.json'), 'utf8'), '{"a":1}');
    const parts = (async function* () { yield new Uint8Array([4]); await Promise.resolve(); yield new Uint8Array([5, 6]); })();
    await writeOutputFile(file, parts);
    assert.deepEqual([...readFileSync(file)], [4, 5, 6]);
    assert.deepEqual(readdirSync(dir).sort(), ['out.beast2', 'text.json']);
  });

  it('replaces the file that is there and never writes into it: another name of the old file keeps its bytes', async () => {
    const file = join(dir, 'model.beast2');
    writeFileSync(file, 'the first model');
    // A store that took the file in by a hard link holds it as an object
    const object = join(dir, 'object');
    linkSync(file, object);
    await writeOutputFile(file, 'the second model');
    assert.equal(readFileSync(file, 'utf8'), 'the second model');
    assert.equal(readFileSync(object, 'utf8'), 'the first model', 'the object keeps the bytes under its hash');
    assert.notEqual(statSync(file, { bigint: true }).ino, statSync(object, { bigint: true }).ino);
  });

  it('leaves the file as it was, and nothing beside it, when its bytes fail part way', async () => {
    const file = join(dir, 'model.beast2');
    writeFileSync(file, 'the first model');
    const failing = (async function* () { yield new Uint8Array([1]); await Promise.resolve(); throw new Error('a segment is missing'); })();
    await assert.rejects(() => writeOutputFile(file, failing), /a segment is missing/);
    assert.equal(readFileSync(file, 'utf8'), 'the first model');
    assert.deepEqual(readdirSync(dir), ['model.beast2']);
  });

  it('keeps the mode of the file it replaces', { skip: posix }, async () => {
    const file = join(dir, 'private.beast2');
    writeFileSync(file, 'old');
    chmodSync(file, 0o600);
    await writeOutputFile(file, 'new');
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });

  it('writes where a link leads, and leaves the link', { skip: posix }, async () => {
    const real = join(dir, 'real.beast2');
    writeFileSync(real, 'old');
    const link = join(dir, 'latest.beast2');
    symlinkSync(real, link);
    await writeOutputFile(link, 'new');
    assert.ok(lstatSync(link).isSymbolicLink(), 'the link is still a link');
    assert.equal(readFileSync(real, 'utf8'), 'new');
  });

  it('writes into what is no regular file, which it cannot replace', { skip: posix }, async () => {
    await writeOutputFile('/dev/null', 'discarded');
    assert.ok(statSync('/dev/null').isCharacterDevice(), 'the device is still the device');
  });
});
