/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 workspace deploy --plan` from a zip or a source, through the CLI: a plan
 * writes nothing, so it imports nothing. Locally it reads the package from the
 * zip where it is; a server plans only a package it holds, so a plan against
 * one is refused before anything reaches it, naming the import that comes
 * first.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import e3 from '@elaraai/e3';
import { packageList as packageListRemote } from '@elaraai/e3-api-client';
import { createServer, type Server } from '@elaraai/e3-api-server';
import { DictType, East, StringType, StructType } from '@elaraai/east';
import { createTestDir, getE3CliPath, removeTestDir, runE3Command } from './helpers.js';

/** The package the source declares and the zip holds: a record, indexed. */
const SOURCE = [
  "import e3 from '@elaraai/e3';",
  "import { DictType, East, StringType, StructType } from '@elaraai/east';",
  'const Task = StructType({ title: StringType, owner: StringType });',
  "const tasks = e3.record('tasks', DictType(StringType, Task), new Map());",
  "const byOwner = e3.recordIndex('by_owner', tasks, { key: East.function([StringType, Task], StringType, ($, _id, task) => task.owner) });",
  "export default e3.package('planned', '1.0.0', tasks, byOwner);",
  '',
].join('\n');

/** Every file under a directory, by its path, with a hash of its bytes. */
function filesUnder(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(path, createHash('sha256').update(readFileSync(path)).digest('hex'));
    }
  };
  walk(dir);
  return files;
}

describe('a deploy plan from a zip or a source', () => {
  let testDir: string;
  let projectDir: string;
  let zip: string;

  beforeEach(async () => {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });

    const Task = StructType({ title: StringType, owner: StringType });
    const tasks = e3.record('tasks', DictType(StringType, Task), new Map());
    const byOwner = e3.recordIndex('by_owner', tasks, {
      key: East.function([StringType, Task], StringType, ($, _id, task) => task.owner),
    });
    zip = join(testDir, 'planned.zip');
    await e3.export(e3.package('planned', '1.0.0', tasks, byOwner), zip);

    // The developer's project: the source, and the SAME @elaraai/e3 and
    // @elaraai/east the CLI loads (the bundled source is imported from its own
    // directory, and export checks instanceof).
    projectDir = join(testDir, 'project');
    const scope = join(projectDir, 'node_modules', '@elaraai');
    mkdirSync(scope, { recursive: true });
    const cliModules = join(dirname(getE3CliPath()), '..', '..', 'node_modules', '@elaraai');
    for (const name of ['e3', 'east']) {
      symlinkSync(realpathSync(join(cliModules, name)), join(scope, name), 'junction');
    }
    writeFileSync(join(projectDir, 'pkg.ts'), SOURCE);
  });

  afterEach(() => {
    removeTestDir(testDir);
  });

  it('leaves a local repository\'s files as they were, and prints the plan', async () => {
    const repoDir = join(testDir, 'repo');
    const created = await runE3Command(['repo', 'create', repoDir], testDir);
    assert.strictEqual(created.exitCode, 0, `repo create failed: ${created.stderr}`);
    const before = filesUnder(repoDir);

    for (const from of [['--from-zip', zip], ['--from-source', 'pkg.ts']]) {
      const result = await runE3Command(['workspace', 'deploy', repoDir, 'ws', ...from, '--plan'], projectDir);
      assert.strictEqual(result.exitCode, 0, `${from[0]} --plan failed: ${result.stderr}\n${result.stdout}`);
      assert.deepStrictEqual(filesUnder(repoDir), before, `${from[0]} --plan leaves the repository as it was`);
      assert.match(result.stderr, /✔ read planned@1\.0\.0 \(\d+ objects\), importing nothing/);
      assert.match(result.stdout, /^ {2}mint record records\/tasks$/m);
      assert.match(result.stdout, /^ {2}build index records\/tasks\.by_owner$/m);
      assert.match(result.stdout, /^A plan: nothing was written\.$/m);
    }
  });

  describe('against a server', () => {
    let server: Server;
    let baseUrl: string;
    let remoteUrl: string;
    let credentialsPath: string;

    beforeEach(async () => {
      const reposDir = join(testDir, 'repos');
      mkdirSync(join(reposDir, 'remote'), { recursive: true });
      const created = await runE3Command(['repo', 'create', join(reposDir, 'remote')], testDir);
      assert.strictEqual(created.exitCode, 0, `repo create failed: ${created.stderr}`);

      server = await createServer({ reposDir, port: 0, host: 'localhost' });
      await server.start();
      baseUrl = `http://localhost:${server.port}`;
      remoteUrl = `${baseUrl}/repos/remote`;
      credentialsPath = join(testDir, 'credentials.json');
      writeFileSync(credentialsPath, JSON.stringify({
        version: 1,
        credentials: {
          [baseUrl]: {
            accessToken: 'mock-test-token',
            refreshToken: 'mock-refresh-token',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        },
      }));
    });

    afterEach(async () => {
      await server.stop();
    });

    it('is refused before anything reaches it, naming the import that comes first', async () => {
      const env = { env: { E3_CREDENTIALS_PATH: credentialsPath } };

      const fromZip = await runE3Command(['workspace', 'deploy', remoteUrl, 'ws', '--from-zip', zip, '--plan'], projectDir, env);
      assert.notStrictEqual(fromZip.exitCode, 0, 'a plan from a zip is refused against a server');
      assert.ok(fromZip.stderr.includes(
        `Error: --plan writes nothing, and a server plans only a package it holds: import ${zip} with ` +
        `\`e3 package import ${remoteUrl} ${zip}\`, then plan with \`e3 workspace deploy ${remoteUrl} ws planned@1.0.0 --plan\``,
      ), fromZip.stderr);

      const fromSource = await runE3Command(['workspace', 'deploy', remoteUrl, 'ws', '--from-source', 'pkg.ts', '--plan'], projectDir, env);
      assert.notStrictEqual(fromSource.exitCode, 0, 'a plan from a source is refused against a server');
      assert.ok(fromSource.stderr.includes(
        `Error: --plan writes nothing, and a server plans only a package it holds: export pkg.ts's package to a zip with e3.export, ` +
        `import it with \`e3 package import ${remoteUrl} <zip>\`, then plan with \`e3 workspace deploy ${remoteUrl} ws <name>@<version> --plan\``,
      ), fromSource.stderr);
      assert.doesNotMatch(fromSource.stderr, /compiling/, 'refused before the source is bundled');

      assert.deepStrictEqual(await packageListRemote(baseUrl, 'remote', { token: 'mock-test-token' }), [], 'nothing was imported');
    });
  });
});
