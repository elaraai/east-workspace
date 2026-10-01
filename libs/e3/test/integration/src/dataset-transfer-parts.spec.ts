/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * How a server's byte endpoints keep an upload's parts honest: the local
 * server's, and e3 in a page's.
 *
 * The local server streams every part to its own offset in one staged file,
 * and e3-web stages each part whole in its own blob, so the server — not an
 * object store — is what keeps a part inside its range: on the local server a
 * part longer than its range would overwrite its neighbour, and on either a
 * part never sent leaves a hole the commit must refuse. Neither takes a part
 * once the commit is asked for, nor a request that carries credentials, as an
 * object store's presigned URL takes none. The shared compliance suite pins
 * what any server answers; these pin how each guards what it assembles.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createServer } from '@elaraai/e3-api-server';
import { createTestContext, createStringPackageZip, type TestContext } from '@elaraai/e3-api-tests';
import { datasetGetStatus, packageImport, workspaceCreate, workspaceDeploy } from '@elaraai/e3-api-client';
import { createWebE3, inProcessUnits } from '@elaraai/e3-web';
import { serveE3 } from '@elaraai/e3-web/worker';
import { StringType, decodeBeast2For, encodeBeast2For, some, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
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

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

const PART_BYTES = 64 * 1024;
const path = [variant('field', 'inputs'), variant('field', 'config')];

/** A server the cases run against. */
interface Target {
  /** Its API's URL */
  readonly baseUrl: string;
  /** The `fetch` that reaches it: the global one unless given */
  readonly fetch?: typeof globalThis.fetch;
  /** How its commit names an upload whose second part was never sent */
  readonly hole: RegExp;
  /** Stops it, and removes what it kept */
  stop(): Promise<void>;
}

/** Each server, with its parts as small as the cases need, and a commit
 *  answered `processing` at once. */
const servers: ReadonlyArray<{ readonly name: string; start(): Promise<Target> }> = [
  {
    name: 'the local server',
    start: async () => {
      const parentDir = mkdtempSync(join(tmpdir(), 'e3-transfer-parts-'));
      const server = await createServer({
        reposDir: parentDir,
        port: 0,
        host: 'localhost',
        transferPartBytes: PART_BYTES,
        transferCommitWaitMs: 0,
      });
      await server.start();
      return {
        baseUrl: `http://localhost:${server.port}`,
        // The hole is zeros in the file it assembles in place, so the bytes
        // hash to another value.
        hole: /hash mismatch/,
        stop: async () => {
          await server.stop();
          rmSync(parentDir, { recursive: true, force: true });
        },
      };
    },
  },
  {
    name: 'e3 in a page',
    start: async () => {
      const { port1, port2 } = new MessageChannel();
      serveE3({ units: inProcessUnits(), persist: false, transferPartBytes: PART_BYTES, transferCommitWaitMs: 0 }, port1);
      const e3 = await createWebE3(port2);
      return {
        baseUrl: e3.apiUrl,
        fetch: e3.fetch,
        // Each part is its own blob, so the one missing is named.
        hole: /part 2 of \d+ was not sent/,
        stop: () => {
          e3.close();
          return Promise.resolve();
        },
      };
    },
  },
];

/** A string value whose beast2 encoding stays several parts long after deflate. */
function encodedDelivery(): Uint8Array {
  const text = Array.from(randomBytes(240_000), (b) => String.fromCharCode(33 + (b % 94))).join('');
  return encodeBeast2For(StringType)(text);
}

/** A fresh repository with the string package deployed to `ws`. */
async function deployed(target: Target, t: { after(fn: () => Promise<void>): void }): Promise<TestContext> {
  // The servers have no auth, so a reader's token is the admin's: none
  const ctx = await createTestContext({
    baseUrl: target.baseUrl,
    getToken: async () => '',
    getReaderToken: async () => '',
    cleanup: true,
    ...(target.fetch !== undefined && { fetch: target.fetch, commands: false }),
  });
  t.after(() => ctx.cleanup());
  const zip = await createStringPackageZip(ctx.tempDir, 'parts-pkg', '1.0.0');
  await packageImport(target.baseUrl, ctx.repoName, readFileSync(zip), await ctx.opts());
  await workspaceCreate(target.baseUrl, ctx.repoName, 'ws', await ctx.opts());
  await workspaceDeploy(target.baseUrl, ctx.repoName, 'ws', 'parts-pkg@1.0.0', await ctx.opts());
  return ctx;
}

/** One transfer API call, with its response envelope decoded. */
async function call<T extends EastType>(ctx: TestContext, url: string, method: 'GET' | 'POST', type: T, body?: Uint8Array) {
  const response = await ctx.fetch(url, { method, ...(body ? { body, headers: { 'Content-Type': BEAST2_CONTENT_TYPE } } : {}) });
  assert.ok(response.ok, `${method} ${url}: ${response.status}`);
  return decodeBeast2For(ResponseType(type))(new Uint8Array(await response.arrayBuffer())) as
    { type: 'success'; value: ValueTypeOf<T> } | { type: 'error'; value: unknown };
}

/** Start an upload of `data` and return its id, plan and part URL getter. */
async function startUpload(ctx: TestContext, data: Uint8Array) {
  const uploadUrl = `${ctx.config.baseUrl}/api/repos/${ctx.repoName}/workspaces/ws/datasets/inputs/config/upload`;
  const request = encodeBeast2For(TransferUploadRequestType)({ hash: sha256(data), size: BigInt(data.byteLength) });
  const init = await call(ctx, `${uploadUrl}?protocol=${TRANSFER_PROTOCOL_VERSION}`, 'POST', TransferUploadResponseType, request);
  assert.ok(init.type === 'success' && init.value.type === 'upload_parts', 'an upload is planned as parts');
  const { id, partBytes } = init.value.value;
  const count = transferPartCount(data.byteLength, partBytes);
  assert.ok(count >= 3, `the delivery spans at least three parts, got ${count}`);
  const partUrl = async (part: number): Promise<string> => {
    const target = await call(ctx, `${uploadUrl}/${id}/parts/${part}`, 'GET', TransferPartResponseType);
    assert.ok(target.type === 'success');
    return target.value.url;
  };
  const put = async (part: number, body: Uint8Array, headers?: Record<string, string>) =>
    ctx.fetch(await partUrl(part), { method: 'PUT', body, ...(headers !== undefined && { headers }) });
  const commit = async () => {
    let done = await call(ctx, `${uploadUrl}/${id}?protocol=${TRANSFER_PROTOCOL_VERSION}`, 'POST', TransferDoneResponseType);
    for (let polls = 0; done.type === 'success' && done.value.type === 'processing' && polls < 600; polls++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      done = await call(ctx, `${uploadUrl}/${id}`, 'GET', TransferDoneResponseType);
    }
    return done;
  };
  return { id, partBytes, count, partUrl, put, commit, uploadUrl };
}

for (const server of servers) {
  describe(`dataset transfer parts on ${server.name}`, { concurrency: false }, () => {
    let target: Target | undefined;

    before(async () => {
      target = await server.start();
    });

    after(async () => {
      await target?.stop();
    });

    it('refuses a part longer than its range without touching the part after it', async (t) => {
      const ctx = await deployed(target!, t);
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
      const status = await datasetGetStatus(target!.baseUrl, ctx.repoName, 'ws', path, await ctx.opts());
      assert.deepEqual(status.hash, some(sha256(data)));
    });

    it('refuses a part shorter than its range', async (t) => {
      const ctx = await deployed(target!, t);
      const data = encodedDelivery();
      const upload = await startUpload(ctx, data);
      const { start, end } = transferPartRange(data.byteLength, upload.partBytes, 2)!;
      const refused = await upload.put(2, data.subarray(start, end - 1));
      assert.equal(refused.status, 400);
      assert.match(await refused.text(), new RegExp(`part 2 is ${end - start} bytes, got ${end - start - 1}`));
    });

    it('refuses a part sent once the commit has been asked for, which would rewrite the bytes it verifies', async (t) => {
      const ctx = await deployed(target!, t);
      const data = encodedDelivery();
      const upload = await startUpload(ctx, data);
      for (let part = 1; part <= upload.count; part++) {
        const { start, end } = transferPartRange(data.byteLength, upload.partBytes, part)!;
        assert.equal((await upload.put(part, data.subarray(start, end))).status, 200);
      }
      // Where part 1 goes, asked for while the upload still takes parts.
      const url = await upload.partUrl(1);

      // The server answers a commit `processing` at once (its commit wait is 0).
      const asked = await call(ctx, `${upload.uploadUrl}/${upload.id}?protocol=${TRANSFER_PROTOCOL_VERSION}`, 'POST', TransferDoneResponseType);
      assert.equal(asked.type, 'success');
      const first = transferPartRange(data.byteLength, upload.partBytes, 1)!;
      const late = await ctx.fetch(url, { method: 'PUT', body: data.subarray(first.start, first.end) });
      assert.equal(late.status, 409);
      assert.equal(await late.text(), 'the upload is committed: it takes no more parts');

      const done = await upload.commit();
      assert.ok(done.type === 'success' && done.value.type === 'completed', 'the upload lands as its parts were sent');
      const status = await datasetGetStatus(target!.baseUrl, ctx.repoName, 'ws', path, await ctx.opts());
      assert.deepEqual(status.hash, some(sha256(data)));
    });

    it('does not land an upload with a part never sent', async (t) => {
      const ctx = await deployed(target!, t);
      const before = await datasetGetStatus(target!.baseUrl, ctx.repoName, 'ws', path, await ctx.opts());
      const data = encodedDelivery();
      const upload = await startUpload(ctx, data);
      for (let part = 1; part <= upload.count; part++) {
        if (part === 2) continue;
        const { start, end } = transferPartRange(data.byteLength, upload.partBytes, part)!;
        assert.equal((await upload.put(part, data.subarray(start, end))).status, 200);
      }

      const done = await upload.commit();
      assert.ok(done.type === 'success' && done.value.type === 'error', 'the commit refuses the hole');
      assert.match(done.value.value.message, target!.hole);
      const after = await datasetGetStatus(target!.baseUrl, ctx.repoName, 'ws', path, await ctx.opts());
      assert.deepEqual(after.hash, before.hash, 'the dataset keeps its value');
    });

    it('refuses a part sent with credentials, as a presigned URL does, and takes one with an empty Authorization header', async (t) => {
      const ctx = await deployed(target!, t);
      const data = encodedDelivery();
      const upload = await startUpload(ctx, data);
      const { start, end } = transferPartRange(data.byteLength, upload.partBytes, 1)!;
      const refused = await upload.put(1, data.subarray(start, end), { Authorization: 'Bearer a-token' });
      assert.equal(refused.status, 400);
      assert.equal(await refused.text(), 'Authorization header must not be sent to data endpoints');
      assert.equal((await upload.put(1, data.subarray(start, end), { Authorization: '' })).status, 200, 'an empty header carries no credentials');
    });
  });
}
