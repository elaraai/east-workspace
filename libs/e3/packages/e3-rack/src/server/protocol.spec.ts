/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from 'node:http';
import { once } from 'node:events';
import { createAdaptorServer } from '@hono/node-server';
import { LocalStorage, processOwner, repoInit } from '@elaraai/e3-core';
import { InMemoryMachineIdentityStore, generateEnrollmentToken, InMemoryRackRegistry,
  InMemoryRackLeaseStore, InMemoryLeaseCoordinator, StoreRackDispatch, createRackRoutes } from '@elaraai/e3-rack';
import { InMemoryRackStorageBridge, RecordingLogStore, rackProtocolSuite } from '@elaraai/e3-rack/testing';
import { sessionAttempts } from '../client/session-attempts.js';

rackProtocolSuite('memory dispatch, real repository', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'e3-contract-'));
  let server: Server | undefined;
  const teardown = async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => {
      server!.close((error) => error ? reject(error) : resolve()); server!.closeAllConnections();
    });
    await rm(repo, { recursive: true, force: true });
  };
  try {
    assert(repoInit(repo).success);
    let time = Date.now(); const now = () => time;
    const storage = new LocalStorage(); const identities = new InMemoryMachineIdentityStore();
    const registry = new InMemoryRackRegistry(); const leases = new InMemoryRackLeaseStore(now);
    const bridge = new InMemoryRackStorageBridge(storage, leases); const logs = new RecordingLogStore();
    const owner = await processOwner(); const attempts = { ...sessionAttempts(storage, repo, () => owner), logs };
    const coordinator = new InMemoryLeaseCoordinator();
    const dispatch = new StoreRackDispatch(leases, registry, { now, coordinator, endings: { stopped: attempts.stopped, writes: bridge } });
    const app = createRackRoutes(identities, registry, leases, bridge, attempts, { now, coordinator, leaseWindowMs: 20, pollIntervalMs: 5 });
    const listener = createAdaptorServer({ fetch: app.fetch }); assert(listener instanceof Server); server = listener;
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert(address && typeof address !== 'string');
    const transport: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith('mem://')) return fetch(input, init);
      const request = new Request(input, init);
      if (request.method === 'PUT') {
        const result = bridge.put(url, new Uint8Array(await request.arrayBuffer()), Object.fromEntries(request.headers));
        return 'refused' in result ? new Response(result.refused, { status: 400 }) : new Response(null, { headers: { 'x-amz-version-id': result.version } });
      }
      const bytes = await bridge.fetch(url);
      return bytes === null ? new Response(null, { status: 404 }) : new Response(bytes);
    };
    return { repo, baseUrl: `http://127.0.0.1:${address.port}`, fetch: transport, dispatch,
      async mintEnrollmentToken() {
        const token = generateEnrollmentToken(); await identities.putEnrollmentToken(token.tokenHash, new Date(time + 60000)); return token.token;
      },
      seedObject: (repo, bytes) => storage.objects.write(repo, bytes),
      readObject: async (repo, hash) => await storage.objects.exists(repo, hash) ? storage.objects.read(repo, hash) : null,
      readLog: async (repo, taskHash, inputsHash, executionId, stream) => logs.entries.filter((entry) =>
        entry.repo === repo && entry.taskHash === taskHash && entry.inputsHash === inputsHash && entry.executionId === executionId && entry.stream === stream).map((entry) => entry.data).join(''),
      advanceClock: (ms) => { time += ms; }, teardown,
    };
  } catch (error) { await teardown(); throw error; }
});
