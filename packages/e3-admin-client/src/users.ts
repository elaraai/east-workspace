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
} from '@elaraai/e3-admin-types';
import { get, post, del, type RequestOptions, type Response } from './http.js';

/**
 * Get current user info.
 *
 * @param url - The base URL of the e3 server (e.g., 'https://dev.e3.elaraai.com')
 * @param options - Request options including authentication token
 * @returns Response containing the current user's identity and admin status
 */
export async function whoami(
  url: string,
  options: RequestOptions
): Promise<Response<WhoamiResponse>> {
  return get(`${url}/api/whoami`, WhoamiResponseType, options);
}

/**
 * List users with access to a repository.
 *
 * Requires: member role on the repository.
 *
 * @param url - The base URL of the e3 server
 * @param repo - The repository name
 * @param options - Request options including authentication token
 * @returns Response containing list of users with access to the repository
 */
export async function repoUsers(
  url: string,
  repo: string,
  options: RequestOptions
): Promise<Response<RepoUser[]>> {
  return get(
    `${url}/api/repos/${encodeURIComponent(repo)}/users`,
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
 * @returns Response containing the newly added user
 */
export async function addUser(
  url: string,
  repo: string,
  request: AddUserRequest,
  options: RequestOptions
): Promise<Response<RepoUser>> {
  return post(
    `${url}/api/repos/${encodeURIComponent(repo)}/users`,
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
 * @returns Response indicating success or error
 */
export async function removeUser(
  url: string,
  repo: string,
  userId: string,
  options: RequestOptions
): Promise<Response<null>> {
  return del(
    `${url}/api/repos/${encodeURIComponent(repo)}/users/${encodeURIComponent(userId)}`,
    NullType,
    options
  );
}
