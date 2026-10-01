/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The package's entries: the ones a page or a worker bundles — the root, which
 * a page and the e3 worker run, createWebE3 and the storage among it; the
 * worker entry, serveE3 and the routes it mounts; the e3 worker's side of
 * e3.fetch; and the units entry, which a unit worker runs — which reach
 * nothing of Node, nothing of e3-core's or e3-api-server's root entries, and
 * nothing of e3's SDK; none of whose modules, of whatever package — e3-web's,
 * e3-api-client's, e3-types', east-web-std's and east's among them — names a
 * global of Node's a browser has not; which bundle with no warning; and the
 * Node one, which a browser bundle refuses.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform, type Message, type Plugin } from 'esbuild';

/** The package's root, which a bundle's module paths are relative to. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Node's globals, which a browser has not: a module that names one it does
 *  not declare fails in a page as it reaches it. */
const NODE_GLOBALS = ['Buffer', 'process', 'require', 'setImmediate', '__dirname', '__filename', 'global'] as const;

/** What each of Node's globals is put in place of where a module names it
 *  free, so a module's code says whether it does. */
const IN_PLACE_OF: Readonly<Record<string, string>> = Object.fromEntries(
  NODE_GLOBALS.map((name) => [name, `__e3_web_free_node_global_${name}__`]),
);

/** The packages whose modules the browser bundles must take in, and check:
 *  e3-web's own, and what it brings a page and its workers. */
const CHECKED_PACKAGES = ['@elaraai/e3-web', '@elaraai/e3-api-client', '@elaraai/e3-types', '@elaraai/east-web-std', '@elaraai/east'];

/**
 * The globals of Node's a module's code names free: each it names and does
 * not declare, which esbuild puts something in place of.
 */
async function freeNodeGlobals(code: string): Promise<string[]> {
  const transformed = await transform(code, { define: IN_PLACE_OF, loader: 'js', format: 'esm', logLevel: 'silent' });
  return NODE_GLOBALS.filter((name) => transformed.code.includes(IN_PLACE_OF[name]!));
}

/** Each directory's package, by its path: `null` for one with no
 *  package.json naming one. */
const packageAt = new Map<string, string | null>();

/** The package a module is of: what the nearest package.json above it that
 *  names one names. */
async function packageOf(module: string): Promise<string> {
  for (let dir = dirname(module); ; dir = dirname(dir)) {
    let name = packageAt.get(dir);
    if (name === undefined) {
      try {
        name = (JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name?: string }).name ?? null;
      } catch {
        name = null;
      }
      packageAt.set(dir, name);
    }
    if (name !== null) return name;
    if (dirname(dir) === dir) return '(no package)';
  }
}

/** What esbuild said, a line each. */
function said(messages: readonly Message[]): string[] {
  return messages.map(({ text, location }) => (location === null ? text : `${location.file}:${location.line}: ${text}`));
}

/**
 * Refuses an import a browser entry must not reach, naming what imported it.
 *
 * @param filter - The imports refused: a regular expression esbuild runs, so
 *   one with no lookaround
 * @param why - Why, as the refusal says
 * @param except - The imports among them that are let through
 */
function refuse(filter: RegExp, why: string, except?: RegExp): Plugin {
  return {
    name: `refuse ${filter.source}`,
    setup(bundler) {
      bundler.onResolve({ filter }, (args) => (except?.test(args.path) === true
        ? undefined
        : { errors: [{ text: `${args.importer} imports ${args.path}: ${why}` }] }));
    },
  };
}

/** What bundling a module for a browser found. */
interface Bundled {
  /** Its errors: what it reaches that a browser has not, say */
  readonly errors: string[];
  /** What esbuild warned of */
  readonly warnings: string[];
  /** The modules the bundle took in, by their paths */
  readonly inputs: string[];
  /** The packages of the modules it took in */
  readonly packages: string[];
  /** Each of Node's globals a module it took in names free: `<module>
   *  (<package>) names <global>` */
  readonly freeGlobals: string[];
}

