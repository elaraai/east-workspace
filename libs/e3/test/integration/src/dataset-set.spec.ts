/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * `e3 dataset set` at the boundary, through the CLI against a real repository.
 *
 * - The declared type is checked at the door, from the file's header, before
 *   anything is read whole or written (#766).
 * - A `.beast2` delivery is adopted by hash — by `--from-file`, and by a
 *   `variant('file', path)` source at deploy — and reports the geometry its
 *   index carries (#765).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import e3 from '@elaraai/e3';
import { workspaceDeploy as workspaceDeployRemote } from '@elaraai/e3-api-client';
import { createServer, type Server } from '@elaraai/e3-api-server';
import {
  ArrayType,
  EastTypeType,
  FloatType,
  IntegerType,
  StringType,
  StructType,
  encodeBeast2PagedFor,
  printFor,
  readBeast2Extents,
  toEastTypeValue,
  variant,
} from '@elaraai/east';
import { createTestDir, getE3CliPath, removeTestDir, runE3Command } from './helpers.js';

const Row = StructType({ id: IntegerType, name: StringType, score: FloatType });
/** The same table after its schema drifted: `score` is gone. */
const DriftedRow = StructType({ id: IntegerType, name: StringType });

const ROW_COUNT = 2000;

/** Every file under the repository's object store. */
function countObjects(repoDir: string): number {
  let count = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else count++;
    }
  };
  walk(join(repoDir, 'objects'));
  return count;
}

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('e3 dataset set', () => {
  let testDir: string;
  let repoDir: string;
  /** The table as delivered, carrying the declared type, in several segments. */
  let goodPath: string;
  /** The same rows under the drifted type. */
  let driftedPath: string;
  /** Only the drifted file's header — decoding it whole fails, reading its type does not. */
  let driftedHeaderPath: string;
  let segmentCount: number;

  beforeEach(() => {
    testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    repoDir = join(testDir, 'repo');

    const rows = Array.from({ length: ROW_COUNT }, (_, i) => ({ id: BigInt(i), name: `row-${i}`, score: i / 7 }));
    const good = encodeBeast2PagedFor(ArrayType(Row), { targetSegmentBytes: 4096 })(rows);
    goodPath = join(testDir, 'TABLE.beast2');
    writeFileSync(goodPath, good);
    segmentCount = readBeast2Extents(good).offsets.length;
    assert.ok(segmentCount > 1, 'the delivery spans several segments');

    const drifted = encodeBeast2PagedFor(ArrayType(DriftedRow), { targetSegmentBytes: 4096 })(
      rows.map(({ id, name }) => ({ id, name }))
    );
    driftedPath = join(testDir, 'TABLE-drifted.beast2');
    writeFileSync(driftedPath, drifted);
    driftedHeaderPath = join(testDir, 'TABLE-drifted-header.beast2');
    writeFileSync(driftedHeaderPath, drifted.subarray(0, readBeast2Extents(drifted).offsets[0]));
  });

  afterEach(() => {
    removeTestDir(testDir);
  });

  /** A workspace `ws` whose package declares `table: Array<Row>`, unset. */
  async function deployTable(): Promise<void> {
    const table = e3.input('table', ArrayType(Row));
    const zip = join(testDir, 'table.zip');
    await e3.export(e3.package('table-set', '1.0.0', table), zip);
    for (const args of [
      ['repo', 'create', repoDir],
      ['package', 'import', repoDir, zip],
      ['workspace', 'create', repoDir, 'ws'],
      ['workspace', 'deploy', repoDir, 'ws', 'table-set@1.0.0'],
    ]) {
      const result = await runE3Command(args, testDir);
      assert.strictEqual(result.exitCode, 0, `${args.slice(0, 2).join(' ')} failed: ${result.stderr}`);
    }
  }

  describe('a file argument is checked against the declared type', () => {
    it('refuses a drifted file, naming the dataset and the first difference, before writing', async () => {
      await deployTable();
      const before = countObjects(repoDir);

      const result = await runE3Command(['dataset', 'set', repoDir, 'ws.table', driftedPath], testDir);

      assert.notStrictEqual(result.exitCode, 0, 'a drifted file is refused');
      assert.match(result.stderr, /dataset '\.inputs\.table' declares \.Array/);
      assert.match(result.stderr, /first difference at .*score/);
      assert.strictEqual(countObjects(repoDir), before, 'nothing is written');
    });

    it('decides from the header alone — a file that is only a drifted header is refused the same way', async () => {
      await deployTable();

      const result = await runE3Command(['dataset', 'set', repoDir, 'ws.table', driftedHeaderPath], testDir);

      // A whole-file decode of this file would fail on its missing segments;
      // the type mismatch is reported instead, so the header was all that was read.
      assert.notStrictEqual(result.exitCode, 0);
      assert.match(result.stderr, /dataset '\.inputs\.table' declares \.Array/);
      assert.match(result.stderr, /first difference at .*score/);
    });

    it('accepts the same table carrying the declared type', async () => {
      await deployTable();

      const result = await runE3Command(['dataset', 'set', repoDir, 'ws.table', goodPath], testDir);
      assert.strictEqual(result.exitCode, 0, `set failed: ${result.stderr}`);

      const status = await runE3Command(['dataset', 'status', repoDir, 'ws.table'], testDir);
      assert.strictEqual(status.exitCode, 0, `status failed: ${status.stderr}`);
      assert.match(status.stdout, /Status: set/);
      assert.match(status.stdout, new RegExp(`Rows: +${ROW_COUNT}\\b`));
    });

    it('checks --type on a .beast2 file instead of letting it override the header', async () => {
      await deployTable();
      const before = countObjects(repoDir);
      const typeSpec = printFor(EastTypeType)(toEastTypeValue(ArrayType(DriftedRow)));

      const result = await runE3Command(
        ['dataset', 'set', repoDir, 'ws.table', goodPath, '--type', typeSpec],
        testDir
      );

      assert.notStrictEqual(result.exitCode, 0, 'an overriding --type is refused');
      assert.match(result.stderr, /--type declares \.Array/);
      assert.strictEqual(countObjects(repoDir), before, 'nothing is written');
    });
  });

  describe('--from-file adopts a delivery by hash', () => {
    it('points the dataset at the file by hash, reports its geometry, and leaves the file untouched', async () => {
      await deployTable();
      const hash = sha256Of(goodPath);
      const delivered = statSync(goodPath);

      const result = await runE3Command(['dataset', 'set', repoDir, 'ws.table', '--from-file', goodPath], testDir);
      assert.strictEqual(result.exitCode, 0, `set --from-file failed: ${result.stderr}`);
      assert.match(result.stdout, new RegExp(`Hash: +${hash}`));
      assert.match(result.stdout, new RegExp(`Segments: ${segmentCount}\\b`));
      assert.match(result.stdout, new RegExp(`Rows: +${ROW_COUNT}\\b`));

      // The object IS the delivery's bytes, under the delivery's hash.
      const object = join(repoDir, 'objects', hash.slice(0, 2), `${hash.slice(2)}.beast2`);
      assert.ok(Buffer.from(readFileSync(object)).equals(readFileSync(goodPath)), 'the object holds the delivery');
      const after = statSync(goodPath);
      assert.strictEqual(after.mtimeMs, delivered.mtimeMs, 'the delivery is not modified');
      assert.strictEqual(after.mode, delivered.mode, "the delivery's mode is unchanged");

      const status = await runE3Command(['dataset', 'status', repoDir, 'ws.table'], testDir);
      assert.strictEqual(status.exitCode, 0, `status failed: ${status.stderr}`);
      assert.match(status.stdout, new RegExp(`Hash: +${hash}`));
      assert.match(status.stdout, new RegExp(`Segments: ${segmentCount}\\b`));
      assert.match(status.stdout, new RegExp(`Rows: +${ROW_COUNT}\\b`));
    });

    it('refuses a drifted delivery with the same message, writing nothing', async () => {
      await deployTable();
      const before = countObjects(repoDir);

      const result = await runE3Command(['dataset', 'set', repoDir, 'ws.table', '--from-file', driftedPath], testDir);

      assert.notStrictEqual(result.exitCode, 0, 'a drifted delivery is refused');
      assert.match(result.stderr, /^Error: dataset '\.inputs\.table' declares \.Array/m);
      assert.match(result.stderr, /first difference at .*score/);
      assert.strictEqual(countObjects(repoDir), before, 'nothing is written');
    });
  });

  describe('a file source', () => {
    it('is adopted at deploy, so the input is set with the file hash and geometry', async () => {
      const table = e3.input('table', ArrayType(Row), variant('file', goodPath));
      const zip = join(testDir, 'sourced.zip');
      await e3.export(e3.package('sourced', '1.0.0', table), zip);
      for (const args of [
        ['repo', 'create', repoDir],
        ['package', 'import', repoDir, zip],
        ['workspace', 'create', repoDir, 'ws'],
        ['workspace', 'deploy', repoDir, 'ws', 'sourced@1.0.0'],
      ]) {
        const result = await runE3Command(args, testDir);
        assert.strictEqual(result.exitCode, 0, `${args.slice(0, 2).join(' ')} failed: ${result.stderr}`);
      }

      const status = await runE3Command(['dataset', 'status', repoDir, 'ws.table'], testDir);
      assert.strictEqual(status.exitCode, 0, `status failed: ${status.stderr}`);
      assert.match(status.stdout, /Status: set/);
      assert.match(status.stdout, new RegExp(`Hash: +${sha256Of(goodPath)}`));
      assert.match(status.stdout, new RegExp(`Segments: ${segmentCount}\\b`));
      assert.match(status.stdout, new RegExp(`Rows: +${ROW_COUNT}\\b`));
    });
  });

  // A remote deploy — from source, from a zip, or of an imported package: the
  // package names a path on the developer's machine, so the server-side deploy
  // leaves each file source unassigned and the CLI streams it over the
  // transfer protocol afterwards.
  // Server and CLI share a filesystem here, so the server COULD read the
  // delivery — which is what makes this the test that it never does: a deploy
  // through the API alone leaves the input unset, and only the CLI's upload
  // sets it. Around that it pins the whole developer flow (the esbuild-loaded
  // source, the relative path resolved against the CLI's working directory,
  // geometry over the API) and that a new or drifted delivery behaves.
  describe('a file source deployed to a remote repository from source', () => {
    let server: Server;
    let baseUrl: string;
    let remoteUrl: string;
    let credentialsPath: string;
    let projectDir: string;
    let delivery: string;

    const SOURCE = [
      "import e3 from '@elaraai/e3';",
      "import { ArrayType, FloatType, IntegerType, StringType, StructType, variant } from '@elaraai/east';",
      "const Row = StructType({ id: IntegerType, name: StringType, score: FloatType });",
      "export default e3.package('remote-source', '1.0.0', e3.input('table', ArrayType(Row), variant('file', './TABLE.beast2')));",
      '',
    ].join('\n');

    /** Replace the delivery with a NEW file. Never rewrite it in place: the
     *  store may hold a hard link to it, which is the delivery contract. */
    function deliver(bytes: Uint8Array): void {
      rmSync(delivery, { force: true });
      writeFileSync(delivery, bytes);
    }

    function deploy(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
      return runE3Command(
        ['workspace', 'deploy', remoteUrl, 'ws', '--from-source', 'pkg.ts'],
        projectDir,
        { env: { E3_CREDENTIALS_PATH: credentialsPath } }
      );
    }

    function status(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
      return runE3Command(['dataset', 'status', remoteUrl, 'ws.table'], projectDir, {
        env: { E3_CREDENTIALS_PATH: credentialsPath },
      });
    }

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

      // The developer's project: the source, the delivery beside it, and the
      // SAME @elaraai/e3 and @elaraai/east the CLI loads (the bundled source is
      // imported from its own directory, and export checks instanceof).
      projectDir = join(testDir, 'project');
      const scope = join(projectDir, 'node_modules', '@elaraai');
      mkdirSync(scope, { recursive: true });
      const cliModules = join(dirname(getE3CliPath()), '..', '..', 'node_modules', '@elaraai');
      for (const name of ['e3', 'east']) {
        symlinkSync(realpathSync(join(cliModules, name)), join(scope, name), 'junction');
      }
      writeFileSync(join(projectDir, 'pkg.ts'), SOURCE);
      delivery = join(projectDir, 'TABLE.beast2');
      deliver(readFileSync(goodPath));
    });

    afterEach(async () => {
      await server.stop();
    });

    it('uploads the delivery after the deploy, re-points on a new delivery, and refuses a drifted one', async () => {
      const first = await deploy();
      assert.strictEqual(first.exitCode, 0, `deploy failed: ${first.stderr}\n${first.stdout}`);
      assert.match(first.stderr, /✔ uploaded ws\.table \(/, 'the CLI completes the file source after the deploy');

      let remote = await status();
      assert.strictEqual(remote.exitCode, 0, `status failed: ${remote.stderr}`);
      assert.match(remote.stdout, new RegExp(`Hash: +${sha256Of(delivery)}`));
      assert.match(remote.stdout, new RegExp(`Segments: ${segmentCount}\\b`));
      assert.match(remote.stdout, new RegExp(`Rows: +${ROW_COUNT}\\b`));

      // The server never resolves the path itself, although it could read it
      // here: the imported package redeployed through the API alone leaves the
      // input unset...
      await workspaceDeployRemote(baseUrl, 'remote', 'ws', 'remote-source@1.0.0', { token: 'mock-test-token' });
      remote = await status();
      assert.strictEqual(remote.exitCode, 0, `status failed: ${remote.stderr}`);
      assert.match(remote.stdout, /Status: unset/, 'a deploy through the API alone adopts nothing');

      // ...and the CLI's upload is what sets it again.
      const again = await deploy();
      assert.strictEqual(again.exitCode, 0, `redeploy failed: ${again.stderr}\n${again.stdout}`);
      remote = await status();
      assert.match(remote.stdout, /Status: set/);
      assert.match(remote.stdout, new RegExp(`Hash: +${sha256Of(delivery)}`));

      // A new delivery under the same path is a new hash on the next deploy.
      const more = Array.from({ length: ROW_COUNT + 500 }, (_, i) => ({ id: BigInt(i), name: `row-${i}`, score: i / 7 }));
      deliver(encodeBeast2PagedFor(ArrayType(Row), { targetSegmentBytes: 4096 })(more));
      const second = await deploy();
      assert.strictEqual(second.exitCode, 0, `redeploy failed: ${second.stderr}\n${second.stdout}`);
      remote = await status();
      const newHash = sha256Of(delivery);
      assert.match(remote.stdout, new RegExp(`Hash: +${newHash}`));
      assert.match(remote.stdout, new RegExp(`Rows: +${ROW_COUNT + 500}\\b`));

      // A drifted delivery fails at the export, before anything reaches the
      // server, and the remote dataset keeps the last good delivery.
      deliver(readFileSync(driftedPath));
      const third = await deploy();
      assert.notStrictEqual(third.exitCode, 0, 'a drifted delivery fails the deploy');
      assert.match(third.stderr, /input 'table' declares \.Array/);
      assert.match(third.stderr, /first difference at .*score/);
      remote = await status();
      assert.match(remote.stdout, new RegExp(`Hash: +${newHash}`), 'the remote dataset is untouched');
    });

    it('completes the file source when deploying a zip or an imported package, checking the delivery before touching the workspace', async () => {
      const env = { env: { E3_CREDENTIALS_PATH: credentialsPath } };
      const e3At = (args: string[]) => runE3Command(args, projectDir, env);
      const statusOf = async (ws: string) => (await e3At(['dataset', 'status', remoteUrl, `${ws}.table`])).stdout;

      // A zip exported elsewhere carries the delivery's absolute path.
      const zip = join(testDir, 'remote-zip.zip');
      await e3.export(e3.package('remote-zip', '1.0.0', e3.input('table', ArrayType(Row), variant('file', delivery))), zip);
      const hash = sha256Of(delivery);

      const fromZip = await e3At(['workspace', 'deploy', remoteUrl, 'zipws', '--from-zip', zip]);
      assert.strictEqual(fromZip.exitCode, 0, `--from-zip deploy failed: ${fromZip.stderr}\n${fromZip.stdout}`);
      assert.match(fromZip.stderr, /✔ uploaded zipws\.table \(/, 'a zip deploy uploads the file source too');
      assert.match(await statusOf('zipws'), new RegExp(`Hash: +${hash}`));

      // The package is now imported: deploy it by name, pinned and as `latest`.
      assert.strictEqual((await e3At(['workspace', 'create', remoteUrl, 'pkgws'])).exitCode, 0);
      const pinned = await e3At(['workspace', 'deploy', remoteUrl, 'pkgws', 'remote-zip@1.0.0']);
      assert.strictEqual(pinned.exitCode, 0, `pkg@version deploy failed: ${pinned.stderr}\n${pinned.stdout}`);
      assert.match(pinned.stderr, /✔ uploaded pkgws\.table \(/);
      assert.match(await statusOf('pkgws'), new RegExp(`Hash: +${hash}`));
      const latest = await e3At(['workspace', 'deploy', remoteUrl, 'pkgws', 'remote-zip']);
      assert.strictEqual(latest.exitCode, 0, `latest deploy failed: ${latest.stderr}\n${latest.stdout}`);
      assert.match(latest.stderr, /deployed remote-zip@1\.0\.0 to workspace pkgws/);

      // Without the delivery on this machine the deploy fails before the
      // remote workspace is touched, naming the input, the path and the way out.
      rmSync(delivery);
      const missing = await e3At(['workspace', 'deploy', remoteUrl, 'pkgws', 'remote-zip@1.0.0']);
      assert.notStrictEqual(missing.exitCode, 0, 'a delivery this machine does not have fails the deploy');
      assert.match(missing.stderr, /input 'table': no file at .*TABLE\.beast2 — a file source is read on the machine that deploys the package/);
      assert.match(missing.stderr, /--skip-file-sources/);
      assert.match(await statusOf('pkgws'), new RegExp(`Hash: +${hash}`), 'the remote workspace is untouched');

      // --skip-file-sources deploys anyway and says how to set the input.
      const skipped = await e3At(['workspace', 'deploy', remoteUrl, 'pkgws', 'remote-zip@1.0.0', '--skip-file-sources']);
      assert.strictEqual(skipped.exitCode, 0, `--skip-file-sources deploy failed: ${skipped.stderr}\n${skipped.stdout}`);
      assert.match(skipped.stdout, /Left pkgws\.table unset \(file source .*TABLE\.beast2\); set it with: e3 dataset set \S+ pkgws\.table --from-file /);
      assert.match(await statusOf('pkgws'), /Status: unset/);
    });
  });
});
