/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, chownSync, linkSync, lstatSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createTempDir, removeTempDir } from '../../test-helpers.js';
import { writeOutputFile } from './output-file.js';

const posix = process.platform === 'win32' ? 'POSIX file modes, links and devices' : false;
/** Root may write any file, and give any owner. */
const root = process.getuid?.() === 0;
/** A group of this user's other than the one its new files take. */
const otherGroup = process.platform === 'win32' ? undefined : process.getgroups?.().find((gid) => gid !== process.getgid?.());

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

  it('leaves nothing beside the file however its bytes\' failure falls against the opening of the new file', async () => {
    // The bytes fail a turn after the first of them, while the new file may
    // still be opening: removed before it has opened, it would be made after
    // all. One write in sixteen left its file behind so, before the write
    // waited for the open to end.
    const file = join(dir, 'model.beast2');
    for (let i = 0; i < 300; i++) {
      const failing = (async function* () { yield new Uint8Array([1]); await Promise.resolve(); throw new Error('a segment is missing'); })();
      await assert.rejects(() => writeOutputFile(file, failing), /a segment is missing/);
    }
    assert.deepEqual(readdirSync(dir), []);
  });

  it('leaves the file as it was, and nothing beside it, when its signal stops it: before it starts, part way, and once its bytes are whole', async () => {
    const file = join(dir, 'model.beast2');
    writeFileSync(file, 'the first model');
    const before = new AbortController();
    before.abort(new Error('interrupted'));
    await assert.rejects(() => writeOutputFile(file, 'the second model', { signal: before.signal }), /interrupted/);
    // Stopped between two of its parts, and after the last of them: the new
    // file is whole then, and still never takes the old one's place
    for (const stopAfter of [1, 2]) {
      const stop = new AbortController();
      const parts = (async function* () {
        for (let part = 1; part <= 2; part++) {
          yield new Uint8Array([part]);
          if (part === stopAfter) stop.abort(new Error('interrupted'));
        }
      })();
      await assert.rejects(() => writeOutputFile(file, parts, { signal: stop.signal }), /interrupted/, `stopped after part ${stopAfter}`);
    }
    assert.equal(readFileSync(file, 'utf8'), 'the first model');
    assert.deepEqual(readdirSync(dir), ['model.beast2']);
  });

  it('keeps the mode of the file it replaces, whatever the process\'s mask would take from a new file', { skip: posix }, async () => {
    // A mask that leaves a new file its owner's alone: a mode given as the
    // file is made would lose every bit of its group's and of others'
    const mask = process.umask(0o077);
    try {
      for (const mode of [0o600, 0o664, 0o666, 0o640]) {
        const file = join(dir, `shared-${mode.toString(8)}.beast2`);
        writeFileSync(file, 'old');
        chmodSync(file, mode);
        await writeOutputFile(file, 'new');
        assert.equal(statSync(file).mode & 0o777, mode, mode.toString(8));
        assert.equal(readFileSync(file, 'utf8'), 'new');
      }
    } finally {
      process.umask(mask);
    }
  });

  it('keeps the group of the file it replaces, where its user is a member of it', {
    skip: posix || (otherGroup === undefined ? 'this user is in one group alone' : false),
  }, async () => {
    const file = join(dir, 'shared.beast2');
    writeFileSync(file, 'old');
    chownSync(file, process.getuid!(), otherGroup!);
    chmodSync(file, 0o660);
    await writeOutputFile(file, 'new');
    const replaced = statSync(file);
    assert.deepEqual({ gid: replaced.gid, uid: replaced.uid, mode: replaced.mode & 0o777 }, { gid: otherGroup, uid: process.getuid!(), mode: 0o660 });
  });

  it('refuses a file its user may not write, as a write into it is refused, and leaves it', {
    skip: posix || (root ? 'root may write any file' : false),
  }, async () => {
    const file = join(dir, 'kept.beast2');
    writeFileSync(file, 'kept');
    chmodSync(file, 0o444);
    await assert.rejects(() => writeOutputFile(file, 'new'), { code: 'EACCES' });
    assert.equal(readFileSync(file, 'utf8'), 'kept');
    assert.equal(statSync(file).mode & 0o777, 0o444);
    assert.deepEqual(readdirSync(dir), ['kept.beast2']);
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

  it('writes where a link leads that leads nowhere yet, through each such link, and leaves them', { skip: posix }, async () => {
    // latest -> current -> runs/today, which no run has written yet
    const today = join(dir, 'today.beast2');
    const current = join(dir, 'current.beast2');
    const latest = join(dir, 'latest.beast2');
    symlinkSync('today.beast2', current);
    symlinkSync(current, latest);
    await writeOutputFile(latest, 'the first run');
    assert.ok(lstatSync(latest).isSymbolicLink() && lstatSync(current).isSymbolicLink(), 'the links are still links');
    assert.ok(lstatSync(today).isFile());
    assert.equal(readFileSync(latest, 'utf8'), 'the first run');
    assert.deepEqual(readdirSync(dir).sort(), ['current.beast2', 'latest.beast2', 'today.beast2']);
  });

  it('writes into what is no regular file, which it cannot replace', { skip: posix }, async () => {
    await writeOutputFile('/dev/null', 'discarded');
    assert.ok(statSync('/dev/null').isCharacterDevice(), 'the device is still the device');
  });

  it('writes into /dev/stdout when it is a pipe, which names no path a file could be made beside', { skip: posix }, () => {
    // As `e3 call -o /dev/stdout | …` does, through a shell's pipe: the bytes
    // reach the pipe's reader
    const module = pathToFileURL(fileURLToPath(new URL('./output-file.js', import.meta.url))).href;
    const script = `const { writeOutputFile } = await import(${JSON.stringify(module)}); await writeOutputFile('/dev/stdout', new Uint8Array([1, 2, 3]));`;
    const piped = execFileSync('/bin/sh', ['-c', '"$NODE" --input-type=module -e "$SCRIPT" | cat'],
      { env: { ...process.env, NODE: process.execPath, SCRIPT: script }, stdio: ['ignore', 'pipe', 'inherit'] });
    assert.deepEqual([...piped], [1, 2, 3]);
  });
});
