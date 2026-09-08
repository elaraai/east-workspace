/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for the `@elaraai/e3-cli/internal` entry (#718).
 *
 * The entry exists so another first-party binary can resolve repositories,
 * tokens and the `auth` commands exactly as `e3` does. These tests pin the
 * exported surface by name (a dropped re-export is a silent break for
 * `e3-ui`) and the repo-location grammar the terminal UI relies on.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { repoInit } from '@elaraai/e3-core';
import * as internal from './internal.js';

/** Every value export the entry promises, grouped by the module it re-exports. */
const VALUE_EXPORTS: Record<string, string[]> = {
  utils: [
    'defaultRepoArg', 'withDefaultRepo', 'parseRepoLocation', 'parseRepoLocationSync', 'resolveRepo',
    'formatError', 'exitError', 'shortHash', 'HASH_DISPLAY_WIDTH',
  ],
  credentials: [
    'normalizeServerUrl', 'loadCredentials', 'getCredential', 'setCredential', 'removeCredential',
    'listCredentials', 'isExpired', 'getValidToken', 'refreshAccessToken', 'fetchDiscovery',
    'startDeviceAuth', 'pollForTokens', 'decodeJwtPayload',
  ],
  auth: ['createAuthCommand', 'createLoginCommand', 'createLogoutCommand'],
  pathResolver: [
    'buildWorkspaceIndex', 'resolveDatasetPath', 'resolveDatasetPathFromIndex', 'indexFromTree',
    'indexFromRemoteEntries', 'suggestSimilar', 'levenshtein',
  ],
  progress: ['createProgress', 'formatBytes'],
  format: ['formatSize'],
  workspace: ['formatTaskStatus'],
};

describe('@elaraai/e3-cli/internal', () => {
  describe('exported surface', () => {
    for (const [module, names] of Object.entries(VALUE_EXPORTS)) {
      it(`re-exports the ${module} names`, () => {
        for (const name of names) {
          const value = (internal as Record<string, unknown>)[name];
          assert.ok(value !== undefined, `${name} is not exported`);
          if (name !== 'HASH_DISPLAY_WIDTH') {
            assert.strictEqual(typeof value, 'function', `${name} should be a function`);
          }
        }
      });
    }

    it('exports HASH_DISPLAY_WIDTH as the CLI hash width', () => {
      assert.strictEqual(internal.HASH_DISPLAY_WIDTH, 12);
    });

    it('createAuthCommand builds the same command tree as `e3 auth`', () => {
      const auth = internal.createAuthCommand();
      assert.strictEqual(auth.name(), 'auth');
      const names = auth.commands.map((c) => c.name()).sort();
      assert.deepStrictEqual(names, ['login', 'logout', 'status', 'token', 'whoami']);
    });

    it('formatTaskStatus prints the words `e3 workspace status` prints', () => {
      assert.strictEqual(internal.formatTaskStatus({ type: 'up-to-date', cached: true }), 'up-to-date (cached)');
      assert.strictEqual(internal.formatTaskStatus({ type: 'ready' }), 'ready to run');
      assert.strictEqual(internal.formatTaskStatus({ type: 'waiting', reason: 'upstream' }), 'waiting (upstream)');
      assert.strictEqual(internal.formatTaskStatus({ type: 'failed', exitCode: 2 }), 'FAILED (exit code 2)');
      assert.strictEqual(internal.formatTaskStatus({ type: 'error', message: 'boom' }), 'ERROR: boom');
    });

    it('formatSize formats bytes the way every e3 table does', () => {
      assert.strictEqual(internal.formatSize(0), '0 B');
      assert.strictEqual(internal.formatSize(1024), '1 KB');
      assert.strictEqual(internal.formatSize(2150), '2.1 KB');
      assert.strictEqual(internal.formatSize(12_700_000), '12.1 MB');
    });
  });

  describe('parseRepoLocationSync', () => {
    let tempDir: string;
    let repoPath: string;
    let previousCwd: string;
    let previousEnv: string | undefined;

    before(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'e3-cli-internal-'));
      repoPath = join(tempDir, 'repo');
      mkdirSync(repoPath);
      repoInit(repoPath);
      previousCwd = process.cwd();
      previousEnv = process.env.E3_REPO;
      // The grammar is E3_REPO-first (an e3-core quirk the TUI documents
      // rather than fixes): unset it so the argument is what resolves.
      delete process.env.E3_REPO;
      process.chdir(repoPath);
    });

    after(() => {
      process.chdir(previousCwd);
      if (previousEnv === undefined) delete process.env.E3_REPO;
      else process.env.E3_REPO = previousEnv;
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('resolves `.` to the current repository', () => {
      const location = internal.parseRepoLocationSync('.');
      assert.strictEqual(location.type, 'local');
      assert.strictEqual(location.type === 'local' && location.path, repoPath);
    });

    it('resolves a relative path to an absolute repository path', () => {
      process.chdir(tempDir);
      try {
        const location = internal.parseRepoLocationSync('./repo');
        assert.deepStrictEqual(location, { type: 'local', path: repoPath });
      } finally {
        process.chdir(repoPath);
      }
    });

    it('rejects a local path that is not an e3 repository', () => {
      assert.throws(
        () => internal.parseRepoLocationSync(join(tempDir, 'missing')),
        /e3 repository not found/,
      );
    });

    it('splits https://host/repos/<repo> into the origin and the repository name', () => {
      assert.deepStrictEqual(internal.parseRepoLocationSync('https://h/repos/r'), {
        type: 'remote',
        baseUrl: 'https://h',
        repo: 'r',
      });
      assert.deepStrictEqual(internal.parseRepoLocationSync('https://h:8443/repos/demo/workspaces/main'), {
        type: 'remote',
        baseUrl: 'https://h:8443',
        repo: 'demo',
      });
    });

    it('refuses a bare origin with the documented message', () => {
      assert.throws(
        () => internal.parseRepoLocationSync('https://h'),
        /Invalid remote URL: expected \/repos\/\{repo\} in path, got \//,
      );
    });
  });
});
