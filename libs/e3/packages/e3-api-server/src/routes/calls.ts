/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Routes for a workspace's kept calls of named functions (east-workspace#1554),
 * mounted at `/api/repos/:repo/workspaces/:ws/calls`.
 *
 * A call is started through the function routes (`POST …/functions/:fn/calls`,
 * or the sync `POST …/functions/:fn`), and kept until the lifetime its end
 * gives it. These routes poll it, cancel it, list the workspace's calls and
 * read one whole. Who may read or cancel a call is the host's to say, since
 * only its auth knows who the caller is: the routes take a {@link CallAccess},
 * and a host whose routes admit every caller of the workspace to every call
 * gives none.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { StorageBackend, TransferBackend } from '@elaraai/e3-core/portable';
import { sendError } from '../beast2.js';
import { errorToVariant } from '../errors.js';
import type { Identity } from '../identity.js';
import {
  FunctionCallPageType,
  FunctionCallStateType,
  FunctionCallStatusType,
  FunctionCallType,
  type FunctionCall,
  type FunctionCallState,
} from '../types.js';
import {
  cancelFunctionCall,
  getFunctionCall,
  getFunctionCallStatus,
  listFunctionCalls,
  type CallAdmit,
} from '../handlers/calls.js';
import { badQuery, wholeQuery } from './query.js';

/** The longest a poll of a call waits for it to end, unless the host says. */
export const DEFAULT_CALL_POLL_WAIT_MS = 20_000;

/** The longest a cancel waits for its call to stop before it answers. */
const CANCEL_WAIT_MS = 2_000;

/**
 * Who makes a request, as a kept call records it — who made the call, or who
 * cancelled it: the host's auth's name for them, or `null` without one.
 */
export type CallerOf = (c: Context) => string | null;

/**
 * Who makes a request, by the identity a host's auth set on its context: its
 * email, else its subject; `null` for a request with none, as on a server
 * without auth.
 *
 * @param c - The request's context
 * @returns The caller's name, or `null`
 */
export function callerOfIdentity(c: Context): string | null {
  const identity = (c as Context<{ Variables: { identity?: Identity } }>).get('identity');
  if (identity === undefined) return null;
  return identity.email ?? identity.sub;
}

/**
 * Whether a request's caller may read a kept call — its status, or the call
 * whole — or cancel it. Only the host's auth knows who the caller is, so a
 * host whose callers see only some of a workspace's calls decides: by the
 * call's `caller`, say.
 */
export type CallAccess = (c: Context, call: FunctionCall, action: 'read' | 'cancel') => boolean | Promise<boolean>;

/** Options for {@link createWorkspaceCallRoutes}. */
export interface CallRoutesOptions {
  /** The longest a poll waits for its call to end (default 20 000 ms): a
   *  host whose held requests cost it keeps this short */
  pollWaitMs?: number;
  /** Who asks to cancel a call (default {@link callerOfIdentity}) */
  callerOf?: CallerOf;
  /** Who may read and cancel a call (default: every caller the routes admit) */
  access?: CallAccess;
}

/** The access check of one request to one call, by the routes' options. */
function admitting(c: Context, options: CallRoutesOptions, action: 'read' | 'cancel'): CallAdmit | undefined {
  const access = options.access;
  return access === undefined ? undefined : (call) => access(c, call, action);
}

