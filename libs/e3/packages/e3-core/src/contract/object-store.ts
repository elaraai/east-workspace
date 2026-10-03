/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The object store's contract: what any backend's content-addressed objects
 * do.
 */

import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectNotFoundError } from '../errors.js';
import { computeHash } from '../objects.js';
import { MALFORMED_HASHES, hashRefusal } from './malformed.js';
import type { BackendSetup } from './setup.js';

/** A directory for a test's own files, removed when the test ends. */
function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'e3-contract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (data: Uint8Array): string => new TextDecoder().decode(data);

/**
 * Registers the object store's contract suite over a backend.
 *
 * @param setup - Makes a fresh backend and a repository in it for each test
 */
export function objectStoreTests(setup: BackendSetup): void {
  describe('the object store', () => {
    it('keeps an object under the SHA-256 of its bytes, once however often it is written', async (t) => {
      const { storage, repo } = await setup(t);
      const data = bytes('an object');
      const before = await storage.objects.count(repo);

      const hash = await storage.objects.write(repo, data);
      assert.equal(hash, computeHash(data));
      assert.equal(await storage.objects.write(repo, data), hash);
      assert.equal(text(await storage.objects.read(repo, hash)), 'an object');
      assert.equal(await storage.objects.exists(repo, hash), true);
      assert.deepEqual(await storage.objects.stat(repo, hash), { size: data.length });
      assert.equal(await storage.objects.count(repo), before + 1);
      assert.ok((await storage.objects.list(repo)).includes(hash));
    });

    it('writes a stream of chunks as the object of their bytes', async (t) => {
      const { storage, repo } = await setup(t);
      async function* chunks(): AsyncIterable<Uint8Array> {
        yield bytes('one, ');
        yield bytes('two, ');
        yield bytes('three');
      }
      const hash = await storage.objects.writeStream(repo, chunks());
      assert.equal(hash, computeHash(bytes('one, two, three')));
      assert.equal(text(await storage.objects.read(repo, hash)), 'one, two, three');
    });

    it('reads a range of an object, short only at its end', async (t) => {
      const { storage, repo } = await setup(t);
      const hash = await storage.objects.write(repo, bytes('0123456789'));
      assert.equal(text(await storage.objects.readRange(repo, hash, 2, 3)), '234');
      assert.equal(text(await storage.objects.readRange(repo, hash, 7, 10)), '789');
    });

    it('refuses to read, size or place an object it does not hold', async (t) => {
      const { storage, repo } = await setup(t);
      const missing = computeHash(bytes('never written'));
      assert.equal(await storage.objects.exists(repo, missing), false);
      await assert.rejects(storage.objects.read(repo, missing), ObjectNotFoundError);
      await assert.rejects(storage.objects.readRange(repo, missing, 0, 1), ObjectNotFoundError);
      await assert.rejects(storage.objects.stat(repo, missing), ObjectNotFoundError);
      await assert.rejects(storage.objects.materialize(repo, missing, join(scratch(t), 'placed')), ObjectNotFoundError);
    });

    it('adopts a file as the object of its bytes, and refuses one that does not hash as promised', async (t) => {
      const { storage, repo } = await setup(t);
      const dir = scratch(t);
      const delivery = join(dir, 'delivery');
      writeFileSync(delivery, 'a delivery');
      const adopted = await storage.objects.adoptFile(repo, delivery);
      assert.deepEqual(adopted, { hash: computeHash(bytes('a delivery')), size: 10 });
      assert.equal(text(await storage.objects.read(repo, adopted.hash)), 'a delivery');

      const other = join(dir, 'other');
      writeFileSync(other, 'not the promised bytes');
      const promised = computeHash(bytes('the promised bytes'));
      await assert.rejects(storage.objects.adoptFile(repo, other, promised));
      assert.equal(await storage.objects.exists(repo, promised), false, 'nothing is stored under the promised hash');
      assert.equal(readFileSync(other, 'utf8'), 'not the promised bytes', 'the file is left as it was');
    });

    it('re-references the objects it holds in a batch, leaving their bytes, and answers false for those it does not, in order', async (t) => {
      const { storage, repo } = await setup(t);
      const hash = await storage.objects.write(repo, bytes('touched'));
      const other = await storage.objects.write(repo, bytes('touched too'));
      const missing = computeHash(bytes('never written'));
      assert.deepEqual(await storage.objects.touch(repo, [hash]), [true]);
      assert.deepEqual(await storage.objects.touch(repo, [missing, hash, other, missing]), [false, true, true, false]);
      assert.deepEqual(await storage.objects.touch(repo, []), []);
      assert.equal(text(await storage.objects.read(repo, hash)), 'touched');
      assert.equal(text(await storage.objects.read(repo, other)), 'touched too');
    });

    it('refuses a hash that is not a SHA-256 in lowercase hex, naming it, before it reads or writes anything', async (t) => {
      const { storage, repo } = await setup(t);
      const dir = scratch(t);
      const start = Date.now();
      const held = await storage.objects.write(repo, bytes('held'));
      // A touch of the held object clears this note: a batch that touched it
      // before refusing would leave none.
      assert.deepEqual(await storage.repos.gcNoteUnreachable(repo, [held], start), [start]);

      for (const malformed of MALFORMED_HASHES) {
        const refused = hashRefusal('object hash', malformed);
        await assert.rejects(storage.objects.read(repo, malformed), refused);
        await assert.rejects(storage.objects.readRange(repo, malformed, 0, 1), refused);
        await assert.rejects(storage.objects.exists(repo, malformed), refused);
        await assert.rejects(storage.objects.stat(repo, malformed), refused);
        await assert.rejects(storage.objects.materialize(repo, malformed, join(dir, 'placed')), refused);
        await assert.rejects(storage.objects.touch(repo, [held, malformed]), refused);
        // Refused before the file is looked at: there is none
        await assert.rejects(storage.objects.adoptFile(repo, join(dir, 'no such file'), malformed), refused);
      }

      assert.deepEqual(await storage.objects.list(repo), [held], 'nothing is written');
      assert.equal(existsSync(join(dir, 'placed')), false, 'nothing is placed');
      assert.deepEqual(await storage.repos.gcNoteUnreachable(repo, [held], start + 1), [start], 'a batch naming one touches none of it');
      assert.deepEqual(await storage.objects.touch(repo, [held]), [true]);
      assert.deepEqual(await storage.repos.gcNoteUnreachable(repo, [held], start + 2), [start + 2], 'as a touch of it alone does');
    });

    it('places an object\'s bytes at a path, shared or copied', async (t) => {
      const { storage, repo } = await setup(t);
      const dir = scratch(t);
      const hash = await storage.objects.write(repo, bytes('placed'));
      await storage.objects.materialize(repo, hash, join(dir, 'shared'));
      await storage.objects.materialize(repo, hash, join(dir, 'copied'), { link: false });
      assert.equal(readFileSync(join(dir, 'shared'), 'utf8'), 'placed');
      assert.equal(readFileSync(join(dir, 'copied'), 'utf8'), 'placed');
    });
  });
}
