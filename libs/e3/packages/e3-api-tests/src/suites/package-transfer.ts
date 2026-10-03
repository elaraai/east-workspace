/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Package transfer protocol test suite.
 *
 * Tests the staged transfer flow for package import/export.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readZipEntries, withRelease, writeZip } from '@elaraai/e3-core/test';

import {
  packageList,
  packageImport,
  packageExport,
  pollExport,
  repoCreate,
  repoRemove,
  workspaceExport,
  ApiError,
  ApiTypes,
  fetchWithAuth,
  type Response,
} from '@elaraai/e3-api-client';
import { encodeBeast2For, decodeBeast2For, equalFor, isValueOf, printFor, NullType, type ValueTypeOf } from '@elaraai/east';
import {
  InvalidNameErrorType,
  PackageJobResponseType,
  PackageTransferInitRequestType,
  PackageTransferInitResponseType,
  PackageImportStatusType,
  type PackageImportStatus,
} from '@elaraai/e3-types';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createPackageZip } from '../fixtures.js';

/**
 * Register package transfer protocol tests.
 */
export function packageTransferTests(setup: TestSetup<TestContext>): void {
  const withPackageZip: TestSetup<TestContext & { packageZip: Uint8Array }> = async (t) => {
    const ctx = await setup(t);
    const zipPath = await createPackageZip(ctx.tempDir, 'transfer-pkg', '1.0.0');
    const packageZip = readFileSync(zipPath);
    return Object.assign(ctx, { packageZip });
  };

  describe('package-transfer', { concurrency: false }, () => {
    it('import via transfer flow round-trips', async (t) => {
      const ctx = await withPackageZip(t);
      const opts = await ctx.opts();

      const result = await packageImport(ctx.config.baseUrl, ctx.repoName, ctx.packageZip, opts);
      assert.strictEqual(result.name, 'transfer-pkg');
      assert.strictEqual(result.version, '1.0.0');
      assert.strictEqual(result.packageHash.length, 64);
      assert.ok(result.objectCount > 0n);

      const packages = await packageList(ctx.config.baseUrl, ctx.repoName, opts);
      assert.strictEqual(packages.length, 1);
      assert.strictEqual(packages[0].name, 'transfer-pkg');
    });

    it('export via transfer flow returns valid zip', async (t) => {
      const ctx = await withPackageZip(t);
      const opts = await ctx.opts();

      await packageImport(ctx.config.baseUrl, ctx.repoName, ctx.packageZip, opts);

      const exported = await packageExport(ctx.config.baseUrl, ctx.repoName, 'transfer-pkg', '1.0.0', opts);
      assert.ok(exported instanceof Uint8Array);
      assert.ok(exported.length > 0);
      // ZIP files start with PK signature
      assert.strictEqual(exported[0], 0x50);
      assert.strictEqual(exported[1], 0x4b);
    });

    it('import then export then re-import round-trip', async (t) => {
      const ctx = await withPackageZip(t);
      const opts = await ctx.opts();

      // Import original
      const result1 = await packageImport(ctx.config.baseUrl, ctx.repoName, ctx.packageZip, opts);
      assert.strictEqual(result1.name, 'transfer-pkg');

      // Export
      const exported = await packageExport(ctx.config.baseUrl, ctx.repoName, 'transfer-pkg', '1.0.0', opts);

      // Re-import (should succeed, package already exists is an error but let's verify zip is valid)
      // The re-import of same name+version may error with package_exists, which is expected
      try {
        await packageImport(ctx.config.baseUrl, ctx.repoName, exported, opts);
        // If it succeeds (idempotent), that's fine too
      } catch (err: any) {
        // PackageExistsError is expected
        assert.ok(err.code === 'package_exists' || err.message.includes('already exists'),
          `Unexpected error: ${err.message}`);
      }
    });

    it('exports a workspace as a job, into a zip that imports as its package', async (t) => {
      const ctx = await withPackageZip(t);
      const opts = await ctx.opts();
      await packageImport(ctx.config.baseUrl, ctx.repoName, ctx.packageZip, opts);
      await ctx.createWorkspace('export-ws');
      await ctx.deployPackage('export-ws', 'transfer-pkg@1.0.0');

      const exported = await workspaceExport(ctx.config.baseUrl, ctx.repoName, 'export-ws', opts, { version: '2.0.0' });
      const imported = await packageImport(ctx.config.baseUrl, ctx.repoName, exported, opts);
      assert.deepStrictEqual([imported.name, imported.version], ['transfer-pkg', '2.0.0']);

      // The export is a job only: nothing answers a request that waits for the zip.
      const waited = await fetchWithAuth(
        `${ctx.config.baseUrl}/api/repos/${encodeURIComponent(ctx.repoName)}/workspaces/export-ws/export`,
        { method: 'GET' },
        opts
      );
      assert.strictEqual(waited.status, 404);
    });

    // =========================================================================
    // Failure-path tests
    // =========================================================================

    it('export of non-existent package fails with package_not_found', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      await assert.rejects(
        () => packageExport(ctx.config.baseUrl, ctx.repoName, 'no-such-pkg', '9.9.9', opts),
        (err: any) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.code, 'package_not_found');
          return true;
        }
      );
    });

    it('refuses an export of a malformed package name, version or workspace name as invalid_name', async (t) => {
      const ctx = await withPackageZip(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;
      await packageImport(base, ctx.repoName, ctx.packageZip, opts);

      /** An export refused as every other route refuses the name: as
       *  `invalid_name`, naming the name and why. */
      const invalidName = (kind: string, name: string, why: string) => (err: unknown) => {
        assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
        assert.strictEqual(err.code, 'invalid_name');
        assert.ok(isValueOf(err.details, InvalidNameErrorType), 'the refusal names the name and why');
        const said = err.details as ValueTypeOf<typeof InvalidNameErrorType>;
        const expected: ValueTypeOf<typeof InvalidNameErrorType> = {
          kind, name, message: `the ${kind} name ${JSON.stringify(name)} ${why}`,
        };
        assert.ok(equalFor(InvalidNameErrorType)(said, expected), `refused as ${printFor(InvalidNameErrorType)(said)}`);
        return true;
      };
      const holds = (c: string) => `holds ${JSON.stringify(c)}, which a file name cannot`;

      // No name holding `/` is sent in a URL here: a front door that decodes
      // `%2F` before it routes, as an AWS HTTP API does, splits the path, and
      // its router answers 404 before e3 sees the name. e3-core's store suites
      // pin that every backend refuses `/` in a name.
      await assert.rejects(packageExport(base, ctx.repoName, 'bad:name', '1.0.0', opts), invalidName('package', 'bad:name', holds(':')));
      await assert.rejects(packageExport(base, ctx.repoName, 'transfer-pkg', '1:0', opts), invalidName('package version', '1:0', holds(':')));
      await assert.rejects(workspaceExport(base, ctx.repoName, 'bad:name', opts), invalidName('workspace', 'bad:name', holds(':')));
      await assert.rejects(workspaceExport(base, ctx.repoName, 'a#b', opts),
        invalidName('workspace', 'a#b', `holds "#", which joins the parts of a lock's name`));
    });

    it('refuses on import a zip a newer e3 exported, naming that release, and imports nothing', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();
      const zipPath = await createPackageZip(ctx.tempDir, 'newer-pkg', '1.0.0');
      const newer = await writeZip(join(ctx.tempDir, 'newer.zip'), withRelease(await readZipEntries(zipPath), '999.0.0'));

      await assert.rejects(
        () => packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(newer), opts),
        (err: unknown) => {
          assert.ok(err instanceof Error, `Expected Error, got ${err}`);
          assert.match(err.message, /e3 999\.0\.0 exported it, and this e3 is \S+ — import it with e3 999\.0\.0 or a newer one/);
          return true;
        }
      );
      assert.deepStrictEqual(await packageList(ctx.config.baseUrl, ctx.repoName, opts), []);
    });

    it('import of corrupted zip fails', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      // Random bytes — not a valid zip
      const garbage = new Uint8Array(1024);
      for (let i = 0; i < garbage.length; i++) garbage[i] = Math.floor(Math.random() * 256);

      await assert.rejects(
        () => packageImport(ctx.config.baseUrl, ctx.repoName, garbage, opts),
        (err: any) => {
          // Import should fail — either ApiError or Error with failure message
          assert.ok(err instanceof Error, `Expected Error, got ${err}`);
          return true;
        }
      );
    });

    it('upload with wrong size is rejected', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();
      const repoEncoded = encodeURIComponent(ctx.repoName);
      const BEAST2 = 'application/beast2';

      // 1. Init transfer claiming size 100
      const encode = encodeBeast2For(PackageTransferInitRequestType);
      const initRes = await fetchWithAuth(
        `${ctx.config.baseUrl}/api/repos/${repoEncoded}/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': BEAST2, 'Accept': BEAST2 },
          body: encode({ size: 100n }),
        },
        opts
      );
      assert.ok(initRes.ok, `Init should succeed, got ${initRes.status}`);

      // Decode to get uploadUrl and id
      const initBuffer = new Uint8Array(await initRes.arrayBuffer());
      const decodeInit = decodeBeast2For(ApiTypes.ResponseType(PackageTransferInitResponseType));
      const initResult = decodeInit(initBuffer) as Response<{ id: string; uploadUrl: string }>;
      assert.strictEqual(initResult.type, 'success');
      const { id, uploadUrl } = initResult.value;

      // 2. Upload only 50 bytes (mismatched with declared size of 100)
      //    Local server validates size at upload time (BEAST2 error response).
      //    Cloud server accepts the upload (S3 presigned URL) and validates at execute time.
      const shortData = new Uint8Array(50);
      const uploadRes = await ctx.fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/zip' },
        body: shortData,
      });

      // Check if the upload itself rejected the size mismatch (local server behavior)
      // Local server returns HTTP 400 for size mismatch
      if (!uploadRes.ok) {
        // Size mismatch caught at upload time — test passes
        return;
      }
      if (uploadRes.headers.get('content-type')?.includes('beast2')) {
        const uploadBuffer = new Uint8Array(await uploadRes.arrayBuffer());
        if (uploadBuffer.length > 0) {
          const decodeUpload = decodeBeast2For(ApiTypes.ResponseType(NullType));
          const uploadResult = decodeUpload(uploadBuffer) as Response<null>;
          if (uploadResult.type === 'error') {
            // Size mismatch caught at upload time — test passes
            return;
          }
        }
      }

      // 3. Upload was accepted (cloud/presigned URL) — trigger import to validate
      const triggerRes = await fetchWithAuth(
        `${ctx.config.baseUrl}/api/repos/${repoEncoded}/import/${id}`,
        {
          method: 'POST',
          headers: { 'Accept': BEAST2 },
        },
        opts
      );
      assert.ok(triggerRes.ok, `Trigger should return 200, got ${triggerRes.status}`);

      // 4. Poll until terminal status — expect failure due to size mismatch or corrupt zip
      const decodePoll = decodeBeast2For(ApiTypes.ResponseType(PackageImportStatusType));
      let status: PackageImportStatus | undefined;
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const pollRes = await fetchWithAuth(
          `${ctx.config.baseUrl}/api/repos/${repoEncoded}/import/${id}`,
          {
            method: 'GET',
            headers: { 'Accept': BEAST2 },
          },
          opts
        );
        assert.ok(pollRes.ok);
        const pollBuffer = new Uint8Array(await pollRes.arrayBuffer());
        const pollResult = decodePoll(pollBuffer) as Response<PackageImportStatus>;
        assert.strictEqual(pollResult.type, 'success');
        status = pollResult.value;
        if (status.type === 'failed' || status.type === 'completed') break;
      }

      assert.ok(status, 'Should have received a terminal status');
      assert.strictEqual(status.type, 'failed', 'Expected failed status due to size mismatch');
    });

    it('poll for non-existent import returns error', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();
      const repoEncoded = encodeURIComponent(ctx.repoName);
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await fetchWithAuth(
        `${ctx.config.baseUrl}/api/repos/${repoEncoded}/import/${fakeId}`,
        {
          method: 'GET',
          headers: { 'Accept': 'application/beast2' },
        },
        opts
      );

      // Server returns 200 with BEAST2 error response for unknown jobs
      assert.ok(res.ok, `Expected 200 response, got ${res.status}`);
      const buffer = new Uint8Array(await res.arrayBuffer());
      const decode = decodeBeast2For(ApiTypes.ResponseType(PackageImportStatusType));
      const result = decode(buffer) as Response<PackageImportStatus>;
      assert.strictEqual(result.type, 'error', 'Expected error variant for non-existent job');
    });

    it('answers an import and an export only through the repository that started them', async (t) => {
      const ctx = await withPackageZip(t);
      const opts = await ctx.opts();
      const base = ctx.config.baseUrl;
      const other = `pkg-jobs-other-${Date.now()}`;
      await repoCreate(base, other, opts);
      t.after(async () => {
        try {
          await repoRemove(base, other, opts);
        } catch {
          // Ignore cleanup errors
        }
      });
      const repoUrl = (repo: string) => `${base}/api/repos/${encodeURIComponent(repo)}`;
      const BEAST2 = 'application/beast2';
      const decodeJob = decodeBeast2For(ApiTypes.ResponseType(PackageJobResponseType));
      const decodeImport = decodeBeast2For(ApiTypes.ResponseType(PackageImportStatusType));
      /** The message a refusal names, as a job route answers it. */
      const refusal = (answer: Response<unknown>): string => {
        if (answer.type !== 'error') assert.fail('a job route answered for a job another repository started');
        if (answer.value.type !== 'internal') assert.fail(`a job route refused with ${answer.value.type}, not internal`);
        return answer.value.value.message;
      };

      // An export and an import, each started in the test's repository.
      await packageImport(base, ctx.repoName, ctx.packageZip, opts);
      const started = await fetchWithAuth(`${repoUrl(ctx.repoName)}/packages/transfer-pkg/1.0.0/export`, {
        method: 'POST', headers: { 'Accept': BEAST2 },
      }, opts);
      const exportJob = decodeJob(new Uint8Array(await started.arrayBuffer())) as Response<{ id: string }>;
      assert.strictEqual(exportJob.type, 'success');
      const exportId = exportJob.value.id;
      const init = await fetchWithAuth(`${repoUrl(ctx.repoName)}/import`, {
        method: 'POST',
        headers: { 'Content-Type': BEAST2, 'Accept': BEAST2 },
        body: encodeBeast2For(PackageTransferInitRequestType)({ size: BigInt(ctx.packageZip.length) }),
      }, opts);
      const importJob = decodeBeast2For(ApiTypes.ResponseType(PackageTransferInitResponseType))(new Uint8Array(await init.arrayBuffer())) as Response<{ id: string; uploadUrl: string }>;
      assert.strictEqual(importJob.type, 'success');
      const importId = importJob.value.id;

      // Through another repository each is a job that does not exist: the
      // export's status and download, the import's status and its processing.
      await assert.rejects(pollExport(base, encodeURIComponent(other), exportId, opts), (err: unknown) => {
        assert.ok(err instanceof ApiError, `Expected ApiError, got ${err}`);
        assert.strictEqual(err.code, 'internal');
        assert.strictEqual((err.details as { message: string }).message, `repository '${other}' has no export job '${exportId}'`);
        return true;
      });
      const polled = await fetchWithAuth(`${repoUrl(other)}/import/${importId}`, { method: 'GET', headers: { 'Accept': BEAST2 } }, opts);
      assert.strictEqual(refusal(decodeImport(new Uint8Array(await polled.arrayBuffer())) as Response<unknown>),
        `repository '${other}' has no import job '${importId}'`);
      const triggered = await fetchWithAuth(`${repoUrl(other)}/import/${importId}`, { method: 'POST', headers: { 'Accept': BEAST2 } }, opts);
      assert.strictEqual(refusal(decodeJob(new Uint8Array(await triggered.arrayBuffer())) as Response<unknown>),
        `repository '${other}' has no import job '${importId}'`);

      // Through its own repository each answers.
      const exported = await pollExport(base, encodeURIComponent(ctx.repoName), exportId, opts);
      assert.strictEqual(exported.type, 'completed');
      const own = await fetchWithAuth(`${repoUrl(ctx.repoName)}/import/${importId}`, { method: 'GET', headers: { 'Accept': BEAST2 } }, opts);
      const pending = decodeImport(new Uint8Array(await own.arrayBuffer())) as Response<PackageImportStatus>;
      assert.strictEqual(pending.type, 'success');
      assert.strictEqual(pending.value.type, 'processing', 'the import waits for its upload');
    });
  });
}
