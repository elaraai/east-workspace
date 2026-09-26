/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { isObjectHash, type StorageBackend, type TransferBackend } from '@elaraai/e3-core';
import { BEAST2_CONTENT_TYPE } from '@elaraai/e3-types';
import { sendJsonError } from '../errors.js';
import { DOWNLOAD_REDIRECT_BYTES } from '../handlers/datasets.js';

/**
 * Creates the routes that read an object by its hash.
 *
 * @remarks
 * A client downloading a collection by its segments reads each segment here.
 * With a transfer backend, an object over {@link DOWNLOAD_REDIRECT_BYTES} is
 * answered as a dataset download is: JSON `{ url }`, which the client fetches
 * directly, so a host whose responses are capped never carries the bytes.
 *
 * @param storage - The storage backend the objects are read from
 * @param getRepoPath - Maps a repository name to its path in the backend
 * @param transferBackend - Serves large objects by URL; without it every object is answered inline
 * @returns The Hono app, mounted at `/api/repos/:repo/objects`
 */
export function createObjectRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend?: TransferBackend,
) {
  const app = new Hono();

  // GET /api/repos/:repo/objects/:hash — Read object by hash
  app.get('/:hash', async (c) => {
    const repo = c.req.param('repo')!;
    const repoPath = getRepoPath(repo);
    const hash = c.req.param('hash')!;

    if (!isObjectHash(hash)) {
      return new Response(JSON.stringify({ error: { type: 'bad_request', message: `invalid hash format: ${hash}` } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      if (transferBackend) {
        const { size } = await storage.objects.stat(repoPath, hash);
        if (size > DOWNLOAD_REDIRECT_BYTES) {
          let url = await transferBackend.datasetDownload.getDownloadUrl(repo, hash);
          if (url.startsWith('/')) url = `${new URL(c.req.url).origin}${url}`;
          return new Response(JSON.stringify({ url }), {
            headers: {
              'Content-Type': 'application/json',
              'X-Content-Length': String(size),
              'X-Content-SHA256': hash,
            },
          });
        }
      }
      const data = await storage.objects.read(repoPath, hash);
      return new Response(data, {
        headers: {
          'Content-Type': BEAST2_CONTENT_TYPE,
          'Content-Length': String(data.byteLength),
          'X-Content-SHA256': hash,
        },
      });
    } catch (err) {
      return sendJsonError(err);
    }
  });

  return app;
}
