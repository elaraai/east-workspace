/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Tests for a run that stops after its cancel answers (#1286):
 * `dataflowCancel` follows the run it cancelled until it has stopped, and a
 * start, a deploy or a workspace's removal the workspace's lock refuses with a
 * `Retry-After` — as a server refuses one while a stopping run holds the
 * workspace — waits as the server says and asks again. Through a stand-in
 * server given as the `fetch`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NullType, encodeBeast2For, none, some, variant, type EastType, type ValueTypeOf } from '@elaraai/east';
import {
  ApiDataflowExecutionStateType, BEAST2_CONTENT_TYPE, PackageJobResponseType, ResponseType, WorkspaceDeployStatusType, type Error as ApiErrorValue,
} from '@elaraai/e3-types';
import { dataflowCancel, dataflowExecuteLaunch } from './executions.js';
import { ApiError } from './http.js';
import { workspaceDeploy, workspaceRemove } from './workspaces.js';

const BASE = 'https://e3.test';
const AT = '2026-10-13T00:00:00.000Z';

/** A BEAST2 success, as the server sends one. */
function success<T extends EastType>(type: T, value: ValueTypeOf<T>, status = 200): globalThis.Response {
  const body = encodeBeast2For(ResponseType(type))(variant('success', value) as never);
  return new Response(body, { status, headers: { 'Content-Type': BEAST2_CONTENT_TYPE } });
}

/** A BEAST2 refusal, as the server sends one, with its headers. */
function refusal<T extends EastType>(type: T, error: ApiErrorValue, headers: Record<string, string> = {}): globalThis.Response {
  const body = encodeBeast2For(ResponseType(type))(variant('error', error) as never);
  return new Response(body, { status: 200, headers: { 'Content-Type': BEAST2_CONTENT_TYPE, ...headers } });
}

/** The refusal of a workspace something holds. */
const locked = variant('workspace_locked', { workspace: 'ws', holder: variant('unknown', null) });

/** A run's state, as its poll answers it. */
function run(runId: string, status: 'running' | 'stopping' | 'aborted'): ValueTypeOf<typeof ApiDataflowExecutionStateType> {
  return {
    runId, status: variant(status, null), startedAt: AT, completedAt: status === 'aborted' ? some(AT) : none, summary: none,
    events: [], nextSeq: 0n, lastSeq: 0n, budget: none, waiting: [], splits: [],
  };
}

/**
 * A server that answers each request by the first of `routes` it matches —
 * `METHOD /path` — with that route's answers in turn, its last again.
 *
 * @returns The requests, as `METHOD /path`, and the `fetch` the server answers
 */
function server(routes: Record<string, Array<() => globalThis.Response>>): { requests: string[]; fetch: typeof globalThis.fetch } {
  const requests: string[] = [];
  const served = new Map<string, number>();
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    requests.push(key);
    if (requests.length > 20) return new Response('the client asked on and on', { status: 500 });
    const answers = routes[key];
    if (answers === undefined) return new Response(`unexpected ${key}`, { status: 500 });
    const at = served.get(key) ?? 0;
    served.set(key, at + 1);
    return answers[Math.min(at, answers.length - 1)]!();
  }) as typeof globalThis.fetch;
  return { requests, fetch };
}

const POLL = 'GET /api/repos/r/workspaces/ws/dataflow/execution';
const CANCEL = 'POST /api/repos/r/workspaces/ws/dataflow/cancel';

