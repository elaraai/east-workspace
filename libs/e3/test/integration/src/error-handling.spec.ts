/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Integration tests for error handling
 *
 * Tests that errors propagate correctly through the stack and provide
 * clear feedback to users.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { createServer, type Server } from '@elaraai/e3-api-server';

import { createTestDir, removeTestDir, runE3Command, getFreePort } from './helpers.js';

describe('error handling', () => {
  let reposDir: string;
  let repoName: string;
  let repoDir: string;
  let tempDir: string;
  let server: Server;
  let remoteUrl: string;
  let serverUrl: string;
  let credentialsPath: string;
  let originalAutoApprove: string | undefined;

  // Env vars for authenticated CLI commands
  const authEnv = () => ({
    E3_CREDENTIALS_PATH: credentialsPath,
  });

  beforeEach(async () => {
    // Enable auto-approve for tests (server checks this env var)
    originalAutoApprove = process.env.E3_AUTH_AUTO_APPROVE;
    process.env.E3_AUTH_AUTO_APPROVE = '1';

    // Create test directory structure
    tempDir = createTestDir();
    mkdirSync(tempDir, { recursive: true });

    // Create repos directory structure: tempDir/repos/test-repo
    reposDir = join(tempDir, 'repos');
    repoName = 'test-repo';
    repoDir = join(reposDir, repoName);
    mkdirSync(repoDir, { recursive: true });

    // Create credentials file location
    credentialsPath = join(tempDir, 'credentials.json');

    // Initialize the repository using CLI (local, no auth needed)
    const initResult = await runE3Command(['repo', 'create', '.'], repoDir);
    assert.strictEqual(initResult.exitCode, 0, `Failed to init repo: ${initResult.stderr}`);

    const assignedPort = await getFreePort();

    serverUrl = `http://localhost:${assignedPort}`;

    // Start server with OIDC enabled
    server = await createServer({
      reposDir,
      port: assignedPort,
      host: 'localhost',
      oidc: {
        baseUrl: serverUrl,
        tokenExpiry: '1h',
        refreshTokenExpiry: '90d',
      },
    });
    await server.start();

    // Remote URL in the user-facing format
    remoteUrl = `${serverUrl}/repos/${repoName}`;

    // Login (auto-approve enabled via process.env in beforeEach)
    const loginResult = await runE3Command(
      ['auth', 'login', '--no-browser', serverUrl],
      tempDir,
      { env: authEnv() }
    );
    assert.strictEqual(loginResult.exitCode, 0, `Login failed: ${loginResult.stderr}\n${loginResult.stdout}`);
  });

  afterEach(async () => {
    await server.stop();
    removeTestDir(tempDir);
    // Restore original auto-approve setting
    if (originalAutoApprove === undefined) {
      delete process.env.E3_AUTH_AUTO_APPROVE;
    } else {
      process.env.E3_AUTH_AUTO_APPROVE = originalAutoApprove;
    }
  });

  describe('repository not found', () => {
    it('returns errors (not empty listings) for every command against a non-existent repo', async () => {
      // One server+login setup, four CLI surfaces. The underlying API error
      // paths are covered per-endpoint in e3-api-tests; this asserts the CLI
      // renders them as failures rather than empty success output.
      const nonExistentUrl = `${serverUrl}/repos/nonexistent-repo`;

      const wsList = await runE3Command(['workspace', 'list', nonExistentUrl], tempDir, { env: authEnv() });
      assert.notStrictEqual(wsList.exitCode, 0, 'workspace list should fail for non-existent repo');
      assert.doesNotMatch(wsList.stdout, /No workspaces/i, 'Should not show "No workspaces" for non-existent repo');
      assert.match(wsList.stderr + wsList.stdout, /not found|error/i, 'workspace list should indicate error');

      const pkgList = await runE3Command(['package', 'list', nonExistentUrl], tempDir, { env: authEnv() });
      assert.notStrictEqual(pkgList.exitCode, 0, 'package list should fail for non-existent repo');
      assert.doesNotMatch(pkgList.stdout, /No packages/i, 'Should not show "No packages" for non-existent repo');

      const wsCreate = await runE3Command(['workspace', 'create', nonExistentUrl, 'test-ws'], tempDir, { env: authEnv() });
      assert.notStrictEqual(wsCreate.exitCode, 0, 'workspace create should fail for non-existent repo');

      const status = await runE3Command(['repo', 'status', nonExistentUrl], tempDir, { env: authEnv() });
      assert.notStrictEqual(status.exitCode, 0, 'repo status should fail for non-existent repo');
      assert.match(status.stderr + status.stdout, /not found|error/i, 'repo status should indicate error');
    });
  });

  describe('workspace and package not found', () => {
    it('returns errors for operations on non-existent workspaces and packages', async () => {
      const wsStatus = await runE3Command(['workspace', 'status', remoteUrl, 'nonexistent-ws'], tempDir, { env: authEnv() });
      assert.notStrictEqual(wsStatus.exitCode, 0, 'workspace status should fail for non-existent workspace');
      assert.match(wsStatus.stderr + wsStatus.stdout, /not found|does not exist|error/i, 'Should indicate error');

      const wsRemove = await runE3Command(['workspace', 'remove', remoteUrl, 'nonexistent-ws'], tempDir, { env: authEnv() });
      assert.notStrictEqual(wsRemove.exitCode, 0, 'workspace remove should fail for non-existent workspace');

      const pkgRemove = await runE3Command(['package', 'remove', remoteUrl, 'nonexistent-pkg@1.0.0'], tempDir, { env: authEnv() });
      assert.notStrictEqual(pkgRemove.exitCode, 0, 'package remove should fail for non-existent package');

      // Deploying a non-existent package to a REAL workspace
      const createResult = await runE3Command(['workspace', 'create', remoteUrl, 'test-ws'], tempDir, { env: authEnv() });
      assert.strictEqual(createResult.exitCode, 0, `Failed to create workspace: ${createResult.stderr}`);
      const deploy = await runE3Command(['workspace', 'deploy', remoteUrl, 'test-ws', 'nonexistent-pkg@1.0.0'], tempDir, { env: authEnv() });
      assert.notStrictEqual(deploy.exitCode, 0, 'deploy should fail for non-existent package');
      assert.match(deploy.stderr + deploy.stdout, /not found|does not exist|error/i, 'Should indicate error');
    });
  });

  describe('auth errors', () => {
    it('returns 401 for missing token', async () => {
      // Use a credentials path that doesn't exist
      const result = await runE3Command(
        ['workspace', 'list', remoteUrl],
        tempDir,
        { env: { E3_CREDENTIALS_PATH: join(tempDir, 'nonexistent-creds.json') } }
      );

      assert.notStrictEqual(result.exitCode, 0, 'Should fail without credentials');
      assert.match(result.stderr + result.stdout, /auth|unauthorized|credentials|login/i, 'Should indicate auth error');
    });
  });
});