/** Bundles a module of this package for a browser — or a module's source, as
 *  if it were one — and answers its errors and warnings, the modules it took
 *  in and their packages, and the globals of Node's they name free. */
async function bundleForBrowser(entry: string | { readonly contents: string }): Promise<Bundled> {
  const source = typeof entry === 'string'
    ? { entryPoints: [fileURLToPath(new URL(entry, import.meta.url))] }
    : { stdin: { contents: entry.contents, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'js' as const } };
  try {
    const { metafile, warnings } = await build({
      ...source,
      absWorkingDir: ROOT,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      metafile: true,
      logLevel: 'silent',
      plugins: [
        // e3-core's root entry is the local backend's, beside the portable one
        refuse(/^@elaraai\/e3-core$/, 'a browser imports @elaraai/e3-core/portable'),
        // e3-api-server's root entry, and every subpath but the portable one,
        // reach the local server and its byte endpoints, over files
        refuse(/^@elaraai\/e3-api-server(\/.*)?$/, 'a browser imports @elaraai/e3-api-server/portable', /^@elaraai\/e3-api-server\/portable$/),
        // e3's SDK authors packages, in Node: a test exports them there
        refuse(/^@elaraai\/e3(\/.*)?$/, 'e3\'s SDK is a test dependency, which exports the runner\'s fixtures in Node'),
      ],
    });
    const inputs = Object.keys(metafile.inputs);
    const packages = new Set<string>();
    const freeGlobals: string[] = [];
    for (const input of inputs) {
      const isStdin = input === '<stdin>';
      if (!isStdin && !['.js', '.mjs', '.cjs'].includes(extname(input))) continue;
      const path = resolve(ROOT, input);
      const pkg = isStdin ? '(the module given)' : await packageOf(path);
      packages.add(pkg);
      const code = isStdin && typeof entry !== 'string' ? entry.contents : await readFile(path, 'utf8');
      for (const name of await freeNodeGlobals(code)) freeGlobals.push(`${input} (${pkg}) names ${name}`);
    }
    return { errors: [], warnings: said(warnings), inputs, packages: [...packages], freeGlobals };
  } catch (err) {
    const failed = err as { errors?: Message[]; warnings?: Message[] };
    return { errors: failed.errors === undefined ? [String(err)] : said(failed.errors), warnings: said(failed.warnings ?? []), inputs: [], packages: [], freeGlobals: [] };
  }
}

/** Asserts a bundle a browser runs is clean: no error, no warning, and no
 *  module that names one of Node's globals free. */
function assertClean(bundled: Bundled): void {
  assert.deepEqual(bundled.errors, []);
  assert.deepEqual(bundled.warnings, [], 'esbuild warns of nothing');
  assert.deepEqual(bundled.freeGlobals, [], 'no module names a global of Node\'s free');
}

/** Asserts a bundle took in each of this package's modules named. */
function assertTakesIn(bundled: Bundled, modules: readonly string[]): void {
  for (const module of modules) {
    assert.ok(bundled.inputs.some((input) => input.endsWith(`/src/${module}`)), `the bundle takes in ${module}: ${bundled.inputs.join(', ')}`);
  }
}

