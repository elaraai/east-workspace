/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { BooleanType, IntegerType, StringType, encodeBeast2For, variant } from '@elaraai/east';
import { LocalStorage, inputsHash, processOwner, repoInit, uuidv7 } from '@elaraai/e3-core';
import { startSessionDataServer } from './session-data-server.js';
import { socketRequest, socketStream } from './local-http.js';
import { LeaseOutcomeType, LeaseRunningType, SessionLogsType, SessionUploadType, VerifyOutputType, type SessionUpload } from '../protocol/session-data.js';
import { makeLeaseId, type RackLeaseRecord } from '../lease/lease-store.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'e3d-'));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const repo = join(home, 'repo');
  assert.equal(repoInit(repo).success, true);
  const storage = new LocalStorage();
  const logs: string[] = [];
  const options = { storage, repoPath: repo, home, dataToken: randomUUID(), onLog: (_id: string, _stream: string, data: string) => { logs.push(data); } };
  const data = await startSessionDataServer(options);
  cleanup.push(() => data.close());
  return { home, repo, storage, options, logs, data, auth: { bearer: options.dataToken } };
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function uploadUrl(id: string, info: SessionUpload) {
  return `/v1/uploads/${id}?${new URLSearchParams({ lease: info.leaseId, hash: info.hash, size: `${info.size}`, receipt: info.receipt })}`;
}

it('rejects an already-cancelled streamed upload without crashing the process', async () => {
  const { data, auth } = await setup();
  const bytes = Buffer.from('cancelled upload');
  const body = Readable.from([bytes]);
  const info: SessionUpload = { leaseId: 'lease', hash: digest(bytes), size: BigInt(bytes.length), receipt: randomUUID() };
  await assert.rejects(socketStream(data.socketPath, 'PUT', uploadUrl(randomUUID(), info), {
    ...auth, rawBody: body, signal: AbortSignal.abort(),
  }), { code: 'aborted' });
  await delay(0); // Allow asynchronous stream errors to reach the test runner.
  assert.equal(body.destroyed, true);
  const response = await socketStream(data.socketPath, 'HEAD', `/v1/objects/${info.hash}`, auth);
  response.resume();
  assert.equal(response.statusCode, 404);
});

it('streams large objects, verifies bytes before adoption and preserves an adopted inode on retries', async () => {
  const { data, auth, repo, storage } = await setup();
  const bytes = Buffer.alloc(9 * 1024 * 1024, 42);
  const hash = digest(bytes);
  const id = randomUUID();
  const info: SessionUpload = { leaseId: 'lease', hash, size: BigInt(bytes.length), receipt: randomUUID() };
  const upload = async (body: Buffer, path = uploadUrl(id, info)) => {
    const response = await socketStream(data.socketPath, 'PUT', path, { ...auth, rawBody: Readable.from((function* () {
      for (let at = 0; at < body.length; at += 65536) yield body.subarray(at, at + 65536);
    })()) });
    response.resume();
    return response;
  };
  const denied = await socketStream(data.socketPath, 'HEAD', `/v1/objects/${hash}`);
  denied.resume();
  assert.equal(denied.statusCode, 401);
  const wrong = Buffer.from(bytes); wrong[0] = 1;
  assert.equal((await upload(wrong)).statusCode, 400);
  const commit = (declaration = info) => socketRequest(data.socketPath, 'POST', `/v1/uploads/${id}/commit`, {
    ...auth, requestType: SessionUploadType, body: declaration, responseType: BooleanType,
  });
  assert.equal(await commit(), false);
  assert.equal(await storage.objects.exists(repo, hash), false);
  const accepted = await upload(bytes);
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.headers['x-amz-version-id'], info.receipt);
  assert.equal(await commit({ ...info, receipt: randomUUID() }), false);
  assert.equal(await commit({ ...info, leaseId: 'another' }), false);
  assert.equal(await commit({ ...info, size: info.size + 1n }), false);
  assert.equal(await commit(), true);
  assert.equal(await commit(), true);
  // A retry with a lost acknowledgment must not reopen the committed inode.
  assert.equal((await upload(wrong)).statusCode, 200);
  assert.equal(digest(await storage.objects.read(repo, hash)), hash);
  const response = await socketStream(data.socketPath, 'GET', `/v1/objects/${hash}`, auth);
  assert.equal(Number(response.headers['content-length']), bytes.length);
  const received = createHash('sha256');
  let size = 0;
  for await (const chunk of response) { received.update(chunk as Buffer); size += (chunk as Buffer).length; }
  assert.equal(size, bytes.length);
  assert.equal(received.digest('hex'), hash);
  assert.equal(await socketRequest(data.socketPath, 'DELETE', `/v1/uploads/${id}`, { ...auth, responseType: BooleanType }), true);
  assert.equal(await storage.objects.exists(repo, hash), true);
});

