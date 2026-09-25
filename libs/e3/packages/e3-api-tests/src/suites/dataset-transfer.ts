/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Dataset transfer test suite.
 *
 * Tests: redirect-based GET for large objects, transfer upload flow for large SET,
 * dedup shortcut, and hash mismatch rejection — through the client, and at the
 * wire for both protocol versions, so a server keeps serving clients that
 * predate protocol 2 and answers a protocol-2 client in its own forms.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';

/**
 * ~`byteLength` bytes of high-entropy ASCII, deterministic across runs.
 *
 * These fixtures exist to cross a byte-size threshold, so they must not be
 * compressible: beast2 frames deflate by default (container v5), and a run of
 * one repeated character shrinks to a few hundred bytes — putting the payload
 * back under the very threshold the test is probing. A cheap LCG gives content
 * deflate cannot shrink, without depending on Math.random.
 */
function incompressibleString(byteLength: number): string {
  // Math.imul, not `*`: a 32-bit LCG done in float multiplication loses low
  // bits past 2^53 and degenerates into a short, highly compressible cycle
  // (1.1 MB of it deflates to 25 kB). Take the high bits — an LCG's low bits
  // are weak.
  let seed = 0x2545f491 >>> 0;
  const chars = new Array<string>(byteLength);
  for (let i = 0; i < byteLength; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    chars[i] = String.fromCharCode(33 + ((seed >>> 16) % 94)); // printable ASCII: 1 byte in UTF-8
  }
  return chars.join('');
}

import { ArrayType, BlobType, IntegerType, StringType, StructType, encodeBeast2For, decodeBeast2For, type EastType, type ValueTypeOf } from '@elaraai/east';
import { some, variant } from '@elaraai/east';
import { computeHash } from '@elaraai/e3-core';
import {
  BEAST2_CONTENT_TYPE,
  ResponseType,
  TRANSFER_PROTOCOL_VERSION,
  TransferDoneResponseType,
  TransferPartResponseType,
  TransferUploadRequestType,
  TransferUploadResponseType,
  transferPartCount,
  transferPartRange,
} from '@elaraai/e3-types';
import {
  ApiError,
  packageImport,
  workspaceCreate,
  workspaceDeploy,
  datasetGet,
  datasetGetStatus,
  datasetSet,
  datasetSetStream,
  type RequestOptions,
} from '@elaraai/e3-api-client';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { createStringPackageZip, createTablePackageZip } from '../fixtures.js';

/** A decoded response envelope: the success value, or the API error. */
type Envelope<T extends EastType> =
  | { type: 'success'; value: ValueTypeOf<T> }
  | { type: 'error'; value: { type: string; value: unknown } };

/**
 * One transfer request made the way a client without e3-api-client makes it,
 * with the response envelope decoded.
 */
async function transferCall<T extends EastType>(
  url: string,
  method: 'GET' | 'POST',
  type: T,
  opts: RequestOptions,
  body?: Uint8Array,
): Promise<Envelope<T>> {
  const response = await fetch(url, {
    method,
    headers: {
      'Accept': BEAST2_CONTENT_TYPE,
      ...(body ? { 'Content-Type': BEAST2_CONTENT_TYPE } : {}),
      ...(opts.token ? { 'Authorization': `Bearer ${opts.token}` } : {}),
    },
    ...(body ? { body } : {}),
  });
  assert.ok(response.ok, `${method} ${url}: ${response.status} ${response.statusText}`);
  return decodeBeast2For(ResponseType(type))(new Uint8Array(await response.arrayBuffer())) as Envelope<T>;
}

/** The success value of an envelope, failing the test on an API error. */
function success<T extends EastType>(envelope: Envelope<T>): ValueTypeOf<T> {
  if (envelope.type !== 'success') {
    assert.fail(`expected success, got ${inspect(envelope.value, { depth: 4 })}`);
  }
  return envelope.value;
}

