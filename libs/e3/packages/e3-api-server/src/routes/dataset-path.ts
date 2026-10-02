/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { Context } from 'hono';

/** A path segment as the client sent it, decoded, compared with `expected`;
 *  a segment that does not decode matches nothing. */
function decodesTo(segment: string, expected: string): boolean {
  try {
    return decodeURIComponent(segment) === expected;
  } catch {
    return false;
  }
}

/**
 * The dataset path a request to `/api/repos/:repo/workspaces/:ws/datasets/…`
 * names, as its client encoded it, with `suffix` — `/upload`, `/upload/<id>` —
 * and a trailing slash cut off: what `urlPathToTreePath` decodes, a segment at
 * a time. The dataset routes and the transfer routes read it here alone, so
 * they agree on it, and an upload's later requests are checked against the
 * path its init stored.
 *
 * @remarks
 * It is cut from the URL the client sent, every escape kept. Hono's
 * `c.req.path` is decoded (`decodeURI`), so a workspace named `my ws`,
 * `café` or `q[1]` — names a workspace may have — no longer matched a prefix
 * built from its name, and every one of its datasets read as the root. The
 * route's leading segments are compared decoded, so a client that escapes a
 * name otherwise than `encodeURIComponent` does names the same dataset.
 *
 * @param c - The request's context
 * @param suffix - What the route puts after the dataset's path, if anything
 * @returns The dataset's path, still percent-encoded; empty when the request
 *   names the root, or is not under the route
 */
export function datasetPathOf(c: Context, suffix = ''): string {
  const repo = c.req.param('repo');
  const ws = c.req.param('ws');
  if (repo === undefined || ws === undefined) return '';
  const head = ['', 'api', 'repos', repo, 'workspaces', ws, 'datasets'];
  const segments = new URL(c.req.url).pathname.split('/');
  if (segments.length < head.length || !head.every((part, i) => decodesTo(segments[i]!, part))) return '';
  let path = segments.slice(head.length).join('/');
  if (suffix !== '' && path.endsWith(suffix)) path = path.slice(0, -suffix.length);
  if (path.endsWith('/')) path = path.slice(0, -1);
  return path;
}
