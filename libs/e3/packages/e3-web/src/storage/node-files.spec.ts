/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The machine's files, held to the files adapter's contract: the paths
 * e3-web's stores adopt and place files at in Node.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTRACT_READ_CHUNK, filesContract, runAdapterCase, type AdapterSetup, type FilesSetup } from '../testing/adapter-contract.js';
import { FILE_READ_CHUNK } from './adapters.js';
import { NodeFiles } from './node-files.js';

const files: AdapterSetup<FilesSetup> = (cleanup) => {
  const dir = mkdtempSync(join(tmpdir(), 'e3-web-files-'));
  cleanup(() => rmSync(dir, { recursive: true, force: true }));
  return Promise.resolve({ files: new NodeFiles({ readChunk: CONTRACT_READ_CHUNK }), dir, join });
};

describe('the machine\'s files', () => {
  for (const adapterCase of filesContract) it(adapterCase.name, () => runAdapterCase(adapterCase, files));

  it('reads in slices of FILE_READ_CHUNK unless made with another size, and refuses one that is not a whole number of bytes greater than zero', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'e3-web-files-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const adapter = new NodeFiles();
    const file = join(dir, 'file');
    await adapter.write(file, new Uint8Array(2 * FILE_READ_CHUNK + 1));
    const chunks: number[] = [];
    for await (const chunk of adapter.read(file)) chunks.push(chunk.length);
    assert.deepEqual(chunks, [FILE_READ_CHUNK, FILE_READ_CHUNK, 1]);
    for (const readChunk of [0, -1, 1.5, Number.NaN]) {
      assert.throws(() => new NodeFiles({ readChunk }), RangeError, `a read size of ${readChunk}`);
    }
  });
});
