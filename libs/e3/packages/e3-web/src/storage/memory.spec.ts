/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The adapters in memory, held to the adapters' contract: what e3's Node
 * test pass runs every store suite over, and a page opened with
 * `persist: false` keeps its repositories in.
 */

import { describe, it } from 'node:test';
import {
  blobsContract,
  filesContract,
  locksContract,
  recordsContract,
  runAdapterCase,
  type AdapterSetup,
  type BlobsSetup,
  type FilesSetup,
  type LocksSetup,
  type RecordsSetup,
} from '../testing/adapter-contract.js';
import { MemoryBlobs, MemoryFiles, MemoryLockSpace, MemoryRecordStore, openMemoryRecords } from './memory.js';

const records: AdapterSetup<RecordsSetup> = (cleanup) => {
  const store = new MemoryRecordStore();
  return Promise.resolve({
    open: () => {
      const adapter = openMemoryRecords(store);
      cleanup(() => adapter.close());
      return Promise.resolve(adapter);
    },
  });
};

const blobs: AdapterSetup<BlobsSetup> = () => Promise.resolve({ blobs: new MemoryBlobs() });

const locks: AdapterSetup<LocksSetup> = (cleanup) => {
  const space = new MemoryLockSpace();
  return Promise.resolve({
    open: async () => {
      const adapter = await space.open();
      cleanup(() => adapter.close());
      return adapter;
    },
  });
};

const files: AdapterSetup<FilesSetup> = async () => {
  const adapter = new MemoryFiles();
  await adapter.mkdir('/scratch');
  return { files: adapter, dir: '/scratch', join: (dir, name) => `${dir}/${name}` };
};

describe('the adapters in memory', () => {
  describe('records', () => {
    for (const adapterCase of recordsContract) it(adapterCase.name, () => runAdapterCase(adapterCase, records));
  });
  describe('blobs', () => {
    for (const adapterCase of blobsContract) it(adapterCase.name, () => runAdapterCase(adapterCase, blobs));
  });
  describe('locks', () => {
    for (const adapterCase of locksContract) it(adapterCase.name, () => runAdapterCase(adapterCase, locks));
  });
  describe('files', () => {
    for (const adapterCase of filesContract) it(adapterCase.name, () => runAdapterCase(adapterCase, files));
  });
});
