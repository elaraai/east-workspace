/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The load routes (§7.11): who may load, through the host's seam (R86), and a
 * load launched, polled to its end and asked to cancel over them. The suites
 * of e3-api-tests run loads of real packages over every backend; these cases
 * are the host's rule, and the routes' own plumbing.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { decodeBeast2For, encodeBeast2For, none } from '@elaraai/east';
import { InMemoryTransferBackend, MockTaskRunner } from '@elaraai/e3-core';
import { InMemoryStorage } from '@elaraai/e3-core/test';
import { BEAST2_CONTENT_TYPE, E3_RELEASE, RecordLoadRequestType, RecordLoadStatusType, TRANSFER_PROTOCOL_VERSION } from '@elaraai/e3-types';
import {
  ResponseType, PackageJobResponseType, TransferDoneResponseType, TransferPartResponseType, TransferUploadRequestType, TransferUploadResponseType,
} from '../types.js';
import { createObjectUploadRoutes, createRecordLoadRoutes, type LoadAccess, type LoadAction } from './record-loads.js';

const REPO = 'r';
const WS = 'main';

const decodeJob = decodeBeast2For(ResponseType(PackageJobResponseType));
const decodeStatus = decodeBeast2For(ResponseType(RecordLoadStatusType));
const decodeUpload = decodeBeast2For(ResponseType(TransferUploadResponseType));
const decodePart = decodeBeast2For(ResponseType(TransferPartResponseType));
const decodeDone = decodeBeast2For(ResponseType(TransferDoneResponseType));
const encodeRequest = encodeBeast2For(RecordLoadRequestType);
const encodeUpload = encodeBeast2For(TransferUploadRequestType);

