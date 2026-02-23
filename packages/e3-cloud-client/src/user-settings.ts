/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

/**
 * Per-user per-workspace settings API functions.
 *
 * These functions use raw HTTP (application/octet-stream) rather than BEAST2
 * because user settings are stored as opaque binary blobs.
 */

import { ApiError, AuthError, type RequestOptions } from '@elaraai/e3-api-client';

function headers(options: RequestOptions): Record<string, string> {
  const h: Record<string, string> = {};
  if (options.token) h['Authorization'] = `Bearer ${options.token}`;
  return h;
}

function settingsPath(repo: string, workspace: string): string {
  return `/api/repos/${encodeURIComponent(repo)}/workspaces/${encodeURIComponent(workspace)}/user-settings`;
}

async function handleErrorResponse(res: Response): Promise<never> {
  if (res.status === 401) {
    throw new AuthError(res.statusText);
  }
  try {
    const body = await res.json() as {
      error?: string | { type: string; message?: string };
      message?: string;
    };
    // Authz middleware returns { error: { type, message } }
    // Route handlers return { error: 'string', message: '...' }
    const code = typeof body.error === 'object' && body.error !== null
      ? body.error.type
      : body.error;
    const message = typeof body.error === 'object' && body.error !== null
      ? body.error.message
      : body.message;
    throw new ApiError(code ?? 'unknown', message);
  } catch (err) {
    if (err instanceof ApiError || err instanceof AuthError) throw err;
    throw new ApiError('unknown', `HTTP ${res.status}`);
  }
}

/**
 * Get user settings for the authenticated user in a workspace.
 *
 * @returns The settings binary data, or null if no settings exist.
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function getUserSettings(
  url: string,
  repo: string,
  workspace: string,
  options: RequestOptions,
): Promise<Uint8Array | null> {
  const res = await fetch(`${url}${settingsPath(repo, workspace)}`, {
    method: 'GET',
    headers: headers(options),
  });

  if (res.status === 204) return null;
  if (!res.ok) return handleErrorResponse(res);

  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Put user settings for the authenticated user in a workspace.
 *
 * @throws {ApiError} On application-level errors (not_found, conflict, payload_too_large)
 * @throws {AuthError} On 401 Unauthorized
 */
export async function putUserSettings(
  url: string,
  repo: string,
  workspace: string,
  data: Uint8Array,
  options: RequestOptions,
): Promise<void> {
  const res = await fetch(`${url}${settingsPath(repo, workspace)}`, {
    method: 'PUT',
    headers: { ...headers(options), 'Content-Type': 'application/octet-stream' },
    body: data,
  });

  if (res.status === 204) return;
  if (!res.ok) return handleErrorResponse(res);
}

/**
 * Delete user settings for the authenticated user in a workspace.
 *
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function deleteUserSettings(
  url: string,
  repo: string,
  workspace: string,
  options: RequestOptions,
): Promise<void> {
  const res = await fetch(`${url}${settingsPath(repo, workspace)}`, {
    method: 'DELETE',
    headers: headers(options),
  });

  if (res.status === 204) return;
  if (!res.ok) return handleErrorResponse(res);
}
