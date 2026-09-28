/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * A server opens a repository before it serves it, as the CLI does: the one it
 * serves alone when it starts, and each of several at every request to it. One
 * this e3 cannot open is refused, naming the release that applied the upgrade
 * it does not know.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import { repoInit } from '@elaraai/e3-core';
import { E3_RELEASE, RepositoryRecordType } from '@elaraai/e3-types';
import { createServer } from './server.js';

/** Records that e3 999.0.0 applied an upgrade to the repository this e3 does not know. */
function upgradedByNewer(repoPath: string): void {
  const file = join(repoPath, 'repository.beast2');
  const record = decodeBeast2For(RepositoryRecordType)(readFileSync(file));
  writeFileSync(file, encodeBeast2For(RepositoryRecordType)({
    ...record, upgrades: [...record.upgrades, { name: 'from-a-newer-e3', release: '999.0.0' }],
  }));
}

const refusal = (repoPath: string) => `the repository at ${repoPath} has had the upgrade "from-a-newer-e3", which e3 999.0.0 applied ` +
  `and this e3, ${E3_RELEASE}, does not know — open it with e3 999.0.0 or a newer one`;

describe('a server opens the repositories it serves', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'e3-server-open-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to serve one repository this e3 cannot open, naming the release that upgraded it', async () => {
    const repoPath = join(dir, 'repo');
    assert.equal(repoInit(repoPath).success, true);
    upgradedByNewer(repoPath);

    await assert.rejects(createServer({ singleRepoPath: repoPath, port: 0 }), { name: 'RepoLayoutError', message: refusal(repoPath) });
  });

  it('refuses each of several repositories this e3 cannot open at a request to it, naming the release that upgraded it', async () => {
    assert.equal(repoInit(join(dir, 'newer')).success, true);
    upgradedByNewer(join(dir, 'newer'));
    const server = await createServer({ reposDir: dir, port: 0, host: '127.0.0.1' });
    await server.start();
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/repos/newer/workspaces`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: { type: 'internal', message: refusal(join(dir, 'newer')) } });
    } finally {
      await server.stop();
    }
  });
});
