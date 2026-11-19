/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Routes for the loads of deliveries into a composite record's external
 * sources, mounted at `/api/repos/:repo/workspaces/:ws/records` beside the
 * record routes, and for the uploads that write no ref a load's delivery
 * arrives by, mounted at `/api/repos/:repo/workspaces/:ws/objects`.
 *
 * A load replaces a whole source, so a host with roles of its own grants it
 * apart from an edit: each route asks the host's {@link LoadAccess} first, a
 * read as a write, and answers a rule that throws as it answers any error.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { StringType, equalFor, none, variant } from '@elaraai/east';
import { RecordLoadRequestType, RecordLoadStatusType } from '@elaraai/e3-types';
import type { ObjectCommitStatus, ObjectUploadJob, StorageBackend, TransferBackend } from '@elaraai/e3-core/portable';
import { decodeBody, sendError, sendSuccess } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import type { Identity } from '../identity.js';
import { cancelRecordLoad, getRecordLoadStatus, startRecordLoad, type LoadAddress } from '../handlers/record-loads.js';
import {
  PackageJobResponseType, TransferDoneResponseType, TransferPartResponseType, TransferUploadRequestType, TransferUploadResponseType,
} from '../types.js';
import { resolveActor } from './records.js';
import { DEFAULT_COMMIT_WAIT_MS, protocolProblem, stagedUploadAnswers } from './transfer.js';

/** Whether two names are one: a repository's or a workspace's. */
const sameName = equalFor(StringType);

/**
 * What a caller asks to do: load a delivery into a record's source, cancel
 * such a load, or read its status (`load`, `cancel`, `read`, naming the
 * record and the source); or upload a file as an object, which names no load
 * (`upload`: its init, where to send a part, its commit, and a poll of it).
 */
export type LoadAction =
  | { readonly kind: 'load' | 'cancel' | 'read'; readonly record: string; readonly source: string }
  | { readonly kind: 'upload' };

/**
 * A host's rule on who may load into a workspace's records: asked with the
 * request's context, whose `repo` and `ws` parameters name the workspace, and
 * what the caller asks to do.
 *
 * @remarks
 * A load replaces a whole source, so a host with roles of its own grants it
 * apart from an edit: to the integration that sends the delivery, not to
 * everyone who may change a row. A load's status says what was delivered and
 * when, and an upload's part says where its bytes go, so each read is asked
 * of the rule as its write is: a load's id is no grant. A refusal is
 * `permission_denied`, its `path` the load as it is named, `orders.erp`, or
 * `upload` for an upload.
 */
export type LoadAccess = (c: Context, action: LoadAction) => boolean | Promise<boolean>;

/**
 * The rule of a host whose mutate route admits every caller its routes do, as
 * the local server's and e3-web's record routes do: every such caller may load
 * any source, and upload a delivery.
 *
 * @returns `true`, for any caller and any load
 */
export const allowEveryLoad: LoadAccess = () => true;

/** Options for {@link createRecordLoadRoutes}. */
export interface RecordLoadRoutesOptions {
  /** Who may load what. Required, so every host decides; a host whose mutate
   *  route admits every caller passes {@link allowEveryLoad}. */
  access: LoadAccess;
}

/** The load a request names. */
function addressOf(c: Context): LoadAddress {
  return { repo: c.req.param('repo')!, workspace: c.req.param('ws')!, record: c.req.param('rec')!, source: c.req.param('source')! };
}

/** The refusal of a caller the host does not grant a load. */
function refusedLoad(address: LoadAddress) {
  return variant('permission_denied', { path: `${address.record}.${address.source}` });
}

