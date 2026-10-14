/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Hono } from 'hono';
import { ArrayType, BooleanType, StringType, decodeBeast2For, encodeBeast2For, equalFor } from '@elaraai/east';
import { atomicWriteFile, isObjectHash, transferStagingPath, touchReachable, type StorageBackend } from '@elaraai/e3-core';
import type { ExecutionOwner } from '@elaraai/e3-types';
import { decodeBody, sendSuccess } from '@elaraai/e3-api-server/beast2';
import { ensureRackHome, rackHome, sessionSocketPath } from '../paths.js';
import { InMemoryLeaseCoordinator } from '../lease/coordinator.js';
import type { RackLeaseRecord } from '../lease/lease-store.js';
import { isLeaseEventV2, type RackLeaseResult } from '../protocol/task-envelope.js';
import { LeaseDataType, LeaseOutcomeType, LeaseRunningType, LeaseStoppedType, SessionLogsType,
  SessionUploadStateType, SessionUploadType, TouchObjectsType, VerifyOutputType, type SessionUpload } from '../protocol/session-data.js';
import { closeSocketServer, serveOnSocket } from './local-http.js';
import { sessionAttempts } from './session-attempts.js';

const CHUNK_BYTES = 8 * 1024 * 1024;
const sameUpload = equalFor(SessionUploadType);
const encodeUpload = encodeBeast2For(SessionUploadStateType);
const decodeUpload = decodeBeast2For(SessionUploadStateType);
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/** Configures one repository session's private data listener. */
export interface SessionDataOptions {
  /** Backend whose repository formats this e3 release understands. */
  storage: StorageBackend;
  /** Canonical repository path, never opened by the hub. */
  repoPath: string;
  /** Unguessable session credential, shared only with the local hub. */
  dataToken: string;
  /** Private rack home, also useful for isolated tests. */
  home?: string;
  /** Tees logs after they have reached storage. */
  onLog?: (executionId: string, stream: 'stdout' | 'stderr', data: string) => void;
}

/**
 * Serves repository objects, staged uploads, logs and execution records locally.
 *
 * Uploads stream to immutable files on the repository's device. Hash, length,
 * declaration and receipt must all match before adoption. Temporary metadata
 * lets another live session recover an acknowledged upload after owner death.
 * The hub fences lease operations; it never receives repository file paths.
 *
 * @param options - Repository backend, credential and log tee
 * @returns The private socket and idempotent shutdown
 * @example
 * const data = await startSessionDataServer({ storage, repoPath, dataToken });
 * await data.close();
 */
