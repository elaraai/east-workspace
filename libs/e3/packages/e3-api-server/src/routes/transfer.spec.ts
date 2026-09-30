/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * The dataset transfer routes: an init answers at once, and takes nothing in.
 * A collection the store holds whole, which the adoption memo does not name, is
 * taken in by the upload's commit, where commits run.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { ArrayType, IntegerType, decodeBeast2For, encodeBeast2For, encodeBeast2PagedFor, none, some, toEastTypeValue, variant } from '@elaraai/east';
import {
  InMemoryTransferBackend, LocalStorage, MockTaskRunner, datasetWrite, storeDatasetBytes, storeDatasetFile, type IntakeSpec,
} from '@elaraai/e3-core';
import { createTestRepo, removeTestRepo } from '@elaraai/e3-core/test';
import {
  BEAST2_CONTENT_TYPE, E3_RELEASE, PackageObjectType, TRANSFER_PROTOCOL_VERSION, WorkspaceRecordType, transferPartCount,
} from '@elaraai/e3-types';
import { createDataEndpoints } from './data.js';
import { createTransferRoutes } from './transfer.js';
import {
  ResponseType, TransferDoneResponseType, TransferPartResponseType, TransferUploadRequestType, TransferUploadResponseType,
} from '../types.js';

const RowsType = ArrayType(IntegerType);

describe('dataset transfer routes', () => {
  it('answer an init whose bytes the store holds whole as a collection at once, taking nothing in, and take the delivery in at its commit', async (t) => {
    const repo = createTestRepo();
    t.after(() => removeTestRepo(repo));
    const storage = new LocalStorage();
    // A workspace whose one input is a collection.
    const pkg = await storage.objects.write(repo, encodeBeast2For(PackageObjectType)({
      tasks: new Map(),
      data: {
        structure: variant('struct', new Map([['inputs', variant('struct', new Map([
          ['rows', variant('value', { type: toEastTypeValue(RowsType), writable: true })],
        ]))]])),
        refs: new Map([['inputs/rows', variant('unassigned', null)]]),
      },
      functions: new Map(), records: new Map(), sources: new Map(),
    }));
    await storage.refs.workspaceWrite(repo, 'ws', encodeBeast2For(WorkspaceRecordType)(some({
      packageName: 'rows', packageVersion: '1.0.0', packageHash: pkg, deployedAt: new Date(), currentRunId: none,
    })));
    await storage.datasets.write(repo, 'ws', 'inputs/rows', variant('unassigned', null));

    // The delivery's bytes are in the store whole, as an object, and the memo
    // names nothing for them: as a store that stages an upload as an object
    // leaves them while that object's intake runs, or after it failed.
    const values = Array.from({ length: 5_000 }, (_, i) => BigInt(i));
    const delivery = encodeBeast2PagedFor(RowsType)(values);
    const hash = await storage.objects.write(repo, delivery);

    // A runner's intake, which stores the delivery's rows as the Writer writes
    // them: through the store's door.
    const intakes: IntakeSpec[] = [];
    const runner = new MockTaskRunner();
    runner.setIntakeResult(async (store, spec) => {
      intakes.push(spec);
      const stored = 'file' in spec.source
        ? await storeDatasetFile(store, repo, spec.source.file)
        : await storeDatasetBytes(store, repo, await store.objects.read(repo, spec.source.object));
      return { hash: stored, runner: 'test' };
    });
    const transferBackend = new InMemoryTransferBackend({ baseUrl: 'http://server', storage, getRepoPath: () => repo, getRunner: () => runner });
    const app = new Hono();
    app.route('/api/uploads', createDataEndpoints(transferBackend, storage, () => repo).uploads);
    app.route('/api/repos/:repo/workspaces/:ws/datasets', createTransferRoutes(storage, () => repo, transferBackend).api);
    const protocol = `protocol=${TRANSFER_PROTOCOL_VERSION}&release=${E3_RELEASE}`;
    const at = '/api/repos/r/workspaces/ws/datasets/inputs/rows/upload';

    const init = await app.request(`${at}?${protocol}`, {
      method: 'POST',
      headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
      body: encodeBeast2For(TransferUploadRequestType)({ hash, size: BigInt(delivery.byteLength) }),
    });
    const planned = decodeBeast2For(ResponseType(TransferUploadResponseType))(new Uint8Array(await init.arrayBuffer()));
    if (planned.type !== 'success' || planned.value.type !== 'upload_parts') assert.fail(`the init answered ${JSON.stringify(planned.type)}, not a plan`);
    assert.deepEqual(intakes, [], 'the init took nothing in');
    assert.equal((await storage.datasets.read(repo, 'ws', 'inputs/rows'))?.type, 'unassigned');

    // The client sends its bytes, and commits.
    const { id, partBytes } = planned.value.value;
    for (let part = 1; part <= transferPartCount(BigInt(delivery.byteLength), partBytes); part++) {
      const target = decodeBeast2For(ResponseType(TransferPartResponseType))(new Uint8Array(await (await app.request(`${at}/${id}/parts/${part}`)).arrayBuffer()));
      if (target.type !== 'success') assert.fail('no part target');
      const from = Number(partBytes) * (part - 1);
      const sent = await app.request(target.value.url, { method: 'PUT', body: delivery.subarray(from, Math.min(delivery.byteLength, from + Number(partBytes))) });
      assert.equal(sent.status, 200);
    }
    const committed = decodeBeast2For(ResponseType(TransferDoneResponseType))(new Uint8Array(await (await app.request(`${at}/${id}?${protocol}`, { method: 'POST' })).arrayBuffer()));
    assert.deepEqual(committed, variant('success', variant('completed', null)));

    assert.ok(intakes.length > 0, 'the commit took the delivery in');
    const ref = await storage.datasets.read(repo, 'ws', 'inputs/rows');
    assert.ok(ref?.type === 'value' && ref.value.hash === await datasetWrite(storage, repo, values, RowsType), 'as the value path stores its value');
  });
});