/**
 * Load routes, mounted at `/api/repos/:repo/workspaces/:ws/records`:
 *
 * - `POST /:rec/loads/:source` launches a load of the delivery its body names
 *   (a `RecordLoadRequest`), as a job, and answers its id.
 * - `GET /:rec/loads/:source/:id` answers the load's status.
 * - `POST /:rec/loads/:source/:id/cancel` asks the load to cancel, and
 *   answers its status as it stands (ruling 28).
 *
 * @remarks
 * The actor the load's commit names is the caller's verified identity when the
 * host authenticates, and otherwise the request's, as a mutation's is.
 *
 * @param transferBackend - Files and dispatches the jobs loads run as
 * @param options - Who may load what
 * @returns The routes
 */
export function createRecordLoadRoutes(transferBackend: TransferBackend, options: RecordLoadRoutesOptions) {
  const app = new Hono<{ Variables: { identity?: Identity } }>();
  const store = transferBackend.recordLoad;

  // POST /:rec/loads/:source — launch a load (PackageJobResponse)
  app.post('/:rec/loads/:source', async (c) => {
    const address = addressOf(c);
    try {
      if (!await options.access(c, { kind: 'load', record: address.record, source: address.source })) {
        return sendError(PackageJobResponseType, refusedLoad(address));
      }
      const request = await decodeBody(c, RecordLoadRequestType);
      const { actor, authoritative } = resolveActor(c.get('identity'));
      return await startRecordLoad(store, address, request, !authoritative && request.actor.type === 'some' ? request.actor.value : actor);
    } catch (err) {
      return sendError(PackageJobResponseType, errorToVariant(err));
    }
  });

  // GET /:rec/loads/:source/:id — poll a load (RecordLoadStatus)
  app.get('/:rec/loads/:source/:id', async (c) => {
    const address = addressOf(c);
    try {
      if (!await options.access(c, { kind: 'read', record: address.record, source: address.source })) {
        return sendError(RecordLoadStatusType, refusedLoad(address));
      }
      return await getRecordLoadStatus(store, address, c.req.param('id'));
    } catch (err) {
      return sendError(RecordLoadStatusType, errorToVariant(err));
    }
  });

  // POST /:rec/loads/:source/:id/cancel — ask a load to cancel (RecordLoadStatus)
  app.post('/:rec/loads/:source/:id/cancel', async (c) => {
    const address = addressOf(c);
    try {
      if (!await options.access(c, { kind: 'cancel', record: address.record, source: address.source })) {
        return sendError(RecordLoadStatusType, refusedLoad(address));
      }
      return await cancelRecordLoad(store, address, c.req.param('id'), resolveActor(c.get('identity')).actor);
    } catch (err) {
      return sendError(RecordLoadStatusType, errorToVariant(err));
    }
  });

  return app;
}

/** Options for {@link createObjectUploadRoutes}. */
export interface ObjectUploadRoutesOptions {
  /** Who may upload: asked as {@link LoadAccess} is, with `upload`. */
  access: LoadAccess;
  /** How long a commit waits for the staged bytes to be checked before it
   *  answers `processing` for the client to poll (default 5000 ms). */
  commitWaitMs?: number;
}

/** An object upload's commit, as the transfer protocol answers it. */
function sendObjectStatus(_upload: ObjectUploadJob, status: ObjectCommitStatus): Response {
  switch (status.type) {
    case 'processing': return sendSuccess(TransferDoneResponseType, variant('processing', none));
    case 'completed': return sendSuccess(TransferDoneResponseType, variant('completed', null));
    case 'failed': return sendSuccess(TransferDoneResponseType, variant('error', { message: status.value.message }));
  }
}

/**
 * Upload routes for a file a load delivers, which write no ref, mounted at
 * `/api/repos/:repo/workspaces/:ws/objects`: the dataset upload's protocol,
 * its forms and its versions, with no dataset.
 *
 * - `POST /` — the init, its body the bytes' hash and size: `completed` when
 *   the store holds the object already, which it re-references, and otherwise
 *   the upload's id and its plan as parts.
 * - `GET /upload/:id/parts/:n` — where to send part `n`.
 * - `POST /upload/:id` — the commit: the staged bytes checked and stored as
 *   their object, naming it nowhere; then poll with `GET /upload/:id`.
 *
 * @param storage - Storage backend
 * @param getRepoPath - The repository a request names, as a path
 * @param transferBackend - The uploads, and where their commits run
 * @param options - Who may upload, and how long a commit is waited for
 * @returns The routes
 */
