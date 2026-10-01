/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * e3-web's own byte endpoints: what the URLs a {@link WebTransferBackend}
 * gives answer, in the e3 worker — an upload's parts and an import's zip put,
 * a dataset's object and an export's zip got — as the local server's data
 * endpoints answer its own, over the backend's staged blobs rather than files.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { IntegerType, equalFor, printFor } from '@elaraai/east';
import { BEAST2_CONTENT_TYPE, transferPartCount, transferPartRange } from '@elaraai/e3-types';
import { ObjectNotFoundError } from '@elaraai/e3-core/portable';
import type { WebStorage } from '../storage/WebStorage.js';
import type { WebTransferBackend } from './WebTransferBackend.js';

const sameInteger = equalFor(IntegerType);
const printInteger = printFor(IntegerType);

/**
 * Refuses a request that carries credentials in an `Authorization` header, as
 * the local server's data endpoints do: the transfer's id in the URL is its
 * sole capability, as a presigned URL's signature is for e3-cloud. An empty
 * header carries none, and is taken, as the local server takes it.
 */
function rejectAuthHeader(c: Context): Response | null {
  const authorization = c.req.header('authorization');
  if (authorization !== undefined && authorization !== '') {
    return new Response('Authorization header must not be sent to data endpoints', { status: 400 });
  }
  return null;
}

/** Bytes as a response's body takes them: over an `ArrayBuffer`, copied
 *  when they lie over any other buffer. */
function bodyOf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes.buffer instanceof ArrayBuffer ? bytes as Uint8Array<ArrayBuffer> : bytes.slice();
}

/** Answers that nothing is at a URL. */
function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

/**
 * The byte endpoints, mounted at `/api/uploads` and `/api/downloads`.
 */
export interface WebDataEndpoints {
  /** `PUT /:id` — an import's zip; `PUT /:id/parts/:part` — one part of a
   *  dataset upload */
  readonly uploads: Hono;
  /** `GET /:id` — a dataset's object, or a completed export's zip */
  readonly downloads: Hono;
}

/**
 * Creates e3-web's byte endpoints over its transfer backend.
 *
 * @remarks
 * - A body is sized by its bytes as they arrived, never by what a header
 *   claims. A body crosses from the page whole, so each is read whole: a
 *   part is at most the backend's part size, and an import's zip is the
 *   package's.
 * - An import's zip of another size than its record's is refused, and the
 *   import forgotten, as the local server refuses it.
 * - A part is checked against the range the upload's plan gives it before it
 *   is staged, so a part too long or too short stages nothing; a part sent
 *   again replaces itself; and a committed upload takes no more parts.
 * - A download is served once: its record goes as it is answered.
 *
 * @param transfer - The transfer backend whose URLs these answer
 * @param storage - The storage a dataset's object is read from
 * @returns The two apps, to mount at `/api/uploads` and `/api/downloads`
 */
export function createWebDataEndpoints(transfer: WebTransferBackend, storage: WebStorage): WebDataEndpoints {
  const uploads = new Hono();
  const downloads = new Hono();

  // PUT /api/uploads/:id — an import's zip, staged for its trigger to process
  uploads.put('/:id', async (c) => {
    const rejected = rejectAuthHeader(c);
    if (rejected !== null) return rejected;

    const id = c.req.param('id');
    const record = await transfer.packageImport.get(id);
    if (record === null) return notFound();
    const body = new Uint8Array(await c.req.arrayBuffer());
    if (!sameInteger(BigInt(body.byteLength), record.size)) {
      await transfer.packageImport.delete(id);
      return new Response(`size mismatch: expected ${printInteger(record.size)}, got ${body.byteLength}`, { status: 400 });
    }
    await transfer.packageImport.stageZip(id, record.repo, body);
    return new Response(null, { status: 200 });
  });

  // PUT /api/uploads/:id/parts/:part — one part of a dataset upload, staged
  // whole in its own blob
  uploads.put('/:id/parts/:part', async (c) => {
    const rejected = rejectAuthHeader(c);
    if (rejected !== null) return rejected;

    const id = c.req.param('id');
    const record = await transfer.datasetUpload.get(id);
    const partBytes = record === null ? null : await transfer.datasetUpload.getPartBytes(id);
    if (record === null || partBytes === null) return notFound();
    // A part sent once the commit is under way could change the bytes it
    // verifies.
    if ((await transfer.datasetUpload.getCommitStatus(id)) !== null) {
      return new Response('the upload is committed: it takes no more parts', { status: 409 });
    }
    const part = Number(c.req.param('part'));
    const range = transferPartRange(record.size, partBytes, part);
    if (range === null) {
      return new Response(`No part ${c.req.param('part')}: the upload has ${transferPartCount(record.size, partBytes)} parts`, { status: 404 });
    }
    const expected = range.end - range.start;
    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.byteLength > expected) {
      return new Response(`part ${part} is ${expected} bytes, and more were sent`, { status: 400 });
    }
    if (body.byteLength < expected) {
      return new Response(`part ${part} is ${expected} bytes, got ${body.byteLength}`, { status: 400 });
    }
    await transfer.datasetUpload.stagePart(id, record.repo, part, body);
    return new Response(null, { status: 200 });
  });

  // GET /api/downloads/:id — a dataset's object, or an export's zip
  downloads.get('/:id', async (c) => {
    const rejected = rejectAuthHeader(c);
    if (rejected !== null) return rejected;

    const id = c.req.param('id');

    const dataset = await transfer.datasetDownload.get(id);
    if (dataset !== null) {
      let data: Uint8Array;
      try {
        data = await storage.objects.read(dataset.repo, dataset.hash);
      } catch (err) {
        await transfer.datasetDownload.delete(id);
        if (err instanceof ObjectNotFoundError) return notFound();
        throw err;
      }
      await transfer.datasetDownload.delete(id);
      return new Response(bodyOf(data), {
        headers: {
          'Content-Type': BEAST2_CONTENT_TYPE,
          'Content-Length': String(data.byteLength),
          'X-Content-SHA256': dataset.hash,
        },
      });
    }

    const exported = await transfer.packageExport.get(id);
    if (exported !== null && exported.status.type === 'completed') {
      const zip = await transfer.packageExport.zipOf(id);
      if (zip === null) return notFound();
      await transfer.packageExport.delete(id);
      return new Response(bodyOf(zip), {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': String(zip.byteLength),
        },
      });
    }

    return notFound();
  });

  return { uploads, downloads };
}