export async function startSessionDataServer(options: SessionDataOptions): Promise<{ socketPath: string; close(): Promise<void> }> {
  const { storage, repoPath: repo } = options;
  const home = ensureRackHome(options.home ?? rackHome());
  const socketPath = sessionSocketPath(home);
  const app = new Hono();
  const serial = new InMemoryLeaseCoordinator();
  const localUploads = new Set<string>();
  let hubOwner: ExecutionOwner | undefined;
  const attempts = sessionAttempts(storage, repo, () => {
    if (hubOwner === undefined) throw new Error('Hub process identity is missing');
    return hubOwner;
  });
  app.use('*', async (c, next) => {
    if (c.req.header('authorization') !== `Bearer ${options.dataToken}`) return c.text('Session credential required', 401);
    await next();
  });
  const hashOf = (value: string) => { if (!isObjectHash(value)) throw new Error('Invalid object hash'); return value; };
  const paths = (id: string) => {
    if (!UUID.test(id)) throw new Error('Invalid upload identity');
    return { data: transferStagingPath(repo, `rack-${id}`), meta: transferStagingPath(repo, `rack-${id}-meta`) };
  };
  const remove = async (path: string) => unlink(path).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
  const leaseOf = (json: string): RackLeaseRecord => {
    const lease = JSON.parse(json) as RackLeaseRecord;
    if (!isLeaseEventV2(lease.event) || typeof lease.leaseId !== 'string' || !isObjectHash(lease.taskHash) || !isObjectHash(lease.inputsHash)) throw new Error('Invalid lease record');
    return lease;
  };
  const declaration = (value: SessionUpload) => {
    hashOf(value.hash);
    const size = Number(value.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > 5 * 1024 ** 3 || !UUID.test(value.receipt)) throw new Error('Invalid upload declaration');
    return size;
  };

  app.on(['HEAD', 'GET'], '/v1/objects/:hash', async (c) => {
    const hash = hashOf(c.req.param('hash'));
    if (!(await storage.objects.touch(repo, [hash]))[0]) return c.body(null, 404);
    const { size } = await storage.objects.stat(repo, hash);
    const headers = { 'content-type': 'application/octet-stream', 'content-length': String(size) };
    if (c.req.method === 'HEAD') return new Response(null, { headers });
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({ async pull(controller) {
      try {
        if (offset >= size) { controller.close(); return; }
        const bytes = await storage.objects.readRange(repo, hash, offset, Math.min(CHUNK_BYTES, size - offset));
        if (bytes.length === 0) throw new Error('Object ended before its declared size');
        offset += bytes.length;
        controller.enqueue(bytes);
      } catch (err) { controller.error(err); }
    } });
    return new Response(body, { headers });
  });
  app.post('/v1/objects', async (c) => {
    const reader = c.req.raw.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader !== undefined) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4096) { await reader.cancel(); return c.text('Inline object exceeds 4096 bytes', 413); }
      chunks.push(value);
    }
    return sendSuccess(StringType, await storage.objects.write(repo, Buffer.concat(chunks)));
  });
  app.post('/v1/touch', async (c) => sendSuccess(ArrayType(BooleanType), await storage.objects.touch(repo, await decodeBody(c, TouchObjectsType))));
  app.post('/v1/verify', async (c) => {
    const { hash } = await decodeBody(c, VerifyOutputType);
    return sendSuccess(BooleanType, await touchReachable(storage, repo, [hashOf(hash)]));
  });

  app.put('/v1/uploads/:id', async (c) => {
    const id = c.req.param('id');
    const files = paths(id);
    const declaredSize = c.req.query('size') ?? '';
    if (!/^\d+$/.test(declaredSize) || !Number.isSafeInteger(Number(declaredSize)) || Number(declaredSize) > 5 * 1024 ** 3) return c.text('Invalid upload size', 400);
    const info: SessionUpload = { leaseId: c.req.query('lease') ?? '', hash: c.req.query('hash') ?? '', size: BigInt(Number(declaredSize)), receipt: c.req.query('receipt') ?? '' };
    const size = declaration(info);
    return serial.run(repo, id, async () => {
      try {
        const prior = decodeUpload(await readFile(files.meta));
        if (!sameUpload(prior.declaration, info)) return c.text('Upload declaration changed', 409);
        // The prior PUT succeeded, even if its response was lost. Never open
        // an adopted file for writing: it may share the object's inode.
        return new Response(null, { headers: { 'x-amz-version-id': info.receipt } });
      } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
      // A predecessor session can still be unwinding an aborted PUT when a
      // successor begins. Each PUT owns a distinct file, so its catch/close
      // cannot unlink the successor's acknowledged upload.
      const fileId = randomUUID();
      const data = paths(fileId).data;
      localUploads.add(data);
      await mkdir(dirname(data), { recursive: true });
      const file = await open(data, 'wx', 0o600);
      let length = 0;
      const hash = createHash('sha256');
      try {
        const reader = c.req.raw.body?.getReader();
        if (reader !== undefined) for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > size) { await reader.cancel(); throw new Error('Upload exceeds its declared size'); }
          hash.update(value);
          await file.writeFile(value);
        }
        await file.close();
        if (length !== size || hash.digest('hex') !== info.hash) throw new Error('Upload checksum or length mismatch');
        await atomicWriteFile(files.meta, encodeUpload({ declaration: info, fileId, committed: false }));
        localUploads.delete(data);
        return new Response(null, { headers: { 'x-amz-version-id': info.receipt } });
      } catch (err) {
        await file.close().catch(() => {});
        await remove(data);
        localUploads.delete(data);
        return c.text(err instanceof Error ? err.message : String(err), 400);
      }
    });
  });
  app.post('/v1/uploads/:id/commit', async (c) => {
    const id = c.req.param('id');
    const files = paths(id);
    const info = await decodeBody(c, SessionUploadType);
    declaration(info);
    return serial.run(repo, id, async () => {
      let state: ReturnType<typeof decodeUpload>;
      try { state = decodeUpload(await readFile(files.meta)); } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return sendSuccess(BooleanType, false);
        throw err;
      }
      if (!sameUpload(state.declaration, info)) return sendSuccess(BooleanType, false);
      if (state.committed) return sendSuccess(BooleanType, (await storage.objects.touch(repo, [info.hash]))[0]!);
      const data = paths(state.fileId).data;
      const adopted = await storage.objects.adoptFile(repo, data, info.hash);
      if (adopted.size !== Number(info.size)) throw new Error('Adopted upload has a different size');
      await atomicWriteFile(files.meta, encodeUpload({ declaration: info, fileId: state.fileId, committed: true }));
      await remove(data);
      return sendSuccess(BooleanType, true);
    });
  });
  app.delete('/v1/uploads/:id', async (c) => {
    const id = c.req.param('id');
    const files = paths(id);
    return serial.run(repo, id, async () => {
      try { await remove(paths(decodeUpload(await readFile(files.meta)).fileId).data); }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
      await remove(files.meta);
      return sendSuccess(BooleanType, true);
    });
  });
  app.post('/v1/logs', async (c) => {
    const request = await decodeBody(c, SessionLogsType);
    for (const chunk of request.chunks) {
      await storage.logs.append(repo, request.taskHash, request.inputsHash, request.executionId, chunk.stream.type, chunk.data);
      options.onLog?.(request.executionId, chunk.stream.type, chunk.data);
    }
    await storage.logs.flush(repo, request.taskHash, request.inputsHash, request.executionId);
    return sendSuccess(BooleanType, true);
  });
  app.post('/v1/logs/tee', async (c) => {
    const request = await decodeBody(c, SessionLogsType);
    for (const chunk of request.chunks) options.onLog?.(request.executionId, chunk.stream.type, chunk.data);
    return sendSuccess(BooleanType, true);
  });
  app.post('/v1/attempts/closure', async (c) => sendSuccess(ArrayType(StringType), [...await attempts.closure(leaseOf((await decodeBody(c, LeaseDataType)).leaseJson))]));
  app.post('/v1/attempts/running', async (c) => {
    const request = await decodeBody(c, LeaseRunningType);
    hubOwner = request.owner;
    const lease = leaseOf(request.leaseJson);
    await serial.run(repo, lease.leaseId, () => attempts.running(lease, request.owner.bootId));
    return sendSuccess(BooleanType, true);
  });
  app.post('/v1/attempts/stopped', async (c) => {
    const request = await decodeBody(c, LeaseStoppedType);
    const lease = leaseOf(request.leaseJson);
    await serial.run(repo, lease.leaseId, () => attempts.stopped(lease, request.cancelled ? 'cancelled' : 'interrupted', request.cause));
    return sendSuccess(BooleanType, true);
  });
  app.post('/v1/attempts/outcome', async (c) => {
    const request = await decodeBody(c, LeaseOutcomeType);
    const lease = leaseOf(request.leaseJson);
    const result = JSON.parse(request.resultJson) as RackLeaseResult;
    await serial.run(repo, lease.leaseId, () => attempts.outcome(lease, result));
    return sendSuccess(BooleanType, true);
  });
  const server = await serveOnSocket(app, socketPath);
  let closing: Promise<void> | undefined;
  return { socketPath, close() {
    return closing ??= (async () => {
      await closeSocketServer(server, socketPath);
      // A graceful close follows hub unregistration, which transfers shared
      // leases first. Keep acknowledged metadata for the successor session;
      // the hub's lease cleanup deletes it, or ordinary staging GC does.
      for (const data of localUploads) await remove(data);
    })();
  } };
}