describe('the load routes', () => {
  let storage: InMemoryStorage;
  let delivery: string;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    await storage.repos.create(REPO);
    delivery = await storage.objects.write(REPO, Uint8Array.of(1, 2, 3));
  });

  /** The routes under a host's rule, every action it is asked kept. */
  const serve = (access: LoadAccess) => {
    const asked: LoadAction[] = [];
    const transfer = new InMemoryTransferBackend({ storage, getRepoPath: () => REPO, getRunner: () => new MockTaskRunner() });
    const app = new Hono();
    const rule: LoadAccess = (c, action) => {
      asked.push(action);
      return access(c, action);
    };
    app.route('/api/repos/:repo/workspaces/:ws/records', createRecordLoadRoutes(transfer, { access: rule }));
    app.route('/api/repos/:repo/workspaces/:ws/objects', createObjectUploadRoutes(storage, () => REPO, transfer, { access: rule }));
    return { app, asked };
  };
  const post = (app: Hono, path: string, body: Uint8Array) =>
    app.request(path, { method: 'POST', headers: { 'Content-Type': BEAST2_CONTENT_TYPE }, body });
  const bytes = async (response: Response): Promise<Uint8Array> => new Uint8Array(await response.arrayBuffer());
  const LOADS = `/api/repos/${REPO}/workspaces/${WS}/records/orders/loads/erp`;
  const OBJECTS = `/api/repos/${REPO}/workspaces/${WS}/objects?protocol=${TRANSFER_PROTOCOL_VERSION}&release=${E3_RELEASE}`;
  /** An upload's own routes, by its id. */
  const UPLOAD = (id: string): string => `/api/repos/${REPO}/workspaces/${WS}/objects/upload/${id}`;

  it('R86 — a caller the host does not grant a load is refused permission_denied, naming the load, and the host is asked what each caller asks to do', async () => {
    const { app, asked } = serve(() => false);
    const launched = decodeJob(await bytes(await post(app, LOADS, encodeRequest({ delivery, actor: none, asOf: none }))));
    assert.ok(launched.type === 'error' && launched.value.type === 'permission_denied' && launched.value.value.path === 'orders.erp',
      `the launch is refused: ${launched.type}`);
    const cancelled = decodeStatus(await bytes(await post(app, `${LOADS}/${globalThis.crypto.randomUUID()}/cancel`, new Uint8Array())));
    assert.ok(cancelled.type === 'error' && cancelled.value.type === 'permission_denied' && cancelled.value.value.path === 'orders.erp');
    const upload = decodeUpload(await bytes(await post(app, OBJECTS, encodeUpload({ hash: delivery, size: 3n }))));
    assert.ok(upload.type === 'error' && upload.value.type === 'permission_denied' && upload.value.value.path === 'upload');
    assert.deepEqual(asked.map((action) => 'record' in action ? `${action.kind} ${action.record}.${action.source}` : action.kind),
      ['load orders.erp', 'cancel orders.erp', 'upload']);
  });

  it('R86, ruling 36 — a read is asked of the host as a write is: a load\'s status, where an upload\'s part goes, and its commit and poll are refused a caller it does not grant', async () => {
    const { app, asked } = serve(() => false);
    const id = globalThis.crypto.randomUUID();
    const status = decodeStatus(await bytes(await app.request(`${LOADS}/${id}`)));
    assert.ok(status.type === 'error' && status.value.type === 'permission_denied' && status.value.value.path === 'orders.erp',
      `a load's status is refused: ${status.type}`);
    const part = decodePart(await bytes(await app.request(`${UPLOAD(id)}/parts/1`)));
    assert.ok(part.type === 'error' && part.value.type === 'permission_denied' && part.value.value.path === 'upload');
    const commit = decodeDone(await bytes(await post(app, `${UPLOAD(id)}?protocol=${TRANSFER_PROTOCOL_VERSION}&release=${E3_RELEASE}`, new Uint8Array())));
    assert.ok(commit.type === 'error' && commit.value.type === 'permission_denied' && commit.value.value.path === 'upload');
    const poll = decodeDone(await bytes(await app.request(UPLOAD(id))));
    assert.ok(poll.type === 'error' && poll.value.type === 'permission_denied' && poll.value.value.path === 'upload');
    assert.deepEqual(asked.map((action) => 'record' in action ? `${action.kind} ${action.record}.${action.source}` : action.kind),
      ['read orders.erp', 'upload', 'upload', 'upload']);
  });

  it('a rule that throws is answered as any error is, in each route\'s own type: no request ends in an untyped 500', async () => {
    const { app } = serve(() => { throw new Error('the roles could not be read'); });
    const id = globalThis.crypto.randomUUID();
    const answers = [
      decodeStatus(await bytes(await app.request(`${LOADS}/${id}`))),
      decodePart(await bytes(await app.request(`${UPLOAD(id)}/parts/1`))),
      decodeDone(await bytes(await post(app, `${UPLOAD(id)}?protocol=${TRANSFER_PROTOCOL_VERSION}&release=${E3_RELEASE}`, new Uint8Array()))),
      decodeDone(await bytes(await app.request(UPLOAD(id)))),
    ];
    for (const answer of answers) {
      assert.ok(answer.type === 'error' && answer.value.type === 'internal' && answer.value.value.message.includes('the roles could not be read'),
        `answered ${answer.type}`);
    }
  });

  it('a load launched is polled to its end, and a cancel after its end is answered as it ended; a poll from another workspace finds none', async () => {
    const { app } = serve(() => true);
    // The store holds the delivery already: its upload's init says nothing need be sent
    const init = decodeUpload(await bytes(await post(app, OBJECTS, encodeUpload({ hash: delivery, size: 3n }))));
    assert.ok(init.type === 'success' && init.value.type === 'completed', 'an object the store holds is not sent again');

    // The workspace holds no record: the job is filed, and ends saying so
    const launched = decodeJob(await bytes(await post(app, LOADS, encodeRequest({ delivery, actor: none, asOf: none }))));
    if (launched.type !== 'success') assert.fail(`the launch failed: ${launched.value.type}`);
    const id = launched.value.id;
    let status = decodeStatus(await bytes(await app.request(`${LOADS}/${id}`)));
    while (status.type === 'success' && status.value.type === 'processing') {
      await new Promise((resolve) => setTimeout(resolve, 20));
      status = decodeStatus(await bytes(await app.request(`${LOADS}/${id}`)));
    }
    assert.ok(status.type === 'success' && status.value.type === 'failed', 'the job ended, failed');
    const late = decodeStatus(await bytes(await post(app, `${LOADS}/${id}/cancel`, new Uint8Array())));
    assert.ok(late.type === 'success' && late.value.type === 'failed', 'a cancel after its end is answered as it ended');
    const elsewhere = decodeStatus(await bytes(await app.request(`/api/repos/${REPO}/workspaces/other/records/orders/loads/erp/${id}`)));
    assert.ok(elsewhere.type === 'error' && elsewhere.value.type === 'internal');
  });
});