export function createObjectUploadRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend: TransferBackend,
  options: ObjectUploadRoutesOptions,
) {
  const app = new Hono();
  const uploads = transferBackend.objectUpload;
  const answers = stagedUploadAnswers(uploads, options.commitWaitMs ?? DEFAULT_COMMIT_WAIT_MS, variant('processing', null) as ObjectCommitStatus, sendObjectStatus);

  /** The upload `id`, if it was made through this request's repository and workspace. */
  async function uploadAt(c: Context, id: string): Promise<ObjectUploadJob | null> {
    const upload = await uploads.get(id);
    return upload !== null && sameName(upload.repo, c.req.param('repo')!) && sameName(upload.workspace, c.req.param('ws')!) ? upload : null;
  }

  // POST / — begin an upload (TransferUploadResponse)
  app.post('/', async (c) => {
    const problem = protocolProblem(c);
    if (problem !== null) return sendError(TransferUploadResponseType, variant('internal', { message: problem }));
    try {
      if (!await options.access(c, { kind: 'upload' })) {
        return sendError(TransferUploadResponseType, variant('permission_denied', { path: 'upload' }));
      }
      const repo = c.req.param('repo')!;
      const workspace = c.req.param('ws')!;
      const { hash, size } = await decodeBody(c, TransferUploadRequestType);
      // The store holds it already: nothing is sent, and it is re-referenced,
      // so a sweep leaves it for the load that names it
      const [held] = await storage.objects.touch(getRepoPath(repo), [hash]);
      if (held === true) return sendSuccess(TransferUploadResponseType, variant('completed', null));
      const id = globalThis.crypto.randomUUID();
      const upload: ObjectUploadJob = { repo, workspace, hash, size };
      await uploads.create(id, upload);
      const partBytes = await uploads.createParts(id, upload);
      return sendSuccess(TransferUploadResponseType, variant('upload_parts', { id, partBytes }));
    } catch (err) {
      return sendError(TransferUploadResponseType, errorToVariant(err));
    }
  });

  /**
   * Answers a request of an upload once the host grants its caller an
   * upload: refused `permission_denied` otherwise, and a rule or a lookup
   * that throws answered as any error is, in the route's own type.
   */
  async function granted(
    c: Context,
    type: typeof TransferPartResponseType | typeof TransferDoneResponseType,
    answer: (upload: ObjectUploadJob | null) => Response | Promise<Response>,
  ): Promise<Response> {
    try {
      if (!await options.access(c, { kind: 'upload' })) return sendError(type, variant('permission_denied', { path: 'upload' }));
      return await answer(await uploadAt(c, c.req.param('id')!));
    } catch (err) {
      return sendError(type, errorToVariant(err));
    }
  }

  // GET /upload/:id/parts/:n — where to send part n (TransferPartResponse)
  app.get('/upload/:id/parts/:part', (c) =>
    granted(c, TransferPartResponseType, (upload) => answers.part(c, c.req.param('id'), upload, Number(c.req.param('part')))));

  // POST /upload/:id — commit (TransferDoneResponse)
  app.post('/upload/:id', (c) => {
    if (protocolProblem(c) !== null) return answers.commit(c, c.req.param('id'), null);
    return granted(c, TransferDoneResponseType, (upload) => answers.commit(c, c.req.param('id'), upload));
  });

  // GET /upload/:id — poll a commit (TransferDoneResponse)
  app.get('/upload/:id', (c) => granted(c, TransferDoneResponseType, (upload) => answers.poll(c.req.param('id'), upload)));

  return app;
}
