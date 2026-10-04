/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The repository record over e3-core's own backends: the contract suite every
 * backend runs, over a local repository `repoInit` created, one the local
 * `RepoStore` created, and the in-memory backend, each able to hold a record
 * in an earlier release's form; and what only e3-core can set up — a
 * backend's own steps, a repository whose upgrade under way does not read,
 * and one with no record.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { E3_RELEASE } from '@elaraai/e3-types';
import { repositoryRecordTests } from './contract/index.js';
import { RepoLayoutError } from './errors.js';
import { REPOSITORY_UPGRADES, newRepositoryRecord, repositoryOpen, repositoryUpgradeStep } from './repository-record.js';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import { LocalStorage } from './storage/local/LocalBackend.js';
import { REPOSITORY_RECORD_FILE, REPOSITORY_UPGRADE_FILE } from './storage/local/LocalRefStore.js';
import { createTempDir, createTestRepo, inMemoryDamage, localDamage, removeTempDir, removeTestRepo } from './test-helpers.js';
import type { RepositoryUpgrade } from './storage/interfaces.js';

describe('over a local repository repoInit created', () => {
  repositoryRecordTests(async (t) => {
    const repo = createTestRepo();
    t.after(() => removeTestRepo(repo));
    return { storage: new LocalStorage(dirname(repo)), repo, damage: localDamage(repo) };
  });
});

describe('over a local repository its RepoStore created', () => {
  repositoryRecordTests(async (t) => {
    const reposDir = createTempDir();
    t.after(() => removeTempDir(reposDir));
    const storage = new LocalStorage(reposDir);
    await storage.repos.create('created');
    const repo = join(reposDir, 'created');
    return { storage, repo, damage: localDamage(repo) };
  });
});

describe('over the in-memory backend', () => {
  repositoryRecordTests(async () => {
    const storage = new InMemoryStorage();
    await storage.repos.create('created');
    return { storage, repo: 'created', damage: inMemoryDamage(storage, 'created') };
  });
});

describe('a backend\'s own upgrades', () => {
  /** A step that records its run in `ran`. */
  const step = (name: string, ran: string[]): RepositoryUpgrade => ({
    name,
    async apply() {
      ran.push(name);
      return null;
    },
  });

  it('apply before the shared ones, both recorded, and a new repository names both', async (t) => {
    const ran: string[] = [];
    const storage = new InMemoryStorage({ upgrades: [] });
    await storage.repos.create('repo');
    const before = await repositoryOpen(storage, 'repo');

    storage.upgrades.push(step('backend-layout', ran));
    const shared = step('shared-form', ran);
    REPOSITORY_UPGRADES.push(shared);
    t.after(() => {
      REPOSITORY_UPGRADES.splice(REPOSITORY_UPGRADES.indexOf(shared), 1);
    });

    const record = await repositoryOpen(storage, 'repo');
    assert.deepEqual(ran, ['backend-layout', 'shared-form']);
    assert.deepEqual(record.upgrades, [
      ...before.upgrades, { name: 'backend-layout', release: E3_RELEASE }, { name: 'shared-form', release: E3_RELEASE },
    ]);
    assert.deepEqual(newRepositoryRecord(storage.upgrades).upgrades.map(({ name }) => name), ['backend-layout', ...REPOSITORY_UPGRADES.map(({ name }) => name)]);
    assert.equal(REPOSITORY_UPGRADES.at(-1), shared);
  });

  it('refuse an open when a step\'s name is another\'s, which the record could not tell apart', async (t) => {
    const storage = new InMemoryStorage();
    await storage.repos.create('repo');
    storage.upgrades.push(step('same-name', []));
    const shared = step('same-name', []);
    REPOSITORY_UPGRADES.push(shared);
    t.after(() => {
      REPOSITORY_UPGRADES.splice(REPOSITORY_UPGRADES.indexOf(shared), 1);
    });

    await assert.rejects(repositoryOpen(storage, 'repo'), { message: 'two repository upgrades are named "same-name"' });
  });
});

describe('a local repository whose upgrade under way does not read', () => {
  it('starts the step under way again, and removes the record of it once the step is done', async (t) => {
    const repo = createTestRepo();
    t.after(() => removeTestRepo(repo));
    const storage = new LocalStorage(dirname(repo));
    // A step of two units, a part each.
    const ran: string[] = [];
    const twoUnits: RepositoryUpgrade = {
      name: 'local-two-units',
      async apply(_storage, _repo, at) {
        const unit = at === null ? 0 : 1;
        ran.push(`${unit}`);
        return unit === 0 ? '0' : null;
      },
    };
    REPOSITORY_UPGRADES.push(twoUnits);
    t.after(() => {
      REPOSITORY_UPGRADES.splice(REPOSITORY_UPGRADES.indexOf(twoUnits), 1);
    });
    await repositoryUpgradeStep(storage, repo, { budgetMs: 0 });
    assert.deepEqual(ran, ['0']);

    writeFileSync(join(repo, REPOSITORY_UPGRADE_FILE), 'not a record');
    assert.equal(await storage.refs.repositoryUpgradeRead(repo), null, 'a record that does not read is none');
    await repositoryOpen(storage, repo);
    assert.deepEqual(ran, ['0', '0', '1'], 'the step starts again');
    assert.equal(existsSync(join(repo, REPOSITORY_UPGRADE_FILE)), false);
  });
});

describe('a local repository with no record', () => {
  it('is refused, naming the fix: an older e3 wrote it', async (t) => {
    const repo = createTestRepo();
    t.after(() => removeTestRepo(repo));
    rmSync(join(repo, REPOSITORY_RECORD_FILE));

    await assert.rejects(repositoryOpen(new LocalStorage(), repo), (err: unknown) =>
      err instanceof RepoLayoutError && err.upgrade === null &&
      err.message === `the repository at ${repo} has no repository record: an older e3 wrote it — re-create it: deploy again and import its data again`);
  });
});
