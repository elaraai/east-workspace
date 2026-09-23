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
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import {
  DictType, East, IntegerType, StringType, SortedMap, compareFor,
  decodeBeast2For, encodeBeast2For, encodeBeast2PagedFor, encodeEastIR, isFrozenValue, Beast2Pages,
  COLLECTION_MANIFEST_KIND, carveBeast2, encodeBeast2FenceFor, encodeCollectionManifest,
  openBeast2PagesFor, readBeast2Extents, segmentRuleFor, toEastTypeValue,
} from '@elaraai/east';

import { inputBytes, loadPlatform, loadPlatformWithMetadata, loadInput, loadInputLazy, lazyInputBytesRead } from './loader.js';
import { runProgram } from './runner.js';

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
      writeFileSync(path, encodeBeast2PagedFor(DT)(table));
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

describe('loadInputLazy — an input staged as a manifest over segment files', () => {
  const DT = DictType(IntegerType, StringType);

  /** `n` rows keyed 0..n-1. */
  const rows = (n: number): SortedMap<bigint, string> => new SortedMap<bigint, string>(
    Array.from({ length: n }, (_, i) => [BigInt(i), `row-${i}`] as [bigint, string]),
    compareFor(IntegerType),
  );

  /**
   * Stages `value` the way e3 does: the manifest at `<dir>/table.beast2` and
   * one file per segment under `<dir>/table.beast2.segments/`, named by the
   * segment's own hash.
   */
  function stageManifest(dir: string, value: SortedMap<bigint, string>): string {
    const blob = encodeBeast2PagedFor(DT)(value);
    const extents = readBeast2Extents(blob);
    const segmentDir = join(dir, 'table.beast2.segments');
    mkdirSync(segmentDir, { recursive: true });
    const fence = encodeBeast2FenceFor(IntegerType);
    const pages = openBeast2PagesFor(DT)(blob);
    const entries = Array.from({ length: extents.offsets.length }, (_, i) => {
      const segment = carveBeast2(blob, i, i + 1, extents);
      const hash = createHash('sha256').update(segment).digest('hex');
      writeFileSync(join(segmentDir, `${hash}.beast2`), segment);
      return { hash, fence: fence(pages.fence(i)), count: BigInt(extents.counts[i]!), bytes: BigInt(segment.byteLength) };
    });
    const path = join(dir, 'table.beast2');
    writeFileSync(path, encodeCollectionManifest({
      kind: COLLECTION_MANIFEST_KIND,
      level: 0n,
      type: toEastTypeValue(DT),
      rule: segmentRuleFor(DT),
      header: 'header',
      entries,
    }));
    return path;
  }

  it('is the collection the manifest describes, read one segment at a time', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enc-manifest-'));
    try {
      const table = rows(20_000);
      const path = stageManifest(dir, table);
      const value = loadInputLazy(path) as SortedMap<bigint, string>;
      assert.ok(value instanceof SortedMap);
      assert.ok(isFrozenValue(value));
      assert.equal(value.size, 20_000);

      // A keyed read decodes ONE segment: the fences came with the manifest,
      // so the bisect reads nothing, and only the owning segment's file is
      // opened. That is the whole claim of staging by link.
      const before = lazyInputBytesRead(value)!;
      assert.equal(value.get(9_999n), 'row-9999');
      const after = lazyInputBytesRead(value)!;
      assert.ok(after > before, 'the read reached a segment file');
      assert.ok(after < 20_000 * 8, `one segment, not the value: ${after} bytes`);
      assert.equal((value as unknown as { hydrated: boolean }).hydrated, false, 'served reads never hydrate');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('iterates the whole collection in canonical order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enc-manifest-'));
    try {
      const value = loadInputLazy(stageManifest(dir, rows(5_000))) as SortedMap<bigint, string>;
      let n = 0n;
      for (const [key, row] of value) {
        assert.equal(key, n);
        assert.equal(row, `row-${n}`);
        n++;
      }
      assert.equal(n, 5_000n);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is the value the eager load splices from the same files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enc-manifest-'));
    try {
      const table = rows(5_000);
      const path = stageManifest(dir, table);
      const eager = loadInput(path, toEastTypeValue(DT)) as SortedMap<bigint, string>;
      assert.equal(eager.size, 5_000);
      assert.equal(eager.get(4_999n), 'row-4999');
      const lazy = loadInputLazy(path) as SortedMap<bigint, string>;
      assert.deepEqual([...lazy.keys()], [...eager.keys()]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the eager load when a segment file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enc-manifest-'));
    try {
      const path = stageManifest(dir, rows(5_000));
      rmSync(join(dir, 'table.beast2.segments'), { recursive: true, force: true });
      assert.equal(loadInputLazy(path), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('holds an empty collection with no segment files at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enc-manifest-'));
    try {
      const path = stageManifest(dir, rows(0));
      assert.equal((loadInputLazy(path) as SortedMap<bigint, string>).size, 0);
      assert.equal((loadInput(path, toEastTypeValue(DT)) as SortedMap<bigint, string>).size, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('measures a staged input by the value it names, not by the manifest file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'enc-manifest-'));
    try {
      const path = stageManifest(dir, rows(20_000));
      const segmentDir = join(dir, 'table.beast2.segments');
      const value = readdirSync(segmentDir).reduce((sum, name) => sum + statSync(join(segmentDir, name)).size, statSync(path).size);
      assert.equal(inputBytes(path), value);
      assert.ok(statSync(path).size * 10 < value, 'the manifest file is a small fraction of the value');

      const blob = join(dir, 'blob.beast2');
      writeFileSync(blob, encodeBeast2PagedFor(DT)(rows(1_000)));
      assert.equal(inputBytes(blob), statSync(blob).size, 'a blob is its own file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('opens lazily once the value crosses the threshold, however small its manifest', async () => {
    // A runner that measured the file would find a few kilobytes of manifest
    // and decode a multi-gigabyte input whole.
    const dir = mkdtempSync(join(tmpdir(), 'enc-manifest-'));
    try {
      const path = stageManifest(dir, rows(20_000));
      const threshold = statSync(path).size + 1;
      const irPath = join(dir, 'program.beast2');
      writeFileSync(irPath, encodeEastIR(East.function([DT], StringType, ($, table) => table.get(9_999n)).toIR()));
      const outputPath = join(dir, 'output.beast2');

      const lines: string[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
      try {
        await runProgram(irPath, [], [], [path], outputPath, { lazyInputBytes: threshold, verbose: true });
      } finally {
        console.error = original;
      }
      assert.ok(lines.some((line) => line.includes('input 0: opened lazily')), lines.join('\n'));
      assert.equal(decodeBeast2For(StringType)(new Uint8Array(readFileSync(outputPath))), 'row-9999');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('holds no descriptor per segment file while the body iterates', { skip: existsSync('/proc/self/fd') ? false : 'counts descriptors in /proc/self/fd' }, () => {
    // An index build over one partition iterates the whole primary, and a
    // descriptor held per segment ran out of them — EMFILE — around a million
    // rows at the common limit of 1024.
    const dir = mkdtempSync(join(tmpdir(), 'enc-manifest-'));
    try {
      const value = loadInputLazy(stageManifest(dir, rows(60_000))) as SortedMap<bigint, string>;
      const segments = readdirSync(join(dir, 'table.beast2.segments')).length;
      assert.ok(segments > 20, `precondition: many segment files, got ${segments}`);
      const descriptors = (): number => readdirSync('/proc/self/fd').length;

      const before = descriptors();
      let n = 0n;
      for (const [key] of value) {
        assert.equal(key, n);
        n++;
      }
      assert.equal(n, 60_000n);
      const held = descriptors() - before;
      assert.ok(held <= 1, `iterating ${segments} segment files left ${held} descriptors open`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
