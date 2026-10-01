/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The package's entries: the root one a page or a worker bundles, which
 * reaches nothing of Node, and the Node one, which a browser bundle refuses.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** Bundles an entry of this package for a browser, and answers its errors. */
async function bundleForBrowser(entry: string): Promise<string[]> {
  try {
    await build({
      entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      logLevel: 'silent',
    });
    return [];
  } catch (err) {
    return (err as { errors?: Array<{ text: string }> }).errors?.map(({ text }) => text) ?? [String(err)];
  }
}

describe('the package\'s entries', () => {
  it('bundles its root entry for a browser: it reaches nothing of Node', async () => {
    assert.deepEqual(await bundleForBrowser('./index.js'), []);
  });

  it('keeps the machine\'s files to the Node entry, which a browser bundle refuses', async () => {
    const errors = await bundleForBrowser('./node.js');
    assert.ok(errors.some((text) => text.includes('node:fs/promises')), errors.join('\n'));
  });
});
