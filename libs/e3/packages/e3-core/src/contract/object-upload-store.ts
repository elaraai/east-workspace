/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The object upload store's contract: what any backend's uploads that write no
 * ref do. An upload is planned as parts, its parts sent in any order, and its
 * commit stores the bytes as the object they hash to, naming it nowhere: one
 * that is not its size, or does not hash to its name, fails and stores
 * nothing. A commit asked for again answers as it finished.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { equalFor, variant } from '@elaraai/east';
import { computeHash } from '../objects.js';
import { ObjectCommitStatusType, type ObjectCommitStatus, type ObjectUploadJob } from '../transfer/types.js';
import type { ObjectUploadStore } from '../transfer/interfaces.js';
import type { StorageBackend } from '../storage/interfaces.js';
import { uuidv7 } from '../uuid.js';

const sameStatus = equalFor(ObjectCommitStatusType);

/** A backend's object upload store, the storage its commits store into, and
 *  how a client sends a part. */
export interface ObjectUploadStoreContext {
  readonly store: ObjectUploadStore;
  readonly storage: StorageBackend;
  /** The repository uploads are for. */
  readonly repo: string;
  /** Sends one part of an upload's bytes, as a client's PUT to the part's URL does. */
  sendPart(id: string, record: ObjectUploadJob, part: number, bytes: Uint8Array): Promise<void>;
  readonly teardown?: () => Promise<void>;
}

/** Makes a fresh object upload store for each case. */
export type ObjectUploadStoreSetup = () => Promise<ObjectUploadStoreContext>;

/**
 * Registers the object upload store's contract over the stores `setup` makes.
 *
 * @param name - What the suite is called: the backend's name
 * @param setup - Makes a fresh store for each case
 */
export function objectUploadStoreTests(name: string, setup: ObjectUploadStoreSetup): void {
  describe(`${name}: the object upload store`, () => {
    let context: ObjectUploadStoreContext;

    beforeEach(async () => {
      context = await setup();
    });

    afterEach(async () => {
      await context.teardown?.();
    });

    /** Some bytes, the same each time for a seed, and their upload's record. */
    const upload = (seed: number, size: number): { bytes: Uint8Array; record: ObjectUploadJob } => {
      const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 31 + seed) % 251);
      return { bytes, record: { repo: context.repo, workspace: 'main', hash: computeHash(bytes), size: BigInt(size) } };
    };

    /** Sends every part of an upload's bytes, the last first, as a client may. */
    const sendAll = async (id: string, record: ObjectUploadJob, bytes: Uint8Array): Promise<void> => {
      const partBytes = Number(await context.store.createParts(id, record));
      assert.ok(partBytes > 0, 'it plans parts of a positive size');
      assert.equal(await context.store.getPartBytes(id), BigInt(partBytes));
      const parts = Math.max(1, Math.ceil(bytes.length / partBytes));
      for (let part = parts; part >= 1; part--) {
        assert.ok((await context.store.getPartUpload(id, record, part)).url.length > 0, `part ${part} has a URL`);
        await context.sendPart(id, record, part, bytes.subarray((part - 1) * partBytes, part * partBytes));
      }
    };

    /** Asserts a commit came to a status. */
    const committed = (status: ObjectCommitStatus | null, expected: ObjectCommitStatus, why: string): void => {
      assert.ok(status !== null && sameStatus(status, expected), `${why}: it came to ${status === null ? 'none' : status.type}`);
    };

    it('commits an upload\'s parts as the object they hash to, which it names nowhere, and answers as it finished when asked again', async () => {
      const { bytes, record } = upload(1, 1000);
      const id = uuidv7();
      await context.store.create(id, record);
      await sendAll(id, record, bytes);
      const refs = await context.storage.refs.workspaceList(context.repo);
      committed(await context.store.commit(id, record), variant('completed', null), 'it completed');
      assert.deepEqual(new Uint8Array(await context.storage.objects.read(context.repo, record.hash)), bytes, 'the store holds the bytes as their object');
      committed(await context.store.commit(id, record), variant('completed', null), 'asked again, it answers the same');
      committed(await context.store.getCommitStatus(id), variant('completed', null), 'and a poll reads it');
      assert.deepEqual(await context.storage.refs.workspaceList(context.repo), refs, 'no workspace changed');
    });

    it('fails an upload whose bytes do not hash to its name, or are not its size, and stores nothing', async () => {
      const { bytes, record } = upload(2, 700);
      const wrongHash: ObjectUploadJob = { ...record, hash: computeHash(Uint8Array.of(9)) };
      const id = uuidv7();
      await context.store.create(id, wrongHash);
      await sendAll(id, wrongHash, bytes);
      const status = await context.store.commit(id, wrongHash);
      assert.equal(status.type, 'failed', 'bytes that hash to another object fail');
      assert.deepEqual(await context.storage.objects.touch(context.repo, [wrongHash.hash]), [false], 'and stores nothing');

      const short: ObjectUploadJob = { ...record, size: record.size + 1n };
      const other = uuidv7();
      await context.store.create(other, short);
      await sendAll(other, short, bytes);
      assert.equal((await context.store.commit(other, short)).type, 'failed', 'bytes short of the size fail');
      assert.equal(await context.store.getCommitStatus(uuidv7()), null, 'and a commit never asked for reads as none');
    });
  });
}