it('recovers an acknowledged upload in a successor session and refuses inline and size overflows', async () => {
  const { data, auth, options, storage, repo } = await setup();
  const bytes = encodeBeast2For(IntegerType)(42n);
  const id = randomUUID();
  const info: SessionUpload = { leaseId: 'lease', hash: digest(bytes), size: BigInt(bytes.length), receipt: randomUUID() };
  const response = await socketStream(data.socketPath, 'PUT', uploadUrl(id, info), { ...auth, rawBody: bytes });
  response.resume(); assert.equal(response.statusCode, 200);
  await data.close();
  const successor = await startSessionDataServer(options);
  cleanup.push(() => successor.close());
  assert.equal(await socketRequest(successor.socketPath, 'POST', `/v1/uploads/${id}/commit`, {
    ...auth, requestType: SessionUploadType, body: info, responseType: BooleanType,
  }), true);
  assert.equal(await storage.objects.exists(repo, info.hash), true);
  await assert.rejects(socketRequest(successor.socketPath, 'POST', '/v1/objects', {
    ...auth, rawBody: new Uint8Array(4097), responseType: StringType,
  }), /413/);
  const bad = await socketStream(successor.socketPath, 'PUT', uploadUrl(randomUUID(), { ...info, size: 1n << 100n }), { ...auth, rawBody: new Uint8Array() });
  bad.resume(); assert.equal(bad.statusCode, 400);
  const oversized = await socketStream(successor.socketPath, 'PUT', uploadUrl(randomUUID(), { ...info, size: 1n }), { ...auth, rawBody: bytes });
  oversized.resume(); assert.equal(oversized.statusCode, 400);
});

it('writes a claim-time attempt and flushes ordered logs before recording a verified outcome', async () => {
  const { data, auth, storage, repo, logs } = await setup();
  const taskHash = 'a'.repeat(64);
  const outputHash = await storage.objects.write(repo, encodeBeast2For(IntegerType)(42n));
  const executionId = uuidv7();
  const lease: RackLeaseRecord = {
    leaseId: makeLeaseId(taskHash, inputsHash([])), repo: 'opaque-alias', workspace: 'dev', taskHash, inputsHash: inputsHash([]),
    tier: 'node', status: 'claimed', createdAtMs: Date.now(), attempt: { executionId, startedAtMs: Date.now() },
    event: { version: 2, workspace: 'dev', taskName: 'task', closure: { hashes: [] }, runnerEvent: {
      mode: 'task', repo: 'opaque-alias', taskHash, launchId: 'launch', inputHashes: [], timeoutMs: 1000,
    } },
  };
  await socketRequest(data.socketPath, 'POST', '/v1/attempts/running', {
    ...auth, requestType: LeaseRunningType, body: { leaseJson: JSON.stringify(lease), owner: await processOwner() }, responseType: BooleanType,
  });
  assert.equal((await storage.refs.executionGet(repo, taskHash, lease.inputsHash, executionId))?.type, 'running');
  await socketRequest(data.socketPath, 'POST', '/v1/logs', { ...auth, requestType: SessionLogsType, responseType: BooleanType, body: {
    taskHash, inputsHash: lease.inputsHash, executionId, chunks: [{ stream: variant('stdout', null), data: 'one\n' }, { stream: variant('stdout', null), data: 'two\n' }],
  } });
  assert.deepEqual(logs, ['one\n', 'two\n']);
  assert.equal(await socketRequest(data.socketPath, 'POST', '/v1/verify', {
    ...auth, requestType: VerifyOutputType, body: { hash: 'b'.repeat(64) }, responseType: BooleanType,
  }), false);
  await socketRequest(data.socketPath, 'POST', '/v1/attempts/outcome', { ...auth, requestType: LeaseOutcomeType, responseType: BooleanType,
    body: { leaseJson: JSON.stringify(lease), resultJson: JSON.stringify({ taskName: 'task', status: 'success', outputHash }) },
  });
  assert.equal((await storage.refs.executionGet(repo, taskHash, lease.inputsHash, executionId))?.type, 'success');
  assert.equal((await storage.logs.read(repo, taskHash, lease.inputsHash, executionId, 'stdout')).data, 'one\ntwo\n');
});

it('keeps a successor upload when a predecessor PUT fails after takeover', async () => {
  const { data, auth, options, storage, repo } = await setup();
  const bytes = Buffer.alloc(1024, 42);
  const id = randomUUID();
  const info: SessionUpload = { leaseId: 'lease', hash: digest(bytes), size: BigInt(bytes.length), receipt: randomUUID() };
  const stream = new PassThrough();
  cleanup.push(async () => { stream.destroy(); });
  const predecessor = socketStream(data.socketPath, 'PUT', uploadUrl(id, info), { ...auth, rawBody: stream });
  stream.write(bytes.subarray(0, 512));
  // Wait until the first listener has opened its real staging file. Keep
  // that PUT in progress while another session takes the same upload over.
  const staging = join(repo, 'tmp', 'transfers');
  const deadline = Date.now() + 5000;
  for (;;) {
    const files = await readdir(staging).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    if (files.some((name) => name.startsWith('rack-'))) break;
    assert(Date.now() < deadline, 'predecessor never opened its staging file');
    await delay(10);
  }
  const successor = await startSessionDataServer(options);
  cleanup.push(() => successor.close());
  const response = await socketStream(successor.socketPath, 'PUT', uploadUrl(id, info), { ...auth, rawBody: bytes });
  response.resume(); assert.equal(response.statusCode, 200);
  // Its checksum failure must clean only its own file, not the successor's.
  stream.end(Buffer.alloc(512, 43));
  const failed = await predecessor; failed.resume(); assert.equal(failed.statusCode, 400);
  await data.close();
  assert.equal(await socketRequest(successor.socketPath, 'POST', `/v1/uploads/${id}/commit`, {
    ...auth, requestType: SessionUploadType, body: info, responseType: BooleanType,
  }), true);
  assert.deepEqual(new Uint8Array(await storage.objects.read(repo, info.hash)), new Uint8Array(bytes));
});
