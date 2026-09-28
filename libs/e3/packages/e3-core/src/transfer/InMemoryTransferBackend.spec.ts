/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The local server's upload commits: a commit still running says how far it
 * has taken the file in, for the client polling it, and how it finished once
 * it has.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ArrayType, IntegerType, StringType, StructType, encodeBeast2PagedFor, some, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { computeHash } from '../objects.js';
import { packageImport } from '../packages.js';
import { workspaceCreate, workspaceDeploy } from '../workspaces.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from '../test-helpers.js';
import { LocalStorage } from '../storage/local/index.js';
import { transferStagingPath } from '../storage/local/localHelpers.js';
import type { RefStore, StorageBackend } from '../storage/index.js';
import { InMemoryTransferBackend } from './InMemoryTransferBackend.js';

const RowsType = ArrayType(StructType({ id: IntegerType, name: StringType }));

describe('an upload commit', () => {
  let repo: string;
  let tempDir: string;
  let storage: StorageBackend;

  beforeEach(async () => {
    repo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage(dirname(repo));
    const zip = join(tempDir, 'table-1.0.0.zip');
    await e3.export(e3.package('table', '1.0.0', e3.input('rows', RowsType, variant('value', []))), zip);
    await packageImport(storage, repo, zip);
    await workspaceCreate(storage, repo, 'main');
    await workspaceDeploy(storage, repo, 'main', 'table', '1.0.0');
  });

  afterEach(() => {
    removeTestRepo(repo);
    removeTempDir(tempDir);
  });

  it('says how far it has taken the file in while it runs, and how it finished once it has', async () => {
    // The adoption's last write holds until released: the commit has taken the
    // file in, and has not yet pointed the dataset at it.
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let reach!: () => void;
    const reached = new Promise<void>((resolve) => { reach = resolve; });
    const refs = Object.create(storage.refs) as RefStore;
    refs.adoptionWrite = async (...args) => {
      reach();
      await released;
      return storage.refs.adoptionWrite(...args);
    };
    const held = Object.assign(Object.create(storage) as StorageBackend, { refs });
    const uploads = new InMemoryTransferBackend({ storage: held, getRepoPath: () => repo }).datasetUpload;

    // A delivery the Writer wrote, staged as its parts stage it.
    const data = encodeBeast2PagedFor(RowsType)(Array.from({ length: 100 }, (_, i) => ({ id: BigInt(i), name: `row ${i}` })));
    const record = { repo: 'r', workspace: 'main', path: 'inputs/rows', hash: computeHash(data), size: BigInt(data.byteLength) };
    await uploads.create('u1', record);
    await uploads.createParts('u1', record);
    writeFileSync(transferStagingPath(repo, 'u1'), data);

    const committing = uploads.commit('u1', record);
    await reached;
    assert.deepEqual(await uploads.getCommitStatus('u1'), variant('processing', some({
      path: 'inputs/rows',
      step: variant('taking_in', { foreign: false }),
      bytes: BigInt(data.byteLength),
      total: BigInt(data.byteLength),
    })), 'the Writer\'s bytes, carried whole, and not yet named by the dataset');

    release();
    assert.deepEqual(await committing, variant('completed', null));
    assert.deepEqual(await uploads.getCommitStatus('u1'), variant('completed', null));
  });
});
