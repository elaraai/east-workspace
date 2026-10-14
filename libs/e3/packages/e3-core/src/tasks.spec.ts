/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for tasks.ts - task listing and details operations
 */

import { describe, it, beforeEach, afterEach, type TestContext } from 'node:test';
import assert from 'node:assert';
import { join } from 'node:path';
import { East, IntegerType, StringType, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { packageListTasks, packageGetTask, workspaceListTasks, workspaceGetTask, workspaceListTaskObjects, workspaceFindTask } from './tasks.js';
import { packageImport } from './package-files.js';
import { workspaceCreate } from './workspaces.js';
import { workspaceDeploy } from './workspace-files.js';
import { TaskNotFoundError, WorkspaceNotFoundError, WorkspaceNotDeployedError } from './errors.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from './test-helpers.js';
import { InMemoryStorage } from './storage/in-memory/InMemoryStorage.js';
import { LocalStorage } from './storage/local/index.js';
import type { StorageBackend } from './storage/interfaces.js';

/** Counts the calls of a method of `target`. */
function countOf(target: object, method: string): { calls: number } {
  const original = (target as Record<string, (...args: unknown[]) => unknown>)[method]!.bind(target);
  const seen = { calls: 0 };
  (target as Record<string, unknown>)[method] = (...args: unknown[]) => {
    seen.calls++;
    return original(...args);
  };
  return seen;
}

describe('tasks', () => {
  let testRepo: string;
  let tempDir: string;
  let storage: StorageBackend;

  beforeEach(() => {
    testRepo = createTestRepo();
    tempDir = createTempDir();
    storage = new LocalStorage();
  });

  afterEach(() => {
    removeTestRepo(testRepo);
    removeTempDir(tempDir);
  });

  describe('packageListTasks', () => {
    it('returns empty array for package with no tasks', async () => {
      const myInput = e3.input('value', StringType, variant('value', 'hello'));
      const pkg = e3.package('no-tasks', '1.0.0', myInput);
      const zipPath = join(tempDir, 'no-tasks.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);

      const tasks = await packageListTasks(storage, testRepo, 'no-tasks', '1.0.0');

      assert.deepStrictEqual(tasks, []);
    });

    it('throws for non-existent package', async () => {
      await assert.rejects(
        async () => await packageListTasks(storage, testRepo, 'nonexistent', '1.0.0'),
        /not found|ENOENT/
      );
    });
  });

  describe('packageGetTask', () => {
    it('throws for non-existent task', async () => {
      const myInput = e3.input('value', StringType, variant('value', 'test'));
      const pkg = e3.package('no-task', '1.0.0', myInput);
      const zipPath = join(tempDir, 'no-task.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);

      await assert.rejects(
        async () => await packageGetTask(storage, testRepo, 'no-task', '1.0.0', 'nonexistent'),
        /not found/
      );
    });

    it('throws for non-existent package', async () => {
      await assert.rejects(
        async () => await packageGetTask(storage, testRepo, 'nonexistent', '1.0.0', 'task'),
        /not found|ENOENT/
      );
    });

    it('throws TaskNotFoundError for non-existent task', async () => {
      const myInput = e3.input('value', StringType, variant('value', 'test'));
      const pkg = e3.package('empty-tasks', '1.0.0', myInput);
      const zipPath = join(tempDir, 'empty-tasks.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);

      await assert.rejects(
        async () => await packageGetTask(storage, testRepo, 'empty-tasks', '1.0.0', 'nonexistent'),
        TaskNotFoundError
      );
    });
  });

  describe('workspaceListTasks', () => {
    it('returns empty array for workspace with no tasks', async () => {
      const myInput = e3.input('value', StringType, variant('value', 'hello'));
      const pkg = e3.package('ws-no-tasks', '1.0.0', myInput);
      const zipPath = join(tempDir, 'ws-no-tasks.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);
      await workspaceDeploy(storage, testRepo, 'myws', 'ws-no-tasks', '1.0.0');

      const tasks = await workspaceListTasks(storage, testRepo, 'myws');

      assert.deepStrictEqual(tasks, []);
    });

    it('throws for non-existent workspace', async () => {
      await assert.rejects(
        async () => await workspaceListTasks(storage, testRepo, 'nonexistent'),
        WorkspaceNotFoundError
      );
    });

    it('throws for undeployed workspace', async () => {
      await workspaceCreate(storage, testRepo, 'empty');

      await assert.rejects(
        async () => await workspaceListTasks(storage, testRepo, 'empty'),
        WorkspaceNotDeployedError
      );
    });
  });

  describe('workspaceGetTask', () => {
    it('throws for non-existent task', async () => {
      const myInput = e3.input('value', StringType, variant('value', 'test'));
      const pkg = e3.package('ws-no-task', '1.0.0', myInput);
      const zipPath = join(tempDir, 'ws-no-task.zip');
      await e3.export(pkg, zipPath);
      await packageImport(storage, testRepo, zipPath);
      await workspaceDeploy(storage, testRepo, 'myws', 'ws-no-task', '1.0.0');

      await assert.rejects(
        async () => await workspaceGetTask(storage, testRepo, 'myws', 'nonexistent'),
        /not found/
      );
    });

    it('throws for non-existent workspace', async () => {
      await assert.rejects(
        async () => await workspaceGetTask(storage, testRepo, 'nonexistent', 'task'),
        WorkspaceNotFoundError
      );
    });

    it('throws for undeployed workspace', async () => {
      await workspaceCreate(storage, testRepo, 'empty');

      await assert.rejects(
        async () => await workspaceGetTask(storage, testRepo, 'empty', 'task'),
        WorkspaceNotDeployedError
      );
    });
  });

  describe('a workspace\'s tasks, with their objects', () => {
    /** A workspace a package of three tasks over one input is deployed to,
     *  over the in-memory backend. */
    async function deployed(t: TestContext): Promise<InMemoryStorage> {
      const dir = createTempDir();
      t.after(() => removeTempDir(dir));
      const seed = e3.input('seed', IntegerType, variant('value', 1n));
      const zip = join(dir, 'three.zip');
      await e3.export(e3.package('three', '1.0.0', ...['a', 'b', 'c'].map((name) =>
        e3.task(name, [seed], East.function([IntegerType], IntegerType, ($, x) => x.add(BigInt(name.length)))))), zip);
      const storage = new InMemoryStorage();
      await storage.repos.create('repo');
      await packageImport(storage, 'repo', zip);
      await workspaceCreate(storage, 'repo', 'ws');
      await workspaceDeploy(storage, 'repo', 'ws', 'three', '1.0.0');
      return storage;
    }

    it('lists them reading the record once and each task object once, and from memory after', async (t) => {
      const storage = await deployed(t);
      const records = countOf(storage.refs, 'workspaceRead');
      const objects = countOf(storage.objects, 'read');

      const listed = await workspaceListTaskObjects(storage, 'repo', 'ws');
      assert.deepStrictEqual(listed.map(({ name }) => name).sort(), ['a', 'b', 'c']);
      for (const { hash, task } of listed) {
        assert.strictEqual(hash.length, 64);
        assert.strictEqual(task.role.type, 'data');
      }
      assert.strictEqual(records.calls, 1, 'the workspace record, once');
      assert.ok(objects.calls <= 4, `the package and the task objects at most once each: ${objects.calls} reads`);

      records.calls = 0;
      objects.calls = 0;
      const again = await workspaceListTaskObjects(storage, 'repo', 'ws');
      assert.deepStrictEqual(again.map(({ hash }) => hash), listed.map(({ hash }) => hash));
      assert.deepStrictEqual([records.calls, objects.calls], [1, 0], 'the record once, and every object from memory');

      const found = await workspaceFindTask(storage, 'repo', 'ws', 'b');
      assert.deepStrictEqual([found.name, found.hash], ['b', listed.find(({ name }) => name === 'b')!.hash]);
      assert.deepStrictEqual([records.calls, objects.calls], [2, 0], 'one task found: the record once, nothing else read');
      assert.strictEqual(await workspaceGetTask(storage, 'repo', 'ws', 'b'), found.task, 'one object, however it is asked for');
    });

    it('finds no task of another name, and none in a workspace nothing is deployed to', async (t) => {
      const storage = await deployed(t);
      await assert.rejects(workspaceFindTask(storage, 'repo', 'ws', 'd'), TaskNotFoundError);
      await workspaceCreate(storage, 'repo', 'empty');
      await assert.rejects(workspaceListTaskObjects(storage, 'repo', 'empty'), WorkspaceNotDeployedError);
      await assert.rejects(workspaceListTaskObjects(storage, 'repo', 'nope'), WorkspaceNotFoundError);
    });
  });
});
