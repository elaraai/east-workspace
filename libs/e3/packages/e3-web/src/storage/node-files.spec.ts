/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The machine's files, held to the files adapter's contract: the paths
 * e3-web's stores adopt and place files at in Node.
 */

import { describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filesContract, runAdapterCase, type AdapterSetup, type FilesSetup } from '../testing/adapter-contract.js';
import { NodeFiles } from './node-files.js';

const files: AdapterSetup<FilesSetup> = (cleanup) => {
  const dir = mkdtempSync(join(tmpdir(), 'e3-web-files-'));
  cleanup(() => rmSync(dir, { recursive: true, force: true }));
  return Promise.resolve({ files: new NodeFiles(), dir, join });
};

describe('the machine\'s files', () => {
  for (const adapterCase of filesContract) it(adapterCase.name, () => runAdapterCase(adapterCase, files));
});
