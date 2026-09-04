/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for platform-package resolution in the loader.
 *
 * The focus is the project-root (`process.cwd()`) resolution fallback added so
 * a project's OWN package can self-resolve its `./platform` subpath through its
 * `exports` map — the load-bearing piece of the TS-East "project-owned platform
 * module" path. A fake project is planted on disk (a `package.json` with a
 * `./platform` export + a compiled `dist/platform.js`) and `process.cwd()` is
 * pointed at it; the CLI-bin root (`process.argv[1]`) never resolves the fake
 * package, so only the cwd fallback can.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  DictType, IntegerType, StringType, SortedMap, compareFor,
  encodeBeast2For, encodeBeast2PagedFor, isFrozenValue, Beast2Pages,
} from '@elaraai/east';

import { loadPlatform, loadPlatformWithMetadata, loadInputLazy } from './loader.js';

/**
 * Plant a self-contained fake platform package on disk and return its dir.
 * The package is named `name`, exports `./platform` (+ `./package.json` so the
 * metadata path can self-resolve), and ships a compiled `dist/platform.js`
 * whose body is `platformJs`.
 */
function makeFakeProject(name: string, platformJs: string): string {
  const root = mkdtempSync(join(tmpdir(), 'enc-loader-'));
  const proj = join(root, 'project');
  mkdirSync(join(proj, 'dist'), { recursive: true });
  writeFileSync(
    join(proj, 'package.json'),
    JSON.stringify(
      {
        name,
        version: '2.3.4',
        type: 'module',
        exports: {
          './platform': './dist/platform.js',
          './package.json': './package.json',
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(proj, 'dist', 'platform.js'), platformJs);
  return proj;
}

/** Run `fn` with `process.cwd()` temporarily pointed at `dir`. */
async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

/** Run `fn` with `E3_RUNNER_SEARCH_DIRS` temporarily set to `value`. */
async function withRunnerSearchDirs<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.E3_RUNNER_SEARCH_DIRS;
  process.env.E3_RUNNER_SEARCH_DIRS = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.E3_RUNNER_SEARCH_DIRS;
    else process.env.E3_RUNNER_SEARCH_DIRS = prev;
  }
}

describe('loadPlatform — project-root resolution fallback', () => {
  it("resolves a project's own <name>/platform via the cwd fallback", async () => {
    const proj = makeFakeProject(
      'acme-demo',
      'export default [{ name: "acme.echo", inputs: [], output: { type: "String" }, type: "sync", fn: (x) => x }];\n',
    );
    try {
      const fns = await withCwd(proj, () => loadPlatform('acme-demo'));
      assert.equal(fns.length, 1);
      assert.equal(fns[0]!.name, 'acme.echo');
      assert.equal(fns[0]!.type, 'sync');
    } finally {
      rmSync(dirname(proj), { recursive: true, force: true });
    }
  });

  it('throws a friendly error when no require root resolves the platform', async () => {
    // Neither the CLI-bin root nor cwd has this package installed.
    await assert.rejects(
      () => loadPlatform('@elaraai/definitely-not-a-real-platform-xyz'),
      /Could not load platform package/,
    );
  });

  it('still rejects a package whose ./platform is not a PlatformFunction[]', async () => {
    const proj = makeFakeProject('acme-bad', 'export default { not: "an array" };\n');
    try {
      await assert.rejects(
        () => withCwd(proj, () => loadPlatform('acme-bad')),
        /does not export a valid platform/,
      );
    } finally {
      rmSync(dirname(proj), { recursive: true, force: true });
    }
  });
});

describe('loadPlatform — E3_RUNNER_SEARCH_DIRS (the e3 dataflow-run path)', () => {
  it('resolves a SCOPED project package by self-reference when cwd is a scratch dir', async () => {
    // Reproduces what `e3 dataflow run` actually does: the runner is spawned in
    // a scratch cwd (NOT the project), so the cwd fallback cannot help — only
    // the project root that e3 propagates via E3_RUNNER_SEARCH_DIRS can. The
    // scaffold names packages `@elaraai/<name>`, so resolution must work for a
    // SCOPED self-reference (`@elaraai/acme/platform`).
    const proj = makeFakeProject(
      '@elaraai/acme',
      'export default [{ name: "acme.apply_safety_buffer", inputs: [], output: { type: "Integer" }, type: "sync", fn: () => 0n }];\n',
    );
    const scratch = mkdtempSync(join(tmpdir(), 'enc-scratch-'));
    try {
      const fns = await withCwd(scratch, () =>
        withRunnerSearchDirs(proj, () => loadPlatform('@elaraai/acme')),
      );
      assert.equal(fns.length, 1);
      assert.equal(fns[0]!.name, 'acme.apply_safety_buffer');
    } finally {
      rmSync(dirname(proj), { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('still fails (not silently) when neither cwd nor E3_RUNNER_SEARCH_DIRS resolves it', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'enc-scratch-'));
    try {
      await assert.rejects(
        () =>
          withCwd(scratch, () =>
            withRunnerSearchDirs(scratch, () => loadPlatform('@elaraai/nope-not-here')),
          ),
        /Could not load platform package/,
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('loadPlatformWithMetadata — project-root resolution fallback', () => {
  it("reads name/version from the project's own package.json via the cwd fallback", async () => {
    const proj = makeFakeProject('acme-meta', 'export default [];\n');
    try {
      const meta = await withCwd(proj, () => loadPlatformWithMetadata('acme-meta'));
      assert.equal(meta.name, 'acme-meta');
      assert.equal(meta.version, '2.3.4');
      assert.deepEqual(meta.fns, []);
    } finally {
      rmSync(dirname(proj), { recursive: true, force: true });
    }
  });
});

describe('loadInputLazy — the input pages from its file descriptor', () => {
  const DT = DictType(IntegerType, StringType);
  const table = new SortedMap<bigint, string>(
    Array.from({ length: 2000 }, (_, i) => [BigInt(i), `row-${i}`] as [bigint, string]),
    compareFor(IntegerType),
  );

  it('serves keyed reads frozen and un-hydrated, fetching one segment per read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enc-lazy-'));
    try {
      const path = join(dir, 'table.beast2');
      writeFileSync(path, encodeBeast2PagedFor(DT, { batchSize: 250 })(table));
      const value = loadInputLazy(path) as SortedMap<bigint, string>;
      assert.ok(value instanceof SortedMap);
      assert.ok(isFrozenValue(value));
      assert.equal(value.size, 2000);

      const proto = Beast2Pages.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
      const originalGet = proto.get!;
      let keyed = 0;
      proto.get = function (this: unknown, ...args: unknown[]) { keyed++; return originalGet.apply(this, args); };
      try {
        assert.equal(value.get(1234n), 'row-1234');
      } finally {
        proto.get = originalGet;
      }
      assert.equal(keyed, 1, 'the keyed read reaches the pager');
      assert.equal((value as unknown as { hydrated: boolean }).hydrated, false, 'served reads never hydrate');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back (undefined) for index-less blobs, non-beast2 files and missing files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enc-lazy-'));
    try {
      const indexless = join(dir, 'whole.beast2');
      writeFileSync(indexless, encodeBeast2For(DT)(table));
      assert.equal(loadInputLazy(indexless), undefined);
      const text = join(dir, 'value.json');
      writeFileSync(text, '{}');
      assert.equal(loadInputLazy(text), undefined);
      assert.equal(loadInputLazy(join(dir, 'missing.beast2')), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