describe('the package\'s entries', () => {
  it('bundles its root entry for a browser: it reaches nothing of Node, of e3-core\'s root entry or of e3\'s SDK, createWebE3 and the storage among it', async () => {
    const bundled = await bundleForBrowser('./index.js');
    assertClean(bundled);
    assertTakesIn(bundled, ['bridge/page.js', 'bridge/protocol.js', 'storage/WebStorage.js']);
  });

  it('checks every module its browser bundles take in — e3-web\'s, e3-api-client\'s, e3-types\', east-web-std\'s and east\'s among them', async () => {
    const packages = new Set<string>();
    for (const entry of ['./index.js', './worker.js', './bridge/worker.js', './units.js']) {
      const bundled = await bundleForBrowser(entry);
      assertClean(bundled);
      for (const pkg of bundled.packages) packages.add(pkg);
    }
    assert.deepEqual(CHECKED_PACKAGES.filter((pkg) => !packages.has(pkg)), [], `the bundles take in every package checked: ${[...packages].sort().join(', ')}`);
  });

  it('refuses a module that names one of Node\'s globals free, or that esbuild warns of, and takes one that declares its own', async () => {
    const free = await bundleForBrowser({
      contents: 'export const a = Buffer.from("x"); export const b = process.env.HOME; export const c = require; setImmediate(() => a); export const d = __dirname;',
    });
    assert.deepEqual(free.freeGlobals, ['Buffer', 'process', 'require', 'setImmediate', '__dirname'].map((name) => `<stdin> ((the module given)) names ${name}`));
    const warned = await bundleForBrowser({ contents: 'export const twice = { key: 1, key: 2 };' });
    assert.ok(warned.warnings.some((text) => text.includes('Duplicate key "key"')), warned.warnings.join('\n'));
    const declared = await bundleForBrowser({ contents: 'const process = { env: {} }; export const env = process.env;' });
    assertClean(declared);
  });

  it('bundles its worker entry for the e3 worker: it reaches nothing of Node, of e3-core\'s or e3-api-server\'s root entries or of e3\'s SDK, serveE3 and the routes among it', async () => {
    const bundled = await bundleForBrowser('./worker.js');
    assertClean(bundled);
    assertTakesIn(bundled, [
      'worker.js', 'app.js', 'bridge/worker.js', 'transfer/WebTransferBackend.js', 'transfer/endpoints.js',
      'execution/WebTaskRunner.js', 'storage/WebStorage.js',
    ]);
    assert.ok(bundled.inputs.some((input) => input.includes('e3-api-server/dist/src/portable.js')), 'the bundle mounts e3-api-server\'s portable routes');
  });

  it('bundles the e3 worker\'s side of e3.fetch for a browser: it reaches nothing of Node, of e3-core\'s root entry or of e3\'s SDK', async () => {
    const bundled = await bundleForBrowser('./bridge/worker.js');
    assertClean(bundled);
    assertTakesIn(bundled, ['bridge/worker.js', 'bridge/protocol.js']);
  });

  it('bundles its units entry for a unit worker: it reaches nothing of Node, of e3-core\'s root entry or of e3\'s SDK, e3\'s own platform functions among it', async () => {
    const bundled = await bundleForBrowser('./units.js');
    assertClean(bundled);
    assertTakesIn(bundled, ['units.js', 'execution/unit-server.js', 'execution/e3-platform.js', 'bridge/page.js']);
  });

  it('refuses to bundle a module that reaches e3\'s SDK, which only the runner\'s fixtures, in Node, do', async () => {
    const { errors } = await bundleForBrowser('./testing/runner-fixtures.js');
    assert.ok(errors.some((text) => text.includes('imports @elaraai/e3: e3\'s SDK is a test dependency')), errors.join('\n'));
  });

  it('refuses to bundle a module that reaches e3-core\'s root entry', async () => {
    const { errors } = await bundleForBrowser({ contents: 'import \'@elaraai/e3-core\';' });
    assert.ok(errors.some((text) => text.includes('imports @elaraai/e3-core: a browser imports @elaraai/e3-core/portable')), errors.join('\n'));
  });

  it('refuses to bundle a module that reaches e3-api-server\'s root entry, or a subpath but its portable one', async () => {
    for (const path of ['@elaraai/e3-api-server', '@elaraai/e3-api-server/routes']) {
      const { errors } = await bundleForBrowser({ contents: `import '${path}';` });
      assert.ok(errors.some((text) => text.includes(`imports ${path}: a browser imports @elaraai/e3-api-server/portable`)), errors.join('\n'));
    }
    assert.deepEqual((await bundleForBrowser({ contents: 'import \'@elaraai/e3-api-server/portable\';' })).errors, []);
  });

  it('keeps the machine\'s files to the Node entry, which a browser bundle refuses', async () => {
    const { errors } = await bundleForBrowser('./node.js');
    assert.ok(errors.some((text) => text.includes('node:fs/promises')), errors.join('\n'));
  });
});
