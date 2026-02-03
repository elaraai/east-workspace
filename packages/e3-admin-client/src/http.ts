/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under the Business Source License 1.1. See LICENSE.md for details.
 */

/**
 * HTTP utilities for e3 admin client using BEAST2 format.
 *
 * The e3 API uses BEAST2 (binary East serialization) for all requests/responses.
 * This module provides typed HTTP helpers that handle encoding/decoding.
 *
 * Uses types from @elaraai/e3-api-client for compatibility with the server.
 */

import { decodeBeast2For, encodeBeast2For } from '@elaraai/east';
import type { EastType, ValueTypeOf } from '@elaraai/east';
import { ApiTypes } from '@elaraai/e3-api-client';

// Import types from ApiTypes namespace
const { ResponseType, ErrorType } = ApiTypes;
type ApiError = ValueTypeOf<typeof ErrorType>;

/**
 * Request options for API calls.
 */
export interface RequestOptions {
  /** Bearer token for authentication (null for unauthenticated requests) */
  token: string | null;
}

/**
 * API response wrapper - success or typed error.
 */
export type Response<T> =
  | { type: 'success'; value: T }
  | { type: 'error'; value: AdminError };

/**
 * Typed admin API error.
 */
export class AdminError extends Error {
  constructor(
    public readonly code: string,
    public readonly details: unknown
  ) {
    super(`Admin error: ${code}`);
    this.name = 'AdminError';
  }

  static fromApiError(error: ApiError): AdminError {
    return new AdminError(error.type, error.value);
  }
}

/**
 * Authentication error (401 Unauthorized).
 */
export class AuthError extends Error {
  constructor(message: string = 'Authentication required') {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Unwrap a response, throwing on error.
 *
 * @param response - The response to unwrap
 * @returns The success value
 * @throws AdminError if the response is an error
 */
export function unwrap<T>(response: Response<T>): T {
  if (response.type === 'error') throw response.value;
  return response.value;
}

/**
 * Create authorization headers.
 */
function authHeaders(token: string | null): Record<string, string> {
  if (token === null) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * JSON error response format from the server.
 */
interface JsonErrorResponse {
  success: false;
  error: {
    type: string;
    message?: string;
  };
}

/**
 * Try to parse error details from JSON response body.
 * Returns the error code from the body if available, otherwise uses fallback.
 */
async function parseJsonError(
  response: globalThis.Response,
  fallbackCode: string
): Promise<AdminError> {
  const text = await response.text();
  try {
    const json = JSON.parse(text) as JsonErrorResponse;
    if (json.error?.type) {
      return new AdminError(json.error.type, json.error.message ?? text);
    }
  } catch {
    // Not JSON or doesn't have expected structure
  }
  return new AdminError(fallbackCode, text);
}

/**
 * Decode a BEAST2 response.
 *
 * Returns typed Response<T> for all cases including errors.
 * HTTP errors are converted to AdminError with codes from the response body.
 */
async function decodeResponse<T extends EastType>(
  response: globalThis.Response,
  successType: T
): Promise<Response<ValueTypeOf<T>>> {
  // Handle HTTP-level errors - parse error code from JSON body
  if (response.status === 401) {
    return {
      type: 'error',
      value: await parseJsonError(response, 'unauthorized'),
    };
  }

  if (response.status === 403) {
    return {
      type: 'error',
      value: await parseJsonError(response, 'forbidden'),
    };
  }

  if (response.status === 400) {
    return {
      type: 'error',
      value: await parseJsonError(response, 'bad_request'),
    };
  }

  if (response.status === 404) {
    return {
      type: 'error',
      value: await parseJsonError(response, 'not_found'),
    };
  }

  // Decode BEAST2 response using e3-api-client's ResponseType
  const buffer = await response.arrayBuffer();
  const decode = decodeBeast2For(ResponseType(successType));
  const result = decode(new Uint8Array(buffer));

  // Convert to our Response type
  if (result.type === 'error') {
    return {
      type: 'error',
      value: AdminError.fromApiError(result.value),
    };
  }

  return {
    type: 'success',
    value: result.value as ValueTypeOf<T>,
  };
}

/**
 * Perform a GET request with BEAST2 response.
 */
export async function get<T extends EastType>(
  url: string,
  successType: T,
  options: RequestOptions
): Promise<Response<ValueTypeOf<T>>> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...authHeaders(options.token),
      Accept: 'application/beast2',
    },
  });

  return decodeResponse(response, successType);
}

/**
 * Perform a POST request with BEAST2 body and response.
 */
export async function post<Req extends EastType, Res extends EastType>(
  url: string,
  body: ValueTypeOf<Req>,
  requestType: Req,
  successType: Res,
  options: RequestOptions
): Promise<Response<ValueTypeOf<Res>>> {
  const encode = encodeBeast2For(requestType);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...authHeaders(options.token),
      'Content-Type': 'application/beast2',
      Accept: 'application/beast2',
    },
    body: encode(body),
  });

  return decodeResponse(response, successType);
}

/**
 * Perform a DELETE request with BEAST2 response.
 */
export async function del<T extends EastType>(
  url: string,
  successType: T,
  options: RequestOptions
): Promise<Response<ValueTypeOf<T>>> {
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      ...authHeaders(options.token),
      Accept: 'application/beast2',
    },
  });

  return decodeResponse(response, successType);
}

// Re-export error type for external use
export { ErrorType };
