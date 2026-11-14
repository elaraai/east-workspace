/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BlobType, encodeBeast2For, variant } from '@elaraai/east';
import { EnvironmentSpecType } from '@elaraai/e3-types';
import { LocalStorage } from '../storage/local/index.js';
import { repoInit } from '../storage/local/repository.js';
import { materializeEnvironment } from './environment.js';
import { linkPrebuiltEnvironment, prebuiltEnvironment, PREBUILT_ENV_DIR_VAR, PREBUILT_ENV_HASH_VAR } from './prebuilt-environment.js';

describe('an environment built ahead of the call that declares it', () => {
  let tmpDir: string;
  let repo: string;
  const storage = new LocalStorage();
  const hash = 'a'.repeat(64);

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e3-prebuilt-env-spec-'));
    repo = path.join(tmpDir, 'repo');
    await repoInit(repo);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is named by a host\'s two variables, both or neither', () => {
    const dir = path.join(tmpDir, 'built');
    assert.strictEqual(prebuiltEnvironment({}), undefined, 'a host that names none holds none');
    assert.deepStrictEqual(prebuiltEnvironment({ [PREBUILT_ENV_HASH_VAR]: hash, [PREBUILT_ENV_DIR_VAR]: dir, PATH: '/usr/bin' }), { hash, dir });
    assert.deepStrictEqual([PREBUILT_ENV_HASH_VAR, PREBUILT_ENV_DIR_VAR], ['E3_BAKED_ENV_HASH', 'E3_BAKED_ENV_DIR'],
      'the names hosts already set');

    assert.throws(() => prebuiltEnvironment({ [PREBUILT_ENV_HASH_VAR]: hash }),
      { message: 'E3_BAKED_ENV_HASH is set and E3_BAKED_ENV_DIR is not: a pre-built environment is named by both' });
    assert.throws(() => prebuiltEnvironment({ [PREBUILT_ENV_DIR_VAR]: dir }),
      { message: 'E3_BAKED_ENV_DIR is set and E3_BAKED_ENV_HASH is not: a pre-built environment is named by both' });
    assert.throws(() => prebuiltEnvironment({ [PREBUILT_ENV_HASH_VAR]: 'latest', [PREBUILT_ENV_DIR_VAR]: dir }),
      { message: "E3_BAKED_ENV_HASH 'latest' is not an object hash" });
    assert.throws(() => prebuiltEnvironment({ [PREBUILT_ENV_HASH_VAR]: hash, [PREBUILT_ENV_DIR_VAR]: 'envs/built' }),
      { message: "E3_BAKED_ENV_DIR 'envs/built' is not an absolute path" });
  });

  it('is linked where e3-core looks, so the environment is taken as built and nothing is installed', async () => {
    // A tools environment whose one file the repository does not hold: a
    // build of it would fail to read the file, so an answer proves none ran.
    const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(variant('tools', {
      files: [{ path: 'bin/a-tool', hash: 'b'.repeat(64) }],
    })));
    const built = path.join(tmpDir, 'built-tools');
    fs.mkdirSync(path.join(built, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(built, 'bin', 'a-tool'), '#!/bin/sh\necho built ahead\n');

    const link = await linkPrebuiltEnvironment(repo, { hash: envHash, dir: built });
    assert.strictEqual(link, path.resolve(repo, 'envs', envHash), 'absolute, as e3-core names it');
    assert.strictEqual(fs.realpathSync(link), fs.realpathSync(built));
    assert.deepStrictEqual(await materializeEnvironment(storage, repo, envHash), [path.join(link, 'bin')]);
    assert.strictEqual(fs.readFileSync(path.join(link, 'bin', 'a-tool'), 'utf8'), '#!/bin/sh\necho built ahead\n');

    // A second call of a warm host keeps the link it finds.
    assert.strictEqual(await linkPrebuiltEnvironment(repo, { hash: envHash, dir: built }), link);
    assert.strictEqual(fs.realpathSync(link), fs.realpathSync(built));
  });

  it('keeps an environment already built at the path, and makes no link to a directory that is not there', async () => {
    // Built by e3-core itself, at the path: the link is not made over it.
    const file = await storage.objects.write(repo, encodeBeast2For(BlobType)(Buffer.from('#!/bin/sh\necho built here\n')));
    const envHash = await storage.objects.write(repo, encodeBeast2For(EnvironmentSpecType)(variant('tools', {
      files: [{ path: 'bin/a-tool', hash: file }],
    })));
    await materializeEnvironment(storage, repo, envHash);
    const other = path.join(tmpDir, 'built-elsewhere');
    fs.mkdirSync(other);
    await linkPrebuiltEnvironment(repo, { hash: envHash, dir: other });
    assert.ok(!fs.lstatSync(path.join(repo, 'envs', envHash)).isSymbolicLink(), 'the environment built there stays');

    const missing = path.join(tmpDir, 'never-built');
    await assert.rejects(linkPrebuiltEnvironment(repo, { hash, dir: missing }), { code: 'ENOENT' });
    assert.ok(!fs.existsSync(path.join(repo, 'envs', hash)), 'no link that leads nowhere');
  });
});
