/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The package's entries: the ones a page or a worker bundles — the root, which
 * the e3 worker runs, and the units entry, which a unit worker runs — which
 * reach nothing of Node, nothing of e3-core's root entry, and nothing of e3's
 * SDK; and the Node one, which a browser bundle refuses.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';

/**
 * Refuses an import a browser entry must not reach, naming what imported it.
 *
 * @param filter - The imports refused
 * @param why - Why, as the refusal says
 */
function refuse(filter: RegExp, why: string): Plugin {
  return {
    name: `refuse ${filter.source}`,
    setup(bundler) {
      bundler.onResolve({ filter }, (args) => ({ errors: [{ text: `${args.importer} imports ${args.path}: ${why}` }] }));
    },
  };
}

/** Bundles an entry of this package for a browser — or a module's source, as
 *  if it were one — and answers its errors. */
async function bundleForBrowser(entry: string | { readonly contents: string }): Promise<string[]> {
  const source = typeof entry === 'string'
    ? { entryPoints: [fileURLToPath(new URL(entry, import.meta.url))] }
    : { stdin: { contents: entry.contents, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'js' as const } };
  try {
    await build({
      ...source,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      logLevel: 'silent',
      plugins: [
        // e3-core's root entry is the local backend's, beside the portable one
        refuse(/^@elaraai\/e3-core$/, 'a browser imports @elaraai/e3-core/portable'),
        // e3's SDK authors packages, in Node: a test exports them there
        refuse(/^@elaraai\/e3(\/.*)?$/, 'e3\'s SDK is a test dependency, which exports the runner\'s fixtures in Node'),
      ],
    });
    return [];
  } catch (err) {
    return (err as { errors?: Array<{ text: string }> }).errors?.map(({ text }) => text) ?? [String(err)];
  }
}

describe('the package\'s entries', () => {
  it('bundles its root entry for a browser: it reaches nothing of Node, of e3-core\'s root entry or of e3\'s SDK', async () => {
    assert.deepEqual(await bundleForBrowser('./index.js'), []);
  });

  it('bundles its units entry for a unit worker: it reaches nothing of Node, of e3-core\'s root entry or of e3\'s SDK', async () => {
    assert.deepEqual(await bundleForBrowser('./units.js'), []);
  });

  it('refuses to bundle a module that reaches e3\'s SDK, which only the runner\'s fixtures, in Node, do', async () => {
    const errors = await bundleForBrowser('./testing/runner-fixtures.js');
    assert.ok(errors.some((text) => text.includes('imports @elaraai/e3: e3\'s SDK is a test dependency')), errors.join('\n'));
  });

  it('refuses to bundle a module that reaches e3-core\'s root entry', async () => {
    const errors = await bundleForBrowser({ contents: 'import \'@elaraai/e3-core\';' });
    assert.ok(errors.some((text) => text.includes('imports @elaraai/e3-core: a browser imports @elaraai/e3-core/portable')), errors.join('\n'));
  });

  it('keeps the machine\'s files to the Node entry, which a browser bundle refuses', async () => {
    const errors = await bundleForBrowser('./node.js');
    assert.ok(errors.some((text) => text.includes('node:fs/promises')), errors.join('\n'));
  });
});
