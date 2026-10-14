/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Conditional answers: the `ETag` a status route names its answer by, which a
 * client polling it sends back as `If-None-Match`, and the `304 Not Modified`
 * that answers a request whose tag is still the answer's.
 *
 * @remarks
 * A workspace's status is computed over its records: its dataset refs, its
 * tasks' executions and its lock. Its revision ({@link workspaceStatusRevision})
 * moves whenever any of them does, so a poll whose tag names the revision now
 * is answered without the status being computed, or any record of the
 * workspace read beyond the revision. The revision is read before the status
 * is computed, so the tag an answer carries is never newer than its content:
 * a change between the two moves the revision, and the next poll's tag
 * mismatches. Every answer is `Cache-Control: no-store`
 * ({@link conditionalHeaders}): the tag is for the server to compare, and
 * no cache between keeps a status or answers a poll in the server's place.
 *
 * @packageDocumentation
 */

import { workspaceStatusRevision, type StorageBackend } from '@elaraai/e3-core/portable';

/**
 * The entity tag of an answer computed over a revision: the revision, quoted,
 * as `ETag` carries one.
 *
 * @param revision - What the answer is computed over, which moves whenever
 *   the answer might
 * @returns The tag
 */
export function etagOf(revision: string): string {
  return `"${revision}"`;
}

/**
 * Whether an `If-None-Match` names an answer's tag: `*`, or one of the tags
 * it lists, each a strong or a weak (`W/`) validator.
 *
 * @remarks
 * The comparison is weak, as a conditional GET's is: a weak tag the client
 * holds matches the tag the server computed over the same revision.
 *
 * @param ifNoneMatch - The request's `If-None-Match`, as sent
 * @param etag - The answer's tag, as {@link etagOf} makes it
 * @returns Whether the request holds the answer
 */
export function etagMatches(ifNoneMatch: string, etag: string): boolean {
  const held = ifNoneMatch.trim();
  if (held === '*') return true;
  return held.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag);
}

/**
 * The headers a conditional answer carries: its `ETag`, and `Cache-Control:
 * no-store`, so no cache between the client and the server keeps a
 * workspace's status for whoever asks next, or answers a poll from what it
 * kept rather than sending the tag on for the server to compare.
 *
 * @param etag - The answer's tag
 * @returns The headers
 */
export function conditionalHeaders(etag: string): Record<string, string> {
  return { ETag: etag, 'Cache-Control': 'no-store' };
}

/**
 * The `304 Not Modified` that answers a conditional GET whose tag is still
 * the answer's: no body, and the headers of a conditional answer
 * ({@link conditionalHeaders}), the tag among them.
 *
 * @param etag - The answer's tag
 * @returns The response
 */
export function sendNotModified(etag: string): Response {
  return new Response(null, { status: 304, headers: conditionalHeaders(etag) });
}

/**
 * The tag of a workspace's status now, and whether a request holds it.
 *
 * @remarks
 * Read before the status is computed, so the tag is never newer than the
 * answer it names.
 *
 * @param storage - Storage backend
 * @param repoPath - Repository identifier
 * @param workspace - Workspace name
 * @param ifNoneMatch - The request's `If-None-Match`, when it sent one
 * @returns The tag, and whether the request holds the answer, in which case
 *   the route answers {@link sendNotModified}, and otherwise the answer with
 *   {@link conditionalHeaders}
 * @throws {WorkspaceNotFoundError} When there is no such workspace
 */
export async function workspaceStatusTag(
  storage: StorageBackend,
  repoPath: string,
  workspace: string,
  ifNoneMatch?: string,
): Promise<{ etag: string; held: boolean }> {
  const etag = etagOf(await workspaceStatusRevision(storage, repoPath, workspace));
  return { etag, held: ifNoneMatch !== undefined && etagMatches(ifNoneMatch, etag) };
}
