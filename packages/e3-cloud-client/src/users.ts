/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * User management API functions using BEAST2 format.
 */

import { ArrayType, NullType } from '@elaraai/east';
import {
  RepoUserType,
  WhoamiResponseType,
  AddUserRequestType,
  type RepoUser,
  type WhoamiResponse,
  type AddUserRequest,
} from '@elaraai/e3-cloud-types';
import { get, post, del, type RequestOptions } from '@elaraai/e3-api-client';

/**
 * Get current user info.
 *
 * @param url - The base URL of the e3 server (e.g., 'https://dev.e3.elaraai.com')
 * @param options - Request options including authentication token
 * @returns The current user's identity and admin status
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function whoami(
  url: string,
  options: RequestOptions
): Promise<WhoamiResponse> {
  return get(url, `/whoami`, WhoamiResponseType, options);
}

/**
 * List users with access to a repository.
 *
 * Requires: member role on the repository.
 *
 * @param url - The base URL of the e3 server
 * @param repo - The repository name
 * @param options - Request options including authentication token
 * @returns List of users with access to the repository
 * @throws {ApiError} On application-level errors
 * @throws {AuthError} On 401 Unauthorized
 */
export async function repoUsers(
  url: string,
  repo: string,
  options: RequestOptions
): Promise<RepoUser[]> {
  return get(
    url,
    `/repos/${encodeURIComponent(repo)}/users`,
    ArrayType(RepoUserType),
    options
  );
}

/**
 * Add a user to a repository.
 *
 * Requires: owner role on the repository.
 *
 * @param url - The base URL of the e3 server
 * @param repo - The repository name
 * @param request - The add user request containing email and role
 * @param options - Request options including authentication token
 * @returns The newly added user
 * @throws {ApiError} On application-level errors (e.g., user_not_found, forbidden)
 * @throws {AuthError} On 401 Unauthorized
 */
export async function addUser(
  url: string,
  repo: string,
  request: AddUserRequest,
  options: RequestOptions
): Promise<RepoUser> {
  return post(
    url,
    `/repos/${encodeURIComponent(repo)}/users`,
    request,
    AddUserRequestType,
    RepoUserType,
    options
  );
}

/**
 * Remove a user from a repository.
 *
 * Requires: owner role on the repository.
 *
 * @param url - The base URL of the e3 server
 * @param repo - The repository name
 * @param userId - The user ID to remove
 * @param options - Request options including authentication token
 * @throws {ApiError} On application-level errors (e.g., forbidden, last_owner)
 * @throws {AuthError} On 401 Unauthorized
 */
export async function removeUser(
  url: string,
  repo: string,
  userId: string,
  options: RequestOptions
): Promise<void> {
  await del(
    url,
    `/repos/${encodeURIComponent(repo)}/users/${encodeURIComponent(userId)}`,
    NullType,
    options
  );
}