describe('a cancel that answers before its run has stopped (#1286)', () => {
  it('follows the run it cancelled while it is stopping, and answers once it has stopped', async () => {
    const { requests, fetch } = server({
      [POLL]: [
        () => success(ApiDataflowExecutionStateType, run('run-1', 'running')),
        () => success(ApiDataflowExecutionStateType, run('run-1', 'stopping')),
        () => success(ApiDataflowExecutionStateType, run('run-1', 'stopping')),
        () => success(ApiDataflowExecutionStateType, run('run-1', 'aborted')),
      ],
      [CANCEL]: [() => success(NullType, null)],
    });
    let told = 0;
    await dataflowCancel(BASE, 'r', 'ws', { token: null, fetch }, { onStopping: () => { told++; } });
    assert.deepEqual(requests, [POLL, CANCEL, POLL, POLL, POLL]);
    assert.equal(told, 1, 'told once that the run is stopping');
  });

  it('answers at once when the cancel answers once its run has ended, as a local server\'s does', async () => {
    const { requests, fetch } = server({
      [POLL]: [
        () => success(ApiDataflowExecutionStateType, run('run-1', 'running')),
        () => success(ApiDataflowExecutionStateType, run('run-1', 'aborted')),
      ],
      [CANCEL]: [() => success(NullType, null)],
    });
    await dataflowCancel(BASE, 'r', 'ws', { token: null, fetch });
    assert.deepEqual(requests, [POLL, CANCEL, POLL]);
  });

  it('stops following once another run has followed the one it cancelled', async () => {
    const { requests, fetch } = server({
      [POLL]: [
        () => success(ApiDataflowExecutionStateType, run('run-1', 'running')),
        () => success(ApiDataflowExecutionStateType, run('run-2', 'running')),
      ],
      [CANCEL]: [() => success(NullType, null)],
    });
    await dataflowCancel(BASE, 'r', 'ws', { token: null, fetch });
    assert.deepEqual(requests, [POLL, CANCEL, POLL]);
  });

  it('raises a cancel of a workspace that has never run as the server refuses it', async () => {
    const { fetch } = server({
      [POLL]: [() => refusal(ApiDataflowExecutionStateType, variant('execution_not_found', { task: 'ws' }))],
      [CANCEL]: [() => refusal(NullType, variant('dataflow_error', { message: 'No active execution for this workspace' }))],
    });
    await assert.rejects(dataflowCancel(BASE, 'r', 'ws', { token: null, fetch }), (err: unknown) => err instanceof ApiError && err.code === 'dataflow_error');
  });
});

describe('a workspace a stopping run still holds (#1286)', () => {
  const hinted = (type: EastType) => () => refusal(type, locked, { 'Retry-After': '0' });

  it('removes the workspace once the run lets it go, asking again as each refusal\'s Retry-After says', async () => {
    const { requests, fetch } = server({
      'DELETE /api/repos/r/workspaces/ws': [hinted(NullType), hinted(NullType), () => success(NullType, null)],
    });
    await workspaceRemove(BASE, 'r', 'ws', { token: null, fetch });
    assert.equal(requests.length, 3);
  });

  it('raises a refusal that names no Retry-After at once: something else holds the workspace', async () => {
    const { requests, fetch } = server({ 'DELETE /api/repos/r/workspaces/ws': [() => refusal(NullType, locked)] });
    await assert.rejects(workspaceRemove(BASE, 'r', 'ws', { token: null, fetch }), (err: unknown) =>
      err instanceof ApiError && err.code === 'workspace_locked' && err.retryAfterMs === undefined);
    assert.equal(requests.length, 1);
  });

  it('starts the dataflow once the run lets the workspace go', async () => {
    const { requests, fetch } = server({
      'POST /api/repos/r/workspaces/ws/dataflow': [hinted(NullType), hinted(NullType), () => success(NullType, null, 202)],
    });
    await dataflowExecuteLaunch(BASE, 'r', 'ws', {}, { token: null, fetch });
    assert.equal(requests.length, 3);
  });

  it('deploys once the run lets the workspace go', async () => {
    const { requests, fetch } = server({
      'POST /api/repos/r/workspaces/ws/deploy': [hinted(PackageJobResponseType), () => success(PackageJobResponseType, { id: 'job-1' })],
      'GET /api/repos/r/workspaces/ws/deploy/job-1': [() => success(WorkspaceDeployStatusType, variant('completed', { records: [], indexes: [], inputs: [], warnings: [] }))],
    });
    await workspaceDeploy(BASE, 'r', 'ws', 'p@1.0.0', { token: null, fetch });
    assert.deepEqual(requests, [
      'POST /api/repos/r/workspaces/ws/deploy', 'POST /api/repos/r/workspaces/ws/deploy', 'GET /api/repos/r/workspaces/ws/deploy/job-1',
    ]);
  });
});
