/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for the client half of the package transfer protocol, through a given
 * `fetch`.
 *
 * `packageImport` uploads the zip to the URL the server names, and
 * `packageExport` and `workspaceExport` download it from the URL their job
 * answers with. A host that answers e3's API itself gives the `fetch` these
 * requests go through: these tests stand a fake server in for it, refuse the
 * global `fetch`, and pin that every request of each flow reaches the given
 * one — the upload and the download among them, which carry no credentials,
 * since their URLs may be presigned.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBeast2For, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import {
  BEAST2_CONTENT_TYPE,
  PackageExportStatusType,
  PackageImportResultType,
  PackageImportStatusType,
  PackageJobResponseType,
  PackageTransferInitResponseType,
  ResponseType,
} from '@elaraai/e3-types';
import { packageExport, packageImport } from './packages.js';
import { workspaceExport } from './workspaces.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const BASE = 'https://e3.test';
const TRANSFER = '0f0e0d0c-0b0a-4908-8706-050403020100';
const JOB = '00010203-0405-4607-8809-0a0b0c0d0e0f';

/** One request the fake server received, its body read whole. */
interface Call {
  method: string;
  url: string;
  auth: string | null;
  body: Uint8Array | null;
}

/**
 * A fake server as the `fetch` a host gives, recording every request it
 * answers, while the global `fetch` refuses every request.
 */
function givenServer(
  answer: (method: string, url: URL) => globalThis.Response,
): { calls: Call[]; fetch: typeof globalThis.fetch } {
  globalThis.fetch = (async (input: string | URL | Request) => {
    throw new Error(`the global fetch was called for ${String(input)}`);
  }) as typeof globalThis.fetch;
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? new Uint8Array(await new Response(init.body).arrayBuffer()) : null;
    calls.push({ method, url: url.href, auth: new Headers(init?.headers).get('authorization'), body });
    return answer(method, url);
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

/** A BEAST2 success envelope, as the server sends one. */
function success<T extends EastType>(type: T, value: ValueTypeOf<T>): globalThis.Response {
  const body = encodeBeast2For(ResponseType(type))(variant('success', value) as never);
  return new Response(body, { status: 200, headers: { 'Content-Type': BEAST2_CONTENT_TYPE } });
}

/** A package zip's bytes, as far as a transfer is concerned. */
const archive = Uint8Array.from({ length: 64 }, (_, i) => i);

/** An export job's poll and its download, answered as a server answers them. */
function exportJob(method: string, url: URL): globalThis.Response | undefined {
  if (method === 'GET' && url.pathname === `/api/repos/r/export/${JOB}`) {
    return success(PackageExportStatusType, variant('completed', { downloadUrl: `https://store.test/export/${JOB}`, size: BigInt(archive.length) }));
  }
  if (method === 'GET' && url.href === `https://store.test/export/${JOB}`) return new Response(archive, { status: 200 });
  return undefined;
}

describe('package transfer through a given fetch', () => {
  it('uploads a package to the URL the server names, and polls its import', async () => {
    const imported: ValueTypeOf<typeof PackageImportResultType> = {
      name: 'pkg', version: '1.0.0', packageHash: 'a'.repeat(64), objectCount: 3n,
    };
    const server = givenServer((method, url) => {
      if (method === 'POST' && url.pathname === '/api/repos/r/import') {
        return success(PackageTransferInitResponseType, { id: TRANSFER, uploadUrl: `https://store.test/upload/${TRANSFER}` });
      }
      if (method === 'PUT' && url.host === 'store.test') return new Response(null, { status: 200 });
      if (method === 'POST' && url.pathname === `/api/repos/r/import/${TRANSFER}`) return success(PackageJobResponseType, { id: JOB });
      if (method === 'GET' && url.pathname === `/api/repos/r/import/${JOB}`) {
        return success(PackageImportStatusType, variant('completed', imported));
      }
      return new Response(`unexpected ${method} ${url.href}`, { status: 500 });
    });

    assert.deepEqual(await packageImport(BASE, 'r', archive, { token: 'tok', fetch: server.fetch }), imported);
    assert.deepEqual(server.calls.map(({ method, url, auth }) => [method, url, auth]), [
      ['POST', `${BASE}/api/repos/r/import`, 'Bearer tok'],
      ['PUT', `https://store.test/upload/${TRANSFER}`, null],
      ['POST', `${BASE}/api/repos/r/import/${TRANSFER}`, 'Bearer tok'],
      ['GET', `${BASE}/api/repos/r/import/${JOB}`, 'Bearer tok'],
    ]);
    assert.deepEqual(server.calls[1]!.body, archive, 'the upload is the zip');
  });

  it('downloads a package\'s export from the URL its job names', async () => {
    const server = givenServer((method, url) => {
      if (method === 'POST' && url.pathname === '/api/repos/r/packages/pkg/1.0.0/export') return success(PackageJobResponseType, { id: JOB });
      return exportJob(method, url) ?? new Response(`unexpected ${method} ${url.href}`, { status: 500 });
    });

    assert.deepEqual(await packageExport(BASE, 'r', 'pkg', '1.0.0', { token: 'tok', fetch: server.fetch }), archive);
    assert.deepEqual(server.calls.map(({ method, url, auth }) => [method, url, auth]), [
      ['POST', `${BASE}/api/repos/r/packages/pkg/1.0.0/export`, 'Bearer tok'],
      ['GET', `${BASE}/api/repos/r/export/${JOB}`, 'Bearer tok'],
      ['GET', `https://store.test/export/${JOB}`, null],
    ]);
  });

  it('downloads a workspace\'s export from the URL its job names', async () => {
    const server = givenServer((method, url) => {
      if (method === 'POST' && url.pathname === '/api/repos/r/workspaces/ws/export') return success(PackageJobResponseType, { id: JOB });
      return exportJob(method, url) ?? new Response(`unexpected ${method} ${url.href}`, { status: 500 });
    });

    assert.deepEqual(await workspaceExport(BASE, 'r', 'ws', { token: 'tok', fetch: server.fetch }), archive);
    assert.deepEqual(server.calls.map(({ method, url, auth }) => [method, url, auth]), [
      ['POST', `${BASE}/api/repos/r/workspaces/ws/export`, 'Bearer tok'],
      ['GET', `${BASE}/api/repos/r/export/${JOB}`, 'Bearer tok'],
      ['GET', `https://store.test/export/${JOB}`, null],
    ]);
  });
});
