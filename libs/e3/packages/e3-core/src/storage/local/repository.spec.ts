/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for storage/local/repository.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeBeast2For } from '@elaraai/east';
import { E3_RELEASE } from '@elaraai/e3-types';
import {
  REPOSITORY_FILENAME,
  REPOSITORY_UPGRADES,
  RepositoryRecordType,
  encodeRepositoryRecord,
  repoOpen,
  repoInit,
  repoFind,
  repoGet,
  type RepositoryRecord,
  type RepositoryUpgrade,
} from './repository.js';
import { RepoLayoutError } from '../../errors.js';
import { createTempDir, removeTempDir } from '../../test-helpers.js';

describe('repository', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTempDir();
  });

  afterEach(() => {
    removeTempDir(testDir);
  });

  describe('repoInit', () => {
    it('creates repository directory structure', () => {
      const repoDir = join(testDir, 'my-repo');
      const result = repoInit(repoDir);

      assert.strictEqual(result.success, true);
      assert.strictEqual(existsSync(repoDir), true);
    });

    it('creates all required directories', () => {
      const repoDir = join(testDir, 'my-repo');
      const result = repoInit(repoDir);

      assert.strictEqual(result.success, true);

      assert.strictEqual(existsSync(join(repoDir, 'objects')), true);
      assert.strictEqual(existsSync(join(repoDir, 'packages')), true);
      assert.strictEqual(existsSync(join(repoDir, 'executions')), true);
      assert.strictEqual(existsSync(join(repoDir, 'workspaces')), true);
    });

    it('does not create any config file', () => {
      const repoDir = join(testDir, 'my-repo');
      const result = repoInit(repoDir);

      assert.strictEqual(result.success, true);

      // No config file should be created - runner config is in tasks
      assert.strictEqual(existsSync(join(repoDir, 'e3.east')), false);
      assert.strictEqual(existsSync(join(repoDir, 'e3.beast2')), false);
    });

    it('writes the repository record, named after the directory, naming this release and every upgrade this e3 knows', () => {
      const repoDir = join(testDir, 'my-repo');
      const result = repoInit(repoDir);

      assert.strictEqual(result.success, true);

      assert.ok(readFileSync(join(repoDir, REPOSITORY_FILENAME)).length > 0);
      const { release, upgrades, metadata } = repoOpen(repoDir);
      assert.strictEqual(release, E3_RELEASE);
      assert.deepStrictEqual(upgrades, REPOSITORY_UPGRADES.map(({ name }) => ({ name, release: E3_RELEASE })));
      assert.strictEqual(metadata.name, 'my-repo');
      assert.strictEqual(metadata.status.type, 'active');
      assert.strictEqual(metadata.statusChangedAt.getTime(), metadata.createdAt.getTime());
    });

    it('returns repoPath in result', () => {
      const repoDir = join(testDir, 'my-repo');
      const result = repoInit(repoDir);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.repoPath, repoDir);
    });

    it('fails if repository already exists', () => {
      const repoDir = join(testDir, 'my-repo');

      // First init succeeds
      const result1 = repoInit(repoDir);
      assert.strictEqual(result1.success, true);

      // Second init fails
      const result2 = repoInit(repoDir);
      assert.strictEqual(result2.success, false);
      assert.strictEqual(result2.alreadyExists, true);
      assert.strictEqual(result2.error?.message.includes('already exists'), true);
    });

    it('creates repo in nested path', () => {
      const nestedDir = join(testDir, 'foo', 'bar', 'baz', 'my-repo');

      const result = repoInit(nestedDir);

      assert.strictEqual(result.success, true);
      assert.strictEqual(existsSync(join(nestedDir, 'objects')), true);
    });

    it('resolves relative paths', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);

        const result = repoInit('my-repo');

        assert.strictEqual(result.success, true);
        assert.strictEqual(existsSync(join(testDir, 'my-repo', 'objects')), true);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('repoFind', () => {
    it('finds repository at specified path', () => {
      const repoDir = join(testDir, 'my-repo');
      repoInit(repoDir);

      const found = repoFind(repoDir);

      assert.strictEqual(found, repoDir);
    });

    it('returns null for non-repository directory', () => {
      // testDir exists but is not a repository
      const found = repoFind(testDir);

      assert.strictEqual(found, null);
    });

    it('returns null if no path provided and E3_REPO not set', () => {
      const originalEnv = process.env.E3_REPO;
      try {
        delete process.env.E3_REPO;

        const found = repoFind();

        assert.strictEqual(found, null);
      } finally {
        if (originalEnv !== undefined) {
          process.env.E3_REPO = originalEnv;
        }
      }
    });

    it('uses E3_REPO environment variable if set', () => {
      const repoDir = join(testDir, 'my-repo');
      repoInit(repoDir);

      const originalEnv = process.env.E3_REPO;
      try {
        process.env.E3_REPO = repoDir;

        // Find without specifying path
        const found = repoFind();

        assert.strictEqual(found, repoDir);
      } finally {
        if (originalEnv !== undefined) {
          process.env.E3_REPO = originalEnv;
        } else {
          delete process.env.E3_REPO;
        }
      }
    });

    it('ignores invalid E3_REPO', () => {
      const repoDir = join(testDir, 'my-repo');
      repoInit(repoDir);

      const originalEnv = process.env.E3_REPO;
      try {
        process.env.E3_REPO = join(testDir, 'nonexistent');

        // Should still find repo at specified path
        const found = repoFind(repoDir);

        assert.strictEqual(found, repoDir);
      } finally {
        if (originalEnv !== undefined) {
          process.env.E3_REPO = originalEnv;
        } else {
          delete process.env.E3_REPO;
        }
      }
    });

    it('returns null if missing objects directory', () => {
      const repoDir = join(testDir, 'my-repo');
      repoInit(repoDir);

      rmSync(join(repoDir, 'objects'), { recursive: true });

      const found = repoFind(repoDir);

      assert.strictEqual(found, null);
    });

    it('returns null if missing packages directory', () => {
      const repoDir = join(testDir, 'my-repo');
      repoInit(repoDir);

      rmSync(join(repoDir, 'packages'), { recursive: true });

      const found = repoFind(repoDir);

      assert.strictEqual(found, null);
    });

    it('returns null if missing executions directory', () => {
      const repoDir = join(testDir, 'my-repo');
      repoInit(repoDir);

      rmSync(join(repoDir, 'executions'), { recursive: true });

      const found = repoFind(repoDir);

      assert.strictEqual(found, null);
    });

    it('returns null if missing workspaces directory', () => {
      const repoDir = join(testDir, 'my-repo');
      repoInit(repoDir);

      rmSync(join(repoDir, 'workspaces'), { recursive: true });

      const found = repoFind(repoDir);

      assert.strictEqual(found, null);
    });

    it('refuses a repository with no record, naming the fix', () => {
      const repoDir = join(testDir, 'my-repo');
      repoInit(repoDir);
      rmSync(join(repoDir, REPOSITORY_FILENAME));
      // An older e3 kept its metadata as JSON.
      writeFileSync(join(repoDir, '.e3-metadata.json'), '{"name":"my-repo","status":"active"}');

      assert.throws(() => repoFind(repoDir), (err: unknown) =>
        err instanceof RepoLayoutError && err.upgrade === null && /an older e3 wrote it — re-create it/.test(err.message));
    });

    it('refuses a repository that has had an upgrade this e3 does not know, naming the release that applied it', () => {
      const repoDir = join(testDir, 'my-repo');
      repoInit(repoDir);
      const record = repoOpen(repoDir);
      // A later release wrote it last; an earlier newer one applied the step.
      writeRecord(repoDir, { ...record, release: '999.1.0', upgrades: [...record.upgrades, { name: 'from-a-newer-e3', release: '999.0.0' }] });

      assert.throws(() => repoGet(repoDir), (err: unknown) => {
        assert.ok(err instanceof RepoLayoutError);
        assert.deepStrictEqual(err.upgrade, { name: 'from-a-newer-e3', release: '999.0.0' });
        assert.strictEqual(err.message, `the repository at ${repoDir} has had the upgrade "from-a-newer-e3", which e3 999.0.0 applied ` +
          `and this e3, ${E3_RELEASE}, does not know — open it with e3 999.0.0 or a newer one`);
        return true;
      });
    });

    it('opens a repository another release wrote, which had no upgrade this e3 does not know, as it is', () => {
      const repoDir = join(testDir, 'my-repo');
      repoInit(repoDir);
      for (const release of ['0.0.1', '999.0.0']) {
        writeRecord(repoDir, { ...repoOpen(repoDir), release });
        const before = readFileSync(join(repoDir, REPOSITORY_FILENAME));

        assert.strictEqual(repoGet(repoDir), repoDir);
        assert.deepStrictEqual(readFileSync(join(repoDir, REPOSITORY_FILENAME)), before, `${release}: nothing is written`);
      }
    });
  });

  describe('upgrades', () => {
    /** The steps this e3 ships, which a test's own follow. */
    const shipped = REPOSITORY_UPGRADES.length;
    /** The steps each test applied, by name, in order. */
    let applied: string[];

    /** Registers a step that records itself, and fails while `fails` says so. */
    function register(name: string, fails: () => boolean = () => false): void {
      const upgrade: RepositoryUpgrade = {
        name,
        apply(repoPath) {
          assert.ok(existsSync(join(repoPath, REPOSITORY_FILENAME)), 'a step runs over a repository');
          if (fails()) throw new Error(`${name} failed`);
          applied.push(name);
        },
      };
      REPOSITORY_UPGRADES.push(upgrade);
    }

    /** A repository an older release wrote, before this e3's steps. */
    function olderRepository(): string {
      const repoDir = join(testDir, 'older-repo');
      repoInit(repoDir);
      writeRecord(repoDir, { ...repoOpen(repoDir), release: '0.0.1' });
      return repoDir;
    }

    beforeEach(() => {
      applied = [];
    });

    afterEach(() => {
      REPOSITORY_UPGRADES.length = shipped;
    });

    it('applies the steps a repository has not had, in order, once, recording each with this release', () => {
      const repoDir = olderRepository();
      const { metadata } = repoOpen(repoDir);
      register('first');
      register('second');

      assert.strictEqual(repoGet(repoDir), repoDir);
      assert.deepStrictEqual(applied, ['first', 'second']);
      const record = repoOpen(repoDir);
      assert.strictEqual(record.release, E3_RELEASE);
      assert.deepStrictEqual(record.upgrades.slice(shipped), [{ name: 'first', release: E3_RELEASE }, { name: 'second', release: E3_RELEASE }]);
      assert.deepStrictEqual(record.metadata, metadata);

      // Opened again, by any door: nothing more to apply.
      repoGet(repoDir);
      repoFind(repoDir);
      assert.deepStrictEqual(applied, ['first', 'second']);
      assert.deepStrictEqual(readdirSync(repoDir).filter((file) => file.endsWith('.partial')), [], 'the record\'s staging files are gone');
    });

    it('gives a repository opened after a failed step that step again, and not the ones before it', () => {
      const repoDir = olderRepository();
      let failing = true;
      register('first');
      register('second', () => failing);

      assert.throws(() => repoGet(repoDir), /second failed/);
      assert.deepStrictEqual(readRecord(repoDir).upgrades.slice(shipped).map(({ name }) => name), ['first']);

      failing = false;
      repoGet(repoDir);
      assert.deepStrictEqual(applied, ['first', 'second']);
      assert.deepStrictEqual(repoOpen(repoDir).upgrades.slice(shipped).map(({ name }) => name), ['first', 'second']);
    });

    it('gives a new repository none: it is in the forms every step this e3 knows writes', () => {
      register('first');
      const repoDir = join(testDir, 'new-repo');
      repoInit(repoDir);

      assert.deepStrictEqual(repoOpen(repoDir).upgrades.slice(shipped), [{ name: 'first', release: E3_RELEASE }]);
      assert.deepStrictEqual(applied, []);
    });
  });

  /** Writes a repository's record as another e3 would have. */
  function writeRecord(repoDir: string, record: RepositoryRecord): void {
    writeFileSync(join(repoDir, REPOSITORY_FILENAME), encodeRepositoryRecord(record));
  }

  /** A repository's record as it is, opening nothing. */
  function readRecord(repoDir: string): RepositoryRecord {
    return decodeBeast2For(RepositoryRecordType)(readFileSync(join(repoDir, REPOSITORY_FILENAME)));
  }

  describe('repoGet', () => {
    it('returns repository path if found', () => {
      const repoDir = join(testDir, 'my-repo');
      repoInit(repoDir);

      const repo = repoGet(repoDir);

      assert.strictEqual(repo, repoDir);
    });

    it('throws if repository not found', () => {
      assert.throws(
        () => repoGet(testDir),
        /e3 repository not found/
      );
    });
  });
});
