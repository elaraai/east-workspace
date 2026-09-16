/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { mkdir, open, writeFile, readFile, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { variant } from '@elaraai/east';
import { transferPartCount, transferPartRange } from '@elaraai/e3-types';
import {
  BEAST2_CONTENT_TYPE,
  ObjectNotFoundError,
  transferStagingDir,
  transferStagingPath,
  type StorageBackend,
  type TransferBackend,
} from '@elaraai/e3-core';

const STAGING_DIR = join(tmpdir(), 'e3-transfers');

/**
 * Reject requests that carry an Authorization header.
 *
 * Data endpoints are authenticated by the unguessable transfer UUID in the
 * URL path (capability URL pattern). In cloud deployments these URLs are S3
 * presigned URLs that reject extra auth headers, so the local server enforces
 * the same contract.
 */
function rejectAuthHeader(c: { req: { header(name: string): string | undefined } }): Response | null {
  if (c.req.header('authorization')) {
    return new Response('Authorization header must not be sent to data endpoints', { status: 400 });
  }
  return null;
}

/**
 * Create generic upload/download data endpoints.
 *
 * Returns two Hono apps:
 * - `uploads`: PUT /:id — upload data (dataset BEAST2 or package zip);
 *   PUT /:id/parts/:part — one part of a dataset upload planned as parts
 * - `downloads`: GET /:id — download data (dataset BEAST2 or package zip)
 *
 * These are unauthenticated — the UUID in the URL is the sole capability.
 * In cloud deployments, these map directly to S3 presigned URLs.
 */
export function createDataEndpoints(
  transferBackend: TransferBackend,
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
) {
  const uploads = new Hono();
  const downloads = new Hono();

  // PUT /api/uploads/:id — Upload data (dataset BEAST2 or package zip)
  uploads.put('/:id', async (c) => {
    const rejected = rejectAuthHeader(c);
    if (rejected) return rejected;

    const id = c.req.param('id')!;

    // Try dataset upload first
    const dsRecord = await transferBackend.datasetUpload.get(id);
    if (dsRecord) {
      // Streamed to the repo's own staging area: a delivery can be far larger
      // than this process's heap, and the commit turns the staged file into an
      // object by link or rename — which only works on the repo's device.
      const repoPath = getRepoPath(dsRecord.repo);
      const stagingPath = transferStagingPath(repoPath, id);
      await mkdir(transferStagingDir(repoPath), { recursive: true });
      const stream = c.req.raw.body;
      try {
        if (stream) {
          await pipeline(Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(stagingPath));
        } else {
          await writeFile(stagingPath, new Uint8Array(await c.req.arrayBuffer()));
        }
      } catch (err) {
        // A broken upload leaves no partial file behind; gc sweeps the staging
        // directory only as the backstop for a server that crashed mid-upload.
        // The transfer record stays, so the client may retry the PUT.
        await unlink(stagingPath).catch(() => {});
        throw err;
      }
      return new Response(null, { status: 200 });
    }

    // Try package import — stage file for later processing by trigger endpoint
    const pkgRecord = await transferBackend.packageImport.get(id);
    if (pkgRecord) {
      const body = new Uint8Array(await c.req.arrayBuffer());
      if (BigInt(body.byteLength) !== pkgRecord.size) {
        await transferBackend.packageImport.delete(id);
        return new Response(
          `size mismatch: expected ${pkgRecord.size}, got ${body.byteLength}`,
          { status: 400 }
        );
      }

      const stagingPath = join(STAGING_DIR, `${id}.zip.partial`);
      await mkdir(STAGING_DIR, { recursive: true });
      await writeFile(stagingPath, body);
      await transferBackend.packageImport.updateStatus(id, variant('uploaded', null));

      return new Response(null, { status: 200 });
    }

    return new Response('Not found', { status: 404 });
  });

  // PUT /api/uploads/:id/parts/:part — One part of a dataset upload planned as
  // parts (protocol 2)
  uploads.put('/:id/parts/:part', async (c) => {
    const rejected = rejectAuthHeader(c);
    if (rejected) return rejected;

    const id = c.req.param('id')!;
    const record = await transferBackend.datasetUpload.get(id);
    const partBytes = record ? await transferBackend.datasetUpload.getPartBytes(id) : null;
    if (!record || partBytes === null) {
      return new Response('Not found', { status: 404 });
    }
    const part = Number(c.req.param('part'));
    const range = transferPartRange(record.size, partBytes, part);
    if (!range) {
      return new Response(
        `No part ${c.req.param('part')}: the upload has ${transferPartCount(record.size, partBytes)} parts`,
        { status: 404 }
      );
    }

    // Every part streams to its own offset in the one staged file — in any
    // order, concurrently, and a re-sent part over the old one — so the commit
    // adopts the file exactly as it does a single PUT's, with nothing to
    // assemble. Opening with 'a' creates the file without truncating the parts
    // already there; the write itself needs a positioned handle.
    const repoPath = getRepoPath(record.repo);
    const stagingPath = transferStagingPath(repoPath, id);
    await mkdir(transferStagingDir(repoPath), { recursive: true });
    await (await open(stagingPath, 'a')).close();

    // A part longer than its range would overwrite the next part, so the
    // stream stops at the range's end instead of trusting Content-Length.
    const expected = range.end - range.start;
    let received = 0;
    const bounded = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > expected) {
          callback(new Error(`part ${part} is ${expected} bytes, and more were sent`));
        } else {
          callback(null, chunk);
        }
      },
    });
    const body = c.req.raw.body;
    try {
      await pipeline(
        body ? Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]) : Readable.from([]),
        bounded,
        createWriteStream(stagingPath, { flags: 'r+', start: range.start }),
      );
    } catch (err) {
      if (received > expected) {
        return new Response(`part ${part} is ${expected} bytes, and more were sent`, { status: 400 });
      }
      throw err;
    }
    if (received !== expected) {
      return new Response(`part ${part} is ${expected} bytes, got ${received}`, { status: 400 });
    }
    return new Response(null, { status: 200 });
  });

  // GET /api/downloads/:id — Download data (dataset BEAST2 or package zip)
  downloads.get('/:id', async (c) => {
    const rejected = rejectAuthHeader(c);
    if (rejected) return rejected;

    const id = c.req.param('id')!;

    // Try dataset download
    const dsRecord = await transferBackend.datasetDownload.get(id);
    if (dsRecord) {
      const repoPath = getRepoPath(dsRecord.repo);
      try {
        const data = await storage.objects.read(repoPath, dsRecord.hash);
        await transferBackend.datasetDownload.delete(id);
        return new Response(data, {
          headers: {
            'Content-Type': BEAST2_CONTENT_TYPE,
            'Content-Length': String(data.byteLength),
            'X-Content-SHA256': dsRecord.hash,
          },
        });
      } catch (err) {
        await transferBackend.datasetDownload.delete(id);
        if (err instanceof ObjectNotFoundError) {
          return new Response('Not found', { status: 404 });
        }
        throw err;
      }
    }

    // Try package export
    const pkgRecord = await transferBackend.packageExport.get(id);
    if (pkgRecord && pkgRecord.status.type === 'completed') {
      const stagingPath = join(STAGING_DIR, `${id}.zip`);
      try {
        const fileData = await readFile(stagingPath);
        await unlink(stagingPath).catch(() => {});
        await transferBackend.packageExport.delete(id);

        return new Response(fileData, {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Length': String(fileData.byteLength),
          },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    }

    return new Response('Not found', { status: 404 });
  });

  return { uploads, downloads };
}