/**
 * Commit an upload in protocol 2 and poll until the commit finishes, returning
 * the final envelope.
 */
async function commitAndPoll(uploadUrl: string, id: string, opts: RequestOptions) {
  let done = await transferCall(`${uploadUrl}/${id}?protocol=${TRANSFER_PROTOCOL_VERSION}`, 'POST', TransferDoneResponseType, opts);
  for (let polls = 0; done.type === 'success' && done.value.type === 'processing' && polls < 1200; polls++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    done = await transferCall(`${uploadUrl}/${id}`, 'GET', TransferDoneResponseType, opts);
  }
  return done;
}

/**
 * Register dataset transfer tests.
 *
 * @param setup - Factory that creates a fresh test context per test
 */
export function datasetTransferTests(setup: TestSetup<TestContext>): void {
  const withStringPackage: TestSetup<TestContext> = async (t) => {
    const ctx = await setup(t);
    const opts = await ctx.opts();

    const zipPath = await createStringPackageZip(ctx.tempDir, 'transfer-pkg', '1.0.0');
    const packageZip = readFileSync(zipPath);
    await packageImport(ctx.config.baseUrl, ctx.repoName, packageZip, opts);

    await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', opts);
    await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', 'transfer-pkg@1.0.0', opts);

    return ctx;
  };

  describe('dataset transfer', { concurrency: false }, () => {
    it('large dataset SET uses transfer flow and round-trips', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();

      // Create a >1MB payload using a large string
      const largeString = incompressibleString(1_100_000);
      const encode = encodeBeast2For(StringType);
      const data = encode(largeString);
      assert.ok(data.byteLength > 1024 * 1024, 'payload should exceed 1MB threshold');

      const path = [variant('field', 'inputs'), variant('field', 'config')];

      // Set via transfer flow (client automatically uses transfer for >1MB)
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, data, opts);

      // Get and verify round-trip via hash comparison (avoiding BEAST2 decode stack overflow on large strings)
      const expectedHash = computeHash(data);
      const { data: retrieved, hash, size } = await datasetGet(
        ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, opts
      );
      assert.ok(retrieved instanceof Uint8Array);
      assert.strictEqual(hash, expectedHash, 'hash should match original data');
      assert.strictEqual(size, data.byteLength, 'size should match');
      assert.strictEqual(computeHash(retrieved), expectedHash, 'retrieved data hash should match');
    });

    it('large dataset SET dedup skips upload on second set of same data', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();

      const largeString = incompressibleString(1_100_001);
      const encode = encodeBeast2For(StringType);
      const data = encode(largeString);
      const expectedHash = computeHash(data);

      const path = [variant('field', 'inputs'), variant('field', 'config')];

      // First set — full upload
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, data, opts);

      // Second set with same data — should dedup (object already exists)
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, data, opts);

      // Verify data is correct via hash
      const { data: retrieved, hash } = await datasetGet(
        ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, opts
      );
      assert.strictEqual(hash, expectedHash, 'hash should match after dedup');
      assert.strictEqual(computeHash(retrieved), expectedHash, 'retrieved data should match');
    });

    it('GET object endpoint returns bytes for known hash', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();

      // Set a small value first to get a known hash
      const encode = encodeBeast2For(StringType);
      const data = encode('object-endpoint-test');

      const path = [variant('field', 'inputs'), variant('field', 'config')];
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, data, opts);

      // Get the hash
      const { hash } = await datasetGet(
        ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, opts
      );

      // Fetch directly from object endpoint
      const response = await fetch(
        `${ctx.config.baseUrl}/api/repos/${encodeURIComponent(ctx.repoName)}/objects/${hash}`,
        {
          headers: { 'Authorization': `Bearer ${(await ctx.opts()).token}` },
        }
      );
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('Content-Type'), BEAST2_CONTENT_TYPE);
      assert.strictEqual(response.headers.get('X-Content-SHA256'), hash);

      const body = new Uint8Array(await response.arrayBuffer());
      assert.strictEqual(computeHash(body), hash);
    });

    it('GET object endpoint returns JSON error for missing hash', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();

      const fakeHash = 'a'.repeat(64);
      const response = await fetch(
        `${ctx.config.baseUrl}/api/repos/${encodeURIComponent(ctx.repoName)}/objects/${fakeHash}`,
        {
          headers: { 'Authorization': `Bearer ${opts.token}` },
        }
      );
      // Error returned as JSON with appropriate HTTP status code
      assert.strictEqual(response.status, 404);
      assert.strictEqual(response.headers.get('Content-Type'), 'application/json');
      const body = await response.json() as { error: { type: string; message: string } };
      assert.strictEqual(body.error.type, 'object_not_found');
    });

    it('refuses an inline PUT whose wire type is not the declared type', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();
      const path = [variant('field', 'inputs'), variant('field', 'config')];
      const before = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, opts);

      // `inputs.config` declares String; the body carries an Integer.
      await assert.rejects(
        () => datasetSet(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, encodeBeast2For(IntegerType)(42n), opts),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.code, 'dataset_type_mismatch');
          const details = err.details as { path: string; message: string };
          assert.strictEqual(details.path, '.inputs.config');
          assert.match(details.message, /dataset '\.inputs\.config' declares \.String but the value carries \.Integer/);
          return true;
        }
      );
      const after = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, opts);
      assert.deepStrictEqual(after.hash, before.hash, 'a refused PUT leaves the dataset where it was');
    });

    it('refuses a transfer whose staged bytes carry another type, with the same error', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();
      const path = [variant('field', 'inputs'), variant('field', 'config')];

      // Over the inline threshold, so it takes the upload + commit path; a
      // Blob of incompressible bytes stays over it after deflate.
      const bytes = new TextEncoder().encode(incompressibleString(1_100_002));
      const data = encodeBeast2For(BlobType)(bytes);
      assert.ok(data.byteLength > 1024 * 1024);

      await assert.rejects(
        () => datasetSet(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, data, opts),
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.strictEqual(err.code, 'dataset_type_mismatch');
          assert.match((err.details as { message: string }).message, /declares \.String but .* carries \.Blob/);
          return true;
        }
      );
    });

    it('streams a dataset from byte-range streams, landing on the bytes\' own hash', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();
      const path = [variant('field', 'inputs'), variant('field', 'config')];

      const data = encodeBeast2For(StringType)(incompressibleString(1_200_000));
      const hash = computeHash(data);
      await datasetSetStream(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, {
        size: data.byteLength,
        hash,
        slice: (start, end) => new ReadableStream<Uint8Array>({
          start(controller) {
            // Several chunks, as a file stream delivers them.
            for (let at = start; at < end; at += 64 * 1024) {
              controller.enqueue(data.slice(at, Math.min(end, at + 64 * 1024)));
            }
            controller.close();
          },
        }),
      }, opts);

      const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, opts);
      assert.deepStrictEqual(status.hash, some(hash));
    });

    it('serves a client that predates protocol 2: one upload URL, and a commit that answers when it is done', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();
      const path = [variant('field', 'inputs'), variant('field', 'config')];
      const uploadUrl = `${ctx.config.baseUrl}/api/repos/${encodeURIComponent(ctx.repoName)}/workspaces/transfer-ws/datasets/inputs/config/upload`;

      const data = encodeBeast2For(StringType)(incompressibleString(1_100_003));
      const hash = computeHash(data);
      const request = encodeBeast2For(TransferUploadRequestType)({ hash, size: BigInt(data.byteLength) });

      // No `?protocol`: the request is protocol 1, so the answer is too.
      const init = success(await transferCall(uploadUrl, 'POST', TransferUploadResponseType, opts, request));
      assert.strictEqual(init.type, 'upload');
      if (init.type !== 'upload') return;

      const put = await fetch(init.value.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
        body: data,
      });
      assert.ok(put.ok, `upload PUT: ${put.status} ${put.statusText}`);

      const done = success(await transferCall(`${uploadUrl}/${init.value.id}`, 'POST', TransferDoneResponseType, opts));
      assert.deepStrictEqual(done, variant('completed', null), 'a protocol-1 commit never answers processing');

      const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, opts);
      assert.deepStrictEqual(status.hash, some(hash));
    });

    it('takes a protocol-2 upload as the parts it plans, in any order, and keeps the commit\'s answer pollable', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();
      const path = [variant('field', 'inputs'), variant('field', 'config')];
      const uploadUrl = `${ctx.config.baseUrl}/api/repos/${encodeURIComponent(ctx.repoName)}/workspaces/transfer-ws/datasets/inputs/config/upload`;

      const data = encodeBeast2For(StringType)(incompressibleString(1_100_004));
      const hash = computeHash(data);
      const request = encodeBeast2For(TransferUploadRequestType)({ hash, size: BigInt(data.byteLength) });

      const init = success(await transferCall(`${uploadUrl}?protocol=${TRANSFER_PROTOCOL_VERSION}`, 'POST', TransferUploadResponseType, opts, request));
      assert.strictEqual(init.type, 'upload_parts');
      if (init.type !== 'upload_parts') return;
      const { id, partBytes } = init.value;
      const count = transferPartCount(data.byteLength, partBytes);

      // Last part first: the plan fixes each part's range, not the order they arrive in.
      for (let part = count; part >= 1; part--) {
        const target = success(await transferCall(`${uploadUrl}/${id}/parts/${part}`, 'GET', TransferPartResponseType, opts));
        const { start, end } = transferPartRange(data.byteLength, partBytes, part)!;
        const put = await fetch(target.url, {
          method: 'PUT',
          headers: Object.fromEntries(target.headers),
          body: data.subarray(start, end),
        });
        assert.ok(put.ok, `part ${part} of ${count}: ${put.status} ${put.statusText}`);
      }

      const beyond = await transferCall(`${uploadUrl}/${id}/parts/${count + 1}`, 'GET', TransferPartResponseType, opts);
      assert.strictEqual(beyond.type, 'error', 'an upload has no part past its plan');

      assert.deepStrictEqual(success(await commitAndPoll(uploadUrl, id, opts)), variant('completed', null));
      // A client whose answer was lost asks again, and hears the same.
      assert.deepStrictEqual(
        success(await transferCall(`${uploadUrl}/${id}`, 'GET', TransferDoneResponseType, opts)),
        variant('completed', null),
      );

      const status = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, opts);
      assert.deepStrictEqual(status.hash, some(hash));
    });

    it('never lands bytes that do not hash to the declared hash', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();
      const path = [variant('field', 'inputs'), variant('field', 'config')];
      const uploadUrl = `${ctx.config.baseUrl}/api/repos/${encodeURIComponent(ctx.repoName)}/workspaces/transfer-ws/datasets/inputs/config/upload`;
      const before = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, opts);

      const data = encodeBeast2For(StringType)(incompressibleString(1_100_005));
      const declared = computeHash(encodeBeast2For(StringType)(incompressibleString(1_100_006)));
      const request = encodeBeast2For(TransferUploadRequestType)({ hash: declared, size: BigInt(data.byteLength) });

      const init = success(await transferCall(`${uploadUrl}?protocol=${TRANSFER_PROTOCOL_VERSION}`, 'POST', TransferUploadResponseType, opts, request));
      assert.strictEqual(init.type, 'upload_parts');
      if (init.type !== 'upload_parts') return;
      const { id, partBytes } = init.value;

      // A store that checks a signed checksum refuses the part itself; one that
      // verifies at the commit takes it. Either way the commit must not land it.
      for (let part = 1; part <= transferPartCount(data.byteLength, partBytes); part++) {
        const target = success(await transferCall(`${uploadUrl}/${id}/parts/${part}`, 'GET', TransferPartResponseType, opts));
        const { start, end } = transferPartRange(data.byteLength, partBytes, part)!;
        await fetch(target.url, { method: 'PUT', headers: Object.fromEntries(target.headers), body: data.subarray(start, end) });
      }

      // Refused as an `error` answer, or as an API error when nothing was staged.
      const done = await commitAndPoll(uploadUrl, id, opts);
      if (done.type === 'success') {
        assert.strictEqual(done.value.type, 'error', `the commit answered ${done.value.type}`);
      }

      const after = await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, opts);
      assert.deepStrictEqual(after.hash, before.hash, 'the dataset keeps its value');
    });

    it('adopts a collection it split before by the delivery\'s hash, with no upload', async (t) => {
      const ctx = await setup(t);
      const opts = await ctx.opts();
      const zipPath = await createTablePackageZip(ctx.tempDir, 'table-transfer', '1.0.0');
      await packageImport(ctx.config.baseUrl, ctx.repoName, readFileSync(zipPath), opts);
      await workspaceCreate(ctx.config.baseUrl, ctx.repoName, 'table-ws', opts);
      await workspaceDeploy(ctx.config.baseUrl, ctx.repoName, 'table-ws', 'table-transfer@1.0.0', opts);
      const path = [variant('field', 'inputs'), variant('field', 'rows')];
      const uploadUrl = `${ctx.config.baseUrl}/api/repos/${encodeURIComponent(ctx.repoName)}/workspaces/table-ws/datasets/inputs/rows/upload`;
      const RowsType = ArrayType(StructType({ id: IntegerType, name: StringType }));

      // A delivery encoded whole, over the inline limit: the store splits it
      // into its own segments, so the dataset is not the delivery's bytes.
      const text = incompressibleString(2_000_000);
      const data = encodeBeast2For(RowsType)(Array.from({ length: 50_000 }, (_, i) => ({ id: BigInt(i), name: text.slice(i * 40, i * 40 + 40) })));
      assert.ok(data.byteLength > 1024 * 1024, 'the delivery takes the transfer');
      const hash = computeHash(data);
      await datasetSetStream(ctx.config.baseUrl, ctx.repoName, 'table-ws', path, {
        size: data.byteLength,
        hash,
        slice: (start, end) => new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(data.slice(start, end));
            controller.close();
          },
        }),
      }, opts);
      const stored = (await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'table-ws', path, opts)).hash;
      assert.notDeepStrictEqual(stored, some(hash), 'the dataset is the manifest the delivery was split into');

      // Pointed elsewhere, then offered the same delivery again: the store
      // knows it by its hash, and asks for no bytes.
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'table-ws', path, encodeBeast2For(RowsType)([]), opts);
      const request = encodeBeast2For(TransferUploadRequestType)({ hash, size: BigInt(data.byteLength) });
      const init = success(await transferCall(`${uploadUrl}?protocol=${TRANSFER_PROTOCOL_VERSION}`, 'POST', TransferUploadResponseType, opts, request));
      assert.deepStrictEqual(init, variant('completed', null), 'no upload is planned');
      assert.deepStrictEqual((await datasetGetStatus(ctx.config.baseUrl, ctx.repoName, 'table-ws', path, opts)).hash, stored);
    });

    it('small dataset SET still uses inline PUT', async (t) => {
      const ctx = await withStringPackage(t);
      const opts = await ctx.opts();

      // Small payload — should use inline PUT (existing path)
      const encode = encodeBeast2For(StringType);
      const decode = decodeBeast2For(StringType);
      const data = encode('small value');

      const path = [variant('field', 'inputs'), variant('field', 'config')];
      await datasetSet(ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, data, opts);

      const { data: retrieved } = await datasetGet(
        ctx.config.baseUrl, ctx.repoName, 'transfer-ws', path, opts
      );
      assert.strictEqual(decode(retrieved), 'small value');
    });
  });
}
