/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for e3's platform functions over a given `fetch`.
 *
 * `Platform.implementation({ fetch })` gives the platform functions whose
 * requests go through the given `fetch`, as a host that answers e3's API
 * itself needs: e3 running in a page. `Platform.Implementation` stays over
 * the global `fetch`.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayType, East, StringType, encodeBeast2For, none, variant, type ValueTypeOf } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, ResponseType, WorkspaceInfoType } from '@elaraai/e3-types';
import { Platform } from './platform.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const BASE = 'https://e3.test';

/** The workspaces the fake server lists. */
const workspaces: ValueTypeOf<typeof WorkspaceInfoType>[] = [
  { name: 'ws', deployed: false, packageName: none, packageVersion: none },
];

/** A server answering the workspace list, as a `fetch`, recording the URLs it answers. */
function workspaceServer(): { urls: string[]; fetch: typeof globalThis.fetch } {
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response(encodeBeast2For(ResponseType(ArrayType(WorkspaceInfoType)))(variant('success', workspaces)), {
      status: 200,
      headers: { 'Content-Type': BEAST2_CONTENT_TYPE },
    });
  }) as typeof globalThis.fetch;
  return { urls, fetch };
}

/** An East program listing a repository's workspaces through e3's platform. */
const listWorkspaces = East.asyncFunction(
  [StringType, StringType, StringType],
  ArrayType(Platform.Types.WorkspaceInfo),
  ($, url, repo, token) => Platform.workspaceList(url, repo, token),
);

describe('Platform.implementation', () => {
  it('sends the platform functions\' requests through the given fetch', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      throw new Error(`the global fetch was called for ${String(input)}`);
    }) as typeof globalThis.fetch;
    const server = workspaceServer();
    const compiled = East.compileAsync(listWorkspaces, Platform.implementation({ fetch: server.fetch }));
    assert.deepEqual(await compiled(BASE, 'r', 'tok'), workspaces);
    assert.deepEqual(server.urls, [`${BASE}/api/repos/r/workspaces`]);
  });

  it('leaves Platform.Implementation over the global fetch', async () => {
    const server = workspaceServer();
    globalThis.fetch = server.fetch;
    const compiled = East.compileAsync(listWorkspaces, Platform.Implementation);
    assert.deepEqual(await compiled(BASE, 'r', 'tok'), workspaces);
    assert.deepEqual(server.urls, [`${BASE}/api/repos/r/workspaces`]);
  });
});
