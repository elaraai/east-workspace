/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The seams e3-core's shared code goes through.
 *
 * A mechanism another backend needs reaches storage, locks and compute only
 * through the interfaces a backend implements, so a shared module never
 * imports the local backend, nor reaches into the machine's filesystem on a
 * repository's behalf, nor judges a process alive on the host that answers.
 * The modules that may are listed below, each with why; an entry that no
 * longer needs its exception fails too, so the list only shrinks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** e3-core's sources: the spec runs from `dist/src`. */
const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** Every source module, by its path under `src`, forward-slashed. */
function sources(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .map((file) => file.split(sep).join('/'))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.d.ts'));
}

/** The module specifiers a source imports, statically or dynamically. */
function imports(file: string): string[] {
  const text = readFileSync(join(SRC, file), 'utf8');
  return [...text.matchAll(/(?:from|import\()\s*'([^']+)'/g)].map((match) => match[1]!);
}

/** Whether a path falls under one of the directories, or is one of the files. */
function within(file: string, places: readonly string[]): boolean {
  return places.some((place) => place.endsWith('/') ? file.startsWith(place) : file === place);
}

/**
 * The local backend and the local runner, which are local by what they are:
 * the modules that run a unit as a process on this machine and judge its
 * processes here. The rest of `execution/` — the engine and its drivers, the
 * planners, the runner interface — is shared, and every backend's driver runs
 * it.
 */
const LOCAL = [
  'storage/local/',
  'execution/LocalTaskRunner.ts', 'execution/processExec.ts', 'execution/processHelpers.ts', 'execution/runDetached.ts',
  'execution/intake.ts', 'execution/units.ts', 'execution/environment.ts', 'execution/scratch.ts', 'execution/budget.ts',
  'execution/cgroups.ts', 'execution/memory.ts', 'execution/segment-fetch.ts',
];

/** Test support: it creates local repositories and temporary files for tests. */
const TEST_SUPPORT = ['test-helpers.ts', 'contract/'];

/** The modules besides {@link LOCAL} that may import the local backend, and why. */
const LOCAL_IMPORTS: Record<string, string> = {
  'index.ts': 'the package exports the local backend beside the interfaces',
  'storage/index.ts': 'the storage barrel exports the local backend beside the interfaces',
  'dataflow/state-store/FileStateStore.ts': 'the local implementation of the execution state store',
  'transfer/InMemoryTransferBackend.ts': 'the local server\'s transfer backend, which stages in the repository',
};

/** The modules besides {@link LOCAL} that may use the machine's filesystem, and why. */
const FILE_SYSTEM: Record<string, string> = {
  'dataflow/state-store/FileStateStore.ts': 'the local implementation of the execution state store',
  'transfer/InMemoryTransferBackend.ts': 'the local server\'s transfer backend, which stages in the repository',
  'transfer/process.ts': 'a zip job given a file reads or writes it on the machine that runs it',
  'packages.ts': 'an import reads, and an export writes, a zip given as a file on this machine',
  'workspaces.ts': 'an export writes a zip given as a file, and a deploy reads a `file` source, on this machine',
  'dataset-adopt.ts': 'an adoption takes in a file on this machine',
  'delivery-intake.ts': 'an intake reads the index of a delivered file on this machine, to cut it into pieces',
  'store-collection.ts': 'the store\'s door reads a runner\'s output files on this machine',
  'formats.ts': 'the CLI\'s formats read and write a user\'s files on this machine',
  'storage/in-memory/InMemoryStorage.ts': 'its object store adopts and materializes files on this machine, as the interface asks',
};

/** Whether a specifier names the local backend. */
const isLocalBackend = (specifier: string): boolean => /(^|\/)storage\/local\/|^\.\/local\//.test(specifier);

/** Whether a specifier names the filesystem or the OS. */
const isFileSystem = (specifier: string): boolean => /^(node:)?(fs|fs\/promises|os)$/.test(specifier);

/** Whether a source judges a pid alive, which only the host running the
 *  process can. */
const judgesProcessAlive = (file: string): boolean =>
  /\b(?:isProcessAlive|processExited)\s*\(/.test(readFileSync(join(SRC, file), 'utf8'));

/** The arguments of each call a source makes of the execution cache's probe. */
const probeCalls = (file: string): string[][] =>
  [...readFileSync(join(SRC, file), 'utf8').matchAll(/\bprobeExecutionCache\s*\(([^()]*)\)/g)]
    .map((match) => match[1]!.split(',').map((arg) => arg.trim()).filter((arg) => arg !== ''));

describe('the seams shared code goes through', () => {
  it('no shared module imports the local backend', () => {
    const reaching = sources()
      .filter((file) => !within(file, [...LOCAL, ...TEST_SUPPORT]) && !(file in LOCAL_IMPORTS))
      .filter((file) => imports(file).some(isLocalBackend));
    assert.deepEqual(reaching, [], 'these reach into the local backend: go through the storage interfaces instead');
  });

  it('no shared module uses the machine\'s filesystem on a repository\'s behalf', () => {
    const reaching = sources()
      .filter((file) => !within(file, [...LOCAL, ...TEST_SUPPORT]) && !(file in FILE_SYSTEM))
      .filter((file) => imports(file).some(isFileSystem));
    assert.deepEqual(reaching, [], 'these use the filesystem: go through the storage interfaces, or say why here');
  });

  it('no shared module judges a process alive on the host that answers', () => {
    const judging = sources()
      .filter((file) => !within(file, [...LOCAL, ...TEST_SUPPORT]))
      .filter(judgesProcessAlive);
    assert.deepEqual(judging, [], 'these judge a pid alive where they run: ask the runner (TaskRunner.executionAlive) or the lock service (LockService.isHolderAlive)');
  });

  it('no shared module probes the execution cache without the liveness it was given', () => {
    // Without one the probe judges on the host that runs it, and rewrites a
    // unit still running on another host as interrupted.
    const probing = sources()
      .filter((file) => !within(file, [...LOCAL, ...TEST_SUPPORT]))
      .filter((file) => probeCalls(file).some((args) => args.length < 5));
    assert.deepEqual(probing, [], 'these probe with the local judgement of what still runs: pass the liveness the driver was given (TaskRunner.executionAlive)');
  });

  it('every exception is still one', () => {
    for (const [list, needs] of [[LOCAL_IMPORTS, isLocalBackend], [FILE_SYSTEM, isFileSystem]] as const) {
      for (const file of Object.keys(list)) {
        assert.ok(existsSync(join(SRC, file)), `${file} is gone: remove its exception`);
        assert.ok(imports(file).some(needs), `${file} no longer needs its exception: remove it`);
      }
    }
    for (const place of LOCAL) assert.ok(existsSync(join(SRC, place)), `${place} is gone: remove it from the local modules`);
  });
});
