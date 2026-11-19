/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Handlers for the loads of deliveries into composite records' external
 * sources: a load launched as a job, its status polled, and a cancel asked of
 * it, which the job acts on, ending itself (ruling 28).
 */

import { StringType, equalFor, none, some, variant } from '@elaraai/east';
import { RecordLoadStatusType, type RecordLoadRequest } from '@elaraai/e3-types';
import type { RecordLoadJob, RecordLoadStore } from '@elaraai/e3-core/portable';
import { sendError, sendSuccess } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import { PackageJobResponseType } from '../types.js';

/** Whether two names are one: a repository's, a workspace's, a record's or a source's. */
const sameName = equalFor(StringType);

/** The load a request names: the repository by its name, the workspace, the
 *  record and its source. */
export interface LoadAddress {
  readonly repo: string;
  readonly workspace: string;
  readonly record: string;
  readonly source: string;
}

/**
 * Launch a load of a delivery into a record's source, as a job the client
 * polls.
 *
 * @remarks
 * The job is filed running and dispatched to the compute the store chooses,
 * where it takes its turn among its source's loads, and runs as long as the
 * delivery is large. A record or source that is not one a delivery is loaded
 * into, and a source the dataflow loads from its feed, fail the job at once,
 * saying why, as a delivery the store does not hold does.
 *
 * @param store - Where the job is filed, and dispatched from
 * @param address - The load
 * @param request - The delivery, and its as-of
 * @param actor - Who the load's commit names
 * @returns The response: the job's id, or the error
 */
export async function startRecordLoad(store: RecordLoadStore, address: LoadAddress, request: RecordLoadRequest, actor: string): Promise<Response> {
  try {
    const id = globalThis.crypto.randomUUID();
    await store.create(id, {
      repo: address.repo,
      workspace: address.workspace,
      record: address.record,
      source: address.source,
      delivery: request.delivery,
      actor,
      asOf: request.asOf,
      cancel: none,
      status: variant('processing', none),
      createdAt: new Date(),
    });
    await store.execute(id, address.repo);
    return sendSuccess(PackageJobResponseType, { id });
  } catch (err) {
    return sendError(PackageJobResponseType, errorToVariant(err));
  }
}

/** The load job `id` a request addresses: `null` when its workspace launched
 *  no such load of the record's source. */
async function addressed(store: RecordLoadStore, address: LoadAddress, id: string): Promise<RecordLoadJob | null> {
  const job = await store.get(id);
  if (job === null) return null;
  const same = sameName(job.repo, address.repo) && sameName(job.workspace, address.workspace)
    && sameName(job.record, address.record) && sameName(job.source, address.source);
  return same ? job : null;
}

/** The answer to a request for a load its workspace never launched. */
function noLoad(address: LoadAddress, id: string): Response {
  return sendError(RecordLoadStatusType, variant('internal', {
    message: `workspace '${address.workspace}' has no load '${id}' of ${address.record}.${address.source}`,
  }));
}

/**
 * A load's status: how far its job has got, what the load did, why it did
 * not, or that it was cancelled.
 *
 * @param store - Where the job is filed
 * @param address - The load
 * @param id - The job's id
 * @returns The response: the status; or `internal` when this workspace
 *   launched no such load
 */
export async function getRecordLoadStatus(store: RecordLoadStore, address: LoadAddress, id: string): Promise<Response> {
  try {
    const job = await addressed(store, address, id);
    if (job === null) return noLoad(address, id);
    return sendSuccess(RecordLoadStatusType, job.status);
  } catch (err) {
    return sendError(RecordLoadStatusType, errorToVariant(err));
  }
}

/**
 * Ask a load to cancel: the request is recorded on its job, which the job
 * reads within a second as it runs, and acts on (ruling 28).
 *
 * @remarks
 * Only the job writes its end. Stopped before its commit wrote, it ends
 * `cancelled`, and its finished pieces stay cached; once its commit has
 * written, the load has landed, and it ends `completed`. A job that has ended
 * is left as it is. The answer is the job as it stands once the request is
 * recorded — still `processing`, for the caller to follow to its end — or the
 * end it had come to.
 *
 * @param store - Where the job is filed
 * @param address - The load
 * @param id - The job's id
 * @param by - Who asks
 * @returns The response: the job's status as it stands; or `internal` when
 *   this workspace launched no such load
 */
export async function cancelRecordLoad(store: RecordLoadStore, address: LoadAddress, id: string, by: string): Promise<Response> {
  try {
    if (await addressed(store, address, id) === null) return noLoad(address, id);
    const job = await store.cancel(id, { by: some(by), at: new Date() });
    if (job === null) return noLoad(address, id);
    return sendSuccess(RecordLoadStatusType, job.status);
  } catch (err) {
    return sendError(RecordLoadStatusType, errorToVariant(err));
  }
}