/**
 * A workspace's kept calls, mounted at `/api/repos/:repo/workspaces/:ws/calls`.
 *
 * - `GET /[?function=&state=&before=&limit=]` lists the workspace's calls, the
 *   latest first, a page at a time: `FUNCTION_CALLS_PAGE_DEFAULT` unless
 *   `limit` says, and never more than `FUNCTION_CALLS_PAGE_MAX`. A page's
 *   `next` is the next page's `before`.
 * - `GET /:id` answers a call whole: its arguments, the versions of the inputs
 *   it read, its value by hash, its log tails, and when it is forgotten.
 * - `GET /:id/status[?wait=ms]` answers how a call stands: `running`, or its
 *   result once it ended, `cancelled` or `lost`. With `wait`, it holds the
 *   answer until the call ends or the wait passes, at most `pollWaitMs`.
 * - `POST /:id/cancel` asks a running call to stop, and answers its status
 *   once it has, or `running` while it stops; a call that has ended is left as
 *   it is.
 *
 * A query given wrong — a `limit` or `wait` that is no whole number, a `state`
 * no call is in — is refused `400 bad_request` before any store is asked.
 *
 * @param storage - Storage backend
 * @param getRepoPath - A repository's identifier from its name
 * @param transferBackend - Runs the calls, and hears of their ends
 * @param options - How long a poll may wait, who cancels, and who may read
 *   and cancel a call
 * @returns The routes
 */
export function createWorkspaceCallRoutes(
  storage: StorageBackend,
  getRepoPath: (repo: string) => string,
  transferBackend: TransferBackend,
  options: CallRoutesOptions = {},
) {
  const app = new Hono();
  const pollWaitMs = options.pollWaitMs ?? DEFAULT_CALL_POLL_WAIT_MS;
  const callerOf = options.callerOf ?? callerOfIdentity;
  // The states a call is in, by the tags of their East type
  const states: ReadonlySet<string> = new Set(Object.keys(FunctionCallStateType.cases));
  const isState = (tag: string): tag is FunctionCallState['type'] => states.has(tag);

  app.get('/', async (c) => {
    try {
      const window = wholeQuery(c, { limit: 1 });
      if (window instanceof Response) return window;
      const state = c.req.query('state') ?? '';
      if (state !== '' && !isState(state)) {
        return badQuery(`state must be one of ${[...states].join(', ')}, got ${JSON.stringify(state)}`);
      }
      const before = c.req.query('before');
      const fn = c.req.query('function');
      return await listFunctionCalls(storage, getRepoPath(c.req.param('repo')!), c.req.param('ws')!, {
        ...(window.limit !== undefined && { limit: window.limit }),
        ...(before !== undefined && before !== '' && { before }),
        ...(fn !== undefined && fn !== '' && { function: fn }),
        ...(isState(state) && { state }),
      });
    } catch (err) {
      return sendError(FunctionCallPageType, errorToVariant(err));
    }
  });

  app.get('/:id', async (c) => {
    try {
      return await getFunctionCall(storage, getRepoPath(c.req.param('repo')!), c.req.param('ws')!, c.req.param('id'), admitting(c, options, 'read'));
    } catch (err) {
      return sendError(FunctionCallType, errorToVariant(err));
    }
  });

  app.get('/:id/status', async (c) => {
    const repo = c.req.param('repo')!;
    try {
      const query = wholeQuery(c, { wait: 0 });
      if (query instanceof Response) return query;
      const admit = admitting(c, options, 'read');
      return await getFunctionCallStatus(storage, transferBackend.functionCalls, repo, getRepoPath(repo), c.req.param('ws')!, c.req.param('id'), {
        waitMs: Math.min(query.wait ?? 0, pollWaitMs),
        ...(admit !== undefined && { admit }),
      });
    } catch (err) {
      return sendError(FunctionCallStatusType, errorToVariant(err));
    }
  });

  app.post('/:id/cancel', async (c) => {
    const repo = c.req.param('repo')!;
    try {
      const admit = admitting(c, options, 'cancel');
      return await cancelFunctionCall(storage, transferBackend.functionCalls, repo, getRepoPath(repo), c.req.param('ws')!, c.req.param('id'), {
        by: callerOf(c),
        waitMs: Math.min(CANCEL_WAIT_MS, pollWaitMs),
        ...(admit !== undefined && { admit }),
      });
    } catch (err) {
      return sendError(FunctionCallStatusType, errorToVariant(err));
    }
  });

  return app;
}
