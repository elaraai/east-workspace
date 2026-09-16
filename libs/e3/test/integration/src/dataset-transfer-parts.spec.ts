/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * How the local server keeps a protocol-2 upload's parts honest.
 *
 * Every part streams to its own offset in one staged file, so this server —
 * not an object store — is what keeps a part inside its range: a part longer
 * than its range would overwrite its neighbour, and a part never sent leaves a
 * hole the commit must refuse. The shared compliance suite pins what any server
 * answers; these pin how this one guards the file it assembles in place.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createServer, type Server } from '@elaraai/e3-api-server';
import { createTestContext, createStringPackageZip, type TestContext } from '@elaraai/e3-api-tests';
import { datasetGetStatus, packageImport, workspaceCreate, workspaceDeploy } from '@elaraai/e3-api-client';
import { StringType, decodeBeast2For, encodeBeast2For, some, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import {
  BEAST2_CONTENT_TYPE,
  ResponseType,
  TransferDoneResponseType,
  TransferPartResponseType,
  TransferUploadRequestType,
  TransferUploadResponseType,
  transferPartCount,
  transferPartRange,
} from '@elaraai/e3-types';

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

const PART_BYTES = 64 * 1024;
const path = [variant('field', 'inputs'), variant('field', 'config')];

let server: Server;
let parentDir: string;
let baseUrl: string;

/** A string value whose beast2 encoding stays several parts long after deflate. */
function encodedDelivery(): Uint8Array {
  const text = Array.from(randomBytes(240_000), (b) => String.fromCharCode(33 + (b % 94))).join('');
  return encodeBeast2For(StringType)(text);
}

/** A fresh repository with the string package deployed to `ws`. */
async function deployed(t: { after(fn: () => Promise<void>): void }): Promise<TestContext> {
  const ctx = await createTestContext({ baseUrl, getToken: async () => '', cleanup: true });
  t.after(() => ctx.cleanup());
  const zip = await createStringPackageZip(ctx.tempDir, 'parts-pkg', '1.0.0');
  await packageImport(baseUrl, ctx.repoName, readFileSync(zip), { token: '' });
  await workspaceCreate(baseUrl, ctx.repoName, 'ws', { token: '' });
  await workspaceDeploy(baseUrl, ctx.repoName, 'ws', 'parts-pkg@1.0.0', { token: '' });
  return ctx;
}

/** One transfer API call, with its response envelope decoded. */
async function call<T extends EastType>(url: string, method: 'GET' | 'POST', type: T, body?: Uint8Array) {
  const response = await fetch(url, { method, ...(body ? { body, headers: { 'Content-Type': BEAST2_CONTENT_TYPE } } : {}) });
  assert.ok(response.ok, `${method} ${url}: ${response.status}`);
  return decodeBeast2For(ResponseType(type))(new Uint8Array(await response.arrayBuffer())) as
    { type: 'success'; value: ValueTypeOf<T> } | { type: 'error'; value: unknown };
}

/** Start a protocol-2 upload of `data` and return its id, plan and part URL getter. */
async function startUpload(ctx: TestContext, data: Uint8Array) {
  const uploadUrl = `${baseUrl}/api/repos/${ctx.repoName}/workspaces/ws/datasets/inputs/config/upload`;
  const request = encodeBeast2For(TransferUploadRequestType)({ hash: sha256(data), size: BigInt(data.byteLength) });
  const init = await call(`${uploadUrl}?protocol=2`, 'POST', TransferUploadResponseType, request);
  assert.ok(init.type === 'success' && init.value.type === 'upload_parts', 'a protocol-2 upload is planned as parts');
  const { id, partBytes } = init.value.value;
  const count = transferPartCount(data.byteLength, partBytes);
  assert.ok(count >= 3, `the delivery spans at least three parts, got ${count}`);
  const partUrl = async (part: number): Promise<string> => {
    const target = await call(`${uploadUrl}/${id}/parts/${part}`, 'GET', TransferPartResponseType);
    assert.ok(target.type === 'success');
    return target.value.url;
  };
  const put = async (part: number, body: Uint8Array) =>
    fetch(await partUrl(part), { method: 'PUT', body });
  const commit = async () => {
    let done = await call(`${uploadUrl}/${id}?protocol=2`, 'POST', TransferDoneResponseType);
    for (let polls = 0; done.type === 'success' && done.value.type === 'processing' && polls < 600; polls++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      done = await call(`${uploadUrl}/${id}`, 'GET', TransferDoneResponseType);
    }
    return done;
  };
  return { id, partBytes, count, put, commit, uploadUrl };
}

describe('dataset transfer parts on the local server', { concurrency: false }, () => {
  before(async () => {
    parentDir = mkdtempSync(join(tmpdir(), 'e3-transfer-parts-'));
    server = await createServer({
      reposDir: parentDir,
      port: 0,
      host: 'localhost',
      transferPartBytes: PART_BYTES,
      transferCommitWaitMs: 0,
    });
    await server.start();
    baseUrl = `http://localhost:${server.port}`;
  });

  after(async () => {
    await server?.stop();
    rmSync(parentDir, { recursive: true, force: true });
  });

  it('refuses a part longer than its range without touching the part after it', async (t) => {
    const ctx = await deployed(t);
    const data = encodedDelivery();
    const upload = await startUpload(ctx, data);
    for (let part = 1; part <= upload.count; part++) {
      const { start, end } = transferPartRange(data.byteLength, upload.partBytes, part)!;
      assert.equal((await upload.put(part, data.subarray(start, end))).status, 200);
    }

    // Part 1 again, one byte too long — and that byte is NOT part 2's first
    // byte, so had it been written the commit's hash check would fail.
    const { end } = transferPartRange(data.byteLength, upload.partBytes, 1)!;
    const tooLong = new Uint8Array(end + 1);
    tooLong.set(data.subarray(0, end));
    tooLong[end] = data[end]! ^ 0xff;
    const refused = await upload.put(1, tooLong);
    assert.equal(refused.status, 400);
    assert.match(await refused.text(), /part 1 is \d+ bytes, and more were sent/);

    const done = await upload.commit();
    assert.ok(done.type === 'success' && done.value.type === 'completed', 'the upload lands whole');
    const status = await datasetGetStatus(baseUrl, ctx.repoName, 'ws', path, { token: '' });
    assert.deepEqual(status.hash, some(sha256(data)));
  });

  it('refuses a part shorter than its range', async (t) => {
    const ctx = await deployed(t);
    const data = encodedDelivery();
    const upload = await startUpload(ctx, data);
    const { start, end } = transferPartRange(data.byteLength, upload.partBytes, 2)!;
    const refused = await upload.put(2, data.subarray(start, end - 1));
    assert.equal(refused.status, 400);
    assert.match(await refused.text(), new RegExp(`part 2 is ${end - start} bytes, got ${end - start - 1}`));
  });

  it('does not land an upload with a part never sent', async (t) => {
    const ctx = await deployed(t);
    const before = await datasetGetStatus(baseUrl, ctx.repoName, 'ws', path, { token: '' });
    const data = encodedDelivery();
    const upload = await startUpload(ctx, data);
    for (let part = 1; part <= upload.count; part++) {
      if (part === 2) continue;
      const { start, end } = transferPartRange(data.byteLength, upload.partBytes, part)!;
      assert.equal((await upload.put(part, data.subarray(start, end))).status, 200);
    }

    const done = await upload.commit();
    assert.ok(done.type === 'success' && done.value.type === 'error', 'the commit refuses the hole');
    assert.match(done.value.value.message, /hash mismatch/);
    const after = await datasetGetStatus(baseUrl, ctx.repoName, 'ws', path, { token: '' });
    assert.deepEqual(after.hash, before.hash, 'the dataset keeps its value');
  });

  it('has no part URL for an upload a protocol-1 client started', async (t) => {
    const ctx = await deployed(t);
    const data = encodedDelivery();
    const uploadUrl = `${baseUrl}/api/repos/${ctx.repoName}/workspaces/ws/datasets/inputs/config/upload`;
    const request = encodeBeast2For(TransferUploadRequestType)({ hash: sha256(data), size: BigInt(data.byteLength) });
    const init = await call(uploadUrl, 'POST', TransferUploadResponseType, request);
    assert.ok(init.type === 'success' && init.value.type === 'upload');
    const { id } = init.value.value;

    const target = await call(`${uploadUrl}/${id}/parts/1`, 'GET', TransferPartResponseType);
    assert.equal(target.type, 'error');
    const put = await fetch(`${baseUrl}/api/uploads/${id}/parts/1`, { method: 'PUT', body: data });
    assert.equal(put.status, 404);
  });
});
