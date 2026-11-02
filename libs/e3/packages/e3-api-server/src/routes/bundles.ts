/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import { Hono } from 'hono';
import { some } from '@elaraai/east';
import { workspaceBundleExport, workspaceBundleImport, type StorageBackend } from '@elaraai/e3-core/portable';
import { BEAST2_CONTENT_TYPE, WorkspaceInfoType } from '@elaraai/e3-types';
import { sendError, sendSuccess } from '../beast2.js';
import { errorToVariant, sendJsonError } from '../errors.js';

/**
 * A workspace's bundle (`WorkspaceBundleType`), mounted at
 * `/api/repos/:repo/workspaces` beside the workspace routes: the workspace
 * written out as it is, and a workspace made from one.
 *
 * @remarks
 * Each streams its bundle within its request, the export as it reads the
 * workspace and the import as it stores what it is sent, so a host mounts them
 * where a workspace's bundle fits in a request's time and size: its own
 * process, or the browser's e3. The export answers its refusals — a workspace
 * that does not exist, has no package deployed, or is held — as JSON, as every
 * route of raw bytes does; a failure once the bundle has begun ends its stream
 * short, which a reader refuses. The import answers as a copy does, with the
 * workspace made, or its refusal.
 *
 * @param storage - Storage backend
 * @param getRepoPath - The repository identifier for a repo name
 * @returns The routes
 */
export function createWorkspaceBundleRoutes(storage: StorageBackend, getRepoPath: (repo: string) => string) {
  const app = new Hono();

  // GET /api/repos/:repo/workspaces/:ws/bundle - The workspace as a bundle,
  // streamed
  app.get('/:ws/bundle', async (c) => {
    const repoPath = getRepoPath(c.req.param('repo')!);
    const ws = c.req.param('ws')!;
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    let failure: unknown;
    const exported = workspaceBundleExport(storage, repoPath, ws, writable).catch((err: unknown) => {
      failure = err;
    });
    // The first chunk is written once everything the bundle carries is known:
    // a refusal before it is answered as the error it is
    const reader = readable.getReader();
    const first = await reader.read().catch(() => null);
    if (first === null || first.done) {
      await exported;
      reader.releaseLock();
      return sendJsonError(failure ?? new Error(`the bundle of workspace '${ws}' ended before it began`));
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first.value);
      },
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (err) {
          controller.error(err);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return new Response(body, { headers: { 'Content-Type': BEAST2_CONTENT_TYPE } });
  });

  // POST /api/repos/:repo/workspaces/:ws/bundle - Make the workspace from the
  // bundle the body holds, under a name no workspace has
  app.post('/:ws/bundle', async (c) => {
    const repoPath = getRepoPath(c.req.param('repo')!);
    const ws = c.req.param('ws')!;
    try {
      const made = await workspaceBundleImport(storage, repoPath, ws, c.req.raw.body ?? []);
      return sendSuccess(WorkspaceInfoType, {
        name: ws,
        deployed: true,
        packageName: some(made.package.name),
        packageVersion: some(made.package.version),
      });
    } catch (err) {
      return sendError(WorkspaceInfoType, errorToVariant(err));
    }
  });

  return app;
}
